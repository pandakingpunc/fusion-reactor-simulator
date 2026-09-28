/// <reference types="node" />
/**
 * Integrity of the literature reference table: ids, coverage of every preset, ranges that contain the
 * published value and its uncertainty, citations, documented known failures, and metric paths that
 * point at outputs the presets really produce (checked against the golden snapshots).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets';
import { REFERENCE_CHECKS, type ReferenceCheck } from './references';
import { evaluateCheck, fmt, formatOutcomeLine, isFailure, markdownTable, selectChecks, tally } from './evaluate';

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

  it('accept ranges are finite, ordered and contain the published value ± its uncertainty', () => {
    for (const c of REFERENCE_CHECKS) {
      const [lo, hi] = c.accept;
      expect(Number.isFinite(lo) && Number.isFinite(hi), c.id).toBe(true);
      expect(lo, c.id).toBeLessThan(hi);
      const u = c.uncertainty ?? 0;
      expect(u, c.id).toBeGreaterThanOrEqual(0);
      expect(c.value - u, c.id).toBeGreaterThanOrEqual(lo);
      expect(c.value + u, c.id).toBeLessThanOrEqual(hi);
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
    source: 'J. Doe, "A value", J. Test 1 (2020) 1', accept: [0.5, 2], kind: 'validation', basis: 'test',
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
