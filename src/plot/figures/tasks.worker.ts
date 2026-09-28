/// <reference types="node" />
/**
 * Worker thread of the figures CLI: executes paper-figure pool tasks (preset/scan discharges, the
 * code-verification data, the POPCON grid) and posts the result back (see paper.ts runFigTask).
 */
import { parentPort } from 'node:worker_threads';
import { FigTask, runFigTask } from './paper';

parentPort!.on('message', (task: FigTask) => {
  parentPort!.postMessage(runFigTask(task));
});
