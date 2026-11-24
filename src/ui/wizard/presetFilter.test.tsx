// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ITER, PRESETS } from '../../physics/presets';
import { AppStoreContext, createAppStore } from '../state/store';
import { Wizard } from './Wizard';

afterEach(cleanup);

function mountWizard() {
  const store = createAppStore();
  return render(
    <AppStoreContext.Provider value={store}>
      <Wizard cfg={ITER} setCfg={() => {}} name="ITER" setName={() => {}} onRun={() => {}} />
    </AppStoreContext.Provider>,
  );
}

describe('Wizard preset search and category filter', () => {
  it('filters presets by category chips (1.5D, Magnetic, Pulsed) and search text', () => {
    mountWizard();
    const count = () => document.querySelectorAll('.preset').length;
    expect(count()).toBe(PRESETS.length);

    fireEvent.click(screen.getByRole('button', { name: '1.5D' }));
    const count15 = PRESETS.filter((p) => (p.cfg as { fidelity?: string }).fidelity === '1.5D').length;
    expect(count()).toBe(count15);
    expect(screen.getByText(`${count15} / ${PRESETS.length}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Magnetic' }));
    const magCount = count();
    expect(magCount).toBeGreaterThan(0);
    expect(magCount).toBeLessThan(PRESETS.length);

    fireEvent.click(screen.getByRole('button', { name: 'Pulsed / alt.' }));
    const pulsedCount = count();
    expect(pulsedCount).toBeGreaterThan(0);
    expect(pulsedCount).toBeLessThan(PRESETS.length);
    expect(magCount + pulsedCount).toBe(PRESETS.length);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(count()).toBe(PRESETS.length);

    const search = screen.getByRole('searchbox', { name: 'Filter presets…' });
    fireEvent.change(search, { target: { value: 'sparc' } });
    expect(count()).toBeGreaterThanOrEqual(2);
    expect(count()).toBeLessThan(PRESETS.length);

    // empty match state and Clear button
    fireEvent.change(search, { target: { value: 'zzzz-nonexistent-reactor' } });
    expect(count()).toBe(0);
    expect(screen.getByText('No presets match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(count()).toBe(PRESETS.length);
  });
});
