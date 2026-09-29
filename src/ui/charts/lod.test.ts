import { describe, expect, it } from 'vitest';
import { forAll, gen, mulberry32 } from '../../testing/prop';
import { FrameColumns, LOD_MAX_PER_COLUMN, LodFrame, eventFrameIndices, lodIndices, lowerBound, thinEvents, upperBound } from './lod';

const frames = (ts: number[], f: (i: number, t: number) => number | undefined): LodFrame[] => ts.map((t, i) => ({ t, d: { v: f(i, t) } }));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** the pixel column of time t in a chart whose window [x0, x1] is `nb` columns wide (as lod.ts assigns them) */
const column = (t: number, x0: number, x1: number, nb: number) => (t < x0 ? -1 : t > x1 ? nb : Math.min(nb - 1, Math.floor((t - x0) * (nb / (x1 - x0)))));

describe('lowerBound / upperBound', () => {
  const fr = frames([0, 1, 1, 2, 5], () => 0);
  it('find the first frame at or after / after a time', () => {
    expect(lowerBound(fr, -1)).toBe(0);
    expect(lowerBound(fr, 1)).toBe(1);
    expect(upperBound(fr, 1)).toBe(3);
    expect(lowerBound(fr, 2.5)).toBe(4);
    expect(lowerBound(fr, 9)).toBe(5);
    expect(upperBound(fr, 5)).toBe(5);
    expect(lowerBound([], 1)).toBe(0);
  });
});

