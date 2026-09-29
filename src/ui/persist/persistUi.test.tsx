// @vitest-environment jsdom
/**
 * The persistence features as a user meets them, through <App> with a fake simulation worker, an in-memory IndexedDB
 * (fake-indexeddb), a replay that runs in-process, and stubs of the clipboard and of file download.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { Simulation } from '../../physics/simulation';
import { PRESETS, TAE } from '../../physics/presets';
import { ReactorConfig } from '../../physics/types';
import { makeMeta } from '../../worker/host';
import { toUiFrame } from '../../worker/protocol';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore, initialAppState } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { ArchiveError, RunArchive } from './archive';
import { createPersistDeps, PersistDeps, PersistDepsContext } from './deps';
import EmbedView from './EmbedView';
import { encodeShare } from './codec';
import { replayRun } from './replayCore';
import { buildRunRecord, serializeRunRecord } from './runRecord';
import { persistTranslator, loadPersistTr } from './usePersistT';
import { APP_VERSION } from './version';
import type { SimApi } from '../useSim';

beforeAll(installDomStubs);
beforeEach(() => { window.location.hash = ''; });
afterEach(() => { cleanup(); window.location.hash = ''; });

interface Harness {
  store: AppStore;
  w: FakeWorker;
  deps: PersistDeps;
  downloads: { name: string; text: string; mime: string }[];
  copied: string[];
  archive: () => Promise<RunArchive>;
  advance(simDt: number): void;
  roundTrip(): void;
}

function mount(over: Partial<PersistDeps> = {}): Harness {
  const store = createAppStore();
  const factory = fakeWorkerFactory();
  const downloads: Harness['downloads'] = [];
  const copied: string[] = [];
  let n = 0;
  const idb = new IDBFactory();
  const deps = createPersistDeps({
    archive: (() => { let a: Promise<RunArchive> | null = null; return () => (a ??= RunArchive.open({ factory: idb, newId: () => `run${++n}` })); })(),
    replay: async (input, opts) => replayRun(input, opts?.onProgress),
    copy: async (text) => { copied.push(text); },
    baseUrl: () => 'https://example.test/app/',
    download: (name, text, mime) => { downloads.push({ name, text, mime }); },
    ...over,
  });
  render(
    <AppStoreContext.Provider value={store}>
      <PersistDepsContext.Provider value={deps}>
        <App createWorker={factory.create} schedule={(flush: () => void) => flush()} />
      </PersistDepsContext.Provider>
    </AppStoreContext.Provider>,
  );
  const w: FakeWorker = factory.workers[0];
  return {
    store, w, deps, downloads, copied, archive: deps.archive,
    advance: (dt) => act(() => { w.advance(dt); w.deliver(); }),
    roundTrip: () => act(() => { w.process(); w.deliver(); }),
  };
}

const presetRunButton = (id: string) => screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === id)];
async function completeTAE(h: Harness) {
  fireEvent.click(presetRunButton('TAE'));
  h.roundTrip();
  h.advance(TAE.t_end);
  await waitFor(async () => expect((await h.archive().then((a) => a.list())).length).toBe(1));
}

/** the run file of TAE, as the report's JSON button writes it */
function taeRunFile(mutate?: (rec: Record<string, unknown>) => void): string {
  const sim = new Simulation(TAE);
  const report = sim.runAll();
  const rec = buildRunRecord({ name: 'TAE file', cfg: TAE, report, events: sim.events, prov: { interventions: 0 } });
  if (mutate) mutate(rec as unknown as Record<string, unknown>);
  return serializeRunRecord(rec);
}

const openLibrary = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Saved runs' }));
  return screen.findByRole('dialog', { name: 'Saved runs' });
};

describe('persistence UI: the archive', () => {
  it('saves a completed run automatically, lists it, opens it in the Report, renames, exports and deletes it', async () => {
    const h = mount();
    await completeTAE(h);
    const dialog = await openLibrary();
    const row = await within(dialog).findByText('TAE Norman (FRC) #1');
    expect(row).toBeTruthy();

    // rename
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    const input = within(dialog).getByLabelText('Rename') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my FRC run' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await within(dialog).findByText('my FRC run')).toBeTruthy();

    // export writes a run file that re-imports (format, fingerprint of the inputs)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export JSON' }));
    await waitFor(() => expect(h.downloads).toHaveLength(1));
    expect(h.downloads[0].name).toBe('my_FRC_run_run.json');
    const rec = JSON.parse(h.downloads[0].text);
    expect(rec).toMatchObject({ format: 'fusion-simulator-run', appVersion: APP_VERSION });
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // open: the Report shows the archived shot once (opening the same run again adds no second shot)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(h.store.getState().tab).toBe('report'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const s = h.store.getState();
    expect(s.shots).toHaveLength(2); // the live shot and the opened one
    expect(s.viewId).toBe(s.shots[1].id);
    expect(s.shots[1].sourceKey).toMatch(/^archive:/);
    expect(await screen.findByTestId('shot-banner')).toBeTruthy();
    expect(window.location.hash).toBe('#/report');

    // delete
    const again = await openLibrary();
    fireEvent.click(await within(again).findByRole('button', { name: 'Delete' }));
    expect(await within(again).findByText(/No saved runs yet/)).toBeTruthy();
    expect((await h.archive().then((a) => a.list())).length).toBe(0);
  });

  it('does not save when automatic saving is switched off', async () => {
    localStorage.setItem('fusion-sim.archive.auto', '0');
    try {
      const h = mount();
      fireEvent.click(presetRunButton('TAE'));
      h.roundTrip();
      h.advance(TAE.t_end);
      expect(h.store.getState().shots).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 50));
      expect((await h.archive().then((a) => a.list())).length).toBe(0);
    } finally {
      localStorage.removeItem('fusion-sim.archive.auto');
    }
  });

  it('works without an archive: the run completes, the library says so', async () => {
    const h = mount({ archive: () => Promise.reject(new ArchiveError('unavailable', 'no IndexedDB')) });
    fireEvent.click(presetRunButton('TAE'));
    h.roundTrip();
    h.advance(TAE.t_end);
    expect(h.store.getState().shots).toHaveLength(1);
    const dialog = await openLibrary();
    expect(await within(dialog).findByText(/cannot keep an archive/)).toBeTruthy();
  });
});

