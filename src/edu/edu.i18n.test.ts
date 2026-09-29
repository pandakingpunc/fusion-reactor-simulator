import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_GROUPS, findTerm, termKeys, termOfDiag } from './glossary';
import { eduEn } from './i18n/en';
import { eduTr } from './i18n/tr';
import { eduTranslator, isEduLoaded, loadEduLocale } from './i18n';
import { MISSIONS } from './missions';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('education dictionaries', () => {
  it('English and Turkish define exactly the same keys', () => {
    const en = Object.keys(eduEn).sort(), tr = Object.keys(eduTr).sort();
    expect(tr.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !tr.includes(k))).toEqual([]);
  });

  it('every Turkish text keeps the placeholders of the English one and is not empty', () => {
    for (const k of Object.keys(eduEn) as (keyof typeof eduEn)[]) {
      expect(eduTr[k].trim(), k).not.toBe('');
      expect(placeholders(eduTr[k]), k).toEqual(placeholders(eduEn[k]));
    }
  });

  it('no Turkish text is a copy of the English one, except symbols and proper names', () => {
    const same = (Object.keys(eduEn) as (keyof typeof eduEn)[]).filter((k) => eduEn[k] === eduTr[k]);
    // symbols (Q_eng), a word that is the same in both languages (log) and the like
    for (const k of same) expect(eduEn[k].length, k).toBeLessThan(16);
  });

  it('translates with the active dictionary and falls back to English until it is loaded', async () => {
    expect(eduTranslator('en')('edu.progress', { n: 2, total: 10 })).toBe('2 of 10 missions solved');
    expect(isEduLoaded('tr')).toBe(false);
    expect(eduTranslator('tr')('edu.solved')).toBe('Solved');
    await loadEduLocale('tr');
    expect(isEduLoaded('tr')).toBe(true);
    expect(eduTranslator('tr')('edu.solved')).toBe('Çözüldü');
    expect(eduTranslator('tr')('edu.progress', { n: 2, total: 10 })).toBe('10 görevin 2 tanesi çözüldü');
  });
});

describe('the glossary', () => {
  it('has a name and a definition in both languages for every term, and every group is used', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(40);
    for (const g of GLOSSARY) {
      const { name, def } = termKeys(g.id);
      for (const d of [eduEn, eduTr] as Record<string, string>[]) {
        expect(d[name], name).toBeTruthy();
        expect(d[def], def).toBeTruthy();
        expect(d[def].length, def).toBeGreaterThan(40);
      }
      expect(GLOSSARY_GROUPS).toContain(g.group);
    }
    for (const grp of GLOSSARY_GROUPS) {
      expect(GLOSSARY.some((g) => g.group === grp), grp).toBe(true);
      expect(eduEn[`grp.${grp}`]).toBeTruthy();
    }
  });

  it('has no term without a dictionary entry: every glossary key of the dictionaries belongs to a term', () => {
    const ids = new Set(GLOSSARY.map((g) => g.id));
    const fromDict = new Set(Object.keys(eduEn).filter((k) => k.startsWith('gl.')).map((k) => k.split('.')[1]));
    expect([...fromDict].filter((i) => !ids.has(i))).toEqual([]);
  });

  it('term ids are unique and every related term exists', () => {
    const ids = GLOSSARY.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GLOSSARY) for (const r of g.related) expect(findTerm(r), `${g.id} → ${r}`).toBeDefined();
    for (const g of GLOSSARY) expect(g.related, g.id).not.toContain(g.id);
  });

  it('finds the term of a diagnostic channel', () => {
    expect(termOfDiag('betaN')?.id).toBe('betaN');
    expect(termOfDiag('Q')?.id).toBe('qSci');
    expect(termOfDiag('no_such_channel')).toBeUndefined();
  });

  it('every term a mission points at is in the glossary', () => {
    for (const m of MISSIONS) for (const t of m.terms) expect(findTerm(t), `${m.id} → ${t}`).toBeDefined();
  });
});
