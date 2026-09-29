/**
 * Lengyel model of the radiating scrape-off layer: the impurity concentration c_z that dissipates a
 * given parallel heat flux, and the heat flux that survives a given concentration.
 *
 * Along a flux tube with electron heat conduction q = −κ0 T^{5/2} dT/dx, static pressure n T = p = const
 * and a radiating fixed-fraction impurity, dq/dx = n² c_z L_z(T) (W m⁻³) gives
 *   q dq = −κ0 T^{5/2} n² c_z L_z dT   ⇒   q_b² − q_a² = 2 κ0 p² c_z ∫_{T_a}^{T_b} L_z(T) √T dT
 * (L. L. Lengyel, "Analysis of radiating plasma boundary layers", Max-Planck-Institut für
 * Plasmaphysik report IPP 1/191 (1981); Lengyel & Goedheer; P. C. Stangeby, The Plasma Boundary of
 * Magnetic Fusion Devices, IoP 2000; M. L. Reinke, Nucl. Fusion 57 (2017) 034004).
 *
 * The divertor spreading is taken into account as in the extended Lengyel model of T. Body, A. Kallenbach
 * and T. Eich, arXiv:2504.05486 (2025), eqs. 38–42: at the divertor entrance (X-point, temperature T_x) the
 * heat-flux density of the peak flux tube drops by b = λ_int/λ_q (the tube widens), so that
 *   above:  q_u² − q_x² = K I_2,        K = 2 κ0 p² c_z,  I_2 = ∫_{T_x}^{T_u} L_z √T dT
 *   below:  (q_x/b)² − q_cc² = K I_1,   I_1 = ∫_{T_cc}^{T_x} L_z √T dT
 * ⇒ q_u² = b² q_cc² + K (b² I_1 + I_2). q_cc is the heat flux at the conduction–convection boundary (here:
 * the target temperature; the convective layer is the f_cool/f_mom fits of losses.ts).
 *
 * Cooling function: the Mavrin fits of radiation.ts (A. A. Mavrin, Radiat. Eff. Defects Solids 173 (2018)
 * 388), coronal equilibrium, valid for T_e ≥ 0.1 keV. LIMITATION: the SOL radiates mostly between 5 and 100 eV,
 * below the range of the fits, where `coolingRate` holds its 100 eV value. For neon, carbon and argon that value lies
 * below the low-temperature maximum of the true curve (by an order of magnitude for Ne): the cooling in this region is
 * underestimated and the concentration required for detachment is an UPPER BOUND, possibly several times too large.
 * `LengyelIntegral.belowFitShare` reports the share of the integral that comes from below 100 eV. A better
 * cooling function (e.g. tabulated ADAS data, with or without the non-coronal enhancement) is supplied with
 * `lzFromTable` / `new LengyelIntegral(fn)`.
 */
import { coolingRate } from '../radiation';
import type { ImpuritySpecies } from '../constants';

/** cooling function L_z(T_e [eV]) [W m³] */
export type LzFunction = (T_eV: number) => number;

/** lowest electron temperature at which the Mavrin fits are defined [eV] */
export const MAVRIN_T_MIN_EV = 100;

const T_GRID_MIN = 0.1; // eV
const T_GRID_MAX = 2e4; // eV
const N_CELLS = 1200;
// 3-point Gauss–Legendre on a cell [−1, 1]
const GL_X = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)];
const GL_W = [5 / 9, 8 / 9, 5 / 9];

/**
 * Cumulative integral G(T) = ∫ L_z(T') √T' dT' [W m³ eV^{3/2}] on a logarithmic temperature grid. Cell
 * increments by 3-point Gauss quadrature (in ln T), cubic Hermite interpolation between the nodes with the
 * exact node slopes: no evaluation of L_z at run time.
 */
export class LengyelIntegral {
  private readonly x0 = Math.log(T_GRID_MIN);
  private readonly dx = (Math.log(T_GRID_MAX) - Math.log(T_GRID_MIN)) / N_CELLS;
  /** G at the nodes and the integrand in ln T at the nodes (= dG/dx) */
  private readonly G = new Float64Array(N_CELLS + 1);
  private readonly f = new Float64Array(N_CELLS + 1);

  constructor(readonly lz: LzFunction) {
    const integrand = (x: number) => { const T = Math.exp(x); return Math.max(lz(T), 0) * Math.pow(T, 1.5); };
    for (let i = 0; i <= N_CELLS; i++) this.f[i] = integrand(this.x0 + i * this.dx);
    for (let i = 0; i < N_CELLS; i++) {
      const xm = this.x0 + (i + 0.5) * this.dx;
      let s = 0;
      for (let k = 0; k < 3; k++) s += GL_W[k] * integrand(xm + 0.5 * this.dx * GL_X[k]);
      this.G[i + 1] = this.G[i] + 0.5 * this.dx * s;
    }
  }

  /** G(T) [eV] */
  cumulative(T_eV: number): number {
    const x = Math.log(Math.min(Math.max(T_eV, T_GRID_MIN), T_GRID_MAX));
    const u = (x - this.x0) / this.dx;
    const i = Math.min(N_CELLS - 1, Math.max(0, Math.floor(u)));
    const t = u - i, t2 = t * t, t3 = t2 * t, h = this.dx;
    return (2 * t3 - 3 * t2 + 1) * this.G[i] + (t3 - 2 * t2 + t) * h * this.f[i]
      + (-2 * t3 + 3 * t2) * this.G[i + 1] + (t3 - t2) * h * this.f[i + 1];
  }

