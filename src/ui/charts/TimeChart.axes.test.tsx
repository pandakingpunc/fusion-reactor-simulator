// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Series, TimeChart } from './TimeChart';

/**
 * Second y-axis and event rug of the time chart. A recording 2D context stands in for the canvas: every stroke()
 * is kept with its colour, dash, alpha and the vertices of the path, every fillText() with its alignment.
 */
interface Stroke { color: string; dash: number[]; alpha: number; width: number; pts: Array<[number, number]> }
interface Text { text: string; x: number; y: number; align: string; fill: string }

function recorder() {
  const strokes: Stroke[] = [];
  const texts: Text[] = [];
  let path: Array<[number, number]> = [];
  const st: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1, textAlign: 'left', dash: [] as number[] };
  const ctx: Record<string, unknown> = new Proxy(st, {
    get: (t, k) => {
      if (k === 'beginPath') return () => { path = []; };
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => path.push([x, y]);
      if (k === 'setLineDash') return (d: number[]) => { st.dash = [...d]; };
      if (k === 'stroke') return () => strokes.push({ color: String(st.strokeStyle), dash: [...(st.dash as number[])], alpha: Number(st.globalAlpha), width: Number(st.lineWidth), pts: [...path] });
      if (k === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y, align: String(st.textAlign), fill: String(st.fillStyle) });
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'clearRect') return () => { strokes.length = 0; texts.length = 0; }; // every redraw starts with one
      if (typeof k === 'string' && k in t) return t[k];
      return () => {};
    },
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  return { strokes, texts };
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 658 });
});
afterEach(cleanup);

const HEIGHT = 220, PAD_T = 8, PLOT_H = HEIGHT - PAD_T - 22;
const ser = (key: string, color: string, label = key): Series => ({ key, label, unit: 'u', color });
type Props = Partial<React.ComponentProps<typeof TimeChart>> & { series: Series[] };
const mount = (props: Props) => {
  const store = createAppStore();
  const ui = (p: Props) => <AppStoreContext.Provider value={store}><TimeChart frames={[]} timeUnit="s" tEnd={99} height={HEIGHT} {...p} /></AppStoreContext.Provider>;
  const r = render(ui(props));
  return { ...r, rerender2: (p: Props) => r.rerender(ui(p)) };
};
const curves = (strokes: Stroke[]) => strokes.filter((s) => s.width === 1.5);

// ITER-like Density chart over 100 s, with values in the ranges quoted by the feature request
const NE = ['ne', '#e60000'], NBAR = ['nbar', '#00e600'], GW = ['gw', '#0000e6'], HE = ['he', '#e6e600'], FUEL = ['fuel', '#e600e6'];
const densityFrames = (fuel = 154) => Array.from({ length: 100 }, (_, i) => ({ t: i, d: { ne: 0.926 * (0.9 + i / 1000), nbar: 1.03, gw: 0.861, he: 0.0338, fuel: i === 50 ? fuel : fuel / 2 } }));
const densitySeries = () => [NE, NBAR, GW, HE, FUEL].map(([k, c]) => ser(k, c));

