/// <reference types="node" />
/**
 * runPool settles only after every worker thread it started has stopped, on every path (see the
 * "Shutdown" paragraph of pool.ts). The workers are observed through Worker.prototype.terminate: the pool
 * terminates each worker it started or replaced, and `threadId` reads -1 once a worker has exited, so a
 * pool that settled without waiting for the threads leaves live ones behind at the moment its promise
 * settles.
 */
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PoolAbortError, PoolTaskError, runPool } from './pool';

interface Task { id: string; action: 'double' | 'slow' | 'hang' | 'spin' | 'throw' | 'crash'; v?: number; code?: number; ms?: number }
interface Res { id: string; v: number | null }
const FIXTURE = new URL('./testdata/pool-fixture.worker.mjs', import.meta.url);
const BROKEN = new URL('./testdata/pool-broken.worker.mjs', import.meta.url);
const doubles = (n: number): Task[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, action: 'double', v: i }));
const hangs = (n: number): Task[] => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, action: 'hang' }));

let terminated: MockInstance<Worker['terminate']>;
beforeEach(() => { terminated = vi.spyOn(Worker.prototype, 'terminate'); });
afterEach(() => { terminated.mockRestore(); });

/** the workers the pool terminated (each worker it started is terminated when it settles) */
const workers = (): Worker[] => terminated.mock.contexts as Worker[];
/** how many of them are still running */
const alive = (): number => workers().filter((w) => w.threadId !== -1).length;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the pool to reject');
}

describe('worker pool shutdown: no worker thread is left running when the promise settles', { timeout: 30_000 }, () => {
  it('success', async () => {
    const res = await runPool<Task, Res>(doubles(12), FIXTURE, { threads: 4 });
    expect(res).toHaveLength(12);
    expect(workers().length).toBeGreaterThanOrEqual(4);
    expect(alive()).toBe(0);
    // the positional (v3) form as well
    terminated.mockClear();
    await runPool<Task, Res>(doubles(6), FIXTURE, 3);
    expect(workers().length).toBeGreaterThanOrEqual(3);
    expect(alive()).toBe(0);
  });

  it('an uncaught error in a worker, an exit mid-task and a worker that fails to load reject after the others stopped', async () => {
    const e = await rejection(runPool<Task, Res>([...doubles(3), { id: 'bad', action: 'throw' }, ...hangs(4)], FIXTURE, { threads: 3 }));
    expect(e).toBeInstanceOf(PoolTaskError);
    expect(workers().length).toBeGreaterThanOrEqual(3);
    expect(alive()).toBe(0);

    terminated.mockClear();
    await rejection(runPool<Task, Res>([{ id: 'quit', action: 'crash', code: 3 }, ...hangs(4)], FIXTURE, { threads: 2 }));
    expect(alive()).toBe(0);

    terminated.mockClear();
    await rejection(runPool<Task, Res>(doubles(4), BROKEN, { threads: 2 }));
    expect(workers().length).toBeGreaterThanOrEqual(1);
    expect(alive()).toBe(0);
  });

  it('a timeout, of an idle event loop or of a busy loop', async () => {
    for (const action of ['hang', 'spin'] as const) {
      terminated.mockClear();
      const e = await rejection(runPool<Task, Res>([{ id: 'stuck', action }, ...hangs(3)], FIXTURE, { threads: 2, timeoutMs: 200 }));
      expect((e as PoolTaskError).timedOut).toBe(true);
      expect(workers().length).toBeGreaterThanOrEqual(2);
      expect(alive()).toBe(0);
    }
  });

  it('an AbortSignal, before the start (no worker) and mid-run (busy workers)', async () => {
    const pre = new AbortController();
    pre.abort();
    await rejection(runPool<Task, Res>(doubles(3), FIXTURE, { threads: 2, signal: pre.signal }));
    expect(workers()).toHaveLength(0);

    const ac = new AbortController();
    const tasks: Task[] = [{ id: 's0', action: 'spin' }, { id: 's1', action: 'spin' }, ...hangs(2)];
    setTimeout(() => ac.abort(new Error('stop')), 150);
    const e = await rejection(runPool<Task, Res>(tasks, FIXTURE, { threads: 2, signal: ac.signal }));
    expect(e).toBeInstanceOf(PoolAbortError);
    expect(workers().length).toBeGreaterThanOrEqual(2);
    expect(alive()).toBe(0);
  });

  it('with onTaskError: workers replaced after a crash, a hang and a spin are stopped too', async () => {
    const tasks: Task[] = [
      { id: 'crash', action: 'crash', code: 3 }, { id: 'spin', action: 'spin' }, { id: 'hang', action: 'hang' }, ...doubles(4),
    ];
    const res = await runPool<Task, Res>(tasks, FIXTURE, {
      threads: 2, timeoutMs: 300, handleSignals: false,
      onTaskError: (_e, t) => ({ id: t.id, v: null }),
    });
    expect(res.map((r) => r.v)).toEqual([null, null, null, 0, 2, 4, 6]);
    // 2 first workers + one replacement per failed task that left work behind
    expect(workers().length).toBeGreaterThanOrEqual(3);
    expect(alive()).toBe(0);
  });

  it('a callback that throws (onResult) rejects after the workers stopped', async () => {
    const e = await rejection(runPool<Task, Res>(doubles(6), FIXTURE, { threads: 2, onResult: () => { throw new Error('callback failed'); } }));
    expect((e as Error).message).toBe('callback failed');
    expect(alive()).toBe(0);
  });

  it('SIGINT: the child process reports no live worker once the pool has rejected', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/testdata/pool-sigint.mts'], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    if (r.error) throw r.error;
    expect(r.status).toBe(130);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(out).toMatchObject({ settled: 'rejected', abort: true, reason: 'SIGINT', terminated: 2, alive: 0 });
  });

  // The consequence a caller can rely on: it may end the process with process.exit() the moment the pool
  // settles (a process that ends by itself waits for terminated workers anyway, so this is the only way a
  // pool that settles early could matter). No CLI does it today; the exit status and the count of live
  // workers are exact, whichever way the pool ended.
  it.each(['success', 'error', 'timeout', 'abort'] as const)('process.exit() right after the pool settled (%s): no worker left running, exact exit status', (how) => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/testdata/pool-exit.mts', how], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    if (r.error) throw r.error;
    expect(r.signal).toBeNull();
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(out).toMatchObject({ how, outcome: how === 'success' ? 'resolved' : 'rejected' });
    expect(out.terminated).toBeGreaterThanOrEqual(3);
    expect(out.alive).toBe(0);
  });
});
