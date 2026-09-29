import { describe, expect, it } from 'vitest';
import { scenarioEn } from './scenario.en';
import { scenarioTr } from './scenario.tr';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('scenario UI dictionaries', () => {
  it('English and Turkish define exactly the same keys', () => {
    const en = Object.keys(scenarioEn).sort();
    const tr = Object.keys(scenarioTr).sort();
    expect(tr.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !tr.includes(k))).toEqual([]);
  });

  it('every translation keeps the placeholders of the English text and is not empty', () => {
    for (const k of Object.keys(scenarioEn) as (keyof typeof scenarioEn)[]) {
      expect(scenarioTr[k].trim(), k).not.toBe('');
      expect(placeholders(scenarioTr[k]), k).toEqual(placeholders(scenarioEn[k]));
    }
  });

  it('no key collides with the main or the persistence dictionary', async () => {
    const { en } = await import('./en');
    const { persistEn } = await import('./persist.en');
    expect(Object.keys(scenarioEn).filter((k) => k in en || k in persistEn)).toEqual([]);
  });

  it('every key is used by the scenario UI (no dead strings)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '../ui/scenario');
    const source = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    // keys built from a template (`scn.tpl.${kind}` and `scn.tpl.${kind}.hint`) are used through their prefix
    const dynamic = ['scn.tpl.drop', 'scn.tpl.ramp', 'scn.tpl.gasPuff', 'scn.tpl.interlock', 'scn.tpl.drop.hint', 'scn.tpl.ramp.hint', 'scn.tpl.gasPuff.hint', 'scn.tpl.interlock.hint'];
    const unused = Object.keys(scenarioEn).filter((k) => !dynamic.includes(k) && !source.includes(`'${k}'`));
    expect(unused).toEqual([]);
  });

  it('the Turkish text is Turkish where it can be told: no English UI words left in the labels', () => {
    for (const k of ['scn.lanes', 'scn.triggers', 'scn.templates', 'scn.run.title'] as const) expect(scenarioTr[k]).not.toBe(scenarioEn[k]);
  });
});
