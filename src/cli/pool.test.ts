/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_MS, PoolAbortError, PoolConfigError, PoolProgress, PoolTaskError, checkThreads, defaultThreads, runPool } from './pool';

interface Task { id: string; action: 'double' | 'echo' | 'slow' | 'hang' | 'spin' | 'throw' | 'crash' | 'exit' | 'twice' | 'throwString'; v?: number; code?: number; ms?: number }
interface Res { id: string; v: number | null; error?: string }
const FIXTURE = new URL('./testdata/pool-fixture.worker.mjs', import.meta.url);
const BROKEN = new URL('./testdata/pool-broken.worker.mjs', import.meta.url);
const TS_WORKER = new URL('./testdata/pool-ts.worker.ts', import.meta.url);
const doubles = (n: number): Task[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, action: 'double', v: i }));

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the pool to reject');
}

describe('worker pool', () => {
  it('returns results in task order and reports each one', async () => {
    const seen: number[] = [];
    const res = await runPool<Task, Res>(doubles(10), FIXTURE, 3, (r, i) => { expect(r.id).toBe(`t${i}`); seen.push(i); });
    expect(res.map((r) => r.v)).toEqual(doubles(10).map((t) => 2 * t.v!));
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
    expect(await runPool<Task, Res>([], FIXTURE, 2)).toEqual([]);
  });

  it('rejects invalid thread counts with a typed error', async () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '4' as unknown as number]) {
      expect(() => checkThreads(bad)).toThrow(PoolConfigError);
      const e = await rejection(runPool<Task, Res>(doubles(2), FIXTURE, bad));
      expect(e).toBeInstanceOf(PoolConfigError);
      expect((e as Error).message).toMatch(/threads must be a finite integer >= 1/);
    }
    expect(checkThreads(1)).toBe(1);
  });

  it('an uncaught worker error rejects with the failing task instead of hanging', async () => {
    const tasks: Task[] = [...doubles(4), { id: 'bad', action: 'throw' }, ...doubles(3)];
    const e = await rejection(runPool<Task, Res>(tasks, FIXTURE, 2));
    expect(e).toBeInstanceOf(PoolTaskError);
    const pe = e as PoolTaskError;
    expect(pe.taskIndex).toBe(4);
    expect(pe.taskId).toBe('bad');
    expect(pe.message).toMatch(/uncaught worker error \(Error: boom in bad\) while running task #4 \(bad\)/);
  });

  it('a worker exiting mid-task (non-zero or zero code) rejects with the exit code', async () => {
    for (const code of [3, 0]) {
      const e = await rejection(runPool<Task, Res>([...doubles(2), { id: 'quit', action: 'exit', code }], FIXTURE, 1));
      expect(e).toBeInstanceOf(PoolTaskError);
      expect((e as PoolTaskError).exitCode).toBe(code);
      expect((e as PoolTaskError).taskId).toBe('quit');
      expect((e as Error).message).toContain(`worker exited with code ${code} while running task #2 (quit)`);
    }
  });

  it('a task that cannot be sent (not structured-cloneable) rejects with that task, first round or later', async () => {
    const fnTask = { id: 'fn', action: 'double', v: 1, cb: () => 1 } as Task;
    // first round: postMessage throws inside the promise executor, right after the worker started
    const first = await rejection(runPool<Task, Res>([fnTask, ...doubles(2)], FIXTURE, 1));
    expect(first).toBeInstanceOf(PoolTaskError);
    expect((first as PoolTaskError).taskIndex).toBe(0);
    expect((first as PoolTaskError).taskId).toBe('fn');
    expect((first as Error).message).toMatch(/could not send task #0 \(fn\) to a worker \(.*could not be cloned/);
    expect((first as Error).cause).toBeInstanceOf(Error);
    // later round: postMessage throws inside the worker's 'message' handler
    const later = await rejection(runPool<Task, Res>([...doubles(2), fnTask], FIXTURE, 1));
    expect(later).toBeInstanceOf(PoolTaskError);
    expect((later as PoolTaskError).taskIndex).toBe(2);
    expect((later as Error).message).toMatch(/could not send task #2 \(fn\) to a worker/);
  });

  it('a worker that fails to load rejects', async () => {
    const e = await rejection(runPool<Task, Res>(doubles(3), BROKEN, 2));
    expect(e).toBeInstanceOf(PoolTaskError);
    expect((e as Error).message).toMatch(/fixture failed to load/);
  });

  // The vitest process has no `--import tsx` for a worker to inherit, so this is the case that failed on every Node
  // with type stripping (ERR_MODULE_NOT_FOUND for the extensionless import) before .ts workers went through tsImport.
  it('a .ts worker with extensionless imports loads whatever the Node version', async () => {
    const res = await runPool<{ id: string; v: number }, Res>([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 5 }], TS_WORKER, 2);
    expect(res).toEqual([{ id: 'a', v: 3 }, { id: 'b', v: 6 }, { id: 'c', v: 15 }]);
  });
});

