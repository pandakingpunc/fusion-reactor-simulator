/**
 * Deterministic simulation kernel: SimModel + Dormand–Prince → time series (HistoryFrame) + events.
 * Models with their own time stepper (the implicit 1.5D PDE solver) advance with model.step().
 * The web worker, the CLIs and the golden harness all use this class.
 *
 * Determinism contract
 *  - Chunk invariance. A step ends only at a kernel breakpoint: the next regular output time,
 *    the next synchronisation point, the next user breakpoint (SimulationOptions.breakpoints) or
 *    t_end. advance(simDt) takes whole steps until t ≥ t₀ + simDt, so it may stop past that target
 *    by less than one step, and the step sequence never depends on how the caller chunks time:
 *    any sequence of advance() calls gives bitwise the same run as runAll().
 *  - Synchronisation points: every t_end/100, with the recurrence t_sync ← t + t_end/100 once a
 *    step reaches t_sync (within 1e-12). This is exactly where runAll() used to cut its chunks, so
 *    runs keep bitwise the results recorded before the kernel became chunk invariant.
 *  - Exact rewind. Every history frame carries a checkpoint (frame.sim: step counter, next output
 *    and synchronisation times, event count, integrator controller state, live controls, the
 *    model's termination, and the model's saveCheckpoint() if it has one); rewindTo() restores it
 *    together with the frame's state and the model's internal state, so the rewound run continues
 *    as the uninterrupted one did — as far as the model's saveInternal()/saveCheckpoint() capture
 *    its state. A shot that had ended at the frame (scheduled end, disruption, magnet quench) is
 *    still ended after the rewind.
 *  - Actuator log. applyControl() takes effect at the current step boundary (a paused simulation
 *    is always at one) and is logged as {t, step, patch}; rewindTo() truncates the log. Replaying a
 *    log (new Simulation(cfg, { actuatorLog }) or Simulation.replay) reproduces the run bitwise,
 *    and runFingerprint() hashes the inputs that define a run.
 *  - Set-points on rewind. rewindTo() re-applies the controls of the frame (frame.sim.controls) to
 *    the model, for the 0D models and for the 1.5D model alike (whose restoreInternal() leaves the
 *    set-points alone): after a rewind the controls are those in force at the frame, not the latest
 *    ones, and the actuator log keeps exactly the entries before the frame.
 *  - Stage reuse (FSAL). A Dormand–Prince step starts from the last stage of the previous step when
 *    nothing changed in between: the step ended at t, y is the state it produced, and the model's
 *    controls and saveInternal() record are those of right after that step (a postStep that changes
 *    y or the state rhs reads, applyControl and a rewind all break it). This is bitwise the same as
 *    evaluating rhs again (SimModel.rhs is a function of t, y, the controls and the saveInternal()
 *    state) and saves one of seven evaluations; SimulationOptions.fsal switches it off. A model whose
 *    saveInternal() record changes at every step defeats it: the 0D magnetic model re-derives its ELM
 *    particle-exhaust rate after every step of an ELM H-mode (MagneticModel.elmPartRate: JET refuses in
 *    1238 of 1501 steps, 0.9 % of the evaluations saved). That is a model decision, not a kernel one.
 *  - Scenario. SimulationOptions.scenario (scenario.ts: JSON waveforms and conditional triggers per
 *    control key) is evaluated at every step boundary, after the replayed actuator entries: the
 *    controls it changes are those of the next step, its corners are breakpoints (steps end on them),
 *    its state is in every frame checkpoint (frame.sim.scenario) and comes back on a rewind, and it
 *    enters runFingerprint(). Its changes are not logged in the actuator log (they are a function of
 *    the scenario, the configuration and the recorded frames); a live applyControl() takes over the
 *    keys of its patch from the waveforms for the rest of the run branch. Replaying an actuator log
 *    needs the same scenario. A run without a scenario is bitwise what it was before scenarios.
 *  - Step atomicity and slicing. A kernel step is atomic: the observable state of the run (t, history, events, the step
 *    counter, the actuator log, every checkpoint) changes only when a step completes, and the completed run is a function
 *    of the configuration, the seed, the actuator log, the breakpoints and the scenario, never of when or how often the
 *    caller stopped (chunk invariance above). advance() can still return in the middle of a step, for a caller that must
 *    stay responsive (the simulation worker: a message, a pause, waits for the task that is running): given
 *    AdvanceOptions.yieldWhen, a model that provides stepSlices() (SimModel: a resumable form of step(); the 1.5D model,
 *    whose Grad-Shafranov update alone takes 30 to 100 ms) is stepped by running that generator, and yieldWhen() is asked
 *    at each of its yields. When it says stop, advance() returns with the step suspended (stepInProgress). The step is the
 *    same statements in the same order as without slicing (the model derives step() from stepSlices()), so slicing
 *    changes no bit of the run (kernel/slicing.test.ts, determinism15.test.ts). A suspended step is not a boundary and not
 *    visible: t, history, events, nSteps and done are those of the boundary before it, no frame of it exists yet, and y and
 *    the model belong to the step (nothing may read or change them until it ends). What ends it:
 *      - advance() continues it first, to its end or, with yieldWhen, to the next stop; the frames and events it
 *        completes are in that call's result. The target of the call is measured from t, the start of the step;
 *      - applyControl() settles it (runs it to its end), then applies the patch at the boundary that follows, exactly as
 *        if the patch had arrived when the step ended. The frames of the settled step are in `history` but in no advance()
 *        result: a caller that mirrors the history reads them (worker/host.ts calls advance(0) first);
 *      - rewindTo() drops it (the model is restored from the frame's checkpoint, which does not depend on the partial
 *        effects of the step), and runAll() runs it to its end.
 *    report() and fingerprint() do not settle it: report() reads the model's state, so call it at a boundary.
 *  - Frame times. Each recorded frame is later than the one before, except that a shot ended by a
 *    step that made no progress in time (a model's own stepper giving up: 'Numerical failure') gets
 *    its terminal frame at the time of the last frame, with the same state; it carries the
 *    termination (see HistoryFrame).
 */
