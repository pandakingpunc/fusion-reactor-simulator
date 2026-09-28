/// <reference types="node" />
/**
 * Golden regression: comparator self-test and a fast subset of the golden suite
 * (the full suite is `npm run golden`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FAST_CASES, GOLDEN_CASES, GOLDEN_SCHEMA, GoldenSnapshot, REL_TOL_OTHER_NODE, REL_TOL_SAME_NODE, caseConfig, compareSnapshots, countBySection,
  flattenScalars, formatDiffTable, goldenCase, historyStats, parseSnapshot, relDiff, runGoldenCase, sampleIndices, serializeSnapshot,
  snapshotFromRun, summarizeChange, toleranceFor,
} from './golden';
import { PRESETS } from '../physics/presets';
import { Simulation } from '../physics/simulation';
import type { HistoryFrame, ShotReport } from '../physics/types';

const goldenFile = (id: string) => new URL(`../../test/golden/${id}.json`, import.meta.url);

/** One run per case for the whole file (the fast subset and the content tests share them). */
const runs = new Map<string, { sim: Simulation; report: ShotReport }>();
function run(id: string) {
  let r = runs.get(id);
  if (!r) {
    const sim = new Simulation(caseConfig(goldenCase(id)));
    r = { sim, report: sim.runAll() };
    runs.set(id, r);
  }
  return r;
}
/** Snapshot of a case's run, optionally with its history replaced (edited copies in tests). */
function snapshot(id: string, history?: HistoryFrame[]): GoldenSnapshot {
  const { sim, report } = run(id);
  const data = { history: history ?? sim.history, events: sim.events, model: sim.model, nSteps: sim.nSteps };
  return snapshotFromRun(goldenCase(id), data, report, process.version);
}

/** deep copy with every object's keys in reverse insertion order */
function reverseKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeys) as T;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

