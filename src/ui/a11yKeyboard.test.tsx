// @vitest-environment jsdom
/**
 * Keyboard operation and focus of the application, and the stylesheets read as text (jsdom has no layout, so what the CSS promises for narrow
 * screens, touch targets and the focus ring is checked in the rules themselves). The names, labels and structure of the screens are checked in
 * a11y.test.tsx.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { preloadRunScreen } from '../App';
import { persistEn } from '../i18n/persist.en';
import { SPARC } from '../physics/presets';
import { createAppStore } from './state/store';
import { goTab, mountApp, startRun } from './testing/appHarness';
import { installDomStubs } from './testing/dom';
import { tabOrder } from './testing/a11y';

beforeAll(async () => { installDomStubs(); await preloadRunScreen(); });
beforeEach(() => { window.location.hash = ''; localStorage.clear(); });
afterEach(async () => { cleanup(); document.body.innerHTML = ''; await createAppStore().actions.setLocale('en'); });

describe('keyboard and focus', () => {
  const stepButtons = () => [...document.querySelectorAll<HTMLElement>('.steps .step')];

  it('the first draw does not take the focus; a step change moves it to the title of the new step', async () => {
    await mountApp({}, 'en');
    expect(document.activeElement).toBe(document.body);
    const next = document.querySelector<HTMLElement>('aside.panel .row .btn:last-child')!;
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.closest('section')).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('2');
    // a step picked in the list: the same
    fireEvent.click(stepButtons()[3]);
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toContain('4');
    expect(stepButtons()[3].getAttribute('aria-current')).toBe('step');
    expect(stepButtons().filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('the tabs of the top bar say which one is open; the steps, method cards and presets are real buttons that say what is chosen', async () => {
    const h = await mountApp({}, 'en');
    const nav = document.querySelector('nav.tabs')!;
    expect(nav.getAttribute('aria-label')).toBeTruthy();
    expect(nav.querySelectorAll('[aria-current=page]')).toHaveLength(1);
    expect(nav.querySelector('[aria-current=page]')!.textContent).toMatch(/Setup/);
    goTab(h.store, 'learn');
    await waitFor(() => expect(nav.querySelector('[aria-current=page]')!.textContent).toMatch(/Learn/));
    goTab(h.store, 'setup');
    for (const el of [...stepButtons(), ...document.querySelectorAll('.method-card, .preset-pick, .preset-run')]) expect(el.tagName).toBe('BUTTON');
    const cards = [...document.querySelectorAll<HTMLElement>('.method-card')];
    expect(cards.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    // Enter or Space on a native button is a click in every browser; the click does what the mouse does
    const before = h.store.getState().cfg.method;
    fireEvent.click(cards.find((c) => c.getAttribute('aria-pressed') === 'false')!);
    expect(h.store.getState().cfg.method).not.toBe(before);
    expect(document.querySelectorAll('.method-card[aria-pressed=true]')).toHaveLength(1);
  });

  it('Tab walks the main controls in reading order, each one is reachable, and nothing is a keyboard trap', async () => {
    await mountApp({}, 'en');
    const order = tabOrder();
    const at = (pred: (e: HTMLElement) => boolean) => order.findIndex(pred);
    const idx = [
      at((e) => e.matches('nav.tabs button')),
      at((e) => e.tagName === 'SELECT' && !!e.closest('header')),
      at((e) => e.matches('.steps .step')),
      at((e) => e.matches('aside input[type=text]')),
      at((e) => e.matches('.method-card')),
      at((e) => e.matches('.preset-pick')),
    ];
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // pressing Tab visits every stop once (focus() stands in for the browser moving it), and the order has no positive tabindex
    const visited = new Set<Element>();
    for (const el of order) { el.focus(); expect(document.activeElement).toBe(el); visited.add(el); }
    expect(visited.size).toBe(order.length);
    expect(order.every((e) => e.tabIndex === 0)).toBe(true);
  });

  it('a dialog keeps Tab inside, and gives the focus back to what opened it', async () => {
    await mountApp({}, 'en');
    const opener = await screen.findByText(persistEn['persist.library'], undefined, { timeout: 30_000 });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 30_000 });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    await waitFor(() => expect(tabOrder(dialog).length).toBeGreaterThan(1), { timeout: 10_000 });
    const stops = tabOrder(dialog);
    expect(stops.length).toBeGreaterThan(1); // the library: its buttons and the file chooser
    const press = (shiftKey: boolean) => fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey });
    stops[stops.length - 1].focus();
    press(false);
    expect(document.activeElement).toBe(stops[0]);
    press(true);
    expect(document.activeElement).toBe(stops[stops.length - 1]);
    dialog.focus();
    press(true);
    expect(document.activeElement).toBe(stops[stops.length - 1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('a live slider says its value in words, and the read-out beside it stays out of a screen reader\'s way', async () => {
    const h = await mountApp({ cfg: { ...SPARC, t_end: 3 }, cfgName: 'SPARC' }, 'en');
    startRun();
    h.roundTrip();
    h.advance(1);
    const slider = document.querySelector<HTMLInputElement>('.slider-row input[type=range]')!;
    expect(slider.getAttribute('aria-label')).toBeTruthy();
    expect(slider.getAttribute('aria-valuetext')).toMatch(/\d/);
    expect(slider.closest('.slider-row')!.querySelector('input[type=text]')!.getAttribute('aria-hidden')).toBe('true');
  });
});

/** the rules of a stylesheet, with the media query each one is under ('' for none) */
function cssRules(text: string): { media: string; selector: string; body: string }[] {
  const out: { media: string; selector: string; body: string }[] = [];
  const walk = (s: string, media: string) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice(6).trim());
      else if (!head.startsWith('@')) out.push({ media, selector: head, body });
      i = j;
    }
  };
  walk(text.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  return out;
}

