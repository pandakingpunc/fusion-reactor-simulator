#!/usr/bin/env node
// Soak test of the exit status of the COMPILED fusion-sim (no tsx loader): the counterpart of scripts/stress-exit.mjs,
// which runs the sources through tsx. One spawned `validate` once ended with the Windows exit code 3221225477
// (0xC0000005, an access violation) and the cause is unknown; one suspect is the tsx loader thread at process exit,
// which the compiled binary does not have. Every run below is a fresh `node build/lib/fusion-sim.js scan` (a pool of
// two worker threads that must all stop before the process ends) or `run`, and must end with exactly the exit code its
// inputs define: never a crash code, never a signal.
//
//   node scripts/build-lib.stress.mjs [runs=150] [concurrency=3] [--lib DIR]
//
// Builds into a temporary directory unless --lib names an existing build (build/lib). Exit 0 when every run ended as
// expected, 1 otherwise (the tally is printed). Like stress-exit.mjs it is a tripwire, not a proof.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const li = argv.indexOf('--lib');
const libArg = li >= 0 ? argv[li + 1] : undefined;
const nums = argv.filter((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1)).map(Number);
const runs = nums[0] ?? 150, concurrency = nums[1] ?? 3;
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1 || (li >= 0 && !libArg)) {
  console.error('usage: node scripts/build-lib.stress.mjs [runs >= 1] [concurrency >= 1] [--lib DIR]');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'fusion-stress-'));
let lib = libArg;
if (!lib) {
  lib = join(work, 'lib');
  const b = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-lib.mjs'), '--out', lib, '--quiet', '--no-types'], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error(`build failed:\n${b.stdout}${b.stderr}`); process.exit(1); }
}
const bin = join(lib, 'fusion-sim.js');
const kinds = [
  { what: 'scan on 2 workers', expected: 0, args: ['scan', '--preset', 'NIF', '--param', 'seed=1,2', '--metric', 'report.Q_sci_max', '--threads', '2'] },
  { what: 'scan on 2 workers, failing point', expected: 1, args: ['scan', '--preset', 'NIF', '--param', 'seed=1,2', '--no-validate', '--set', 'method=nope', '--threads', '2'] },
  { what: 'run, invalid configuration', expected: 2, args: ['run', '--preset', 'NIF', '--set', 'E_laser_MJ=-1'] },
  { what: 'run, csv', expected: 0, args: ['run', '--preset', 'FRXL', '--format', 'csv', '--series', 'Q'] },
];

const tally = new Map();
let started = 0, bad = 0;
const t0 = performance.now();
const one = (k) => new Promise((resolve) => {
  const child = spawn(process.execPath, [bin, ...k.args], { stdio: 'ignore' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  child.on('error', () => { clearTimeout(timer); resolve({ code: -1, signal: null }); });
  child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
});
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
  rmSync(work, { recursive: true, force: true });
}
for (const [key, n] of [...tally].sort()) console.log(`  ${String(n).padStart(5)}  ${key}`);
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(bad ? `\n✗ ${bad} of ${runs} runs ended with an unexpected exit status (${secs} s)` : `\n✓ all ${runs} runs of the compiled fusion-sim ended with the expected exit code (${secs} s)`);
process.exitCode = bad ? 1 : 0;
