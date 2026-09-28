/**
 * Reference pack: operational-limit definitions (src/physics/limits.ts, q95 in src/physics/geometry.ts).
 *  [G88]  M. Greenwald et al., Nucl. Fusion 28 (1988) 2199: n_G [1e20 m⁻³] = I_p [MA]/(π a²).
 *  [T84]  F. Troyon et al., Plasma Phys. Control. Fusion 26 (1984) 209: β_N = β_T[%] a B_T / I_p[MA],
 *         β_T = 2μ0<p>/B_T².
 *  [W11]  J. Wesson, Tokamaks, 4th ed. (2011) §3.5: β_p = 2μ0<p>/B_p², with the mean poloidal field on the
 *         elliptic-equivalent circumference B_p = μ0 I_p/(2π a √((1+κ²)/2)).
 *  [IPB99] ITER Physics Basis, Nucl. Fusion 39 (1999) 2137: the ITER inductive reference has q95 ≈ 3.
 * Only definitions are asserted here: which density enters the Greenwald fraction (line vs volume
 * average) is being changed by lane ws2b and is deliberately not pinned.
 */
import { describe, expect, it } from 'vitest';
import { betaNormalized, betaPoloidal, betaToroidal, greenwaldDensity } from '../limits';
import { q95 } from '../geometry';
import { forAll, gen } from '../../testing/prop';

const mu0 = 1.25663706212e-6;
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('limit definitions', () => {
  it('[G88] Greenwald density; ITER (15 MA, a = 2 m) has n_G ≈ 1.19e20 m⁻³', () => {
    forAll(gen.record({ I: gen.logFloat(0.05, 30), a: gen.float(0.1, 4) }), ({ I, a }) => {
      expect(rel(greenwaldDensity(I, a), (I / (Math.PI * a * a)) * 1e20)).toBeLessThan(1e-14);
    });
    expect(greenwaldDensity(15, 2.0) / 1e20).toBeCloseTo(15 / (4 * Math.PI), 12);
  });

  it('[T84] toroidal and normalised beta', () => {
    forAll(gen.record({ p: gen.logFloat(1e2, 1e7), B: gen.logFloat(0.2, 20), a: gen.float(0.1, 4), I: gen.logFloat(0.05, 30) }), ({ p, B, a, I }) => {
      const bT = betaToroidal(p, B);
      expect(rel(bT, (2 * mu0 * p) / (B * B))).toBeLessThan(1e-14);
      expect(rel(betaNormalized(bT, a, B, I), (bT * 100 * a * B) / I)).toBeLessThan(1e-14);
    });
    expect(betaNormalized(0.02, 2, 5, 0)).toBe(0); // no current, no Troyon normalisation
  });

  it('[W11] poloidal beta with the elliptic mean poloidal field', () => {
    forAll(gen.record({ p: gen.logFloat(1e2, 1e7), I: gen.logFloat(5e4, 3e7), a: gen.float(0.1, 4), k: gen.float(1, 3) }), ({ p, I, a, k }) => {
      const Bp = (mu0 * I) / (2 * Math.PI * a * Math.sqrt((1 + k * k) / 2));
      expect(rel(betaPoloidal(p, I, a, k), (2 * mu0 * p) / (Bp * Bp))).toBeLessThan(1e-12);
    });
  });

  it('[IPB99] q95 of the ITER reference (R = 6.2, a = 2, κ95 = 1.7, δ95 = 0.33, 5.3 T, 15 MA) is ≈ 3', () => {
    const q = q95({ R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 }, 5.3, 15);
    expect(q).toBeGreaterThan(2.9);
    expect(q).toBeLessThan(3.2);
  });

  it('q95 ∝ B/I_p at fixed shape and is infinite without current', () => {
    forAll(gen.record({ R: gen.float(1.5, 10), eps: gen.float(0.15, 0.45), k: gen.float(1, 2.2), d: gen.float(0, 0.6), B: gen.logFloat(1, 13), I: gen.logFloat(0.5, 20), f: gen.float(0.5, 2) }), (s) => {
      const g = { R: s.R, a: s.eps * s.R, kappa: s.k, delta: s.d };
      expect(rel(q95(g, s.f * s.B, s.I) / q95(g, s.B, s.I), s.f)).toBeLessThan(1e-12);
      expect(rel(q95(g, s.B, s.f * s.I) / q95(g, s.B, s.I), 1 / s.f)).toBeLessThan(1e-12);
    });
    expect(q95({ R: 6.2, a: 2, kappa: 1.7, delta: 0.33 }, 5.3, 0)).toBe(Infinity);
  });
});
