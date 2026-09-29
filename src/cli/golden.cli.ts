/// <reference types="node" />
/**
 * Golden regression CLI (see src/regression/golden.ts for what a snapshot contains).
 *
 *   npm run golden [-- --only A,B --threads N]
 *       Runs the golden cases on a worker pool and compares them with test/golden/<case>.json.
 *       Exit 0: all match; 1: a mismatch, a missing/unreadable golden file or a failed run
 *       (a table lists preset, key, old, new, rel. diff); 2: usage error.
 *   npm run golden:update -- --reason "why the numbers moved" [--only A,B]
 *   npm run golden:update -- --reason-file reason.txt [--only A,B]
 *       Rewrites the golden files and appends a dated entry to test/golden/CHANGES.md: the reason,
 *       the added and unchanged cases and, per changed case, a schema change, how many existing keys
 *       moved (largest relative change) and how many were added or removed, by section, then the moved,
 *       added and removed keys themselves (first 12 of each). Files in an older schema are
 *       compared too, so a format-only change is logged as "0 keys moved". Refuses to run without a reason.
 *       The reason of --reason-file may be long: the first paragraph is the title of the entry, further
 *       paragraphs (blank-line separated) follow it. Use it when the reason does not fit on a command line
 *       (npm.cmd on Windows rejects a long --reason with 'command line is too long').
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GOLDEN_CASES, GoldenDiff, SnapshotChange, caseConfig, compareSnapshots, formatDiffTable, parseSnapshot, serializeSnapshot, summarizeChange, toleranceFor } from '../regression/golden';
import { Changed, Reason, changesEntry, parseReason } from '../regression/changes';
import type { GoldenResult, GoldenTask } from '../regression/golden.worker';
import { PoolAbortError, PoolConfigError, defaultThreads, runPool } from './pool';
import { defineCli, exitUsage, parseArgsOrExit } from './args';

const CLI = defineCli({
  name: 'npm run golden --',
  summary: 'Golden regression check: runs every golden case and compares it with test/golden/<case>.json.\n' +
    'Exit codes: 0 all match; 1 mismatch, missing golden file or failed run; 2 usage error.',
  flags: {
    update: { type: 'bool', help: 'rewrite the golden files (npm run golden:update); requires --reason or --reason-file' },
    reason: { type: 'string', metavar: 'TEXT', help: 'why the numbers moved; recorded in CHANGES.md (update only)' },
    'reason-file': { type: 'string', metavar: 'FILE', help: 'read the reason from this UTF-8 file instead (update only); first paragraph = title, the rest follows it' },
    only: { type: 'list', choices: GOLDEN_CASES.map((c) => c.id), metavar: 'ID,…', help: 'only these cases' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores − 1)' },
    dir: { type: 'string', default: 'test/golden', metavar: 'DIR', help: 'golden file folder' },
    'max-rows': { type: 'int', default: 25, min: 1, help: 'mismatching keys listed per case' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a case that runs longer than S seconds (default: no limit)' },
  },
  epilog: 'A case whose worker crashes, hangs past --timeout or fails to load is reported as a RUN ERROR; the other\n' +
    'cases still run. Ctrl-C terminates the workers and exits with code 130.',
});

const CHANGES_HEADER = `# Golden regression log

Append-only record of every change to the golden files in this folder. Entries are written by
\`npm run golden:update -- --reason "…"\` (or \`--reason-file <file>\` for a long, multi-line reason); do not edit or reorder past entries.
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
  const reason = args.update ? reasonOrExit(args.reason, args['reason-file']) : undefined;
  if (!args.update && args.reason !== undefined) exitUsage(CLI.name, '--reason is only used by golden:update');
  if (!args.update && args['reason-file'] !== undefined) exitUsage(CLI.name, '--reason-file is only used by golden:update');
  const dir = resolve(args.dir);
  const cases = GOLDEN_CASES.filter((c) => !args.only || args.only.includes(c.id));
  const threads = args.threads ?? defaultThreads();
  const tasks: GoldenTask[] = cases.map((c) => ({ id: c.id, case: c })).sort((a, b) => weight(b) - weight(a));

  console.log(`Golden ${args.update ? 'update' : 'check'}: ${cases.length} cases on ${Math.min(threads, cases.length)} worker threads (${relative(process.cwd(), dir) || '.'})`);
  const t0 = performance.now();
  const res = await runPool<GoldenTask, GoldenResult>(tasks, new URL('../regression/golden.worker.ts', import.meta.url), {
    threads,
    timeoutMs: args.timeout === undefined ? undefined : args.timeout * 1000,
    // a crashed or hung worker fails its case only; the pool replaces the worker and carries on
    onTaskError: (e, t) => ({ id: t.id, ok: false, error: e.message, ms: 0 }),
  });
  const wall = performance.now() - t0;
  const byId = new Map(res.map((r) => [r.id, r]));
  const ordered = cases.map((c) => byId.get(c.id)!);

  if (reason) update(dir, ordered, reason, args.only, wall);
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

function update(dir: string, results: GoldenResult[], reason: Reason, only: string[] | undefined, wall: number): void {
  mkdirSync(dir, { recursive: true });
  const added: string[] = [], unchanged: string[] = [], failed: string[] = [];
  const changed: Changed[] = [];
  for (const r of results) {
    if (!r.ok || !r.snapshot) { failed.push(r.id); console.log(`  ${r.id.padEnd(14)} RUN ERROR  ${firstLine(r.error)}`); continue; }
    const file = join(dir, `${r.id}.json`);
    const text = serializeSnapshot(r.snapshot);
    if (!existsSync(file)) {
      added.push(r.id);
    } else {
      const oldText = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); // a checkout may have CRLF
      if (oldText === text) { unchanged.push(r.id); console.log(`  ${r.id.padEnd(14)} unchanged`); continue; }
      let change: SnapshotChange | undefined;
      let meta: string | undefined;
      try {
        const old = parseSnapshot(oldText, { anySchema: true }); // an older format is described, not rejected
        change = summarizeChange(old, r.snapshot);
        if (old.meta.node !== r.snapshot.meta.node) meta = `Node ${old.meta.node} → ${r.snapshot.meta.node}`;
      } catch (e) {
        meta = `replaced unreadable file (${e instanceof Error ? e.message : String(e)})`;
      }
      changed.push({ id: r.id, change, meta });
    }
    writeFileSync(file, text);
    console.log(`  ${r.id.padEnd(14)} ${added.includes(r.id) ? 'added' : 'updated'}`);
  }
  if (added.length || changed.length) {
    const log = join(dir, 'CHANGES.md');
    if (!existsSync(log)) writeFileSync(log, CHANGES_HEADER);
    appendFileSync(log, changesEntry({ reason, added, changed, unchanged, failed, only }));
    console.log(`\n✓ golden: ${added.length} added, ${changed.length} updated, ${unchanged.length} unchanged (${secs(wall)} wall); entry appended to ${relative(process.cwd(), log)}`);
  } else {
    console.log(`\n✓ golden: files already up to date (${unchanged.length} cases); nothing written`);
  }
  if (failed.length) {
    console.log(`✗ ${failed.length} case(s) failed to run and were not written: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

/** The reason of an update, from --reason or --reason-file; a usage error (exit 2) if there is none, both, or the file cannot be read. */
function reasonOrExit(text: string | undefined, file: string | undefined): Reason {
  if (text !== undefined && file !== undefined) exitUsage(CLI.name, '--reason and --reason-file are mutually exclusive');
  let raw = text;
  if (file !== undefined) {
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      exitUsage(CLI.name, `--reason-file: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const reason = raw === undefined ? undefined : parseReason(raw);
  if (!reason) exitUsage(CLI.name, file !== undefined ? `--reason-file ${file} contains no text` : 'golden:update requires --reason "why the numbers moved" or --reason-file FILE (it is recorded in CHANGES.md)');
  return reason;
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  if (e instanceof PoolAbortError) {
    console.error(`\n✗ golden: ${e.message}; nothing was written`);
    process.exitCode = 130;
    return;
  }
  console.error(e);
  process.exitCode = 1;
});
