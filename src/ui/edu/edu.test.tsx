// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../../edu/missions';
import { solveMission } from '../../edu/missionEval';
import { NIF, SPARC } from '../../physics/presets';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { makeShot } from '../compare/testShots';
import { RunPool } from '../pool/pool';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Explain } from './Explain';
import { GlossaryView } from './GlossaryView';
import { LearnView } from './LearnView';
import { PowerFlow } from './PowerFlow';
import { PROGRESS_KEY, loadSolved, saveSolved } from './progress';

beforeAll(installDomStubs);
beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

function withStore(node: React.ReactElement, store: AppStore = createAppStore()) {
  return { store, ...render(<AppStoreContext.Provider value={store}>{node}</AppStoreContext.Provider>) };
}

/** hand every live fake worker its queued messages and deliver the replies (inside act) */
const drive = (workers: FakeWorker[]) => act(() => { for (const w of workers) if (!w.terminated) { w.process(); w.deliver(); } });

describe('Explain popover', () => {
  it('opens with the name, symbol and definition of the term, and closes with Escape, the button and a click outside', () => {
    withStore(<div><Explain term="betaN"><span>β_N</span></Explain><span data-testid="outside">x</span></div>);
    const btn = screen.getByRole('button', { name: 'Explain Normalised beta' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    const dlg = screen.getByRole('dialog', { name: 'Normalised beta' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(dlg).getByText('β_N')).toBeTruthy();
    expect(dlg.textContent).toContain('plasma pressure over the magnetic pressure');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    fireEvent.click(btn); // the button toggles
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByRole('dialog')); // inside: stays open
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders the popover in a fixed-position portal outside a scrolling ancestor, so that it cannot be clipped', () => {
    withStore(
      <div data-testid="panel" style={{ overflowX: 'auto' }}>
        <table><tbody><tr><td><Explain term="betaN"><span>β_N</span></Explain></td></tr></tbody></table>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Explain/ }));
    const dlg = screen.getByRole('dialog');
    expect(screen.getByTestId('panel').contains(dlg)).toBe(false);
    expect(dlg.parentElement).toBe(document.body);
    expect(dlg.style.position).toBe('fixed');
    expect(dlg.style.visibility).toBe('visible');
    // Escape inside the portal still closes it, and a mouse-down inside it does not count as outside
    fireEvent.mouseDown(within(dlg).getByText('Normalised beta'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.querySelector('.explain-pop')).toBeNull();
  });

  it('switches to a related term inside the popover, and goes back to its own term when closed', () => {
    withStore(<Explain term="betaN"><span>β_N</span></Explain>);
    fireEvent.click(screen.getByRole('button', { name: /Explain/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Troyon limit' }));
    expect(screen.getByRole('dialog', { name: 'Troyon limit' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /Explain/ }));
    expect(screen.getByRole('dialog', { name: 'Normalised beta' })).toBeTruthy();
  });

  it('offers the glossary link only when a handler is given, and calls it with the term shown', () => {
    const seen: string[] = [];
    const { unmount } = withStore(<Explain term="q95"><span>q95</span></Explain>);
    fireEvent.click(screen.getByRole('button', { name: /Explain/ }));
    expect(screen.queryByRole('button', { name: 'Open in the glossary' })).toBeNull();
    unmount();
    withStore(<Explain term="q95" onOpenGlossary={(id) => seen.push(id)}><span>q95</span></Explain>);
    fireEvent.click(screen.getByRole('button', { name: /Explain/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Disruption/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in the glossary' }));
    expect(seen).toEqual(['disruption']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders only its children for a term that is not in the glossary', () => {
    withStore(<Explain term="no_such_term"><span data-testid="c">plain</span></Explain>);
    expect(screen.getByTestId('c').textContent).toBe('plain');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('speaks Turkish once the locale is switched', async () => {
    const { store } = withStore(<Explain term="betaN"><span>β_N</span></Explain>);
    await act(async () => { await store.actions.setLocale('tr'); });
    const btn = await screen.findByRole('button', { name: 'Normalize beta nedir?' });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog', { name: 'Normalize beta' }).textContent).toContain('Plazma basıncının manyetik basınca oranı');
    await act(async () => { await store.actions.setLocale('en'); });
    expect(await screen.findByRole('button', { name: 'Explain Normalised beta' })).toBeTruthy();
  });
});

describe('Glossary view', () => {
  it('lists every term, filters by search text and group, and says how many it shows', () => {
    withStore(<GlossaryView />);
    expect(screen.getAllByRole('article').length).toBeGreaterThanOrEqual(40);
    const all = screen.getAllByRole('article').length;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the glossary' }), { target: { value: 'pedestal' } });
    const found = screen.getAllByRole('article');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(all);
    expect(screen.getByText(`${found.length} terms`)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz-no-such' } });
    expect(screen.getByText('No term matches.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inertial fusion' }));
    expect(screen.getAllByRole('article').map((a) => a.querySelector('h3')!.textContent)).toEqual([
      expect.stringContaining('Hohlraum'), expect.stringContaining('Fuel adiabat'), expect.stringContaining('Drive asymmetry'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('article')).toHaveLength(all);
  });

  it('a related term is selected on click and the filters are cleared so that it is visible', () => {
    const picked: (string | null)[] = [];
    withStore(<GlossaryView onSelect={(id) => picked.push(id)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    const tokamak = screen.getAllByRole('article')[0];
    fireEvent.click(within(tokamak).getByRole('button', { name: 'Stellarator' }));
    expect(picked).toEqual(['stellarator']);
    expect(screen.getAllByRole('article').length).toBeGreaterThan(2);
  });

  it('marks the selected term', () => {
    withStore(<GlossaryView selected="elm" />);
    const sel = screen.getAllByRole('article').filter((a) => a.getAttribute('aria-current') === 'true');
    expect(sel).toHaveLength(1);
    expect(sel[0].querySelector('h3')!.textContent).toContain('Edge-localised mode');
  });
});

describe('PowerFlow', () => {
  const zero = makeShot(1, 'SPARC', { ...SPARC, t_end: 4 });

  it('draws the bars of the power balance with values, and switches the part of the run', () => {
    withStore(<PowerFlow frames={zero.frames} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('Auxiliary heating');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(8);
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(8);
    const flat = svg.getAttribute('aria-label');
    fireEvent.click(screen.getByRole('button', { name: 'instant of peak Q' }));
    expect(screen.getByRole('button', { name: 'instant of peak Q' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toBe(flat);
    expect(screen.getByText(/^Total /)).toBeTruthy();
  });

  it('explains a bar through a popover in the legend', () => {
    withStore(<PowerFlow frames={zero.frames} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain Alpha heating' }));
    expect(screen.getByRole('dialog', { name: 'Alpha heating' }).textContent).toContain('3.5 MeV');
  });

  it('says there is no power balance for a device without one, and can hide the part-of-shot selector', () => {
    const nif = makeShot(2, 'NIF', NIF);
    const { unmount } = withStore(<PowerFlow frames={nif.frames} />);
    expect(screen.getByText('No power balance for this kind of device.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    withStore(<PowerFlow frames={zero.frames} fixedWindow />);
    expect(screen.queryByRole('group', { name: 'Part of the shot' })).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
    cleanup();
    withStore(<PowerFlow frames={[]} />);
    expect(screen.getByText('No power balance for this kind of device.')).toBeTruthy();
  });
});

describe('progress storage', () => {
  it('keeps only known mission ids, survives damaged or missing storage', () => {
    expect(loadSolved()).toEqual([]);
    saveSolved(['hmode', 'nif']);
    expect(loadSolved()).toEqual(['hmode', 'nif']);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(['nif', 'made-up', 3]));
    expect(loadSolved()).toEqual(['nif']);
    localStorage.setItem(PROGRESS_KEY, '{not json');
    expect(loadSolved()).toEqual([]);
    localStorage.setItem(PROGRESS_KEY, '"a string"');
    expect(loadSolved()).toEqual([]);
  });
});

describe('Learn screen', () => {
  function mount(store?: AppStore) {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 2);
    const r = withStore(<LearnView createWorker={f.create} pool={pool} />, store);
    return { ...r, f, pool };
  }
  const openMission = (title: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
  const slider = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

  it('lists the ten missions with their machine and level', () => {
    mount();
    expect(screen.getByText('0 of 10 missions solved')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('mission-card'))).toHaveLength(10);
    const card = screen.getByRole('button', { name: /Reach H-mode/ });
    expect(card.textContent).toContain('DIII-D');
    expect(card.textContent).toContain('Easy');
    expect(screen.getByRole('button', { name: /Survive an ELM storm/ }).textContent).toContain('SPARC (1.5D)');
  });

  it('plays a run mission: a failing shot, a solving one, the verdict, the lesson, the saved progress', async () => {
    const { f } = mount();
    openMission('Squeeze the capsule evenly');
    expect(screen.getByText(/Starting point: NIF/)).toBeTruthy();
    expect(slider('Drive asymmetry').value).toBe('8');
    expect(screen.getAllByText('Target gain')).toHaveLength(2); // the glossary chip and the goal

    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    expect(f.workers).toHaveLength(1);
    expect(f.workers[0].sent[0]).toMatchObject({ type: 'runAll', keepFrames: true });
    expect(slider('Drive asymmetry').disabled).toBe(true); // locked while the shot runs
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('Not yet')).toBeTruthy());
    expect(screen.queryByText('Mission accomplished')).toBeNull();
    const goals = screen.getAllByRole('listitem');
    expect(goals[0].textContent).toContain('✓'); // survived
    expect(goals[1].textContent).toContain('✗'); // gain below 0.7
    expect(loadSolved()).toEqual([]);

    fireEvent.change(slider('Drive asymmetry'), { target: { value: '1' } });
    expect(screen.getByText('start 8.00 %')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('Mission accomplished')).toBeTruthy());
    expect(screen.getByText(/a symmetric implosion turns the same laser energy/)).toBeTruthy();
    expect(loadSolved()).toEqual(['nif']);
    // the workers are reused: two jobs, one worker
    expect(f.workers).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /All missions/ }));
    expect(screen.getByText('1 of 10 missions solved')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Squeeze the capsule evenly/ }).classList.contains('solved')).toBe(true);
  });

  it('shows the progress kept by an earlier visit', () => {
    saveSolved(['hmode', 'fuel', 'nif']);
    mount();
    expect(screen.getByText('3 of 10 missions solved')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fuel JET for the record/ }).classList.contains('solved')).toBe(true);
  });

  it('cancels a running shot and frees the controls', async () => {
    const { f, pool } = mount();
    openMission('Squeeze the capsule evenly');
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('The run was cancelled.')).toBeTruthy());
    expect(f.workers[0].terminated).toBe(true);
    expect(slider('Drive asymmetry').disabled).toBe(false);
    expect(pool.stats).toMatchObject({ cancelled: 1, running: 0 });
    expect(screen.queryByText('Not yet')).toBeNull();
  });

  it('reports a worker that fails', async () => {
    const { f } = mount();
    openMission('Squeeze the capsule evenly');
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    act(() => f.workers[0].crash('boom'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The run failed: boom');
    expect(screen.getByRole('button', { name: 'Run the shot' })).toBeTruthy();
  });

  it('gives two hints one after the other, then shows a solution and its explanation', async () => {
    mount();
    openMission('Squeeze the capsule evenly');
    const hint = screen.getByRole('button', { name: 'Hint' });
    fireEvent.click(hint);
    expect(screen.getByText(/The gain collapses quickly/)).toBeTruthy();
    expect(screen.queryByText(/Aim for about 1 %/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hint 2 of 2' }));
    expect(screen.getByText(/Aim for about 1 %/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Hint 2 of 2' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show a solution' }));
    expect(slider('Drive asymmetry').value).toBe('1');
    expect(screen.getByText('A solution is set on the controls. Run it to check.')).toBeTruthy();
    expect(screen.getByText(/About 1 % asymmetry gives a gain near 0.75/)).toBeTruthy();
    // touching a control takes the note away; reset restores the starting values
    fireEvent.change(slider('Drive asymmetry'), { target: { value: '5' } });
    expect(screen.queryByText('A solution is set on the controls. Run it to check.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset controls' }));
    expect(slider('Drive asymmetry').value).toBe('8');
  });

  it('every mission opens, has a control for each lever and a goal list', () => {
    mount();
    for (const m of MISSIONS) {
      openMission(m.id === 'hmode' ? 'Reach H-mode' : { density: 'Stay below the density limit', beta: 'Beat the beta limit', kink: 'Carry more current', sparcQ: 'Q above 3 on SPARC', ignition: 'Find ignition in POPCON', elm: 'Survive an ELM storm', fuel: 'Fuel JET for the record', nif: 'Squeeze the capsule evenly', tungsten: 'Keep the core clean' }[m.id]!);
      expect(screen.getAllByRole('listitem')).toHaveLength(m.goals.length);
      expect(document.querySelectorAll('.lever')).toHaveLength(m.levers.length);
      fireEvent.click(screen.getByRole('button', { name: /All missions/ }));
    }
  });

  it('a choice lever is a select; changing it changes the configuration that is run', async () => {
    const { f } = mount();
    openMission('Fuel JET for the record');
    const fuel = screen.getByLabelText('Fuel') as HTMLSelectElement;
    expect(fuel.value).toBe('DD');
    fireEvent.change(fuel, { target: { value: 'DT' } });
    fireEvent.change(slider('Deuterium fraction'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    expect(f.workers[0].sent[0]).toMatchObject({ cfg: { fuel: 'DT', fuelFracA: 0.5 } });
    act(() => { f.workers[0].terminate(); });
  });

  it('a logarithmic lever moves on a log scale and runs the value it shows', async () => {
    const { f } = mount();
    openMission('Keep the core clean');
    const w = slider('Tungsten concentration');
    expect(Number(w.min)).toBeCloseTo(-6, 9);
    expect(Number(w.max)).toBeCloseTo(-3, 9);
    expect(Number(w.value)).toBeCloseTo(Math.log10(3e-4), 6);
    fireEvent.change(w, { target: { value: String(Math.log10(1.5e-5)) } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    const sent = f.workers[0].sent[0] as unknown as { cfg: { impurity: { concentration: number } } };
    expect(sent.cfg.impurity.concentration).toBeCloseTo(1.5e-5, 9);
    act(() => { f.workers[0].terminate(); });
  });

  it('plays the POPCON mission: read the map at a bad point, then with the solution', async () => {
    mount();
    openMission('Find ignition in POPCON');
    expect(document.querySelector('canvas')).toBeTruthy();
    expect(screen.getByText(/The plasma needs [\d.]+ MW of auxiliary heating here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read the map' }));
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(loadSolved()).toEqual([]);

    const sol = solveMission(MISSIONS.find((m) => m.id === 'ignition')!);
    fireEvent.click(screen.getByRole('button', { name: 'Show a solution' }));
    expect(Number(slider('Confinement quality H98').value)).toBeCloseTo(Number(sol.H98), 9);
    expect(Number(slider('Operating temperature').value)).toBeCloseTo(Number(sol.pointT), 9);
    expect(screen.getByText(/The plasma is ignited here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read the map' }));
    expect(screen.getByText('Mission accomplished')).toBeTruthy();
    expect(loadSolved()).toEqual(['ignition']);
  });

  it('shows the power flow of a finished magnetic run', async () => {
    const { f } = mount();
    openMission('Fuel JET for the record');
    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: 'DT' } });
    fireEvent.change(slider('Deuterium fraction'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    drive(f.workers);
    await waitFor(() => expect(screen.getByText('Mission accomplished')).toBeTruthy(), { timeout: 20_000 });
    expect(screen.getByText('Power flow')).toBeTruthy();
    expect(screen.getAllByRole('img').some((i) => (i.getAttribute('aria-label') ?? '').includes('Alpha heating'))).toBe(true);
    expect(screen.getByText('The shot ended: Scheduled end')).toBeTruthy();
  }, 60_000);

  it('opens the glossary at a term from a mission popover', () => {
    mount();
    openMission('Squeeze the capsule evenly');
    const chips = screen.getByLabelText('Terms in this mission');
    fireEvent.click(within(chips).getByRole('button', { name: 'Explain Target gain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in the glossary' }));
    expect(screen.getByRole('tab', { name: 'Glossary' }).getAttribute('aria-selected')).toBe('true');
    const sel = screen.getAllByRole('article').filter((a) => a.getAttribute('aria-current') === 'true');
    expect(sel.map((a) => a.querySelector('h3')!.textContent)).toEqual([expect.stringContaining('Target gain')]);
    fireEvent.click(screen.getByRole('tab', { name: 'Missions' }));
    expect(screen.getAllByRole('button').some((b) => b.classList.contains('mission-card'))).toBe(true);
  });

  it('is available in Turkish', async () => {
    const store = createAppStore();
    mount(store);
    await act(async () => { await store.actions.setLocale('tr'); });
    expect(await screen.findByRole('button', { name: /H-moduna ulaş/ })).toBeTruthy();
    expect(screen.getByText('10 görevin 0 tanesi çözüldü')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /H-moduna ulaş/ }));
    expect(screen.getByText('Kontrolleriniz')).toBeTruthy();
    expect(screen.getByLabelText('Nötral demet gücü')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İpucu' }));
    expect(screen.getByText(/L-H eşiği P_LH/)).toBeTruthy();
    await act(async () => { await store.actions.setLocale('en'); });
  });

  it('stops its workers when the screen goes away', () => {
    const f = fakeWorkerFactory();
    const { unmount } = withStore(<LearnView createWorker={f.create} />);
    openMission('Squeeze the capsule evenly');
    fireEvent.click(screen.getByRole('button', { name: 'Run the shot' }));
    expect(f.workers).toHaveLength(1);
    unmount();
    expect(f.workers[0].terminated).toBe(true);
  });
});
