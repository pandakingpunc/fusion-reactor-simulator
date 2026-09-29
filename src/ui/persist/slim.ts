/**
 * Slim frames: a run's time series in the size an archive can afford.
 *
 * A live run keeps every recorded frame (thousands for a 1.5D shot, each with its diagnostics and, on regular
 * output frames, radial profiles). The archive keeps a thinned copy for redisplay: the frames become columns
 * (one Float64Array per diagnostic, one for the times), at most `maxFrames` of them evenly spread over the run
 * with the first and the last always kept, and only the last profile snapshot and flux-surface snapshot are kept
 * (attached to the frames that carried them). The numbers of a kept frame are exact; a run is reproduced exactly
 * from its inputs (see verify.ts), not from its archived frames.
 */
import type { EqSnapshot } from '../../physics/types';
import type { UiFrame } from '../../worker/protocol';

export const DEFAULT_MAX_FRAMES = 500;

export interface SlimFrames {
  /** number of frames kept */
  n: number;
  /** number of frames the run had */
  sourceCount: number;
  t: Float64Array;
  /** diagnostic keys, in first-seen order; cols[i] holds keys[i] for every kept frame (NaN where a frame had no such key) */
  keys: string[];
  cols: Float64Array[];
  /** profile and flux-surface snapshots, by kept-frame index */
  extras: { i: number; prof?: Record<string, number[]>; eq?: EqSnapshot }[];
}

/** Indices of the frames to keep: `max` evenly spread ones, plus the given ones, ascending and unique. */
export function pickIndices(count: number, max: number, must: readonly number[] = []): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const set = new Set<number>(must.filter((i) => i >= 0 && i < count));
  const m = Math.max(2, max);
  for (let k = 0; k < m; k++) set.add(Math.round((k * (count - 1)) / (m - 1)));
  return [...set].sort((a, b) => a - b);
}

export function slimFrames(frames: readonly UiFrame[], opts: { maxFrames?: number } = {}): SlimFrames {
  let lastProf = -1;
  let lastEq = -1;
  frames.forEach((f, i) => { if (f.prof) lastProf = i; if (f.eq) lastEq = i; });
  const idx = pickIndices(frames.length, opts.maxFrames ?? DEFAULT_MAX_FRAMES, [lastProf, lastEq]);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const i of idx) for (const k of Object.keys(frames[i].d)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  const n = idx.length;
  const t = new Float64Array(n);
  const cols = keys.map(() => new Float64Array(n).fill(NaN));
  const extras: SlimFrames['extras'] = [];
  idx.forEach((src, j) => {
    const f = frames[src];
    t[j] = f.t;
    keys.forEach((k, c) => { const v = f.d[k]; if (v !== undefined) cols[c][j] = v; });
    if (src === lastProf || src === lastEq) {
      const e: SlimFrames['extras'][number] = { i: j };
      if (src === lastProf && f.prof) e.prof = f.prof;
      if (src === lastEq && f.eq) e.eq = f.eq;
      extras.push(e);
    }
  });
  return { n, sourceCount: frames.length, t, keys, cols, extras };
}

export function expandFrames(s: SlimFrames): UiFrame[] {
  const out: UiFrame[] = new Array(s.n);
  for (let j = 0; j < s.n; j++) {
    const d: Record<string, number> = {};
    for (let c = 0; c < s.keys.length; c++) d[s.keys[c]] = s.cols[c][j];
    out[j] = { t: s.t[j], d };
  }
  for (const e of s.extras) {
    if (e.prof) out[e.i].prof = e.prof;
    if (e.eq) out[e.i].eq = e.eq;
  }
  return out;
}

/** Approximate size in bytes of the stored form (the columns; the snapshots are counted at 8 bytes per number). */
export function slimBytes(s: SlimFrames): number {
  let b = s.t.byteLength + s.cols.reduce((a, c) => a + c.byteLength, 0);
  for (const e of s.extras) {
    if (e.prof) for (const a of Object.values(e.prof)) b += a.length * 8;
    if (e.eq) b += (e.eq.R.reduce((a, r) => a + r.length, 0) + e.eq.Z.reduce((a, r) => a + r.length, 0) + e.eq.rho.length) * 8;
  }
  return b;
}
