/// <reference types="node" />
/**
 * Pool worker for the golden harness: runs one case and returns its snapshot.
 */
import { parentPort } from 'node:worker_threads';
import { GoldenCase, GoldenSnapshot, runGoldenCase } from './golden';

export interface GoldenTask { id: string; case: GoldenCase }
export interface GoldenResult { id: string; ok: boolean; snapshot?: GoldenSnapshot; error?: string; ms: number }

parentPort!.on('message', (task: GoldenTask) => {
  const t0 = performance.now();
  try {
    const snapshot = runGoldenCase(task.case);
    parentPort!.postMessage({ id: task.id, ok: true, snapshot, ms: performance.now() - t0 } satisfies GoldenResult);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e), ms: performance.now() - t0 } satisfies GoldenResult);
  }
});
