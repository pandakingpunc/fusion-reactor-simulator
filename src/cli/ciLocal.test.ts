/// <reference types="node" />
/**
 * scripts/ci-local.mjs --dry-run: the environment knobs of a machine that is shared (vitest workers, threads of validate, golden and
 * the figures check), their validation, the figures step (after golden, before the build; CI_LOCAL_FIGURES=0 skips it) and the bundle-size
 * steps that exist only when scripts/check-bundle.mjs does. The script is copied into a fixture
 * folder (its root is the folder above its own), so that the presence of check-bundle.mjs is under the test's control.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/ci-local.mjs', import.meta.url));
let plain = '', withBundle = '';
const dirs: string[] = [];

function fixture(bundle: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'ci-local-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(SCRIPT, join(dir, 'scripts', 'ci-local.mjs'));
  if (bundle) writeFileSync(join(dir, 'scripts', 'check-bundle.mjs'), '// stub\n');
  return join(dir, 'scripts', 'ci-local.mjs');
}

function dryRun(script: string, env: Record<string, string> = {}) {
  const clean: Record<string, string | undefined> = { ...process.env };
  for (const k of ['CI_LOCAL_WORKERS', 'CI_LOCAL_THREADS', 'CI_LOCAL_BUNDLE', 'CI_LOCAL_FIGURES']) delete clean[k];
  const r = spawnSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8', env: { ...clean, ...env }, timeout: 30_000 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

beforeAll(() => {
  plain = fixture(false);
  withBundle = fixture(true);
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('ci:local knobs', () => {
  it('the defaults are the ones of a machine of its own: unlimited vitest workers, 4 threads for validate, golden and the figures check, no bundle step without the script', () => {
    const r = dryRun(plain);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/unit tests: npx vitest run\r?\n/);
    expect(r.out).toContain('validation: npm run validate -- --threads 4');
    expect(r.out).toContain('golden regression: npm run golden -- --threads 4');
    expect(r.out).toContain('figures reproducible: npm run figures:check -- --threads 4');
    expect(r.out).not.toMatch(/bundle|budget|build/);
    expect(r.out.trim().split(/\r?\n/)).toHaveLength(8);
  });

  it('the figures check runs after the golden regression and before the build, and CI_LOCAL_FIGURES=0 skips it (any other value runs it)', () => {
    const lines = dryRun(withBundle).out.trim().split(/\r?\n/);
    const at = (label: string) => lines.findIndex((l) => l.includes(label));
    expect(at('golden regression')).toBeGreaterThanOrEqual(0);
    expect(at('figures reproducible')).toBe(at('golden regression') + 1);
    expect(at('production build')).toBe(at('figures reproducible') + 1);
    const off = dryRun(withBundle, { CI_LOCAL_FIGURES: '0' });
    expect(off.status).toBe(0);
    expect(off.out).not.toContain('figures');
    expect(off.out.trim().split(/\r?\n/)).toHaveLength(9);
    for (const v of ['1', '', 'no']) expect(dryRun(plain, { CI_LOCAL_FIGURES: v }).out, `CI_LOCAL_FIGURES=${v}`).toContain('figures reproducible');
    // the knobs are independent: neither one drops the other's steps
    expect(dryRun(withBundle, { CI_LOCAL_FIGURES: '0', CI_LOCAL_BUNDLE: '0' }).out.trim().split(/\r?\n/)).toHaveLength(7);
  });

  it('the generated schemas and the configuration reference are checked right after the type check, before the slow steps', () => {
    const lines = dryRun(plain).out.trim().split(/\r?\n/);
    expect(lines[1]).toContain('config schema up to date: npm run schema:check');
    expect(lines[2]).toContain('scenario schema up to date: npm run schema:scenario:check');
    expect(lines[3]).toContain('config reference up to date: npm run docs:config:check');
    expect(lines[4]).toContain('unit tests:');
  });

  it('CI_LOCAL_WORKERS limits the vitest workers and CI_LOCAL_THREADS the threads of validate and golden', () => {
    const r = dryRun(plain, { CI_LOCAL_WORKERS: '3', CI_LOCAL_THREADS: '2' });
    expect(r.status).toBe(0);
    expect(r.out).toContain('unit tests: npx vitest run --maxWorkers=3');
    expect(r.out).toContain('validation: npm run validate -- --threads 2');
    expect(r.out).toContain('golden regression: npm run golden -- --threads 2');
    expect(r.out).toContain('figures reproducible: npm run figures:check -- --threads 2');
  });

  it('an empty value is the default; anything but a positive integer is a usage error (exit 2) that names the variable', () => {
    expect(dryRun(plain, { CI_LOCAL_THREADS: '' }).out).toContain('--threads 4');
    for (const [name, bad] of [['CI_LOCAL_WORKERS', '0'], ['CI_LOCAL_WORKERS', '-1'], ['CI_LOCAL_THREADS', '2.5'], ['CI_LOCAL_THREADS', 'many'], ['CI_LOCAL_THREADS', '1e3']]) {
      const r = dryRun(plain, { [name]: bad });
      expect(r.status, `${name}=${bad}`).toBe(2);
      expect(r.err).toContain(name);
      expect(r.out).toBe('');
    }
  });

  it('the production build and the main-chunk budget are steps when scripts/check-bundle.mjs exists, and CI_LOCAL_BUNDLE=0 drops them', () => {
    const on = dryRun(withBundle);
    expect(on.status).toBe(0);
    const lines = on.out.trim().split(/\r?\n/);
    expect(lines).toHaveLength(10);
    expect(lines[8]).toContain('production build: npm run build');
    expect(lines[9]).toContain('main chunk within budget: node scripts/check-bundle.mjs');
    const off = dryRun(withBundle, { CI_LOCAL_BUNDLE: '0' });
    expect(off.out.trim().split(/\r?\n/)).toHaveLength(8);
    // any other value keeps them
    expect(dryRun(withBundle, { CI_LOCAL_BUNDLE: '1' }).out.trim().split(/\r?\n/)).toHaveLength(10);
  });
});
