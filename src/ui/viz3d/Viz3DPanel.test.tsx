// @vitest-environment jsdom
/** The 3D view's Show / Hide choice is kept in the browser: a new page view opens the panel the way it was left. */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStubs } from '../testing/dom';

// the view itself (WebGL) is not what is tested here
vi.mock('./Viz3D', () => ({ default: () => React.createElement('div', { 'data-testid': 'viz3d-view' }, 'view') }));

const KEY = 'fusion-sim.viz3d.open';
const props = {} as never;

beforeEach(() => { installDomStubs(); localStorage.clear(); vi.resetModules(); });
afterEach(cleanup);

/** a fresh module instance is a new page view (the session's own choice is a module variable) */
async function pageView() {
  const { Viz3DPanel } = await import('./Viz3DPanel');
  return render(React.createElement(Viz3DPanel, props));
}
const button = () => screen.getByRole('button');

describe('Viz3DPanel persistence', () => {
  it('starts hidden, and Show / Hide are written to the browser', async () => {
    await pageView();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem(KEY)).toBeNull();
    fireEvent.click(button());
    expect(localStorage.getItem(KEY)).toBe('1');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByTestId('viz3d-view')).toBeTruthy();
    fireEvent.click(button());
    expect(localStorage.getItem(KEY)).toBe('0');
    expect(screen.queryByTestId('viz3d-view')).toBeNull();
  });

  it('opens the way the last page view left it', async () => {
    localStorage.setItem(KEY, '1');
    await pageView();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    cleanup();
    localStorage.setItem(KEY, '0');
    vi.resetModules();
    await pageView();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('works without storage: the choice lasts for the session', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      const { Viz3DPanel } = await import('./Viz3DPanel');
      const first = render(React.createElement(Viz3DPanel, props));
      expect(button().getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(button());
      expect(button().getAttribute('aria-expanded')).toBe('true');
      first.unmount(); // the run screen is left and entered again in the same page view
      render(React.createElement(Viz3DPanel, props));
      expect(button().getAttribute('aria-expanded')).toBe('true');
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
