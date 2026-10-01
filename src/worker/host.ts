/**
 * Simülasyon worker'ının mesaj işleyicisi (protokol v3), `self`'ten bağımsız:
 * sim.worker.ts bunu gerçek worker'a bağlar, testler doğrudan çağırır.
 * Oynatma döngüsü ~30 Hz; her tikte duvar-saati × hız kadar simülasyon zamanı ilerletilir.
 *
 * Time slicing (v4.0). The worker is one thread, so a `pause`, `control` or `rewind` message is handled only
 * when the task that is running ends. A playback tick used to advance the whole simulated time it owed in one
 * synchronous call (up to 5 % of the shot: 0.4-0.6 s for the 1.5D DEMO at 100x), and the page waited that long
 * for its pause. The loop now works off the owed simulated time one kernel step at a time and yields to the event
 * loop as soon as SLICE_MS of wall time has gone by (the step in progress always completes), so a request waits for
 * one slice plus one step. The kernel is chunk invariant (see simulation.ts), so slicing changes no result.
 * A single 1.5D step that includes a Grad-Shafranov update takes tens of milliseconds, so the loop also lets the
 * kernel stop inside a step (Simulation.advance `yieldWhen`, "Step atomicity and slicing" in simulation.ts): the step
 * stays suspended, invisible to the page, until the next slice continues it, and a request waits for one slice plus
 * one yield-to-yield stretch of it (about 5 ms) instead of the whole step. A control message settles the step in
 * progress first and posts what it completes, so that the page's history and the run's stay the same.
 */
import { Simulation } from '../physics/simulation';
import { NonFiniteStateError, ScenarioError, SimulationError } from '../physics/kernel/errors';
import type { ScenarioSpec } from '../physics/scenario';
import { EquilibriumInitFailure } from '../physics/profiles/failures';
import { HistoryFrame, ReactorConfig, ShotReport, SimEvent, SimModel } from '../physics/types';
import { FromWorker, PROTOCOL_VERSION, RunProvenanceMsg, SimMeta, ToWorker, isSupportedProtocol, simSecondsPerWallSecond, toUiFrame } from './protocol';
import { defaultSchedule } from './schedule';
import { APP_VERSION } from '../ui/persist/version';

export { defaultSchedule };

const TICK_MS = 33;
/** wall time after which the playback loop yields to the event loop (see the file header) */
export const SLICE_MS = 5;
/** minimum wall time between two `progress` messages of a background full run */
const PROGRESS_MS = 100;
/** the kernel takes a step only while t < target - T_EPS (Simulation, T_EPS) */
const T_EPS = 1e-12;
/** kernel call size that takes exactly one step: a fraction of the shot, but above the kernel's own tolerance */
const ONE_STEP = 1e-9;

export interface SimHost {
  handle(msg: ToWorker): void;
  /** stop the playback loop (worker shutdown / tests) */
  dispose(): void;
}

