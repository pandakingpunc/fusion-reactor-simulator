import { describe, expect, it } from 'vitest';
import { en } from './en';
import { tr } from './tr';
import { LOCALES, format, isLocale, isMessageKey, loadLocale, translator } from './index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionaries', () => {
  it('en and tr define exactly the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const trKeys = Object.keys(tr).sort();
    expect(trKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !trKeys.includes(k))).toEqual([]);
  });

  it('every translation keeps the placeholders of the English text and is not empty', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(tr[k].trim(), k).not.toBe('');
      expect(placeholders(tr[k]), k).toEqual(placeholders(en[k]));
    }
  });
});

describe('translator', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('{n} shots · {x}', { n: 3 })).toBe('3 shots · {x}');
    expect(translator('en')('app.st.running', { speed: 10 })).toBe('Running · 10×');
  });

  it('falls back to English until a locale is loaded, then translates', async () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isMessageKey('run.play')).toBe(true);
    expect(isMessageKey('geom.nope')).toBe(false);
    expect(translator('tr')('run.play')).toBe('Play');
    await loadLocale('tr');
    expect(translator('tr')('run.play')).toBe('Oynat');
    expect(translator('tr')('cmp.sub', { n: 2 })).toBe('2 atış · en iyi değer vurgulu');
  });
});
