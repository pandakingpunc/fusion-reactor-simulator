/**
 * Lengyel model (edge/lengyel.ts).
 *  [L81]  L. L. Lengyel, IPP report 1/191 (1981): q_b² − q_a² = 2 κ0 p² c_z ∫ L_z √T dT.
 *  [B25]  T. Body, A. Kallenbach and T. Eich, arXiv:2504.05486, eqs. 38–42 (extended model with the divertor broadening b).
 *  [M18]  A. A. Mavrin, Radiat. Eff. Defects Solids 173 (2018) 388 (the cooling function of radiation.ts).
 * The independent references are numerical integrations of the flux-tube equations with quadrature and Runge–Kutta
 * codes that share nothing with the cumulative tables of the implementation.
 */
import { describe, expect, it } from 'vitest';
import { forAll, gen } from '../../testing/prop';
import { coolingRate } from '../radiation';
import { integrateGL } from '../numerics/quadrature';
import { rk4Fixed } from '../numerics/rk4';
import {
  LengyelIntegral, LengyelGeometry, MAVRIN_T_MIN_EV, lengyelConcentration, lengyelFluxes, lzFromTable, mavrinLengyel,
} from './lengyel';
import { KAPPA0E } from './twoPoint';

/** smooth test cooling function: a Gaussian bump in ln T (peak 5e-32 W m³ at 30 eV) on a 1e-34 floor */
const bump = (T: number) => 1e-34 + 5e-32 * Math.exp(-0.5 * Math.pow(Math.log(T / 30) / 0.9, 2));
const gaussianLz = new LengyelIntegral(bump);

/** ∫ L_z √T dT by brute-force Gauss–Legendre over many sub-intervals in ln T */
function brute(lz: (T: number) => number, Ta: number, Tb: number, cells = 400): number {
  const la = Math.log(Ta), lb = Math.log(Tb);
  let s = 0;
  for (let i = 0; i < cells; i++) {
    const x0 = la + ((lb - la) * i) / cells, x1 = la + ((lb - la) * (i + 1)) / cells;
    s += integrateGL((x) => lz(Math.exp(x)) * Math.pow(Math.exp(x), 1.5), x0, x1, 8);
  }
  return s;
}

describe('cumulative Lengyel integral', () => {
  it('is exact for a constant cooling function: (2/3) L (T_b^{3/2} − T_a^{3/2})', () => {
    const li = new LengyelIntegral(() => 3e-32);
    forAll(gen.record({ a: gen.logFloat(0.3, 3000), b: gen.logFloat(0.3, 3000) }), ({ a, b }) => {
      const [Ta, Tb] = a < b ? [a, b] : [b, a];
      if (Tb - Ta < 1e-9 * Tb) return;
      const exact = (2 / 3) * 3e-32 * (Math.pow(Tb, 1.5) - Math.pow(Ta, 1.5));
      expect(li.integral(Ta, Tb) / exact).toBeCloseTo(1, 7);
    });
  });

  it('agrees with a brute-force quadrature of a smooth cooling function to 1e-8 and of the Mavrin fits to 1e-4', () => {
    for (const [Ta, Tb] of [[2, 90], [5, 400], [30, 30.5], [0.5, 4000]] as const) {
      expect(gaussianLz.integral(Ta, Tb) / brute(bump, Ta, Tb)).toBeCloseTo(1, 8);
    }
    // the Mavrin fits are piecewise and not quite continuous at the segment boundaries: the cell that holds one is less accurate
    for (const sp of ['C', 'Ne', 'Ar', 'W'] as const) {
      const li = mavrinLengyel(sp);
      for (const [Ta, Tb] of [[5, 300], [100, 3000], [40, 100]] as const) {
        const ref = brute((T) => coolingRate(sp, T / 1000), Ta, Tb, 2000);
        expect(Math.abs(li.integral(Ta, Tb) / ref - 1)).toBeLessThan(1e-4);
      }
    }
  });

  it('is additive, non-negative, zero for a reversed or empty interval, and the Mavrin object is built once', () => {
    forAll(gen.record({ a: gen.logFloat(0.5, 50), b: gen.logFloat(60, 500), c: gen.logFloat(600, 4000) }), ({ a, b, c }) => {
      expect(gaussianLz.integral(a, b) + gaussianLz.integral(b, c)).toBeCloseTo(gaussianLz.integral(a, c), 20);
      expect(gaussianLz.integral(a, b)).toBeGreaterThan(0);
      expect(gaussianLz.integral(b, a)).toBe(0);
    });
    expect(gaussianLz.integral(10, 10)).toBe(0);
    expect(mavrinLengyel('Ne')).toBe(mavrinLengyel('Ne'));
    expect(mavrinLengyel('Ne')).not.toBe(mavrinLengyel('Ar'));
    // beyond the grid the argument is held at the end
    expect(gaussianLz.cumulative(1e-3)).toBe(gaussianLz.cumulative(0.1));
    expect(gaussianLz.cumulative(1e6)).toBe(gaussianLz.cumulative(2e4));
    // a negative cooling function counts as no cooling
    expect(new LengyelIntegral(() => -1).integral(1, 100)).toBe(0);
  });

  it('reports the share of the integral from below the range of the Mavrin fits (100 eV)', () => {
    expect(MAVRIN_T_MIN_EV).toBe(100);
    const li = mavrinLengyel('Ar');
    expect(li.belowFitShare(150, 400)).toBe(0);
    expect(li.belowFitShare(5, 100)).toBeCloseTo(1, 12);
    expect(li.belowFitShare(5, 90)).toBeCloseTo(1, 12);
    const s = li.belowFitShare(5, 300);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    expect(s).toBeCloseTo(li.integral(5, 100) / li.integral(5, 300), 12);
    expect(li.belowFitShare(50, 50)).toBe(0);
    expect(li.belowFitShare(5, 30, 10)).toBeCloseTo(li.integral(5, 10) / li.integral(5, 30), 12);
  });
});

