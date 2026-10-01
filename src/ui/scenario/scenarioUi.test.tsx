// @vitest-environment jsdom
/**
 * The scenario UI as a user meets it, through <App> with a fake simulation worker: the wizard's Scenario step (lanes with draggable
 * points, templates, triggers, the text form), a run with a scenario (init message, an invalid scenario as an error, programmed against
 * actual lanes, record mode), the completion message that lets a run with interventions be signed, and share links that carry the
 * scenario (checked against the model first) or the exact run.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { PRESETS, TAE } from '../../physics/presets';
import { Simulation } from '../../physics/simulation';
import { dropTemplate, type ScenarioSpec } from '../../physics/scenario';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { RunArchive } from '../persist/archive';
import { loadScenarioTr } from './useScenarioT';
import { createPersistDeps, PersistDepsContext } from '../persist/deps';
import { encodeShare, decodeShare } from '../persist/codec';
import { replayRun } from '../persist/replayCore';
import { APP_VERSION } from '../persist/version';

// the first test loads the lazy editor chunk (a cold transform): on a machine shared with other jobs it takes longer than the 1 s default
beforeAll(() => { installDomStubs(); configure({ asyncUtilTimeout: 8000 }); });
vi.setConfig({ testTimeout: 30000 }); // the lazy editor chunk and the workers are slow on a loaded machine
beforeEach(() => { window.location.hash = ''; });
afterEach(() => { cleanup(); window.location.hash = ''; });

const T = TAE.t_end;

interface Harness {
  store: AppStore;
  factory: ReturnType<typeof fakeWorkerFactory>;
  live: FakeWorker;
  copied: string[];
  roundTrip(): void;
  advance(dt: number): void;
}

/** the app with a configuration object of its own (the model of a configuration is probed once per object) */
function mount(init: Partial<Parameters<typeof createAppStore>[0]> = {}): Harness {
  const store = createAppStore({ cfg: { ...TAE }, cfgName: 'TAE Norman (FRC)', ...init });
  const factory = fakeWorkerFactory();
  const copied: string[] = [];
  let n = 0;
  const idb = new IDBFactory();
  const deps = createPersistDeps({
    archive: (() => { let a: Promise<RunArchive> | null = null; return () => (a ??= RunArchive.open({ factory: idb, newId: () => `run${++n}` })); })(),
    replay: async (input, opts) => replayRun(input, opts?.onProgress),
    copy: async (text) => { copied.push(text); },
    baseUrl: () => 'https://example.test/app/',
    download: () => undefined,
  });
  render(
    <AppStoreContext.Provider value={store}>
      <PersistDepsContext.Provider value={deps}>
        <App createWorker={factory.create} schedule={(flush: () => void) => flush()} />
      </PersistDepsContext.Provider>
    </AppStoreContext.Provider>,
  );
  const live: FakeWorker = factory.workers[0];
  return {
    store, factory, live, copied,
    roundTrip: () => act(() => { live.process(); live.deliver(); }),
    advance: (dt) => act(() => { live.advance(dt); live.deliver(); }),
  };
}

/** let the probe worker that a component started answer (the newest fake worker) */
async function answerProbe(h: Harness, expectedWorkers: number): Promise<void> {
  await waitFor(() => expect(h.factory.workers.length).toBeGreaterThanOrEqual(expectedWorkers));
  const w = h.factory.workers[expectedWorkers - 1];
  act(() => { w.process(); w.deliver(); });
}

/** open the wizard's Scenario step and let the model be read */
async function openScenarioStep(h: Harness): Promise<void> {
  fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('Scenario'));
  await answerProbe(h, 2);
  await screen.findByText('Waveforms');
}

const lane = (key: string) => screen.getByTestId(`lane-${key}`);
const scenarioOf = (h: Harness) => h.store.getState().scenario;
const svgOf = (key: string) => lane(key).querySelector('svg') as SVGSVGElement;
const pointsOf = (key: string) => [...svgOf(key).querySelectorAll('circle.scn-pt')] as SVGCircleElement[];

