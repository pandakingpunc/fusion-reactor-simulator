/// <reference types="node" />
/**
 * The flags of the uq command (src/cli/uq.cli.ts) and the conversion of parsed flags into an ensemble specification, kept apart
 * from the entry point so that they can be tested in-process (the entry point starts a worker pool).
 */
import { PRESETS } from '../physics/presets';
import { EnsemblePlan, EnsembleSpec, SimOutcome, planEnsemble, resolveSpec, summarizeEnsemble, toCsv, toJson } from '../analysis/ensemble';
import { SAMPLER_KINDS } from '../analysis/samplers';
import { H98_SIGMA, defaultPriors } from '../analysis/priors';
import { METRIC_KEYS } from '../analysis/metrics';
import { buildPriors, formatEnsemble, parseLevels, parseParam, parseProbability, presetConfig } from '../analysis/cliSupport';
import { ParsedArgs, defineCli } from './args';

export const UQ_CLI = defineCli({
  name: 'npx tsx src/cli/uq.cli.ts',
  summary: 'Uncertainty quantification of a preset by ensembles of full simulations: probabilities (Q >= target, disruption, n/n_G > 1),\n' +
    "quantiles of Q and P_fus, rank correlations and, with --analysis sensitivity, Sobol' first-order and total indices with\n" +
    'bootstrap intervals. EDUCATIONAL: results describe the reduced-order model under the stated priors, not a real device.',
  flags: {
    preset: { type: 'string', required: true, choices: PRESETS.map((p) => p.id), metavar: 'ID', help: 'preset to study (magnetic presets have default priors)' },
    n: { type: 'int', default: 64, min: 1, help: 'shots (propagate) or base sample size of the Saltelli design (sensitivity: n (d + 2) shots); a power of two for sobol' },
    analysis: { type: 'string', default: 'propagate', choices: ['propagate', 'sensitivity'], help: 'propagate the priors, or also compute Sobol indices' },
    sampler: { type: 'string', default: 'sobol', choices: SAMPLER_KINDS, help: 'design of the samples' },
    seed: { type: 'int', default: 1, min: 0, max: 4294967295, help: 'seed of the design and of the bootstrap' },
    param: {
      type: 'list', metavar: 'PATH=DIST,…',
      help: 'uncertain parameter and prior, e.g. H98=lognormal:1.0:0.14 (lognormal:median:sigmaLog, normal:mean:sd[:lo:hi], uniform:lo:hi, loguniform:lo:hi, triangular:lo:mode:hi, point:v); replaces the default prior of that path or adds one',
    },
    priors: { type: 'string', choices: ['default', 'none'], help: 'default priors of a magnetic preset (the default for them) or none (only --param; required for non-magnetic presets)' },
    'h98-prior': { type: 'string', default: 'ipb98y2', choices: Object.keys(H98_SIGMA), help: 'width of the H98 prior: IPB98(y,2) RMSE 14 %, or the ITPA20-IL prediction uncertainty 15.8 %' },
    stochastic: { type: 'bool', help: 'also vary the ELM/jitter random seed of each shot (default: every shot keeps the preset seed)' },
    't-end': { type: 'number', min: 1e-6, metavar: 'S', help: 'override the shot duration [s] (a shorter shot is cheaper but the flat top moves)' },
    'flat-top': { type: 'string', default: 'time', choices: ['frame', 'time'], help: 'weighting of the flat-top means: time (the published definition since v4.0, unbiased by the extra frames at ELMs) or frame (the mean over the frames of v3.0.0)' },
    'q-target': { type: 'number', default: 10, min: 0, help: 'Q of the headline probability P(Q >= target)' },
    prob: { type: 'list', metavar: 'METRIC>=X,…', help: `extra probabilities; metrics: ${METRIC_KEYS.join(', ')}` },
    levels: { type: 'list', metavar: 'P,…', help: 'quantile levels (default 0.05,0.16,0.5,0.84,0.95)' },
    bootstrap: { type: 'int', default: 200, min: 0, help: 'bootstrap resamples for the intervals of quantiles and indices (0 = none)' },
    confidence: { type: 'number', default: 0.95, min: 0.5, max: 0.999, help: 'confidence level of the intervals' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores - 1)' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a shot that runs longer than S seconds' },
    'max-runs': { type: 'int', default: 100000, min: 1, help: 'refuse designs with more shots' },
    json: { type: 'string', metavar: 'FILE', help: 'write the result as JSON to FILE (- for stdout)' },
    csv: { type: 'string', metavar: 'FILE', help: 'write one row per shot as CSV to FILE (- for stdout)' },
    quiet: { type: 'bool', help: 'no progress lines and no text summary' },
    'list-params': { type: 'bool', help: 'print the default priors of the preset and exit' },
  },
  epilog: 'Same seed and options give byte-identical JSON, independent of --threads. Progress goes to stderr. With --json - or --csv -\n' +
    'stdout carries only that data and the text summary goes to stderr.',
});

