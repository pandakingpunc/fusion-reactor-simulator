/**
 * Regression test (lane ws2b review): the 0D diagnostic P_cond is the continuous conduction loss that
 * the power balance applies, W/τ_E − ⟨P_ELM⟩ (the ELM-averaged part leaves in discrete crashes). An
 * intermediate version published the whole transport loss W/τ_E as P_cond, so an energy ledger built
 * from the published diagnostics no longer closed (MAST-U: 39 % of ∫P_heat missing). The whole loss is
 * published separately as P_transport; the ignition test and the ELM power use it.
 *
 * The ledger is ΔW_th = ∫(P_heat − P_rad − P_cond) dt over the output intervals that contain no
 * discrete event (ELM, sawtooth, L–H/H–L, NTM switch), as in lane ws2a's invariant tests.
 */
import { describe, expect, it } from 'vitest';
import { DIIID, MASTU } from '../presets';
import { Simulation } from '../simulation';
import { HistoryFrame, MagneticConfig } from '../types';

const DYNAMIC = new Set(['ELM', 'sawtooth', 'LH', 'HL', 'NTM_onset', 'NTM_gone', 'disruption', 'quench']);

function ledger(cfg: MagneticConfig) {
  const sim = new Simulation(cfg);
  sim.runAll();
  const evT = sim.events.filter((e) => DYNAMIC.has(e.kind)).map((e) => e.t);
  const H = sim.history;
  let resid = 0, heat = 0, n = 0;
  for (let i = 1; i < H.length; i++) {
    const a: HistoryFrame = H[i - 1], b: HistoryFrame = H[i];
    if (evT.some((t) => t >= a.t && t <= b.t)) continue;
    const dt = b.t - a.t;
    const rate = (d: Record<string, number>) => d.P_heat - d.P_rad - d.P_cond;
    resid += b.d.W - a.d.W - 0.5 * (rate(a.d) + rate(b.d)) * dt;
    heat += 0.5 * (a.d.P_heat + b.d.P_heat) * dt;
    n++;
  }
  return { sim, resid, heat, n };
}

describe('0D energy ledger with the published P_cond', { timeout: 60_000 }, () => {
  for (const [name, cfg] of [['MAST-U', { ...MASTU, t_end: 2 }], ['DIII-D', { ...DIIID, t_end: 3 }]] as const) {
    it(`${name}: ΔW = ∫(P_heat − P_rad − P_cond) dt between events, and P_transport = P_cond + P_ELM`, () => {
      const { sim, resid, heat, n } = ledger(cfg);
      expect(n).toBeGreaterThan(100);
      expect(sim.events.filter((e) => e.kind === 'ELM').length).toBeGreaterThan(5);
      expect(Math.abs(resid) / heat, `residual ${resid} MJ of ∫P_heat = ${heat} MJ`).toBeLessThan(5e-4);
      for (const f of sim.history) {
        const d = f.d;
        expect(d.P_transport).toBeGreaterThanOrEqual(d.P_cond);
        if (d.P_cond > 0) expect(d.P_cond + d.P_ELM).toBeCloseTo(d.P_transport, 9);
      }
    });
  }
});
