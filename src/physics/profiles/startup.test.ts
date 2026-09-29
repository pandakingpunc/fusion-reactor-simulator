/**
 * The start-up of a 1.5D shot (lane ws6c, the check of the L-H transition and of the temperature overshoot of the first seconds).
 *
 * Findings that the tests keep (README, "Start-up"): (1) the first L-H transition is the crossing of the loss power with the threshold by the
 * auxiliary heating, not by the Joule power of the initial state (the 0.06 s ohmic transition of the first v4.0 runs is gone); (2) the central
 * ion temperature of the first seconds overshoots its flat-top value because the heating ramps up faster than the density (a preset choice, not
 * a start-up artefact of the model): the overshoot follows the heating ramp, and a heating ramp as slow as the density ramp removes most of it.
 * JET15 is the case that costs the least (a shot of 1.3 s takes about 3 s).
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';

const T_END = 1.3;
const run = (rampTime: number) => {
  const cfg: MagneticConfig = { ...JET_15D, t_end: T_END, heating: { ...JET_15D.heating, rampTime } };
  const sim = new Simulation(cfg);
  sim.runAll();
  const peak = sim.history.reduce((m, h) => Math.max(m, h.d.Ti0), 0);
  return { sim, peak };
};

describe('start-up of JET15', () => {
  const fast = run(JET_15D.heating.rampTime); // the preset: 0.5 s
  const slow = run(JET_15D.n_rampTime); // heating ramp as long as the density ramp: 1.5 s

  it('the L-H transition is driven by the auxiliary heating: at the transition P_aux exceeds the Joule power several times, and P_loss is above P_LH', () => {
    const lh = fast.sim.events.find((e) => e.kind === 'LH');
    expect(lh, 'an L-H transition in the first 1.3 s').toBeDefined();
    expect(lh!.t).toBeGreaterThan(0.1); // not at the start of the shot (the ohmic transition of the early v4.0 runs was at 0.06 s)
    const f = fast.sim.history.find((h) => h.t >= lh!.t)!;
    expect(f.d.P_aux).toBeGreaterThan(3 * f.d.P_oh);
    // the initial state, with the Joule power of the full current alone, is far below the threshold
    const f0 = fast.sim.history[0];
    expect(f0.d.P_oh).toBeLessThan(0.25 * f0.d.P_LH);
  });

  it('the temperature overshoot follows the heating ramp: the ramp as slow as the density ramp lowers the peak of T_i0 and moves the L-H transition later', () => {
    expect(slow.peak).toBeLessThan(0.85 * fast.peak);
    const tFast = fast.sim.events.find((e) => e.kind === 'LH')!.t;
    const tSlow = slow.sim.events.find((e) => e.kind === 'LH')?.t ?? Infinity;
    expect(tSlow).toBeGreaterThan(tFast);
    // the overshoot is the response to the ramps, not a numerical start-up transient: the peak of T_i0 is well above the value it relaxes to
    // (the preset: 26.6 keV at 0.5 s, 13 at 1.3 s, 9.8 at 3 s) and the state stays positive throughout
    for (const h of fast.sim.history) expect(h.d.Ti0).toBeGreaterThan(0);
    expect(fast.peak).toBeGreaterThan(1.5 * fast.sim.history[fast.sim.history.length - 1].d.Ti0);
  });
});
