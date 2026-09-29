import { describe, expect, it } from 'vitest';
import { serialRunner } from '../analysis/run';
import { CliHelpRequested, parseArgs } from './args';
import { SCAN_CLI, scanPrepare, scanReport, scanSpecFromArgs } from './scanSpec';

const parse = (...a: string[]) => parseArgs(SCAN_CLI, a);
const SHORT = ['--preset', 'JET', '--t-end', '1'];

describe('scan flags and specification', () => {
  it('--help, required flags, defaults', () => {
    let text = '';
    try { parse('--help'); } catch (e) { if (e instanceof CliHelpRequested) text = e.text; else throw e; }
    expect(text).toMatch(/Usage: npx tsx src\/cli\/scan\.cli\.ts/);
    expect(text).toMatch(/EDUCATIONAL/);
    expect(() => parse(...SHORT)).toThrow(/--param is required/);
    expect(parse(...SHORT, '--param', 'H98=1:2:3')).toMatchObject({ sampler: 'sobol', seed: 1, 'max-runs': 10000, 'flat-top': 'time' });
  });

  it('a grid: axes with N; the options reach the specification', () => {
    const s = scanSpecFromArgs(parse(...SHORT, '--param', 'H98=0.8:1.2:3,n_target=log:4e19:1e20:2', '--run-seed', '77', '--flat-top', 'frame'));
    expect(s).toMatchObject({ preset: 'JET', mode: 'grid', seed: 1, runSeed: 77, tEnd: 1, flatTop: 'frame', maxRuns: 10000 });
    expect(s.axes).toEqual([{ path: 'H98', lo: 0.8, hi: 1.2, points: 3 }, { path: 'n_target', lo: 4e19, hi: 1e20, points: 2, log: true }]);
  });

  it('a sampled scan: axes without N and --points', () => {
    const s = scanSpecFromArgs(parse(...SHORT, '--param', 'H98=0.8:1.2,n_target=4e19:1e20', '--points', '8', '--sampler', 'lhs', '--seed', '5'));
    expect(s).toMatchObject({ mode: 'lhs', points: 8, seed: 5 });
  });

  it('inconsistent axes and points are RangeErrors (usage errors)', () => {
    for (const [args, re] of [
      [['--param', 'H98=1'], /expected PATH=LO:HI/],
      [['--param', 'H98=1:2'], /need --points/],
      [['--param', 'H98=1:2:3', '--points', '4'], /--points is for a sampled scan/],
      [['--param', 'H98=1:2:3,n_target=1e20:2e20'], /give N on every axis/],
      [['--param', 'nope=1:2:3'], /'nope' is not a number/],
      [['--param', 'H98=1:2:3', '--max-runs', '2'], /the grid has 3 points, more than the limit of 2/],
    ] as [string[], RegExp][]) {
      expect(() => scanPrepare(parse(...SHORT, ...args)), args.join(' ')).toThrow(re);
      expect(() => scanPrepare(parse(...SHORT, ...args))).toThrow(RangeError);
    }
  });
});

describe('scan reports', { timeout: 60_000 }, () => {
  it('a grid run in-process: JSON, CSV and the text table', async () => {
    const prep = scanPrepare(parse(...SHORT, '--param', 'H98=0.8:1.2:3,n_target=log:4e19:1e20:2'));
    expect(prep.plan.runs).toBe(6);
    const out = scanReport(prep, await serialRunner(prep.plan.tasks()));
    expect(out.valid).toBe(6);
    const j = JSON.parse(out.json);
    expect(j).toMatchObject({ schema: 1, tool: 'scan', design: { mode: 'grid', points: 6, seed: null }, runs: { total: 6, valid: 6, failed: 0 } });
    expect(j.points.map((p: { values: Record<string, number> }) => [p.values.H98, p.values.n_target])).toEqual([[0.8, 4e19], [0.8, 1e20], [1, 4e19], [1, 1e20], [1.2, 4e19], [1.2, 1e20]]);
    expect(j.points[0].metrics.Q_flat).toBeGreaterThan(0);
    expect(out.csv.trimEnd().split('\n')).toHaveLength(7);
    expect(out.text).toMatch(/Scan of JET/);
    expect(out.text).toMatch(/H98 +n_target +Q_flat/);
  });

  it('a sampled scan is reported with its seed; a failed scan has zero valid shots', async () => {
    const s = scanPrepare(parse(...SHORT, '--param', 'H98=0.8:1.2', '--points', '2', '--sampler', 'mc', '--seed', '3'));
    const out = scanReport(s, await serialRunner(s.plan.tasks()));
    expect(JSON.parse(out.json).design).toMatchObject({ mode: 'mc', points: 2, seed: 3 });
    const bad = scanPrepare(parse(...SHORT, '--param', 'geometry.a=-2:-1:2'));
    expect(scanReport(bad, await serialRunner(bad.plan.tasks())).valid).toBe(0);
  });
});
