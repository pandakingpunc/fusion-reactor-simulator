/// <reference types="node" />
/**
 * The flags of the optimize command (src/cli/optimize.cli.ts) and everything it does short of writing files: turning parsed flags into
 * a design (or Pareto) specification, solving it, and rendering the JSON and text reports. Kept apart from the entry point so that it can
 * be tested in-process.
 */
import { PRESETS } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { Simulation } from '../physics/simulation';
import { ScenarioError } from '../physics/kernel/errors';
import type { ScenarioSpec } from '../physics/scenario';
import { DESIGN_OBJECTIVES, DESIGN_VARS, DesignConstraints, DesignMethod, DesignObjective, DesignReport, DesignSpec, DesignValues, DesignVarName, designPoint, designReport, paretoReport, presetDesign } from '../analysis/design';
import { formatDesign, formatPareto, parseBound, presetConfig } from '../analysis/cliSupport';
import { ScenarioRecord, scenarioRecord, toJson } from '../analysis/ensemble';
import { ParsedArgs, defineCli } from './args';
import { loadScenarioFile, scenarioFileProblems } from './scenarioFlag';

const TOKAMAKS = PRESETS.filter((p) => (p.cfg.method === 'tokamak' || p.cfg.method === 'spherical_tokamak') && (p.cfg as MagneticConfig).fidelity !== '1.5D').map((p) => p.id);

export const OPTIMIZE_CLI = defineCli({
  name: 'npx tsx src/cli/optimize.cli.ts',
  summary: 'Design optimisation of a tokamak preset on the steady-state power balance (POPCON fixed point) with an augmented Lagrangian\n' +
    'solver: minimise the major radius, plasma volume or auxiliary power, or maximise the fusion power or gain, under limits on Q, beta_N,\n' +
    'q95, H-mode access, heating power, TF coil field and aspect ratio. EDUCATIONAL: the optimum belongs to the reduced model.',
  flags: {
    preset: { type: 'string', required: true, choices: TOKAMAKS, metavar: 'ID', help: 'tokamak or spherical tokamak preset (0D) that supplies the fuel, impurities, profiles, limits and magnet technology' },
    objective: { type: 'string', default: 'major-radius', choices: DESIGN_OBJECTIVES, help: 'figure of merit' },
    pareto: { type: 'list', choices: DESIGN_OBJECTIVES, metavar: 'A,B', help: 'instead of one objective: the Pareto front of two objectives (NSGA-II), e.g. major-radius,aux-power' },
    solver: { type: 'string', default: 'nelder-mead', choices: ['nelder-mead', 'cma-es'], help: 'inner solver of the augmented Lagrangian (single objective)' },
    'pop-size': { type: 'int', default: 100, min: 8, help: 'Pareto: NSGA-II population size (a multiple of 4)' },
    generations: { type: 'int', default: 100, min: 1, help: 'Pareto: NSGA-II generations' },
    seed: { type: 'int', default: 1, min: 0, max: 4294967295, help: 'Pareto: seed of NSGA-II' },
    vars: { type: 'list', default: ['R', 'a', 'B0', 'Ip', 'fG', 'T'], choices: DESIGN_VARS, metavar: 'NAME,…', help: 'design variables: major/minor radius R, a [m], field B0 [T], current Ip [MA], line-averaged density over the Greenwald density fG, temperature T [keV], H98, elongation kappa' },
    bound: { type: 'list', metavar: 'NAME=LO:HI,…', help: 'bounds of a variable (default: 0.6 to 1.5 times the preset for R, a, B0, Ip; fG 0.1 to the Greenwald limit; T 2 to 40 keV; H98 0.8 to 1.5; kappa +-20 %)' },
    'q-min': { type: 'number', min: 0, help: 'steady-state Q at least this (default 10, or none for --objective gain; 0 = no constraint)' },
    'beta-n-max': { type: 'number', min: 0.1, help: 'beta_N at most this (default: the preset limit)' },
    'q95-min': { type: 'number', min: 0.5, help: 'q95 at least this (default: max(3, preset limit))' },
    'lh-margin': { type: 'number', min: 0, help: 'P_L / P_LH at least this (default 1; 0 = no constraint)' },
    'paux-max': { type: 'number', min: 0, metavar: 'MW', help: 'auxiliary power at most this (default: the preset installed power; 0 = no limit)' },
    'no-coil': { type: 'bool', help: 'do not limit the TF coil peak field and stress' },
    'aspect-min': { type: 'number', min: 1.05, help: 'aspect ratio R/a at least this (default 0.6 times the preset)' },
    'aspect-max': { type: 'number', min: 1.1, help: 'aspect ratio R/a at most this (default 1.6 times the preset)' },
    'pfus-min': { type: 'number', min: 0, metavar: 'MW', help: 'fusion power at least this' },
    'wall-load-max': { type: 'number', min: 0, metavar: 'MW/M2', help: 'neutron wall load at most this' },
    'start-temps': { type: 'list', default: ['6', '10', '16', '25'], metavar: 'KEV,…', help: 'starting temperatures of the multi-start [keV]' },
    'max-evals': { type: 'int', min: 100, default: 200000, help: 'evaluation budget of one start' },
    scenario: { type: 'string', metavar: 'FILE', help: 'scenario JSON file (schema 1): after a single-objective optimum is found, the optimised machine is run as a time-dependent shot with this scenario (the preset\'s heating and density ramp) and the outcome is reported next to the design (scenarioCheck in the JSON). The steady-state solution itself does not depend on it. Checked against the preset before anything runs; not for --pareto' },
    json: { type: 'string', metavar: 'FILE', help: 'write the report as JSON to FILE (- for stdout)' },
    quiet: { type: 'bool', help: 'no text summary' },
  },
  epilog: 'Same problem, byte-identical JSON. With --json - stdout carries only the JSON and the text summary goes to stderr.',
});

