/**
 * Level of detail for long time series (min/max decimation that keeps the frames of events).
 *
 * A chart is a few hundred pixels wide and a run can hold tens of thousands of frames (a 1.5D shot records a frame
 * per ELM or sawtooth crash on top of the regular output). Taking every k-th frame, as the time chart used to, drops
 * exactly the frames that matter: a crash is one or two frames wide. This module thins a series per pixel column
 * instead. Of the frames that fall in one column it keeps the first and the last (they connect the columns), the
 * minimum and the maximum of the series (the vertical extent of the column: a spike or a dip is never lost), and the
 * first frame that has no value (so a gap stays a gap); the polyline through the kept frames covers the same pixels as
 * the polyline through all of them. On top of that the frame of an event and the frame before it are kept (one event
 * per column, see `eventFrameIndices`), so a crash keeps its vertical edge and stays lined up with its event marker
 * wherever the columns are wide enough to resolve it.
 *
 * Cost. Reading `frame.d[key]` for every frame of every series on every redraw is a dictionary lookup per value;
 * `FrameColumns` copies the times and each series into Float64Arrays once and only appends the frames that arrive
 * afterwards (a live run adds a few per redraw), so a redraw is one sequential pass over the typed arrays.
 *
 * All functions take frames sorted by time (a run's history, also after a rewind: the branch is cut) and return
 * ascending frame indices. DOM-free.
 */

/** the part of a history frame the chart needs */
export interface LodFrame { t: number; d: Readonly<Record<string, number | undefined>> }

/** No pixel column keeps more frames than this: first, min, max, last and a gap marker, plus an event frame and the one before it. */
export const LOD_MAX_PER_COLUMN = 7;
/** a series with at most this many frames per column is drawn as it is (the thinning would keep them all anyway) */
const FULL_DETAIL_PER_COLUMN = 4;

/** index of the first frame with t ≥ x (frames.length if there is none) */
export function lowerBound(frames: ArrayLike<{ t: number }>, x: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (frames[m].t < x) lo = m + 1; else hi = m; }
  return lo;
}

/** index of the first frame with t > x (frames.length if there is none) */
export function upperBound(frames: ArrayLike<{ t: number }>, x: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (frames[m].t <= x) lo = m + 1; else hi = m; }
  return lo;
}