  /** ∫_{Ta}^{Tb} L_z(T) √T dT [W m³ eV^{3/2}]; 0 for Tb ≤ Ta */
  integral(Ta_eV: number, Tb_eV: number): number {
    return Tb_eV > Ta_eV ? this.cumulative(Tb_eV) - this.cumulative(Ta_eV) : 0;
  }

  /** Share of ∫_{Ta}^{Tb} that comes from temperatures below `Tfit_eV` (default: the lower limit of the Mavrin fits) */
  belowFitShare(Ta_eV: number, Tb_eV: number, Tfit_eV = MAVRIN_T_MIN_EV): number {
    const total = this.integral(Ta_eV, Tb_eV);
    if (!(total > 0)) return 0;
    return Math.min(1, this.integral(Ta_eV, Math.min(Tb_eV, Tfit_eV)) / total);
  }
}

const mavrinCache = new Map<ImpuritySpecies, LengyelIntegral>();

/** Lengyel integral of the Mavrin (coronal) cooling function of a species; built once */
export function mavrinLengyel(species: ImpuritySpecies): LengyelIntegral {
  let li = mavrinCache.get(species);
  if (!li) { li = new LengyelIntegral((T) => coolingRate(species, T / 1000)); mavrinCache.set(species, li); }
  return li;
}

/**
 * Cooling function from a table (T_e [eV] increasing, L_z [W m³] > 0), log–log linear between the rows and constant
 * beyond the ends.
 */
export function lzFromTable(T_eV: readonly number[], Lz: readonly number[]): LzFunction {
  if (T_eV.length < 2 || T_eV.length !== Lz.length) throw new Error('lzFromTable: need at least two rows of equal length');
  for (let i = 0; i < T_eV.length; i++) {
    if (!(T_eV[i] > 0) || !(Lz[i] > 0)) throw new Error('lzFromTable: T_e and L_z must be positive');
    if (i > 0 && !(T_eV[i] > T_eV[i - 1])) throw new Error('lzFromTable: T_e must increase');
  }
  const lx = T_eV.map(Math.log), ly = Lz.map(Math.log);
  return (T) => {
    const x = Math.log(Math.max(T, 1e-30));
    if (x <= lx[0]) return Lz[0];
    if (x >= lx[lx.length - 1]) return Lz[Lz.length - 1];
    let lo = 0, hi = lx.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lx[m] <= x) lo = m; else hi = m; }
    return Math.exp(ly[lo] + ((x - lx[lo]) / (lx[hi] - lx[lo])) * (ly[hi] - ly[lo]));
  };
}

/** Temperatures and pressure of one Lengyel evaluation */
export interface LengyelGeometry {
  /** heat-flux density upstream of the X-point [W/m²] */
  q_u: number;
  /** broadening b = λ_int/λ_q below the X-point */
  b: number;
  /** electron pressure n T [m⁻³ eV], constant along the conduction region */
  p: number;
  /** temperatures at the conduction–convection boundary, the divertor entrance and upstream [eV] */
  T_cc: number; T_x: number; T_u: number;
  /** electron heat conductivity coefficient κ0e [W m⁻¹ eV^{-7/2}] */
  kappa0: number;
}

/**
 * Heat-flux densities at the divertor entrance q_x and at the conduction–convection boundary q_cc for the
 * concentration c_z of the radiating impurity. 0 once the radiation removes all of the heat flux.
 */
export function lengyelFluxes(g: LengyelGeometry, c_z: number, li: LengyelIntegral): { q_x: number; q_cc: number } {
  if (!(c_z > 0)) return { q_x: g.q_u, q_cc: g.q_u / g.b };
  const K = 2 * g.kappa0 * g.p * g.p * c_z;
  const I1 = li.integral(g.T_cc, g.T_x), I2 = li.integral(g.T_x, g.T_u);
  const qx2 = g.q_u * g.q_u - K * I2;
  const qcc2 = (g.q_u * g.q_u - K * (g.b * g.b * I1 + I2)) / (g.b * g.b);
  return { q_x: qx2 > 0 ? Math.sqrt(qx2) : 0, q_cc: qcc2 > 0 ? Math.sqrt(qcc2) : 0 };
}

/**
 * Concentration c_z at which the heat flux at the conduction–convection boundary is q_cc:
 *   c_z = (q_u² − b² q_cc²) / (2 κ0 p² (b² I_1 + I_2)).
 * 0 if q_cc already is below the target value without radiation (no impurity needed), Infinity if the
 * cooling function integrates to zero.
 */
export function lengyelConcentration(g: LengyelGeometry, q_cc: number, li: LengyelIntegral): number {
  const num = g.q_u * g.q_u - g.b * g.b * q_cc * q_cc;
  if (!(num > 0)) return 0;
  const I = g.b * g.b * li.integral(g.T_cc, g.T_x) + li.integral(g.T_x, g.T_u);
  const den = 2 * g.kappa0 * g.p * g.p * I;
  return den > 0 ? num / den : Infinity;
}
