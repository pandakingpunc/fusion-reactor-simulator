import { describe, expect, it } from 'vitest';
import { ITER_15D, JET, NIF } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import {
  CAVEAT, EnsemblePlan, EnsembleSpec, SimOutcome, ensembleHash, planEnsemble, quantileLabel, resolveSpec, runEnsemble, summarizeEnsemble, toCsv, toJson,
} from './ensemble';
import { METRIC_KEYS, MetricKey, RunMetrics } from './metrics';
import { PriorSet, defaultPriors } from './priors';
import { serialRunner } from './run';

const PRIORS: PriorSet = {
  params: [
    { path: 'H98', dist: { type: 'uniform', lo: 0.8, hi: 1.2 } },
    { path: 'n_target', dist: { type: 'uniform', lo: 4e19, hi: 1e20 } },
    { path: 'impurity.concentration', dist: { type: 'loguniform', lo: 0.005, hi: 0.05 } },
  ],
};

const spec = (over: Partial<EnsembleSpec> = {}): EnsembleSpec => resolveSpec({ preset: 'JET', base: JET, priors: PRIORS, n: 32, seed: 3, tEnd: 1, ...over });

/** metrics of a synthetic shot */
function synth(over: Partial<Record<MetricKey, number>>, endReason = 'Scheduled end'): RunMetrics {
  const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, 1])) as Record<MetricKey, number>;
  Object.assign(values, { disrupted: 0, completed: 1 }, over);
  return { values, endReason };
}
const ok = (over: Partial<Record<MetricKey, number>>, endReason?: string): SimOutcome => ({ ok: true, metrics: synth(over, endReason) });
const fake = (plan: EnsemblePlan, f: (x: number[], row: number) => SimOutcome): SimOutcome[] =>
  Array.from({ length: plan.runs }, (_, row) => f(Array.from({ length: plan.d }, (_, k) => plan.values[row * plan.d + k]), row));

