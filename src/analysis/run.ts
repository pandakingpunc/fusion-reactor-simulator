/**
 * Runs the simulations of an ensemble in-process: {@link simulateMetrics} for one configuration (also what a pool worker
 * calls) and {@link serialRunner}, a {@link BatchRunner} that works through the tasks one after the other. The pool
 * version is in node/ensembleRunner.ts. Pure TypeScript, no DOM or Node API.
 */
import { Simulation } from '../physics/simulation';
import type { ReactorConfig } from '../physics/types';
import type { ScenarioSpec } from '../physics/scenario';
import { formatIssue, validateConfig } from '../physics/config/schema';
import type { BatchRunner, SimOutcome, SimTask } from './ensemble';
import { MetricsOptions, runMetrics } from './metrics';

/**
 * Runs one configuration to its end and returns its metrics; a run that throws is reported as a failed outcome, not raised.
 * So is a configuration outside the domain of the model (a sampled or scanned value the configuration schema rejects, e.g. a
 * fuel fraction above 1): the model would run it to meaningless metrics (a negative fusion power) that count as a valid shot.
 */
export function simulateMetrics(cfg: ReactorConfig, opts: MetricsOptions & { scenario?: ScenarioSpec } = {}): SimOutcome {
  try {
    // every issue on one line (the reports keep the first line of an error); a property the schema does not know is no
    // issue here: the model ignores it, and --t-end gives a t_end to the families that have no shot duration (ICF, MTF, muon)
    const v = validateConfig(cfg, { unknownKeys: 'ignore' });
    if (!v.ok) return { ok: false, error: `ConfigValidationError: ${v.issues.map(formatIssue).join('; ')}` };
    const { scenario, ...metricsOpts } = opts;
    const sim = new Simulation(cfg, scenario ? { scenario } : {});
    const report = sim.runAll();
    return { ok: true, metrics: runMetrics(sim.history, sim.events, report, metricsOpts) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/** In-process runner: the tasks one after the other, progress after each; the outcomes are in task order. */
export const serialRunner: BatchRunner = async (tasks: SimTask[], onProgress) => {
  const out: SimOutcome[] = [];
  let failed = 0;
  for (const t of tasks) {
    const o = simulateMetrics(t.cfg, { weighting: t.weighting, scenario: t.scenario });
    if (!o.ok) failed++;
    out.push(o);
    onProgress?.({ done: out.length, total: tasks.length, failed });
    // let the event loop breathe between shots (a long ensemble must not block timers or signals)
    if (out.length % 16 === 0) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return out;
};