export type OptimizeArgs = ParsedArgs<typeof OPTIMIZE_CLI>;

/** The design specification of parsed flags. Throws RangeError (a usage error) for bad bounds or start temperatures. */
export function optimizeSpecFromArgs(args: OptimizeArgs): DesignSpec {
  const base = presetConfig(args.preset) as MagneticConfig;
  const objective = args.objective as DesignObjective;
  const bounds: Partial<Record<DesignVarName, [number, number]>> = {};
  for (const b of (args.bound ?? []).map(parseBound)) {
    if (!(DESIGN_VARS as readonly string[]).includes(b.name)) throw new RangeError(`--bound ${b.name}: unknown variable. Valid names: ${DESIGN_VARS.join(', ')}`);
    bounds[b.name as DesignVarName] = [b.lo, b.hi];
  }
  const qMin = args['q-min'] ?? (objective === 'gain' ? 0 : 10);
  const constraints: DesignConstraints = {
    qMin: qMin === 0 ? null : qMin,
    ...(args['beta-n-max'] !== undefined ? { betaNMax: args['beta-n-max'] } : {}),
    ...(args['q95-min'] !== undefined ? { q95Min: args['q95-min'] } : {}),
    ...(args['lh-margin'] !== undefined ? { lhMargin: args['lh-margin'] === 0 ? null : args['lh-margin'] } : {}),
    ...(args['paux-max'] !== undefined ? { pauxMaxMW: args['paux-max'] === 0 ? null : args['paux-max'] } : {}),
    coil: !args['no-coil'],
    ...(args['aspect-min'] !== undefined ? { aspectMin: args['aspect-min'] } : {}),
    ...(args['aspect-max'] !== undefined ? { aspectMax: args['aspect-max'] } : {}),
    ...(args['pfus-min'] !== undefined ? { pfusMinMW: args['pfus-min'] } : {}),
    ...(args['wall-load-max'] !== undefined ? { wallLoadMax: args['wall-load-max'] } : {}),
  };
  const temps = args['start-temps'].map(Number);
  if (temps.some((t) => !(t > 0.5 && t < 100))) throw new RangeError('--start-temps: each temperature must be between 0.5 and 100 keV');
  if (args.pareto && args.pareto.length !== 2) throw new RangeError('--pareto takes exactly two objectives, e.g. --pareto major-radius,aux-power');
  if (args.pareto && args['pop-size'] % 4 !== 0) throw new RangeError('--pop-size must be a multiple of 4');
  return { base, objective, method: args.solver as DesignMethod, variables: args.vars as DesignVarName[], bounds, constraints, startTemperatures: temps, solver: { maxEvals: args['max-evals'] } };
}

