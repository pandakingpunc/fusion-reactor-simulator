// @vitest-environment jsdom
/**
 * Accessibility of the screens, checked with the DOM-only helper of testing/a11y.ts: names, labels, figures, ids, headings, dialogs, tabs and
 * keyboard operation. The helper has tests of its own (a fixture of every failure it knows, and one that passes), so that a green sweep means
 * the screens are clean and not that the checker is blind. The CSS of the narrow screens is read from the stylesheet (jsdom has no layout).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { preloadRunScreen } from '../App';
import { NIF, SPARC, SPARC_15D } from '../physics/presets';
import { STEP_IDS, PRESETS as WIZ_PRESETS } from './wizard/schema';
import { Wizard } from './wizard/Wizard';
import { AppStoreContext, createAppStore } from './state/store';
import { persistEn } from '../i18n/persist.en';
import { installDomStubs } from './testing/dom';
import { A11yIssue, accessibleName, checkA11y, issueLines, tabOrder } from './testing/a11y';
import { goTab, mountApp, startRun } from './testing/appHarness';
import { Harness } from './testing/appHarness';

beforeAll(async () => { installDomStubs(); await preloadRunScreen(); });
beforeEach(() => { window.location.hash = ''; localStorage.clear(); document.documentElement.lang = 'en'; });
afterEach(async () => { cleanup(); document.body.innerHTML = ''; await createAppStore().actions.setLocale('en'); });

const html = (s: string) => { document.body.innerHTML = s; return document.body; };
const rules = (list: A11yIssue[]) => list.map((i) => i.rule).sort();
/** a fragment is not a page: the document-level rules (one main, lang, an h1) are tested on their own below */
const FRAGMENT = { page: false };
const checkFragment = (s: string) => checkA11y(html(s), FRAGMENT);

