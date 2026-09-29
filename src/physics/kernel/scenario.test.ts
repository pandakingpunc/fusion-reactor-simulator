/**
 * The scenario engine inside a run (SimulationOptions.scenario): breakpoints and exact control values,
 * triggers on recorded frames, the actuator log, chunk invariance, exact rewind, replay, fingerprint.
 * First on a toy model (fast, exact), then on ITER 0D (an L-H transition and, after 'drop P_NBI', an
 * H-L transition) and on the 1.5D model. The engine alone is in ../scenario.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, type SimulationOptions } from '../simulation';
import { dropTemplate, interlockTemplate, mergeScenarios, parseScenario, rampTemplate, scenarioFromJSON, type ScenarioSpec } from '../scenario';
import type { DiagSpec, HistoryFrame, ReactorConfig, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import { canonicalString } from './canonical';
import { ScenarioError } from './errors';
import { runFingerprint, runDigest } from './fingerprint';
import {
  advanceRandomly, applyRandomControls, digestOf, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked, tick,
} from './testkit';

/**
 * y' = drive − gain·y on [0, 10], y(0) = 0. Both controls are live (the rhs reads them); every rhs() call is logged
 * with the controls it saw. Frames carry y and the controls in force.
 */
class ScenarioToy implements SimModel {
  readonly kind = 'pulsed' as const;
  readonly method = 'muon' as const;
  readonly timeUnit = 's' as const;
  readonly tEnd = 10;
  readonly outputDt = 0.5;
  readonly nState = 1;
  readonly diagSpecs: DiagSpec[] = [];
  readonly dt0 = 0.05;
  readonly integratorOpts = { rtol: 1e-9, atol: 1e-12, dtMin: 1e-9, dtMax: 0.2 };
  terminated: TerminationInfo | null = null;
  private ctrl: Record<string, number> = { drive: 1, gain: 2 };
  readonly calls: [number, number, number][] = [];
  initialState(): Float64Array { return Float64Array.of(0); }
  rhs(t: number, y: Float64Array, d: Float64Array): void { this.calls.push([t, this.ctrl.drive, this.ctrl.gain]); d[0] = this.ctrl.drive - this.ctrl.gain * y[0]; }
  diagnostics(_t: number, y: Float64Array): Record<string, number> { return { y: y[0], drive: this.ctrl.drive, gain: this.ctrl.gain }; }
  postStep(t: number, _dt: number, _y: Float64Array): SimEvent[] {
    if (this.terminated || t < this.tEnd - 1e-9) return [];
    this.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: '', fix: '' };
    return [{ t, kind: 'end', msg: 'end' }];
  }
  applyControl(patch: Record<string, number>): void { for (const k of Object.keys(patch)) if (k in this.ctrl) this.ctrl[k] = patch[k]; }
  getControls(): Record<string, number> { return { ...this.ctrl }; }
  saveInternal(): Record<string, number> { return {}; }
  restoreInternal(_s: Record<string, number>): void { this.terminated = null; }
  report(): ShotReport { return {} as ShotReport; }
  geometryInfo(): Record<string, number> { return {}; }
}

const TOY_CFG = presetCfg('NIF');
const toy = (scenario?: ScenarioSpec, more: SimulationOptions = {}): SimulationOptions => ({ modelFactory: () => new ScenarioToy(), scenario, ...more });
const toyModel = (sim: Simulation): ScenarioToy => sim.model as unknown as ScenarioToy;

/** The frames of a run without the scenario state of their checkpoints (what a run without a scenario records) */
function withoutScenarioState(history: readonly HistoryFrame[]): HistoryFrame[] {
  return history.map((f) => { if (!f.sim) return f; const { scenario: _s, ...sim } = f.sim; return { ...f, sim }; });
}

