/**
 * jsdom gaps for component tests: jsdom has no ResizeObserver and no canvas 2D context.
 * The stub context accepts every drawing call and property write and draws nothing; `listenCanvasText` hears the text of every fillText
 * and strokeText (the pseudo-locale sweep reads what the charts write on their canvases).
 * Not imported by the application bundle.
 */
let textListener: ((text: string) => void) | null = null;

/** call `fn` with the text of every fillText/strokeText of the stub context from now on (null stops it) */
export function listenCanvasText(fn: ((text: string) => void) | null): void { textListener = fn; }

export function installDomStubs(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.ResizeObserver) {
    g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'measureText') return () => ({ width: 0 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key === 'fillText' || key === 'strokeText') return (text: unknown) => { if (typeof text === 'string') textListener?.(text); };
      return () => {};
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
}
