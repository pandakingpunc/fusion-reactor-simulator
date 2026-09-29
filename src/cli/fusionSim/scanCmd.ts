/// <reference types="node" />
/**
 * `fusion-sim scan`: the Cartesian product of parameter values, every point run on the worker pool, one
 * row of metrics per point.
 *
 *   fusion-sim scan --preset ITER --param heating.P_NBI_MW=10:50:10 --param H98=0.9,1.0,1.1 \
 *                   --metric flatTop.Q,report.E_fusion_MJ --out scan.csv
 *
 * A parameter is `PATH=SPEC`: a comma list (10,20,30 or DT,DD) or an inclusive range `start:stop:step`.
 * Metrics use the paths of the validation table: `flatTop.<key>`, `report.<key>`, `engineering.<key>`,
 * `burn.<key>`, `derived.H98y2|Ttot|alphaShare`.
 */
import { parseSettingValue, setPath, splitPath } from '../../physics/config/paths';
import { formatIssue, validateConfig } from '../../physics/config/schema';
import { runShot } from '../../physics/config/run';
import { DERIVED_METRICS, METRIC_SCOPES, readMetric, type MetricPath } from '../../physics/validation/metrics';
import { runFingerprint } from '../../physics/kernel/fingerprint';
import type { ReactorConfig } from '../../physics/types';
import { csvFromRows } from '../../io/csv';
import { jsonLine } from '../../io/ndjson';
import { defineCli, parseArgs, CliUsageError } from '../args';
import { PoolAbortError, PoolConfigError, defaultThreads, runPool, type PoolProgress } from '../pool';
import type { RunResult, RunTask } from '../presetRunner.worker';
import {
  CONFIG_EPILOG, CONFIG_FLAGS, CliContext, CliFailure, CliInputError, emit, extensionOf, packageVersionOf, provenanceBlock, resolveConfig, takeRepeated,
} from './common';

const FORMATS = ['csv', 'json', 'ndjson'] as const;
type Format = (typeof FORMATS)[number];
const EXT_FORMAT: Readonly<Record<string, Format>> = { csv: 'csv', json: 'json', ndjson: 'ndjson', jsonl: 'ndjson' };

/** what the table holds when --metric is not given */
export const DEFAULT_METRICS: readonly string[] = ['report.Q_sci_max', 'flatTop.Q', 'flatTop.P_fus', 'report.E_fusion_MJ', 'report.Tmax_keV', 'report.score'];

/** Runs scan tasks (one Simulation each) and returns their results in task order. */
export type Executor = (tasks: RunTask[], opts: { threads: number; timeoutMs?: number; onProgress?: (p: PoolProgress) => void }) => Promise<RunResult[]>;

/** The worker of presetRunner.worker.ts: the .ts file when running from source (tsx), the compiled .js next to the bundle. */
export function workerUrl(here: string = import.meta.url): URL {
  return here.endsWith('.ts') ? new URL('../presetRunner.worker.ts', here) : new URL('./presetRunner.worker.js', here);
}

/** An executor that runs the tasks on a pool of worker threads that load the given worker module. */
export function makePoolExecutor(url: URL): Executor {
  return (tasks, opts) => runPool<RunTask, RunResult>(tasks, url, {
    threads: opts.threads,
    timeoutMs: opts.timeoutMs,
    onProgress: opts.onProgress,
    // a crashed or hung worker fails its point only; the pool replaces it and carries on
    onTaskError: (e, t) => ({ id: t.id, ok: false, error: e.message }),
  });
}

/** The default executor: a pool of worker threads running presetRunner.worker (see {@link workerUrl}). */
export const poolExecutor: Executor = (tasks, opts) => makePoolExecutor(workerUrl())(tasks, opts);

export const SCAN_CLI = defineCli({
  name: 'fusion-sim scan',
  summary: 'Runs a grid of parameter values on worker threads and writes one row of metrics per point.\n' +
    'Every point starts from the configuration (preset and/or file, then --set) and then takes its parameter values.',
  flags: {
    ...CONFIG_FLAGS,
    metric: { type: 'list', metavar: 'PATH,…', help: `metrics to record, as in the validation table (default: ${DEFAULT_METRICS.join(',')})` },
    format: { type: 'string', choices: FORMATS, help: 'csv (a table), json (one document), ndjson (one point per line); default: from the --out extension, else csv' },
    out: { type: 'string', metavar: 'FILE', help: 'write here instead of stdout (`-` is stdout)' },
    series: { type: 'list', metavar: 'KEY,…', help: 'json and ndjson: also keep the time series of these diagnostics for every point' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores - 1)' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a point that runs longer than S seconds' },
    'max-points': { type: 'int', min: 1, default: 10000, help: 'refuse a grid with more points than this' },
    indent: { type: 'int', min: 0, max: 8, default: 2, help: 'JSON indentation (json)' },
  },
  epilog: 'Parameters: --param PATH=SPEC (repeatable, at least one). SPEC is a comma list (10,20,30 or DT,DD) or an inclusive\n' +
    'range start:stop:step (10:50:10). The first --param varies slowest.\n' +
    'Metrics: flatTop.<diagnostic>, report.<field>, engineering.<field>, burn.<Ti|Te>, derived.<H98y2|Ttot|alphaShare>.\n\n' +
    `${CONFIG_EPILOG}\n\nExit codes: 0 every point ran; 1 a point crashed or timed out; 2 usage or input error (an invalid point is listed with its path); 130 interrupted.`,
});

