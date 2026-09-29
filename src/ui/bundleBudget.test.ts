/// <reference types="node" />
/**
 * scripts/check-bundle.mjs on a synthetic build: the entry script is found in index.html, and a main chunk over the
 * budget (bytes or gzip) fails the check with the largest chunks listed, while a chunk within it and a missing build
 * are told apart by the exit code.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-bundle.mjs', import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** a fake `dist` whose main chunk holds `bytes` bytes of incompressible-ish text */
function fakeDist(bytes: number, html?: string): string {
  const dist = mkdtempSync(join(tmpdir(), 'ws10r-dist-'));
  dirs.push(dist);
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), html ?? '<html><head><link rel="modulepreload" href="./assets/other.js"><script type="module" crossorigin src="./assets/index-abc123.js"></script></head></html>');
  let x = 12345, s = '';
  while (s.length < bytes) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += x.toString(36); }
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), s.slice(0, bytes));
  writeFileSync(join(dist, 'assets', 'Report-xyz.js'), 'x'.repeat(4000));
  return dist;
}
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

describe('scripts/check-bundle.mjs', () => {
  it('passes a main chunk within the budget and names it', () => {
    const r = run('--dist', fakeDist(10_000), '--max-kb', '20', '--max-gzip-kb', '20');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('index-abc123.js');
    expect(r.stdout).toContain('10.00 kB');
  });

  it('fails a main chunk over the budget and lists the largest chunks', () => {
    const r = run('--dist', fakeDist(30_000), '--max-kb', '20', '--max-gzip-kb', '100');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('over its budget by 10.00 kB');
    expect(r.stderr).toContain('index-abc123.js');
    expect(r.stderr).toContain('Report-xyz.js');
  });

  it('fails a chunk whose gzip size is over its own budget', () => {
    const r = run('--dist', fakeDist(30_000), '--max-kb', '100', '--max-gzip-kb', '5');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('gzip by');
  });

  it('exits 2 without a build, without a module script and on a bad argument', () => {
    expect(run('--dist', join(tmpdir(), 'ws10r-no-such-dist')).status).toBe(2);
    expect(run('--dist', fakeDist(1000, '<html><script src="./a.js"></script></html>')).status).toBe(2);
    expect(run('--max-kb', 'lots').status).toBe(2);
    expect(run('--frobnicate').status).toBe(2);
  });
});