describe('specification and design', () => {
  it('resolveSpec fills in the defaults', () => {
    const s = resolveSpec({ base: JET, priors: PRIORS });
    expect(s).toMatchObject({ n: 64, sampler: 'sobol', seed: 1, analysis: 'propagate', runSeed: 'fixed', flatTop: 'frame', qTarget: 10, bootstrap: 200, confidence: 0.95, maxRuns: 100000 });
    expect(s.quantileLevels).toEqual([0.05, 0.16, 0.5, 0.84, 0.95]);
    expect(s.probabilities).toEqual([]);
  });

  it('a propagation plan has n runs; a Saltelli plan n (d + 2) runs, in blocks A, B, AB_1 ... AB_d', () => {
    const p = planEnsemble(spec({ n: 16 }));
    expect(p.runs).toBe(16);
    expect(p.d).toBe(3);
    expect(p.values).toHaveLength(48);
    expect(p.block(0)).toBe('MC');
    const s = planEnsemble(spec({ n: 16, analysis: 'sensitivity' }));
    expect(s.runs).toBe(16 * 5);
    expect(s.saltelli).toBe(true);
    expect([s.block(0), s.block(15), s.block(16), s.block(32), s.block(48), s.block(64), s.block(79)]).toEqual(['A', 'A', 'B', 'AB1', 'AB2', 'AB3', 'AB3']);
    // AB_i equals A except in column i, where it equals B
    const v = (row: number, k: number) => s.values[row * 3 + k];
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) expect(v(32 + 16 * i + j, k)).toBe(k === i ? v(16 + j, k) : v(j, k));
    }
  });

  it('parameter values follow the priors; the configurations carry them and leave the base untouched', () => {
    const before = JSON.stringify(JET);
    const p = planEnsemble(spec({ n: 16, tEnd: 2 }));
    for (let r = 0; r < p.runs; r++) {
      const c = p.config(r) as MagneticConfig;
      expect(c.H98).toBe(p.values[r * 3]);
      expect(c.n_target).toBe(p.values[r * 3 + 1]);
      expect(c.impurity.concentration).toBe(p.values[r * 3 + 2]);
      expect(c.H98).toBeGreaterThanOrEqual(0.8);
      expect(c.H98).toBeLessThanOrEqual(1.2);
      expect(c.impurity.concentration).toBeGreaterThanOrEqual(0.005);
      expect(c.t_end).toBe(2);
      expect(c.seed).toBe(JET.seed); // 'fixed'
      expect(c.geometry).toBe(JET.geometry);
    }
    expect(JSON.stringify(JET)).toBe(before);
    const tasks = p.tasks();
    expect(tasks).toHaveLength(16);
    expect(tasks[3].id).toBe('r3');
    expect(tasks.every((t) => t.weighting === 'frame')).toBe(true);
    expect(planEnsemble(spec({ n: 4, flatTop: 'time' })).tasks()[0].weighting).toBe('time');
    expect(tasks[3].cfg).toEqual(p.config(3));
    expect(() => p.config(16)).toThrow(/outside the design/);
    expect(() => p.config(-1)).toThrow(/outside the design/);
  });

  it('a 1.5D profile setting is perturbed without losing the preset\'s other profile settings', () => {
    const priors: PriorSet = { params: [{ path: 'profiles.pedestalWidth', dist: { type: 'uniform', lo: 0.03, hi: 0.09 } }] };
    const p = planEnsemble(resolveSpec({ base: ITER_15D, priors, n: 8, tEnd: 1 }));
    const c = p.config(3) as MagneticConfig;
    expect(c.profiles).toEqual({ lcfsKappa: 1.85, lcfsDelta: 0.49, pedestalWidth: p.values[3] });
    expect(c.profiles!.pedestalWidth).toBeGreaterThanOrEqual(0.03);
    expect(ITER_15D.profiles).toEqual({ lcfsKappa: 1.85, lcfsDelta: 0.49 });
    expect(() => planEnsemble(resolveSpec({ base: JET, priors, n: 8 }))).toThrow(/not a number of the tokamak configuration/);
  });

  it('the design is reproducible per seed and differs for another seed and another sampler', () => {
    const a = planEnsemble(spec({ n: 16 })), b = planEnsemble(spec({ n: 16 })), c = planEnsemble(spec({ n: 16, seed: 4 })), m = planEnsemble(spec({ n: 16, sampler: 'mc' }));
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
    expect(Array.from(a.values)).not.toEqual(Array.from(c.values));
    expect(Array.from(a.values)).not.toEqual(Array.from(m.values));
  });

  it('run seeds: fixed keeps the preset seed; perRow derives one per design row, shared by the rows A, B, AB of a Saltelli design', () => {
    const p = planEnsemble(spec({ n: 8, runSeed: 'perRow' }));
    const seeds = Array.from({ length: 8 }, (_, r) => (p.config(r) as MagneticConfig).seed);
    expect(new Set(seeds).size).toBe(8);
    expect(seeds).toEqual(Array.from({ length: 8 }, (_, r) => (planEnsemble(spec({ n: 8, runSeed: 'perRow' })).config(r) as MagneticConfig).seed));
    expect(seeds).not.toEqual(Array.from({ length: 8 }, (_, r) => (planEnsemble(spec({ n: 8, runSeed: 'perRow', seed: 9 })).config(r) as MagneticConfig).seed));
    const s = planEnsemble(spec({ n: 8, runSeed: 'perRow', analysis: 'sensitivity' }));
    for (let j = 0; j < 8; j++) {
      const seed = (s.config(j) as MagneticConfig).seed;
      for (let b = 1; b < 5; b++) expect((s.config(b * 8 + j) as MagneticConfig).seed).toBe(seed);
    }
  });

  it('rejects invalid designs with a clear message', () => {
    expect(() => planEnsemble(spec({ n: 0 }))).toThrow(/positive integer/);
    expect(() => planEnsemble(spec({ n: 2.5 }))).toThrow(/positive integer/);
    expect(() => planEnsemble(spec({ sampler: 'halton' as never }))).toThrow(/unknown sampler/);
    expect(() => planEnsemble(spec({ analysis: 'nope' as never }))).toThrow(/unknown analysis/);
    expect(() => planEnsemble(spec({ priors: { params: [] } }))).toThrow(/at least one uncertain parameter/);
    expect(() => planEnsemble(spec({ priors: { params: [{ path: 'nope', dist: { type: 'point', value: 1 } }] } }))).toThrow(/not a number/);
    expect(() => planEnsemble(spec({ tEnd: -1 }))).toThrow(/tEnd must be a positive number/);
    expect(() => planEnsemble(spec({ n: 1000, analysis: 'sensitivity', maxRuns: 500 }))).toThrow(/needs 5000 runs, more than the limit of 500/);
    expect(() => planEnsemble(spec({ analysis: 'sensitivity', priors: { ...PRIORS, correlations: [{ paths: ['H98', 'n_target'], matrix: [[1, 0.5], [0.5, 1]] }] } }))).toThrow(/independent parameters/);
    expect(planEnsemble(spec({ n: 24 })).notes[0]).toMatch(/not a power of two/);
    expect(planEnsemble(spec({ n: 24, sampler: 'lhs' })).notes).toEqual([]);
  });

  it('the input hash is stable and reflects every input', () => {
    const h = ensembleHash(spec());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(ensembleHash(spec())).toBe(h);
    for (const over of [{ seed: 4 }, { n: 64 }, { sampler: 'lhs' as const }, { tEnd: 2 }, { qTarget: 5 }, { runSeed: 'perRow' as const }, { analysis: 'sensitivity' as const }, { flatTop: 'time' as const }]) {
      expect(ensembleHash(spec(over)), JSON.stringify(over)).not.toBe(h);
    }
  });

  it('quantile labels', () => {
    expect([0.05, 0.16, 0.5, 0.84, 0.95, 0.975, 0.001].map(quantileLabel)).toEqual(['p05', 'p16', 'p50', 'p84', 'p95', 'p97.5', 'p0.1']);
  });
});

