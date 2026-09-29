/// <reference types="node" />
/**
 * The uq and scan command-line tools end to end, in child processes (node --import tsx), on very short JET shots (t_end 1 s, about
 * 0.2 s each): exit codes, stdout/stderr routing, and the contract that the same inputs give byte-identical JSON whatever the
 * thread count. What the flags mean and what the reports contain is tested in-process (uqSpec.test.ts, scanSpec.test.ts).
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

describe('uq CLI', { timeout: 180_000 }, () => {
  it('--help exits 0, a usage error exits 2 with the message on stderr and nothing on stdout, --list-params prints the priors', () => {
    const h = uq('--help');
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/Usage: npx tsx src\/cli\/uq\.cli\.ts/);
    const bad = uq('--preset', 'NOPE');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--preset: unknown value 'NOPE'/);
    expect(bad.stdout).toBe('');
    const param = uq(...SHORT, '--param', 'nope=uniform:0:1');
    expect(param.code).toBe(2);
    expect(param.stderr).toMatch(/'nope' is not a number of the tokamak configuration/);
    const list = uq('--preset', 'ITER', '--list-params');
    expect(list.code).toBe(0);
    expect(list.stdout).toMatch(/H98\s+\{"type":"lognormal","median":1,"sigmaLog":0.14\}/);
  });

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
    expect(ta).not.toMatch(/"ms"|"elapsed"|"date"|"host"/); // no timing or host information in the JSON
    const rows = readFileSync(csv, 'utf8').trimEnd().split('\n');
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatch(/^run,block,H98,n_target,/);
  });

  it('--json - puts only the JSON on stdout, the summary and the progress on stderr', () => {
    const r = uq(...SHORT, '--n', '4', '--bootstrap', '0', '--threads', '2', '--priors', 'none', '--param', 'H98=uniform:0.8:1.2', '--json', '-');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.parameters.map((p: { path: string }) => p.path)).toEqual(['H98']);
    expect(r.stderr).toMatch(/uq: 4\/4 runs/);
    expect(r.stderr).toMatch(/UQ of JET/);
    expect(r.stderr).toMatch(/EDUCATIONAL/);
  });

  it('without --json/--csv the text summary goes to stdout', () => {
    const r = uq(...SHORT, '--n', '4', '--bootstrap', '0', '--threads', '2');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/UQ of JET \(tokamak, 0D, t_end 1 s\): 4 runs/);
    expect(r.stdout).toMatch(/input hash [0-9a-f]{64}/);
  });

  it('a non-magnetic preset runs with explicit parameters; exit 1 when no shot runs to a result', () => {
    const nif = uq('--preset', 'NIF', '--param', 'E_laser_MJ=uniform:1.8:2.2', '--n', '4', '--bootstrap', '0', '--threads', '2', '--json', '-', '--quiet');
    expect(nif.code).toBe(0);
    expect(JSON.parse(nif.stdout).system.method).toBe('icf_indirect');
    const dead = uq(...SHORT, '--n', '2', '--priors', 'none', '--param', 'geometry.a=uniform:-2:-1', '--bootstrap', '0', '--threads', '1', '--quiet');
    expect(dead.code).toBe(1);
    expect(dead.stderr).toMatch(/no shot ran to a result/);
  });
});

describe('scan CLI', { timeout: 180_000 }, () => {
  it('--help exits 0; a usage error exits 2', () => {
    expect(scan('--help').code).toBe(0);
    const r = scan(...SHORT, '--param', 'H98=1:2');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/need --points/);
  });

  it('a grid: one row per combination; the JSON is byte-identical for different --threads; a run seed is recorded', () => {
    const args = [...SHORT, '--param', 'H98=0.8:1.2:3,n_target=log:4e19:1e20:2', '--quiet'];
    const a = join(DIR, 's1.json'), b = join(DIR, 's2.json'), c = join(DIR, 's3.json'), csv = join(DIR, 's.csv');
    expect(scan(...args, '--threads', '1', '--json', a, '--csv', csv).code).toBe(0);
    expect(scan(...args, '--threads', '3', '--json', b).code).toBe(0);
    const ta = readFileSync(a, 'utf8');
    expect(readFileSync(b, 'utf8')).toBe(ta);
    const r = JSON.parse(ta);
    expect(r).toMatchObject({ schema: 1, tool: 'scan', design: { mode: 'grid', points: 6, seed: null }, runs: { total: 6, valid: 6, failed: 0 } });
    expect(readFileSync(csv, 'utf8').trimEnd().split('\n')).toHaveLength(7);
    expect(scan(...args, '--threads', '2', '--run-seed', '77', '--json', c).code).toBe(0);
    expect(JSON.parse(readFileSync(c, 'utf8')).system.runSeed).toBe(77);
  });

  it('a sampled scan with --json -; the text table on stdout otherwise', () => {
    const r = scan(...SHORT, '--param', 'H98=0.8:1.2,n_target=4e19:1e20', '--points', '4', '--sampler', 'lhs', '--threads', '2', '--json', '-', '--quiet');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.design).toMatchObject({ mode: 'lhs', points: 4, seed: 1 });
    expect(out.points).toHaveLength(4);
    const t = scan(...SHORT, '--param', 'H98=0.8:1.2:2', '--threads', '2');
    expect(t.code).toBe(0);
    expect(t.stdout).toMatch(/Scan of JET/);
    expect(t.stdout).toMatch(/H98\s+Q_flat/);
  });
});
