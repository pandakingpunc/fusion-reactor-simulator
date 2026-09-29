/**
 * Ensembles of simulated shots under uncertain parameters: the design (which configurations to run), the summary of
 * the outcomes (probabilities, quantiles, rank correlations, Sobol' indices) and the reports (JSON, CSV). Nothing here
 * runs a simulation: the runs are done by a {@link BatchRunner} (in-process: run.ts; on the worker pool:
 * node/ensembleRunner.ts), so the same design and summary serve the library, the CLI and the tests.
 *
 * Two analyses:
 *  - 'propagate': n runs at unit-cube points of the chosen sampler mapped through the priors; reports the probability of
 *    events (Q reaches the target, a disruption, the density exceeds the Greenwald limit), quantiles of the outputs
 *    with bootstrap intervals, and Spearman rank correlations of the outputs with the inputs.
 *  - 'sensitivity': the Saltelli design (n (d + 2) runs, see sensitivity.ts) for first-order and total Sobol' indices of
 *    the key outputs with bootstrap intervals; the rows of the A and B blocks (2 n independent samples) also serve as the
 *    propagation sample. Needs independent parameters.
 *
 * Definitions (all over the "valid" runs, those that did not fail with an error):
 *  - P(Q >= target): the shot ran to its scheduled end without a disruption AND its flat-top Q reached the target.
 *  - P(disruption): the shot had a disruption event.
 *  - P(n/n_G > 1): the flat-top mean (or, for the "any time" variant, the peak) of n_bar / n_Greenwald exceeds 1.
 *  - quantiles of the performance outputs (Q, P_fus, ...) are conditional on the shot having run to its scheduled end; the
 *    operating-point outputs (n/n_G, beta_N) are over all valid shots.
 *  - probabilities carry a Wilson score interval that treats the runs as independent draws (conservative for Sobol'
 *    and Latin hypercube designs).
 * The result is a snapshot of the model under stated priors, not a forecast (see {@link CAVEAT}).
 *
 * Pure TypeScript, no DOM or Node API.
 */
import type { FlatTopWeighting } from '../physics/analysis/flatTop';
import type { ReactorConfig } from '../physics/types';
import { canonicalString } from '../physics/kernel/canonical';
import { sha256Hex } from '../physics/kernel/sha256';
import { METRIC_INFO, METRIC_KEYS, MetricKey, OPERATING_METRICS, PERFORMANCE_METRICS, RunMetrics } from './metrics';
import { ParamSpec, PriorSet, checkPriors, describeParam, setPath, transformUnit } from './priors';
import { SamplerKind, SAMPLER_KINDS, mixSeed, unitSample } from './samplers';
import { SobolIndices, saltelliDesign, saltelliRuns, sobolIndices } from './sensitivity';
import { bootstrap, mean, quantileSorted, sd, sortedFinite, spearman, wilsonInterval } from './stats';

export const CAVEAT =
  'EDUCATIONAL: the results describe a reduced-order model (0D power balance or simplified 1.5D transport) under the stated priors. ' +
  'They illustrate how uncertainty propagates through it and which inputs matter most; they are not predictions of any real device, and the ' +
  'probabilities are conditional on the priors and on the model, whose structural errors are not part of them.';

export type Analysis = 'propagate' | 'sensitivity';
export type RunSeedMode = 'fixed' | 'perRow';
export type Comparison = '>=' | '<=' | '>' | '<';

/** an extra probability: the fraction of valid shots whose metric satisfies the comparison (performance metrics also need completion) */
export interface CustomProbability {
  metric: MetricKey;
  op: Comparison;
  value: number;
}

