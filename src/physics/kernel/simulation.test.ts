/**
 * The contract between Simulation and its models: which members a model must provide (rhs() and
 * integratorOpts, or its own step()), when the kernel may reuse the last Dormand–Prince stage (FSAL),
 * and how a shot ended by a failed step is recorded.
 */
import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '../simulation';
import { JET_15D } from '../presets';
import { ProfileModel } from '../profiles/model';
import type { DiagSpec, ReactorConfig, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import { ModelContractError } from './errors';
import { runDigest } from './fingerprint';
import { advanceRandomly, applyRandomControls, expectSameRun, presetCfg, rewindAt, tick } from './testkit';

// Counts the Dormand–Prince steppers that Simulation builds.
const built = vi.hoisted(() => ({ n: 0 }));
vi.mock('../integrator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../integrator')>();
  class CountingDormandPrince extends mod.DormandPrince {
    constructor(...args: ConstructorParameters<typeof mod.DormandPrince>) {
      super(...args);
      built.n++;
    }
  }
  return { ...mod, DormandPrince: CountingDormandPrince };
});

/** A minimal model: y' = −k y on [0, 1]; subclasses say how it advances. */
abstract class ToyModel implements SimModel {
  readonly kind = 'pulsed' as const;
  readonly method = 'muon' as const;
  readonly timeUnit = 's' as const;
  readonly tEnd = 1;
  readonly outputDt = 0.1;
  readonly nState = 1;
  readonly diagSpecs: DiagSpec[] = [];
  readonly dt0 = 0.05;
  terminated: TerminationInfo | null = null;
  initialState(): Float64Array { return Float64Array.of(1); }
  diagnostics(_t: number, y: Float64Array): Record<string, number> { return { y: y[0] }; }
  postStep(t: number, _dt: number, _y: Float64Array): SimEvent[] {
    if (this.terminated || t < this.tEnd - 1e-9) return [];
    this.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: '', fix: '' };
    return [{ t, kind: 'end', msg: 'end' }];
  }
  applyControl(): void { /* no controls */ }
  getControls(): Record<string, number> { return {}; }
  saveInternal(): Record<string, number> { return {}; }
  restoreInternal(_s: Record<string, number>): void { this.terminated = null; }
  report(): ShotReport { return {} as ShotReport; } // runAll() asks for it; the tests never look at it
  geometryInfo(): Record<string, number> { return {}; }
}

/** Advances with its own stepper: neither rhs() nor integratorOpts. */
class StepOnlyModel extends ToyModel {
  step(t: number, y: Float64Array, tMax: number): number {
    const h = Math.min(0.03, tMax - t);
    y[0] *= Math.exp(-h);
    return t + h;
  }
}

/**
 * Dormand–Prince model whose rate constant k is switched by postStep() (at step ends, without an
 * event and without changing y) — the case FSAL must notice. `reportK` says whether saveInternal()
 * tells the kernel about k, as the SimModel contract requires.
 */
class SwitchingModel extends ToyModel {
  readonly integratorOpts = { rtol: 1e-9, atol: 1e-12, dtMin: 1e-9, dtMax: 0.05 };
  k = 1;
  constructor(private readonly reportK: boolean) { super(); }
  rhs(_t: number, y: Float64Array, d: Float64Array): void { d[0] = -this.k * y[0]; }
  override postStep(t: number, dt: number, y: Float64Array): SimEvent[] {
    this.k = 1 + 2 * (Math.floor(t / 0.13) % 2);
    return super.postStep(t, dt, y);
  }
  override saveInternal(): Record<string, number> { return this.reportK ? { k: this.k } : {}; }
  override restoreInternal(s: Record<string, number>): void { super.restoreInternal(s); if (this.reportK) this.k = s.k; }
}

const anyCfg = (): ReactorConfig => presetCfg('NIF');
const digest = (sim: Simulation): string => runDigest(sim.history, sim.events);

/** Counts the right-hand side evaluations of a simulation that has not run yet. */
function countRhs(sim: Simulation): () => number {
  const model = sim.model;
  const rhs = model.rhs!.bind(model);
  let n = 0;
  model.rhs = (t, y, d) => { n++; rhs(t, y, d); };
  return () => n;
}

