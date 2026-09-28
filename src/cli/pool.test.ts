import { describe, expect, it } from 'vitest';
import { PoolConfigError, PoolTaskError, checkThreads, runPool } from './pool';

interface Task { id: string; action: 'double' | 'throw' | 'exit'; v?: number; code?: number }
interface Res { id: string; v: number }
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

  it('a worker that fails to load rejects', async () => {
    const e = await rejection(runPool<Task, Res>(doubles(3), BROKEN, 2));
    expect(e).toBeInstanceOf(PoolTaskError);
    expect((e as Error).message).toMatch(/fixture failed to load/);
  });
});
