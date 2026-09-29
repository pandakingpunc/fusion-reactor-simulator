// @vitest-environment jsdom
/**
 * The Report and Compare screens in front of the key table: labels and units in the interface language with the raw key as the
 * tooltip, Explain popovers on the labels that have a glossary term, the power flow of a magnetic run, the embedded report without
 * its toolbar, the verification badge of an imported shot and the engineering rows of Compare.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SPARC } from '../../physics/presets';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import type { SavedShot } from '../state/types';
import { installDomStubs } from '../testing/dom';
import { Compare } from '../compare/Compare';
import { makeShot } from '../compare/testShots';
import { Report } from './Report';

beforeAll(installDomStubs);
let store: AppStore = createAppStore();
afterEach(async () => { cleanup(); await store.actions.setLocale('en'); });

let shot: SavedShot;
beforeAll(() => { shot = makeShot(1, 'SPARC #1', { ...SPARC, t_end: 3 }); }, 60_000);

function mountReport(props: Partial<React.ComponentProps<typeof Report>> = {}) {
  store = createAppStore();
  return render(<AppStoreContext.Provider value={store}><Report shot={shot} onRerun={() => undefined} onEdit={() => undefined} {...props} /></AppStoreContext.Provider>);
}
/** the row of the engineering or extras table whose raw key is `key` (the raw key is the row's tooltip) */
const row = (key: string) => document.querySelector(`tr[title="${key}"]`) as HTMLTableRowElement;

describe('Report: engineering keys', () => {
  it('shows the label and unit in English, and keeps the raw key as the tooltip', () => {
    mountReport();
    const r = row('Cryoplant power (MW)');
    expect(r.cells[0].textContent).toBe('Cryoplant electric power');
    expect(r.cells[1].textContent).toMatch(/^[\d.]+ MW$/);
    // the edge and systems rows read as words too, and no row prints an English key with its unit inside
    expect(row('Target q_peak, two-point (MW/m²)').cells[0].textContent).toContain('Peak target heat flux (two-point model)');
    expect(row('TF stress margin').cells[0].textContent).toBe('TF stress margin');
    expect(screen.queryByText('Cryo pulse length (s)')).toBeNull();
  });

  it('shows them in Turkish after the switch, translated values included', async () => {
    store = createAppStore();
    await store.actions.setLocale('tr');
    render(<AppStoreContext.Provider value={store}><Report shot={shot} onRerun={() => undefined} onEdit={() => undefined} /></AppStoreContext.Provider>);
    expect(row('Cryo pulse length (s)').cells[0].textContent).toBe('Kriyojenik tesis için alınan atım süresi');
    expect(row('dpa/year').cells[1].textContent).toMatch(/dpa\/yıl$/);
    expect(row('Detachment state').cells[1].textContent).toMatch(/^(bağlı|kısmen ayrılmış|ayrılmış)$/);
    expect(row('Flux margin').cells[0].textContent).toBe('Akı payı');
  });

  it('puts a glossary popover on the labels that have a term and on the summary quantities', () => {
    mountReport();
    const q = screen.getAllByRole('button', { name: 'Explain Scientific gain' })[0];
    fireEvent.click(q);
    expect(screen.getByRole('dialog', { name: 'Scientific gain' })).toBeTruthy();
    // a table label with a term: the divertor row
    fireEvent.click(within(row('Divertor q_max (MW/m²)')).getByRole('button'));
    expect(screen.getByRole('dialog', { name: 'Divertor' })).toBeTruthy();
  });
});

describe('Report: power flow and the embedded view', () => {
  it('draws the power flow of a magnetic run', () => {
    mountReport();
    expect(screen.getByText('Power flow')).toBeTruthy();
    expect(document.querySelector('.pf svg')).toBeTruthy();
  });

  it('has the full toolbar in the app and none in the embedded view', () => {
    const { unmount } = mountReport();
    expect(screen.getByText('Run again')).toBeTruthy();
    expect(screen.getByText('SVG ↓')).toBeTruthy();
    unmount();
    mountReport({ embedded: true });
    expect(screen.queryByText('Run again')).toBeNull();
    expect(screen.queryByText('SVG ↓')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByText(/Shot duration/)).toBeTruthy(); // the results stay
  });
});

describe('Compare: verification and engineering rows', () => {
  it('shows the verification badge of a shot that carries one, and only of that shot', () => {
    store = createAppStore();
    const a: SavedShot = { ...shot, id: 1, name: 'imported', verification: 'verified' };
    const b: SavedShot = { ...shot, id: 2, name: 'live' };
    render(<AppStoreContext.Provider value={store}><Compare shots={[a, b]} onRemove={() => undefined} onLoad={() => undefined} /></AppStoreContext.Provider>);
    const badges = document.querySelectorAll('[data-verify]');
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute('data-verify')).toBe('verified');
  });

  it('lists the engineering values of the shots in the language, on request', async () => {
    store = createAppStore();
    const a: SavedShot = { ...shot, id: 1, name: 'A' };
    const b: SavedShot = { ...shot, id: 2, name: 'B', report: { ...shot.report, engineering: { ...shot.report.engineering, 'Only in B (kg)': 7 } } };
    render(<AppStoreContext.Provider value={store}><Compare shots={[a, b]} onRemove={() => undefined} onLoad={() => undefined} /></AppStoreContext.Provider>);
    expect(document.querySelector('tr[title="Cryoplant power (MW)"]')).toBeNull(); // folded away
    fireEvent.click(screen.getByRole('button', { name: /Show the engineering values/ }));
    const r = row('Cryoplant power (MW)');
    expect(r.cells[0].textContent).toContain('Cryoplant electric power');
    expect(r.cells[0].textContent).toContain('[MW]');
    expect(r.cells[1].textContent).toBe(r.cells[2].textContent);
    // a key one shot lacks is a dash there, and an unknown key is shown as written
    expect(row('Only in B (kg)').cells[0].textContent).toContain('Only in B (kg)');
    expect(row('Only in B (kg)').cells[1].textContent).toBe('—');
    expect(row('Only in B (kg)').cells[2].textContent).toBe('7.00');
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(row('Cryoplant power (MW)').cells[0].textContent).toContain('Kriyojenik tesisin elektrik gücü');
  });
});