describe('the checker', () => {
  it('passes a clean fragment', () => {
    const body = html(`<main><h1>Title</h1><nav aria-label="Main"><button>Run</button><a href="#x">Go</a></nav>
      <label>Name <input type="text"></label><label for="s">Pick</label><select id="s"><option>a</option></select>
      <img src="x.png" alt="A plant"><svg role="img" aria-label="Chart"></svg><canvas role="img" aria-label="Plot"></canvas>
      <div role="dialog" aria-modal="true" aria-label="Share" tabindex="-1"><button aria-label="Close">x</button></div>
      <div role="tablist" aria-label="Views"><button role="tab" aria-selected="true">A</button></div>
      <h2>Section</h2><h3>Part</h3><h2>Next</h2><button aria-hidden="true" tabindex="-1">x</button></main>`);
    expect(issueLines(checkA11y(body))).toEqual([]);
  });

  it('finds an unnamed button, link, input, select and role=button', () => {
    const body = html('<main><button></button><a href="#a"><span></span></a><input type="text"><select></select><div role="button" tabindex="0"></div></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['label', 'label', 'name', 'name', 'name']);
  });

  it('computes names from aria-labelledby, label, aria-label, content, alt and svg title', () => {
    const body = html(`<span id="n">By id</span><button aria-labelledby="n">x</button><label><span>Wrapped</span><input id="i"></label>
      <button><svg role="img"><title>Icon title</title></svg></button><button><img alt="Alt text" src="a.png"></button><button title="Tip"></button>
      <label>Speed <select><option>fast</option></select></label>`);
    const names = [...body.querySelectorAll('button, input, select')].map((e) => accessibleName(e));
    expect(names).toEqual(['By id', 'Wrapped', 'Icon title', 'Alt text', 'Tip', 'Speed']);
  });

  it('finds figures without a name: img without alt, svg and canvas without role and name', () => {
    const body = html('<main><img src="x.png"><svg></svg><canvas></canvas><svg role="img"></svg><svg role="group"></svg><svg aria-hidden="true"></svg></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['img', 'img', 'img', 'img', 'role-name']);
  });

  it('finds duplicate ids and dangling aria references', () => {
    const body = html('<main><div id="a"></div><div id="a"></div><button aria-describedby="nope">x</button></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['aria-ref', 'dup-id']);
  });

  it('finds a heading level that skips, and an empty heading', () => {
    const body = html('<main><h2>A</h2><h4>B</h4><h3></h3></main>');
    expect(issueLines(checkA11y(body, FRAGMENT)).map((l) => l.replace(/ <.*?> ("B" )?/, ' '))).toEqual(['[heading] jumps from h2 to h4', '[heading] an empty heading']);
  });

  it('finds a dialog without aria-modal, without a name, without anything to focus', () => {
    const body = html('<main><div role="dialog"></div></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['dialog', 'dialog', 'dialog', 'role-name']);
  });

  it('finds a tab outside a tablist, a tab without aria-selected, and a positive tabindex', () => {
    const body = html('<main><button role="tab">A</button><div role="tablist" aria-label="x"><button role="tab" aria-selected="false">B</button></div><button tabindex="3">c</button></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['keyboard', 'tabs', 'tabs']);
  });

  it('finds a file input that is hidden for good, and accepts a visually hidden one that a button opens', () => {
    expect(rules(checkFragment('<main><label>Pick<input type="file" hidden></label></main>'))).toEqual(['file-input']);
    expect(rules(checkFragment('<main><button>Pick</button><input type="file" class="sr-only" tabindex="-1" aria-hidden="true"></main>'))).toEqual([]);
  });

  it('finds a focusable element inside aria-hidden', () => {
    const body = html('<main><div aria-hidden="true"><button>x</button></div></main>');
    expect(rules(checkA11y(body, FRAGMENT))).toEqual(['hidden-focus']);
  });

  it('finds the document-level failures: two mains, no lang; and ignores what is hidden', () => {
    document.documentElement.removeAttribute('lang');
    const body = html('<main></main><main></main><button hidden></button><div style="display:none"><button></button></div><details><summary>S</summary><button></button></details>');
    expect(rules(checkA11y(body))).toEqual(['h1', 'landmark', 'lang']);
    // the h1 may not be empty, hidden or aria-hidden
    document.documentElement.setAttribute('lang', 'en');
    for (const h of ['<h1></h1>', '<h1 hidden>T</h1>', '<h1 aria-hidden="true">T</h1>', '<h2>T</h2>']) expect(rules(checkA11y(html(`<main>${h}</main>`))), h).toContain('h1');
    expect(rules(checkA11y(html('<main><h1>T</h1></main>')))).toEqual([]);
  });

  it('finds a mouse-only element through its React handler, and accepts a custom control that has a role, a tab stop and a key handler', () => {
    const { unmount } = render(<main>
      <h1>Page</h1>
      <div onClick={() => {}}>mouse only</div>
      <div role="button" tabIndex={0} onClick={() => {}} onKeyDown={() => {}}>ok</div>
      <div role="button" tabIndex={0} onClick={() => {}}>no keys</div>
      <div role="button" onClick={() => {}} onKeyDown={() => {}}>no stop</div>
      <div onClick={(e) => e.stopPropagation()}><button>wrapper</button></div>
      <div onClick={(e) => e.stopPropagation()} data-on-purpose><button>on purpose</button></div>
    </main>);
    const found = checkA11y(document.body, { allow: (_i, el) => el.hasAttribute('data-on-purpose') });
    expect(found.map((i) => `${/^<([a-z]+)/.exec(i.where)![1]} "${/"(.*)"/.exec(i.where)![1]}" ${i.detail}`)).toEqual([
      'div "mouse only" has a click handler but is not a button, link or control (a mouse-only element)',
      'div "no keys" role=button reacts to a click but not to Enter or Space',
      'div "no stop" role=button is not a tab stop',
      'div "wrapper" has a click handler but is not a button, link or control (a mouse-only element)',
    ]);
    unmount();
  });

  it('lists the tab stops in the order of the Tab key', () => {
    const body = html('<main><button id="b">b</button><button tabindex="2" id="p2">p2</button><button tabindex="1" id="p1">p1</button><button disabled>d</button><a href="#" id="a">a</a><div tabindex="-1">x</div><input type="hidden"></main>');
    expect(tabOrder(body).map((e) => e.id)).toEqual(['p1', 'p2', 'b', 'a']);
  });
});

/** report of every scan so far: one failing assertion lists everything that is wrong */
const found: string[] = [];
const scan = (where: string, opts?: Parameters<typeof checkA11y>[1]) => { found.push(...issueLines(checkA11y(document.body, opts), where)); };
beforeEach(() => { found.length = 0; });

const waitReport = () => waitFor(() => expect(document.querySelector('.report')).toBeTruthy(), { timeout: 30_000 });

describe('the screens', () => {
  it('the wizard: every step of every method, with the Advanced section open', async () => {
    const store = createAppStore();
    await store.actions.setLocale('en');
    const seen = new Set<string>();
    for (const p of WIZ_PRESETS) {
      if (seen.has(p.cfg.method)) continue;
      seen.add(p.cfg.method);
      const { unmount } = render(
        <AppStoreContext.Provider value={store}>
          <Wizard cfg={p.cfg} setCfg={() => {}} name={p.name} setName={() => {}} onRun={() => {}} />
        </AppStoreContext.Provider>);
      for (let i = 0; i < STEP_IDS.length; i++) {
        fireEvent.click(document.querySelectorAll('.steps .step')[i]);
        const adv = document.querySelector('details.advanced > summary');
        if (adv) { fireEvent.click(adv); await waitFor(() => expect(document.querySelector('details.advanced .fields, details.advanced .muted')).toBeTruthy()); }
        scan(`wizard ${p.cfg.method} step ${STEP_IDS[i]}`, { page: false });
      }
      unmount();
    }
    expect([...new Set(found)]).toEqual([]);
  }, 120_000);

  it('the app: setup, run (live and finished), report, compare, validation', async () => {
    const h = await mountApp({ cfg: { ...SPARC, t_end: 3 }, cfgName: 'SPARC' }, 'en');
    scan('app setup');
    startRun();
    h.roundTrip();
    h.advance(1);
    scan('run');
    h.advance(3);
    scan('run, completed');
    goTab(h.store, 'report');
    await waitReport();
    scan('report');
    goTab(h.store, 'compare');
    await screen.findAllByRole('img', undefined, { timeout: 30_000 });
    scan('compare');
    goTab(h.store, 'validate');
    await waitFor(() => expect(document.querySelector('.panel h2, .panel h3')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 100));
    scan('validation');
    expect([...new Set(found)]).toEqual([]);
  }, 120_000);

  it('a 1.5D run and a pulsed run', async () => {
    let h: Harness = await mountApp({ cfg: { ...SPARC_15D, t_end: 1 }, cfgName: 'SPARC' }, 'en');
    startRun();
    h.roundTrip();
    h.advance(0.4);
    await waitFor(() => expect(document.querySelector('.profile-chart, canvas')).toBeTruthy());
    scan('run 1.5D');
    h.advance(2);
    goTab(h.store, 'report');
    await waitReport();
    scan('report 1.5D');
    cleanup();
    h = await mountApp({ cfg: NIF, cfgName: 'NIF' }, 'en');
    startRun();
    h.roundTrip();
    h.advance(4);
    scan('run pulsed');
    h.advance(1000);
    goTab(h.store, 'report');
    await waitReport();
    scan('report pulsed');
    expect([...new Set(found)]).toEqual([]);
  }, 120_000);

  it('learn: missions, a mission, the glossary', async () => {
    const h = await mountApp({}, 'en');
    goTab(h.store, 'learn');
    await waitFor(() => expect(document.querySelectorAll('.mission-card').length).toBeGreaterThan(0), { timeout: 30_000 });
    scan('learn missions');
    fireEvent.click(document.querySelector('.mission-card') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.mission-card')).toBeNull());
    scan('learn mission');
    act(() => { window.location.hash = '#/learn/glossary'; });
    await waitFor(() => expect(document.querySelector('[class*="gloss"]')).toBeTruthy(), { timeout: 30_000 });
    scan('learn glossary');
    expect([...new Set(found)]).toEqual([]);
  }, 120_000);

  it('the scenario step, and the share and saved-runs dialogs', async () => {
    const h = await mountApp({}, 'en');
    const steps = document.querySelectorAll('.steps .step');
    fireEvent.click(steps[STEP_IDS.indexOf('scenario')]);
    await waitFor(() => expect(document.querySelector('[class*="scn"]')).toBeTruthy(), { timeout: 30_000 });
    await waitFor(() => expect(h.factory.workers.length).toBeGreaterThan(0));
    act(() => { for (const w of h.factory.workers) { w.process(); w.deliver(); } });
    await new Promise((r) => setTimeout(r, 50));
    scan('scenario step');
    for (const key of ['persist.share', 'persist.library'] as const) {
      fireEvent.click(await screen.findByText(persistEn[key], undefined, { timeout: 30_000 }));
      await screen.findByRole('dialog', undefined, { timeout: 30_000 });
      scan(`dialog ${key}`);
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect([...new Set(found)]).toEqual([]);
  }, 120_000);
});
