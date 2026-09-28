/**
 * Reference pack: collisional heating formulas (src/physics/heating.ts).
 *  [NRL]  J.D. Huba, NRL Plasma Formulary (2019), p. 34: η⊥ = 1.03e-2 Z lnΛ T_e^{−3/2} Ω cm (T_e in eV),
 *         η∥ = η⊥/1.96 for Z = 1; fast-ion slowing down on electrons τ_se = 6.27e8 A T_e^{3/2}/(Z² n_e lnΛ) s
 *         (T_e in eV, n_e in cm⁻³).
 *  [SAL99] O. Sauter, C. Angioni and Y.R. Lin-Liu, Phys. Plasmas 6 (1999) 2834, Eq. (18): Spitzer
 *         conductivity ∝ 1/(Z N(Z)), N(Z) = 0.58 + 0.74/(0.76 + Z).
 *  [Stix72] T.H. Stix, Plasma Phys. 14 (1972) 367: critical energy E_c = 14.8 T_e A_f [Σ n_j Z_j²/(n_e A_j)]^{2/3}
 *         and the ion share of the slowing-down power G(x) = (1/x) ∫₀ˣ dy/(1 + y^{3/2}), x = E_0/E_c;
 *         thermalisation time τ_th = (τ_se/3) ln(1 + x^{3/2}).
 *  [Wes11] J. Wesson, Tokamaks, 4th ed. (2011), §5.5: E_c ≈ 33 T_e for fusion alphas in a 50:50 D-T plasma.
 */
import { describe, expect, it } from 'vitest';
import { criticalEnergy, ionHeatingFraction, nbiShineThrough, ohmicPower, resistivity, slowingDownTime } from '../heating';
import { coulombLog } from '../transport';
import { forAll, gen } from '../../testing/prop';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('Spitzer resistivity', () => {
  it('[NRL] η∥ = 5.26e-5 lnΛ T_eV^{−3/2} Ω m for Z = 1 without trapping correction, within 1 %', () => {
    forAll(gen.record({ T: gen.logFloat(0.02, 50), n: gen.logFloat(1e18, 1e21) }), ({ T, n }) => {
      const eta = ((1.03e-2 / 1.96) * 1e-2 * coulombLog(n, T)) / (T * 1e3) ** 1.5;
      expect(rel(resistivity(T, 1, n, 0), eta)).toBeLessThan(0.01);
    }, { runs: 100 });
  });

  it('[SAL99] Z_eff dependence follows Z N(Z)/N(1) within 2 % for 1 ≤ Z_eff ≤ 5', () => {
    const N = (Z: number) => 0.58 + 0.74 / (0.76 + Z);
    forAll(gen.float(1, 5), (Z) => {
      const ratio = resistivity(5, Z, 1e20, 0) / resistivity(5, 1, 1e20, 0);
      expect(rel(ratio, (Z * N(Z)) / N(1))).toBeLessThan(0.02);
    }, { runs: 100 });
  });

  it('the trapped-particle correction never lowers η and grows with ε; η falls as T_e^{−3/2} (lnΛ aside)', () => {
    forAll(gen.record({ T: gen.logFloat(0.05, 50), Z: gen.float(1, 4), e1: gen.float(0, 0.9), e2: gen.float(0, 0.9) }), ({ T, Z, e1, e2 }) => {
      const [lo, hi] = e1 < e2 ? [e1, e2] : [e2, e1];
      expect(resistivity(T, Z, 1e20, lo)).toBeGreaterThanOrEqual(resistivity(T, Z, 1e20, 0));
      expect(resistivity(T, Z, 1e20, hi)).toBeGreaterThanOrEqual(resistivity(T, Z, 1e20, lo));
      const r = (resistivity(2 * T, Z, 1e20, lo) / resistivity(T, Z, 1e20, lo)) * (coulombLog(1e20, T) / coulombLog(1e20, 2 * T));
      expect(r).toBeCloseTo(2 ** -1.5, 12);
    }, { runs: 100 });
  });

  it('ohmic power is η j² V with j = I/A', () => {
    expect(ohmicPower(15e6, 21.4, 830, 2e-9)).toBeCloseTo(2e-9 * (15e6 / 21.4) ** 2 * 830, 6);
  });
});

