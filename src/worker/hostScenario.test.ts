/**
 * The simulation worker host with scenarios (protocol v3): the scenario goes through `init`, an invalid one comes back as an
 * error message that lists its problems, `done` and `getLog` carry the provenance of the run (so a live run with interventions
 * can be signed), `frames` carry the control values of their frames, `probe` describes the model without running it, and a v2
 * page is still understood.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../physics/simulation';
import { TAE } from '../physics/presets';
import { dropTemplate, type ScenarioSpec } from '../physics/scenario';
import { APP_VERSION } from '../ui/persist/version';
import { createSimHost, scenarioErrorText } from './host';
import { FromWorker, PROTOCOL_VERSION, ToWorker } from './protocol';
import { ScenarioError } from '../physics/kernel/errors';

function harness() {
  const out: FromWorker[] = [];
  const host = createSimHost((m) => out.push(m));
  const take = () => out.splice(0, out.length);
  const init = (scenario?: ScenarioSpec, id = 7) => host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id, cfg: TAE, ...(scenario ? { scenario } : {}) });
  return { host, out, take, init };
}
const ofType = <K extends FromWorker['type']>(ms: FromWorker[], type: K) => ms.filter((m): m is Extract<FromWorker, { type: K }> => m.type === type);

/** drop the NBI power at 40 % of the shot */
const DROP = dropTemplate('P_NBI_MW', TAE.t_end * 0.4, 0);

