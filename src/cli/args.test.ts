import { describe, expect, it } from 'vitest';
import { CliHelpRequested, CliUsageError, defineCli, formatHelp, parseArgs } from './args';

const spec = defineCli({
  name: 'demo',
  summary: 'Demo command.',
  flags: {
    threads: { type: 'int', default: 4, min: 1, max: 64, help: 'worker threads' },
    scale: { type: 'number', min: 0, help: 'scale factor' },
    out: { type: 'string', default: 'out', metavar: 'DIR', help: 'output folder' },
    mode: { type: 'string', choices: ['fast', 'full'], help: 'run mode' },
    only: { type: 'list', choices: ['a', 'b', 'c'], help: 'subset' },
    formats: { type: 'list', default: ['svg', 'pdf'], help: 'formats' },
    json: { type: 'bool', help: 'machine-readable output' },
  },
});

const usage = (argv: string[]): string => {
  try {
    parseArgs(spec, argv);
  } catch (e) {
    expect(e).toBeInstanceOf(CliUsageError);
    expect((e as CliUsageError).exitCode).toBe(2);
    return (e as Error).message;
  }
  throw new Error(`expected a usage error for ${JSON.stringify(argv)}`);
};

describe('strict CLI argument parser', () => {
  it('applies defaults and types', () => {
    const a = parseArgs(spec, []);
    expect(a).toEqual({ threads: 4, scale: undefined, out: 'out', mode: undefined, only: undefined, formats: ['svg', 'pdf'], json: false });
    // compile-time types: defaults make the value non-optional
    const t: number = a.threads, o: string = a.out, f: string[] = a.formats, j: boolean = a.json;
    const s: number | undefined = a.scale, l: string[] | undefined = a.only;
    expect([t, o, f, j, s, l]).toBeDefined();
  });

  it('parses both --name value and --name=value', () => {
    const a = parseArgs(spec, ['--threads', '8', '--scale=2.5e-1', '--out', 'x y', '--mode=full', '--only', 'a,c', '--json']);
    expect(a).toMatchObject({ threads: 8, scale: 0.25, out: 'x y', mode: 'full', only: ['a', 'c'], json: true });
  });

  it('accumulates repeated list flags and trims items', () => {
    expect(parseArgs(spec, ['--only', 'a', '--only', ' b , c ']).only).toEqual(['a', 'b', 'c']);
  });

  it('accepts negative numbers as values', () => {
    const s = defineCli({ name: 'x', summary: '', flags: { v: { type: 'number', help: '' } } });
    expect(parseArgs(s, ['--v', '-3.5']).v).toBe(-3.5);
  });

  it('rejects unknown flags with a suggestion', () => {
    expect(usage(['--thread', '2'])).toBe('unknown flag --thread (did you mean --threads?)');
    expect(usage(['--zzzzzz'])).toBe('unknown flag --zzzzzz');
    expect(usage(['--toString'])).toMatch(/unknown flag --toString/);
  });

  it('rejects positional arguments and single-dash flags', () => {
    expect(usage(['ITER'])).toMatch(/unexpected argument 'ITER'/);
    expect(usage(['-t', '3'])).toMatch(/unexpected argument '-t'/);
    expect(usage(['--'])).toMatch(/unexpected '--'/);
  });

  it('rejects missing values', () => {
    expect(usage(['--threads'])).toBe('missing value for --threads');
    expect(usage(['--out', '--json'])).toBe('missing value for --out');
  });

  it('rejects malformed, non-finite and out-of-range numbers', () => {
    expect(usage(['--threads', 'abc'])).toBe(`--threads expects an integer, got 'abc'`);
    expect(usage(['--threads', '2.5'])).toMatch(/expects an integer/);
    expect(usage(['--threads', ''])).toMatch(/expects an integer/);
    expect(usage(['--threads', '0x10'])).toMatch(/expects an integer/);
    expect(usage(['--threads', '99999999999999999999'])).toMatch(/expects an integer/);
    expect(usage(['--threads', '0'])).toBe('--threads must be >= 1, got 0');
    expect(usage(['--threads', '65'])).toBe('--threads must be <= 64, got 65');
    expect(usage(['--scale', 'NaN'])).toMatch(/expects a finite number/);
    expect(usage(['--scale', 'Infinity'])).toMatch(/expects a finite number/);
    expect(usage(['--scale', '1e999'])).toMatch(/expects a finite number/);
    expect(usage(['--scale', '-1'])).toBe('--scale must be >= 0, got -1');
  });

  it('rejects values outside choices, listing the valid ones', () => {
    expect(usage(['--mode', 'slow'])).toBe(`--mode: unknown value 'slow'. Valid values: fast, full`);
    expect(usage(['--only', 'a,NOPE'])).toBe(`--only: unknown value 'NOPE'. Valid values: a, b, c`);
    expect(usage(['--only', 'a,,b'])).toMatch(/without empty items/);
  });

  it('rejects values on switches and repeated scalar flags', () => {
    expect(usage(['--json=true'])).toMatch(/does not take a value/);
    expect(usage(['--threads', '2', '--threads', '3'])).toBe('--threads given more than once');
  });

  it('enforces required flags', () => {
    const s = defineCli({ name: 'x', summary: '', flags: { reason: { type: 'string', required: true, help: 'why' } } });
    expect(() => parseArgs(s, [])).toThrow('--reason is required');
    const r: string = parseArgs(s, ['--reason', 'because']).reason;
    expect(r).toBe('because');
  });

  it('--help / -h produce the generated help text', () => {
    for (const h of ['--help', '-h']) {
      try {
        parseArgs(spec, ['--threads', '2', h]);
        throw new Error('expected help');
      } catch (e) {
        expect(e).toBeInstanceOf(CliHelpRequested);
        expect((e as CliHelpRequested).text).toBe(formatHelp(spec));
      }
    }
    const text = formatHelp(spec);
    expect(text).toMatch(/^Usage: demo \[options\]/);
    expect(text).toMatch(/--threads N +worker threads; range 1…64; default: 4/);
    expect(text).toMatch(/--out DIR +output folder; default: out/);
    expect(text).toMatch(/--only A,B +subset; one of: a, b, c/);
    expect(text).toMatch(/--json +machine-readable output/);
    expect(text).toMatch(/-h, --help/);
  });
});