describe('lodIndices', () => {
  it('draws a short series as it is, with one neighbour on each side of the window', () => {
    const fr = frames(range(100).map((i) => i / 10), (i) => i);
    expect(lodIndices(fr, 'v', 2, 4, 200)).toEqual(range(100).filter((i) => i >= 19 && i <= 41));
    expect(lodIndices(fr, 'v', 0, 9.9, 400)).toEqual(range(100));
    expect(lodIndices([], 'v', 0, 1, 100)).toEqual([]);
    expect(lodIndices(fr, 'v', 50, 60, 100)).toEqual([99]); // the window is after the run: only the last frame is a neighbour
  });

  it('keeps the whole envelope: of every pixel column the first, last, minimum and maximum frames', () => {
    forAll(gen.record({ seed: gen.int(1, 1e6), n: gen.int(600, 6000), cols: gen.int(20, 240), spikes: gen.int(0, 20) }), ({ seed, n, cols, spikes }) => {
      const rnd = mulberry32(seed);
      // irregular times (crash frames cluster), a noisy series with a few one-frame spikes
      const ts: number[] = [];
      let t = 0;
      for (let i = 0; i < n; i++) { t += rnd() < 0.1 ? 1e-4 : 1; ts.push(t); }
      const spikeAt = new Set(range(spikes).map(() => Math.floor(rnd() * n)));
      const fr = frames(ts, (i) => Math.sin(i / 37) + 0.05 * rnd() + (spikeAt.has(i) ? (rnd() < 0.5 ? 5 : -5) : 0));
      const x0 = ts[0], x1 = ts[n - 1];
      const idx = lodIndices(fr, 'v', x0, x1, cols);
      // ascending, unique, bounded by the per-column maximum
      expect(idx.every((v, k) => k === 0 || v > idx[k - 1])).toBe(true);
      expect(idx.length).toBeLessThanOrEqual(LOD_MAX_PER_COLUMN * cols);
      expect(idx.length).toBeLessThanOrEqual(n);
      // per column: the kept frames have the column's extremes and its first and last frame
      const kept = new Set(idx);
      const byColumn = new Map<number, number[]>();
      fr.forEach((f, i) => { const c = column(f.t, x0, x1, cols); (byColumn.get(c) ?? byColumn.set(c, []).get(c)!).push(i); });
      for (const members of byColumn.values()) {
        const vals = members.map((i) => fr[i].d.v!);
        const keptVals = members.filter((i) => kept.has(i)).map((i) => fr[i].d.v!);
        expect(Math.min(...keptVals)).toBe(Math.min(...vals));
        expect(Math.max(...keptVals)).toBe(Math.max(...vals));
        expect(kept.has(members[0])).toBe(true);
        expect(kept.has(members[members.length - 1])).toBe(true);
      }
    }, { runs: 40 });
  });

  it('a one-frame spike in a flat series of 100 000 frames survives at 300 columns', () => {
    const n = 100_000;
    const fr = frames(range(n).map((i) => i * 0.01), (i) => (i === 61_234 ? 9 : i === 3 ? -4 : 1));
    const idx = lodIndices(fr, 'v', 0, (n - 1) * 0.01, 300);
    expect(idx).toContain(61_234);
    expect(idx).toContain(3);
    expect(idx.length).toBeLessThanOrEqual(5 * 300 + 2);
  });

  it('the polyline through the kept frames spans the same vertical range in every column as the full one', () => {
    // a 1.5D-like trace: a slow ramp with sawtooth crashes, sampled irregularly
    const ts: number[] = [];
    for (let i = 0; i < 20_000; i++) ts.push(i * 0.02 + (i % 50 === 0 ? 0.001 : 0));
    const fr = frames(ts, (i) => 8 + 0.0004 * i - 2.5 * ((i % 400) / 400) + (i % 400 === 399 ? -3 : 0));
    const cols = 500, x0 = ts[0], x1 = ts[ts.length - 1];
    const idx = lodIndices(fr, 'v', x0, x1, cols);
    const lo = new Float64Array(cols).fill(Infinity), hi = new Float64Array(cols).fill(-Infinity);
    const klo = new Float64Array(cols).fill(Infinity), khi = new Float64Array(cols).fill(-Infinity);
    fr.forEach((f) => { const c = column(f.t, x0, x1, cols); lo[c] = Math.min(lo[c], f.d.v!); hi[c] = Math.max(hi[c], f.d.v!); });
    idx.forEach((i) => { const c = column(fr[i].t, x0, x1, cols); klo[c] = Math.min(klo[c], fr[i].d.v!); khi[c] = Math.max(khi[c], fr[i].d.v!); });
    expect(Array.from(klo)).toEqual(Array.from(lo));
    expect(Array.from(khi)).toEqual(Array.from(hi));
    expect(idx.length).toBeLessThan(ts.length / 4);
  });

  it('keeps a gap a gap: a missing value stays in the list so the pen is lifted there', () => {
    const fr = frames(range(4000).map((i) => i), (i) => (i >= 1500 && i < 1600 ? undefined : i % 7));
    const idx = lodIndices(fr, 'v', 0, 3999, 100);
    expect(idx.some((i) => i >= 1500 && i < 1600)).toBe(true);
    // the first missing frame of the gap is there (unless a column boundary put it in the previous column's list)
    expect(idx).toContain(1500);
  });

  it('log axis: values at or below zero count as missing', () => {
    const fr = frames(range(3000).map((i) => i), (i) => (i === 500 ? 0 : i === 501 ? -1 : 10 + (i % 5)));
    const lin = lodIndices(fr, 'v', 0, 2999, 60, [], false);
    const log = lodIndices(fr, 'v', 0, 2999, 60, [], true);
    expect(Math.min(...lin.map((i) => fr[i].d.v!))).toBe(-1);
    // the column that holds them is represented by its positive values plus one marker for the gap
    expect(log).toContain(500);
    const c = Math.floor(500 * (60 / 2999));
    const positives = log.filter((i) => Math.floor(i * (60 / 2999)) === c && fr[i].d.v! > 0);
    expect(positives.length).toBeGreaterThan(0);
  });

  it('a degenerate window or a zero-width chart does not fail', () => {
    const fr = frames(range(50).map((i) => i), (i) => i);
    expect(lodIndices(fr, 'v', 10, 10, 100)).toEqual([9, 10, 11]);
    expect(lodIndices(fr, 'v', 0, 49, 0).length).toBeGreaterThan(0);
    expect(lodIndices(fr, 'v', 0, 49, -70).length).toBeGreaterThan(0);
    expect(lodIndices(fr, 'v', 30, 10, 100)).toEqual([]);
  });
});