/** the lane's SVG has a size in this test: 1 client pixel is 1 unit of its view box */
function sizeSvg(svg: SVGSVGElement) {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 640, bottom: 124, width: 640, height: 124, x: 0, y: 0, toJSON: () => ({}) });
}
const pointer = (el: Element, type: string, x: number, y: number) => act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });

/** add a lane for P_NBI_MW (the first control of the FRC) */
async function addNbiLane(h: Harness) {
  await openScenarioStep(h);
  fireEvent.click(screen.getByRole('button', { name: 'Add lane' }));
  expect(scenarioOf(h)!.waveforms!.P_NBI_MW).toEqual({ kind: 'pwl', points: [[0, null], [T, null]] });
}

describe('the wizard\'s Scenario step', () => {
  it('reads the controls of the configuration through a probe and offers a lane per control', async () => {
    const h = mount();
    await openScenarioStep(h);
    const probe = h.factory.workers[1];
    expect(probe.last('probe')).toMatchObject({ cfg: h.store.getState().cfg });
    expect(h.live.sent.filter((m) => m.type === 'init')).toHaveLength(0); // the live worker is not touched
    const select = screen.getByLabelText('Add a lane for') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['P_NBI_MW', 'kappa_conf']);
    expect(screen.getByText(/The scenario is valid for this configuration/)).toBeTruthy();
    expect(screen.getByText(/No waveforms yet/)).toBeTruthy();
    // the step is announced in the sidebar and the heading
    expect(screen.getByRole('heading', { name: /Scenario$/ })).toBeTruthy();
  });

  it('says why when the model cannot be read, and the text form still works structurally', async () => {
    const h = mount();
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('Scenario'));
    await waitFor(() => expect(h.factory.workers.length).toBe(2));
    act(() => h.factory.workers[1].crash('worker boom'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read: worker boom/);
    expect(screen.queryByText('Waveforms')).toBeNull();
    const text = screen.getByLabelText('Text form (JSON)') as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: JSON.stringify(dropTemplate('P_NBI_MW', 0.02, 0)) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text' }));
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.kind).toBe('step');
  });

  it('adds a lane, edits its points in the table, and the scenario in the app state follows', async () => {
    const h = mount();
    await addNbiLane(h);
    const time2 = screen.getByLabelText('Time [s] 2') as HTMLInputElement;
    fireEvent.change(time2, { target: { value: '0.03' } });
    fireEvent.blur(time2);
    const value2 = screen.getByLabelText('Value 2') as HTMLInputElement;
    fireEvent.change(value2, { target: { value: '4' } });
    fireEvent.blur(value2);
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points).toEqual([[0, null], [0.03, 4]]);
    // an unparsable text is put back, an empty value box means "the configured value"
    fireEvent.change(value2, { target: { value: 'abc' } });
    fireEvent.blur(value2);
    expect(value2.value).toBe('4');
    fireEvent.change(value2, { target: { value: '' } });
    fireEvent.blur(value2);
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1]).toEqual([0.03, null]);
    // times stay between the neighbours; the end of the run is the limit
    fireEvent.change(time2, { target: { value: '9' } });
    fireEvent.blur(time2);
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1][0]).toBe(T);
    // add point / remove point
    fireEvent.click(screen.getByRole('button', { name: 'Add point' }));
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove point 1' }));
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points).toHaveLength(2);
    // the shape
    fireEvent.change(within(lane('P_NBI_MW')).getByLabelText('Shape'), { target: { value: 'step' } });
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.kind).toBe('step');
    // removing the lane empties the scenario: the state goes back to none
    fireEvent.click(within(lane('P_NBI_MW')).getByRole('button', { name: 'Remove this lane' }));
    expect(scenarioOf(h)).toBeNull();
  });

  it('moves points with the keyboard, removes them with Delete, and adds one by a double click', async () => {
    const h = mount();
    await addNbiLane(h);
    const svg = svgOf('P_NBI_MW');
    sizeSvg(svg);
    // the point at t_end: Left nudges by a hundredth of the run, Shift ten times that
    const last = () => pointsOf('P_NBI_MW')[1];
    expect(last().getAttribute('aria-label')).toMatch(/^Point 2: t = /);
    fireEvent.keyDown(last(), { key: 'ArrowLeft' });
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1]).toEqual([T - T / 100, 13]);
    fireEvent.keyDown(last(), { key: 'ArrowLeft', shiftKey: true });
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1][0]).toBeCloseTo(T - T / 100 - T / 10, 12);
    // vertical: the value moves and the point stops being "configured"
    const before = scenarioOf(h)!.waveforms!.P_NBI_MW.points[1][1] as number;
    fireEvent.keyDown(last(), { key: 'ArrowUp' });
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1][1]).toBeGreaterThan(before);
    // double-click in the middle of the plot: a point between the two, at the clicked time
    const x = 48 + 0.5 * 580;
    fireEvent.doubleClick(svg, { clientX: x, clientY: 40 });
    const pts = scenarioOf(h)!.waveforms!.P_NBI_MW.points;
    expect(pts).toHaveLength(3);
    expect(pts[1][0]).toBeCloseTo(T / 2, 6);
    // Delete removes the focused point
    fireEvent.keyDown(pointsOf('P_NBI_MW')[1], { key: 'Delete' });
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points).toHaveLength(2);
    // an unrelated key does nothing
    const same = scenarioOf(h);
    fireEvent.keyDown(pointsOf('P_NBI_MW')[0], { key: 'a' });
    expect(scenarioOf(h)).toBe(same);
  });

  it('drags a point with the pointer; the scale stays put while it is held and the time stays between the neighbours', async () => {
    const h = mount();
    await addNbiLane(h);
    // three points: 0, T/2, T
    const svg = svgOf('P_NBI_MW');
    sizeSvg(svg);
    fireEvent.doubleClick(svg, { clientX: 48 + 0.5 * 580, clientY: 40 });
    const mid = () => pointsOf('P_NBI_MW')[1];
    const cx = Number(mid().getAttribute('cx')), cy = Number(mid().getAttribute('cy'));
    pointer(mid(), 'pointerdown', cx, cy);
    pointer(svg, 'pointermove', cx + 58, cy - 20); // a tenth of the run later, higher
    let p = scenarioOf(h)!.waveforms!.P_NBI_MW.points[1];
    expect(p[0]).toBeCloseTo(T / 2 + T / 10, 6);
    const v1 = p[1] as number;
    expect(v1).toBeGreaterThan(0);
    pointer(svg, 'pointermove', cx + 5000, cy); // far to the right: held at the next point
    p = scenarioOf(h)!.waveforms!.P_NBI_MW.points[1];
    expect(p[0]).toBe(T);
    pointer(svg, 'pointermove', cx, cy + 5000); // far below: the lower limit of a power
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW.points[1][1]).toBeGreaterThanOrEqual(0);
    pointer(svg, 'pointerup', cx, cy);
    // released: further moves change nothing
    const after = scenarioOf(h);
    pointer(svg, 'pointermove', cx + 10, cy);
    expect(scenarioOf(h)).toBe(after);
  });

  it('adds templates (drop, ramp, gas puff is refused where there is no density target), and a trigger with its controls', async () => {
    const h = mount();
    await openScenarioStep(h);
    const templates = screen.getByRole('tablist', { name: 'Templates' });
    // drop: the default is the NBI power to zero in the middle of the run
    fireEvent.click(screen.getByRole('button', { name: 'Add to the scenario' }));
    expect(scenarioOf(h)!.waveforms!.P_NBI_MW).toEqual({ kind: 'step', points: [[T / 2, 0]] });
    // ramp of the confinement factor
    fireEvent.click(within(templates).getByRole('tab', { name: 'Ramp' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Control' }), { target: { value: 'kappa_conf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to the scenario' }));
    expect(scenarioOf(h)!.waveforms!.kappa_conf.kind).toBe('pwl');
    // gas puff: the FRC has no density target: the scenario says so instead of running
    fireEvent.click(within(templates).getByRole('tab', { name: 'Gas puff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the scenario' }));
    expect(screen.getAllByText(/unknown control 'n_target_1e20'/).length).toBeGreaterThan(0);
    // interlock -> a trigger, editable
    fireEvent.click(within(templates).getByRole('tab', { name: 'Interlock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the scenario' }));
    const trig = await screen.findByTestId('trigger-0');
    fireEvent.change(within(trig).getByLabelText('Dwell time'), { target: { value: '0.002' } });
    fireEvent.blur(within(trig).getByLabelText('Dwell time'));
    fireEvent.change(within(trig).getByLabelText('Fires'), { target: { value: 'repeat' } });
    expect(scenarioOf(h)!.triggers![0]).toMatchObject({ mode: 'repeat', hold: 0.002 });
    fireEvent.click(within(trig).getAllByRole('button', { name: 'Add a control' })[0]);
    expect(Object.keys(scenarioOf(h)!.triggers![0].set)).toEqual(['P_NBI_MW', 'kappa_conf']);
    fireEvent.click(within(trig).getByRole('button', { name: 'Remove kappa_conf' }));
    expect(Object.keys(scenarioOf(h)!.triggers![0].set)).toEqual(['P_NBI_MW']);
    fireEvent.click(within(trig).getByRole('button', { name: 'Remove trigger' }));
    expect(scenarioOf(h)!.triggers).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    expect(scenarioOf(h)!.triggers).toHaveLength(1);
  });

  it('offers a ramp step no finer than t_end / 1e4, and says so when it is', async () => {
    const h = mount();
    await addNbiLane(h);
    const box = screen.getByLabelText('Ramp step') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '1e-9' } });
    fireEvent.blur(box);
    expect(scenarioOf(h)!.rampStep).toBe(1e-9);
    expect((await screen.findAllByText(/rampStep/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert').textContent).toMatch(/must be >= 0\.000005/);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    expect(scenarioOf(h)!.rampStep).toBe(T / 100 >= 5e-6 ? Number((T / 100).toPrecision(2)) : 5e-6);
    expect(screen.getByText(/The scenario is valid for this configuration/)).toBeTruthy();
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    expect(scenarioOf(h)!.rampStep).toBeUndefined();
  });

  it('the text form shows the canonical JSON, loads valid text, and lists the problems of invalid text without changing anything', async () => {
    const h = mount({ scenario: dropTemplate('P_NBI_MW', 0.02, 1) });
    await openScenarioStep(h);
    const text = screen.getByLabelText('Text form (JSON)') as HTMLTextAreaElement;
    expect(JSON.parse(text.value)).toEqual(dropTemplate('P_NBI_MW', 0.02, 1));
    const before = scenarioOf(h);
    fireEvent.change(text, { target: { value: '{"schema":1,"waveforms":{"bogus":{"kind":"step","points":[[0.01,1]]}},"extra":true}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text' }));
    const alert = screen.getAllByRole('alert').find((a) => /Not applied/.test(a.textContent ?? ''))!;
    expect(alert.textContent).toMatch(/waveforms\.bogus: unknown control 'bogus'/);
    expect(alert.textContent).toMatch(/extra: unknown property/);
    expect(scenarioOf(h)).toBe(before);
    fireEvent.change(text, { target: { value: '{not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text' }));
    expect(screen.getAllByRole('alert').some((a) => /not valid JSON/.test(a.textContent ?? ''))).toBe(true);
    fireEvent.change(text, { target: { value: JSON.stringify({ schema: 1, name: 'loaded', waveforms: { kappa_conf: { kind: 'step', points: [[0.01, 5]] } } }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text' }));
    expect(scenarioOf(h)).toEqual({ schema: 1, name: 'loaded', waveforms: { kappa_conf: { kind: 'step', points: [[0.01, 5]] } } });
    expect(screen.queryByText(/Not applied/)).toBeNull();
    // empty text clears the scenario; Clear does too
    fireEvent.change(text, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply text' }));
    expect(scenarioOf(h)).toBeNull();
  });

  it('loading a scenario file is a real button (reachable by keyboard); the file input is out of the way but not display:none', async () => {
    const h = mount();
    await openScenarioStep(h);
    const input = screen.getByTestId('scn-file') as HTMLInputElement;
    expect(input.hasAttribute('hidden')).toBe(false);
    expect(input.tabIndex).toBe(-1);
    const button = screen.getByRole('button', { name: 'Load file' }) as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    let clicked = 0;
    input.addEventListener('click', () => { clicked++; });
    fireEvent.click(button);
    expect(clicked).toBe(1);
    const text = JSON.stringify(dropTemplate('P_NBI_MW', T / 2, 2));
    const file = new File([text], 'drop.scenario.json', { type: 'application/json' });
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => text });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(scenarioOf(h)).toEqual(dropTemplate('P_NBI_MW', T / 2, 2)));
  });

  it('shows the problems of a scenario that does not fit the model, live', async () => {
    const h = mount({ scenario: { schema: 1, waveforms: { not_a_control: { kind: 'step', points: [[0.01, 1]] } }, triggers: [{ diag: 'nope', op: '>', value: 1, set: { P_NBI_MW: 0 } }] } });
    await openScenarioStep(h);
    const box = screen.getByText('Problems with this scenario').closest('[role="alert"]') as HTMLElement;
    expect(box.textContent).toMatch(/waveforms\.not_a_control/);
    expect(box.textContent).toMatch(/triggers\[0\]\.diag/);
    expect(within(screen.getByTestId('trigger-0')).getByText(/unknown diagnostic 'nope'/)).toBeTruthy();
  });

  it('is translated: the Turkish dictionary loads with the editor', async () => {
    const h = mount();
    await act(async () => { await h.store.actions.setLocale('tr'); await loadScenarioTr(); });
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('Senaryo'));
    await answerProbe(h, 2);
    expect(await screen.findByText('Dalga biçimleri')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Şerit ekle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Senaryoya ekle' })).toBeTruthy();
  });

  it('the last step summarises the scenario', async () => {
    const h = mount({ scenario: { ...dropTemplate('P_NBI_MW', 0.02, 1), name: 'trip' } });
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('RUN'));
    expect(await screen.findByText(/trip: 1 waveforms, 0 triggers/)).toBeTruthy();
    expect(h.store.getState().scenario!.name).toBe('trip');
  });
});

describe('a run with a scenario', () => {
  it('starts with the scenario of the wizard in the init message; the run view shows programmed and actual lanes', async () => {
    const h = mount({ scenario: dropTemplate('P_NBI_MW', T * 0.4, 0) });
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    expect(h.live.last('init')).toMatchObject({ autoPlay: true, scenario: dropTemplate('P_NBI_MW', T * 0.4, 0) });
    h.roundTrip();
    h.advance(T * 0.7);
    const panel = await screen.findByTestId('scenario-panel');
    const l = within(panel).getByTestId('run-lane-P_NBI_MW');
    expect(l.querySelector('[data-testid="prog-P_NBI_MW"]')).toBeTruthy();
    const actual = l.querySelector('[data-testid="actual-P_NBI_MW"]');
    expect(actual).toBeTruthy();
    expect(actual!.getAttribute('d')!.length).toBeGreaterThan(20);
    expect(within(panel).getByRole('button', { name: 'Record interventions as a scenario' }).hasAttribute('disabled')).toBe(true);
    expect(within(panel).getByText('No live interventions yet.')).toBeTruthy();
  });

  it('the programmed lane resolves a null point (and the configured line) against the configured value, not the t = 0 value the scenario applied', async () => {
    const configured = new Simulation({ ...TAE }).model.getControls().P_NBI_MW;
    const start = configured + 3;
    const scenario: ScenarioSpec = { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, start], [T * 0.5, null]] as [number, number | null][] } } };
    // the meta of this run has the scenario's t = 0 value: the trap
    expect(new Simulation({ ...TAE }, { scenario }).model.getControls().P_NBI_MW).toBe(start);
    const h = mount({ scenario });
    // the run of the wizard's configuration: the store keeps the very object the run used, which the probes of the panel are keyed by (a preset object is shared between tests)
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('RUN'));
    fireEvent.click(await screen.findByRole('button', { name: '▶ START SHOT' }));
    h.roundTrip();
    h.advance(T * 0.7);
    const panel = await screen.findByTestId('scenario-panel');
    await answerProbe(h, 2); // the configured values of the controls
    const l = within(panel).getByTestId('run-lane-P_NBI_MW');
    const baseTitle = () => l.querySelector('line.scn-base title')!.textContent!;
    await waitFor(() => expect(baseTitle()).toContain(String(Number(configured.toPrecision(4)))));
    expect(baseTitle()).not.toContain(String(Number(start.toPrecision(4))));
    // the programmed line ends where the dashed configured line is: no false discrepancy with what the run does
    const d = l.querySelector('[data-testid="prog-P_NBI_MW"]')!.getAttribute('d')!;
    const lastY = d.split(' ').pop()!.split(',')[1];
    expect(lastY).toBe(Number(l.querySelector('line.scn-base')!.getAttribute('y1')).toFixed(1));
    // and the first point is off that line (the scenario starts at another value)
    expect(d.split(' ')[0].split(',')[1]).not.toBe(lastY);
  });

  it('a run without a scenario or intervention has no scenario panel; the first intervention brings it', async () => {
    const h = mount();
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    h.roundTrip();
    h.advance(T * 0.2);
    expect(screen.queryByTestId('scenario-panel')).toBeNull();
    fireEvent.change(screen.getByRole('slider', { name: 'P_NBI' }), { target: { value: '4' } });
    expect(await screen.findByTestId('scenario-panel')).toBeTruthy();
    expect(screen.getByText('1 live interventions so far.')).toBeTruthy();
  });

  it('shows an invalid scenario as the run error, with the problems, and Setup goes back to the wizard', async () => {
    const h = mount({ scenario: { schema: 1, waveforms: { bogus: { kind: 'step', points: [[0.01, 1]] } } } });
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    h.roundTrip();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Simulation error');
    expect(alert.textContent).toContain('Invalid scenario (1 problem)');
    expect(alert.textContent).toContain("waveforms.bogus: unknown control 'bogus'");
    expect(document.querySelector('.status-pill')!.textContent).toMatch(/^ERROR/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Setup' }));
    expect(h.store.getState().tab).toBe('setup');
    expect(scenarioOf(h)!.waveforms!.bogus).toBeDefined(); // the scenario is kept for editing
  });

  it('completion: a live run with interventions is archived with the provenance the worker sent, so it can be signed', async () => {
    const h = mount();
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    h.roundTrip();
    h.advance(T * 0.3);
    fireEvent.change(screen.getByRole('slider', { name: 'P_NBI' }), { target: { value: '4' } });
    act(() => h.live.process());
    h.advance(T);
    const shot = h.store.getState().shots[0];
    expect(shot.prov!.interventions).toBe(1);
    expect(shot.prov!.actuatorLog).toEqual([expect.objectContaining({ patch: { P_NBI_MW: 4 } })]);
    expect(shot.prov!.fingerprint).toBe(Simulation.replay(TAE, shot.prov!.actuatorLog!).fingerprint(APP_VERSION));
  });

  it('record mode: the live interventions become a scenario for the next run, next to what the scenario already programs', async () => {
    const h = mount({ scenario: dropTemplate('P_NBI_MW', T * 0.9, 0) });
    // the run of the wizard's configuration: the store keeps the very object the run used, which the probes of the panel are keyed by (a preset object is shared between tests)
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('RUN'));
    fireEvent.click(await screen.findByRole('button', { name: '▶ START SHOT' }));
    h.roundTrip();
    h.advance(T * 0.3);
    fireEvent.change(screen.getByRole('slider', { name: 'P_NBI' }), { target: { value: '4' } });
    act(() => h.live.process());
    const panel = await screen.findByTestId('scenario-panel');
    const button = within(panel).getByRole('button', { name: 'Record interventions as a scenario' });
    fireEvent.click(button);
    expect(h.live.last('getLog')).toBeDefined();
    act(() => { h.live.process(); h.live.deliver(); });
    // the baseline (configured values) is read with a probe
    await answerProbe(h, 2);
    expect(await within(panel).findByText(/Recorded 1 interventions as waveforms/)).toBeTruthy();
    const rec = scenarioOf(h)!;
    // the operator took the control over from the waveform: the scripted drop at 90 % before it, the live value after
    expect(rec.waveforms!.P_NBI_MW.kind).toBe('step');
    const pts = rec.waveforms!.P_NBI_MW.points;
    expect(pts[pts.length - 1][1]).toBe(4);
    expect(pts[pts.length - 1][0]).toBeGreaterThanOrEqual(T * 0.3 - 1e-12);
    expect(pts.every((p) => p[0] < T * 0.9 - 1e-12)).toBe(true); // the drop at 90 % came after the takeover: it is not part of what happened
  });

  it('re-running the run on screen uses its own scenario, not the one of the wizard', async () => {
    const h = mount({ scenario: dropTemplate('P_NBI_MW', T * 0.4, 0) });
    fireEvent.click(screen.getAllByTitle('Run this preset directly')[PRESETS.findIndex((p) => p.id === 'TAE')]);
    h.roundTrip();
    h.advance(T);
    act(() => h.store.actions.setScenario(null)); // the wizard moved on
    fireEvent.click(await screen.findByRole('button', { name: 'Report ▶' }));
    fireEvent.click(await screen.findByRole('button', { name: /Run again/i }));
    expect(h.live.sent.filter((m) => m.type === 'init').at(-1)).toMatchObject({ scenario: dropTemplate('P_NBI_MW', T * 0.4, 0) });
  });
});

