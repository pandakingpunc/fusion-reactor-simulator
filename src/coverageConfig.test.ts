/**
 * The by-name coverage exclusion of type-only modules (TYPE_ONLY_MODULES in vite.config.ts).
 *
 * V8 coverage counts a module that compiles to nothing as an empty file at 100 % in a plain checkout path but as
 * 28 to 63 uncovered lines in a path with a space or a non-ASCII letter, so the ratchet thresholds of `npm run
 * coverage` came out about 2.6 points apart between this repository's own checkout and CI. Excluding those files
 * makes the numbers path-independent; this test keeps the list exact in both directions:
 *  - a listed module must really be type-only (an exclusion must never hide executable code);
 *  - a type-only module that is not listed would bring the path dependence back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';
import { TYPE_ONLY_MODULES } from '../vite.config';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'testdata') out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** true when the module compiles to no runtime code at all (only types, at most an empty export) */
async function isTypeOnly(file: string): Promise<boolean> {
  const src = fs.readFileSync(file, 'utf8');
  const { code } = await transformWithEsbuild(src, file, { format: 'esm' });
  const runtime = code.split('\n').filter((l) => !l.trim().startsWith('//')).join('').replace(/\s+/g, '');
  return runtime === '' || runtime === 'export{};';
}

describe('coverage: type-only modules are excluded by name', () => {
  it('every listed module exists and compiles to no runtime code', async () => {
    expect(TYPE_ONLY_MODULES.length).toBeGreaterThan(0);
    for (const rel of TYPE_ONLY_MODULES) {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), `${rel} exists`).toBe(true);
      expect(await isTypeOnly(file), `${rel} is type-only`).toBe(true);
    }
  });

  // transpiles every source file of src/ (5 to 7 s on a busy machine, over vitest's 5 s default)
  it('every type-only module of src/ is listed (none left to the checkout-path dependent count)', async () => {
    const found: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      if (await isTypeOnly(file)) found.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
    expect(found.sort()).toEqual([...TYPE_ONLY_MODULES].sort());
  }, 60_000);
});