describe('persistence UI: import of a run file', () => {
  const importFile = (dialog: HTMLElement, text: string) => {
    const file = new File([text], 'run.json', { type: 'application/json' });
    fireEvent.change(within(dialog).getByTestId('import-file'), { target: { files: [file] } });
  };

  it('shows a verified reproduction for an untouched file, and opens it in the Report', async () => {
    const h = mount();
    const dialog = await openLibrary();
    importFile(dialog, taeRunFile());
    const badge = await within(dialog).findByText(/Verified reproduction/, {}, { timeout: 15000 });
    expect(badge.closest('[data-verify]')?.getAttribute('data-verify')).toBe('verified');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save to archive' }));
    await waitFor(async () => expect((await h.archive().then((a) => a.list())).map((r) => [r.origin, r.verification])).toEqual([['import', 'verified']]));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open report' }));
    await waitFor(() => expect(h.store.getState().tab).toBe('report'));
    expect(h.store.getState().shots[0]).toMatchObject({ name: 'TAE file', verification: 'verified' });
  }, 30000);

  it('says so when the report in the file was edited', async () => {
    const h = mount();
    const dialog = await openLibrary();
    importFile(dialog, taeRunFile((rec) => { (rec.report as { Q_sci_max: number }).Q_sci_max = 99; }));
    const badge = await within(dialog).findByText(/Report differs/, {}, { timeout: 15000 });
    expect(badge.closest('[data-verify]')?.getAttribute('data-verify')).toBe('mismatch');
    // the Report never shows the number that was typed into the file, and the archive keeps the re-run's
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open report' }));
    await waitFor(() => expect(h.store.getState().tab).toBe('report'));
    const shown = h.store.getState().shots[0];
    expect(shown).toMatchObject({ verification: 'mismatch' });
    expect(shown.report.Q_sci_max).not.toBe(99);
  }, 30000);

  it('says so when the inputs were edited after the export, and refuses text that is not a run file', async () => {
    mount();
    const dialog = await openLibrary();
    importFile(dialog, taeRunFile((rec) => { (rec.cfg as { seed: number }).seed = 12345; }));
    expect(await within(dialog).findByText(/Inputs changed/, {}, { timeout: 15000 })).toBeTruthy();
    importFile(dialog, '{ this is not json');
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/could not be imported/);
  }, 30000);
});

