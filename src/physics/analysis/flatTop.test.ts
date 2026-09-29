import { describe, expect, it } from 'vitest';
import { FLAT_TOP_START, flatTopAverages, flatTopMean, flatTopStartIndex } from './flatTop';
import { RNG } from '../rng';

type Frame = { t: number; d: Record<string, number> };

const frames = (ts: number[], f: (t: number, i: number) => Partial<Record<string, number>>): Frame[] => ts.map((t, i) => ({ t, d: f(t, i) as Record<string, number> }));

/** v3.0.0 copy used by the CLI worker and figures (reference for bitwise equality) */
function legacyWorkerAvg(hist: Frame[]): Record<string, number> {
  const i0 = Math.floor(hist.length * 0.7);
  const avg: Record<string, number> = {};
  for (const k of Object.keys(hist[hist.length - 1].d)) {
    let s = 0, n = 0;
    for (let i = i0; i < hist.length; i++) { const v = hist[i].d[k]; if (Number.isFinite(v)) { s += v; n++; } }
    avg[k] = n ? s / n : NaN;
  }
  return avg;
}

/** v3.0.0 copy used by the shot reports */
function legacyReportAvg(hist: Frame[], k: string): number {
  const i0 = Math.floor(hist.length * 0.7);
  let s = 0, n = 0;
  for (let i = i0; i < hist.length; i++) { s += hist[i].d[k] ?? 0; n++; }
  return n ? s / n : 0;
}

function randomHistory(rng: RNG, n: number): Frame[] {
  let t = 0;
  return Array.from({ length: n }, () => {
    t += rng.next() < 0.2 ? 0 : rng.next() * 3;
    const d: Record<string, number> = { a: rng.normal() * 1e3, b: Math.exp(rng.normal() * 30), c: rng.next() - 0.5 };
    const r = rng.next();
    if (r < 0.05) d.a = NaN;
    else if (r < 0.08) d.b = Infinity;
    else if (r < 0.12) delete (d as Partial<Record<string, number>>).c;
    return { t, d };
  });
}