describe('summary of the outcomes', () => {
  const plan = planEnsemble(spec({ n: 40, sampler: 'lhs', bootstrap: 50, probabilities: [{ metric: 'Pfus_flat_MW', op: '>=', value: 15 }, { metric: 'betaN_max', op: '>', value: 2 }] }));

  // shot i: Q_flat = 20 H98 (so Q >= 10 needs H98 >= 0.5: always), disrupted when n_target > 9.4e19, failed every 10th run
  const outcomes = fake(plan, ([h, n], row) => {
    if (row % 10 === 7) return { ok: false, error: `Error: boom ${row}\n    at stack line` };
    if (n > 9.4e19) return ok({ disrupted: 1, completed: 0, Q_flat: 20 * h, nG_flat: 1.1, nG_max: 1.2, betaN_max: 2.5 }, 'Density-limit disruption (Greenwald)');
    if (row % 10 === 3) return ok({ completed: 0 }, 'Numerical failure');
    return ok({ Q_flat: 20 * h, Q_max: 25 * h, Pfus_flat_MW: 10 * h + 5 * (n / 1e20), nG_flat: n / 1e20, nG_max: n / 1e20 + 0.05, betaN_max: 1.5 });
  });
  const res = summarizeEnsemble(plan, outcomes);
  const prob = (id: string) => res.probabilities.find((p) => p.id === id)!;

  it('counts valid, failed, completed, disrupted and other shots and lists the end reasons', () => {
    const nFailed = outcomes.filter((o) => !o.ok).length;
    const nDisr = outcomes.filter((o) => o.ok && o.metrics.values.disrupted === 1).length;
    const nOther = outcomes.filter((o) => o.ok && o.metrics.endReason === 'Numerical failure').length;
    expect(nFailed).toBe(4);
    expect(res.runs).toMatchObject({ total: 40, failed: nFailed, valid: 40 - nFailed, disrupted: nDisr, other: nOther, completed: 40 - nFailed - nDisr - nOther });
    expect(res.runs.endReasons).toEqual({ 'Density-limit disruption (Greenwald)': nDisr, 'Numerical failure': nOther, 'Scheduled end': 40 - nFailed - nDisr - nOther });
    expect(res.runs.failures).toHaveLength(4);
    expect(res.runs.failures[0]).toEqual({ run: 7, error: 'Error: boom 7' }); // first line only: no stack in the report
    expect(nDisr).toBeGreaterThan(0);
  });

  it('probabilities: counts, the definition of each event, Wilson intervals', () => {
    const valid = res.runs.valid;
    const qs = outcomes.flatMap((o) => (o.ok ? [o.metrics] : []));
    const kQ = qs.filter((m) => m.values.completed === 1 && m.values.Q_flat >= 10).length;
    expect(prob('Q>=10')).toMatchObject({ k: kQ, n: valid });
    expect(prob('Q>=10').p).toBeCloseTo(kQ / valid, 14);
    expect(prob('disruption')).toMatchObject({ k: res.runs.disrupted, n: valid });
    expect(prob('n/nG>1 (flat top)').k).toBe(res.runs.disrupted); // only the disrupted shots have nG_flat > 1
    expect(prob('n/nG>1 (any time)').k).toBe(qs.filter((m) => m.values.nG_max > 1).length);
    expect(prob('betaN_max>2').k).toBe(res.runs.disrupted); // an operating metric: over all valid shots
    // a performance metric: completed shots only
    expect(prob('Pfus_flat_MW>=15').k).toBe(qs.filter((m) => m.values.completed === 1 && m.values.Pfus_flat_MW >= 15).length);
    for (const p of res.probabilities) {
      expect(p.ci[0]).toBeLessThanOrEqual(p.p);
      expect(p.ci[1]).toBeGreaterThanOrEqual(p.p);
      expect(p.definition.length).toBeGreaterThan(10);
    }
    expect(prob('Q>=10').definition).toMatch(/runs to its scheduled end without a disruption and its flat-top Q >= 10/);
  });

  it('a different Q target changes the id and the count', () => {
    const r2 = summarizeEnsemble(planEnsemble(spec({ n: 40, sampler: 'lhs', qTarget: 18, bootstrap: 0 })), outcomes);
    const p = r2.probabilities.find((x) => x.id === 'Q>=18')!;
    expect(p.k).toBeGreaterThan(0);
    expect(p.k).toBeLessThan(prob('Q>=10').k);
  });

  it('outputs are over the completed shots, operating metrics over all valid shots; quantiles are ordered with intervals', () => {
    const q = res.outputs.Q_flat;
    expect(q.n).toBe(res.runs.completed);
    expect(Object.keys(q.quantiles)).toEqual(['p05', 'p16', 'p50', 'p84', 'p95']);
    const v = Object.values(q.quantiles);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    expect(q.min).toBeLessThanOrEqual(q.quantiles.p05);
    expect(q.max).toBeGreaterThanOrEqual(q.quantiles.p95);
    expect(q.min).toBeGreaterThanOrEqual(16); // 20 * H98 with H98 >= 0.8
    expect(q.max).toBeLessThanOrEqual(24);
    for (const k of Object.keys(q.quantiles)) {
      expect(q.quantileCI![k][0]).toBeLessThanOrEqual(q.quantileCI![k][1]);
      expect(q.quantileCI![k][0]).toBeLessThanOrEqual(q.quantiles[k] + 1e-9);
    }
    expect(res.operating.nG_max.n).toBe(res.runs.valid);
    expect(res.operating.nG_max.max).toBeCloseTo(1.2, 12);
    expect(res.outputs.Pfus_flat_MW.n).toBe(res.runs.completed);
  });

  it('rank correlations reflect the built-in dependence: Q rises with H98, the disruption flag with the density', () => {
    expect(res.rankCorrelation.Q_flat.H98).toBeCloseTo(1, 12); // Q = 20 H98 exactly
    expect(Math.abs(res.rankCorrelation.Q_flat.n_target)).toBeLessThan(0.5);
    expect(res.rankCorrelation.disrupted.n_target).toBeGreaterThan(0.5);
    expect(res.rankCorrelation.nG_max.n_target).toBeGreaterThan(0.5);
  });

  it('reports the system, design, parameters, caveat and input hash', () => {
    expect(res.schema).toBe(1);
    expect(res.tool).toBe('uq');
    expect(res.caveat).toBe(CAVEAT);
    expect(res.caveat).toMatch(/^EDUCATIONAL/);
    expect(res.inputHash).toBe(ensembleHash(plan.spec));
    expect(res.system).toEqual({ preset: 'JET', method: 'tokamak', fidelity: '0D', t_end_s: 1, runSeed: 'fixed', flatTop: 'frame' });
    expect(res.design).toMatchObject({ analysis: 'propagate', sampler: 'lhs', seed: 3, n: 40, runs: 40, confidence: 0.95, bootstrap: 50 });
    expect(res.parameters.map((p) => p.path)).toEqual(['H98', 'n_target', 'impurity.concentration']);
    expect(res.parameters[0].nominal).toBe(JET.H98);
    expect(res.sensitivity).toBeUndefined();
  });

  it('a mismatching number of outcomes is rejected; an all-failed ensemble summarises without NaN crashes', () => {
    expect(() => summarizeEnsemble(plan, outcomes.slice(1))).toThrow(/expected 40 outcomes, got 39/);
    const dead = summarizeEnsemble(plan, outcomes.map(() => ({ ok: false as const, error: 'x' })));
    expect(dead.runs).toMatchObject({ valid: 0, failed: 40, completed: 0 });
    expect(dead.probabilities.every((p) => Number.isNaN(p.p))).toBe(true);
    expect(dead.outputs).toEqual({});
    expect(dead.rankCorrelation).toEqual({});
  });
});

