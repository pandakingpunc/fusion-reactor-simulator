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
 * same inputs give byte-identical JSON whatever --threads is. The flags are in scanSpec.ts.
 *
 * Exit codes: 0 done (individual failed shots are reported, not fatal); 1 no shot ran to a result; 2 usage error;
 * 130 interrupted.
 */
import { PoolAbortError, PoolConfigError } from './pool';
import { exitUsage, parseArgsOrExit } from './args';
import { SimOutcome } from '../analysis/ensemble';
import { poolRunner } from '../analysis/node/ensembleRunner';
import { progressPrinter, writeOutput } from '../analysis/node/output';
import { SCAN_CLI, ScanPrepared, scanPrepare, scanReport } from './scanSpec';

async function main(): Promise<void> {
  const args = parseArgsOrExit(SCAN_CLI);
  let prep: ScanPrepared;
  try {
    prep = scanPrepare(args);
  } catch (e) {
    if (e instanceof RangeError) exitUsage(SCAN_CLI.name, e.message);
    throw e;
  }
  const { spec, plan } = prep;
  const say = (s: string) => { if (!args.quiet) process.stderr.write(s); };
  say(`scan: ${spec.preset}, ${plan.runs} runs (${spec.mode}; ${plan.names.join(', ')})\n`);
  const runner = poolRunner({ threads: args.threads, timeoutS: args.timeout });
  const outcomes: SimOutcome[] = await runner(plan.tasks(), args.quiet ? undefined : progressPrinter('scan'));
  const out = scanReport(prep, outcomes);
  if (args.json !== undefined) writeOutput(args.json, out.json);
  if (args.csv !== undefined) writeOutput(args.csv, out.csv);
  if (!args.quiet) {
    if (args.json === '-' || args.csv === '-') process.stderr.write(out.text); else process.stdout.write(out.text);
  }
  if (out.valid === 0) {
    process.stderr.write('scan: error: no shot ran to a result\n');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(SCAN_CLI.name, e.message);
  if (e instanceof PoolAbortError) {
    console.error(`\n✗ scan: ${e.message}`);
    process.exitCode = 130;
    return;
  }
  console.error(e);
  process.exitCode = 1;
});
