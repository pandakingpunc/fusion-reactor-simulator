/// <reference types="node" />
/**
 * The optimize command-line tool in child processes (node --import tsx). The problems are the small ones (two variables,
 * one start) that solve in well under a second; the full ITER problem is covered in src/analysis/design.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function optimize(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/optimize.cli.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SMALL = ['--preset', 'ITER', '--objective', 'gain', '--vars', 'fG,T', '--q-min', '0', '--q95-min', '2.5', '--start-temps', '8'];

describe('optimize CLI', { timeout: 120_000 }, () => {
  it('--help lists the objectives and the caveat', () => {
    const r = optimize('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage: npx tsx src\/cli\/optimize\.cli\.ts/);
    expect(r.stdout).toMatch(/EDUCATIONAL/);
    expect(r.stdout).toMatch(/major-radius, plasma-volume, aux-power, fusion-power, gain/);
  });

  it('usage errors (exit 2): missing or non-tokamak preset, unknown objective or variable, bad bounds, bad temperatures', () => {
    expect(optimize().stderr).toMatch(/--preset is required/);
    expect(optimize('--preset', 'W7X').stderr).toMatch(/--preset: unknown value 'W7X'/); // a stellarator is not offered
    expect(optimize('--preset', 'ITER15').code).toBe(2); // neither is a 1.5D preset
    expect(optimize('--preset', 'ITER', '--objective', 'cost').stderr).toMatch(/--objective: unknown value 'cost'/);
    expect(optimize('--preset', 'ITER', '--vars', 'R,nope').stderr).toMatch(/--vars: unknown value 'nope'/);
    expect(optimize('--preset', 'ITER', '--bound', 'R').stderr).toMatch(/expected PATH=VALUE/);
    expect(optimize('--preset', 'ITER', '--bound', 'R=7:6').stderr).toMatch(/HI must exceed LO/);
    expect(optimize('--preset', 'ITER', '--bound', 'X=1:2').stderr).toMatch(/--bound X: unknown variable/);
    expect(optimize('--preset', 'ITER', '--start-temps', '0.1').stderr).toMatch(/--start-temps: each temperature must be between/);
    expect(optimize('--preset', 'ITER', '--vars', 'R,R').stderr).toMatch(/listed twice/);
  });

  it('solves a small problem, prints the report, and writes byte-identical JSON on repeated runs', () => {
    const a = optimize(...SMALL, '--json', '-', '--quiet');
    const b = optimize(...SMALL, '--json', '-', '--quiet');
    expect(a.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    const r = JSON.parse(a.stdout);
    expect(r).toMatchObject({ schema: 1, tool: 'optimize', problem: { preset: 'ITER', objective: 'gain', variables: ['fG', 'T'] }, result: { feasible: true } });
    expect(r.caveat).toMatch(/^EDUCATIONAL/);
    expect(r.result.caveat).toBe(r.caveat);
    expect(r.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.problem.constraints).toMatchObject({ qMin: null, q95Min: 2.5, betaNMax: 3.5, pauxMaxMW: 50, coil: true });
    expect(r.result.optimum.Q).toBeGreaterThan(5);
    expect(r.result.objective.name).toBe('gain');
    expect(a.stdout).not.toMatch(/"ms"|"elapsed"|"date"|"host"/);
    const text = optimize(...SMALL);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Design optimisation of ITER: steady-state Q \(gain\) maximised/);
    expect(text.stdout).toMatch(/Optimum: steady-state Q = /);
    expect(text.stdout).toMatch(/Constraints:/);
    expect(text.stdout).toMatch(/input hash [0-9a-f]{64}/);
    // another problem, another hash
    expect(JSON.parse(optimize(...SMALL, '--paux-max', '30', '--json', '-', '--quiet').stdout).inputHash).not.toBe(r.inputHash);
  });

  it('with --json - the text summary goes to stderr; no --quiet, no JSON: stdout has the summary', () => {
    const r = optimize(...SMALL, '--json', '-');
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr).toMatch(/Design optimisation of ITER/);
  });

  it('a problem without a feasible design exits 1 and says so', () => {
    const r = optimize('--preset', 'ITER', '--objective', 'major-radius', '--vars', 'fG,T', '--q-min', '10000', '--start-temps', '8', '--max-evals', '2000', '--json', '-', '--quiet');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no feasible design found/);
    expect(JSON.parse(r.stdout).result.feasible).toBe(false);
  });
});
