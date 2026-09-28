/**
 * Live simulation state: a pure reducer over worker messages plus a controller that owns the worker.
 *
 * Incoming messages are queued and applied in order once per animation frame (one store update and
 * one React render per frame, however many messages arrived). Every live message carries the run id
 * and the timeline branch; messages from an earlier run or from a branch abandoned by a rewind are
 * dropped by the reducer, so a late frame can never reappear after a rewind or a restart.
 */
import { ReactorConfig } from '../../physics/types';
import { FromWorker, PROTOCOL_VERSION, ToWorker } from '../../worker/protocol';
import { createStore, Store } from './store';
import { RunAllProgress, RunAllResult, SimState } from './types';

/** The part of the Worker interface the controller uses (a real Worker or a test double). */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromWorker>) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
}
export type WorkerFactory = () => WorkerLike;
/** schedules one flush of the incoming-message queue */
export type FrameScheduler = (flush: () => void) => void;

export const initialSimState: SimState = {
  status: 'idle', cfg: null, meta: null, frames: [], events: [], t: 0, dt: 0, nSteps: 0, controls: {},
  report: null, error: null, speed: 1, wallMs: 0, runId: 0, branchId: 0, autoPlay: false,
};

/** upper bound on how long incoming messages may wait when animation frames are throttled */
const MAX_FLUSH_DELAY_MS = 100;

/**
 * Flush on the next animation frame. Browsers throttle or suspend rAF in hidden or occluded
 * windows, so a timer guarantees the flush within MAX_FLUSH_DELAY_MS; whichever fires first wins.
 */
