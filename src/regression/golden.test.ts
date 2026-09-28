/// <reference types="node" />
/**
 * Golden regression: comparator self-test and a fast subset of the golden suite
 * (the full suite is `npm run golden`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FAST_CASES, GOLDEN_CASES, GoldenSnapshot, REL_TOL_OTHER_NODE, REL_TOL_SAME_NODE, caseConfig, compareSnapshots, flattenScalars,
  formatDiffTable, goldenCase, parseSnapshot, relDiff, runGoldenCase, sampleIndices, serializeSnapshot, toleranceFor,
} from './golden';
import { PRESETS } from '../physics/presets';

const goldenFile = (id: string) => new URL(`../../test/golden/${id}.json`, import.meta.url);

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
  const snap = runGoldenCase(goldenCase('NIF'));

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
      const fresh = runGoldenCase(goldenCase(id));
      const diffs = compareSnapshots(stored, fresh, toleranceFor(stored.meta.node));
      expect(diffs, `golden mismatch — if intended, run npm run golden:update -- --reason "…"\n${formatDiffTable([{ case: id, diffs }])}`).toEqual([]);
    });
  }
});
