/**
 * Regression tests (lane ws2b review, finding 3): why the ITER-pB11 golden case (ITER with p-11B fuel,
 * 100 s, 50 MW of external heating, Z_eff ~ 4.6) ended in a radiative collapse at ~28 s although the
 * v3 baseline (3d04e96) ran to the scheduled end. Since v4.0 (ws2c) the ITER preset's density target is re-based
 * to the design n̄/n_G = 0.85 (0.914e20 m^-3 volume average instead of 1.0e20), which is on the surviving side of
 * this marginal balance: the preset's own p-11B shot now runs to the scheduled end. The golden case ITER-pB11
 * keeps the former target (1.0e20, an override of the case) so that the suite still has a disrupting shot, and the
 * tests below pin both sides.
 *
 * The baseline survived because of an ELM artefact, not because of physics. At 60 s it took off
 *   - an ELM-averaged power of 0.3 P_heat = 23.3 MW, 5.5 times the whole transport loss W/tau_E = 4.2 MW
 *     that the tau_E scaling allows (the continuous conduction was clipped to zero), and
 *   - a nominal ELM particle exhaust of 0.132 1/s (the rate the model took off the continuous loss), 4.9
 *     times the total particle loss 1/tau_p = 0.027 1/s,
 * which held the density at n/n_G = 0.72 instead of the 0.84 of the target. With the ELM losses a fraction
 * of W/tau_E (0.3, Loarte et al. 2003) and of 1/tau_p the density follows its target, the bremsstrahlung
 * (Z_eff = 4.6, ~n^2) and the Be/Ar line radiation rise until P_rad > P_heat at T_e < 2 keV. The outcome is set
 * by the density ramp, not by the ELM model: without ELMs the same run collapses too, a target of 0.85e20 m^-3
 * (n/n_G ~ 0.85) survives, and H98 +-10 % does not change the outcome.
 */
import { describe, expect, it } from 'vitest';
import { ITER } from '../presets';
import { Simulation } from '../simulation';

/** the ITER preset's target before the v4.0 re-base (0.914e20 now), with which the collapse was found and pinned */
const N_OLD = 1.0e20;
const PB11 = { ...ITER, fuel: 'pB11' as const, t_end: 100, n_target: N_OLD };
const run = (over: object = {}) => { const sim = new Simulation({ ...PB11, ...over }); sim.runAll(); return sim; };

describe('ITER-pB11: the radiative collapse follows from the density ramp, not from the ELM model', { timeout: 120_000 }, () => {
  it('a target of 1.0e20 m^-3 (the former golden case) collapses at ~28 s, with ELMs on or off', () => {
    for (const events of [ITER.events, { ...ITER.events, elms: false }]) {
      const sim = run({ events });
      const disr = sim.events.find((e) => e.kind === 'disruption');
      expect(disr, `elms = ${events.elms}`).toBeDefined();
      expect(disr!.t).toBeGreaterThan(25);
      expect(disr!.t).toBeLessThan(32);
      expect(sim.model.terminated?.natural).toBe(false);
    }
  });

  it('the collapse is a marginal power balance: the H98 = 0.9 and 1.1 runs collapse at the same time', () => {
    const t0 = run().events.find((e) => e.kind === 'disruption')!.t;
    for (const H98 of [0.9, 1.1]) {
      const d = run({ H98 }).events.find((e) => e.kind === 'disruption');
      expect(d, `H98 = ${H98}`).toBeDefined();
      expect(Math.abs(d!.t - t0)).toBeLessThan(5);
    }
  });

  it('ITER with p-11B at the preset density (0.914e20 m^-3 since v4.0: n̄/n_G = 0.85 of the design point) survives to the scheduled end, radiating < P_heat', () => {
    const sim = run({ n_target: ITER.n_target });
    expect(ITER.n_target).toBe(0.914e20);
    expect(sim.model.terminated?.natural).toBe(true);
    const tail = sim.history.filter((f) => f.t > 60);
    expect(Math.max(...tail.map((f) => f.d.P_rad / f.d.P_heat))).toBeLessThan(1); // marginal: 0.93 of P_heat at 100 s
  });

  it('a target of 0.85e20 m^-3 (n/n_G ~ 0.85) survives to the scheduled end, radiating < P_heat', () => {
    const sim = run({ n_target: 0.85e20 });
    expect(sim.model.terminated?.natural).toBe(true);
    const tail = sim.history.filter((f) => f.t > 60);
    expect(tail.length).toBeGreaterThan(100);
    const mean = (k: string) => tail.reduce((s, f) => s + f.d[k], 0) / tail.length;
    expect(mean('nG_frac')).toBeGreaterThan(0.75);
    expect(mean('nG_frac')).toBeLessThan(0.95);
    expect(mean('P_rad')).toBeLessThan(mean('P_heat'));
    expect(mean('P_rad')).toBeGreaterThan(0.7 * mean('P_heat')); // a radiative, marginal state, not a healthy one
  });

  it('the ELM particle exhaust is a part of the tau_p exhaust (the v3 baseline took several times all of it)', () => {
    const sim = run({ n_target: 0.85e20 });
    const t0 = 40, H = sim.history;
    const elms = sim.events.filter((e) => e.kind === 'ELM' && e.t >= t0);
    expect(elms.length).toBeGreaterThan(20);
    // the ELM removes 0.3 of the fraction of W it removes as particles; `value` = ΔW [MJ] of the pre-crash W
    let j = 0, exhaust = 0;
    for (const e of elms) {
      while (j + 1 < H.length && H[j + 1].t <= e.t) j++;
      exhaust += (0.3 * e.value!) / H[j].d.W;
    }
    exhaust /= H[H.length - 1].t - t0;
    const win = H.filter((f) => f.t >= t0);
    const invTauP = win.reduce((s, f) => s + 1 / (ITER.transport.tau_p_over_tau_E * f.d.tauE), 0) / win.length;
    expect(exhaust / invTauP).toBeGreaterThan(0.15);
    expect(exhaust / invTauP).toBeLessThan(0.45);
    // and the ELM-averaged power is 0.3 of the transport loss, not a multiple of it
    const ratio = win.reduce((s, f) => s + f.d.P_ELM, 0) / win.reduce((s, f) => s + f.d.P_transport, 0);
    expect(ratio).toBeCloseTo(0.3, 6);
  });
});
