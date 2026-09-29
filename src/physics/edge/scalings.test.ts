/**
 * Heat-flux width scalings (edge/scalings.ts) and the loss factors of the divertor leg (edge/losses.ts).
 *  [E13]  T. Eich et al., Nucl. Fusion 53 (2013) 093031, regression #14: λ_q [mm] = 0.63 B_pol^-1.19.
 *  [M12]  M. A. Makowski et al., Phys. Plasmas 19 (2012) 056122: λ_int = λ_q + 1.64 S.
 *  [Z22]  B. Zhu et al., arXiv:2206.09964, eqs. 6.1–6.4 (the fit sets of Stangeby, PPCF 60 (2018) 044022).
 */
import { describe, expect, it } from 'vitest';
import { forAll, gen } from '../../testing/prop';
import { poloidalField } from '../geometry';
import {
  B_POL_FLOOR, EICH14_COEFFICIENT_MM, EICH14_EXPONENT, INTEGRAL_WIDTH_FACTOR, broadeningFactor, eichLambdaQ_mm, integralWidth_mm,
} from './scalings';
import {
  BODY_2025_FIT, STANGEBY_FIT_1, STANGEBY_FIT_2, coolingLoss, lossFit, momentumLoss, powerLoss, transmission,
} from './losses';

describe('Eich regression #14 and the integral width', () => {
  it('is 0.63 B_pol^-1.19 mm, exactly', () => {
    expect(EICH14_COEFFICIENT_MM).toBe(0.63);
    expect(EICH14_EXPONENT).toBe(-1.19);
    for (const B of [0.3, 0.5, 1, 1.2, 2, 2.5]) expect(eichLambdaQ_mm(B)).toBeCloseTo(0.63 * Math.pow(B, -1.19), 12);
    expect(eichLambdaQ_mm(1)).toBeCloseTo(0.63, 12);
  });

  it('gives sub-millimetre widths for the ITER poloidal field (about 1.1 T) and about a millimetre for JET', () => {
    const Bp = poloidalField({ R: 6.2, a: 2, kappa: 1.7, delta: 0.33 }, 15e6);
    expect(Bp).toBeGreaterThan(1.0);
    expect(Bp).toBeLessThan(1.2);
    const lq = eichLambdaQ_mm(Bp);
    expect(lq).toBeGreaterThan(0.5);
    expect(lq).toBeLessThan(0.62);
    // JET 3.5 MA: B_pol about 0.6 T, λ_q about 1.2 mm
    const lqJET = eichLambdaQ_mm(poloidalField({ R: 2.96, a: 0.93, kappa: 1.68, delta: 0.3 }, 3.5e6));
    expect(lqJET).toBeGreaterThan(1);
    expect(lqJET).toBeLessThan(1.5);
  });

  it('decreases with the poloidal field and is floored below B_pol = 0.05 T (start-up)', () => {
    forAll(gen.record({ a: gen.logFloat(0.06, 5), b: gen.logFloat(0.06, 5) }), ({ a, b }) => {
      expect(a < b ? eichLambdaQ_mm(a) > eichLambdaQ_mm(b) : eichLambdaQ_mm(a) <= eichLambdaQ_mm(b)).toBe(true);
    });
    expect(eichLambdaQ_mm(0)).toBe(eichLambdaQ_mm(B_POL_FLOOR));
    expect(eichLambdaQ_mm(-1)).toBe(eichLambdaQ_mm(B_POL_FLOOR));
    expect(Number.isFinite(eichLambdaQ_mm(0))).toBe(true);
  });

  it('λ_int = λ_q + 1.64 S; b = 3 for S = 1.22 λ_q (Kallenbach et al. 2016); S < 0 counts as 0', () => {
    expect(INTEGRAL_WIDTH_FACTOR).toBe(1.64);
    expect(integralWidth_mm(1, 1)).toBeCloseTo(2.64, 12);
    expect(integralWidth_mm(2, 0)).toBe(2);
    expect(integralWidth_mm(2, -3)).toBe(2);
    expect(broadeningFactor(0.6, 1.22 * 0.6)).toBeCloseTo(1 + 1.64 * 1.22, 12);
    expect(broadeningFactor(0.6, 1.22 * 0.6)).toBeCloseTo(3, 2);
  });
});