describe('breakpoints and exact control values (toy model)', () => {
  const RAMP: ScenarioSpec = {
    schema: 1,
    waveforms: {
      drive: { kind: 'pwl', points: [[1.23, 1], [3.77, 3], [5, 3]] },
      gain: { kind: 'step', points: [[6.001, 4], [8, 1.5]] },
    },
  };

  it('every corner is a step boundary, and the control that the step after it uses is exactly the corner value', () => {
    const sim = new Simulation(TOY_CFG, toy(RAMP));
    const ends: number[] = [], drive: number[] = [], gain: number[] = [];
    while (!sim.done) {
      sim.advance(2e-12); // one step
      ends.push(sim.t);
      drive.push(sim.model.getControls().drive); gain.push(sim.model.getControls().gain);
    }
    const corners: [string, number, number][] = [['drive', 1.23, 1], ['drive', 3.77, 3], ['drive', 5, 3], ['gain', 6.001, 4], ['gain', 8, 1.5]];
    for (const [key, c, v] of corners) {
      const k = ends.findIndex((t) => Math.abs(t - c) <= 1e-12);
      expect(k, `a step ends at ${c}`).toBeGreaterThanOrEqual(0);
      // no step straddles the corner
      for (let i = 1; i < ends.length; i++) expect(ends[i - 1] < c - 1e-12 && ends[i] > c + 1e-12, `step ${i} straddles ${c}`).toBe(false);
      // the step that starts there ran with the corner value (controls are applied at its start)
      expect((key === 'drive' ? drive : gain)[k + 1], `${key} at ${c}`).toBe(v);
    }
  });

  it('a pwl ramp is a staircase of the steps: the control of each step is the ramp value at its start', () => {
    const sim = new Simulation(TOY_CFG, toy(RAMP));
    let t = 0;
    while (!sim.done) {
      sim.advance(2e-12);
      const t1 = sim.t;
      const k = sim.model.getControls().drive;
      if (t > 1.23 + 1e-9 && t1 < 3.77 - 1e-9) expect(k).toBeCloseTo(1 + 2 * (t - 1.23) / (3.77 - 1.23), 12);
      t = t1;
    }
  });

  it('user breakpoints and scenario corners both end steps, and chunking still does not matter', () => {
    const opts = toy(RAMP, { breakpoints: [1.11, 2.5, 6.001] });
    const sim = new Simulation(TOY_CFG, opts);
    const ends: number[] = [];
    while (!sim.done) { sim.advance(2e-12); ends.push(sim.t); }
    for (const c of [1.11, 1.23, 2.5, 3.77, 5, 6.001, 8]) expect(ends.some((t) => Math.abs(t - c) <= 1e-12), `a step ends at ${c}`).toBe(true);
    expectSameRun(runChunked(TOY_CFG, 4, opts), sim, 'toy with breakpoints and a scenario, chunked');
    // both are part of the run's definition
    expect(sim.fingerprint('4.0.0')).not.toBe(new Simulation(TOY_CFG, toy(RAMP)).fingerprint('4.0.0'));
    expect(sim.fingerprint('4.0.0')).not.toBe(new Simulation(TOY_CFG, toy(undefined, { breakpoints: [1.11, 2.5, 6.001] })).fingerprint('4.0.0'));
  });

  it('the waveforms of t = 0 are in force from the first frame; a control that no waveform has started keeps its configured value', () => {
    const sim = new Simulation(TOY_CFG, toy({ schema: 1, waveforms: { drive: { kind: 'step', points: [[0, 5], [4, 0.5]] }, gain: { kind: 'step', points: [[2, 9]] } } }));
    expect(sim.model.getControls()).toEqual({ drive: 5, gain: 2 });
    expect(sim.history[0].d).toEqual({ y: 0, drive: 5, gain: 2 });
    expect(sim.history[0].sim!.controls).toEqual({ drive: 5, gain: 2 });
    sim.advance(1.9);
    expect(sim.model.getControls().gain).toBe(2);
    sim.advance(2);
    expect(sim.model.getControls().gain).toBe(9);
  });

  it('logs nothing in the actuator log, and a scenario that acts after t_end leaves the run as it was (frames without the scenario state)', () => {
    const sim = new Simulation(TOY_CFG, toy(RAMP));
    sim.runAll();
    expect(sim.actuatorLog).toEqual([]);
    const late = new Simulation(TOY_CFG, toy(dropTemplate('drive', 50)));
    late.runAll();
    const plain = new Simulation(TOY_CFG, toy());
    plain.runAll();
    expect(late.history.every((f) => f.sim?.scenario !== undefined)).toBe(true);
    expect(runDigest(withoutScenarioState(late.history), late.events)).toBe(runDigest(plain.history, plain.events));
    // a run without a scenario has no scenario state in its checkpoints
    expect(plain.history.every((f) => f.sim && !('scenario' in f.sim))).toBe(true);
  });

  it('an empty scenario is no scenario', () => {
    const a = new Simulation(TOY_CFG, toy({ schema: 1 }));
    a.runAll();
    const b = new Simulation(TOY_CFG, toy());
    b.runAll();
    expect(digestOf(a)).toBe(digestOf(b));
    expect(a.scenario).toBeNull();
    expect(a.fingerprint('4.0.0')).toBe(b.fingerprint('4.0.0'));
  });

  it('FSAL stage reuse and the scenario do not interfere: the same run with FSAL off, and the reuse resumes on flat segments', () => {
    const on = new Simulation(TOY_CFG, toy(RAMP));
    on.runAll();
    const off = new Simulation(TOY_CFG, toy(RAMP, { fsal: false }));
    off.runAll();
    expect(digestOf(on)).toBe(digestOf(off));
    // the steps that change no control (before t = 1.23, after t = 5 but for the corners) start from the last stage of the step before
    expect(toyModel(off).calls.length - toyModel(on).calls.length).toBeGreaterThan(20);
  });
});

