/// <reference types="node" />
/**
 * `--scenario FILE` of the study tools: the file is checked up front (JSON, structure, fit to the model), a scenario reaches every
 * shot of a scan or an ensemble and is part of the study's input hash, its SHA-256 and normalised form are in the JSON result,
 * and the optimiser runs its optimum as a shot with it. Short JET shots (t_end 1 s, about 0.2 s each), in-process; a few end-to-end
 * runs in child processes at the end.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { serialRunner } from '../analysis/run';
import { ensembleHash, resolveSpec } from '../analysis/ensemble';
import { scanHash } from '../analysis/scan';
import { UnknownMethodError } from '../physics/kernel/errors';
import { sha256Hex } from '../physics/kernel/sha256';
import { dropTemplate, scenarioToJSON } from '../physics/scenario';
import { parseArgs } from './args';
import { OPTIMIZE_CLI, optimizeRun } from './optimizeSpec';
import { loadScenarioFile } from './scenarioFlag';
import { SCAN_CLI, scanPrepare, scanReport, scanSpecFromArgs } from './scanSpec';
import { UQ_CLI, uqPrepare, uqReport, uqSpecFromArgs } from './uqSpec';
import { presetConfig } from '../analysis/cliSupport';
import type { ReactorConfig } from '../physics/types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'scenario-flag-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const TRIP = { ...dropTemplate('P_NBI_MW', 0.5, 0), name: 'nbi trip' };
const file = (name: string, content: unknown): string => {
  const p = join(DIR, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};
const TRIP_FILE = file('trip.json', TRIP);
const HASH = sha256Hex(scenarioToJSON(TRIP));
const JET = presetConfig('JET');
const SHORT = ['--preset', 'JET', '--t-end', '1'];

describe('loadScenarioFile', () => {
  it('reads a valid scenario and returns its normalised form', () => {
    const l = loadScenarioFile(TRIP_FILE, JET, { tEnd: 1 });
    expect(l).toEqual({ file: TRIP_FILE, spec: TRIP, empty: false });
    // unsorted points are sorted, defaults dropped: the normalised form is what is used
    const messy = file('messy.json', { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0.8, 4], [0.2, null]] } }, triggers: [] });
    expect(loadScenarioFile(messy, JET).spec.waveforms!.P_NBI_MW.points).toEqual([[0.2, null], [0.8, 4]]);
  });

  it('a file that starts with a UTF-8 byte order mark (Windows PowerShell writes one) reads like the same file without it', () => {
    const bom = file('bom.json', `\uFEFF${scenarioToJSON(TRIP)}`);
    expect(loadScenarioFile(bom, JET, { tEnd: 1 })).toEqual({ file: bom, spec: TRIP, empty: false });
  });

  it('an empty scenario is flagged: attaching it changes nothing', () => {
    expect(loadScenarioFile(file('empty.json', { schema: 1 }), JET).empty).toBe(true);
  });

  it('usage errors (RangeError) that say why: unreadable file, not JSON, invalid structure with every problem, does not fit the model', () => {
    expect(() => loadScenarioFile(join(DIR, 'missing.json'), JET)).toThrow(/--scenario .*missing\.json: cannot read the file/);
    expect(() => loadScenarioFile(file('junk.json', '{nope'), JET)).toThrow(/invalid scenario \(1 problem\):\n {2}not valid JSON/);
    const bad = file('bad.json', { schema: 1, oops: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[0.2, -1]] } } });
    let msg = '';
    try { loadScenarioFile(bad, JET); } catch (e) { expect(e).toBeInstanceOf(RangeError); msg = (e as Error).message; }
    expect(msg).toMatch(/invalid scenario \(2 problems\)/);
    expect(msg).toMatch(/oops: unknown property/);
    expect(msg).toMatch(/waveforms\.P_NBI_MW\.points\[0\]\[1\]: P_NBI_MW must be >= 0 MW/);
    // structurally fine, but the model has no such control / diagnostic
    expect(() => loadScenarioFile(file('ctl.json', { schema: 1, waveforms: { kappa_conf: { kind: 'step', points: [[0.2, 1]] } } }), JET)).toThrow(/unknown control 'kappa_conf'/);
    expect(() => loadScenarioFile(file('diag.json', { schema: 1, triggers: [{ diag: 'nope', op: '>', value: 1, set: { P_NBI_MW: 0 } }] }), JET)).toThrow(/unknown diagnostic 'nope'/);
  });

  it('a read failure is a usage error with the reason of the failure, whatever kind of value the read throws', () => {
    // fs itself throws Error objects (the missing-file case above); the reason is formatted from anything else just the same
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw 'disk on fire'; });
    try {
      expect(() => loadScenarioFile(TRIP_FILE, JET)).toThrow(RangeError);
      expect(() => loadScenarioFile(TRIP_FILE, JET)).toThrow(`--scenario ${TRIP_FILE}: cannot read the file (disk on fire)`);
    } finally {
      spy.mockRestore();
    }
    // the spy is gone: the same file reads again
    expect(loadScenarioFile(TRIP_FILE, JET).empty).toBe(false);
  });

  it('a failure that is not about the scenario passes through unchanged: a configuration the engine rejects is not blamed on the file', () => {
    const broken = { ...JET, method: 'bogus' } as unknown as ReactorConfig;
    let err: unknown;
    try { loadScenarioFile(TRIP_FILE, broken); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UnknownMethodError);
    expect(err).not.toBeInstanceOf(RangeError);
    expect((err as Error).message).toBe("unknown confinement method 'bogus'");
    // whereas a file that is itself wrong, checked against the same good model, is still a usage error
    expect(() => loadScenarioFile(file('junk2.json', '[]'), JET)).toThrow(RangeError);
  });

  it('checks the ramp step against the shot duration the study will use', () => {
    const ramp = file('ramp.json', { schema: 1, rampStep: 1e-4, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[1, 5], [2, 10]] } } });
    expect(() => loadScenarioFile(ramp, JET, { tEnd: 1 })).not.toThrow();
    expect(() => loadScenarioFile(ramp, JET, { tEnd: 1000 })).toThrow(/rampStep: must be >= 0\.1 = t_end \/ 10000/);
  });
});

describe('scan with a scenario', { timeout: 120_000 }, () => {
  const parse = (...a: string[]) => parseArgs(SCAN_CLI, a);
  const AXES = ['--param', 'H98=0.9:1.1:2'];

  it('the scenario reaches the specification and every task; it is part of the input hash, a scan without one hashes as before', () => {
    const withS = scanSpecFromArgs(parse(...SHORT, ...AXES, '--scenario', TRIP_FILE));
    expect(withS.scenario).toEqual(TRIP);
    const plain = scanSpecFromArgs(parse(...SHORT, ...AXES));
    expect('scenario' in plain).toBe(false);
    expect(scanHash(withS)).not.toBe(scanHash(plain));
    const tasks = scanPrepare(parse(...SHORT, ...AXES, '--scenario', TRIP_FILE)).plan.tasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.scenario === withS.scenario || JSON.stringify(t.scenario) === JSON.stringify(TRIP))).toBe(true);
    expect(scanPrepare(parse(...SHORT, ...AXES)).plan.tasks().every((t) => !('scenario' in t))).toBe(true);
    // an empty scenario is left out
    expect('scenario' in scanSpecFromArgs(parse(...SHORT, ...AXES, '--scenario', file('empty2.json', { schema: 1 })))).toBe(false);
  });

  it('an invalid scenario file is a usage error before any shot runs', () => {
    expect(() => scanPrepare(parse(...SHORT, ...AXES, '--scenario', file('bad2.json', { schema: 1, waveforms: { nope: { kind: 'step', points: [[0.1, 1]] } } })))).toThrow(RangeError);
    expect(() => scanPrepare(parse(...SHORT, ...AXES, '--scenario', join(DIR, 'nowhere.json')))).toThrow(/cannot read the file/);
  });

  it('the shots run with it: the trip changes the outcome, the JSON carries the hash and the form', async () => {
    const a = scanPrepare(parse(...SHORT, ...AXES, '--scenario', TRIP_FILE));
    const b = scanPrepare(parse(...SHORT, ...AXES));
    const withS = scanReport(a, await serialRunner(a.plan.tasks()));
    const plain = scanReport(b, await serialRunner(b.plan.tasks()));
    const js = JSON.parse(withS.json), jp = JSON.parse(plain.json);
    expect(js.scenario).toEqual({ sha256: HASH, spec: TRIP });
    expect('scenario' in jp).toBe(false);
    expect(js.inputHash).not.toBe(jp.inputHash);
    expect(js.points[0].metrics.Pfus_flat_MW).not.toBe(jp.points[0].metrics.Pfus_flat_MW);
    expect(withS.text).toMatch(/Scenario "nbi trip" \(sha256 [0-9a-f]{16}\.\.\.\): every shot runs with it/);
    expect(plain.text).not.toMatch(/Scenario/);
    // the csv names the scenario in a comment line, a scan without one has none
    expect(withS.csv.split('\n')[0]).toBe(`# scenario_sha256 ${HASH}`);
    expect(plain.csv.startsWith('run,')).toBe(true);
    // deterministic: the same inputs give the same bytes
    const again = scanReport(a, await serialRunner(a.plan.tasks()));
    expect(again.json).toBe(withS.json);
  });
});

describe('uq with a scenario', { timeout: 120_000 }, () => {
  const parse = (...a: string[]) => parseArgs(UQ_CLI, a);
  const ARGS = [...SHORT, '--n', '2', '--bootstrap', '0', '--priors', 'none', '--param', 'H98=uniform:0.9:1.1'];

  it('reaches the specification, the tasks and the hash; the JSON carries the hash and the form', async () => {
    const withS = uqSpecFromArgs(parse(...ARGS, '--scenario', TRIP_FILE));
    const plain = uqSpecFromArgs(parse(...ARGS));
    expect(withS.scenario).toEqual(TRIP);
    expect('scenario' in plain).toBe(false);
    expect(ensembleHash(withS)).not.toBe(ensembleHash(plain));
    // ... and the hash of a study without a scenario is what resolveSpec always made of it
    expect(ensembleHash(plain)).toBe(ensembleHash(resolveSpec({ ...plain })));
    const prep = uqPrepare(parse(...ARGS, '--scenario', TRIP_FILE));
    const tasks = prep.plan.tasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => JSON.stringify(t.scenario) === JSON.stringify(TRIP))).toBe(true);
    const out = uqReport(prep, await serialRunner(tasks));
    const j = JSON.parse(out.json);
    expect(j.scenario).toEqual({ sha256: HASH, spec: TRIP });
    expect(j.inputHash).toBe(ensembleHash(prep.spec));
    expect(out.text).toMatch(/Scenario "nbi trip" \(sha256 [0-9a-f]{16}\.\.\.\): every shot runs with it/);
    expect(out.csv.split('\n')[0]).toBe(`# scenario_sha256 ${HASH}`);
    expect(out.valid).toBe(2);
  });

  it('an invalid scenario is a usage error', () => {
    expect(() => uqPrepare(parse(...ARGS, '--scenario', file('bad3.json', { schema: 1, triggers: [{ diag: 'nope', op: '>', value: 1, set: { P_NBI_MW: 0 } }] })))).toThrow(/unknown diagnostic 'nope'/);
  });
});

describe('optimize with a scenario', { timeout: 120_000 }, () => {
  const parse = (...a: string[]) => parseArgs(OPTIMIZE_CLI, a);
  const SMALL = ['--preset', 'ITER', '--objective', 'gain', '--vars', 'fG,T', '--q-min', '0', '--q95-min', '2.5', '--start-temps', '8'];

  it('runs the optimised machine as a shot with the scenario and reports it next to the design', () => {
    const trip = file('iter-trip.json', { ...dropTemplate('P_NBI_MW', 100, 0), name: 'iter trip' });
    const out = optimizeRun(parse(...SMALL, '--scenario', trip));
    const j = JSON.parse(out.json);
    expect(out.feasible).toBe(true);
    expect(j.scenarioCheck).toMatchObject({ ran: true, sha256: sha256Hex(scenarioToJSON({ ...dropTemplate('P_NBI_MW', 100, 0), name: 'iter trip' })) });
    expect(j.scenarioCheck.note).toMatch(/not an operating point/);
    expect(typeof j.scenarioCheck.shot.endReason).toBe('string');
    expect(j.scenarioCheck.shot.duration).toBeGreaterThan(0);
    expect(out.text).toMatch(/Scenario "iter trip" \(sha256 [0-9a-f]{16}\.\.\.\) on the optimised machine:/);
    // the design itself is the one without the scenario
    const plain = JSON.parse(optimizeRun(parse(...SMALL)).json);
    expect(j.result).toEqual(plain.result);
    expect(j.inputHash).toBe(plain.inputHash);
    expect('scenarioCheck' in plain).toBe(false);
  });

  it('a Pareto front has no single machine: --scenario is refused; an invalid scenario is a usage error', () => {
    expect(() => optimizeRun(parse('--preset', 'ITER', '--pareto', 'major-radius,aux-power', '--pop-size', '8', '--generations', '1', '--scenario', TRIP_FILE))).toThrow(/applies to a single objective/);
    expect(() => optimizeRun(parse(...SMALL, '--scenario', file('bad4.json', { schema: 1, waveforms: { nope: { kind: 'step', points: [[1, 1]] } } })))).toThrow(RangeError);
  });

  it('an infeasible design is not run: the check says so', () => {
    const out = optimizeRun(parse('--preset', 'ITER', '--objective', 'major-radius', '--vars', 'R', '--bound', 'R=3:3.5', '--q-min', '50', '--start-temps', '8', '--scenario', file('iter-trip2.json', dropTemplate('P_NBI_MW', 100, 0))));
    const j = JSON.parse(out.json);
    expect(out.feasible).toBe(false);
    expect(j.scenarioCheck.ran).toBe(false);
    expect(j.scenarioCheck.shot).toBeUndefined();
    expect(out.text).toMatch(/not run \(no feasible design\)/);
  });
});

describe('the tools end to end', { timeout: 180_000 }, () => {
  function cli(script: string, ...args: string[]) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', `src/cli/${script}.cli.ts`, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 170_000 });
    if (r.error) throw r.error;
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it('scan --scenario writes the hash into its JSON; an invalid scenario exits 2 with every problem on stderr and nothing on stdout', () => {
    const out = join(DIR, 'scan.json');
    const ok = cli('scan', ...SHORT, '--param', 'H98=0.9:1.1:2', '--scenario', TRIP_FILE, '--quiet', '--threads', '2', '--json', out);
    expect(ok.code).toBe(0);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    expect(j.scenario.sha256).toBe(HASH);
    const bad = cli('scan', ...SHORT, '--param', 'H98=0.9:1.1:2', '--scenario', file('bad5.json', { schema: 1, waveforms: { nope: { kind: 'step', points: [[0.1, 1]] } }, extra: 1 }));
    expect(bad.code).toBe(2);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toMatch(/invalid scenario \(2 problems\)/);
    expect(bad.stderr).toMatch(/extra: unknown property/);
  });

  it('uq and optimize refuse a scenario that does not fit with exit 2; --help documents the flag', () => {
    const badFile = file('bad6.json', { schema: 1, waveforms: { nope: { kind: 'step', points: [[0.1, 1]] } } });
    const uq = cli('uq', ...SHORT, '--n', '2', '--priors', 'none', '--param', 'H98=uniform:0.9:1.1', '--scenario', badFile);
    expect(uq.code).toBe(2);
    expect(uq.stderr).toMatch(/unknown control 'nope'/);
    const opt = cli('optimize', '--preset', 'ITER', '--scenario', badFile);
    expect(opt.code).toBe(2);
    expect(opt.stderr).toMatch(/unknown control 'nope'/);
    for (const tool of ['scan', 'uq', 'optimize']) expect(cli(tool, '--help').stdout).toMatch(/--scenario FILE/);
  });
});
