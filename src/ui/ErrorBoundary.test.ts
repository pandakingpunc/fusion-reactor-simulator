// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);
// React reports every caught error on the console; keep the test output readable
let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => quiet.mockRestore());

/** throws while drawing (in an effect, like the canvas views) when `bad` is set */
function Drawing({ bad }: { bad: boolean }) {
  useEffect(() => { if (bad) throw new TypeError("Cannot read properties of undefined (reading 'map')"); }, [bad]);
  return React.createElement('p', null, 'drawn');
}

const tree = (bad: boolean, key: number, variant?: 'view' | 'panel') =>
  React.createElement('div', null,
    React.createElement('h1', null, 'top bar'),
    React.createElement(ErrorBoundary, { resetKeys: [key], variant }, React.createElement(Drawing, { bad })));

describe('ErrorBoundary', () => {
  it('shows a drawing error in place instead of unmounting the page', () => {
    render(tree(true, 1));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This view could not be drawn');
    expect(alert.textContent).toContain("reading 'map'");
    expect(screen.getByText('top bar')).toBeTruthy();
    expect(screen.queryByText('drawn')).toBeNull();
  });

  it('draws again after "Try again" once the cause is gone, or when a reset key changes', () => {
    const { rerender } = render(tree(true, 1, 'panel'));
    expect(screen.getByRole('alert').textContent).toContain('This panel could not be drawn');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('alert')).toBeTruthy(); // still broken: caught again

    rerender(tree(false, 1, 'panel'));
    expect(screen.getByRole('alert')).toBeTruthy(); // same keys: the error stays until retried
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('drawn')).toBeTruthy();

    rerender(tree(true, 1, 'panel'));
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(tree(false, 2, 'panel')); // e.g. a new run or a new timeline branch
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('drawn')).toBeTruthy();
  });
});
