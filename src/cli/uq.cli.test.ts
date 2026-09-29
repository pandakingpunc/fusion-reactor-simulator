/// <reference types="node" />
/**
 * The uq and scan command-line tools, exercised in child processes (node --import tsx) on very short JET shots
 * (t_end 1 s, about 0.2 s each): usage errors, the output formats, and the contract that the same inputs give
 * byte-identical JSON whatever the thread count.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'uq-cli-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function cli(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', `src/cli/${script}.cli.ts`, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const uq = (...a: string[]) => cli('uq', ...a);
const scan = (...a: string[]) => cli('scan', ...a);

const SHORT = ['--preset', 'JET', '--t-end', '1'];

describe('uq CLI usage errors (exit 2)', { timeout: 60_000 }, () => {
  it('--help prints the usage and exits 0', () => {
    const r = uq('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage: npx tsx src\/cli\/uq\.cli\.ts/);
    expect(r.stdout).toMatch(/EDUCATIONAL/);
    expect(r.stdout).toMatch(/--analysis/);
  });

  it('a missing --preset, an unknown preset, a bad number', () => {
    expect(uq().stderr).toMatch(/--preset is required/);
    expect(uq().code).toBe(2);
    expect(uq('--preset', 'NOPE').stderr).toMatch(/--preset: unknown value 'NOPE'/);
    expect(uq(...SHORT, '--n', '0').stderr).toMatch(/--n must be >= 1/);
    expect(uq(...SHORT, '--sampler', 'halton').code).toBe(2);
  });

  it('bad --param, --prob and --levels syntax; unknown path; unsupported combinations', () => {
    expect(uq(...SHORT, '--param', 'H98').stderr).toMatch(/expected PATH=VALUE/);
    expect(uq(...SHORT, '--param', 'H98=gamma:1:2').stderr).toMatch(/unknown name 'gamma'/);
    expect(uq(...SHORT, '--param', 'nope=uniform:0:1').stderr).toMatch(/'nope' is not a number of the tokamak configuration/);
    expect(uq(...SHORT, '--prob', 'Qflat>1').stderr).toMatch(/unknown metric 'Qflat'/);
    expect(uq(...SHORT, '--levels', '0.5,1.5').stderr).toMatch(/not a probability/);
    // a non-magnetic preset has no default priors: an ensemble needs parameters
    expect(uq('--preset', 'NIF').stderr).toMatch(/at least one uncertain parameter/);
    expect(uq('--preset', 'NIF', '--list-params').stderr).toMatch(/has no default priors/);
    expect(uq(...SHORT, '--n', '100000', '--analysis', 'sensitivity', '--max-runs', '1000').stderr).toMatch(/needs 800000 runs, more than the limit of 1000/);
  });

  it('--list-params prints the default priors with their basis', () => {
    const r = uq('--preset', 'ITER', '--list-params');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/H98\s+\{"type":"lognormal","median":1,"sigmaLog":0.14\}/);
    expect(r.stdout).toMatch(/IPB98\(y,2\).*Nucl\. Fusion 39 \(1999\) 2175/);
    expect(r.stdout).toMatch(/impurity\.seedConcentration/);
    expect(uq('--preset', 'ITER', '--list-params', '--h98-prior', 'itpa20il').stdout).toMatch(/"sigmaLog":0\.1577/);
  });
});

describe('uq CLI results', { timeout: 180_000 }, () => {
  it('writes JSON and CSV; the same inputs give byte-identical JSON whatever --threads is; another seed differs', () => {
    const common = [...SHORT, '--n', '8', '--bootstrap', '20', '--quiet'];
    const a = join(DIR, 'a.json'), b = join(DIR, 'b.json'), c = join(DIR, 'c.json'), csv = join(DIR, 'a.csv');
    expect(uq(...common, '--seed', '5', '--threads', '1', '--json', a, '--csv', csv).code).toBe(0);
    expect(uq(...common, '--seed', '5', '--threads', '3', '--json', b).code).toBe(0);
    expect(uq(...common, '--threads', '2', '--seed', '6', '--json', c).code).toBe(0);
    const ta = readFileSync(a, 'utf8');
    expect(readFileSync(b, 'utf8')).toBe(ta);
    expect(readFileSync(c, 'utf8')).not.toBe(ta);
    const r = JSON.parse(ta);
    expect(r).toMatchObject({ schema: 1, tool: 'uq', system: { preset: 'JET', method: 'tokamak', t_end_s: 1 }, design: { analysis: 'propagate', sampler: 'sobol', seed: 5, n: 8, runs: 8 }, runs: { total: 8, valid: 8, failed: 0 } });
    expect(r.caveat).toMatch(/^EDUCATIONAL/);
    expect(r.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.probabilities.map((p: { id: string }) => p.id)).toEqual(['Q>=10', 'disruption', 'n/nG>1 (flat top)', 'n/nG>1 (any time)']);
    expect(r.outputs.Q_flat.n).toBe(8);
    expect(ta).not.toMatch(/"ms"|"elapsed"|"date"|"host"/); // no timing or host information in the JSON
    const rows = readFileSync(csv, 'utf8').trimEnd().split('\n');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatch(/^run,block,H98,n_target,/);
  });

  it('--json - puts only the JSON on stdout, the summary and progress on stderr; extra probabilities and levels are honoured', () => {
    const r = uq(...SHORT, '--n', '4', '--bootstrap', '0', '--threads', '2', '--priors', 'none', '--param', 'H98=uniform:0.8:1.2', '--json', '-', '--levels', '0.1,0.9', '--prob', 'Pfus_flat_MW>=5', '--q-target', '0.3');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.parameters.map((p: { path: string }) => p.path)).toEqual(['H98']);
    expect(Object.keys(out.outputs.Q_flat.quantiles)).toEqual(['p10', 'p90']);
    expect(out.probabilities.map((p: { id: string }) => p.id)).toEqual(['Q>=0.3', 'disruption', 'n/nG>1 (flat top)', 'n/nG>1 (any time)', 'Pfus_flat_MW>=5']);
    expect(r.stderr).toMatch(/uq: 4\/4 runs/);
    expect(r.stderr).toMatch(/UQ of JET/);
    expect(r.stderr).toMatch(/EDUCATIONAL/);
  });

  it('the text summary lists the parameters, probabilities and outputs', () => {
    const r = uq(...SHORT, '--n', '4', '--bootstrap', '0', '--threads', '2');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/UQ of JET \(tokamak, 0D, t_end 1 s\): 4 runs/);
    expect(r.stdout).toMatch(/EDUCATIONAL/);
    expect(r.stdout).toMatch(/Uncertain parameters/);
    expect(r.stdout).toMatch(/P\(Q>=10\)/);
    expect(r.stdout).toMatch(/Q_flat\s+4 /);
    expect(r.stdout).toMatch(/input hash [0-9a-f]{64}/);
  });

  it('a sensitivity analysis reports Sobol indices for the key outputs', () => {
    const r = uq(...SHORT, '--analysis', 'sensitivity', '--n', '8', '--bootstrap', '10', '--threads', '2', '--priors', 'none',
      '--param', 'H98=uniform:0.6:1.4,n_target=uniform:4e19:8e19', '--json', '-', '--quiet');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.design).toMatchObject({ analysis: 'sensitivity', n: 8, runs: 32 });
    expect(out.sensitivity.runs).toBe(32);
    const q = out.sensitivity.targets.find((t: { metric: string }) => t.metric === 'Q_flat');
    expect(q.indices.map((i: { path: string }) => i.path)).toEqual(['H98', 'n_target']);
    expect(q.indices[0].S1_ci).toHaveLength(2);
    // H98 multiplies the confinement time: it must matter for Q
    expect(q.indices[0].ST).toBeGreaterThan(0.05);
  });

  it('a non-magnetic preset runs with explicit parameters', () => {
    const r = uq('--preset', 'NIF', '--param', 'E_laser_MJ=uniform:1.8:2.2', '--n', '4', '--bootstrap', '0', '--threads', '2', '--json', '-', '--quiet');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.system.method).toBe('icf_indirect');
    expect(out.runs.valid).toBe(4);
  });

  it('exits 1 when no shot runs to a result', () => {
    const r = uq(...SHORT, '--n', '2', '--priors', 'none', '--param', 'geometry.a=uniform:-2:-1', '--bootstrap', '0', '--threads', '1', '--quiet');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no shot ran to a result/);
  });
});

describe('scan CLI', { timeout: 180_000 }, () => {
  it('usage errors: axes, points, unknown path', () => {
    expect(scan(...SHORT).stderr).toMatch(/--param is required/);
    expect(scan(...SHORT, '--param', 'H98=1').stderr).toMatch(/expected PATH=LO:HI/);
    expect(scan(...SHORT, '--param', 'H98=1:2').stderr).toMatch(/need --points/);
    expect(scan(...SHORT, '--param', 'H98=1:2:3', '--points', '4').stderr).toMatch(/--points is for a sampled scan/);
    expect(scan(...SHORT, '--param', 'H98=1:2:3,n_target=1e20:2e20').stderr).toMatch(/give N on every axis/);
    expect(scan(...SHORT, '--param', 'nope=1:2:3').stderr).toMatch(/'nope' is not a number/);
    expect(scan(...SHORT, '--param', 'H98=1:2:3', '--max-runs', '2').stderr).toMatch(/the grid has 3 points, more than the limit of 2/);
    expect(scan('--help').code).toBe(0);
  });

  it('a grid: one row per combination, last axis fastest; JSON is byte-identical for different --threads', () => {
    const args = [...SHORT, '--param', 'H98=0.8:1.2:3,n_target=log:4e19:1e20:2', '--quiet'];
    const a = join(DIR, 's1.json'), b = join(DIR, 's2.json'), csv = join(DIR, 's.csv');
    expect(scan(...args, '--threads', '1', '--json', a, '--csv', csv).code).toBe(0);
    expect(scan(...args, '--threads', '3', '--json', b).code).toBe(0);
    const ta = readFileSync(a, 'utf8');
    expect(readFileSync(b, 'utf8')).toBe(ta);
    const r = JSON.parse(ta);
    expect(r).toMatchObject({ schema: 1, tool: 'scan', design: { mode: 'grid', points: 6, seed: null }, runs: { total: 6, valid: 6, failed: 0 } });
    expect(r.axes[0]).toMatchObject({ path: 'H98', points: 3, log: false, nominal: 0.85 });
    expect(r.axes[1].values[0]).toBe(4e19);
    expect(r.axes[1].values[1]).toBe(1e20);
    expect(r.points.map((p: { values: Record<string, number> }) => [p.values.H98, p.values.n_target])).toEqual([
      [0.8, 4e19], [0.8, 1e20], [1, 4e19], [1, 1e20], [1.2, 4e19], [1.2, 1e20],
    ]);
    expect(r.points[0].metrics.Q_flat).toBeGreaterThan(0);
    expect(readFileSync(csv, 'utf8').trimEnd().split('\n')).toHaveLength(7);
    // a run seed is part of the inputs
    const c = join(DIR, 's3.json');
    expect(scan(...args, '--threads', '2', '--run-seed', '77', '--json', c).code).toBe(0);
    expect(JSON.parse(readFileSync(c, 'utf8')).system.runSeed).toBe(77);
  });

  it('a sampled scan of a box with --points', () => {
    const r = scan(...SHORT, '--param', 'H98=0.8:1.2,n_target=4e19:1e20', '--points', '4', '--sampler', 'lhs', '--threads', '2', '--json', '-', '--quiet');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.design).toMatchObject({ mode: 'lhs', points: 4, seed: 1 });
    expect(out.points).toHaveLength(4);
    for (const p of out.points) {
      expect(p.values.H98).toBeGreaterThanOrEqual(0.8);
      expect(p.values.H98).toBeLessThanOrEqual(1.2);
    }
  });

  it('the text table is printed to stdout without --json/--csv', () => {
    const r = scan(...SHORT, '--param', 'H98=0.8:1.2:2', '--threads', '2');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Scan of JET/);
    expect(r.stdout).toMatch(/H98\s+Q_flat/);
  });
});