describe('golden comparator (self-test)', () => {
  const snap = snapshot('NIF');

  it('catches a 1e-7 relative perturbation at the same-Node tolerance, not at the cross-Node one', () => {
    const p = structuredClone(snap);
    p.scalars.Q_sci_max *= 1 + 1e-7;
    const d = compareSnapshots(snap, p, REL_TOL_SAME_NODE);
    expect(d.map((x) => x.key)).toEqual(['scalars.Q_sci_max']);
    expect(d[0].rel).toBeGreaterThan(0.9e-7);
    expect(d[0].rel).toBeLessThan(1.1e-7);
    expect(compareSnapshots(snap, p, REL_TOL_OTHER_NODE)).toEqual([]);
    // the same in a trace sample and in a flat-top average
    const q = structuredClone(snap);
    (q.traces.Ti as number[])[5] *= 1 - 1e-7;
    q.flatTop.P_fus = (q.flatTop.P_fus as number) * (1 + 1e-7);
    expect(compareSnapshots(snap, q, REL_TOL_SAME_NODE).map((x) => x.key)).toEqual(['flatTop.P_fus', 'traces.Ti[5]']);
    // below the tolerance: ignored
    const r = structuredClone(snap);
    r.scalars.Q_sci_max *= 1 + 1e-11;
    expect(compareSnapshots(snap, r, REL_TOL_SAME_NODE)).toEqual([]);
  });

  it('ignores key order, in comparison and in the serialized text', () => {
    const rev = reverseKeys(snap);
    expect(Object.keys(rev)).not.toEqual(Object.keys(snap));
    expect(compareSnapshots(snap, rev, 0)).toEqual([]);
    expect(serializeSnapshot(rev)).toBe(serializeSnapshot(snap));
    // a file written in any key order compares equal to a fresh run
    expect(compareSnapshots(JSON.parse(JSON.stringify(rev)), snap, 0)).toEqual([]);
  });

  it('serialization round-trips exactly (full precision)', () => {
    const text = serializeSnapshot(snap);
    const back = parseSnapshot(text);
    expect(compareSnapshots(snap, back, 0)).toEqual([]);
    expect(serializeSnapshot(back)).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('reports missing, extra and non-numeric changes', () => {
    const p = structuredClone(snap) as GoldenSnapshot & { extra?: number };
    delete (p.events as Record<string, number>).end;
    p.labels['termination.reason'] = 'Disruption';
    p.extra = 1;
    p.traces.Ti = (p.traces.Ti as number[]).slice(0, -1);
    const d = compareSnapshots(snap, p, REL_TOL_SAME_NODE);
    expect(d.map((x) => x.key)).toEqual(['events.end', 'extra', 'labels.termination.reason', `traces.Ti[${snap.traces.Ti.length - 1}]`]);
    expect(d.every((x) => x.rel === Infinity)).toBe(true);
    const table = formatDiffTable([{ case: 'NIF', diffs: d }]);
    expect(table).toMatch(/preset +key +old +new +rel diff/);
    expect(table).toMatch(/NIF +events\.end +1 +\(missing\) +—/);
    // non-finite values are stored as strings and compare by identity
    const a = structuredClone(snap), b = structuredClone(snap);
    a.flatTop.x = 'NaN'; b.flatTop.x = 'NaN';
    expect(compareSnapshots(a, b, REL_TOL_SAME_NODE)).toEqual([]);
    b.flatTop.x = 1;
    expect(compareSnapshots(a, b, REL_TOL_SAME_NODE).map((x) => x.key)).toEqual(['flatTop.x']);
    // the producing Node version is informational only
    b.flatTop.x = 'NaN'; b.meta.node = 'v99.0.0';
    expect(compareSnapshots(a, b, 0)).toEqual([]);
  });

  it('summarizes a re-record as schema change and moved, added and removed keys (update log)', () => {
    const old = structuredClone(snap) as GoldenSnapshot & { gone?: number };
    old.meta.schema = GOLDEN_SCHEMA - 1;
    old.gone = 1;
    old.scalars.Q_sci_max *= 1 + 1e-12; // any change counts, below every tolerance too
    delete (old.flatTop as Record<string, unknown>).Ti;
    delete (old.events as Record<string, unknown>).end;
    const c = summarizeChange(old, snap);
    expect(c.schema).toEqual([GOLDEN_SCHEMA - 1, GOLDEN_SCHEMA]);
    expect(c.moved.map((d) => d.key)).toEqual(['scalars.Q_sci_max']);
    expect(c.added.map((d) => d.key)).toEqual(['events.end', 'flatTop.Ti']);
    expect(c.removed.map((d) => d.key)).toEqual(['gone']);
    expect(countBySection([...c.added, { key: 'events.x', old: undefined, new: 1, rel: Infinity }])).toBe('events 2, flatTop 1');
    expect(countBySection([{ key: 'traces.Ti[3]', old: 1, new: 2, rel: 0.5 }])).toBe('traces 1');
    expect(summarizeChange(snap, structuredClone(snap))).toEqual({ moved: [], added: [], removed: [] });
    // an older schema is readable on request only
    const text = serializeSnapshot(old as GoldenSnapshot);
    expect(() => parseSnapshot(text)).toThrow(/unsupported golden schema/);
    expect(parseSnapshot(text, { anySchema: true }).meta.schema).toBe(GOLDEN_SCHEMA - 1);
    expect(() => parseSnapshot('{"a": 1}', { anySchema: true })).toThrow(/no meta object/);
  });

  it('tolerance: 1e-9 on the same Node major, 1e-6 otherwise; relative with a 1e-300 floor', () => {
    expect(toleranceFor('v24.19.0', 'v24.1.0')).toBe(1e-9);
    expect(toleranceFor('v22.11.0', 'v24.19.0')).toBe(1e-6);
    expect(toleranceFor('garbage', 'v24.19.0')).toBe(1e-6);
    expect(relDiff(0, 0)).toBe(0);
    expect(relDiff(1, 1 + 1e-7)).toBeCloseTo(1e-7, 12);
    expect(relDiff(-2, 2)).toBe(2);
    expect(relDiff(0, 1e-310)).toBeLessThan(1e-9);
  });

  it('flattens nested report fields and samples traces evenly in time', () => {
    expect(flattenScalars({ a: 1, b: { c: [2, { d: 3 }], e: 'x', f: true, g: NaN } })).toEqual({ a: 1, 'b.c[0]': 2, 'b.c[1].d': 3, 'b.f': 1 });
    const hist = [0, 1, 1, 2, 5, 9, 10].map((t) => ({ t }));
    expect(sampleIndices(hist, 6)).toEqual([0, 3, 3, 4, 4, 6]); // t_k = 0, 2, 4, 6, 8, 10 → last frame with t ≤ t_k
    expect(snap.traces.t).toHaveLength(20);
    // a second run gives the identical snapshot
    expect(compareSnapshots(runGoldenCase(goldenCase('NIF')), snap, 0)).toEqual([]);
  });
});

describe('golden snapshot content', { timeout: 30_000 }, () => {
  it('history statistics: min/max/mean of the finite samples, missing and non-finite counts', () => {
    const frames: { d: Record<string, number> }[] = [
      { d: { a: 1, b: 2 } },
      { d: { a: NaN, b: 4, c: 5 } },
      { d: { a: 3, c: Infinity } },
      { d: { a: -1, b: 6, c: -Infinity } },
    ];
    expect(historyStats(frames)).toEqual({
      a: { min: -1, max: 3, mean: 1, missing: 0, nonFinite: 1 },
      b: { min: 2, max: 6, mean: 4, missing: 1, nonFinite: 0 },
      c: { min: 5, max: 5, mean: 5, missing: 1, nonFinite: 2 },
    });
    expect(historyStats([{ d: { x: NaN } }])).toEqual({ x: { min: 'NaN', max: 'NaN', mean: 'NaN', missing: 0, nonFinite: 1 } });
    expect(historyStats([])).toEqual({});
  });

  it('a NaN, a dropped key or a changed value anywhere in the history is a mismatch', () => {
    const { sim } = run('JET');
    const base = snapshot('JET');
    const keys = new Set(sim.history.flatMap((f) => Object.keys(f.d)));
    expect(Object.keys(base.history).sort()).toEqual([...keys].sort());
    for (const s of Object.values(base.history)) expect([s.missing, s.nonFinite]).toEqual([0, 0]);
    /** keys that differ after editing a copy of the history */
    const diffAfter = (edit: (h: HistoryFrame[]) => void) => {
      const h = sim.history.map((f) => ({ ...f, d: { ...f.d } }));
      edit(h);
      return compareSnapshots(base, snapshot('JET', h), REL_TOL_SAME_NODE).map((d) => d.key);
    };
    // q95 is neither traced nor (at frame 0) inside the flat-top window: only the history sees it
    const nan = diffAfter((h) => { h[0].d.q95 = NaN; });
    expect(nan).toContain('history.q95.nonFinite');
    expect(nan.every((k) => k.startsWith('history.q95.'))).toBe(true);
    const k = Math.floor(0.3 * sim.history.length); // before the flat-top window
    const dropped = diffAfter((h) => { delete h[k].d.Ip; });
    expect(dropped).toContain('history.Ip.missing');
    expect(dropped.every((x) => x.startsWith('history.Ip.'))).toBe(true);
    const scaled = diffAfter((h) => { for (let i = 0; i <= k; i++) h[i].d.P_LH *= 1.2; });
    expect(scaled).toContain('history.P_LH.mean');
    expect(scaled.every((x) => x.startsWith('history.P_LH.'))).toBe(true);
  });

  it('1.5D: every radial profile on the full grid at mid-run and at the end, and the last equilibrium', () => {
    const { sim } = run('SPARC15-short');
    const s = snapshot('SPARC15-short');
    const withProf = sim.history.filter((f) => f.prof);
    const lastProf = withProf[withProf.length - 1];
    const tEnd = sim.history[sim.history.length - 1].t;
    expect(s.meta).toMatchObject({ fidelity: '1.5D', fuel: 'DT' });
    expect(s.profiles!.frames).toBe(withProf.length);
    expect(s.profiles!.last.t).toBe(lastProf.t);
    expect(s.profiles!.last.prof).toEqual(lastProf.prof); // all finite, so stored as numbers
    expect(Object.keys(s.profiles!.last.prof)).toEqual(expect.arrayContaining(['rho', 'q', 'j', 'johm', 'shear']));
    for (const a of Object.values(s.profiles!.last.prof)) expect(a).toHaveLength(s.profiles!.last.prof.rho.length);
    expect(s.profiles!.mid.t as number).toBeLessThanOrEqual(tEnd / 2);
    expect(s.profiles!.mid.t as number).toBeGreaterThan(tEnd / 2 - 0.01);
    const eqFrames = sim.history.filter((f) => f.eq);
    expect(s.equilibrium!.frames).toBe(eqFrames.length);
    const e = s.equilibrium!.last;
    expect(e.q95).toBe(eqFrames[eqFrames.length - 1].eq!.q95);
    expect(e.surfaces.rho).toHaveLength(10);
    const Rmin = e.surfaces.Rmin as number[], Rmax = e.surfaces.Rmax as number[];
    expect(Rmin[0]).toBeLessThan(e.Raxis as number);
    expect(Rmax[0]).toBeGreaterThan(e.Raxis as number);
    for (let i = 1; i < 10; i++) { expect(Rmin[i]).toBeLessThan(Rmin[i - 1]); expect(Rmax[i]).toBeGreaterThan(Rmax[i - 1]); }
    expect(s.geometry).toMatchObject({ profiles: 1, nRho: s.profiles!.last.prof.rho.length });
    expect(typeof s.geometry.shafranov).toBe('number');
    // a change in one profile point or in the equilibrium is a mismatch
    const h = sim.history.map((f) => (f === lastProf ? { ...f, prof: { ...f.prof!, johm: f.prof!.johm.map((x, i) => (i === 10 ? x * (1 + 1e-6) : x)) } } : f));
    const eqLast = eqFrames[eqFrames.length - 1];
    h[sim.history.indexOf(eqLast)] = { ...h[sim.history.indexOf(eqLast)], eq: { ...eqLast.eq!, Raxis: eqLast.eq!.Raxis + 1e-3 } };
    expect(compareSnapshots(s, snapshot('SPARC15-short', h), REL_TOL_SAME_NODE).map((d) => d.key)).toEqual(['equilibrium.last.Raxis', 'profiles.last.prof.johm[10]']);
    // 0D and pulsed cases carry neither section
    expect(snapshot('JET').profiles).toBeUndefined();
    expect(snapshot('JET').equilibrium).toBeUndefined();
  });
});

describe('golden cases', () => {
  it('cover every method, every 1.5D preset, and name valid presets', () => {
    const methods = new Set(GOLDEN_CASES.map((c) => caseConfig(c).method));
    expect([...methods].sort()).toEqual(['frc', 'icf_direct', 'icf_indirect', 'maglif', 'mirror', 'mtf_liner', 'mtf_piston', 'muon', 'spherical_tokamak', 'stellarator', 'tokamak', 'zpinch_sfs']);
    for (const p of PRESETS) expect(GOLDEN_CASES.some((c) => c.preset === p.id)).toBe(true);
    expect(new Set(GOLDEN_CASES.map((c) => c.id)).size).toBe(GOLDEN_CASES.length);
    for (const id of FAST_CASES) expect(() => goldenCase(id)).not.toThrow();
  });
});

describe('golden regression (fast subset; full suite: npm run golden)', { timeout: 30_000 }, () => {
  for (const id of FAST_CASES) {
    it(`${id} matches test/golden/${id}.json`, () => {
      const stored = parseSnapshot(readFileSync(goldenFile(id), 'utf8'));
      const fresh = snapshot(id);
      const diffs = compareSnapshots(stored, fresh, toleranceFor(stored.meta.node));
      expect(diffs, `golden mismatch — if intended, run npm run golden:update -- --reason "…"\n${formatDiffTable([{ case: id, diffs }])}`).toEqual([]);
    });
  }
});
