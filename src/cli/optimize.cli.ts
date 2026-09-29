/// <reference types="node" />
/**
 * Design optimisation on the steady-state (POPCON) power balance of a tokamak preset: the smallest machine, the lowest heating
 * power or the highest gain that satisfies the usual limits, found with an augmented Lagrangian / Nelder-Mead solver.
 *
 *   npx tsx src/cli/optimize.cli.ts --preset ITER --objective major-radius --q-min 10
 *   npx tsx src/cli/optimize.cli.ts --preset SPARC --objective gain --vars fG,T --q-min 0 --json best.json
 *   npx tsx src/cli/optimize.cli.ts --preset ITER --objective aux-power --vars B0,Ip,fG,T --bound B0=4:6
 *
 * See src/analysis/design.ts for the variables, the constraints and their defaults (the preset's own limits and installed
 * heating power). The solver is deterministic and the JSON contains no timing information: the same problem gives
 * byte-identical JSON. EDUCATIONAL: the optimum is a property of the reduced model, not a design.
 *
 * Exit codes: 0 done (a problem with no feasible design is reported and exits 1); 1 no feasible design; 2 usage error.
 */
import { PRESETS } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { defineCli, exitUsage, parseArgsOrExit } from './args';
import { DESIGN_OBJECTIVES, DESIGN_VARS, DesignConstraints, DesignMethod, DesignObjective, DesignSpec, DesignVarName, designReport, paretoReport } from '../analysis/design';
import { formatDesign, formatPareto, parseBound, presetConfig } from '../analysis/cliSupport';
import { toJson } from '../analysis/ensemble';
import { writeOutput } from '../analysis/node/output';

const TOKAMAKS = PRESETS.filter((p) => (p.cfg.method === 'tokamak' || p.cfg.method === 'spherical_tokamak') && (p.cfg as MagneticConfig).fidelity !== '1.5D').map((p) => p.id);

const CLI = defineCli({
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
    json: { type: 'string', metavar: 'FILE', help: 'write the report as JSON to FILE (- for stdout)' },
    quiet: { type: 'bool', help: 'no text summary' },
  },
  epilog: 'Same problem, byte-identical JSON. With --json - stdout carries only the JSON and the text summary goes to stderr.',
});

async function main(): Promise<void> {
  const args = parseArgsOrExit(CLI);
  let spec: DesignSpec;
  try {
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
    spec = { base, objective, method: args.solver as DesignMethod, variables: args.vars as DesignVarName[], bounds, constraints, startTemperatures: temps, solver: { maxEvals: args['max-evals'] } };
  } catch (e) {
    if (e instanceof RangeError) exitUsage(CLI.name, e.message);
    throw e;
  }
  if (args.pareto) {
    let rep;
    try {
      rep = paretoReport({ ...spec, objectives: [args.pareto[0] as DesignObjective, args.pareto[1] as DesignObjective], popSize: args['pop-size'], generations: args.generations, seed: args.seed }, args.preset);
    } catch (e) {
      if (e instanceof RangeError) exitUsage(CLI.name, e.message);
      throw e;
    }
    if (args.json !== undefined) writeOutput(args.json, toJson(rep));
    if (!args.quiet) {
      const text = formatPareto(rep);
      if (args.json === '-') process.stderr.write(text); else process.stdout.write(text);
    }
    if (!rep.result.feasibleFound) {
      process.stderr.write('optimize: no feasible design found (see the constraints)\n');
      process.exitCode = 1;
    }
    return;
  }
  let report;
  try {
    report = designReport(spec, args.preset);
  } catch (e) {
    if (e instanceof RangeError) exitUsage(CLI.name, e.message);
    throw e;
  }
  if (args.json !== undefined) writeOutput(args.json, toJson(report));
  if (!args.quiet) {
    const text = formatDesign(report);
    if (args.json === '-') process.stderr.write(text); else process.stdout.write(text);
  }
  if (!report.result.feasible) {
    process.stderr.write('optimize: no feasible design found (see the violated constraints)\n');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
