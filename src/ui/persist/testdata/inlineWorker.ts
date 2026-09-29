/**
 * Test double of the replay worker: it runs the worker's message handler in-process, one macrotask after
 * postMessage, and delivers its replies through onmessage like a real worker. Not imported by the application bundle.
 */
import { handleReplayMessage, ReplayFromWorker, ReplayToWorker } from '../replayCore';
import type { ReplayWorkerFactory, ReplayWorkerLike } from '../replay';

export class InlineReplayWorker implements ReplayWorkerLike {
  onmessage: ((ev: MessageEvent<ReplayFromWorker>) => unknown) | null = null;
  onerror: ((ev: ErrorEvent) => unknown) | null = null;
  terminated = false;
  sent: ReplayToWorker[] = [];

  constructor(private readonly clock: () => number = () => Date.now()) {}

  postMessage(msg: ReplayToWorker): void {
    if (this.terminated) throw new Error('InlineReplayWorker: postMessage after terminate()');
    this.sent.push(msg);
    setTimeout(() => {
      if (this.terminated) return;
      handleReplayMessage(structuredClone(msg), (m) => { if (!this.terminated) this.onmessage?.({ data: structuredClone(m) } as MessageEvent<ReplayFromWorker>); }, this.clock);
    }, 0);
  }

  terminate(): void { this.terminated = true; }

  /** simulate an uncaught exception in the worker script */
  crash(message: string): void { this.onerror?.({ message } as ErrorEvent); }
}

/** A factory that records the workers it made. */
export function inlineWorkerFactory(clock?: () => number): { create: ReplayWorkerFactory; workers: InlineReplayWorker[] } {
  const workers: InlineReplayWorker[] = [];
  return { workers, create: () => { const w = new InlineReplayWorker(clock); workers.push(w); return w; } };
}
