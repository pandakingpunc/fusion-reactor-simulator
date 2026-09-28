/**
 * Radiation losses of the electrons (radiation.ts for the rate coefficients):
 *
 *  - bremsstrahlung with the main-ion Z_eff (impurity bremsstrahlung is part of their cooling rate);
 *  - line radiation of the intrinsic and the seeded impurity (coronal cooling rates L_Z(T_e));
 *  - synchrotron: global fit of Albajar, Johner & Granata, Nucl. Fusion 41 (2001) 665 with the wall
 *    reflection correction of Fidone, Giruzzi & Granata, Nucl. Fusion 41 (2001) 1755
 *    (synchrotronTotal), with the peaking factors of the old state; distributed ∝ n_e T_e and
 *    evaluated once per step.
 *
 * The sink is linearised implicitly in the heat equation, Q ≈ P(T*) − L (T − T*), with
 * L = ∂P_rad/∂T_e ≥ 0 (w.dPrad; bremsstrahlung ∝ T^{1/2}, line by a 2 % finite difference).
 */
import { bremsstrahlung, coolingRate, synchrotronTotal } from '../../radiation';
import type { ProfileContext, StepConstants } from '../context';
import type { ProfileState } from '../state';
import { seedSpecies } from '../composition';
import { volumeIntegral } from './deposition';
import type { SourceModel } from './SourceModel';

export class RadiationSource implements SourceModel {
  readonly id = 'radiation';

  prepare(ctx: ProfileContext, _t: number, st: ProfileState, K: StepConstants): void {
    const c = ctx.cfg, w = ctx.w, N = ctx.N, g = ctx.tg;
    const { Te, ne } = st;
    const nAvg = ctx.volAvg(ne), TAvg = volumeIntegral(g, Te.map((v, i) => v * ne[i])) / Math.max(volumeIntegral(g, ne), 1);
    const aN = Math.min(Math.max(ne[0] / Math.max(nAvg, 1) - 1, 0.01), 3), aT = Math.min(Math.max(Te[0] / Math.max(TAvg, 1e-3) - 1, 0.1), 4);
    const Psync = synchrotronTotal({ R: g.R0, a: g.a, kappa: ctx.kappaA, B0: g.B0, ne0_1e20: ne[0] / 1e20, Te0_keV: Te[0], alpha_n: aN, alpha_T: aT, wallReflectivity: c.impurity.wallReflectivity });
    let wsum = 0;
    for (let i = 0; i < N; i++) wsum += ne[i] * Te[i] * g.dV[i];
    for (let i = 0; i < N; i++) w.Psync[i] = wsum > 0 ? (Psync * ne[i] * Te[i]) / wsum : 0;
    K.Psync = Psync;
  }

  heat(ctx: ProfileContext, st: ProfileState): void {
    const w = ctx.w, N = ctx.N;
    const { Te, ne } = st;
    const im = ctx.cfg.impurity;
    const seed = seedSpecies(ctx);
    for (let i = 0; i < N; i++) {
      const Tev = Math.max(Te[i], 0.01);
      const pbr = bremsstrahlung(ne[i], Tev, w.ZeffMain[i]);
      let pl = ne[i] * w.nZ[i] * coolingRate(im.species, Tev);
      let dpl = ne[i] * w.nZ[i] * (coolingRate(im.species, Tev * 1.02) - coolingRate(im.species, Tev)) / (0.02 * Tev);
      if (seed) {
        pl += ne[i] * w.ns[i] * coolingRate(seed, Tev);
        dpl += ne[i] * w.ns[i] * (coolingRate(seed, Tev * 1.02) - coolingRate(seed, Tev)) / (0.02 * Tev);
      }
      w.Pbr[i] = pbr; w.Pline[i] = pl;
      w.Prad[i] = pbr + pl + w.Psync[i];
      w.dPrad[i] = Math.max(0, pbr / (2 * Tev) + dpl);
    }
  }
}
