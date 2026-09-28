/**
 * Reference pack: confinement scalings, L–H threshold and Coulomb logarithm (src/physics/transport.ts).
 * Each scaling is re-evaluated here from the published formula, written out in full:
 *  [IPB98] ITER Physics Expert Groups, "ITER Physics Basis, Chapter 2", Nucl. Fusion 39 (1999) 2175, Eq. (20):
 *          τ = 0.0562 I^0.93 B^0.15 n19^0.41 P^−0.69 R^1.97 κ_a^0.78 ε^0.58 M^0.19
 *  [ITER89] P.N. Yushmanov et al., Nucl. Fusion 30 (1990) 1999:
 *          τ = 0.048 I^0.85 R^1.2 a^0.3 κ^0.5 n20^0.1 B^0.2 M^0.5 P^−0.5
 *  [ISS04] H. Yamada et al., Nucl. Fusion 45 (2005) 1684:
 *          τ = 0.134 a^2.28 R^0.64 P^−0.61 n19^0.54 B^0.84 ι_{2/3}^0.41
 *  [ST]    M. Valovič et al., Nucl. Fusion 51 (2011) 073045 (MAST): τ ∝ I^0.59 B^1.4 n^0.44 P^−0.73,
 *          normalised by the model to IPB98 at I = 0.8 MA, B = 0.5 T, n19 = 3, P = 2 MW.
 *  [M08]   Y.R. Martin et al., J. Phys.: Conf. Ser. 123 (2008) 012033:
 *          P_LH = 0.0488 n20^0.717 B^0.803 S^0.941 [MW], with the 2/M isotope factor (−20 % for D-T).
 *  [NRL]   J.D. Huba, NRL Plasma Formulary (2019), p. 34: lnΛ_ei = 24 − ln(n_e^{1/2} T_e^{−1}), n in cm⁻³, T in eV.
 * Units: I [MA], B [T], n [m⁻³], P [W], R, a [m], M [amu].
 */
import { describe, expect, it } from 'vitest';
import { coulombLog, pLH_Martin, tauIPB98y2, tauISS04, tauITER89P, tauSTValovic } from '../transport';
import type { Geometry } from '../geometry';
import { forAll, gen } from '../../testing/prop';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

const ipb98 = (g: Geometry, I: number, B: number, n: number, P: number, M: number) =>
  0.0562 * I ** 0.93 * B ** 0.15 * (n / 1e19) ** 0.41 * (P / 1e6) ** -0.69 * g.R ** 1.97 * g.kappa ** 0.78 * (g.a / g.R) ** 0.58 * M ** 0.19;
const iter89 = (g: Geometry, I: number, B: number, n: number, P: number, M: number) =>
  0.048 * I ** 0.85 * g.R ** 1.2 * g.a ** 0.3 * g.kappa ** 0.5 * (n / 1e20) ** 0.1 * B ** 0.2 * M ** 0.5 * (P / 1e6) ** -0.5;
const iss04 = (g: Geometry, B: number, n: number, P: number, iota: number) =>
  0.134 * g.a ** 2.28 * g.R ** 0.64 * (P / 1e6) ** -0.61 * (n / 1e19) ** 0.54 * B ** 0.84 * iota ** 0.41;
const martin = (n: number, B: number, S: number, M: number) => 0.0488 * (n / 1e20) ** 0.717 * B ** 0.803 * S ** 0.941 * (2 / M);

/** random operating point, kept away from the clamps (P ≥ 0.1 MW, n19 ≥ 0.01) */
const point = gen.record({
  R: gen.float(0.5, 10), eps: gen.float(0.15, 0.8), kappa: gen.float(1, 2.8), delta: gen.float(0, 0.6),
  I: gen.logFloat(0.1, 20), B: gen.logFloat(0.2, 13), n: gen.logFloat(1e19, 5e20), P: gen.logFloat(1e6, 5e8),
  M: gen.float(1, 3), iota: gen.float(0.2, 2),
});
const geo = (p: { R: number; eps: number; kappa: number; delta: number }): Geometry => ({ R: p.R, a: p.eps * p.R, kappa: p.kappa, delta: p.delta });

