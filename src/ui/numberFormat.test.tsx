// @vitest-environment jsdom
/**
 * Numbers that people read follow the interface language: in Turkish a decimal is written with a comma ("0,5 MW", "1,23e-5"), in English
 * with a point. The sweep renders the main screens in Turkish (the real dictionaries) and reports every decimal that is still written
 * with a point, in text nodes, attributes and on the charts' canvases. Machine formats (the exports, the share links, the saved runs) are
 * checked to keep the point whatever the language is.
 */
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadRunScreen } from '../App';
import { activeLocale, format, localizeDecimals } from '../i18n';
import { PRESETS as WIZ_PRESETS, STEP_IDS } from './wizard/schema';
import { SPARC } from '../physics/presets';
import { fmtAxis, fmtInt, fmtNum, fmtTime, fmtValue } from './format';
import { createAppStore } from './state/store';
import { installDomStubs, listenCanvasText } from './testing/dom';
import { goTab, modelTexts, mountApp, startRun } from './testing/appHarness';

const CANVAS_TEXT = new Set<string>();
beforeAll(async () => { installDomStubs(); listenCanvasText((t) => CANVAS_TEXT.add(t)); await preloadRunScreen(); });
beforeEach(() => { window.location.hash = ''; localStorage.clear(); });
afterEach(async () => { cleanup(); await createAppStore().actions.setLocale('en'); });

/** a decimal written with a point: digit, point, digit. Names that have one are not numbers: "1.5D" (the profile model), "v4.0" (a version), "H98(y,2)". */
const POINT_DECIMAL = /(?<![vV.\d])\d+\.\d+(?!D\b|[\d.]*\.\d)/g;
const dotDecimals = (text: string): string[] => text.match(POINT_DECIMAL) ?? [];

/** the texts of the document, the label-like attributes and the canvases that hold a decimal point */
function pointDecimals(where: string): string[] {
  const found: string[] = [];
  const add = (kind: string, text: string) => { if (dotDecimals(text).length) found.push(`${where} [${kind}] ${JSON.stringify(text.trim().slice(0, 140))}`); };
  const walk = (n: Node) => {
    if (n.nodeType === 3) { add('text', n.textContent ?? ''); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (['SCRIPT', 'STYLE'].includes(el.tagName)) return;
    for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v) add(a, v); }
    // the value a person is typing in is shown in the interface language too
    if (el instanceof HTMLInputElement && el.type === 'text') add('value', el.value);
    el.childNodes.forEach(walk);
  };
  document.body.childNodes.forEach(walk);
  for (const t of CANVAS_TEXT) add('canvas', t);
  CANVAS_TEXT.clear();
  return found;
}
const uniq = (a: string[]) => [...new Set(a.map((s) => s.replace(/^[^[]*/, '')))];

describe('the number formatters', () => {
  it('write the point in English and the comma in Turkish, and group thousands as the language does', async () => {
    const store = createAppStore();
    await store.actions.setLocale('en');
    expect([fmtNum(0.5), fmtNum(12.34), fmtNum(2.5e-5), fmtTime(0.0123, 's'), fmtTime(2.5, 's'), fmtAxis(0.25), fmtValue(1.5, 'MW'), fmtInt(1234567)])
      .toEqual(['0.500', '12.3', '2.50e-5', '12.3 ms', '2.50 s', '0.25', '1.50 MW', '1,234,567']);
    await store.actions.setLocale('tr');
    expect(activeLocale()).toBe('tr');
    expect([fmtNum(0.5), fmtNum(12.34), fmtNum(2.5e-5), fmtTime(0.0123, 's'), fmtTime(2.5, 's'), fmtAxis(0.25), fmtValue(1.5, 'MW'), fmtInt(1234567)])
      .toEqual(['0,500', '12,3', '2,50e-5', '12,3 ms', '2,50 s', '0,25', '1,50 MW', '1.234.567']);
    expect(fmtNum(NaN)).toBe('—');
    expect(fmtNum(1500)).toBe('1500'); // a plain integer is not grouped, as before
  });

  it('only a point between two digits is a decimal point', () => {
    expect(localizeDecimals('1.5D profiles, v4.0, 0.25 MW, 3.0e-5', 'tr')).toBe('1,5D profiles, v4,0, 0,25 MW, 3,0e-5');
    expect(localizeDecimals('see item 3. Next 4.', 'tr')).toBe('see item 3. Next 4.');
    expect(localizeDecimals('0.5', 'en')).toBe('0.5');
  });

  it('write the numbers that fill a message in the language of the message', () => {
    expect(format('{a} / {b}', { a: 0.5, b: 'x.y' }, 'tr')).toBe('0,5 / x.y');
    expect(format('{a}', { a: 0.5 }, 'en')).toBe('0.5');
    expect(format('{a}', { a: 12 }, 'tr')).toBe('12');
  });
});

describe('machine formats keep the point in Turkish', () => {
  it('the summary CSV, the run file and the share link do not go through the interface formatters', async () => {
    const { reportCsv } = await import('./report/exportShot');
    const { serializeRunRecord, buildRunRecord } = await import('./persist/runRecord');
    const { encodeShare } = await import('./persist/codec');
    const { makeShot } = await import('./compare/testShots');
    const shot = makeShot(1, 'SPARC', { ...SPARC, t_end: 2 });
    const at = new Date(0);
    const record = () => serializeRunRecord(buildRunRecord({ name: 'x', cfg: shot.cfg, report: shot.report, events: shot.events, exportedAt: at }));
    const en = { csv: reportCsv(shot.report, 'en'), json: record(), link: await encodeShare({ cfg: shot.cfg, name: 'x' }) };
    await createAppStore().actions.setLocale('tr');
    expect(activeLocale()).toBe('tr');
    // the CSV names its rows in the language asked for, but its numbers are machine text; the JSON and the link do not know the language
    expect(reportCsv(shot.report, 'en')).toBe(en.csv);
    expect(record()).toBe(en.json);
    expect(await encodeShare({ cfg: shot.cfg, name: 'x' })).toBe(en.link);
    // the numbers of the 'tr' summary are the very numbers of the 'en' one (only labels and text values change language)
    const valueOf = (line: string) => /^(?:"(?:[^"]|"")*"|[^,]*),([^,]*),/.exec(line)?.[1] ?? '';
    const enLines = en.csv.split(/\r?\n/), trLines = reportCsv(shot.report, 'tr').split(/\r?\n/);
    expect(trLines).toHaveLength(enLines.length);
    const numeric = enLines.map((l, i) => [valueOf(l), valueOf(trLines[i])]).filter(([v]) => /^-?\d/.test(v));
    expect(numeric.length).toBeGreaterThan(20);
    for (const [e, t] of numeric) expect(t).toBe(e);
    expect(en.csv).toMatch(/^Tmax_keV,\d+\.\d+/m);
  });
});