describe('[Stix72] fast-ion slowing down', () => {
  it('critical energy formula, and E_c ≈ 33 T_e for alphas in 50:50 D-T [Wes11]', () => {
    forAll(gen.record({ T: gen.logFloat(0.1, 100), A: gen.float(1, 4), s: gen.float(0.1, 3) }), ({ T, A, s }) => {
      expect(rel(criticalEnergy(T, A, s), 14.8 * T * A * s ** (2 / 3))).toBeLessThan(1e-14);
    });
    const ionSum = 0.5 / 2.014 + 0.5 / 3.016; // Σ n_j Z_j²/(n_e A_j), n_D = n_T = n_e/2
    expect(criticalEnergy(10, 4.0026, ionSum) / 10).toBeGreaterThan(32);
    expect(criticalEnergy(10, 4.0026, ionSum) / 10).toBeLessThan(34);
  });

  /** G(x) by Simpson's rule after y = u² (smooth integrand 2u/(1+u³)) */
  const Gref = (x: number) => {
    const n = 2000, b = Math.sqrt(x), h = b / n;
    let s = 0;
    for (let i = 0; i <= n; i++) { const u = i * h; s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * ((2 * u) / (1 + u ** 3)); }
    return (s * h) / 3 / x;
  };

  it('closed-form ion heating fraction equals the defining integral', () => {
    forAll(gen.logFloat(1e-3, 1e3), (x) => { expect(Math.abs(ionHeatingFraction(x * 50, 50) - Gref(x))).toBeLessThan(1e-9); }, { runs: 200 });
  });

  it('G → 1 for E_0 ≪ E_c and G x → 4π/(3√3) for E_0 ≫ E_c; G decreases with E_0/E_c', () => {
    expect(ionHeatingFraction(1e-3, 100)).toBeCloseTo(1, 6);
    expect(ionHeatingFraction(1e6, 1) * 1e6).toBeCloseTo((4 * Math.PI) / (3 * Math.sqrt(3)), 2);
    forAll(gen.tuple(gen.logFloat(1e-3, 1e3), gen.float(1.01, 10)), ([x, k]) => {
      expect(ionHeatingFraction(k * x, 1)).toBeLessThan(ionHeatingFraction(x, 1));
    });
  });

  it('[NRL] slowing-down and thermalisation times', () => {
    forAll(gen.record({ T: gen.logFloat(0.1, 50), n: gen.logFloat(1e18, 1e21), A: gen.float(1, 4), Z: gen.oneOf([1, 2]), E0: gen.logFloat(10, 5000), Ec: gen.logFloat(5, 2000) }),
      ({ T, n, A, Z, E0, Ec }) => {
        const tse = (6.27e8 * A * (T * 1e3) ** 1.5) / (Z * Z * n * 1e-6 * coulombLog(n, T));
        expect(rel(slowingDownTime(T, n, A, Z, E0, Ec), (tse / 3) * Math.log(1 + (E0 / Ec) ** 1.5))).toBeLessThan(1e-12);
      }, { runs: 100 });
    // ITER-like core: 3.5 MeV alpha, T_e = 10 keV, n_e = 1e20 m⁻³ → τ_se = 0.37 s from the NRL expression
    const tse = slowingDownTime(10, 1e20, 4, 2, 3500, 330) * 3 / Math.log(1 + (3500 / 330) ** 1.5);
    expect(tse).toBeGreaterThan(0.3);
    expect(tse).toBeLessThan(0.5);
  });
});

describe('NBI shine-through (documented approximation)', () => {
  it('is a transmission in (0, 1], falling with density and minor radius, rising with beam energy', () => {
    forAll(gen.record({ n: gen.logFloat(1e18, 1e21), a: gen.float(0.1, 3), E: gen.logFloat(10, 2000), k: gen.float(1.01, 3) }), ({ n, a, E, k }) => {
      const f = nbiShineThrough(n, a, E);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(nbiShineThrough(k * n, a, E)).toBeLessThan(f);
      expect(nbiShineThrough(n, k * a, E)).toBeLessThan(f);
      if (k * E <= 2000) expect(nbiShineThrough(n, a, k * E)).toBeGreaterThan(f);
    });
  });
});
