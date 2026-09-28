// Child-process script for pool.test.ts: the "deferred await" pattern of figures.cli.ts — start a
// pool, do other awaited work on the main thread, await the pool afterwards — with SIGINT raised
// during the other work. Emitting the event (instead of a real signal) works on Windows too.
//   positional  runPool(tasks, url, threads): installs no signal listener, so the pool is not
//               cancelled (a real Ctrl-C would end the process through Node's default handler)
//   options     runPool(tasks, url, { threads }) with a handler attached at once: the pool is
//               cancelled and the later await sees the PoolAbortError, with no unhandled rejection
import { PoolAbortError, runPool } from '../pool';

const mode = process.argv[2];
const url = new URL('./pool-fixture.worker.mjs', import.meta.url);
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });

const before = process.listenerCount('SIGINT');
const pending = mode === 'positional'
  ? runPool(Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, action: 'slow', v: i, ms: 150 })), url, 2)
  : runPool(Array.from({ length: 4 }, (_, i) => ({ id: `h${i}`, action: 'hang' })), url, { threads: 2 });
if (mode !== 'positional') pending.catch(() => {});
const during = process.listenerCount('SIGINT');
setTimeout(() => process.emit('SIGINT', 'SIGINT'), 100);
await new Promise((r) => setTimeout(r, 500)); // the main-thread work
const listeners = { before, during, after: process.listenerCount('SIGINT') };
try {
  const res = await pending;
  console.log(JSON.stringify({ settled: 'resolved', n: res.length, unhandled, listeners }));
} catch (e) {
  console.log(JSON.stringify({ settled: 'rejected', abort: e instanceof PoolAbortError, unhandled, listeners }));
  process.exitCode = 130;
}