export interface SimHostOptions {
  /** wall-clock budget of one playback slice [ms] (default SLICE_MS) */
  sliceMs?: number;
  /** clock [ms] (default performance.now); tests inject a fake one */
  now?: () => number;
  /** run `fn` after `delayMs` and return a canceller; tests inject a manual scheduler (default: defaultSchedule) */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

export function makeMeta(model: SimModel): SimMeta {
  return {
    method: model.method, kind: model.kind, timeUnit: model.timeUnit, tEnd: model.tEnd,
    diagSpecs: model.diagSpecs, geometry: model.geometryInfo(), controls: model.getControls(),
  };
}

function checkVersion(v: number): void {
  if (!isSupportedProtocol(v)) throw new Error(`Worker protocol mismatch: page speaks v${v}, worker speaks v${PROTOCOL_VERSION}. Reload the page.`);
}

const CHECK_CONFIG = 'Check the configuration for empty or out-of-range values.';

/** a run that cannot go on for a reason the user can fix; reported without a stack trace */
class RunError extends Error {}

/** A ScenarioError as the user reads it: every problem with its path (the error's own message names the first three). */
export function scenarioErrorText(err: ScenarioError): string {
  const shown = err.issues.slice(0, 12).map((i) => `  ${i.path ? `${i.path}: ` : ''}${i.message}`);
  const more = err.issues.length > shown.length ? [`  ... and ${err.issues.length - shown.length} more`] : [];
  return `Invalid scenario (${err.issues.length} problem${err.issues.length === 1 ? '' : 's'}):\n${[...shown, ...more].join('\n')}`;
}

/** The provenance of a run as it stands: its live interventions, breakpoints, scenario and fingerprint. */
export function provenanceOf(sim: Simulation): RunProvenanceMsg {
  const actuatorLog = sim.actuatorLog, breakpoints = sim.breakpoints, scenario = sim.scenario;
  return {
    interventions: actuatorLog.length, actuatorLog, ...(breakpoints.length ? { breakpoints } : {}), ...(scenario ? { scenario } : {}),
    fingerprint: sim.fingerprint(APP_VERSION), appVersion: APP_VERSION,
  };
}

/** A Simulation of the configuration, with the scenario when there is one (ScenarioError when it does not fit). */
function newSimulation(cfg: ReactorConfig, scenario: ScenarioSpec | undefined): Simulation {
  return new Simulation(cfg, scenario ? { scenario } : {});
}

/** time and state vector are finite (diagnostics may legitimately be NaN or ±Infinity, e.g. Q with no heating) */
function finiteFrame(f: HistoryFrame): boolean {
  return Number.isFinite(f.t) && f.y.every(Number.isFinite);
}

/**
 * Refuse a configuration that cannot be integrated: the shot duration must be a positive number and the
 * initial state finite. A missing required parameter (undefined → NaN) otherwise gives a run whose
 * clock never advances, or a NaN state that the drawing code cannot handle.
 */
function checkStart(sim: Simulation): void {
  const tEnd = sim.model.tEnd;
  if (!(Number.isFinite(tEnd) && tEnd > 0)) throw new RunError(`Invalid shot duration (t_end = ${tEnd}). ${CHECK_CONFIG}`);
  if (!finiteFrame(sim.history[0])) throw new RunError(`The initial plasma state is not finite (NaN or Infinity). ${CHECK_CONFIG}`);
}

export function createSimHost(post: (m: FromWorker) => void, opts: SimHostOptions = {}): SimHost {
  const sliceMs = opts.sliceMs ?? SLICE_MS;
  const now = opts.now ?? (() => performance.now());
  const schedule = opts.schedule ?? defaultSchedule;
  let sim: Simulation | null = null;
  let meta: SimMeta | null = null;
  let playing = false;
  let speed = 1;
  /** cancels the tick that is scheduled, if any */
  let cancelTick: (() => void) | null = null;
  let lastWall = 0;
  /** simulated time the playback still has to advance (wall time × speed, less what was advanced); a step that overshoots it is not carried over, as before slicing */
  let owed = 0;
  /** wall time of the last `frames` message */
  let lastLivePost = 0;
  /** frames and events computed by slices of the playback loop and not yet posted (one message per tick, not per slice) */
  let pending: { frames: HistoryFrame[]; events: SimEvent[]; wallMs: number } = { frames: [], events: [], wallMs: 0 };
  /** id of the loaded run and the current timeline branch; echoed on every live message */
  let runId = 0;
  let branchId = 0;
  /** the run has a scenario or has received a live intervention: its `frames` messages carry the control values of their frames */
  let ctlOn = false;

  function stopLoop() {
    playing = false;
    if (cancelTick) { cancelTick(); cancelTick = null; }
  }

  function postError(err: unknown, id?: number, branch?: number, stop = true) {
    if (stop) stopLoop();
    // RunError, the kernel's typed errors (kernel/errors.ts) and the 1.5D model's refusal of an impossible boundary
    // (EquilibriumInitFailure, e.g. a > R) are raised on purpose: their message is the whole story
    const msg = err instanceof ScenarioError ? scenarioErrorText(err) : err instanceof RunError || err instanceof SimulationError || err instanceof EquilibriumInitFailure ? err.message
      : err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    post({ type: 'error', msg, id, branchId: branch });
  }

  /** the control values in force at each frame (the checkpoint of the frame holds them), as rows over the model's control keys (those of meta.controls) */
  function controlRows(frames: readonly HistoryFrame[]): number[][] {
    const keys = Object.keys(meta!.controls);
    return frames.map((f) => keys.map((k) => f.sim!.controls[k]));
  }

  /** post a `frames` message and start the tick clock over */
  function postFrames(frames: HistoryFrame[], events: SimEvent[], t: number, done: boolean, wallMs: number) {
    lastLivePost = now();
    post({
      type: 'frames', id: runId, branchId, frames: frames.map(toUiFrame), events, t, done,
      dt: sim!.dt, nSteps: sim!.nSteps, controls: sim!.model.getControls(), wallMs,
      ...(ctlOn && frames.length ? { ctl: controlRows(frames) } : {}),
    });
  }

  /** the end of the current branch: its report and what defines the run (so that a run with interventions can be signed) */
  function postDone() {
    post({ type: 'done', id: runId, branchId, report: sim!.report(), provenance: provenanceOf(sim!) });
  }

  /** post what the playback slices have computed since the last message (the run's history and the page's must not differ) */
  function flushPending(force = false) {
    const p = pending;
    if (!sim || !(force || p.frames.length || p.events.length)) return;
    pending = { frames: [], events: [], wallMs: 0 };
    postFrames(p.frames, p.events, sim.t, sim.done, p.wallMs);
  }

  /**
   * Advance the live simulation by `simDt` and post the new frames (and the report when it ends). If the state
   * turns non-finite, only the frames before that point are posted and the run stops with an error.
   * Without a budget the kernel takes all the steps in one call and the frames are posted at once. With `budgetMs`
   * (the playback loop) it takes them one at a time and stops when that much wall time has gone by (after at least
   * one step), possibly short of `simDt`; the frames are held back until a tick has passed since the last message
   * (or the run ends, is paused or fails), so a busy loop posts about 30 messages a second, as it did before
   * slicing. Returns the wall time used and the simulated time advanced.
   */
  function advance(simDt: number, budgetMs = Infinity): { wallMs: number; advanced: number } {
    if (!sim) return { wallMs: 0, advanced: 0 };
    const t0 = now();
    const tStart = sim.t;
    const startFrames = sim.history.length, startEvents = sim.events.length;
    let frames: HistoryFrame[], events: SimEvent[];
    let blewUp = false;
    try {
      if (budgetMs === Infinity) {
        ({ frames, events } = sim.advance(simDt));
      } else {
        const tTarget = Math.min(tStart + simDt, sim.model.tEnd);
        const oneStep = Math.max(ONE_STEP * sim.model.tEnd, 4 * T_EPS);
        const yieldWhen = () => now() - t0 >= budgetMs;
        while (!sim.done && sim.t < tTarget - T_EPS) {
          const before = sim.t;
          sim.advance(oneStep, { yieldWhen });
          // no progress: a step that goes nowhere ends the shot (sim.done), or the kernel stopped inside a step (sim.stepInProgress)
          if (!(sim.t > before) || yieldWhen()) break;
        }
        frames = sim.history.slice(startFrames);
        events = sim.events.slice(startEvents);
      }
    } catch (err) {
      // The Dormand–Prince integrator refuses a non-finite state: it throws and leaves the simulation
      // at its last good step. The frames recorded earlier in this call are finite and still posted.
      if (!(err instanceof NonFiniteStateError)) throw err;
      frames = sim.history.slice(startFrames);
      events = sim.events.slice(startEvents);
      blewUp = true;
    }
    const wallMs = now() - t0;
    const advanced = sim.t - tStart;
    const bad = frames.findIndex((f) => !finiteFrame(f));
    if (blewUp || bad >= 0 || !Number.isFinite(sim.t)) {
      const good = bad >= 0 ? frames.slice(0, bad) : frames;
      const tLast = good.length ? good[good.length - 1].t : sim.history[startFrames - 1].t;
      const p = pending;
      pending = { frames: [], events: [], wallMs: 0 };
      if (p.frames.length || good.length) postFrames(p.frames.concat(good), p.events.concat(events.filter((e) => e.t <= tLast)), tLast, false, p.wallMs + wallMs);
      postError(new RunError(`The simulation state became non-finite (NaN or Infinity) after t = ${+tLast.toPrecision(6)} ${meta?.timeUnit ?? ''}. ${CHECK_CONFIG}`), runId, branchId);
      return { wallMs, advanced };
    }
    // concat, not push(...): a step message can bring thousands of frames, more than an argument list should carry
    pending.frames = pending.frames.concat(frames);
    pending.events = pending.events.concat(events);
    pending.wallMs += wallMs;
    if (budgetMs === Infinity || sim.done || now() - lastLivePost >= TICK_MS) flushPending(true);
    if (sim.done) {
      stopLoop();
      postDone();
    }
    return { wallMs, advanced };
  }

  /** run the next tick after `delayMs` (0: as soon as the messages already queued have been handled) */
  function later(delayMs: number) {
    cancelTick = schedule(tick, delayMs);
  }

  function startLoop() {
    if (!sim || sim.done || playing) return;
    playing = true;
    lastWall = now();
    owed = 0;
    later(0);
  }

  function tick() {
    cancelTick = null;
    if (!sim || !meta || !playing) return;
    try {
      const t0 = now();
      const wallDt = Math.min((t0 - lastWall) / 1000, 0.25); // sekme arka plana düşerse sıçrama olmasın
      lastWall = t0;
      // simülasyon zamanı: duvar × hız × birim ölçeği; en fazla atışın %5'i birikir (UI akıcılığı)
      owed = Math.min(owed + wallDt * speed * simSecondsPerWallSecond(meta), meta.tEnd / 20);
      owed = Math.max(0, owed - advance(owed, sliceMs).advanced);
      if (!playing) return; // the run ended or failed
      // still owed (compute slower than real time, or a slice cut short): next slice right after the queued messages, else at the next tick
      later(owed > 0 ? 0 : Math.max(0, TICK_MS - (now() - t0)));
    } catch (err) {
      postError(err, runId, branchId);
    }
  }

  function runAll(msg: Extract<ToWorker, { type: 'runAll' }>): void {
    checkVersion(msg.protocolVersion);
    const s = newSimulation(msg.cfg, msg.scenario);
    let report: ShotReport;
    if (msg.progress) {
      // Same chunking as Simulation.runAll(), with throttled progress messages in between.
      let guard = 0, lastProgress = -Infinity;
      while (!s.done && guard++ < 10000) {
        s.advance(s.model.tEnd / 100);
        const wall = now();
        if (wall - lastProgress >= PROGRESS_MS) { lastProgress = wall; post({ type: 'progress', id: msg.id, t: s.t, tEnd: s.model.tEnd, frames: s.history.length }); }
      }
      report = s.report();
    } else {
      report = s.runAll();
    }
    post({
      type: 'runAllDone', protocolVersion: PROTOCOL_VERSION, id: msg.id, report, meta: makeMeta(s.model),
      frames: msg.keepFrames ? s.history.map(toUiFrame) : undefined, events: msg.keepFrames ? s.events : undefined,
    });
  }

  /** the model of a configuration without a run (the scenario editor's view of what can be driven) */
  function probe(msg: Extract<ToWorker, { type: 'probe' }>): void {
    checkVersion(msg.protocolVersion);
    post({ type: 'probed', protocolVersion: PROTOCOL_VERSION, id: msg.id, meta: makeMeta(newSimulation(msg.cfg, msg.scenario).model) });
  }

  function handle(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case 'init': {
          stopLoop();
          runId = msg.id;
          branchId = 0;
          sim = null; meta = null; ctlOn = false;
          pending = { frames: [], events: [], wallMs: 0 };
          checkVersion(msg.protocolVersion);
          if (msg.speed !== undefined) speed = msg.speed;
          const next = newSimulation(msg.cfg, msg.scenario);
          checkStart(next);
          sim = next;
          ctlOn = next.scenario !== null;
          meta = makeMeta(sim.model);
          post({ type: 'ready', protocolVersion: PROTOCOL_VERSION, id: runId, meta, frame: toUiFrame(sim.history[0]) });
          // model kurulumda bitmiş olabilir (ör. mıknatıs quench → atış iptal)
          if (sim.done) postDone();
          else if (msg.autoPlay) startLoop();
          break;
        }
        case 'play':
          speed = msg.speed;
          startLoop();
          break;
        case 'pause': stopLoop(); flushPending(); break;
        case 'setSpeed': speed = msg.speed; break;
        case 'step':
          if (sim && !sim.done) advance(msg.simDt); // one explicit call, not sliced
          break;
        case 'rewind': {
          if (!sim) break;
          stopLoop();
          pending = { frames: [], events: [], wallMs: 0 }; // they lie after the frame we go back to
          branchId = msg.branchId;
          const index = Math.max(0, Math.min(msg.index, sim.history.length - 1));
          sim.rewindTo(index);
          post({ type: 'rewound', id: runId, branchId, index, t: sim.t, nEvents: sim.events.length, controls: sim.model.getControls() });
          // Rewinding to the final frame of a finished shot leaves nothing to simulate: the new branch is
          // complete at once (otherwise play/step would do nothing and the page would wait forever).
          // rewindTo() restores the shot's termination from the frame's checkpoint; a zero-length advance
          // redoes the kernel's end-of-run postStep for a model that leaves its termination to that call,
          // so the report is the one of the uninterrupted run.
          if (sim.done) {
            sim.advance(0);
            postDone();
          }
          break;
        }
        case 'control':
          if (sim) {
            if (sim.stepInProgress) advance(0); // settles it and posts its frames before the patch
            sim.applyControl(msg.patch);
            ctlOn = true;
          }
          break;
        case 'getLog':
          if (sim) post({ type: 'log', id: runId, branchId, token: msg.token, provenance: provenanceOf(sim) });
          break;
        case 'probe':
          probe(msg);
          break;
        case 'runAll':
          runAll(msg);
          break;
      }
    } catch (err) {
      if (msg.type === 'runAll' || msg.type === 'probe') postError(err, msg.id, undefined, false);
      else postError(err, msg.type === 'init' ? msg.id : runId, branchId);
    }
  }

  return { handle, dispose: stopLoop };
}
