// @vitest-environment jsdom
/** The live values of the run screen: glossary popovers on the labels of the channels that have a term, and the power flow of the run so far. */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SPARC } from '../../physics/presets';
import { makeShot } from '../compare/testShots';
import { AppStoreContext, createAppStore } from '../state/store';
import type { SavedShot } from '../state/types';
import { installDomStubs } from '../testing/dom';
import { LiveValuesPanel } from './panels/LiveValuesPanel';

beforeAll(installDomStubs);
afterEach(cleanup);

let shot: SavedShot;
beforeAll(() => { shot = makeShot(1, 'SPARC', { ...SPARC, t_end: 2 }); }, 60_000);

const mount = (frames = shot.frames) => render(
  <AppStoreContext.Provider value={createAppStore()}>
    <LiveValuesPanel meta={shot.meta} last={frames[frames.length - 1]} report={null} frames={frames} />
  </AppStoreContext.Provider>,
);

describe('LiveValuesPanel', () => {
  it('puts an Explain popover on the label of a channel that has a glossary term, and none on one that has not', () => {
    mount();
    const tiles = [...document.querySelectorAll('.kpi')] as HTMLElement[];
    const withTerm = tiles.filter((t) => t.querySelector('.explain-btn'));
    expect(withTerm.length).toBeGreaterThan(0);
    expect(withTerm.length).toBeLessThan(tiles.length);
    // the popover of the fusion gain is the glossary's
    const q = screen.getAllByRole('button', { name: 'Explain Scientific gain' })[0];
    fireEvent.click(q);
    expect(screen.getByRole('dialog', { name: 'Scientific gain' })).toBeTruthy();
    // the value and its unit are still in the tile
    expect(within(q.closest('.kpi') as HTMLElement).getByText(/^[\d.e+-]+$/)).toBeTruthy();
  });

  it('has the power flow of the run behind a summary line, drawn only once it is opened', () => {
    mount();
    const summary = screen.getByText('Power flow');
    expect(document.querySelector('.pf svg')).toBeNull();
    fireEvent.click(summary);
    expect(document.querySelector('.pf svg')).not.toBeNull();
    fireEvent.click(summary);
    expect(document.querySelector('.pf svg')).toBeNull();
  });

  it('has no power flow for a run without power channels', () => {
    const noPower = shot.frames.map((f) => ({ ...f, d: Object.fromEntries(Object.entries(f.d).filter(([k]) => k !== 'P_aux')) }));
    mount(noPower);
    expect(screen.queryByText('Power flow')).toBeNull();
  });
});
