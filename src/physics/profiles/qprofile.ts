/**
 * Magnetic profiles from the poloidal flux of the state: ψ' on the faces (with the boundary value
 * set by I_p), q = Φ_b ρ/(π ψ'), the enclosed current I(ρ) and ⟨j·B⟩; and q95 located on the
 * equilibrium's ψ_N grid.
 */
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
