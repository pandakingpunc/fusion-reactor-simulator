/**
 * Variance-based global sensitivity analysis: Sobol' first-order and total-effect indices from the Saltelli design,
 * with bootstrap confidence intervals.
 *
 * Design (A. Saltelli, P. Annoni, I. Azzini, F. Campolongo, M. Ratto & S. Tarantola, "Variance based sensitivity
 * analysis of model output. Design and estimator for the total sensitivity index", Comput. Phys. Commun. 181 (2010)
 * 259-270). Two independent n x d matrices A and B are drawn (here as the two halves of one 2d-dimensional
 * sample, so that a scrambled Sobol' sequence keeps its low discrepancy) and, for every parameter i, the matrix
 * AB_i equals A except that column i is taken from B. The model is run on the (d + 2) n rows in the order
 * A, B, AB_1, ..., AB_d (block k occupies rows k n ... (k+1) n - 1).
 *
 * Estimators, with Var the variance and f0 the mean of the pooled outputs f(A) and f(B), all sums over the n rows j:
 *   first-order S_i, 'saltelli' (Saltelli et al. 2010, eq. (b) of table 2):  (1/n) Σ f(B)_j (f(AB_i)_j - f(A)_j) / Var
 *   first-order S_i, 'jansen'   (M. J. W. Jansen 1999, Comput. Phys. Commun. 117, 35):  1 - (1/2n) Σ (f(B)_j - f(AB_i)_j)^2 / Var
 *   total ST_i, 'jansen'  (default; Jansen 1999, recommended by Saltelli et al. 2010): (1/2n) Σ (f(A)_j - f(AB_i)_j)^2 / Var
 *   total ST_i, 'sobol'   (Sobol' 2001, Math. Comput. Simul. 55, 271; Saltelli et al. 2010, table 2):  1 - ((1/n) Σ f(A)_j f(AB_i)_j - f0^2) / Var
 * S_i is the fraction of the output variance that varies with parameter i alone, ST_i the fraction that involves i at
 * all (main effect plus every interaction); ST_i >= S_i, and a large gap flags interactions.
 *
 * Confidence intervals: the n rows are resampled with replacement (the same rows for every block), all indices are
 * recomputed, and the (1 - level)/2 and (1 + level)/2 percentiles are reported (percentile bootstrap, Efron 1979). The
 * resampling treats the rows as independent draws, which they are for 'mc'; for a Sobol' or Latin hypercube design the
 * rows are better than independent, so the intervals are conservative (wider than the true error).
 *
 * Rows for which any of the (d + 2) outputs is not finite (a failed run) are dropped as a whole; nUsed reports how many
 * remain.
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../physics/rng';
import { DistSpec, quantile } from './distributions';
import { SamplerKind, mixSeed, unitSample } from './samplers';
import { quantileSorted, sortedFinite } from './stats';

export type FirstOrderEstimator = 'saltelli' | 'jansen';
export type TotalEstimator = 'jansen' | 'sobol';

export interface SaltelliDesign {
  n: number;
  d: number;
  /** unit-cube rows in evaluation order A, B, AB_1 ... AB_d: (d + 2) n rows of d columns, row-major */
  U: Float64Array;
}

/** Number of model runs of a Saltelli design: n (d + 2). */
export function saltelliRuns(n: number, d: number): number {
  return n * (d + 2);
}

/**
 * The Saltelli design in the unit cube: A and B are the first and last d columns of a 2d-dimensional sample of n points
 * (kind 'sobol': scrambled Sobol', use a power of two for n).
 */