function lowerBoundT(t: ArrayLike<number>, n: number, x: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

function upperBoundT(t: ArrayLike<number>, n: number, x: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (t[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

const valueOf = (f: LodFrame, key: string): number => { const v = f.d[key]; return v === undefined ? Number.NaN : v; };

/**
 * A run's frames as columns: the times and, per requested series, its values (NaN where a frame has none) in
 * Float64Arrays. `sync(frames)` follows the run: when `frames` is the array it had before with frames appended
 * (the last frame it saw is still at the same index), only the new frames are copied; after a rewind or a new run
 * it starts over. The frames themselves are immutable.
 */
export class FrameColumns {
  /** number of frames covered */
  n = 0;
  t: Float64Array = new Float64Array(0);
  private cols = new Map<string, Float64Array>();
  private frames: readonly LodFrame[] = [];
  private last: LodFrame | undefined;

  static from(frames: readonly LodFrame[]): FrameColumns { return new FrameColumns().sync(frames); }

  sync(frames: readonly LodFrame[]): this {
    const m = frames.length;
    if (!(this.n <= m && (this.n === 0 || frames[this.n - 1] === this.last))) { this.n = 0; this.cols.clear(); }
    this.frames = frames;
    if (m > this.t.length) {
      const cap = Math.max(m, this.t.length * 2, 256);
      const t = new Float64Array(cap); t.set(this.t.subarray(0, this.n));
      this.t = t;
      for (const [k, a] of this.cols) { const b = new Float64Array(cap); b.set(a.subarray(0, this.n)); this.cols.set(k, b); }
    }
    for (let i = this.n; i < m; i++) {
      this.t[i] = frames[i].t;
      for (const [k, a] of this.cols) a[i] = valueOf(frames[i], k);
    }
    this.n = m;
    this.last = frames[m - 1];
    return this;
  }

  /** the values of one series, extracted on first use and extended by `sync` afterwards (valid up to `n`) */
  column(key: string): Float64Array {
    let a = this.cols.get(key);
    if (!a) {
      a = new Float64Array(this.t.length);
      for (let i = 0; i < this.n; i++) a[i] = valueOf(this.frames[i], key);
      this.cols.set(key, a);
    }
    return a;
  }

  /** index of the first frame with t ≥ x */
  lowerBound(x: number): number { return lowerBoundT(this.t, this.n, x); }
  /** index of the first frame with t > x */
  upperBound(x: number): number { return upperBoundT(this.t, this.n, x); }

  /**
   * Range of a series over the frames with x0 ≤ t ≤ x1 (values that are missing, not finite, or (positiveOnly) not
   * positive do not count); null when there is none.
   */
  range(key: string, x0: number, x1: number, positiveOnly = false): { lo: number; hi: number } | null {
    const v = this.column(key);
    let lo = Infinity, hi = -Infinity;
    for (let i = this.lowerBound(x0), e = this.upperBound(x1); i < e; i++) {
      const x = v[i];
      if (!Number.isFinite(x) || (positiveOnly && x <= 0)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return lo <= hi ? { lo, hi } : null;
  }
}

const columns = (buckets: number) => Math.max(1, Math.floor(Number.isFinite(buckets) ? buckets : 1));

/** ascending, duplicate-free merge of two ascending index lists */
export function mergeIndices(a: readonly number[], b: readonly number[]): number[] {
  if (!b.length) return a as number[];
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const v = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (!out.length || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

/**
 * Frames to keep because an event happened there: the frame recorded at each event and the one before it (the
 * pre-crash state, which gives the crash its vertical edge). At most one event per pixel column contributes: events
 * closer together than a column are the same pixel, and their crashes are in the min/max of the column anyway.
 * @param events chronological (the run's event list)
 * @param buckets number of pixel columns across [x0, x1]
 */
export function eventFrameIndices(frames: FrameColumns | ArrayLike<{ t: number }>, events: readonly { t: number }[], x0: number, x1: number, buckets: number): number[] {
  const cols = frames instanceof FrameColumns ? frames : null;
  const n = cols ? cols.n : (frames as ArrayLike<{ t: number }>).length, nb = columns(buckets);
  if (!n || !events.length || !(x1 > x0)) return [];
  const first = (x: number) => (cols ? cols.lowerBound(x) : lowerBound(frames as ArrayLike<{ t: number }>, x));
  const scale = nb / (x1 - x0);
  const out: number[] = [];
  let lastColumn = -1;
  for (const ev of events) {
    if (ev.t < x0 || ev.t > x1) continue;
    const c = Math.min(nb - 1, Math.floor((ev.t - x0) * scale));
    if (c === lastColumn) continue;
    lastColumn = c;
    const i = first(ev.t - 1e-9 * Math.max(1, Math.abs(ev.t)));
    if (i > 0) out.push(i - 1);
    if (i < n) out.push(i);
  }
  return out.sort((p, q) => p - q).filter((v, k, arr) => k === 0 || v !== arr[k - 1]);
}

/**
 * Indices of the frames to draw for one series over the window [x0, x1] of a chart `buckets` pixels wide.
 * One frame on each side of the window is included, so the line runs to the edges of the plot.
 * @param frames the run's frames, or the FrameColumns that follows them (cheaper across redraws)
 * @param keep ascending indices that must survive (`eventFrameIndices`)
 * @param positiveOnly log axis: values ≤ 0 are as good as missing
 */
export function lodIndices(frames: FrameColumns | readonly LodFrame[], key: string, x0: number, x1: number, buckets: number, keep: readonly number[] = [], positiveOnly = false): number[] {
  const cols = frames instanceof FrameColumns ? frames : FrameColumns.from(frames);
  const n = cols.n, nb = columns(buckets);
  if (!n || !(x1 >= x0)) return [];
  const t = cols.t, v = cols.column(key);
  const a = Math.max(0, cols.lowerBound(x0) - 1);
  const b = Math.min(n, cols.upperBound(x1) + 1);
  if (b <= a) return [];
  if (b - a <= FULL_DETAIL_PER_COLUMN * nb || !(x1 > x0)) {
    const all: number[] = [];
    for (let i = a; i < b; i++) all.push(i);
    return all;
  }

  const scale = nb / (x1 - x0);
  const out: number[] = [];
  const pick = new Int32Array(5);
  let column = Number.NaN;
  let first = -1, last = -1, iMin = -1, iMax = -1, gap = -1, vMin = Infinity, vMax = -Infinity;
  // the column's frames in index order, without duplicates (an insertion sort over at most five indices)
  const flush = () => {
    let m = 0;
    for (let q = 0; q < 5; q++) {
      const i = q === 0 ? first : q === 1 ? iMin : q === 2 ? iMax : q === 3 ? last : gap;
      if (i < 0) continue;
      let j = m++;
      while (j > 0 && pick[j - 1] > i) { pick[j] = pick[j - 1]; j--; }
      pick[j] = i;
    }
    for (let k = 0; k < m; k++) if (k === 0 || pick[k] !== pick[k - 1]) out.push(pick[k]);
  };
  for (let i = a; i < b; i++) {
    const ti = t[i];
    // the neighbours outside the window sit in columns of their own
    const c = ti < x0 ? -1 : ti > x1 ? nb : Math.min(nb - 1, Math.floor((ti - x0) * scale));
    if (c !== column) {
      flush();
      column = c; first = last = iMin = iMax = gap = -1; vMin = Infinity; vMax = -Infinity;
    }
    const x = v[i];
    if (!Number.isFinite(x) || (positiveOnly && x <= 0)) { if (gap < 0) gap = i; continue; }
    if (first < 0) first = i;
    last = i;
    if (x < vMin) { vMin = x; iMin = i; }
    if (x > vMax) { vMax = x; iMax = i; }
  }
  flush();
  return mergeIndices(out, keep.filter((i) => i >= a && i < b));
}

/**
 * Events worth a marker line at this zoom: every major event, and of the minor ones the first of each kind in a
 * pixel column (a thousand ELMs in a 600 px chart would be a thousand overlapping lines).
 * @param events chronological
 */
export function thinEvents<E extends { t: number; kind: string }>(events: readonly E[], x0: number, x1: number, buckets: number, isMajor: (kind: string) => boolean): E[] {
  const nb = columns(buckets);
  if (!(x1 > x0)) return [];
  const scale = nb / (x1 - x0);
  const out: E[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.t < x0 || ev.t > x1) continue;
    if (!isMajor(ev.kind)) {
      const id = `${ev.kind}:${Math.min(nb - 1, Math.floor((ev.t - x0) * scale))}`;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(ev);
  }
  return out;
}