import { DormandPrince } from './integrator';
import { ActuatorEntry, HistoryFrame, MagneticConfig, ReactorConfig, ShotReport, SimCheckpoint, SimEvent, SimModel, TerminationInfo } from './types';
import { MagneticModel } from './confinement/magnetic';
import { ICFModel } from './confinement/icf';
import { MTFModel } from './confinement/mtf';
import { FRCModel } from './confinement/frc';
import { MirrorModel } from './confinement/mirror';
import { MuonModel } from './confinement/muon';
import { ProfileModel, supportsProfiles } from './profiles/model';
import { ModelContractError, UnknownMethodError } from './kernel/errors';
import { runFingerprint } from './kernel/fingerprint';
import { sameRecord } from './kernel/signature';
import { isEmptyScenario, Scenario, T_EPS, type ScenarioSpec } from './scenario';

/** Builds the model of a configuration; throws UnknownMethodError for an unknown method. */
export function createModel(cfg: ReactorConfig): SimModel {
  switch (cfg.method) {
    case 'tokamak': case 'spherical_tokamak': case 'stellarator':
      return (cfg as MagneticConfig).fidelity === '1.5D' && supportsProfiles(cfg) ? new ProfileModel(cfg) : new MagneticModel(cfg);
    case 'icf_direct': case 'icf_indirect': return new ICFModel(cfg);
    case 'mtf_liner': case 'mtf_piston': case 'maglif': case 'zpinch_sfs': return new MTFModel(cfg);
    case 'frc': return new FRCModel(cfg);
    case 'mirror': return new MirrorModel(cfg);
    case 'muon': return new MuonModel(cfg);
    default: throw new UnknownMethodError((cfg as { method?: unknown } | null)?.method);
  }
}

/** Number of synchronisation intervals per run (see the file header). */
export const SYNC_INTERVALS = 100;
/** Safety cap on the steps of one advance() call (the next call continues seamlessly). */
const MAX_STEPS_PER_ADVANCE = 200000;
/** Safety cap on the advance() calls of runAll(). */
const MAX_CHUNKS = 10000;

export interface SimulationOptions {
  /**
   * Actuator log to replay: each patch is applied when the kernel reaches its step boundary
   * (entry.step), exactly as the logged run applied it; entries of one boundary in log order.
   */
  actuatorLog?: readonly ActuatorEntry[];
  /**
   * Extra times at which a step must end (e.g. a fixed sampling grid; advance() alone ends at step
   * boundaries only). They change the step sequence, so they are part of a run's definition (see
   * runFingerprint); times outside (0, t_end) are ignored.
   */
  breakpoints?: readonly number[];
  /**
   * Start a Dormand–Prince step from the last stage of the previous one when the model state is
   * unchanged in between (default true). The results are bitwise identical either way; the switch
   * is for tests and benchmarks.
   */
  fsal?: boolean;
  /**
   * A scenario: waveforms and conditional triggers that drive the model's control keys (scenario.ts;
   * validated against the model's controls, ScenarioError when invalid). Part of the run's definition:
   * runFingerprint() covers it, and so must a replay of an actuator log.
   */
  scenario?: ScenarioSpec;
  /** Builds the model instead of createModel() (plug-in models, tests of the kernel contract); runFingerprint() does not cover it. */
  modelFactory?: (cfg: ReactorConfig) => SimModel;
}

