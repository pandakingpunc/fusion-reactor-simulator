/**
 * Determinism of the simulation kernel (0D and pulsed models; the 1.5D model is in
 * determinism15.test.ts): chunk invariance, exact rewind, actuator-log replay, breakpoints.
 * "Bitwise" means equal SHA-256 digests over every number of every frame and event.
 */
import { describe, expect, it } from 'vitest';
import { createModel, Simulation } from '../simulation';
import { PRESETS } from '../presets';
import { RNG } from '../rng';
import type { ActuatorEntry, ReactorConfig } from '../types';
import { canonicalString } from './canonical';
import { UnknownMethodError } from './errors';
import { runFingerprint } from './fingerprint';
import {
  Run, advanceRandomly, applyRandomControls, digestOf, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked, withoutWarnings,
} from './testkit';

const SCHEDULES = 20;

/** 0D / pulsed chunk-invariance cases: [label, preset, shortened t_end] */
const CHUNK_CASES: [string, string, number?][] = [
  ['ITER (30 s: L–H, ELMs, sawteeth, H–L)', 'ITER', 30],
  ['JET DTE2', 'JET'],
  ['W7-X (stellarator)', 'W7X'],
  ['NIF (indirect-drive ICF)', 'NIF'],
  ['Z machine (MagLIF)', 'Z'],
];

describe('chunk invariance: any advance() schedule equals runAll() bitwise', () => {
  for (const [label, id, tEnd] of CHUNK_CASES) {
    it(`${label}: ${SCHEDULES} seeded random chunk schedules`, () => {
      const cfg = presetCfg(id, tEnd);
      const ref = referenceRun(cfg);
      for (let s = 1; s <= SCHEDULES; s++) expectSameRun(runChunked(cfg, 1000 + s), ref, `${id} schedule ${s}`);
    }, 120000);
  }

  it('advance(simDt) stops at the first step boundary at or after t + simDt', () => {
    const sim = new Simulation(presetCfg('JET'));
    const rng = new RNG(5);
    while (!sim.done) {
      const t0 = sim.t, n0 = sim.history.length;
      const dt = sim.model.tEnd * 0.02 * rng.next();
      sim.advance(dt);
      expect(sim.t >= Math.min(t0 + dt, sim.model.tEnd) - 1e-12 || sim.done).toBe(true);
      expect(sim.history.length).toBeGreaterThanOrEqual(n0);
    }
  });
});

