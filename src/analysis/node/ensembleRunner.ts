/// <reference types="node" />
/**
 * The worker-pool {@link BatchRunner}: the shots of an ensemble or scan run on worker threads (src/cli/pool.ts), one shot
 * per task, results in task order. A shot whose worker crashes, hangs past the timeout or fails to load becomes a failed
 * outcome (the ensemble carries on); cancelling (Ctrl-C, an AbortSignal) rejects with PoolAbortError.
 */
import { PoolTaskError, defaultThreads, runPool } from '../../cli/pool';
import type { BatchRunner, SimOutcome, SimTask } from '../ensemble';
import type { WorkerOutcome } from './ensemble.worker';

export interface PoolRunnerOptions {
  /** worker threads (default: cores - 1) */
  threads?: number;
  /** wall-clock limit per shot [s]; a shot over it fails (default: none) */
  timeoutS?: number;
  signal?: AbortSignal;
}

export function poolRunner(opts: PoolRunnerOptions = {}): BatchRunner {
  return async (tasks: SimTask[], onProgress) => {
    const res = await runPool<SimTask, WorkerOutcome>(tasks, new URL('./ensemble.worker.ts', import.meta.url), {
      threads: opts.threads ?? defaultThreads(),
      timeoutMs: opts.timeoutS === undefined ? undefined : opts.timeoutS * 1000,
      signal: opts.signal,
      onTaskError: (e: PoolTaskError, t: SimTask): WorkerOutcome => ({ id: t.id, ok: false, error: e.timedOut ? `timed out (${opts.timeoutS} s)` : e.message }),
      onProgress: (p) => onProgress?.({ done: p.done, total: p.total, failed: p.failed }),
    });
    return res.map(({ id: _id, ...o }) => o as SimOutcome);
  };
}
