/**
 * Min/max decimation of long series: envelope, events and gaps survive; short series are untouched.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_POINTS, decimateFrames, decimateIndices } from './decimate';
import type { HistoryFrame, SimEvent } from '../physics/types';

const linspace = (a: number, b: number, n: number) => Float64Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

describe('decimateIndices', () => {
  it('returns every index for a series that is not longer than the budget', () => {
    const t = linspace(0, 1, 500);
    expect(decimateIndices(t, [t])).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(decimateIndices(t, [t], { maxPoints: 500 }).length).toBe(500);
    expect(DEFAULT_MAX_POINTS).toBe(4000);
  });

  it('keeps the first and last sample and the global minimum and maximum of every series', () => {
    const n = 50000;
    const t = linspace(0, 100, n);
    const a = Float64Array.from(t, (x, i) => Math.sin(x) + (i === 12345 ? 9 : 0) - (i === 40001 ? 7 : 0));
    const b = Float64Array.from(t, (x, i) => Math.cos(3 * x) * 0.1 + (i === 777 ? 3 : 0));
    const idx = decimateIndices(t, [a, b], { maxPoints: 600 });
    expect(idx.length).toBeLessThan(1200);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    expect(idx).toContain(12345); // the spike of series a
    expect(idx).toContain(40001); // the dip of series a
    expect(idx).toContain(777); // the spike of series b
    expect(idx).toEqual([...new Set(idx)].sort((x, y) => x - y)); // ascending, unique
  });

  it('per bucket the kept samples have the same range as all samples (the envelope of the plot is unchanged)', () => {
    const n = 20000, B = 100;
    const t = linspace(0, 1, n);
    const y = Float64Array.from(t, (x, i) => Math.sin(40 * x) * Math.cos(3 * x) + 0.3 * Math.sin(1000 * x) + (i % 4001 === 0 ? 0.5 : 0));
    // one series: at most 4 samples per bucket, so max = 4 B + first/last gives exactly B buckets
    const idx = decimateIndices(t, [y], { maxPoints: 4 * B + 2 });
    const bucket = (x: number) => Math.min(B - 1, Math.floor(x * B));
    const lo = new Array(B).fill(Infinity), hi = new Array(B).fill(-Infinity), klo = new Array(B).fill(Infinity), khi = new Array(B).fill(-Infinity);
    for (let i = 0; i < n; i++) { const b = bucket(t[i]); lo[b] = Math.min(lo[b], y[i]); hi[b] = Math.max(hi[b], y[i]); }
    for (const i of idx) { const b = bucket(t[i]); klo[b] = Math.min(klo[b], y[i]); khi[b] = Math.max(khi[b], y[i]); }
    expect(klo).toEqual(lo);
    expect(khi).toEqual(hi);
    expect(idx.length).toBeLessThanOrEqual(4 * B + 2);
  });

  it('keeps the samples on both sides of every event time even where the series is flat', () => {
    const n = 30000;
    const t = linspace(0, 300, n); // dt = 0.01
    const flat = new Float64Array(n).fill(5);
    const events = [42.003, 150.0, 299.5];
    const without = decimateIndices(t, [flat], { maxPoints: 200 });
    const withEv = decimateIndices(t, [flat], { maxPoints: 200, keepTimes: events });
    for (const te of events) {
      const j = t.findIndex((x) => x >= te);
      expect(withEv, `event ${te}`).toContain(j - 1);
      expect(withEv, `event ${te}`).toContain(j);
    }
    expect(without.length).toBeLessThan(withEv.length); // the event samples are what the call added
    expect(withEv.length).toBeLessThan(400);
    expect(decimateIndices(t, [flat], { maxPoints: 200, keepTimes: [NaN, -5, 1e9] }).length).toBeGreaterThan(0); // outside / non-finite times are harmless
  });

  it('keeps the samples on both sides of a gap, and explicitly requested indices', () => {
    const n = 10000;
    const t = linspace(0, 10, n);
    const y = Float64Array.from(t, (x) => Math.sin(x));
    for (let i = 5000; i < 5600; i++) y[i] = NaN; // a gap
    const idx = decimateIndices(t, [y], { maxPoints: 100, keepIndices: [1234, 9999.7, -4, 1e9] });
    expect(idx).toContain(4999);
    expect(idx).toContain(5600);
    expect(idx).toContain(1234);
    expect(idx).toContain(9999);
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    for (const i of idx) if (i >= 5000 && i < 5600) expect(Number.isNaN(y[i])).toBe(true); // nothing finite is invented inside the gap
    // the kept series has the same gap: finite on both sides of it, none of the kept finite samples lies in it
    const kept = idx.filter((i) => Number.isFinite(y[i]));
    expect(kept.some((i) => i >= 5000 && i < 5600)).toBe(false);
  });

  it('keeps both edge samples and the samples inside a short gap that lies in the middle of a bucket', () => {
    // a monotone series has its bucket extremes at the bucket ends, so an edge sample in the middle of a
    // bucket is kept only by the gap rule; the gap here is 4 samples wide, well off every bucket boundary
    const n = 10000;
    const t = linspace(0, 10, n);
    const y = Float64Array.from(t, (x) => x);
    for (let i = 5003; i <= 5006; i++) y[i] = NaN;
    const idx = decimateIndices(t, [y], { maxPoints: 100 });
    expect(idx.length).toBeLessThan(200);
    for (const i of [5002, 5007]) expect(idx, `edge sample ${i}`).toContain(i);
    // the gap is still a gap: no kept sample invents a finite value inside it
    const kept = idx.filter((i) => i >= 5003 && i <= 5006);
    for (const i of kept) expect(Number.isNaN(y[i])).toBe(true);
    // a gap that opens at the start of the series, and one that closes at its end
    const y2 = Float64Array.from(t, (x) => x);
    y2[0] = NaN; y2[1] = NaN;
    y2[n - 2] = NaN;
    const idx2 = decimateIndices(t, [y2], { maxPoints: 100 });
    expect(idx2).toContain(2);
    expect(idx2).toContain(n - 3);
  });

  it('handles a series that is not ordered in time (a rewound history) by index buckets, and constant time', () => {
    const n = 5000;
    const t = Float64Array.from({ length: n }, (_, i) => (i < 2500 ? i : 4999 - i)); // goes up, then back down
    const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 50));
    const idx = decimateIndices(t, [y], { maxPoints: 200, keepTimes: [100] });
    expect(idx.length).toBeGreaterThan(0);
    expect(idx.length).toBeLessThan(400);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    const same = new Float64Array(n).fill(3); // no time span at all
    expect(decimateIndices(same, [y], { maxPoints: 100 }).length).toBeLessThan(200);
  });

  it('never returns fewer samples than two buckets can hold, whatever the number of series', () => {
    const n = 8000;
    const t = linspace(0, 1, n);
    const many = Array.from({ length: 12 }, (_, k) => Float64Array.from(t, (x) => Math.sin((k + 1) * 30 * x)));
    const idx = decimateIndices(t, many, { maxPoints: 20 });
    expect(idx.length).toBeGreaterThanOrEqual(2);
    expect(idx.length).toBeLessThan(2 + 2 * 12 + 2 + 10); // one bucket: first, last and 2 extremes per series
  });
});

function frame(t: number, v: number, extra: Partial<HistoryFrame> = {}): HistoryFrame {
  return { t, y: [], internal: {}, d: { a: v, b: -v }, ...extra };
}

describe('decimateFrames', () => {
  const frames = Array.from({ length: 12000 }, (_, i) => frame(i * 0.01, Math.sin(i / 200)));
  const events: SimEvent[] = [{ t: 33.337, kind: 'ELM', msg: 'ELM' }, { t: 90.0, kind: 'LH', msg: 'L-H' }];

  it('returns the frames unchanged (as a copy) when the history is short', () => {
    const short = frames.slice(0, 100);
    const out = decimateFrames(short, ['a'], events);
    expect(out).toEqual(short);
    expect(out).not.toBe(short);
  });

  it('thins a long history, keeps the event frames, and returns the original frame objects in order', () => {
    const out = decimateFrames(frames, ['a', 'b'], events, { maxPoints: 500 });
    expect(out.length).toBeLessThan(frames.length / 8);
    expect(out[0]).toBe(frames[0]);
    expect(out[out.length - 1]).toBe(frames[frames.length - 1]);
    for (const e of events) {
      const j = frames.findIndex((f) => f.t >= e.t);
      expect(out).toContain(frames[j]);
      expect(out).toContain(frames[j - 1]);
    }
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
    // the extremes of both diagnostics survive
    const maxA = Math.max(...frames.map((f) => f.d.a)), minB = Math.min(...frames.map((f) => f.d.b));
    expect(Math.max(...out.map((f) => f.d.a))).toBe(maxA);
    expect(Math.min(...out.map((f) => f.d.b))).toBe(minB);
  });

  it('alwaysKeep frames (e.g. those with profiles) and keys that are absent from the frames', () => {
    const withProf = frames.map((f, i) => (i % 3000 === 1 ? { ...f, prof: { rho: [0, 1] } } : f));
    const out = decimateFrames(withProf, ['a', 'missing'], [], { maxPoints: 300, alwaysKeep: (f) => !!f.prof });
    for (const f of withProf) if (f.prof) expect(out).toContain(f);
    expect(out.length).toBeLessThan(1000);
  });
});
