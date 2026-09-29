/**
 * Mouse, touch and keyboard control of the 3D view, attached to a DOM element: drag orbits, shift-drag or right-drag pans,
 * wheel or a two-finger pinch zooms, double-click (or 0 / Home) resets, and the arrow keys and + / - do the same from the keyboard.
 * The handlers read plain event fields, so they are testable without a real pointer.
 */

/** what the controls drive (the viewer) */
export interface ControlTarget {
  orbitBy(dxPx: number, dyPx: number): void;
  panBy(dxPx: number, dyPx: number): void;
  zoomBy(factor: number): void;
  resetView(): void;
}

/** pixels of drag per key press of an arrow key */
export const KEY_STEP_PX = 14;
/** factor of the distance per key press of + / - */
export const KEY_ZOOM = 0.88;
/** distance factor per pixel of wheel delta (exponential, so that opposite turns cancel) */
export const WHEEL_ZOOM_PER_PX = 0.0015;

/**
 * Attach the controls to `el`. `target()` is read at every event (the viewer is replaced when the drawing falls back to 2D).
 * Returns the function that removes them again.
 */
export function attachControls(el: HTMLElement, target: () => ControlTarget | null): () => void {
  const pointers = new Map<number, { x: number; y: number }>();

  const down = (e: PointerEvent) => {
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId), v = target();
    if (!p || !v) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pointers.size === 1) {
      if (e.shiftKey || (e.buttons & 2) !== 0) v.panBy(dx, dy); else v.orbitBy(dx, dy);
    } else if (pointers.size === 2) {
      let other: { x: number; y: number } | undefined;
      for (const [id, q] of pointers) if (id !== e.pointerId) other = q;
      if (other) {
        const before = Math.hypot(p.x - other.x, p.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0 && after > 0) v.zoomBy(before / after);
      }
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); };
  const wheel = (e: WheelEvent) => {
    const v = target();
    if (!v) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    v.zoomBy(Math.exp(px * WHEEL_ZOOM_PER_PX));
  };
  const dbl = () => target()?.resetView();
  const key = (e: KeyboardEvent) => {
    // leave the browser and OS shortcuts alone (Ctrl/Cmd + / - / 0 zoom the page, Alt+Left/Right is history)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = target();
    if (!v) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => v.orbitBy(-KEY_STEP_PX, 0), ArrowRight: () => v.orbitBy(KEY_STEP_PX, 0),
      ArrowUp: () => v.orbitBy(0, -KEY_STEP_PX), ArrowDown: () => v.orbitBy(0, KEY_STEP_PX),
      '+': () => v.zoomBy(KEY_ZOOM), '=': () => v.zoomBy(KEY_ZOOM), '-': () => v.zoomBy(1 / KEY_ZOOM),
      '0': () => v.resetView(), Home: () => v.resetView(),
    };
    const act = Object.prototype.hasOwnProperty.call(actions, e.key) ? actions[e.key] : undefined;
    if (act) { e.preventDefault(); act(); }
  };
  const noMenu = (e: Event) => e.preventDefault(); // the right button pans

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('dblclick', dbl);
  el.addEventListener('keydown', key);
  el.addEventListener('contextmenu', noMenu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('dblclick', dbl);
    el.removeEventListener('keydown', key);
    el.removeEventListener('contextmenu', noMenu);
    pointers.clear();
  };
}
