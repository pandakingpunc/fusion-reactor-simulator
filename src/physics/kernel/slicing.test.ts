/**
 * Step atomicity and slicing (header of simulation.ts, "Step atomicity and slicing"): a model with a resumable step
 * (SimModel.stepSlices) can be stopped inside a step by the `yieldWhen` of advance(). The suspended step is invisible, and
 * whatever the stops, the run that results is bitwise the run of runAll().
 *
 * A toy model with a three-stage step tests the contract in isolation (every rule of the header, fast); the 1.5D model
 * tests it where it matters: steps suspended inside the Grad-Shafranov update (ITER15, a short shot with frequent updates).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation, type SimulationOptions } from '../simulation';
import { ProfileModel } from '../profiles/model';
import type { DiagSpec, MagneticConfig, ReactorConfig, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import { runSlices, type Slices } from './slices';
import { advanceSliced, digestOf, expectSameRun, presetCfg, referenceRun, tick } from './testkit';

afterEach(() => { vi.restoreAllMocks(); });

describe('runSlices()', () => {
  it('runs a resumable computation to its end and returns its result', () => {
    const seen: number[] = [];
    function* f(): Slices<string> { seen.push(1); yield; seen.push(2); yield; seen.push(3); return 'end'; }
    expect(runSlices(f())).toBe('end');
    expect(seen).toEqual([1, 2, 3]);
  });

  it('a computation dropped at a yield does not run on (return() leaves its state where it is)', () => {
    let stage = 0;
    function* f(): Slices<number> { stage = 1; yield; stage = 2; yield; stage = 3; return 3; }
    const g = f();
    g.next();
    expect(g.return(0)).toEqual({ done: true, value: 0 });
    expect(stage).toBe(1);
    expect(g.next().done).toBe(true);
    expect(stage).toBe(1);
  });
});

/** y' = -k y advanced in steps of at most 0.03 (the kernel's sync grid, t_end / 100 = 0.01, is what limits them) with three stages that y is updated by; a step can be suspended after each of the first two. k is a control. */
class SlicedModel implements SimModel {
  readonly kind = 'pulsed' as const;
  readonly method = 'muon' as const;
  readonly timeUnit = 's' as const;
  readonly tEnd = 1;
  readonly outputDt = 0.1;
  readonly nState = 1;
  readonly diagSpecs: DiagSpec[] = [];
  readonly dt0 = 0.05;
  terminated: TerminationInfo | null = null;
  k = 1;
  /** stages executed so far (over the model's life, not rewound) */
  stages = 0;
  /** steps whose generator was closed before it ended (return()) */
  dropped = 0;
  /** the stage count at which the step throws, once (-1: never) */
  throwAt = -1;
  /** the stage count at which the model decides that the shot ends in this step (-1: never) */
  terminateAt = -1;
  initialState(): Float64Array { return Float64Array.of(1); }
  diagnostics(_t: number, y: Float64Array): Record<string, number> { return { y: y[0] }; }
  postStep(t: number, _dt: number, _y: Float64Array): SimEvent[] {
    if (this.terminated || t < this.tEnd - 1e-9) return [];
    this.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: '', fix: '' };
    return [{ t, kind: 'end', msg: 'end' }];
  }
  applyControl(p: Record<string, number>): void { if (p.k !== undefined) this.k = p.k; }
  getControls(): Record<string, number> { return { k: this.k }; }
  saveInternal(): Record<string, number> { return { k: this.k }; }
  restoreInternal(s: Record<string, number>): void { this.terminated = null; this.k = s.k; }
  report(): ShotReport { return {} as ShotReport; }
  geometryInfo(): Record<string, number> { return {}; }
  *stepSlices(t: number, y: Float64Array, tMax: number): Slices<number> {
    const h = Math.min(0.03, tMax - t);
    let complete = false;
    try {
      for (let i = 0; i < 3; i++) {
        y[0] *= Math.exp(-this.k * h / 3);
        this.stages++;
        if (this.stages === this.throwAt) { this.throwAt = -1; throw new Error('model bug'); }
        if (this.stages === this.terminateAt) this.terminated = { t: t + h, natural: false, reason: 'Toy failure', diagnosis: '', fix: '' };
        if (i < 2) yield;
      }
      complete = true;
    } finally {
      if (!complete) this.dropped++;
    }
    return t + h;
  }
  step(t: number, y: Float64Array, tMax: number): number { return runSlices(this.stepSlices(t, y, tMax)); }
}

const anyCfg = (): ReactorConfig => presetCfg('NIF'); // the toy model ignores it
const make = (o: SimulationOptions = {}) => new Simulation(anyCfg(), { modelFactory: () => new SlicedModel(), ...o });
const toy = (s: Simulation) => s.model as SlicedModel;
const reference = (o: SimulationOptions = {}) => { const s = make(o); s.runAll(); return s; };
const STOP = () => true;

