import { describe, expect, it } from 'vitest';
import { ITER, JET, SPARC } from '../physics/presets';
import { EnsembleResult, planEnsemble, resolveSpec, summarizeEnsemble } from './ensemble';
import { buildPriors, fmt, formatEnsemble, formatScan, parseAxis, parseLevels, parseParam, parseProbability, presetConfig } from './cliSupport';
import { METRIC_KEYS, MetricKey, RunMetrics } from './metrics';
import { defaultPriors } from './priors';
import { planScan, summarizeScan } from './scan';
import type { SimOutcome } from './ensemble';

describe('flag syntaxes', () => {
  it('presetConfig looks up the validate ids and lists the valid ones on error', () => {
    expect(presetConfig('ITER')).toBe(ITER);
    expect(presetConfig('NIF').method).toBe('icf_indirect');
    expect(() => presetConfig('iter')).toThrow(/unknown preset 'iter'\. Valid ids: ITER, JET, SPARC/);
  });

  it('--param PATH=DIST', () => {
    expect(parseParam('H98=lognormal:1:0.14')).toEqual({ path: 'H98', dist: { type: 'lognormal', median: 1, sigmaLog: 0.14 }, basis: 'given on the command line' });
    expect(parseParam(' impurity.concentration = loguniform:0.005:0.05 ').path).toBe('impurity.concentration');
    expect(parseParam('n_target=normal:1e20:1e19:5e19:-').dist).toEqual({ type: 'normal', mean: 1e20, sd: 1e19, lo: 5e19 });
    expect(() => parseParam('H98')).toThrow(/expected PATH=VALUE/);
    expect(() => parseParam('=uniform:0:1')).toThrow(/expected PATH=VALUE/);
    expect(() => parseParam('H98=')).toThrow(/expected PATH=VALUE/);
    expect(() => parseParam('H98=uniform:2:1')).toThrow(/--param H98=uniform:2:1: .*must exceed lo/);
  });

  it('--param PATH=LO:HI[:N] for scans', () => {
    expect(parseAxis('H98=0.8:1.2:5')).toEqual({ path: 'H98', lo: 0.8, hi: 1.2, points: 5 });
    expect(parseAxis('H98=0.8:1.2')).toEqual({ path: 'H98', lo: 0.8, hi: 1.2 });
    expect(parseAxis('n_target=log:1e19:1e21:3')).toEqual({ path: 'n_target', lo: 1e19, hi: 1e21, points: 3, log: true });
    expect(() => parseAxis('H98=1')).toThrow(/expected PATH=LO:HI/);
    expect(() => parseAxis('H98=1:2:3:4')).toThrow(/expected PATH=LO:HI/);
    expect(() => parseAxis('H98=a:2')).toThrow(/LO and HI must be finite numbers/);
    expect(() => parseAxis('H98=:2')).toThrow(/LO and HI must be finite numbers/);
    expect(() => parseAxis('H98=1:2:0')).toThrow(/N must be a positive integer/);
    expect(() => parseAxis('H98=1:2:2.5')).toThrow(/N must be a positive integer/);
    expect(() => parseAxis('H98=1:2:')).toThrow(/N must be a positive integer/);
  });

  it('--prob METRIC>=VALUE with all four operators', () => {
    expect(parseProbability('Pfus_flat_MW>=400')).toEqual({ metric: 'Pfus_flat_MW', op: '>=', value: 400 });
    expect(parseProbability('nG_max>1')).toEqual({ metric: 'nG_max', op: '>', value: 1 });
    expect(parseProbability('Q_flat<=5')).toEqual({ metric: 'Q_flat', op: '<=', value: 5 });
    expect(parseProbability('betaN_max < 2.5')).toEqual({ metric: 'betaN_max', op: '<', value: 2.5 });
    expect(() => parseProbability('Q>=1')).toThrow(/unknown metric 'Q'\. Valid metrics: Q_flat/);
    expect(() => parseProbability('Q_flat>=')).toThrow(/is not a finite number/);
    expect(() => parseProbability('Q_flat>=x')).toThrow(/is not a finite number/);
    expect(() => parseProbability('Q_flat')).toThrow(/expected METRIC>=VALUE/);
    expect(() => parseProbability('>=3')).toThrow(/expected METRIC>=VALUE/);
  });

  it('--levels', () => {
    expect(parseLevels(['0.05', '0.5', '0.975'])).toEqual([0.05, 0.5, 0.975]);
    expect(() => parseLevels(['0', '0.5'])).toThrow(/not a probability/);
    expect(() => parseLevels(['0.5', 'x'])).toThrow(/not a probability/);
    expect(() => parseLevels(['0.5', '0.5'])).toThrow(/ascending and distinct/);
    expect(() => parseLevels(['0.9', '0.1'])).toThrow(/ascending and distinct/);
  });

  it('buildPriors: defaults, replaced entries, added entries, none', () => {
    const d = defaultPriors(ITER).params;
    const over = parseParam('H98=lognormal:1:0.2');
    const extra = parseParam('geometry.R=normal:6.2:0.1');
    const p = buildPriors(ITER, 'default', [over, extra]);
    expect(p.params).toHaveLength(d.length + 1);
    expect(p.params[0]).toBe(over); // replaced in place
    expect(p.params[p.params.length - 1]).toBe(extra);
    expect(buildPriors(ITER, 'none', [over]).params).toEqual([over]);
    expect(buildPriors(JET, 'default', [], 'itpa20il').params[0].dist).toMatchObject({ sigmaLog: 0.44 / 2.79 });
    expect(() => buildPriors(presetConfig('NIF'), 'default', [])).toThrow(/no default priors/);
  });
});

