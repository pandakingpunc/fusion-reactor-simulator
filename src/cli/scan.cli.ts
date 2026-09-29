/// <reference types="node" />
/**
 * Parameter scan of a preset: full simulations over a grid (or a space-filling sample) of parameter values, tabulated.
 *
 *   npx tsx src/cli/scan.cli.ts --preset SPARC --param H98=0.8:1.2:5 --param n_target=log:1.5e20:4.5e20:5 --json scan.json
 *   npx tsx src/cli/scan.cli.ts --preset ITER --param H98=0.8:1.2 --param impurity.concentration=0.005:0.05 --points 64 --sampler sobol
 *
 * An axis is PATH=LO:HI:N (N grid points, linear; PATH=log:LO:HI:N for logarithmic spacing). Without N on any axis, give
 * --points for a sampled scan (sobol, lhs or mc) in the box spanned by the axes. Every shot keeps the preset's random seed
 * unless --run-seed is given, so a scan is deterministic; the JSON carries no timing, host or date information, and the
 * same inputs give byte-identical JSON whatever --threads is.
 *
 * Exit codes: 0 done (individual failed shots are reported, not fatal); 1 no shot ran to a result; 2 usage error;
 * 130 interrupted.
 */
import { PRESETS } from '../physics/presets';
import { PoolAbortError, PoolConfigError } from './pool';
import { defineCli, exitUsage, parseArgsOrExit } from './args';
import { SimOutcome, toCsv, toJson } from '../analysis/ensemble';
import { SAMPLER_KINDS } from '../analysis/samplers';
import { ScanSpec, planScan, summarizeScan } from '../analysis/scan';
import { formatScan, parseAxis, presetConfig } from '../analysis/cliSupport';
import { poolRunner } from '../analysis/node/ensembleRunner';
import { progressPrinter, writeOutput } from '../analysis/node/output';

const CLI = defineCli({
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
    'flat-top': { type: 'string', default: 'frame', choices: ['frame', 'time'], help: 'weighting of the flat-top means: frame (the published definition) or time (unbiased by the extra frames at ELMs)' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores - 1)' },
    timeout: { type: 'number', min: 1, metavar: 'S', help: 'fail a shot that runs longer than S seconds' },
    'max-runs': { type: 'int', default: 10000, min: 1, help: 'refuse scans with more shots' },
    json: { type: 'string', metavar: 'FILE', help: 'write the result as JSON to FILE (- for stdout)' },
    csv: { type: 'string', metavar: 'FILE', help: 'write one row per shot as CSV to FILE (- for stdout)' },
    quiet: { type: 'bool', help: 'no progress lines and no text summary' },
  },
  epilog: 'Progress goes to stderr. With --json - or --csv - stdout carries only that data and the text summary goes to stderr.',
});

async function main(): Promise<void> {
  const args = parseArgsOrExit(CLI);
  let spec: ScanSpec;
  let plan;
  try {
    const axes = args.param.map(parseAxis);
    const grid = axes.every((a) => a.points !== undefined);
    const partial = axes.some((a) => a.points !== undefined) && !grid;
    if (partial) throw new RangeError('give N on every axis (a grid) or on none (a sampled scan with --points)');
    if (!grid && args.points === undefined) throw new RangeError('axes without N need --points for a sampled scan');
    if (grid && args.points !== undefined) throw new RangeError('--points is for a sampled scan; the axes with N define a grid');
    spec = {
      preset: args.preset, base: presetConfig(args.preset), axes, mode: grid ? 'grid' : (args.sampler as ScanSpec['mode']), points: args.points, seed: args.seed,
      runSeed: args['run-seed'], tEnd: args['t-end'], flatTop: args['flat-top'] as ScanSpec['flatTop'], maxRuns: args['max-runs'],
    };
    plan = planScan(spec);
  } catch (e) {
    if (e instanceof RangeError) exitUsage(CLI.name, e.message);
    throw e;
  }
  const say = (s: string) => { if (!args.quiet) process.stderr.write(s); };
  say(`scan: ${spec.preset}, ${plan.runs} runs (${spec.mode}; ${plan.names.join(', ')})\n`);
  const runner = poolRunner({ threads: args.threads, timeoutS: args.timeout });
  const outcomes: SimOutcome[] = await runner(plan.tasks(), args.quiet ? undefined : progressPrinter('scan'));
  const result = summarizeScan(plan, outcomes);
  if (args.json !== undefined) writeOutput(args.json, toJson(result));
  if (args.csv !== undefined) writeOutput(args.csv, toCsv(plan, outcomes));
  if (!args.quiet) {
    const text = formatScan(result);
    if (args.json === '-' || args.csv === '-') process.stderr.write(text); else process.stdout.write(text);
  }
  if (result.runs.valid === 0) {
    process.stderr.write('scan: error: no shot ran to a result\n');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  if (e instanceof PoolAbortError) {
    console.error(`\n✗ scan: ${e.message}`);
    process.exitCode = 130;
    return;
  }
  console.error(e);
  process.exitCode = 1;
});
