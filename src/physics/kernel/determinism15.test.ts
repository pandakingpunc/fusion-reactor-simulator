/**
 * Determinism of the simulation kernel with the 1.5D profile model (own implicit stepper).
 * Separate from determinism.test.ts so that the two slow files run in parallel.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { canonicalString } from './canonical';
import { advanceRandomly, applyRandomControls, digestOf, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked } from './testkit';

describe('1.5D: chunk invariance', () => {
  it('ITER 1.5D (1 s): 20 seeded random chunk schedules equal runAll() bitwise', () => {
    const cfg = presetCfg('ITER15', 1);
    const ref = referenceRun(cfg);
    for (let s = 1; s <= 20; s++) expectSameRun(runChunked(cfg, 2000 + s), ref, `ITER15 schedule ${s}`);
  }, 180000);

  it('JET 1.5D (0.6 s: L–H transition and ELM frames): 6 seeded random chunk schedules equal runAll() bitwise', () => {
    const cfg = presetCfg('JET15', 0.6);
    const ref = referenceRun(cfg);
    expect(ref.events.some((e) => e.kind === 'ELM')).toBe(true);
    for (let s = 1; s <= 6; s++) expectSameRun(runChunked(cfg, 3000 + s), ref, `JET15 schedule ${s}`);
  }, 180000);
});

describe('1.5D: actuator log', () => {
  it('JET 1.5D (0.6 s): replaying the log of a run with random interventions reproduces it bitwise', () => {
    const cfg = presetCfg('JET15', 0.6);
    const sim = applyRandomControls(new Simulation(cfg), 41, 0.3);
    expect(sim.actuatorLog.length).toBeGreaterThan(3);
    expect(digestOf(sim)).not.toBe(referenceRun(cfg).digest);
    expectSameRun(Simulation.replay(cfg, sim.actuatorLog), sim, 'JET15 replay');
  }, 180000);
});

describe('1.5D: exact rewind', () => {
  // Expected to fail until the 1.5D model checkpoints its own state (equilibrium and transport
  // geometry, solver state, warning flags, ELM history, …) in saveInternal()/saveCheckpoint():
  // the kernel restores its part exactly (frame.sim), but ProfileModel.restoreInternal() does not
  // bring back the equilibrium the run had at the frame (lane ws3). Remove `.fails` then.
  it.fails('ITER 1.5D (1 s): rewind at 25/50/75 % and replay equals the uninterrupted run bitwise', () => {
    const cfg = presetCfg('ITER15', 1);
    const ref = normalizeRng(referenceRun(cfg));
    for (const p of [0.25, 0.5, 0.75]) {
      const sim = rewindAt(cfg, p, 4000 + p * 100);
      advanceRandomly(sim, 4100 + p * 100);
      expectSameRun(normalizeRng(sim), ref, `ITER15 rewound at ${p * 100} %`);
    }
  }, 180000);

  it('JET 1.5D (1.2 s): a rewind to the final frame keeps the shot ended and the run unchanged', () => {
    const cfg = presetCfg('JET15', 1.2);
    const ref = referenceRun(cfg);
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

  // Expected to fail until ProfileModel checkpoints its ELM history: restoreInternal() empties
  // elmTimes, from which report() computes 'ELM frequency (Hz)' (37.11 Hz before the rewind, 0
  // after it); lane ws3. The kernel part (termination, frames, events) is asserted above.
  it.fails('JET 1.5D (1.2 s): a rewind to the final frame leaves report() unchanged (needs the model to checkpoint its ELM history)', () => {
    const cfg = presetCfg('JET15', 1.2);
    const sim = new Simulation(cfg);
    const before = canonicalString(sim.runAll());
    sim.rewindTo(sim.history.length - 1);
    expect(canonicalString(sim.runAll())).toBe(before);
  }, 180000);
});
