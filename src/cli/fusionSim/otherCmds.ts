/// <reference types="node" />
/**
 * The small subcommands of fusion-sim: `presets`, `schema` and `export-eqdsk`.
 */
import { PRESETS } from '../../physics/presets';
import { requirePreset } from '../../physics/config/registry';
import { CONFIG_SCHEMA_ID, configJsonSchema, formatIssue, validateConfig } from '../../physics/config/schema';
import { runShot } from '../../physics/config/run';
import { SimulationError } from '../../physics/kernel/errors';
import { defineCli, parseArgs } from '../args';
import {
  CONFIG_EPILOG, CONFIG_FLAGS, CliContext, CliFailure, CliInputError, emit, parseJsonFile, resolveConfig, takeRepeated,
} from './common';

// ── presets ─────────────────────────────────────────────────────────────────────────────────────────

export const PRESETS_CLI = defineCli({
  name: 'fusion-sim presets',
  summary: 'Lists the built-in presets (id, method, fidelity, duration, name), or prints the configuration of one.',
  flags: {
    json: { type: 'bool', help: 'machine-readable output (JSON array)' },
    show: { type: 'string', metavar: 'ID', help: 'print the configuration of this preset as JSON (the file `run --config` takes)' },
  },
});

function fidelityOf(cfg: unknown): string {
  const c = cfg as { method: string; fidelity?: string };
  return ['tokamak', 'spherical_tokamak'].includes(c.method) ? (c.fidelity ?? '0D') : '-';
}

export function presetsCommand(argv: readonly string[], ctx: CliContext): number {
  const args = parseArgs(PRESETS_CLI, argv);
  if (args.show !== undefined) {
    if (args.json) throw new CliInputError('--show already prints JSON; do not combine it with --json');
    try {
      emit(ctx.io, undefined, JSON.stringify(requirePreset(args.show).cfg, null, 2) + '\n');
    } catch (e) {
      throw new CliInputError((e as Error).message);
    }
    return 0;
  }
  const rows = PRESETS.map((p) => ({
    id: p.id, name: p.name, method: p.cfg.method, fidelity: fidelityOf(p.cfg),
    t_end: 't_end' in p.cfg ? (p.cfg as { t_end: number }).t_end : null, description: p.desc, ...(p.validation ? { validation: p.validation } : {}),
  }));
  if (args.json) {
    emit(ctx.io, undefined, JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  const cell = (r: (typeof rows)[number]): string[] => [r.id, r.method, r.fidelity, r.t_end === null ? 'pulsed' : `${r.t_end} s`, r.name];
  const table = [['ID', 'METHOD', 'FIDELITY', 'DURATION', 'NAME'], ...rows.map(cell)];
  const w = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
  emit(ctx.io, undefined, table.map((r) => r.map((s, c) => (c === r.length - 1 ? s : s.padEnd(w[c] + 2))).join('')).join('\n') + '\n');
  return 0;
}

// ── schema ──────────────────────────────────────────────────────────────────────────────────────────

export const SCHEMA_CLI = defineCli({
  name: 'fusion-sim schema',
  summary: 'Prints the JSON Schema (draft 2020-12) of a reactor configuration, or checks a configuration file against it.',
  flags: {
    out: { type: 'string', metavar: 'FILE', help: 'write the schema here instead of stdout' },
    check: { type: 'string', metavar: 'FILE', help: 'check this configuration file instead: every problem is listed with its path; exit 0 if valid, 1 if not, 2 if unreadable' },
    id: { type: 'bool', help: 'print only the schema id' },
  },
  epilog: 'The schema is also checked in as schema/fusion-sim.schema.json. Cross-field rules (a < R, a tokamak needs a plasma current)\n' +
    'are not expressible in JSON Schema; they are listed in its `x-rules` annotations, and `--check` (like `run`) enforces them.',
});

export function schemaCommand(argv: readonly string[], ctx: CliContext): number {
  const args = parseArgs(SCHEMA_CLI, argv);
  if (args.check !== undefined) {
    const value = parseJsonFile(ctx.io, args.check);
    const r = validateConfig(value);
    if (r.ok) {
      ctx.io.stdout.write(`${args.check}: valid (${(value as { method: string }).method})\n`);
      return 0;
    }
    ctx.io.stderr.write(`${args.check}: invalid configuration (${r.issues.length} problem${r.issues.length === 1 ? '' : 's'}):\n${r.issues.map((i) => `  ${formatIssue(i)}`).join('\n')}\n`);
    return 1;
  }
  if (args.id) {
    ctx.io.stdout.write(CONFIG_SCHEMA_ID + '\n');
    return 0;
  }
  emit(ctx.io, args.out, JSON.stringify(configJsonSchema(), null, 2) + '\n');
  return 0;
}

// ── export-eqdsk ────────────────────────────────────────────────────────────────────────────────────

export const EQDSK_CLI = defineCli({
  name: 'fusion-sim export-eqdsk',
  summary: 'Runs a 1.5D shot and writes its equilibrium as a GEQDSK (EQDSK) file in COCOS 11.',
  flags: {
    ...CONFIG_FLAGS,
    time: { type: 'number', min: 0, metavar: 'S', help: 'time of the equilibrium in seconds (default: the last equilibrium of the run)' },
    out: { type: 'string', metavar: 'FILE', required: true, help: 'output file (`-` is stdout)' },
  },
  epilog: CONFIG_EPILOG,
});

export const EQDSK_UNAVAILABLE = 'not available in this build: the GEQDSK writer (src/io/geqdsk.ts, workstream WS4) has not been merged into it.\n' +
  'The flux surfaces of a 1.5D run are available meanwhile as the equilibrium IDS of `fusion-sim run --format imas` (boundary outline, axis, q95, l_i, beta_p).';

export async function eqdskCommand(argv: readonly string[], ctx: CliContext): Promise<number> {
  const { rest, values } = takeRepeated(argv, ['set']);
  const args = parseArgs(EQDSK_CLI, rest);
  const write = ctx.deps.writeEqdsk;
  if (!write) throw new CliFailure(EQDSK_UNAVAILABLE);
  const { cfg } = resolveConfig(args, values.set, ctx.io);
  if ((cfg as { fidelity?: string }).fidelity !== '1.5D' || !['tokamak', 'spherical_tokamak'].includes(cfg.method)) {
    throw new CliInputError(`export-eqdsk needs a 1.5D tokamak or spherical tokamak run (fidelity "1.5D"; got method '${cfg.method}', fidelity '${(cfg as { fidelity?: string }).fidelity ?? '0D'}'): add --fidelity 1.5D or use a preset such as ITER15`);
  }
  let text: string;
  try {
    const { sim } = runShot(cfg, { validate: false });
    text = write(sim, { ...(args.time !== undefined ? { time: args.time } : {}) });
  } catch (e) {
    if (e instanceof SimulationError) throw new CliFailure(`the run failed: ${e.message}`);
    throw e;
  }
  emit(ctx.io, args.out, text);
  return 0;
}

