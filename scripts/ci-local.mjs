#!/usr/bin/env node
// Local CI: type check, config JSON Schema up to date, unit tests, literature validation, golden regression and the reproducibility
// of the paper figures (docs/figures), in sequence, then (when scripts/check-bundle.mjs exists) the production build and its main-chunk budget.
// Stops at the first failing step and exits with its code. Usage: npm run ci:local [-- --dry-run]
//
// Environment knobs, for a machine that several agents or builds share (the defaults are the ones of a machine of its own):
//   CI_LOCAL_WORKERS   vitest workers of the unit-test step (a positive integer; unset: vitest's own default, one per core)
//   CI_LOCAL_THREADS   worker threads of the validation, golden and figures steps (a positive integer; default 4)
//   CI_LOCAL_FIGURES   0 skips the figures step (it regenerates the nine figures of docs/figures and compares their hashes with the manifest;
//                      several minutes; default: run it, a missing manifest fails it)
//   CI_LOCAL_BUNDLE    0 skips the build and bundle-size steps (default: run them when scripts/check-bundle.mjs exists)
// --dry-run prints the steps that would run and exits 0 (a bad knob value is a usage error, exit 2, also with --dry-run).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const win = process.platform === 'win32';

/** A positive-integer knob from the environment: undefined when unset or empty; a thrown Error naming the variable when it is anything else. */
function knob(env, name) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  if (!/^[1-9]\d{0,3}$/.test(raw.trim())) throw new Error(`${name} must be a positive integer (got "${raw}")`);
  return Number(raw.trim());
}

/**
 * The steps as [label, command, args]; npm/npx are .cmd shims on Windows and must be started through a shell.
 * `bundle`: whether scripts/check-bundle.mjs exists (the budget of the main chunk needs a build to measure).
 */
function buildSteps(env = process.env, bundle = existsSync(join(root, 'scripts', 'check-bundle.mjs'))) {
  const workers = knob(env, 'CI_LOCAL_WORKERS');
  const threads = knob(env, 'CI_LOCAL_THREADS') ?? 4;
  const steps = [
    ['type check', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']],
    ['config schema up to date', 'npm', ['run', 'schema:check']],
    ['scenario schema up to date', 'npm', ['run', 'schema:scenario:check']],
    ['config reference up to date', 'npm', ['run', 'docs:config:check']],
    ['unit tests', 'npx', ['vitest', 'run', ...(workers ? [`--maxWorkers=${workers}`] : [])]],
    ['validation', 'npm', ['run', 'validate', '--', '--threads', String(threads)]],
    ['golden regression', 'npm', ['run', 'golden', '--', '--threads', String(threads)]],
  ];
  if (env.CI_LOCAL_FIGURES !== '0') steps.push(['figures reproducible', 'npm', ['run', 'figures:check', '--', '--threads', String(threads)]]);
  if (bundle && env.CI_LOCAL_BUNDLE !== '0') {
    steps.push(['production build', 'npm', ['run', 'build']]);
    steps.push(['main chunk within budget', 'node', ['scripts/check-bundle.mjs']]);
  }
  return steps;
}

function main() {
  let steps;
  try {
    steps = buildSteps();
  } catch (e) {
    console.error(`ci:local: ${e.message}`);
    process.exit(2);
  }
  if (process.argv.slice(2).includes('--dry-run')) {
    for (const [i, [label, cmd, args]] of steps.entries()) console.log(`[${i + 1}/${steps.length}] ${label}: ${cmd} ${args.join(' ')}`);
    return;
  }
  const t0 = Date.now();
  for (const [i, [label, cmd, args]] of steps.entries()) {
    const s0 = Date.now();
    console.log(`\n▶ [${i + 1}/${steps.length}] ${label}: ${cmd} ${args.join(' ')}`);
    // the arguments are fixed literals or validated integers, so joining them into one shell command line is safe
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
}

main();
