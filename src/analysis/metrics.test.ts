import { describe, expect, it } from 'vitest';
import { flatTopMean } from '../physics/analysis/flatTop';
import { Simulation } from '../physics/simulation';
import { JET, SPARC } from '../physics/presets';
import type { HistoryFrame, ShotReport, SimEvent } from '../physics/types';
import { METRIC_INFO, METRIC_KEYS, OPERATING_METRICS, PERFORMANCE_METRICS, runMetrics } from './metrics';

/** a history of n frames with linear diagnostics (t = i, Q = i, P_fus = 2 i, nG_frac = i / 10, tauE = 1, betaN = 3 - i / 10) */
function fakeHistory(n: number): HistoryFrame[] {
  return Array.from({ length: n }, (_, i) => ({ t: i, y: [], internal: {}, d: { Q: i, P_fus: 2 * i, nG_frac: i / 10, tauE: 1, betaN: 3 - i / 10 } }));
}
const fakeReport = (natural: boolean, reason: string): ShotReport => ({
  Q_sci_max: 99, E_fusion_MJ: 5, Q_eng: 0.5, termination: { natural, reason, t: 0, diagnosis: '', fix: '' },
} as unknown as ShotReport);
const disruptionAt = (t: number): SimEvent => ({ t, kind: 'disruption', msg: 'x' });

describe('metric definitions', () => {
  it('every metric key has a label; performance and operating metrics are disjoint subsets', () => {
    for (const k of METRIC_KEYS) expect(METRIC_INFO[k].label.length).toBeGreaterThan(3);
    for (const k of [...PERFORMANCE_METRICS, ...OPERATING_METRICS]) expect(METRIC_KEYS).toContain(k);
    expect(PERFORMANCE_METRICS.filter((k) => OPERATING_METRICS.includes(k))).toEqual([]);
  });
});

describe('runMetrics on constructed histories', () => {
  it('a shot that ran to its end: flat-top means, maxima, the report values, completed = 1', () => {
    const h = fakeHistory(10);
    const m = runMetrics(h, [], fakeReport(true, 'Scheduled end'));
    expect(m.endReason).toBe('Scheduled end');
    const v = m.values;
    // the flat top is the last 30 % of the frames (indices 7, 8, 9)
    expect(v.Q_flat).toBe(8);
    expect(v.Pfus_flat_MW).toBe(16);
    expect(v.nG_flat).toBeCloseTo(0.8, 14);
    expect(v.betaN_flat).toBeCloseTo(2.2, 14);
    expect(v.tauE_flat_s).toBe(1);
    expect(v.Q_flat).toBe(flatTopMean(h, 'Q')); // the project's definition
    expect(v.Q_max).toBe(99); // the report's value for a shot that did not disrupt
    expect(v.Pfus_max_MW).toBe(18);
    expect(v.nG_max).toBeCloseTo(0.9, 14);
    expect(v.betaN_max).toBe(3);
    expect(v.E_fusion_MJ).toBe(5);
    expect(v.Q_eng).toBe(0.5);
    expect(v.disrupted).toBe(0);
    expect(v.completed).toBe(1);
  });

  it('a disrupted shot: metrics over the frames up to the onset only, completed = 0 even if the report says natural', () => {
    const h = fakeHistory(10);
    const m = runMetrics(h, [disruptionAt(5)], fakeReport(false, 'Density-limit disruption'));
    // frames 0 ... 5 (6 frames): the flat top is the last 30 %: from index floor(6 * 0.7) = 4, i.e. frames 4 and 5
    expect(m.values.Q_flat).toBe(4.5);
    expect(m.values.nG_max).toBeCloseTo(0.5, 14);
    expect(m.values.Q_max).toBe(5); // recomputed over the frames up to the onset, not the report's 99
    expect(m.values.Pfus_max_MW).toBe(10);
    expect(m.values.disrupted).toBe(1);
    expect(m.values.completed).toBe(0);
    expect(runMetrics(h, [disruptionAt(5)], fakeReport(true, 'Scheduled end')).values.completed).toBe(0);
    // an onset before the first frame keeps the whole history rather than none
    expect(Number.isFinite(runMetrics(h, [disruptionAt(-1)], fakeReport(false, 'x')).values.Q_flat)).toBe(true);
  });

  it('a shot that ended for another reason is neither completed nor disrupted', () => {
    const m = runMetrics(fakeHistory(10), [], fakeReport(false, 'Numerical failure'));
    expect(m.values.completed).toBe(0);
    expect(m.values.disrupted).toBe(0);
    expect(m.endReason).toBe('Numerical failure');
  });

  it('missing diagnostics and an empty history give NaN, never a crash; a non-finite report value becomes NaN', () => {
    const empty = runMetrics([], [], { ...fakeReport(true, 'Scheduled end'), Q_sci_max: Infinity } as ShotReport);
    for (const k of ['Q_flat', 'Pfus_flat_MW', 'nG_flat', 'nG_max', 'betaN_max', 'tauE_flat_s', 'Q_max'] as const) expect(empty.values[k], k).toBeNaN();
    const noKeys = runMetrics([{ t: 0, y: [], internal: {}, d: {} }, { t: 1, y: [], internal: {}, d: {} }], [], fakeReport(true, 'Scheduled end'));
    expect(noKeys.values.Q_flat).toBeNaN();
    expect(noKeys.values.nG_max).toBeNaN();
  });
});

describe('runMetrics on real shots', () => {
  it('a short JET shot: finite performance metrics that agree with the shot report and the flat-top definition', () => {
    const sim = new Simulation({ ...JET, t_end: 1 });
    const report = sim.runAll();
    const m = runMetrics(sim.history, sim.events, report);
    for (const k of METRIC_KEYS) expect(Number.isFinite(m.values[k]), k).toBe(true);
    expect(m.values.Q_flat).toBe(flatTopMean(sim.history, 'Q'));
    expect(m.values.Q_max).toBe(report.Q_sci_max);
    expect(m.values.E_fusion_MJ).toBe(report.E_fusion_MJ);
    expect(m.values.Q_max).toBeGreaterThanOrEqual(m.values.Q_flat);
    expect(m.values.Pfus_max_MW).toBeGreaterThanOrEqual(m.values.Pfus_flat_MW);
    expect(m.values.completed).toBe(1);
    expect(m.endReason).toBe('Scheduled end');
  });

  it('a density-limit disruption is flagged, and n/n_G at the onset is at the limit, not the post-disruption blow-up', () => {
    // SPARC at four times its density target: the Greenwald limit is crossed while the density ramps up
    const sim = new Simulation({ ...SPARC, n_target: 1.2e21, t_end: 4 });
    const report = sim.runAll();
    expect(sim.events.some((e) => e.kind === 'disruption')).toBe(true);
    const m = runMetrics(sim.history, sim.events, report);
    expect(m.values.disrupted).toBe(1);
    expect(m.values.completed).toBe(0);
    expect(m.endReason).toMatch(/Density-limit disruption/);
    expect(m.values.nG_max).toBeGreaterThan(1);
    expect(m.values.nG_max).toBeLessThan(1.1); // the raw maximum over the whole history is about 7 (I_p collapses)
    const raw = Math.max(...sim.history.map((f) => f.d.nG_frac));
    expect(raw).toBeGreaterThan(3);
  });
});