export interface AdvanceOptions {
  /**
   * Called at every yield of a resumable step (SimModel.stepSlices) and after every completed step that has not reached
   * the target of the call: when it returns true, advance() returns (at a boundary, or with the step suspended, see the
   * header, "Step atomicity and slicing"). It is asked only after some work has been done, so every call makes progress.
   * It must not read the model or the simulation. A model without stepSlices() and a Dormand-Prince model are stepped
   * whole: for them it is asked between steps only.
   */
  yieldWhen?: () => boolean;
}

/** What a reusable stage depends on besides (t, y): the controls and the model's saveInternal() record. */
interface ModelSignature {
  controls: Record<string, number>;
  internal: Record<string, number>;
}

export class Simulation {
  readonly cfg: ReactorConfig;
  model: SimModel;
  t = 0;
  y: Float64Array;
  history: HistoryFrame[] = [];
  events: SimEvent[] = [];
  /** the Dormand–Prince stepper; null for a model with its own step() */
  private integ: DormandPrince | null;
  private readonly fsal: boolean;
  /** the scenario engine; null for a run without a scenario (or with an empty one) */
  private readonly scen: Scenario | null;
  /** the model's signature right after the last Dormand–Prince step (null: none yet, or FSAL off) */
  private stageSig: ModelSignature | null = null;
  private nextOut = 0;
  private nextSync: number;
  private readonly syncDt: number;
  private steps = 0;
  private readonly breaks: number[];
  private breakIdx = 0;
  /** the end-of-run postStep safety call was made (see flushEnd) */
  private endFlushed = false;
  private log: ActuatorEntry[] = [];
  private readonly pending: readonly ActuatorEntry[];
  private pendIdx = 0;
  /** the step in progress, suspended inside model.stepSlices() (t0: where it started); null at a step boundary */
  private run: { gen: Generator<void, number, void>; t0: number } | null = null;

  constructor(cfg: ReactorConfig, opts: SimulationOptions = {}) {
    this.cfg = cfg;
    this.model = (opts.modelFactory ?? createModel)(cfg);
    this.y = this.model.initialState();
    this.fsal = opts.fsal ?? true;
    this.integ = this.makeIntegrator();
    this.syncDt = this.model.tEnd / SYNC_INTERVALS;
    this.nextSync = Math.min(this.t + this.syncDt, this.model.tEnd);
    this.breaks = (opts.breakpoints ?? []).filter((b) => b > 0 && b < this.model.tEnd).sort((a, b) => a - b);
    // stable sort: a log from Simulation.actuatorLog is already in step order
    this.pending = (opts.actuatorLog ?? []).map((e) => ({ t: e.t, step: e.step, patch: { ...e.patch } })).sort((a, b) => a.step - b.step);
    // validated in any case; one that does nothing is no scenario (no checkpoint state, the fingerprint of a run without one)
    // (tEnd: a rampStep grid finer than t_end / MAX_RAMP_GRID would make the run endless and is refused)
    const scen = opts.scenario ? new Scenario(opts.scenario, this.model.getControls(), { tEnd: this.model.tEnd }) : null;
    this.scen = scen && !isEmptyScenario(scen.spec) ? scen : null;
    // the waveforms in force at t = 0 are the controls of the first frame and the first step
    if (this.scen) this.model.applyControl(this.scen.waveformsAt(0));
    this.record(true);
    this.scen?.checkDiagnostics(Object.keys(this.history[0].d));
  }

  /** Replays a run from its configuration and actuator log, to completion. */
  static replay(cfg: ReactorConfig, actuatorLog: readonly ActuatorEntry[], opts: Omit<SimulationOptions, 'actuatorLog'> = {}): Simulation {
    const sim = new Simulation(cfg, { ...opts, actuatorLog });
    sim.runAll();
    return sim;
  }

