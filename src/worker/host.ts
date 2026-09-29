/**
 * Simülasyon worker'ının mesaj işleyicisi (protokol v2), `self`'ten bağımsız:
 * sim.worker.ts bunu gerçek worker'a bağlar, testler doğrudan çağırır.
 * Oynatma döngüsü ~30 Hz; her tikte duvar-saati × hız kadar simülasyon zamanı ilerletilir.
 */
import { Simulation } from '../physics/simulation';
import { NonFiniteStateError, SimulationError } from '../physics/kernel/errors';
import { EquilibriumInitFailure } from '../physics/profiles/failures';
import { HistoryFrame, ShotReport, SimEvent, SimModel } from '../physics/types';
import { FromWorker, PROTOCOL_VERSION, SimMeta, ToWorker, simSecondsPerWallSecond, toUiFrame } from './protocol';

const TICK_MS = 33;
/** minimum wall time between two `progress` messages of a background full run */
const PROGRESS_MS = 100;

export interface SimHost {
  handle(msg: ToWorker): void;
  /** stop the playback loop (worker shutdown / tests) */
  dispose(): void;
}

export function makeMeta(model: SimModel): SimMeta {
  return {
    method: model.method, kind: model.kind, timeUnit: model.timeUnit, tEnd: model.tEnd,
    diagSpecs: model.diagSpecs, geometry: model.geometryInfo(), controls: model.getControls(),
  };
}

function checkVersion(v: number): void {
  if (v !== PROTOCOL_VERSION) throw new Error(`Worker protocol mismatch: page speaks v${v}, worker speaks v${PROTOCOL_VERSION}. Reload the page.`);
}

const CHECK_CONFIG = 'Check the configuration for empty or out-of-range values.';

/** a run that cannot go on for a reason the user can fix; reported without a stack trace */
class RunError extends Error {}

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

