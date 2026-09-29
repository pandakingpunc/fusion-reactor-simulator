/**
 * The ECCD efficiency of Lin-Liu, Chan and Prater, Phys. Plasmas 10 (2003) 4064 (cd/eccd.ts): the flux-surface averages and the interpolation formula
 * of Appendix A against numerical averages, the response function against its differential equation and the limits of the paper (Taguchi 1/(Z_eff + 5)),
 * the non-relativistic straight-field efficiency against an independent evaluation of equation 40, and the curves of Fig. 1 of the paper.
 */
import { describe, expect, it } from 'vitest';
import { coulombLog } from '../../transport';
import {
  avgSqrtOneMinusLambdaH, circulatingFraction, currentPerPower, dHdLambda, eccdSurface, eccdZetaStar, resonanceRange, responseFRaw, responseH, surfaceAverages, ZETA_CONSTANT,
} from './eccd';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/** Flux-surface average of the circular model (A.10): (1/π) ∫_0^π (1 + ε cos θ) A(θ) dθ, midpoint rule with n panels */
function fsAvg(eps: number, A: (h: number) => number, n = 20000): number {
  let s = 0;
  for (let k = 0; k < n; k++) {
    const th = ((k + 0.5) / n) * Math.PI;
    const c = 1 + eps * Math.cos(th);
    s += c * A((1 - eps) / c);
  }
  return s / n;
}

describe('flux-surface averages of the model equilibrium (Appendix A)', () => {
  it('⟨h⟩ = 1 − ε, ⟨h²⟩ = (1 − ε)²/√(1 − ε²) and ⟨(1 − h)^{1/2}⟩ of A.13, against the average over θ_p', () => {
    for (const e of [0.05, 0.2, 0.5, 0.8]) {
      const a = surfaceAverages(e);
      expect(rel(a.h1, fsAvg(e, (h) => h))).toBeLessThan(1e-9);
      expect(rel(a.h2, fsAvg(e, (h) => h * h))).toBeLessThan(1e-9);
      // c_4 + 1 = ⟨(1 − h)^{1/2}⟩²/(1 − ⟨h⟩)
      const hs = fsAvg(e, (h) => Math.sqrt(1 - h), 400000);
      expect(rel(a.c4 + 1, (hs * hs) / e)).toBeLessThan(2e-4);
    }
  });

  it('the limits ε → 0 of the paper: c_2 → −1/8, c_4 → 8/π² − 1', () => {
    const a = surfaceAverages(1e-3);
    expect(a.c2).toBeCloseTo(-0.125, 3);
    expect(a.c4).toBeCloseTo(8 / (Math.PI * Math.PI) - 1, 2);
  });

  it('the interpolation formula (A.5) gives ⟨(1 − λh)^{1/2}⟩ to 1 % for ε ≤ 0.5 and 0 ≤ λ ≤ 0.98', () => {
    let worst = 0;
    for (const e of [0.05, 0.1, 0.2, 0.35, 0.5]) {
      const a = surfaceAverages(e);
      for (const l of [0, 0.2, 0.5, 0.8, 0.95, 0.98]) worst = Math.max(worst, rel(avgSqrtOneMinusLambdaH(l, a), fsAvg(e, (h) => Math.sqrt(1 - l * h), 100000)));
    }
    expect(worst).toBeLessThan(1e-2);
  });

  it('H(λ) is the integral of equation 29 with the exact averages (to 0.5 %); H(1) = 0, dH/dλ = −1/(2⟨√(1 − λ h)⟩), H → √(1 − λ) as ε → 0', () => {
    for (const e of [0.05, 0.2, 0.5]) {
      const a = surfaceAverages(e);
      for (const l of [0, 0.3, 0.7, 0.9]) {
        let I = 0;
        const n = 400;
        for (let k = 0; k < n; k++) {
          const x = l + ((k + 0.5) / n) * (1 - l);
          I += (1 - l) / n / fsAvg(e, (h) => Math.sqrt(1 - x * h), 4000);
        }
        expect(rel(responseH(l, a), 0.5 * I)).toBeLessThan(5e-3);
        expect(rel(dHdLambda(l, a), -0.5 / fsAvg(e, (h) => Math.sqrt(1 - l * h), 100000))).toBeLessThan(1e-2);
      }
      expect(responseH(1, a)).toBe(0);
      expect(responseH(1.2, a)).toBe(0);
    }
    const a0 = surfaceAverages(1e-5);
    for (const l of [0, 0.4, 0.9]) expect(Math.abs(responseH(l, a0) - Math.sqrt(1 - l))).toBeLessThan(0.01);
  });

  it('the effective circulating fraction f_c of equation 32 is 1 − f_t of the neoclassical theory (Lin-Liu and Miller, Phys. Plasmas 2 (1995) 1666: f_t = 1 − (1 − ε)²/(√(1 − ε²)(1 + 1.46 √ε))) to 2 %', () => {
    for (const e of [0.05, 0.1, 0.2, 0.3, 0.5]) {
      const ft = 1 - ((1 - e) ** 2 / (Math.sqrt(1 - e * e) * (1 + 1.46 * Math.sqrt(e))));
      expect(Math.abs(circulatingFraction(surfaceAverages(e)) - (1 - ft))).toBeLessThan(0.02);
    }
    expect(circulatingFraction(surfaceAverages(1e-4))).toBeGreaterThan(0.97);
  });
});

