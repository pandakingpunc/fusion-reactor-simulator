#!/usr/bin/env node
/**
 * Soak test of the exit status of the worker-pool CLIs: `npm run stress:exit -- [runs] [concurrency]`
 * (defaults 200 and 6). Runs `validate --only NIF` (a fixture check table, so the outcome does not depend on
 * the physics) and the golden check of an empty folder in fresh child processes and tallies their exit
 * codes. Exit 0 when every run ended with the code its inputs define (0 or 1); exit 1 when any run crashed
 * or was killed by a signal (on Windows a crash of the process shows up as an exit code such as
 * 3221225477 = 0xC0000005), listing the tally. It is a tripwire for the one unexplained 0xC0000005 crash of a
 * `validate` run (not reproduced since, cause unknown); it cannot prove that the crash is gone.
 *
 * Soak record (ws1d, 2026-09-30, Node v24.19.0, Windows 11, 12 cores shared with ten other agents, 8 busy-loop processes on top):
 * 400 runs of this script at concurrency 12 (through the tsx loader) and 1440 runs of scripts/build-lib.stress.mjs at concurrency 8 to 12
 * (the compiled fusion-sim, no tsx loader) all ended with the expected exit code; the Windows Application event log holds no
 * faulting-module record for node.exe. So the loader thread is neither shown to be the cause nor cleared: the crash stays
 * unreproduced (about 3400 runs in all since it was seen, with the 1600+ of ws1c). A crash dump (WER LocalDumps for node.exe) is the next step if it recurs.
 *
 * src/cli/exitStress.test.ts is the small version of this that runs in `npm test`.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const runs = Number(process.argv[2] ?? 200);
const concurrency = Number(process.argv[3] ?? 6);
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
  console.error('usage: node scripts/stress-exit.mjs [runs >= 1] [concurrency >= 1]');
  process.exit(2);
}

const check = (id, accept) => ({
  id: `NIF.${id}`, preset: 'NIF', metric: `gain ${id}`, path: 'report.Q_sci_max', value: (accept[0] + accept[1]) / 2, unit: '',
  ref: 'Fixture 2020', source: 'CLI test fixture, not a literature value (2020)', accept, tolerance: 'stated',
  kind: 'validation', basis: 'a bound chosen so that the outcome does not depend on the model',
});
const dir = mkdtempSync(join(tmpdir(), 'stress-exit-'));
const passing = join(dir, 'passing.json');
const failing = join(dir, 'failing.json');
writeFileSync(passing, JSON.stringify([check('in', [0, 1e6])]));
writeFileSync(failing, JSON.stringify([check('out', [1e6, 2e6])]));

const kinds = [
  { what: 'validate, passing check', expected: 0, args: ['src/cli/validate.cli.ts', '--threads', '2', '--only', 'NIF', '--checks', passing] },
  { what: 'validate, failing check', expected: 1, args: ['src/cli/validate.cli.ts', '--threads', '2', '--only', 'NIF', '--checks', failing] },
  { what: 'validate, failing check', expected: 1, args: ['src/cli/validate.cli.ts', '--threads', '2', '--only', 'NIF', '--checks', failing] },
  { what: 'golden, no golden file', expected: 1, args: ['src/cli/golden.cli.ts', '--threads', '2', '--only', 'NIF', '--dir', join(dir, 'no-golden')] },
];

const tally = new Map();
let started = 0;
let bad = 0;
const t0 = performance.now();

function one(k) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...k.args], { cwd: ROOT, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, signal: null }); });
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

async function lane() {
  while (started < runs) {
    const k = kinds[started++ % kinds.length];
    const { code, signal } = await one(k);
    const key = `${k.what}: ${signal ? `signal ${signal}` : `exit ${code}`}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (code !== k.expected || signal) bad++;
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, lane));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
for (const [key, n] of [...tally].sort()) console.log(`  ${String(n).padStart(5)}  ${key}`);
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(bad ? `\n✗ ${bad} of ${runs} runs ended with an unexpected exit status (${secs} s)` : `\n✓ all ${runs} runs ended with the expected exit code (${secs} s)`);
process.exitCode = bad ? 1 : 0;
