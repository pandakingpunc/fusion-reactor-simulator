/// <reference types="node" />
/**
 * Strict command-line flag parser for the Node CLIs (validate, figures, golden).
 *
 * A CLI declares its flags once in a typed spec; parsing yields a typed record. Anything the spec
 * does not allow — unknown flags, stray positional arguments, a missing value, a malformed or
 * non-finite number, a value out of range or outside `choices`, a repeated scalar flag — is a
 * usage error: {@link parseArgsOrExit} prints it to stderr and exits with code 2. `--help`/`-h`
 * prints the generated help text and exits with code 0.
 *
 * Accepted syntax: `--name value`, `--name=value`; boolean flags take no value. List flags take
 * comma-separated items and may be repeated (items accumulate).
 */

export type FlagType = 'string' | 'int' | 'number' | 'bool' | 'list';

interface FlagBase {
  /** one-line help text */
  help: string;
  /** placeholder in the help text, e.g. N or DIR */
  metavar?: string;
}
export interface StringFlag extends FlagBase { type: 'string'; default?: string; choices?: readonly string[]; required?: boolean }
export interface IntFlag extends FlagBase { type: 'int'; default?: number; min?: number; max?: number; required?: boolean }
export interface NumberFlag extends FlagBase { type: 'number'; default?: number; min?: number; max?: number; required?: boolean }
export interface BoolFlag extends FlagBase { type: 'bool' }
export interface ListFlag extends FlagBase { type: 'list'; default?: readonly string[]; choices?: readonly string[]; required?: boolean }
export type FlagSpec = StringFlag | IntFlag | NumberFlag | BoolFlag | ListFlag;

export interface CliSpec {
  /** command name used in messages, e.g. "npm run validate --" */
  name: string;
  /** one-paragraph description printed at the top of --help */
  summary: string;
  flags: Record<string, FlagSpec>;
  /** extra text printed after the flag list */
  epilog?: string;
}

type ValueOf<F extends FlagSpec> =
  F extends BoolFlag ? boolean :
  F extends ListFlag ? (F extends { default: readonly string[] } | { required: true } ? string[] : string[] | undefined) :
  F extends IntFlag | NumberFlag ? (F extends { default: number } | { required: true } ? number : number | undefined) :
  F extends StringFlag ? (F extends { default: string } | { required: true } ? string : string | undefined) :
  never;

export type ParsedArgs<S extends CliSpec> = { -readonly [K in keyof S['flags']]: ValueOf<S['flags'][K]> };

/** Declares a CLI spec while keeping its literal types (defaults, required) for {@link ParsedArgs}. */
export function defineCli<const S extends CliSpec>(spec: S): S {
  return spec;
}

/** A command-line usage error (exit code 2). */
export class CliUsageError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/** Thrown by {@link parseArgs} when --help is requested. */
export class CliHelpRequested extends Error {
  readonly exitCode = 0;
  constructor(readonly text: string) {
    super('help requested');
    this.name = 'CliHelpRequested';
  }
}

const INT_RE = /^[+-]?\d+$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function checkRange(name: string, v: number, f: IntFlag | NumberFlag): void {
  if (f.min !== undefined && v < f.min) throw new CliUsageError(`--${name} must be >= ${f.min}, got ${v}`);
  if (f.max !== undefined && v > f.max) throw new CliUsageError(`--${name} must be <= ${f.max}, got ${v}`);
}

function checkChoice(name: string, v: string, choices: readonly string[] | undefined): void {
  if (choices && !choices.includes(v)) throw new CliUsageError(`--${name}: unknown value '${v}'. Valid values: ${choices.join(', ')}`);
}

function convert(name: string, f: Exclude<FlagSpec, BoolFlag>, raw: string): number | string | string[] {
  switch (f.type) {
    case 'int': {
      const s = raw.trim();
      const v = INT_RE.test(s) ? Number(s) : NaN;
      if (!Number.isSafeInteger(v)) throw new CliUsageError(`--${name} expects an integer, got '${raw}'`);
      checkRange(name, v, f);
      return v;
    }
    case 'number': {
      const s = raw.trim();
      const v = NUM_RE.test(s) ? Number(s) : NaN;
      if (!Number.isFinite(v)) throw new CliUsageError(`--${name} expects a finite number, got '${raw}'`);
      checkRange(name, v, f);
      return v;
    }
    case 'string':
      checkChoice(name, raw, f.choices);
      return raw;
    case 'list': {
      const items = raw.split(',').map((s) => s.trim());
      if (items.some((s) => s === '')) throw new CliUsageError(`--${name} expects a comma-separated list without empty items, got '${raw}'`);
      for (const it of items) checkChoice(name, it, f.choices);
      return items;
    }
  }
}

