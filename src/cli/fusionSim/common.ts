/// <reference types="node" />
/**
 * What the fusion-sim subcommands share: the I/O seam (tests pass their own), errors that map to exit
 * codes, configuration resolution (preset, file, settings, shorthand flags, validation), repeated flags,
 * the provenance block and output helpers.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPT_DOI, gitInfo, packageVersion, runtimeInfo } from '../provenance';
import { requirePreset } from '../../physics/config/registry';
import { ConfigValidationError, validateConfig } from '../../physics/config/schema';
import { applyAssignments, mergeConfig } from '../../physics/config/paths';
import { canonicalString } from '../../physics/kernel/canonical';
import { runFingerprint } from '../../physics/kernel/fingerprint';
import { sha256Hex } from '../../physics/kernel/sha256';
import type { ReactorConfig } from '../../physics/types';
import type { FlagSpec } from '../args';
import { CliUsageError } from '../args';

/** Everything a command touches outside the process: standard streams, files, the working directory. */
export interface CliIo {
  stdout: { write(data: string | Uint8Array): void; readonly isTTY: boolean };
  stderr: { write(text: string): void; readonly isTTY: boolean };
  readText(path: string): string;
  writeFile(path: string, data: string | Uint8Array): void;
}

/** The real thing: process streams and the file system. */
export function nodeIo(): CliIo {
  return {
    stdout: { write: (d) => { process.stdout.write(d); }, get isTTY() { return Boolean(process.stdout.isTTY); } },
    stderr: { write: (t) => { process.stderr.write(t); }, get isTTY() { return Boolean(process.stderr.isTTY); } },
    readText: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, d) => writeFileSync(p, d),
  };
}

/** Bad input (an unreadable or invalid configuration, an unknown preset): exit code 2. */
export class CliInputError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'CliInputError';
  }
}

/** The command ran and failed, or is not available: exit code 1 (130 when it was interrupted). */
export class CliFailure extends Error {
  constructor(message: string, readonly exitCode: number = 1) {
    super(message);
    this.name = 'CliFailure';
  }
}

/** Optional pieces of the CLI that other workstreams supply; absent ones make their command say so. */
export interface CliDeps {
  /**
   * GEQDSK text of the equilibrium of a finished 1.5D run (COCOS 11), from the writer of src/io/geqdsk.ts.
   * `time` is the requested time in seconds (the last equilibrium of the run if undefined).
   */
  writeEqdsk?: (sim: import('../../physics/simulation').Simulation, opts: { time?: number }) => string;
  /** runs scan tasks; the default is the worker pool (src/cli/pool.ts) */
  execute?: import('./scanCmd').Executor;
}

export interface CliContext {
  io: CliIo;
  /** the pieces of CliDeps, with the scan executor always present (the worker pool unless a caller replaced it) */
  deps: CliDeps & { execute: import('./scanCmd').Executor };
  /** the package root (where package.json is), or undefined when it cannot be found */
  root: string | undefined;
}

/** The nearest directory upwards from `fromUrl` whose package.json is this package's; undefined if none. */
export function findPackageRoot(fromUrl: string): string | undefined {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const p = join(dir, 'package.json');
    if (existsSync(p)) {
      try { if (JSON.parse(readFileSync(p, 'utf8')).name === 'fusion-reactor-simulator') return dir; } catch { /* keep looking */ }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

export const packageVersionOf = (ctx: CliContext): string => (ctx.root ? packageVersion(ctx.root) : '0.0.0');

// ── repeated flags ──────────────────────────────────────────────────────────────────────────────────

/**
 * Takes the repeatable `--name value` / `--name=value` flags out of argv (their values may contain commas
 * and colons, which the list flags of args.ts would split). Returns the remaining arguments.
 */
export function takeRepeated(argv: readonly string[], names: readonly string[]): { rest: string[]; values: Record<string, string[]> } {
  const values: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, []]));
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    const name = names.find((n) => tok === `--${n}` || tok.startsWith(`--${n}=`));
    if (name === undefined) { rest.push(tok); continue; }
    if (tok.startsWith(`--${name}=`)) { values[name].push(tok.slice(name.length + 3)); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new CliUsageError(`missing value for --${name}`);
    values[name].push(next);
    i++;
  }
  return { rest, values };
}

// ── configuration ───────────────────────────────────────────────────────────────────────────────────