export interface EnsembleSpec {
  /** name of the preset, for the report */
  preset?: string;
  base: ReactorConfig;
  priors: PriorSet;
  /** shots (propagate) or base sample size of the Saltelli design (sensitivity) */
  n: number;
  sampler: SamplerKind;
  /** seed of the design (and of the bootstrap) */
  seed: number;
  analysis: Analysis;
  /** 'fixed': every run uses the configuration's own seed (default); 'perRow': each design row gets a seed derived from `seed`, so the ELM/jitter realisation varies as well */
  runSeed: RunSeedMode;
  /** override of the shot duration [s] */
  tEnd?: number;
  /** flat-top weighting of the metrics: 'frame' (default, the project's published definition) or 'time' */
  flatTop: FlatTopWeighting;
  /** Q target of the headline probability (default 10) */
  qTarget: number;
  probabilities: CustomProbability[];
  /** quantile levels reported (default 0.05, 0.16, 0.5, 0.84, 0.95) */
  quantileLevels: number[];
  /** bootstrap resamples for the intervals of quantiles and Sobol' indices (default 200; 0 = none) */
  bootstrap: number;
  /** confidence level of the intervals (default 0.95) */
  confidence: number;
  /** refuse designs with more runs than this (default 100000) */
  maxRuns: number;
}

export const DEFAULT_QUANTILES: readonly number[] = [0.05, 0.16, 0.5, 0.84, 0.95];

/** Fills in the defaults of a partial specification. */
export function resolveSpec(s: Partial<EnsembleSpec> & Pick<EnsembleSpec, 'base' | 'priors'>): EnsembleSpec {
  return {
    preset: s.preset, base: s.base, priors: s.priors, n: s.n ?? 64, sampler: s.sampler ?? 'sobol', seed: s.seed ?? 1,
    analysis: s.analysis ?? 'propagate', runSeed: s.runSeed ?? 'fixed', tEnd: s.tEnd, flatTop: s.flatTop ?? 'frame', qTarget: s.qTarget ?? 10,
    probabilities: s.probabilities ?? [], quantileLevels: s.quantileLevels ?? [...DEFAULT_QUANTILES], bootstrap: s.bootstrap ?? 200,
    confidence: s.confidence ?? 0.95, maxRuns: s.maxRuns ?? 100_000,
  };
}

/** One simulation to run. */
export interface SimTask {
  id: string;
  cfg: ReactorConfig;
  /** flat-top weighting of the metrics (default 'frame') */
  weighting?: FlatTopWeighting;
}

export type SimOutcome = { ok: true; metrics: RunMetrics } | { ok: false; error: string };

export interface EnsembleProgress {
  done: number;
  total: number;
  failed: number;
}

/** Runs the simulations of an ensemble; the outcomes come back in task order. */
export type BatchRunner = (tasks: SimTask[], onProgress?: (p: EnsembleProgress) => void) => Promise<SimOutcome[]>;

export interface EnsemblePlan {
  spec: EnsembleSpec;
  /** number of parameters */
  d: number;
  /** parameter paths, in column order */
  names: string[];
  /** number of runs */
  runs: number;
  /** parameter values, runs x d, row-major */
  values: Float64Array;
  /** the design is a Saltelli design (blocks A, B, AB_1 ... AB_d of n rows each) */
  saltelli: boolean;
  notes: string[];
  /** configuration of run `row` */
  config(row: number): ReactorConfig;
  tasks(): SimTask[];
  /** label of the block of run `row`: 'MC' for a propagation design, 'A', 'B', 'AB1' ... for a Saltelli design */
  block(row: number): string;
}

/** Number of runs an ensemble needs. */
export function ensembleRuns(analysis: Analysis, n: number, d: number): number {
  return analysis === 'sensitivity' ? saltelliRuns(n, d) : n;
}

