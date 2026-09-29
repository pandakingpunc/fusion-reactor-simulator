// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasRecorder } from '../testing/canvasRecorder';
import { currentDpr, prepareCanvas, useCanvasSize } from './useCanvasSize';

let clientWidth = 0;
const observers: { cb: () => void; disconnected: boolean; target?: Element }[] = [];

function Probe({ fallback }: { fallback?: number }) {
  const { ref, width, dpr } = useCanvasSize<HTMLDivElement>(fallback);
  return React.createElement('div', { ref, 'data-w': width, 'data-dpr': dpr });
}
const probe = (c: HTMLElement) => c.querySelector('div')!;

beforeEach(() => {
  clientWidth = 0;
  observers.length = 0;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    private rec: { cb: () => void; disconnected: boolean; target?: Element };
    constructor(cb: () => void) { this.rec = { cb, disconnected: false }; observers.push(this.rec); }
    observe(el: Element) { this.rec.target = el; }
    unobserve() {}
    disconnect() { this.rec.disconnected = true; }
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 }); });

describe('useCanvasSize: width', () => {
  it('uses the fallback width while the element has none (before layout, in a test DOM)', () => {
    const { container } = render(React.createElement(Probe));
    expect(probe(container).dataset.w).toBe('320');
    cleanup();
    const again = render(React.createElement(Probe, { fallback: 500 }));
    expect(probe(again.container).dataset.w).toBe('500');
  });

  it('reads the width of the element, whole pixels', () => {
    clientWidth = 412.6;
    const { container } = render(React.createElement(Probe));
    expect(probe(container).dataset.w).toBe('413');
  });

  it('follows a resize (whole pixels) and stops observing on unmount', () => {
    clientWidth = 400;
    const { container, unmount } = render(React.createElement(Probe));
    expect(observers).toHaveLength(1);
    expect(observers[0].target).toBe(probe(container));
    clientWidth = 400.2; // rounds to the same width
    act(() => observers[0].cb());
    expect(probe(container).dataset.w).toBe('400');
    clientWidth = 520;
    act(() => observers[0].cb());
    expect(probe(container).dataset.w).toBe('520');
    unmount();
    expect(observers[0].disconnected).toBe(true);
  });

  it('works without a ResizeObserver', () => {
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    clientWidth = 333;
    const { container } = render(React.createElement(Probe));
    expect(probe(container).dataset.w).toBe('333');
  });
});

describe('useCanvasSize: device pixel ratio', () => {
  type Listener = () => void;
  const setDpr = (v: number) => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: v });

  it('takes the ratio of the display, follows it when the window moves to another one, and asks about the new ratio', () => {
    setDpr(2);
    const queries: string[] = [];
    const listeners = new Map<string, Set<Listener>>();
    window.matchMedia = ((q: string) => {
      queries.push(q);
      const set = listeners.get(q) ?? new Set<Listener>(); listeners.set(q, set);
      return { media: q, addEventListener: (_: string, l: Listener) => set.add(l), removeEventListener: (_: string, l: Listener) => set.delete(l) };
    }) as unknown as typeof window.matchMedia;
    const { container, unmount } = render(React.createElement(Probe));
    expect(probe(container).dataset.dpr).toBe('2');
    expect(queries).toEqual(['(resolution: 2dppx)']);
    setDpr(3);
    act(() => { for (const l of [...listeners.get('(resolution: 2dppx)')!]) l(); });
    expect(probe(container).dataset.dpr).toBe('3');
    expect(queries.at(-1)).toBe('(resolution: 3dppx)'); // armed again for the next change
    expect(listeners.get('(resolution: 2dppx)')!.size).toBe(0);
    unmount();
    expect(listeners.get('(resolution: 3dppx)')!.size).toBe(0);
  });

  it('currentDpr is 1 for a missing or nonsensical ratio', () => {
    setDpr(0);
    expect(currentDpr()).toBe(1);
    setDpr(NaN);
    expect(currentDpr()).toBe(1);
    setDpr(1.5);
    expect(currentDpr()).toBe(1.5);
  });
});

describe('prepareCanvas', () => {
  it('sizes the backing store to CSS size × ratio and sets the transform so that drawing is in CSS pixels', () => {
    const rec = canvasRecorder(); rec.install();
    const cv = document.createElement('canvas');
    const ctx = prepareCanvas(cv, 300, 200, 2);
    expect(ctx).toBe(rec.ctx);
    expect([cv.width, cv.height]).toEqual([600, 400]);
    expect(rec.calls.find((c) => c.name === 'setTransform')!.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('rounds to whole device pixels and scales exactly by the rounded size (fractional ratios)', () => {
    const rec = canvasRecorder(); rec.install();
    const cv = document.createElement('canvas');
    prepareCanvas(cv, 333, 260, 1.25);
    expect([cv.width, cv.height]).toEqual([416, 325]);
    const [a, , , d] = rec.calls.find((c) => c.name === 'setTransform')!.args as number[];
    expect(a).toBe(416 / 333);
    expect(d).toBe(325 / 260);
  });

  it('touches the backing store only when its size changes (assigning width or height clears the canvas)', () => {
    canvasRecorder().install();
    const cv = document.createElement('canvas');
    let sets = 0;
    let w = 0, h = 0;
    Object.defineProperty(cv, 'width', { get: () => w, set: (v: number) => { w = v; sets++; } });
    Object.defineProperty(cv, 'height', { get: () => h, set: (v: number) => { h = v; sets++; } });
    prepareCanvas(cv, 300, 200, 1);
    expect(sets).toBe(2);
    prepareCanvas(cv, 300, 200, 1);
    prepareCanvas(cv, 300, 200, 1);
    expect(sets).toBe(2);
    prepareCanvas(cv, 320, 200, 1);
    expect(sets).toBe(3); // only the width changed
  });

  it('gives null when the browser has no 2D context, and never a zero-size canvas', () => {
    const cv = document.createElement('canvas');
    cv.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
    expect(prepareCanvas(cv, 300, 200, 1)).toBeNull();
    canvasRecorder().install();
    const c2 = document.createElement('canvas');
    prepareCanvas(c2, 0, 0, 1);
    expect([c2.width, c2.height]).toEqual([1, 1]);
  });
});