describe('FrameColumns', () => {
  const mk = (n: number, from = 0, k = 1) => frames(range(n).map((i) => (i + from) * 0.5), (i) => (i + from) % 11 === 5 ? undefined : (i + from) * k);
  const sameAsFresh = (cols: FrameColumns, fr: LodFrame[]) => {
    const fresh = FrameColumns.from(fr);
    expect(cols.n).toBe(fresh.n);
    expect(Array.from(cols.t.subarray(0, cols.n))).toEqual(Array.from(fresh.t.subarray(0, fresh.n)));
    expect(Array.from(cols.column('v').subarray(0, cols.n))).toEqual(Array.from(fresh.column('v').subarray(0, fresh.n)));
  };

  it('holds the times and the values of a series, NaN where a frame has none', () => {
    const fr = mk(20);
    const cols = FrameColumns.from(fr);
    expect(cols.n).toBe(20);
    expect(cols.t[3]).toBe(1.5);
    expect(cols.column('v')[4]).toBe(4);
    expect(cols.column('v')[5]).toBeNaN();
    expect(cols.column('absent').subarray(0, 20).every(Number.isNaN)).toBe(true);
    expect(cols.lowerBound(1.5)).toBe(3);
    expect(cols.upperBound(1.5)).toBe(4);
  });

  it('follows a growing run by appending only the new frames', () => {
    const all = mk(5000);
    const cols = new FrameColumns();
    cols.sync(all.slice(0, 10));
    const first = cols.column('v'); // requested early: must be extended and re-allocated as capacity grows
    expect(first[9]).toBe(9);
    for (let m = 11; m <= 5000; m += m < 300 ? 1 : 137) cols.sync(all.slice(0, m));
    cols.sync(all);
    sameAsFresh(cols, all);
    // the untouched prefix is not re-read: frames whose object identity is the same are trusted
    const spy = { reads: 0 };
    const counted = all.map((f) => ({ t: f.t, get d() { spy.reads++; return f.d; } }));
    const c2 = FrameColumns.from(counted.slice(0, 100));
    c2.column('v');
    const before = spy.reads;
    c2.sync(counted.slice(0, 110));
    expect(spy.reads - before).toBe(10);
  });

  it('starts over after a rewind, also when the new branch is as long as the old one', () => {
    const a = mk(300);
    const cols = FrameColumns.from(a);
    cols.column('v');
    // rewound to frame 199, then 100 more frames on another branch (values differ from frame 200 on)
    const b = [...a.slice(0, 200), ...mk(100, 200, -1)];
    expect(b).toHaveLength(300);
    const direct = FrameColumns.from(a); // synced straight from the old branch to the new one of the same length: the last frame differs
    direct.column('v');
    direct.sync(b);
    sameAsFresh(direct, b);
    cols.sync(b.slice(0, 200));
    sameAsFresh(cols, b.slice(0, 200));
    cols.sync(b);
    sameAsFresh(cols, b);
    expect(cols.column('v')[250]).toBe(-250);
    // a shorter array
    cols.sync(b.slice(0, 50));
    sameAsFresh(cols, b.slice(0, 50));
    // a new run
    const c = mk(80, 1000, 3);
    cols.sync(c);
    sameAsFresh(cols, c);
    cols.sync([]);
    expect(cols.n).toBe(0);
    expect(lodIndices(cols, 'v', 0, 1, 10)).toEqual([]);
  });

  it('range: the extent of a series over a time window, ignoring missing values, optionally non-positive ones', () => {
    const fr = frames(range(100).map((i) => i), (i) => (i === 40 ? undefined : i === 50 ? -3 : i === 60 ? 0 : 10 + (i % 7)));
    const cols = FrameColumns.from(fr);
    expect(cols.range('v', 0, 99)).toEqual({ lo: -3, hi: 16 });
    expect(cols.range('v', 0, 99, true)).toEqual({ lo: 10, hi: 16 });
    expect(cols.range('v', 40, 40)).toBeNull();
    expect(cols.range('v', 200, 300)).toBeNull();
  });
});

