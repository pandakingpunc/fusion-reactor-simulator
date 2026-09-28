// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { MagneticConfig } from '../physics/types';
import { PRESETS, TAE } from '../physics/presets';
import { FakeWorker, fakeWorkerFactory } from '../worker/fakeWorker';
import { FromWorker } from '../worker/protocol';
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

/** the ▶ button of a preset in the wizard's preset list */
const presetRunButton = (id: string) => screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === id)];

/** start the TAE preset from the wizard's preset list, as a user would */
function runTAE(h: ReturnType<typeof mount>) {
  fireEvent.click(presetRunButton('TAE'));
  expect(screen.getByText('Loading simulation…')).toBeTruthy();
  h.roundTrip();
}

/** the text input of a numeric wizard field, found by its label */
const numberInput = (label: string) => screen.getByText(label).closest('label')!.querySelector('input.num') as HTMLInputElement;
const typeInto = (input: HTMLInputElement, text: string) => { fireEvent.change(input, { target: { value: text } }); fireEvent.blur(input); };

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

  it('rewinding a finished run to its final frame changes nothing', () => {
    const h = mount();
    runTAE(h);
    h.advance(TAE.t_end);
    const sent = h.w.sent.length;
    const timeline = screen.getByLabelText('Timeline') as HTMLInputElement;
    const end = Number(timeline.max);
    fireEvent.change(timeline, { target: { value: String(end - 1) } }); // drag back …
    fireEvent.change(timeline, { target: { value: String(end) } }); // … and to the end again
    fireEvent.mouseUp(timeline);
    expect(h.w.sent.length).toBe(sent); // no rewind: nothing would be left to simulate
    expect(document.querySelector('.status-pill')!.textContent).toMatch(/^Completed/);
    expect(screen.getByRole('button', { name: 'Report ▶' })).toBeTruthy();
    expect(compareTab().textContent).toBe('Compare (1)');
  });

  it('stops a run whose state turns non-finite and says why, keeping what was simulated', () => {
    const h = mount();
    runTAE(h);
    h.advance(TAE.t_end / 10);
    act(() => h.w.postMessage({ type: 'control', patch: { kappa_conf: NaN } }));
    h.advance(TAE.t_end / 10);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Simulation error');
    expect(alert.textContent).toContain('became non-finite (NaN or Infinity) after t = 0.005 s');
    expect(alert.textContent).not.toMatch(/\n\s+at /); // a cause the user can fix, not a stack trace
    expect(document.querySelector('.status-pill')!.textContent).toMatch(/^ERROR · t = 5\.0 ms/);
    expect(screen.getByText('Live values')).toBeTruthy();
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

describe('App: robustness of the wizard and the drawings', () => {
  it('blocks RUN while a required field is empty and leads back to it', () => {
    const h = mount();
    fireEvent.click(screen.getByText('Geometry'));
    typeInto(numberInput('Major radius R'), '');
    expect((h.store.getState().cfg as MagneticConfig).geometry.R).toBeUndefined();
    expect(screen.getByText('Required — enter a value (the run is blocked while it is empty)').className).toBe('hint warn');
    expect(screen.getByText('!').getAttribute('title')).toContain('Major radius R');

    fireEvent.click(screen.getByText('RUN'));
    expect(screen.getByRole('alert').textContent).toContain('Required values are empty');
    const start = screen.getByRole('button', { name: '▶ START SHOT' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'RUN ▶' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(h.w.sent.filter((m) => m.type === 'init')).toEqual([]);

    fireEvent.click(screen.getByRole('link', { name: 'Major radius R' }));
    typeInto(numberInput('Major radius R'), '6,2');
    expect(screen.queryByText('!')).toBeNull();
    fireEvent.click(screen.getByText('RUN'));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '▶ START SHOT' }));
    expect((h.w.last('init')!.cfg as MagneticConfig).geometry.R).toBe(6.2);
  });

  it('a stock preset with documented blank settings is not blocked and keeps their explanations', () => {
    mount();
    fireEvent.click(screen.getByText('ITER · 1.5D profiles'));
    fireEvent.click(screen.getByText('Heating & Fueling'));
    expect(screen.getByText('Blank = two-point model (Eich λ_q)').className).toBe('hint ');
    expect(numberInput('1.5D · separatrix T_e').value).toBe('');
    fireEvent.click(screen.getByText('RUN'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: '▶ START SHOT' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('draws the cross-section of a frame without a temperature (NaN) instead of failing', () => {
    const h = mount();
    fireEvent.click(presetRunButton('ITER'));
    act(() => h.w.process());
    const ready = h.w.outbox.find((m): m is Extract<FromWorker, { type: 'ready' }> => m.type === 'ready')!;
    act(() => { h.w.deliver(); });
    act(() => h.w.emit({
      type: 'frames', id: 1, branchId: 0, frames: [{ t: 1, d: { ...ready.frame.d, Ti0: NaN, Ti: NaN } }], events: [],
      t: 1, done: false, dt: 0.01, nSteps: 1, controls: ready.meta.controls, wallMs: 0,
    }));
    expect(screen.getByText('Poloidal cross-section')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a panel that fails to draw shows the error in place; the app, its tabs and the archive stay', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = mount();
      runTAE(h);
      h.advance(TAE.t_end);
      expect(compareTab().textContent).toBe('Compare (1)');
      fireEvent.click(screen.getByTitle('Restart (same configuration)'));
      h.roundTrip();
      // a malformed frame (no diagnostics) breaks the panels that read them …
      act(() => h.w.emit({ type: 'frames', id: 2, branchId: 0, frames: [{ t: 0.001 } as never], events: [], t: 0.001, done: false, dt: 1e-5, nSteps: 1, controls: {}, wallMs: 0 }));
      const broken = screen.getAllByRole('alert');
      expect(broken.length).toBeGreaterThan(0);
      for (const a of broken) expect(a.textContent).toContain('This panel could not be drawn');
      // … but not the rest of the run screen, the top bar or the shot archive
      expect(screen.getByTitle('Rewind to start')).toBeTruthy();
      expect(screen.getByText('Event log')).toBeTruthy();
      expect(compareTab().textContent).toBe('Compare (1)');
      // a new run draws normally again
      fireEvent.click(screen.getByTitle('Restart (same configuration)'));
      h.roundTrip();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('Live values')).toBeTruthy();
    } finally {
      quiet.mockRestore();
    }
  });
});
