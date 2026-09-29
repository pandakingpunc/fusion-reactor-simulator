/**
 * The edge model in the 1.5D model: the ELM-inclusive P_SOL of the boundary, the edge channels of the diagnostics and the
 * 'twoPoint' boundary condition (JET15 and SPARC15).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runAllYielding } from '../../testing/yielding';
import { flatTopMean } from '../analysis/flatTop';
import { JET_15D, SPARC_15D } from '../presets';
import { Simulation } from '../simulation';
import type { HistoryFrame } from '../types';
import { EDGE_DIAGS } from './index';

const EDGE_KEYS = EDGE_DIAGS.map((d) => d.key);
const timeMean = (h: HistoryFrame[], f: (d: Record<string, number>) => number, t0: number, t1: number) => {
  let s = 0, T = 0;
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1], b = h[i];
    if (b.t <= t0 || a.t >= t1) continue;
    const lo = Math.max(a.t, t0), hi = Math.min(b.t, t1);
    s += 0.5 * (f(a.d) + f(b.d)) * (hi - lo); T += hi - lo;
  }
  return s / T;
};

describe('1.5D: ELM-inclusive P_SOL and the edge boundary', { timeout: 240_000 }, () => {
  let base: Simulation, tp: Simulation;
  const t1 = JET_15D.t_end;
  beforeAll(async () => {
    base = new Simulation(JET_15D); await runAllYielding(base);
    tp = new Simulation({ ...JET_15D, profiles: { ...JET_15D.profiles, edgeModel: 'twoPoint' } }); await runAllYielding(tp);
  }, 200_000);

  it('P_SOL is the ELM-averaged power across the separatrix: it closes the energy balance P_heat − P_rad − ΔW/Δt of the flat top to 3 %, the step-wise dW/dt does not', () => {
    const h = base.history, t0 = 0.55 * t1;
    const Wat = (t: number) => { const i = h.findIndex((f) => f.t >= t); return h[i].d.W; };
    const dWdt = (Wat(t1 - 1e-9) - Wat(t0)) / (h[h.length - 1].t - h[h.findIndex((f) => f.t >= t0)].t); // MJ/s = MW
    const balance = timeMean(h, (d) => d.P_heat - d.P_rad, t0, t1) - dWdt;
    const psol = timeMean(h, (d) => d.P_SOL, t0, t1);
    expect(Math.abs(psol / balance - 1)).toBeLessThan(0.03);
    // the ELM power is what the raw dW/dt misses (it is negative between crashes' worth of W: the mean of raw dW/dt is +P_ELM)
    const raw = timeMean(h, (d) => d.P_heat - d.P_rad - d.dWdt, t0, t1);
    expect(Math.abs(raw / balance - 1)).toBeGreaterThan(0.05);
    expect(raw).toBeLessThan(psol);
    expect(base.events.filter((e) => e.kind === 'ELM').length).toBeGreaterThan(50);
  });

  it("the edge channels are present; 'legacy' (default) leaves T_sep to the conduction-limited formula with its clamp", () => {
    for (const f of base.history) for (const k of EDGE_KEYS) expect(Number.isFinite(f.d[k]), k).toBe(true);
    const Tsep = flatTopMean(base.history, 'Tsep'), Tu = flatTopMean(base.history, 'T_u') / 1000;
    expect(Tsep).toBeGreaterThan(0.03);
    expect(Tsep).toBeLessThan(0.5);
    // the legacy value and the edge model differ by a few percent (outboard share 0.6 vs 2/3, divertor broadening)
    expect(Math.abs(Tu / Tsep - 1)).toBeLessThan(0.15);
  });

  it("'twoPoint': T_sep is the T_u of the edge model, and the run stays within a few percent of the legacy boundary", () => {
    for (const f of tp.history.filter((x) => x.t > 0.5)) expect(Math.abs((f.d.Tsep * 1000) / f.d.T_u - 1)).toBeLessThan(0.02);
    const a = flatTopMean(base.history, 'Tsep'), b = flatTopMean(tp.history, 'Tsep');
    expect(Math.abs(b / a - 1)).toBeLessThan(0.15);
    for (const k of ['Q', 'P_fus', 'W', 'Tped']) expect(Math.abs(flatTopMean(tp.history, k) / flatTopMean(base.history, k) - 1), k).toBeLessThan(0.1);
    expect(tp.events.filter((e) => e.kind === 'ELM').length).toBeGreaterThan(50);
  });

  it("a fixed Tsep_keV wins over both boundary models", async () => {
    const fx = new Simulation({ ...JET_15D, t_end: 1.5, profiles: { ...JET_15D.profiles, edgeModel: 'twoPoint', Tsep_keV: 0.123 } });
    fx.runAll();
    for (const f of fx.history.filter((x) => x.t > 0.1)) expect(f.d.Tsep).toBeCloseTo(0.123, 12);
  });

  it('the high-field compact case: T_u and the loads are finite through the whole shot', async () => {
    const sp = new Simulation({ ...SPARC_15D, t_end: 3 });
    sp.runAll();
    for (const f of sp.history) for (const k of EDGE_KEYS) expect(Number.isFinite(f.d[k]), `${f.t} ${k}`).toBe(true);
    expect(flatTopMean(sp.history, 'lambda_q')).toBeLessThan(0.4);
  });
});

