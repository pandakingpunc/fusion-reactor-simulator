/// <reference types="node" />
/**
 * fusion-sim: the command-line front end of the simulator library.
 *
 *   fusion-sim run           one shot -> json | csv | ndjson | netcdf | imas | text
 *   fusion-sim scan          a grid of parameter values on worker threads -> a table of metrics
 *   fusion-sim export-eqdsk  the equilibrium of a 1.5D run as a GEQDSK file (needs the WS4 writer)
 *   fusion-sim presets       the built-in presets, or one configuration as JSON
 *   fusion-sim schema        the JSON Schema of a configuration, or a check of a configuration file
 *
 * `main` is the whole program with its environment passed in (streams, files, optional pieces), so that
 * tests run it in-process; src/cli/fusion-sim.ts is the three-line entry point.
 * Exit codes: 0 success; 1 a run or check failed, or the command is not available; 2 usage or input error;
 * 130 interrupted.
 */
import { CliHelpRequested, CliUsageError, formatHelp } from '../args';
import { CliFailure, CliInputError, findPackageRoot, nodeIo, packageVersionOf, type CliContext, type CliDeps, type CliIo } from './common';
import { EQDSK_CLI, PRESETS_CLI, SCHEMA_CLI, eqdskCommand, presetsCommand, schemaCommand } from './otherCmds';
import { RUN_CLI, runCommand } from './runCmd';
import { SCAN_CLI, poolExecutor, scanCommand } from './scanCmd';

const COMMANDS = ['run', 'scan', 'export-eqdsk', 'presets', 'schema'] as const;
type Command = (typeof COMMANDS)[number];

const TOP_HELP = `Usage: fusion-sim <command> [options]

Commands:
  run           run a preset or a configuration file; write json, csv, ndjson, netcdf, imas or a text summary
  scan          run a grid of parameter values on worker threads; write a table of metrics
  export-eqdsk  write the equilibrium of a 1.5D run as a GEQDSK file (COCOS 11)
  presets       list the built-in presets, or print the configuration of one
  schema        print the JSON Schema of a configuration, or check a configuration file against it

Run \`fusion-sim <command> --help\` for the options of a command; \`fusion-sim --version\` prints the version.

Exit codes: 0 success; 1 a run or check failed, or the command is not available; 2 usage or input error
(an invalid configuration is listed with the path of every offending property); 130 interrupted.
`;

const HELP: Readonly<Record<Command, string>> = {
  run: formatHelp(RUN_CLI),
  scan: formatHelp(SCAN_CLI),
  'export-eqdsk': formatHelp(EQDSK_CLI),
  presets: formatHelp(PRESETS_CLI),
  schema: formatHelp(SCHEMA_CLI),
};

/** The pieces of a run of the CLI that a caller may replace. */
export interface MainEnv {
  io?: CliIo;
  deps?: CliDeps;
  /** package root override (tests); default: found from this file */
  root?: string | undefined;
}

/** Runs the CLI with `argv` (without node and the script) and returns the exit code; never calls process.exit. */
export async function main(argv: readonly string[], env: MainEnv = {}): Promise<number> {
  const io = env.io ?? nodeIo();
  const ctx: CliContext = { io, deps: { execute: poolExecutor, ...env.deps }, root: 'root' in env ? env.root : findPackageRoot(import.meta.url) };
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    (cmd === undefined ? io.stderr : io.stdout).write(TOP_HELP);
    return cmd === undefined ? 2 : 0;
  }
  if (cmd === '--version' || cmd === '-V' || cmd === 'version') {
    io.stdout.write(`${packageVersionOf(ctx)}\n`);
    return 0;
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    io.stderr.write(`fusion-sim: error: unknown command '${cmd}'. Commands: ${COMMANDS.join(', ')}\nRun \`fusion-sim --help\` for usage.\n`);
    return 2;
  }
  try {
    switch (cmd as Command) {
      case 'run': return await runCommand(rest, ctx);
      case 'scan': return await scanCommand(rest, ctx);
      case 'export-eqdsk': return await eqdskCommand(rest, ctx);
      case 'presets': return presetsCommand(rest, ctx);
      case 'schema': return schemaCommand(rest, ctx);
    }
  } catch (e) {
    if (e instanceof CliHelpRequested) {
      io.stdout.write(HELP[cmd as Command]);
      return 0;
    }
    if (e instanceof CliUsageError) {
      io.stderr.write(`fusion-sim ${cmd}: error: ${e.message}\nRun \`fusion-sim ${cmd} --help\` for usage.\n`);
      return e.exitCode;
    }
    if (e instanceof CliInputError) {
      io.stderr.write(`fusion-sim ${cmd}: error: ${e.message}\n`);
      return e.exitCode;
    }
    if (e instanceof CliFailure) {
      io.stderr.write(`fusion-sim ${cmd}: ${e.message}\n`);
      return e.exitCode;
    }
    io.stderr.write(`fusion-sim ${cmd}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return 1;
  }
  return 0;
}
