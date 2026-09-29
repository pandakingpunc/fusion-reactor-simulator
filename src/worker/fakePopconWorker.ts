/**
 * Test harness: an in-process stand-in for the POPCON worker (popconProtocol.ts), the same shape as FakeWorker
 * (fakeWorker.ts) for the simulation worker.
 *
 * The page side talks to it exactly like to `popcon.worker.ts`. Nothing happens on its own, and time is virtual:
 *  - `process()` feeds the messages the page posted to the real host (createPopconHost, real model unless a `compute`
 *    is injected), in order, the way a busy worker would find them queued;
 *  - `elapse(ms)` lets virtual time pass and runs the host's scheduled stages that fall due (a zero-delay stage is due
 *    at `elapse(0)`), `flush()` runs all of them whatever their delay;
 *  - `deliver()` hands the host's replies to the page, in order; `emit()` injects any message (a stale grid, an
 *    error …) and `crash()` fires the worker's onerror.
 * Messages are structured-cloned in both directions, as across a real thread boundary. Not imported by the
 * application bundle.
 */
import { computePopcon } from '../physics/popcon';
import type { PopconWorkerLike } from '../ui/charts/usePopcon';
import { PopconHost, PopconHostOptions, createPopconHost } from './popconHost';
import type { FromPopcon, ToPopcon } from './popconProtocol';

const clone = <T,>(x: T): T => structuredClone(x);

interface Task { at: number; fn: () => void; cancelled: boolean }

export class FakePopconWorker implements PopconWorkerLike {
  onmessage: ((ev: MessageEvent<FromPopcon>) => unknown) | null = null;
  onerror: ((ev: ErrorEvent) => unknown) | null = null;
  /** everything the page posted, in order */
  readonly sent: ToPopcon[] = [];
  /** replies produced by the host and not yet delivered */
  readonly outbox: FromPopcon[] = [];
  /** every call of the model: the configuration it got (a clone) and the grid size */
  readonly computed: { cfg: Parameters<typeof computePopcon>[0]; nx: number; ny: number; Tmax?: number }[] = [];
  terminated = false;
  private processed = 0;
  private time = 0;
  private tasks: Task[] = [];
  private readonly host: PopconHost;

  constructor(opts: { compute?: PopconHostOptions['compute'] } = {}) {
    const model = opts.compute ?? computePopcon;
    this.host = createPopconHost((m) => this.outbox.push(clone(m)), {
      compute: (cfg, o) => { this.computed.push({ cfg, nx: o?.nx ?? 44, ny: o?.ny ?? 44, Tmax: o?.Tmax }); return model(cfg, o); },
      now: () => this.time,
      schedule: (fn, delayMs) => {
        const t: Task = { at: this.time + delayMs, fn, cancelled: false };
        this.tasks.push(t);
        return () => { t.cancelled = true; };
      },
    });
  }

  postMessage(msg: ToPopcon): void {
    if (this.terminated) throw new Error('FakePopconWorker: postMessage after terminate()');
    this.sent.push(clone(msg));
  }

  terminate(): void {
    this.terminated = true;
    this.host.dispose();
    this.tasks = [];
  }

  /** last posted message of a type */
  last<K extends ToPopcon['type']>(type: K): Extract<ToPopcon, { type: K }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].type === type) return this.sent[i] as Extract<ToPopcon, { type: K }>;
    return undefined;
  }

  /** hand the messages the page posted to the host (each newer `compute` replaces the previous job) */
  process(): void {
    while (this.processed < this.sent.length) this.host.handle(this.sent[this.processed++]);
  }

  /** let `ms` of virtual time pass: the stages that fall due run, in order of their due time */
  elapse(ms = 0): void {
    this.process();
    const end = this.time + ms;
    for (;;) {
      const due = this.tasks.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.tasks.splice(this.tasks.indexOf(due), 1);
      this.time = Math.max(this.time, due.at);
      due.fn();
    }
    this.time = end;
    this.tasks = this.tasks.filter((t) => !t.cancelled);
  }

  /** run every scheduled stage, whatever its delay (the job to its end) */
  flush(): void {
    this.process();
    for (let guard = 0; guard < 1000; guard++) {
      const next = this.tasks.filter((t) => !t.cancelled).sort((a, b) => a.at - b.at)[0];
      if (!next) return;
      this.elapse(Math.max(0, next.at - this.time));
    }
  }

  /** stages still scheduled (a job waiting for the controls to rest has its next stage here) */
  pending(): number { return this.tasks.filter((t) => !t.cancelled).length; }

  /** deliver queued host replies to the page (all, or only those accepted by `filter`, which are removed) */
  deliver(filter: (m: FromPopcon) => boolean = () => true): FromPopcon[] {
    const out: FromPopcon[] = [];
    for (let i = 0; i < this.outbox.length;) {
      if (filter(this.outbox[i])) out.push(...this.outbox.splice(i, 1)); else i++;
    }
    for (const m of out) this.onmessage?.({ data: m } as MessageEvent<FromPopcon>);
    return out;
  }

  /** inject a message as if the worker had posted it */
  emit(m: FromPopcon): void {
    this.onmessage?.({ data: clone(m) } as MessageEvent<FromPopcon>);
  }

  /** simulate an uncaught exception in the worker script */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

/** Worker factory that remembers every FakePopconWorker it created (the live one is the last). */
export function fakePopconFactory(opts: ConstructorParameters<typeof FakePopconWorker>[0] = {}): { create: () => FakePopconWorker; workers: FakePopconWorker[] } {
  const workers: FakePopconWorker[] = [];
  return { workers, create: () => { const w = new FakePopconWorker(opts); workers.push(w); return w; } };
}
