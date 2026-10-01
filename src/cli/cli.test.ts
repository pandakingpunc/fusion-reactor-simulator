/// <reference types="node" />
/**
 * Exit-code contracts of the validate and golden CLIs, exercised in child processes (node --import tsx).
 * Only presets that run in milliseconds are used. The validate tests assert the report structure, not
 * model values: statuses that must come out a given way (KNOWN-FAIL, XPASS, FAIL) use a fixture check
 * table (--checks) whose ranges any finite NIF gain falls in or out of, so physics changes in other
 * lanes cannot break them.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { REFERENCE_CHECKS, type ReferenceCheck } from '../physics/validation/references';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function validate(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/validate.cli.ts', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface JsonCheck {
  id: string; preset: string; metric: string; kind: string; tolerance: string; value: number | null;
  expected: { lo: number; hi: number }; status: string; pass: boolean; knownFailure?: string;
  published: number; ratio: number | null; deviationPct: number | null; wording: string; role?: string;
  reference: { value: number; uncertainty?: number; band?: [number, number]; source: string; doi?: string; sourceLimitation?: string };
}
interface JsonOut {
  schema: number;
  checks: JsonCheck[];
  presets: { id: string; ok: boolean }[];
  checksExecuted: number;
  failures: number;
  knownFailures: number;
  unexpectedPasses: number;
  wordings: Record<string, number>;
  passed: boolean;
}

/** Fixture checks on the NIF gain (report.Q_sci_max): 'in' contains any finite gain, 'out' none of them. */
const IN: readonly [number, number] = [0, 1e6];
const OUT: readonly [number, number] = [1e6, 2e6];
const fixture = (id: string, accept: readonly [number, number], knownFailure?: string): ReferenceCheck => ({
  id: `NIF.${id}`, preset: 'NIF', metric: `gain ${id}`, path: 'report.Q_sci_max', value: (accept[0] + accept[1]) / 2, unit: '',
  ref: 'Fixture 2020', source: 'CLI test fixture, not a literature value (2020)', accept, tolerance: 'stated',
  kind: 'validation', basis: 'a bound chosen so that the outcome does not depend on the model', ...(knownFailure ? { knownFailure } : {}),
});
const DIR = mkdtempSync(join(tmpdir(), 'validate-checks-'));
const table = (name: string, checks: readonly ReferenceCheck[]): string => {
  const file = join(DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(checks));
  return file;
};
const KNOWN = table('known', [
  fixture('pass', IN), fixture('known', OUT, 'fixture: a documented failure'), fixture('xpass', IN, 'fixture: fixed meanwhile'),
]);
const FAILING = table('failing', [fixture('pass', IN), fixture('fail', OUT), fixture('known', OUT, 'fixture: a documented failure')]);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const CHECK_LINE = /^\s+(PASS|FAIL|KNOWN-FAIL|XPASS)\s+(\S+)\s+(.*?) = (\S+)/;

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

  it('--only NIF → one report line per NIF check of the table, exit code matching the statuses', () => {
    const nif = REFERENCE_CHECKS.filter((c) => c.preset === 'NIF');
    const r = validate('--threads', '2', '--only', 'NIF');
    const lines = r.stdout.split('\n').map((l) => CHECK_LINE.exec(l)).filter((m) => m !== null);
    expect(lines.map((m) => [m[2], m[3]])).toEqual(nif.map((c) => ['NIF', c.metric]));
    for (const m of lines) expect(Number.isFinite(Number(m[4])), m[0]).toBe(true);
    const failed = lines.some((m) => m[1] === 'FAIL');
    expect(r.code).toBe(failed ? 1 : 0);
    expect(r.stdout).toMatch(failed ? /✗ \d+ CHECKS FAILED/ : /✓ (ALL CHECKS PASSED|NO UNEXPECTED FAILURES)/);
  });

  it('--only NIF --json → machine-readable results for NIF only, consistent with the table', () => {
    const r = validate('--threads', '2', '--only', 'NIF', '--json');
    const out = JSON.parse(r.stdout) as JsonOut;
    expect(out.schema).toBe(3);
    expect(out.presets.map((p) => p.id)).toEqual(['NIF']);
    const nif = REFERENCE_CHECKS.filter((c) => c.preset === 'NIF');
    expect(out.checksExecuted).toBe(nif.length);
    expect(out.checks.map((c) => c.id)).toEqual(nif.map((c) => c.id));
    for (const [i, c] of out.checks.entries()) {
      expect(c).toMatchObject({ preset: 'NIF', metric: nif[i].metric, kind: nif[i].kind, tolerance: nif[i].tolerance });
      expect(c.expected).toEqual({ lo: nif[i].accept[0], hi: nif[i].accept[1] });
      expect(c.reference.value).toBe(nif[i].value);
      expect(Number.isFinite(c.value)).toBe(true);
      expect(['pass', 'fail', 'known-fail', 'xpass']).toContain(c.status);
      expect(c.pass).toBe(c.status === 'pass' || c.status === 'xpass');
      // the comparison with the published value: ratio, deviation, wording, role (schema 3)
      expect(c.published).toBe(nif[i].value);
      expect(c.ratio).toBeCloseTo(c.value! / nif[i].value, 12);
      expect(c.deviationPct).toBeCloseTo(100 * (c.ratio! - 1), 9);
      expect(c.wording).toBe(Math.abs(c.ratio! - 1) > 0.2 ? `benchmarked (deviation ${c.deviationPct! < 0 ? '-' : '+'}${Math.abs(c.deviationPct!).toFixed(0)} %)` : 'validated');
      expect(c.role).toBe(nif[i].role);
    }
    expect(out.wordings.benchmarked + out.wordings.validated).toBe(out.checksExecuted);
    expect(out.passed).toBe(out.failures === 0);
    expect(r.code).toBe(out.passed ? 0 : 1);
  });

  it('--only NIF210808,NIF --json → the calibration shot is calibrated, the others blind; ratios and wording as the report prints them', () => {
    const r = validate('--threads', '2', '--only', 'NIF210808,NIF', '--json');
    const out = JSON.parse(r.stdout) as JsonOut;
    const byId = new Map(out.checks.map((c) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual(['NIF.G', 'NIF.G_N230729', 'NIF210808.G']);
    const cal = byId.get('NIF210808.G')!;
    expect(cal).toMatchObject({ role: 'calibration', status: 'pass', published: 0.72 });
    expect(cal.wording).toMatch(/^calibrated \(deviation [+-]\d\.\d %\)$/);
    expect(Math.abs(cal.ratio! - 1)).toBeLessThan(0.01);
    for (const id of ['NIF.G', 'NIF.G_N230729']) expect(byId.get(id)).toMatchObject({ role: 'blind', wording: expect.stringMatching(/^benchmarked \(deviation -\d\d %\)$/) });
    expect(byId.get('NIF.G_N230729')!.reference).toMatchObject({ source: expect.stringContaining('LLNL-PRES-859704'), sourceLimitation: expect.stringContaining('no peer-reviewed paper') });
    expect(byId.get('NIF.G_N230729')!.reference.doi).toBeUndefined();
    expect(byId.get('NIF.G')!.reference.doi).toBe('10.1103/PhysRevLett.132.065102');
    expect(out.wordings).toMatchObject({ calibrated: 1, benchmarked: 2 });
    const text = validate('--threads', '2', '--only', 'NIF210808,NIF');
    expect(text.stdout).toMatch(/^\s+PASS\s+NIF210808 Gain G \(N210808, calibration\) = 0\.715 .*calibrated \(deviation -0\.7 %\)$/m);
    expect(text.stdout).toMatch(/^\s+KNOWN-FAIL\s+NIF\s+Gain G \(N221204, blind\) = 0\.668 .*benchmarked \(deviation -55 %\)$/m);
    expect(text.stdout).toMatch(/wording: 0 validated, 2 benchmarked \(deviation above 20 % from the published value\), 1 calibrated, 0 sanity bounds/);
    expect(text.stdout).toMatch(/NIF\.G: 0\.668, accepted 1–3, model\/published 0\.446 \[blind\] — /);
  });

  it('--help explains how to capture --json through npm (npm run adds a banner to stdout)', () => {
    const r = validate('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('npm run -s validate -- --json > results.json');
    expect(r.stdout).toContain('--checks FILE');
  });

  it('a selection without literature checks → exit 1 (zero checks executed)', () => {
    const r = validate('--threads', '2', '--only', 'NIF', '--checks', KNOWN, '--kind', 'sanity');
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/NO CHECKS EXECUTED/);
    const j = validate('--threads', '2', '--only', 'NIF', '--checks', KNOWN, '--kind', 'sanity', '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.stdout)).toMatchObject({ checksExecuted: 0, passed: false });
  });

  it('documented known failures are reported as KNOWN-FAIL and listed, unexpected passes as XPASS; exit 0', () => {
    const r = validate('--threads', '2', '--only', 'NIF', '--checks', KNOWN);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\s+PASS\s+NIF\s+gain pass = /m);
    expect(r.stdout).toMatch(/^\s+KNOWN-FAIL\s+NIF\s+gain known = /m);
    expect(r.stdout).toMatch(/^\s+XPASS\s+NIF\s+gain xpass = /m);
    expect(r.stdout).toMatch(/=== KNOWN FAILURES .*===\n\s+NIF\.known: .*, accepted 1\.00e\+6–2\.00e\+6, model\/published [-\d.e+]+ — fixture: a documented failure/);
    expect(r.stdout).toMatch(/=== KNOWN FAILURES THAT NOW PASS .*===\n\s+NIF\.xpass: .* within 0–1\.00e\+6/);
    expect(r.stdout).toMatch(/✓ NO UNEXPECTED FAILURES: 2 passed, 1 known failures/);
    const j = JSON.parse(validate('--threads', '2', '--only', 'NIF', '--checks', KNOWN, '--json').stdout) as JsonOut;
    expect(j).toMatchObject({ schema: 3, checksExecuted: 3, failures: 0, knownFailures: 1, unexpectedPasses: 1, passed: true });
    expect(j.checks.map((c) => [c.id, c.status, c.pass])).toEqual([
      ['NIF.pass', 'pass', true], ['NIF.known', 'known-fail', false], ['NIF.xpass', 'xpass', true],
    ]);
    expect(j.checks[1]).toMatchObject({ kind: 'validation', tolerance: 'stated', knownFailure: 'fixture: a documented failure', reference: { value: 1.5e6 } });
  });

  it('an undocumented failure fails the run (exit 1) and is counted apart from the known failures', () => {
    const r = validate('--threads', '2', '--only', 'NIF', '--checks', FAILING);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^\s+FAIL\s+NIF\s+gain fail = /m);
    expect(r.stdout).toMatch(/✗ 1 CHECKS FAILED \(plus 1 known failures\)/);
    expect(JSON.parse(validate('--threads', '2', '--only', 'NIF', '--checks', FAILING, '--json').stdout)).toMatchObject({ failures: 1, knownFailures: 1, passed: false });
  });

  it('--markdown prints a table with model values; --list prints the checks without running', () => {
    const md = validate('--threads', '2', '--only', 'NIF', '--checks', KNOWN, '--markdown');
    expect(md.code).toBe(0);
    expect(md.stdout).toMatch(/^\| Check \| Kind \| Metric \| Reference \| Accepted \| Model \| Ratio \| Status \| Wording \| Source \|$/m);
    expect(md.stdout).toMatch(/^\| `NIF\.pass` \| validation \| gain pass \| 5\.00e\+5 \| 0–1\.00e\+6 \| [-\d.e+]+ \| [-\d.e+]+ \| PASS \| benchmarked \(deviation -[\d.]+ %\) \| Fixture 2020 \|$/m);
    expect(md.stdout).toMatch(/^\| `NIF\.known` \| .* \| KNOWN-FAIL \| benchmarked \(deviation .* %\) \| Fixture 2020 \|$/m);
    expect(md.stdout).toMatch(/^- `NIF\.known` \(known failure\): fixture: a documented failure$/m);
    expect(md.stdout).toMatch(/2 of 3 checks within the accepted range; 1 known failures; 0 unexpected failures\./);
    const list = validate('--list', '--markdown');
    expect(list.code).toBe(0);
    expect(list.stdout).not.toMatch(/SUMMARY/);
    expect(list.stdout.match(/^\| `[A-Za-z0-9]+\.[A-Za-z0-9_]+` \|/gm)!.length).toBe(REFERENCE_CHECKS.length);
    const plain = validate('--list', '--only', 'Z');
    const z = REFERENCE_CHECKS.filter((c) => c.preset === 'Z');
    const rows = plain.stdout.split('\n').filter((l) => /^\s+Z\./.test(l));
    expect(rows).toHaveLength(z.length);
    for (const [i, c] of z.entries()) {
      expect(rows[i]).toMatch(new RegExp(`^\\s+${c.id.replace('.', '\\.')}\\s+${c.kind}\\s+`));
      expect(rows[i].endsWith('(known failure)'), c.id).toBe(c.knownFailure !== undefined);
    }
    expect(plain.stdout).toMatch(new RegExp(`\n${z.length} checks\n`));
    expect(validate('--json', '--markdown', '--only', 'NIF').code).toBe(2);
  });

  it('--checks: a missing file or an invalid table is a usage error (exit 2)', () => {
    const missing = validate('--list', '--checks', join(DIR, 'nope.json'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/--checks: cannot read .*nope\.json/);
    const drift = table('drift', [{ ...fixture('g', [0.7, 3.2]), value: 1.5, uncertainty: 0.1, tolerance: 'gain', accept: [0.75, 3.2] }]);
    const bad = validate('--list', '--checks', drift);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/invalid check table:\n\s+NIF\.g: accept 0\.75–3\.2 is not the gain tolerance of the band 1\.4–1\.6: expected \[0\.7, 3\.2\]/);
    const list = validate('--list', '--checks', KNOWN);
    expect(list.code).toBe(0);
    expect(list.stdout).toMatch(/NIF\.known\s+validation gain known = 1\.50e\+6, accepted 1\.00e\+6–2\.00e\+6\s+\[Fixture 2020\]\s+\(known failure\)/);
    expect(list.stdout).toMatch(/\n3 checks\n/);
  });
});