// ITER Q = 10 reference point (ITER Physics Basis 1999, Ch. 1; Shimada et al., Nucl. Fusion 47 (2007) S1):
// R = 6.2 m, a = 2.0 m, κ = 1.7, I = 15 MA, B = 5.3 T, n̄ = 1.0e20 m⁻³, D-T (M = 2.5) and a loss power
// P_α + P_aux − P_rad,core ≈ 80 + 40 − 33 ≈ 87 MW.
const ITER_G: Geometry = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };

describe('[IPB98] H-mode scaling', () => {
  it('equals the published formula at random operating points', () => {
    forAll(point, (p) => { expect(rel(tauIPB98y2(geo(p), p.I, p.B, p.n, p.P, p.M), ipb98(geo(p), p.I, p.B, p.n, p.P, p.M))).toBeLessThan(1e-12); },
      { runs: 200, label: 'IPB98(y,2)' });
  });

  it('gives τ_E ≈ 3.6 s at the ITER Q = 10 reference point (quoted 3.4–3.7 s)', () => {
    const tau = tauIPB98y2(ITER_G, 15, 5.3, 1.0e20, 87e6, 2.5);
    expect(tau).toBeGreaterThan(3.4);
    expect(tau).toBeLessThan(3.8);
    expect(tau).toBeCloseTo(3.60, 1);
  });

  it('isotope factor M^0.19: D-T confines 4.3 % better than D', () => {
    const r = tauIPB98y2(ITER_G, 15, 5.3, 1e20, 87e6, 2.5) / tauIPB98y2(ITER_G, 15, 5.3, 1e20, 87e6, 2.0);
    expect(r).toBeCloseTo(1.25 ** 0.19, 12);
  });
});

describe('[ITER89] L-mode scaling', () => {
  it('equals the published formula at random operating points', () => {
    forAll(point, (p) => { expect(rel(tauITER89P(geo(p), p.I, p.B, p.n, p.P, p.M), iter89(geo(p), p.I, p.B, p.n, p.P, p.M))).toBeLessThan(1e-12); },
      { runs: 200, label: 'ITER89-P' });
  });
  it('isotope factor M^0.5 and H-mode/L-mode ratio ≈ 2 at the ITER point', () => {
    const tauL = tauITER89P(ITER_G, 15, 5.3, 1e20, 87e6, 2.5);
    expect(tauL / tauITER89P(ITER_G, 15, 5.3, 1e20, 87e6, 2.0)).toBeCloseTo(Math.sqrt(1.25), 12);
    const H = tauIPB98y2(ITER_G, 15, 5.3, 1e20, 87e6, 2.5) / tauL;
    expect(H).toBeGreaterThan(1.5);
    expect(H).toBeLessThan(2.5);
  });
});

describe('[ISS04] stellarator scaling', () => {
  it('equals the published formula (f_ren = 1) and is linear in f_ren', () => {
    forAll(gen.tuple(point, gen.float(0.3, 1.5)), ([p, f]) => {
      const g = geo(p);
      expect(rel(tauISS04(g, p.B, p.n, p.P, p.iota, 1), iss04(g, p.B, p.n, p.P, p.iota))).toBeLessThan(1e-12);
      expect(rel(tauISS04(g, p.B, p.n, p.P, p.iota, f), f * iss04(g, p.B, p.n, p.P, p.iota))).toBeLessThan(1e-12);
    }, { runs: 200, label: 'ISS04' });
  });
});

describe('[ST] spherical-tokamak scaling', () => {
  it('coincides with IPB98 at its normalisation point for any geometry and mass', () => {
    forAll(point, (p) => {
      const g = geo(p);
      expect(rel(tauSTValovic(g, 0.8, 0.5, 3e19, 2e6, p.M), tauIPB98y2(g, 0.8, 0.5, 3e19, 2e6, p.M))).toBeLessThan(1e-12);
    }, { runs: 100 });
  });
});

