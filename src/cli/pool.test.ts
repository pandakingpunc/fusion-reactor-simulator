/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PoolAbortError, PoolConfigError, PoolProgress, PoolTaskError, checkThreads, runPool } from './pool';

interface Task { id: string; action: 'double' | 'echo' | 'slow' | 'hang' | 'spin' | 'throw' | 'crash' | 'exit'; v?: number; code?: number; ms?: number }
interface Res { id: string; v: number | null; error?: string }
const FIXTURE = new URL('./testdata/pool-fixture.worker.mjs', import.meta.url);
const BROKEN = new URL('./testdata/pool-broken.worker.mjs', import.meta.url);
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

  it('removes its SIGINT/SIGTERM listeners when it settles, and handleSignals: false adds none', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const p = runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1 });
    expect(process.listenerCount('SIGINT')).toBe(before[0] + 1);
    await p;
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
    const q = runPool<Task, Res>(doubles(2), FIXTURE, { threads: 1, handleSignals: false });
    expect(process.listenerCount('SIGINT')).toBe(before[0]);
    await q;
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
});
