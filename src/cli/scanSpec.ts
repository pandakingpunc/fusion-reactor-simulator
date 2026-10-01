/// <reference types="node" />
/**
 * The flags of the scan command (src/cli/scan.cli.ts) and the conversion of parsed flags into a scan specification, kept apart from
 * the entry point so that they can be tested in-process.
 */
import { PRESETS } from '../physics/presets';
import { SAMPLER_KINDS } from '../analysis/samplers';
import { SimOutcome, toCsv, toJson } from '../analysis/ensemble';
import { ScanPlan, ScanSpec, planScan, summarizeScan } from '../analysis/scan';
import { formatScan, parseAxis, presetConfig } from '../analysis/cliSupport';
import { ParsedArgs, defineCli } from './args';
import { loadScenarioFile } from './scenarioFlag';

export const SCAN_CLI = defineCli({
  name: 'npx tsx src/cli/scan.cli.ts',
  summary: 'Parameter scan of a preset by full simulations: a grid over the axes, or a space-filling sample of their box.\n' +
    'EDUCATIONAL: results describe the reduced-order model, not a real device.',
  flags: {
    preset: { type: 'string', required: true, choices: PRESETS.map((p) => p.id), metavar: 'ID', help: 'preset to scan' },
    param: { type: 'list', required: true, metavar: 'PATH=LO:HI[:N],…', help: 'scan axis, e.g. H98=0.8:1.2:5 or n_target=log:1e20:4e20:4; a dotted path into the configuration' },
    points: { type: 'int', min: 1, help: 'number of points of a sampled scan (axes without N)' },
    sampler: { type: 'string', default: 'sobol', choices: SAMPLER_KINDS, help: 'sampled scan: the design' },
    seed: { type: 'int', default: 1, min: 0, max: 4294967295, help: 'sampled scan: seed of the design' },
    'run-seed': { type: 'int', min: 0, max: 4294967295, help: 'use this random seed in every shot (default: the preset seed)' },
    't-end': { type: 'number', min: 1e-6, metavar: 'S', help: 'override the shot duration [s]' },
    'flat-top': { type: 'string', default: 'time', choices: ['frame', 'time'], help: 'weighting of the flat-top means: time (the published definition since v4.0, unbiased by the extra frames at ELMs) or frame (the mean over the frames of v3.0.0)' },
    scenario: { type: 'string', metavar: 'FILE', help: 'scenario JSON file (schema 1: waveforms of the controls, triggers on the diagnostics) that every shot runs with; checked against the preset before any shot runs; its hash and form are in the JSON result and part of its input hash (an empty scenario is ignored)' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores - 1)' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a shot that runs longer than S seconds' },
    'max-runs': { type: 'int', default: 10000, min: 1, help: 'refuse scans with more shots' },
    json: { type: 'string', metavar: 'FILE', help: 'write the result as JSON to FILE (- for stdout)' },
    csv: { type: 'string', metavar: 'FILE', help: 'write one row per shot as CSV to FILE (- for stdout)' },
    quiet: { type: 'bool', help: 'no progress lines and no text summary' },
  },
  epilog: 'Progress goes to stderr. With --json - or --csv - stdout carries only that data and the text summary goes to stderr.',
});

export type ScanArgs = ParsedArgs<typeof SCAN_CLI>;

/** The scan specification of parsed flags. Throws RangeError (a usage error) for inconsistent axes and points. */
export function scanSpecFromArgs(args: ScanArgs): ScanSpec {
  const axes = args.param.map(parseAxis);
  const grid = axes.every((a) => a.points !== undefined);
  const partial = axes.some((a) => a.points !== undefined) && !grid;
  if (partial) throw new RangeError('give N on every axis (a grid) or on none (a sampled scan with --points)');
  if (!grid && args.points === undefined) throw new RangeError('axes without N need --points for a sampled scan');
  if (grid && args.points !== undefined) throw new RangeError('--points is for a sampled scan; the axes with N define a grid');
  const base = presetConfig(args.preset);
  const scenario = args.scenario !== undefined ? loadScenarioFile(args.scenario, base, { tEnd: args['t-end'] }) : undefined;
  return {
    preset: args.preset, base, axes, mode: grid ? 'grid' : (args.sampler as ScanSpec['mode']), points: args.points, seed: args.seed,
    runSeed: args['run-seed'], tEnd: args['t-end'], ...(scenario && !scenario.empty ? { scenario: scenario.spec } : {}), flatTop: args['flat-top'] as ScanSpec['flatTop'], maxRuns: args['max-runs'],
  };
}

export interface ScanPrepared {
  spec: ScanSpec;
  plan: ScanPlan;
}

/** The specification and the plan of parsed flags; throws RangeError (a usage error) for any invalid input. */
export function scanPrepare(args: ScanArgs): ScanPrepared {
  const spec = scanSpecFromArgs(args);
  return { spec, plan: planScan(spec) };
}

export interface ScanOutput {
  json: string;
  csv: string;
  text: string;
  /** shots that ran to a result */
  valid: number;
}

/** The reports (JSON, CSV, text) of the outcomes of a prepared scan. */
export function scanReport(prep: ScanPrepared, outcomes: readonly SimOutcome[]): ScanOutput {
  const result = summarizeScan(prep.plan, outcomes);
  return { json: toJson(result), csv: toCsv(prep.plan, outcomes, result.scenario ? { scenarioSha256: result.scenario.sha256 } : {}), text: formatScan(result), valid: result.runs.valid };
}