describe('triggers act on recorded frames (toy model)', () => {
  // y rises towards drive/gain = 0.5: 0.316 at t = 0.5, 0.432 at t = 1.0, ...
  const SPEC: ScenarioSpec = { schema: 1, triggers: [{ id: 'y high', diag: 'y', op: '>', value: 0.4, set: { gain: 4 } }] };

  it('fires at the first step boundary after the first frame that satisfies the condition, once', () => {
    const sim = new Simulation(TOY_CFG, toy(SPEC));
    sim.runAll();
    const fired = sim.events.filter((e) => e.kind === 'info');
    expect(fired).toHaveLength(1);
    expect(fired[0].msg).toMatch(/^Scenario trigger 'y high': y = 0\.43\d+ > 0\.4 → gain = 4$/);
    const f = sim.history.find((x) => x.d.y > 0.4)!;
    expect(f.t).toBeCloseTo(1.0, 12);
    expect(Math.abs(fired[0].t - f.t)).toBeLessThanOrEqual(1e-12);
    // the frame that showed y > 0.4 has the old gain, the next frame the new one
    expect(f.d.gain).toBe(2);
    expect(sim.history[sim.history.indexOf(f) + 1].d.gain).toBe(4);
    expect(sim.actuatorLog).toEqual([]);
    expect(sim.history[sim.history.length - 1].sim!.scenario).toMatchObject({ armed: [0], fired: [1], manual: ['gain'] });
  });

  it('is independent of how time is chunked: 20 seeded random schedules equal runAll() bitwise', async () => {
    const opts = toy(mergeScenarios(SPEC, rampTemplate('drive', 2, 7, 3)));
    const ref = referenceRun(TOY_CFG, opts);
    for (let s = 1; s <= 20; s++) expectSameRun(runChunked(TOY_CFG, 500 + s, opts), ref, `toy schedule ${s}`);
    await tick();
  });

  it('a rewind restores what the triggers have done: before the firing it fires again at the same frame, after it never again', async () => {
    const opts = toy(mergeScenarios(SPEC, rampTemplate('drive', 2, 7, 3)));
    const ref = referenceRun(TOY_CFG, opts);
    const iFire = ref.history.findIndex((f) => f.d.y > 0.4);
    for (const i of [iFire - 1, iFire, iFire + 1, Math.floor(ref.history.length / 2), ref.history.length - 2]) {
      const sim = advanceRandomly(new Simulation(TOY_CFG, opts), 70 + i);
      sim.rewindTo(i);
      expect(sim.history.length).toBe(i + 1);
      expect(sim.events.filter((e) => e.kind === 'info').length, `events after a rewind to frame ${i}`).toBe(i > iFire ? 1 : 0);
      advanceRandomly(sim, 170 + i);
      expectSameRun(sim, ref, `toy rewound to frame ${i}`);
    }
    // the rewind restored the scenario state of the frame itself
    const sim = advanceRandomly(new Simulation(TOY_CFG, opts), 5);
    sim.rewindTo(iFire);
    expect(sim.history[iFire].sim!.scenario).toMatchObject({ armed: [1], fired: [0], manual: [] });
    await tick();
  });

  it('a repeating trigger with hysteresis runs through the whole run (bang-bang), deterministically', async () => {
    const spec: ScenarioSpec = { schema: 1, triggers: [{ id: 'level', diag: 'y', op: '>', value: 0.4, mode: 'repeat', hysteresis: 0.1, set: { drive: 0.2 }, release: { drive: 1 } }] };
    const opts = toy(spec);
    const sim = new Simulation(TOY_CFG, opts);
    sim.runAll();
    const notes = sim.events.filter((e) => e.kind === 'info');
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.map((e) => (e.msg.includes('re-armed') ? 'release' : 'set')).slice(0, 4)).toEqual(['set', 'release', 'set', 'release']);
    // y stays inside the band [0.3, 0.4] + one output interval of overshoot
    for (const f of sim.history.slice(4)) { expect(f.d.y).toBeGreaterThan(0.15); expect(f.d.y).toBeLessThan(0.5); }
    expectSameRun(runChunked(TOY_CFG, 9, opts), sim, 'bang-bang chunked');
    await tick();
  });
});

