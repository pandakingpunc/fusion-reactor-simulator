/// <reference types="node" />
/**
 * Çok çekirdekli iş havuzu (Node worker_threads). Her işçi görevleri sırayla işler; sonuçlar
 * görev sırasıyla döner. tsx altında işçiler ana sürecin execArgv'sini (TS yükleyicisi) miras alır.
 *
 * Worker contract: a worker answers every task it receives with exactly one message (the result).
 *
 * Two call forms, both returning the results in task order:
 *   runPool(tasks, workerUrl, threads?, onResult?)   — the v3 form, fail-fast
 *   runPool(tasks, workerUrl, options)                — adds per-task timeouts, cancellation through an
 *                                                        AbortSignal, progress reports and crash recovery
 *
 * Failure handling: an invalid thread count or timeout throws {@link PoolConfigError} before any worker
 * is started. A task fails when it cannot be sent to a worker (e.g. it holds a function, which
 * structured clone rejects), when its worker raises an uncaught error, sends an unreadable message or
 * exits while it owns the task (whatever the exit code), or when it exceeds its timeout (the worker is
 * terminated). By default the pool then rejects with a {@link PoolTaskError} naming that task (index
 * and, when the task has a string `id`, its id) and terminates the remaining workers — it never hangs.
 * With `options.onTaskError` the failure is turned into that task's result instead: a crashed, hung or
 * broken worker is replaced by a fresh one and the remaining tasks continue.
 *
 * Cancellation: aborting `options.signal`, or SIGINT/SIGTERM while the pool runs (unless
 * `handleSignals: false`), terminates every worker and rejects with a {@link PoolAbortError}. The
 * signal listeners are removed when the pool settles; a CLI maps the error to exit code 130.
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export function defaultThreads(): number {
  return Math.max(1, availableParallelism() - 1);
}

/** Invalid pool configuration (e.g. a thread count that is not a finite integer ≥ 1). CLIs map it to exit code 2. */
export class PoolConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolConfigError';
  }
}

/** A task could not be completed: it could not be sent, its worker crashed, exited or sent an unreadable message, or it timed out. */
export class PoolTaskError extends Error {
  /** true when the task exceeded its timeout and its worker was terminated */
  readonly timedOut: boolean;
  constructor(
    message: string,
    /** index of the failed task in the `tasks` array */
    readonly taskIndex: number,
    /** the task's `id` if it has a string one */
    readonly taskId: string | undefined,
    /** worker exit code, when the worker exited */
    readonly exitCode?: number,
    options?: { cause?: unknown; timedOut?: boolean },
  ) {
    super(message, options);
    this.name = 'PoolTaskError';
    this.timedOut = options?.timedOut ?? false;
  }
}

/** The pool was cancelled before all tasks finished; every worker was terminated. CLIs map it to exit code 130. */
export class PoolAbortError extends Error {
  constructor(
    message: string,
    /** 'signal' for an aborted AbortSignal (its reason is the `cause`), otherwise the process signal */
    readonly reason: 'signal' | 'SIGINT' | 'SIGTERM',
    /** tasks that had finished (or failed and were mapped) when the pool was cancelled */
    readonly completed: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PoolAbortError';
  }
}

/** Reported through {@link PoolOptions.onProgress} each time a task settles. */
export interface PoolProgress {
  /** tasks settled so far, successful or failed */
  done: number;
  total: number;
  /** failed tasks so far (only non-zero with `onTaskError`) */
  failed: number;
  /** the task that just settled */
  index: number;
  id: string | undefined;
  ok: boolean;
  /** wall time of that task [ms] */
  ms: number;
  /** workers started to replace a crashed, hung or broken one so far */
  respawns: number;
}

export interface PoolOptions<T, R> {
  /** worker threads, a finite integer ≥ 1 (default {@link defaultThreads}); never more than the number of tasks */
  threads?: number;
  /** called with every result in completion order, including results produced by `onTaskError` */
  onResult?: (result: R, index: number) => void;
  /** called after every settled task, after `onResult` */
  onProgress?: (progress: PoolProgress) => void;
  /**
   * Wall-clock limit per task [ms], measured from the moment the task is sent to its worker. A number
   * applies to every task; a function chooses per task. `undefined`, 0 and Infinity mean no limit.
   * A task over its limit fails with `timedOut: true` and its worker is terminated.
   */
  timeoutMs?: number | ((task: T, index: number) => number | undefined);
  /** aborting it terminates every worker and rejects with {@link PoolAbortError} */
  signal?: AbortSignal;
  /**
   * Turns a task failure into that task's result. Without it (the default) the first failure rejects
   * the pool. With it, a worker that crashed, exited, hung or failed to load is replaced by a fresh
   * one and the remaining tasks continue. If it throws, the pool rejects with that error.
   */
  onTaskError?: (error: PoolTaskError, task: T, index: number) => R;
  /** cancel on SIGINT/SIGTERM while the pool runs (default true) */
  handleSignals?: boolean;
}