describe('SimModel without rhs() and integratorOpts (own step())', () => {
  it('runs, without a Dormand–Prince stepper', () => {
    built.n = 0;
    const sim = new Simulation(anyCfg(), { modelFactory: () => new StepOnlyModel() });
    expect(built.n).toBe(0);
    sim.runAll();
    expect(sim.done).toBe(true);
    expect(sim.model.terminated?.natural).toBe(true);
    expect(sim.t).toBeCloseTo(1, 12);
    expect(sim.y[0]).toBeCloseTo(Math.exp(-1), 12);
    expect(built.n).toBe(0);
  });

  it('counts its steps itself, reports the model step size (dt0) and stores no integrator state in the frames', () => {
    const sim = new Simulation(anyCfg(), { modelFactory: () => new StepOnlyModel() });
    sim.runAll();
    const last = sim.history[sim.history.length - 1].sim!;
    expect(sim.nSteps).toBe(last.steps);
    expect(sim.nSteps).toBeGreaterThan(30);
    expect(sim.dt).toBe(0.05);
    for (const f of sim.history) {
      expect(f.sim).toBeDefined();
      expect('integ' in f.sim!).toBe(false);
    }
  });

  it('rewinds and continues bitwise, and replays a fresh run', () => {
    const make = () => new Simulation(anyCfg(), { modelFactory: () => new StepOnlyModel() });
    const ref = make();
    ref.runAll();
    const sim = make();
    sim.advance(0.5);
    const i = Math.floor(sim.history.length / 2);
    sim.rewindTo(i);
    expect(sim.model.terminated).toBeNull();
    sim.runAll();
    expectSameRun(sim, ref, 'rewound run');
    expect(built.n).toBe(0);
  });

  it('a model with a stepper is not asked for rhs() even if it has one', () => {
    class BothModel extends StepOnlyModel {
      readonly integratorOpts = { rtol: 1e-6, atol: 1e-9, dtMin: 1e-9, dtMax: 0.05 };
      rhs = vi.fn();
    }
    built.n = 0;
    const model = new BothModel();
    new Simulation(anyCfg(), { modelFactory: () => model }).runAll();
    expect(built.n).toBe(0);
    expect(model.rhs).not.toHaveBeenCalled();
  });
});

