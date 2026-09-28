/// <reference types="node" />
/**
 * Integrity of the literature reference table: ids, coverage of every preset, ranges that contain the
 * published value and its uncertainty, citations, documented known failures, and metric paths that
 * point at outputs the presets really produce (checked against the golden snapshots).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets';
import { CONFINEMENT_FACTOR, REFERENCE_CHECKS, type PolicyTolerance, type ReferenceCheck, publishedBand, roundOutward, widen } from './references';
import {
  evaluateCheck, fmt, fmtReference, formatOutcomeLine, isFailure, markdownTable, parseChecks, selectChecks, tableProblems, tally,
} from './evaluate';

const GOLDEN_DIR = new URL('../../../test/golden/', import.meta.url);

describe('reference table integrity', () => {
  it('ids are unique and named <preset>.<quantity>', () => {
    const ids = REFERENCE_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of REFERENCE_CHECKS) expect(c.id).toMatch(new RegExp(`^${c.preset}\\.[A-Za-z0-9_]+$`));
  });

  it('every preset has at least one check and every check names an existing preset', () => {
    const presetIds = PRESETS.map((p) => p.id);
    for (const id of presetIds) expect(REFERENCE_CHECKS.some((c) => c.preset === id), `preset ${id} has no check`).toBe(true);
    for (const c of REFERENCE_CHECKS) expect(presetIds, c.id).toContain(c.preset);
  });

  it('accept ranges are finite, ordered and contain the published value ± its uncertainty (or its band)', () => {
    for (const c of REFERENCE_CHECKS) {
      const [lo, hi] = c.accept;
      expect(Number.isFinite(lo) && Number.isFinite(hi), c.id).toBe(true);
      expect(lo, c.id).toBeLessThan(hi);
      const u = c.uncertainty ?? 0;
      expect(u, c.id).toBeGreaterThanOrEqual(0);
      expect(c.value - u, c.id).toBeGreaterThanOrEqual(lo);
      expect(c.value + u, c.id).toBeLessThanOrEqual(hi);
      if (c.band) {
        expect(c.band[0], c.id).toBeGreaterThanOrEqual(lo);
        expect(c.band[1], c.id).toBeLessThanOrEqual(hi);
        expect(c.value, c.id).toBeGreaterThanOrEqual(c.band[0]);
        expect(c.value, c.id).toBeLessThanOrEqual(c.band[1]);
      }
    }
    expect(tableProblems(REFERENCE_CHECKS, PRESETS.map((p) => p.id))).toEqual([]);
  });

  it('a policy-tolerance range is the published band widened by that tolerance (recomputed independently)', () => {
    // factors of the acceptance policy in references.ts, restated here on purpose
    const factor: Record<PolicyTolerance, [number, number]> = {
      confinement: [1 / Math.exp(0.29), Math.exp(0.29)], temperature: [0.7, 1.3], yield: [1 / 3, 3], gain: [0.5, 2],
    };
    let n = 0;
    for (const c of REFERENCE_CHECKS) {
      if (c.tolerance === 'stated') continue;
      n++;
      const u = c.uncertainty ?? 0;
      const [bLo, bHi] = c.band ?? [c.value - u, c.value + u];
      const [lo, hi] = [bLo * factor[c.tolerance][0], bHi * factor[c.tolerance][1]];
      // rounded outward to three significant digits: never narrower, at most 1 % wider
      expect(c.accept[0], `${c.id} lower bound`).toBeLessThanOrEqual(lo * (1 + 1e-12));
      expect(c.accept[0], `${c.id} lower bound`).toBeGreaterThan(lo * 0.99);
      expect(c.accept[1], `${c.id} upper bound`).toBeGreaterThanOrEqual(hi * (1 - 1e-12));
      expect(c.accept[1], `${c.id} upper bound`).toBeLessThan(hi * 1.01);
      expect(c.accept, c.id).toEqual(widen(c.tolerance, publishedBand(c)));
    }
    expect(n).toBeGreaterThanOrEqual(10);
    for (const t of ['confinement', 'temperature', 'yield', 'gain'] as const) {
      expect(REFERENCE_CHECKS.some((c) => c.tolerance === t), t).toBe(true);
    }
  });

  it('H98 of a preset that confines with IPB98(y,2) times its input H98 is a sanity check, not a benchmark', () => {
    // τ_E = H98_input × τ_IPB98(y,2) in the 0D model, so the derived H98 mostly returns the input
    const byId = new Map(PRESETS.map((p) => [p.id, p.cfg as { scaling?: string }]));
    const h98 = REFERENCE_CHECKS.filter((c) => c.path === 'derived.H98y2');
    expect(h98.length).toBeGreaterThan(0);
    for (const c of h98) {
      if (byId.get(c.preset)?.scaling === 'IPB98y2') {
        expect(c.kind, c.id).toBe('sanity');
        expect(c.basis, c.id).toMatch(/input H98/);
      }
    }
  });

  it('every check is cited: full source with a year, short ref, DOI format, basis and kind', () => {
    for (const c of REFERENCE_CHECKS) {
      expect(c.source.length, c.id).toBeGreaterThan(40);
      expect(c.source, c.id).toMatch(/\((19|20)\d\d\)/);
      expect(c.ref, c.id).toMatch(/(19|20)\d\d$/);
      if (c.doi !== undefined) expect(c.doi, c.id).toMatch(/^10\.\d{4,9}\/\S+$/);
      expect(c.basis.length, c.id).toBeGreaterThan(20);
      expect(['validation', 'benchmark', 'sanity'], c.id).toContain(c.kind);
      // measured values and design predictions must be traceable
      if (c.kind !== 'sanity') expect(c.doi, `${c.id} needs a DOI`).toBeDefined();
    }
  });

  it('a known failure explains itself', () => {
    const known = REFERENCE_CHECKS.filter((c) => c.knownFailure !== undefined);
    expect(known.length).toBeGreaterThan(0);
    for (const c of known) expect(c.knownFailure!.length, c.id).toBeGreaterThan(60);
  });

  it('metric paths point at outputs the preset produces (golden snapshot keys)', () => {
    let checked = 0;
    for (const c of REFERENCE_CHECKS) {
      const file = new URL(`${c.preset}.json`, GOLDEN_DIR);
      const [scope, key] = [c.path.slice(0, c.path.indexOf('.')), c.path.slice(c.path.indexOf('.') + 1)];
      expect(['flatTop', 'report', 'engineering', 'burn', 'derived'], c.id).toContain(scope);
      if (!existsSync(file) || scope === 'burn' || scope === 'derived') continue;
      const snap = JSON.parse(readFileSync(file, 'utf8')) as { flatTop: Record<string, number>; scalars: Record<string, number> };
      const found = scope === 'flatTop' ? key in snap.flatTop : scope === 'report' ? key in snap.scalars : `engineering.${key}` in snap.scalars;
      expect(found, `${c.id}: ${c.path} not in test/golden/${c.preset}.json`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('check evaluation', () => {
  const base: ReferenceCheck = {
    id: 'X.q', preset: 'X', metric: 'q', path: 'flatTop.q', value: 1, unit: 'keV', ref: 'Doe 2020',
    source: 'J. Doe, "A value", J. Test 1 (2020) 1', accept: [0.5, 2], tolerance: 'stated', kind: 'validation', basis: 'test',
  };
  const known: ReferenceCheck = { ...base, id: 'X.k', knownFailure: 'documented reason' };

  it('pass / fail / error, and known failures that fail or unexpectedly pass', () => {
    expect(evaluateCheck(base, 1).status).toBe('pass');
    expect(evaluateCheck(base, 0.5).status).toBe('pass'); // inclusive bounds
    expect(evaluateCheck(base, 2).status).toBe('pass');
    expect(evaluateCheck(base, 2.01).status).toBe('fail');
    expect(evaluateCheck(base, NaN)).toMatchObject({ status: 'fail', value: null });
    expect(evaluateCheck(base, Infinity).status).toBe('fail');
    expect(evaluateCheck(base, 1, 'worker crashed')).toMatchObject({ status: 'error', value: null, error: 'worker crashed' });
    expect(evaluateCheck(known, 5).status).toBe('known-fail');
    expect(evaluateCheck(known, 1).status).toBe('xpass');
    // a missing value is a real failure even for a documented known failure
    expect(evaluateCheck(known, NaN).status).toBe('fail');
    expect(['pass', 'known-fail', 'xpass'].map((s) => isFailure(s as never))).toEqual([false, false, false]);
    expect(['fail', 'error'].map((s) => isFailure(s as never))).toEqual([true, true]);
  });

  it('tallies outcomes and selects checks by preset and kind', () => {
    const t = tally([evaluateCheck(base, 1), evaluateCheck(base, 9), evaluateCheck(known, 9), evaluateCheck(known, 1), evaluateCheck(base, 1, 'x')]);
    expect(t).toEqual({ executed: 5, pass: 1, fail: 1, error: 1, knownFail: 1, xpass: 1 });
    expect(selectChecks(REFERENCE_CHECKS, ['NIF']).map((c) => c.id)).toEqual(['NIF.G']);
    expect(selectChecks(REFERENCE_CHECKS, ['TAE'], ['benchmark'])).toEqual([]);
    expect(selectChecks(REFERENCE_CHECKS, undefined, ['sanity']).every((c) => c.kind === 'sanity')).toBe(true);
  });

  it('formats report lines and numbers', () => {
    expect(formatOutcomeLine(evaluateCheck(base, 1.234))).toBe('  PASS        X        q = 1.23 keV (expected 0.5–2)  [Doe 2020]');
    expect(formatOutcomeLine(evaluateCheck(known, 7))).toMatch(/^ {2}KNOWN-FAIL {2}X +q = 7 keV/);
    expect(formatOutcomeLine(evaluateCheck(base, 1, 'boom'))).toMatch(/^ {2}FAIL +X +q — run failed/);
    expect([fmt(1.1e13), fmt(0.000123), fmt(0), fmt(12345), fmt(null), fmt(NaN)]).toEqual(['1.10e+13', '1.23e-4', '0', '12300', 'n/a', 'n/a']);
  });

  it('renders a Markdown table with or without model values, with known-failure notes', () => {
    const plain = markdownTable([base, known]).split('\n');
    expect(plain[0]).toBe('| Check | Kind | Metric | Reference | Accepted | Source |');
    expect(plain[2]).toBe('| `X.q` | validation | q | 1 keV | 0.5–2 keV | Doe 2020 |');
    expect(plain.at(-1)).toBe('- `X.k` (known failure): documented reason');
    const res = markdownTable([evaluateCheck(base, 1), evaluateCheck(known, 9)]).split('\n');
    expect(res[0]).toContain('| Model | Status |');
    expect(res[3]).toContain('| 9 keV | KNOWN-FAIL |');
    const full = markdownTable(REFERENCE_CHECKS);
    for (const c of REFERENCE_CHECKS) expect(full).toContain(`\`${c.id}\``);
    expect(full).toContain('[doi:10.1103/PhysRevLett.125.155002](https://doi.org/10.1103/PhysRevLett.125.155002)');
  });
});

describe('acceptance policy helpers', () => {
  it('rounds outward to three significant digits, absorbing binary noise', () => {
    expect(roundOutward(0.7 * 1.3, 'down')).toBe(0.91); // 0.9099999999999999
    expect(roundOutward(1.7 * 1.3, 'up')).toBe(2.21); // 2.2100000000000004
    expect(roundOutward(0.38912, 'down')).toBe(0.389);
    expect(roundOutward(0.38912, 'up')).toBe(0.39);
    expect(roundOutward(1.1e13 / 3, 'down')).toBe(3.66e12);
    expect(roundOutward(3.3e13, 'up')).toBe(3.3e13);
    expect(roundOutward(0, 'up')).toBe(0);
  });

  it('widens a published band by each policy tolerance', () => {
    expect(widen('gain', [10, 10])).toEqual([5, 20]);
    expect(widen('temperature', [1.3, 1.7])).toEqual([0.91, 2.21]);
    expect(widen('yield', [1.1e13, 1.1e13])).toEqual([3.66e12, 3.3e13]);
    expect(widen('confinement', [1, 1])).toEqual([0.748, 1.34]);
    expect(CONFINEMENT_FACTOR).toBeCloseTo(1.3364, 4);
    expect(publishedBand({ value: 2, uncertainty: 0.5 })).toEqual([1.5, 2.5]);
    expect(publishedBand({ value: 2 })).toEqual([2, 2]);
    expect(publishedBand({ value: 0.64, uncertainty: 0.1, band: [0.52, 0.64] })).toEqual([0.52, 0.64]);
  });

  it('shows a band next to the reference value', () => {
    const jt = REFERENCE_CHECKS.find((c) => c.band !== undefined)!;
    expect(fmtReference(jt)).toBe(`${fmt(jt.value)} (${fmt(jt.band![0])}–${fmt(jt.band![1])})${jt.unit ? ` ${jt.unit}` : ''}`);
  });
});

describe('table problems and JSON tables', () => {
  const ok: ReferenceCheck = {
    id: 'NIF.G', preset: 'NIF', metric: 'Gain G', path: 'report.Q_sci_max', value: 1.5, uncertainty: 0.1, unit: '', ref: 'Doe 2020',
    source: 'J. Doe, "A value", J. Test 1 (2020) 1', accept: [0.7, 3.2], tolerance: 'gain', kind: 'validation', basis: 'band ×/÷ 2',
  };
  const ids = ['NIF', 'Z'];

  it('accepts a sound table and names every problem of an unsound one', () => {
    expect(tableProblems([ok], ids)).toEqual([]);
    const bad: ReferenceCheck[] = [
      { ...ok, accept: [0.75, 3.2] }, // hand-typed range that drifted from the gain tolerance
      { ...ok, id: 'NIF.G' }, // duplicate
      { ...ok, id: 'Z.x', preset: 'Z', path: 'derived.Nope' as never },
      { ...ok, id: 'Q.x', preset: 'Q', path: 'nowhere' as never },
      { ...ok, id: 'NIF.s', tolerance: 'stated', accept: [1.45, 1.6], basis: 'no widening given' },
      { ...ok, id: 'NIF.b', band: [1.6, 1.8], uncertainty: undefined, tolerance: 'stated', accept: [0, 5], basis: 'a bound' },
      { ...ok, id: 'NIF.r', accept: [3, 1] },
    ];
    const p = tableProblems(bad, ids);
    expect(p).toContainEqual('NIF.G: accept 0.75–3.2 is not the gain tolerance of the band 1.4–1.6: expected [0.7, 3.2]');
    expect(p).toContain('NIF.G: duplicate id');
    expect(p).toContainEqual(expect.stringMatching(/^Z\.x: unknown derived metric 'derived\.Nope'/));
    expect(p).toContain("Q.x: unknown preset 'Q'");
    expect(p).toContainEqual(expect.stringMatching(/^Q\.x: metric path 'nowhere' must be <scope>\.<key>/));
    expect(p).toContainEqual(expect.stringMatching(/^NIF\.s: accept 1\.45–1\.6 does not contain the published band 1\.4–1\.6/));
    expect(p).toContainEqual(expect.stringMatching(/^NIF\.s: tolerance 'stated' needs the widening/));
    expect(p).toContain('NIF.b: value 1.5 outside its band 1.6–1.8');
    expect(p).toContain('NIF.r: accept must be a finite range [lo, hi] with lo < hi');
  });

  it('parses a JSON table, rejecting wrong types and policy problems', () => {
    expect(parseChecks(JSON.parse(JSON.stringify([ok])), ids)).toEqual([ok]);
    expect(parseChecks([], ids)).toEqual([]);
    expect(() => parseChecks({ checks: [] }, ids)).toThrow(/must be a JSON array/);
    expect(() => parseChecks([{ ...ok, value: '1.5' }, 3], ids)).toThrow(/check #0 \(NIF\.G\): 'value' must be a finite number\n {2}check #1: must be an object/);
    expect(() => parseChecks([{ ...ok, accept: [1] }], ids)).toThrow(/'accept' must be \[lo, hi\]/);
    expect(() => parseChecks([{ ...ok, preset: 'ITER' }], ids)).toThrow(/NIF\.G: id must be <preset>\.<quantity>\n {2}NIF\.G: unknown preset 'ITER'/);
  });
});
