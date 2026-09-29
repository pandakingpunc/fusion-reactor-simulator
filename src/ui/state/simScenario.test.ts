/**
 * The page's side of scenarios: the controller loads with a scenario, an invalid one reaches the state as an error, the run
 * keeps the control values of its frames (programmed against actual lanes) and, at completion, the provenance the worker sends,
 * which makes a live run with interventions signable; probing and capturing the log go through the worker as well.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../physics/simulation';
import { TAE } from '../../physics/presets';
import { dropTemplate, type ScenarioSpec } from '../../physics/scenario';
import { fakeWorkerFactory, manualScheduler } from '../../worker/fakeWorker';
import { FromWorker, PROTOCOL_VERSION } from '../../worker/protocol';
import { APP_VERSION } from '../persist/version';
import { fingerprintOf } from '../persist/runRecord';
import { SimController, initialSimState, reduceSim, runProvenance } from './sim';
import type { SimState } from './types';

function setup() {
  const factory = fakeWorkerFactory();
  const sched = manualScheduler();
  const ctrl = new SimController(factory.create, sched.schedule);
  ctrl.attach();
  const w = factory.workers[0];
  const roundTrip = () => { w.process(); w.deliver(); sched.run(); };
  const advance = (dt: number) => { w.advance(dt); w.deliver(); sched.run(); };
  return { ctrl, w, factory, roundTrip, advance, s: () => ctrl.store.getState() };
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
    expect(h.s().trace).toEqual({ keys: ['P_NBI_MW', 'kappa_conf'], rows: [[13, 10]] });
    h.advance(TAE.t_end * 0.7);
    const s = h.s();
    expect(s.trace!.rows).toHaveLength(s.frames.length);
    const nbi = s.trace!.rows.map((r) => r[0]);
    expect(nbi[0]).toBe(13);
    expect(nbi[nbi.length - 1]).toBe(0);
    const at = Math.floor(s.frames.length / 3);
    h.ctrl.rewind(at);
    h.roundTrip();
    expect(h.s().trace!.rows).toHaveLength(at + 1);
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
    expect(s.trace!.rows).toHaveLength(s.frames.length);
    expect(s.trace!.rows.slice(0, before).every((r) => r[0] === 13)).toBe(true);
    expect(s.trace!.rows[s.trace!.rows.length - 1][0]).toBe(3);
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
    const prov = runProvenance(s);
    expect(prov.interventions).toBe(1);
    expect(prov.actuatorLog).toEqual([expect.objectContaining({ patch: { P_NBI_MW: 5 } })]);
    expect(prov.fingerprint).toBe(Simulation.replay(TAE, prov.actuatorLog!).fingerprint(APP_VERSION));
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
    const prov = runProvenance(h.s());
    expect(prov.scenario).toEqual(DROP);
    expect(prov.interventions).toBe(0);
    const ref = new Simulation(TAE, { scenario: DROP });
    ref.runAll();
    expect(prov.fingerprint).toBe(ref.fingerprint(APP_VERSION));
  });

  it('a completed run whose worker sent no provenance (an older worker) keeps the interventions count only', () => {
    const s = { ...initialSimState, interventions: 2 };
    expect(runProvenance(s)).toEqual({ interventions: 2 });
  });

  it('captureLog asks the worker for the provenance as it stands', async () => {
    const h = setup();
    h.ctrl.load(TAE, false, DROP);
    h.roundTrip();
    h.advance(TAE.t_end * 0.2);
    h.ctrl.control({ kappa_conf: 4 });
    const p = h.ctrl.captureLog();
    h.w.process();
    h.w.deliver();
    const log = await p;
    expect(log.actuatorLog).toHaveLength(1);
    expect(log.actuatorLog[0].patch).toEqual({ kappa_conf: 4 });
    expect(log.scenario).toEqual(DROP);
    // no run: a rejected promise, not a hang
    const fresh = setup();
    await expect(fresh.ctrl.captureLog()).rejects.toThrow(/no run/i);
  });

  it('probe builds the model in a worker of its own and resolves with its meta', async () => {
    const h = setup();
    const p = h.ctrl.probe(TAE);
    const probeWorker = h.factory.workers[1];
    expect(probeWorker.last('probe')).toMatchObject({ protocolVersion: PROTOCOL_VERSION, cfg: TAE });
    probeWorker.process();
    probeWorker.deliver();
    const meta = await p;
    expect(meta.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(probeWorker.terminated).toBe(true);
    expect(h.w.terminated).toBe(false);
    // the error of a configuration that cannot be built rejects
    const bad = h.ctrl.probe({ ...TAE, method: 'bogus' } as never);
    const w2 = h.factory.workers[2];
    w2.process();
    w2.deliver();
    await expect(bad).rejects.toThrow();
  });

  it('runAll passes the scenario on', async () => {
    const h = setup();
    const p = h.ctrl.runAll(TAE, false, undefined, DROP);
    const w = h.factory.workers[1];
    expect(w.last('runAll')).toMatchObject({ scenario: DROP });
    w.process();
    w.deliver();
    const r = await p;
    expect(r.report.E_input_MJ).toBeLessThan(new Simulation(TAE).runAll().E_input_MJ);
  });
});

describe('reduceSim and protocol versions', () => {
  const ready = (protocolVersion: number, scenario: ScenarioSpec | null): [SimState, FromWorker] => {
    const h = setup();
    h.ctrl.load(TAE, false, scenario);
    h.w.process();
    const m = h.w.outbox[0];
    return [h.s(), { ...m, protocolVersion } as FromWorker];
  };

  it('accepts a v2 worker for a run without scenario and refuses a v2 worker for one with a scenario', () => {
    const [s0, m2] = ready(2, null);
    expect(reduceSim(s0, m2).status).toBe('ready');
    const [s1, m3] = ready(2, DROP);
    const r = reduceSim(s1, m3);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/cannot run a scenario/);
  });

  it('refuses a worker from the future', () => {
    const [s0, m] = ready(PROTOCOL_VERSION + 1, null);
    expect(reduceSim(s0, m)).toMatchObject({ status: 'error' });
  });
});
