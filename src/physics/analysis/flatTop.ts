/**
 * Flat-top averaging of history diagnostics — the single definition shared by the shot report,
 * the CLI preset runner, the figure generator and the regression harness.
 *
 * The flat top is the last 30 % of the discharge. Two weightings are available:
 *   'time' (default since v4.0): trapezoidal time average over t ∈ [t₀ + 0.7·(t_N − t₀), t_N], with
 *            the value at the window start interpolated linearly. Every frame counts for the time it
 *            spans, so the extra frames recorded at ELMs, sawtooth crashes and mode flips (their number
 *            depends on the event rate, which the very quantities averaged here change) do not bias it.
 *            This is the definition of the shot report, the golden flat-top, the validation table and
 *            the figures.
 *   'frame': arithmetic mean over the frames from index ⌊0.7·N⌋ to N−1. This was the definition up to
 *            v3.0.0 and is reproduced here bit for bit; it weights a time span by its number of frames
 *            (an ELM cycle contributes 2 frames, a quiet interval of the same length 1), so it is biased
 *            towards the ELM-crash states. Measured on the 30 golden cases at v4.0 the difference is at most
 *            0.1 % for the headline Q, P_fus of the ELM tokamaks (ITER Q +0.04 %, DEMO Q −0.1 %) and 2 % in the
 *            pulsed and marginal cases (GF, FRXL P_fus −2 %, ITER-pB11 Q +2 %).
 *
 * Sample policy:
 *   'finite' (default): missing and non-finite samples are ignored; NaN if nothing is left.
 *   'all':   every frame counts, a missing key reads as 0 and non-finite values propagate;
 *            0 for an empty window. This is the ShotReport convention.
 */
import type { HistoryFrame } from '../types';

/** Start of the flat-top window as a fraction of the history (frames for 'frame', time for 'time'). */
export const FLAT_TOP_START = 0.7;

export type FlatTopWeighting = 'frame' | 'time';
export type FlatTopSamples = 'finite' | 'all';

export interface FlatTopOptions {
  /** window start as a fraction of the history, default {@link FLAT_TOP_START} */
  start?: number;
  /** default 'time' (was 'frame' up to v3.0.0) */
  weighting?: FlatTopWeighting;
  /** default 'finite' */
  samples?: FlatTopSamples;
}

type Frames = readonly Pick<HistoryFrame, 't' | 'd'>[];

/** Index of the first frame in the frame-weighted flat-top window. */
export function flatTopStartIndex(nFrames: number, start = FLAT_TOP_START): number {
  return Math.floor(nFrames * start);
}

/** Flat-top average of one diagnostic. */
export function flatTopMean(hist: Frames, key: string, opts: FlatTopOptions = {}): number {
  const start = opts.start ?? FLAT_TOP_START;
  const all = (opts.samples ?? 'finite') === 'all';
  if ((opts.weighting ?? 'time') === 'time') {
    const v = timeMean(hist, key, start, all);
    if (v !== undefined) return v;
    // zero-length window (single frame or constant t): fall back to the frame mean
  }
  const i0 = flatTopStartIndex(hist.length, start);
  let s = 0, n = 0;
  if (all) {
    for (let i = i0; i < hist.length; i++) { s += hist[i].d[key] ?? 0; n++; }
    return n ? s / n : 0;
  }
  for (let i = i0; i < hist.length; i++) { const v = hist[i].d[key]; if (Number.isFinite(v)) { s += v; n++; } }
  return n ? s / n : NaN;
}

/**
 * Flat-top averages of several diagnostics, by default every key of the last frame
 * (in that frame's key order). Empty history → empty record.
 */
export function flatTopAverages(hist: Frames, opts: FlatTopOptions = {}, keys?: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!hist.length) return out;
  for (const k of keys ?? Object.keys(hist[hist.length - 1].d)) out[k] = flatTopMean(hist, k, opts);
  return out;
}

/** Trapezoidal time average over the window; undefined if the window has zero duration. */
function timeMean(hist: Frames, key: string, start: number, all: boolean): number | undefined {
  const n = hist.length;
  if (n < 2) return undefined;
  const tA = hist[0].t, tB = hist[n - 1].t;
  const tS = tA + start * (tB - tA);
  if (!(tB > tS)) return undefined;
  const val = (i: number): number => {
    const v = hist[i].d[key];
    return all ? (v ?? 0) : (v as number);
  };
  let integral = 0, duration = 0;
  for (let i = 0; i < n - 1; i++) {
    const t0 = hist[i].t, t1 = hist[i + 1].t;
    if (t1 <= tS || t1 <= t0) continue;
    let v0 = val(i);
    const v1 = val(i + 1);
    if (!all && !(Number.isFinite(v0) && Number.isFinite(v1))) continue;
    let a = t0;
    if (t0 < tS) { v0 = v0 + ((v1 - v0) * (tS - t0)) / (t1 - t0); a = tS; }
    integral += 0.5 * (v0 + v1) * (t1 - a);
    duration += t1 - a;
  }
  if (duration > 0) return integral / duration;
  return all ? 0 : NaN;
}