/** Closest flag name (edit distance ≤ 2) for "did you mean" hints. */
function suggest(name: string, names: string[]): string | undefined {
  let best: string | undefined, bestD = 3;
  for (const n of names) {
    const d = editDistance(name, n);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Parses `argv` (without the node/script prefix) against `spec`.
 * Throws {@link CliUsageError} on invalid input and {@link CliHelpRequested} for --help / -h.
 */
export function parseArgs<const S extends CliSpec>(spec: S, argv: readonly string[]): ParsedArgs<S> {
  const flags = spec.flags as Record<string, FlagSpec>;
  const names = Object.keys(flags);
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') throw new CliHelpRequested(formatHelp(spec));
    if (!tok.startsWith('--') || tok === '--') {
      throw new CliUsageError(tok === '--' ? `unexpected '--' (this command takes no positional arguments)` : `unexpected argument '${tok}'`);
    }
    const eq = tok.indexOf('=');
    const name = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
    const f = flags[name];
    if (!f || !Object.prototype.hasOwnProperty.call(flags, name)) {
      const hint = suggest(name, names);
      throw new CliUsageError(`unknown flag --${name}${hint ? ` (did you mean --${hint}?)` : ''}`);
    }
    if (seen.has(name) && f.type !== 'list') throw new CliUsageError(`--${name} given more than once`);
    seen.add(name);
    if (f.type === 'bool') {
      if (eq >= 0) throw new CliUsageError(`--${name} is a switch and does not take a value`);
      out[name] = true;
      continue;
    }
    let raw: string;
    if (eq >= 0) raw = tok.slice(eq + 1);
    else {
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) throw new CliUsageError(`missing value for --${name}`);
      raw = nxt;
      i++;
    }
    const v = convert(name, f, raw);
    out[name] = f.type === 'list' && Array.isArray(out[name]) ? [...(out[name] as string[]), ...(v as string[])] : v;
  }
  for (const name of names) {
    const f = flags[name];
    if (name in out) continue;
    if (f.type === 'bool') out[name] = false;
    else if ('required' in f && f.required) throw new CliUsageError(`--${name} is required`);
    else if (f.default !== undefined) out[name] = Array.isArray(f.default) ? [...f.default] : f.default;
    else out[name] = undefined;
  }
  return out as ParsedArgs<S>;
}

/** Generated --help text. */
export function formatHelp(spec: CliSpec): string {
  const rows = Object.entries(spec.flags).map(([name, f]) => {
    const meta = f.type === 'bool' ? '' : ` ${f.metavar ?? (f.type === 'list' ? 'A,B' : f.type === 'int' ? 'N' : f.type === 'number' ? 'X' : 'VALUE')}`;
    const bits: string[] = [f.help];
    if (f.type !== 'bool') {
      if ('choices' in f && f.choices) bits.push(`one of: ${f.choices.join(', ')}`);
      if (f.type === 'int' || f.type === 'number') {
        if (f.min !== undefined && f.max !== undefined) bits.push(`range ${f.min}…${f.max}`);
        else if (f.min !== undefined) bits.push(`>= ${f.min}`);
        else if (f.max !== undefined) bits.push(`<= ${f.max}`);
      }
      if (f.required) bits.push('required');
      else if (f.default !== undefined) bits.push(`default: ${Array.isArray(f.default) ? f.default.join(',') : String(f.default)}`);
    }
    return { left: `  --${name}${meta}`, right: bits.join('; ') };
  });
  rows.push({ left: '  -h, --help', right: 'show this help and exit' });
  const w = Math.max(...rows.map((r) => r.left.length)) + 2;
  const lines = [`Usage: ${spec.name} [options]`, '', spec.summary, '', 'Options:', ...rows.map((r) => r.left.padEnd(w) + r.right)];
  if (spec.epilog) lines.push('', spec.epilog);
  return lines.join('\n') + '\n';
}

/**
 * {@link parseArgs} for CLI entry points: on a usage error prints `<name>: error: …` to stderr and
 * exits with code 2; on --help prints the help text to stdout and exits with code 0.
 */
export function parseArgsOrExit<const S extends CliSpec>(spec: S, argv: readonly string[] = process.argv.slice(2)): ParsedArgs<S> {
  try {
    return parseArgs(spec, argv);
  } catch (e) {
    if (e instanceof CliHelpRequested) {
      process.stdout.write(e.text);
      process.exit(0);
    }
    if (e instanceof CliUsageError) exitUsage(spec.name, e.message);
    throw e;
  }
}

/** Prints a usage error for `name` and exits with code 2. */
export function exitUsage(name: string, message: string): never {
  process.stderr.write(`${name}: error: ${message}\nRun with --help for usage.\n`);
  process.exit(2);
}
