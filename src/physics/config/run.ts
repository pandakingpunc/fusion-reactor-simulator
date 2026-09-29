/**
 * The whole-shot convenience of the library: validate a configuration, run it to the end and return what
 * the reports and the command line are built from (shot report, flat-top and burn-weighted averages,
 * event counts). It is the in-process counterpart of the worker of src/cli/presetRunner.worker.ts and
 * returns the same numbers for the same configuration.
 */
import type { ReactorConfig, ShotReport } from '../types';
import { Simulation, type SimulationOptions } from '../simulation';
import { flatTopAverages } from '../analysis/flatTop';
import { burnAverages } from '../validation/metrics';
import { assertValidConfig } from './schema';

/** The numbers of a finished run (a subset of RunResult in the CLI worker, without timing). */
export interface RunSummary {
  report: ShotReport;
  /** flat-top averages of every diagnostic (analysis/flatTop.ts) */
  flatTop: Record<string, number>;
  /** fusion-power-weighted averages of T_i and T_e over the whole run (validation/metrics burnAverages) */
  burn: Record<string, number>;
  /** number of events by kind */
  events: Record<string, number>;
  /** accepted kernel steps */
  steps: number;
  /** recorded history frames */
  frames: number;
}

/** Summarises a simulation that has finished (or has been advanced as far as it should). */
export function summarizeRun(sim: Simulation, report: ShotReport = sim.report()): RunSummary {
  const events: Record<string, number> = {};
  for (const e of sim.events) events[e.kind] = (events[e.kind] ?? 0) + 1;
  return { report, flatTop: flatTopAverages(sim.history), burn: burnAverages(sim.history), events, steps: sim.nSteps, frames: sim.history.length };
}

export interface RunShotOptions {
  /** check the configuration first and throw ConfigValidationError with every problem (default true) */
  validate?: boolean;
  /** passed to the Simulation (breakpoints, actuator log, ...) */
  simulation?: SimulationOptions;
}

/**
 * Runs a configuration to its end. The returned `sim` still holds the full history (frames, profiles of a
 * 1.5D run, events) for export. Throws ConfigValidationError for an invalid configuration (unless
 * `validate: false`) and the kernel's typed errors for a model that cannot be built.
 */
export function runShot(cfg: ReactorConfig, opts: RunShotOptions = {}): RunSummary & { sim: Simulation } {
  if (opts.validate ?? true) assertValidConfig(cfg);
  const sim = new Simulation(cfg, opts.simulation);
  const report = sim.runAll();
  return { sim, ...summarizeRun(sim, report) };
}
