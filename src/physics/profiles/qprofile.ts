/**
 * Magnetic profiles from the poloidal flux of the state: ψ' on the faces (with the boundary value
 * set by I_p), q = Φ_b ρ/(π ψ'), the enclosed current I(ρ) and ⟨j·B⟩; and q95 located on the
 * equilibrium's ψ_N grid.
 */
import type { Equilibrium } from '../equilibrium/gs';
import { lerpTable } from '../numerics/interp';
import { MU0, type ProfileContext } from './context';
import { cellIndex } from './geometry1d';
import { qFromDpsi } from './mhd';

/** ψ → ψ', q (faces and cells), enclosed current, ⟨j·B⟩ (writes w.dpsiF, w.qF, w.q, w.IencF, w.jB) */
export function currentProfiles(ctx: ProfileContext, psi: ArrayLike<number>, Ip: number): void {
  const w = ctx.w;
  ctx.cur.dpsiF(psi as Float64Array, Ip, w.dpsiF);
  qFromDpsi(ctx.tg, w.dpsiF, w.qF, w.q);
  ctx.cur.Ienc(w.dpsiF, w.IencF);
  ctx.cur.jB(w.dpsiF, w.jB);
}

/**
 * Factor that makes the equilibrium's own current profile carry the boundary current I_p [A]: I_p over the enclosed current of its last
 * flux surface (eq.prof.Ienc, a line integral of the Grad–Shafranov solution, which is I_p only up to the discretisation of the
 * solver: 1.0006 to 1.0011 I_p on the presets). The initial ψ' = Φ_b ρ/(π q) is scaled by it (q by its inverse, 0.1 %).
 * The current equation takes I_p as its boundary condition, so without the factor the enclosed current of the last interior face
 * would exceed I_p and the outermost cell would carry a negative current (the packed grid, whose last cell holds 5e-4 I_p, shows it:
 * −5.8e-4 I_p on ITER15). 1 when the table gives no usable value (not finite, or more than 10 % off).
 */
export function equilibriumCurrentScale(eq: Pick<Equilibrium, 'prof'>, Ip: number): number {
  const I = eq.prof.Ienc, last = I.length > 0 ? I[I.length - 1] : NaN;
  const f = Ip / last;
  return Number.isFinite(f) && f > 0.9 && f < 1.1 ? f : 1;
}

/**
 * Radial ramp [ρ̂ start, ρ̂ end] over which the enclosed current of the initial state is taken over from the equilibrium's own table
 * (matchEdgeCurrent): the q profile the initial ψ' is built from diverges towards the X-point, and the metric coefficients the enclosed
 * current is made of (V', g2) are splined on the same table, so the enclosed current of the state differs from the table's by up to 1e-3 I_p
 * at ρ̂ 0.9 and 3e-4 I_p at the edge on the packed grid (5e-3 on the uniform grid, whose last cells are coarse): as much as the current of
 * the outermost cell of the packed grid, which held 2.4 to 3.7 times its neighbour's (ITER15, SPARC15) and, on the uniform grid, a negative
 * current in the last cells (SPARC15) once the edge-clustered 101-surface table of the equilibrium moved the errors.
 */
export const EDGE_CURRENT_RAMP: readonly [number, number] = [0.9, 0.97];

/**
 * The enclosed current of the initial state follows the equilibrium's own profile at the edge: from ρ̂ = 0.9 to 0.97 the slope of ψ at the
 * faces is moved (smoothstep weight) from the q-based value to the one that gives the enclosed current I(ρ_f) = V' g2 ψ'/(2π μ0) of the
 * table (eq.prof.Ienc, times `scale` of equilibriumCurrentScale, linear between its nodes: it is smooth and bounded at the edge, unlike q),
 * and ψ is integrated again from the first face that moved. Inside ρ̂ = 0.9 nothing changes, bit for bit; beyond 0.97 the state carries the
 * table's current at every face and the boundary face carries I_p, so the outermost cells hold their share of the table (2.6e-4 I_p on
 * ITER15 instead of 5.8e-4) and no cell is negative. Nothing is done when the table gives no usable current (not finite, not increasing
 * in ρ̂). `psi` is the ψ of the cells the slopes were taken from; Ip [A] is the boundary current.
 */
export function matchEdgeCurrent(ctx: ProfileContext, psi: Float64Array, scale: number, Ip: number): void {
  const g = ctx.tg, N = ctx.N, P = ctx.eq.prof;
  const x = P.rhoTor, I = P.Ienc, n = x.length;
  if (n < 4 || I.length !== n) return;
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(x[k]) || !Number.isFinite(I[k]) || (k > 0 && !(x[k] > x[k - 1]))) return;
  }
  const [a, b] = EDGE_CURRENT_RAMP;
  const dp = ctx.cur.dpsiF(psi, Ip, new Float64Array(N + 1));
  let first = -1;
  for (let f = 1; f < N; f++) {
    const r = g.rhoF[f];
    if (!(r > a)) continue;
    const u = Math.min(1, (r - a) / (b - a)), w = u * u * (3 - 2 * u);
    const slope = (2 * Math.PI * MU0 * scale * lerpTable(x, I, r)) / (g.VpF[f] * g.g2F[f]);
    dp[f] += w * (slope - dp[f]);
    if (first < 0) first = f;
  }
  if (first > 0) for (let i = first; i < N; i++) psi[i] = psi[i - 1] + g.distF[i] * dp[i];
}

/** q at ψ_N = 0.95: ρ_tor(ψ_N = 0.95) from the equilibrium, q interpolated linearly on the faces */
export function q95(ctx: ProfileContext): number {
  const w = ctx.w, g = ctx.tg;
  const P = ctx.eq.prof;
  let k = 0; while (k < P.psiN.length - 2 && P.psiN[k + 1] < 0.95) k++;
  const t = (0.95 - P.psiN[k]) / (P.psiN[k + 1] - P.psiN[k]);
  const r95 = P.rhoTor[k] + t * (P.rhoTor[k + 1] - P.rhoTor[k]);
  const f = cellIndex(g, r95);
  const u = (r95 - g.rhoF[f]) / g.dRhoC[f];
  return w.qF[f] + u * (w.qF[f + 1] - w.qF[f]);
}
