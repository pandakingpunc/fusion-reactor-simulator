/// <reference types="node" />
/**
 * Design optimisation on the steady-state (POPCON) power balance of a tokamak preset: the smallest machine, the lowest heating
 * power or the highest gain that satisfies the usual limits, found with an augmented Lagrangian / Nelder-Mead solver.
 *
 *   npx tsx src/cli/optimize.cli.ts --preset ITER --objective major-radius --q-min 10
 *   npx tsx src/cli/optimize.cli.ts --preset SPARC --objective gain --vars fG,T --q-min 0 --json best.json
 *   npx tsx src/cli/optimize.cli.ts --preset ITER --objective aux-power --vars B0,Ip,fG,T --bound B0=4:6
 *   npx tsx src/cli/optimize.cli.ts --preset ITER --pareto major-radius,aux-power --paux-max 200
 *
 * See src/analysis/design.ts for the variables, the constraints and their defaults (the preset's own limits and installed
 * heating power). The solver is deterministic and the JSON contains no timing information: the same problem gives
 * byte-identical JSON. EDUCATIONAL: the optimum is a property of the reduced model, not a design. The flags and the report
 * are in optimizeSpec.ts.
 *
 * Exit codes: 0 done; 1 no feasible design; 2 usage error.
 */
import { exitUsage, parseArgsOrExit } from './args';
import { writeOutput } from '../analysis/node/output';
import { OPTIMIZE_CLI, OptimizeOutput, optimizeRun } from './optimizeSpec';

function main(): void {
  const args = parseArgsOrExit(OPTIMIZE_CLI);
  let out: OptimizeOutput;
  try {
    out = optimizeRun(args);
  } catch (e) {
    if (e instanceof RangeError) exitUsage(OPTIMIZE_CLI.name, e.message);
    throw e;
  }
  if (args.json !== undefined) writeOutput(args.json, out.json);
  if (!args.quiet) {
    if (args.json === '-') process.stderr.write(out.text); else process.stdout.write(out.text);
  }
  if (!out.feasible) {
    process.stderr.write(`optimize: no feasible design found (see the ${out.mode === 'pareto' ? '' : 'violated '}constraints)\n`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
