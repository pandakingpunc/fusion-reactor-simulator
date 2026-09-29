/**
 * Building blocks of the two-point model of the scrape-off layer (P. C. Stangeby, The Plasma Boundary of
 * Magnetic Fusion Devices, IoP 2000, ch. 5; Plasma Phys. Control. Fusion 60 (2018) 044022): electron heat
 * conduction between the upstream point (outer midplane, separatrix) and the target, and the sheath
 * boundary condition with momentum loss.
 *
 * SI except for temperatures, which are in eV (as the coefficients of the model are).
 */

const E = 1.602176634e-19; // J/eV

/** Spitzer–Härm parallel electron heat conductivity coefficient κ0e [W m⁻¹ eV^{−7/2}], Z_eff ≈ 1 (Stangeby 2000: ≈ 2000; 2390 for ln Λ = 13) */
export const KAPPA0E = 2000;
/** Sheath heat transmission coefficient γ (T_i = T_e; Stangeby 2000, ch. 2: γ ≈ 7; the SOLPS-4.3 ITER runs of Moulton et al. 2021 use 8.6) */
export const SHEATH_GAMMA = 7;

/**
 * Conduction-limited temperature at the hot end of a segment of length L that carries the parallel heat-flux
 * density q with the cold end at T_c:
 *   T_hot^{7/2} = T_c^{7/2} + (7/2) q L / κ0e            (q = −κ0e T^{5/2} dT/dx, q constant)
 * For T_c ≪ T_hot this is T_hot = (7 q L / (2 κ0e))^{2/7}: the (q L)^{2/7} law of the conduction-limited SOL.
 */
export function conductionTemperature(Tcold_eV: number, q: number, L: number, kappa0: number = KAPPA0E): number {
  return Math.pow(Math.pow(Math.max(Tcold_eV, 0), 3.5) + (3.5 * Math.max(q, 0) * Math.max(L, 0)) / kappa0, 2 / 7);
}

/**
 * Parallel heat-flux density at the target sheath [W/m²] for the upstream electron density n_u and the temperatures
 * T_u, T_t (T_i = T_e everywhere). Momentum balance: 2 n_t T_t (1 + M_t²) = 4 n_t T_t = (1 − f_mom) 2 n_u T_u
 * (Mach number 1 at the sheath edge); sheath: q_t = γ n_t T_t c_s with c_s = (2 T_t / m_i)^{1/2}:
 *   q_t = γ (1 − f_mom) n_u T_u (T_t / (2 m_i))^{1/2}
 */
export function sheathHeatFlux(n_u: number, Tu_eV: number, Tt_eV: number, fMom: number, m_i: number, gamma: number = SHEATH_GAMMA): number {
  return gamma * (1 - fMom) * n_u * Tu_eV * E * Math.sqrt((Math.max(Tt_eV, 0) * E) / (2 * m_i));
}

/** Electron density at the target sheath edge [m⁻³]: n_t = (1 − f_mom) n_u T_u / (2 T_t) */
export function targetDensity(n_u: number, Tu_eV: number, Tt_eV: number, fMom: number): number {
  return ((1 - fMom) * n_u * Tu_eV) / (2 * Math.max(Tt_eV, 1e-9));
}
