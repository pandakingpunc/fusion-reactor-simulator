// @vitest-environment jsdom
/**
 * Pseudo-locale sweep. The Turkish dictionaries are replaced (vi.mock) by a pseudo-translation of the English ones, every
 * string becoming `[!! Ťéxţ ŝŝŝ !!]`. The main screens are rendered in that locale and every visible text that is not
 * fenced is reported: it does not come from a dictionary, so it is hard-coded in one language and stays English for a
 * Turkish visitor. Numbers, units, symbols and the short list of proper names in testing/pseudo.ts are allowed.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { preloadRunScreen } from '../App';
import { en } from '../i18n/en';
import { eduEn } from '../edu/i18n/en';
import { persistEn } from '../i18n/persist.en';
import { Wizard } from './wizard/Wizard';
import { METHOD_INFO, STEP_IDS, PRESETS as WIZ_PRESETS } from './wizard/schema';
import { NIF, PRESETS, SPARC, SPARC_15D } from '../physics/presets';
import { FakeWorker, fakeWorkerFactory } from '../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from './state/store';
import { installDomStubs, listenCanvasText } from './testing/dom';
import { mountApp as mountAppIn, modelTexts, startRun } from './testing/appHarness';
import { PSEUDO_OPEN, Untranslated, findUntranslated, plainWords, pseudo } from './testing/pseudo';

vi.mock('../i18n/tr', async () => {
  const { en } = await import('../i18n/en');
  const { pseudoDict } = await import('./testing/pseudo');
  return { tr: pseudoDict(en) };
});
vi.mock('../i18n/wizard.tr', async () => {
  const { wizardTr } = await vi.importActual<typeof import('../i18n/wizard.tr')>('../i18n/wizard.tr');
  const { pseudoByKey } = await import('./testing/pseudo');
  return { wizardTr: pseudoByKey(wizardTr) };
});
vi.mock('../i18n/catalog.tr', async () => {
  const { catalogTr } = await vi.importActual<typeof import('../i18n/catalog.tr')>('../i18n/catalog.tr');
  const { pseudoByKey } = await import('./testing/pseudo');
  return { catalogTr: pseudoByKey(catalogTr) };
});
vi.mock('../i18n/persist.tr', async () => {
  const { persistEn } = await import('../i18n/persist.en');
  const { pseudoDict } = await import('./testing/pseudo');
  return { persistTr: pseudoDict(persistEn) };
});
vi.mock('../i18n/scenario.tr', async () => {
  const { scenarioEn } = await import('../i18n/scenario.en');
  const { pseudoDict } = await import('./testing/pseudo');
  return { scenarioTr: pseudoDict(scenarioEn) };
});
vi.mock('../edu/i18n/tr', async () => {
  const { eduEn } = await import('../edu/i18n/en');
  const { pseudoDict } = await import('./testing/pseudo');
  return { eduTr: pseudoDict(eduEn) };
});

// the report key table holds both languages in one table: its labels come out pseudo-translated, its units as the Turkish ones
vi.mock('./report/keys', async () => {
  const actual = await vi.importActual<typeof import('./report/keys')>('./report/keys');
  const { pseudo } = await import('./testing/pseudo');
  return {
    ...actual,
    describeReportKey: (k: string, locale: 'en' | 'tr') => {
      if (locale !== 'tr') return actual.describeReportKey(k, locale);
      return { ...actual.describeReportKey(k, 'tr'), label: pseudo(actual.describeReportKey(k, 'en').label) };
    },
    describeReportValue: (v: string, locale: 'en' | 'tr') => (locale === 'tr' ? pseudo(actual.describeReportValue(v, 'en')) : actual.describeReportValue(v, locale)),
  };
});

/** the text the charts wrote on their canvases since the last scan (the DOM scan cannot see it) */
const CANVAS_TEXT = new Set<string>();
beforeAll(async () => { installDomStubs(); listenCanvasText((text) => CANVAS_TEXT.add(text)); await preloadRunScreen(); });
beforeEach(() => { window.location.hash = ''; });
afterEach(cleanup);

/** What the physics model writes as sentences (see modelTexts in testing/appHarness.ts): the one thing the sweep does not hold against the interface. */
let MODEL_TEXTS = new Set<string>();
function collectModelTexts(store: AppStore): void { for (const text of modelTexts(store)) MODEL_TEXTS.add(text); }
// the raw physics key of a report row is its tooltip, so that a number can be traced to the key of the JSON export
const ignoreOnPurpose = (el: Element, kind: string, text: string): boolean =>
  kind === 'title' && (el.tagName === 'TR' || (el.tagName === 'TD' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)));

