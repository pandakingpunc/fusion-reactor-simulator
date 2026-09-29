// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DIIID, NIF, SPARC } from '../../physics/presets';
import { SavedShot } from '../state/types';
import { AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Compare } from './Compare';
import { makeShot } from './testShots';

beforeAll(installDomStubs);
afterEach(cleanup);

// three real archived shots: two magnetic devices (seconds) and one inertial shot (nanoseconds)
let sparc: SavedShot, sparc2: SavedShot, diiid: SavedShot, nif: SavedShot;
beforeAll(() => {
  sparc = makeShot(1, 'SPARC #1', { ...SPARC, t_end: 4 });
  sparc2 = makeShot(2, 'SPARC #2', { ...SPARC, t_end: 4, H98: 1.1, heating: { ...SPARC.heating, P_ICRH_MW: 30 } });
  diiid = makeShot(3, 'DIII-D #1', { ...DIIID, t_end: 3 });
  nif = makeShot(4, 'NIF #1', NIF);
}, 60_000);
afterAll(() => { vi.restoreAllMocks(); });

function mount(shots: SavedShot[], extra: Partial<React.ComponentProps<typeof Compare>> = {}) {
  const onRemove = vi.fn(), onLoad = vi.fn();
  const store = createAppStore();
  const r = render(<AppStoreContext.Provider value={store}><Compare shots={shots} onRemove={onRemove} onLoad={onLoad} {...extra} /></AppStoreContext.Provider>);
  return { ...r, onRemove, onLoad, store };
}

/** the polygons of the shots in a radar chart (the rings are direct children of the svg, the shots sit in groups) */
const chart = (name: RegExp | string) => screen.getByRole('img', { name });
const polygons = (svg: Element) => [...svg.querySelectorAll('g > polygon')];

