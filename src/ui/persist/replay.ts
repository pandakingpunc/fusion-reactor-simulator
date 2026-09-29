/**
 * The page's side of the replay worker: run a run from its inputs in a worker of its own and get the result back.
 * Each call uses a fresh worker and ends it (on success, failure or abort), so nothing lingers between runs and an
 * abort really stops the computation.
 */
import { ReplayError, ReplayFromWorker, ReplayInput, ReplayResult, ReplayToWorker } from './replayCore';

/** The part of the Worker interface used here (a real Worker or a test double). */
export interface ReplayWorkerLike {
  postMessage(msg: ReplayToWorker): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<ReplayFromWorker>) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
}
export type ReplayWorkerFactory = () => ReplayWorkerLike;

export interface ReplayOptions {
  onProgress?: (p: { t: number; tEnd: number }) => void;
  /** aborting terminates the worker and rejects with an AbortError */
  signal?: AbortSignal;
}

/** Re-run a run: the function the import and share flows call (tests pass their own). */
export type ReplayFn = (input: ReplayInput, opts?: ReplayOptions) => Promise<ReplayResult>;

export function createReplayWorker(): ReplayWorkerLike {
  return new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' }) as unknown as ReplayWorkerLike;
}

let nextId = 0;

export function replayInWorker(input: ReplayInput, opts: ReplayOptions & { createWorker?: ReplayWorkerFactory } = {}): Promise<ReplayResult> {
  return new Promise<ReplayResult>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException('Replay aborted', 'AbortError')); return; }
    const id = ++nextId;
    const w = (opts.createWorker ?? createReplayWorker)();
    const end = () => { opts.signal?.removeEventListener('abort', onAbort); w.terminate(); };
    const onAbort = () => { end(); reject(new DOMException('Replay aborted', 'AbortError')); };
    opts.signal?.addEventListener('abort', onAbort);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') opts.onProgress?.({ t: m.t, tEnd: m.tEnd });
      else if (m.type === 'done') { end(); resolve(m.result); }
      else if (m.type === 'error') { end(); reject(new ReplayError(m.code, m.msg)); }
    };
    w.onerror = (ev) => { end(); reject(new ReplayError('failed', ev.message || 'The replay worker failed.')); };
    w.postMessage({ type: 'replay', id, input });
  });
}