describe('TimeChart second y-axis', () => {
  it('Density: only the fueling series is dashed, and the right edge carries its own tick labels', () => {
    const { strokes, texts } = recorder();
    mount({ frames: densityFrames(), series: densitySeries() });
    const curve = (c: string) => curves(strokes).filter((s) => s.color === c);
    for (const [, c] of [NE, NBAR, GW, HE]) { expect(curve(c)).toHaveLength(1); expect(curve(c)[0].dash).toEqual([]); }
    expect(curve(FUEL[1])).toHaveLength(1);
    expect(curve(FUEL[1])[0].dash).toEqual([6, 3]);
    // plot: 658 - 58 - 50 = 550 px; the right labels sit just right of it, left-aligned, in the muted colour
    const rightEdge = 58 + 550;
    const right = texts.filter((t) => t.x > rightEdge && t.align === 'left');
    expect(right.length).toBeGreaterThanOrEqual(3);
    expect(right.every((t) => t.fill === '#7f8ba3' && t.x === rightEdge + 4)).toBe(true);
    // the fueling rate (77..154) has its own axis, not 0..160 shared with the densities
    expect(right.map((t) => Number(t.text)).some((v) => v >= 140)).toBe(true);
    // the left labels come from the density group (about 0..1.2), not from the fueling rate
    const left = texts.filter((t) => t.align === 'right').map((t) => Number(t.text));
    expect(left.length).toBeGreaterThan(2);
    expect(Math.max(...left)).toBeLessThan(2);
    // the density curves fill a usable part of the plot instead of a flat line at the bottom
    const ys = curve(HE[1])[0].pts.map((p) => p[1]);
    const ysNe = curve(NE[1])[0].pts.map((p) => p[1]);
    expect(Math.max(...ys, ...ysNe) - Math.min(...ys, ...ysNe)).toBeGreaterThan(PLOT_H / 3);
    // the x scale uses the wider right padding: t = 99 (the end) is at the right edge of the 550 px plot
    expect(curve(FUEL[1])[0].pts.at(-1)![0]).toBeCloseTo(58 + 550, 6);
  });

  it('legend: the right-axis series gets a trailing arrow and a hint, the others do not; hiding still works', () => {
    recorder();
    mount({ frames: densityFrames(), series: densitySeries() });
    const btn = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
    expect(btn('fuel').textContent).toContain('→');
    expect(btn('fuel').getAttribute('title')).toBe('right axis');
    expect(btn('ne').textContent).not.toContain('→');
    expect(btn('ne').getAttribute('title')).toBeNull();
    expect(btn('fuel').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('fuel'));
    expect(btn('fuel').getAttribute('aria-pressed')).toBe('false');
  });

  it('hiding the outliers merges back to a single axis: nothing dashed, no right labels, padding back to 12', () => {
    const { strokes, texts } = recorder();
    mount({ frames: densityFrames(), series: densitySeries() });
    fireEvent.click(screen.getByRole('button', { name: /^fuel/ }));
    // He ash (0.03) is still a decade below the densities: it moves to the right axis once the fueling rate is gone
    expect(curves(strokes).filter((s) => s.dash.length > 0).map((s) => s.color)).toEqual([HE[1]]);
    fireEvent.click(screen.getByRole('button', { name: /^he/ }));
    expect(curves(strokes).some((s) => s.dash.length > 0)).toBe(false);
    expect(texts.some((t) => t.x > 58 + 560 && t.align === 'left')).toBe(false);
    expect(curves(strokes).find((s) => s.color === NE[1])!.pts.at(-1)![0]).toBeCloseTo(58 + 588, 6);
  });

  it('log mode keeps the single axis', () => {
    const { strokes } = recorder();
    mount({ frames: densityFrames(), series: densitySeries().map((s) => ({ ...s, log: true })) });
    expect(curves(strokes).some((s) => s.dash.length > 0)).toBe(false);
    expect(curves(strokes).find((s) => s.color === NE[1])!.pts.at(-1)![0]).toBeCloseTo(58 + 588, 6);
  });

  it('similar magnitudes (no decade between them) stay on one axis', () => {
    const { strokes } = recorder();
    const frames = Array.from({ length: 20 }, (_, i) => ({ t: i, d: { a: 1.89, b: 1.72, c: 2.67, d: 3, z: 0, e: 15 } }));
    mount({ frames, series: ['a', 'b', 'c', 'd', 'z', 'e'].map((k, i) => ser(k, `#10${i}0a0`)), tEnd: 19 });
    expect(curves(strokes).some((s) => s.dash.length > 0)).toBe(false);
  });

  it('hysteresis: once split, a ratio drifting to 8 keeps the split; a new resetKey forgets it', () => {
    const { strokes } = recorder();
    const series = [ser('a', '#aa0000'), ser('b', '#00aa00')];
    const mk = (hi: number) => Array.from({ length: 10 }, (_, i) => ({ t: i, d: { a: 1, b: hi } }));
    const dashed = () => curves(strokes).some((s) => s.dash.length > 0);
    const c = mount({ frames: mk(12), series, tEnd: 9 });
    expect(dashed()).toBe(true);
    c.rerender2({ frames: mk(8), series, tEnd: 9 });
    expect(dashed()).toBe(true);
    c.rerender2({ frames: mk(6), series, tEnd: 9 });
    expect(dashed()).toBe(false);
    c.rerender2({ frames: mk(8), series, tEnd: 9 }); // single again: it takes 10 to split
    expect(dashed()).toBe(false);
    c.rerender2({ frames: mk(12), series, tEnd: 9 });
    expect(dashed()).toBe(true);
    c.rerender2({ frames: mk(8), series, tEnd: 9 });
    expect(dashed()).toBe(true);
    c.rerender2({ frames: mk(8), series, tEnd: 9, resetKey: 1 }); // memory reset: 8 alone does not split
    expect(dashed()).toBe(false);
  });

  it('click-to-seek uses the effective (wider) right padding', () => {
    recorder();
    const seen: number[] = [];
    const c = mount({ frames: densityFrames(), series: densitySeries(), onSeek: (t) => seen.push(t) });
    const canvas = c.container.querySelector('canvas')!;
    // jsdom has no layout (rect.left = 0): the plot spans px 58 .. 608 for t 0 .. 99, so its middle is t = 49.5
    const x = 58 + 275;
    fireEvent.mouseDown(canvas, { clientX: x });
    fireEvent.mouseUp(canvas, { clientX: x });
    expect(seen[0]).toBeCloseTo(49.5, 6);
  });
});

