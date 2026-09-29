import { describe, expect, it } from 'vitest';
import { persistEn } from './persist.en';
import { persistTr } from './persist.tr';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('persistence dictionaries', () => {
  it('English and Turkish define exactly the same keys', () => {
    const en = Object.keys(persistEn).sort();
    const tr = Object.keys(persistTr).sort();
    expect(tr.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !tr.includes(k))).toEqual([]);
  });

  it('every translation keeps the placeholders of the English text and is not empty', () => {
    for (const k of Object.keys(persistEn) as (keyof typeof persistEn)[]) {
      expect(persistTr[k].trim(), k).not.toBe('');
      expect(placeholders(persistTr[k]), k).toEqual(placeholders(persistEn[k]));
    }
  });

  it('no key collides with the main dictionary', async () => {
    const { en } = await import('./en');
    expect(Object.keys(persistEn).filter((k) => k in en)).toEqual([]);
  });
});
