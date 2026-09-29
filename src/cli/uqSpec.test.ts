import { describe, expect, it } from 'vitest';
import { JET } from '../physics/presets';
import { serialRunner } from '../analysis/run';
import { CliHelpRequested, CliUsageError, parseArgs } from './args';
import { UQ_CLI, uqListParams, uqPrepare, uqReport, uqSpecFromArgs } from './uqSpec';

const parse = (...a: string[]) => parseArgs(UQ_CLI, a);
const SHORT = ['--preset', 'JET', '--t-end', '1'];

describe('uq flags', () => {
  it('--help lists the flags and the caveat', () => {
    let text = '';
    try { parse('--help'); } catch (e) { if (e instanceof CliHelpRequested) text = e.text; else throw e; }
    expect(text).toMatch(/Usage: npx tsx src\/cli\/uq\.cli\.ts/);
    expect(text).toMatch(/EDUCATIONAL/);
    for (const flag of ['--analysis', '--sampler', '--param', '--prob', '--flat-top', '--json', '--csv', '--threads']) expect(text).toContain(flag);
  });

  it('parse errors: missing or unknown preset, bad numbers, bad choices', () => {
    expect(() => parse()).toThrow(/--preset is required/);
    expect(() => parse('--preset', 'NOPE')).toThrow(/--preset: unknown value 'NOPE'/);
    expect(() => parse(...SHORT, '--n', '0')).toThrow(/--n must be >= 1/);
    expect(() => parse(...SHORT, '--sampler', 'halton')).toThrow(CliUsageError);
    expect(() => parse(...SHORT, '--flat-top', 'median')).toThrow(/--flat-top: unknown value 'median'/);
    expect(() => parse(...SHORT, '--confidence', '1')).toThrow(/--confidence must be <= 0.999/);
    expect(() => parse(...SHORT, '--seed', '-1')).toThrow(/--seed must be >= 0/);
  });

  it('the defaults', () => {
    const a = parse(...SHORT);
    expect(a).toMatchObject({ n: 64, analysis: 'propagate', sampler: 'sobol', seed: 1, 'h98-prior': 'ipb98y2', 'flat-top': 'frame', 'q-target': 10, bootstrap: 200, confidence: 0.95, 'max-runs': 100000, stochastic: false, quiet: false });
    expect(a.param).toBeUndefined();
    expect(a.priors).toBeUndefined();
  });
});

describe('uq specification', () => {
  it('a magnetic preset gets the default priors; the options reach the specification', () => {
    const s = uqSpecFromArgs(parse(...SHORT, '--n', '32', '--sampler', 'lhs', '--seed', '9', '--analysis', 'sensitivity', '--stochastic', '--flat-top', 'time', '--q-target', '5', '--bootstrap', '10', '--confidence', '0.9'));
    expect(s).toMatchObject({ preset: 'JET', base: JET, n: 32, sampler: 'lhs', seed: 9, analysis: 'sensitivity', runSeed: 'perRow', tEnd: 1, flatTop: 'time', qTarget: 5, bootstrap: 10, confidence: 0.9 });
    expect(s.priors.params.map((p) => p.path)).toEqual(['H98', 'n_target', 'impurity.concentration', 'transport.tau_He_over_tau_E', 'limits.betaN_limit', 'limits.greenwald_limit']);
    expect(s.quantileLevels).toEqual([0.05, 0.16, 0.5, 0.84, 0.95]);
  });

  it('--param replaces or adds a prior, --priors none drops the defaults, --h98-prior changes the width, --prob and --levels are parsed', () => {
    const s = uqSpecFromArgs(parse(...SHORT, '--param', 'H98=lognormal:0.85:0.2,geometry.R=normal:2.96:0.05', '--prob', 'Pfus_flat_MW>=10,nG_max>0.9', '--levels', '0.1,0.9'));
    expect(s.priors.params[0].dist).toEqual({ type: 'lognormal', median: 0.85, sigmaLog: 0.2 });
    expect(s.priors.params[s.priors.params.length - 1].path).toBe('geometry.R');
    expect(s.probabilities).toEqual([{ metric: 'Pfus_flat_MW', op: '>=', value: 10 }, { metric: 'nG_max', op: '>', value: 0.9 }]);
    expect(s.quantileLevels).toEqual([0.1, 0.9]);
    const none = uqSpecFromArgs(parse(...SHORT, '--priors', 'none', '--param', 'H98=uniform:0.8:1.2'));
    expect(none.priors.params.map((p) => p.path)).toEqual(['H98']);
    const wide = uqSpecFromArgs(parse(...SHORT, '--h98-prior', 'itpa20il'));
    expect(wide.priors.params[0].dist).toMatchObject({ sigmaLog: 0.44 / 2.79 });
  });

  it('a non-magnetic preset has no default priors: --param is needed', () => {
    expect(() => uqPrepare(parse('--preset', 'NIF'))).toThrow(/at least one uncertain parameter/);
    const p = uqPrepare(parse('--preset', 'NIF', '--param', 'E_laser_MJ=uniform:1.8:2.2', '--n', '4'));
    expect(p.plan.runs).toBe(4);
    expect(p.spec.priors.params).toHaveLength(1);
  });

  it('invalid syntax or values are RangeErrors (usage errors)', () => {
    for (const [args, re] of [
      [['--param', 'H98'], /expected PATH=VALUE/],
      [['--param', 'H98=gamma:1:2'], /unknown name 'gamma'/],
      [['--param', 'nope=uniform:0:1'], /'nope' is not a number of the tokamak configuration/],
      [['--prob', 'Qflat>1'], /unknown metric 'Qflat'/],
      [['--levels', '0.5,1.5'], /not a probability/],
      [['--n', '100000', '--analysis', 'sensitivity', '--max-runs', '1000'], /needs 800000 runs, more than the limit of 1000/],
    ] as [string[], RegExp][]) {
      expect(() => uqPrepare(parse(...SHORT, ...args)), args.join(' ')).toThrow(re);
      expect(() => uqPrepare(parse(...SHORT, ...args))).toThrow(RangeError);
    }
  });

  it('--list-params prints the default priors with their basis; a preset without defaults is an error', () => {
    const t = uqListParams(parse('--preset', 'ITER', '--list-params'));
    expect(t).toMatch(/H98\s+\{"type":"lognormal","median":1,"sigmaLog":0.14\}/);
    expect(t).toMatch(/IPB98\(y,2\).*Nucl\. Fusion 39 \(1999\) 2175/);
    expect(t).toMatch(/impurity\.seedConcentration/);
    expect(uqListParams(parse('--preset', 'ITER', '--list-params', '--h98-prior', 'itpa20il'))).toMatch(/"sigmaLog":0\.1577/);
    expect(() => uqListParams(parse('--preset', 'NIF', '--list-params'))).toThrow(/has no default priors/);
  });
});