describe('sensitivity analysis of the outcomes', () => {
  it('recovers the analytic Sobol indices of a built-in additive model through the whole plumbing', () => {
    // Q_flat = 20 H98 + 10 n/1e20: with H98 ~ U(0.8, 1.2) (variance 0.0133) and n ~ U(4e19, 1e20) (variance 0.03) the
    // partial variances are 400 * 0.0133 = 5.33 and 100 * 0.03 = 3, so S = (0.640, 0.360, 0)
    const plan = planEnsemble(spec({ n: 1024, analysis: 'sensitivity', bootstrap: 60 }));
    const outcomes = fake(plan, ([h, n]) => ok({ Q_flat: 20 * h + 10 * (n / 1e20), completed: 1 }));
    const res = summarizeEnsemble(plan, outcomes);
    const t = res.sensitivity!.targets.find((x) => x.metric === 'Q_flat')!;
    expect(res.sensitivity!.runs).toBe(1024 * 5);
    expect(res.sensitivity!.failedRuns).toBe(0);
    expect(t.nUsed).toBe(1024);
    const by = Object.fromEntries(t.indices.map((i) => [i.path, i]));
    const v1 = 400 * (0.4 ** 2 / 12), v2 = 100 * (6e19 ** 2 / 12) / 1e40;
    expect(by.H98.S1).toBeCloseTo(v1 / (v1 + v2), 2);
    expect(by.n_target.S1).toBeCloseTo(v2 / (v1 + v2), 2);
    expect(Math.abs(by['impurity.concentration'].S1)).toBeLessThan(0.01);
    expect(by.H98.ST).toBeCloseTo(by.H98.S1, 1);
    expect(by.H98.S1_ci![0]).toBeLessThanOrEqual(by.H98.S1);
    expect(by.H98.S1_ci![1]).toBeGreaterThanOrEqual(by.H98.S1);
    expect(res.sensitivity!.estimator).toEqual({ first: 'saltelli2010', total: 'jansen' });
    // the propagation summary uses the A and B blocks only
    expect(res.runs.total).toBe(2048);
    expect(res.runs.valid).toBe(2048);
    expect(res.design.runs).toBe(5120);
    const names = res.sensitivity!.targets.map((x) => x.metric);
    expect(names).toEqual(['Q_flat', 'Q_delivered', 'Pfus_flat_MW', 'nG_max', 'betaN_max', 'disrupted']);
  });

  it('failed runs drop their rows from the indices; Q_delivered is zero for a shot that ended early', () => {
    const plan = planEnsemble(spec({ n: 64, analysis: 'sensitivity', bootstrap: 0 }));
    const outcomes = fake(plan, ([h, n], row) => {
      if (row === 100) return { ok: false, error: 'boom' };
      return n > 9e19 ? ok({ Q_flat: 5, completed: 0, disrupted: 1 }) : ok({ Q_flat: 10 * h, completed: 1 });
    });
    const res = summarizeEnsemble(plan, outcomes);
    expect(res.sensitivity!.failedRuns).toBe(1);
    expect(res.sensitivity!.targets[0].nUsed).toBe(63);
    // the disruption indicator depends on the density only
    const d = res.sensitivity!.targets.find((t) => t.metric === 'disrupted')!;
    expect(d.indices.find((i) => i.path === 'n_target')!.S1).toBeGreaterThan(0.9);
    expect(d.indices.find((i) => i.path === 'H98')!.ST).toBeLessThan(0.1);
    expect(d.indices[0].S1_ci).toBeUndefined(); // bootstrap 0: no intervals
  });
});

