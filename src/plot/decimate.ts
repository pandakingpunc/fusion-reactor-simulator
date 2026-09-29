/**
 * Min/max decimation of long time series that keeps the frames around events.
 *
 * A series of n samples is cut into B time buckets; from every bucket the first and last sample and,
 * for each plotted series, the lowest and highest one are kept (the "M4" aggregation of Jugel, Jerzak,
 * Hackenbroich & Markl, "M4: A visualization-oriented time series data aggregation", Proc. VLDB
 * Endowment 7(10), 797-808, 2014). The drawn envelope of every series is then that of the full data
 * whenever a bucket is not wider than a pixel column of the plot. Two kinds of samples are kept in
 * addition, whatever the budget: the samples next to every event time (a crash, a transition), so that
 * a mark or a vertical line at an event sits on a data point and the jump across it is not smoothed
 * away, and the samples on either side of a gap (a NaN run), so that gaps stay where they were.
 *
 * The draw-time decimation of a polyline in device space is `decimateMinMax` in figure.ts; this module
 * thins the data before it is plotted (memory, export of very long histories).
 */
import type { HistoryFrame, SimEvent } from '../physics/types';

export interface DecimateOptions {
  /** target number of samples (default 4000, at least 16); event and gap samples come on top of it */
  maxPoints?: number;
  /** times whose neighbouring samples are always kept (e.g. the event times) */
  keepTimes?: readonly number[];
  /** indices that are always kept */
  keepIndices?: Iterable<number>;
}

export const DEFAULT_MAX_POINTS = 4000;

/** first index i with t[i] >= x (t non-decreasing) */
function lowerBound(t: ArrayLike<number>, x: number): number {
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Indices (ascending) of the samples kept from `t` and the plotted `series` (all of length n).
 * Series shorter than n or with non-finite entries are allowed: a non-finite value is never a
 * minimum or maximum, and the samples around a change between finite and non-finite are kept.
 * When t is not non-decreasing (a series that was rewound) the buckets are cut by index instead of time.
 */
export function decimateIndices(t: ArrayLike<number>, series: readonly ArrayLike<number>[], o: DecimateOptions = {}): number[] {
  const n = t.length;
  const max = Math.max(16, Math.floor(o.maxPoints ?? DEFAULT_MAX_POINTS));
  if (n <= max) return Array.from({ length: n }, (_, i) => i);

  const keep = new Set<number>([0, n - 1]);
  for (const i of o.keepIndices ?? []) if (i >= 0 && i < n) keep.add(Math.floor(i));
  let monotone = true;
  for (let i = 1; i < n; i++) if (!(t[i] >= t[i - 1])) { monotone = false; break; }

  // samples next to gaps
  for (const s of series) {
    for (let i = 1; i < n; i++) if (Number.isFinite(s[i]) !== Number.isFinite(s[i - 1])) { keep.add(i); keep.add(i - 1); }
  }
  // samples next to the events (needs a time axis; on a rewound one the nearest-in-time search is skipped)
  if (monotone) {
    for (const te of o.keepTimes ?? []) {
      if (!Number.isFinite(te)) continue;
      const j = lowerBound(t, te);
      if (j > 0) keep.add(j - 1);
      if (j < n) keep.add(j);
    }
  }

  const per = 2 + 2 * series.length;
  const B = Math.max(1, Math.floor((max - keep.size) / per));
  const t0 = t[0], span = t[n - 1] - t0;
  const bucket = (i: number) => {
    const u = monotone && span > 0 ? (t[i] - t0) / span : i / n;
    return Math.min(B - 1, Math.max(0, Math.floor(u * B)));
  };
  let cur = -1, first = -1, last = -1;
  let lo = new Array<number>(series.length).fill(-1), hi = new Array<number>(series.length).fill(-1);
  const flush = () => {
    if (first < 0) return;
    keep.add(first); keep.add(last);
    for (let k = 0; k < series.length; k++) { if (lo[k] >= 0) keep.add(lo[k]); if (hi[k] >= 0) keep.add(hi[k]); }
  };
  for (let i = 0; i < n; i++) {
    const b = bucket(i);
    if (b !== cur) { flush(); cur = b; first = i; lo = lo.map(() => -1); hi = hi.map(() => -1); }
    last = i;
    for (let k = 0; k < series.length; k++) {
      const v = series[k][i];
      if (!Number.isFinite(v)) continue;
      if (lo[k] < 0 || v < series[k][lo[k]]) lo[k] = i;
      if (hi[k] < 0 || v > series[k][hi[k]]) hi[k] = i;
    }
  }
  flush();
  return [...keep].sort((a, b) => a - b);
}

export interface DecimateFramesOptions extends DecimateOptions {
  /** frames that are always kept (e.g. those that carry a profile or an equilibrium snapshot) */
  alwaysKeep?: (frame: HistoryFrame, index: number) => boolean;
}

/**
 * The frames that remain after min/max decimation with respect to the diagnostics `keys`, keeping the
 * frames next to `events` (all of them, or those the caller passes). Frames are returned as they are
 * (not copied), in their original order; a history that is short enough is returned unchanged.
 */
export function decimateFrames(frames: readonly HistoryFrame[], keys: readonly string[], events: readonly SimEvent[] = [], o: DecimateFramesOptions = {}): HistoryFrame[] {
  const max = Math.max(16, Math.floor(o.maxPoints ?? DEFAULT_MAX_POINTS));
  if (frames.length <= max) return frames.slice();
  const t = frames.map((f) => f.t);
  const series = keys.map((k) => frames.map((f) => f.d[k] ?? NaN));
  const extra: number[] = [...(o.keepIndices ?? [])];
  if (o.alwaysKeep) frames.forEach((f, i) => { if (o.alwaysKeep!(f, i)) extra.push(i); });
  const idx = decimateIndices(t, series, { ...o, keepTimes: [...(o.keepTimes ?? []), ...events.map((e) => e.t)], keepIndices: extra });
  return idx.map((i) => frames[i]);
}
