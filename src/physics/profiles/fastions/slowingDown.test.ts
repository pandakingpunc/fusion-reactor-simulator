/**
 * The steady slowing-down distribution (Stix 1972; Gaffey 1976): its moments against brute-force quadrature of the
 * distribution itself, which shares no code with the closed forms of heating.ts and slowingDown.ts.
 */
import { describe, expect, it } from 'vitest';
import { criticalEnergy, spitzerSlowingDownTime } from '../../heating';
import { gaussLegendre } from '../../numerics/quadrature';
import { gaffeyCurrentIntegral, gaffeyDistribution, legendre, slowingDownMoments, slowingDownTimes } from './slowingDown';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/** Composite Simpson rule of g(s) on [a, b] with n (even) intervals */
function simpson(g: (s: number) => number, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let s = g(a) + g(b);
  for (let k = 1; k < n; k++) s += g(a + k * h) * (k % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** ∫_0^{u_b} F(u) du with u = e^s from a tiny lower limit (F = O(u²) there) */
function overSpeed(F: (u: number) => number, ub: number): number {
  const lo = 1e-6;
  return simpson((s) => F(Math.exp(s)) * Math.exp(s), Math.log(lo), Math.log(ub), 40000);
}

describe('isotropic steady slowing-down distribution: f(v) = S τ_s / (4π (v³ + v_c³))', () => {
  // v_c = 1, E_c = 10 keV, so E(u) = E_c u²; the source is S = 1 with τ_s = 0.3 s
  const Ec = 10, tauS = 0.3, S = 1;
  for (const ub of [0.7, 1.5, 4, 15]) {
    const E0 = Ec * ub * ub;
    it(`E_0/E_c = ${(ub * ub).toFixed(2)}: n, W, the powers to the ions and the electrons and their sum, to 1e-8 of the brute-force moments`, () => {
      const f = (u: number) => (S * tauS) / (4 * Math.PI * (u * u * u + 1));
      // moments of d³v = 4π u² du
      const n = overSpeed((u) => 4 * Math.PI * u * u * f(u), ub);
      const W = overSpeed((u) => 4 * Math.PI * u * u * f(u) * Ec * u * u, ub);
      // drag on the electrons 2E/τ_s and on the ions 2E/τ_s (v_c/v)³ (the Stix loss law)
      const Pe = overSpeed((u) => 4 * Math.PI * u * u * f(u) * ((2 * Ec * u * u) / tauS), ub);
      const Pi = overSpeed((u) => 4 * Math.PI * u * u * f(u) * ((2 * Ec * u * u) / tauS) / (u * u * u), ub);
      const m = slowingDownMoments({ E0_keV: E0, Ec_keV: Ec, tauS, S });
      expect(rel(m.n, n)).toBeLessThan(1e-8);
      expect(rel(m.W, W)).toBeLessThan(1e-8);
      expect(rel(m.Pe, Pe)).toBeLessThan(1e-8);
      expect(rel(m.Pi, Pi)).toBeLessThan(1e-8);
      // the steady state balances the source: every keV born is delivered to the ions or the electrons
      expect(rel(m.Pe + m.Pi, S * E0)).toBeLessThan(1e-12);
      expect(rel(Pe + Pi, S * E0)).toBeLessThan(1e-8);
      // τ_W = W/(S E_0) is the energy time, τ_th = n/S the thermalisation time
      expect(rel(m.tauW, W / (S * E0))).toBeLessThan(1e-8);
      expect(rel(m.tauTh, n / S)).toBeLessThan(1e-8);
    });
  }

  it('the times of the moments are those of heating.ts for the same plasma', () => {
    const Te = 7, ne = 6e19, A = 2.014, Z = 1, ionSum = 0.55;
    const Ec_keV = criticalEnergy(Te, A, ionSum), tauS2 = spitzerSlowingDownTime(Te, ne, A, Z);
    for (const E0 of [30, 110, 1000, 3500]) {
      const m = slowingDownMoments({ E0_keV: E0, Ec_keV, tauS: tauS2, S: 1 });
      const [th, w] = slowingDownTimes(Te, ne, A, Z, E0, Ec_keV);
      expect(rel(m.tauTh, th)).toBeLessThan(1e-13);
      expect(rel(m.tauW, w)).toBeLessThan(1e-13);
    }
  });

  it('limits: a source far above E_c gives all its energy to the electrons first (G → 0, τ_W → τ_s/2); one below E_c to the ions (G → 1)', () => {
    const hi = slowingDownMoments({ E0_keV: 1e6, Ec_keV: 10, tauS: 1, S: 1 });
    expect(hi.G).toBeLessThan(2e-3);
    expect(rel(hi.tauW, 0.5)).toBeLessThan(2e-3);
    const lo = slowingDownMoments({ E0_keV: 0.01, Ec_keV: 10, tauS: 1, S: 1 });
    expect(lo.G).toBeGreaterThan(1 - 1e-3);
    expect(lo.tauW / 0.5).toBeLessThan(1e-3);
  });
});

describe("Gaffey's distribution with the pitch-angle scattering of the ions", () => {
  const nodes = gaussLegendre(24);

  it('the Legendre polynomials are the ones of the series (orthogonality on [−1, 1], P_l(1) = 1)', () => {
    for (let l = 0; l <= 4; l++) {
      expect(legendre(l, 1)).toBeCloseTo(1, 14);
      for (let k = 0; k <= 4; k++) {
        let s = 0;
        for (let q = 0; q < nodes.x.length; q++) s += nodes.w[q] * legendre(l, nodes.x[q]) * legendre(k, nodes.x[q]);
        expect(Math.abs(s - (l === k ? 2 / (2 * l + 1) : 0))).toBeLessThan(1e-13);
      }
    }
    expect(() => legendre(5, 0.3)).toThrow(RangeError);
  });

  // brute force: ∫ f(u, ξ) g d³v = 2π ∫ u² du ∫ dξ f g with v_c = 1
  const moment = (ub: number, xib: number, Zhat: number, g: (u: number, xi: number) => number, S = 1, tauS = 1) =>
    2 * Math.PI * overSpeed((u) => {
      let s = 0;
      for (let q = 0; q < nodes.x.length; q++) s += nodes.w[q] * gaffeyDistribution(u, nodes.x[q], ub, xib, Zhat, S, tauS, 1) * g(u, nodes.x[q]);
      return u * u * s;
    }, ub);

  const cases: [number, number, number][] = [[3, 0.9, 1.5], [8, 0.6, 2.4], [1.2, 1, 0.8], [20, 0.75, 3.1]];
  for (const [ub, xib, Zhat] of cases) {
    it(`u_b = ${ub}, ξ_b = ${xib}, Ẑ = ${Zhat}: density = S τ_th and energy = S E_0 τ_W with the isotropic part only, to 1e-8`, () => {
      const Ec = 10, E0 = Ec * ub * ub;
      const m = slowingDownMoments({ E0_keV: E0, Ec_keV: Ec, tauS: 1, S: 1 });
      // the pitch-angle scattering conserves the number of particles and their energy: l ≥ 1 integrate to zero over ξ
      expect(rel(moment(ub, xib, Zhat, () => 1), m.n)).toBeLessThan(1e-8);
      expect(rel(moment(ub, xib, Zhat, (u) => Ec * u * u), m.W)).toBeLessThan(1e-8);
    });

    it(`u_b = ${ub}, ξ_b = ${xib}, Ẑ = ${Zhat}: the parallel flow is S τ_s v_b ξ_b I(y_c, Ẑ) to 1e-8 (brute force over the Legendre series)`, () => {
      const flow = moment(ub, xib, Zhat, (u, xi) => u * xi);
      const want = ub * xib * gaffeyCurrentIntegral(1 / ub, Zhat);
      expect(rel(flow, want)).toBeLessThan(1e-8);
    });
  }

  it('without scattering (Ẑ = 0) I(y_c, 0) = 1 − y_c J(1/y_c) with J(Y) = ∫_0^Y du/(1 + u³) in closed form, to 1e-12', () => {
    const J = (Y: number) => (1 / 6) * Math.log(((1 + Y) * (1 + Y)) / (1 - Y + Y * Y)) + (1 / Math.sqrt(3)) * (Math.atan((2 * Y - 1) / Math.sqrt(3)) + Math.PI / 6);
    for (const yc of [0.02, 0.1, 0.35, 0.8, 1.7, 5]) expect(rel(gaffeyCurrentIntegral(yc, 0), 1 - yc * J(1 / yc))).toBeLessThan(1e-12);
  });

  it('limits of the current integral: a source far above E_c keeps its whole parallel velocity (I → 1), scattering lowers it (I decreases with Ẑ)', () => {
    expect(gaffeyCurrentIntegral(0, 0)).toBeCloseTo(1, 12);
    // I(y_c, 0) → 1 − y_c J(∞) with J(∞) = 2π/(3√3) for a small y_c
    expect(rel(1 - gaffeyCurrentIntegral(1e-3, 0), (1e-3 * 2 * Math.PI) / (3 * Math.sqrt(3)))).toBeLessThan(1e-3);
    for (const yc of [0.05, 0.3, 0.9]) {
      let prev = Infinity;
      for (const Zhat of [0, 1, 2, 4]) {
        const I = gaffeyCurrentIntegral(yc, Zhat);
        expect(I).toBeGreaterThan(0);
        expect(I).toBeLessThan(prev);
        prev = I;
      }
    }
  });

  it('the distribution is zero above the birth speed and has the isotropic Stix shape for l = 0 (Ẑ has no effect on it)', () => {
    expect(gaffeyDistribution(2.1, 0.3, 2, 0.5, 1, 1, 1, 1)).toBe(0);
    expect(gaffeyDistribution(0, 0.3, 2, 0.5, 1, 1, 1, 1)).toBe(0);
    const iso = (u: number) => 1 / (4 * Math.PI * (u ** 3 + 1));
    for (const u of [0.2, 1, 1.9]) expect(rel(gaffeyDistribution(u, 0.2, 2, 0.7, 2, 1, 1, 1, 0), iso(u))).toBeLessThan(1e-14);
  });
});
