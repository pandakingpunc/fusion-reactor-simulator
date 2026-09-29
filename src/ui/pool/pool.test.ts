import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAE } from '../../physics/presets';
import { ReactorConfig } from '../../physics/types';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { PROTOCOL_VERSION } from '../../worker/protocol';
import { AbortError, RunPool, defaultPoolSize } from './pool';

/** feed every live fake worker its pending messages and hand the replies back to the pool */
function drive(workers: FakeWorker[]): void {
  for (const w of workers) if (!w.terminated) { w.process(); w.deliver(); }
}

const fast = (seed: number): ReactorConfig => ({ ...TAE, seed, t_end: 0.01 });
const posted = (w: FakeWorker) => w.sent.filter((m) => m.type === 'runAll');

afterEach(() => { vi.useRealTimers(); });

describe('RunPool', () => {
  it('runs jobs on at most `size` workers, in submission order, and reuses the workers', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 2);
    const jobs = [1, 2, 3, 4, 5].map((s) => pool.run(fast(s)));
    // two jobs are on workers, three wait
    expect(f.workers).toHaveLength(2);
    expect(pool.stats).toMatchObject({ size: 2, workers: 2, running: 2, queued: 3 });
    expect(posted(f.workers[0]).map((m) => (m as { id: number }).id)).toEqual([1]);
    expect(posted(f.workers[1]).map((m) => (m as { id: number }).id)).toEqual([2]);

    for (let i = 0; i < 4; i++) drive(f.workers);
    const results = await Promise.all(jobs);
    expect(results).toHaveLength(5);
    for (const r of results) expect(r.report.termination.natural).toBe(true);
    expect(f.workers).toHaveLength(2); // no third worker was ever created
    expect(pool.stats).toMatchObject({ running: 0, queued: 0, completed: 5, failed: 0, cancelled: 0, replaced: 0 });
    expect(f.workers.flatMap((w) => posted(w)).map((m) => (m as { id: number }).id).sort()).toEqual([1, 2, 3, 4, 5]);
    pool.dispose();
  });

  it('returns the frames and events only when asked to', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const plain = pool.run(fast(1));
    drive(f.workers);
    expect((await plain).frames).toBeUndefined();
    const full = pool.run(fast(1), { keepFrames: true });
    drive(f.workers);
    const r = await full;
    expect(r.frames!.length).toBeGreaterThan(2);
    expect(r.events).toBeDefined();
    expect(r.meta.method).toBe('frc');
    pool.dispose();
  });

  it('relays progress only for a job that asks for it', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const seen: number[] = [];
    const a = pool.run(fast(1), { onProgress: (p) => seen.push(p.t / p.tEnd) });
    const b = pool.run(fast(2));
    expect((f.workers[0].sent[0] as { progress: boolean }).progress).toBe(true);
    drive(f.workers);
    await a;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x >= 0 && x <= 1.0001)).toBe(true);
    drive(f.workers);
    await b;
    expect((f.workers[0].sent[1] as { progress: boolean }).progress).toBe(false);
    pool.dispose();
  });

  it('calls onStart when a worker takes the job, not when it is queued', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const log: string[] = [];
    const a = pool.run(fast(1), { onStart: () => log.push('a') });
    const b = pool.run(fast(2), { onStart: () => log.push('b') });
    expect(log).toEqual(['a']);
    drive(f.workers);
    await a;
    expect(log).toEqual(['a', 'b']);
    drive(f.workers);
    await b;
    pool.dispose();
  });

  it('a job cancelled while it waits in the queue never reaches a worker', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const ctl = new AbortController();
    const first = pool.run(fast(1));
    const second = pool.run(fast(2), { signal: ctl.signal });
    const third = pool.run(fast(3));
    ctl.abort();
    await expect(second).rejects.toBeInstanceOf(AbortError);
    expect(pool.stats).toMatchObject({ queued: 1, running: 1, cancelled: 1 });
    drive(f.workers);
    drive(f.workers);
    await Promise.all([first, third]);
    expect(posted(f.workers[0]).map((m) => (m as { id: number }).id)).toEqual([1, 3]);
    pool.dispose();
  });

  it('cancelling a running job stops its worker and gives the next job a fresh one', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const ctl = new AbortController();
    const running = pool.run(fast(1), { signal: ctl.signal });
    const waiting = pool.run(fast(2));
    ctl.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.workers[0].terminated).toBe(true);
    expect(f.workers).toHaveLength(2);
    expect(pool.stats).toMatchObject({ workers: 1, running: 1, queued: 0, cancelled: 1, replaced: 1 });
    drive(f.workers);
    expect((await waiting).report.termination.natural).toBe(true);
    pool.dispose();
  });

  it('a signal that is already aborted rejects at once and a later abort of a finished job does nothing', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const done = new AbortController();
    done.abort();
    await expect(pool.run(fast(1), { signal: done.signal })).rejects.toBeInstanceOf(AbortError);
    expect(f.workers).toHaveLength(0);

    const ctl = new AbortController();
    const job = pool.run(fast(2), { signal: ctl.signal });
    drive(f.workers);
    await job;
    ctl.abort();
    expect(pool.stats).toMatchObject({ completed: 1, cancelled: 1, replaced: 0 });
    expect(f.workers[0].terminated).toBe(false);
    pool.dispose();
  });

  it('one signal that cancels a whole batch does not start the queued jobs on the way', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const ctl = new AbortController();
    const jobs = [1, 2, 3, 4, 5].map((s) => pool.run(fast(s), { signal: ctl.signal }));
    const outcomes = jobs.map((j) => j.then(() => 'ok', (e: Error) => e.name));
    ctl.abort();
    expect(await Promise.all(outcomes)).toEqual(['AbortError', 'AbortError', 'AbortError', 'AbortError', 'AbortError']);
    expect(f.workers).toHaveLength(1); // only the first job ever had a worker
    expect(f.workers[0].terminated).toBe(true);
    expect(pool.stats).toMatchObject({ running: 0, queued: 0, cancelled: 5, replaced: 1 });
    pool.dispose();
  });

  it('cancelAll clears the queue and the workers, and the pool can be used again', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 2);
    const jobs = [1, 2, 3, 4].map((s) => pool.run(fast(s)));
    const outcomes = jobs.map((j) => j.then(() => 'ok', (e: Error) => e.name));
    pool.cancelAll();
    expect(await Promise.all(outcomes)).toEqual(['AbortError', 'AbortError', 'AbortError', 'AbortError']);
    expect(pool.stats).toMatchObject({ running: 0, queued: 0, cancelled: 4 });
    const again = pool.run(fast(9));
    drive(f.workers);
    expect((await again).report.termination.natural).toBe(true);
    pool.dispose();
  });

  it('a crashing worker fails its own job only and is replaced', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const bad = pool.run(fast(1));
    const good = pool.run(fast(2));
    f.workers[0].crash('out of memory');
    await expect(bad).rejects.toThrow('out of memory');
    expect(f.workers[0].terminated).toBe(true);
    expect(pool.stats).toMatchObject({ failed: 1, replaced: 1, running: 1 });
    drive(f.workers);
    expect((await good).report.termination.natural).toBe(true);
    pool.dispose();
  });

  it('an error reported for a run fails that job and keeps the worker', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const broken = pool.run({ method: 'tokamak' } as unknown as ReactorConfig);
    const good = pool.run(fast(3));
    drive(f.workers);
    await expect(broken).rejects.toThrow();
    expect(f.workers[0].terminated).toBe(false);
    expect(pool.stats).toMatchObject({ failed: 1, replaced: 0 });
    drive(f.workers);
    expect((await good).report.termination.natural).toBe(true);
    expect(f.workers).toHaveLength(1);
    pool.dispose();
  });

  it('refuses a worker that speaks another protocol version', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const job = pool.run(fast(1));
    const w = f.workers[0];
    w.emit({ type: 'runAllDone', protocolVersion: PROTOCOL_VERSION + 1, id: 1, report: {} as never, meta: {} as never });
    await expect(job).rejects.toThrow('protocol mismatch');
    expect(w.terminated).toBe(true);
    pool.dispose();
  });

  it('stops a job that runs longer than its time limit', async () => {
    vi.useFakeTimers();
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const slow = pool.run(fast(1), { timeoutMs: 1000 });
    const next = pool.run(fast(2), { timeoutMs: 1000 });
    const caught = slow.then(() => new Error('resolved'), (e: Error) => e);
    vi.advanceTimersByTime(1001);
    expect((await caught).message).toContain('longer than 1000 ms');
    expect(f.workers[0].terminated).toBe(true);
    drive(f.workers);
    expect((await next).report.termination.natural).toBe(true);
    // a finished job leaves no timer behind
    expect(vi.getTimerCount()).toBe(0);
    pool.dispose();
  });

  it('ignores messages of a job it no longer runs', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 1);
    const job = pool.run(fast(1));
    f.workers[0].emit({ type: 'progress', id: 99, t: 1, tEnd: 2, frames: 3 });
    f.workers[0].emit({ type: 'frames', id: 1, branchId: 0, frames: [], events: [], t: 0, done: false, dt: 0, nSteps: 0, controls: {}, wallMs: 0 });
    drive(f.workers);
    await job;
    f.workers[0].emit({ type: 'progress', id: 1, t: 1, tEnd: 2, frames: 3 }); // after the job: nothing is waiting
    expect(pool.stats.completed).toBe(1);
    pool.dispose();
  });

  it('dispose terminates every worker; a failing worker factory fails the job, not the pool', async () => {
    const f = fakeWorkerFactory();
    const pool = new RunPool(f.create, 3);
    const a = pool.run(fast(1)), b = pool.run(fast(2));
    const outcomes = [a, b].map((j) => j.catch((e: Error) => e.name));
    pool.dispose();
    expect(await Promise.all(outcomes)).toEqual(['AbortError', 'AbortError']);
    expect(f.workers.every((w) => w.terminated)).toBe(true);
    expect(pool.stats.workers).toBe(0);

    let calls = 0;
    const flaky = new RunPool(() => { if (calls++ === 0) throw new Error('no worker for you'); return f.create(); }, 1);
    await expect(flaky.run(fast(1))).rejects.toThrow('no worker for you');
    const ok = flaky.run(fast(2));
    drive(f.workers);
    expect((await ok).report.termination.natural).toBe(true);
    flaky.dispose();
  });

  it('chooses a default size between one and four', () => {
    const n = defaultPoolSize();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
    expect(new RunPool(() => new FakeWorker(), 0).size).toBe(1);
    expect(new RunPool(() => new FakeWorker(), 2.9).size).toBe(2);
  });
});