export function saltelliDesign(n: number, d: number, kind: SamplerKind = 'sobol', seed = 1): SaltelliDesign {
  if (!Number.isInteger(d) || d < 1) throw new RangeError(`the number of parameters must be a positive integer, got ${d}`);
  const P = unitSample(kind, n, 2 * d, { seed });
  const U = new Float64Array(saltelliRuns(n, d) * d);
  const row = (block: number, j: number) => (block * n + j) * d;
  for (let j = 0; j < n; j++) {
    for (let c = 0; c < d; c++) {
      const a = P[j * 2 * d + c], b = P[j * 2 * d + d + c];
      U[row(0, j) + c] = a;
      U[row(1, j) + c] = b;
      for (let i = 0; i < d; i++) U[row(2 + i, j) + c] = c === i ? b : a;
    }
  }
  return { n, d, U };
}

export interface IndexEstimate {
  /** S_i for every parameter */
  first: number[];
  /** ST_i for every parameter */
  total: number[];
}

export interface SobolIndices extends IndexEstimate {
  /** rows used (n minus the rows dropped for non-finite outputs) */
  nUsed: number;
  /** mean and variance of the pooled outputs f(A), f(B) */
  mean: number;
  variance: number;
  /** bootstrap results, present when resamples > 0 */
  firstCI?: [number, number][];
  totalCI?: [number, number][];
  firstSd?: number[];
  totalSd?: number[];
  level?: number;
  resamples?: number;
}

export interface IndexOptions {
  first?: FirstOrderEstimator;
  total?: TotalEstimator;
  /** bootstrap resamples (default 200; 0 = none) */
  resamples?: number;
  /** confidence level of the intervals (default 0.95) */
  level?: number;
  /** seed of the bootstrap (default 1) */
  seed?: number;
}

/** the n x (d + 2) outputs of the used rows, by block */
function pick(y: ArrayLike<number>, n: number, d: number): { rows: number[]; blocks: Float64Array[] } {
  const rows: number[] = [];
  for (let j = 0; j < n; j++) {
    let ok = true;
    for (let b = 0; b < d + 2 && ok; b++) if (!Number.isFinite(y[b * n + j])) ok = false;
    if (ok) rows.push(j);
  }
  const blocks: Float64Array[] = [];
  for (let b = 0; b < d + 2; b++) {
    const a = new Float64Array(rows.length);
    for (let k = 0; k < rows.length; k++) a[k] = y[b * n + rows[k]];
    blocks.push(a);
  }
  return { rows, blocks };
}

/** the estimators on the rows `idx` of the blocks (all rows when idx is null) */
function estimate(blocks: Float64Array[], d: number, m: number, idx: Int32Array | null, fo: FirstOrderEstimator, to: TotalEstimator): IndexEstimate & { mean: number; variance: number } {
  const fA = blocks[0], fB = blocks[1];
  const at = (a: Float64Array, k: number) => a[idx ? idx[k] : k];
  let sum = 0;
  for (let k = 0; k < m; k++) sum += at(fA, k) + at(fB, k);
  const mean = sum / (2 * m);
  let ss = 0;
  for (let k = 0; k < m; k++) { const a = at(fA, k) - mean, b = at(fB, k) - mean; ss += a * a + b * b; }
  const variance = ss / (2 * m);
  const first: number[] = [], total: number[] = [];
  for (let i = 0; i < d; i++) {
    const fAB = blocks[2 + i];
    let sB = 0, sJ1 = 0, sJT = 0, sAA = 0;
    for (let k = 0; k < m; k++) {
      const a = at(fA, k), b = at(fB, k), ab = at(fAB, k);
      sB += b * (ab - a);
      sJ1 += (b - ab) * (b - ab);
      sJT += (a - ab) * (a - ab);
      sAA += a * ab;
    }
    first.push(variance > 0 ? (fo === 'saltelli' ? sB / m : variance - sJ1 / (2 * m)) / variance : NaN);
    total.push(variance > 0 ? (to === 'jansen' ? sJT / (2 * m) : variance - (sAA / m - mean * mean)) / variance : NaN);
  }
  return { first, total, mean, variance };
}

/**
 * Sobol' indices from the outputs y of a Saltelli design (length (d + 2) n, in the row order of
 * {@link saltelliDesign}), with bootstrap confidence intervals.
 */
