// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../App';
import { PRESETS, TAE } from '../../physics/presets';
import { fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';

beforeAll(installDomStubs);
beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

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
    fireEvent.click(await screen.findByRole('button', { name: /Ignite the capsule/ }));
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
    expect(await screen.findByText('Radar of headline metrics')).toBeTruthy();
    expect(screen.getByText('Overlay of runs')).toBeTruthy();
    expect(screen.getByText('Configuration difference')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Validation' }));
    expect(await screen.findByText(/shared among \d background workers/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run everything' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run 4 tests' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findAllByText('cancelled')).toHaveLength(4);
  });

  it('the Learn tab label is translated', async () => {
    const { store } = mount();
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(screen.getByRole('button', { name: 'Öğren' })).toBeTruthy();
    await act(async () => { await store.actions.setLocale('en'); });
  });
});
