/**
 * The plasma circuit (confinement/circuit.ts): inductances, the Ejima ramp-up flux, the Wilson bootstrap fraction, the flux accounting
 * of the 0D model and its checkpoint record.
 */
import { describe, expect, it } from 'vitest';
import { C } from '../constants';
import {
  bootstrapFractionWilson, circuitFlux, EJIMA_COEFFICIENT, ejimaFlux, externalInductance, internalInductance, LI_DEFAULT, PlasmaCircuit, plasmaInductance,
} from './circuit';

const MU0 = C.mu0;

describe('inductances', () => {
  it('the external inductance is mu0 R (ln(8R/(a sqrt(kappa))) - 2) and the internal one mu0 R l_i / 2', () => {
    expect(externalInductance(6.2, 2, 1.7)).toBeCloseTo(MU0 * 6.2 * (Math.log((8 * 6.2) / (2 * Math.sqrt(1.7))) - 2), 15);
    expect(internalInductance(6.2, 0.85)).toBeCloseTo(0.5 * MU0 * 6.2 * 0.85, 15);
    expect(plasmaInductance(6.2, 2, 1.7, 0.85)).toBeCloseTo(externalInductance(6.2, 2, 1.7) + internalInductance(6.2, 0.85), 15);
  });

  it('ITER: L_e about 7 microhenry, L_p about 11 microhenry, so the inductive flux of 15 MA is about 165 V s', () => {
    expect(externalInductance(6.2, 2, 1.7) * 1e6).toBeGreaterThan(6.5);
    expect(externalInductance(6.2, 2, 1.7) * 1e6).toBeLessThan(8);
    const Lp = plasmaInductance(6.2, 2, 1.7, LI_DEFAULT);
    expect(Lp * 15e6).toBeGreaterThan(140);
    expect(Lp * 15e6).toBeLessThan(190);
  });

  it('a larger l_i or a thinner plasma has more inductance', () => {
    expect(plasmaInductance(6.2, 2, 1.7, 1.1)).toBeGreaterThan(plasmaInductance(6.2, 2, 1.7, 0.8));
    expect(externalInductance(6.2, 1.5, 1.7)).toBeGreaterThan(externalInductance(6.2, 2, 1.7));
  });
});

describe('Ejima ramp-up flux', () => {
  it('is C_E mu0 R I_p, with the default 0.4 (PROCESS; the ITER design value is 0.45, the experiments 0.3-0.4)', () => {
    expect(EJIMA_COEFFICIENT).toBe(0.4);
    expect(ejimaFlux(6.2, 15e6)).toBeCloseTo(0.4 * MU0 * 6.2 * 15e6, 9);
    expect(ejimaFlux(6.2, 15e6, 0.45) / ejimaFlux(6.2, 15e6)).toBeCloseTo(0.45 / 0.4, 12);
    // ITER: 0.4 mu0 R I_p = 47 V s of the 277 V s of the design
    expect(ejimaFlux(6.2, 15e6)).toBeGreaterThan(40);
    expect(ejimaFlux(6.2, 15e6)).toBeLessThan(55);
  });
});

describe('flux of the circuit', () => {
  const geo = { R: 6.2, a: 2, kappa: 1.7, Ip0: 15e6, li0: 0.85, ejima: 0.4 };

  it('a run that has not drawn any flux yet needs the whole ramp-up: (L_e + L_i) I_p + C_E mu0 R I_p, of which C_E mu0 R I_p is resistive', () => {
    const f = circuitFlux({ ...geo, Ip: 15e6, psiB: 0, psiR: 0 });
    expect(f.psiUsed).toBeCloseTo(plasmaInductance(6.2, 2, 1.7, 0.85) * 15e6 + ejimaFlux(6.2, 15e6), 6);
    expect(f.psiRes).toBeCloseTo(ejimaFlux(6.2, 15e6), 9);
    expect(f.psiUsed).toBeCloseTo(f.psiRes + f.psiInd, 9);
    // the ITER design requirement is 277 V s including the burn and margins: the ramp-up alone is about 200
    expect(f.psiUsed).toBeGreaterThan(180);
    expect(f.psiUsed).toBeLessThan(230);
  });

  it('the boundary flux adds one for one, and a change of the current moves only the external inductance flux', () => {
    const f0 = circuitFlux({ ...geo, Ip: 15e6, psiB: 0, psiR: 0 });
    const f1 = circuitFlux({ ...geo, Ip: 15e6, psiB: 12, psiR: 9 });
    expect(f1.psiUsed - f0.psiUsed).toBeCloseTo(12, 9);
    expect(f1.psiRes - f0.psiRes).toBeCloseTo(9, 9);
    expect(f1.psiInd - f0.psiInd).toBeCloseTo(3, 9);
    const f2 = circuitFlux({ ...geo, Ip: 12e6, psiB: 0, psiR: 0 });
    expect(f0.psiUsed - f2.psiUsed).toBeCloseTo(externalInductance(6.2, 2, 1.7) * 3e6, 9);
  });
});