export function sobolIndices(y: ArrayLike<number>, n: number, d: number, opts: IndexOptions = {}): SobolIndices {
  if (y.length !== n * (d + 2)) throw new RangeError(`expected ${n * (d + 2)} outputs (n = ${n}, d = ${d}), got ${y.length}`);
  const fo = opts.first ?? 'saltelli', to = opts.total ?? 'jansen';
  const level = opts.level ?? 0.95;
  const B = opts.resamples ?? 200;
  const { rows, blocks } = pick(y, n, d);
  const m = rows.length;
  if (m < 2) return { first: new Array(d).fill(NaN), total: new Array(d).fill(NaN), nUsed: m, mean: NaN, variance: NaN };
  const est = estimate(blocks, d, m, null, fo, to);
  const out: SobolIndices = { first: est.first, total: est.total, nUsed: m, mean: est.mean, variance: est.variance };
  if (B > 0) {
    const rng = new RNG(mixSeed(opts.seed ?? 1, 0x5eed));
    const idx = new Int32Array(m);
    const firsts: Float64Array[] = Array.from({ length: d }, () => new Float64Array(B));
    const totals: Float64Array[] = Array.from({ length: d }, () => new Float64Array(B));
    for (let b = 0; b < B; b++) {
      for (let k = 0; k < m; k++) idx[k] = Math.floor(rng.next() * m);
      const e = estimate(blocks, d, m, idx, fo, to);
      for (let i = 0; i < d; i++) { firsts[i][b] = e.first[i]; totals[i][b] = e.total[i]; }
    }
    const summarize = (a: Float64Array): { ci: [number, number]; sd: number } => {
      const s = sortedFinite(a);
      let mu = 0;
      for (const v of s) mu += v;
      mu /= s.length;
      let vv = 0;
      for (const v of s) vv += (v - mu) * (v - mu);
      return { ci: [quantileSorted(s, (1 - level) / 2), quantileSorted(s, (1 + level) / 2)], sd: Math.sqrt(vv / Math.max(s.length - 1, 1)) };
    };
    const F = firsts.map(summarize), T = totals.map(summarize);
    out.firstCI = F.map((r) => r.ci); out.firstSd = F.map((r) => r.sd);
    out.totalCI = T.map((r) => r.ci); out.totalSd = T.map((r) => r.sd);
    out.level = level; out.resamples = B;
  }
  return out;
}

/** Maps the unit-cube rows to parameter values, column by column, through the quantile functions of `dists`. */
export function mapUnitToParams(U: Float64Array, dists: readonly DistSpec[]): Float64Array {
  const d = dists.length;
  const out = new Float64Array(U.length);
  for (let i = 0; i < U.length; i += d) for (let c = 0; c < d; c++) out[i + c] = quantile(dists[c], U[i + c]);
  return out;
}

export interface FunctionSobolOptions extends IndexOptions {
  sampler?: SamplerKind;
  /** seed of the design (default 1) */
  designSeed?: number;
}

/**
 * Sobol' indices of a plain function of independent parameters: builds the Saltelli design of n rows, evaluates f on
 * the (d + 2) n rows and estimates the indices. A convenience for cheap models and for verifying the estimators.
 */
export function sobolIndicesOfFunction(f: (x: Float64Array) => number, dists: readonly DistSpec[], n: number, opts: FunctionSobolOptions = {}): SobolIndices {
  const d = dists.length;
  const design = saltelliDesign(n, d, opts.sampler ?? 'sobol', opts.designSeed ?? 1);
  const X = mapUnitToParams(design.U, dists);
  const rows = saltelliRuns(n, d);
  const y = new Float64Array(rows);
  const x = new Float64Array(d);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < d; c++) x[c] = X[r * d + c];
    y[r] = f(x);
  }
  return sobolIndices(y, n, d, opts);
}
