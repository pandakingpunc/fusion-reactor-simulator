/// <reference types="node" />
/**
 * Exit-code contract of the validate CLI, exercised in a child process (node --import tsx).
 * Only presets that run in milliseconds are used.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function validate(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/validate.cli.ts', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface JsonOut {
  checks: { preset: string; metric: string; value: number | null; expected: { lo: number; hi: number }; pass: boolean }[];
  presets: { id: string; ok: boolean }[];
  checksExecuted: number;
  failures: number;
  passed: boolean;
}

describe('validate CLI exit codes', { timeout: 60_000 }, () => {
  it('unknown --only id → exit 2, listing the valid ids', () => {
    const r = validate('--only', 'NOPE');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--only: unknown value 'NOPE'\. Valid values: ITER, JET, .*MUON/);
    expect(r.stdout).toBe('');
  });

  it('non-integer --threads → exit 2', () => {
    const r = validate('--threads', 'abc', '--only', 'NIF');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--threads expects an integer, got 'abc'/);
  });

  it('--threads 0 → exit 2', () => {
    const r = validate('--threads', '0', '--only', 'NIF');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--threads must be >= 1, got 0/);
  });

  it('unknown flag → exit 2', () => {
    const r = validate('--onyl', 'NIF');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown flag --onyl \(did you mean --only\?\)/);
  });

  it('--only NIF → exit 0 with exactly the NIF checks (human report)', () => {
    const r = validate('--threads', '2', '--only', 'NIF');
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n').filter((l) => /^\s+(PASS|FAIL)\s/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\s+PASS\s+NIF\s+Gain G = /);
    expect(r.stdout).toMatch(/✓ ALL CHECKS PASSED/);
  });

  it('--only NIF --json → exit 0, machine-readable results for NIF only', () => {
    const r = validate('--threads', '2', '--only', 'NIF', '--json');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as JsonOut;
    expect(out.presets.map((p) => p.id)).toEqual(['NIF']);
    expect(out.checksExecuted).toBe(1);
    expect(out.checks).toHaveLength(1);
    const c = out.checks[0];
    expect(c).toMatchObject({ preset: 'NIF', metric: 'Gain G', expected: { lo: 1, hi: 3 }, pass: true });
    expect(c.value).toBeGreaterThan(1);
    expect(out).toMatchObject({ failures: 0, passed: true });
  });

  it('a selection without literature checks → exit 1 (zero checks executed)', () => {
    const r = validate('--threads', '2', '--only', 'TAE');
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/NO CHECKS EXECUTED/);
    const j = validate('--threads', '2', '--only', 'TAE', '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.stdout)).toMatchObject({ checksExecuted: 0, passed: false });
  });
});