describe('the actuator log and the scenario (toy model)', () => {
  const RAMP: ScenarioSpec = { schema: 1, waveforms: { drive: { kind: 'pwl', points: [[0, 1], [10, 3]] } } };
  const OPTS = toy(RAMP);

  it('a live applyControl() takes its keys over from the waveforms for the rest of the branch, and is the only thing in the log', () => {
    const sim = new Simulation(TOY_CFG, OPTS);
    sim.advance(3);
    sim.applyControl({ drive: 5 });
    sim.advance(1);
    const i = sim.history.length - 1;
    sim.runAll();
    expect(sim.actuatorLog).toEqual([{ t: expect.any(Number), step: expect.any(Number), patch: { drive: 5 } }]);
    for (const f of sim.history.filter((x) => x.t > sim.actuatorLog[0].t + 1e-9)) expect(f.d.drive, `frame at t = ${f.t}`).toBe(5);
    // before the intervention the waveform drove it
    expect(sim.history.filter((x) => x.t > 0.1 && x.t < 2.9).every((x) => x.d.drive > 1 && x.d.drive < 3)).toBe(true);
    expect(sim.history[i].sim!.scenario!.manual).toEqual(['drive']);
    // a key that the scenario does not drive is not taken over
    const other = new Simulation(TOY_CFG, OPTS);
    other.applyControl({ gain: 3 });
    expect(other.history[0].sim!.scenario!.manual).toEqual([]);
    other.advance(0.6);
    expect(other.history[other.history.length - 1].sim!.scenario!.manual).toEqual([]);
  });

  it('rewinding before the intervention gives the key back to the waveform', () => {
    const sim = new Simulation(TOY_CFG, OPTS);
    sim.advance(3);
    const i = sim.history.length - 1;
    sim.applyControl({ drive: 5 });
    sim.advance(3);
    expect(sim.history[sim.history.length - 1].d.drive).toBe(5);
    sim.rewindTo(i);
    expect(sim.actuatorLog).toEqual([]);
    expect(sim.history[i].sim!.scenario!.manual).toEqual([]);
    sim.advance(3);
    const last = sim.history[sim.history.length - 1];
    expect(last.d.drive).toBeGreaterThan(1 + (2 * last.t) / 10 - 0.3);
    expect(last.d.drive).toBeLessThan(1 + (2 * last.t) / 10 + 0.3);
  });

  it('replays bitwise from (configuration, scenario, log); without the scenario, or without the log, it is another run', () => {
    const sim = new Simulation(TOY_CFG, OPTS);
    sim.advance(3);
    sim.applyControl({ drive: 5 });
    sim.advance(2);
    sim.applyControl({ gain: 1, drive: 0.5 });
    sim.runAll();
    const log = sim.actuatorLog;
    expect(log).toHaveLength(2);
    expectSameRun(Simulation.replay(TOY_CFG, log, OPTS), sim, 'replay with the scenario');
    expect(digestOf(Simulation.replay(TOY_CFG, log, toy()))).not.toBe(digestOf(sim));
    expect(digestOf(Simulation.replay(TOY_CFG, [], OPTS))).not.toBe(digestOf(sim));
    // and the fingerprints tell the three apart
    const fp = (o: SimulationOptions, l = log) => Simulation.replay(TOY_CFG, l, o).fingerprint('4.0.0');
    expect(fp(OPTS)).toBe(sim.fingerprint('4.0.0'));
    expect(new Set([fp(OPTS), fp(toy()), fp(OPTS, [])]).size).toBe(3);
  });

  it('a random storm of interventions on driven and undriven keys replays bitwise', async () => {
    const opts = toy(mergeScenarios(RAMP, dropTemplate('gain', 4, 3), interlockTemplate('y', '>', 0.45, { gain: 6 })));
    const sim = applyRandomControls(new Simulation(TOY_CFG, opts), 21, 0.3);
    expect(sim.actuatorLog.length).toBeGreaterThan(4);
    expectSameRun(Simulation.replay(TOY_CFG, sim.actuatorLog, opts), sim, 'toy replay');
    await tick();
  });
});

