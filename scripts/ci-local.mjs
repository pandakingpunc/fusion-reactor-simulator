#!/usr/bin/env node
// Local CI: type check, unit tests, literature validation and golden regression, in sequence.
// Stops at the first failing step and exits with its code. Usage: npm run ci:local
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const win = process.platform === 'win32';

/** [label, command, args] — npm/npx are .cmd shims on Windows and must be started through a shell */
const steps = [
  ['type check', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['unit tests', 'npx', ['vitest', 'run']],
  ['validation', 'npm', ['run', 'validate', '--', '--threads', '4']],
  ['golden regression', 'npm', ['run', 'golden', '--', '--threads', '4']],
];

const t0 = Date.now();
for (const [i, [label, cmd, args]] of steps.entries()) {
  const s0 = Date.now();
  console.log(`\n▶ [${i + 1}/${steps.length}] ${label}: ${cmd} ${args.join(' ')}`);
  // the arguments are fixed literals, so joining them into one shell command line is safe
  const r = win
    ? spawnSync([cmd, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  const secs = ((Date.now() - s0) / 1000).toFixed(1);
  if (r.error || r.status !== 0) {
    const code = r.status ?? 1;
    console.error(`\n✗ ci:local failed at step ${i + 1} (${label}) after ${secs} s — exit code ${code}${r.error ? ` (${r.error.message})` : ''}`);
    process.exit(code === 0 ? 1 : code);
  }
  console.log(`✓ ${label} (${secs} s)`);
}
console.log(`\n✓ ci:local passed: ${steps.map((s) => s[0]).join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
