/// <reference types="node" />
/**
 * Worker for bench/convergence.ts: runs one configuration to the end and returns its flat-top
 * averages, with an optional upper limit on the internal time step of a self-stepping (1.5D) model.
 */
import { parentPort } from 'node:worker_threads';
import { flatTopAverages } from '../src/physics/analysis/flatTop';
import { Simulation } from '../src/physics/simulation';
import type { ReactorConfig } from '../src/physics/types';
import { limitStep } from './limitStep';

export interface ConvTask { id: string; cfg: ReactorConfig; dtMax?: number }
export interface ConvResult { id: string; ok: boolean; error?: string; avg?: Record<string, number>; ms?: number; steps?: number }

parentPort!.on('message', (task: ConvTask) => {
  const t0 = performance.now();
  try {
    const sim = new Simulation(task.cfg);
    if (task.dtMax !== undefined) limitStep(sim, task.dtMax);
    sim.runAll();
    parentPort!.postMessage({ id: task.id, ok: true, avg: flatTopAverages(sim.history), ms: performance.now() - t0, steps: sim.nSteps } satisfies ConvResult);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies ConvResult);
  }
});
