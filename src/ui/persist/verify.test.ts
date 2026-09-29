import { describe, expect, it } from 'vitest';
import { canonicalString } from '../../physics/kernel/canonical';
import { runFingerprint } from '../../physics/kernel/fingerprint';
import { Simulation } from '../../physics/simulation';
import { ITER, ITER_15D, MIRROR, NIF, TAE } from '../../physics/presets';
import { ActuatorEntry, ReactorConfig } from '../../physics/types';
import { replayInWorker, ReplayFn } from './replay';
import { ReplayError, replayRun } from './replayCore';
import { buildRunRecord, fingerprintOf, parseRunRecord, RUN_RECORD_FORMAT, RunRecord, RunRecordError, serializeRunRecord } from './runRecord';
import { inlineWorkerFactory } from './testdata/inlineWorker';
import { classify, diffPaths, verifyRecord } from './verify';
import { APP_VERSION } from './version';

/** re-run in-process (the worker's code, without a thread) */
const replay: ReplayFn = async (input, opts) => replayRun(input, opts?.onProgress);

interface Made { rec: RunRecord; text: string; sim: Simulation }

/** Run a configuration the way the application does (advance in pieces, interventions in between) and export it as a run file. */
function makeRecord(cfg: ReactorConfig, opts: { interventions?: { after: number; patch: Record<string, number> }[]; breakpoints?: number[]; version?: string } = {}): Made {
  const sim = new Simulation(cfg, { breakpoints: opts.breakpoints });
  const iv = [...(opts.interventions ?? [])];
  const tEnd = sim.model.tEnd;
  while (!sim.done) {
    const next = iv.shift();
    if (next) { sim.advance(next.after * tEnd); sim.applyControl(next.patch); } else sim.advance(tEnd / 7);
  }
  sim.advance(0);
  const version = opts.version ?? APP_VERSION;
  const report = sim.report();
  const rec = buildRunRecord({
    name: 'test run', cfg, report, events: sim.events, appVersion: version,
    prov: { interventions: sim.actuatorLog.length, actuatorLog: sim.actuatorLog, breakpoints: sim.breakpoints, fingerprint: sim.fingerprint(version) },
    exportedAt: new Date('2026-09-29T12:00:00Z'),
  });
  return { rec, text: serializeRunRecord(rec), sim };
}

