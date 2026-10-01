/// <reference types="node" />
/**
 * Doğrulama CLI'si — `npm run validate` (tsx ile çalışır).
 *
 * Her preset'i (0D ve 1.5D) worker_threads havuzunda paralel koşturur (çekirdek sayısı − 1 işçi)
 * ve seçili çıktıları açık literatürdeki değerlerle karşılaştırır. The checks, their sources and the
 * acceptance policy live in src/physics/validation/references.ts; a check documented as a known
 * failure is reported as KNOWN-FAIL and does not fail the run.
 *   --threads N        işçi sayısı (varsayılan: çekirdek − 1)
 *   --only a,b         yalnız bu preset kimlikleri
 *   --kind k,…         only checks of these kinds (validation, benchmark, sanity)
 *   --json             machine-readable results on stdout instead of the report (use `npm run -s`: plain
 *                      `npm run` writes its banner to stdout before the JSON). Schema 3: one entry per check with the
 *                      reference (published value, uncertainty, source, DOI), the model value, ratio = model/published,
 *                      the accepted range, the pass status, the role (calibration, blind) and the wording of the
 *                      comparison: 'validated' within 20 % of the published value, 'benchmarked (deviation X %)' beyond
 *   --markdown         a Markdown table of the checks with the model values instead of the report
 *   --list             print the selected checks without running anything (with --markdown: as a table)
 *   --timeout S        fail a preset whose run takes longer than S seconds
 *   --checks FILE      use the checks of this JSON file (an array of ReferenceCheck objects) instead of
 *                      the built-in table; the same integrity rules apply. For tests and for trying out
 *                      new references before they go into references.ts
 * Exit codes: 0 no unexpected failure; 1 a check or run failed, or no check was executed (the selection
 * has none); 2 usage error (unknown flag or preset id, bad --threads); 130 interrupted (Ctrl-C).
 */
import { readFileSync } from 'node:fs';
import { PRESETS } from '../physics/presets';
import { REFERENCE_CHECKS, type CheckKind, type CheckRole, type ReferenceCheck, type Tolerance } from '../physics/validation/references';
import { readMetric } from '../physics/validation/metrics';
import {
  BENCHMARK_DEVIATION, type CheckOutcome, evaluateCheck, fmt, fmtRange, fmtReference, formatOutcomeLine, markdownTable, parseChecks, selectChecks, tally,
} from '../physics/validation/evaluate';
import { PoolAbortError, PoolConfigError, type PoolProgress, defaultThreads, runPool } from './pool';
import { defineCli, exitUsage, parseArgsOrExit } from './args';
import type { RunResult, RunTask } from './presetRunner.worker';

const KINDS: readonly CheckKind[] = ['validation', 'benchmark', 'sanity'];

const CLI = defineCli({
  name: 'npm run validate --',
  summary: 'Runs the presets (0D and 1.5D) on a worker-thread pool and checks selected outputs against published values\n' +
    '(src/physics/validation/references.ts). Checks documented as known failures are reported but do not fail the run.\n' +
    'Exit codes: 0 no unexpected failure; 1 a check or run failed, or no check was executed; 2 usage error; 130 interrupted.',
  flags: {
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores − 1)' },
    only: { type: 'list', choices: PRESETS.map((p) => p.id), metavar: 'ID,…', help: 'only these preset ids' },
    kind: { type: 'list', choices: KINDS, metavar: 'KIND,…', help: 'only checks of these kinds: validation, benchmark, sanity' },
    json: { type: 'bool', help: 'print machine-readable JSON results instead of the report' },
    markdown: { type: 'bool', help: 'print a Markdown table of the checks and model values instead of the report' },
    list: { type: 'bool', help: 'list the selected checks without running the presets (Markdown with --markdown)' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a preset whose run takes longer than S seconds (default: no limit)' },
    checks: {
      type: 'string', metavar: 'FILE',
      help: 'use the checks of this JSON file (an array of checks with the fields of references.ts) instead of the built-in table',
    },
  },
  epilog: 'With --json, stdout is a single JSON document. Plain `npm run` writes its own "> script" banner to\n' +
    'stdout first, so run it silently to capture the JSON:\n' +
    '  npm run -s validate -- --json > results.json     (or: npx tsx src/cli/validate.cli.ts --json > results.json)',
});