describe('cooling function from a table', () => {
  it('interpolates log–log linearly, is held constant beyond the ends, and rejects malformed tables', () => {
    const f = lzFromTable([1, 10, 100], [1e-33, 1e-31, 1e-32]);
    expect(f(1)).toBeCloseTo(1e-33, 45);
    expect(f(10) / 1e-31).toBeCloseTo(1, 12);
    expect(f(100) / 1e-32).toBeCloseTo(1, 12);
    expect(f(Math.sqrt(10)) / 1e-32).toBeCloseTo(1, 10); // geometric mean of 1e-33 and 1e-31
    expect(f(0.01)).toBe(1e-33);
    expect(f(1e4)).toBe(1e-32);
    expect(() => lzFromTable([1], [1e-33])).toThrow(/at least two/);
    expect(() => lzFromTable([1, 2], [1e-33])).toThrow(/equal length/);
    expect(() => lzFromTable([1, 1], [1e-33, 1e-32])).toThrow(/increase/);
    expect(() => lzFromTable([1, 2], [1e-33, 0])).toThrow(/positive/);
    expect(() => lzFromTable([-1, 2], [1e-33, 1e-32])).toThrow(/positive/);
    // a table plugs into the integral
    const li = new LengyelIntegral(f);
    expect(li.integral(1, 100) / brute(f, 1, 100)).toBeCloseTo(1, 6);
  });
});

const geometry = (over: Partial<LengyelGeometry> = {}): LengyelGeometry => ({
  q_u: 2.5e9, b: 3, p: 4e19 * 250, T_cc: 5, T_x: 130, T_u: 250, kappa0: KAPPA0E, ...over,
});