describe('the stylesheets', () => {
  const files = ['theme.css', 'edu/edu.css', 'persist/persist.css', 'scenario/scenario.css'];
  const all = files.flatMap((f) => cssRules(readFileSync(join(process.cwd(), 'src/ui', f), 'utf8')).map((r) => ({ ...r, file: f })));
  const sels = (r: { selector: string }) => r.selector.split(',').map((x) => x.trim());

  it('draw a focus ring for the keyboard, and no rule takes the outline away without putting something in its place', () => {
    expect(all.find((r) => r.selector === ':focus-visible')?.body).toMatch(/outline:\s*2px solid/);
    const states = (r: { body: string }) => /border-color|box-shadow|stroke/.test(r.body);
    const bad = all.filter((r) => /outline:\s*(none|0)\b/.test(r.body) && !states(r)).filter((r) => {
      // a sibling rule of the same element states the focus (".scn-pt" with ".scn-pt:focus")
      const base = sels(r)[0];
      return !all.some((o) => o !== r && states(o) && sels(o).some((s) => s.startsWith(base) && /:focus/.test(s)));
    });
    expect(bad.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });

  it('make the layout one column on a phone, wrap the top bar, and give the touch targets 32 px', () => {
    const narrow = all.filter((r) => r.file === 'theme.css' && /max-width:\s*700px/.test(r.media));
    const rule = (sel: string) => narrow.find((r) => sels(r).includes(sel));
    expect(rule('.run, .report, .wizard')?.body ?? narrow.find((r) => sels(r).includes('.run'))?.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(rule('.topbar')?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.main')?.body).toMatch(/padding/);
    const touch = all.find((r) => r.file === 'theme.css' && /pointer:\s*coarse/.test(r.media) && sels(r).includes('button'));
    expect(touch?.body).toMatch(/min-height:\s*(3[2-9]|[4-9]\d)px/);
    for (const sel of ['button', 'select', 'input[type=text]', 'input[type=number]', '.tab', '.step', '.chip']) expect(sels(touch!)).toContain(sel);
    // the media query that gives them 32 px reaches a 400 px screen
    expect(touch!.media).toMatch(/max-width:\s*700px/);
  });

  it('have no fixed width that a 360 px screen cannot hold, outside a media query for wide screens', () => {
    const fixed = all.filter((r) => !/min-width/.test(r.media)).flatMap((r) => [...r.body.matchAll(/(?<![-\w])(?:min-)?width:\s*(\d+)px/g)].map((m) => ({ r, px: Number(m[1]) })));
    expect(fixed.filter((w) => w.px > 360).map((w) => `${w.r.file}: ${w.r.selector} ${w.px}px`)).toEqual([]);
    const cols = all.flatMap((r) => [...r.body.matchAll(/minmax\((\d+)px/g)].map((m) => ({ r, px: Number(m[1]) })));
    expect(cols.filter((c) => c.px > 360).map((c) => `${c.r.file}: ${c.r.selector} minmax(${c.px}px`)).toEqual([]);
  });
});

describe('the page shell', () => {
  it('index.html names the language, the viewport (no zoom lock) and a title', () => {
    const page = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(page).toMatch(/<html lang="en">/);
    expect(page).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1(\.0)?" \/>/);
    expect(page).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
    expect(page).toMatch(/<title>[^<]+<\/title>/);
  });
});
