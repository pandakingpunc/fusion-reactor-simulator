// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App, { preloadRunScreen } from '../../App';
import { PRESETS, TAE } from '../../physics/presets';
import { fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';

beforeAll(async () => { installDomStubs(); await preloadRunScreen(); });
beforeEach(() => { localStorage.clear(); window.location.hash = ''; });
afterEach(() => { cleanup(); window.location.hash = ''; });

function mount() {
  const store: AppStore = createAppStore();
  const factory = fakeWorkerFactory();
  render(<AppStoreContext.Provider value={store}><App createWorker={factory.create} schedule={(flush: () => void) => flush()} /></AppStoreContext.Provider>);
  return { store, factory };
}

describe('the education and comparison screens in the app shell', () => {
  it('has a Learn tab that loads its screen on demand', async () => {
    const { store } = mount();
    const tab = screen.getByRole('button', { name: 'Learn' });
    expect(screen.queryByText('Learn fusion')).toBeNull();
    fireEvent.click(tab);
    expect(store.getState().tab).toBe('learn');
    expect(await screen.findByText('Learn fusion')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('mission-card'))).toHaveLength(10);
    expect(tab.classList.contains('active')).toBe(true);
  });

  it('a mission runs on the same worker factory as the app (a worker of its own, not the live simulation)', async () => {
    const { factory } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    fireEvent.click(await screen.findByRole('button', { name: /Squeeze the capsule evenly/ }));
    const before = factory.workers.length;
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    expect(factory.workers.length).toBe(before + 1);
    const w = factory.workers[factory.workers.length - 1];
    expect(w.sent[0]).toMatchObject({ type: 'runAll', keepFrames: true });
    act(() => { w.process(); w.deliver(); });
    expect(await screen.findByText('Not yet')).toBeTruthy();
  });

  it('the Compare tab is the new one, with the archived shot, and the Validation tab is the pooled one', async () => {
    const { store, factory } = mount();
    // run a preset from the wizard and let it finish, so that a shot is archived
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    const w = factory.workers[0];
    act(() => { w.process(); w.deliver(); });
    act(() => { w.advance(TAE.t_end); w.deliver(); });
    expect(store.getState().shots).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Compare/ }));
    // Compare and Validation are lazy chunks: the first import is slow on a loaded machine
    expect(await screen.findByText('Radar of headline metrics', {}, { timeout: 30000 })).toBeTruthy();
    expect(screen.getByText('Overlay of runs')).toBeTruthy();
    expect(screen.getByText('Configuration difference')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Validation' }));
    expect(await screen.findByText(/shared among \d background workers/, {}, { timeout: 30000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run everything' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run 4 tests' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findAllByText('cancelled')).toHaveLength(4);
  }, 90000);

  it('the Learn tab is in the address: #/learn, #/learn/missions/<id>, #/learn/glossary/<term>, and back returns', async () => {
    const { store } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(window.location.hash).toBe('#/learn');
    fireEvent.click(await screen.findByRole('button', { name: /Squeeze the capsule evenly/ }));
    expect(window.location.hash).toBe('#/learn/missions/nif');
    expect(await screen.findByRole('button', { name: 'Run the shot' })).toBeTruthy();

    // a glossary link of a mission: the term is in the address
    fireEvent.click(screen.getAllByRole('button', { name: /^Explain / })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in the glossary' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/learn\/glossary\/[A-Za-z0-9]+$/));
    expect(store.getState().tab).toBe('learn');
    expect(screen.getByRole('searchbox')).toBeTruthy();

    // back returns to the mission, and another back to the list
    act(() => { window.history.back(); });
    await waitFor(() => expect(window.location.hash).toBe('#/learn/missions/nif'));
    expect(await screen.findByRole('button', { name: 'Run the shot' })).toBeTruthy();
    act(() => { window.history.back(); });
    await waitFor(() => expect(window.location.hash).toBe('#/learn'));
    expect(await screen.findByRole('button', { name: /Squeeze the capsule evenly/ })).toBeTruthy();
    expect(store.getState().tab).toBe('learn');

    // leaving the tab leaves the address
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(window.location.hash).toBe('#/wizard');
  });

  it('a Learn address opens the mission or the term the page was loaded with', async () => {
    window.location.hash = '#/learn/missions/ignition';
    const { store } = mount();
    expect(store.getState().tab).toBe('learn');
    expect(await screen.findByRole('heading', { name: /Find ignition in POPCON/ })).toBeTruthy();
    expect(screen.getByText('POPCON map with your operating point')).toBeTruthy();
    expect(window.location.hash).toBe('#/learn/missions/ignition');
    cleanup();

    window.location.hash = '#/learn/glossary/pLH';
    const g = mount();
    expect(g.store.getState().tab).toBe('learn');
    await screen.findByRole('searchbox');
    expect(document.querySelector('#gl-pLH')?.getAttribute('aria-current')).toBe('true');
    expect(window.location.hash).toBe('#/learn/glossary/pLH');
  });

  it('a Learn address that names nothing shows the list and is rewritten; a Learn address the router does not know goes to the tab that is showing', async () => {
    window.location.hash = '#/learn/missions/not-a-mission';
    mount();
    expect(await screen.findByText('Learn fusion')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('mission-card'))).toHaveLength(10);
    await waitFor(() => expect(window.location.hash).toBe('#/learn/missions'));
    cleanup();

    window.location.hash = '#/learn/whatever/at/all';
    const { store } = mount();
    await waitFor(() => expect(window.location.hash).toBe('#/wizard'));
    expect(store.getState().tab).toBe('setup');
  });

  it('the other tabs and the Learn addresses take over from each other when the address changes', async () => {
    const { store } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(await screen.findByText('Learn fusion')).toBeTruthy();
    act(() => { window.location.hash = '#/compare'; });
    await waitFor(() => expect(store.getState().tab).toBe('compare'));
    act(() => { window.location.hash = '#/learn/glossary'; });
    await waitFor(() => expect(store.getState().tab).toBe('learn'));
    expect(await screen.findByRole('searchbox')).toBeTruthy();
  });

  it('the Learn tab label is translated', async () => {
    const { store } = mount();
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(screen.getByRole('button', { name: 'Öğren' })).toBeTruthy();
    await act(async () => { await store.actions.setLocale('en'); });
  });
});