export const scheduleFrame: FrameScheduler = (flush) => {
  let pending = true;
  const run = () => { if (pending) { pending = false; flush(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  setTimeout(run, MAX_FLUSH_DELAY_MS);
};

const current = (s: SimState, m: { id: number; branchId: number }) => m.id === s.runId && m.branchId === s.branchId;

/** Apply one worker message to the live state (pure). */
export function reduceSim(s: SimState, m: FromWorker): SimState {
  switch (m.type) {
    case 'ready':
      if (m.id !== s.runId) return s;
      if (m.protocolVersion !== PROTOCOL_VERSION) {
        return { ...s, status: 'error', error: `Worker protocol mismatch: worker v${m.protocolVersion}, page v${PROTOCOL_VERSION}. Reload the page.` };
      }
      return {
        ...s, status: s.autoPlay ? 'running' : 'ready', meta: m.meta, frames: [m.frame], events: [],
        t: m.frame.t, dt: 0, nSteps: 0, controls: m.meta.controls, report: null, error: null,
      };
    case 'frames':
      if (!current(s, m) || s.status === 'error') return s;
      return {
        ...s,
        frames: m.frames.length ? s.frames.concat(m.frames) : s.frames,
        events: m.events.length ? s.events.concat(m.events) : s.events,
        t: m.t, dt: m.dt, nSteps: m.nSteps, controls: m.controls, wallMs: m.wallMs,
        status: m.done ? 'done' : s.status === 'ready' || s.status === 'paused' ? s.status : 'running',
      };
    case 'rewound':
      if (!current(s, m)) return s;
      return {
        ...s, status: 'paused', t: m.t, controls: m.controls, report: null, error: null,
        frames: s.frames.slice(0, m.index + 1), events: s.events.filter((ev) => ev.t <= m.t + 1e-12),
      };
    case 'done':
      if (!current(s, m)) return s;
      return { ...s, status: 'done', report: m.report };
    case 'error':
      if ((m.id !== undefined && m.id !== s.runId) || (m.branchId !== undefined && m.branchId !== s.branchId)) return s;
      return { ...s, status: 'error', error: m.msg };
    default:
      return s;
  }
}

/** Archive key of a completed run branch, or null while the run is not complete. */
export function completedShotKey(s: SimState): string | null {
  return s.status === 'done' && s.report && s.meta && s.cfg ? `${s.runId}:${s.branchId}` : null;
}

export class SimController {
  readonly store: Store<SimState> = createStore<SimState>(initialSimState);
  private worker: WorkerLike | null = null;
  private queue: FromWorker[] = [];
  private scheduled = false;
  private lastRunId = 0;
  private lastRunAllId = 0;

  constructor(private readonly createWorker: WorkerFactory, private readonly schedule: FrameScheduler = scheduleFrame) {}

  /** create the live worker (idempotent) */
  attach(): void {
    if (this.worker) return;
    const w = this.createWorker();
    w.onmessage = (e) => this.receive(e.data);
    w.onerror = (e) => this.receive({ type: 'error', msg: e.message || 'Simulation worker failed' });
    this.worker = w;
  }

  /** terminate the live worker and drop undelivered messages */
  detach(): void {
    this.worker?.terminate();
    this.worker = null;
    this.queue = [];
  }

  private receive(m: FromWorker): void {
    this.queue.push(m);
    if (!this.scheduled) { this.scheduled = true; this.schedule(this.flush); }
  }

  /** apply all queued messages in one store update (normally called by the frame scheduler) */
  readonly flush = (): void => {
    this.scheduled = false;
    if (!this.queue.length) return;
    const q = this.queue;
    this.queue = [];
    let s = this.store.getState();
    for (const m of q) s = reduceSim(s, m);
    this.store.setState(s);
  };

  private send(m: ToWorker): void { this.worker?.postMessage(m); }
  private get state(): SimState { return this.store.getState(); }
  private patch(p: Partial<SimState>): void { this.store.setState({ ...this.state, ...p }); }

  /** load a configuration; with autoPlay the run starts as soon as the worker is ready */
  readonly load = (cfg: ReactorConfig, autoPlay = false): void => {
    const id = ++this.lastRunId;
    const { speed } = this.state;
    this.store.setState({ ...initialSimState, speed, cfg, status: 'loading', runId: id, autoPlay });
    this.send({ type: 'init', protocolVersion: PROTOCOL_VERSION, id, cfg, autoPlay, speed });
  };

  readonly play = (): void => {
    const s = this.state;
    if (s.status !== 'ready' && s.status !== 'paused') return;
    this.send({ type: 'play', speed: s.speed });
    this.patch({ status: 'running' });
  };

  readonly pause = (): void => {
    this.send({ type: 'pause' });
    if (this.state.status === 'running') this.patch({ status: 'paused' });
  };

  readonly setSpeed = (speed: number): void => {
    this.send({ type: 'setSpeed', speed });
    this.patch({ speed });
  };

  readonly step = (simDt: number): void => this.send({ type: 'step', simDt });

  /**
   * Rewind to history frame `index`; frames still in flight from the old branch are ignored from now on.
   * The report belongs to the abandoned branch and is cleared with it, so a completed run is never
   * re-archived under the new branch before that branch completes.
   */
  readonly rewind = (index: number): void => {
    const s = this.state;
    if (!s.meta) return;
    const branchId = s.branchId + 1;
    this.patch({ branchId, report: null });
    this.send({ type: 'rewind', index, branchId });
  };

  readonly control = (patch: Record<string, number>): void => {
    this.send({ type: 'control', patch });
    this.patch({ controls: { ...this.state.controls, ...patch } });
  };

  readonly restart = (): void => {
    const { cfg } = this.state;
    if (cfg) this.load(cfg);
  };

  /** Independent full run in a separate worker (does not touch the live run). */
  readonly runAll = (cfg: ReactorConfig, keepFrames = false, onProgress?: (p: RunAllProgress) => void): Promise<RunAllResult> =>
    new Promise((resolve, reject) => {
      const w = this.createWorker();
      const id = ++this.lastRunAllId;
      const fail = (msg: string) => { w.terminate(); reject(new Error(msg)); };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress' && m.id === id) onProgress?.({ t: m.t, tEnd: m.tEnd, frames: m.frames });
        else if (m.type === 'runAllDone' && m.id === id) {
          if (m.protocolVersion !== PROTOCOL_VERSION) return fail(`Worker protocol mismatch: worker v${m.protocolVersion}, page v${PROTOCOL_VERSION}`);
          w.terminate();
          resolve({ report: m.report, meta: m.meta, frames: m.frames, events: m.events });
        } else if (m.type === 'error') fail(m.msg);
      };
      w.onerror = (ev) => fail(ev.message || 'Simulation worker failed');
      w.postMessage({ type: 'runAll', protocolVersion: PROTOCOL_VERSION, id, cfg, keepFrames, progress: !!onProgress });
    });
}
