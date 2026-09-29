/**
 * The ignition state and the ignition test (heating.autoOff) of the 1.5D model, with the definitions of
 * the 0D model (confinement/magnetic.ts): ignition is P_α ≥ P_rad + W/τ_E with hysteresis, the ignition
 * test ramps the external heating down at Q ≥ 5. The event logic is in events/events.test.ts; here the
 * shot: an ITER15 that ignites on H98 = 1.4.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D } from '../presets';
import type { MagneticConfig, SimEvent } from '../types';
import { rel } from './testkit';

describe('ignition and the ignition test (heating.autoOff)', () => {
  const cfg = (autoOff: boolean, H98 = 1.4): MagneticConfig => ({ ...ITER_15D, t_end: 40, H98, heating: { ...ITER_15D.heating, autoOff } });
  const run = (c: MagneticConfig) => { const sim = new Simulation(c); const r = sim.runAll(); return { sim, r }; };
  let test: ReturnType<typeof run>;
  let tests: SimEvent[];
  beforeAll(() => {
    test = run(cfg(true));
    tests = test.sim.events.filter((e) => e.kind === 'info' && e.msg.startsWith('Ignition test'));
  }, 120000);

  it('at Q ≥ 5 the external heating ramps down linearly over heating.rampTime, once, and the plasma ignites on its own α heating', () => {
    expect(tests).toHaveLength(1);
    const tOff = tests[0].t;
    const ramp = ITER_15D.heating.rampTime, P0 = ITER_15D.heating.P_NBI_MW + ITER_15D.heating.P_ICRH_MW + ITER_15D.heating.P_ECRH_MW;
    // the start-up ramp min(1, t/rampTime) is still on its way up when Q reaches 5 (ITER15: t = 10.5 s, rampTime = 10 s)
    const factor = (t: number) => Math.min(1, t / ramp) * Math.max(0, 1 - (t - tOff) / ramp);
    const before = test.sim.history.filter((h) => h.t < tOff - 0.5);
    expect(before.length).toBeGreaterThan(5);
    for (const h of before.slice(1)) expect(Math.abs(h.d.P_aux - P0 * Math.min(1, h.t / ramp))).toBeLessThan(0.06 * P0);
    let last = P0 + 1, n = 0;
    for (const h of test.sim.history.filter((x) => x.t > tOff + 0.5 && x.t < tOff + ramp)) {
      expect(h.d.P_aux).toBeLessThanOrEqual(last + 1e-9);
      expect(h.d.P_aux).toBeLessThan(P0);
      // linear down: the heating of a step is that of its start (a step is at most ~0.5 s long)
      expect(Math.abs(h.d.P_aux - P0 * factor(h.t))).toBeLessThan(0.06 * P0);
      last = h.d.P_aux; n++;
    }
    expect(n).toBeGreaterThan(5);
    for (const h of test.sim.history.filter((x) => x.t > tOff + ramp + 0.6)) expect(h.d.P_aux).toBe(0);
    // ignition: an event, the diagnostic and the report agree
    const ign = test.sim.events.filter((e) => e.kind === 'ignition');
    expect(ign).toHaveLength(1);
    expect(ign[0].t).toBeGreaterThan(tOff);
    const flagged = test.sim.history.filter((h) => h.d.ignited === 1);
    expect(flagged.length).toBeGreaterThan(5);
    // the definition with its hysteresis: on at P_α ≥ P_rad + W/τ_E, off below 0.9 of it. (A frame right after an ELM or a
    // sawtooth crash shows the flag of the step and diagnostics re-evaluated on the crashed profiles: not compared.)
    const crashes = new Set(test.sim.events.filter((e) => e.kind === 'ELM' || e.kind === 'sawtooth').map((e) => e.t));
    const steps = flagged.filter((h) => !crashes.has(h.t));
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.every((h) => h.d.P_alpha >= 0.9 * (h.d.P_rad + h.d.P_cond) - 1e-9)).toBe(true);
    expect(flagged.some((h) => h.d.P_aux === 0)).toBe(true); // it sustains itself without any external heating
    const first = test.sim.history.find((h) => h.d.ignited === 1 && !crashes.has(h.t))!;
    // (the flagged frame is recorded a fraction of a step after the ignition step, and this ITER15 ignites marginally: P_α is within
    // 1e-3 of P_loss for a while; the exact criterion holds at the step of the event, which the 'ignition' event message reports)
    expect(first.d.P_alpha).toBeGreaterThanOrEqual((first.d.P_rad + first.d.P_cond) * (1 - 1e-3));
    let tIgn = 0;
    for (let i = 1; i < test.sim.history.length; i++) if (test.sim.history[i].d.ignited > 0) tIgn += test.sim.history[i].t - test.sim.history[i - 1].t;
    expect(test.r.ignitionTime_s).toBeGreaterThan(1);
    expect(rel(test.r.ignitionTime_s, tIgn)).toBeLessThan(1e-12);
  });

  it('without heating.autoOff the heating stays on, and with it on nothing is reported as ignited', () => {
    const { sim, r } = run(cfg(false));
    expect(sim.events.some((e) => e.msg.startsWith('Ignition test'))).toBe(false);
    const P0 = ITER_15D.heating.P_NBI_MW + ITER_15D.heating.P_ICRH_MW + ITER_15D.heating.P_ECRH_MW;
    // H98 = 1.4 runs into the Troyon limit at ~27 s; until then the heating is at full power
    const during = sim.history.filter((h) => h.t > 11 && h.t < r.stableTime_s - 0.5);
    expect(during.length).toBeGreaterThan(20);
    for (const h of during) expect(h.d.P_aux).toBeCloseTo(P0, 6);
    expect(sim.history.every((h) => h.d.ignited === 0)).toBe(true);
    expect(r.ignitionTime_s).toBe(0);
  }, 120000);

  it('the state of the test and of the ignition flag is checkpointed: a replay from before the test reproduces it, from inside the ramp too', () => {
    const tOff = tests[0].t;
    for (const t0 of [tOff - 2, tOff + 4]) {
      const sim = new Simulation(cfg(true));
      sim.runAll();
      const idx = sim.history.reduce((b, h, k) => (h.t <= t0 ? k : b), 0);
      sim.rewindTo(idx);
      sim.advance(40);
      expect(sim.history.length).toBe(test.sim.history.length);
      for (let k = idx + 1; k < sim.history.length; k++) {
        expect(sim.history[k].y).toEqual(test.sim.history[k].y);
        expect(sim.history[k].d.P_aux).toBe(test.sim.history[k].d.P_aux);
        expect(sim.history[k].d.ignited).toBe(test.sim.history[k].d.ignited);
      }
      expect(sim.events.filter((e) => e.kind === 'ignition').map((e) => e.t)).toEqual(test.sim.events.filter((e) => e.kind === 'ignition').map((e) => e.t));
      expect(sim.events.filter((e) => e.msg.startsWith('Ignition test')).map((e) => e.t)).toEqual([tOff]);
    }
  }, 120000);

  it('a shot that ignites on H98 = 1 does not exist here: the plasma cannot hold its heat without the external heating', () => {
    const { sim, r } = run({ ...cfg(true, 1.0), t_end: 60 });
    expect(sim.events.filter((e) => e.msg.startsWith('Ignition test'))).toHaveLength(1);
    expect(r.ignitionTime_s).toBe(0);
    expect(r.termination.natural).toBe(false);
  });
});
