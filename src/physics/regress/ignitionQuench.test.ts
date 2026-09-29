/**
 * Regression test (ws3d request, integrator): the 0D ignition state ended nowhere but in the ignition test of
 * the normal phase, so a plasma that disrupted while ignited kept `ignited = 1` through the whole quench
 * (P_α = 0, W → 0 there) and the report's ignition time counted the quench frames. The 1.5D model clears the
 * state at the disruption onset (profiles/events/events.test.ts); the 0D model now does the same.
 */
import { describe, expect, it } from 'vitest';
import { ITER } from '../presets';
import { Simulation } from '../simulation';
import { MagneticConfig } from '../types';

describe('0D ignition state at a disruption', { timeout: 60_000 }, () => {
  // ITER at H98 = 1.6 ignites at 15 s with β_N about 2 and keeps heating up: β_N crosses the Troyon limit
  // 3.5 at about 22 s, while the plasma is still ignited (NTMs off: a seeded NTM would end the burn first).
  // The preset's n_target (0.914e20, n̄/n_G = 0.85) is the density of the scenario. It was set up with 1.0e20 (the density before v4.0
  // re-based it), until the density controller of v4.0-ws2d followed the ramp of n_target 6 % more closely: at 1.0e20 the L-H
  // threshold of this heating (P_LH ~ n̄^0.717, P_L within 2 % of it at 9-10 s) is then missed, the plasma stays in L-mode and
  // collapses radiatively at 29 s.
  const cfg: MagneticConfig = { ...ITER, H98: 1.6, events: { ...ITER.events, ntm: false }, t_end: 60 };
  const sim = new Simulation(cfg);
  const report = sim.runAll();
  const tIgn = sim.events.find((e) => e.kind === 'ignition')?.t;
  const disr = sim.events.find((e) => e.kind === 'disruption');

  it('premise: the shot ignites and then ends in a beta-limit disruption before the ignition is lost', () => {
    expect(tIgn).toBeDefined();
    expect(disr).toBeDefined();
    expect(disr!.msg).toMatch(/beta limit/i);
    expect(tIgn!).toBeLessThan(disr!.t);
    expect(sim.events.some((e) => e.kind === 'info' && /ignition condition lost/i.test(e.msg) && e.t < disr!.t)).toBe(false);
    const before = sim.history.filter((f) => f.t > tIgn! && f.t < disr!.t);
    expect(before.length).toBeGreaterThan(10);
    expect(before.every((f) => f.d.ignited === 1)).toBe(true);
  });

  it('the onset frame and every quench frame are not ignited', () => {
    const after = sim.history.filter((f) => f.t >= disr!.t);
    expect(after.length).toBeGreaterThan(3);
    for (const f of after) expect(f.d.ignited, `t = ${f.t}`).toBe(0);
    // the quench frames really are cold: a plasma with W below 1 % of the pre-quench content is not burning
    expect(sim.history.at(-1)!.d.W).toBeLessThan(0.01 * sim.history.filter((f) => f.t < disr!.t).at(-1)!.d.W);
  });

  it("the report's ignition time is the time of the frames that are ignited, and ends with the burn", () => {
    let ign = 0;
    for (let i = 1; i < sim.history.length; i++) if (sim.history[i].d.ignited > 0) ign += sim.history[i].t - sim.history[i - 1].t;
    expect(report.ignitionTime_s).toBeCloseTo(ign, 12);
    // from the ignition event to the onset, plus at most the output interval that ends at the ignition frame
    const tFrame = sim.history.find((f) => f.t >= tIgn!)!.t;
    const tPrev = sim.history.filter((f) => f.t < tIgn!).at(-1)!.t;
    expect(report.ignitionTime_s).toBeLessThanOrEqual(disr!.t - tPrev + 1e-9);
    expect(report.ignitionTime_s).toBeGreaterThan(disr!.t - tFrame - 1e-9);
  });

  it('the state survives a rewind to a frame before the onset and is cleared again by the replayed disruption', () => {
    const replay = new Simulation(cfg);
    replay.runAll();
    const k = replay.history.findIndex((f) => f.t >= tIgn! + 1);
    replay.rewindTo(k);
    expect(replay.history[replay.history.length - 1].d.ignited).toBe(1);
    replay.runAll();
    expect(replay.history.filter((f) => f.t >= disr!.t).every((f) => f.d.ignited === 0)).toBe(true);
    expect(replay.report().ignitionTime_s).toBe(report.ignitionTime_s);
  });
});