// ── parameters ──────────────────────────────────────────────────────────────────────────────────────

export interface ParamSpec { path: string; values: unknown[] }

/** The largest number of values a range may expand to (a guard against `0:1:1e-9`). */
const MAX_RANGE = 1_000_000;

/** Parses `PATH=SPEC` into the values of one parameter. Throws CliUsageError. */
export function parseParam(text: string): ParamSpec {
  const eq = text.indexOf('=');
  if (eq < 0) throw new CliUsageError(`--param '${text}' is not of the form PATH=SPEC`);
  const path = text.slice(0, eq).trim();
  try { splitPath(path); } catch (e) { throw new CliUsageError(`--param '${text}': ${(e as Error).message}`); }
  const spec = text.slice(eq + 1).trim();
  if (spec === '') throw new CliUsageError(`--param '${text}' has no values`);
  const range = spec.split(':');
  if (range.length === 3 && range.every((s) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim()))) {
    const [a, b, step] = range.map(Number);
    if (step === 0 || (b - a) * step < 0) throw new CliUsageError(`--param '${text}': the step ${step} does not lead from ${a} to ${b}`);
    const n = Math.floor((b - a) / step + 1e-9) + 1;
    if (n > MAX_RANGE) throw new CliUsageError(`--param '${text}' expands to ${n} values (limit ${MAX_RANGE})`);
    return { path, values: Array.from({ length: n }, (_, i) => Number((a + i * step).toPrecision(12))) };
  }
  const items = spec.split(',').map((s) => s.trim());
  if (items.some((s) => s === '')) throw new CliUsageError(`--param '${text}' has an empty value in its list`);
  return { path, values: items.map(parseSettingValue) };
}

/** Validates a metric path (the scope and, for a derived metric, its name). Throws CliUsageError. */
export function checkMetric(path: string): MetricPath {
  const dot = path.indexOf('.');
  const scope = dot < 0 ? path : path.slice(0, dot), key = dot < 0 ? '' : path.slice(dot + 1);
  if (!(METRIC_SCOPES as readonly string[]).includes(scope) || key === '') {
    throw new CliUsageError(`--metric '${path}': a metric is SCOPE.KEY with SCOPE one of ${METRIC_SCOPES.join(', ')}`);
  }
  if (scope === 'derived' && !(DERIVED_METRICS as readonly string[]).includes(key)) {
    throw new CliUsageError(`--metric '${path}': derived metrics are ${DERIVED_METRICS.join(', ')}`);
  }
  return path as MetricPath;
}

const fmtValue = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

interface Point { index: number; values: unknown[]; cfg: ReactorConfig; fixedId: string }

/** The points of the grid in row-major order (the first parameter varies slowest). */
export function gridPoints(params: readonly ParamSpec[]): unknown[][] {
  let rows: unknown[][] = [[]];
  for (const p of params) rows = rows.flatMap((r) => p.values.map((v) => [...r, v]));
  return rows;
}

interface PointResult {
  index: number;
  params: Record<string, unknown>;
  status: 'ok' | 'ended' | 'error';
  endReason: string;
  metrics: Record<string, number>;
  steps?: number;
  events?: Record<string, number>;
  series?: Record<string, number[]>;
  error?: string;
  fingerprint: string;
}

