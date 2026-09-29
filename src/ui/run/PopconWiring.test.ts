// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App, { preloadRunScreen } from '../../App';
import { ITER, JET, PRESETS } from '../../physics/presets';
import { FakePopconWorker, fakePopconFactory } from '../../worker/fakePopconWorker';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { FromPopcon } from '../../worker/popconProtocol';
import { PopconView, fromPx, toPx } from '../charts/popconRender';
import { PopconWorkerContext } from '../charts/usePopcon';
import { AppStoreContext, createAppStore } from '../state/store';
import { canvasRecorder } from '../testing/canvasRecorder';
import { installDomStubs } from '../testing/dom';

/**
 * The run screen with both fake workers: the simulation's (FakeWorker) and the POPCON one (FakePopconWorker, through
 * PopconWorkerContext). Checks the wiring RunScreen gives the map: the live controls in, click-to-steer out.
 */
const W = 420;
beforeAll(async () => {
  installDomStubs();
  await preloadRunScreen();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => W });
});
beforeEach(() => canvasRecorder().install());
afterEach(cleanup);

function mount() {
  const store = createAppStore();
  const sim = fakeWorkerFactory();
  const pop = fakePopconFactory();
  render(React.createElement(AppStoreContext.Provider, { value: store },
    React.createElement(PopconWorkerContext.Provider, { value: pop.create },
      React.createElement(App, { createWorker: sim.create, schedule: (flush: () => void) => flush() }))));
  const w: FakeWorker = sim.workers[0];
  return {
    store, w, pop,
    roundTrip: () => act(() => { w.process(); w.deliver(); }),
    advance: (simDt: number) => act(() => { w.advance(simDt); w.deliver(); }),
    /** the POPCON worker of the run screen: its stages run and its grids are delivered */
    map: (ms = 0) => { let out: FromPopcon[] = []; const pw: FakePopconWorker = pop.workers[pop.workers.length - 1]; act(() => { pw.elapse(ms); out = pw.deliver(); }); return out; },
  };
}

const presetRunButton = (id: string) => screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === id)];
const popconCanvas = () => document.querySelector('canvas[aria-label^="POPCON"]') as HTMLCanvasElement | null;
type GridMsg = Extract<FromPopcon, { type: 'grid' }>;

describe('POPCON on the run screen', () => {
  it('a magnetic run has the map, computed by the POPCON worker for the run\'s configuration', () => {
    const h = mount();
    expect(popconCanvas()).toBeNull();
    fireEvent.click(presetRunButton('ITER'));
    h.roundTrip();
    expect(screen.getByText('Live POPCON')).toBeTruthy();
    expect(h.pop.workers).toHaveLength(1);
    const pw = h.pop.workers[0];
    expect(pw.last('compute')).toMatchObject({ job: 1, cfg: { B0: ITER.B0, H98: ITER.H98 } });
    const [g] = h.map() as GridMsg[];
    expect(g.grid.nx).toBe(16);
    expect(popconCanvas()).not.toBeNull();
  });

  it('a pulsed or non-tokamak run has no map and starts no POPCON worker', () => {
    const h = mount();
    fireEvent.click(presetRunButton('TAE'));
    h.roundTrip();
    expect(screen.queryByText('Live POPCON')).toBeNull();
    expect(h.pop.workers).toHaveLength(0);
  });

  it('a click on the map steers the run: the density and heating controls go to the simulation worker and to the sliders', () => {
    const h = mount();
    fireEvent.click(presetRunButton('ITER'));
    h.roundTrip();
    const [g] = h.map() as GridMsg[];
    const v: PopconView = { width: W, height: 280, ...g.axes };
    // a cell whose steady state the heating sliders can carry
    const k = g.grid.Paux.findIndex((x) => x > 40e6 && x < 300e6);
    const p = toPx(v, g.grid.n[Math.floor(k / g.grid.ny)], g.grid.T[k % g.grid.ny]);
    const before = h.w.sent.filter((m) => m.type === 'control').length;
    fireEvent.click(popconCanvas()!, { clientX: p.x, clientY: p.y });
    const controls = h.w.sent.filter((m) => m.type === 'control');
    expect(controls).toHaveLength(before + 1);
    const patch = (controls.at(-1) as Extract<typeof controls[number], { type: 'control' }>).patch;
    const at = fromPx(v, p.x, p.y);
    expect(patch.n_target_1e20).toBeCloseTo(at.n / 1e20, 3);
    expect(patch.P_NBI_MW + patch.P_ICRH_MW + patch.P_ECRH_MW).toBeGreaterThan(30);
    // the store (and so the sliders) follow at once
    const state = h.store.getState();
    expect(state).toBeTruthy();
    expect((screen.getByLabelText('P_NBI') as HTMLInputElement).value).toBe(String(patch.P_NBI_MW));
    // the worker applies it at the next step and reports it back
    h.advance(1);
    expect(h.w.last('control')).toBeTruthy();
  });

  it('the live confinement control changes the map: a new job for the new H98; the heating powers do not', () => {
    const h = mount();
    fireEvent.click(presetRunButton('ITER'));
    h.roundTrip();
    h.map();
    const pw = h.pop.workers[0];
    const jobs = () => pw.sent.filter((m) => m.type === 'compute').length;
    expect(jobs()).toBe(1);
    fireEvent.change(screen.getByLabelText('P_NBI'), { target: { value: '55' } });
    expect(jobs()).toBe(1);
    fireEvent.change(screen.getByLabelText('H₉₈'), { target: { value: '1.3' } });
    expect(jobs()).toBe(2);
    expect(pw.last('compute')!.cfg.H98).toBeCloseTo(1.3, 12);
    expect(h.w.last('control')).toEqual({ type: 'control', patch: { H98: 1.3 } });
  });

  it('once the shot is over the map is read-only', () => {
    const h = mount();
    fireEvent.click(presetRunButton('JET')); // a short shot
    h.roundTrip();
    const [g] = h.map() as GridMsg[];
    h.advance(JET.t_end);
    expect(screen.getAllByText('Completed', { exact: false }).length).toBeGreaterThan(0);
    const v: PopconView = { width: W, height: 280, ...g.axes };
    const p = toPx(v, g.grid.n[8], g.grid.T[6]);
    const before = h.w.sent.length;
    fireEvent.click(popconCanvas()!, { clientX: p.x, clientY: p.y });
    expect(h.w.sent.length).toBe(before);
    expect(popconCanvas()!.style.cursor).toBe('default');
  });
});
