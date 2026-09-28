// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../App';
import { PRESETS, TAE } from '../physics/presets';
import { FakeWorker, fakeWorkerFactory } from '../worker/fakeWorker';
import { AppStoreContext, AppStore, createAppStore } from './state/store';
import { installDomStubs } from './testing/dom';

beforeAll(installDomStubs);
afterEach(cleanup);

/** App with a fresh store and fake workers; worker replies are applied synchronously inside act() */
function mount() {
  const store: AppStore = createAppStore();
  const factory = fakeWorkerFactory();
  render(React.createElement(AppStoreContext.Provider, { value: store },
    React.createElement(App, { createWorker: factory.create, schedule: (flush: () => void) => flush() })));
  const w: FakeWorker = factory.workers[0];
  const roundTrip = () => act(() => { w.process(); w.deliver(); });
  const advance = (simDt: number) => act(() => { w.advance(simDt); w.deliver(); });
  return { store, w, roundTrip, advance };
}

/** start the TAE preset from the wizard's preset list, as a user would */
function runTAE(h: ReturnType<typeof mount>) {
  const idx = PRESETS.findIndex((p) => p.id === 'TAE');
  fireEvent.click(screen.getAllByTitle('Run this preset directly')[idx]);
  expect(screen.getByText('Loading simulation…')).toBeTruthy();
  h.roundTrip();
}

const compareTab = () => screen.getByRole('button', { name: /^Compare/ });

describe('App with a fake simulation worker', () => {
  it('archives a completed run, and again after a rewind re-completes it, once per branch', async () => {
    const h = mount();
    runTAE(h);
    expect(h.w.last('init')).toMatchObject({ id: 1, autoPlay: true });
    expect(screen.getByText('Running · 1×', { exact: false })).toBeTruthy();

    h.advance(TAE.t_end);
    expect(compareTab().textContent).toBe('Compare (1)');
    expect(h.store.getState().shots.map((s) => s.name)).toEqual(['TAE Norman (FRC) #1']);

    fireEvent.click(screen.getByTitle('Rewind to start'));
    expect(h.w.last('rewind')).toEqual({ type: 'rewind', index: 0, branchId: 1 });
    expect(compareTab().textContent).toBe('Compare (1)'); // switching branch alone archives nothing
    h.roundTrip();
    expect(screen.getByText('Paused', { exact: false })).toBeTruthy();

    // a late completion of the abandoned branch must not be archived
    act(() => h.w.emit({ type: 'done', id: 1, branchId: 0, report: h.store.getState().shots[0].report }));
    expect(compareTab().textContent).toBe('Compare (1)');

    fireEvent.click(screen.getByTitle('Play'));
    h.advance(TAE.t_end);
    expect(compareTab().textContent).toBe('Compare (2)');
    expect(h.store.getState().shots.map((s) => s.name)).toEqual(['TAE Norman (FRC) #1', 'TAE Norman (FRC) #2']);

    // re-rendering the completed state does not archive it again
    fireEvent.click(screen.getByRole('button', { name: 'Report ▶' }));
    expect(await screen.findByText('Results summary')).toBeTruthy();
    expect(h.store.getState().shots).toHaveLength(2);
  });

  it('shows an error raised in the middle of a run', () => {
    const h = mount();
    runTAE(h);
    h.advance(TAE.t_end / 4);
    act(() => h.w.emit({ type: 'error', id: 1, branchId: 0, msg: 'Integrator failure: NaN in the state vector' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Simulation error');
    expect(alert.textContent).toContain('Integrator failure: NaN in the state vector');
    expect(document.querySelector('.status-pill')!.textContent).toMatch(/^ERROR/);
    // the charts and values of the run stay visible
    expect(screen.getByText('Live values')).toBeTruthy();
  });

  it('centres the confinement-multiplier slider on the model default on a log scale', () => {
    const h = mount();
    runTAE(h);
    const slider = screen.getByLabelText('Confinement multiplier') as HTMLInputElement;
    expect([slider.min, slider.max, slider.value]).toEqual(['0', '2', '1']); // log10 of 1 … 100 around 10
    fireEvent.change(slider, { target: { value: '1.5' } });
    const sent = h.w.last('control')!;
    expect(sent.patch.kappa_conf).toBeCloseTo(Math.pow(10, 1.5), 9);
  });

  it('labels the geometry summary instead of printing raw keys', () => {
    const h = mount();
    runTAE(h);
    expect(screen.getByText('Separatrix radius r_s')).toBeTruthy();
    expect(screen.getByTitle('rs')).toBeTruthy();
  });

  it('switches the interface language and <html lang> at runtime', async () => {
    const h = mount();
    expect(screen.getByRole('button', { name: 'Setup' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'tr' } });
    expect(await screen.findByRole('button', { name: 'Kurulum' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('tr');
    expect(h.store.getState().locale).toBe('tr');
    await act(() => h.store.actions.setLocale('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('button', { name: 'Setup' })).toBeTruthy();
  });
});
