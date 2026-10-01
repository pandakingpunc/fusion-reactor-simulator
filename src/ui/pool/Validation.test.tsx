// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NIF, Preset, TAE } from '../../physics/presets';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { RunPool } from './pool';
import { TESTS, TestDef, Validation } from './Validation';

beforeAll(installDomStubs);
afterEach(cleanup);

const drive = (workers: FakeWorker[]) => act(() => { for (const w of workers) if (!w.terminated) { w.process(); w.deliver(); } });

// small tests and presets, so that a run takes milliseconds
const PRESET_LIST: Preset[] = [
  { id: 'NIF', name: 'NIF small', desc: '', cfg: NIF, validation: 'Gain ≈ 1–2' },
  { id: 'TAE', name: 'TAE small', desc: '', cfg: { ...TAE, t_end: 0.01 } },
  { id: 'TAE2', name: 'TAE second', desc: '', cfg: { ...TAE, t_end: 0.01, seed: 2 } },
];
const TEST_LIST: TestDef[] = [
  { id: 'nif', presetId: 'NIF', title: 'NIF test', criteria: [
    // plumbing test: these ranges only have to be passed by the preset (G = 0.67, 1.37 MJ since the ICF model is calibrated on N210808);
    // they are not validation ranges, which live in physics/validation/references.ts
    { label: 'Gain', get: (r) => r.Q_sci_max, lo: 0.5, hi: 1, unit: '', source: 'N221204' },
    { label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 1, hi: 2, unit: 'MJ', source: '3.15 MJ' },
  ] },
  { id: 'tae', presetId: 'TAE', title: 'TAE test', criteria: [
    { label: 'Q must be huge', get: (r) => r.Q_sci_max, lo: 100, hi: 200, unit: '', source: 'impossible on purpose' },
  ] },
];

function mount(size = 2, store?: AppStore) {
  const f = fakeWorkerFactory();
  const pool = new RunPool(f.create, size);
  const r = render(<AppStoreContext.Provider value={store ?? createAppStore()}><Validation createWorker={f.create} pool={pool} tests={TEST_LIST} presets={PRESET_LIST} /></AppStoreContext.Provider>);
  return { ...r, f, pool };
}

describe('Validation view', () => {
  it('queues the tests on the pool, runs two at a time, and judges them against their criteria', async () => {
    const { f } = mount(1);
    expect(screen.getByText(/shared among 1 background workers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run 2 tests' }));
    // one worker: the first test runs, the second waits
    expect(f.workers).toHaveLength(1);
    expect(screen.getByText('queued')).toBeTruthy();
    expect(screen.getByText(/^running/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run 2 tests' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    drive(f.workers);
    await waitFor(() => expect(screen.getByText('PASS')).toBeTruthy());
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('FAIL')).toBeTruthy());
    expect(screen.getByText('1/2 tests passed')).toBeTruthy();
    expect(screen.getByText('2 of 2 finished')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    // the value of a criterion and its source
    expect(screen.getByText('N221204')).toBeTruthy();
    expect(screen.getAllByText(/Scheduled end/).length).toBe(2);
  });

  it('runs on several workers at once and lists the preset scan in the order of the presets', async () => {
    const { f } = mount(3);
    fireEvent.click(screen.getByRole('button', { name: 'Scan all presets' }));
    expect(f.workers).toHaveLength(3);
    expect(screen.getAllByText(/^running/)).toHaveLength(3);
    // finish in a different order than submitted: the last worker first
    act(() => { const w = f.workers[2]; w.process(); w.deliver(); });
    await waitFor(() => expect(screen.getByText('1 of 3 finished')).toBeTruthy());
    drive([f.workers[0], f.workers[1]]);
    await waitFor(() => expect(screen.getByText('3 of 3 finished')).toBeTruthy());
    const table = screen.getByText('Preset scan').closest('.panel') as HTMLElement;
    expect([...table.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')!.textContent)).toEqual(['NIF small', 'TAE small', 'TAE second']);
    expect(within(table).getByText('Gain ≈ 1–2')).toBeTruthy();
  });

  it('cancel stops the whole batch: queued runs never start, running ones lose their worker; then it can run again', async () => {
    const { f, pool } = mount(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run everything' }));
    expect(pool.stats).toMatchObject({ running: 1, queued: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
    expect(screen.getAllByText('cancelled').length).toBeGreaterThanOrEqual(4);
    expect(f.workers[0].terminated).toBe(true);
    expect(pool.stats).toMatchObject({ running: 0, queued: 0, cancelled: 5 });
    expect(f.workers).toHaveLength(1); // nothing started after the cancellation
    expect(screen.getByText('5 of 5 finished')).toBeTruthy();

    // the buttons are live again and a new batch starts a fresh count
    fireEvent.click(screen.getByRole('button', { name: 'Run 2 tests' }));
    expect(screen.getByText('0 of 2 finished')).toBeTruthy();
    expect(f.workers).toHaveLength(2);
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('PASS')).toBeTruthy());
  });

  it('runs a single test from its own button, and shows a failed run without stopping the others', async () => {
    const { f } = mount(2);
    fireEvent.click(within(screen.getByText('TAE test').closest('.panel') as HTMLElement).getByRole('button', { name: 'run' }));
    expect(f.workers).toHaveLength(1);
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('FAIL')).toBeTruthy());
    expect(screen.queryByText('PASS')).toBeNull();
    // a crashing worker shows its error in the test's panel
    fireEvent.click(within(screen.getByText('NIF test').closest('.panel') as HTMLElement).getByRole('button', { name: 'run' }));
    act(() => f.workers[f.workers.length - 1].crash('worker exploded'));
    await waitFor(() => expect(screen.getByText('worker exploded')).toBeTruthy());
    // and the run button of the failed test is usable again
    expect((within(screen.getByText('NIF test').closest('.panel') as HTMLElement).getByRole('button', { name: 'run' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('stops its workers and its jobs when the screen goes away', () => {
    const { f, unmount, pool } = mount(2);
    fireEvent.click(screen.getByRole('button', { name: 'Run everything' }));
    expect(pool.stats.running).toBe(2);
    unmount();
    expect(f.workers.every((w) => w.terminated)).toBe(true);
    expect(pool.stats).toMatchObject({ running: 0, queued: 0 });
  });

  it('builds a pool of its own (with the size of the machine) when none is given', () => {
    const f = fakeWorkerFactory();
    render(<AppStoreContext.Provider value={createAppStore()}><Validation createWorker={f.create} tests={TEST_LIST} presets={PRESET_LIST} /></AppStoreContext.Provider>);
    expect(screen.getByText(/shared among [1-4] background workers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run 2 tests' }));
    expect(f.workers.length).toBeGreaterThan(0);
  });

  it('is available in Turkish', async () => {
    const store = createAppStore();
    mount(1, store);
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(await screen.findByText('2 testi çalıştır')).toBeTruthy();
    expect(screen.getByText('Tüm hazır ayarları tara')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2 testi çalıştır' }));
    expect(screen.getByText('sırada')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.getAllByText('iptal edildi').length).toBe(2));
    await act(async () => { await store.actions.setLocale('en'); });
  });

  it('the published tests point at existing presets and their criteria have sensible ranges', async () => {
    const { PRESETS } = await import('../../physics/presets');
    for (const t of TESTS) {
      expect(PRESETS.some((p) => p.id === t.presetId), t.id).toBe(true);
      for (const c of t.criteria) { expect(c.lo).toBeLessThanOrEqual(c.hi); expect(c.source.length).toBeGreaterThan(5); }
    }
  });
});
