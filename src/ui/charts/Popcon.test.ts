// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITER } from '../../physics/presets';
import { MagneticConfig } from '../../physics/types';
import { FakePopconWorker, fakePopconFactory } from '../../worker/fakePopconWorker';
import { POPCON_IDLE_MS, FromPopcon } from '../../worker/popconProtocol';
import { UiFrame } from '../../worker/protocol';
import { PopconPanel } from '../run/panels/PopconPanel';
import { fmtNum } from '../format';
import { canvasRecorder } from '../testing/canvasRecorder';
import { installDomStubs } from '../testing/dom';
import { Popcon, PopconProps } from './Popcon';
import { PopconView, fromPx, plotRect, readoutAt, toPx } from './popconRender';
import { steerPatch } from './usePopcon';

const W = 420, H = 260;
const rec = canvasRecorder();
let observers: (() => void)[] = [];
let clientWidth = W;

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
});
beforeEach(() => {
  clientWidth = W;
  observers = [];
  rec.reset(); rec.install();
  (globalThis as Record<string, unknown>).ResizeObserver = class { constructor(cb: () => void) { observers.push(cb); } observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

type GridMsg = Extract<FromPopcon, { type: 'grid' }>;
const frames = (n: number, ne0 = 0.3, Ti0 = 1): UiFrame[] => Array.from({ length: n }, (_, i) => ({ t: i, d: { ne: ne0 + i * 0.002, Ti: Ti0 + i * 0.03 } }));

function mount(props: Partial<PopconProps> = {}) {
  const f = fakePopconFactory();
  const utils = render(React.createElement(Popcon, { cfg: ITER, height: H, createWorker: f.create, ...props }));
  const w: FakePopconWorker = f.workers[0];
  const canvas = utils.container.querySelector('canvas')!;
  canvasEl = canvas;
  /** run the worker's due stages and deliver the replies inside act(); returns the grids delivered */
  const step = (ms = 0): GridMsg[] => {
    let out: FromPopcon[] = [];
    act(() => { w.elapse(ms); out = w.deliver(); });
    return out.filter((m): m is GridMsg => m.type === 'grid');
  };
  return { ...utils, f, w, canvas, step };
}
const viewOf = (m: GridMsg): PopconView => ({ width: W, height: H, ...m.axes });
let canvasEl: HTMLCanvasElement | null = null; // the visible canvas of the latest mount
/** the map layer is drawn offscreen and composited: what the latest drawing put on screen is the layer's calls, then the visible canvas's */
const layerDraw = () => (canvasEl ? rec.except(canvasEl).flatMap((r) => r.lastDraw()) : []);
const mainDraw = () => (canvasEl ? rec.of(canvasEl).lastDraw() : []);
const everything = () => [...layerDraw(), ...mainDraw()];
const arcs = () => everything().filter((c) => c.name === 'arc');
const readout = () => screen.queryByTestId('popcon-readout')?.textContent ?? null;

describe('Popcon: progressive map from the worker', () => {
  it('draws nothing until the first grid, then the 16 × 16 preview with its badge, then the 44 × 44 map', () => {
    const { w, step } = mount();
    expect(w.last('compute')).toMatchObject({ job: 1 });
    expect(rec.draws()).toBe(0);
    const [preview] = step();
    expect(preview.grid.nx).toBe(16);
    expect(rec.draws()).toBeGreaterThan(0);
    expect(everything().filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(256);
    expect(screen.getByText('preview 16×16')).toBeTruthy();
    const [fine] = step(POPCON_IDLE_MS);
    expect(fine.grid.nx).toBe(44);
    expect(everything().filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(44 * 44);
    expect(screen.queryByText(/^preview/)).toBeNull();
  });

  it('draws at the width of its container and the device pixel ratio, and again when the container is resized', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const { canvas, step } = mount();
    step();
    expect([canvas.width, canvas.height]).toEqual([2 * W, 2 * H]);
    expect(canvas.style.height).toBe(`${H}px`);
    const draws = rec.draws();
    clientWidth = 300;
    act(() => observers.forEach((cb) => cb()));
    expect(canvas.width).toBe(600);
    expect(rec.draws()).toBeGreaterThan(draws);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });

  it('a moving control starts new jobs and never computes the fine map; on release it refines', () => {
    const f = fakePopconFactory();
    const cfg = (H98: number): MagneticConfig => ({ ...ITER, H98 });
    const { rerender } = render(React.createElement(Popcon, { cfg: cfg(1), createWorker: f.create }));
    const w = f.workers[0];
    for (let k = 1; k <= 5; k++) {
      rerender(React.createElement(Popcon, { cfg: cfg(1 + 0.05 * k), createWorker: f.create }));
      act(() => { w.elapse(POPCON_IDLE_MS / 3); w.deliver(); });
    }
    expect(w.computed.every((c) => c.nx === 16)).toBe(true);
    expect(w.computed).toHaveLength(5); // the first job was replaced before its preview started
    expect(screen.getByText('preview 16×16')).toBeTruthy();
    act(() => { w.elapse(POPCON_IDLE_MS); w.deliver(); });
    expect(w.computed.at(-1)).toMatchObject({ nx: 44 });
    expect(w.computed.at(-1)!.cfg.H98).toBeCloseTo(1.25, 12);
    expect(screen.queryByText(/^preview/)).toBeNull();
  });
});

describe('Popcon: the map layer', () => {
  it('the map is drawn once per grid and size: pointer moves and new frames only composite it and draw the overlay', () => {
    const f = fakePopconFactory();
    const props = (fr: UiFrame[]) => ({ cfg: ITER, height: H, createWorker: f.create, frames: fr });
    const { container, rerender } = render(React.createElement(Popcon, props(frames(20))));
    const cv = container.querySelector('canvas')!;
    canvasEl = cv;
    const w = f.workers[0];
    act(() => { w.elapse(0); w.deliver(); });
    expect(rec.except(cv)).toHaveLength(1); // the offscreen layer
    const layer = () => rec.except(cv)[0];
    expect(layer().draws()).toBe(1);
    expect(layer().calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(256);
    // the visible canvas holds no cells of its own, only the composite and the overlay
    expect(rec.of(cv).calls.filter((c) => c.name === 'fillRect')).toHaveLength(0);
    const drawsBefore = rec.of(cv).draws();
    for (let k = 0; k < 12; k++) fireEvent.mouseMove(cv, { clientX: 100 + 5 * k, clientY: 100 });
    rerender(React.createElement(Popcon, props(frames(40))));
    rerender(React.createElement(Popcon, props(frames(60))));
    expect(layer().draws()).toBe(1);
    expect(layer().calls.filter((c) => c.name === 'fillRect').length).toBeLessThan(3 * 256); // still the one drawing
    expect(rec.of(cv).draws()).toBeGreaterThanOrEqual(drawsBefore + 12);
    // every redraw is one drawImage of the layer at full size
    const composites = rec.of(cv).calls.filter((c) => c.name === 'drawImage');
    expect(composites).toHaveLength(rec.of(cv).draws());
    expect(composites[0].args.slice(1)).toEqual([0, 0, W, H]);
    // the fine grid, a new size: the layer is drawn again
    act(() => { w.elapse(POPCON_IDLE_MS); w.deliver(); });
    expect(layer().draws()).toBe(2);
    clientWidth = 300;
    act(() => observers.forEach((cb) => cb()));
    expect(layer().draws()).toBe(3);
    // and once more per pixel ratio
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });
});

describe('Popcon: hover readout', () => {
  it('shows the values of the cell under the pointer, and the hint when the pointer leaves or is outside the plot', () => {
    const { canvas, step } = mount();
    const [m] = step();
    const v = viewOf(m);
    expect(screen.getByText('move over the map for the values at a point')).toBeTruthy();
    const i = 9, j = 5, k = i * m.grid.ny + j;
    const p = toPx(v, m.grid.n[i], m.grid.T[j]);
    fireEvent.mouseMove(canvas, { clientX: p.x, clientY: p.y });
    const text = readout()!;
    expect(text).toContain(`P_aux ${fmtNum(m.grid.Paux[k] / 1e6)} MW`);
    expect(text).toContain(`β_N ${fmtNum(m.grid.betaN[k])}`);
    expect(text).toContain(`T ${fmtNum(fromPx(v, p.x, p.y).T)} keV`);
    // the cross-hair follows the pointer
    expect(everything().some((c) => c.name === 'moveTo' && Math.abs((c.args[0] as number) - p.x) < 1e-9 && c.args[1] === plotRect(v).y)).toBe(true);
    // limits are named in words
    const ro = readoutAt(m.grid, ITER, v.nMax, v.Tmax, m.grid.n[i], m.grid.T[j])!;
    expect(text.includes('above the β_N limit')).toBe(ro.aboveBetaLimit);
    expect(text.includes('below the L-H threshold')).toBe(ro.belowLH);
    // outside the plot rectangle: no readout
    fireEvent.mouseMove(canvas, { clientX: 3, clientY: 3 });
    expect(readout()).toBeNull();
    fireEvent.mouseMove(canvas, { clientX: p.x, clientY: p.y });
    expect(readout()).not.toBeNull();
    fireEvent.mouseLeave(canvas);
    expect(readout()).toBeNull();
    expect(screen.getByText('move over the map for the values at a point')).toBeTruthy();
  });

  it('names the regions of the map at the four corners of the plot', () => {
    const { canvas, step } = mount();
    const [m] = step();
    const v = viewOf(m), r = plotRect(v);
    fireEvent.mouseMove(canvas, { clientX: r.x + r.w - 2, clientY: r.y + 2 }); // hot and dense
    expect(readout()).toContain('above the β_N limit');
    expect(readout()).toContain('above the Greenwald density');
    fireEvent.mouseMove(canvas, { clientX: r.x + 2, clientY: r.y + r.h - 2 }); // cold and thin
    expect(readout()).toContain('below the L-H threshold');
    expect(readout()).not.toContain('Greenwald');
  });
});

describe('Popcon: click to steer', () => {
  const controls = { P_NBI_MW: 30, P_ICRH_MW: 10, P_ECRH_MW: 0, n_target_1e20: 1, H98: 1 };

  it('sends the live-control patch of the clicked point and marks it until the shot gets there', () => {
    const onSteer = vi.fn();
    const { canvas, step } = mount({ onSteer, controls, frames: frames(50) });
    const [m] = step();
    const v = viewOf(m);
    expect(canvas.style.cursor).toBe('crosshair');
    // a cell that needs a power the heating sliders can carry
    const k = m.grid.Paux.findIndex((x) => x > 30e6 && x < 200e6);
    expect(k).toBeGreaterThanOrEqual(0);
    const p = toPx(v, m.grid.n[Math.floor(k / m.grid.ny)], m.grid.T[k % m.grid.ny]);
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    const at = fromPx(v, p.x, p.y);
    const ro = readoutAt(m.grid, ITER, v.nMax, v.Tmax, at.n, at.T)!;
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith(steerPatch({ n: at.n, Paux_MW: ro.Paux_MW }, controls));
    const patch = onSteer.mock.calls[0][0];
    expect(patch.n_target_1e20).toBeCloseTo(at.n / 1e20, 3);
    expect(patch.P_NBI_MW + patch.P_ICRH_MW + patch.P_ECRH_MW).toBeCloseTo(Math.max(0, ro.Paux_MW), 0);
    // the target ring is drawn, and named in the status line once the pointer has left
    expect(arcs().some((c) => c.strokeStyle === '#f8961e' && Math.abs((c.args[0] as number) - p.x) < 1e-9)).toBe(true);
    fireEvent.mouseLeave(canvas);
    expect(screen.getByText(/^steering to n̄ = /)).toBeTruthy();
  });

  it('does nothing outside the plot, without a handler, or when the controls offer nothing to steer', () => {
    const onSteer = vi.fn();
    const a = mount({ onSteer, controls });
    const [m] = a.step();
    fireEvent.click(a.canvas, { clientX: 2, clientY: 2 });
    expect(onSteer).not.toHaveBeenCalled();
    const v = viewOf(m), p = toPx(v, m.grid.n[4], m.grid.T[4]);
    cleanup();

    const b = mount({ controls });
    const [mb] = b.step();
    expect(b.canvas.style.cursor).toBe('default');
    fireEvent.click(b.canvas, { clientX: toPx(viewOf(mb), mb.grid.n[4], mb.grid.T[4]).x, clientY: p.y });
    expect(arcs().some((c) => c.strokeStyle === '#f8961e')).toBe(false);
    expect(screen.queryByText(/steering to/)).toBeNull();
    cleanup();

    const c = mount({ onSteer, controls: { H98: 1 } }); // no density or heating control
    const [mc] = c.step();
    const pc = toPx(viewOf(mc), mc.grid.n[4], mc.grid.T[4]);
    fireEvent.click(c.canvas, { clientX: pc.x, clientY: pc.y });
    expect(onSteer).not.toHaveBeenCalled();
    expect(screen.getByText(/click to steer the shot there/)).toBeTruthy(); // the hint is for a map that can steer
  });

  it('the steering marker goes when the operating point arrives at it', () => {
    const onSteer = vi.fn();
    const f = fakePopconFactory();
    const props = (fr: UiFrame[]) => ({ cfg: ITER, height: H, createWorker: f.create, onSteer, controls, frames: fr });
    const { container, rerender } = render(React.createElement(Popcon, props(frames(40))));
    const w = f.workers[0], canvas = container.querySelector('canvas')!;
    canvasEl = canvas;
    let m!: GridMsg;
    act(() => { w.elapse(0); m = w.deliver()[0] as GridMsg; });
    const v = viewOf(m), p = toPx(v, m.grid.n[10], m.grid.T[7]), at = fromPx(v, p.x, p.y);
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(arcs().some((c) => c.strokeStyle === '#f8961e')).toBe(true);
    // the shot moves close to the target (within 3 % of each axis)
    rerender(React.createElement(Popcon, props([...frames(40), { t: 41, d: { ne: (at.n + 0.01 * v.nMax) / 1e20, Ti: at.T + 0.01 * v.Tmax } }])));
    expect(arcs().some((c) => c.strokeStyle === '#f8961e')).toBe(false);
  });
});

describe('Popcon: trajectory and operating point', () => {
  it('draws the run as a path that fades with age, its start, and the operating point at the last frame', () => {
    const { step } = mount({ frames: frames(200) });
    const [m] = step();
    const v = viewOf(m);
    const last = { n: (0.3 + 199 * 0.002) * 1e20, T: 1 + 199 * 0.03 };
    const ring = arcs().find((c) => c.strokeStyle === '#ffffff' && c.args[2] === 5)!;
    expect(ring.args[0]).toBeCloseTo(toPx(v, last.n, last.T).x, 9);
    expect(ring.args[1]).toBeCloseTo(toPx(v, last.n, last.T).y, 9);
    const start = arcs().find((c) => c.args[2] === 3)!;
    expect(start.args[0]).toBeCloseTo(toPx(v, 0.3e20, 1).x, 9);
    // path strokes in white of rising alpha
    const alphas = everything().filter((c) => c.name === 'stroke' && /^rgba\(255,255,255,0\.\d+\)$/.test(String(c.strokeStyle)) && c.lineWidth === 1.6).map((c) => Number(String(c.strokeStyle).match(/0\.\d+/)![0]));
    expect(alphas.length).toBe(8);
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
    expect(alphas[0]).toBeLessThan(alphas[7]);
  });

  it('a long run costs a bounded number of path vertices', () => {
    const { step } = mount({ frames: frames(40_000, 0.2, 1) });
    step();
    const lineTos = everything().filter((c) => c.name === 'lineTo').length;
    expect(lineTos).toBeLessThan(6000); // contours, frame ticks and the path: not 40 000 frames
  });

  it('follows the run: a new frame moves the operating point and redraws', () => {
    const f = fakePopconFactory();
    const { container, rerender } = render(React.createElement(Popcon, { cfg: ITER, height: H, createWorker: f.create, frames: frames(20) }));
    canvasEl = container.querySelector('canvas');
    const w = f.workers[0];
    let m!: GridMsg;
    act(() => { w.elapse(0); m = w.deliver()[0] as GridMsg; });
    const draws = rec.draws();
    rerender(React.createElement(Popcon, { cfg: ITER, height: H, createWorker: f.create, frames: frames(21) }));
    expect(rec.draws()).toBeGreaterThan(draws);
    const ring = arcs().find((c) => c.strokeStyle === '#ffffff' && c.args[2] === 5)!;
    expect(ring.args[0]).toBeCloseTo(toPx(viewOf(m), (0.3 + 20 * 0.002) * 1e20, 1 + 20 * 0.03).x, 9);
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('draws the contour of the heating power applied now, dashed', () => {
    const { step } = mount({ frames: frames(10), heatingMW: 60 });
    step();
    expect(everything().some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '3,3')).toBe(true);
  });

  it('an operating point of its own (the Learn missions) replaces the one of the last frame, and null shows none', () => {
    const own = { n: 0.75e20, T: 10 };
    const { step, rerender, f } = mount({ point: own, frames: frames(50) });
    const [m] = step();
    const ring = arcs().find((c) => c.strokeStyle === '#ffffff' && c.args[2] === 5)!;
    expect(ring.args[0]).toBeCloseTo(toPx(viewOf(m), own.n, own.T).x, 9);
    expect(ring.args[1]).toBeCloseTo(toPx(viewOf(m), own.n, own.T).y, 9);
    rerender(React.createElement(Popcon, { cfg: ITER, height: H, createWorker: f.create, point: null, frames: frames(50) }));
    expect(arcs().some((c) => c.strokeStyle === '#ffffff' && c.args[2] === 5)).toBe(false);
  });

  it('a frame without a density or temperature has no operating point (and no crash)', () => {
    const { step } = mount({ frames: [{ t: 0, d: {} }] });
    step();
    expect(arcs()).toHaveLength(0);
  });
});

describe('Popcon: failures', () => {
  it('shows the error of the worker for the current job, and of a crashed worker', () => {
    const { w } = mount();
    act(() => { w.emit({ type: 'error', job: 1, msg: 'no such plasma' }); });
    expect(screen.getByRole('alert').textContent).toBe('POPCON could not be computed: no such plasma');
    act(() => { w.crash('worker died'); });
    expect(screen.getByRole('alert').textContent).toContain('worker died');
  });

  it('says so when there is no worker to compute it', () => {
    const none = () => null;
    render(React.createElement(Popcon, { cfg: ITER, height: H, createWorker: none }));
    expect(screen.getByText('The POPCON map needs a web worker, which this browser does not offer.')).toBeTruthy();
    expect(rec.draws()).toBe(0);
  });

  it('terminates its worker when it goes away', () => {
    const { w, unmount } = mount();
    unmount();
    expect(w.terminated).toBe(true);
  });
});

describe('PopconPanel', () => {
  const controls = { P_NBI_MW: 30, P_ICRH_MW: 0, P_ECRH_MW: 0, n_target_1e20: 1, H98: ITER.H98, cZ: ITER.impurity.concentration };
  const last: UiFrame = { t: 10, d: { ne: 0.9, Ti: 8, P_aux: 42 } };

  function panel(over: Record<string, unknown> = {}) {
    const f = fakePopconFactory();
    const el = (p: Record<string, unknown>) => React.createElement(PopconPanel, { cfg: ITER, last, frames: [last], controls, onSteer: vi.fn(), createWorker: f.create, ...over, ...p });
    const utils = render(el({}));
    canvasEl = utils.container.querySelector('canvas');
    return { ...utils, f, w: f.workers[0] as FakePopconWorker, again: (p: Record<string, unknown>) => utils.rerender(el(p)) };
  }

  it('has a title, and passes the run and the heating power to the map', () => {
    const { w } = panel();
    expect(screen.getByText('Live POPCON')).toBeTruthy();
    act(() => { w.elapse(0); w.deliver(); });
    expect(everything().some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '3,3')).toBe(true); // the heating contour of last.d.P_aux
    expect(arcs().some((c) => c.strokeStyle === '#ffffff' && c.args[2] === 5)).toBe(true);
  });

  it('only the controls that enter the map start a new job: the confinement multiplier and the impurity fraction', () => {
    const { w, again } = panel();
    expect(w.sent.filter((m) => m.type === 'compute')).toHaveLength(1);
    again({ controls: { ...controls, P_NBI_MW: 55, n_target_1e20: 1.4 } });
    expect(w.sent.filter((m) => m.type === 'compute')).toHaveLength(1); // heating and density are what the map is read for
    again({ controls: { ...controls, P_NBI_MW: 55, H98: 1.25 } });
    expect(w.sent.filter((m) => m.type === 'compute')).toHaveLength(2);
    expect(w.last('compute')!.cfg.H98).toBe(1.25);
    again({ controls: { ...controls, H98: 1.25, cZ: 0.031 } });
    expect(w.last('compute')!.cfg.impurity.concentration).toBe(0.031);
    expect(w.sent.filter((m) => m.type === 'compute')).toHaveLength(3);
  });

  it('steers through the given handler, and is read-only once the shot is over', () => {
    const onSteer = vi.fn();
    const { w, container, again } = panel({ onSteer });
    let m!: GridMsg;
    act(() => { w.elapse(0); m = w.deliver()[0] as GridMsg; });
    const canvas = container.querySelector('canvas')!, p = toPx(viewOf(m), m.grid.n[8], m.grid.T[6]);
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(onSteer).toHaveBeenCalledTimes(1);
    again({ onSteer, steerable: false });
    fireEvent.click(canvas, { clientX: p.x, clientY: p.y });
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(canvas.style.cursor).toBe('default');
  });

  it('without the run\'s frames the last frame is the whole trajectory', () => {
    const { w } = panel({ frames: undefined });
    act(() => { w.elapse(0); w.deliver(); });
    expect(arcs().some((c) => c.args[2] === 5)).toBe(true);
  });
});