describe('the run file', () => {
  it('a run without interventions gets the fingerprint of its inputs, computed on the page', () => {
    const { rec, sim } = makeRecord(TAE);
    expect(rec).toMatchObject({ format: RUN_RECORD_FORMAT, formatVersion: 1, appVersion: APP_VERSION, seed: TAE.seed, exportedAt: '2026-09-29T12:00:00.000Z' });
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.fingerprint).toBe(runFingerprint(TAE, TAE.seed, [], APP_VERSION));
    expect(rec.fingerprint).toBe(sim.fingerprint(APP_VERSION));
    expect(rec.actuatorLog).toBeUndefined();
    // the page alone (no worker report) reaches the same value
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 0 } })).toBe(rec.fingerprint);
    expect(fingerprintOf({ cfg: TAE })).toBe(rec.fingerprint);
  });

  it('a run with interventions is fingerprinted only when its actuator log is known', () => {
    const log: ActuatorEntry[] = [{ t: 0.01, step: 4, patch: { P_NBI_MW: 3 } }];
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 2 } })).toBeUndefined();
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 1, actuatorLog: log } })).toBe(runFingerprint(TAE, TAE.seed, log, APP_VERSION));
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 1, breakpoints: [0.01], actuatorLog: log } })).toBe(runFingerprint(TAE, TAE.seed, log, APP_VERSION, [0.01]));
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 1, fingerprint: 'f'.repeat(64) } })).toBe('f'.repeat(64));
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 0, scenario: { schema: 1 } } })).toBeUndefined(); // only the worker can fingerprint a scenario
    const noLog = buildRunRecord({ name: 'x', cfg: TAE, report: makeRecord(TAE).rec.report, events: [], prov: { interventions: 3 } });
    expect(noLog.fingerprint).toBeUndefined();
    expect(noLog.interventionsUnrecorded).toBe(3);
  });

  it('writes and reads back exactly, including the numbers JSON cannot hold', () => {
    const { rec } = makeRecord(TAE);
    const odd: RunRecord = { ...rec, report: { ...rec.report, lawson_ratio: NaN, Q_sci_max: Infinity, tripleProduct_max: -0 } };
    const text = serializeRunRecord(odd);
    expect(text).toContain('"$num": "NaN"');
    const parsed = parseRunRecord(text);
    expect(canonicalString(parsed.report)).toBe(canonicalString(odd.report));
    expect(Object.is(parsed.report.tripleProduct_max, -0)).toBe(true);
    expect(parsed).toMatchObject({ name: 'test run', legacy: false, appVersion: APP_VERSION, fingerprint: rec.fingerprint });
    // a report without such numbers is plain JSON
    expect(() => JSON.parse(serializeRunRecord(rec))).not.toThrow();
    expect(serializeRunRecord(rec)).not.toContain('$num');
  });

  it('refuses what is not a run file, with the reason', () => {
    const { rec, text } = makeRecord(TAE);
    const mutate = (f: (o: Record<string, unknown>) => void) => { const o = JSON.parse(text); f(o); return JSON.stringify(o); };
    const cases: [string, string, RegExp][] = [
      ['not JSON', 'nope', /not valid JSON/],
      ['an array', '[1]', /does not hold a run/],
      ['a number', '5', /does not hold a run/],
      ['another format', mutate((o) => { o.format = 'something-else'; }), /'something-else' document/],
      ['a future version', mutate((o) => { o.formatVersion = 9; }), /format version 9/],
      ['a bad configuration', mutate((o) => { (o.cfg as Record<string, unknown>).Be_T = 'big'; }), /Be_T: expected a number/],
      ['no report', mutate((o) => { delete o.report; }), /report: missing/],
      ['a report of another method', mutate((o) => { (o.report as Record<string, unknown>).method = 'tokamak'; }), /does not match the configuration/],
      ['not a report', mutate((o) => { o.report = { method: 'frc' }; }), /not a shot report/],
      ['events not an array', mutate((o) => { o.events = 5; }), /events: not an array/],
      ['a bad event', mutate((o) => { o.events = [{ t: 1 }]; }), /an entry is not an event/],
      ['a fingerprint that is not one', mutate((o) => { o.fingerprint = 'abc'; }), /fingerprint: not 64/],
      ['a fingerprint without a version', mutate((o) => { delete o.appVersion; }), /without the simulator version/],
      ['a bad actuator log', mutate((o) => { o.actuatorLog = [{ t: 1, step: 0.5, patch: {} }]; }), /step: not a non-negative integer/],
      ['a name too long', mutate((o) => { o.name = 'x'.repeat(300); }), /name: not a text/],
    ];
    for (const [label, json, msg] of cases) {
      let err: unknown;
      try { parseRunRecord(json); } catch (e) { err = e; }
      expect(err, label).toBeInstanceOf(RunRecordError);
      expect((err as RunRecordError).message, label).toMatch(msg);
    }
    expect(() => parseRunRecord('x'.repeat(20_000_001))).toThrow(/too large/);
    expect(rec.format).toBe(RUN_RECORD_FORMAT);
  });

  it('reads an export from before the run file format as unsigned', () => {
    const { rec } = makeRecord(TAE);
    const legacy = JSON.stringify({ name: 'TAE', exportedAt: '2026-01-01T00:00:00Z', cfg: TAE, report: rec.report, events: rec.events });
    const p = parseRunRecord(legacy);
    expect(p.legacy).toBe(true);
    expect(p.fingerprint).toBeUndefined();
    expect(p.appVersion).toBeUndefined();
  });
});

