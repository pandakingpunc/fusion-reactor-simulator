// @vitest-environment jsdom
/** The event log of the run screen: the kind filter chips, the 200-event window over the filtered list and the count in the title. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventKind, SimEvent } from '../../../physics/types';
import { AppStoreContext, createAppStore } from '../../state/store';
import { EventLogPanel } from './EventLogPanel';

afterEach(async () => { cleanup(); await createAppStore().actions.setLocale('en'); });

const ev = (t: number, kind: EventKind, msg = `${kind} ${t}`): SimEvent => ({ t, kind, msg });
/** an old warning, then 300 ELMs: the warning is beyond the 200 newest events */
const buried = (): SimEvent[] => [ev(0, 'warning', 'old warning'), ...Array.from({ length: 300 }, (_, i) => ev(i + 1, 'ELM'))];

const mount = (events: SimEvent[], store = createAppStore()) => {
  const r = render(<AppStoreContext.Provider value={store}><EventLogPanel events={events} timeUnit="s" /></AppStoreContext.Provider>);
  return { ...r, rerenderWith: (e: SimEvent[]) => r.rerender(<AppStoreContext.Provider value={store}><EventLogPanel events={e} timeUnit="s" /></AppStoreContext.Provider>) };
};
const rows = () => document.querySelectorAll('.event').length;
const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('EventLogPanel', () => {
  it('shows a chip per kind present, with its count, all pressed', () => {
    mount(buried());
    expect(chip(/^ELM 300$/).getAttribute('aria-pressed')).toBe('true');
    expect(chip(/^Warning 1$/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(rows()).toBe(200);
  });

  it('hiding ELM reveals the warning beyond the 200 newest, and the title shows shown / total', () => {
    mount(buried());
    expect(screen.queryByText('old warning')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Event log' }).parentElement!.textContent).toContain('301');
    fireEvent.click(chip(/^ELM/));
    expect(chip(/^ELM/).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('old warning')).toBeTruthy();
    expect(rows()).toBe(1);
    expect(screen.getByRole('heading', { name: 'Event log' }).parentElement!.textContent).toContain('1 / 301');
    fireEvent.click(chip(/^ELM/));
    expect(rows()).toBe(200);
    expect(screen.getByRole('heading', { name: 'Event log' }).parentElement!.textContent).not.toContain('/');
  });

  it('keeps a hidden kind hidden when new events arrive', () => {
    const { rerenderWith } = mount(buried());
    fireEvent.click(chip(/^ELM/));
    rerenderWith([...buried(), ev(400, 'ELM'), ev(401, 'sawtooth')]);
    expect(rows()).toBe(2); // the warning and the sawtooth; no ELM
    expect(chip(/^ELM 301$/).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows no chip row for a log of one kind', () => {
    mount([ev(1, 'ELM'), ev(2, 'ELM')]);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(rows()).toBe(2);
  });

  it('names the kinds in the interface language and falls back to the raw name of an unknown kind', async () => {
    const store = createAppStore();
    await act(async () => { await store.actions.setLocale('tr'); });
    mount([ev(1, 'sawtooth'), ev(2, 'warning'), ev(3, 'mystery' as EventKind)], store);
    expect(chip(/^Testere dişi 1$/)).toBeTruthy();
    expect(chip(/^Uyarı 1$/)).toBeTruthy();
    expect(chip(/^mystery 1$/)).toBeTruthy();
  });
});
