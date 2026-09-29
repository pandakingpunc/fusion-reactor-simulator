/**
 * A pool of simulation workers for batches of independent full runs (the validation tests, the preset scan, the
 * mission runs): a queue in front of up to `size` workers, each of which runs one `runAll` job at a time.
 *
 *  - Jobs start in the order they were submitted; a worker is created only when a job needs it, and is reused.
 *  - Every job can be cancelled through an AbortSignal (or pool.cancelAll()). A queued job just leaves the queue; a
 *    running one costs its worker: a synchronous `runAll` cannot be interrupted, so the worker is terminated
 *    and a fresh one is created for the next job.
 *  - A worker that crashes (onerror) fails only the job it was running and is replaced.
 *  - A job that has an `onProgress` callback gets the worker's throttled progress messages.
 *
 * The pool talks the protocol of src/worker/protocol.ts and works with any WorkerLike (the real module worker
 * in the browser, FakeWorker in tests). It has no React in it.
 */
import { ReactorConfig } from '../../physics/types';
import { FromWorker, PROTOCOL_VERSION } from '../../worker/protocol';
import { WorkerFactory, WorkerLike } from '../state/sim';
import { RunAllProgress, RunAllResult } from '../state/types';

export class AbortError extends Error {
  constructor(message = 'The run was cancelled') { super(message); this.name = 'AbortError'; }
}

export interface RunOptions {
  /** return the recorded frames and events as well (the mission screens draw from them) */
  keepFrames?: boolean;
  signal?: AbortSignal;
  /** simulated time reached so far (throttled by the worker) */
  onProgress?: (p: RunAllProgress) => void;
  /** the job left the queue and a worker took it */
  onStart?: () => void;
  /** give up on a job that has been on a worker this long [ms] */
  timeoutMs?: number;
}

export interface PoolStats {
  /** most workers the pool may use */
  size: number;
  /** workers alive right now */
  workers: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** workers replaced after a crash, a cancellation or a timeout */
  replaced: number;
}

interface Job {
  id: number;
  cfg: ReactorConfig;
  opts: RunOptions;
  resolve: (r: RunAllResult) => void;
  reject: (e: Error) => void;
  slot: Slot | null;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort: (() => void) | null;
}
interface Slot { worker: WorkerLike | null; job: Job | null }

/** workers to use by default: one fewer than the cores (the page itself needs one), at most four */
export function defaultPoolSize(): number {
  const n = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(4, n - 1));
}

export class RunPool {
  readonly size: number;
  private readonly slots: Slot[];
  private queue: Job[] = [];
  private nextId = 0;
  private counts = { completed: 0, failed: 0, cancelled: 0, replaced: 0 };

  constructor(private readonly createWorker: WorkerFactory, size: number = defaultPoolSize()) {
    this.size = Math.max(1, Math.floor(size));
    this.slots = Array.from({ length: this.size }, () => ({ worker: null, job: null }));
  }

  get stats(): PoolStats {
    return {
      size: this.size, workers: this.slots.filter((s) => s.worker).length, running: this.slots.filter((s) => s.job).length,
      queued: this.queue.length, ...this.counts,
    };
  }