/** Flags every command that takes a configuration shares. */
export const CONFIG_FLAGS = {
  preset: { type: 'string', metavar: 'ID', help: 'built-in preset (`fusion-sim presets` lists them)' },
  config: { type: 'string', metavar: 'FILE', help: 'configuration JSON file (the argument of new Simulation); together with --preset it is a patch merged over the preset' },
  't-end': { type: 'number', metavar: 'S', help: 'shot duration in seconds (sets t_end)' },
  seed: { type: 'int', min: 0, help: 'random seed (sets seed)' },
  fidelity: { type: 'string', choices: ['0D', '1.5D'], help: 'model fidelity of a tokamak or spherical tokamak (sets fidelity)' },
  fuel: { type: 'string', choices: ['DT', 'DD', 'DHe3', 'pB11'], help: 'fuel (sets fuel)' },
  'no-validate': { type: 'bool', help: 'run without checking the configuration first (the kernel then rejects only what it cannot build)' },
} as const satisfies Record<string, FlagSpec>;

export const CONFIG_EPILOG = 'Settings: --set PATH=VALUE (repeatable) changes one property after the preset and the file, e.g.\n' +
  '  --set heating.P_NBI_MW=20 --set impurity.seedSpecies=Ar --set fidelity=1.5D\n' +
  'VALUE is JSON (20, 1e20, true, "DT") or plain text (DT). Later settings win; the shorthand flags come before --set.';

interface ConfigArgs {
  preset: string | undefined;
  config: string | undefined;
  't-end': number | undefined;
  seed: number | undefined;
  fidelity: string | undefined;
  fuel: string | undefined;
  'no-validate': boolean;
}

export interface ResolvedConfig {
  cfg: ReactorConfig;
  /** the preset the configuration started from, if any */
  preset: string | undefined;
}

/** Strips a UTF-8 byte order mark (Windows PowerShell writes one) and parses JSON, naming the file on failure. */
export function parseJsonFile(io: CliIo, path: string): unknown {
  let text: string;
  try { text = io.readText(path); } catch (e) { throw new CliInputError(`cannot read ${path}: ${(e as { code?: string }).code ?? (e as Error).message}`); }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new CliInputError(`${path}: not valid JSON (${(e as Error).message})`); }
}

/**
 * The configuration a command should run: the preset and/or the file, the shorthand flags, then the
 * `--set` settings; validated (every problem listed with its path) unless --no-validate.
 */
export function resolveConfig(args: ConfigArgs, sets: readonly string[], io: CliIo): ResolvedConfig {
  if (args.preset === undefined && args.config === undefined) throw new CliInputError('give --preset ID or --config FILE (see `fusion-sim presets`)');
  let cfg: unknown;
  try {
    if (args.preset !== undefined) cfg = requirePreset(args.preset).cfg;
  } catch (e) {
    throw new CliInputError((e as Error).message);
  }
  if (args.config !== undefined) {
    const file = parseJsonFile(io, args.config);
    cfg = cfg === undefined ? file : mergeConfig(cfg, file);
  }
  const shorthand: string[] = [];
  if (args['t-end'] !== undefined) shorthand.push(`t_end=${args['t-end']}`);
  if (args.seed !== undefined) shorthand.push(`seed=${args.seed}`);
  if (args.fidelity !== undefined) shorthand.push(`fidelity=${args.fidelity}`);
  if (args.fuel !== undefined) shorthand.push(`fuel=${args.fuel}`);
  try {
    cfg = applyAssignments(cfg as ReactorConfig, [...shorthand, ...sets]);
  } catch (e) {
    throw new CliInputError((e as Error).message); // a malformed setting or a forbidden path (ConfigPathError)
  }
  if (!args['no-validate']) {
    const v = validateConfig(cfg);
    if (!v.ok) throw new CliInputError(new ConfigValidationError(v.issues).message);
  }
  return { cfg: cfg as ReactorConfig, preset: args.preset };
}

// ── provenance ──────────────────────────────────────────────────────────────────────────────────────

/** The provenance block of an output: what produced it and which run it is. No path, user name or timestamp. */
export function provenanceBlock(ctx: CliContext, cfg: ReactorConfig, preset: string | undefined): Record<string, unknown> {
  const version = packageVersionOf(ctx);
  const seed = (cfg as { seed?: number }).seed ?? 0;
  return {
    generator: 'fusion-sim',
    version,
    conceptDoi: CONCEPT_DOI,
    git: ctx.root ? gitInfo(ctx.root) : null,
    runtime: runtimeInfo(),
    preset: preset ?? null,
    seed,
    configSha256: sha256Hex(canonicalString(cfg)),
    fingerprint: runFingerprint(cfg, seed, [], version),
  };
}

// ── output ──────────────────────────────────────────────────────────────────────────────────────────

/** Writes to a file, or to stdout when `out` is undefined or '-'. */
export function emit(io: CliIo, out: string | undefined, data: string | Uint8Array): void {
  if (out === undefined || out === '-') io.stdout.write(data);
  else io.writeFile(resolve(out), data);
}

/** Extension of a path in lower case without the dot ('' if none). */
export function extensionOf(path: string | undefined): string {
  if (path === undefined) return '';
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}
