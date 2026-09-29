/**
 * FACIT (facit.ts): the limits of the theory the fitted coefficients must reduce to, and regression pins of the port.
 *
 * The coefficients are transcribed fits to NEO scans (Fajardo et al. 2022); there is no independent NEO run in this repository, so what is
 * checked is the structure of the theory (the Z scaling of the convection, K = (Z/Z_i) D), the results that the fits are built to
 * reproduce (the -1/2 temperature screening of a heavy impurity in the Pfirsch-Schlueter regime, Hirshman and Sigmar, Nucl. Fusion 21
 * (1981) 1079, and the ratio 2 q^2 of the PS to the classical diffusion, Hinton and Hazeltine, Rev. Mod. Phys. 48 (1976) 239) and the
 * regimes (banana-plateau dominates at low collisionality, PS at high). The pins are the numbers of this port at the documented inputs: they
 * catch a change of a constant, they are not a validation.
 */
import { describe, expect, it } from 'vitest';
import { facitCoefficients, ftrap, mainIonFlowCoefficient, type FacitInput } from './facit';

/** ITER-like plasma: D-T main ions, R0 6.2 m, B0 5.3 T, minor radius 2 m */
const ITER = { Zi: 1, Ai: 2.5, TeOverTi: 1, R0: 6.2, B0: 5.3, Zeff: 1.6 };
const at = (rho: number, T_eV: number, n: number, q: number, Z: number, A: number, frac = 1e-4): FacitInput => ({
  ...ITER, Zimp: Z, Aimp: A, Ti_eV: T_eV, Ni: n, Nimp: frac * n, eps: (rho * 2.0) / 6.2, q,
});
const CORE = (Z: number, A: number) => at(0.6, 10000, 8e19, 2.0, Z, A);

