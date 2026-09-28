/// <reference types="node" />
/**
 * Worker for bench/convergence.ts: runs one configuration to the end and returns its flat-top
 * averages, with an optional upper limit on the internal time step of a self-stepping (1.5D) model.
 */
import { parentPort } from 'node:worker_threads';
import { flatTopAverages } from '../src/physics/analysis/flatTop';
import { Simulation } from '../src/physics/simulation';
import type { ReactorConfig } from '../src/physics/types';

export interface ConvTask { id: string; cfg: ReactorConfig; dtMax?: number }
export interface ConvResult { id: string; ok: boolean; error?: string; avg?: Record<string, number>; ms?: number; steps?: number }

/**
 * Limits the internal step of a model that advances itself (model.step), such as the 1.5D profile
 * model, whose adaptive Δt is otherwise capped at 0.5 s inside the model. The model keeps Δt in a
 * private field that it reuses as the next proposal; lowering it before each step caps every step.
 * APPROXIMATION of a missing configuration option (ProfileSettings has no dtMax yet).
 */
function limitStep(sim: Simulation, dtMax: number): void {
  const m = sim.model as unknown as { step?: (t: number, y: Float64Array, tMax: number) => number; dt?: unknown };
  if (typeof m.step !== 'function' || typeof m.dt !== 'number') throw new Error('this model has no internal time step to limit');
  const step = m.step.bind(m);
  const own = m as { dt: number };
  m.step = (t, y, tMax) => {
    own.dt = Math.min(own.dt, dtMax);
    return step(t, y, tMax);
  };
}

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
