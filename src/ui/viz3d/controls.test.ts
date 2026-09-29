import { describe, expect, it } from 'vitest';
import { ControlTarget, KEY_STEP_PX, KEY_ZOOM, WHEEL_ZOOM_PER_PX, attachControls } from './controls';

type Handler = (e: never) => void;
class FakeEl {
  handlers = new Map<string, Handler[]>();
  captured: number[] = [];
  addEventListener(type: string, h: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]); }
  removeEventListener(type: string, h: Handler) { this.handlers.set(type, (this.handlers.get(type) ?? []).filter((x) => x !== h)); }
  setPointerCapture(id: number) { this.captured.push(id); }
  fire(type: string, e: object) { for (const h of this.handlers.get(type) ?? []) h({ preventDefault() { /* noop */ }, ...e } as never); }
  count() { let n = 0; for (const v of this.handlers.values()) n += v.length; return n; }
}
const recorder = () => {
  const log: string[] = [];
  const t: ControlTarget = {
    orbitBy: (x, y) => log.push(`orbit ${x} ${y}`), panBy: (x, y) => log.push(`pan ${x} ${y}`),
    zoomBy: (f) => log.push(`zoom ${f.toFixed(4)}`), resetView: () => log.push('reset'),
  };
  return { log, t };
};
const setup = () => {
  const el = new FakeEl(), r = recorder();
  const detach = attachControls(el as unknown as HTMLElement, () => r.t);
  return { el, ...r, detach };
};

describe('view controls', () => {
  it('one pointer drags to orbit; shift or the right button pans', () => {
    const { el, log } = setup();
    el.fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    el.fire('pointermove', { pointerId: 1, clientX: 15, clientY: 8, shiftKey: false, buttons: 1 });
    el.fire('pointermove', { pointerId: 1, clientX: 15, clientY: 20, shiftKey: true, buttons: 1 });
    el.fire('pointermove', { pointerId: 1, clientX: 25, clientY: 20, shiftKey: false, buttons: 2 });
    expect(log).toEqual(['orbit 5 -2', 'pan 0 12', 'pan 10 0']);
    expect(el.captured).toEqual([1]);
  });
  it('moves without a pressed pointer, and after release, do nothing', () => {
    const { el, log } = setup();
    el.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 1, buttons: 0 });
    el.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    el.fire('pointerup', { pointerId: 1 });
    el.fire('pointermove', { pointerId: 1, clientX: 5, clientY: 5, buttons: 0 });
    expect(log).toEqual([]);
  });
  it('a two-finger pinch zooms by the ratio of the finger distances (spreading zooms in)', () => {
    const { el, log } = setup();
    el.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    el.fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 });
    el.fire('pointermove', { pointerId: 2, clientX: 200, clientY: 0, buttons: 1 });
    expect(log).toEqual(['zoom 0.5000']);
  });
  it('the wheel zooms exponentially, so opposite turns cancel, and prevents page scrolling', () => {
    const { el, log } = setup();
    let prevented = 0;
    el.fire('wheel', { deltaY: 100, deltaMode: 0, preventDefault: () => { prevented++; } });
    el.fire('wheel', { deltaY: -100, deltaMode: 0, preventDefault: () => { prevented++; } });
    el.fire('wheel', { deltaY: 1, deltaMode: 1 });
    expect(prevented).toBe(2);
    expect(log[0]).toBe(`zoom ${Math.exp(100 * WHEEL_ZOOM_PER_PX).toFixed(4)}`);
    expect(log[1]).toBe(`zoom ${Math.exp(-100 * WHEEL_ZOOM_PER_PX).toFixed(4)}`);
    expect(log[2]).toBe(`zoom ${Math.exp(16 * WHEEL_ZOOM_PER_PX).toFixed(4)}`);
  });
  it('double-click, 0 and Home reset the view', () => {
    const { el, log } = setup();
    el.fire('dblclick', {});
    el.fire('keydown', { key: '0' });
    el.fire('keydown', { key: 'Home' });
    expect(log).toEqual(['reset', 'reset', 'reset']);
  });
  it('the keyboard orbits and zooms, and ignores other keys without preventing them', () => {
    const { el, log } = setup();
    el.fire('keydown', { key: 'ArrowLeft' });
    el.fire('keydown', { key: 'ArrowDown' });
    el.fire('keydown', { key: '+' });
    el.fire('keydown', { key: '-' });
    let prevented = false;
    el.fire('keydown', { key: 'Tab', preventDefault: () => { prevented = true; } });
    el.fire('keydown', { key: 'constructor' });
    expect(log).toEqual([`orbit ${-KEY_STEP_PX} 0`, `orbit 0 ${KEY_STEP_PX}`, `zoom ${KEY_ZOOM.toFixed(4)}`, `zoom ${(1 / KEY_ZOOM).toFixed(4)}`]);
    expect(prevented).toBe(false);
  });
  it('leaves the browser shortcuts alone: Ctrl/Cmd/Alt with a handled key is neither acted on nor prevented', () => {
    const { el, log } = setup();
    let prevented = 0;
    const preventDefault = () => { prevented++; };
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      for (const key of ['0', '+', '=', '-', 'Home', 'ArrowLeft', 'ArrowRight']) el.fire('keydown', { key, [mod]: true, preventDefault });
    }
    expect(log).toEqual([]);
    expect(prevented).toBe(0);
    // Shift alone (needed to type '+') still works
    el.fire('keydown', { key: '+', shiftKey: true, preventDefault });
    expect(log).toEqual([`zoom ${KEY_ZOOM.toFixed(4)}`]);
    expect(prevented).toBe(1);
  });
  it('does nothing while there is no viewer, and detaches every listener', () => {
    const el = new FakeEl();
    const detach = attachControls(el as unknown as HTMLElement, () => null);
    el.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    el.fire('pointermove', { pointerId: 1, clientX: 3, clientY: 3, buttons: 1 });
    el.fire('wheel', { deltaY: 5, deltaMode: 0 });
    el.fire('keydown', { key: '0' });
    expect(el.count()).toBeGreaterThan(0);
    detach();
    expect(el.count()).toBe(0);
  });
});
