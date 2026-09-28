/// <reference types="node" />
/**
 * Exit-status stress test of the worker-pool CLIs. One `validate` run once ended with exit code
 * 3221225477 (0xC0000005, a Windows access violation) instead of 0 or 1 while Node was tearing down its
 * worker threads at process exit; runPool now waits for every worker to stop before it settles
 * (pool.shutdown.test.ts checks that directly, this test checks the symptom). Each run below is a fresh
 * child process, and the exit code must be exactly the one its inputs define — never a crash code, never a
 * signal — over many runs, several at a time so that the machine is loaded like it is under `npm test`.
 *
 * Cost: 16 runs of about one second each, four at a time, a few seconds. For a real soak test use
 * `npm run stress:exit -- 300 8` (scripts/stress-exit.mjs) or set STRESS_EXIT_RUNS=300 for this test.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { ReferenceCheck } from '../physics/validation/references';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNS = Math.max(8, Number(process.env.STRESS_EXIT_RUNS) || 16);
const CONCURRENCY = 4;

/** a fixture check on the NIF gain that every finite gain is inside of ('in') or outside of ('out') */
const check = (id: string, accept: readonly [number, number]): ReferenceCheck => ({
  id: `NIF.${id}`, preset: 'NIF', metric: `gain ${id}`, path: 'report.Q_sci_max', value: (accept[0] + accept[1]) / 2, unit: '',
  ref: 'Fixture 2020', source: 'CLI test fixture, not a literature value (2020)', accept, tolerance: 'stated',
  kind: 'validation', basis: 'a bound chosen so that the outcome does not depend on the model',
});
const DIR = mkdtempSync(join(tmpdir(), 'exit-stress-'));
const PASSING = join(DIR, 'passing.json');
const FAILING = join(DIR, 'failing.json');
writeFileSync(PASSING, JSON.stringify([check('in', [0, 1e6])]));
writeFileSync(FAILING, JSON.stringify([check('out', [1e6, 2e6])]));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

interface Run { args: string[]; expected: number; what: string }
/** the mix of runs: validate that passes (0), validate that fails a check (1), golden check of an empty folder (1) */
function plan(n: number): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    out.push(k === 0
      ? { args: ['src/cli/validate.cli.ts', '--threads', '2', '--only', 'NIF', '--checks', PASSING], expected: 0, what: 'validate, passing check' }
      : k === 1 || k === 2
        ? { args: ['src/cli/validate.cli.ts', '--threads', '2', '--only', 'NIF', '--checks', FAILING], expected: 1, what: 'validate, failing check' }
        : { args: ['src/cli/golden.cli.ts', '--threads', '2', '--only', 'NIF', '--dir', join(DIR, 'no-golden')], expected: 1, what: 'golden, no golden file' });
  }
  return out;
}

function exitOf(args: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: ROOT, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

describe('worker-pool CLIs exit cleanly', { timeout: 30_000 + RUNS * 6_000 }, () => {
  it(`${RUNS} runs, ${CONCURRENCY} at a time: every exit code is the expected 0 or 1, none a crash or a signal`, async () => {
    const runs = plan(RUNS);
    const bad: string[] = [];
    let next = 0;
    const lane = async () => {
      while (next < runs.length) {
        const r = runs[next++];
        const { code, signal } = await exitOf(r.args);
        if (code !== r.expected || signal !== null) bad.push(`${r.what}: exit code ${code}${signal ? `, signal ${signal}` : ''} (expected ${r.expected})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
    expect(bad).toEqual([]);
  });
});