describe('bootstrap fraction of Wilson (1992)', () => {
  // ITER-like: R 6.2, a 2, q95 3.1, q0 1, n ~ (1 - rho^2)^1, T ~ (1 - rho^2)^1.5
  const f = (betaP: number, R = 6.2, a = 2) => bootstrapFractionWilson(2.1, 2.5, 1.5, betaP, 1, 3.1, R, a);

  it('is of the order of a quarter to a half for the poloidal beta of ITER (about 1), and grows with beta_p', () => {
    expect(f(1.0)).toBeGreaterThan(0.2);
    expect(f(1.0)).toBeLessThan(0.55);
    expect(f(1.2)).toBeGreaterThan(f(0.8));
  });

  it('is proportional to beta_p sqrt(eps) for fixed profiles', () => {
    expect(f(1.0) / f(0.5)).toBeCloseTo(2, 12);
    expect(f(0)).toBe(0);
  });

  it('is more at a smaller aspect ratio for the same beta_p', () => {
    expect(f(1, 3, 1.5)).toBeGreaterThan(0);
    expect(bootstrapFractionWilson(2.1, 2.5, 1.5, 1, 1, 3.1, 1.7, 1.2)).toBeGreaterThan(f(1));
  });

  it('is 0 for a profile it is not defined for, never NaN', () => {
    expect(bootstrapFractionWilson(2.1, 2.5, 1.5, 1, 3.5, 3.1, 6.2, 2)).toBe(0); // q0 above q95
    expect(bootstrapFractionWilson(0, 2.5, 1.5, 1, 1, 3.1, 6.2, 2)).toBe(0);
    expect(bootstrapFractionWilson(2.1, 2.5, 1.5, NaN, 1, 3.1, 6.2, 2)).toBe(0);
    expect(bootstrapFractionWilson(2.1, 2.5, 1.5, 1, 1, 3.1, 1.5, 2)).toBe(0); // a > R
  });
});

describe('the 0D circuit', () => {
  const params = { R: 6.2, a: 2, kappa: 1.7, alphaN: 0.5, alphaT: 1 };

  it('the loop voltage of a steady current is (1 - f_NI) P_ohmic / I_p, and 0 without a current', () => {
    const c = new PlasmaCircuit(params);
    expect(c.loopVoltage(1e6, 15e6, 0)).toBeCloseTo(1e6 / 15e6, 12);
    expect(c.loopVoltage(1e6, 15e6, 0.4)).toBeCloseTo(0.6 * 1e6 / 15e6, 12);
    expect(c.loopVoltage(1e6, 15e6, 1.5)).toBe(0); // a fraction above 1 is clamped
    expect(c.loopVoltage(1e6, 0, 0.2)).toBe(0);
  });

  it('the Wilson fraction uses the profile exponents and q95 of the model (q0 = 1)', () => {
    const c = new PlasmaCircuit(params);
    expect(c.fBootstrap(1, 3.1)).toBeCloseTo(bootstrapFractionWilson(2.1, 1.5, 1, 1, 1, 3.1, 6.2, 2), 12);
    expect(c.fBootstrap(1, 3.1)).toBeGreaterThan(0);
    expect(c.fBootstrap(1, 0.9)).toBe(0); // q95 below q0: not a profile the fit is for
  });

  it('publishes f_bs, f_cd = 0, f_NI and V_loop; the loop voltage carries the bootstrap fraction and is 0 outside the normal phase', () => {
    const c = new PlasmaCircuit(params);
    const s = { Ip: 15e6, betaPth: 1, q95: 3.1, P_oh: 1.2e6 };
    const d = c.diagnostics(s);
    expect(Object.keys(d).sort()).toEqual(['V_loop', 'f_NI', 'f_bs', 'f_cd']);
    expect(d.f_cd).toBe(0);
    expect(d.f_NI).toBe(d.f_bs);
    expect(d.V_loop).toBeCloseTo((1 - d.f_bs) * 1.2e6 / 15e6, 12);
    expect(c.diagnostics(s, false).V_loop).toBe(0);
    expect(c.diagnostics(s, false).f_bs).toBe(d.f_bs);
  });
});
