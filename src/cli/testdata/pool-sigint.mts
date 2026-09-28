// Child-process script for pool.test.ts: starts a pool of never-answering tasks, raises SIGINT in
// this process once they run and prints how the pool settled. Emitting the event (instead of a real
// signal) works on Windows too, where a signal sent by another process cannot be caught.
// If the pool did not terminate its workers, this process would never exit.
import { PoolAbortError, runPool } from '../pool';

const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, action: 'hang' }));
const before = process.listenerCount('SIGINT');
const pending = runPool(tasks, new URL('./pool-fixture.worker.mjs', import.meta.url), { threads: 2 });
const during = process.listenerCount('SIGINT');
setTimeout(() => process.emit('SIGINT', 'SIGINT'), 300);
try {
  await pending;
  console.log(JSON.stringify({ settled: 'resolved' }));
} catch (e) {
  console.log(JSON.stringify({
    settled: 'rejected',
    abort: e instanceof PoolAbortError,
    reason: e instanceof PoolAbortError ? e.reason : undefined,
    completed: e instanceof PoolAbortError ? e.completed : undefined,
    message: e instanceof Error ? e.message : String(e),
    listeners: { before, during, after: process.listenerCount('SIGINT') },
  }));
  process.exitCode = 130;
}
