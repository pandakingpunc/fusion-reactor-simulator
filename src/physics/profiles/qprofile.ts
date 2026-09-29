/**
 * Magnetic profiles from the poloidal flux of the state: ψ' on the faces (with the boundary value
 * set by I_p), q = Φ_b ρ/(π ψ'), the enclosed current I(ρ) and ⟨j·B⟩; and q95 located on the
 * equilibrium's ψ_N grid.
 */
import type { Equilibrium } from '../equilibrium/gs';
import type { ProfileContext } from './context';
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
