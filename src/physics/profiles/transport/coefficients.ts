/**
 * Transport coefficients on the faces for the current Picard iterate: the anomalous χ of the
 * transport model, then the parts common to every model (see TransportModel.ts for the order):
 * edge transport barrier, particle diffusivity D = (D/χ)·χ_e + 0.02 m²/s with the inward pinch
 * v = −2 P ρ D ⟨|∇ρ|²⟩/⟨|∇ρ|⟩ that makes the source-free profile n ∝ exp(−P ρ²), NTM islands
 * (+5 m²/s), the neoclassical ion floor and a 0.01 m²/s numerical floor.
 */
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { islandRegions } from '../events/ntm';
import { barrierFactor } from './pedestal';
import type { TransportModel } from './TransportModel';

/** Writes w.chiE, w.chiI, w.D, w.v (and the anomalous parts w.chiTurbE, w.chiTurbI) for the iterate st */
export function transportCoefficients(ctx: ProfileContext, model: TransportModel, st: ProfileState): void {
  const w = ctx.w, g = ctx.tg, N = ctx.N, ps = ctx.ps;
  model.diffusivities(ctx, st, w.chiTurbE, w.chiTurbI);
  const islands = islandRegions(ctx, st.s);
  for (let f = 0; f <= N; f++) {
    const rho = g.rhoF[f];
    let chiT = w.chiTurbE[f], chiTi = w.chiTurbI[f];
    if (ctx.hmode) {
      const sup = barrierFactor(ctx, rho);
      chiT *= sup; chiTi *= sup;
    }
    let chiE = chiT, chiI = chiTi;
    for (const [rs, dr] of islands) if (Math.abs(rho - rs) < 0.5 * dr) { chiE += 5; chiI += 5; }
    // neoclassical ion floor
    const i0 = Math.max(0, Math.min(N - 1, f - 1)), i1 = Math.min(N - 1, f);
    chiI += 0.5 * (w.chiNeo[i0] + w.chiNeo[i1]);
    w.chiE[f] = chiE + 0.01;
    w.chiI[f] = chiI + 0.01;
    w.D[f] = ps.DoverChi * chiT + 0.02;
    w.v[f] = f === 0 ? 0 : -w.D[f] * 2 * ctx.Pn * rho * (g.g1F[f] / Math.max(g.gradRhoF[f], 1e-9));
  }
}
