/**
 * Runs the simulations of an ensemble in-process: {@link simulateMetrics} for one configuration (also what a pool worker
 * calls) and {@link serialRunner}, a {@link BatchRunner} that works through the tasks one after the other. The pool
 * version is in node/ensembleRunner.ts. Pure TypeScript, no DOM or Node API.
 */
import { Simulation } from '../physics/simulation';
import type { ReactorConfig } from '../physics/types';
import type { BatchRunner, SimOutcome, SimTask } from './ensemble';
import { runMetrics } from './metrics';

/** Runs one configuration to its end and returns its metrics; a run that throws is reported as a failed outcome, not raised. */
export function simulateMetrics(cfg: ReactorConfig): SimOutcome {
  try {
    const sim = new Simulation(cfg);
    const report = sim.runAll();
    return { ok: true, metrics: runMetrics(sim.history, sim.events, report) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/** In-process runner: the tasks one after the other, progress after each; the outcomes are in task order. */
export const serialRunner: BatchRunner = async (tasks: SimTask[], onProgress) => {
  const out: SimOutcome[] = [];
  let failed = 0;
  for (const t of tasks) {
    const o = simulateMetrics(t.cfg);
    if (!o.ok) failed++;
    out.push(o);
    onProgress?.({ done: out.length, total: tasks.length, failed });
    // let the event loop breathe between shots (a long ensemble must not block timers or signals)
    if (out.length % 16 === 0) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return out;
};
