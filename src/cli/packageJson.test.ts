/// <reference types="node" />
/**
 * The entry points package.json declares for the library and the command line (main, module, types, bin,
 * exports, files, the build:lib / schema scripts) name files that scripts/build-lib.mjs and
 * scripts/gen-schema.ts actually produce or that sit in the repository. The build itself is exercised end to
 * end in lib.test.ts; this is the cheap static check that the two stay in step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  private?: boolean;
  engines?: { node?: string };
  bin?: Record<string, string>;
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, string | Record<string, string>>;
  files?: string[];
  scripts: Record<string, string>;
};

/** What scripts/build-lib.mjs writes under build/lib (its header comment lists the same files) */
const BUILD_OUTPUT = ['index.js', 'index.cjs', 'index.d.ts', 'io.js', 'io.cjs', 'io.d.ts', 'fusion-sim.js'];

const targets = (v: string | Record<string, string>): string[] => (typeof v === 'string' ? [v] : Object.values(v));

describe('package.json entry points', () => {
  it('stays private, and keeps the Node floor', () => {
    expect(pkg.private).toBe(true);
    expect(pkg.engines?.node).toBe('>=20');
  });

  it('bin, main, module, types and the build exports point at files the library build writes', () => {
    const declared = [pkg.bin?.['fusion-sim'], pkg.main, pkg.module, pkg.types];
    for (const [key, v] of Object.entries(pkg.exports ?? {})) if (key === '.' || key === './io') declared.push(...targets(v));
    expect(declared.every((d) => typeof d === 'string')).toBe(true);
    for (const d of declared as string[]) {
      expect(d.replace(/^\.\//, '')).toMatch(/^build\/lib\//);
      expect(BUILD_OUTPUT, d).toContain(d.replace(/^\.\//, '').slice('build/lib/'.length));
    }
  });

  it('the exports map: root and ./io with types, import and require; the schema file; package.json', () => {
    const e = pkg.exports!;
    expect(Object.keys(e).sort()).toEqual(['.', './io', './package.json', './schema']);
    for (const k of ['.', './io']) expect(Object.keys(e[k] as Record<string, string>)).toEqual(['types', 'import', 'require']);
    expect(e['./schema']).toBe('./schema/fusion-sim.schema.json');
    expect(existsSync(join(ROOT, 'schema', 'fusion-sim.schema.json'))).toBe(true);
    // the bin is the ESM command line the build writes, next to the bundles
    expect(pkg.bin).toEqual({ 'fusion-sim': 'build/lib/fusion-sim.js' });
  });

  it('every entry of files exists in the repository, except the build output', () => {
    for (const f of pkg.files ?? []) if (f !== 'build/lib') expect(existsSync(join(ROOT, f)), f).toBe(true);
    expect(pkg.files).toContain('build/lib');
    expect(pkg.files).toContain('schema');
  });

  it('the build:lib, schema and schema:check scripts call scripts that exist', () => {
    expect(pkg.scripts['build:lib']).toBe('node scripts/build-lib.mjs');
    expect(pkg.scripts.schema).toBe('tsx scripts/gen-schema.ts');
    expect(pkg.scripts['schema:check']).toBe('tsx scripts/gen-schema.ts --check');
    for (const s of ['scripts/build-lib.mjs', 'scripts/gen-schema.ts']) expect(existsSync(join(ROOT, s)), s).toBe(true);
    // gen-schema really has the --check flag the script relies on
    expect(readFileSync(join(ROOT, 'scripts', 'gen-schema.ts'), 'utf8')).toMatch(/--check/);
  });
});
