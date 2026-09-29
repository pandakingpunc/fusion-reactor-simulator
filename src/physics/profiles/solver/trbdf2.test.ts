/**
 * TR-BDF2 (solver/trbdf2.ts) on scalar test problems with exact stage solves: the constants, the second order, the L-stability,
 * the embedded error estimate against the true local error, and the step-size controller.
 */
import { describe, expect, it } from 'vitest';
import { TRBDF2_A, TRBDF2_B, TRBDF2_C, TRBDF2_D, TRBDF2_EST, TRBDF2_GAMMA, STEP_CONTROL, acceptedFactor, errorExponent, rejectedFactor, trbdf2Estimate } from './trbdf2';

const g = TRBDF2_GAMMA, d = TRBDF2_D;

/**
 * One TR-BDF2 step of U' = −λU + f(t) from (t, U) over h, the stages solved exactly (the problem is linear). Returns the three states and
 * the rate of the old state, as the stepper has them.
 */
function step(lambda: number, f: (t: number) => number, t: number, U: number, h: number) {
  const R = (T: number, u: number) => -lambda * u + f(T);
  const Rn = R(t, U);
  // trapezoidal stage: U_γ − U = d h (R_n + R_γ)
  const Ug = (U + d * h * (Rn + f(t + g * h))) / (1 + d * h * lambda);
  // BDF2 stage: U_1 = a U_γ + b U + d h R(U_1)
  const U1 = (TRBDF2_A * Ug + TRBDF2_B * U + d * h * f(t + h)) / (1 + d * h * lambda);
  return { Ug, U1, Rn };
}

describe('TR-BDF2 constants', () => {
  it('γ = 2 − √2, both stages have the interval d h with d = γ/2, the BDF2 weights sum to one, w = a d = √2/4', () => {
    expect(g).toBeCloseTo(2 - Math.SQRT2, 15);
    expect(d).toBeCloseTo(1 - Math.SQRT2 / 2, 15);
    expect(TRBDF2_A + TRBDF2_B).toBeCloseTo(1, 14);
    // the BDF2 stage's implicit interval (1 − γ)/(2 − γ) equals the trapezoidal stage's γ/2
    expect((1 - g) / (2 - g)).toBeCloseTo(d, 14);
    expect(TRBDF2_A * d).toBeCloseTo(Math.SQRT2 / 4, 14);
    // Hosea and Shampine's error constant
    expect(TRBDF2_C).toBeCloseTo(-0.0404401145, 9);
  });

  it('the estimate coefficients: no error for a constant state or a state linear in time', () => {
    const c = TRBDF2_EST;
    expect(c.cN + c.cG + c.cE).toBeCloseTo(0, 13);
    // U = t, R = 1 over h = 1: U_n = 0, U_γ = γ, U_1 = 1
    expect(c.cR + c.cG * g + c.cE).toBeCloseTo(0, 13);
    expect(trbdf2Estimate(0.1, 0, 5, 5, 5)).toBeCloseTo(0, 12);
  });
});

describe('TR-BDF2 as a method', () => {
  it('is second order: halving h divides the global error of U′ = −U + sin t by four', () => {
    const exact = (t: number) => (Math.sin(t) - Math.cos(t) + Math.exp(-t)) / 2; // U(0) = 0
    const run = (n: number) => {
      const h = 2 / n;
      let U = 0;
      for (let k = 0; k < n; k++) U = step(1, Math.sin, k * h, U, h).U1;
      return Math.abs(U - exact(2));
    };
    const e1 = run(20), e2 = run(40), e3 = run(80);
    expect(e1 / e2).toBeGreaterThan(3.7);
    expect(e1 / e2).toBeLessThan(4.3);
    expect(e2 / e3).toBeGreaterThan(3.8);
    expect(e2 / e3).toBeLessThan(4.2);
  });

  it('is L-stable: a stiff mode is damped in one step (λh = 10⁶), where the trapezoidal stage alone rings with amplitude ~1', () => {
    const { Ug, U1 } = step(1e6, () => 0, 0, 1, 1);
    expect(Math.abs(U1)).toBeLessThan(1e-5);
    // the trapezoidal stage: U_γ = (1 − dhλ)/(1 + dhλ) U ≈ −1
    expect(Ug).toBeLessThan(-0.99);
  });

  it('the embedded estimate equals the local truncation error of a cubic (U‴ = const) and converges to it as h → 0', () => {
    // U' = f(t) = t²/2 (λ = 0), U = t³/6: U‴ = 1, local error −C h³ … the estimate is exact
    const f = (t: number) => (t * t) / 2;
    const h = 0.7, t = 0.3;
    const U = (t * t * t) / 6;
    const { Ug, U1, Rn } = step(0, f, t, U, h);
    const trueErr = ((t + h) ** 3) / 6 - U1;
    expect(trbdf2Estimate(h, Rn, U, Ug, U1)).toBeCloseTo(trueErr, 12);
    // a non-polynomial problem: the ratio estimate/true error tends to 1
    const ratios = [0.4, 0.2, 0.1].map((hh) => {
      const s = step(1, Math.sin, 0.5, 0.3, hh);
      // the exact solution of U′ = −U + sin t from (0.5, 0.3)
      const ex = (tt: number) => (Math.sin(tt) - Math.cos(tt)) / 2 + (0.3 - (Math.sin(0.5) - Math.cos(0.5)) / 2) * Math.exp(-(tt - 0.5));
      return trbdf2Estimate(hh, s.Rn, 0.3, s.Ug, s.U1) / (ex(0.5 + hh) - s.U1);
    });
    expect(Math.abs(ratios[2] - 1)).toBeLessThan(0.05);
    expect(Math.abs(ratios[2] - 1)).toBeLessThan(Math.abs(ratios[0] - 1));
  });
});