describe('uq reports', { timeout: 60_000 }, () => {
  it('JSON, CSV and text of a propagation run (in-process, short JET shots)', async () => {
    const prep = uqPrepare(parse(...SHORT, '--n', '4', '--bootstrap', '0', '--priors', 'none', '--param', 'H98=uniform:0.8:1.2', '--levels', '0.1,0.9', '--prob', 'Pfus_flat_MW>=5', '--q-target', '0.3'));
    const out = uqReport(prep, await serialRunner(prep.plan.tasks()));
    expect(out.valid).toBe(4);
    const j = JSON.parse(out.json);
    expect(j.parameters.map((p: { path: string }) => p.path)).toEqual(['H98']);
    expect(Object.keys(j.outputs.Q_flat.quantiles)).toEqual(['p10', 'p90']);
    expect(j.probabilities.map((p: { id: string }) => p.id)).toEqual(['Q>=0.3', 'disruption', 'n/nG>1 (flat top)', 'n/nG>1 (any time)', 'Pfus_flat_MW>=5']);
    expect(j.caveat).toMatch(/^EDUCATIONAL/);
    expect(out.csv.trimEnd().split('\n')).toHaveLength(5);
    expect(out.text).toMatch(/UQ of JET \(tokamak, 0D, t_end 1 s\): 4 runs/);
    expect(out.text).toMatch(/P\(Q>=0\.3\)/);
  });

  it('a sensitivity analysis reports Sobol indices for the key outputs', async () => {
    const prep = uqPrepare(parse(...SHORT, '--analysis', 'sensitivity', '--n', '4', '--bootstrap', '10', '--priors', 'none', '--param', 'H98=uniform:0.6:1.4,n_target=uniform:4e19:8e19'));
    expect(prep.plan.runs).toBe(16);
    const out = uqReport(prep, await serialRunner(prep.plan.tasks()));
    const j = JSON.parse(out.json);
    expect(j.design).toMatchObject({ analysis: 'sensitivity', n: 4, runs: 16 });
    const q = j.sensitivity.targets.find((t: { metric: string }) => t.metric === 'Q_flat');
    expect(q.indices.map((i: { path: string }) => i.path)).toEqual(['H98', 'n_target']);
    expect(q.indices[0].S1_ci).toHaveLength(2);
    expect(q.indices[0].ST).toBeGreaterThan(0.05); // H98 multiplies the confinement time: it matters for Q
    expect(out.text).toMatch(/Sobol' indices \(16 runs/);
  });

  it('--flat-top time is recorded and changes the input hash', () => {
    const a = uqPrepare(parse(...SHORT, '--n', '4')), b = uqPrepare(parse(...SHORT, '--n', '4', '--flat-top', 'time'));
    expect(a.spec.flatTop).toBe('frame');
    expect(b.spec.flatTop).toBe('time');
    expect(b.plan.tasks()[0].weighting).toBe('time');
  });

  it('a run in which no shot works has zero valid shots', async () => {
    const prep = uqPrepare(parse(...SHORT, '--n', '2', '--priors', 'none', '--param', 'geometry.a=uniform:-2:-1', '--bootstrap', '0'));
    const out = uqReport(prep, await serialRunner(prep.plan.tasks()));
    expect(out.valid).toBe(0);
    expect(out.csv).toMatch(/FAILED: /);
  });
});
