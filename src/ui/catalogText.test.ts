/**
 * The Turkish catalog (src/i18n/catalog.tr.ts): the texts that the physics layer writes in English and the interface shows (method and
 * preset names, diagnostic labels and groups, scenario controls, the fixed lines of a report, the validation criteria). Every such text that
 * has words has an entry, and no entry is left without its text. The sweep of src/ui/pseudoLocale.test.tsx finds what is shown on the
 * screens; this one finds what a screen could show for another configuration.
 */
import { describe, expect, it } from 'vitest';
import { catalogTr } from '../i18n/catalog.tr';
import { wizardTr } from '../i18n/wizard.tr';
import { PRESETS } from '../physics/presets';
import { Simulation, createModel } from '../physics/simulation';
import { SCENARIO_CONTROLS } from '../physics/scenario';
import { METHOD_LABELS, ReactorConfig } from '../physics/types';
import { TESTS } from './pool/Validation';
import { plainWords } from './testing/pseudo';

const hasWords = (s: string) => plainWords(s).length > 0;

/** texts that components write as literals: the profile chart, the cross-section (see ProfileChart.tsx and CrossSection.tsx) */
const LITERALS = [
  'current', 'power', 'total', 'ohmic', 'bootstrap', 'driven', 'aux', 'rad', 'shear s', 'profiles available for 1.5D runs', 'DISRUPTION',
];

/** the methods the report builders belong to, one preset each, run for a moment */
const REPORT_PRESETS = ['ITER', 'MASTU', 'W7X', 'NIF', 'DIRECT', 'Z', 'GF', 'FRXL', 'ZAP', 'TAE', 'MIRROR', 'MUON'];

function reportTexts(): Set<string> {
  const out = new Set<string>();
  for (const id of REPORT_PRESETS) {
    const preset = PRESETS.find((p) => p.id === id)!;
    const cfg: ReactorConfig = 't_end' in preset.cfg && (preset.cfg.method === 'tokamak' || preset.cfg.method === 'spherical_tokamak' || preset.cfg.method === 'stellarator')
      ? { ...preset.cfg, t_end: 2 } : preset.cfg;
    const sim = new Simulation(cfg);
    sim.runAll();
    const r = sim.report();
    for (const s of r.scoreBreakdown) { out.add(s.label); out.add(s.note); }
    for (const h of r.historical) { out.add(h.label); out.add(h.note); }
  }
  return out;
}

function sources(): Map<string, string> {
  const src = new Map<string, string>();
  const add = (text: string | undefined, from: string) => { if (text && hasWords(text) && !src.has(text)) src.set(text, from); };
  for (const label of Object.values(METHOD_LABELS)) add(label, 'method label');
  for (const p of PRESETS) add(p.name, `preset ${p.id}`);
  for (const [key, info] of Object.entries(SCENARIO_CONTROLS)) add(info.label, `scenario control ${key}`);
  for (const p of PRESETS) {
    const model = createModel(p.cfg);
    for (const s of model.diagSpecs) { add(s.label, `diagnostic of ${p.id}`); add(s.group, `diagnostic group of ${p.id}`); }
  }
  for (const text of reportTexts()) add(text, 'report line');
  for (const test of TESTS) {
    add(test.title, `validation ${test.id}`);
    for (const c of test.criteria) { add(c.label, `validation ${test.id}`); add(c.source, `validation ${test.id}`); }
  }
  for (const text of LITERALS) add(text, 'component literal');
  return src;
}

describe('Turkish catalog of the physics layer', () => {
  const src = sources();

  it('has an entry for every text that the physics layer writes and the interface shows', () => {
    expect(src.size).toBeGreaterThan(150);
    const dictionary = { ...wizardTr, ...catalogTr };
    const missing = [...src].filter(([text]) => dictionary[text] === undefined).map(([text, from]) => `${from}: ${text}`);
    expect(missing).toEqual([]);
  });

  it('has no entry whose English text is no longer written anywhere (a renamed label must not leave a stale row)', () => {
    const stale = Object.keys(catalogTr).filter((k) => !src.has(k) && !hasWordsNot(k));
    expect(stale).toEqual([]);
  });

  it('agrees with the wizard dictionary where both have the text, keeps the numbers of the English text and is not empty', () => {
    const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.')).sort();
    for (const [en, tr] of Object.entries(catalogTr)) {
      expect(tr.trim(), en).not.toBe('');
      expect(nums(tr), en).toEqual(nums(en));
      if (wizardTr[en] !== undefined) expect(tr, `${en} is in both dictionaries`).toBe(wizardTr[en]);
    }
  });

  it('is Turkish and not a copy: most entries differ from the English text (the rest are symbols and proper names)', () => {
    const same = Object.entries(catalogTr).filter(([en, tr]) => en === tr);
    expect(same.length / Object.keys(catalogTr).length).toBeLessThan(0.1);
  });
});

/** an entry whose text has no words is not needed by the interface (it passes through unchanged); none is expected in the file */
function hasWordsNot(text: string): boolean { return !hasWords(text); }