describe('flat-top averaging', () => {
  it("frame weighting ('frame', the v3.0.0 default) reproduces the v3.0.0 averages bit for bit (both sample policies)", () => {
    const rng = new RNG(1234);
    for (let trial = 0; trial < 200; trial++) {
      const hist = randomHistory(rng, 1 + Math.floor(rng.next() * 60));
      const ref = legacyWorkerAvg(hist);
      const got = flatTopAverages(hist, { weighting: 'frame' });
      expect(Object.keys(got)).toEqual(Object.keys(ref));
      for (const k of Object.keys(ref)) expect(Object.is(got[k], ref[k])).toBe(true);
      for (const k of ['a', 'b', 'c', 'missing']) expect(Object.is(flatTopMean(hist, k, { samples: 'all', weighting: 'frame' }), legacyReportAvg(hist, k))).toBe(true);
    }
  });

  it('uses the last 30 % of the frames (frame weighting) or of the time (time weighting)', () => {
    expect(FLAT_TOP_START).toBe(0.7);
    expect(flatTopStartIndex(10)).toBe(7);
    expect(flatTopStartIndex(1)).toBe(0);
    const hist = frames([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (_t, i) => ({ x: i }));
    expect(flatTopMean(hist, 'x', { weighting: 'frame' })).toBe(8);
    expect(flatTopMean(hist, 'x', { weighting: 'frame', start: 0.5 })).toBe(7);
    // x = t on [0, 9]: the window [6.3, 9] has the mean 7.65, [4.5, 9] the mean 6.75
    expect(flatTopMean(hist, 'x', { weighting: 'time' })).toBeCloseTo(7.65, 12);
    expect(flatTopMean(hist, 'x', { weighting: 'time', start: 0.5 })).toBeCloseTo(6.75, 12);
  });

  it('the default weighting is the time average (v4.0); frame weighting is opt-in', () => {
    const ts = [0, 1, 2, 3, 4, 5, 6, 7.05, 7.1, 7.15, 7.2, 7.25, 7.3, 7.35, 10];
    const hist = frames(ts, (t) => ({ x: t }));
    expect(flatTopMean(hist, 'x')).toBe(flatTopMean(hist, 'x', { weighting: 'time' }));
    expect(flatTopMean(hist, 'x')).toBeCloseTo(8.5, 12);
    expect(flatTopMean(hist, 'x', { weighting: 'frame' })).not.toBeCloseTo(8.5, 1);
    expect(flatTopAverages(hist, {}, ['x']).x).toBeCloseTo(8.5, 12);
    // the 'all' policy (the shot report) uses the same weighting
    expect(flatTopMean(hist, 'x', { samples: 'all' })).toBeCloseTo(8.5, 12);
  });

  it('sample policies: finite skips, all counts missing as zero and propagates NaN', () => {
    const hist = frames([0, 1, 2, 3], (_t, i) => (i === 3 ? { x: NaN } : i === 2 ? {} : { x: 4 }));
    // window = frames 2..3 (frame weighting)
    const F = { weighting: 'frame' } as const;
    expect(flatTopMean(hist, 'x', F)).toBeNaN(); // nothing finite left
    expect(flatTopMean(hist, 'x', { ...F, samples: 'all' })).toBeNaN(); // NaN propagates
    const h2 = frames([0, 1, 2, 3], (_t, i) => (i === 2 ? {} : { x: 4 }));
    expect(flatTopMean(h2, 'x', F)).toBe(4);
    expect(flatTopMean(h2, 'x', { ...F, samples: 'all' })).toBe(2);
    expect(flatTopMean([], 'x')).toBeNaN();
    expect(flatTopMean([], 'x', { samples: 'all' })).toBe(0);
    expect(flatTopAverages([])).toEqual({});
  });

  it('averages every key of the last frame, in its order, or the requested keys', () => {
    const hist = frames([0, 1], () => ({ z: 1, a: 2 }));
    expect(Object.keys(flatTopAverages(hist))).toEqual(['z', 'a']);
    expect(flatTopAverages(hist, {}, ['a'])).toEqual({ a: 2 });
  });

  it('time weighting integrates a linear signal exactly, independent of frame clustering', () => {
    // x = t on [0, 10]; flat top = [7, 10] → mean 8.5. Frames cluster near t = 7.2 (e.g. an ELM burst).
    const ts = [0, 1, 2, 3, 4, 5, 6, 7.05, 7.1, 7.15, 7.2, 7.25, 7.3, 7.35, 10];
    const hist = frames(ts, (t) => ({ x: t }));
    expect(flatTopMean(hist, 'x', { weighting: 'time' })).toBeCloseTo(8.5, 12);
    // the frame mean over the last 30 % of frames is biased towards the cluster
    expect(Math.abs(flatTopMean(hist, 'x', { weighting: 'frame' }) - 8.5)).toBeGreaterThan(0.3);
  });

  it('time weighting: step signal, skipped non-finite segments and degenerate windows', () => {
    // piecewise constant x = 1 until t = 8, then 3 (vertical step via duplicate time stamp)
    const hist = frames([0, 5, 8, 8, 10], (t, i) => ({ x: i < 3 ? 1 : 3 }));
    // window [7, 10]: 1 over [7, 8], 3 over [8, 10] → (1 + 6) / 3
    expect(flatTopMean(hist, 'x', { weighting: 'time' })).toBeCloseTo(7 / 3, 14);
    // a NaN frame removes its two adjacent segments in 'finite' mode
    const h2 = frames([0, 7, 8, 9, 10], (t, i) => ({ x: i === 3 ? NaN : 2 }));
    expect(flatTopMean(h2, 'x', { weighting: 'time' })).toBe(2);
    expect(flatTopMean(h2, 'x', { weighting: 'time', samples: 'all' })).toBeNaN();
    // single frame / zero duration → frame mean
    expect(flatTopMean(frames([3], () => ({ x: 5 })), 'x', { weighting: 'time' })).toBe(5);
    expect(flatTopMean(frames([3, 3, 3], (_t, i) => ({ x: i })), 'x', { weighting: 'time' })).toBe(2);
  });
});