describe('step-size controller', () => {
  it('grows a step after a small error and shrinks it after an error near the tolerance, within [facMin, facMax]', () => {
    const c = STEP_CONTROL;
    expect(acceptedFactor(1e-12, false)).toBe(c.facMax);
    expect(acceptedFactor(0, false)).toBe(c.facMax);
    expect(acceptedFactor(0.81, false)).toBeCloseTo(1, 12);
    expect(acceptedFactor(1, false)).toBeLessThan(1);
    expect(acceptedFactor(0.3, false)).toBeGreaterThan(acceptedFactor(0.6, false));
    // a repeated step does not grow
    expect(acceptedFactor(1e-6, true)).toBe(1);
    expect(acceptedFactor(0.9, true)).toBeLessThanOrEqual(1);
    for (const e of [1e-9, 0.01, 0.5, 0.99, 1]) {
      const f = acceptedFactor(e, false);
      expect(f).toBeGreaterThanOrEqual(c.facMin);
      expect(f).toBeLessThanOrEqual(c.facMax);
    }
  });

  it('a rejected step is repeated with the step at which the error would be the safety factor; the exponent is measured from two attempts', () => {
    // first retry: order 1
    expect(rejectedFactor(1.8)).toBeCloseTo(0.9 / 1.8, 12);
    // an error that follows h²: the step that gives 0.9 from 4 is sqrt(0.9/4)
    expect(rejectedFactor(4, 2)).toBeCloseTo(Math.sqrt(0.9 / 4), 12);
    // never a factor above 0.9, never below facMin; not finite: facMin
    expect(rejectedFactor(1.0001)).toBeLessThanOrEqual(0.9);
    expect(rejectedFactor(1e9)).toBe(STEP_CONTROL.facMin);
    expect(rejectedFactor(Infinity)).toBe(STEP_CONTROL.facMin);
    expect(rejectedFactor(NaN)).toBe(STEP_CONTROL.facMin);
    // the measured exponent: err = 0.55 h^0.5, rejected at h = 8 (1.56) and again at h = 4 (1.10): exponent 0.5
    const e = (h: number) => 0.55 * Math.sqrt(h);
    expect(errorExponent(8, e(8), 4, e(4))).toBeCloseTo(0.5, 12);
    // and it reaches the target in one more repetition
    const p = errorExponent(8, e(8), 4, e(4));
    const h3 = 4 * rejectedFactor(e(4), p);
    expect(e(h3)).toBeCloseTo(0.9, 10);
    // no decrease, or an exponent out of range: limited or 1
    expect(errorExponent(2, 1, 1, 1.5)).toBe(1);
    expect(errorExponent(2, 8, 1, 1)).toBe(3);
    expect(errorExponent(2, 1.001, 1, 1)).toBe(0.3);
  });

  it('holds a step size near the tolerance on a problem whose error follows h^p: converges to err = safety² for the exponent 1/2 and does not oscillate', () => {
    for (const p of [0.5, 1, 2, 3]) {
      let h = 1e-6;
      const errAt = (hh: number) => 2 * Math.pow(hh, p);
      let rejects = 0, prevH = h, growthAfterSettle = 0;
      for (let k = 0; k < 400; k++) {
        let e = errAt(h);
        let order = 1, last: { h: number; e: number } | null = null;
        while (e > 1) {
          rejects++;
          if (last) order = errorExponent(last.h, last.e, h, e);
          last = { h, e };
          h *= rejectedFactor(e, order);
          e = errAt(h);
        }
        prevH = h;
        h *= acceptedFactor(e, false);
        if (k > 300) growthAfterSettle = Math.max(growthAfterSettle, Math.abs(h / prevH - 1));
      }
      // settled: the step no longer changes by more than a few per cent, and few repetitions were needed
      expect(growthAfterSettle).toBeLessThan(0.25);
      expect(rejects).toBeLessThan(80);
    }
  });
});
