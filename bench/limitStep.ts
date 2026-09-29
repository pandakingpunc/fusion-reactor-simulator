/// <reference types="node" />
/**
 * An upper limit on the internal time step of a model that advances itself (`model.step`), such as
 * the 1.5D profile model, whose adaptive Δt is otherwise capped at 0.5 s inside the model. For
 * bench/convergence.worker.ts.
 *
 * The model keeps its Δt in the shared context (`ProfileModel.ctx.dt`, since the split of model.ts;
 * before it was a private field of the model) and reuses it as the next proposal; lowering it before
 * each step caps every step. APPROXIMATION of a missing configuration option (ProfileSettings has no
 * dtMax yet).
 */
import type { Simulation } from '../src/physics/simulation';

export function limitStep(sim: Simulation, dtMax: number): void {
  const m = sim.model as unknown as { step?: (t: number, y: Float64Array, tMax: number) => number; ctx?: { dt?: unknown } };
  const ctx = m.ctx as { dt: number } | undefined;
  if (typeof m.step !== 'function' || typeof ctx?.dt !== 'number') throw new Error('this model has no internal time step to limit');
  const step = m.step.bind(m);
  m.step = (t, y, tMax) => {
    ctx.dt = Math.min(ctx.dt, dtMax);
    return step(t, y, tMax);
  };
}
