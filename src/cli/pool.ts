/// <reference types="node" />
/**
 * Çok çekirdekli iş havuzu (Node worker_threads). Her işçi görevleri sırayla işler; sonuçlar
 * görev sırasıyla döner. tsx altında işçiler ana sürecin execArgv'sini (TS yükleyicisi) miras alır.
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export function defaultThreads(): number {
  return Math.max(1, availableParallelism() - 1);
}

export async function runPool<T, R>(tasks: T[], workerUrl: URL, threads = defaultThreads(), onResult?: (r: R, i: number) => void): Promise<R[]> {
  const results: R[] = new Array(tasks.length);
  let next = 0, done = 0;
  const n = Math.min(threads, tasks.length);
  if (n === 0) return results;
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const finish = () => { for (const w of workers) void w.terminate(); resolve(results); };
    for (let k = 0; k < n; k++) {
      const w = new Worker(workerUrl);
      workers.push(w);
      let current = -1;
      const feed = () => {
        if (next >= tasks.length) return;
        current = next++;
        w.postMessage(tasks[current]);
      };
      w.on('message', (r: R) => {
        results[current] = r;
        onResult?.(r, current);
        if (++done === tasks.length) finish(); else feed();
      });
      w.on('error', (e) => { for (const x of workers) void x.terminate(); reject(e); });
      feed();
    }
  });
}