describe('TimeChart event rug', () => {
  const run = (nElm: number, nSaw: number, tEnd = 400) => {
    const frames = Array.from({ length: 200 }, (_, i) => ({ t: (i / 199) * tEnd, d: { W: 100 + (i % 7) } }));
    const events = [
      ...Array.from({ length: nElm }, (_, i) => ({ t: ((i + 0.5) / nElm) * tEnd, kind: 'ELM' as const, msg: 'ELM' })),
      ...Array.from({ length: nSaw }, (_, i) => ({ t: ((i + 0.25) / nSaw) * tEnd, kind: 'sawtooth' as const, msg: 'saw' })),
      { t: 200, kind: 'LH' as const, msg: 'LH' },
    ].sort((a, b) => a.t - b.t);
    return { frames, events };
  };
  const EL = '#f8961e', SAW = '#c77dff', LH = '#06d6a0';

  it('a dense ELM train and sawtooth become two stacked rows of 5 px ticks; no full-height dashed line for them', () => {
    const { strokes } = recorder();
    const { frames, events } = run(1354, 252);
    mount({ frames, events, series: [ser('W', '#123456')], tEnd: 400 });
    const elm = strokes.filter((s) => s.color === EL), saw = strokes.filter((s) => s.color === SAW);
    expect(elm.length).toBeGreaterThan(300);
    expect(saw.length).toBeGreaterThan(200);
    for (const s of elm) { expect(s.dash).toEqual([]); expect(s.alpha).toBe(0.8); expect(s.width).toBe(1); expect(s.pts.map((p) => p[1])).toEqual([PAD_T, PAD_T + 5]); }
    for (const s of saw) { expect(s.dash).toEqual([]); expect(s.pts.map((p) => p[1])).toEqual([PAD_T + 6, PAD_T + 11]); } // row 1: 5 px tick + 1 px gap
    // the major event keeps its full-height line
    const lh = strokes.filter((s) => s.color === LH);
    expect(lh).toHaveLength(1);
    expect(lh[0].pts.map((p) => p[1])).toEqual([PAD_T, PAD_T + PLOT_H]);
    expect(lh[0].alpha).toBe(0.9);
  });

  it('only the dense kind becomes a rug: a sparse kind keeps its full-height dashed lines and takes no row', () => {
    const { strokes } = recorder();
    const { frames, events } = run(1354, 12);
    mount({ frames, events, series: [ser('W', '#123456')], tEnd: 400 });
    const elm = strokes.filter((s) => s.color === EL);
    expect(elm.length).toBeGreaterThan(300);
    expect(elm.every((s) => s.pts[0][1] === PAD_T && s.pts[1][1] === PAD_T + 5)).toBe(true);
    const saw = strokes.filter((s) => s.color === SAW);
    expect(saw).toHaveLength(12);
    for (const s of saw) { expect(s.dash).toEqual([2, 3]); expect(s.pts.map((p) => p[1])).toEqual([PAD_T, PAD_T + PLOT_H]); }
  });

  it('a sparse train (zoomed out but few events) keeps the old dashed lines', () => {
    const { strokes } = recorder();
    const { frames, events } = run(20, 0);
    mount({ frames, events, series: [ser('W', '#123456')], tEnd: 400 });
    const elm = strokes.filter((s) => s.color === EL);
    expect(elm).toHaveLength(20);
    expect(elm.every((s) => s.dash.join() === '2,3' && s.alpha === 0.35 && s.pts[1][1] === PAD_T + PLOT_H)).toBe(true);
  });
});

describe('TimeChart live y-range', () => {
  it('follows frames appended while x0/x1 stay fixed (first 2 % of a live shot): the curve stays inside the plot', () => {
    const { strokes, texts } = recorder();
    const series = [ser('T', '#abcdef')];
    const mk = (n: number, k: number) => Array.from({ length: n }, (_, i) => ({ t: i * 0.01, d: { T: 1 + i * k } }));
    // tEnd 400: live window is [0, max(tNow*1.05, 8)] = [0, 8] while tNow < 7.6
    const c = mount({ frames: mk(50, 0.01), series, tEnd: 400, live: true });
    const lastY = () => curves(strokes).find((s) => s.color === '#abcdef')!.pts.at(-1)![1];
    expect(lastY()).toBeGreaterThanOrEqual(PAD_T);
    c.rerender2({ frames: mk(300, 1), series, tEnd: 400, live: true }); // same window, values 100x larger
    expect(lastY()).toBeGreaterThanOrEqual(PAD_T);
    expect(lastY()).toBeLessThanOrEqual(PAD_T + PLOT_H);
    expect(Math.max(...texts.filter((t) => t.align === 'right').map((t) => Number(t.text)))).toBeGreaterThan(200);
  });

  it('the right axis follows appended frames too', () => {
    const { strokes } = recorder();
    const series = [ser('a', '#aa0000'), ser('b', '#00aa00')];
    const mk = (n: number, hi: number) => Array.from({ length: n }, (_, i) => ({ t: i * 0.01, d: { a: 1, b: 100 + i * hi } }));
    const c = mount({ frames: mk(50, 0.01), series, tEnd: 400, live: true });
    c.rerender2({ frames: mk(300, 10), series, tEnd: 400, live: true });
    const y = curves(strokes).find((s) => s.color === '#00aa00')!.pts.at(-1)![1];
    expect(y).toBeGreaterThanOrEqual(PAD_T);
    expect(y).toBeLessThanOrEqual(PAD_T + PLOT_H);
  });
});
