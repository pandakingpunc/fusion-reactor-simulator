/**
 * Current sources and the ohmic heating they leave to the inductive current:
 *
 *  - neoclassical conductivity σ_neo and the bootstrap current ⟨j_bs·B⟩ (Sauter, Angioni &
 *    Lin-Liu, Phys. Plasmas 6 (1999) 2834, Eqs. (5), (13)–(18); α corrected in Phys. Plasmas 9
 *    (2002) 5140; neoclassical.ts), with the ρ derivatives of p, T_e, T_i by central differences
 *    (one-sided to the separatrix value at the edge), and the plasma pressure p = n_e T_e + n_i T_i;
 *  - driven current: the current() hooks of the sources (NBCD in nbi.ts, ECCD in rf.ts), with the
 *    common efficiency scaling I_CD = γ P/(n̄₂₀ R0), ⟨j·B⟩ ≈ j B0 (cdDensity20, cdTeFactor);
 *  - ohmic heating of the inductive part: P_Ω = (⟨j·B⟩ − ⟨j_ni·B⟩)² / (σ ⟨B²⟩).
 */
import { KEV, ProfileContext } from '../context';
import { sigmaNeo, bootstrapJB } from '../neoclassical';
import type { ProfileState } from '../state';

/** n̄_e/10²⁰ m⁻³ (line average, floor 0.05) of the current-drive efficiency */
export function cdDensity20(ctx: ProfileContext, ne: ArrayLike<number>): number {
  return Math.max(ctx.lineAvg(ne) / 1e20, 0.05);
}

/** T_e/10 keV at cell i, clamped to [0.05, 1.5]: the T_e dependence of the current-drive efficiency */
export function cdTeFactor(Te: ArrayLike<number>, i: number): number {
  return Math.min(Math.max(Te[i] / 10, 0.05), 1.5);
}

/** σ_neo, pressure and bootstrap current of the iterate (writes w.sigma, w.p, w.jbsB) */
export function neoclassicalCurrent(ctx: ProfileContext, st: ProfileState): void {
  const w = ctx.w, g = ctx.tg, N = ctx.N;
  const { Te, Ti, ne } = st;
  const dpsiC = (i: number) => 0.5 * (w.dpsiF[i] + w.dpsiF[i + 1]);
  for (let i = 0; i < N; i++) {
    const Tev = Math.max(Te[i], 0.01);
    w.sigma[i] = sigmaNeo(g.ftC[i], w.nuE[i], ne[i], Tev * 1e3, Math.max(w.Zeff[i], 1));
    w.p[i] = (ne[i] * Tev + w.ni[i] * Math.max(Ti[i], 0.01)) * KEV;
  }
  // bootstrap: ρ derivatives at the centres (central differences; one-sided to the boundary value at the edge)
  const TeB = ctx.bc.Te, TiB = ctx.bc.Ti, nB = ctx.bc.n;
  const niB = nB * (w.ni[N - 1] / Math.max(ne[N - 1], 1));
  const pB = (nB * TeB + niB * TiB) * KEV;
  for (let i = 0; i < N; i++) {
    const im = Math.max(i - 1, 0);
    const h = g.spanC[i];
    const pR = i < N - 1 ? w.p[i + 1] : pB, TeR = i < N - 1 ? Te[i + 1] : TeB, TiR = i < N - 1 ? Ti[i + 1] : TiB;
    const pL = i === 0 ? w.p[0] : w.p[im], TeL = i === 0 ? Te[0] : Te[im], TiL = i === 0 ? Ti[0] : Ti[im];
    const dlnp = (pR - pL) / h / Math.max(w.p[i], 1);
    const dlnTe = (TeR - TeL) / h / Math.max(Te[i], 1e-3);
    const dlnTi = (TiR - TiL) / h / Math.max(Ti[i], 1e-3);
    const pe = ne[i] * Math.max(Te[i], 0.01) * KEV;
    const Rpe = pe / Math.max(w.p[i], 1);
    w.jbsB[i] = Math.max(0, bootstrapJB(g.FC[i], w.p[i], Rpe, ctx.sauter[i], dlnp, dlnTe, dlnTi, Math.max(dpsiC(i), 1e-12)));
  }
}

/** Non-inductive current j_ni = j_bs + j_cd and the ohmic heating of the rest (writes w.jniB, w.Poh) */
export function ohmicHeating(ctx: ProfileContext): void {
  const w = ctx.w, g = ctx.tg, N = ctx.N;
  for (let i = 0; i < N; i++) w.jniB[i] = w.jbsB[i] + w.jcdB[i];
  for (let i = 0; i < N; i++) {
    const jind = w.jB[i] - w.jniB[i];
    w.Poh[i] = (jind * jind) / (Math.max(w.sigma[i], 1) * g.B2C[i]);
  }
}