  /** the shot has ended; false while a step is in progress (it has not ended yet, whatever the model already says) */
  get done(): boolean {
    return this.run === null && (this.model.terminated !== null || this.t >= this.model.tEnd - T_EPS);
  }
  /** a step is suspended in the middle (advance() with yieldWhen returned inside it); t and the history are those of the boundary before it */
  get stepInProgress(): boolean { return this.run !== null; }
  get dt(): number { return this.model.currentDt ?? this.integ?.dt ?? this.model.dt0; }
  get nSteps(): number { return this.integ ? this.integ.nSteps : this.steps; }
  /** Every applyControl() of the current branch of the run, in order (copies). */
  get actuatorLog(): ActuatorEntry[] { return this.log.map((e) => ({ t: e.t, step: e.step, patch: { ...e.patch } })); }
  /** The user breakpoint schedule in force (sorted, inside (0, t_end)). */
  get breakpoints(): number[] { return [...this.breaks]; }
  /** The scenario of the run (validated, normalised; a copy), or null. A ScenarioSpec is plain JSON, so a JSON round trip is its deep copy (structuredClone is not in the ECMAScript library the core is compiled against). */
  get scenario(): ScenarioSpec | null { return this.scen ? JSON.parse(JSON.stringify(this.scen.spec)) as ScenarioSpec : null; }

  /** runFingerprint() of this run as it stands (configuration, seed, actuator log, breakpoints). */
  fingerprint(appVersion: string): string {
    const seed = (this.cfg as { seed?: number }).seed ?? 0;
    return runFingerprint(this.cfg, seed, this.log, appVersion, this.breaks, this.scen?.fingerprintForm());
  }

  /**
   * The Dormand–Prince stepper of a model that integrates dy/dt = rhs(t, y); null for a model with
   * its own step(), which needs neither rhs() nor integratorOpts.
   */
  private makeIntegrator(): DormandPrince | null {
    const m = this.model;
    if (m.step) return null;
    if (!m.rhs || !m.integratorOpts) {
      throw new ModelContractError(m.method, `it has no step() and lacks ${m.rhs ? 'integratorOpts' : m.integratorOpts ? 'rhs()' : 'rhs() and integratorOpts'}`);
    }
    const integ = new DormandPrince(m.nState, (t, y, d) => this.model.rhs!(t, y, d), m.integratorOpts, m.dt0);
    integ.fsal = this.fsal;
    return integ;
  }

  private checkpoint(): SimCheckpoint {
    const cp: SimCheckpoint = {
      steps: this.steps, nextOut: this.nextOut, nextSync: this.nextSync, nextBreak: this.breakIdx,
      nEvents: this.events.length, controls: this.model.getControls(),
      terminated: this.model.terminated ? { ...this.model.terminated } : null,
    };
    if (this.integ) cp.integ = this.integ.snapshot();
    if (this.model.saveCheckpoint) cp.model = this.model.saveCheckpoint();
    if (this.scen) cp.scenario = this.scen.save();
    return cp;
  }

  /** regular: a regular output frame (only these carry profiles — memory bound) */
  private record(regular: boolean): void {
    const f: HistoryFrame = { t: this.t, y: Array.from(this.y), d: this.model.diagnostics(this.t, this.y), internal: this.model.saveInternal() };
    if (regular && this.model.profiles) f.prof = this.model.profiles(this.y);
    const eq = this.model.takeEqSnapshot?.();
    if (eq) f.eq = eq;
    if (regular) this.nextOut = this.t + this.model.outputDt;
    f.sim = this.checkpoint();
    this.history.push(f);
  }

  /** Applies the replayed actuator entries whose step boundary has been reached. */
  private applyPending(): void {
    while (this.pendIdx < this.pending.length && this.pending[this.pendIdx].step <= this.steps) {
      this.applyControl(this.pending[this.pendIdx++].patch);
    }
  }

  /**
   * The scenario at the step boundary: its waveforms at the current time and the triggers on the last
   * recorded frame. Controls that differ from the model's are written (the stage FSAL would reuse
   * belongs to the old ones); nothing goes into the actuator log. What the triggers did is logged as events.
   */
  private applyScenario(): void {
    const scen = this.scen;
    if (!scen) return;
    const i = this.history.length - 1;
    const r = scen.step(this.t, { index: i, t: this.history[i].t, d: this.history[i].d });
    for (const n of r.notes) this.events.push(n.value === undefined ? { t: this.t, kind: 'info', msg: n.msg } : { t: this.t, kind: 'info', msg: n.msg, value: n.value });
    const cur = this.model.getControls();
    let patch: Record<string, number> | null = null;
    for (const k of Object.keys(r.patch)) if (!Object.is(cur[k], r.patch[k])) (patch ??= {})[k] = r.patch[k];
    if (patch) {
      this.model.applyControl(patch);
      this.integ?.invalidate();
    }
  }