describe('SimModel contract check', () => {
  const noStepper = (model: ToyModel, extra: object = {}): SimModel => Object.assign(model, { step: undefined }, extra) as unknown as SimModel;

  it('a model with neither step() nor rhs() and integratorOpts is refused with ModelContractError', () => {
    let err: unknown;
    try { new Simulation(anyCfg(), { modelFactory: () => noStepper(new StepOnlyModel()) }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ModelContractError);
    expect((err as ModelContractError).method).toBe('muon');
    expect((err as ModelContractError).message).toBe("model 'muon' does not meet the SimModel contract: it has no step() and lacks rhs() and integratorOpts");
  });

  it('names the member that is missing when it has one of the two', () => {
    const rhs = () => undefined;
    const opts = { rtol: 1e-6, atol: 1e-9, dtMin: 1e-9, dtMax: 0.1 };
    expect(() => new Simulation(anyCfg(), { modelFactory: () => noStepper(new StepOnlyModel(), { rhs }) })).toThrow(/lacks integratorOpts$/);
    expect(() => new Simulation(anyCfg(), { modelFactory: () => noStepper(new StepOnlyModel(), { integratorOpts: opts }) })).toThrow(/lacks rhs\(\)$/);
  });

  it('every model of the standard configurations meets it (one stepper for a 0D model, none for 1.5D)', () => {
    built.n = 0;
    new Simulation(presetCfg('NIF'));
    expect(built.n).toBe(1);
    built.n = 0;
    const sim = new Simulation(presetCfg('JET15', 0.1));
    expect(sim.model).toBeInstanceOf(ProfileModel);
    expect(built.n).toBe(0);
    expect(sim.history[0].sim && 'integ' in sim.history[0].sim).toBe(false);
  });

  it('the 1.5D model carries no rhs() / integratorOpts stub: it has its own step() and needs neither', () => {
    const model = new Simulation(presetCfg('JET15', 0.1)).model as ProfileModel;
    expect(typeof model.step).toBe('function');
    expect('rhs' in model).toBe(false);
    expect('integratorOpts' in model).toBe(false);
  });
});

describe('FSAL stage reuse', () => {
  /** short runs of every model family; [id, t_end] */
  const CASES: [string, number?][] = [['NIF'], ['Z'], ['TAE'], ['MIRROR'], ['W7X'], ['JET', 3], ['DIIID', 3], ['ITER', 8]];

  it.each(CASES)('%s: a run that reuses stages is bitwise the run that does not', async (id, tEnd) => {
    const cfg = presetCfg(id, tEnd);
    const on = new Simulation(cfg, { fsal: true }), off = new Simulation(cfg, { fsal: false });
    const callsOn = countRhs(on), callsOff = countRhs(off);
    on.runAll();
    await tick();
    off.runAll();
    expectSameRun(on, off, `${id} with and without stage reuse`);
    expect(callsOn()).toBeLessThanOrEqual(callsOff());
    expect(on.nSteps).toBe(off.nSteps);
  }, 120000);

  it('saves one evaluation per step where nothing changes between steps (pulsed models, stellarator)', () => {
    for (const id of ['NIF', 'MIRROR', 'W7X']) {
      const cfg = presetCfg(id);
      const on = new Simulation(cfg), off = new Simulation(cfg, { fsal: false });
      const callsOn = countRhs(on), callsOff = countRhs(off);
      on.runAll(); off.runAll();
      expect(callsOff() - callsOn(), id).toBeGreaterThan(0.9 * on.nSteps);
      expect(callsOn(), id).toBeLessThan(6.2 * on.nSteps);
    }
  });

  it('a step follows a control change: interventions through applyControl() and around the kernel', async () => {
    // through the kernel: every applyControl invalidates the reusable stage
    const a = applyRandomControls(new Simulation(presetCfg('JET', 3), { fsal: true }), 31, 0.25);
    expect(a.actuatorLog.length).toBeGreaterThan(3);
    await tick();
    expectSameRun(a, applyRandomControls(new Simulation(presetCfg('JET', 3), { fsal: false }), 31, 0.25), 'JET with random interventions');
    await tick();
    // straight on the model, which the kernel does not see: the model's controls are part of the stage's signature
    const drive = (fsal: boolean, patch: boolean) => {
      const sim = new Simulation(presetCfg('JET', 3), { fsal });
      let n = 0;
      while (!sim.done) {
        sim.advance(0.05);
        if (patch && ++n % 3 === 0) sim.model.applyControl({ P_NBI_MW: 8 + (n % 9), n_target_1e20: 0.5 + 0.02 * (n % 7) });
      }
      return digest(sim);
    };
    const direct = drive(true, true);
    expect(direct).toBe(drive(false, true));
    expect(direct).not.toBe(drive(true, false)); // the patches did change the run
  }, 60000);

  it('a rewind starts from a fresh evaluation, also right after stages were reused', async () => {
    const cfg = presetCfg('W7X');
    const ref = new Simulation(cfg, { fsal: false });
    ref.runAll();
    for (const p of [0.3, 0.7]) {
      const sim = rewindAt(cfg, p, 5);
      await tick();
      advanceRandomly(sim, 6);
      expect(sim.history.length).toBe(ref.history.length);
      expect(sim.y).toEqual(ref.y);
    }
  });

  describe('model state that postStep() changes', () => {
    const run = (reportK: boolean, fsal: boolean) => {
      const sim = new Simulation(anyCfg(), { modelFactory: () => new SwitchingModel(reportK), fsal });
      const calls = countRhs(sim);
      sim.runAll();
      return { sim, calls: calls() };
    };

    it('breaks the reuse: the run equals the run without stage reuse', () => {
      const on = run(true, true), off = run(true, false);
      expect(digest(on.sim)).toBe(digest(off.sim));
      // the state is switched on some steps only, the other steps reuse
      expect(on.calls).toBeLessThan(off.calls);
      expect(off.calls - on.calls).toBeGreaterThan(20);
    });

    it('is a contract violation to keep it out of saveInternal(): the kernel then cannot see it and reuses a stale stage', () => {
      const on = run(false, true), off = run(false, false);
      expect(digest(on.sim)).not.toBe(digest(off.sim));
    });
  });
});

describe('a shot ended by a failed step of the model’s own stepper (1.5D numerical failure)', () => {
  // The solver reports a failed attempt (StepAttempt.ok = false) at every time step, so the stepper
  // retries down to its floor and then ends the shot with a StepFailure. The failure is injected as a
  // failed attempt, not as a thrown Error: the stepper's contract for a THROWN error differs between
  // versions of the profiles module (a numerical failure is retried like a failed attempt, any other
  // exception is a programming error that propagates out of advance()), and these tests are about how
  // the kernel records a shot ended by a StepFailure, not about that classification.
  const fail = (sim: Simulation): void => {
    (sim.model as ProfileModel).stepper.implicitStep = () => ({ ok: false, change: Infinity, error: new Error('solver failure') });
  };
  const lastFrame = (sim: Simulation) => sim.history[sim.history.length - 1];
  /** a JET 1.5D shot paused where the last frame is at the current time */
  const atFrame = (): Simulation => {
    const sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.advance(0.3);
    let guard = 0;
    while (lastFrame(sim).t !== sim.t && guard++ < 1000) sim.advance(1e-9);
    expect(lastFrame(sim).t).toBe(sim.t);
    return sim;
  };
  /** a JET 1.5D shot paused between two frames */
  const betweenFrames = (): Simulation => {
    const sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.advance(0.3);
    let guard = 0;
    while (lastFrame(sim).t === sim.t && guard++ < 1000) sim.advance(1e-9);
    expect(lastFrame(sim).t).toBeLessThan(sim.t);
    return sim;
  };

  it('without progress since the last frame, the terminal frame shares its time and state and carries the termination', () => {
    const sim = atFrame();
    const prev = lastFrame(sim), n = sim.history.length;
    fail(sim);
    const out = sim.advance(0.1);
    expect(sim.history.length).toBe(n + 1);
    expect(out.frames).toEqual([lastFrame(sim)]); // handed to the caller like any new frame
    const term = lastFrame(sim);
    expect(term.t).toBe(prev.t);
    expect(sim.t).toBe(prev.t);
    expect(term.y).toEqual(prev.y);
    expect(term.d).toEqual(prev.d);
    expect(prev.sim?.terminated).toBeNull();
    expect(term.sim?.terminated?.reason).toBe('Numerical failure');
    expect(term.sim?.terminated?.natural).toBe(false);
    expect(term.sim?.nEvents).toBe(sim.events.length);
    expect(out.events.map((e) => e.kind)).toEqual(['end']);
    expect(out.events[0].msg).toContain('Numerical failure');
    // it is the stepper's own StepFailure (the failed attempts were retried down to the floor), carrying the solver's message
    expect(out.events[0].msg).toContain('solver failure');
    expect(term.sim?.terminated?.diagnosis).toContain('solver failure');
    expect(sim.done).toBe(true);
    expect(sim.advance(0.1)).toEqual({ frames: [], events: [] });
    // every other pair of frames is strictly increasing in time
    for (let i = 1; i < sim.history.length - 1; i++) expect(sim.history[i].t).toBeGreaterThan(sim.history[i - 1].t);
  }, 60000);

  it('in the middle of an output interval, the terminal frame is a later frame like any other', () => {
    const sim = betweenFrames();
    const prev = lastFrame(sim);
    fail(sim);
    sim.advance(0.1);
    const term = lastFrame(sim);
    expect(term.t).toBe(sim.t);
    expect(term.t).toBeGreaterThan(prev.t);
    expect(term.sim?.terminated?.reason).toBe('Numerical failure');
    expect(term.sim?.terminated?.diagnosis).toContain('solver failure');
    for (let i = 1; i < sim.history.length; i++) expect(sim.history[i].t).toBeGreaterThan(sim.history[i - 1].t);
  }, 60000);

  it('rewinding to the terminal frame keeps the shot ended; rewinding to the frame before it brings the failure back', () => {
    const sim = atFrame();
    const n = sim.history.length;
    fail(sim);
    sim.advance(0.1);
    const term = lastFrame(sim);
    sim.rewindTo(n); // the terminal frame
    expect(sim.done).toBe(true);
    expect(sim.model.terminated?.reason).toBe('Numerical failure');
    expect(sim.history.length).toBe(n + 1);
    sim.rewindTo(n - 1); // the frame before it: alive again, and the same step fails the same way
    expect(sim.model.terminated).toBeNull();
    expect(sim.done).toBe(false);
    sim.advance(0.1);
    expect(sim.history.length).toBe(n + 1);
    expect(lastFrame(sim).t).toBe(term.t);
    expect(lastFrame(sim).y).toEqual(term.y);
    expect(lastFrame(sim).sim?.terminated).toEqual(term.sim?.terminated);
  }, 60000);
});