describe('number formatting', () => {
  it('3 significant figures, exponential outside 1e-3 ... 1e5, n/a for missing values', () => {
    expect(fmt(3.14159)).toBe('3.14');
    expect(fmt(0)).toBe('0');
    expect(fmt(1234.5)).toBe('1230');
    expect(fmt(3e20)).toBe('3.00e+20');
    expect(fmt(1.5e-5)).toBe('1.50e-5');
    expect(fmt(-0.5)).toBe('-0.5');
    expect(fmt(NaN)).toBe('n/a');
    expect(fmt(null)).toBe('n/a');
    expect(fmt(undefined)).toBe('n/a');
    expect(fmt(Infinity)).toBe('n/a');
  });
});

const metrics = (over: Partial<Record<MetricKey, number>> = {}, endReason = 'Scheduled end'): RunMetrics => {
  const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, 1])) as Record<MetricKey, number>;
  Object.assign(values, { disrupted: 0, completed: 1 }, over);
  return { values, endReason };
};

describe('text reports', () => {
  const priors = { params: [{ path: 'H98', dist: { type: 'uniform' as const, lo: 0.8, hi: 1.2 }, basis: 'test' }, { path: 'n_target', dist: { type: 'uniform' as const, lo: 4e19, hi: 1e20 } }] };

  it('formatEnsemble: header, caveat, parameters, runs, probabilities, outputs and the hash', () => {
    const plan = planEnsemble(resolveSpec({ preset: 'JET', base: JET, priors, n: 16, sampler: 'lhs', bootstrap: 0, tEnd: 1 }));
    const outcomes: SimOutcome[] = Array.from({ length: 16 }, (_, r) => (r === 0 ? { ok: false as const, error: 'boom' } : { ok: true as const, metrics: metrics({ Q_flat: r }) }));
    const r = summarizeEnsemble(plan, outcomes);
    const text = formatEnsemble(r);
    expect(text).toMatch(/^UQ of JET \(tokamak, 0D, t_end 1 s\): 16 runs, propagate, sampler lhs, seed 1\n/);
    expect(text).toMatch(/EDUCATIONAL/);
    expect(text).toMatch(/H98 +0\.999?\d* +\[0\.[0-9]+ \.\.\. 1\.\d+\] +uniform|H98 +1 +\[/);
    expect(text).toMatch(/Runs: 15 valid of 16 \(1 failed\): 15 ran to the scheduled end, 0 disrupted, 0 ended otherwise/);
    expect(text).toMatch(/failed run 0: boom/);
    expect(text).toMatch(/Probabilities \(Wilson 95 % interval/);
    expect(text).toMatch(/P\(Q>=10\) +\d+\.\d %/);
    expect(text).toMatch(/Performance \(shots that ran to the scheduled end\):/);
    expect(text).toMatch(/Q_flat +15 /);
    expect(text).toMatch(/input hash [0-9a-f]{64}\n$/);
    expect(text).not.toMatch(/Sobol' indices/);
  });

  it('formatEnsemble of a sensitivity result lists the indices with their intervals', () => {
    const plan = planEnsemble(resolveSpec({ preset: 'JET', base: JET, priors, n: 16, analysis: 'sensitivity', bootstrap: 20, confidence: 0.9 }));
    const outcomes: SimOutcome[] = Array.from({ length: plan.runs }, (_, r) => ({ ok: true as const, metrics: metrics({ Q_flat: plan.values[r * 2] * 10 }) }));
    const text = formatEnsemble(summarizeEnsemble(plan, outcomes) as EnsembleResult);
    expect(text).toMatch(/Sobol' indices \(64 runs; S = first order, ST = total; bracket = 90 % bootstrap interval\)/);
    expect(text).toMatch(/Q_flat \(flat-top Q; 16 rows\)/);
    expect(text).toMatch(/H98 +S +[0-9.]+ \[/);
    expect(text).toMatch(/Pfus_flat_MW [^\n]*\n +H98 +S +n\/a +ST +n\/a/); // a constant output has no variance to apportion
    expect(text).not.toMatch(/NaN/);
    expect(text).toMatch(/Wilson 90 % interval/);
  });

  it('formatScan: axes, bookkeeping and the table, truncated after maxRows', () => {
    const plan = planScan({ preset: 'JET', base: JET, axes: [{ path: 'H98', lo: 0.8, hi: 1.2, points: 6 }], mode: 'grid', seed: 1, maxRuns: 100, tEnd: 1 });
    const outcomes: SimOutcome[] = Array.from({ length: 6 }, (_, i) => (i === 2 ? { ok: false as const, error: 'x' } : { ok: true as const, metrics: metrics({ Q_flat: i }) }));
    const r = summarizeScan(plan, outcomes);
    const text = formatScan(r, 4);
    expect(text).toMatch(/^Scan of JET \(tokamak, 0D, t_end 1 s\): 6 points, grid\n/);
    expect(text).toMatch(/axis H98: 0\.8 \.\.\. 1\.2, 6 points, preset value 0\.85/);
    expect(text).toMatch(/Runs: 5 valid of 6 \(1 failed\)/);
    expect(text).toMatch(/H98 +Q_flat +Pfus_flat_MW/);
    expect(text).toMatch(/FAILED/);
    expect(text).toMatch(/\.\.\. 2 more points/);
    expect(formatScan(r, 25)).not.toMatch(/more points/);
    const sampled = summarizeScan(planScan({ base: SPARC, axes: [{ path: 'H98', lo: 0.8, hi: 1.2, log: true }], mode: 'lhs', points: 2, seed: 1, maxRuns: 10 }), [
      { ok: true, metrics: metrics() }, { ok: true, metrics: metrics() },
    ]);
    expect(formatScan(sampled)).toMatch(/axis H98: 0\.8 \.\.\. 1\.2 \(log\)/);
  });
});
