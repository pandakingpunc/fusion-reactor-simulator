/// <reference types="node" />
/**
 * Çok çekirdekli iş havuzu (Node worker_threads). Her işçi görevleri sırayla işler; sonuçlar
 * görev sırasıyla döner. tsx altında işçiler ana sürecin execArgv'sini (TS yükleyicisi) miras alır.
 *
 * Failure handling: an invalid thread count throws {@link PoolConfigError} before any worker is
 * started. If a worker raises an uncaught error, fails to deserialize a message, or exits while it
 * still owns a task (whatever the exit code), the pool rejects with a {@link PoolTaskError} naming that task (index and,
 * when the task has a string `id`, its id) and terminates the remaining workers — it never hangs.
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

/** A task could not be completed because its worker crashed, exited or sent an unreadable message. */
export class PoolTaskError extends Error {
  constructor(
    message: string,
    /** index of the failed task in the `tasks` array */
    readonly taskIndex: number,
    /** the task's `id` if it has a string one */
    readonly taskId: string | undefined,
    /** worker exit code, when the worker exited */
    readonly exitCode?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PoolTaskError';
  }
}

/** Validates a thread count; throws {@link PoolConfigError} unless it is a finite integer ≥ 1. */
export function checkThreads(threads: unknown): number {
  if (typeof threads !== 'number' || !Number.isInteger(threads) || threads < 1) {
    throw new PoolConfigError(`threads must be a finite integer >= 1, got ${typeof threads === 'number' ? threads : JSON.stringify(threads)}`);
  }
  return threads;
}

function describeTask(task: unknown, index: number): { label: string; id: string | undefined } {
  const id = typeof task === 'object' && task !== null && typeof (task as { id?: unknown }).id === 'string' ? (task as { id: string }).id : undefined;
  return { label: id !== undefined ? `task #${index} (${id})` : `task #${index}`, id };
}

export async function runPool<T, R>(tasks: T[], workerUrl: URL, threads = defaultThreads(), onResult?: (r: R, i: number) => void): Promise<R[]> {
  checkThreads(threads);
  const results: R[] = new Array(tasks.length);
  let next = 0, done = 0;
  const n = Math.min(threads, tasks.length);
  if (n === 0) return results;
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    let settled = false;
    const stopAll = () => { for (const w of workers) void w.terminate(); };
    const finish = () => { if (settled) return; settled = true; stopAll(); resolve(results); };
    const fail = (e: Error) => { if (settled) return; settled = true; stopAll(); reject(e); };
    for (let k = 0; k < n && !settled; k++) {
      let w: Worker;
      try {
        w = new Worker(workerUrl);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      workers.push(w);
      let current = -1;
      const feed = () => {
        if (settled) return;
        if (next >= tasks.length) { current = -1; return; }
        current = next++;
        w.postMessage(tasks[current]);
      };
      /** fails the pool on behalf of the task this worker owns; an idle worker owns none and is ignored */
      const taskFailure = (what: string, exitCode?: number, cause?: unknown) => {
        if (settled || current < 0) return;
        const { label, id } = describeTask(tasks[current], current);
        fail(new PoolTaskError(`worker pool: ${what} while running ${label}`, current, id, exitCode, { cause }));
      };
      w.on('message', (r: R) => {
        if (settled) return;
        const i = current;
        if (i < 0) return; // unsolicited message — ignore
        results[i] = r;
        try {
          onResult?.(r, i);
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        if (++done === tasks.length) finish(); else feed();
      });
      w.on('error', (e) => {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        taskFailure(`uncaught worker error (${msg})`, undefined, e);
      });
      w.on('messageerror', (e) => {
        taskFailure(`unreadable message from worker (${e instanceof Error ? e.message : String(e)})`, undefined, e);
      });
      w.on('exit', (code) => taskFailure(`worker exited with code ${code}`, code));
      feed();
    }
  });
}