describe('reports', () => {
  const plan = planEnsemble(spec({ n: 8, sampler: 'mc', bootstrap: 0 }));
  const outcomes = fake(plan, ([h], row) => (row === 2 ? { ok: false, error: 'bad, "quoted"\nsecond line' } : ok({ Q_flat: h }, row === 3 ? 'End, with comma' : 'Scheduled end')));

  it('toJson: fixed layout, non-finite numbers as null, identical bytes for the same result', () => {
    const r = summarizeEnsemble(plan, outcomes);
    const a = toJson(r), b = toJson(summarizeEnsemble(plan, outcomes));
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
    expect(a).toContain('\n  "schema": 1,');
    expect(toJson({ x: NaN, y: Infinity, z: -Infinity, w: 1 })).toBe('{\n  "x": null,\n  "y": null,\n  "z": null,\n  "w": 1\n}\n');
    expect(() => JSON.parse(a)).not.toThrow();
  });

  it('toCsv: a header, one row per run, empty cells for missing values and RFC 4180 quoting', () => {
    const lines = toCsv(plan, outcomes).trimEnd().split('\n');
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe(['run', 'block', 'H98', 'n_target', 'impurity.concentration', ...METRIC_KEYS, 'end_reason'].join(','));
    const row0 = lines[1].split(',');
    expect(row0[0]).toBe('0');
    expect(row0[1]).toBe('MC');
    expect(Number(row0[2])).toBe(plan.values[0]);
    expect(row0[row0.length - 1]).toBe('Scheduled end');
    expect(lines[3]).toMatch(/^2,MC,.*,"FAILED: bad, ""quoted"""$/); // first line of the error only
    expect(lines[3].split(',').slice(5, 5 + METRIC_KEYS.length).every((c) => c === '')).toBe(true);
    expect(lines[4].endsWith('"End, with comma"')).toBe(true);
    // NaN metrics are empty cells
    const nan = fake(plan, () => ok({ Q_flat: NaN }));
    expect(toCsv(plan, nan).split('\n')[1].split(',')[2 + 3]).toBe('');
  });
});

