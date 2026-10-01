/**
 * Determinism of the simulation kernel with the 1.5D profile model (own implicit stepper).
 * Separate from determinism.test.ts so that the two slow files run in parallel.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ProfileModel } from '../profiles/model';
import type { MagneticConfig } from '../types';
import { canonicalString } from './canonical';
import { advanceRandomly, applyRandomControls, digestOf, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked, tick } from './testkit';

describe('1.5D: chunk invariance', () => {
  it('ITER 1.5D (1 s): 20 seeded random chunk schedules equal runAll() bitwise', async () => {
    const cfg = presetCfg('ITER15', 1);
    const ref = referenceRun(cfg);
    for (let s = 1; s <= 20; s++) {
      expectSameRun(runChunked(cfg, 2000 + s), ref, `ITER15 schedule ${s}`);
      await tick();
    }
  }, 180000);

  it('JET 1.5D (0.6 s: L–H transition and ELM frames): 6 seeded random chunk schedules equal runAll() bitwise', async () => {
    const cfg = presetCfg('JET15', 0.6);
    const ref = referenceRun(cfg);
    expect(ref.events.some((e) => e.kind === 'ELM')).toBe(true);
    for (let s = 1; s <= 6; s++) {
      expectSameRun(runChunked(cfg, 3000 + s), ref, `JET15 schedule ${s}`);
      await tick();
    }
  }, 180000);

  it('JET 1.5D fast ions + current drive (0.6 s): 6 seeded random chunk schedules equal runAll() bitwise', async () => {
    const base = presetCfg('JET15', 0.6) as MagneticConfig;
    const cfg: MagneticConfig = {
      ...base, profiles: { ...base.profiles, fastIonModel: 'profile', cdModel: 'physics' },
    };
    const ref = referenceRun(cfg);
    expect(ref.digest).not.toBe(referenceRun(base).digest); // the opt-in physics changes the run
    for (let s = 1; s <= 6; s++) {
      expectSameRun(runChunked(cfg, 3100 + s), ref, `JET15-fast schedule ${s}`);
      await tick();
    }
  }, 180000);
});

describe('1.5D: actuator log', () => {
  it('JET 1.5D (0.6 s): replaying the log of a run with random interventions reproduces it bitwise', async () => {
    const cfg = presetCfg('JET15', 0.6);
    const sim = applyRandomControls(new Simulation(cfg), 41, 0.3);
    expect(sim.actuatorLog.length).toBeGreaterThan(3);
    await tick();
    expect(digestOf(sim)).not.toBe(referenceRun(cfg).digest);
    await tick();
    expectSameRun(Simulation.replay(cfg, sim.actuatorLog), sim, 'JET15 replay');
  }, 180000);
});

describe('1.5D: exact rewind', () => {
  // The kernel restores its part (frame.sim) and ProfileModel checkpoints the rest (equilibrium and
  // transport geometry, solver and controller state, warning flags, ELM history; profiles/checkpoint.ts).
  it('ITER 1.5D (1 s): rewind at 25/50/75 % and replay equals the uninterrupted run bitwise', async () => {
    const cfg = presetCfg('ITER15', 1);
    const ref = normalizeRng(referenceRun(cfg));
    for (const p of [0.25, 0.5, 0.75]) {
      const sim = rewindAt(cfg, p, 4000 + p * 100);
      await tick();
      advanceRandomly(sim, 4100 + p * 100);
      expectSameRun(normalizeRng(sim), ref, `ITER15 rewound at ${p * 100} %`);
      await tick();
    }
  }, 180000);

  it('JET 1.5D (1.2 s): a rewind to the final frame keeps the shot ended and the run unchanged', async () => {
    const cfg = presetCfg('JET15', 1.2);
    const ref = referenceRun(cfg);
    await tick();
    const sim = new Simulation(cfg);
    sim.runAll();
    const term = sim.model.terminated;
    expect(term?.reason).toBe('Scheduled end');
    sim.rewindTo(sim.history.length - 1);
    expect(sim.model.terminated).toEqual(term);
    expect(sim.done).toBe(true);
    sim.runAll();
    expectSameRun(normalizeRng(sim), normalizeRng(ref), 'JET15 rewound to its final frame');
  }, 180000);

  // report() computes 'ELM frequency (Hz)' from the ELM times, which the model checkpoints (37.11 Hz
  // before the rewind; restoreInternal() used to empty them and report 0). The kernel part
  // (termination, frames, events) is asserted above.
  it('JET 1.5D (1.2 s): a rewind to the final frame leaves report() unchanged', () => {
    const cfg = presetCfg('JET15', 1.2);
    const sim = new Simulation(cfg);
    const before = canonicalString(sim.runAll());
    sim.rewindTo(sim.history.length - 1);
    expect(canonicalString(sim.runAll())).toBe(before);
  }, 180000);
});

describe('1.5D: actuator set-points across a rewind', () => {
  const patch = { P_NBI_MW: 12, H98: 1.1 };

  // The kernel re-applies the controls stored in the frame (frame.sim.controls) after the model's
  // restoreInternal(), which leaves the set-points alone on purpose (profiles/checkpoint.ts): the
  // 1.5D model and the 0D models rewind their controls the same way.
  it('the model itself keeps its latest set-points through restoreInternal()', () => {
    const sim = new Simulation(presetCfg('JET15', 0.3));
    sim.advance(0.1);
    const frame = sim.history[sim.history.length - 1];
    const before = sim.model.getControls();
    expect(before.P_NBI_MW).not.toBe(patch.P_NBI_MW);
    sim.model.applyControl(patch);
    sim.model.restoreInternal(frame.internal);
    expect(sim.model.getControls()).toEqual({ ...before, ...patch });
    expect(sim.model).toBeInstanceOf(ProfileModel);
  });

  it('JET 1.5D (0.6 s): a rewind across an applyControl gives back the set-points of the frame, and both branches replay bitwise', async () => {
    const cfg = presetCfg('JET15', 0.6);
    const plain = normalizeRng(referenceRun(cfg)); // no intervention
    const defaults = new Simulation(cfg).model.getControls();
    const sim = new Simulation(cfg);
    sim.advance(0.2);
    const iBefore = sim.history.length - 1; // last frame before the intervention
    const fBefore = sim.history[iBefore];
    expect(fBefore.sim?.controls).toEqual(defaults);
    sim.applyControl(patch);
    sim.advance(0.15);
    const iAfter = sim.history.length - 1; // a frame after it
    expect(iAfter).toBeGreaterThan(iBefore);
    expect(sim.history[iAfter].sim?.controls).toEqual({ ...defaults, ...patch });
    advanceRandomly(sim, 7);
    const withControl = normalizeRng({ history: sim.history, events: sim.events });
    expect(digestOf(withControl)).not.toBe(digestOf(plain)); // the intervention changed the run
    const log = sim.actuatorLog;
    expect(log).toHaveLength(1);
    await tick();

    // back to a frame after the intervention: it stays in force, the log keeps its entry, the run is the same
    sim.rewindTo(iAfter);
    expect(sim.model.getControls()).toEqual({ ...defaults, ...patch });
    expect(sim.actuatorLog).toEqual(log);
    advanceRandomly(sim, 8);
    expectSameRun(normalizeRng(sim), withControl, 'JET15 rewound to a frame after the intervention');
    await tick();

    // back to a frame before it: the set-points of that frame are back (not the latest ones), the entry is gone,
    // and the run is the one without intervention
    sim.rewindTo(iBefore);
    expect(sim.model.getControls()).toEqual(defaults);
    expect(sim.actuatorLog).toEqual([]);
    expect(sim.t).toBe(fBefore.t);
    advanceRandomly(sim, 9);
    expectSameRun(normalizeRng(sim), plain, 'JET15 rewound to a frame before the intervention');
    await tick();

    // the replay of the log of the first branch reproduces it too
    expectSameRun(normalizeRng(Simulation.replay(cfg, log)), withControl, 'JET15 replay of the log');
  }, 180000);

  it('JET 1.5D: rewinding across an applyControl and applying another one branches the log', () => {
    const cfg = presetCfg('JET15', 0.4) as MagneticConfig;
    const sim = new Simulation(cfg);
    sim.advance(0.1);
    const i = sim.history.length - 1;
    sim.applyControl({ P_NBI_MW: 12 });
    sim.advance(0.1);
    sim.rewindTo(i);
    sim.applyControl({ P_ICRH_MW: 9 });
    sim.advance(0.1);
    expect(sim.actuatorLog.map((e) => e.patch)).toEqual([{ P_ICRH_MW: 9 }]);
    const c = sim.model.getControls();
    expect(c.P_ICRH_MW).toBe(9);
    expect(c.P_NBI_MW).toBe(cfg.heating.P_NBI_MW); // the abandoned branch's NBI change is gone
  });
});
