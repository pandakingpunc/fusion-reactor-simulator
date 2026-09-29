/**
 * Code-verification data behind Fig. 7 (computeVerification): the observed orders of convergence are
 * those of the schemes (Grad-Shafranov five-point solver with Shortley-Weller boundary: 2, finite-volume
 * heat solver: 2, backward Euler: 1) and the adaptive Dormand-Prince integrator needs the fewest
 * right-hand-side evaluations for a given accuracy; plus the log-log slope and the burn-dynamics test problem.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeFontSet } from '../fontsNode';
import { VerificationData, burnRhs, computeVerification, figVerification, slope } from './verification';

describe('slope', () => {
  it('is the least-squares exponent of a power law, and of noisy data close to it', () => {
    expect(slope([1, 2, 4, 8, 16], [3, 12, 48, 192, 768])).toBeCloseTo(2, 12);
    expect(slope([1, 10, 100], [5, 0.5, 0.05])).toBeCloseTo(-1, 12);
    const x = [1, 2, 4, 8, 16, 32], y = x.map((v, i) => 0.7 * v ** 1.5 * (1 + 0.02 * (i % 2 ? 1 : -1)));
    expect(slope(x, y)).toBeCloseTo(1.5, 1);
  });
});

describe('burn-dynamics test problem', () => {
  it('right-hand side at t = 0: density relaxes towards the source (analytic), the temperature derivative is finite', () => {
    const d = new Float64Array(2);
    burnRhs(0, Float64Array.from([0.5, 1.0]), d);
    // S = 2e19 m^-3/s at t = 0, n = 0.5e20, tau_p = 5 s: dn/dt = 2e19 - 1e19 = 1e19, in units of 1e20: 0.1
    expect(d[0]).toBeCloseTo(0.1, 12);
    expect(Number.isFinite(d[1])).toBe(true);
    burnRhs(5, Float64Array.from([0.5, 0.0]), d); // T is floored at 0.05 keV inside the right-hand side
    expect(Number.isFinite(d[1])).toBe(true);
  });
});

describe('computeVerification', () => {
  let v: VerificationData;
  beforeAll(() => { v = computeVerification(); }, 120_000);

  it('observed orders of convergence: 2 (Grad-Shafranov), 2 (heat solver), 1 (backward Euler)', () => {
    expect(v.gs.h.length).toBe(7);
    expect(v.space.dr.length).toBe(6);
    expect(v.time.dt.length).toBe(8);
    expect(slope(v.gs.h, v.gs.err)).toBeGreaterThan(1.8);
    expect(slope(v.gs.h, v.gs.err)).toBeLessThan(2.3);
    expect(slope(v.space.dr, v.space.err)).toBeGreaterThan(1.8);
    expect(slope(v.space.dr, v.space.err)).toBeLessThan(2.2);
    expect(slope(v.time.dt, v.time.err)).toBeGreaterThan(0.85);
    expect(slope(v.time.dt, v.time.err)).toBeLessThan(1.15);
    expect(v.time.tau).toBeGreaterThan(0);
    // finer resolution, smaller error
    for (const [h, e] of [[v.gs.h, v.gs.err], [v.space.dr, v.space.err], [v.time.dt, v.time.err]]) {
      for (let k = 1; k < h.length; k++) { expect(h[k]).toBeLessThan(h[k - 1]); expect(e[k]).toBeLessThan(e[k - 1]); }
    }
  }, 60_000);

  it('work-precision: adaptive Dormand-Prince needs fewer evaluations than RK4, RK4 fewer than Euler, for an error of 1e-6', () => {
    const first = (w: { nfev: number[]; err: number[] }, tol: number) => { const k = w.err.findIndex((e) => e <= tol); return k < 0 ? Infinity : w.nfev[k]; };
    const dp5 = first(v.wp.dp5, 1e-6), rk4 = first(v.wp.rk4, 1e-6), euler = first(v.wp.euler, 1e-6);
    expect(dp5).toBeLessThan(rk4);
    expect(rk4).toBeLessThan(euler);
    expect(v.wp.dp5.nfev.length).toBe(9);
    for (const w of [v.wp.dp5, v.wp.rk4, v.wp.euler]) expect(w.err.every((e) => Number.isFinite(e) && e > 0 && e < 1)).toBe(true);
  }, 60_000);

  it('renders as Figure 7 with the fitted slopes in the legend', () => {
    const svg = figVerification(v).toSVG({ fonts: nodeFontSet() });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain(`fit slope ${slope(v.gs.h, v.gs.err).toFixed(2)}`);
  }, 60_000);
});