export type UqArgs = ParsedArgs<typeof UQ_CLI>;

/** The ensemble specification of parsed flags. Throws RangeError (a usage error) for a bad preset, prior, probability or level list. */
export function uqSpecFromArgs(args: UqArgs): EnsembleSpec {
  const cfg = presetConfig(args.preset);
  const magnetic = cfg.method === 'tokamak' || cfg.method === 'spherical_tokamak' || cfg.method === 'stellarator';
  const mode: 'default' | 'none' = (args.priors as 'default' | 'none' | undefined) ?? (magnetic ? 'default' : 'none');
  const h98 = args['h98-prior'] as keyof typeof H98_SIGMA;
  const priors = buildPriors(cfg, mode, (args.param ?? []).map(parseParam), h98);
  return resolveSpec({
    preset: args.preset, base: cfg, priors, n: args.n, sampler: args.sampler as EnsembleSpec['sampler'], seed: args.seed,
    analysis: args.analysis as EnsembleSpec['analysis'], runSeed: args.stochastic ? 'perRow' : 'fixed', tEnd: args['t-end'], flatTop: args['flat-top'] as EnsembleSpec['flatTop'],
    qTarget: args['q-target'], probabilities: (args.prob ?? []).map(parseProbability), quantileLevels: args.levels ? parseLevels(args.levels) : undefined,
    bootstrap: args.bootstrap, confidence: args.confidence, maxRuns: args['max-runs'],
  });
}

/** --list-params: the default priors of the preset with their basis; throws RangeError for a preset without defaults. */
export function uqListParams(args: UqArgs): string {
  const cfg = presetConfig(args.preset);
  if (cfg.method !== 'tokamak' && cfg.method !== 'spherical_tokamak' && cfg.method !== 'stellarator') {
    throw new RangeError(`'${args.preset}' has no default priors (give --param PATH=DIST)`);
  }
  return defaultPriors(cfg, { h98: args['h98-prior'] as keyof typeof H98_SIGMA }).params
    .map((p) => `${p.path.padEnd(30)} ${JSON.stringify(p.dist)}\n${' '.repeat(31)}${p.basis ?? ''}`).join('\n') + '\n';
}

export interface UqPrepared {
  spec: EnsembleSpec;
  plan: EnsemblePlan;
}

/** The specification and the design of parsed flags; throws RangeError (a usage error) for any invalid input. */
export function uqPrepare(args: UqArgs): UqPrepared {
  const spec = uqSpecFromArgs(args);
  return { spec, plan: planEnsemble(spec) };
}

export interface UqOutput {
  json: string;
  csv: string;
  text: string;
  /** shots that ran to a result */
  valid: number;
}

/** The reports (JSON, CSV, text) of the outcomes of a prepared ensemble. */
export function uqReport(prep: UqPrepared, outcomes: readonly SimOutcome[]): UqOutput {
  const result = summarizeEnsemble(prep.plan, outcomes);
  return { json: toJson(result), csv: toCsv(prep.plan, outcomes), text: formatEnsemble(result), valid: result.runs.valid };
}