describe('the run fingerprint covers the scenario', () => {
  const cfg = presetCfg('JET');
  const seed = (cfg as { seed: number }).seed;
  const spec = mergeScenarios(dropTemplate('P_NBI_MW', 3), interlockTemplate('Q', '>', 1, { P_ICRH_MW: 0 }));

  it('a scenario changes it, its free label does not, an empty one is none, and the order of keys does not matter', () => {
    const plain = new Simulation(cfg).fingerprint('4.0.0');
    const withSc = new Simulation(cfg, { scenario: spec });
    expect(withSc.fingerprint('4.0.0')).not.toBe(plain);
    expect(new Simulation(cfg, { scenario: { ...spec, name: 'another label' } }).fingerprint('4.0.0')).toBe(withSc.fingerprint('4.0.0'));
    expect(new Simulation(cfg, { scenario: dropTemplate('P_NBI_MW', 3.5) }).fingerprint('4.0.0')).not.toBe(new Simulation(cfg, { scenario: dropTemplate('P_NBI_MW', 3) }).fingerprint('4.0.0'));
    expect(new Simulation(cfg, { scenario: { schema: 1, name: 'nothing' } }).fingerprint('4.0.0')).toBe(plain);
    const reordered = JSON.parse(canonicalString(spec), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(new Simulation(cfg, { scenario: reordered }).fingerprint('4.0.0')).toBe(withSc.fingerprint('4.0.0'));
    // = runFingerprint() of the normalised scenario without its label
    const { name: _n, ...form } = withSc.scenario!;
    expect(withSc.fingerprint('4.0.0')).toBe(runFingerprint(cfg, seed, [], '4.0.0', [], form as ScenarioSpec));
    // a run without a scenario keeps the fingerprint it always had
    expect(plain).toBe(runFingerprint(cfg, seed, [], '4.0.0'));
  });

  it('the scenario of a run is a normalised copy', () => {
    const s = new Simulation(cfg, { scenario: spec });
    const copy = s.scenario!;
    copy.waveforms!.P_NBI_MW.points.push([9, 1]);
    expect(s.scenario!.waveforms!.P_NBI_MW.points).toEqual([[3, 0]]);
  });
});

describe('errors', () => {
  it('a scenario that names a control the model does not expose (I_p before WS6c) or a diagnostic the frames do not carry is refused', () => {
    const ip = rampTemplate('Ip_MA', 100, 130, 0);
    expect(() => new Simulation(presetCfg('ITER'), { scenario: ip })).toThrow(ScenarioError);
    expect(() => new Simulation(presetCfg('ITER'), { scenario: ip })).toThrow(/unknown control 'Ip_MA' \(this model exposes: H98, P_ECRH_MW, P_ICRH_MW, P_NBI_MW, cZ, fuelRate_1e20s, n_target_1e20\)/);
    expect(() => new Simulation(presetCfg('ITER'), { scenario: interlockTemplate('no_such_diag', '>', 1, { P_NBI_MW: 0 }) })).toThrow(/unknown diagnostic 'no_such_diag'/);
    expect(() => new Simulation(presetCfg('ITER'), { scenario: { schema: 2 } as unknown as ScenarioSpec })).toThrow(ScenarioError);
    // a model without controls (pulsed ICF)
    expect(() => new Simulation(presetCfg('NIF'), { scenario: dropTemplate('P_NBI_MW', 1) })).toThrow(/unknown control 'P_NBI_MW' \(this model exposes: none\)/);
    // every frame key is a valid diagnostic; the model's controls are all valid keys
    const sim = new Simulation(presetCfg('ITER'), { scenario: interlockTemplate('betaN_th', '>', 100, { P_ECRH_MW: 1 }) });
    expect(sim.scenario!.triggers).toHaveLength(1);
  });

  it('a rampStep finer than t_end / 1e4 (or than 1e-6) is refused at construction and does not hang the run; the finest grid allowed completes', () => {
    const ITER400 = presetCfg('ITER', 400);
    const ramp = (rampStep: number): ScenarioSpec => ({ ...rampTemplate('P_NBI_MW', 10, 50, 0), rampStep });
    // ITER: t_end 400 s, so the finest grid is 40 ms; 1e-9 used to make a run of 4e11 steps, 1e-20 an endless loop in the first step
    for (const rampStep of [1e-20, 1e-9, 0.01, 0.0399]) {
      expect(() => new Simulation(ITER400, { scenario: ramp(rampStep) }), `rampStep ${rampStep}`).toThrow(ScenarioError);
    }
    expect(() => new Simulation(ITER400, { scenario: ramp(1e-9) })).toThrow(/rampStep: must be >= 0\.04 = t_end \/ 10000/);
    expect(() => new Simulation(ITER400, { scenario: ramp(0.04) })).not.toThrow();
    // a share link with the same content is refused where it is parsed
    expect(() => scenarioFromJSON('{"schema":1,"rampStep":1e-20,"waveforms":{"P_NBI_MW":{"kind":"pwl","points":[[10,null],[50,0]]}}}')).toThrow(ScenarioError);
    // the toy model (t_end 10): the finest grid is 1e-3, and a ramp over the whole run then takes about 1e4 steps
    expect(() => new Simulation(TOY_CFG, toy({ ...rampTemplate('drive', 0, 10, 3), rampStep: 0.9e-3 }))).toThrow(/rampStep: must be >= 0\.001 = t_end/);
    const sim = new Simulation(TOY_CFG, toy({ ...rampTemplate('drive', 0, 10, 3), rampStep: 1e-3 }));
    sim.runAll();
    expect(sim.done).toBe(true);
    expect(sim.nSteps).toBeGreaterThan(9990);
    expect(sim.nSteps).toBeLessThan(10100);
  });
});

describe('ITER 0D: drop P_NBI', () => {
  const T_DROP = 30;
  const cfg = presetCfg('ITER', 60);
  const opts: SimulationOptions = { scenario: dropTemplate('P_NBI_MW', T_DROP) };

  it('the plasma leaves H-mode only after the drop; up to the drop the run is the baseline, bitwise', () => {
    const base = referenceRun(cfg);
    expect(base.events.some((e) => e.kind === 'HL')).toBe(false);
    const sim = new Simulation(cfg, opts);
    sim.runAll();
    const hl = sim.events.filter((e) => e.kind === 'HL');
    expect(hl).toHaveLength(1);
    expect(hl[0].t).toBeGreaterThan(T_DROP);
    expect(sim.events.filter((e) => e.kind === 'LH')).toHaveLength(1);
    expect(sim.events.find((e) => e.kind === 'LH')!.t).toBeLessThan(T_DROP);
    // frames and events before the drop are those of the baseline
    const before = (h: readonly HistoryFrame[]) => h.filter((f) => f.t < T_DROP - 1e-9).map((f) => ({ t: f.t, y: f.y, d: f.d, internal: f.internal }));
    expect(canonicalString(before(sim.history))).toBe(canonicalString(before(base.history)));
    expect(canonicalString(sim.events.filter((e) => e.t < T_DROP - 1e-9))).toBe(canonicalString(base.events.filter((e) => e.t < T_DROP - 1e-9)));
    // the control is dropped exactly at T_DROP, nothing else changes; H_mode follows the events
    expect(sim.history.filter((f) => f.t < T_DROP - 1e-9).every((f) => f.sim!.controls.P_NBI_MW === 33)).toBe(true);
    expect(sim.history.filter((f) => f.t > T_DROP + 1e-9).every((f) => f.sim!.controls.P_NBI_MW === 0)).toBe(true);
    const tLH = sim.events.find((e) => e.kind === 'LH')!.t;
    for (const f of sim.history) expect(f.d.H_mode, `frame at t = ${f.t}`).toBe(f.t >= tLH - 1e-12 && f.t < hl[0].t - 1e-12 ? 1 : 0);
    expect(sim.actuatorLog).toEqual([]);
  });

  it('20 seeded random chunk schedules equal runAll() bitwise (waveform corner, a ramp and a trigger together)', async () => {
    const spec = mergeScenarios(dropTemplate('P_NBI_MW', 20), rampTemplate('P_ICRH_MW', 12, 18, 5), interlockTemplate('Q', '>', 1, { n_target_1e20: 0.9 }, { id: 'Q limit' }));
    const o: SimulationOptions = { scenario: spec };
    const c = presetCfg('ITER', 30);
    const ref = referenceRun(c, o);
    expect(ref.events.some((e) => e.kind === 'info')).toBe(true); // the trigger fires
    for (let s = 1; s <= 20; s++) {
      expectSameRun(runChunked(c, 6000 + s, o), ref, `ITER scenario schedule ${s}`);
      await tick();
    }
  }, 120000);

  it('rewinds exactly at 25/50/75 % (before the corner, at the ramp, after the trigger)', async () => {
    const spec = mergeScenarios(dropTemplate('P_NBI_MW', 20), rampTemplate('P_ICRH_MW', 12, 18, 5), interlockTemplate('Q', '>', 1, { n_target_1e20: 0.9 }));
    const o: SimulationOptions = { scenario: spec };
    const c = presetCfg('ITER', 30);
    const ref = normalizeRng(referenceRun(c, o));
    for (const p of [0.25, 0.5, 0.75]) {
      const sim = rewindAt(c, p, 8100 + p * 100, o);
      await tick();
      advanceRandomly(sim, 8200 + p * 100);
      expectSameRun(normalizeRng(sim), ref, `ITER scenario rewound at ${p * 100} %`);
      await tick();
    }
  }, 120000);

  it('a random storm of live interventions on top of the scenario replays bitwise from the actuator log', async () => {
    const o: SimulationOptions = { scenario: mergeScenarios(dropTemplate('P_NBI_MW', 20), rampTemplate('P_ICRH_MW', 12, 18, 5)) };
    const c = presetCfg('ITER', 30);
    const sim = applyRandomControls(new Simulation(c, o), 33, 0.25);
    expect(sim.actuatorLog.length).toBeGreaterThan(3);
    await tick();
    expect(digestOf(sim)).not.toBe(referenceRun(c, o).digest);
    expectSameRun(Simulation.replay(c, sim.actuatorLog, o), sim, 'ITER scenario + storm replay');
    expect(Simulation.replay(c, sim.actuatorLog, o).fingerprint('4.0.0')).toBe(sim.fingerprint('4.0.0'));
  }, 120000);
});

describe('1.5D: JET15 with a scenario', () => {
  // L-H at 0.22 s; the NBI ramp (off the output grid, with a grid of 5 ms on the ramp) starts before it, the trigger fires after it
  const spec = parseScenario({ ...mergeScenarios(rampTemplate('P_NBI_MW', 0.1537, 0.4413, 12), interlockTemplate('H_mode', '>=', 1, { P_ICRH_MW: 8 }, { id: 'in H-mode' })), rampStep: 0.005 });
  const o: SimulationOptions = { scenario: spec };
  const cfg = presetCfg('JET15', 0.6) as ReactorConfig;

  it('chunk invariance (6 schedules) and exact rewind hold with the 1.5D stepper', async () => {
    const ref = referenceRun(cfg, o);
    const fired = ref.events.filter((e) => e.kind === 'info');
    expect(fired).toHaveLength(1);
    const lh = ref.events.find((e) => e.kind === 'LH')!;
    expect(fired[0].t).toBeGreaterThan(lh.t);
    for (let s = 1; s <= 6; s++) {
      expectSameRun(runChunked(cfg, 9000 + s, o), ref, `JET15 scenario schedule ${s}`);
      await tick();
    }
    const nref = normalizeRng(ref);
    for (const p of [0.3, 0.7]) {
      const sim = rewindAt(cfg, p, 9100 + p * 100, o);
      await tick();
      advanceRandomly(sim, 9200 + p * 100);
      expectSameRun(normalizeRng(sim), nref, `JET15 scenario rewound at ${p * 100} %`);
    }
  }, 180000);

  it('the corners are step boundaries, the ramp is followed on a 5 ms grid, and ICRH steps up after the L-H transition', () => {
    const sim = new Simulation(cfg, o);
    const ends: number[] = [];
    while (!sim.done) { sim.advance(2e-12); ends.push(sim.t); }
    for (const c of [0.1537, 0.4413]) expect(ends.some((t) => Math.abs(t - c) <= 1e-12), `a step ends at ${c}`).toBe(true);
    // on the ramp no step is longer than the grid (5 ms) plus a rounding error
    const ramp = ends.map((t, i) => [i ? ends[i - 1] : 0, t]).filter(([a, b]) => a >= 0.1537 - 1e-12 && b <= 0.4413 + 1e-12);
    expect(ramp.length).toBeGreaterThan(50);
    for (const [a, b] of ramp) expect(b - a).toBeLessThanOrEqual(0.005 + 1e-9);
    const at = (t: number) => sim.history.reduce((a, f) => (Math.abs(f.t - t) < Math.abs(a.t - t) ? f : a));
    expect(at(0.1).sim!.controls.P_NBI_MW).toBe(29);
    for (const t of [0.2, 0.3, 0.4]) {
      const f = at(t);
      // the staircase of the grid lags the ideal ramp by less than one grid step (17 MW over 0.2876 s: 0.3 MW)
      expect(Math.abs(f.sim!.controls.P_NBI_MW - (29 + (12 - 29) * (f.t - 0.1537) / (0.4413 - 0.1537)))).toBeLessThan(0.35);
    }
    expect(at(0.55).sim!.controls.P_NBI_MW).toBe(12);
    expect(at(0.1).sim!.controls.P_ICRH_MW).toBe(4);
    expect(at(0.55).sim!.controls.P_ICRH_MW).toBe(8);
    expect(sim.actuatorLog).toEqual([]);
  }, 180000);
});