/** Validates a thread count; throws {@link PoolConfigError} unless it is a finite integer ≥ 1. */
export function checkThreads(threads: unknown): number {
  if (typeof threads !== 'number' || !Number.isInteger(threads) || threads < 1) {
    throw new PoolConfigError(`threads must be a finite integer >= 1, got ${typeof threads === 'number' ? threads : JSON.stringify(threads)}`);
  }
  return threads;
}

/** Validates a timeout; undefined, 0 and Infinity mean "no limit" (→ undefined). */
function checkTimeout(ms: unknown, what: string): number | undefined {
  if (ms === undefined || ms === 0 || ms === Infinity) return undefined;
  if (typeof ms !== 'number' || !(ms > 0) || !Number.isFinite(ms)) {
    throw new PoolConfigError(`${what} must be a positive number of milliseconds, 0 or Infinity, got ${typeof ms === 'number' ? ms : JSON.stringify(ms)}`);
  }
  return ms;
}

function describeTask(task: unknown, index: number): { label: string; id: string | undefined } {
  const id = typeof task === 'object' && task !== null && typeof (task as { id?: unknown }).id === 'string' ? (task as { id: string }).id : undefined;
  return { label: id !== undefined ? `task #${index} (${id})` : `task #${index}`, id };
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One worker slot: the live worker and the task it owns (-1 when idle). */
interface Slot {
  worker: Worker;
  current: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function runPool<T, R>(tasks: readonly T[], workerUrl: URL, threads?: number, onResult?: (r: R, i: number) => void): Promise<R[]>;
export function runPool<T, R>(tasks: readonly T[], workerUrl: URL, options: PoolOptions<T, R>): Promise<R[]>;
export async function runPool<T, R>(
  tasks: readonly T[], workerUrl: URL, threadsOrOptions?: number | PoolOptions<T, R>, onResultArg?: (r: R, i: number) => void,
): Promise<R[]> {
  const opts: PoolOptions<T, R> = typeof threadsOrOptions === 'object' && threadsOrOptions !== null
    ? threadsOrOptions
    : { threads: threadsOrOptions, onResult: onResultArg };
  const threads = checkThreads(opts.threads === undefined ? defaultThreads() : opts.threads);
  const fixedTimeout = typeof opts.timeoutMs === 'function' ? undefined : checkTimeout(opts.timeoutMs, 'timeoutMs');
  const timeoutFor = (task: T, i: number): number | undefined =>
    typeof opts.timeoutMs === 'function' ? checkTimeout(opts.timeoutMs(task, i), `timeoutMs(task #${i})`) : fixedTimeout;
  const { onResult, onProgress, onTaskError, signal } = opts;
  const total = tasks.length;
  const results: R[] = new Array(total);
  if (signal?.aborted) {
    throw new PoolAbortError('worker pool: cancelled before it started', 'signal', 0, { cause: signal.reason });
  }
  if (total === 0) return results;

  return new Promise<R[]>((resolve, reject) => {
    const slots: Slot[] = [];
    let next = 0, done = 0, failed = 0, respawns = 0;
    let settled = false;

    const onAbort = () => fail(new PoolAbortError(
      `worker pool: cancelled after ${done} of ${total} tasks (${message(signal?.reason ?? 'aborted')})`, 'signal', done, { cause: signal?.reason }));
    const onSigint = () => fail(new PoolAbortError(`worker pool: interrupted by SIGINT after ${done} of ${total} tasks; workers terminated`, 'SIGINT', done));
    const onSigterm = () => fail(new PoolAbortError(`worker pool: terminated by SIGTERM after ${done} of ${total} tasks; workers terminated`, 'SIGTERM', done));
    signal?.addEventListener('abort', onAbort, { once: true });
    const handleSignals = opts.handleSignals ?? true;
    if (handleSignals) { process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm); }

    function cleanup(): void {
      signal?.removeEventListener('abort', onAbort);
      if (handleSignals) { process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm); }
      for (const s of slots) {
        if (s.timer) clearTimeout(s.timer);
        void s.worker.terminate();
      }
    }
    function finish(): void {
      if (settled) return;
      settled = true; cleanup(); resolve(results);
    }
    function fail(e: Error): void {
      if (settled) return;
      settled = true; cleanup(); reject(e);
    }

    /** stores a settled task's result and reports it; false if the pool settled meanwhile (a callback threw or cancelled it) */
    function settleTask(slot: Slot, i: number, r: R, ok: boolean): boolean {
      results[i] = r;
      done++;
      if (!ok) failed++;
      const ms = performance.now() - slot.started;
      try {
        onResult?.(r, i);
        if (!settled) onProgress?.({ done, total, failed, index: i, id: describeTask(tasks[i], i).id, ok, ms, respawns });
      } catch (e) {
        fail(asError(e));
      }
      return !settled;
    }

    /** maps a failure through onTaskError; false if there is none, it threw, or a callback threw */
    function recover(slot: Slot, err: PoolTaskError): boolean {
      if (!onTaskError) { fail(err); return false; }
      let mapped: R;
      try {
        mapped = onTaskError(err, tasks[err.taskIndex], err.taskIndex);
      } catch (e) {
        fail(asError(e));
        return false;
      }
      return settleTask(slot, err.taskIndex, mapped, false);
    }

    /** sends the next task to this slot's worker; unsendable tasks are failed (or mapped) in a loop */
    function feed(slot: Slot): void {
      while (!settled) {
        if (next >= total) { slot.current = -1; return; }
        const i = next++;
        slot.current = i;
        slot.started = performance.now();
        let limit: number | undefined;
        try {
          limit = timeoutFor(tasks[i], i);
          slot.worker.postMessage(tasks[i]);
        } catch (e) {
          slot.current = -1;
          if (e instanceof PoolConfigError) { fail(e); return; }
          // e.g. a DataCloneError for a task holding a function; the worker itself is fine
          const { label, id } = describeTask(tasks[i], i);
          const err = new PoolTaskError(`worker pool: could not send ${label} to a worker (${message(e)})`, i, id, undefined, { cause: e });
          if (!recover(slot, err)) return;
          if (done === total) { finish(); return; }
          continue;
        }
        if (limit !== undefined) {
          const w = slot.worker;
          slot.timer = setTimeout(() => {
            slot.timer = undefined;
            if (slot.worker === w && slot.current === i) taskFailure(slot, w, `task timed out after ${limit} ms`, undefined, undefined, true);
          }, limit);
        }
        return;
      }
    }

    /**
     * Fails the task a worker owns. An idle worker owns none: it is only idle once every task has been
     * dispatched, so the others finish the run and the failure is ignored. Events of a worker that was
     * already replaced are ignored too.
     */
    function taskFailure(slot: Slot, w: Worker, what: string, exitCode?: number, cause?: unknown, timedOut = false): void {
      if (settled || slot.worker !== w || slot.current < 0) return;
      const i = slot.current;
      slot.current = -1;
      if (slot.timer) { clearTimeout(slot.timer); slot.timer = undefined; }
      const { label, id } = describeTask(tasks[i], i);
      const err = new PoolTaskError(`worker pool: ${what} while running ${label}`, i, id, exitCode, { cause, timedOut });
      if (!onTaskError) { fail(err); return; }
      void w.terminate(); // it crashed, hung or is about to exit; never reuse it
      if (!recover(slot, err)) return;
      if (done === total) { finish(); return; }
      if (next < total) {
        respawns++;
        if (start(slot)) feed(slot);
      }
    }

    /** starts a worker in `slot` (a new slot if omitted); false if the Worker constructor threw */
    function start(slot?: Slot): Slot | undefined {
      let w: Worker;
      try {
        w = new Worker(workerUrl);
      } catch (e) {
        fail(asError(e));
        return undefined;
      }
      const s: Slot = slot ?? { worker: w, current: -1, started: 0, timer: undefined };
      s.worker = w;
      s.current = -1;
      if (!slot) slots.push(s);
      w.on('message', (r: R) => {
        if (settled || s.worker !== w) return;
        const i = s.current;
        if (i < 0) return; // unsolicited message — ignore
        s.current = -1;
        if (s.timer) { clearTimeout(s.timer); s.timer = undefined; }
        if (!settleTask(s, i, r, true)) return;
        if (done === total) finish(); else feed(s);
      });
      w.on('error', (e) => {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        taskFailure(s, w, `uncaught worker error (${msg})`, undefined, e);
      });
      w.on('messageerror', (e) => taskFailure(s, w, `unreadable message from worker (${message(e)})`, undefined, e));
      w.on('exit', (code) => taskFailure(s, w, `worker exited with code ${code}`, code));
      return s;
    }

    const n = Math.min(threads, total);
    for (let k = 0; k < n && !settled; k++) {
      const s = start();
      if (!s) return;
      feed(s);
    }
  });
}