describe('exact rewind', () => {
  /** presets whose model checkpoint (saveInternal) is complete */
  for (const [id, tEnd] of [['JET'], ['DIIID', 2], ['NIF'], ['Z'], ['TAE'], ['MIRROR']] as [string, number?][]) {
    it(`${id}: rewind at 25/50/75 % and replay equals the uninterrupted run bitwise`, () => {
      const cfg = presetCfg(id, tEnd);
      const ref = normalizeRng(referenceRun(cfg));
      for (const p of [0.25, 0.5, 0.75]) {
        const sim = rewindAt(cfg, p, 77);
        advanceRandomly(sim, 78);
        expectSameRun(normalizeRng(sim), ref, `${id} rewound at ${p * 100} %`);
      }
    }, 120000);
  }

  // MagneticModel.restoreInternal() clears its once-only warning flags (`warned`), so a warning
  // issued before the rewind point is issued again after it. The physics (every frame's state,
  // diagnostics and internal state, and every other event) is bitwise the same: asserted here.
  for (const [id, tEnd] of [['ITER', 30], ['W7X']] as [string, number?][]) {
    it(`${id}: rewind at 25/50/75 % replays the physics bitwise (warnings aside)`, () => {
      const cfg = presetCfg(id, tEnd);
      const ref = withoutWarnings(normalizeRng(referenceRun(cfg)));
      for (const p of [0.25, 0.5, 0.75]) {
        const sim = rewindAt(cfg, p, 91);
        advanceRandomly(sim, 92);
        expectSameRun(withoutWarnings(normalizeRng(sim)), ref, `${id} rewound at ${p * 100} %`);
      }
    }, 120000);

    // Expected to fail until MagneticModel.saveInternal()/restoreInternal() keep the `warned`
    // flags (request to lane ws2b); remove `.fails` then.
    it.fails(`${id}: rewind at 50 % replays the event list bitwise (needs the model to checkpoint its warning flags)`, () => {
      const cfg = presetCfg(id, tEnd);
      const sim = rewindAt(cfg, 0.5, 93);
      advanceRandomly(sim, 94);
      expectSameRun(normalizeRng(sim), normalizeRng(referenceRun(cfg)), `${id} rewound at 50 %`);
    }, 120000);
  }

  it('restores the controls in force at the frame and truncates later events', () => {
    const cfg = presetCfg('JET');
    const sim = new Simulation(cfg);
    sim.advance(1.0);
    const i = sim.history.length - 1;
    const before = sim.model.getControls();
    expect(sim.history[i].sim?.controls).toEqual(before);
    sim.applyControl({ P_NBI_MW: 5, H98: 1.2 });
    sim.advance(1.0);
    expect(sim.model.getControls().P_NBI_MW).toBe(5);
    expect(sim.history[sim.history.length - 1].sim?.controls.P_NBI_MW).toBe(5);
    const nEv = sim.history[i].sim!.nEvents;
    sim.rewindTo(i);
    expect(sim.model.getControls()).toEqual(before);
    expect(sim.events.length).toBe(nEv);
    expect(sim.history.length).toBe(i + 1);
    expect(sim.actuatorLog).toEqual([]);
  });

  it('clamps the frame index and rejects NaN', () => {
    const sim = new Simulation(presetCfg('NIF'));
    sim.advance(sim.model.tEnd / 3);
    sim.rewindTo(-5);
    expect(sim.history.length).toBe(1);
    expect(sim.t).toBe(0);
    sim.advance(sim.model.tEnd / 3);
    const n = sim.history.length;
    sim.rewindTo(1e9);
    expect(sim.history.length).toBe(n);
    expect(() => sim.rewindTo(NaN)).toThrow(RangeError);
  });

  // A shot that has ended stays ended when rewound to its final frame (frame.sim.terminated):
  // restoreInternal() clears SimModel.terminated, which used to report a finished shot as
  // 'In progress' and let a disrupted or quenched plasma run on to t_end.
  const ENDED: [string, () => ReactorConfig][] = [
    ['JET (scheduled end)', () => presetCfg('JET')],
    ['NIF (pulsed, scheduled end)', () => presetCfg('NIF')],
    ['JET at n = 3e20 m^-3 (density-limit disruption)', () => ({ ...presetCfg('JET'), n_target: 3e20 }) as ReactorConfig],
    ['JET at B0 = 30 T (magnet quench at t = 0)', () => ({ ...presetCfg('JET'), B0: 30 }) as ReactorConfig],
  ];
  for (const [label, mk] of ENDED) {
    it(`${label}: rewinding to the final frame and running again changes nothing, report included`, () => {
      const cfg = mk();
      const ref = new Simulation(cfg);
      const refReport = canonicalString(ref.runAll());
      const term = ref.model.terminated;
      expect(term).not.toBeNull();
      const sim = new Simulation(cfg);
      sim.runAll();
      sim.rewindTo(sim.history.length - 1);
      expect(sim.history[sim.history.length - 1].sim?.terminated).toEqual(term);
      expect(sim.model.terminated).toEqual(term);
      expect(sim.done).toBe(true);
      expect(sim.advance(sim.model.tEnd)).toEqual({ frames: [], events: [] });
      expect(canonicalString(sim.runAll())).toBe(refReport);
      expect(sim.t).toBe(ref.t);
      expectSameRun(normalizeRng(sim), normalizeRng(ref), `${label} rewound to its final frame`);
    }, 60000);
  }

  // Warnings aside, as for ITER and W7-X above: the density-limit warning issued just before the
  // disruption is issued again after a rewind that precedes it (MagneticModel `warned`, lane ws2b).
  it('a disrupted shot rewound before, at and after the disruption replays the physics and the report bitwise', () => {
    const cfg = { ...presetCfg('JET'), n_target: 3e20 } as ReactorConfig;
    const ref = new Simulation(cfg);
    const refReport = canonicalString(ref.runAll());
    expect(ref.model.terminated?.natural).toBe(false);
    const iDis = ref.history.findIndex((f) => f.t >= ref.events.find((e) => e.kind === 'disruption')!.t);
    const n = ref.history.length;
    // before the disruption, the frame of the disruption, the thermal / current quench, the end
    for (const i of [Math.floor(n / 4), Math.floor(n / 2), iDis - 1, iDis, iDis + 1, n - 2, n - 1]) {
      const sim = advanceRandomly(new Simulation(cfg), 60 + i);
      sim.rewindTo(i);
      expect(sim.model.terminated).toEqual(i === n - 1 ? ref.model.terminated : null);
      advanceRandomly(sim, 160 + i);
      expect(canonicalString(sim.report()), `report after a rewind to frame ${i}`).toBe(refReport);
      expectSameRun(withoutWarnings(normalizeRng(sim)), withoutWarnings(normalizeRng(ref)), `disrupted JET rewound to frame ${i} of ${n}`);
    }
  }, 60000);

  it('stores and restores an optional model checkpoint (SimModel.saveCheckpoint)', () => {
    const sim = new Simulation(presetCfg('NIF'));
    let counter = 0;
    const restored: unknown[] = [];
    sim.model.saveCheckpoint = () => ({ n: ++counter });
    sim.model.restoreCheckpoint = (s: unknown) => { restored.push(s); };
    sim.advance(sim.model.tEnd / 2);
    const i = Math.floor(sim.history.length / 2);
    const saved = sim.history[i].sim?.model;
    expect(saved).toEqual({ n: expect.any(Number) });
    sim.rewindTo(i);
    expect(restored).toEqual([saved]);
  });
});

