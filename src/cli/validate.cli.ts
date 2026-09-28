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
 *                      `npm run` writes its banner to stdout before the JSON)
 *   --markdown         a Markdown table of the checks with the model values instead of the report
 *   --list             print the selected checks without running anything (with --markdown: as a table)
 *   --timeout S        fail a preset whose run takes longer than S seconds
 * Exit codes: 0 no unexpected failure; 1 a check or run failed, or no check was executed (the selection
 * has none); 2 usage error (unknown flag or preset id, bad --threads); 130 interrupted (Ctrl-C).
 */
import { PRESETS } from '../physics/presets';
import { REFERENCE_CHECKS, type CheckKind } from '../physics/validation/references';
import { readMetric } from '../physics/validation/metrics';
import {
  type CheckOutcome, evaluateCheck, fmt, fmtRange, formatOutcomeLine, isFailure, markdownTable, selectChecks, tally,
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
  reference: { value: number; uncertainty?: number; source: string; doi?: string };
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

async function main() {
  const args = parseArgsOrExit(CLI);
  if (args.json && args.markdown) exitUsage(CLI.name, '--json and --markdown are mutually exclusive');
  const kinds = args.kind as CheckKind[] | undefined;
  const checks = selectChecks(REFERENCE_CHECKS, args.only, kinds);
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
  const failures = runFails + t.fail + t.error;
  const known = outcomes.filter((o) => o.status === 'known-fail');
  const xpass = outcomes.filter((o) => o.status === 'xpass');
  if (known.length) {
    say('\n=== KNOWN FAILURES (documented in src/physics/validation/references.ts; not counted as failures) ===');
    for (const o of known) {
      say(`  ${o.check.id}: ${fmt(o.value)}${o.check.unit ? ` ${o.check.unit}` : ''}, accepted ${fmtRange(o.check)} — ${o.check.knownFailure}`);
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
      schema: 2, threads, wall_s: wall / 1000, presets: presetResults, checks: outcomes.map(toJson),
      checksExecuted: outcomes.length, failures, knownFailures: t.knownFail, unexpectedPasses: t.xpass,
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
    reference: { value: c.value, ...(c.uncertainty !== undefined ? { uncertainty: c.uncertainty } : {}), source: c.source, ...(c.doi ? { doi: c.doi } : {}) },
    status: o.status, pass: o.status === 'pass' || o.status === 'xpass', ref: c.ref,
    ...(c.knownFailure ? { knownFailure: c.knownFailure } : {}), ...(o.error ? { error: o.error } : {}),
  };
}

function printList(checks: ReturnType<typeof selectChecks>, json: boolean, markdown: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ schema: 2, checks }, null, 2) + '\n');
  } else if (markdown) {
    process.stdout.write(markdownTable(checks) + '\n');
  } else {
    for (const c of checks) {
      console.log(`  ${c.id.padEnd(14)} ${c.kind.padEnd(10)} ${c.metric} = ${fmt(c.value)}${c.uncertainty !== undefined ? ` ± ${fmt(c.uncertainty)}` : ''}` +
        `${c.unit ? ` ${c.unit}` : ''}, accepted ${fmtRange(c)}  [${c.ref}]${c.knownFailure ? '  (known failure)' : ''}`);
    }
    console.log(`\n${checks.length} checks`);
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
