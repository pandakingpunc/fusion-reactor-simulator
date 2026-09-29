// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TimeChart } from './TimeChart';
import { installDomStubs } from '../testing/dom';

/**
 * The time chart draws long runs through the min/max level of detail (lod.ts): bounded work per redraw, and the
 * frames of events are kept. A recording 2D context stands in for the canvas.
 */
interface Vertex { x: number; y: number; move: boolean; color: string }

function recorder() {
  const vertices: Vertex[] = [];
  const state = { strokeStyle: '' as string };
  const ctx: Record<string, unknown> = new Proxy(state, {
    get: (t, k) => {
      if (k === 'moveTo') return (x: number, y: number) => vertices.push({ x, y, move: true, color: String(t.strokeStyle) });
      if (k === 'lineTo') return (x: number, y: number) => vertices.push({ x, y, move: false, color: String(t.strokeStyle) });
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'clearRect') return () => { vertices.length = 0; }; // every redraw starts with one: keep the last drawing only
      if (k in t) return (t as Record<string | symbol, unknown>)[k];
      return () => {};
    },
    set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  return vertices;
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 658 }); // plot width 658 - 58 - 12 = 588 px
});
afterEach(cleanup);

const PLOT_W = 588, PAD_L = 58;
const COLOR = '#12ab34';

/** 30 000 frames over 30 s; a type-I-ELM-like sawtooth (a crash frame every 100th frame) */
function elmRun() {
  const n = 30_000;
  const crash = (i: number) => i % 100 === 99;
  const frames = Array.from({ length: n }, (_, i) => ({ t: i * 0.001, d: { W: 100 - (i % 100) * 0.2 - (crash(i) ? 15 : 0) } }));
  const events = frames.filter((_, i) => crash(i)).map((f) => ({ t: f.t, kind: 'ELM' as const, msg: 'ELM' }));
  return { frames, events };
}

describe('TimeChart level of detail', () => {
  it('draws a series of 30 000 frames with a bounded number of vertices and keeps every ELM crash frame', () => {
    const vertices = recorder();
    const { frames, events } = elmRun();
    render(React.createElement(TimeChart, {
      frames, events, series: [{ key: 'W', label: 'W', unit: 'MJ', color: COLOR }], timeUnit: 's', tEnd: 30,
    }));
    const line = vertices.filter((v) => v.color === COLOR);
    expect(line.length).toBeGreaterThan(PLOT_W);
    expect(line.length).toBeLessThanOrEqual(7 * PLOT_W + 2); // not the 30 000 frames, not the old stride of 2 per pixel either
    // 300 ELMs, one every 0.1 s = about 2 pixel columns: each crash frame and its pre-crash frame is a vertex
    const xOf = (t: number) => PAD_L + (t / 30) * PLOT_W;
    for (const e of events) {
      expect(line.some((v) => Math.abs(v.x - xOf(e.t)) < 1e-6)).toBe(true);
      expect(line.some((v) => Math.abs(v.x - xOf(e.t - 0.001)) < 1e-6)).toBe(true);
    }
  });

  it('a one-frame spike in a long series is drawn (the old every-k-th-frame thinning dropped it)', () => {
    const vertices = recorder();
    const n = 50_000;
    const frames = Array.from({ length: n }, (_, i) => ({ t: i * 0.0006, d: { W: i === 31_337 ? 999 : 1 } }));
    render(React.createElement(TimeChart, { frames, series: [{ key: 'W', label: 'W', unit: '', color: COLOR }], timeUnit: 's', tEnd: 30 }));
    const line = vertices.filter((v) => v.color === COLOR);
    const ys = line.map((v) => v.y);
    // the spike is the highest point of the line: alone at the top, everything else on one level
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(2);
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys) - 50);
    const x = PAD_L + ((31_337 * 0.0006) / 30) * PLOT_W;
    const top = line.filter((v) => v.y === Math.min(...ys));
    expect(top.some((v) => Math.abs(v.x - x) < 1e-6)).toBe(true);
  });

  it('a run short enough for the chart is drawn frame for frame', () => {
    const vertices = recorder();
    const frames = Array.from({ length: 200 }, (_, i) => ({ t: i, d: { W: Math.sin(i) } }));
    render(React.createElement(TimeChart, { frames, series: [{ key: 'W', label: 'W', unit: '', color: COLOR }], timeUnit: 's', tEnd: 199 }));
    expect(vertices.filter((v) => v.color === COLOR)).toHaveLength(200);
  });

  it('live mode: the run so far is thinned to the envelope of its pixel columns', () => {
    const vertices = recorder();
    const frames = Array.from({ length: 6000 }, (_, i) => ({ t: i * 0.01, d: { W: Math.cos(i / 300) } }));
    render(React.createElement(TimeChart, { frames, live: true, series: [{ key: 'W', label: 'W', unit: '', color: COLOR }], timeUnit: 's', tEnd: 200 }));
    const line = vertices.filter((v) => v.color === COLOR);
    expect(line.length).toBeLessThan(6000); // 6000 frames over 588 columns are 10 per column
    expect(line.length).toBeGreaterThan(300);
  });
});