/** --json: one entry per executed check */
interface CheckResult {
  id: string;
  preset: string;
  metric: string;
  kind: CheckKind;
  /** null when the run failed or the value is not finite */
  value: number | null;
  unit: string;
  expected: { lo: number; hi: number };
  /** the published value of the check (also in `reference.value`) */
  published: number;
  reference: { value: number; uncertainty?: number; band?: readonly [number, number]; source: string; doi?: string; sourceLimitation?: string };
  /** model / published value; null when there is no model value */
  ratio: number | null;
  /** 100 × (ratio − 1), the deviation of the model from the published value in percent; null as `ratio` */
  deviationPct: number | null;
  /** 'validated', 'benchmarked (deviation +35 %)' (beyond 20 %), 'sanity bound', 'calibrated (deviation …)' or 'n/a' */
  wording: string;
  /** 'calibration' (a model constant was fitted to this value) or 'blind' (predicted after that calibration); absent otherwise */
  role?: CheckRole;
  tolerance: Tolerance;
  status: CheckOutcome['status'];
  /** value within the accepted range (status pass or xpass) */
  pass: boolean;
  ref: string;
  knownFailure?: string;
  error?: string;
}
/** --json: one entry per selected preset */
interface PresetResult {
  id: string;
  ok: boolean;
  error?: string;
  Q_sci_max?: number | null;
  E_fusion_MJ?: number | null;
  Tmax_keV?: number | null;
  score?: number | null;
  steps?: number;
  cpu_s?: number;
}

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** how many checks of each wording ('benchmarked (deviation +35 %)' counts as 'benchmarked'; 'n/a' as 'unavailable') */
function wordingTally(outcomes: readonly CheckOutcome[]): Record<'validated' | 'benchmarked' | 'calibrated' | 'sanity bound' | 'unavailable', number> {
  const t = { validated: 0, benchmarked: 0, calibrated: 0, 'sanity bound': 0, unavailable: 0 };
  for (const o of outcomes) {
    const w = o.wording.split(' ')[0];
    if (w === 'validated' || w === 'benchmarked' || w === 'calibrated') t[w]++;
    else if (o.wording === 'sanity bound') t['sanity bound']++;
    else t.unavailable++;
  }
  return t;
}