/** onTaskError mapping used by the recovery tests: the failure becomes a result */
const asResult = (e: PoolTaskError, t: Task): Res => ({ id: t.id, v: null, error: e.message });

describe('worker pool options', { timeout: 30_000 }, () => {
  it('the options form matches the positional form and reports progress for every task', async () => {
    const seen: number[] = [];
    const progress: PoolProgress[] = [];
    const res = await runPool<Task, Res>(doubles(7), FIXTURE, { threads: 3, onResult: (_r, i) => seen.push(i), onProgress: (p) => progress.push(p) });
    expect(res).toEqual(await runPool<Task, Res>(doubles(7), FIXTURE, 3));
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(7).keys()]);
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(progress.every((p) => p.total === 7 && p.ok && p.failed === 0 && p.respawns === 0 && p.ms >= 0)).toBe(true);
    expect(progress.map((p) => p.id).sort()).toEqual(doubles(7).map((t) => t.id).sort());
  });

  it('echo: a task travels to the worker and back unchanged', async () => {
    const tasks: Task[] = [{ id: 'e0', action: 'echo', v: 1.5 }, { id: 'e1', action: 'echo', v: -2 }];
    expect(await runPool<Task, Task>(tasks, FIXTURE, { threads: 1 })).toEqual(tasks);
  });

  it('a task over its timeout rejects with timedOut and the task, and the hung worker is terminated', async () => {
    for (const action of ['hang', 'spin'] as const) {
      const t0 = performance.now();
      const e = await rejection(runPool<Task, Res>([...doubles(2), { id: 'stuck', action }], FIXTURE, { threads: 1, timeoutMs: 300 }));
      expect(e).toBeInstanceOf(PoolTaskError);
      const pe = e as PoolTaskError;
      expect(pe.timedOut).toBe(true);
      expect(pe.taskIndex).toBe(2);
      expect(pe.message).toContain('task timed out after 300 ms while running task #2 (stuck)');
      expect(performance.now() - t0).toBeLessThan(10_000);
    }
  });

  it('per-task timeouts: only the tasks given a limit are limited', async () => {
    const tasks: Task[] = [{ id: 'fast', action: 'slow', v: 1, ms: 10 }, { id: 'long', action: 'slow', v: 2, ms: 400 }, { id: 'late', action: 'slow', v: 3, ms: 400 }];
    const res = await runPool<Task, Res>(tasks, FIXTURE, {
      threads: 3, timeoutMs: (t) => (t.id === 'late' ? 100 : undefined), onTaskError: asResult,
    });
    expect(res.map((r) => r.v)).toEqual([1, 2, null]);
    expect(res[2].error).toMatch(/timed out after 100 ms while running task #2 \(late\)/);
  });

  it('with onTaskError, crashes, uncaught errors and timeouts become results and the other tasks complete', async () => {
    const tasks: Task[] = [
      ...doubles(3), { id: 'crash', action: 'crash', code: 3 }, ...doubles(2).map((t) => ({ ...t, id: `${t.id}b` })),
      { id: 'throw', action: 'throw' }, { id: 'spin', action: 'spin' }, { id: 'last', action: 'double', v: 21 },
    ];
    const errors: PoolTaskError[] = [];
    const progress: PoolProgress[] = [];
    const res = await runPool<Task, Res>(tasks, FIXTURE, {
      threads: 2, timeoutMs: 500, onProgress: (p) => progress.push(p),
      onTaskError: (e, t) => { errors.push(e); return asResult(e, t); },
    });
    expect(res.map((r) => r.v)).toEqual([0, 2, 4, null, 0, 2, null, null, 42]);
    expect(errors.map((e) => [e.taskId, e.exitCode, e.timedOut])).toEqual(expect.arrayContaining([['crash', 3, false], ['throw', undefined, false], ['spin', undefined, true]]));
    expect(res[3].error).toContain('worker exited with code 3 while running task #3 (crash)');
    expect(res[6].error).toContain('uncaught worker error (Error: boom in throw)');
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ done: 9, total: 9, failed: 3 });
    // crash and throw always leave tasks to run, so their workers are replaced; whether the timed-out
    // worker is replaced depends on whether the other worker has already taken the last task
    expect(last.respawns).toBeGreaterThanOrEqual(2);
    expect(last.respawns).toBeLessThanOrEqual(3);
  });

  it('with onTaskError, a worker that fails to load fails every task instead of hanging', async () => {
    const res = await runPool<Task, Res>(doubles(4), BROKEN, { threads: 2, onTaskError: asResult });
    expect(res).toHaveLength(4);
    for (const r of res) expect(r.error).toMatch(/fixture failed to load/);
  });

  it('with onTaskError, an unsendable task becomes a result and its worker keeps going', async () => {
    const fnTask = { id: 'fn', action: 'double', v: 1, cb: () => 1 } as Task;
    const res = await runPool<Task, Res>([fnTask, ...doubles(2), fnTask], FIXTURE, { threads: 1, onTaskError: asResult });
    expect(res.map((r) => r.v)).toEqual([null, 0, 2, null]);
    expect(res[0].error).toMatch(/could not send task #0 \(fn\)/);
  });

  it('an onTaskError that throws rejects the pool with its error', async () => {
    const e = await rejection(runPool<Task, Res>([{ id: 'x', action: 'crash' }, ...doubles(3)], FIXTURE, {
      threads: 1, onTaskError: () => { throw new Error('mapper failed'); },
    }));
    expect((e as Error).message).toBe('mapper failed');
  });

  it('invalid timeouts are configuration errors', async () => {
    for (const bad of [-1, NaN, '5' as unknown as number]) {
      expect(await rejection(runPool<Task, Res>(doubles(1), FIXTURE, { threads: 1, timeoutMs: bad }))).toBeInstanceOf(PoolConfigError);
    }
    const e = await rejection(runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1, timeoutMs: () => -5 }));
    expect(e).toBeInstanceOf(PoolConfigError);
    expect((e as Error).message).toMatch(/timeoutMs\(task #0\) must be a positive number/);
    // 0 and Infinity mean "no limit"
    expect(await runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1, timeoutMs: 0 })).toHaveLength(2);
    expect(await runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1, timeoutMs: Infinity })).toHaveLength(2);
  });

  it('a limit too long for a timer (> 2^31 - 1 ms, about 24.8 days) means no limit, not a time-out after 1 ms', async () => {
    const slow: Task[] = [{ id: 'a', action: 'slow', v: 1, ms: 50 }, { id: 'b', action: 'slow', v: 2, ms: 50 }];
    for (const timeoutMs of [MAX_TIMEOUT_MS, MAX_TIMEOUT_MS + 1, 3e9, 1e10, () => 1e12]) {
      expect(await runPool<Task, Res>(slow, FIXTURE, { threads: 1, timeoutMs, onTaskError: asResult })).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    }
  });

  it('an AbortSignal cancels the pool: before the start or mid-run, with no results reported afterwards', async () => {
    const pre = new AbortController();
    pre.abort(new Error('not today'));
    const e0 = await rejection(runPool<Task, Res>(doubles(3), FIXTURE, { threads: 2, signal: pre.signal }));
    expect(e0).toBeInstanceOf(PoolAbortError);
    expect((e0 as PoolAbortError).completed).toBe(0);

    const ac = new AbortController();
    const tasks: Task[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, action: 'slow', v: i, ms: 150 }));
    let after = 0;
    let aborted = false;
    const e = await rejection(runPool<Task, Res>(tasks, FIXTURE, {
      threads: 2, signal: ac.signal,
      onResult: () => { if (aborted) after++; else { aborted = true; ac.abort(new Error('user cancelled')); } },
    }));
    expect(e).toBeInstanceOf(PoolAbortError);
    const pa = e as PoolAbortError;
    expect(pa.reason).toBe('signal');
    expect(pa.message).toMatch(/cancelled after 1 of 6 tasks \(user cancelled\)/);
    expect((pa.cause as Error).message).toBe('user cancelled');
    await new Promise((r) => setTimeout(r, 400));
    expect(after).toBe(0);
  });

  it('removes its SIGINT/SIGTERM listeners when it settles; handleSignals: false and the positional form add none', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const p = runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1 });
    expect(process.listenerCount('SIGINT')).toBe(before[0] + 1);
    await p;
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
    const q = runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1, handleSignals: false });
    expect(process.listenerCount('SIGINT')).toBe(before[0]);
    await q;
    // the positional (v3) form keeps Node's default Ctrl-C behaviour
    const v3 = runPool<Task, Res>(doubles(2), FIXTURE, 1);
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
    await v3;
    await rejection(runPool<Task, Res>([{ id: 'x', action: 'crash' }], FIXTURE, 1));
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });

  it('SIGINT terminates the workers and rejects with PoolAbortError (child process)', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/testdata/pool-sigint.mts'], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    if (r.error) throw r.error;
    expect(r.status).toBe(130);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(out).toMatchObject({ settled: 'rejected', abort: true, reason: 'SIGINT', completed: 0 });
    expect(out.message).toMatch(/interrupted by SIGINT after 0 of 6 tasks; workers terminated/);
    expect(out.listeners.during).toBe(out.listeners.before + 1);
    expect(out.listeners.after).toBe(out.listeners.before);
  });

  it('deferred await (pool started, other work awaited, pool awaited later) with SIGINT meanwhile (child process)', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const run = (mode: string) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/testdata/pool-deferred.mts', mode], { cwd: root, encoding: 'utf8', timeout: 20_000 });
      if (r.error) throw r.error;
      return { status: r.status, stderr: r.stderr, out: JSON.parse(r.stdout.trim().split('\n').pop()!) };
    };
    // positional form: no listener, so SIGINT does not cancel the pool and nothing is left unhandled
    const v3 = run('positional');
    expect(v3.status).toBe(0);
    expect(v3.out).toMatchObject({ settled: 'resolved', n: 4, unhandled: 0 });
    expect(v3.out.listeners.during).toBe(v3.out.listeners.before);
    // options form with a handler attached at once: cancelled, and the later await sees the abort
    const opt = run('options');
    expect(opt.status).toBe(130);
    expect(opt.out).toMatchObject({ settled: 'rejected', abort: true, unhandled: 0 });
    expect(opt.out.listeners.during).toBe(opt.out.listeners.before + 1);
    expect(opt.out.listeners.after).toBe(opt.out.listeners.before);
    expect(opt.stderr).not.toMatch(/PoolAbortError/);
  });
});