describe('event frames', () => {
  // 40 000 frames, an "ELM" at every 200th frame: one frame dropping the value for one sample
  const n = 40_000;
  const ts = range(n).map((i) => i * 0.001);
  const crash = (i: number) => i % 200 === 199;
  const fr = frames(ts, (i) => 10 - (i % 200) * 0.01 + (crash(i) ? 3 : 0));
  const events = range(n).filter(crash).map((i) => ({ t: ts[i], kind: 'ELM' }));

  it('returns the frame at the event and the one before it', () => {
    const ix = eventFrameIndices(fr, events, 0, ts[n - 1], 4000);
    expect(ix).toContain(199);
    expect(ix).toContain(198);
    expect(ix).toContain(399);
    expect(ix.every((v, k) => k === 0 || v > ix[k - 1])).toBe(true);
    expect(ix).toHaveLength(2 * events.length);
  });

  it('keeps at most one event per pixel column: 200 ELMs in 20 columns are 40 frames', () => {
    const ix = eventFrameIndices(fr, events, 0, ts[n - 1], 20);
    expect(ix.length).toBeLessThanOrEqual(2 * 20);
    expect(ix.length).toBeGreaterThan(0);
  });

  it('only events inside the window count', () => {
    const ix = eventFrameIndices(fr, events, 10, 20, 100);
    expect(ix.every((i) => ts[i] >= 9.5 && ts[i] <= 20.5)).toBe(true);
    expect(eventFrameIndices(fr, [], 0, 1, 10)).toEqual([]);
    expect(eventFrameIndices([], events, 0, 1, 10)).toEqual([]);
    expect(eventFrameIndices(fr, events, 5, 5, 10)).toEqual([]);
  });

  it('the series keeps every ELM crash frame and its pre-crash frame wherever the columns resolve them', () => {
    // 400 columns across 40 s: an ELM every 0.2 s = 2 columns apart, all resolvable
    const cols = 400;
    const keep = eventFrameIndices(fr, events, 0, ts[n - 1], cols);
    const idx = lodIndices(fr, 'v', 0, ts[n - 1], cols, keep);
    const kept = new Set(idx);
    for (const e of events) {
      const i = Math.round(e.t / 0.001);
      expect(kept.has(i)).toBe(true);
      expect(kept.has(i - 1)).toBe(true);
    }
    // the plain decimation of the old chart (every stride-th frame of the window) misses most crash frames
    const stride = Math.max(1, Math.floor(n / (cols * 2)));
    const oldKept = new Set(range(n).filter((i) => i % stride === 0));
    const missed = events.filter((e) => !oldKept.has(Math.round(e.t / 0.001))).length;
    expect(missed).toBeGreaterThan(events.length / 2);
  });

  it('the point count stays bounded whatever the number of events', () => {
    const cols = 300;
    const keep = eventFrameIndices(fr, events, 0, ts[n - 1], cols);
    const idx = lodIndices(fr, 'v', 0, ts[n - 1], cols, keep);
    expect(idx.length).toBeLessThanOrEqual(LOD_MAX_PER_COLUMN * cols + 2);
  });
});

describe('thinEvents', () => {
  const major = (k: string) => k === 'LH' || k === 'disruption';
  const evs = [
    ...range(1000).map((i) => ({ t: i * 0.01, kind: 'ELM' })),
    { t: 5.001, kind: 'LH' }, { t: 5.002, kind: 'LH' }, { t: 9, kind: 'disruption' },
  ].sort((a, b) => a.t - b.t);

  it('keeps every major event and one minor event of a kind per pixel column', () => {
    const out = thinEvents(evs, 0, 10, 50, major);
    expect(out.filter((e) => e.kind === 'LH')).toHaveLength(2);
    expect(out.filter((e) => e.kind === 'disruption')).toHaveLength(1);
    expect(out.filter((e) => e.kind === 'ELM').length).toBeLessThanOrEqual(50);
    expect(out.filter((e) => e.kind === 'ELM').length).toBeGreaterThan(40);
    // resolvable events are all kept
    expect(thinEvents(evs, 0, 10, 5000, major)).toHaveLength(evs.length);
  });

  it('clips to the window and tolerates an empty one', () => {
    expect(thinEvents(evs, 2, 3, 1000, major).every((e) => e.t >= 2 && e.t <= 3)).toBe(true);
    expect(thinEvents(evs, 3, 3, 10, major)).toEqual([]);
  });
});