/** report of every scan so far, so that one failing assertion lists all hard-coded texts of the screen */
function untranslated(where: string): Untranslated[] {
  const found = findUntranslated(document.body, { ignore: ignoreOnPurpose }).map((u) => ({ ...u, where: `${where}: ${u.where}` }));
  for (const text of CANVAS_TEXT) if (plainWords(text).length) found.push({ where: `${where}: canvas`, kind: 'canvas', text });
  CANVAS_TEXT.clear();
  return found;
}
const lines = (list: Untranslated[]) => list.filter((u) => !MODEL_TEXTS.has(u.text)).map((u) => `${u.where} [${u.kind}] ${JSON.stringify(u.text)}`);

/** the application in the pseudo-locale (the mocked "Turkish") */
const mountApp = (init: Parameters<typeof mountAppIn>[0] = {}) => mountAppIn(init, 'tr');

const tabButton = (key: 'app.tab.run' | 'app.tab.report' | 'app.tab.compare' | 'app.tab.validate' | 'app.tab.learn') =>
  screen.getAllByText(new RegExp(`^${escapeRe(pseudo(en[key]))}`))[0];

describe('pseudo-locale', () => {
  it('the transform fences the text, keeps placeholders and grows it by about 30 %', () => {
    const s = pseudo('Running · {speed}× now');
    expect(s.startsWith(PSEUDO_OPEN)).toBe(true);
    expect(s).toContain('{speed}');
    expect(s.length).toBeGreaterThan('Running · {speed}× now'.length * 1.25);
  });

  it('the scanner reports plain English, and accepts numbers, units, symbols and fenced text', () => {
    document.body.innerHTML = `<div><span>${pseudo('Run')}</span><span>10.5 MW</span><span>n_e/n_GW</span><span>ITER</span><span>Start run</span>
      <button aria-label="Close dialog">x</button></div>`;
    try {
      expect(findUntranslated(document.body).map((u) => `${u.kind} ${u.text}`)).toEqual(['text Start run', 'aria-label Close dialog']);
    } finally { document.body.innerHTML = ''; }
  });
});

