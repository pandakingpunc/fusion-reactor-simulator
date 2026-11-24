// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs, listenCanvasText } from '../testing/dom';
import { Series, TimeChart } from './TimeChart';

beforeAll(installDomStubs);
afterEach(() => { listenCanvasText(null); cleanup(); });

const lin = (): Series[] => [{ key: 'Q', label: 'Q', unit: '', color: '#fff' }];
const log = (): Series[] => [{ key: 'ne', label: 'n_e', unit: '1e20 m^-3', color: '#fff', log: true }];

function mount(series: Series[]) {
  const store = createAppStore();
  const ui = (s: Series[]) => <AppStoreContext.Provider value={store}><TimeChart frames={[]} series={s} timeUnit="s" tEnd={1} /></AppStoreContext.Provider>;
  const r = render(ui(series));
  return { rerender: (s: Series[]) => r.rerender(ui(s)), scale: () => screen.getByRole('button', { name: 'logarithmic y-axis' }) };
}

describe('TimeChart scale', () => {
  it('keeps the log/lin choice when the parent passes an equal series array again (the Report builds one on every render)', () => {
    const c = mount(lin());
    expect(c.scale().textContent).toBe('lin');
    fireEvent.click(c.scale());
    expect(c.scale().textContent).toBe('log');
    c.rerender(lin()); // a new array with the same series, as after a click on SVG ↓
    expect(c.scale().textContent).toBe('log');
  });

  it('goes back to the default of the series when the plotted series change', () => {
    const c = mount(lin());
    fireEvent.click(c.scale());
    c.rerender(log());
    expect(c.scale().textContent).toBe('log');
    fireEvent.click(c.scale());
    expect(c.scale().textContent).toBe('lin');
    c.rerender(lin());
    expect(c.scale().textContent).toBe('lin');
  });

  it('syncs hover time, shows nearest event tooltip, and ignores click-to-seek in axis margins', () => {
    const store = createAppStore();
    const onHoverT = vi.fn();
    const onSeek = vi.fn();
    const texts: string[] = [];
    listenCanvasText((s) => texts.push(s));
    const frames = Array.from({ length: 11 }, (_, i) => ({ t: i, d: { Q: i * 0.5 } }));
    const events = [{ t: 5, kind: 'LH' as const, msg: 'L→H transition: P_L 30 MW > P_LH 25 MW' }];
    const { container } = render(
      <AppStoreContext.Provider value={store}>
        <TimeChart frames={frames} series={lin()} timeUnit="s" tEnd={10} events={events} onHoverT={onHoverT} onSeek={onSeek} />
      </AppStoreContext.Provider>,
    );
    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 220, right: 600, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    // clicking in left axis margin (px = 10 < PAD.l = 58) must NOT trigger seek
    fireEvent.mouseDown(canvas, { clientX: 10 });
    fireEvent.mouseUp(canvas, { clientX: 10 });
    expect(onSeek).not.toHaveBeenCalled();
    // hovering near t=5 emits hoverT ~ 5 and draws event tooltip
    const midPx = 58 + (600 - 58 - 12) * 0.5;
    texts.length = 0;
    fireEvent.mouseMove(canvas, { clientX: midPx });
    expect(onHoverT).toHaveBeenCalled();
    expect(onHoverT.mock.calls.at(-1)![0]).toBeCloseTo(5, 1);
    expect(texts.some((s) => s.includes('L→H transition'))).toBe(true);
    // clicking inside plot seeks to t ~ 5
    fireEvent.mouseDown(canvas, { clientX: midPx });
    fireEvent.mouseUp(canvas, { clientX: midPx });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(5, 1);
  });
});