describe('momentum and power loss factors (Stangeby 2018 fits)', () => {
  it('fit 1 is 1 − f_mom = (1 − e^{−T/0.8})^2.1 and 1 − f_cool = (1 − e^{−T/2.4})^1.9 [Z22 6.1, 6.2]', () => {
    for (const T of [0.5, 1, 2, 5, 10, 30]) {
      expect(momentumLoss(T)).toBeCloseTo(1 - Math.pow(1 - Math.exp(-T / 0.8), 2.1), 12);
      expect(coolingLoss(T)).toBeCloseTo(1 - Math.pow(1 - Math.exp(-T / 2.4), 1.9), 12);
    }
    expect(STANGEBY_FIT_1.mom).toEqual({ A: 1, w: 0.8, s: 2.1 });
    expect(STANGEBY_FIT_1.cool).toEqual({ A: 1, w: 2.4, s: 1.9 });
  });

  it('fit 2 carries the prefactors 1.3 and 0.9 [Z22 6.3, 6.4]; the pressure gain of 1.3 is clipped to no loss', () => {
    expect(STANGEBY_FIT_2.mom).toEqual({ A: 1.3, w: 1.8, s: 1.6 });
    expect(STANGEBY_FIT_2.cool).toEqual({ A: 0.9, w: 6, s: 1.7 });
    expect(momentumLoss(50, STANGEBY_FIT_2)).toBe(0);
    expect(transmission(STANGEBY_FIT_2.mom, 50)).toBeGreaterThan(1);
    // the cooling fit never reaches 1: 10 % of the power is lost at any T_t
    expect(coolingLoss(500, STANGEBY_FIT_2)).toBeCloseTo(0.1, 6);
    expect(coolingLoss(5, STANGEBY_FIT_2)).toBeCloseTo(1 - 0.9 * Math.pow(1 - Math.exp(-5 / 6), 1.7), 12);
  });

  it('the fit of Body et al. 2025 (Table 1) is available; the default set is Stangeby fit 1', () => {
    expect(BODY_2025_FIT.mom).toEqual({ A: 0.886, w: 3.83, s: 0.828 });
    expect(BODY_2025_FIT.cool).toEqual({ A: 0.853, w: 5.2, s: 0.964 });
    expect(lossFit(undefined)).toBe(STANGEBY_FIT_1);
    expect(lossFit('stangeby1')).toBe(STANGEBY_FIT_1);
    expect(lossFit('stangeby2')).toBe(STANGEBY_FIT_2);
    expect(lossFit('body2025')).toBe(BODY_2025_FIT);
    expect(lossFit('nonsense' as never)).toBe(STANGEBY_FIT_1);
  });

  it('both losses vanish above 10 eV, rise as T_t falls, and are total at T_t → 0', () => {
    for (const fit of [STANGEBY_FIT_1, STANGEBY_FIT_2, BODY_2025_FIT]) {
      forAll(gen.record({ a: gen.logFloat(0.05, 200), b: gen.logFloat(0.05, 200) }), ({ a, b }) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(momentumLoss(lo, fit)).toBeGreaterThanOrEqual(momentumLoss(hi, fit) - 1e-15);
        expect(coolingLoss(lo, fit)).toBeGreaterThanOrEqual(coolingLoss(hi, fit) - 1e-15);
        for (const T of [lo, hi]) {
          expect(momentumLoss(T, fit)).toBeGreaterThanOrEqual(0);
          expect(momentumLoss(T, fit)).toBeLessThanOrEqual(1);
          expect(coolingLoss(T, fit)).toBeLessThanOrEqual(1);
        }
      });
      expect(momentumLoss(0, fit)).toBe(1);
      expect(coolingLoss(-3, fit)).toBe(1);
    }
    // Stangeby fit 1: momentum loss 0.5 near 1 eV and 0.9 near 0.4 eV ("very strong by 1 eV"); negligible above 10 eV
    expect(momentumLoss(10)).toBeLessThan(1e-4);
    expect(momentumLoss(1)).toBeGreaterThan(0.4);
    expect(momentumLoss(1)).toBeLessThan(0.6);
    expect(momentumLoss(0.4)).toBeGreaterThan(0.85);
    expect(coolingLoss(10)).toBeLessThan(0.05);
  });

  it('total power loss of the chain: 1 − (1 − f_rad)(1 − f_cool)', () => {
    expect(powerLoss(0, 0)).toBe(0);
    expect(powerLoss(1, 0.3)).toBe(1);
    expect(powerLoss(0.7, 0.5)).toBeCloseTo(0.85, 14);
    forAll(gen.record({ r: gen.float(0, 1), c: gen.float(0, 1) }), ({ r, c }) => {
      expect(powerLoss(r, c)).toBeGreaterThanOrEqual(Math.max(r, c) - 1e-15);
      expect(powerLoss(r, c)).toBeLessThanOrEqual(1);
    });
  });
});