describe('a real ensemble (short JET shots)', () => {
  it('runs end to end in-process: reproducible JSON, physically ordered outputs, honest bookkeeping', async () => {
    const s = spec({ n: 8, sampler: 'sobol', bootstrap: 20, priors: defaultPriors(JET) });
    const progress: number[] = [];
    const a = await runEnsemble(s, serialRunner, (p) => progress.push(p.done));
    const b = await runEnsemble(s, serialRunner);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toJson(a.result)).toBe(toJson(b.result));
    expect(a.outcomes.every((o) => o.ok)).toBe(true);
    const r = a.result;
    expect(r.runs).toMatchObject({ total: 8, valid: 8, failed: 0 });
    expect(r.runs.completed + r.runs.disrupted + r.runs.other).toBe(8);
    expect(r.outputs.Q_flat.n).toBe(r.runs.completed);
    expect(r.outputs.Q_flat.quantiles.p50).toBeGreaterThan(0);
    expect(r.outputs.Pfus_flat_MW.quantiles.p50).toBeGreaterThan(1);
    expect(r.outputs.Q_flat.quantiles.p05).toBeLessThanOrEqual(r.outputs.Q_flat.quantiles.p95);
    expect(toCsv(a.plan, a.outcomes).trimEnd().split('\n')).toHaveLength(9);
  });

  it('a configuration the model cannot run is reported as a failed shot, the ensemble carries on', async () => {
    const s = spec({ n: 4, priors: { params: [{ path: 'geometry.a', dist: { type: 'uniform', lo: -2, hi: -1 } }] }, bootstrap: 0 });
    const { result } = await runEnsemble(s, serialRunner);
    expect(result.runs.failed).toBe(4);
    expect(result.runs.valid).toBe(0);
    expect(result.runs.failures[0].error.length).toBeGreaterThan(5);
  });

  it('non-magnetic configurations run with explicit parameters (metrics that do not exist are NaN)', async () => {
    const s = resolveSpec({ base: NIF, priors: { params: [{ path: 'E_laser_MJ', dist: { type: 'uniform', lo: 1.8, hi: 2.2 } }] }, n: 4, bootstrap: 0 });
    const { result, outcomes } = await runEnsemble(s, serialRunner);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(result.system.method).toBe('icf_indirect');
    expect(result.outputs.E_fusion_MJ.n).toBeGreaterThan(0);
  });
});
