/**
 * Long simulation runs in tests without blocking the Vitest worker.
 *
 * Simulation.runAll is synchronous. A run of 20–50 s of wall time never returns to the worker's event
 * loop, so the worker cannot answer the runner's RPC calls, and under coverage (which makes it two to
 * three times slower) the runner reports "[vitest-worker]: Timeout calling onTaskUpdate" and exits
 * non-zero although every test passed. runAllYielding advances in the same chunks as runAll and
 * yields to the event loop after each; the result is bit-identical to runAll's.
 */
import { SYNC_INTERVALS, Simulation } from '../physics/simulation';
import type { ShotReport } from '../physics/types';

const MAX_CHUNKS = 1e6;

/** Lets pending I/O (the worker's RPC) run */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Simulation.runAll with a yield to the event loop after every chunk (tEnd / SYNC_INTERVALS of simulated time) */
export async function runAllYielding(sim: Simulation): Promise<ShotReport> {
  let guard = 0;
  while (!sim.done && guard++ < MAX_CHUNKS) {
    sim.advance(sim.model.tEnd / SYNC_INTERVALS);
    await tick();
  }
  // the loop ended on `done`: runAll ends with its end-of-run call and the report
  return sim.runAll();
}