describe('scenario through the worker host', () => {
  it('builds the run with the scenario of the init message: the drop is in the control values of the frames', () => {
    const h = harness();
    h.init(DROP);
    const [ready] = ofType(h.take(), 'ready');
    expect(ready.protocolVersion).toBe(PROTOCOL_VERSION);
    h.host.handle({ type: 'step', simDt: TAE.t_end });
    const msgs = h.take();
    const frames = ofType(msgs, 'frames');
    const rows = frames.flatMap((m) => m.ctl!.rows);
    const keys = frames[0].ctl!.keys;
    expect(keys).toEqual(['P_NBI_MW', 'kappa_conf']);
    // one row per frame, of the message it came in
    for (const m of frames) expect(m.ctl!.rows).toHaveLength(m.frames.length);
    const times = frames.flatMap((m) => m.frames.map((f) => f.t));
    const nbi = rows.map((r) => r[keys.indexOf('P_NBI_MW')]);
    expect(nbi[0]).toBe(TAE.P_NBI_MW); // before the drop the configured value
    expect(nbi[nbi.length - 1]).toBe(0);
    // the switch happens at a step boundary at or after 40 % of the shot, and stays
    const first0 = nbi.findIndex((v) => v === 0);
    expect(times[first0]).toBeGreaterThanOrEqual(TAE.t_end * 0.4 - 1e-12);
    expect(nbi.slice(first0).every((v) => v === 0)).toBe(true);
    // the scenario really changed the run: less energy than the unscripted one
    const done = ofType(msgs, 'done')[0];
    const plain = new Simulation(TAE).runAll();
    expect(done.report.E_input_MJ).toBeLessThan(plain.E_input_MJ);
  });

  it('answers an invalid scenario with an error that names every problem, and stays usable', () => {
    const h = harness();
    const bad = { schema: 1, waveforms: { bogus: { kind: 'step', points: [[0.01, 1]] }, P_NBI_MW: { kind: 'step', points: [[0.01, -3]] } } } as unknown as ScenarioSpec;
    h.init(bad);
    const out = h.take();
    expect(ofType(out, 'ready')).toHaveLength(0);
    const [err] = ofType(out, 'error');
    expect(err).toMatchObject({ id: 7 });
    expect(err.msg).toMatch(/^Invalid scenario \(2 problems\):/);
    expect(err.msg).toContain("waveforms.bogus: unknown control 'bogus'");
    expect(err.msg).toContain('waveforms.P_NBI_MW.points[0][1]: P_NBI_MW must be >= 0 MW');
    expect(err.msg).not.toMatch(/\n\s+at /); // the problems, not a stack trace
    h.init(DROP, 8);
    expect(ofType(h.take(), 'ready')).toHaveLength(1);
  });

  it('refuses a rampStep finer than t_end / 1e4 like the kernel does', () => {
    const h = harness();
    h.init({ schema: 1, rampStep: TAE.t_end / 1e5, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0.01, 5], [0.02, 10]] } } });
    const [err] = ofType(h.take(), 'error');
    expect(err.msg).toContain('rampStep');
  });

  it('reports the diagnostics a trigger names against the frames of the model', () => {
    const h = harness();
    h.init({ schema: 1, triggers: [{ diag: 'not_a_diagnostic', op: '>', value: 1, set: { P_NBI_MW: 0 } }] });
    expect(ofType(h.take(), 'error')[0].msg).toContain("unknown diagnostic 'not_a_diagnostic'");
  });

  it('completes with the provenance of the run: scenario, breakpoints, empty actuator log and its fingerprint', () => {
    const h = harness();
    h.init(DROP);
    h.take();
    h.host.handle({ type: 'step', simDt: TAE.t_end });
    const [done] = ofType(h.take(), 'done');
    expect(done.provenance).toBeDefined();
    const p = done.provenance!;
    expect(p.actuatorLog).toEqual([]);
    expect(p.breakpoints).toEqual([]);
    expect(p.scenario).toEqual(DROP);
    expect(p.appVersion).toBe(APP_VERSION);
    const ref = new Simulation(TAE, { scenario: DROP });
    ref.runAll();
    expect(p.fingerprint).toBe(ref.fingerprint(APP_VERSION));
    expect(p.fingerprint).not.toBe(new Simulation(TAE).fingerprint(APP_VERSION));
  });

  it('signs a live run with interventions: the reported log replays to the same report', () => {
    const h = harness();
    h.init();
    h.take();
    h.host.handle({ type: 'step', simDt: TAE.t_end * 0.3 });
    h.host.handle({ type: 'control', patch: { P_NBI_MW: 4 } });
    h.host.handle({ type: 'step', simDt: TAE.t_end * 0.2 });
    h.host.handle({ type: 'control', patch: { kappa_conf: 6 } });
    h.host.handle({ type: 'step', simDt: TAE.t_end });
    const msgs = h.take();
    const [done] = ofType(msgs, 'done');
    const p = done.provenance!;
    expect(p.actuatorLog.map((e) => e.patch)).toEqual([{ P_NBI_MW: 4 }, { kappa_conf: 6 }]);
    expect(p.scenario).toBeNull();
    // the frames carry the controls once there was an intervention
    const frames = ofType(msgs, 'frames').filter((m) => m.ctl);
    expect(frames.length).toBeGreaterThan(0);
    const replay = Simulation.replay(TAE, p.actuatorLog);
    expect(replay.report()).toEqual(done.report);
    expect(replay.fingerprint(APP_VERSION)).toBe(p.fingerprint);
  });

  it('getLog answers with the provenance as it stands, without ending or disturbing the run', () => {
    const h = harness();
    h.init(DROP);
    h.take();
    h.host.handle({ type: 'step', simDt: TAE.t_end * 0.2 });
    h.host.handle({ type: 'control', patch: { kappa_conf: 5 } });
    h.take();
    h.host.handle({ type: 'getLog', token: 41 });
    const [log] = ofType(h.take(), 'log');
    expect(log).toMatchObject({ id: 7, branchId: 0, token: 41 });
    expect(log.provenance.actuatorLog).toHaveLength(1);
    expect(log.provenance.actuatorLog[0].patch).toEqual({ kappa_conf: 5 });
    expect(log.provenance.scenario).toEqual(DROP);
    // the run goes on
    h.host.handle({ type: 'step', simDt: TAE.t_end });
    expect(ofType(h.take(), 'done')).toHaveLength(1);
  });

  it('sends the control values only when there is a scenario or an intervention', () => {
    const h = harness();
    h.init();
    h.take();
    h.host.handle({ type: 'step', simDt: TAE.t_end * 0.1 });
    const plain = ofType(h.take(), 'frames');
    expect(plain.every((m) => m.ctl === undefined)).toBe(true);
    h.host.handle({ type: 'control', patch: { P_NBI_MW: 2 } });
    h.host.handle({ type: 'step', simDt: TAE.t_end * 0.1 });
    const after = ofType(h.take(), 'frames');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((m) => m.ctl !== undefined)).toBe(true);
    expect(after[after.length - 1].ctl!.rows.at(-1)![0]).toBe(2);
  });

  it('probes the model of a configuration without a run and without touching the live one', () => {
    const h = harness();
    h.init();
    h.take();
    h.host.handle({ type: 'probe', protocolVersion: PROTOCOL_VERSION, id: 99, cfg: TAE });
    const [probed] = ofType(h.take(), 'probed');
    expect(probed).toMatchObject({ id: 99, protocolVersion: PROTOCOL_VERSION });
    expect(probed.meta.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(probed.meta.tEnd).toBe(TAE.t_end);
    expect(probed.meta.diagSpecs.length).toBeGreaterThan(5);
    // an invalid probe is an error of its own id and leaves the live run alone
    h.host.handle({ type: 'probe', protocolVersion: PROTOCOL_VERSION, id: 100, cfg: { ...TAE, method: 'bogus' } as never });
    const [err] = ofType(h.take(), 'error');
    expect(err.id).toBe(100);
    h.host.handle({ type: 'step', simDt: TAE.t_end });
    expect(ofType(h.take(), 'done')).toHaveLength(1);
  });

  it('runAll takes a scenario too', () => {
    const h = harness();
    h.host.handle({ type: 'runAll', protocolVersion: PROTOCOL_VERSION, id: 5, cfg: TAE, scenario: DROP });
    const [r] = ofType(h.take(), 'runAllDone');
    const ref = new Simulation(TAE, { scenario: DROP }).runAll();
    expect(r.report).toEqual(ref);
  });

  it('is backward compatible: a v2 page is served, other versions are refused', () => {
    const h = harness();
    h.host.handle({ type: 'init', protocolVersion: 2, id: 1, cfg: TAE } as ToWorker);
    const [ready] = ofType(h.take(), 'ready');
    expect(ready.protocolVersion).toBe(PROTOCOL_VERSION);
    for (const v of [1, PROTOCOL_VERSION + 1, NaN]) {
      h.host.handle({ type: 'init', protocolVersion: v, id: 2, cfg: TAE } as ToWorker);
      expect(ofType(h.take(), 'error')[0].msg).toMatch(/protocol mismatch/i);
    }
  });
});

describe('scenarioErrorText', () => {
  it('lists up to twelve problems and counts the rest', () => {
    const issues = Array.from({ length: 15 }, (_, i) => ({ path: `waveforms.k${i}`, message: 'bad' }));
    const text = scenarioErrorText(new ScenarioError(issues));
    expect(text.split('\n')).toHaveLength(1 + 12 + 1);
    expect(text).toContain('(15 problems)');
    expect(text).toContain('... and 3 more');
    expect(scenarioErrorText(new ScenarioError([{ path: '', message: 'not valid JSON' }]))).toBe('Invalid scenario (1 problem):\n  not valid JSON');
  });
});
