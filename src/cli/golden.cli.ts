/// <reference types="node" />
/**
 * Golden regression CLI (see src/regression/golden.ts for what a snapshot contains).
 *
 *   npm run golden [-- --only A,B --threads N]
 *       Runs the golden cases on a worker pool and compares them with test/golden/<case>.json.
 *       Exit 0: all match; 1: a mismatch, a missing/unreadable golden file or a failed run
 *       (a table lists preset, key, old, new, rel. diff); 2: usage error.
 *   npm run golden:update -- --reason "why the numbers moved" [--only A,B]
 *       Rewrites the golden files and appends a dated entry (reason, added/changed cases and the
 *       keys that moved) to test/golden/CHANGES.md. Refuses to run without --reason.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GOLDEN_CASES, GoldenDiff, caseConfig, compareSnapshots, formatDiffTable, parseSnapshot, serializeSnapshot, toleranceFor } from '../regression/golden';
import type { GoldenResult, GoldenTask } from '../regression/golden.worker';
import { PoolConfigError, defaultThreads, runPool } from './pool';
import { defineCli, exitUsage, parseArgsOrExit } from './args';

const CLI = defineCli({
  name: 'npm run golden --',
  summary: 'Golden regression check: runs every golden case and compares it with test/golden/<case>.json.\n' +
    'Exit codes: 0 all match; 1 mismatch, missing golden file or failed run; 2 usage error.',
  flags: {
    update: { type: 'bool', help: 'rewrite the golden files (npm run golden:update); requires --reason' },
    reason: { type: 'string', metavar: 'TEXT', help: 'why the numbers moved; recorded in CHANGES.md (update only)' },
    only: { type: 'list', choices: GOLDEN_CASES.map((c) => c.id), metavar: 'ID,…', help: 'only these cases' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores − 1)' },
    dir: { type: 'string', default: 'test/golden', metavar: 'DIR', help: 'golden file folder' },
    'max-rows': { type: 'int', default: 25, min: 1, help: 'mismatching keys listed per case' },
  },
});

const CHANGES_HEADER = `# Golden regression log

Append-only record of every change to the golden files in this folder. Entries are written by
\`npm run golden:update -- --reason "…"\`; do not edit or reorder past entries.
`;

/** rough cost for longest-first scheduling */
function weight(t: GoldenTask): number {
  const c = caseConfig(t.case) as { fidelity?: string; t_end?: number };
  return (c.fidelity === '1.5D' ? 100 : 1) * (c.t_end ?? 1);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const firstLine = (s: string | undefined) => (s ?? 'no result').split('\n')[0];

async function main() {
  const args = parseArgsOrExit(CLI);
  const reason = args.reason?.replace(/\s+/g, ' ').trim();
  if (args.update && !reason) exitUsage(CLI.name, 'golden:update requires --reason "why the numbers moved" (it is recorded in CHANGES.md)');
  if (!args.update && args.reason !== undefined) exitUsage(CLI.name, '--reason is only used by golden:update');
  const dir = resolve(args.dir);
  const cases = GOLDEN_CASES.filter((c) => !args.only || args.only.includes(c.id));
  const threads = args.threads ?? defaultThreads();
  const tasks: GoldenTask[] = cases.map((c) => ({ id: c.id, case: c })).sort((a, b) => weight(b) - weight(a));

  console.log(`Golden ${args.update ? 'update' : 'check'}: ${cases.length} cases on ${Math.min(threads, cases.length)} worker threads (${relative(process.cwd(), dir) || '.'})`);
  const t0 = performance.now();
  const res = await runPool<GoldenTask, GoldenResult>(tasks, new URL('../regression/golden.worker.ts', import.meta.url), threads);
  const wall = performance.now() - t0;
  const byId = new Map(res.map((r) => [r.id, r]));
  const ordered = cases.map((c) => byId.get(c.id)!);

  if (args.update) update(dir, ordered, reason!, args.only, wall);
  else check(dir, ordered, args['max-rows'], !args.only, wall);
}

function check(dir: string, results: GoldenResult[], maxRows: number, all: boolean, wall: number): void {
  const bad: { case: string; diffs: GoldenDiff[] }[] = [];
  let failures = 0;
  for (const r of results) {
    const file = join(dir, `${r.id}.json`);
    const tag = r.id.padEnd(14);
    if (!r.ok || !r.snapshot) { failures++; console.log(`  ${tag} RUN ERROR  ${firstLine(r.error)}`); continue; }
    if (!existsSync(file)) { failures++; console.log(`  ${tag} NO GOLDEN FILE (${relative(process.cwd(), file)})`); continue; }
    let old;
    try {
      old = parseSnapshot(readFileSync(file, 'utf8'));
    } catch (e) {
      failures++; console.log(`  ${tag} BAD GOLDEN FILE  ${e instanceof Error ? e.message : String(e)}`); continue;
    }
    const tol = toleranceFor(old.meta.node);
    const diffs = compareSnapshots(old, r.snapshot, tol);
    if (diffs.length) { failures++; bad.push({ case: r.id, diffs }); }
    console.log(`  ${tag} ${diffs.length ? `MISMATCH (${plural(diffs.length, 'key')})` : 'ok'}`.padEnd(40) + `${secs(r.ms)}, tol ${tol.toExponential(0)} (golden: Node ${old.meta.node})`);
  }
  if (all && existsSync(dir)) {
    const known = new Set(GOLDEN_CASES.map((c) => `${c.id}.json`));
    for (const f of readdirSync(dir)) if (f.endsWith('.json') && !known.has(f)) console.log(`  warning: ${f} does not belong to any golden case`);
  }
  if (bad.length) console.log(`\n${formatDiffTable(bad, maxRows)}`);
  console.log(failures
    ? `\n✗ golden: ${failures} of ${results.length} cases differ or failed (${secs(wall)} wall). If the change is intended: npm run golden:update -- --reason "…"\n`
    : `\n✓ golden: all ${results.length} cases match (${secs(wall)} wall)\n`);
  if (failures) process.exitCode = 1;
}

function update(dir: string, results: GoldenResult[], reason: string, only: string[] | undefined, wall: number): void {
  mkdirSync(dir, { recursive: true });
  const added: string[] = [], unchanged: string[] = [], failed: string[] = [];
  const changed: { id: string; diffs: GoldenDiff[]; meta?: string }[] = [];
  for (const r of results) {
    if (!r.ok || !r.snapshot) { failed.push(r.id); console.log(`  ${r.id.padEnd(14)} RUN ERROR  ${firstLine(r.error)}`); continue; }
    const file = join(dir, `${r.id}.json`);
    const text = serializeSnapshot(r.snapshot);
    if (!existsSync(file)) {
      added.push(r.id);
    } else {
      const oldText = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); // a checkout may have CRLF
      if (oldText === text) { unchanged.push(r.id); console.log(`  ${r.id.padEnd(14)} unchanged`); continue; }
      let diffs: GoldenDiff[];
      let meta: string | undefined;
      try {
        const old = parseSnapshot(oldText);
        diffs = compareSnapshots(old, r.snapshot, 0);
        if (old.meta.node !== r.snapshot.meta.node) meta = `Node ${old.meta.node} → ${r.snapshot.meta.node}`;
      } catch (e) {
        diffs = [];
        meta = `replaced unreadable file (${e instanceof Error ? e.message : String(e)})`;
      }
      changed.push({ id: r.id, diffs, meta });
    }
    writeFileSync(file, text);
    console.log(`  ${r.id.padEnd(14)} ${added.includes(r.id) ? 'added' : 'updated'}`);
  }
  if (added.length || changed.length) {
    const log = join(dir, 'CHANGES.md');
    if (!existsSync(log)) writeFileSync(log, CHANGES_HEADER);
    appendFileSync(log, changesEntry(reason, added, changed, unchanged, failed, only));
    console.log(`\n✓ golden: ${added.length} added, ${changed.length} updated, ${unchanged.length} unchanged (${secs(wall)} wall); entry appended to ${relative(process.cwd(), log)}`);
  } else {
    console.log(`\n✓ golden: files already up to date (${unchanged.length} cases); nothing written`);
  }
  if (failed.length) {
    console.log(`✗ ${failed.length} case(s) failed to run and were not written: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

function changesEntry(reason: string, added: string[], changed: { id: string; diffs: GoldenDiff[]; meta?: string }[], unchanged: string[], failed: string[], only: string[] | undefined): string {
  const now = new Date().toISOString();
  const stamp = `${now.slice(0, 10)} ${now.slice(11, 16)} UTC`;
  const L: string[] = ['', `## ${stamp} — ${reason}`, ''];
  L.push(`Node ${process.version} · \`npm run golden:update\` · ${only ? `--only ${only.join(',')}` : 'all cases'}`, '');
  if (added.length) L.push(`- Added (${added.length}): ${added.join(', ')}`);
  if (changed.length) {
    L.push(`- Changed (${changed.length}):`);
    for (const c of changed) {
      const numeric = c.diffs.filter((d) => Number.isFinite(d.rel));
      const maxRel = numeric.length ? Math.max(...numeric.map((d) => d.rel)) : undefined;
      const keys = c.diffs.slice(0, 12).map((d) => d.key).join(', ') + (c.diffs.length > 12 ? `, … (+${c.diffs.length - 12} more)` : '');
      const parts = [`${plural(c.diffs.length, 'key')} moved`];
      if (maxRel !== undefined) parts.push(`max rel. diff ${maxRel.toExponential(2)}`);
      if (c.meta) parts.push(c.meta);
      L.push(`  - ${c.id}: ${parts.join('; ')}${c.diffs.length ? ` — ${keys}` : ''}`);
    }
  }
  if (unchanged.length) L.push(`- Unchanged (${unchanged.length}): ${unchanged.join(', ')}`);
  if (failed.length) L.push(`- Failed to run, not written (${failed.length}): ${failed.join(', ')}`);
  return L.join('\n') + '\n';
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  console.error(e);
  process.exitCode = 1;
});