describe('every main screen is translated (no hard-coded text)', () => {
  it('the setup wizard: every step of every method', async () => {
    const store = createAppStore();
    await store.actions.setLocale('tr');
    const methods = Object.keys(METHOD_INFO) as (keyof typeof METHOD_INFO)[];
    const found: Untranslated[] = [];
    for (const m of methods) {
      const preset = WIZ_PRESETS.find((p) => p.cfg.method === m);
      const cfg = preset?.cfg ?? PRESETS[0].cfg;
      const { unmount } = render(
        <AppStoreContext.Provider value={store}>
          <Wizard cfg={cfg} setCfg={() => {}} name={pseudo(preset?.name ?? m)} setName={() => {}} onRun={() => {}} />
        </AppStoreContext.Provider>);
      for (let i = 0; i < STEP_IDS.length; i++) {
        found.push(...untranslated(`wizard ${m} step ${STEP_IDS[i]}`));
        const btn = document.querySelector('aside.panel .row')?.querySelectorAll('button')[1];
        if (btn && !btn.disabled && i < STEP_IDS.length - 1) fireEvent.click(btn);
      }
      unmount();
    }
    expect(lines(dedupe(found))).toEqual([]);
  }, 60_000);

  it('run screen, report, compare, validation', async () => {
    const h = await mountApp({ cfg: { ...SPARC, t_end: 3 }, cfgName: 'SPARC' });
    const found: Untranslated[] = [];
    found.push(...untranslated('app wizard'));
    const steps = document.querySelectorAll('.steps .step');
    fireEvent.click(steps[steps.length - 1]);
    fireEvent.click(screen.getByText(pseudo(en['wiz.start'])));
    h.roundTrip();
    h.advance(1);
    found.push(...untranslated('run screen'));
    h.advance(3);
    found.push(...untranslated('run screen, completed'));
    const tab = (key: 'app.tab.report' | 'app.tab.compare' | 'app.tab.validate' | 'app.tab.learn') =>
      fireEvent.click(screen.getAllByText(new RegExp(`^${escapeRe(pseudo(en[key]))}`))[0]);
    MODEL_TEXTS = new Set();
    collectModelTexts(h.store);
    tab('app.tab.report');
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy(), { timeout: 30_000 });
    found.push(...untranslated('report'));
    tab('app.tab.compare');
    await screen.findAllByRole('img', undefined, { timeout: 30_000 });
    found.push(...untranslated('compare'));
    tab('app.tab.validate');
    await screen.findByText(pseudo(eduEn['val.title']), undefined, { timeout: 30_000 });
    found.push(...untranslated('validation'));
    expect(lines(dedupe(found))).toEqual([]);
  }, 120_000);

  it('a 1.5D run: the profile panel, then its report and the profile figure choice', async () => {
    const h = await mountApp({ cfg: { ...SPARC_15D, t_end: 1 }, cfgName: 'SPARC' });
    const found: Untranslated[] = [];
    startRun();
    h.roundTrip();
    h.advance(0.4);
    await screen.findByText(pseudo(en['run.profiles']), undefined, { timeout: 30_000 });
    // every view of the profile chart writes its own texts on the canvas
    for (const view of ['T, n', 'q, s', 'current', 'χ', 'power']) {
      // a name made of symbols has no dictionary entry and shows as it is
      const shown = plainWords(view).length ? pseudo(view) : view;
      fireEvent.click(screen.getAllByText(new RegExp(`^${escapeRe(shown)}$`))[0]);
      found.push(...untranslated(`run 1.5D, profile view ${view}`));
    }
    found.push(...untranslated('run 1.5D'));
    h.advance(2);
    found.push(...untranslated('run 1.5D, completed'));
    collectModelTexts(h.store);
    fireEvent.click(tabButton('app.tab.report'));
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy(), { timeout: 30_000 });
    found.push(...untranslated('report 1.5D'));
    expect(lines(dedupe(found))).toEqual([]);
  }, 120_000);

  it('a pulsed run: the implosion panel, its report, and Compare with a magnetic shot', async () => {
    const h = await mountApp({ cfg: NIF, cfgName: 'NIF' });
    const found: Untranslated[] = [];
    startRun();
    h.roundTrip();
    h.advance(4); // the time of a pulsed shot is in nanoseconds
    await screen.findByText(pseudo(en['run.implosion']), undefined, { timeout: 30_000 });
    found.push(...untranslated('run pulsed'));
    h.advance(1000);
    found.push(...untranslated('run pulsed, completed'));
    collectModelTexts(h.store);
    fireEvent.click(tabButton('app.tab.report'));
    await waitFor(() => expect(document.querySelector('.report')).toBeTruthy(), { timeout: 30_000 });
    found.push(...untranslated('report pulsed'));
    fireEvent.click(tabButton('app.tab.compare'));
    await screen.findAllByRole('img', undefined, { timeout: 30_000 });
    found.push(...untranslated('compare pulsed'));
    expect(lines(dedupe(found))).toEqual([]);
  }, 120_000);

  it('learn: missions, a mission, the glossary', async () => {
    const h = await mountApp();
    const found: Untranslated[] = [];
    fireEvent.click(screen.getAllByText(new RegExp(`^${escapeRe(pseudo(en['app.tab.learn']))}`))[0]);
    await waitFor(() => expect(document.querySelectorAll('.mission-card').length).toBeGreaterThan(0), { timeout: 30_000 });
    found.push(...untranslated('learn missions'));
    fireEvent.click(document.querySelector('.mission-card') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.mission-card')).toBeNull());
    found.push(...untranslated('learn mission'));
    window.location.hash = '#/learn/glossary';
    await waitFor(() => expect(document.querySelector('.glossary, .gloss-list, [class*="gloss"]')).toBeTruthy(), { timeout: 30_000 });
    found.push(...untranslated('learn glossary'));
    void h;
    expect(lines(dedupe(found))).toEqual([]);
  }, 120_000);

  it('the scenario step, and the share and saved-runs dialogs', async () => {
    const h = await mountApp();
    const found: Untranslated[] = [];
    const steps = document.querySelector('.steps') as HTMLElement;
    fireEvent.click([...steps.querySelectorAll('.step')].find((b) => (b.textContent ?? '').includes(pseudo('Scenario')))!);
    await waitFor(() => expect(document.querySelector('.scn, [class*="scn-"]')).toBeTruthy(), { timeout: 30_000 });
    // the editor reads the model through a probe worker
    await waitFor(() => expect(h.factory.workers.length).toBeGreaterThan(0));
    act(() => { for (const w of h.factory.workers) { w.process(); w.deliver(); } });
    await new Promise((r) => setTimeout(r, 50));
    found.push(...untranslated('scenario step'));
    for (const key of ['persist.share', 'persist.library'] as const) {
      const btn = await screen.findByText(pseudo(persistEn[key]), undefined, { timeout: 30_000 });
      fireEvent.click(btn);
      await screen.findByRole('dialog', undefined, { timeout: 30_000 });
      found.push(...untranslated(`dialog ${key}`));
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(lines(dedupe(found))).toEqual([]);
  }, 120_000);
});

function dedupe(list: Untranslated[]): Untranslated[] {
  const seen = new Set<string>();
  return list.filter((u) => { const k = `${u.kind}|${u.text}|${u.where.replace(/^[^:]*: /, '')}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function escapeRe(x: string): string { return x.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c); }