describe('verified reproduction', () => {
  it('a fresh run file of a simple 0D run is verified', async () => {
    const { text } = makeRecord(MIRROR);
    const { verify, result } = await verifyRecord(parseRunRecord(text), replay);
    expect(verify).toMatchObject({ status: 'verified', inputsIntact: true, reportMatch: true, differences: [] });
    expect(verify.fingerprint.computed).toBe(verify.fingerprint.claimed);
    expect(verify.versions).toEqual({ file: APP_VERSION, current: APP_VERSION });
    expect(result.frames!.length).toBeGreaterThan(5);
    expect(result.meta.method).toBe('mirror');
  });

  it('is verified for a run with live interventions and breakpoints (the actuator log is replayed at its step boundaries)', async () => {
    const cfg = { ...ITER, t_end: 40 };
    const { rec, text } = makeRecord(cfg, { interventions: [{ after: 0.3, patch: { P_NBI_MW: 12 } }, { after: 0.2, patch: { P_NBI_MW: 40, P_ICRH_MW: 5 } }], breakpoints: [5, 12.5] });
    expect(rec.actuatorLog).toHaveLength(2);
    expect(rec.breakpoints).toEqual([5, 12.5]);
    const { verify } = await verifyRecord(parseRunRecord(text), replay);
    expect(verify.status).toBe('verified');
    // the interventions mattered: without the log the run is a different run
    const plain = makeRecord(cfg);
    expect(plain.rec.fingerprint).not.toBe(rec.fingerprint);
    expect(canonicalString(plain.rec.report)).not.toBe(canonicalString(rec.report));
  });

  it('is verified for an ICF shot (pulsed model, nanosecond time base)', async () => {
    const { text } = makeRecord(NIF);
    expect((await verifyRecord(parseRunRecord(text), replay)).verify.status).toBe('verified');
  });

  it('is verified for a short 1.5D run (profiles, equilibrium)', async () => {
    const { text } = makeRecord({ ...ITER_15D, t_end: 6 });
    const { verify, result } = await verifyRecord(parseRunRecord(text), replay);
    expect(verify.status).toBe('verified');
    expect(result.frames!.some((f) => f.prof)).toBe(true);
  }, 120_000);

  it('recognises inputs that were edited after export: tampered', async () => {
    const { text } = makeRecord(TAE);
    const edited = JSON.parse(text);
    edited.cfg.B0 = undefined;
    edited.cfg.Be_T = TAE.Be_T * 1.01;
    const { verify } = await verifyRecord(parseRunRecord(JSON.stringify(edited)), replay);
    expect(verify.status).toBe('tampered');
    expect(verify.inputsIntact).toBe(false);
    expect(verify.fingerprint.computed).not.toBe(verify.fingerprint.claimed);
    // the seed is an input too, as is an actuator log entry added by hand
    const seeded = JSON.parse(text);
    seeded.cfg.seed = TAE.seed + 1;
    expect((await verifyRecord(parseRunRecord(JSON.stringify(seeded)), replay)).verify.status).toBe('tampered');
    const logged = JSON.parse(text);
    logged.actuatorLog = [{ t: 0.01, step: 3, patch: { P_NBI_MW: 1 } }];
    expect((await verifyRecord(parseRunRecord(JSON.stringify(logged)), replay)).verify.status).toBe('tampered');
  });

  it('recognises a report that was edited: mismatch, and names the fields', async () => {
    const { text } = makeRecord(TAE);
    const edited = JSON.parse(text);
    edited.report.Q_sci_max += 1;
    edited.report.termination.reason = 'Totally natural';
    const { verify } = await verifyRecord(parseRunRecord(JSON.stringify(edited)), replay);
    expect(verify.status).toBe('mismatch');
    expect(verify.inputsIntact).toBe(true);
    expect(verify.reportMatch).toBe(false);
    expect(verify.differences).toEqual(['Q_sci_max', 'termination.reason']);
  });

  it('a file from another simulator version is reported as such, and says whether it reproduced anyway', async () => {
    const { text } = makeRecord(TAE, { version: '3.0.0' });
    const { verify } = await verifyRecord(parseRunRecord(text), replay, { currentVersion: '4.0.0' });
    expect(verify.status).toBe('other-version');
    expect(verify.inputsIntact).toBe(true); // the fingerprint is checked with the version the file names
    expect(verify.reportMatch).toBe(true);
    expect(verify.versions).toEqual({ file: '3.0.0', current: '4.0.0' });
  });

  it('an older export or a run whose interventions were not recorded is unsigned, but is still compared', async () => {
    const { rec } = makeRecord(TAE);
    const legacy = JSON.stringify({ name: 'TAE', cfg: TAE, report: rec.report, events: rec.events });
    const a = await verifyRecord(parseRunRecord(legacy), replay);
    expect(a.verify).toMatchObject({ status: 'unsigned', inputsIntact: null, reportMatch: true });
    expect(a.verify.fingerprint.claimed).toBeUndefined();
    const unrecorded = buildRunRecord({ name: 'x', cfg: TAE, report: rec.report, events: rec.events, prov: { interventions: 4 } });
    const b = await verifyRecord(parseRunRecord(serializeRunRecord(unrecorded)), replay);
    expect(b.verify.status).toBe('unsigned');
    expect(parseRunRecord(serializeRunRecord(unrecorded)).interventionsUnrecorded).toBe(4);
  });

  it('classify: every combination has one definite answer', () => {
    const rec = { fingerprint: 'a'.repeat(64), appVersion: '4.0.0' };
    expect(classify(rec, 'a'.repeat(64), true, '4.0.0')).toEqual({ status: 'verified', inputsIntact: true });
    expect(classify(rec, 'a'.repeat(64), false, '4.0.0')).toEqual({ status: 'mismatch', inputsIntact: true });
    expect(classify(rec, 'a'.repeat(64), true, '4.1.0')).toEqual({ status: 'other-version', inputsIntact: true });
    expect(classify(rec, 'b'.repeat(64), true, '4.0.0')).toEqual({ status: 'tampered', inputsIntact: false });
    expect(classify({ appVersion: '4.0.0' }, 'b'.repeat(64), true, '4.0.0')).toEqual({ status: 'unsigned', inputsIntact: null });
  });

  it('diffPaths finds the differing leaves and stops at the limit', () => {
    expect(diffPaths({ a: 1, b: { c: [1, 2, 3], d: 'x' } }, { a: 1, b: { c: [1, 9, 3], d: 'y' } })).toEqual(['b.c.1', 'b.d']);
    expect(diffPaths({ a: 1 }, { b: 1 })).toEqual(['a', 'b']);
    expect(diffPaths(NaN, NaN)).toEqual([]);
    expect(diffPaths(0, -0)).toEqual(['(root)']);
    expect(diffPaths([1, 2], { 0: 1, 1: 2 })).toEqual(['(root)']);
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(diffPaths(many, {}, 3)).toHaveLength(3);
  });
});