// The update -> check -> tamper test starts the CLI (node + tsx + two 0D cases) about ten times: 35 s alone, and it passed the 60 s
// of the other groups only on an idle machine, so its budget is three times as long (a hung child is still killed by spawnSync).
describe('golden CLI', { timeout: 180_000 }, () => {
  const golden = (...args: string[]) => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/golden.cli.ts', '--threads', '2', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
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
      expect(second).toMatch(/— restore\n\n.*\n\n- Changed \(1\):\n {2}- NIF: 1 key moved; max rel\. diff 1\.00e-7\n {4}- moved, largest change first: scalars\.Q_sci_max\n- Unchanged \(1\): Z\n$/);
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
      // the added keys are named as added, under their own label
      expect(third.slice(second.length)).toContain(
        `- NIF: schema ${cur.meta.schema - 1} → ${cur.meta.schema}; 0 keys moved; ${nEvents} key${nEvents === 1 ? '' : 's'} added (events ${nEvents})\n` +
        `    - added: ${Object.keys(cur.events).sort().map((k) => `events.${k}`).slice(0, 12).join(', ')}`);
      expect(golden('--only', 'NIF', '--dir', dir).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--reason-file: a long reason in a file (title paragraph plus body), CRLF included; usage errors exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    try {
      const long = 'x'.repeat(9000); // more than npm.cmd takes on a command line (8191 characters)
      const file = join(dir, 'reason.txt');
      writeFileSync(file, `Headline of the change\r\ncontinued here\r\n\r\n(A) first cause: ${long}\r\n\r\n(B) second cause\r\n`);
      const u = golden('--update', '--reason-file', file, '--only', 'NIF', '--dir', dir);
      expect(u.code).toBe(0);
      const log = readFileSync(join(dir, 'CHANGES.md'), 'utf8');
      expect(log).toMatch(/\n## \d{4}-\d\d-\d\d \d\d:\d\d UTC — Headline of the change continued here\n\n\(A\) first cause: x{9000}\n\n\(B\) second cause\n\nNode v\S+ · `npm run golden:update` · --only NIF\n\n- Added \(1\): NIF\n$/);
      expect(golden('--only', 'NIF', '--dir', dir).code).toBe(0);

      // usage errors: both reasons, neither, an unreadable or blank file, and the flag outside an update
      const both = golden('--update', '--reason', 'a', '--reason-file', file, '--only', 'NIF', '--dir', dir);
      expect(both.code).toBe(2);
      expect(both.stderr).toMatch(/--reason and --reason-file are mutually exclusive/);
      const missing = golden('--update', '--reason-file', join(dir, 'nope.txt'), '--only', 'NIF', '--dir', dir);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toMatch(/--reason-file: cannot read .*nope\.txt/);
      const blank = join(dir, 'blank.txt');
      writeFileSync(blank, ' \r\n\r\n');
      const empty = golden('--update', '--reason-file', blank, '--only', 'NIF', '--dir', dir);
      expect(empty.code).toBe(2);
      expect(empty.stderr).toMatch(/blank\.txt contains no text/);
      const outside = golden('--reason-file', file, '--only', 'NIF', '--dir', dir);
      expect(outside.code).toBe(2);
      expect(outside.stderr).toMatch(/--reason-file is only used by golden:update/);
      expect(golden('--update', '--only', 'NIF', '--dir', dir).stderr).toMatch(/requires --reason "why the numbers moved" or --reason-file FILE/);
      expect(readFileSync(join(dir, 'CHANGES.md'), 'utf8')).toBe(log); // none of them wrote anything
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
