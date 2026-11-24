// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UiFrame } from '../../worker/protocol';
import { AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs, listenCanvasText } from '../testing/dom';
import { ProfileChart, interpProfile } from './ProfileChart';
import { RhoTHeatmap, buildRhoTGrid, lutRgb, sampleRhoTGrid } from './RhoTHeatmap';

beforeAll(installDomStubs);
afterEach(() => { listenCanvasText(null); cleanup(); });

function makeFrames(): UiFrame[] {
  const rho = [0, 0.25, 0.5, 0.75, 1.0];
  return [0, 5, 10].map((t) => ({
    t,
    d: { Ti0: 5 + t },
    prof: {
      rho,
      Te: rho.map((r) => (5 + t) * (1 - 0.8 * r * r)),
      Ti: rho.map((r) => (4 + t) * (1 - 0.8 * r * r)),
      ne: rho.map((r) => 1.0 - 0.4 * r * r),
      q: rho.map((r) => 1.0 + 2.5 * r * r),
    },
  }));
}

describe('RhoTHeatmap helpers', () => {
  it('parses matplotlib 256-entry RGB lookup tables', () => {
    const inf = lutRgb('inferno');
    expect(inf.length).toBe(256 * 3);
    // dark start, bright yellow-white end
    expect(inf[0] + inf[1] + inf[2]).toBeLessThan(20);
    expect(inf[255 * 3] + inf[255 * 3 + 1] + inf[255 * 3 + 2]).toBeGreaterThan(600);
  });

  it('builds a uniform grid from 1.5D frames and samples values accurately', () => {
    const frames = makeFrames();
    expect(buildRhoTGrid(frames.slice(0, 1), 'Te')).toBeNull();
    const g = buildRhoTGrid(frames, 'Te', 21)!;
    expect(g).not.toBeNull();
    expect(g.t0).toBe(0);
    expect(g.t1).toBe(10);
    expect(g.vmin).toBeCloseTo(1.0, 6); // t=0, rho=1 -> 5 * 0.2 = 1
    expect(g.vmax).toBeCloseTo(15.0, 6); // t=10, rho=0 -> 15
    expect(sampleRhoTGrid(g, 0, 0)).toBeCloseTo(5.0, 4);
    expect(sampleRhoTGrid(g, 1, 0)).toBeCloseTo(15.0, 4);
    expect(sampleRhoTGrid(g, 0.5, 0)).toBeCloseTo(10.0, 4);
  });

  it('interpolates radial profile curves linearly', () => {
    expect(interpProfile([0, 0.5, 1], [10, 6, 2], 0.25)).toBeCloseTo(8, 9);
    expect(interpProfile([0, 0.5, 1], [10, 6, 2], 0)).toBe(10);
    expect(interpProfile([0, 0.5, 1], [10, 6, 2], 1)).toBe(2);
    expect(Number.isNaN(interpProfile([], [], 0.5))).toBe(true);
  });
});

describe('RhoTHeatmap & ProfileChart UI', () => {
  it('switches quantities and calls onSelectT when clicked inside the plot', () => {
    const store = createAppStore();
    const onSelectT = vi.fn();
    render(
      <AppStoreContext.Provider value={store}>
        <RhoTHeatmap frames={makeFrames()} timeUnit="s" onSelectT={onSelectT} />
      </AppStoreContext.Provider>,
    );
    const canvas = screen.getByRole('img', { name: /T_e/ }) as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 360, height: 230, right: 360, bottom: 230, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 44 + (360 - 44 - 62) / 2, clientY: 100 });
    expect(onSelectT).toHaveBeenCalledTimes(1);
    expect(onSelectT.mock.calls[0][0]).toBeCloseTo(5, 1);

    fireEvent.click(screen.getByRole('button', { name: 'n_e' }));
    expect(screen.getByRole('img', { name: /n_e/ })).toBeTruthy();
  });

  it('draws hover readout on ProfileChart when moving the pointer across the plot', () => {
    const store = createAppStore();
    const texts: string[] = [];
    listenCanvasText((s) => texts.push(s));
    const frames = makeFrames();
    render(
      <AppStoreContext.Provider value={store}>
        <ProfileChart prof={frames[2].prof} compareProf={frames[0].prof} compareLabel="t = 0.0 s" t="t = 10.0 s" />
      </AppStoreContext.Provider>,
    );
    const canvas = screen.getByRole('img') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 320, height: 220, right: 320, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    texts.length = 0;
    fireEvent.mouseMove(canvas, { clientX: 46 + (320 - 92) * 0.5, clientY: 100 });
    expect(texts.some((s) => s.includes('ρ_tor = 0.50'))).toBe(true);
    expect(texts.some((s) => s.includes('T_e:'))).toBe(true);
  });
});
