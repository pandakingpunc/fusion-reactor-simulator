#!/usr/bin/env node
// Strict type-check ratchet: npm run typecheck:strict [-- --update]
//
// Runs `tsc --noEmit -p tsconfig.strict.json` (tsconfig.json plus noUnusedLocals, noUnusedParameters,
// noImplicitOverride, noImplicitReturns), counts the errors per file and compares them with
// scripts/strict-baseline.json. It fails (exit 1) only when a file has more errors than its baseline
// (a file missing from the baseline has 0), so existing errors can be fixed file by file by the lanes
// that own them while no new ones get in. --update rewrites the baseline with the current counts.
// Exit codes: 0 no file got worse; 1 a file got worse, or tsc could not run; 2 usage error.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = resolve(root, 'scripts', 'strict-baseline.json');
const PROJECT = 'tsconfig.strict.json';
/** errors reported without a file (e.g. configuration errors) */
const GLOBAL = '<global>';

const args = process.argv.slice(2);
for (const a of args) {
  if (a === '--help' || a === '-h') {
    console.log('usage: npm run typecheck:strict [-- --update]\n  --update   record the current per-file error counts in scripts/strict-baseline.json');
    process.exit(0);
  }
  if (a !== '--update') {
    console.error(`typecheck-strict: unknown argument '${a}' (only --update is accepted)`);
    process.exit(2);
  }
}
const update = args.includes('--update');

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', PROJECT, '--pretty', 'false'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
if (r.error) {
  console.error(`typecheck-strict: could not run tsc (${r.error.message})`);
  process.exit(1);
}

/** file → error lines */
const errors = new Map();
for (const line of `${r.stdout}\n${r.stderr}`.split(/\r?\n/)) {
  const m = /^(.+?)\(\d+,\d+\): error TS\d+: /.exec(line);
  const g = !m && /^error TS\d+: /.test(line);
  if (!m && !g) continue;
  const file = m ? relative(root, resolve(root, m[1])).replace(/\\/g, '/') : GLOBAL;
  if (!errors.has(file)) errors.set(file, []);
  errors.get(file).push(line);
}
if (r.status !== 0 && errors.size === 0) {
  console.error(`typecheck-strict: tsc exited with code ${r.status} without reporting errors:\n${r.stdout}${r.stderr}`);
  process.exit(1);
}
const counts = Object.fromEntries([...errors].map(([f, e]) => [f, e.length]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const total = (c) => Object.values(c).reduce((s, n) => s + n, 0);
const tscVersion = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('typescript/package.json'), 'utf8')).version;

if (update) {
  const out = {
    comment: 'Per-file error counts of `tsc -p tsconfig.strict.json`. Written by `npm run typecheck:strict -- --update`; a file may only go down.',
    typescript: tscVersion,
    total: total(counts),
    files: counts,
  };
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`typecheck:strict: baseline written (${out.total} errors in ${Object.keys(counts).length} files) → ${relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('typecheck-strict: scripts/strict-baseline.json is missing; create it with npm run typecheck:strict -- --update');
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {};
const worse = [], better = [];
for (const f of new Set([...Object.keys(base), ...Object.keys(counts)])) {
  const now = counts[f] ?? 0, was = base[f] ?? 0;
  if (now > was) worse.push({ f, was, now });
  else if (now < was) better.push({ f, was, now });
}
console.log(`typecheck:strict (${PROJECT}, TypeScript ${tscVersion}): ${total(counts)} errors in ${Object.keys(counts).length} files; baseline ${total(base)} in ${Object.keys(base).length}`);
if (better.length) {
  console.log('\nFewer errors than the baseline (lower it with npm run typecheck:strict -- --update):');
  for (const { f, was, now } of better) console.log(`  ${f}: ${was} → ${now}`);
}
if (worse.length) {
  console.log('\n✗ More strict-mode errors than the baseline:');
  for (const { f, was, now } of worse) {
    console.log(`  ${f}: ${was} → ${now}`);
    for (const e of errors.get(f) ?? []) console.log(`      ${e}`);
  }
  console.log('\nFix the new errors (or, for a deliberate exception, discuss raising the baseline).');
  process.exit(1);
}
console.log('\n✓ no file has more strict-mode errors than its baseline');
