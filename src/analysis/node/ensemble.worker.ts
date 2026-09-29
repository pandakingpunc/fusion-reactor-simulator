/// <reference types="node" />
/**
 * Pool worker of the UQ tools: runs one configuration to its end and answers with its metrics (see ../run.ts). One message
 * in (a SimTask), exactly one message out, as the pool contract in src/cli/pool.ts requires.
 */
import { parentPort } from 'node:worker_threads';
import type { SimOutcome, SimTask } from '../ensemble';
import { simulateMetrics } from '../run';

export type WorkerOutcome = SimOutcome & { id: string };

parentPort!.on('message', (task: SimTask) => {
  const out: WorkerOutcome = { id: task.id, ...simulateMetrics(task.cfg, { weighting: task.weighting, scenario: task.scenario }) };
  parentPort!.postMessage(out);
});