async function main() {
  const args = parseArgsOrExit(CLI);
  if (args.json && args.markdown) exitUsage(CLI.name, '--json and --markdown are mutually exclusive');
  const kinds = args.kind as CheckKind[] | undefined;
  const table = args.checks === undefined ? REFERENCE_CHECKS : loadChecks(args.checks);
  const checks = selectChecks(table, args.only, kinds);
  if (args.list) {
    printList(checks, args.json, args.markdown);
    return;
  }
  const threads = args.threads ?? defaultThreads();
  const quiet = args.json || args.markdown;
  const say = (line: string) => { if (!quiet) console.log(line); };
  const list = PRESETS.filter((p) => !args.only || args.only.includes(p.id));
  const tasks: RunTask[] = list.map((p) => ({ id: p.id, cfg: p.cfg }));
  const t0 = performance.now();
  // uzun koşular önce (yük dengeleme)
  const order = [...tasks].sort((a, b) => weight(b) - weight(a));
  // live progress on an interactive terminal only (stderr, erased when the last preset is done)
  const onProgress = !quiet && process.stderr.isTTY
    ? (p: PoolProgress) => {
      process.stderr.write(`\r  running presets: ${p.done}/${p.total} (${p.id ?? '?'}${p.ok ? '' : ' FAILED'})`.padEnd(64));
      if (p.done === p.total) process.stderr.write(`\r${' '.repeat(64)}\r`);
    }
    : undefined;
  const res = await runPool<RunTask, RunResult>(order, new URL('./presetRunner.worker.ts', import.meta.url), {
    threads,
    timeoutMs: args.timeout === undefined ? undefined : args.timeout * 1000,
    // a crashed or hung worker fails its preset only; the pool replaces the worker and carries on
    onTaskError: (e, t) => ({ id: t.id, ok: false, error: e.message }),
    onProgress,
  });
  const wall = performance.now() - t0;
  const byId = new Map(res.map((r) => [r.id, r]));

  let runFails = 0;
  const presetResults: PresetResult[] = [];
  say(`\n=== SUMMARY (all presets, ${threads} worker threads, ${(wall / 1000).toFixed(1)} s wall) ===`);
  let cpu = 0;
  for (const p of list) {
    const r = byId.get(p.id);
    if (!r?.ok || !r.report) {
      runFails++; say(`  ERROR ${p.id}: ${r?.error ?? 'no result'}`);
      presetResults.push({ id: p.id, ok: false, error: r?.error ?? 'no result' });
      continue;
    }
    cpu += r.ms ?? 0;
    const rep = r.report;
    const finite = isFinite(rep.Q_sci_max) && isFinite(rep.E_fusion_MJ) && isFinite(rep.Tmax_keV) && isFinite(rep.score);
    presetResults.push({
      id: p.id, ok: finite, ...(finite ? {} : { error: 'non-finite report' }),
      Q_sci_max: finiteOrNull(rep.Q_sci_max), E_fusion_MJ: finiteOrNull(rep.E_fusion_MJ), Tmax_keV: finiteOrNull(rep.Tmax_keV),
      score: finiteOrNull(rep.score), steps: r.steps, cpu_s: (r.ms ?? 0) / 1000,
    });
    if (!finite) { runFails++; say(`  NAN!  ${p.id}`); continue; }
    say(
      `  ${p.id.padEnd(8)} Q=${rep.Q_sci_max.toExponential(2)}  E_fus=${rep.E_fusion_MJ.toExponential(2)} MJ  T=${rep.Tmax_keV.toFixed(2)} keV  score=${rep.score}` +
      `  (${((r.ms ?? 0) / 1000).toFixed(1)} s, ${r.steps} steps)`
    );
  }
  say(`  parallel speed-up ≈ ${(cpu / wall).toFixed(1)}× (Σ CPU ${(cpu / 1000).toFixed(1)} s)`);

  say('\n=== VALIDATION (against literature) ===');
  const cfgById = new Map(PRESETS.map((p) => [p.id, p.cfg]));
  const outcomes: CheckOutcome[] = [];
  for (const c of checks) {
    const r = byId.get(c.preset);
    const o = !r?.ok || !r.report || !r.avg
      ? evaluateCheck(c, NaN, r?.error?.split('\n')[0] ?? 'run failed')
      : evaluateCheck(c, readMetric(c.path, { report: r.report, flatTop: r.avg, burn: r.burn, cfg: cfgById.get(c.preset)! }));
    outcomes.push(o);
    say(formatOutcomeLine(o));
  }
  const t = tally(outcomes);
  const words = wordingTally(outcomes);
  if (outcomes.length) {
    say(`  wording: ${words.validated} validated, ${words.benchmarked} benchmarked (deviation above ${BENCHMARK_DEVIATION * 100} % from the published value), ` +
      `${words.calibrated} calibrated, ${words['sanity bound']} sanity bounds${words.unavailable ? `, ${words.unavailable} without a model value` : ''}`);
  }
  const failures = runFails + t.fail + t.error;
  const known = outcomes.filter((o) => o.status === 'known-fail');
  const xpass = outcomes.filter((o) => o.status === 'xpass');
  if (known.length) {
    say('\n=== KNOWN FAILURES (documented in src/physics/validation/references.ts; not counted as failures) ===');
    for (const o of known) {
      say(`  ${o.check.id}: ${fmt(o.value)}${o.check.unit ? ` ${o.check.unit}` : ''}, accepted ${fmtRange(o.check)}, model/published ${fmt(o.ratio)}${o.check.role ? ` [${o.check.role}]` : ''} — ${o.check.knownFailure}`);
    }
  }
  if (xpass.length) {
    say('\n=== KNOWN FAILURES THAT NOW PASS (remove knownFailure from references.ts) ===');
    for (const o of xpass) say(`  ${o.check.id}: ${fmt(o.value)} within ${fmtRange(o.check)}`);
  }

  // zero executed checks is a failure: a filter that selects nothing checkable must not look green
  const none = outcomes.length === 0;
  if (args.json) {
    const out = {
      schema: 3, threads, wall_s: wall / 1000, presets: presetResults, checks: outcomes.map(toJson),
      checksExecuted: outcomes.length, failures, knownFailures: t.knownFail, unexpectedPasses: t.xpass, wordings: words,
      passed: failures === 0 && !none,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else if (args.markdown) {
    process.stdout.write(markdownTable(outcomes) + '\n\n' +
      `${t.pass + t.xpass} of ${outcomes.length} checks within the accepted range; ${t.knownFail} known failures; ${failures} unexpected failures.\n`);
  } else if (none && failures === 0) {
    say('  (none — the selection has no literature checks)\n\n✗ NO CHECKS EXECUTED\n');
  } else if (failures > 0) {
    say(`\n✗ ${failures} CHECKS FAILED${t.knownFail ? ` (plus ${t.knownFail} known failures)` : ''}\n`);
  } else if (t.knownFail || t.xpass) {
    say(`\n✓ NO UNEXPECTED FAILURES: ${t.pass + t.xpass} passed, ${t.knownFail} known failures (listed above)\n`);
  } else {
    say(`\n✓ ALL CHECKS PASSED (${t.pass})\n`);
  }
  if (failures > 0 || none) process.exitCode = 1;
}

function toJson(o: CheckOutcome): CheckResult {
  const c = o.check;
  return {
    id: c.id, preset: c.preset, metric: c.metric, kind: c.kind, value: o.value, unit: c.unit,
    expected: { lo: c.accept[0], hi: c.accept[1] },
    published: c.value,
    reference: {
      value: c.value, ...(c.uncertainty !== undefined ? { uncertainty: c.uncertainty } : {}), ...(c.band ? { band: c.band } : {}),
      source: c.source, ...(c.doi ? { doi: c.doi } : {}), ...(c.sourceLimitation ? { sourceLimitation: c.sourceLimitation } : {}),
    },
    ratio: o.ratio, deviationPct: o.deviation === null ? null : 100 * o.deviation, wording: o.wording, ...(c.role ? { role: c.role } : {}),
    tolerance: c.tolerance, status: o.status, pass: o.status === 'pass' || o.status === 'xpass', ref: c.ref,
    ...(c.knownFailure ? { knownFailure: c.knownFailure } : {}), ...(o.error ? { error: o.error } : {}),
  };
}

function printList(checks: ReturnType<typeof selectChecks>, json: boolean, markdown: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ schema: 3, checks }, null, 2) + '\n');
  } else if (markdown) {
    process.stdout.write(markdownTable(checks) + '\n');
  } else {
    for (const c of checks) {
      console.log(`  ${c.id.padEnd(14)} ${c.kind.padEnd(10)} ${c.metric} = ${fmtReference(c)}, accepted ${fmtRange(c)}  [${c.ref}]` +
        `${c.knownFailure ? '  (known failure)' : ''}`);
    }
    console.log(`\n${checks.length} checks`);
  }
}

/** --checks FILE: a JSON check table; a missing, unreadable or invalid file is a usage error (exit 2) */
function loadChecks(file: string): ReferenceCheck[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    exitUsage(CLI.name, `--checks: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return parseChecks(data, PRESETS.map((p) => p.id));
  } catch (e) {
    exitUsage(CLI.name, `--checks ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** kaba maliyet tahmini: 1.5D ve uzun atışlar önce */
function weight(t: RunTask): number {
  const c = t.cfg as { fidelity?: string; t_end?: number };
  return (c.fidelity === '1.5D' ? 100 : 1) * (c.t_end ?? 1);
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  if (e instanceof PoolAbortError) {
    console.error(`\n✗ validate: ${e.message}`);
    process.exitCode = 130;
    return;
  }
  console.error(e);
  process.exitCode = 1;
});