/** Builds the design of an ensemble: samples the unit cube, maps it through the priors and prepares the configurations. */
export function planEnsemble(spec: EnsembleSpec): EnsemblePlan {
  const { base, priors, n, sampler, seed, analysis } = spec;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`the sample size must be a positive integer, got ${n}`);
  if (!SAMPLER_KINDS.includes(sampler)) throw new RangeError(`unknown sampler '${String(sampler)}' (${SAMPLER_KINDS.join(', ')})`);
  if (analysis !== 'propagate' && analysis !== 'sensitivity') throw new RangeError(`unknown analysis '${String(analysis)}'`);
  const d = priors.params.length;
  if (d < 1) throw new RangeError('an ensemble needs at least one uncertain parameter');
  checkPriors(base, priors);
  if (analysis === 'sensitivity' && (priors.correlations?.length ?? 0) > 0) {
    throw new RangeError('Sobol\' indices need independent parameters: remove the correlations or use the propagate analysis');
  }
  if (spec.tEnd !== undefined && !(spec.tEnd > 0 && Number.isFinite(spec.tEnd))) throw new RangeError(`tEnd must be a positive number, got ${spec.tEnd}`);
  const runs = ensembleRuns(analysis, n, d);
  if (runs > spec.maxRuns) throw new RangeError(`the design needs ${runs} runs, more than the limit of ${spec.maxRuns} (lower the sample size or raise the limit)`);
  const notes: string[] = [];
  if (sampler === 'sobol' && (n & (n - 1)) !== 0) notes.push(`n = ${n} is not a power of two: a Sobol' design keeps its balance properties only for n = 2^k`);
  let U: Float64Array;
  if (analysis === 'sensitivity') U = saltelliDesign(n, d, sampler, seed).U;
  else U = unitSample(sampler, n, d, { seed });
  const values = transformUnit(U, priors);
  const seedIndex = (row: number) => (analysis === 'sensitivity' ? row % n : row);
  const config = (row: number): ReactorConfig => {
    if (!Number.isInteger(row) || row < 0 || row >= runs) throw new RangeError(`run ${row} is outside the design (0 ... ${runs - 1})`);
    let c = base;
    for (let k = 0; k < d; k++) c = setPath(c, priors.params[k].path, values[row * d + k]);
    if (spec.tEnd !== undefined) c = { ...c, t_end: spec.tEnd } as ReactorConfig;
    if (spec.runSeed === 'perRow') c = { ...c, seed: mixSeed(seed, 0xa11ce + seedIndex(row)) } as ReactorConfig;
    return c;
  };
  return {
    spec, d, names: priors.params.map((p) => p.path), runs, values, saltelli: analysis === 'sensitivity', notes, config,
    tasks: () => Array.from({ length: runs }, (_, row) => ({ id: `r${row}`, cfg: config(row), weighting: spec.flatTop })),
    block: (row) => (analysis === 'sensitivity' ? (Math.floor(row / n) === 0 ? 'A' : Math.floor(row / n) === 1 ? 'B' : `AB${Math.floor(row / n) - 1}`) : 'MC'),
  };
}

// ---- summary -----------------------------------------------------------------------------------------------------

export interface Probability {
  id: string;
  definition: string;
  /** shots for which the event happened */
  k: number;
  /** valid shots */
  n: number;
  p: number;
  /** Wilson score interval */
  ci: [number, number];
}

export interface OutputSummary {
  /** shots the statistics are over */
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** quantile of level p, keyed 'p05', 'p16', 'p50', ... */
  quantiles: Record<string, number>;
  /** bootstrap interval of each quantile */
  quantileCI?: Record<string, [number, number]>;
}

export interface SensitivityTarget {
  metric: string;
  label: string;
  nUsed: number;
  mean: number;
  variance: number;
  indices: { path: string; S1: number; S1_ci?: [number, number]; ST: number; ST_ci?: [number, number] }[];
}

export interface EnsembleResult {
  schema: 1;
  tool: 'uq';
  caveat: string;
  inputHash: string;
  system: { preset?: string; method: string; fidelity: string; t_end_s: number; runSeed: RunSeedMode; flatTop: FlatTopWeighting };
  design: { analysis: Analysis; sampler: SamplerKind; seed: number; n: number; runs: number; confidence: number; bootstrap: number; notes: string[] };
  parameters: ReturnType<typeof describeParam>[];
  /** over the propagation sample: all runs of a propagate design, the A and B blocks of a Saltelli design */
  runs: { total: number; valid: number; failed: number; completed: number; disrupted: number; other: number; endReasons: Record<string, number>; failures: { run: number; error: string }[] };
  probabilities: Probability[];
  outputs: Record<string, OutputSummary>;
  operating: Record<string, OutputSummary>;
  rankCorrelation: Record<string, Record<string, number>>;
  sensitivity?: { estimator: { first: string; total: string }; runs: number; failedRuns: number; targets: SensitivityTarget[] };
}