export function createSimHost(post: (m: FromWorker) => void): SimHost {
  let sim: Simulation | null = null;
  let meta: SimMeta | null = null;
  let playing = false;
  let speed = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWall = 0;
  /** id of the loaded run and the current timeline branch; echoed on every live message */
  let runId = 0;
  let branchId = 0;

  function stopLoop() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function postError(err: unknown, id?: number, branch?: number, stop = true) {
    if (stop) stopLoop();
    // RunError, the kernel's typed errors (kernel/errors.ts) and the 1.5D model's refusal of an impossible boundary
    // (EquilibriumInitFailure, e.g. a > R) are raised on purpose: their message is the whole story
    const msg = err instanceof RunError || err instanceof SimulationError || err instanceof EquilibriumInitFailure ? err.message
      : err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    post({ type: 'error', msg, id, branchId: branch });
  }

  /**
   * Advance the live simulation and post the new frames (and the report when it ends). If the state
   * turns non-finite, only the frames before that point are posted and the run stops with an error.
   */
  function advance(simDt: number): number {
    if (!sim) return 0;
    const t0 = performance.now();
    const startFrames = sim.history.length, startEvents = sim.events.length;
    let frames: HistoryFrame[], events: SimEvent[];
    let blewUp = false;
    try {
      ({ frames, events } = sim.advance(simDt));
    } catch (err) {
      // The Dormand–Prince integrator refuses a non-finite state: it throws and leaves the simulation
      // at its last good step. The frames recorded earlier in this call are finite and still posted.
      if (!(err instanceof NonFiniteStateError)) throw err;
      frames = sim.history.slice(startFrames);
      events = sim.events.slice(startEvents);
      blewUp = true;
    }
    const wallMs = performance.now() - t0;
    const bad = frames.findIndex((f) => !finiteFrame(f));
    if (blewUp || bad >= 0 || !Number.isFinite(sim.t)) {
      const good = bad >= 0 ? frames.slice(0, bad) : frames;
      const tLast = good.length ? good[good.length - 1].t : sim.history[startFrames - 1].t;
      if (good.length) {
        post({
          type: 'frames', id: runId, branchId, frames: good.map(toUiFrame), events: events.filter((e) => e.t <= tLast), t: tLast, done: false,
          dt: sim.dt, nSteps: sim.nSteps, controls: sim.model.getControls(), wallMs,
        });
      }
      postError(new RunError(`The simulation state became non-finite (NaN or Infinity) after t = ${+tLast.toPrecision(6)} ${meta?.timeUnit ?? ''}. ${CHECK_CONFIG}`), runId, branchId);
      return wallMs;
    }
    post({
      type: 'frames', id: runId, branchId, frames: frames.map(toUiFrame), events, t: sim.t, done: sim.done,
      dt: sim.dt, nSteps: sim.nSteps, controls: sim.model.getControls(), wallMs,
    });
    if (sim.done) {
      stopLoop();
      post({ type: 'done', id: runId, branchId, report: sim.report() });
    }
    return wallMs;
  }

  function startLoop() {
    if (!sim || sim.done || playing) return;
    playing = true;
    lastWall = performance.now();
    timer = setTimeout(tick, 0);
  }

  function tick() {
    timer = null;
    if (!sim || !meta || !playing) return;
    try {
      const now = performance.now();
      const wallDt = Math.min((now - lastWall) / 1000, 0.25); // sekme arka plana düşerse sıçrama olmasın
      lastWall = now;
      // simülasyon zamanı: duvar × hız × birim ölçeği; tek tikte en fazla atışın %5'i (UI akıcılığı)
      const simDt = Math.min(wallDt * speed * simSecondsPerWallSecond(meta), meta.tEnd / 20);
      const wallMs = advance(simDt);
      // hesap tik süresinden uzun sürdüyse bir sonraki tik hemen
      if (playing) timer = setTimeout(tick, Math.max(0, TICK_MS - wallMs));
    } catch (err) {
      postError(err, runId, branchId);
    }
  }

  function runAll(msg: Extract<ToWorker, { type: 'runAll' }>): void {
    checkVersion(msg.protocolVersion);
    const s = new Simulation(msg.cfg);
    let report: ShotReport;
    if (msg.progress) {
      // Same chunking as Simulation.runAll(), with throttled progress messages in between.
      let guard = 0, lastPost = -Infinity;
      while (!s.done && guard++ < 10000) {
        s.advance(s.model.tEnd / 100);
        const now = performance.now();
        if (now - lastPost >= PROGRESS_MS) { lastPost = now; post({ type: 'progress', id: msg.id, t: s.t, tEnd: s.model.tEnd, frames: s.history.length }); }
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

  function handle(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case 'init': {
          stopLoop();
          runId = msg.id;
          branchId = 0;
          sim = null; meta = null;
          checkVersion(msg.protocolVersion);
          if (msg.speed !== undefined) speed = msg.speed;
          const next = new Simulation(msg.cfg);
          checkStart(next);
          sim = next;
          meta = makeMeta(sim.model);
          post({ type: 'ready', protocolVersion: PROTOCOL_VERSION, id: runId, meta, frame: toUiFrame(sim.history[0]) });
          // model kurulumda bitmiş olabilir (ör. mıknatıs quench → atış iptal)
          if (sim.done) post({ type: 'done', id: runId, branchId, report: sim.report() });
          else if (msg.autoPlay) startLoop();
          break;
        }
        case 'play':
          speed = msg.speed;
          startLoop();
          break;
        case 'pause': stopLoop(); break;
        case 'setSpeed': speed = msg.speed; break;
        case 'step':
          if (sim && !sim.done) advance(msg.simDt);
          break;
        case 'rewind': {
          if (!sim) break;
          stopLoop();
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
            post({ type: 'done', id: runId, branchId, report: sim.report() });
          }
          break;
        }
        case 'control':
          if (sim) sim.applyControl(msg.patch);
          break;
        case 'runAll':
          runAll(msg);
          break;
      }
    } catch (err) {
      if (msg.type === 'runAll') postError(err, msg.id, undefined, false);
      else postError(err, msg.type === 'init' ? msg.id : runId, branchId);
    }
  }

  return { handle, dispose: stopLoop };
}
