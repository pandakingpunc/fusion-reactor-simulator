import { beforeAll, describe, expect, it } from 'vitest';
import { wizardTr } from '../../i18n/wizard.tr';
import type { Method } from '../../physics/types';
import { ADVANCED_FIELDS } from './advanced';
import { METHOD_INFO, PRESETS, STEP_TITLES, stepsFor } from './schema';
import { loadWizardText, wizText } from './wizText';

/** every text the wizard shows that is not in the message dictionary: label, hint, option, unit, step title and note, method card, preset description */
function wizardTexts(): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => { if (s) out.add(s); };
  for (const m of Object.keys(METHOD_INFO) as Method[]) {
    for (const st of stepsFor(m)) {
      add(st.title); add(st.note);
      for (const f of st.fields) {
        if (!f.labelKey) add(f.label);
        if (!f.hintKey) add(f.hint);
        for (const o of f.options ?? []) add(o.label);
        add(f.unit);
      }
    }
  }
  for (const fields of Object.values(ADVANCED_FIELDS)) {
    for (const f of fields) { add(f.label); add(f.hint); add(f.unit); for (const o of f.options ?? []) add(o.label); }
  }
  for (const t of Object.values(STEP_TITLES)) add(t);
  for (const i of Object.values(METHOD_INFO)) { add(i.name); add(i.desc); add(i.group); }
  for (const p of PRESETS) { add(p.desc); add(p.validation); }
  return out;
}

/**
 * a text that has words to translate: three lowercase letters in a row (P_NBI, keV, 'D-T' and the like are symbols); the step titles always;
 * and a text with a decimal (R=2.96 m): Turkish writes the comma, so it has its own entry even when it has no word ("1.5D" is a name)
 */
const hasWords = (s: string) => /[a-z]{3,}/.test(s) || /\d\.\d(?!D)/.test(s) || (Object.values(STEP_TITLES) as string[]).includes(s);

describe('Turkish texts of the wizard', () => {
  it('has an entry for every text of the wizard that has words', () => {
    const missing = [...wizardTexts()].filter((s) => hasWords(s) && wizardTr[s] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no entry whose English text is no longer in the wizard', () => {
    const texts = wizardTexts();
    expect(Object.keys(wizardTr).filter((k) => !texts.has(k))).toEqual([]);
  });

  it('is not empty, and keeps the numbers of the English text (decimals with a comma)', () => {
    const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.')).sort();
    for (const [en, tr] of Object.entries(wizardTr)) {
      expect(tr.trim(), en).not.toBe('');
      expect(nums(tr), en).toEqual(nums(en));
    }
  });

  it('translates a label and leaves a text without an entry as it is', async () => {
    const en = wizText('en');
    expect(en('Major radius R')).toBe('Major radius R');
    expect(wizText('tr')('Major radius R')).toBe('Major radius R'); // Turkish is not loaded yet: the English text shows
    await loadWizardText('tr');
    const tr = wizText('tr');
    expect(tr('Major radius R')).toBe('Büyük yarıçap R');
    expect(tr('A text nobody wrote')).toBe('A text nobody wrote');
    expect(en('Major radius R')).toBe('Major radius R');
  });
});

describe('the wizard dictionary is Turkish and not a copy', () => {
  beforeAll(() => loadWizardText('tr'));
  it('differs from the English text for the great majority of entries (the rest are symbols and proper names)', () => {
    const same = Object.entries(wizardTr).filter(([en, tr]) => en === tr).map(([en]) => en);
    expect(same.length / Object.keys(wizardTr).length).toBeLessThan(0.1);
  });
});
