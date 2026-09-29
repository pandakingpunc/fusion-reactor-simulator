/**
 * The page's side of scenarios: the controller loads with a scenario, an invalid one reaches the state as an error, the run keeps the
 * control values of its frames (programmed against actual lanes) and, at completion, the provenance the worker sends, which makes a live
 * run with interventions signable; the worker's answer to a log request lands in the state; probing and background runs go through a
 * worker of their own (oneShot.ts).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../physics/simulation';
import { TAE } from '../../physics/presets';
import { dropTemplate, type ScenarioSpec } from '../../physics/scenario';
import { fakeWorkerFactory, manualScheduler } from '../../worker/fakeWorker';
import { FromWorker, PROTOCOL_VERSION } from '../../worker/protocol';
import { APP_VERSION } from '../persist/version';
import { fingerprintOf } from '../persist/runRecord';
import { probeInWorker } from './oneShot';
import { SimController, initialSimState, reduceSim } from './sim';
import type { SimState } from './types';

function setup() {
  const factory = fakeWorkerFactory();
  const sched = manualScheduler();
  const ctrl = new SimController(factory.create, sched.schedule);
  ctrl.attach();
  const w = factory.workers[0];
  const roundTrip = () => { w.process(); w.deliver(); sched.run(); };
  const advance = (dt: number) => { w.advance(dt); w.deliver(); sched.run(); };
  return { ctrl, w, factory, sched, roundTrip, advance, s: () => ctrl.store.getState() };
}

const DROP: ScenarioSpec = dropTemplate('P_NBI_MW', TAE.t_end * 0.4, 0);

describe('SimController with a scenario', () => {
  it('sends the scenario in the init message and keeps it in the state; restart reuses it', () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    expect(h.w.last('init')).toMatchObject({ protocolVersion: PROTOCOL_VERSION, scenario: DROP });
    expect(h.s().scenario).toEqual(DROP);
    h.roundTrip();
    expect(h.s().status).toBe('ready');
    h.ctrl.restart();
    expect(h.w.last('init')).toMatchObject({ id: 2, scenario: DROP });
    // no scenario: the message has no field at all
    h.ctrl.load(TAE, false);
    expect(h.w.last('init')).not.toHaveProperty('scenario');
    expect(h.s().scenario).toBeNull();
  });

  it('shows an invalid scenario as the run error, with every problem', () => {
    const h = setup();
    h.ctrl.load(TAE, true, { schema: 1, waveforms: { bogus: { kind: 'step', points: [[0.01, 1]] } } } as ScenarioSpec);
    h.roundTrip();
    const s = h.s();
    expect(s.status).toBe('error');
    expect(s.meta).toBeNull();
    expect(s.error).toContain('Invalid scenario (1 problem)');
    expect(s.error).toContain("waveforms.bogus: unknown control 'bogus'");
  });

  it('keeps the control values of every frame, aligned with the frames, and truncates them on a rewind', () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    h.roundTrip();
    expect(h.s().trace).toEqual([[13, 10]]);
    h.advance(TAE.t_end * 0.7);
    const s = h.s();
    expect(s.trace).toHaveLength(s.frames.length);
    const nbi = s.trace!.map((r) => r[0]);
    expect(nbi[0]).toBe(13);
    expect(nbi[nbi.length - 1]).toBe(0);
    const at = Math.floor(s.frames.length / 3);
    h.ctrl.rewind(at);
    h.roundTrip();
    expect(h.s().trace).toHaveLength(at + 1);
    expect(h.s().frames).toHaveLength(at + 1);
    expect(h.s().provenance).toBeNull();
  });

  it('a run without scenario has no trace until its first intervention; earlier frames had the controls of the load', () => {
    const h = setup();
    h.ctrl.load(TAE, false);
    h.roundTrip();
    h.advance(TAE.t_end * 0.3);
    expect(h.s().trace).toBeNull();
    const before = h.s().frames.length;
    h.ctrl.control({ P_NBI_MW: 3 });
    h.advance(TAE.t_end * 0.3);
    const s = h.s();
    expect(s.trace).toHaveLength(s.frames.length);
    expect(s.trace!.slice(0, before).every((r) => r[0] === 13)).toBe(true);
    expect(s.trace![s.trace!.length - 1][0]).toBe(3);
  });

  it('completes with the provenance: a live run with interventions gets its fingerprint and actuator log', () => {
    const h = setup();
    h.ctrl.load(TAE, false);
    h.roundTrip();
    h.advance(TAE.t_end * 0.4);
    h.ctrl.control({ P_NBI_MW: 5 });
    h.w.process();
    h.advance(TAE.t_end);
    const s = h.s();
    expect(s.status).toBe('done');
    const prov = s.provenance!;
    expect(prov.interventions).toBe(1);
    expect(prov.actuatorLog).toEqual([expect.objectContaining({ patch: { P_NBI_MW: 5 } })]);
    expect(prov.fingerprint).toBe(Simulation.replay(TAE, prov.actuatorLog).fingerprint(APP_VERSION));
    // the run file writer takes the fingerprint as the worker computed it (it could not compute it itself)
    expect(fingerprintOf({ cfg: TAE, prov })).toBe(prov.fingerprint);
    // without the worker's word (an older worker) the same run cannot be signed
    expect(fingerprintOf({ cfg: TAE, prov: { interventions: 1 } })).toBeUndefined();
  });

  it('a run with a scenario carries the scenario and its fingerprint into the provenance', () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    h.roundTrip();
    h.advance(TAE.t_end);
    const prov = h.s().provenance!;
    expect(prov.scenario).toEqual(DROP);
    expect(prov.interventions).toBe(0);
    const ref = new Simulation(TAE, { scenario: DROP });
    ref.runAll();
    expect(prov.fingerprint).toBe(ref.fingerprint(APP_VERSION));
  });

  it('a rewind takes the provenance of the abandoned branch away; completing the new branch brings the new one', () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    h.roundTrip();
    h.advance(TAE.t_end);
    expect(h.s().provenance).not.toBeNull();
    h.ctrl.rewind(2);
    h.roundTrip();
    expect(h.s().provenance).toBeNull();
    h.ctrl.control({ kappa_conf: 4 });
    h.w.process();
    h.advance(TAE.t_end);
    expect(h.s().provenance!.actuatorLog).toHaveLength(1);
  });

  it('the worker\'s answer to a log request lands in the state, for the current run only', () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    h.roundTrip();
    h.advance(TAE.t_end * 0.2);
    h.ctrl.control({ kappa_conf: 4 });
    h.ctrl.post({ type: 'getLog', token: 9 });
    h.roundTrip();
    const a = h.s().logAnswer!;
    expect(a.token).toBe(9);
    expect(a.provenance.actuatorLog).toEqual([expect.objectContaining({ patch: { kappa_conf: 4 } })]);
    expect(a.provenance.scenario).toEqual(DROP);
    // an answer of an earlier run is dropped
    h.w.emit({ type: 'log', id: 77, branchId: 0, token: 10, provenance: a.provenance });
    h.sched.run();
    expect(h.s().logAnswer!.token).toBe(9);
  });
});

describe('probes and background runs in a worker of their own', () => {
  it('probeInWorker builds the model in a fresh worker and resolves with its meta', async () => {
    const f = fakeWorkerFactory();
    const p = probeInWorker(f.create, TAE);
    const w = f.workers[0];
    expect(w.last('probe')).toMatchObject({ protocolVersion: PROTOCOL_VERSION, cfg: TAE });
    expect(w.last('probe')).not.toHaveProperty('scenario');
    w.process();
    w.deliver();
    const meta = await p;
    expect(meta.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(w.terminated).toBe(true);
  });

  it('a probe can carry a scenario, and a configuration that cannot be built rejects with the worker\'s message', async () => {
    const f = fakeWorkerFactory();
    const p = probeInWorker(f.create, TAE, DROP);
    expect(f.workers[0].last('probe')).toMatchObject({ scenario: DROP });
    f.workers[0].process();
    f.workers[0].deliver();
    await p;
    const bad = probeInWorker(f.create, { ...TAE, method: 'bogus' } as never);
    f.workers[1].process();
    f.workers[1].deliver();
    await expect(bad).rejects.toThrow(/bogus|method/i);
    expect(f.workers[1].terminated).toBe(true);
  });

  it('a crash of the probe worker rejects', async () => {
    const f = fakeWorkerFactory();
    const p = probeInWorker(f.create, TAE);
    f.workers[0].crash('boom');
    await expect(p).rejects.toThrow('boom');
  });

  it('the controller\'s runAll passes the scenario on', async () => {
    const h = setup();
    const p = h.ctrl.runAll(TAE, false, undefined, DROP);
    await expect.poll(() => h.factory.workers.length).toBe(2);
    const w = h.factory.workers[1];
    expect(w.last('runAll')).toMatchObject({ scenario: DROP });
    w.process();
    w.deliver();
    const r = await p;
    expect(r.report.E_input_MJ).toBeLessThan(new Simulation(TAE).runAll().E_input_MJ);
  });
});

describe('reduceSim and protocol versions', () => {
  it('the page needs the worker of its own build', () => {
    const h = setup();
    h.ctrl.load(TAE, false);
    h.w.process();
    const m = h.w.outbox[0];
    for (const v of [2, PROTOCOL_VERSION + 1]) {
      const r = reduceSim(h.s(), { ...m, protocolVersion: v } as FromWorker);
      expect(r).toMatchObject({ status: 'error' });
      expect(r.error).toMatch(/protocol mismatch/i);
    }
  });

  it('the initial state has no scenario, provenance, trace or log answer', () => {
    const s: SimState = initialSimState;
    expect([s.scenario, s.provenance, s.trace, s.logAnswer]).toEqual([null, null, null, null]);
  });
});
