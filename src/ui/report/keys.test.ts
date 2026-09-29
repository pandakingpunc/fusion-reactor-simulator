/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeReportKey, describeReportValue, knownReportKeys, reportKeyInfo } from './keys';
import { findTerm } from '../../edu/glossary';

const GOLDEN = fileURLToPath(new URL('../../../test/golden/', import.meta.url));

/** the engineering and extras keys the reports of every golden case carry (their numbers and booleans; a string value is not in the file) */
function goldenKeys(): string[] {
  const keys = new Set<string>();
  for (const f of readdirSync(GOLDEN)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(GOLDEN + f, 'utf8')) as { scalars?: Record<string, unknown> };
    for (const k of Object.keys(j.scalars ?? {})) {
      const m = /^(?:engineering|extras)\.(.+)$/.exec(k);
      if (m) keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

/** keys whose values are text: the golden files do not list them, so they are named here (from the report builders of src/physics) */
const TEXT_KEYS = [
  'Detachment state', 'Model', 'Coupling', 'q(0) / q95 (final)', 'Transport steps (accepted / rejected by the error test)',
  'Newton iterations / Jacobians / Picard fallbacks', 'β (FRC)', 'End loss dominant', 'Why Q<1?', 'Status',
];

describe('report key table', () => {
  it('has an English and a Turkish label for every key of the golden reports', () => {
    const keys = [...goldenKeys(), ...TEXT_KEYS];
    expect(keys.length).toBeGreaterThan(80);
    const missing = keys.filter((k) => !reportKeyInfo(k));
    expect(missing).toEqual([]);
  });

  it('has no row that no report carries (a renamed physics key must not leave a stale row)', () => {
    const live = new Set([...goldenKeys(), ...TEXT_KEYS]);
    // keys of paths the golden cases do not take (a 1.5D run without Newton iterations, the MTF/muon/FRC text keys) are named in TEXT_KEYS or below
    const OFF_GOLDEN = ['LCOE ($/MWh)', 'Newton iterations / Jacobians / Picard fallbacks'];
    const stale = knownReportKeys().filter((k) => !live.has(k) && !OFF_GOLDEN.includes(k));
    expect(stale).toEqual([]);
  });

  it('gives every row two different labels that are not the raw key, and a Turkish text for each', () => {
    for (const k of knownReportKeys()) {
      const en = describeReportKey(k, 'en'), tr = describeReportKey(k, 'tr');
      expect(en.label.length, k).toBeGreaterThan(1);
      expect(tr.label.length, k).toBeGreaterThan(1);
      // the unit is its own column, not left inside the label as in the raw key
      const inKey = /\(([^)]+)\)$/.exec(k);
      if (inKey && inKey[1] === en.unit) expect(en.label, k).not.toContain(`(${inKey[1]})`);
      expect(tr.unit === '' || en.unit !== '' , k).toBe(true);
    }
    // the symbol-only labels are the same in both languages by design; the words are not
    const same = knownReportKeys().filter((k) => describeReportKey(k, 'en').label === describeReportKey(k, 'tr').label);
    expect(same.sort()).toEqual(['Model']);
  });

  it('splits the unit from the label and translates the one unit that is a word', () => {
    expect(describeReportKey('Cryo pulse length (s)', 'en')).toEqual({ label: 'Pulse length used for the cryoplant', unit: 's' });
    expect(describeReportKey('Cryo pulse length (s)', 'tr').label).toBe('Kriyojenik tesis için alınan atım süresi');
    expect(describeReportKey('dpa/year', 'en').unit).toBe('dpa/year');
    expect(describeReportKey('dpa/year', 'tr').unit).toBe('dpa/yıl');
    expect(describeReportKey('n_0 (1e20 m⁻³)', 'en').unit).toBe('10²⁰ m⁻³');
    expect(describeReportKey('TF stress margin', 'en').unit).toBe('');
  });

  it('shows an unknown key as written', () => {
    expect(describeReportKey('Some new key (kg)', 'tr')).toEqual({ label: 'Some new key (kg)', unit: '' });
  });

  it('points only at glossary terms that exist', () => {
    for (const k of knownReportKeys()) {
      const term = describeReportKey(k, 'en').term;
      if (term) expect(findTerm(term), `${k} -> ${term}`).toBeDefined();
    }
  });

  it('translates the phrases the physics writes as values, and the patterned ones', () => {
    expect(describeReportValue('partially detached', 'en')).toBe('partially detached');
    expect(describeReportValue('partially detached', 'tr')).toBe('kısmen ayrılmış');
    expect(describeReportValue('n/a (net<0)', 'tr')).toBe('yok (net < 0)');
    expect(describeReportValue('hohlraum 15%', 'tr')).toBe('hohlraum %15');
    expect(describeReportValue('direct 80%', 'tr')).toBe('doğrudan %80');
    expect(describeReportValue('≥ 3.20 (> 100 % in 40 % of the flat top)', 'tr')).toBe('≥ 3.20 (düz tepenin %40’sinde > %100)');
    expect(describeReportValue('3.10 / 4.20', 'tr')).toBe('3.10 / 4.20');
  });
});
