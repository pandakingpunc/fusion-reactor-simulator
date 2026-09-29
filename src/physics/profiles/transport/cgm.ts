/**
 * Critical-gradient model ('cgm'): predictive and uncalibrated (experimental option).
 *
 *   χ_i = q^{3/2} χ_gB (R/L_Ti − κ_c)² H(R/L_Ti − κ_c) + 0.1 χ_gB + 0.05 m²/s,   χ_e = χ_i/2,
 *   χ_gB = (T_i/e B0)(ρ_s/R0),  ρ_s = √(m_i T_e)/(e B0),  κ_c = 4.5
 *
 * (Garbet et al., Plasma Phys. Control. Fusion 46 (2004) 1351).
 */
import { AMU, KEV, ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { TransportModel } from './TransportModel';

export class CriticalGradientTransport implements TransportModel {
  readonly id = 'cgm';
  readonly predictive = true;

  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void {
    const w = ctx.w, g = ctx.tg, N = ctx.N;
    const { Te, Ti } = st;
    for (let f = 0; f <= N; f++) {
      const iL = Math.max(0, Math.min(N - 2, f - 1));
      const Tif = Math.max(0.5 * (Ti[iL] + Ti[iL + 1]), 0.01), Tef = Math.max(0.5 * (Te[iL] + Te[iL + 1]), 0.01);
      const dTi = (Ti[iL + 1] - Ti[iL]) / g.distF[iL + 1] * g.gradRhoF[f];
      const RLT = (-g.R0 * dTi) / Tif;
      const mi = ctx.M * AMU;
      const rhoS = Math.sqrt(mi * Tef * KEV) / (1.602176634e-19 * g.B0);
      const chiGB = (Tif * 1e3 / g.B0) * (rhoS / g.R0);
      const qf = Math.max(w.qF[f], 0.5);
      const x = Math.max(RLT - 4.5, 0);
      const chiTi = Math.pow(qf, 1.5) * chiGB * x * x + 0.1 * chiGB + 0.05;
      chiI[f] = chiTi;
      chiE[f] = chiTi / 2;
    }
  }
}
