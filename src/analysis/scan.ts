/**
 * Parameter scans: run a configuration over a set of parameter values and tabulate the outputs. Unlike an ensemble
 * (ensemble.ts) a scan has no probabilistic content: the values are chosen, not drawn from priors, and the result is the
 * table itself.
 *
 *  - grid:    every combination of `points` values per axis (linear or logarithmic spacing between lo and hi), last axis
 *             fastest;
 *  - sampled: `points` points of a space-filling design ('sobol', 'lhs' or 'mc') in the box [lo, hi]^d (log-uniform along
 *             a logarithmic axis) - for more than two or three parameters, where a grid is too expensive.
 * Every run uses the configuration's own seed unless `runSeed` is given, so a scan is deterministic; the outcomes are
 * the {@link RunMetrics} of metrics.ts (flat-top and peak Q, P_fus, n/n_G, beta_N, disruption flags).
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { canonicalString } from '../physics/kernel/canonical';
import { sha256Hex } from '../physics/kernel/sha256';
import type { FlatTopWeighting } from '../physics/analysis/flatTop';
import type { ReactorConfig } from '../physics/types';
import { CAVEAT, SimOutcome, SimTask } from './ensemble';
import type { MetricKey } from './metrics';
import { paramStatus, setPath } from './priors';
import { SAMPLER_KINDS, SamplerKind, unitSample } from './samplers';

export interface ScanAxis {
  path: string;
  lo: number;
  hi: number;
  /** grid points along this axis (grid mode; >= 1) */
  points?: number;
  /** logarithmic spacing (needs lo > 0) */
  log?: boolean;
}

export type ScanMode = 'grid' | SamplerKind;

export interface ScanSpec {
  preset?: string;
  base: ReactorConfig;
  axes: ScanAxis[];
  mode: ScanMode;
  /** number of points of a sampled scan */
  points?: number;
  /** seed of a sampled design */
  seed: number;
  /** override of the configuration's own seed for every run */
  runSeed?: number;
  tEnd?: number;
  /** flat-top weighting of the metrics (default 'time') */
  flatTop?: FlatTopWeighting;
  maxRuns: number;
}

export interface ScanPlan {
  spec: ScanSpec;
  d: number;
  names: string[];
  runs: number;
  /** parameter values, runs x d, row-major */
  values: Float64Array;
  /** the values along each axis (grid mode; the sampled design has none) */
  axisValues: number[][] | null;
  config(row: number): ReactorConfig;
  tasks(): SimTask[];
  block(row: number): string;
}

/** n values from lo to hi, linearly or logarithmically spaced; a single value is lo. */
export function spacing(lo: number, hi: number, n: number, log = false): number[] {
  if (n === 1) return [lo];
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return hi; // exact end point
    const f = i / (n - 1);
    return log ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo);
  });
}

export function planScan(spec: ScanSpec): ScanPlan {
  const { base, axes, mode } = spec;
  const d = axes.length;
  if (d < 1) throw new RangeError('a scan needs at least one parameter');
  const seen = new Set<string>();
  for (const a of axes) {
    if (seen.has(a.path)) throw new RangeError(`parameter '${a.path}' is listed twice`);
    seen.add(a.path);
    if (!paramStatus(base, a.path).ok) throw new RangeError(`parameter '${a.path}' is not a number of the ${base.method} configuration`);
    if (!Number.isFinite(a.lo) || !Number.isFinite(a.hi)) throw new RangeError(`${a.path}: the limits must be finite numbers`);
    if (a.hi < a.lo) throw new RangeError(`${a.path}: hi (${a.hi}) is below lo (${a.lo})`);
    if (a.log && !(a.lo > 0)) throw new RangeError(`${a.path}: a logarithmic axis needs lo > 0`);
  }
  if (mode !== 'grid' && !SAMPLER_KINDS.includes(mode)) throw new RangeError(`unknown scan mode '${String(mode)}' (grid, ${SAMPLER_KINDS.join(', ')})`);
  if (spec.tEnd !== undefined && !(spec.tEnd > 0 && Number.isFinite(spec.tEnd))) throw new RangeError(`tEnd must be a positive number, got ${spec.tEnd}`);
  let values: Float64Array, axisValues: number[][] | null = null, runs: number;
  if (mode === 'grid') {
    axisValues = axes.map((a) => {
      const n = a.points ?? 5;
      if (!Number.isInteger(n) || n < 1) throw new RangeError(`${a.path}: the number of grid points must be a positive integer, got ${n}`);
      return spacing(a.lo, a.hi, n, a.log);
    });
    runs = axisValues.reduce((p, v) => p * v.length, 1);
    if (runs > spec.maxRuns) throw new RangeError(`the grid has ${runs} points, more than the limit of ${spec.maxRuns} (fewer points or a higher limit)`);
    values = new Float64Array(runs * d);
    for (let r = 0; r < runs; r++) {
      let rem = r;
      for (let k = d - 1; k >= 0; k--) { const n = axisValues[k].length; values[r * d + k] = axisValues[k][rem % n]; rem = Math.floor(rem / n); }
    }
  } else {
    const n = spec.points;
    if (n === undefined || !Number.isInteger(n) || n < 1) throw new RangeError(`a sampled scan needs a positive integer number of points, got ${String(n)}`);
    runs = n;
    if (runs > spec.maxRuns) throw new RangeError(`the scan has ${runs} points, more than the limit of ${spec.maxRuns}`);
    const U = unitSample(mode, n, d, { seed: spec.seed });
    values = new Float64Array(n * d);
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < d; k++) {
        const a = axes[k], u = U[r * d + k];
        values[r * d + k] = a.log ? a.lo * Math.pow(a.hi / a.lo, u) : a.lo + u * (a.hi - a.lo);
      }
    }
  }
  const config = (row: number): ReactorConfig => {
    if (!Number.isInteger(row) || row < 0 || row >= runs) throw new RangeError(`run ${row} is outside the scan (0 ... ${runs - 1})`);
    let c = base;
    for (let k = 0; k < d; k++) c = setPath(c, axes[k].path, values[row * d + k], { createMissing: true });
    if (spec.tEnd !== undefined) c = { ...c, t_end: spec.tEnd } as ReactorConfig;
    if (spec.runSeed !== undefined) c = { ...c, seed: spec.runSeed } as ReactorConfig;
    return c;
  };
  return {
    spec, d, names: axes.map((a) => a.path), runs, values, axisValues, config,
    tasks: () => Array.from({ length: runs }, (_, row) => ({ id: `s${row}`, cfg: config(row), weighting: spec.flatTop ?? 'time' })),
    block: () => (mode === 'grid' ? 'grid' : mode),
  };
}

