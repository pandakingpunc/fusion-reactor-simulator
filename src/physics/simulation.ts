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
/** Time slack [model time unit] within which a step counts as having reached a breakpoint. */
const T_EPS = 1e-12;
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
  /** Builds the model instead of createModel() (plug-in models, tests of the kernel contract); runFingerprint() does not cover it. */
  modelFactory?: (cfg: ReactorConfig) => SimModel;
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

  constructor(cfg: ReactorConfig, opts: SimulationOptions = {}) {
    this.cfg = cfg;
    this.model = (opts.modelFactory ?? createModel)(cfg);
    this.y = this.model.initialState();
    this.integ = this.makeIntegrator();
    this.syncDt = this.model.tEnd / SYNC_INTERVALS;
    this.nextSync = Math.min(this.t + this.syncDt, this.model.tEnd);
    this.breaks = (opts.breakpoints ?? []).filter((b) => b > 0 && b < this.model.tEnd).sort((a, b) => a - b);
    // stable sort: a log from Simulation.actuatorLog is already in step order
    this.pending = (opts.actuatorLog ?? []).map((e) => ({ t: e.t, step: e.step, patch: { ...e.patch } })).sort((a, b) => a.step - b.step);
    this.record(true);
  }

  /** Replays a run from its configuration and actuator log, to completion. */
  static replay(cfg: ReactorConfig, actuatorLog: readonly ActuatorEntry[], opts: Omit<SimulationOptions, 'actuatorLog'> = {}): Simulation {
    const sim = new Simulation(cfg, { ...opts, actuatorLog });
    sim.runAll();
    return sim;
  }

  get done(): boolean {
    return this.model.terminated !== null || this.t >= this.model.tEnd - T_EPS;
  }
  get dt(): number { return this.model.currentDt ?? this.integ?.dt ?? this.model.dt0; }
  get nSteps(): number { return this.integ ? this.integ.nSteps : this.steps; }
  /** Every applyControl() of the current branch of the run, in order (copies). */
  get actuatorLog(): ActuatorEntry[] { return this.log.map((e) => ({ t: e.t, step: e.step, patch: { ...e.patch } })); }
  /** The user breakpoint schedule in force (sorted, inside (0, t_end)). */
  get breakpoints(): number[] { return [...this.breaks]; }

  /** runFingerprint() of this run as it stands (configuration, seed, actuator log, breakpoints). */
  fingerprint(appVersion: string): string {
    const seed = (this.cfg as { seed?: number }).seed ?? 0;
    return runFingerprint(this.cfg, seed, this.log, appVersion, this.breaks);
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
    return new DormandPrince(m.nState, (t, y, d) => this.model.rhs!(t, y, d), m.integratorOpts, m.dt0);
  }

  private checkpoint(): SimCheckpoint {
    const cp: SimCheckpoint = {
      steps: this.steps, nextOut: this.nextOut, nextSync: this.nextSync, nextBreak: this.breakIdx,
      nEvents: this.events.length, controls: this.model.getControls(),
      terminated: this.model.terminated ? { ...this.model.terminated } : null,
    };
    if (this.integ) cp.integ = this.integ.snapshot();
    if (this.model.saveCheckpoint) cp.model = this.model.saveCheckpoint();
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

  /** One kernel step: integrate to the next breakpoint at most, then events and output. */
  private stepOnce(): void {
    this.applyPending();
    const t0 = this.t;
    const tBreak = this.breakIdx < this.breaks.length ? this.breaks[this.breakIdx] : Infinity;
    const tMax = Math.min(this.nextSync, this.nextOut, tBreak);
    this.t = this.integ ? this.integ.step(t0, this.y, tMax) : this.model.step!(t0, this.y, tMax);
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
  advance(simDt: number): { frames: HistoryFrame[]; events: SimEvent[] } {
    const startFrames = this.history.length, startEv = this.events.length;
    const tTarget = Math.min(this.t + simDt, this.model.tEnd);
    let guard = 0;
    while (this.t < tTarget - T_EPS && !this.model.terminated && guard++ < MAX_STEPS_PER_ADVANCE) this.stepOnce();
    this.flushEnd();
    this.applyPending();
    return { frames: this.history.slice(startFrames), events: this.events.slice(startEv) };
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
    const i = Math.max(0, Math.min(Math.floor(frameIndex), this.history.length - 1));
    const f = this.history[i];
    this.t = f.t;
    this.y = Float64Array.from(f.y);
    this.model.restoreInternal(f.internal);
    this.history = this.history.slice(0, i + 1);
    this.endFlushed = false;
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
    } else {
      // a frame without a checkpoint (recorded by an older version): best effort, as before v4
      this.events = this.events.filter((e) => e.t <= f.t);
      this.integ = this.makeIntegrator();
      this.nextOut = this.t + this.model.outputDt;
      this.nextSync = Math.min(this.t + this.syncDt, this.model.tEnd);
      this.breakIdx = this.breaks.findIndex((b) => b > this.t + T_EPS);
      if (this.breakIdx < 0) this.breakIdx = this.breaks.length;
    }
    this.log = this.log.filter((e) => e.step < this.steps);
    this.pendIdx = this.pending.findIndex((e) => e.step >= this.steps);
    if (this.pendIdx < 0) this.pendIdx = this.pending.length;
  }

  /**
   * Live intervention: the patch takes effect at the current step boundary (the next step uses
   * it) and is appended to the actuator log.
   */
  applyControl(patch: Record<string, number>): void {
    this.log.push({ t: this.t, step: this.steps, patch: { ...patch } });
    this.model.applyControl(patch);
  }
}
