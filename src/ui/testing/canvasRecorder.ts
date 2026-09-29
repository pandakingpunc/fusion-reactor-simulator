/**
 * Test double for a canvas 2D context that remembers what was drawn: every method call with its arguments and the
 * paint state (fillStyle, strokeStyle, lineWidth) at that moment. Lets a chart test say "this many cells were
 * filled, a white ring was stroked at this pixel" without a real canvas (jsdom has none).
 * Not imported by the application bundle.
 */
export interface CanvasCall {
  name: string;
  args: number[] | unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: unknown;
}

export interface CanvasRecorder {
  ctx: CanvasRenderingContext2D;
  /** every call since the recorder was made (or `reset`) */
  calls: CanvasCall[];
  /** the calls of the latest drawing: those since the last clearRect */
  lastDraw(): CanvasCall[];
  /** number of drawings (clearRect calls) so far */
  draws(): number;
  reset(): void;
  /** make every canvas of the (jsdom) document hand out this context */
  install(): void;
}

export function canvasRecorder(): CanvasRecorder {
  const calls: CanvasCall[] = [];
  const state: Record<string | symbol, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  let lastClear = 0, clears = 0;
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get: (t, key) => {
      if (key === 'measureText') return () => ({ width: 0 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key in t) return t[key];
      if (typeof key === 'symbol') return undefined;
      return (...args: unknown[]) => {
        if (key === 'clearRect') { lastClear = calls.length; clears++; }
        calls.push({ name: key, args, fillStyle: t.fillStyle, strokeStyle: t.strokeStyle, lineWidth: t.lineWidth });
      };
    },
    set: (t, key, value) => { t[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx, calls,
    lastDraw: () => calls.slice(lastClear),
    draws: () => clears,
    reset() { calls.length = 0; lastClear = 0; clears = 0; },
    install() { HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext']; },
  };
}