describe('worker pool: failure values and edge paths', { timeout: 30_000 }, () => {
  const slow = (n: number, ms: number): Task[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, action: 'slow', v: i, ms }));
  const signalListeners = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];

  it('without a thread count the pool uses defaultThreads() workers (all cores but one, at least one) and still returns every result in order', async () => {
    expect(defaultThreads()).toBe(Math.max(1, availableParallelism() - 1));
    const res = await runPool<Task, Res>(doubles(5), FIXTURE, {});
    expect(res.map((r) => r.v)).toEqual([0, 2, 4, 6, 8]);
  });

  it('tasks that have no string id are named by their index only: in a failure, and in the progress reports', async () => {
    // a plain number, an object without an id and an object whose id is not a string are all "anonymous"
    const anonymous = [5, { action: 'double', v: 2 }, { id: 7, action: 'double', v: 3 }];
    const progress: PoolProgress[] = [];
    const res = await runPool<unknown, Res>(anonymous, FIXTURE, { threads: 1, onProgress: (p) => progress.push(p) });
    expect(res).toHaveLength(3);
    expect(progress.map((p) => [p.index, p.id, p.ok])).toEqual([[0, undefined, true], [1, undefined, true], [2, undefined, true]]);

    const crashed = await rejection(runPool<unknown, Res>([{ action: 'crash', code: 3 }], FIXTURE, { threads: 1 }));
    expect(crashed).toBeInstanceOf(PoolTaskError);
    expect((crashed as PoolTaskError).taskId).toBeUndefined();
    expect((crashed as Error).message).toBe('worker pool: worker exited with code 3 while running task #0');
    // an unsendable one is named the same way
    const unsendable = await rejection(runPool<unknown, Res>([{ cb: () => 1 }], FIXTURE, { threads: 1 }));
    expect(unsendable).toBeInstanceOf(PoolTaskError);
    expect((unsendable as PoolTaskError).taskId).toBeUndefined();
    expect((unsendable as Error).message).toMatch(/^worker pool: could not send task #0 to a worker \(/);
  });

  it('a callback that throws something that is not an Error rejects the pool with an Error that carries its text', async () => {
    const fromResult = await rejection(runPool<Task, Res>(doubles(3), FIXTURE, { threads: 1, onResult: () => { throw 'plain string'; } }));
    expect(fromResult).toBeInstanceOf(Error);
    expect((fromResult as Error).message).toBe('plain string');
    const fromMapper = await rejection(runPool<Task, Res>([{ id: 'x', action: 'crash' }, ...doubles(2)], FIXTURE, { threads: 1, onTaskError: () => { throw 42; } }));
    expect(fromMapper).toBeInstanceOf(Error);
    expect((fromMapper as Error).message).toBe('42');
  });

  it('the reason of an abort goes into the message and the cause as it is: a string, or null (reported as "aborted")', async () => {
    const abortWith = async (reason: unknown): Promise<PoolAbortError> => {
      const ac = new AbortController();
      let first = true;
      const e = await rejection(runPool<Task, Res>(slow(4, 100), FIXTURE, { threads: 2, signal: ac.signal, onResult: () => { if (first) { first = false; ac.abort(reason); } } }));
      expect(e).toBeInstanceOf(PoolAbortError);
      return e as PoolAbortError;
    };
    const withText = await abortWith('stop it');
    expect(withText.reason).toBe('signal');
    expect(withText.completed).toBe(1);
    expect(withText.message).toMatch(/cancelled after 1 of 4 tasks \(stop it\)$/);
    expect(withText.cause).toBe('stop it');
    const withNull = await abortWith(null);
    expect(withNull.message).toMatch(/cancelled after 1 of 4 tasks \(aborted\)$/);
    expect(withNull.cause).toBeNull();
  });

  it('the first failure wins: a callback that cancels the pool and then throws is reported as the cancellation', async () => {
    const before = signalListeners();
    const ac = new AbortController();
    const e = await rejection(runPool<Task, Res>(slow(4, 50), FIXTURE, {
      threads: 2, signal: ac.signal, onResult: () => { ac.abort(new Error('user cancelled')); throw new Error('callback failed'); },
    }));
    expect(e).toBeInstanceOf(PoolAbortError);
    expect((e as Error).message).toContain('user cancelled');
    expect((e as Error).message).not.toContain('callback failed');
    expect(signalListeners()).toEqual(before);
  });

  it('a worker that cannot even be created rejects with the error of the Worker constructor, not as a task failure, and onTaskError is not consulted', async () => {
    const before = signalListeners();
    const nowhere = new URL('https://example.invalid/pool.worker.mjs'); // a worker script must be a file: URL
    const mapped: string[] = [];
    for (const options of [{ threads: 2 }, { threads: 2, onTaskError: (e: PoolTaskError, t: Task) => { mapped.push(t.id); return asResult(e, t); } }]) {
      const e = await rejection(runPool<Task, Res>(doubles(3), nowhere, options));
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(PoolTaskError);
      expect((e as NodeJS.ErrnoException).code).toBe('ERR_INVALID_URL_SCHEME');
    }
    expect(mapped).toEqual([]);
    expect(signalListeners()).toEqual(before); // the listeners installed for the run are gone again
  });

  it('a reply from a worker that has no task any more is ignored: one result per task, the first reply counts', async () => {
    const seen: number[] = [];
    // 'dup' answers its task twice; the pool has nothing left to hand out, so the second reply finds an idle worker
    const tasks: Task[] = [{ id: 'wait', action: 'slow', v: 7, ms: 300 }, { id: 'dup', action: 'twice', v: 5 }];
    const res = await runPool<Task, Res>(tasks, FIXTURE, { threads: 2, onResult: (_r, i) => seen.push(i) });
    expect(res.map((r) => r.v)).toEqual([7, 10]);
    expect(seen.sort()).toEqual([0, 1]);
  });

  it('an uncaught error in a worker whose value is not an Error object is reported by its text', async () => {
    const e = await rejection(runPool<Task, Res>([{ id: 'str', action: 'throwString' }], FIXTURE, { threads: 1 }));
    expect(e).toBeInstanceOf(PoolTaskError);
    expect((e as Error).message).toBe('worker pool: uncaught worker error (plain string thrown in str) while running task #0 (str)');
    expect((e as Error).cause).toBe('plain string thrown in str');
  });
});