describe('heat flux through a radiating layer', () => {
  it('a single segment (b = 1) obeys q_u² = q_cc² + 2 κ0 p² c_z ∫ L_z √T dT, verified by integrating the flux-tube ODE with RK4', () => {
    // q dq/dT = κ0 T^{5/2} n² c L_z with n = p/T (variable ln T for a smooth right-hand side); state y = q²
    const c = 0.03, p = 3e21, Tc = 4, Tu = 200, kappa = KAPPA0E;
    const g = geometry({ b: 1, p, T_cc: Tc, T_x: 60, T_u: Tu });
    const li = gaussianLz;
    const q_cc = 4e8;
    // integrate d(q²)/d(ln T) = 2 κ0 p² c L_z(T) T^{3/2} from T_c up to T_u
    const y = new Float64Array([q_cc * q_cc]);
    rk4Fixed((x, _y, dy) => { const T = Math.exp(x); dy[0] = 2 * kappa * p * p * c * bump(T) * Math.pow(T, 1.5); }, y, Math.log(Tc), Math.log(Tu), 4000);
    const qu = Math.sqrt(y[0]);
    // the closed form through the implementation: solve the flux at the target for this q_u
    const { q_cc: q1 } = lengyelFluxes({ ...g, q_u: qu }, c, li);
    expect(q1 / q_cc).toBeCloseTo(1, 7);
    expect(lengyelConcentration({ ...g, q_u: qu }, q_cc, li) / c).toBeCloseTo(1, 7);
  });

  it('with the divertor broadening b: two Lengyel segments, the tube widening by b at the X-point (integrated numerically)', () => {
    const c = 0.02, kappa = KAPPA0E;
    const g = geometry();
    const li = gaussianLz;
    const q_cc = 3e8, b = g.b;
    // lower segment from T_cc to T_x, then the flux density is multiplied by b, then the upper segment to T_u
    const ylow = new Float64Array([q_cc * q_cc]);
    rk4Fixed((x, _y, dy) => { const T = Math.exp(x); dy[0] = 2 * kappa * g.p * g.p * c * bump(T) * Math.pow(T, 1.5); }, ylow, Math.log(g.T_cc), Math.log(g.T_x), 4000);
    const qx = b * Math.sqrt(ylow[0]);
    const yup = new Float64Array([qx * qx]);
    rk4Fixed((x, _y, dy) => { const T = Math.exp(x); dy[0] = 2 * kappa * g.p * g.p * c * bump(T) * Math.pow(T, 1.5); }, yup, Math.log(g.T_x), Math.log(g.T_u), 4000);
    const qu = Math.sqrt(yup[0]);
    const f = lengyelFluxes({ ...g, q_u: qu }, c, li);
    expect(f.q_x / qx).toBeCloseTo(1, 7);
    expect(f.q_cc / q_cc).toBeCloseTo(1, 7);
    expect(lengyelConcentration({ ...g, q_u: qu }, q_cc, li) / c).toBeCloseTo(1, 7);
    // the radiated share of the extended model is larger than of the plain one at the same c_z: the broadening weighs the
    // divertor segment by b²
    const plain = lengyelFluxes({ ...g, b: 1, q_u: qu }, c, li);
    expect(plain.q_cc).toBeGreaterThan(f.q_cc);
  });

  it('c_z ↔ q_cc round trip; no impurity leaves the heat flux unradiated; saturation removes all of it', () => {
    const li = mavrinLengyel('Ar');
    forAll(gen.record({ c: gen.logFloat(1e-4, 0.05), Tu: gen.logFloat(120, 500), qu: gen.logFloat(1e8, 1e10) }), ({ c, Tu, qu }) => {
      const g = geometry({ q_u: qu, T_u: Tu, T_x: 0.5 * Tu, p: 4e19 * Tu });
      const f = lengyelFluxes(g, c, li);
      expect(f.q_cc).toBeLessThanOrEqual(qu / g.b);
      expect(f.q_x).toBeLessThanOrEqual(qu);
      expect(f.q_cc).toBeLessThanOrEqual(f.q_x / g.b + 1e-9);
      if (f.q_cc > 0.05 * qu / g.b) expect(lengyelConcentration(g, f.q_cc, li) / c).toBeCloseTo(1, 6);
      // more impurity, less heat flux
      expect(lengyelFluxes(g, 2 * c, li).q_cc).toBeLessThanOrEqual(f.q_cc);
    });
    const g = geometry();
    expect(lengyelFluxes(g, 0, li)).toEqual({ q_x: g.q_u, q_cc: g.q_u / g.b });
    expect(lengyelFluxes(g, -1, li)).toEqual({ q_x: g.q_u, q_cc: g.q_u / g.b });
    expect(lengyelFluxes(g, 1, li)).toEqual({ q_x: 0, q_cc: 0 });
    // radiation of the upper segment alone consumes the flux below: q_x > 0 but q_cc = 0
    const partial = lengyelFluxes(geometry({ T_x: 60 }), 0.4, gaussianLz);
    expect(partial.q_cc).toBe(0);
  });

  it('the required concentration is 0 when the sheath already takes less than the flux that arrives, Infinity without cooling', () => {
    const li = mavrinLengyel('Ar');
    const g = geometry();
    expect(lengyelConcentration(g, g.q_u / g.b, li)).toBe(0);
    expect(lengyelConcentration(g, 2 * g.q_u, li)).toBe(0);
    expect(lengyelConcentration(g, 0, new LengyelIntegral(() => 0))).toBe(Infinity);
    expect(lengyelConcentration(g, 0, li)).toBeGreaterThan(0);
  });

  it('the temperature of the unradiated conduction model is close to the Lengyel-consistent one: L differs by < 3 % above and < 15 % below the X-point for a radiated fraction of about 17 %', () => {
    // ITER-like: P_sep 100 MW, λ_q = 2 mm → q_u ≈ 2.5 GW/m², Ar; the length of the tube from the two segments of the
    // Lengyel profile against the lengths of the conduction model (q = q_u above, q_u/b below the X-point)
    const li = mavrinLengyel('Ar');
    const g = geometry({ q_u: 2.46e9, T_cc: 177, T_x: 216, T_u: 258, p: 4e19 * 258 });
    const c = 0.02;
    const f = lengyelFluxes(g, c, li);
    expect(1 - (g.b * f.q_cc) / g.q_u).toBeGreaterThan(0.1);
    expect(1 - (g.b * f.q_cc) / g.q_u).toBeLessThan(0.25);
    const K = 2 * g.kappa0 * g.p * g.p * c;
    const qup = (T: number) => Math.sqrt(g.q_u * g.q_u - K * li.integral(T, g.T_u));
    const qlow = (T: number) => Math.sqrt((f.q_x / g.b) ** 2 - K * li.integral(T, g.T_x));
    const Lup = integrateGL((T) => (g.kappa0 * Math.pow(T, 2.5)) / qup(T), g.T_x, g.T_u, 32);
    const Llow = integrateGL((T) => (g.kappa0 * Math.pow(T, 2.5)) / qlow(T), g.T_cc, g.T_x, 32);
    const LupModel = (g.kappa0 * (Math.pow(g.T_u, 3.5) - Math.pow(g.T_x, 3.5))) / (3.5 * g.q_u);
    const LlowModel = (g.kappa0 * (Math.pow(g.T_x, 3.5) - Math.pow(g.T_cc, 3.5))) / (3.5 * (g.q_u / g.b));
    expect(Lup / LupModel - 1).toBeGreaterThan(0);
    expect(Lup / LupModel - 1).toBeLessThan(0.03);
    expect(Llow / LlowModel - 1).toBeGreaterThan(0);
    expect(Llow / LlowModel - 1).toBeLessThan(0.15);
  });
});
