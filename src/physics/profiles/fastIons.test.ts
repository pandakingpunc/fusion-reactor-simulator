/**
 * Fast-ion pressure and the thermal β_N of the 1.5D model, with the definitions of the 0D model
 * (confinement/magnetic.ts): β_T and β_N carry the pressure of the NBI ions and of the fast fusion
 * products, β_N,th (the drive of the NTMs) the thermal pressure only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { JET_15D } from '../presets';
import { criticalEnergy, fastIonEnergyTime } from '../heating';
import type { MagneticConfig } from '../types';
import { MU0 } from './context';
import { powerTotals } from './diagnostics';
import { ProfileModel } from './model';
import { volumeIntegral } from './sources/deposition';
import { rel, stepChecks } from './testkit';

describe('fast-ion pressure and the thermal β_N', () => {
  let flat: Simulation['history'];
  beforeAll(() => {
    const sim = new Simulation({ ...JET_15D, t_end: 5 });
    sim.runAll();
    flat = sim.history.filter((h) => h.t > 3);
  }, 120000);

  it('β_N follows the total pressure, β_N,th the thermal one: β_N = β_N,th (1 + W_f/W), and β_N,th is the thermal stored energy over the volume', () => {
    const n = stepChecks({ ...JET_15D, t_end: 1.5 }, 1.5, (ctx, d) => {
      const g = ctx.tg;
      expect(rel(d.Wf, d.W_alpha + d.W_beam)).toBeLessThan(1e-12);
      expect(rel(d.betaN, d.betaN_th * (1 + d.Wf / d.W))).toBeLessThan(1e-12);
      const betaTh = (2 * MU0 * (d.W * 1e6) / (1.5 * g.volume)) / (g.B0 * g.B0);
      expect(rel(d.betaN_th, (betaTh * 100 * g.a * g.B0) / d.Ip)).toBeLessThan(1e-12);
      expect(d.betaN).toBeGreaterThanOrEqual(d.betaN_th);
    });
    expect(n).toBeGreaterThan(50);
    // the frames of the whole run agree as well, to the accuracy of the equilibrium changes of B0
    for (const h of flat) expect(rel(h.d.betaN, h.d.betaN_th * (1 + h.d.Wf / h.d.W))).toBeLessThan(1e-12);
  });

  it('JET15 (NBI): the fast ions are a substantial part of the pressure, most of it the beam', () => {
    const d = flat[flat.length - 1].d;
    expect(d.P_beam_heat).toBeGreaterThan(0.8 * JET_15D.heating.P_NBI_MW); // absorbed part of the injected NBI power
    expect(d.P_beam_heat).toBeLessThan(JET_15D.heating.P_NBI_MW + 1e-9);
    expect(d.W_beam).toBeGreaterThan(0.1);
    expect(d.W_beam).toBeGreaterThan(5 * d.W_alpha);
    expect(d.Wf / d.W).toBeGreaterThan(0.08);
    expect(d.betaN).toBeGreaterThan(1.08 * d.betaN_th);
  });

  it('W_beam is P τ_W of the slowing-down distribution, cell by cell (Stix: τ_W = τ_se (1 − G)/2, at least 1 ms)', () => {
    const cfg: MagneticConfig = { ...JET_15D, heating: { ...JET_15D.heating, P_NBI_MW: 30, P_ICRH_MW: 0, P_ECRH_MW: 0, E_NBI_keV: 800 } };
    const m = new ProfileModel(cfg);
    const y = m.initialState();
    const st = m.ctx.view(y);
    st.Te.fill(6); st.Ti.fill(6); st.ne.fill(4e19);
    const K = m.physics.evaluateWorkArrays(100, st);
    const w = m.ctx.w, ctx = m.ctx;
    let total = 0;
    for (let i = 0; i < ctx.N; i++) {
      const Ec = criticalEnergy(6, 2.014, w.ionSum[i]);
      const want = K.P_NBI * w.nbiDep[i] * Math.max(fastIonEnergyTime(6, 4e19, 2.014, 1, 800, Ec), 1e-3);
      expect(rel(w.Wbeam[i], want)).toBeLessThan(1e-12);
      total += w.Wbeam[i] * ctx.tg.dV[i];
    }
    expect(total).toBeGreaterThan(1e5);
    expect(rel(powerTotals(ctx, K).W_beam, total)).toBeLessThan(1e-12);
    expect(rel(volumeIntegral(ctx.tg, w.Wbeam), total)).toBeLessThan(1e-12);
  });
});