export async function scanCommand(argv: readonly string[], ctx: CliContext): Promise<number> {
  const { rest, values } = takeRepeated(argv, ['set', 'param']);
  const args = parseArgs(SCAN_CLI, rest);
  if (!values.param.length) throw new CliUsageError('give at least one --param PATH=SPEC');
  const params = values.param.map(parseParam);
  const dup = params.find((p, i) => params.findIndex((q) => q.path === p.path) !== i);
  if (dup) throw new CliUsageError(`--param ${dup.path} is given twice`);
  const metricPaths = (args.metric ?? DEFAULT_METRICS).map(checkMetric);
  const format: Format = (args.format as Format | undefined) ?? EXT_FORMAT[extensionOf(args.out)] ?? 'csv';
  const grid = gridPoints(params);
  if (grid.length > args['max-points']) throw new CliUsageError(`the grid has ${grid.length} points, more than --max-points ${args['max-points']}`);

  const base = resolveConfig(args, values.set, ctx.io);
  const version = packageVersionOf(ctx);
  // every point is validated before anything runs: one bad value must not waste a long scan
  const points: Point[] = [];
  const problems: string[] = [];
  grid.forEach((vals, index) => {
    let cfg: unknown = base.cfg;
    params.forEach((p, k) => { cfg = setPath(cfg, p.path, vals[k]); });
    const v = args['no-validate'] ? undefined : validateConfig(cfg);
    if (v && !v.ok) {
      const what = params.map((p, k) => `${p.path}=${fmtValue(vals[k])}`).join(', ');
      if (problems.length < 20) problems.push(`point ${index} (${what}):\n${v.issues.map((i) => `    ${formatIssue(i)}`).join('\n')}`);
      else if (problems.length === 20) problems.push('...');
    }
    points.push({ index, values: vals, cfg: cfg as ReactorConfig, fixedId: `p${index}` });
  });
  if (problems.length) throw new CliInputError(`the scan has invalid points:\n${problems.join('\n')}`);

  const keepSeries = args.series;
  const tasks: RunTask[] = points.map((p) => ({ id: p.fixedId, cfg: p.cfg, ...(keepSeries?.length ? { keepSeries } : {}) }));
  const onProgress = ctx.io.stderr.isTTY
    ? (p: PoolProgress) => {
      ctx.io.stderr.write(`\r  scan: ${p.done}/${p.total} points`.padEnd(40));
      if (p.done === p.total) ctx.io.stderr.write(`\r${' '.repeat(40)}\r`);
    }
    : undefined;
  const execute = ctx.deps.execute;
  let results: RunResult[];
  try {
    results = await execute(tasks, { threads: args.threads ?? defaultThreads(), timeoutMs: args.timeout === undefined ? undefined : args.timeout * 1000, onProgress });
  } catch (e) {
    if (e instanceof PoolAbortError) throw new CliFailure(e.message, 130);
    if (e instanceof PoolConfigError) throw new CliUsageError(e.message);
    throw e;
  }

  const rows: PointResult[] = points.map((p, i) => {
    const r = results[i];
    const seed = (p.cfg as { seed?: number }).seed ?? 0;
    const paramMap: Record<string, unknown> = Object.fromEntries(params.map((q, k) => [q.path, p.values[k]]));
    const fingerprint = runFingerprint(p.cfg, seed, [], version);
    if (!r || !r.ok || !r.report) return { index: i, params: paramMap, status: 'error', endReason: '', metrics: Object.fromEntries(metricPaths.map((m) => [m, NaN])), error: r?.error?.split('\n')[0] ?? 'no result', fingerprint };
    const run = { report: r.report, flatTop: r.avg ?? {}, burn: r.burn, cfg: p.cfg };
    return {
      index: i, params: paramMap, status: r.report.termination.natural ? 'ok' : 'ended', endReason: r.report.termination.reason,
      metrics: Object.fromEntries(metricPaths.map((m) => [m, readMetric(m, run)])), steps: r.steps, events: r.events,
      ...(r.series ? { series: r.series } : {}), fingerprint,
    };
  });

  switch (format) {
    case 'csv': {
      const table: (number | string)[][] = [[...params.map((p) => p.path), 'status', 'end_reason', ...metricPaths]];
      for (const row of rows) table.push([...params.map((p) => (typeof row.params[p.path] === 'number' ? (row.params[p.path] as number) : fmtValue(row.params[p.path]))), row.status, row.error ?? row.endReason, ...metricPaths.map((m) => row.metrics[m])]);
      emit(ctx.io, args.out, csvFromRows(table));
      break;
    }
    case 'json': {
      const doc = {
        schema: 1, tool: 'fusion-sim scan', provenance: provenanceBlock(ctx, base.cfg, base.preset),
        base: { preset: base.preset ?? null, config: base.cfg }, params: params.map((p) => ({ path: p.path, values: p.values })), metrics: metricPaths,
        points: rows,
      };
      emit(ctx.io, args.out, JSON.stringify(doc, null, args.indent) + '\n');
      break;
    }
    case 'ndjson':
      emit(ctx.io, args.out, rows.map((r) => jsonLine(r) + '\n').join(''));
      break;
  }
  const failed = rows.filter((r) => r.status === 'error');
  if (failed.length) {
    ctx.io.stderr.write(`fusion-sim scan: ${failed.length} of ${rows.length} points failed: ${failed.slice(0, 3).map((r) => `#${r.index} ${r.error}`).join('; ')}\n`);
    return 1;
  }
  return 0;
}

/** Runs the tasks in this process, one after another (the executor the tests use, and a fallback without threads). */
export const inProcessExecutor: Executor = async (tasks) => tasks.map((t): RunResult => {
  try {
    const r = runShot(t.cfg, { validate: false });
    const series = t.keepSeries?.length ? { t: r.sim.history.map((h) => h.t), ...Object.fromEntries(t.keepSeries.map((k) => [k, r.sim.history.map((h) => h.d[k] ?? NaN)])) } : undefined;
    return { id: t.id, ok: true, report: r.report, avg: r.flatTop, burn: r.burn, ...(series ? { series } : {}), steps: r.steps, events: r.events };
  } catch (e) {
    return { id: t.id, ok: false, error: (e as Error).message };
  }
});

