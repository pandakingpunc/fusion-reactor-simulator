/**
 * Test harness: an in-process stand-in for the simulation worker (protocol v2).
 *
 * The page side talks to it exactly like to `sim.worker.ts`. Nothing happens on its own:
 *  - `process()` feeds the messages the page posted to the real protocol host (createSimHost, real
 *    physics) — autoplay and `play` are recorded but not run, so tests stay deterministic;
 *    `advance(simDt)` stands in for playback ticks;
 *  - `deliver()` hands the host's replies to the page, in order; `emit()` injects any message
 *    (stale frames, errors …) and `crash()` fires the worker's onerror.
 * Messages are structured-cloned in both directions, as across a real thread boundary.
 * Not imported by the application bundle.
 */
import { FromWorker, ToWorker } from './protocol';
import { SimHost, createSimHost } from './host';
import type { FrameScheduler, WorkerLike } from '../ui/state/sim';

const clone = <T,>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

export class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent<FromWorker>) => unknown) | null = null;
  onerror: ((ev: ErrorEvent) => unknown) | null = null;
  /** everything the page posted, in order */
  readonly sent: ToWorker[] = [];
  /** replies produced by the host and not yet delivered */
  readonly outbox: FromWorker[] = [];
  terminated = false;
  private processed = 0;
  private readonly host: SimHost = createSimHost((m) => this.outbox.push(clone(m)));

  postMessage(msg: ToWorker): void {
    if (this.terminated) throw new Error('FakeWorker: postMessage after terminate()');
    this.sent.push(clone(msg));
  }

  terminate(): void {
    this.terminated = true;
    this.host.dispose();
  }

  /** last posted message of a type */
  last<K extends ToWorker['type']>(type: K): Extract<ToWorker, { type: K }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].type === type) return this.sent[i] as Extract<ToWorker, { type: K }>;
    return undefined;
  }

  /** run the page's pending messages through the real protocol host (without starting playback timers) */
  process(): void {
    while (this.processed < this.sent.length) {
      const m = this.sent[this.processed++];
      if (m.type === 'play') continue;
      this.host.handle(m.type === 'init' ? { ...m, autoPlay: false } : m);
    }
  }

  /** one playback tick of `simDt` simulated time on the current branch */
  advance(simDt: number): void {
    this.process();
    this.host.handle({ type: 'step', simDt });
  }

  /** deliver queued host replies to the page (all, or only those accepted by `filter`, which are removed) */
  deliver(filter: (m: FromWorker) => boolean = () => true): FromWorker[] {
    const out: FromWorker[] = [];
    for (let i = 0; i < this.outbox.length;) {
      if (filter(this.outbox[i])) out.push(...this.outbox.splice(i, 1)); else i++;
    }
    for (const m of out) this.onmessage?.({ data: m } as MessageEvent<FromWorker>);
    return out;
  }

  /** inject a message as if the worker had posted it */
  emit(m: FromWorker): void {
    this.onmessage?.({ data: clone(m) } as MessageEvent<FromWorker>);
  }

  /** simulate an uncaught exception in the worker script */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

/** Worker factory that remembers every FakeWorker it created (the live one is `workers[0]`). */
export function fakeWorkerFactory(): { create: () => FakeWorker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  return { workers, create: () => { const w = new FakeWorker(); workers.push(w); return w; } };
}

/** Frame scheduler under test control: flushes happen only when `run()` is called. */
export function manualScheduler(): { schedule: FrameScheduler; pending: () => number; run: () => void } {
  let queue: (() => void)[] = [];
  return {
    schedule: (flush) => { queue.push(flush); },
    pending: () => queue.length,
    run: () => { const q = queue; queue = []; q.forEach((f) => f()); },
  };
}