  /** The start of a kernel step: what is due at the boundary (replayed actuator entries, the scenario), and the time the step must not pass. */
  private beginStep(): { t0: number; tMax: number } {
    this.applyPending();
    this.applyScenario();
    const t0 = this.t;
    const tBreak = this.breakIdx < this.breaks.length ? this.breaks[this.breakIdx] : Infinity;
    const tMax = Math.min(this.nextSync, this.nextOut, tBreak, this.scen ? this.scen.nextBreakpoint(t0) : Infinity);
    return { t0, tMax };
  }

  /**
   * One kernel step, or the continuation of the one in progress: integrate to the next breakpoint at most, then events and
   * output. Returns true when the step ended, false when `yieldWhen` stopped it in the middle of a resumable step (this.run).
   */
  private stepOnce(yieldWhen?: () => boolean): boolean {
    let run = this.run;
    if (!run) {
      const { t0, tMax } = this.beginStep();
      const m = this.model;
      if (this.integ || !yieldWhen || !m.stepSlices) {
        this.endStep(t0, this.integ ? this.integrate(this.integ, t0, tMax) : m.step!(t0, this.y, tMax));
        return true;
      }
      run = this.run = { gen: m.stepSlices(t0, this.y, tMax), t0 };
    }
    for (;;) {
      let r: IteratorResult<void, number>;
      try { r = run.gen.next(); } catch (e) { this.run = null; throw e; } // the model has put its state back; the step did not happen
      if (r.done) {
        this.run = null;
        this.endStep(run.t0, r.value);
        return true;
      }
      if (yieldWhen?.()) return false;
    }
  }

  /** The end of a kernel step that took the model from t0 to t: events, output frame, breakpoints. */
  private endStep(t0: number, t: number): void {
    this.t = t;
    this.steps++;
    const ev = this.model.postStep(this.t, this.t - t0, this.y);
    if (ev.length) this.events.push(...ev);
    if (this.t >= this.nextSync - T_EPS) this.nextSync = Math.min(this.t + this.syncDt, this.model.tEnd);
    while (this.breakIdx < this.breaks.length && this.t >= this.breaks[this.breakIdx] - T_EPS) this.breakIdx++;
    const regular = this.t >= this.nextOut - T_EPS;
    if (regular || this.model.terminated || ev.some((e) => e.kind === 'ELM' || e.kind === 'sawtooth' || e.kind === 'disruption')) this.record(regular || !!this.model.terminated);
    this.flushEnd();
  }

  /**
   * One Dormand–Prince step. It starts from the last stage of the previous step (FSAL) only if the
   * model's controls and saveInternal() record are what they were right after that step: any state
   * that postStep(), applyControl() or a rewind changed breaks the reuse.
   */
  private integrate(integ: DormandPrince, t0: number, tMax: number): number {
    if (!this.fsal) return integ.step(t0, this.y, tMax);
    if (integ.canReuseStage(t0, this.y)) {
      const s = this.stageSig;
      if (!s || !sameRecord(s.internal, this.model.saveInternal()) || !sameRecord(s.controls, this.model.getControls())) integ.invalidate();
    }
    const t = integ.step(t0, this.y, tMax);
    this.stageSig = { internal: this.model.saveInternal(), controls: this.model.getControls() };
    return t;
  }

  /**
   * Safety net: models set their own `terminated` in postStep when t reaches t_end; if one did not,
   * give it one more postStep at t_end (once per branch). Its events are kept.
   */
  private flushEnd(): void {
    if (this.endFlushed || this.model.terminated || this.t < this.model.tEnd - T_EPS) return;
    this.endFlushed = true;
    const ev = this.model.postStep(this.t, 0, this.y);
    if (ev.length) this.events.push(...ev);
  }

