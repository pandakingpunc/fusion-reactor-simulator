/**
 * Small statistics toolbox for the UQ and optimisation code: moments, sample quantiles, rank correlation, the Wilson
 * interval for a probability, and the percentile bootstrap. Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../physics/rng';
import { normalQuantile } from './distributions';

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : NaN;
}

/** Sample variance with divisor n - ddof (default 1); NaN for fewer than ddof + 1 values. */
export function variance(x: ArrayLike<number>, ddof = 1): number {
  const n = x.length;
  if (n <= ddof) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - m) * (x[i] - m);
  return s / (n - ddof);
}

export function sd(x: ArrayLike<number>, ddof = 1): number {
  return Math.sqrt(variance(x, ddof));
}

/**
 * Sample quantile of the sorted values `s` at probability p, by linear interpolation between order statistics
 * (Hyndman & Fan 1996, Am. Stat. 50, 361, definition 7: the default of R and NumPy): h = (n - 1) p.
 */
export function quantileSorted(s: ArrayLike<number>, p: number): number {
  const n = s.length;
  if (n === 0) return NaN;
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile probability must be in [0, 1], got ${p}`);
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

/** Sorted copy (ascending; NaN removed). */
export function sortedFinite(x: ArrayLike<number>): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) out.push(x[i]);
  const a = Float64Array.from(out);
  a.sort();
  return a;
}

/** Quantiles of several probabilities in one sort. NaN values in x are ignored. */
export function quantiles(x: ArrayLike<number>, ps: readonly number[]): number[] {
  const s = sortedFinite(x);
  return ps.map((p) => quantileSorted(s, p));
}

/**
 * Wilson score interval for a binomial proportion k/n (E. B. Wilson, J. Am. Stat. Assoc. 22 (1927) 209): unlike the
 * normal approximation it stays inside [0, 1] and is sensible for k = 0 or k = n. `level` is the confidence level.
 */
export function wilsonInterval(k: number, n: number, level = 0.95): [number, number] {
  if (!(n > 0)) return [NaN, NaN];
  const z = normalQuantile(0.5 + level / 2);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Average ranks (1-based; ties share the mean of their positions). */
export function ranks(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[idx[j + 1]] === x[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation coefficient; NaN if either sample is constant or they differ in length. */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  if (n !== y.length || n < 2) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Spearman rank correlation (Pearson correlation of the average ranks). */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  return pearson(ranks(x), ranks(y));
}

export interface BootstrapResult {
  /** the statistic of the original sample */
  estimate: number;
  /** percentile interval at the requested level */
  ci: [number, number];
  /** standard deviation of the resampled statistics */
  sd: number;
}

/**
 * Percentile bootstrap (B. Efron, Ann. Stat. 7 (1979) 1) of a scalar statistic of one sample: `resamples` samples of
 * the same size are drawn with replacement, the interval is the (1 - level)/2 and (1 + level)/2 quantiles of the
 * statistic over them. Deterministic for a given seed.
 */
export function bootstrap(x: ArrayLike<number>, statistic: (sample: Float64Array) => number, resamples: number, seed: number, level = 0.95): BootstrapResult {
  const n = x.length;
  const orig = Float64Array.from(x);
  const estimate = statistic(orig);
  if (n === 0 || resamples < 1) return { estimate, ci: [NaN, NaN], sd: NaN };
  const rng = new RNG(seed);
  const buf = new Float64Array(n);
  const stats = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) buf[i] = orig[Math.floor(rng.next() * n)];
    stats[b] = statistic(buf);
  }
  const s = sortedFinite(stats);
  return { estimate, ci: [quantileSorted(s, (1 - level) / 2), quantileSorted(s, (1 + level) / 2)], sd: sd(s) };
}
