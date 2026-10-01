// @vitest-environment jsdom
/// <reference types="node" />
/**
 * A visitor who chose Turkish last time must never see English: not on the first paint, and not when a screen that is a chunk of its own
 * (the sharing buttons are on the first screen) arrives a moment later. The saved language is read before the first render (src/ui/boot.ts),
 * its dictionaries are fetched together with the main one (the store), and <html lang> is set before any script chunk is fetched
 * (the inline script of index.html) and again, with the page title, when the language is applied.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vitest runs from the project root
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; document.title = 'Fusion Reactor Simulator'; });
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

/** run the inline script of index.html (the one that sets the language early) in this document */
function runIndexScript(): void {
  const scripts = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(scripts).toHaveLength(1);
  new Function(scripts[0])();
}

describe('index.html: the language is on <html lang> before the application starts', () => {
  it('takes the saved Turkish locale', () => {
    localStorage.setItem('fusion-sim.locale', 'tr');
    runIndexScript();
    expect(document.documentElement.lang).toBe('tr');
  });

  it('stays English when nothing, English or something unknown is saved', () => {
    runIndexScript();
    expect(document.documentElement.lang).toBe('en');
    for (const saved of ['en', 'de', '', '<script>']) {
      localStorage.setItem('fusion-sim.locale', saved);
      runIndexScript();
      expect(document.documentElement.lang).toBe('en');
    }
  });

  it('does not fail when the storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try { expect(runIndexScript).not.toThrow(); } finally { get.mockRestore(); }
    expect(document.documentElement.lang).toBe('en');
  });

  it('reads the key under which the application saves the language', async () => {
    const { createAppStore } = await import('./state/store');
    await createAppStore().actions.setLocale('tr');
    expect(localStorage.getItem('fusion-sim.locale')).toBe('tr');
    document.documentElement.lang = 'en';
    runIndexScript();
    expect(document.documentElement.lang).toBe('tr');
    await createAppStore().actions.setLocale('en');
  });
});

describe('a saved Turkish locale on a fresh page', () => {
  it('draws no English text at any moment: the first screen, then the sharing buttons that arrive in a chunk of their own', async () => {
    localStorage.setItem('fusion-sim.locale', 'tr');
    runIndexScript(); // the page's own inline script runs first, before any module
    // a new page: no dictionary of any screen is loaded yet (a fresh module graph, with its own React)
    vi.resetModules();
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../App');
    const { createAppStore, AppStoreContext } = await import('./state/store');
    const { restoreLocaleThenRender } = await import('./boot');
    const { fakeWorkerFactory } = await import('../worker/fakeWorker');
    const { en } = await import('../i18n/en');
    const { persistEn } = await import('../i18n/persist.en');
    const { installDomStubs } = await import('./testing/dom');
    installDomStubs();

    const store = createAppStore();
    expect(store.getState().locale).toBe('en'); // the page starts as English
    // every text the page ever shows, as it is drawn (a mutation of the document is a moment of the paint)
    const seen: string[] = [];
    const langs: string[] = [];
    const mo = new MutationObserver(() => { seen.push(document.body.textContent ?? ''); langs.push(document.documentElement.lang); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false; // the paint is observed as it happens, not batched by act()
    const factory = fakeWorkerFactory();
    await restoreLocaleThenRender(store, () => {
      root.render(React.createElement(AppStoreContext.Provider, { value: store }, React.createElement(App, { createWorker: factory.create, schedule: (flush: () => void) => flush() })));
    });
    // Turkish "Paylaş" (Share) is the sharing button, which comes with the lazily loaded sharing chunk
    await vi.waitFor(() => expect(document.body.textContent).toContain('Paylaş'), { timeout: 30_000 });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Kayıtlı atışlar'), { timeout: 30_000 });
    mo.disconnect();
    root.unmount();

    expect(seen.length).toBeGreaterThan(0);
    const english = [en['app.tab.setup'], en['app.tab.report'], en['wiz.steps'], en['wiz.presets'], persistEn['persist.share'], persistEn['persist.library']];
    for (const text of seen) for (const word of english) expect(text, `English "${word}" was drawn`).not.toContain(word);
    expect(new Set(langs)).toEqual(new Set(['tr'])); // <html lang> was Turkish at every paint
    expect(document.title).toBe('Füzyon Reaktör Simülatörü');
  }, 60_000);
});
