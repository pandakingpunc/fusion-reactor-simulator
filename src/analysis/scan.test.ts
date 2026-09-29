import { describe, expect, it } from 'vitest';
import { JET, NIF } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { METRIC_KEYS, MetricKey, RunMetrics } from './metrics';
import { SimOutcome } from './ensemble';
import { ScanSpec, planScan, scanHash, spacing, summarizeScan } from './scan';
import { serialRunner } from './run';

const spec = (over: Partial<ScanSpec> = {}): ScanSpec => ({
  preset: 'JET', base: JET, axes: [{ path: 'H98', lo: 0.8, hi: 1.2, points: 3 }, { path: 'n_target', lo: 4e19, hi: 1e20, points: 2 }],
  mode: 'grid', seed: 1, maxRuns: 1000, tEnd: 1, ...over,
});

const okOutcome = (over: Partial<Record<MetricKey, number>> = {}, endReason = 'Scheduled end'): SimOutcome => {
  const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, 1])) as Record<MetricKey, number>;
  Object.assign(values, { disrupted: 0, completed: 1 }, over);
  return { ok: true, metrics: { values, endReason } as RunMetrics };
};

describe('spacing', () => {
  it('linear and logarithmic points with exact end points', () => {
    expect(spacing(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(spacing(2, 2, 1)).toEqual([2]);
    const g = spacing(1, 1000, 4, true);
    expect(g[0]).toBe(1);
    expect(g[1]).toBeCloseTo(10, 12);
    expect(g[2]).toBeCloseTo(100, 10);
    expect(g[3]).toBe(1000);
    expect(spacing(3, 4, 2)).toEqual([3, 4]);
  });
});

describe('scan plan', () => {
  it('a grid has one run per combination, the last axis varying fastest', () => {
    const p = planScan(spec());
    expect(p.runs).toBe(6);
    expect(p.names).toEqual(['H98', 'n_target']);
    expect(p.axisValues).toEqual([[0.8, 1, 1.2], [4e19, 1e20]]);
    const rows = Array.from({ length: 6 }, (_, r) => [p.values[r * 2], p.values[r * 2 + 1]]);
    expect(rows).toEqual([[0.8, 4e19], [0.8, 1e20], [1, 4e19], [1, 1e20], [1.2, 4e19], [1.2, 1e20]]);
    const c = p.config(3) as MagneticConfig;
    expect(c.H98).toBe(1);
    expect(c.n_target).toBe(1e20);
    expect(c.t_end).toBe(1);
    expect(c.seed).toBe(JET.seed);
    expect((planScan(spec({ runSeed: 9 })).config(0) as MagneticConfig).seed).toBe(9);
    expect(p.tasks().map((t) => t.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
    expect(p.block(0)).toBe('grid');
    expect(() => p.config(6)).toThrow(/outside the scan/);
  });

  it('a logarithmic axis and the default of 5 points', () => {
    const p = planScan(spec({ axes: [{ path: 'n_target', lo: 1e19, hi: 1e21, log: true }] }));
    expect(p.runs).toBe(5);
    expect(Array.from(p.values)[1]).toBeCloseTo(1e19 * 10 ** 0.5, -4);
    expect(p.values[4]).toBe(1e21);
  });

  it('a sampled scan fills the box: uniform along linear axes, log-uniform along logarithmic ones, reproducibly', () => {
    const s = spec({ mode: 'sobol', points: 16, axes: [{ path: 'H98', lo: 0.8, hi: 1.2 }, { path: 'impurity.concentration', lo: 0.001, hi: 0.1, log: true }] });
    const p = planScan(s), q = planScan(s);
    expect(Array.from(p.values)).toEqual(Array.from(q.values));
    expect(p.runs).toBe(16);
    for (let r = 0; r < 16; r++) {
      expect(p.values[r * 2]).toBeGreaterThanOrEqual(0.8);
      expect(p.values[r * 2]).toBeLessThanOrEqual(1.2);
      expect(p.values[r * 2 + 1]).toBeGreaterThanOrEqual(0.001);
      expect(p.values[r * 2 + 1]).toBeLessThanOrEqual(0.1);
    }
    expect(p.axisValues).toBeNull();
    expect(p.block(0)).toBe('sobol');
    expect(Array.from(planScan({ ...s, seed: 2 }).values)).not.toEqual(Array.from(p.values));
    // the log axis is uniform in ln x: the median of the sample is near the geometric centre
    const logs = Array.from({ length: 16 }, (_, r) => Math.log(p.values[r * 2 + 1])).sort((a, b) => a - b);
    expect((logs[7] + logs[8]) / 2).toBeCloseTo(Math.log(0.01), 0);
  });

  it('rejects invalid scans', () => {
    expect(() => planScan(spec({ axes: [] }))).toThrow(/at least one parameter/);
    expect(() => planScan(spec({ axes: [{ path: 'H98', lo: 1, hi: 2 }, { path: 'H98', lo: 1, hi: 2 }] }))).toThrow(/listed twice/);
    expect(() => planScan(spec({ axes: [{ path: 'nope', lo: 1, hi: 2 }] }))).toThrow(/'nope' is not a number of the tokamak configuration/);
    expect(() => planScan(spec({ axes: [{ path: 'H98', lo: NaN, hi: 2 }] }))).toThrow(/finite/);
    expect(() => planScan(spec({ axes: [{ path: 'H98', lo: 2, hi: 1 }] }))).toThrow(/below lo/);
    expect(() => planScan(spec({ axes: [{ path: 'H98', lo: 0, hi: 1, log: true }] }))).toThrow(/needs lo > 0/);
    expect(() => planScan(spec({ axes: [{ path: 'H98', lo: 1, hi: 2, points: 0 }] }))).toThrow(/positive integer/);
    expect(() => planScan(spec({ mode: 'halton' as never }))).toThrow(/unknown scan mode/);
    expect(() => planScan(spec({ mode: 'sobol' }))).toThrow(/positive integer number of points/);
    expect(() => planScan(spec({ tEnd: 0 }))).toThrow(/tEnd must be a positive number/);
    expect(() => planScan(spec({ maxRuns: 5 }))).toThrow(/the grid has 6 points, more than the limit of 5/);
    expect(() => planScan(spec({ mode: 'lhs', points: 50, maxRuns: 10 }))).toThrow(/more than the limit of 10/);
  });

  it('the input hash reflects every input and ignores the seed of a grid', () => {
    const h = scanHash(spec());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(scanHash(spec({ seed: 99 }))).toBe(h); // a grid has no random design
    expect(scanHash(spec({ tEnd: 2 }))).not.toBe(h);
    expect(scanHash(spec({ runSeed: 3 }))).not.toBe(h);
    expect(scanHash(spec({ axes: [{ path: 'H98', lo: 0.8, hi: 1.2, points: 4 }] }))).not.toBe(h);
    expect(scanHash(spec({ mode: 'sobol', points: 8, seed: 1 }))).not.toBe(scanHash(spec({ mode: 'sobol', points: 8, seed: 2 })));
  });
});

describe('scan result', () => {
  it('summarises the grid: axes with their values, per-point metrics, failures and end reasons', () => {
    const p = planScan(spec());
    const outcomes: SimOutcome[] = [okOutcome({ Q_flat: 2 }), okOutcome(), { ok: false, error: 'boom\nstack' }, okOutcome({ disrupted: 1, completed: 0 }, 'Density-limit disruption'), okOutcome(), okOutcome()];
    const r = summarizeScan(p, outcomes);
    expect(r).toMatchObject({ schema: 1, tool: 'scan', system: { preset: 'JET', method: 'tokamak', fidelity: '0D', t_end_s: 1, runSeed: 'preset' } });
    expect(r.caveat).toMatch(/^EDUCATIONAL/);
    expect(r.design).toEqual({ mode: 'grid', points: 6, seed: null, notes: [] });
    expect(r.axes[0]).toEqual({ path: 'H98', lo: 0.8, hi: 1.2, log: false, nominal: 0.85, points: 3, values: [0.8, 1, 1.2] });
    expect(r.runs).toEqual({ total: 6, valid: 5, failed: 1, completed: 4, disrupted: 1 });
    expect(r.points[0]).toMatchObject({ index: 0, values: { H98: 0.8, n_target: 4e19 }, endReason: 'Scheduled end' });
    expect(r.points[0].metrics!.Q_flat).toBe(2);
    expect(r.points[2]).toEqual({ index: 2, values: { H98: 1, n_target: 4e19 }, metrics: null, endReason: 'FAILED', error: 'boom' });
    expect(r.points[3].metrics!.disrupted).toBe(1);
    expect(r.inputHash).toBe(scanHash(p.spec));
    expect(() => summarizeScan(p, outcomes.slice(1))).toThrow(/expected 6 outcomes, got 5/);
  });

  it('a sampled scan reports its seed, and a note for a Sobol design that is not a power of two', () => {
    const p = planScan(spec({ mode: 'sobol', points: 6, axes: [{ path: 'H98', lo: 0.8, hi: 1.2 }] }));
    const r = summarizeScan(p, Array.from({ length: 6 }, () => okOutcome()));
    expect(r.design.seed).toBe(1);
    expect(r.design.notes[0]).toMatch(/not a power of two/);
    expect(r.axes[0].points).toBeUndefined();
  });

  it('runs end to end in-process on a tiny real grid', async () => {
    const p = planScan(spec({ axes: [{ path: 'H98', lo: 0.7, hi: 1.1, points: 2 }] }));
    const outcomes = await serialRunner(p.tasks());
    const r = summarizeScan(p, outcomes);
    expect(r.runs).toMatchObject({ total: 2, valid: 2, failed: 0 });
    // more confinement, more fusion power (the JET shot is in H-mode at both values)
    expect(r.points[1].metrics!.Pfus_flat_MW).toBeGreaterThan(r.points[0].metrics!.Pfus_flat_MW);
  });

  it('non-magnetic configurations scan too', () => {
    const p = planScan({ base: NIF, axes: [{ path: 'E_laser_MJ', lo: 1.8, hi: 2.2, points: 2 }], mode: 'grid', seed: 1, maxRuns: 10 });
    const r = summarizeScan(p, [okOutcome(), okOutcome()]);
    expect(r.system.method).toBe('icf_indirect');
    expect(Number.isNaN(r.system.t_end_s)).toBe(true);
    expect(r.system.preset).toBeUndefined();
  });
});