describe('the screens in Turkish', () => {
  it('write no decimal with a point: wizard (every method, every step), run, report, compare', async () => {
    const found: string[] = [];
    const h = await mountApp({ cfg: { ...SPARC, t_end: 3 }, cfgName: 'SPARC' }, 'tr');
    found.push(...pointDecimals('wizard'));
    // every step of the wizard in this configuration, then of one preset of every other method
    const steps = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.steps .step')];
    for (let i = 0; i < STEP_IDS.length; i++) { fireEvent.click(steps()[i]); found.push(...pointDecimals(`wizard step ${STEP_IDS[i]}`)); }
    for (const preset of WIZ_PRESETS) {
      h.store.actions.setCfg(preset.cfg);
      fireEvent.click(steps()[0]);
      found.push(...pointDecimals(`preset ${preset.id} method`));
      fireEvent.click(steps()[STEP_IDS.length - 1]);
      found.push(...pointDecimals(`preset ${preset.id} summary`));
    }
    h.store.actions.setCfg({ ...SPARC, t_end: 3 });
    startRun();
    h.roundTrip();
    h.advance(1);
    found.push(...pointDecimals('run'));
    h.advance(3);
    found.push(...pointDecimals('run, completed'));
    goTab(h.store, 'report');
    found.push(...pointDecimals('report'));
    goTab(h.store, 'compare');
    found.push(...pointDecimals('compare'));
    goTab(h.store, 'validate');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Doğrulama'), { timeout: 30_000 });
    found.push(...pointDecimals('validation'));
    goTab(h.store, 'learn');
    await vi.waitFor(() => expect(document.querySelectorAll('.mission-card').length).toBeGreaterThan(0), { timeout: 30_000 });
    found.push(...pointDecimals('learn'));
    fireEvent.click(document.querySelector('.mission-card') as HTMLElement);
    found.push(...pointDecimals('mission'));
    // the events and notes the model wrote in English are shown as they are
    const model = modelTexts(h.store);
    expect(uniq(found.filter((f) => ![...model].some((m) => f.includes(JSON.stringify(m).slice(1, -1).slice(0, 60)))))).toEqual([]);
  }, 120_000);
});
