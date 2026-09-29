/// <reference types="node" />
/**
 * The optimize command-line tool end to end, in child processes (node --import tsx): exit codes and stdout/stderr routing on the
 * small problems (two variables, one start) that solve in well under a second. What the flags mean and what the reports contain is
 * tested in-process (optimizeSpec.test.ts); the full ITER problem is in src/analysis/design.test.ts.
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
  it('--help exits 0; usage errors exit 2 with the message on stderr', () => {
    const h = optimize('--help');
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/Usage: npx tsx src\/cli\/optimize\.cli\.ts/);
    const bad = optimize('--preset', 'W7X');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--preset: unknown value 'W7X'/);
    const bound = optimize(...SMALL, '--bound', 'R=7:6');
    expect(bound.code).toBe(2);
    expect(bound.stderr).toMatch(/HI must exceed LO/);
    expect(bound.stdout).toBe('');
  });

  it('solves a small problem: byte-identical JSON on stdout on repeated runs, the text summary on stderr; the text summary on stdout without --json', () => {
    const a = optimize(...SMALL, '--json', '-');
    const b = optimize(...SMALL, '--json', '-', '--quiet');
    expect(a.code).toBe(0);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stderr).toMatch(/Design optimisation of ITER/);
    expect(b.stderr).toBe('');
    const r = JSON.parse(a.stdout);
    expect(r).toMatchObject({ schema: 1, tool: 'optimize', result: { feasible: true } });
    expect(a.stdout).not.toMatch(/"ms"|"elapsed"|"date"|"host"/);
    const text = optimize(...SMALL);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/Optimum: steady-state Q = /);
    expect(text.stdout).toMatch(/input hash [0-9a-f]{64}/);
  });

  it('a problem without a feasible design exits 1 and says so', () => {
    const r = optimize('--preset', 'ITER', '--objective', 'major-radius', '--vars', 'fG,T', '--q-min', '10000', '--start-temps', '8', '--max-evals', '2000', '--json', '-', '--quiet');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no feasible design found/);
    expect(JSON.parse(r.stdout).result.feasible).toBe(false);
  });

  it('--pareto: the front as JSON on stdout', () => {
    const r = optimize('--preset', 'ITER', '--pareto', 'major-radius,aux-power', '--vars', 'R,B0,fG,T', '--paux-max', '200', '--pop-size', '20', '--generations', '10', '--json', '-', '--quiet');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ mode: 'pareto', problem: { objectives: ['major-radius', 'aux-power'] } });
    expect(out.result.feasibleFound).toBe(true);
  });
});
