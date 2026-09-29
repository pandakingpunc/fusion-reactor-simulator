/// <reference types="node" />
/**
 * Uncertainty quantification of a preset: propagates uncertain inputs through full simulations and reports the
 * probability of events, quantiles of the outputs and (optionally) Sobol' sensitivity indices.
 *
 *   npx tsx src/cli/uq.cli.ts --preset ITER --n 128 --threads 4 --json uq-iter.json --csv uq-iter.csv
 *   npx tsx src/cli/uq.cli.ts --preset SPARC --analysis sensitivity --n 64 --t-end 10
 *   npx tsx src/cli/uq.cli.ts --preset JET --param H98=lognormal:0.85:0.2 --param impurity.concentration=loguniform:0.005:0.05
 *
 * The runs are independent full shots on a worker-thread pool (src/cli/pool.ts). The design comes from a seeded sampler
 * and the JSON contains no timing, host or date information: the same inputs give byte-identical JSON whatever --threads
 * is. See src/analysis/ensemble.ts for what the numbers mean; every result carries an "educational" caveat. The flags are in
 * uqSpec.ts.
 *
 * Exit codes: 0 done (individual failed shots are reported, not fatal); 1 no shot ran to a result; 2 usage error;
 * 130 interrupted.
 */
import { PoolAbortError, PoolConfigError } from './pool';
import { exitUsage, parseArgsOrExit } from './args';
import { SimOutcome } from '../analysis/ensemble';
import { poolRunner } from '../analysis/node/ensembleRunner';
import { progressPrinter, writeOutput } from '../analysis/node/output';
import { UQ_CLI, UqPrepared, uqListParams, uqPrepare, uqReport } from './uqSpec';

async function main(): Promise<void> {
  const args = parseArgsOrExit(UQ_CLI);
  let prep: UqPrepared;
  try {
    if (args['list-params']) {
      process.stdout.write(uqListParams(args));
      return;
    }
    prep = uqPrepare(args);
  } catch (e) {
    if (e instanceof RangeError) exitUsage(UQ_CLI.name, e.message);
    throw e;
  }
  const { spec, plan } = prep;
  const say = (s: string) => { if (!args.quiet) process.stderr.write(s); };
  say(`uq: ${spec.preset} ${spec.analysis}, ${plan.runs} runs (${spec.sampler}, seed ${spec.seed}, ${plan.d} parameters: ${plan.names.join(', ')})\n`);
  for (const n of plan.notes) say(`uq: note: ${n}\n`);
  const runner = poolRunner({ threads: args.threads, timeoutS: args.timeout });
  const outcomes: SimOutcome[] = await runner(plan.tasks(), args.quiet ? undefined : progressPrinter('uq'));
  const out = uqReport(prep, outcomes);
  if (args.json !== undefined) writeOutput(args.json, out.json);
  if (args.csv !== undefined) writeOutput(args.csv, out.csv);
  if (!args.quiet) {
    if (args.json === '-' || args.csv === '-') process.stderr.write(out.text); else process.stdout.write(out.text);
  }
  if (out.valid === 0) {
    process.stderr.write('uq: error: no shot ran to a result\n');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(UQ_CLI.name, e.message);
  if (e instanceof PoolAbortError) {
    console.error(`\n✗ uq: ${e.message}`);
    process.exitCode = 130;
    return;
  }
  console.error(e);
  process.exitCode = 1;
});
