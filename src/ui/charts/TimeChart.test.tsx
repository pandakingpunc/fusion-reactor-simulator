// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Series, TimeChart } from './TimeChart';

beforeAll(installDomStubs);
afterEach(cleanup);

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
});
