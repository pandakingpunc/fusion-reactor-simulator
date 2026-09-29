/// <reference types="node" />
/**
 * fusion-sim from source in real child processes (node --import tsx src/cli/fusion-sim.ts): exit codes, the
 * streams, and a scan on the real worker pool, whose workers inherit the tsx loader. The compiled binary
 * is exercised in src/cli/lib.test.ts, everything else in cli.test.ts (in-process).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sim(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/fusion-sim.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 90_000 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('fusion-sim in a child process', { timeout: 120_000 }, () => {
  it('--help exits 0, no arguments exit 2', () => {
    const h = sim('--help');
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/^Usage: fusion-sim <command>/);
    expect(sim().code).toBe(2);
  });

  it('an invalid configuration exits 2 with every problem on stderr and nothing on stdout', () => {
    const r = sim('run', '--preset', 'ITER', '--set', 'geometry.kappa=0.5', '--set', 'B0=-1');
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/invalid configuration \(2 problems\)/);
    expect(r.err).toMatch(/geometry\.kappa: must be >= 1/);
  });

  it('run: csv on stdout, then the same bytes again (deterministic)', () => {
    const a = sim('run', '--preset', 'JET', '--t-end', '0.5', '--format', 'csv', '--series', 'Q,Ti', '--every', '25');
    expect(a.code).toBe(0);
    expect(a.err).toBe('');
    expect(a.out.split('\n')[0]).toBe('t,Q,Ti');
    expect(sim('run', '--preset', 'JET', '--t-end', '0.5', '--format', 'csv', '--series', 'Q,Ti', '--every', '25').out).toBe(a.out);
  });

  it('scan: the grid runs on the worker pool (the workers load the .ts worker through the inherited loader)', () => {
    const r = sim('scan', '--preset', 'JET', '--t-end', '0.5', '--param', 'heating.P_NBI_MW=10,20', '--param', 'fuel=DT,DD', '--metric', 'report.Q_sci_max', '--threads', '2');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const rows = r.out.trim().split('\n');
    expect(rows[0]).toBe('heating.P_NBI_MW,fuel,status,end_reason,report.Q_sci_max');
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).map((l) => l.split(',').slice(0, 3).join(','))).toEqual(['10,DT,ok', '10,DD,ok', '20,DT,ok', '20,DD,ok']);
  });

  it('scan: an invalid point is found before any worker starts (exit 2)', () => {
    const r = sim('scan', '--preset', 'JET', '--param', 'B0=3.7,-1');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/point 1 \(B0=-1\):\n {4}B0: must be > 0/);
  });

  it('presets and schema print JSON', () => {
    expect(JSON.parse(sim('presets', '--json').out).length).toBeGreaterThanOrEqual(21);
    expect(JSON.parse(sim('schema').out).$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('export-eqdsk writes a G-EQDSK of a 1.5D run to stdout (exit 0), and refuses a 0D run (exit 2)', () => {
    const r = sim('export-eqdsk', '--preset', 'SPARC15', '--t-end', '0.2', '--set', 'profiles.nRho=20', '--set', 'profiles.eqNR=25', '--out', '-');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out.split('\n')[0]).toMatch(/^fusion-sim equilibrium in force at t = 0\.2000 s +3 +25 +49$/);
    expect(sim('export-eqdsk', '--preset', 'JET', '--out', '-').code).toBe(2);
  });
});