  /**
   * Advances simulation time by at least `simDt` (whole steps; see the file header) or to the end.
   * Returns the new frames and events. The call does not cut a step at t + simDt, so to sample at
   * fixed times (e.g. every 2 ms) pass those times as SimulationOptions.breakpoints: steps then end
   * on them, and each advance(2 ms) from one grid point stops at the next.
   */
  advance(simDt: number, opts: AdvanceOptions = {}): { frames: HistoryFrame[]; events: SimEvent[] } {
    const startFrames = this.history.length, startEv = this.events.length;
    const yieldWhen = opts.yieldWhen;
    const tTarget = Math.min(this.t + simDt, this.model.tEnd);
    const result = () => ({ frames: this.history.slice(startFrames), events: this.events.slice(startEv) });
    // the step in progress is part of this call's work, whatever the target
    let guard = 0, resumed = this.run !== null;
    while (resumed || (this.t < tTarget - T_EPS && !this.model.terminated && guard++ < MAX_STEPS_PER_ADVANCE)) {
      resumed = false;
      if (!this.stepOnce(yieldWhen)) return result();
      if (yieldWhen && this.t < tTarget - T_EPS && yieldWhen()) break;
    }
    this.flushEnd();
    this.applyPending();
    return result();
  }

  /** Runs to the end (CLI / validation / golden). */
  runAll(): ShotReport {
    let guard = 0;
    while (!this.done && guard++ < MAX_CHUNKS) this.advance(this.model.tEnd / SYNC_INTERVALS);
    // advance() ends with flushEnd(); a run that is already done (e.g. rewound to its final frame)
    // never calls advance(), so make the end-of-run call here as well
    this.flushEnd();
    this.applyPending();
    return this.report();
  }

  report(): ShotReport {
    return this.model.report(this.history, this.events);
  }

  /**
   * Rewinds to history frame `frameIndex` (clamped to the recorded frames); later frames, events
   * and actuator entries are dropped (branching). The kernel, integrator, controls, the model's
   * termination and its internal state are restored from the frame's checkpoint.
   */
  rewindTo(frameIndex: number): void {
    if (Number.isNaN(frameIndex)) throw new RangeError('rewindTo: frame index is NaN');
    // a step in progress is dropped: the restore below overwrites everything it has done to y and to the model
    if (this.run) { const gen = this.run.gen; this.run = null; gen.return(0); }
    const i = Math.max(0, Math.min(Math.floor(frameIndex), this.history.length - 1));
    const f = this.history[i];
    this.t = f.t;
    this.y = Float64Array.from(f.y);
    this.model.restoreInternal(f.internal);
    this.history = this.history.slice(0, i + 1);
    this.endFlushed = false;
    this.stageSig = null;
    const cp = f.sim;
    if (cp) {
      if (cp.model !== undefined && this.model.restoreCheckpoint) this.model.restoreCheckpoint(cp.model);
      // restoreInternal() cleared it; SimModel.terminated is writable for the kernel (see types.ts)
      (this.model as { terminated: TerminationInfo | null }).terminated = cp.terminated ? { ...cp.terminated } : null;
      this.model.applyControl(cp.controls);
      if (cp.integ) this.integ?.restore(cp.integ);
      this.steps = cp.steps;
      this.nextOut = cp.nextOut;
      this.nextSync = cp.nextSync;
      this.breakIdx = cp.nextBreak;
      this.events = this.events.slice(0, cp.nEvents);
      if (this.scen) { if (cp.scenario) this.scen.restore(cp.scenario); else this.scen.reset(); }
    } else {
      // a frame without a checkpoint (recorded by an older version): best effort, as before v4
      this.events = this.events.filter((e) => e.t <= f.t);
      this.integ = this.makeIntegrator();
      this.nextOut = this.t + this.model.outputDt;
      this.nextSync = Math.min(this.t + this.syncDt, this.model.tEnd);
      this.breakIdx = this.breaks.findIndex((b) => b > this.t + T_EPS);
      if (this.breakIdx < 0) this.breakIdx = this.breaks.length;
      this.scen?.reset();
    }
    this.log = this.log.filter((e) => e.step < this.steps);
    this.pendIdx = this.pending.findIndex((e) => e.step >= this.steps);
    if (this.pendIdx < 0) this.pendIdx = this.pending.length;
  }

  /**
   * Live intervention: the patch takes effect at the current step boundary (the next step uses
   * it) and is appended to the actuator log. Its keys are taken over from the scenario's waveforms
   * (the operator wins) for the rest of the run branch.
   */
  applyControl(patch: Record<string, number>): void {
    if (this.run) this.stepOnce(); // settle the step in progress: the patch takes effect at the boundary that follows it
    this.log.push({ t: this.t, step: this.steps, patch: { ...patch } });
    this.model.applyControl(patch);
    this.scen?.override(Object.keys(patch));
    this.integ?.invalidate();
  }
}