describe('the response function F(u) (equations 31, 33, 34)', () => {
  const theta = 0.01, ue2 = 2 * theta; // T_e = 5.1 keV, c = 1
  const Z = 1.6, fc = 0.6, rho = (Z + 1) / fc;
  const F = (u: number) => responseFRaw(u, fc, rho) / (ue2 * ue2);

  it('solves (γ²/u²) F′ + ρ̂ (γ/u³) F = u/(f_c γ u_e⁴): its derivative is the one of the equation, and F(0) = 0', () => {
    for (const u of [0.05, 0.15, 0.3, 0.6]) {
      const h = 1e-5 * u, g = Math.sqrt(1 + u * u);
      const dF = (F(u + h) - F(u - h)) / (2 * h);
      const model = (u ** 3) / (fc * g ** 3 * ue2 * ue2) - (rho * F(u)) / (g * u);
      expect(rel(dF, model)).toBeLessThan(1e-5);
    }
    expect(responseFRaw(1e-9, fc, rho)).toBeLessThan(1e-30);
  });

  it('is Taguchi\'s (u/u_e)⁴/(Z_eff + 1 + 4 f_c) for u ≪ c (equation 34)', () => {
    for (const f of [1, 0.6, 0.3]) {
      const u = 1e-3, r = (Z + 1) / f;
      expect(rel(responseFRaw(u, f, r) / (ue2 * ue2), (u * u * u * u) / (ue2 * ue2 * (Z + 1 + 4 * f)))).toBeLessThan(1e-5);
    }
  });
});

describe('the resonance curve (equation 43)', () => {
  it('γ_min, γ_max are the roots of γ² − 1 = ((γ − y)/n∥)², and there is none when n∥² + y² ≤ 1', () => {
    for (const [n, y] of [[0.3, 0.97], [0.5, 0.9], [0.7, 0.93], [0.2, 0.99]]) {
      const [lo, hi] = resonanceRange(n, y)!;
      for (const g of [lo, hi]) expect(Math.abs(g * g - 1 - ((g - y) / n) ** 2)).toBeLessThan(1e-12);
      expect(hi).toBeGreaterThan(lo);
    }
    expect(resonanceRange(0.3, 0.9)).toBeNull();
    expect(resonanceRange(1.2, 1.0)).toBeNull();
  });
});