describe('sharing and loading with a scenario', () => {
  const codeOf = (link: string) => link.split('#/share/')[1];

  it('the link carries the scenario of the wizard, after the model has vouched for it', async () => {
    const scenario = dropTemplate('P_NBI_MW', T / 2, 3);
    const h = mount({ scenario });
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share this configuration' });
    expect(within(dialog).getByText(/also carries the scenario of this configuration \(1 waveforms, 0 triggers\)/)).toBeTruthy();
    await answerProbe(h, 2); // the probe of the model
    const link = (await within(dialog).findByLabelText('Link')) as HTMLInputElement;
    const back = await decodeShare(codeOf(link.value));
    expect(back.payload.scenario).toEqual(scenario);
    expect(back.payload.cfg).toEqual(h.store.getState().cfg);
    expect(back.payload.actuatorLog).toBeUndefined();
  });

  it('a scenario that does not fit the model is not shared: no link, the reason instead', async () => {
    const h = mount({ scenario: { schema: 1, waveforms: { bogus: { kind: 'step', points: [[0.01, 1]] } } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share this configuration' });
    await answerProbe(h, 2);
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toMatch(/The scenario is not valid for this configuration, so no link was made: waveforms\.bogus: unknown control 'bogus'/);
    expect(within(dialog).queryByLabelText('Link')).toBeNull();
  });

  it('after a run has finished the dialog offers the exact run: scenario, actuator log and fingerprint', async () => {
    const scenario = dropTemplate('P_NBI_MW', T * 0.8, 0);
    const h = mount({ scenario });
    // the run of the wizard's configuration (the store keeps the very object the run used)
    fireEvent.click(within(document.querySelector('.steps') as HTMLElement).getByText('RUN'));
    fireEvent.click(await screen.findByRole('button', { name: '▶ START SHOT' }));
    h.roundTrip();
    h.advance(T * 0.3);
    fireEvent.change(screen.getByRole('slider', { name: 'P_NBI' }), { target: { value: '4' } });
    act(() => h.live.process());
    h.advance(T);
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share this configuration' });
    const exact = await within(dialog).findByRole('checkbox', { name: 'Share the exact run that just finished' });
    fireEvent.click(exact);
    await answerProbe(h, 2);
    const link = (await within(dialog).findByLabelText('Link')) as HTMLInputElement;
    const { payload } = await decodeShare(codeOf(link.value));
    expect(payload.scenario).toEqual(scenario);
    expect(payload.actuatorLog).toEqual([expect.objectContaining({ patch: { P_NBI_MW: 4 } })]);
    expect(payload.appVersion).toBe(APP_VERSION);
    expect(payload.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('opening a link with a scenario puts it in the wizard; a link without one clears the old scenario', async () => {
    const scenario = { ...dropTemplate('P_NBI_MW', T / 2, 2), name: 'linked' };
    const code = await encodeShare({ cfg: { ...TAE }, name: 'Linked', appVersion: APP_VERSION, scenario });
    window.location.hash = `#/share/${code}`;
    const h = mount({ scenario: dropTemplate('P_NBI_MW', 0.01, 9) });
    await answerProbe(h, 2); // the model of the link's configuration vouches for its scenario
    expect(await screen.findByText(/Opened "Linked" from a shared link/)).toBeTruthy();
    expect(scenarioOf(h)).toEqual(scenario);
    // the notice offers to reproduce the exact run (a scenario is part of it)
    expect(screen.getByRole('button', { name: 'Reproduce the run' })).toBeTruthy();
    const plain = await encodeShare({ cfg: { ...TAE }, name: 'Plain', appVersion: APP_VERSION });
    act(() => { window.location.hash = `#/share/${plain}`; });
    expect(await screen.findByText(/Opened "Plain" from a shared link/)).toBeTruthy();
    expect(scenarioOf(h)).toBeNull();
  });

  it('a link whose scenario is invalid is refused up front, with the reason, and changes nothing', async () => {
    const bad = { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[0.01, -5]] } }, oops: 1 };
    const cfg = { ...TAE };
    // encodeShare validates as well, so the code is made without it
    const code = await encodeShare({ cfg, name: 'Bad', appVersion: APP_VERSION }).then(async () => {
      const { toBase64Url } = await import('../persist/base64url');
      const { crc32, SHARE_VERSION } = await import('../persist/codec');
      const json = new TextEncoder().encode(JSON.stringify({ cfg, name: 'Bad', appVersion: APP_VERSION, scenario: bad }));
      const out = new Uint8Array(6 + json.length);
      out[0] = SHARE_VERSION; out[1] = 0;
      new DataView(out.buffer).setUint32(2, crc32(json), false);
      out.set(json, 6);
      return toBase64Url(out);
    });
    window.location.hash = `#/share/${code}`;
    const h = mount({ scenario: dropTemplate('P_NBI_MW', 0.01, 9) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be opened/);
    expect(alert.textContent).toMatch(/scenario\./);
    expect(scenarioOf(h)).toEqual(dropTemplate('P_NBI_MW', 0.01, 9)); // untouched
    expect(h.store.getState().cfgName).not.toBe('Bad');
  });

  it('an embedded run with a scenario starts with it', async () => {
    const scenario = dropTemplate('P_NBI_MW', T / 2, 2);
    const code = await encodeShare({ cfg: { ...TAE }, name: 'embedded', appVersion: APP_VERSION, scenario });
    window.location.hash = `#/embed/run/${code}?autoplay=0`;
    const h = mount();
    await waitFor(() => expect(h.live.last('init')).toMatchObject({ autoPlay: false, scenario }));
  });

  it('an embedded run with a scenario shows the lanes but no Edit-in-Setup or Record controls (the embed has no Setup)', async () => {
    const scenario = dropTemplate('P_NBI_MW', T / 2, 2);
    const code = await encodeShare({ cfg: { ...TAE }, name: 'embedded', appVersion: APP_VERSION, scenario });
    window.location.hash = `#/embed/run/${code}?autoplay=1`;
    const h = mount();
    await waitFor(() => expect(h.live.last('init')).toMatchObject({ scenario }));
    h.roundTrip();
    h.advance(T * 0.3);
    const panel = await screen.findByTestId('scenario-panel');
    expect(within(panel).getByTestId('run-lane-P_NBI_MW')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Edit in Setup' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Record interventions as a scenario' })).toBeNull();
  });

  it('opening a link whose scenario names a control the configuration lacks is refused up front (checked against the model), and changes nothing', async () => {
    const bad = { schema: 1, waveforms: { bogus_control: { kind: 'step', points: [[0.01, 5]] } } } as never;
    const code = await encodeShare({ cfg: { ...TAE }, name: 'Bad', appVersion: APP_VERSION, scenario: bad });
    window.location.hash = `#/share/${code}`;
    const keep = dropTemplate('P_NBI_MW', 0.01, 9);
    const h = mount({ scenario: keep });
    await answerProbe(h, 2);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be opened/);
    expect(alert.textContent).toMatch(/does not fit the configuration/);
    expect(alert.textContent).toMatch(/unknown control 'bogus_control'/);
    expect(scenarioOf(h)).toEqual(keep);
    expect(h.store.getState().cfgName).not.toBe('Bad');
  });
});
