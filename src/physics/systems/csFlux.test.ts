/**
 * Central solenoid flux budget (lane ws7b): the closed-form swing against a numerical flux integral and against the ITER CS, the
 * plasma inductance, the flux requirement and the hook for a current/flux model.
 */
import { describe, expect, it } from 'vitest';
import { C } from '../constants';
import type { HistoryFrame } from '../types';
import {
  CS_CURRENT_DENSITY, EJIMA_COEFFICIENT, FLUX_HISTORY_KEYS, csFluxSwing, fluxBudget, fluxFromHistory, plasmaInductance,
} from './csFlux';

const MU0 = C.mu0;

function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

const ITER_IN = { R: 6.2, a: 2.0, kappa: 1.7, Ip_MA: 15, li: 0.85, tech: 'Nb3Sn' as const, r_outer_m: 2.08, height_m: 12.9, B_max_T: 13 };

describe('solenoid flux swing', () => {
  it('equals the numerical flux of the field of a uniform-current solenoid (bore B_i, linear fall in the winding)', () => {
    const ri = 1.3, ro = 2.08, B = 13, d = ro - ri;
    const flux = simpson((r) => (r <= ri ? B : (B * (ro - r)) / d) * 2 * Math.PI * r, 0, ro);
    expect(csFluxSwing(ri, ro, B, 0.5)).toBeCloseTo(flux, 6); // f_swing 0.5 is the half swing 0 -> +B
    expect(csFluxSwing(ri, ro, B)).toBeCloseTo(2 * flux, 6);
  });

  it('is within 15 % of the 266.6 V s quoted for the ITER CS (r_i 1.3 m, r_o 2.08 m, 13 T)', () => {
    const psi = csFluxSwing(1.3, 2.08, 13);
    expect(psi).toBeGreaterThan(0.85 * 266.6);
    expect(psi).toBeLessThan(1.05 * 266.6);
  });

  it('a thin shell of radius r holds the full 2 pi r^2 B per polarity, and the swing scales with B and the swing fraction', () => {
    expect(csFluxSwing(1, 1, 10, 0.5)).toBeCloseTo(Math.PI * 10, 12);
    expect(csFluxSwing(1, 2, 10) / csFluxSwing(1, 2, 5)).toBeCloseTo(2, 12);
    expect(csFluxSwing(1, 2, 10, 0.5) / csFluxSwing(1, 2, 10)).toBeCloseTo(0.5, 12);
  });
});

describe('flux requirement', () => {
  it('the plasma inductance of ITER is about 11 microhenry and the inductive flux about 165 V s', () => {
    const L = plasmaInductance(6.2, 2.0, 1.7, 0.85);
    expect(L).toBeGreaterThan(9e-6);
    expect(L).toBeLessThan(13e-6);
    expect(L * 15e6).toBeGreaterThan(140);
    expect(L * 15e6).toBeLessThan(190);
    // formula: mu0 R (ln(8R/(a sqrt(kappa))) - 2 + li/2)
    expect(L).toBeCloseTo(MU0 * 6.2 * (Math.log((8 * 6.2) / (2 * Math.sqrt(1.7))) - 2 + 0.425), 15);
    // larger internal inductance, larger inductance
    expect(plasmaInductance(6.2, 2.0, 1.7, 1.1)).toBeGreaterThan(L);
  });

  it('the resistive start-up flux is the Ejima term and the required flux is the sum of the parts', () => {
    const b = fluxBudget({ ...ITER_IN, burn: { Vloop_V: 0.075, duration_s: 400 } });
    expect(b.psiResistive_Vs).toBeCloseTo(EJIMA_COEFFICIENT * MU0 * 6.2 * 15e6, 9);
    expect(b.psiInductive_Vs).toBeCloseTo(b.L_p_H * 15e6, 9);
    expect(b.psiBurn_Vs).toBeCloseTo(30, 12);
    expect(b.psiRequired_Vs).toBeCloseTo(b.psiInductive_Vs + b.psiResistive_Vs + b.psiBurn_Vs, 9);
    // the ITER requirement is 277 V s with margin: the estimate is of that order
    expect(b.psiRequired_Vs).toBeGreaterThan(200);
    expect(b.psiRequired_Vs).toBeLessThan(300);
  });

  it('the margin is (available - required) / required and PF flux adds to the capability', () => {
    const b0 = fluxBudget(ITER_IN);
    const b1 = fluxBudget({ ...ITER_IN, pfFlux_Vs: 40 });
    expect(b1.psiAvailable_Vs - b0.psiAvailable_Vs).toBeCloseTo(40, 9);
    expect(b0.margin).toBeCloseTo((b0.psiAvailable_Vs - b0.psiRequired_Vs) / b0.psiRequired_Vs, 12);
    expect(b1.margin).toBeGreaterThan(b0.margin);
  });

  it('the burn duration the leftover flux supports is the flux over the loop voltage', () => {
    const b = fluxBudget({ ...ITER_IN, pfFlux_Vs: 100, burn: { Vloop_V: 0.05, duration_s: 400 } });
    const left = b.psiAvailable_Vs - b.psiInductive_Vs - b.psiResistive_Vs;
    expect(b.burnSupported_s).toBeCloseTo(Math.max(left, 0) / 0.05, 9);
    expect(fluxBudget(ITER_IN).burnSupported_s).toBe(Infinity);
  });
});