/** label of a quantile level: 0.05 -> 'p05', 0.5 -> 'p50', 0.975 -> 'p97.5' */
export function quantileLabel(p: number): string {
  const pct = Math.round(p * 1e6) / 1e4;
  return `p${Number.isInteger(pct) && pct < 10 ? `0${pct}` : String(pct)}`;
}

/** targets of the Sobol' analysis: derived from the metrics of each run */
const SENSITIVITY_TARGETS: { metric: string; label: string; f: (m: Record<MetricKey, number>) => number }[] = [
  { metric: 'Q_flat', label: METRIC_INFO.Q_flat.label, f: (m) => m.Q_flat },
  { metric: 'Q_delivered', label: 'Q of shots that ran to the end (0 for a shot that ended early)', f: (m) => (m.completed ? m.Q_flat : 0) },
  { metric: 'Pfus_flat_MW', label: METRIC_INFO.Pfus_flat_MW.label, f: (m) => m.Pfus_flat_MW },
  { metric: 'nG_max', label: METRIC_INFO.nG_max.label, f: (m) => m.nG_max },
  { metric: 'betaN_max', label: METRIC_INFO.betaN_max.label, f: (m) => m.betaN_max },
  { metric: 'disrupted', label: METRIC_INFO.disrupted.label, f: (m) => m.disrupted },
];

function summarizeOutput(x: number[], levels: readonly number[], resamples: number, conf: number, seed: number): OutputSummary {
  const s = sortedFinite(x);
  const q: Record<string, number> = {};
  for (const p of levels) q[quantileLabel(p)] = quantileSorted(s, p);
  const out: OutputSummary = { n: s.length, mean: mean(s), sd: s.length > 1 ? sd(s) : NaN, min: s.length ? s[0] : NaN, max: s.length ? s[s.length - 1] : NaN, quantiles: q };
  if (resamples > 0 && s.length > 1) {
    const ci: Record<string, [number, number]> = {};
    levels.forEach((p, k) => { ci[quantileLabel(p)] = bootstrap(s, (r) => { const t = Float64Array.from(r).sort(); return quantileSorted(t, p); }, resamples, mixSeed(seed, 0xb00 + k), conf).ci; });
    out.quantileCI = ci;
  }
  return out;
}

function holds(v: number, op: Comparison, ref: number): boolean {
  return op === '>=' ? v >= ref : op === '<=' ? v <= ref : op === '>' ? v > ref : v < ref;
}