describe('actuator log', () => {
  for (const [id, tEnd] of [['JET'], ['ITER', 30], ['TAE']] as [string, number?][]) {
    it(`${id}: replaying the log of a run with random interventions reproduces it bitwise`, () => {
      const cfg = presetCfg(id, tEnd);
      const sim = new Simulation(cfg);
      applyRandomControls(sim, 31, 0.25);
      expect(sim.actuatorLog.length).toBeGreaterThan(3);
      const plain = referenceRun(cfg);
      expect(digestOf(sim)).not.toBe(plain.digest); // the interventions did change the run
      const replay = Simulation.replay(cfg, sim.actuatorLog);
      expectSameRun(replay, sim, `${id} replay`);
      expect(replay.actuatorLog).toEqual(sim.actuatorLog);
      expect(replay.fingerprint('test')).toBe(sim.fingerprint('test'));
    }, 120000);
  }

  it('logs each patch at the step boundary where it takes effect', () => {
    const sim = new Simulation(presetCfg('JET'));
    sim.applyControl({ P_NBI_MW: 20 });
    sim.advance(0.5);
    const t1 = sim.t, n1 = sim.nSteps;
    sim.applyControl({ n_target_1e20: 0.6, H98: 0.9 });
    expect(sim.actuatorLog).toEqual([
      { t: 0, step: 0, patch: { P_NBI_MW: 20 } },
      { t: t1, step: n1, patch: { n_target_1e20: 0.6, H98: 0.9 } },
    ]);
    // the log holds copies
    const log = sim.actuatorLog;
    log[0].patch.P_NBI_MW = 1;
    expect(sim.actuatorLog[0].patch.P_NBI_MW).toBe(20);
  });

  it('rewind truncates the log; the log of the final branch replays the final run', () => {
    const cfg = presetCfg('JET');
    const sim = new Simulation(cfg);
    sim.advance(1.0);
    sim.applyControl({ P_NBI_MW: 22 });
    sim.advance(1.0);
    const i = sim.history.length - 1;
    sim.advance(0.5);
    sim.applyControl({ P_NBI_MW: 10 }); // on the abandoned branch
    sim.advance(0.5);
    sim.rewindTo(i);
    expect(sim.actuatorLog.map((e) => e.patch.P_NBI_MW)).toEqual([22]);
    sim.applyControl({ H98: 1.0 });
    advanceRandomly(sim, 55);
    const log = sim.actuatorLog;
    expect(log.map((e) => Object.keys(e.patch)[0])).toEqual(['P_NBI_MW', 'H98']);
    const replay = Simulation.replay(cfg, log);
    expectSameRun(normalizeRng(replay), normalizeRng(sim), 'JET replay of the final branch');
  }, 60000);

  it('fingerprint() = runFingerprint(cfg, seed, log, version, breakpoints)', () => {
    const cfg = presetCfg('NIF');
    const sim = new Simulation(cfg, { breakpoints: [1, 2] });
    sim.applyControl({ foo: 1 });
    const log: ActuatorEntry[] = sim.actuatorLog;
    expect(sim.fingerprint('4.0.0')).toBe(runFingerprint(cfg, (cfg as { seed: number }).seed, log, '4.0.0', [1, 2]));
    expect(new Simulation(cfg).fingerprint('4.0.0')).toBe(runFingerprint(cfg, (cfg as { seed: number }).seed, [], '4.0.0'));
  });
});

describe('user breakpoints', () => {
  it('every breakpoint is a step boundary, and chunking still does not matter', () => {
    const cfg = presetCfg('JET');
    const T = (cfg as { t_end: number }).t_end;
    const grid = Array.from({ length: 40 }, (_, k) => 1.3 + k * 0.00237);
    const sim = new Simulation(cfg, { breakpoints: [...grid, -1, T + 1] });
    expect(sim.breakpoints).toEqual(grid);
    const ends: number[] = [];
    while (!sim.done) { sim.advance(2e-12); ends.push(sim.t); }
    for (const b of grid) expect(ends.some((t) => Math.abs(t - b) <= 1e-12)).toBe(true);
    const ref: Run = { history: sim.history, events: sim.events, digest: digestOf(sim) };
    const rng = new RNG(3);
    const chunked = new Simulation(cfg, { breakpoints: grid });
    while (!chunked.done) chunked.advance(T * 0.05 * rng.next());
    expectSameRun(chunked, ref, 'JET with breakpoints, chunked');
    // breakpoints are part of the run: without them the run differs
    expect(referenceRun(cfg).digest).not.toBe(ref.digest);
  }, 60000);
});

describe('configuration errors', () => {
  it('createModel throws UnknownMethodError for an unknown method', () => {
    const bad = { ...PRESETS[0].cfg, method: 'tokamak_x' } as unknown as ReactorConfig;
    expect(() => createModel(bad)).toThrow(UnknownMethodError);
    expect(() => new Simulation(bad)).toThrow(/unknown confinement method 'tokamak_x'/);
    try { createModel(bad); } catch (e) { expect((e as UnknownMethodError).method).toBe('tokamak_x'); }
  });
});