describe('solenoid geometry from the current density', () => {
  it('the radial thickness is B / (mu0 J): ITER at 13 T and 13.6 MA/m^2 needs 0.76 m', () => {
    const b = fluxBudget(ITER_IN);
    expect(b.r_o - b.r_i).toBeCloseTo(13 / (MU0 * CS_CURRENT_DENSITY.Nb3Sn), 9);
    expect(b.J_cs_Am2).toBeCloseTo(CS_CURRENT_DENSITY.Nb3Sn, 3);
    // a higher current density gives a thinner solenoid with a bigger bore and more flux
    const hi = fluxBudget({ ...ITER_IN, currentDensity_Am2: 2e7 });
    expect(hi.r_i).toBeGreaterThan(b.r_i);
    expect(hi.psiCS_Vs).toBeGreaterThan(b.psiCS_Vs);
  });

  it('a solenoid that does not fit keeps a small bore and says so', () => {
    const b = fluxBudget({ ...ITER_IN, r_outer_m: 0.5 });
    expect(b.r_i).toBeCloseTo(0.025, 12);
    expect(b.notes.join(' ')).toContain('does not fit');
  });

  it('the stored energy of the CS (ITER: several GJ) equals the field integral', () => {
    const b = fluxBudget(ITER_IN);
    const ri = b.r_i, ro = b.r_o, B = 13, d = ro - ri, h = ITER_IN.height_m;
    const bore = ((B * B) / (2 * MU0)) * Math.PI * ri * ri * h;
    const wind = simpson((r) => (((B * (ro - r)) / d) ** 2 / (2 * MU0)) * 2 * Math.PI * r * h, ri, ro);
    expect(b.W_cs_J).toBeCloseTo(bore + wind, -3);
    expect(b.W_cs_J / 1e9).toBeGreaterThan(3);
    expect(b.W_cs_J / 1e9).toBeLessThan(12);
    expect(b.mass_kg / 1e3).toBeGreaterThan(300); // ITER CS 954 t
    expect(b.mass_kg / 1e3).toBeLessThan(1500);
  });
});

describe('hook for a current/flux model (WS6c)', () => {
  it('measured quantities override the estimates and are flagged', () => {
    const est = fluxBudget(ITER_IN);
    expect(est.source).toBe('estimate');
    const m = fluxBudget(ITER_IN, { psiInductive_Vs: 120, psiResistive_Vs: 30, psiBurn_Vs: 20 });
    expect(m.psiRequired_Vs).toBeCloseTo(170, 12);
    expect(m.source).toBe('measured');
    expect(m.notes.join(' ')).toContain('WS6c');
    // a measured total replaces the parts, a measured PF flux replaces the configured one
    const t = fluxBudget({ ...ITER_IN, pfFlux_Vs: 40 }, { psiTotal_Vs: 210, psiPF_Vs: 25 });
    expect(t.psiRequired_Vs).toBe(210);
    expect(t.psiPF_Vs).toBe(25);
  });

  const frame = (t: number, d: Record<string, number>): HistoryFrame => ({ t, y: [], d, internal: {} });

  it('reads the burn flux from the V_loop history key, else from P_ohmic / I_p, after the start-up', () => {
    const withLoop = [0, 1, 2, 3, 4].map((t) => frame(t, { V_loop: 0.1 * (t > 0 ? 1 : 0), Ip: 15, P_oh: 5 }));
    const a = fluxFromHistory(withLoop, 2)!;
    expect(a.measurement.psiBurn_Vs).toBeCloseTo(0.1 * 2, 12); // frames at t = 3 and 4, dt 1
    expect(a.Vloop_V).toBeCloseTo(0.1, 12);
    const ohm = [0, 1, 2, 3, 4].map((t) => frame(t, { Ip: 10, P_oh: 0.5 }));
    const b = fluxFromHistory(ohm, 0)!;
    expect(b.measurement.psiBurn_Vs).toBeUndefined(); // no hook key: only the mean loop voltage is taken from the ohmic power
    expect(b.Vloop_V).toBeCloseTo(0.05, 12);
    expect(b.duration_s).toBeCloseTo(4, 12);
  });

  it('a published psi_used total becomes the requirement; a history with fewer than two frames gives nothing', () => {
    const h = [0, 1, 2].map((t) => frame(t, { Ip: 10, P_oh: 0.5, [FLUX_HISTORY_KEYS.psiUsed]: 100 * t }));
    expect(fluxFromHistory(h)!.measurement.psiTotal_Vs).toBe(200);
    expect(fluxFromHistory([h[0]])).toBeUndefined();
    // frames without a plasma current contribute no loop voltage
    const cold = [0, 1, 2].map((t) => frame(t, { Ip: 0, P_oh: 0 }));
    expect(fluxFromHistory(cold)!.Vloop_V).toBe(0);
  });
});