/** Summarises the outcomes of the runs of a plan (in run order). */
export function summarizeEnsemble(plan: EnsemblePlan, outcomes: readonly SimOutcome[]): EnsembleResult {
  const { spec, d, runs } = plan;
  if (outcomes.length !== runs) throw new RangeError(`expected ${runs} outcomes, got ${outcomes.length}`);
  const base = spec.base as { method: string; fidelity?: string; t_end?: number };
  const failures: { run: number; error: string }[] = [];
  const endReasons: Record<string, number> = {};
  const inSample = (row: number) => !plan.saltelli || row < 2 * spec.n; // propagation sample: all rows, or the A and B blocks
  const valid: { row: number; m: RunMetrics }[] = [];
  outcomes.forEach((o, row) => {
    if (!o.ok) { if (failures.length < 20) failures.push({ run: row, error: o.error.split('\n')[0] }); return; }
    if (inSample(row)) { endReasons[o.metrics.endReason] = (endReasons[o.metrics.endReason] ?? 0) + 1; valid.push({ row, m: o.metrics }); }
  });
  const total = plan.saltelli ? 2 * spec.n : runs;
  const failed = total - valid.length;
  const completed = valid.filter((v) => v.m.values.completed === 1);
  const disrupted = valid.filter((v) => v.m.values.disrupted === 1);
  const conf = spec.confidence;

  // probabilities
  const probs: Probability[] = [];
  const addProb = (id: string, definition: string, k: number) => {
    const n = valid.length;
    probs.push({ id, definition, k, n, p: n ? k / n : NaN, ci: wilsonInterval(k, n, conf) });
  };
  addProb(`Q>=${spec.qTarget}`, `the shot runs to its scheduled end without a disruption and its flat-top Q >= ${spec.qTarget}`,
    completed.filter((v) => v.m.values.Q_flat >= spec.qTarget).length);
  addProb('disruption', 'the shot has a disruption event', disrupted.length);
  addProb('n/nG>1 (flat top)', 'the flat-top mean of n_bar / n_Greenwald exceeds 1', valid.filter((v) => v.m.values.nG_flat > 1).length);
  addProb('n/nG>1 (any time)', 'the peak of n_bar / n_Greenwald over the shot exceeds 1', valid.filter((v) => v.m.values.nG_max > 1).length);
  for (const c of spec.probabilities) {
    const perf = PERFORMANCE_METRICS.includes(c.metric);
    const pool = perf ? completed : valid;
    addProb(`${c.metric}${c.op}${c.value}`, `${METRIC_INFO[c.metric].label} ${c.op} ${c.value}${perf ? ' for a shot that runs to its scheduled end' : ''}`,
      pool.filter((v) => holds(v.m.values[c.metric], c.op, c.value)).length);
  }

  // outputs
  const col = (rows: { m: RunMetrics }[], k: MetricKey) => rows.map((v) => v.m.values[k]);
  const outputs: Record<string, OutputSummary> = {};
  const operating: Record<string, OutputSummary> = {};
  PERFORMANCE_METRICS.forEach((k, i) => { const x = col(completed, k); if (x.some(Number.isFinite)) outputs[k] = summarizeOutput(x, spec.quantileLevels, spec.bootstrap, conf, mixSeed(spec.seed, 0x1000 + i)); });
  OPERATING_METRICS.forEach((k, i) => { const x = col(valid, k); if (x.some(Number.isFinite)) operating[k] = summarizeOutput(x, spec.quantileLevels, spec.bootstrap, conf, mixSeed(spec.seed, 0x2000 + i)); });

  // rank correlations of the inputs with the key outputs
  const rank: Record<string, Record<string, number>> = {};
  const rankOf = (metric: MetricKey, rows: { row: number; m: RunMetrics }[]) => {
    if (rows.length < 10) return;
    const y = rows.map((v) => v.m.values[metric]);
    if (!y.every(Number.isFinite)) return;
    const r: Record<string, number> = {};
    for (let k = 0; k < d; k++) {
      const rho = spearman(rows.map((v) => plan.values[v.row * d + k]), y);
      if (Number.isFinite(rho)) r[spec.priors.params[k].path] = rho;
    }
    if (Object.keys(r).length) rank[metric] = r;
  };
  rankOf('Q_flat', completed); rankOf('Pfus_flat_MW', completed);
  rankOf('nG_max', valid); rankOf('betaN_max', valid); rankOf('disrupted', valid);

  const result: EnsembleResult = {
    schema: 1, tool: 'uq', caveat: CAVEAT,
    inputHash: ensembleHash(spec),
    system: { ...(spec.preset ? { preset: spec.preset } : {}), method: base.method, fidelity: base.fidelity ?? '0D', t_end_s: spec.tEnd ?? base.t_end ?? NaN, runSeed: spec.runSeed, flatTop: spec.flatTop },
    design: { analysis: spec.analysis, sampler: spec.sampler, seed: spec.seed, n: spec.n, runs, confidence: conf, bootstrap: spec.bootstrap, notes: plan.notes },
    parameters: spec.priors.params.map((p) => describeParam(spec.base, p)),
    runs: {
      total, valid: valid.length, failed, completed: completed.length, disrupted: disrupted.length,
      other: valid.length - completed.length - disrupted.length, endReasons: sortKeys(endReasons), failures,
    },
    probabilities: probs, outputs, operating, rankCorrelation: rank,
  };

  if (plan.saltelli) {
    const targets: SensitivityTarget[] = SENSITIVITY_TARGETS.map((t) => {
      const y = new Float64Array(runs);
      outcomes.forEach((o, row) => { y[row] = o.ok ? t.f(o.metrics.values) : NaN; });
      const idx = sobolIndices(y, spec.n, d, { resamples: spec.bootstrap, level: conf, seed: mixSeed(spec.seed, 0x3000) });
      return toTarget(t.metric, t.label, idx, spec.priors.params, spec.bootstrap > 0);
    });
    result.sensitivity = { estimator: { first: 'saltelli2010', total: 'jansen' }, runs, failedRuns: outcomes.filter((o) => !o.ok).length, targets };
  }
  return result;
}

