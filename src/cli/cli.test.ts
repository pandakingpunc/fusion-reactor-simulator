/// <reference types="node" />
/**
 * Exit-code contracts of the validate and golden CLIs, exercised in child processes (node --import tsx).
 * Only presets that run in milliseconds are used.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('--help explains how to capture --json through npm (npm run adds a banner to stdout)', () => {
    const r = validate('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('npm run -s validate -- --json > results.json');
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

describe('golden CLI', { timeout: 60_000 }, () => {
  const golden = (...args: string[]) => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/golden.cli.ts', '--threads', '2', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    if (r.error) throw r.error;
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('usage errors → exit 2 (update without --reason, --reason without update, unknown case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    try {
      const a = golden('--update', '--only', 'NIF', '--dir', dir);
      expect(a.code).toBe(2);
      expect(a.stderr).toMatch(/golden:update requires --reason/);
      expect(golden('--update', '--reason', '   ', '--only', 'NIF', '--dir', dir).code).toBe(2);
      expect(golden('--reason', 'x', '--only', 'NIF', '--dir', dir).code).toBe(2);
      const c = golden('--only', 'NOPE', '--dir', dir);
      expect(c.code).toBe(2);
      expect(c.stderr).toMatch(/Valid values: ITER, .*SPARC15-short/);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('update → check → tamper → mismatch table → update logs the moved key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    try {
      const u = golden('--update', '--reason', 'first record', '--only', 'NIF,Z', '--dir', dir);
      expect(u.code).toBe(0);
      const log = join(dir, 'CHANGES.md');
      const first = readFileSync(log, 'utf8');
      expect(first).toMatch(/^# Golden regression log/);
      expect(first).toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d UTC — first record/);
      expect(first).toMatch(/- Added \(2\): NIF, Z/);

      expect(golden('--only', 'NIF,Z', '--dir', dir).code).toBe(0);
      const again = golden('--update', '--reason', 'no-op', '--only', 'NIF,Z', '--dir', dir);
      expect(again.code).toBe(0);
      expect(again.stdout).toMatch(/already up to date/);
      expect(readFileSync(log, 'utf8')).toBe(first);

      const file = join(dir, 'NIF.json');
      const snap = JSON.parse(readFileSync(file, 'utf8'));
      snap.scalars.Q_sci_max *= 1 + 1e-7;
      writeFileSync(file, JSON.stringify(snap)); // also a different key order and layout
      const bad = golden('--only', 'NIF,Z', '--dir', dir);
      expect(bad.code).toBe(1);
      expect(bad.stdout).toMatch(/NIF +MISMATCH \(1 key\)/);
      expect(bad.stdout).toMatch(/preset +key +old +new +rel diff/);
      expect(bad.stdout).toMatch(/NIF +scalars\.Q_sci_max +[\d.]+ +[\d.]+ +1\.00e-7/);
      expect(bad.stdout).toMatch(/Z +ok/);

      expect(golden('--update', '--reason', 'restore', '--only', 'NIF,Z', '--dir', dir).code).toBe(0);
      const second = readFileSync(log, 'utf8');
      expect(second.startsWith(first)).toBe(true); // append-only
      expect(second).toMatch(/— restore\n\n.*\n\n- Changed \(1\):\n {2}- NIF: 1 key moved; max rel\. diff 1\.00e-7 — scalars\.Q_sci_max\n- Unchanged \(1\): Z\n$/);
      expect(golden('--only', 'NIF,Z', '--dir', dir).code).toBe(0);

      // a file in an older format (previous schema, without the events section) is rejected by the
      // check and described by the update: nothing moved, only keys were added
      const cur = JSON.parse(readFileSync(file, 'utf8'));
      const nEvents = Object.keys(cur.events).length;
      const oldFormat = { ...cur, meta: { ...cur.meta, schema: cur.meta.schema - 1 } };
      delete oldFormat.events;
      writeFileSync(file, JSON.stringify(oldFormat));
      const stale = golden('--only', 'NIF', '--dir', dir);
      expect(stale.code).toBe(1);
      expect(stale.stdout).toMatch(/NIF +BAD GOLDEN FILE +unsupported golden schema/);
      expect(golden('--update', '--reason', 'format', '--only', 'NIF', '--dir', dir).code).toBe(0);
      const third = readFileSync(log, 'utf8');
      expect(third.startsWith(second)).toBe(true);
      expect(third.slice(second.length)).toContain(
        `- NIF: schema ${cur.meta.schema - 1} → ${cur.meta.schema}; 0 keys moved; ${nEvents} key${nEvents === 1 ? '' : 's'} added (events ${nEvents})\n`);
      expect(golden('--only', 'NIF', '--dir', dir).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
