/**
 * Sizing of a canvas that draws in CSS pixels on a device with any pixel ratio.
 *
 * `useCanvasSize` follows the CSS width of the element (a ResizeObserver, so a panel that is resized or a window that
 * is tiled redraws at the right size) and the device pixel ratio (it changes when the window moves to another display
 * or the browser zoom changes: the `resolution` media query stops matching). `prepareCanvas` sizes the backing store
 * to width × ratio only when that changed, since assigning canvas.width or height clears the canvas and reallocates
 * its memory (the old charts did it on every redraw), and returns a 2D context whose units are CSS pixels.
 */
import { RefObject, useEffect, useRef, useState } from 'react';

/** the device pixel ratio now (1 where there is no window) */
export function currentDpr(): number {
  const d = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return d > 0 && Number.isFinite(d) ? d : 1;
}

export interface CanvasSize<T extends HTMLElement> {
  ref: RefObject<T>;
  /** CSS width of the element [px], whole pixels */
  width: number;
  dpr: number;
}

/**
 * @param fallbackWidth width used while the element has none (before layout, in a test DOM)
 */
export function useCanvasSize<T extends HTMLElement>(fallbackWidth = 320): CanvasSize<T> {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallbackWidth);
  const [dpr, setDpr] = useState(currentDpr);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const w = Math.round(el.clientWidth) || fallbackWidth; setWidth((p) => (p === w ? p : w)); };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallbackWidth]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList | null = null;
    const onChange = () => { setDpr(currentDpr()); watch(); };
    const watch = () => {
      mq?.removeEventListener('change', onChange);
      mq = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
      mq.addEventListener('change', onChange);
    };
    watch();
    return () => mq?.removeEventListener('change', onChange);
  }, []);

  return { ref, width, dpr };
}

/**
 * Give `canvas` a backing store of width × height CSS px at `dpr` (touched only when its size changes) and return its
 * 2D context with the transform set so that drawing is in CSS pixels; null when the browser gives no 2D context.
 */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
  return ctx;
}
