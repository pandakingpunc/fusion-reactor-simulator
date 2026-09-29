/**
 * Test double for a canvas 2D context that remembers what was drawn: every method call with its arguments and the
 * paint state (fillStyle, strokeStyle, lineWidth) at that moment. Lets a chart test say "this many cells were
 * filled, a white ring was stroked at this pixel" without a real canvas (jsdom has none).
 *
 * `install()` makes every canvas of the (jsdom) document hand out a recording context of its own, so a chart that
 * draws into an offscreen layer and composites it can be told apart from the visible canvas: `of(canvas)` is the
 * recorder of one canvas, `draws()` counts the drawings (clearRect calls) of all of them.
 * Not imported by the application bundle.
 */
export interface CanvasCall {
  name: string;
  args: number[] | unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: unknown;
}

/** the recording of one context */
export interface ContextRecording {
  ctx: CanvasRenderingContext2D;
  /** every call since the recorder was made (or `reset`) */
  calls: CanvasCall[];
  /** the calls of the latest drawing: those since the last clearRect */
  lastDraw(): CanvasCall[];
  /** number of drawings (clearRect calls) so far */
  draws(): number;
  reset(): void;
}

export interface CanvasRecorder extends ContextRecording {
  /** the recording of the context of one canvas (made on first use) */
  of(canvas: HTMLCanvasElement): ContextRecording;
  /** the recordings of every canvas but `canvas`, in the order they were first used */
  except(canvas: HTMLCanvasElement): ContextRecording[];
  /** make every canvas of the (jsdom) document hand out a recording context of its own */
  install(): void;
}

function recording(): ContextRecording {
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
  };
}

export function canvasRecorder(): CanvasRecorder {
  const own = recording();
  const per = new Map<HTMLCanvasElement, ContextRecording>();
  const rec: CanvasRecorder = {
    ...own,
    draws: () => own.draws() + [...per.values()].reduce((a, r) => a + r.draws(), 0),
    reset() { own.reset(); per.clear(); }, // the canvases are forgotten too: each gets a fresh recording when it next asks for a context
    of(canvas) {
      let r = per.get(canvas);
      if (!r) { r = recording(); per.set(canvas, r); }
      return r;
    },
    except(canvas) { return [...per.entries()].filter(([c]) => c !== canvas).map(([, r]) => r); },
    install() {
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) { return rec.of(this).ctx; } as unknown as HTMLCanvasElement['getContext'];
    },
  };
  return rec;
}
