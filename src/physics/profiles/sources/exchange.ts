/**
 * Collisional electron–ion energy exchange. The heat solver couples T_e and T_i implicitly with
 * the rate ν_eq [1/s]:
 *
 *   ν_eq = 3.2×10⁻⁹ lnΛ Σ_j n_j Z_j²/A_j [cm⁻³] / T_e[eV]^{3/2}
 *
 * (NRL Plasma Formulary, energy equilibration rate of electrons with ion species j; the ion sum
 * comes from the composition).
 */
import { coulombLog } from '../../transport';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { SourceModel } from './SourceModel';

export class ExchangeSource implements SourceModel {
  readonly id = 'exchange';

  heat(ctx: ProfileContext, st: ProfileState): void {
    const w = ctx.w, N = ctx.N;
    const { Te, ne } = st;
    for (let i = 0; i < N; i++) {
      const Tev = Math.max(Te[i], 0.01);
      const lnL = coulombLog(ne[i], Tev);
      w.nuEq[i] = (3.2e-9 * lnL * ne[i] * w.ionSum[i] * 1e-6) / Math.pow(Tev * 1e3, 1.5);
    }
  }
}