describe('the replay worker client', () => {
  it('runs a replay in a worker of its own, reports progress and ends the worker', async () => {
    const f = inlineWorkerFactory();
    const progress: number[] = [];
    let clock = 0;
    const f2 = inlineWorkerFactory(() => (clock += 1000)); // every progress call is 1 s after the last: none is throttled away
    const r = await replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f2.create, onProgress: (p) => progress.push(p.t / p.tEnd) });
    expect(r.report.method).toBe('frc');
    expect(r.fingerprint).toBe(runFingerprint(TAE, TAE.seed, [], APP_VERSION));
    expect(progress.length).toBeGreaterThan(3);
    expect(progress[progress.length - 1]).toBeCloseTo(1, 6);
    expect(f2.workers).toHaveLength(1);
    expect(f2.workers[0].terminated).toBe(true);
    expect(f.workers).toHaveLength(0);
  });

  it('throttles progress messages to about ten a second', async () => {
    const f = inlineWorkerFactory(() => 0); // the clock never moves
    const seen: number[] = [];
    await replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f.create, onProgress: (p) => seen.push(p.t) });
    expect(seen.length).toBe(1); // only the first is posted while the clock is stuck
  });

  it('reports a configuration that cannot be run as a failed replay', async () => {
    const f = inlineWorkerFactory();
    const bad = { ...TAE, method: 'nope' } as unknown as ReactorConfig;
    const err = await replayInWorker({ cfg: bad, appVersion: APP_VERSION }, { createWorker: f.create }).catch((e) => e);
    expect(err).toBeInstanceOf(ReplayError);
    expect(err.code).toBe('failed');
    expect(f.workers[0].terminated).toBe(true);
  });

  it('refuses a run with a scenario on a build without the scenario engine, instead of running it without', async () => {
    if ('scenario' in Simulation.prototype) return; // with the engine present this refusal does not apply
    const f = inlineWorkerFactory();
    const err = await replayInWorker({ cfg: TAE, appVersion: APP_VERSION, scenario: { schema: 1, waveforms: {}, triggers: [] } }, { createWorker: f.create }).catch((e) => e);
    expect(err).toMatchObject({ name: 'ReplayError', code: 'unsupported' });
  });

  it('an abort terminates the worker and rejects with AbortError, before or during the run', async () => {
    const f = inlineWorkerFactory();
    const ac = new AbortController();
    const p = replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f.create, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.workers[0].terminated).toBe(true);
    const pre = new AbortController();
    pre.abort();
    await expect(replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f.create, signal: pre.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.workers).toHaveLength(1); // no worker was made for the second
  });

  it('a crashing worker rejects and is terminated', async () => {
    const f = inlineWorkerFactory();
    const p = replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f.create });
    f.workers[0].crash('boom');
    await expect(p).rejects.toMatchObject({ code: 'failed', message: 'boom' });
    expect(f.workers[0].terminated).toBe(true);
  });

  it('ignores messages of another replay', async () => {
    const f = inlineWorkerFactory();
    const p = replayInWorker({ cfg: TAE, appVersion: APP_VERSION }, { createWorker: f.create });
    f.workers[0].onmessage?.({ data: { type: 'error', id: 999, code: 'failed', msg: 'not for you' } } as never);
    const r = await p;
    expect(r.report.method).toBe('frc');
  });
});