export interface ScanPoint {
  index: number;
  values: Record<string, number>;
  /** absent for a failed run */
  metrics: Record<MetricKey, number> | null;
  endReason: string;
  error?: string;
}

export interface ScanResult {
  schema: 1;
  tool: 'scan';
  caveat: string;
  inputHash: string;
  system: { preset?: string; method: string; fidelity: string; t_end_s: number; runSeed: number | 'preset'; flatTop: FlatTopWeighting };
  design: { mode: ScanMode; points: number; seed: number | null; notes: string[] };
  axes: { path: string; lo: number; hi: number; log: boolean; nominal: number | null; points?: number; values?: number[] }[];
  runs: { total: number; valid: number; failed: number; completed: number; disrupted: number };
  points: ScanPoint[];
}

export function scanHash(spec: ScanSpec): string {
  const { base, axes, mode, points, seed, runSeed, tEnd, flatTop } = spec;
  return sha256Hex(canonicalString({ base, axes, mode, points: points ?? null, seed: mode === 'grid' ? null : seed, runSeed: runSeed ?? null, tEnd: tEnd ?? null, flatTop: flatTop ?? 'time' }));
}

export function summarizeScan(plan: ScanPlan, outcomes: readonly SimOutcome[]): ScanResult {
  const { spec, d, runs } = plan;
  if (outcomes.length !== runs) throw new RangeError(`expected ${runs} outcomes, got ${outcomes.length}`);
  const base = spec.base as { method: string; fidelity?: string; t_end?: number };
  const points: ScanPoint[] = outcomes.map((o, index) => {
    const values: Record<string, number> = {};
    for (let k = 0; k < d; k++) values[plan.names[k]] = plan.values[index * d + k];
    return o.ok
      ? { index, values, metrics: { ...o.metrics.values }, endReason: o.metrics.endReason }
      : { index, values, metrics: null, endReason: 'FAILED', error: o.error.split('\n')[0] };
  });
  const okPts = points.filter((p) => p.metrics !== null);
  return {
    schema: 1, tool: 'scan', caveat: CAVEAT, inputHash: scanHash(spec),
    system: { ...(spec.preset ? { preset: spec.preset } : {}), method: base.method, fidelity: base.fidelity ?? '0D', t_end_s: spec.tEnd ?? base.t_end ?? NaN, runSeed: spec.runSeed ?? 'preset', flatTop: spec.flatTop ?? 'time' },
    design: { mode: spec.mode, points: runs, seed: spec.mode === 'grid' ? null : spec.seed, notes: spec.mode === 'sobol' && spec.points !== undefined && (spec.points & (spec.points - 1)) !== 0 ? [`points = ${spec.points} is not a power of two: a Sobol' design keeps its balance properties only for 2^k points`] : [] },
    axes: spec.axes.map((a, k) => {
      const st = paramStatus(spec.base, a.path);
      return { path: a.path, lo: a.lo, hi: a.hi, log: !!a.log, nominal: st.ok ? st.nominal : null, ...(plan.axisValues ? { points: plan.axisValues[k].length, values: plan.axisValues[k] } : {}) };
    }),
    runs: {
      total: runs, valid: okPts.length, failed: runs - okPts.length,
      completed: okPts.filter((p) => p.metrics!.completed === 1).length, disrupted: okPts.filter((p) => p.metrics!.disrupted === 1).length,
    },
    points,
  };
}