describe('FACIT: structure of the theory', () => {
  it('the convection driven by the main-ion density gradient is Z / Z_i times the diffusion, in every part', () => {
    for (const [Z, A] of [[2, 4], [6, 12], [18, 40], [46, 184]]) {
      const r = facitCoefficients(CORE(Z, A));
      for (const p of [r, r.PS, r.BP, r.CL]) expect(p.K / p.D).toBeCloseTo(Z, 10);
      expect(r.D).toBeCloseTo(r.PS.D + r.BP.D + r.CL.D, 15);
      expect(r.H).toBeCloseTo(r.PS.H + r.BP.H + r.CL.H, 15);
      expect(r.D).toBeGreaterThan(0);
    }
  });

  it('the trapped fraction approaches sqrt(2 eps) at small eps (the thesis approximation of eq. 2.31)', () => {
    for (const eps of [1e-4, 1e-3]) expect(ftrap(eps) / Math.sqrt(2 * eps)).toBeGreaterThan(0.97), expect(ftrap(eps) / Math.sqrt(2 * eps)).toBeLessThan(1.06);
    expect(ftrap(0.3)).toBeGreaterThan(ftrap(0.1));
    expect(ftrap(0.9)).toBeLessThan(1);
  });

  it('the Pfirsch-Schlueter diffusion is 2 q^2 times the classical one (Hinton and Hazeltine 1976) at small eps', () => {
    for (const q of [1, 2, 3.5]) {
      const r = facitCoefficients(at(0.1, 5000, 8e19, q, 10, 20));
      // the fits give 0.96 (1 - 0.54 f_t^4.5) 2 eps^2 / (1 + 2 eps^2) of the ideal ratio: within 6 % at eps = 0.03
      expect(r.PS.D / r.CL.D / (2 * q * q)).toBeGreaterThan(0.94);
      expect(r.PS.D / r.CL.D / (2 * q * q)).toBeLessThan(1.0);
    }
  });

  it('a heavy impurity in the low-collisionality core has the -1/2 temperature screening of the PS and classical parts', () => {
    // Z >> Z_i, A >> A_i: C0 -> 3/2 (thesis section 2.3.5), H/K -> -1/2 (Hirshman and Sigmar 1981)
    for (const rho of [0.6, 0.9]) {
      const r = facitCoefficients(at(rho, 10000, 8e19, 2.5, 46, 184));
      expect(r.PS.H / r.PS.K).toBeGreaterThan(-0.62);
      expect(r.PS.H / r.PS.K).toBeLessThan(-0.45);
      expect(r.CL.H / r.CL.K).toBeGreaterThan(-0.62);
      expect(r.CL.H / r.CL.K).toBeLessThan(-0.45);
      expect(r.C0z).toBeGreaterThan(1.4);
      expect(r.C0z).toBeLessThan(1.65);
    }
    // ... and the ion temperature gradient then drives an outward convection: the total H is negative for a heavy impurity
    expect(facitCoefficients(CORE(46, 184)).H).toBeLessThan(0);
  });

  it('the banana-plateau part dominates the diffusion at low collisionality and the PS part at high collisionality', () => {
    const hot = facitCoefficients(at(0.3, 20000, 5e19, 1.2, 10, 20));
    expect(hot.BP.D).toBeGreaterThan(5 * hot.PS.D);
    expect(hot.nuiStar).toBeLessThan(0.05);
    const cold = facitCoefficients(at(0.6, 150, 8e19, 2.0, 10, 20));
    expect(cold.PS.D).toBeGreaterThan(5 * cold.BP.D);
    expect(cold.nuiStar).toBeGreaterThan(10);
  });

  it('the diffusion grows with the collision rate: the PS part is proportional to nu_z rho_Lz^2 q^2 (a factor 4 in n -> 4 in D_PS at fixed fits)', () => {
    const a = facitCoefficients(at(0.6, 8000, 4e19, 2, 6, 12, 1e-5));
    const b = facitCoefficients(at(0.6, 8000, 8e19, 2, 6, 12, 1e-5));
    // nu_z ~ n_i / T^{3/2} (times a slowly varying Coulomb logarithm): twice the density, about twice the PS diffusion
    expect(b.PS.D / a.PS.D).toBeGreaterThan(1.9);
    expect(b.PS.D / a.PS.D).toBeLessThan(2.1);
  });

  it('every coefficient is finite over a scan of the inputs the model can reach (edge to core, He to W)', () => {
    let n = 0;
    for (const [Z, A] of [[2, 4], [4, 9], [10, 20], [18, 40], [46, 184]]) {
      for (const rho of [0.02, 0.3, 0.7, 0.99]) {
        for (const T of [30, 300, 3000, 30000]) {
          for (const q of [0.8, 3, 12]) {
            const r = facitCoefficients({ ...ITER, Zimp: Z, Aimp: A, Ti_eV: T, Ni: 6e19, Nimp: 1e15, eps: (rho * 2.0) / 6.2, q });
            expect(Number.isFinite(r.D) && Number.isFinite(r.K) && Number.isFinite(r.H), `Z ${Z} rho ${rho} T ${T} q ${q}`).toBe(true);
            expect(r.D).toBeGreaterThan(0);
            n++;
          }
        }
      }
    }
    expect(n).toBe(240);
  });

  it('the impurity density is floored (a zero density is the trace limit, not a division by zero)', () => {
    const r = facitCoefficients({ ...CORE(2, 4), Nimp: 0 });
    expect(Number.isFinite(r.D) && r.D > 0).toBe(true);
    expect(r.D).toBeCloseTo(facitCoefficients({ ...CORE(2, 4), Nimp: 1e10 }).D, 12);
  });

  it('the main-ion flow coefficient is the banana value -(1 - f_t)/(1 - 1.158 f_t + 0.98 f_t^2) at low collisionality and rises towards 0 with it', () => {
    for (const ft of [0.2, 0.5]) {
      const banana = -(1 - ft) / (1 - 1.158 * ft + 0.98 * ft * ft);
      expect(mainIonFlowCoefficient(1e-20, ft, 1)).toBeCloseTo(banana, 3);
    }
    expect(mainIonFlowCoefficient(1e-3, 0.3, 1)).toBeLessThan(mainIonFlowCoefficient(10, 0.3, 1));
  });
});

describe('FACIT: regression pins of the port (numbers of this implementation, not an external reference)', () => {
  it('ITER-like core at rho 0.6: W and Ar', () => {
    const w = facitCoefficients(at(0.6, 10000, 8e19, 2.0, 46, 184));
    expect(w.D).toBeCloseTo(0.008451, 5);
    expect(w.H / w.K).toBeCloseTo(-0.3803, 3);
    const ar = facitCoefficients(at(0.6, 10000, 8e19, 2.0, 16, 40));
    expect(ar.D).toBeCloseTo(0.01560, 4);
    expect(ar.PS.H / ar.PS.K).toBeCloseTo(-0.4926, 3);
  });
});