describe('the efficiency ζ*', () => {
  const lnL = (ne: number, Te: number) => coulombLog(ne, Te);

  /** Independent evaluation of equation 40 in the non-relativistic straight-field limit: F = (u/u_e)⁴/(Z + 5), H = |ξ|, so that
   * m u_e² Λ̃χ̃ = (u/u_e)² [3ξ + n∥ u/c]/(Z + 5), on the resonance curve, midpoint rule in x = (γ − γ_min)/θ_T */
  function straightFieldZeta(Te: number, Z: number, n: number, y: number, ell: number, lnLam: number): number {
    const th = Te / 510.99895;
    const [lo, hi] = resonanceRange(n, y)!;
    const X = Math.min((hi - lo) / th, 60), M = 200000;
    let num = 0, den = 0;
    for (let k = 0; k < M; k++) {
      const x = ((k + 0.5) / M) * X, g = lo + th * x;
      const u2 = g * g - 1, u = Math.sqrt(u2), up = (g - y) / n, xi = up / u;
      const w = Math.exp(-x) * Math.pow(Math.max(u2 - up * up, 0), ell);
      num += w * ((u2 / (2 * th)) * (3 * xi + n * u)) / (Z + 5);
      den += w;
    }
    return ((4 / lnLam) * num) / den;
  }

  it('large aspect ratio, non-relativistic: agrees with an independent evaluation of equation 40 with F = (u/u_e)⁴/(Z_eff + 5) and H = |ξ| to 3 % (what it leaves out: the relativistic corrections of order γ − 1 ≈ 1e-2 of the resonant electrons here, f_c = 0.999)', () => {
    const Te = 0.1, ne = 3e19;
    for (const [n, y, ell] of [[0.3, 0.97, 2], [0.5, 0.95, 2], [0.2, 0.99, 1]]) {
      const surf = eccdSurface(1e-6);
      const z = eccdZetaStar({ Te_keV: Te, Zeff: 1.5, nPar: n, harmonic: ell, y, eps: 1e-6, thetaP: 0, lnLambda: lnL(ne, Te) }, surf);
      expect(rel(z, straightFieldZeta(Te, 1.5, n, y, ell, lnL(ne, Te)))).toBeLessThan(3e-2);
    }
  });

  it('the Z_eff dependence of the straight-field efficiency is Taguchi\'s (Z_eff + 5)^{-1} (non-relativistic, ε → 0)', () => {
    const p = { Te_keV: 0.1, nPar: 0.3, harmonic: 2, y: 0.97, eps: 1e-6, thetaP: 0, lnLambda: 16 };
    const z1 = eccdZetaStar({ ...p, Zeff: 1 }), z3 = eccdZetaStar({ ...p, Zeff: 3 });
    expect(rel(z1 / z3, (3 + 5) / (1 + 5))).toBeLessThan(1.5e-2);
  });

  it('trapping lowers the efficiency at large ε (the Ohkawa effect): the same conditions at ε = 0.3 drive less current than at ε = 0.02, and no wave, no current', () => {
    const p = { Te_keV: 5, Zeff: 1.5, nPar: 0.3, harmonic: 2, y: 0.965, thetaP: 0, lnLambda: 16 };
    expect(Math.abs(eccdZetaStar({ ...p, eps: 0.3 }))).toBeLessThan(Math.abs(eccdZetaStar({ ...p, eps: 0.02 })));
    expect(eccdZetaStar({ ...p, eps: 0.1, y: 0.9 })).toBe(0);
    expect(eccdZetaStar({ ...p, eps: 0.1, Te_keV: 0 })).toBe(0);
  });

  it('the current per power: ⟨j∥⟩ = 2π ζ* T_e Q/(32.74 n_20), i.e. I = ζ T_keV P/(32.7 n_20 R) (equation 44)', () => {
    // 10 MW absorbed in a shell of volume 2 m³ at R = 3 m, T_e = 5 keV, n_e = 0.5e20, ζ = 0.3: I = 0.3 × 5 × 10e6/(32.74 × 0.5 × 3) = 0.305 MA
    const j = currentPerPower(0.3, 5, 0.5e20) * (10e6 / 2);
    const I = j * (2 / (2 * Math.PI * 3));
    expect(rel(I, (0.3 * 5 * 10e6) / (ZETA_CONSTANT * 0.5 * 3))).toBeLessThan(1e-12);
    expect(ZETA_CONSTANT).toBeCloseTo(32.7, 1);
  });

  // Fig. 1 of the paper: n_e = 2e19 m^-3, T_e = 2 keV, R = 1.76 m, ε = 0.2, Z_eff = 1.6, second harmonic, ζ of equation 44 (= ζ*/√(1 − ε²) for the model
  // equilibrium, B.7) against y = 2 f_ce/f (the solid curves are equations 40-43). The values below are read off the plotted curves (± 0.02).
  describe('Fig. 1 of the paper', () => {
    const surf = eccdSurface(0.2);
    const zeta = (n: number, y: number, thDeg: number) => eccdZetaStar({ Te_keV: 2, Zeff: 1.6, nPar: n, harmonic: 2, y, eps: 0.2, thetaP: (thDeg * Math.PI) / 180, lnLambda: lnL(2e19, 2) }, surf) / Math.sqrt(1 - 0.04);

    it('(a) θ_p = 165° (high-field side): positive everywhere, falling towards zero at y → 1, 0.2 at y = 0.932 for n∥ = 0.7', () => {
      for (const n of [0.7, 0.6, 0.5, 0.4]) {
        let prev = Infinity;
        for (const y of [0.95, 0.96, 0.97, 0.98, 0.99]) {
          const z = zeta(n, y, 165);
          expect(z).toBeGreaterThan(0);
          expect(z).toBeLessThan(prev);
          prev = z;
        }
      }
      expect(Math.abs(zeta(0.7, 0.932, 165) - 0.2)).toBeLessThan(0.02);
      expect(Math.abs(zeta(0.7, 0.96, 165) - 0.09)).toBeLessThan(0.02);
      expect(Math.abs(zeta(0.7, 0.98, 165) - 0.03)).toBeLessThan(0.02);
    });

    it('(b) θ_p = 90°: the curve of n∥ = 0.7 crosses zero near y = 0.95 and dips to −0.02; it dips deeper (−0.03 to −0.05) at larger y for smaller n∥', () => {
      expect(zeta(0.7, 0.93, 90)).toBeGreaterThan(0.05);
      expect(zeta(0.7, 0.94, 90)).toBeGreaterThan(0);
      expect(zeta(0.7, 0.96, 90)).toBeLessThan(0);
      let min7 = 0;
      for (let y = 0.94; y <= 1; y += 0.002) min7 = Math.min(min7, zeta(0.7, y, 90));
      expect(Math.abs(min7 + 0.02)).toBeLessThan(0.015);
      let min4 = 0, at4 = 0;
      for (let y = 0.95; y <= 1; y += 0.002) { const z = zeta(0.4, y, 90); if (z < min4) { min4 = z; at4 = y; } }
      expect(min4).toBeLessThan(-0.02);
      expect(min4).toBeGreaterThan(-0.07);
      expect(at4).toBeGreaterThan(0.97);
    });

    it('(c) θ_p = 15° (low-field side): negative dips of −0.06 (n∥ = 0.7, near y = 0.94) and −0.09 (n∥ = 0.5, near y = 0.96) as the trapped electrons turn the current round', () => {
      let min7 = 0, at7 = 0, min5 = 0, at5 = 0;
      for (let y = 0.93; y <= 1; y += 0.002) {
        const a = zeta(0.7, y, 15), b = zeta(0.5, y, 15);
        if (a < min7) { min7 = a; at7 = y; }
        if (b < min5) { min5 = b; at5 = y; }
      }
      expect(Math.abs(min7 + 0.06)).toBeLessThan(0.02);
      expect(Math.abs(at7 - 0.94)).toBeLessThan(0.015);
      expect(Math.abs(min5 + 0.09)).toBeLessThan(0.025);
      expect(Math.abs(at5 - 0.96)).toBeLessThan(0.015);
      // the reversal is a trapping effect: at θ_p = 165° the same conditions give a positive current
      expect(zeta(0.5, 0.96, 165)).toBeGreaterThan(0);
    });
  });
});