describe('a step suspended by yieldWhen (toy model)', () => {
  it('stops at the first yield and shows nothing of the step in progress', () => {
    const sim = make();
    const r = sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    expect(sim.done).toBe(false);
    expect(sim.t).toBe(0);
    expect(sim.nSteps).toBe(0);
    expect(sim.history).toHaveLength(1);
    expect(sim.events).toHaveLength(0);
    expect(r).toEqual({ frames: [], events: [] });
    expect(toy(sim).stages).toBe(1);
    expect(sim.y[0]).toBeLessThan(1); // y belongs to the step now
  });

  it('the next call continues it (stages are neither repeated nor skipped) and ends it: three calls for a step of three stages', () => {
    const sim = make();
    sim.advance(0.5, { yieldWhen: STOP });
    sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    expect(toy(sim).stages).toBe(2);
    expect(sim.t).toBe(0);
    sim.advance(0.5, { yieldWhen: STOP }); // the third stage ends the step, and the call stops at the boundary
    expect(sim.stepInProgress).toBe(false);
    expect(toy(sim).stages).toBe(3);
    expect(sim.t).toBeCloseTo(0.01, 15);
    expect(sim.nSteps).toBe(1);
  });

  it('a yieldWhen that always says stop still makes progress: the run ends and equals runAll()', () => {
    const ref = reference();
    const sim = make();
    let calls = 0;
    while (!sim.done && calls < 1000) { sim.advance(0.5, { yieldWhen: STOP }); calls++; }
    expect(sim.done).toBe(true);
    expect(calls).toBe(3 * ref.nSteps);
    expectSameRun(sim, ref, 'always-stop');
  });

  it('40 seeded schedules of random chunks and random stops equal runAll() bitwise, also with breakpoints', () => {
    for (const opts of [{}, { breakpoints: [0.123, 0.5, 0.5001] }]) {
      const ref = reference(opts);
      for (let s = 1; s <= 20; s++) expectSameRun(advanceSliced(make(opts), s, [0.05, 0.3, 0.6, 0.95][s % 4]), ref, `schedule ${s}`);
    }
  });

  it('the step in progress is part of the next call whatever its target: the target is measured from the start of the step', () => {
    const sim = make();
    sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    sim.advance(0); // an idle tick continues it to its end
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(1);
    expect(sim.t).toBeCloseTo(0.01, 15);
    sim.advance(0.5, { yieldWhen: STOP });
    sim.advance(0.005); // target 0.015 from the start of the step: it ends at 0.02 and no further step is taken
    expect(sim.nSteps).toBe(2);
    expect(sim.t).toBeCloseTo(0.02, 15);
  });

  it('done is false while a step is in progress, even if the model has already decided that the shot ends in it', () => {
    const sim = make();
    toy(sim).terminateAt = 1;
    sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    expect(sim.model.terminated).not.toBeNull();
    expect(sim.done).toBe(false);
    sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.done).toBe(false);
    sim.advance(0.5, { yieldWhen: STOP }); // the last stage ends the step: the terminal frame is recorded
    expect(sim.stepInProgress).toBe(false);
    expect(sim.done).toBe(true);
    expect(sim.history).toHaveLength(2);
    expect(sim.history[1].t).toBeCloseTo(0.01, 15);
  });

  it('applyControl() settles the step first: the patch applies at the boundary after it, it is logged there, and the log replays the run', () => {
    const sim = make();
    sim.advance(0.2, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    sim.applyControl({ k: 3 });
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(1);
    expect(toy(sim).stages).toBe(3);
    expect(sim.actuatorLog).toEqual([{ t: sim.t, step: 1, patch: { k: 3 } }]);
    expect(toy(sim).k).toBe(3);
    // the step that was settled ran with the old k: y after it is that of a plain step
    const plain = make();
    plain.advance(0.001);
    expect(sim.y[0]).toBe(plain.y[0]);
    advanceSliced(sim, 5, 0.4);
    expectSameRun(Simulation.replay(anyCfg(), sim.actuatorLog, { modelFactory: () => new SlicedModel() }), sim, 'replay of the log');
    expect(digestOf(sim)).not.toBe(digestOf(reference())); // the patch changed the run
  });

  it('applyControl() at a step boundary is what it always was, whether the run got there in slices or not', () => {
    const a = make(), b = make();
    a.advance(0.05);
    while (b.t < 0.05 - 1e-12) b.advance(1, { yieldWhen: STOP });
    expect(b.stepInProgress).toBe(false);
    expect(b.t).toBe(a.t);
    a.applyControl({ k: 2 });
    b.applyControl({ k: 2 });
    expect(b.actuatorLog).toEqual(a.actuatorLog);
    a.runAll();
    advanceSliced(b, 4, 0.5);
    expectSameRun(b, a, 'patch at a boundary');
  });

  it('rewindTo() drops the step in progress: its generator is closed and the run goes on from the frame, bitwise', () => {
    const ref = reference();
    const sim = make();
    let guard = 0;
    while (sim.t < 0.35 && guard++ < 1e4) sim.advance(0.05);
    sim.advance(0.01, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    expect(toy(sim).dropped).toBe(0);
    const i = sim.history.length - 2;
    sim.rewindTo(i);
    expect(sim.stepInProgress).toBe(false);
    expect(toy(sim).dropped).toBe(1);
    expect(sim.done).toBe(false);
    expect(sim.t).toBe(sim.history[i].t);
    expect(sim.history).toHaveLength(i + 1);
    advanceSliced(sim, 9, 0.5);
    expectSameRun(sim, ref, 'rewound from a suspended step');
  });

  it('runAll() completes the step in progress', () => {
    const ref = reference();
    const sim = make();
    sim.advance(0.5, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(true);
    sim.runAll();
    expect(sim.stepInProgress).toBe(false);
    expectSameRun(sim, ref, 'runAll from a suspended step');
  });

  it('a step that throws leaves nothing in progress; the kernel is as it was at the boundary before it, and a rewind restores the model', () => {
    const ref = reference();
    const sim = make();
    toy(sim).throwAt = 5; // the second stage of the second step
    let calls = 0;
    expect(() => { while (calls++ < 100) sim.advance(1, { yieldWhen: STOP }); }).toThrow('model bug');
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(1);
    expect(sim.t).toBeCloseTo(0.01, 15);
    expect(sim.history).toHaveLength(1);
    sim.rewindTo(sim.history.length - 1);
    sim.runAll();
    expectSameRun(sim, ref, 'run after a failed step and a rewind');
  });

  it('a model without stepSlices is stepped whole: yieldWhen is asked between steps only, and every call takes at least one step', () => {
    class Whole extends SlicedModel {
      override step(t: number, y: Float64Array, tMax: number): number { return runSlices(super.stepSlices(t, y, tMax)); }
    }
    const sim = new Simulation(anyCfg(), { modelFactory: () => Object.assign(new Whole(), { stepSlices: undefined }) as unknown as SimModel });
    let asked = 0;
    sim.advance(0.09, { yieldWhen: () => { asked++; return false; } });
    expect(sim.nSteps).toBe(9);
    expect(asked).toBe(8); // after every step but the one that reached the target
    sim.advance(1, { yieldWhen: STOP });
    expect(sim.nSteps).toBe(10);
    expect(sim.stepInProgress).toBe(false);
  });

  it('a model with a Dormand–Prince stepper is stepped whole, even if it has stepSlices()', () => {
    class Rk extends SlicedModel {
      readonly integratorOpts = { rtol: 1e-9, atol: 1e-12, dtMin: 1e-9, dtMax: 0.05 };
      rhs(_t: number, y: Float64Array, d: Float64Array): void { d[0] = -this.k * y[0]; }
    }
    const model = new Rk();
    const sim = new Simulation(anyCfg(), { modelFactory: () => Object.assign(model, { step: undefined }) as unknown as SimModel });
    sim.advance(1, { yieldWhen: STOP });
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(1);
    expect(model.stages).toBe(0);
    sim.runAll();
    expect(sim.done).toBe(true);
  });
});

describe('1.5D: steps suspended inside the Grad–Shafranov update', () => {
  // A short ITER15 shot that updates the equilibrium every 0.12 s: 3 updates in 0.45 s, each of them 2 to 4 solves of the outer iteration.
  const base = presetCfg('ITER15', 0.45) as MagneticConfig;
  const cfg: MagneticConfig = { ...base, profiles: { ...base.profiles, eqUpdateInterval: 0.12 } };
  const oneStep = (sim: Simulation) => 1e-9 * sim.model.tEnd;

  /** counts the equilibrium updates, and how many are open (suspended) at the moment */
  function watchUpdates() {
    const real = ProfileModel.prototype.updateEquilibriumSlices;
    const w = { open: 0, updates: 0 };
    vi.spyOn(ProfileModel.prototype, 'updateEquilibriumSlices').mockImplementation(function* (this: ProfileModel, t: number, y: Float64Array): Slices<boolean> {
      w.open++; w.updates++;
      try { return yield* real.call(this, t, y); } finally { w.open--; }
    });
    return w;
  }

  /** Suspends a fresh run at every yield until it stands inside an update after t = 0.2 s. */
  function suspendedInUpdate(w: { open: number }): Simulation {
    const sim = new Simulation(cfg);
    let guard = 0;
    while (!(sim.stepInProgress && w.open > 0 && sim.t > 0.2) && !sim.done && guard++ < 1e5) sim.advance(oneStep(sim), { yieldWhen: STOP });
    expect(sim.stepInProgress, 'the run ended before it stood inside an update').toBe(true);
    return sim;
  }

  it('suspended at every yield of every step, the run equals runAll() bitwise, and a suspended step shows nothing of itself', async () => {
    const ref = referenceRun(cfg);
    expect(ref.history.length).toBeGreaterThan(50);
    await tick();
    const w = watchUpdates();
    const sim = new Simulation(cfg);
    const model = sim.model as ProfileModel;
    let boundary = { t: sim.t, frames: sim.history.length, steps: sim.nSteps, events: sim.events.length, dt: sim.dt };
    let calls = 0, suspended = 0, inside = 0;
    const tg0 = model.ctx.tg;
    while (!sim.done && calls++ < 1e5) {
      sim.advance(oneStep(sim), { yieldWhen: STOP });
      if (sim.stepInProgress) {
        suspended++;
        if (w.open > 0) inside++;
        expect(sim.t).toBe(boundary.t);
        expect(sim.history).toHaveLength(boundary.frames);
        expect(sim.nSteps).toBe(boundary.steps);
        expect(sim.events).toHaveLength(boundary.events);
        expect(sim.done).toBe(false);
        if (w.open > 0) expect(sim.dt, 'the step size shown is that of the boundary').toBe(boundary.dt);
      } else {
        boundary = { t: sim.t, frames: sim.history.length, steps: sim.nSteps, events: sim.events.length, dt: sim.dt };
      }
    }
    expect(sim.done).toBe(true);
    expect(w.updates).toBeGreaterThanOrEqual(3);
    expect(model.ctx.tg).not.toBe(tg0); // the updates were adopted
    expect(suspended).toBeGreaterThan(sim.nSteps); // a yield after the first attempt of every step, and more inside the updates
    expect(inside).toBeGreaterThan(8); // Picard iterations and trace slices of the solves of three updates
    expectSameRun(sim, ref, 'ITER15 suspended at every yield');
  }, 240000);

  it('random stops and chunk sizes (a stop at every second yield, and at every twentieth) equal runAll() bitwise', async () => {
    const ref = referenceRun(cfg);
    for (const [seed, pStop] of [[11, 0.5], [12, 0.05]] as const) {
      expectSameRun(advanceSliced(new Simulation(cfg), seed, pStop), ref, `ITER15 seed ${seed}, stop probability ${pStop}`);
      await tick();
    }
  }, 240000);

  it('a rewind inside an update drops it (the update is closed, nothing of it is adopted) and the run goes on from the frame bitwise', async () => {
    const ref = referenceRun(cfg);
    const w = watchUpdates();
    const sim = suspendedInUpdate(w);
    const model = sim.model as ProfileModel;
    const updates = model.eqUpdates, tg = model.ctx.tg;
    expect(w.open).toBe(1);
    expect(model.ctx.tg).toBe(tg);
    sim.rewindTo(Math.max(0, sim.history.length - 3));
    expect(sim.stepInProgress).toBe(false);
    expect(w.open).toBe(0); // the generator was closed (return())
    expect(model.eqUpdates).toBeLessThanOrEqual(updates);
    await tick();
    advanceSliced(sim, 21, 0.3);
    expectSameRun(sim, ref, 'ITER15 rewound from a suspended update');
  }, 240000);

  it('a control applied inside an update settles the step first and lands at the boundary after it: the log replays the run bitwise', async () => {
    const w = watchUpdates();
    const sim = suspendedInUpdate(w);
    const steps = sim.nSteps, t = sim.t;
    sim.applyControl({ P_NBI_MW: 20 });
    expect(sim.stepInProgress).toBe(false);
    expect(sim.nSteps).toBe(steps + 1);
    expect(sim.t).toBeGreaterThan(t);
    expect(sim.actuatorLog).toEqual([{ t: sim.t, step: steps + 1, patch: { P_NBI_MW: 20 } }]);
    await tick();
    advanceSliced(sim, 31, 0.4);
    expect(digestOf(sim)).not.toBe(referenceRun(cfg).digest); // the control changed the run
    await tick();
    expectSameRun(Simulation.replay(cfg, sim.actuatorLog), sim, 'ITER15 replay of a control applied inside an update');
  }, 240000);
});