describe('persistence UI: sharing', () => {
  it('builds a link that decodes to the configuration, and copies it', async () => {
    const h = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share this configuration' });
    const link = (await within(dialog).findByLabelText('Link')) as HTMLInputElement;
    expect(link.value.startsWith('https://example.test/app/#/share/')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(h.copied).toEqual([link.value]));
    const { decodeShare } = await import('./codec');
    const back = await decodeShare(link.value.split('#/share/')[1]);
    expect(back.payload.cfg).toEqual(h.store.getState().cfg);
    // the embed code points at the same code
    const html = (within(dialog).getByLabelText('HTML') as HTMLTextAreaElement).value;
    expect(html).toContain('#/embed/run/');
    expect(html).toContain(link.value.split('#/share/')[1]);
  });

  it('opens a shared link in the wizard with a notice, and rewrites the address', async () => {
    const cfg: ReactorConfig = { ...TAE, name: 'from a link' } as ReactorConfig;
    const code = await encodeShare({ cfg, name: 'Linked FRC', appVersion: APP_VERSION });
    window.location.hash = `#/share/${code}`;
    const h = mount();
    expect(await screen.findByText(/Opened "Linked FRC" from a shared link/)).toBeTruthy();
    expect(h.store.getState().cfgName).toBe('Linked FRC');
    expect(h.store.getState().cfg).toEqual(cfg);
    expect(h.store.getState().tab).toBe('setup');
    await waitFor(() => expect(window.location.hash).toBe('#/wizard'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/from a shared link/)).toBeNull();
  });

  it('a shared link opened while the Learn tab shows (ws10e x ws10b) lands in the wizard with its notice, and Learn deep links still work afterwards', async () => {
    const h = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Learn' }));
    expect(await screen.findByText('Learn fusion')).toBeTruthy();
    expect(window.location.hash).toBe('#/learn');
    const code = await encodeShare({ cfg: { ...TAE, name: 'from a link' } as ReactorConfig, name: 'Linked FRC', appVersion: APP_VERSION });
    act(() => { window.location.hash = `#/share/${code}`; });
    expect(await screen.findByText(/Opened "Linked FRC" from a shared link/)).toBeTruthy();
    expect(h.store.getState().tab).toBe('setup');
    await waitFor(() => expect(window.location.hash).toBe('#/wizard'));
    act(() => { window.location.hash = '#/learn/glossary/tauE'; });
    await waitFor(() => expect(h.store.getState().tab).toBe('learn'));
    expect(await screen.findByRole('searchbox')).toBeTruthy();
    expect(window.location.hash).toBe('#/learn/glossary/tauE');
  });

  it('says so, and stays on the wizard, when the link is damaged', async () => {
    const code = await encodeShare({ cfg: TAE, appVersion: APP_VERSION });
    window.location.hash = `#/share/${code.slice(0, -6)}AAAAAA`;
    const h = mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be opened/);
    expect(h.store.getState().cfg).toEqual(initialAppState().cfg);
    expect(h.store.getState().tab).toBe('setup');
    await waitFor(() => expect(window.location.hash).toBe('#/wizard'));
  });

  it('a link that carries the exact run offers to reproduce it, and reports whether the fingerprint matches', async () => {
    const sim = new Simulation(TAE, { breakpoints: [] });
    sim.advance(0.3 * sim.model.tEnd);
    sim.applyControl({ P_NBI_MW: 1 } as never);
    sim.runAll();
    const code = await encodeShare({ cfg: TAE, name: 'exact', appVersion: APP_VERSION, actuatorLog: sim.actuatorLog, breakpoints: sim.breakpoints, fingerprint: sim.fingerprint(APP_VERSION) });
    window.location.hash = `#/share/${code}`;
    const h = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Reproduce the run' }));
    expect(await screen.findByText(/Reproduced the shared run/, {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByText(/fingerprint matches/)).toBeTruthy();
    await waitFor(() => expect(h.store.getState().tab).toBe('report'));
    expect(h.store.getState().shots.at(-1)?.sourceKey).toMatch(/^share:/);
  }, 30000);
});

describe('persistence UI: embed views', () => {
  it('#/embed/run shows only the run screen and starts the run', async () => {
    const code = await encodeShare({ cfg: TAE, name: 'embedded', appVersion: APP_VERSION });
    window.location.hash = `#/embed/run/${code}?lang=en&autoplay=0`;
    const h = mount();
    await waitFor(() => expect(h.w.last('init')).toMatchObject({ autoPlay: false }));
    expect(document.querySelector('.topbar')).toBeNull();
    expect(screen.getByText(/Open in the simulator/).closest('a')?.getAttribute('href')).toBe(`https://example.test/app/#/share/${code}`);
    expect(await screen.findByText('embedded')).toBeTruthy();
  });

  it('#/embed with a damaged code says so and links to the simulator', async () => {
    window.location.hash = '#/embed/run/not-a-code';
    mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be opened/);
  });

  it('the report view computes the report from the code', async () => {
    const code = await encodeShare({ cfg: TAE, name: 'embedded report', appVersion: APP_VERSION });
    const store = createAppStore();
    const sim = {
      state: {}, load: vi.fn(),
      runAll: vi.fn(async (cfg: ReactorConfig, _keep?: boolean, onProgress?: (p: { t: number; tEnd: number }) => void) => {
        const s = new Simulation(cfg);
        const report = s.runAll();
        onProgress?.({ t: 1, tEnd: 2 });
        return { report, meta: makeMeta(s.model), frames: s.history.map(toUiFrame), events: s.events };
      }),
    } as unknown as SimApi;
    render(
      <AppStoreContext.Provider value={store}>
        <PersistDepsContext.Provider value={createPersistDeps({ baseUrl: () => 'https://example.test/app/' })}>
          <React.Suspense fallback={null}><EmbedView route={{ name: 'embed', view: 'report', code }} sim={sim} /></React.Suspense>
        </PersistDepsContext.Provider>
      </AppStoreContext.Provider>,
    );
    expect(await screen.findByText('Results summary', {}, { timeout: 15000 })).toBeTruthy();
    expect(sim.runAll).toHaveBeenCalledTimes(1);
    expect(store.getState().cfg).toEqual(TAE);
  }, 30000);
});

describe('persistence dictionary in use', () => {
  it('serves the Turkish strings once loaded and English before', async () => {
    expect(persistTranslator('tr')('persist.close')).toBe('Close');
    await loadPersistTr();
    expect(persistTranslator('tr')('persist.close')).not.toBe('Close');
    expect(persistTranslator('en')('persist.close')).toBe('Close');
  });
});
