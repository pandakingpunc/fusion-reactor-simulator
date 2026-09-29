// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { restoreLocaleThenRender } from './boot';
import { createAppStore } from './state/store';

describe('start-up', () => {
  it('applies the saved Turkish locale before the first render, so the first paint is not English', async () => {
    await createAppStore().actions.setLocale('tr'); // a previous visit chose Turkish
    const store = createAppStore(); // the new page starts as English
    expect(store.getState().locale).toBe('en');
    const seen: { locale: string; lang: string }[] = [];
    await restoreLocaleThenRender(store, () => seen.push({ locale: store.getState().locale, lang: document.documentElement.lang }));
    expect(seen).toEqual([{ locale: 'tr', lang: 'tr' }]); // rendered once, already in Turkish
    await store.actions.setLocale('en');
  });

  it('renders once in English when nothing is saved', async () => {
    localStorage.clear();
    const store = createAppStore();
    const render = vi.fn(() => expect(store.getState().locale).toBe('en'));
    await restoreLocaleThenRender(store, render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('never leaves the page blank: a locale that fails to restore still renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = { actions: { restoreLocale: () => Promise.reject(new Error('chunk failed to load')) } } as unknown as Parameters<typeof restoreLocaleThenRender>[0];
    const render = vi.fn();
    await restoreLocaleThenRender(store, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
