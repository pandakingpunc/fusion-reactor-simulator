// Child-process script for pool.shutdown.test.ts: runs a pool that ends in the way given as argument
// (success | error | timeout | abort), prints how many of the workers the pool terminated are still running
// at the moment its promise settles (none, when the pool waits for the threads to stop before it settles)
// and then ends the process at once with process.exit(3). That is the one way a caller can end the process
// while worker threads are still stopping: a process that ends by itself stays alive until they have exited.
import { writeSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { runPool } from '../pool';

const how = process.argv[2];

// every worker the pool terminates, to check that its thread has stopped (threadId is -1 then)
const terminated: Worker[] = [];
const terminate = Worker.prototype.terminate;
Worker.prototype.terminate = function (this: Worker) { terminated.push(this); return terminate.call(this); };

const url = new URL('./pool-fixture.worker.mjs', import.meta.url);
const hangs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, action: 'hang' }));
const spins = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, action: 'spin' }));
const doubles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, action: 'double', v: i }));

let pending: Promise<unknown>;
switch (how) {
  case 'success': pending = runPool(doubles(8), url, { threads: 4, handleSignals: false }); break;
  case 'error': pending = runPool([...spins(2), { id: 'bad', action: 'throw' }, ...hangs(3)], url, { threads: 4, handleSignals: false }); break;
  case 'timeout': pending = runPool([...spins(2), ...hangs(4)], url, { threads: 3, timeoutMs: 200, handleSignals: false }); break;
  case 'abort': {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    pending = runPool([...spins(3), ...hangs(3)], url, { threads: 3, signal: ac.signal, handleSignals: false });
    break;
  }
  default: console.error(`unknown mode ${how}`); process.exit(2);
}

let outcome = 'resolved';
try { await pending; } catch { outcome = 'rejected'; }
// written synchronously: nothing may be left in a buffer when the process ends
writeSync(1, JSON.stringify({ how, outcome, terminated: terminated.length, alive: terminated.filter((w) => w.threadId !== -1).length }) + '\n');
process.exit(3);