export interface OptimizeOutput {
  mode: 'single' | 'pareto';
  json: string;
  text: string;
  /** a feasible design (or, for a Pareto run, a feasible front) was found */
  feasible: boolean;
}

/** What a scenario does to the optimised machine when it is run as a shot (the steady-state optimum is not an operating point). */
export interface ScenarioCheck extends ScenarioRecord {
  note: string;
  /** false when no feasible design was found: there is no machine to run */
  ran: boolean;
  shot?: { endReason: string; natural: boolean; duration: number; timeUnit: string; Q_sci_max: number; Tmax_keV: number; E_fusion_MJ: number };
}

const CHECK_NOTE = 'The steady-state optimum is not an operating point: the shot runs the preset\'s heating and density ramp on the optimised machine (its R, a, B0, I_p, H98, kappa and the density of the design), with the scenario.';

/** Runs the optimised machine of a report as a shot with the scenario (its time-dependent counterpart of the steady state). */
export function checkScenarioOnDesign(spec: DesignSpec, report: DesignReport, scenario: ScenarioSpec, file = 'scenario'): ScenarioCheck {
  const record = scenarioRecord(scenario);
  if (!report.result.feasible) return { ...record, note: CHECK_NOTE, ran: false };
  const values: DesignValues = { ...presetDesign(spec.base) };
  for (const v of report.result.variables) values[v.name] = v.value;
  const pt = designPoint(spec.base, values);
  const cfg: MagneticConfig = { ...pt.cfg, n_target: pt.n };
  let rep;
  try {
    rep = new Simulation(cfg, { scenario }).runAll();
  } catch (e) {
    if (e instanceof ScenarioError) throw new RangeError(scenarioFileProblems(file, e.issues));
    throw e;
  }
  return {
    ...record, note: CHECK_NOTE, ran: true,
    shot: { endReason: rep.termination.reason, natural: rep.termination.natural, duration: rep.duration, timeUnit: rep.timeUnit, Q_sci_max: rep.Q_sci_max, Tmax_keV: rep.Tmax_keV, E_fusion_MJ: rep.E_fusion_MJ },
  };
}

/** The text lines of a scenario check. */
export function formatScenarioCheck(c: ScenarioCheck): string {
  const head = `Scenario${c.spec.name ? ` "${c.spec.name}"` : ''} (sha256 ${c.sha256.slice(0, 16)}...) on the optimised machine:`;
  if (!c.ran || !c.shot) return `\n${head} not run (no feasible design).\n`;
  const s = c.shot;
  const f = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(4))) : 'n/a');
  return `\n${head}\n  ${c.note}\n  ended ${s.endReason}${s.natural ? '' : ' (not a planned end)'} after ${f(s.duration)} ${s.timeUnit}; Q_max ${f(s.Q_sci_max)}, T_max ${f(s.Tmax_keV)} keV, E_fusion ${f(s.E_fusion_MJ)} MJ\n`;
}

/** Solves the problem of parsed flags and renders both reports. Throws RangeError for an invalid problem (a usage error). */
export function optimizeRun(args: OptimizeArgs): OptimizeOutput {
  const spec = optimizeSpecFromArgs(args);
  const loaded = args.scenario !== undefined ? loadScenarioFile(args.scenario, spec.base) : undefined;
  if (loaded && args.pareto) throw new RangeError('--scenario applies to a single objective: a Pareto front has no single machine to run the scenario on');
  if (args.pareto) {
    const rep = paretoReport({ ...spec, objectives: [args.pareto[0] as DesignObjective, args.pareto[1] as DesignObjective], popSize: args['pop-size'], generations: args.generations, seed: args.seed }, args.preset);
    return { mode: 'pareto', json: toJson(rep), text: formatPareto(rep), feasible: rep.result.feasibleFound };
  }
  const report = designReport(spec, args.preset);
  const check = loaded && !loaded.empty ? checkScenarioOnDesign(spec, report, loaded.spec, args.scenario) : undefined;
  return {
    mode: 'single', json: toJson(check ? { ...report, scenarioCheck: check } : report), text: formatDesign(report) + (check ? formatScenarioCheck(check) : ''),
    feasible: report.result.feasible,
  };
}
