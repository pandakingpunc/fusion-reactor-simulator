/**
 * jsdom gaps for component tests: jsdom has no ResizeObserver and no canvas 2D context.
 * The stub context accepts every drawing call and property write and draws nothing.
 * Not imported by the application bundle.
 */
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
      return () => {};
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
}