function toTarget(metric: string, label: string, idx: SobolIndices, params: readonly ParamSpec[], ci: boolean): SensitivityTarget {
  return {
    metric, label, nUsed: idx.nUsed, mean: idx.mean, variance: idx.variance,
    indices: params.map((p, i) => ({
      path: p.path, S1: idx.first[i], ...(ci && idx.firstCI ? { S1_ci: idx.firstCI[i] } : {}), ST: idx.total[i], ...(ci && idx.totalCI ? { ST_ci: idx.totalCI[i] } : {}),
    })),
  };
}

function sortKeys(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** SHA-256 of the canonical form of everything that defines an ensemble: the same inputs give the same hash. */
export function ensembleHash(spec: EnsembleSpec): string {
  const { base, priors, n, sampler, seed, analysis, runSeed, tEnd, flatTop, qTarget, probabilities, quantileLevels, bootstrap: b, confidence } = spec;
  return sha256Hex(canonicalString({ base, priors, n, sampler, seed, analysis, runSeed, tEnd: tEnd ?? null, flatTop, qTarget, probabilities, quantileLevels, bootstrap: b, confidence }));
}

// ---- reports -----------------------------------------------------------------------------------------------------

/** JSON text of a result: two-space indent, non-finite numbers as null, trailing newline. Same result, same bytes. */
export function toJson(result: unknown): string {
  return JSON.stringify(result, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2) + '\n';
}

const csvCell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csvNum = (v: number): string => (Number.isFinite(v) ? String(v) : '');

/** One row per run: run index, block, the parameter values, the metrics and the end reason (or the error of a failed run). */
export function toCsv(plan: Pick<EnsemblePlan, 'd' | 'names' | 'values' | 'block'>, outcomes: readonly SimOutcome[]): string {
  const { d } = plan;
  const head = ['run', 'block', ...plan.names, ...METRIC_KEYS, 'end_reason'];
  const lines = [head.map(csvCell).join(',')];
  outcomes.forEach((o, row) => {
    const cells = [String(row), plan.block(row)];
    for (let k = 0; k < d; k++) cells.push(csvNum(plan.values[row * d + k]));
    if (o.ok) { for (const k of METRIC_KEYS) cells.push(csvNum(o.metrics.values[k])); cells.push(csvCell(o.metrics.endReason)); }
    else { for (const _k of METRIC_KEYS) cells.push(''); cells.push(csvCell(`FAILED: ${o.error.split('\n')[0]}`)); }
    lines.push(cells.join(','));
  });
  return lines.join('\n') + '\n';
}

/** Plans, runs and summarises an ensemble. */
export async function runEnsemble(spec: EnsembleSpec, runner: BatchRunner, onProgress?: (p: EnsembleProgress) => void): Promise<{ plan: EnsemblePlan; outcomes: SimOutcome[]; result: EnsembleResult }> {
  const plan = planEnsemble(spec);
  const outcomes = await runner(plan.tasks(), onProgress);
  return { plan, outcomes, result: summarizeEnsemble(plan, outcomes) };
}

