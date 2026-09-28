// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TimeChart } from './TimeChart';
import { installDomStubs } from '../testing/dom';

beforeAll(installDomStubs);
afterEach(cleanup);

describe('TimeChart wheel zoom', () => {
  it('owns the wheel: the event is cancelled (non-passive listener) and the view zooms', () => {
    const frames = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, d: { Ti: i } }));
    const { container } = render(React.createElement(TimeChart, {
      frames, series: [{ key: 'Ti', label: 'T_i', unit: 'keV', color: '#fff' }], timeUnit: 's', tEnd: 5,
    }));
    const canvas = container.querySelector('canvas')!;
    expect(screen.queryByTitle('reset zoom (double-click)')).toBeNull();
    const ev = new WheelEvent('wheel', { deltaY: -100, clientX: 200, cancelable: true, bubbles: true });
    act(() => { canvas.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTitle('reset zoom (double-click)')).toBeTruthy();
  });
});
