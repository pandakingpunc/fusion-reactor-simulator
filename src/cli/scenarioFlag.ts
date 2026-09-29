/// <reference types="node" />
/**
 * The `--scenario FILE` flag of the study tools (scan, uq, optimize; `fusion-sim run` has its own copy of this logic in
 * fusionSim/runCmd.ts): reads the scenario file, checks it up front and hands the tools a scenario that is known to fit the
 * configuration they study.
 *
 * "Up front" means the checks are made before any shot runs, and fail as a usage error (RangeError, exit code 2) that lists every
 * problem with its path, like an invalid configuration: the file is readable JSON (size, syntax), the scenario is well formed (its
 * structure, values inside the sanity limits) and it fits the model of the base configuration (it only names controls the model
 * exposes and diagnostics its frames carry, a rampStep is not finer than t_end / 10^4, a null point has a configured value). The
 * model is built once for this (its controls, diagnostics and end time are what the scenario is checked against), so a file with
 * a structural error and an unknown control reports both, not one after the other.
 * A parameter of the study that changes what the model exposes (or t_end) is not covered: a shot that fails for it is a failed shot
 * of the study, as any other failure.
 *
 * The hash of a scenario is the SHA-256 of its canonical JSON text (scenarioToJSON): the same hash that `fusion-sim run` writes as
 * `provenance.scenarioSha256` and the csv, ndjson, netcdf and imas exports embed.
 */
import fs from 'node:fs';
import { ScenarioError, type ScenarioIssue } from '../physics/kernel/errors';
import { Simulation } from '../physics/simulation';
import { Scenario, isEmptyScenario, scenarioFromJSON, type ScenarioSpec } from '../physics/scenario';
import type { ReactorConfig } from '../physics/types';

export interface LoadedScenario {
  file: string;
  /** the validated, normalised scenario */
  spec: ScenarioSpec;
  /** the scenario neither drives a control nor reacts to anything: attaching it changes nothing, the tools leave it out */
  empty: boolean;
}

/** Every problem of a scenario file with its path (the message of the usage error). */
export function scenarioFileProblems(file: string, issues: readonly ScenarioIssue[]): string {
  return `--scenario ${file}: invalid scenario (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n${issues.map((i) => `  ${i.path ? `${i.path}: ` : ''}${i.message}`).join('\n')}`;
}

/**
 * Reads and checks a scenario file for the study of `base` (with the shot duration `tEnd` when the study overrides it).
 * Throws RangeError, whose message lists the problems, for anything a usage error should say.
 */
export function loadScenarioFile(file: string, base: ReactorConfig, opts: { tEnd?: number } = {}): LoadedScenario {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new RangeError(`--scenario ${file}: cannot read the file (${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    // the model of the study: what a scenario may name and how long the shot is
    const cfg = opts.tEnd !== undefined ? ({ ...base, t_end: opts.tEnd } as ReactorConfig) : base;
    const sim = new Simulation(cfg);
    const controls = sim.model.getControls();
    const ctx = { controls: Object.keys(controls), diagnostics: Object.keys(sim.history[0].d), tEnd: sim.model.tEnd };
    const spec = scenarioFromJSON(text, ctx);
    new Scenario(spec, controls, ctx); // the engine's own construction: a null point needs a configured value of its control
    return { file, spec, empty: isEmptyScenario(spec) };
  } catch (e) {
    if (e instanceof ScenarioError) throw new RangeError(scenarioFileProblems(file, e.issues));
    throw e;
  }
}
