/**
 * Two-point model building blocks (edge/twoPoint.ts): conduction-limited temperature and the sheath boundary condition.
 *  [S00]  P. C. Stangeby, The Plasma Boundary of Magnetic Fusion Devices, IoP 2000: T_u^{7/2} = T_t^{7/2} + (7/2) q L/κ0e
 *         and q_t = γ n_t T_t c_s.
 */
import { describe, expect, it } from 'vitest';
import { forAll, gen } from '../../testing/prop';
import { integrateGL } from '../numerics/quadrature';
import { KAPPA0E, SHEATH_GAMMA, conductionTemperature, sheathHeatFlux, targetDensity } from './twoPoint';

const E = 1.602176634e-19;
const mD = 2.014 * 1.66053906660e-27;

describe('conduction-limited temperature T_u = (7 q L / 2 κ0e)^{2/7}', () => {
  it('follows the (q L)^{2/7} law: doubling q or L multiplies T_u by 2^{2/7}, to rounding', () => {
    forAll(gen.record({ q: gen.logFloat(1e6, 1e11), L: gen.logFloat(1, 200) }), ({ q, L }) => {
      const T = conductionTemperature(0, q, L);
      expect(conductionTemperature(0, 2 * q, L) / T).toBeCloseTo(Math.pow(2, 2 / 7), 12);
      expect(conductionTemperature(0, q, 2 * L) / T).toBeCloseTo(Math.pow(2, 2 / 7), 12);
      expect(conductionTemperature(0, 3 * q, 5 * L) / T).toBeCloseTo(Math.pow(15, 2 / 7), 12);
      expect(T).toBeCloseTo(Math.pow((7 * q * L) / (2 * KAPPA0E), 2 / 7), 9);
    });
  });

  it('solves q = −κ0e T^{5/2} dT/dx for constant q: integrating dx/dT = κ0e T^{5/2}/q from T_t to T_u gives the length L', () => {
    for (const [q, Tt] of [[2e9, 5], [1e10, 30], [5e7, 2]] as const) {
      for (const L of [10, 60]) {
        const Tu = conductionTemperature(Tt, q, L);
        const Lnum = integrateGL((T) => (KAPPA0E * Math.pow(T, 2.5)) / q, Tt, Tu, 24);
        expect(Lnum / L).toBeCloseTo(1, 12);
      }
    }
  });

  it('reduces to the cold-end temperature without heat flux or length, and never goes below it', () => {
    expect(conductionTemperature(7, 0, 50)).toBeCloseTo(7, 12);
    expect(conductionTemperature(7, 1e9, 0)).toBeCloseTo(7, 12);
    expect(conductionTemperature(7, -1e9, 50)).toBeCloseTo(7, 12);
    forAll(gen.record({ q: gen.logFloat(1e5, 1e11), L: gen.logFloat(1, 100), Tc: gen.logFloat(0.5, 500) }), ({ q, L, Tc }) => {
      expect(conductionTemperature(Tc, q, L)).toBeGreaterThanOrEqual(Tc);
      // the cold end matters as T^{7/2}: the two terms add
      expect(Math.pow(conductionTemperature(Tc, q, L), 3.5) / (Math.pow(Tc, 3.5) + (3.5 * q * L) / KAPPA0E)).toBeCloseTo(1, 11);
    });
    // a different conductivity (Z_eff correction, 2390 for ln Λ = 13) rescales T_u by (κ ratio)^{−2/7}
    expect(conductionTemperature(0, 1e9, 50, 2390) / conductionTemperature(0, 1e9, 50, 2000)).toBeCloseTo(Math.pow(2000 / 2390, 2 / 7), 12);
  });

  it('gives 100–400 eV for the parallel heat fluxes of ITER-size divertors (1–10 GW/m² over 58 m)', () => {
    expect(conductionTemperature(0, 1e9, 58)).toBeGreaterThan(150);
    expect(conductionTemperature(0, 1e9, 58)).toBeLessThan(250);
    expect(conductionTemperature(0, 1e10, 58)).toBeGreaterThan(300);
    expect(conductionTemperature(0, 1e10, 58)).toBeLessThan(500);
  });
});

describe('sheath boundary condition', () => {
  it('q_t = γ n_t T_t c_s with n_t from the pressure balance 4 n_t T_t = (1 − f_mom) 2 n_u T_u and c_s = (2 T_t/m_i)^{1/2}', () => {
    forAll(gen.record({ n: gen.logFloat(1e18, 1e21), Tu: gen.logFloat(20, 800), Tt: gen.logFloat(0.5, 100), f: gen.float(0, 0.95) }), ({ n, Tu, Tt, f }) => {
      const nt = targetDensity(n, Tu, Tt, f);
      // static + dynamic pressure at the target: n_t (T_e + T_i) + m_i n_t c_s² = 4 n_t T_t
      expect(4 * nt * Tt / ((1 - f) * 2 * n * Tu)).toBeCloseTo(1, 12);
      const cs = Math.sqrt((2 * Tt * E) / mD);
      const q = SHEATH_GAMMA * nt * Tt * E * cs;
      expect(sheathHeatFlux(n, Tu, Tt, f, mD) / q).toBeCloseTo(1, 12);
    });
  });

  it('is sheath-limited (n_t = n_u/2) at T_t = T_u and scales as n_u T_u T_t^{1/2}, i.e. T_t ∝ q_t² / (n_u T_u)²', () => {
    expect(targetDensity(3e19, 100, 100, 0)).toBeCloseTo(1.5e19, 6);
    const q = sheathHeatFlux(3e19, 100, 10, 0, mD);
    expect(sheathHeatFlux(6e19, 100, 10, 0, mD) / q).toBeCloseTo(2, 12);
    expect(sheathHeatFlux(3e19, 200, 10, 0, mD) / q).toBeCloseTo(2, 12);
    expect(sheathHeatFlux(3e19, 100, 40, 0, mD) / q).toBeCloseTo(2, 12);
    expect(sheathHeatFlux(3e19, 100, 10, 0.5, mD) / q).toBeCloseTo(0.5, 12);
    expect(sheathHeatFlux(3e19, 100, 10, 1, mD)).toBe(0);
    expect(sheathHeatFlux(3e19, 100, 0, 0, mD)).toBe(0);
    // a different transmission coefficient (SOLPS: 8.6) rescales linearly
    expect(sheathHeatFlux(3e19, 100, 10, 0, mD, 8.6) / q).toBeCloseTo(8.6 / SHEATH_GAMMA, 12);
    // the target density is finite as T_t → 0
    expect(Number.isFinite(targetDensity(3e19, 100, 0, 0))).toBe(true);
  });
});
