/// <reference types="node" />
/**
 * scripts/coverage-levels.mjs: the thresholds of vite.config.ts are found by their globs, a glob is aggregated over the files it
 * matches (covered and total counts summed, as vitest measures it), the ratchet is the measurement less a margin rounded down, and
 * --check fails when a configured threshold is above the measurement.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/coverage-levels.mjs', import.meta.url));
/** a function of the script's module, called in a plain Node process (the shebang line of the script is not for the test transform); JSON in and out */
function call<T>(fn: string, ...args: unknown[]): T {
  const code = `import(${JSON.stringify(pathToFileURL(SCRIPT).href)}).then((m) => process.stdout.write(JSON.stringify(m[${JSON.stringify(fn)}](...JSON.parse(process.argv[1])))))`;
  const r = spawnSync(process.execPath, ['-e', code, JSON.stringify(args)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as T;
}
type Counts = { covered: number; total: number; pct: number };
const lib = {
  thresholdsOf: (t: string) => call<Record<string, Record<string, number>>>('thresholdsOf', t),
  aggregate: (summary: unknown, glob: string, base: string) => call<Record<string, Counts> & { files: number }>('aggregate', summary, glob, base),
  ratchet: (pct: number, margin: number) => call<number>('ratchet', pct, margin),
};

const CONFIG = `export default {
  test: {
    coverage: {
      // a comment with { braces } and 'src/x/**'
      thresholds: {
        'src/physics/**': { lines: 98, statements: 98, functions: 94, branches: 92 },
        // a comment line
        'src/io/**': { lines: 90, statements: 90, functions: 85, branches: 80 },
        'src/cli/**': { lines: 95.5, statements: 95, functions: 89, branches: 93 },
      },
    },
  },
};
`;

const entry = (covered: number, total: number) => ({ total, covered, skipped: 0, pct: total ? (100 * covered) / total : 100 });
const file = (l: [number, number], s: [number, number], f: [number, number], b: [number, number]) =>
  ({ lines: entry(...l), statements: entry(...s), functions: entry(...f), branches: entry(...b) });

const BASE = join(tmpdir(), 'cov-fixture-root');
const SUMMARY = {
  total: file([1, 1], [1, 1], [1, 1], [1, 1]),
  [join(BASE, 'src', 'physics', 'a.ts')]: file([90, 100], [90, 100], [9, 10], [8, 10]),
  [join(BASE, 'src', 'physics', 'numerics', 'b.ts')]: file([100, 100], [100, 100], [10, 10], [10, 10]),
  [join(BASE, 'src', 'io', 'c.ts')]: file([45, 50], [45, 50], [4, 5], [3, 5]),
  [join(BASE, 'src', 'iox', 'd.ts')]: file([0, 100], [0, 100], [0, 10], [0, 10]),
  [join(BASE, 'src', 'cli', 'e.ts')]: file([0, 0], [0, 0], [0, 0], [0, 0]),
};

describe('coverage-levels: the parts', () => {
  it('finds the globs of the thresholds block and their numbers, and nothing in comments', () => {
    const t = lib.thresholdsOf(CONFIG);
    expect(Object.keys(t)).toEqual(['src/physics/**', 'src/io/**', 'src/cli/**']);
    expect(t['src/physics/**']).toEqual({ lines: 98, statements: 98, functions: 94, branches: 92 });
    expect(t['src/cli/**'].lines).toBe(95.5);
    expect(lib.thresholdsOf('export default {}')).toEqual({});
  });

  it('the real config of the repository has its thresholds found', () => {
    const t = lib.thresholdsOf(readRepoConfig());
    expect(Object.keys(t)).toContain('src/physics/**');
    expect(Object.keys(t).length).toBeGreaterThanOrEqual(7);
    for (const v of Object.values(t)) for (const k of ['lines', 'statements', 'functions', 'branches']) expect(v[k]).toBeGreaterThan(0);
  });

  it('aggregates over the files of a glob by summing the counts (not by averaging the percentages); a directory that only starts with the same letters is not in it', () => {
    const p = lib.aggregate(SUMMARY, 'src/physics/**', BASE);
    expect(p.files).toBe(2);
    expect(p.lines).toEqual({ covered: 190, total: 200, pct: 95 });
    expect(p.functions).toMatchObject({ covered: 19, total: 20 });
    const io = lib.aggregate(SUMMARY, 'src/io/**', BASE);
    expect(io.files).toBe(1);
    expect(io.lines.pct).toBeCloseTo(90, 12);
    // a glob without countable code (a directory of type-only modules) is 100 %
    expect(lib.aggregate(SUMMARY, 'src/cli/**', BASE).lines.pct).toBe(100);
    expect(lib.aggregate(SUMMARY, 'src/none/**', BASE).files).toBe(0);
  });

  it('the ratchet is the measurement less the margin, rounded down to a whole percent, never above 100', () => {
    expect(lib.ratchet(96.3, 0.25)).toBe(96);
    expect(lib.ratchet(96.2, 0.25)).toBe(95);
    expect(lib.ratchet(96, 0.25)).toBe(95);
    expect(lib.ratchet(100, 0.25)).toBe(99);
    expect(lib.ratchet(100, 0)).toBe(100);
    expect(lib.ratchet(72.25, 0.25)).toBe(72);
  });
});

function readRepoConfig(): string {
  const r = spawnSync(process.execPath, ['-e', "process.stdout.write(require('node:fs').readFileSync('vite.config.ts','utf8'))"], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });
  return r.stdout;
}

describe('coverage-levels: the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cov-levels-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'coverage'));
  // the script resolves the summary and the config against its own repository root: paths are given absolute
  const summaryPath = join(dir, 'coverage', 'coverage-summary.json');
  const configPath = join(dir, 'vite.config.ts');
  const abs = (rel: string) => join(fileURLToPath(new URL('../../', import.meta.url)), rel);
  const summaryOfRepo: Record<string, unknown> = { total: SUMMARY.total };
  for (const [k, v] of Object.entries(SUMMARY)) if (k !== 'total') summaryOfRepo[abs(k.slice(BASE.length + 1))] = v;
  writeFileSync(summaryPath, JSON.stringify(summaryOfRepo));
  writeFileSync(configPath, CONFIG);
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--summary', summaryPath, '--config', configPath, ...args], { encoding: 'utf8' });

  it('prints the measurement and the suggestion of every glob; --check fails on a glob measured below its threshold and names it', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('src/physics/**');
    // physics measures 95 / 95 / 95 / 90: below the configured 98 / 98 / 94 / 92
    expect(r.stdout).toMatch(/src\/physics\/\*\*.*95\.0 \/ 95\.0 \/ 95\.0 \/ 90\.0.*98\/98\/94\/92.*94\/94\/94\/89.*below the config/);
    const c = run('--check');
    expect(c.status).toBe(1);
    expect(c.stderr).toContain('below their threshold');
  });

  it('a usage error is exit 2: an unknown argument, a bad margin, a missing summary', () => {
    expect(run('--nope').status).toBe(2);
    expect(run('--margin', 'x').status).toBe(2);
    expect(run('--margin').status).toBe(2);
    const r = spawnSync(process.execPath, [SCRIPT, '--summary', join(dir, 'none.json'), '--config', configPath], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('npm run coverage');
  });
});