describe('Compare 2.0', () => {
  it('shows the empty message without shots', () => {
    mount([]);
    expect(screen.getByText(/./).textContent).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the headline table: one column per shot, the best value marked, load and remove buttons', () => {
    const { onLoad, onRemove } = mount([sparc, sparc2]);
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByText('SPARC #1')).toBeTruthy();
    expect(within(table).getByText('SPARC #2')).toBeTruthy();
    expect(table.querySelectorAll('td.ok').length).toBeGreaterThan(3);
    fireEvent.click(within(table).getAllByRole('button', { name: /^Load|Setup|Kur/i })[0]);
    expect(onLoad).toHaveBeenCalledWith(sparc);
    fireEvent.click(within(table).getAllByText('×')[1]);
    expect(onRemove).toHaveBeenCalledWith(2);
    // a glossary popover on a quantity
    fireEvent.click(within(table).getAllByRole('button', { name: 'Explain Scientific gain' })[0]);
    expect(screen.getByRole('dialog', { name: 'Scientific gain' })).toBeTruthy();
  });

  it('draws one radar polygon per shown shot and toggles a shot with its checkbox', () => {
    mount([sparc, sparc2, diiid]);
    const radar = chart('Radar of headline metrics');
    expect(polygons(radar)).toHaveLength(3); // the rings are not inside a group
    expect(radar.textContent).toContain('Q_sci max');
    expect(radar.textContent).toContain('Lawson ratio');
    const box = screen.getByRole('checkbox', { name: /SPARC #2/ }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(polygons(chart('Radar of headline metrics'))).toHaveLength(2);
    fireEvent.click(box);
    expect(polygons(chart('Radar of headline metrics'))).toHaveLength(3);
  });

  it('the radar scale switches between linear and log, which moves the polygon of a weaker shot outwards', () => {
    mount([sparc, diiid]);
    const points = () => polygons(chart('Radar of headline metrics'))[1].getAttribute('points');
    const lin = points();
    fireEvent.click(screen.getByRole('button', { name: 'log' }));
    expect(screen.getByRole('button', { name: 'log' }).getAttribute('aria-pressed')).toBe('true');
    expect(points()).not.toBe(lin);
  });

  it('overlays a channel of all shown shots, lists the channels they share, and can plot fractions of the shot', () => {
    mount([sparc, sparc2]);
    const overlay = () => screen.getAllByRole('img').find((i) => (i.getAttribute('aria-label') ?? '').startsWith('Overlay of runs'))!;
    expect(overlay().querySelectorAll('polyline')).toHaveLength(2);
    const select = screen.getByRole('combobox', { name: 'Channel' }) as HTMLSelectElement;
    expect(select.value).toBe('Q');
    const label = overlay().getAttribute('aria-label');
    fireEvent.change(select, { target: { value: 'Ti' } });
    expect(overlay().getAttribute('aria-label')).not.toBe(label);
    expect(overlay().querySelectorAll('polyline')).toHaveLength(2);
    expect(overlay().textContent).toContain('t [s]');
    fireEvent.click(screen.getByRole('button', { name: 'fraction of the shot' }));
    expect(overlay().textContent).toContain('fraction of the shot');
    fireEvent.click(screen.getByRole('checkbox', { name: /SPARC #2/ }));
    expect(overlay().querySelectorAll('polyline')).toHaveLength(1);
  });

  it('shots with different time units get the normalised axis, and only the channels they share', () => {
    mount([sparc, nif]);
    const abs = screen.getByRole('button', { name: 'absolute' }) as HTMLButtonElement;
    expect(abs.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'fraction of the shot' }).getAttribute('aria-pressed')).toBe('true');
    const select = screen.getByRole('combobox', { name: 'Channel' }) as HTMLSelectElement;
    const shared = [...select.options].map((o) => o.value);
    for (const k of shared) {
      expect(sparc.meta.diagSpecs.some((d) => d.key === k)).toBe(true);
      expect(nif.meta.diagSpecs.some((d) => d.key === k)).toBe(true);
    }
  });

  it('says so when no shot is shown, or when the shown shots share no channel', () => {
    mount([sparc, sparc2]);
    fireEvent.click(screen.getByRole('checkbox', { name: /SPARC #1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /SPARC #2/ }));
    expect(screen.getByText('No shot is shown: tick at least one.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Radar of headline metrics' })).toBeNull();
    cleanup();
    const stranger = { ...nif, id: 9, name: 'Stranger', meta: { ...nif.meta, diagSpecs: [{ key: 'zzz', label: 'z', unit: '', group: 'g' }] } };
    mount([sparc, stranger]);
    expect(screen.getByText('The shown shots have no diagnostic channel in common.')).toBeTruthy();
  });

  it('lists the configuration fields that differ between two chosen shots', () => {
    mount([sparc, sparc2, diiid]);
    const panel = screen.getByText('Configuration difference').closest('.panel') as HTMLElement;
    // default: the first and the last shot (SPARC vs DIII-D: many fields)
    expect(within(panel).getByText(/\d+ fields differ/)).toBeTruthy();
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Compared with' }), { target: { value: '2' } });
    expect(within(panel).getByText('2 fields differ')).toBeTruthy();
    const rows = [...panel.querySelectorAll('tbody tr:not(.group)')];
    const byPath = Object.fromEntries(rows.map((r) => [r.querySelector('td.path')!.textContent!.replace(/ⓘ$/, ''), [...r.querySelectorAll('td')].slice(1).map((c) => c.textContent)]));
    expect(Object.keys(byPath).sort()).toEqual(['H98', 'heating.P_ICRH_MW']);
    expect(byPath.H98).toEqual(['1.00', '1.10', '+10.0 %']);
    expect(byPath['heating.P_ICRH_MW']).toEqual(['25.0', '30.0', '+20.0 %']);
    // the same shot on both sides: nothing differs
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Baseline' }), { target: { value: '2' } });
    expect(within(panel).getByText('The two configurations are identical.')).toBeTruthy();
  });

  it('asks for a second shot before it can diff, and falls back when a chosen shot is removed', () => {
    const { rerender, onLoad, onRemove } = mount([sparc]);
    expect(screen.getByText('Archive at least two shots to compare their configurations.')).toBeTruthy();
    rerender(<AppStoreContext.Provider value={createAppStore()}><Compare shots={[sparc, sparc2, diiid]} onRemove={onRemove} onLoad={onLoad} /></AppStoreContext.Provider>);
    const panel = screen.getByText('Configuration difference').closest('.panel') as HTMLElement;
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Compared with' }), { target: { value: '2' } });
    rerender(<AppStoreContext.Provider value={createAppStore()}><Compare shots={[sparc, diiid]} onRemove={onRemove} onLoad={onLoad} /></AppStoreContext.Provider>);
    expect((within(panel).getByRole('combobox', { name: 'Compared with' }) as HTMLSelectElement).value).toBe('3'); // fell back to the last shot
  });

  it('shows the power flow of a chosen shot, and says none exists for a pulsed one', () => {
    mount([sparc, nif]);
    const panel = screen.getByText('Power flow of a shot').closest('.panel') as HTMLElement;
    expect(within(panel).getByRole('img').getAttribute('aria-label')).toContain('Alpha heating');
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Shot' }), { target: { value: '4' } });
    expect(within(panel).getByText('No power balance for this kind of device.')).toBeTruthy();
  });

  it('is available in Turkish', async () => {
    const { store } = mount([sparc, sparc2]);
    const { act } = await import('@testing-library/react');
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(await screen.findByText('Yapılandırma farkı')).toBeTruthy();
    expect(screen.getByText('Başlıca ölçütlerin radarı')).toBeTruthy();
    expect(screen.getByText('2 alan farklı')).toBeTruthy();
    await act(async () => { await store.actions.setLocale('en'); });
  });
});