describe('scaling homogeneity: τ(λx) = λ^α τ(x) for every argument', () => {
  type Scaling = { name: string; tau: (g: Geometry, I: number, B: number, n: number, P: number, M: number, iota: number) => number; exps: Record<string, number> };
  const scalings: Scaling[] = [
    { name: 'IPB98', tau: (g, I, B, n, P, M) => tauIPB98y2(g, I, B, n, P, M), exps: { I: 0.93, B: 0.15, n: 0.41, P: -0.69, M: 0.19, kappa: 0.78, a: 0.58, R: 1.97 - 0.58 } },
    { name: 'ITER89', tau: (g, I, B, n, P, M) => tauITER89P(g, I, B, n, P, M), exps: { I: 0.85, B: 0.2, n: 0.1, P: -0.5, M: 0.5, kappa: 0.5, a: 0.3, R: 1.2 } },
    { name: 'ISS04', tau: (g, _I, B, n, P, _M, iota) => tauISS04(g, B, n, P, iota, 1), exps: { I: 0, B: 0.84, n: 0.54, P: -0.61, M: 0, kappa: 0, a: 2.28, R: 0.64, iota: 0.41 } },
    { name: 'ST', tau: (g, I, B, n, P, M) => tauSTValovic(g, I, B, n, P, M), exps: { I: 0.59, B: 1.4, n: 0.44, P: -0.73, M: 0.19, kappa: 0.78, a: 0.58, R: 1.97 - 0.58 } },
  ];
  const vars = ['I', 'B', 'n', 'P', 'M', 'kappa', 'a', 'R', 'iota'] as const;
  it('holds for random points, variables and factors', () => {
    forAll(gen.tuple(point, gen.oneOf(scalings), gen.oneOf(vars), gen.float(0.5, 2)), ([p, s, v, lam]) => {
      const x = { ...p, a: p.eps * p.R };
      const run = (q: typeof x) => s.tau({ R: q.R, a: q.a, kappa: q.kappa, delta: q.delta }, q.I, q.B, q.n, q.P, q.M, q.iota);
      const y = { ...x, [v]: x[v] * lam };
      const alpha = s.exps[v] ?? 0;
      expect(rel(run(y) / run(x), lam ** alpha), `${s.name}: ∂lnτ/∂ln${v} = ${alpha}`).toBeLessThan(1e-11);
    }, { runs: 400, label: 'homogeneity' });
  });
});

describe('[M08] L–H power threshold', () => {
  it('equals the published formula (in W) at random points', () => {
    forAll(gen.record({ n: gen.logFloat(1e19, 3e20), B: gen.logFloat(0.2, 13), S: gen.logFloat(1, 2000), M: gen.float(1, 3) }), ({ n, B, S, M }) => {
      expect(rel(pLH_Martin(n, B, S, M), martin(n, B, S, M) * 1e6)).toBeLessThan(1e-12);
    }, { runs: 200 });
  });
  it('matches the PROCESS unit-test reference: 13.542309512892546 MW at n20 = 1, B = 5 T, S = 100 m², M = 2', () => {
    // ukaea/PROCESS tests/unit/models/physics/test_l_h_transition.py (test_calculate_martin08_nominal)
    expect(rel(pLH_Martin(1e20, 5, 100, 2) / 1e6, 13.542309512892546)).toBeLessThan(1e-12);
  });
  it('predicts ≈ 52 MW for ITER in deuterium at n = 0.5e20 and 20 % less in D-T', () => {
    const S_ITER = 683; // m², ITER plasma surface
    const pD = pLH_Martin(0.5e20, 5.3, S_ITER, 2) / 1e6;
    expect(pD).toBeGreaterThan(47);
    expect(pD).toBeLessThan(57);
    expect(pLH_Martin(0.5e20, 5.3, S_ITER, 2.5) / 1e6 / pD).toBeCloseTo(0.8, 12);
  });
});

describe('[NRL] Coulomb logarithm', () => {
  it('equals 24 − ln(√n_e[cm⁻³] / T_e[eV]) above 10 eV', () => {
    forAll(gen.record({ n: gen.logFloat(1e17, 1e22), T: gen.logFloat(0.011, 100) }), ({ n, T }) => {
      const ref = 24 - Math.log(Math.sqrt(n * 1e-6) / (T * 1e3));
      expect(coulombLog(n, T)).toBeCloseTo(Math.max(ref, 5), 12);
    }, { runs: 200 });
    expect(coulombLog(1e20, 10)).toBeCloseTo(24 - Math.log(1e7 / 1e4), 12); // ≈ 17.1 in a reactor core
  });
});