  /** Queue a full run; resolves with the report (rejects with AbortError when cancelled, with Error otherwise). */
  run(cfg: ReactorConfig, opts: RunOptions = {}): Promise<RunAllResult> {
    return new Promise<RunAllResult>((resolve, reject) => {
      if (opts.signal?.aborted) { this.counts.cancelled++; reject(new AbortError()); return; }
      const job: Job = { id: ++this.nextId, cfg, opts, resolve, reject, slot: null, timer: null, onAbort: null };
      if (opts.signal) {
        job.onAbort = () => this.cancel(job);
        opts.signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Cancel every queued and running job. The pool stays usable. */
  cancelAll(): void {
    for (const job of [...this.queue]) this.cancel(job);
    for (const slot of this.slots) if (slot.job) this.cancel(slot.job);
  }

  /** Cancel everything and stop all workers (the pool creates new ones if it is used again). */
  dispose(): void {
    this.cancelAll();
    for (const slot of this.slots) this.dropWorker(slot, false);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────

  private pump(): void {
    for (const slot of this.slots) {
      if (!this.queue.length) return;
      if (!slot.job) this.start(slot, this.queue.shift()!);
    }
  }

  private start(slot: Slot, job: Job): void {
    try {
      if (!slot.worker) {
        const w = this.createWorker();
        w.onmessage = (ev) => this.onMessage(slot, ev.data);
        w.onerror = (ev) => this.onCrash(slot, ev.message);
        slot.worker = w;
      }
      slot.job = job; job.slot = slot;
      slot.worker.postMessage({ type: 'runAll', protocolVersion: PROTOCOL_VERSION, id: job.id, cfg: job.cfg, keepFrames: !!job.opts.keepFrames, progress: !!job.opts.onProgress });
    } catch (e) {
      this.finish(job, e instanceof Error ? e : new Error(String(e)));
      this.dropWorker(slot, true);
      this.pump();
      return;
    }
    if (job.opts.timeoutMs !== undefined) job.timer = setTimeout(() => this.timeOut(job), job.opts.timeoutMs);
    job.opts.onStart?.();
  }

  private onMessage(slot: Slot, m: FromWorker): void {
    const job = slot.job;
    if (!job) return;
    if (m.type === 'progress' && m.id === job.id) job.opts.onProgress?.({ t: m.t, tEnd: m.tEnd, frames: m.frames });
    else if (m.type === 'runAllDone' && m.id === job.id) {
      if (m.protocolVersion !== PROTOCOL_VERSION) {
        this.finish(job, new Error(`Worker protocol mismatch: worker v${m.protocolVersion}, page v${PROTOCOL_VERSION}`));
        this.dropWorker(slot, true);
      } else {
        this.finish(job, { report: m.report, meta: m.meta, frames: m.frames, events: m.events });
      }
      this.pump();
    } else if (m.type === 'error' && (m.id === undefined || m.id === job.id)) {
      // the worker survives an error in a run: only the job fails
      this.finish(job, new Error(m.msg));
      this.pump();
    }
  }

  private onCrash(slot: Slot, message: string): void {
    const job = slot.job;
    this.dropWorker(slot, true);
    if (job) this.finish(job, new Error(message || 'Simulation worker failed'));
    this.pump();
  }

  private timeOut(job: Job): void {
    const slot = job.slot;
    job.timer = null;
    if (!slot || slot.job !== job) return;
    this.dropWorker(slot, true);
    this.finish(job, new Error(`The run took longer than ${job.opts.timeoutMs} ms and was stopped`));
    this.pump();
  }

  private cancel(job: Job): void {
    const q = this.queue.indexOf(job);
    if (q >= 0) {
      this.queue.splice(q, 1);
      this.finish(job, new AbortError());
      return;
    }
    const slot = job.slot;
    if (!slot || slot.job !== job) return;
    this.dropWorker(slot, true);
    this.finish(job, new AbortError());
    this.pump();
  }

  /** settle a job: a result resolves it, an Error rejects it; the slot becomes free */
  private finish(job: Job, outcome: RunAllResult | Error): void {
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    if (job.onAbort) { job.opts.signal?.removeEventListener('abort', job.onAbort); job.onAbort = null; }
    if (job.slot && job.slot.job === job) job.slot.job = null;
    job.slot = null;
    if (outcome instanceof Error) {
      if (outcome instanceof AbortError) this.counts.cancelled++; else this.counts.failed++;
      job.reject(outcome);
    } else {
      this.counts.completed++;
      job.resolve(outcome);
    }
  }

  private dropWorker(slot: Slot, replaced: boolean): void {
    const w = slot.worker;
    if (!w) return;
    slot.worker = null;
    w.onmessage = null; w.onerror = null;
    try { w.terminate(); } catch { /* already gone */ }
    if (replaced) this.counts.replaced++;
  }
}
