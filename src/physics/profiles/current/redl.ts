/**
 * Redl et al. neoclassical coefficients: the bootstrap current and the neoclassical conductivity (lane ws6c), an option beside the Sauter
 * coefficients of `neoclassical.ts` (`ProfileSettings.neoclassicalModel: 'redl'`).
 *
 * A. Redl, C. Angioni, E. Belli, O. Sauter, ASDEX Upgrade Team and EUROfusion MST1 Team, "A new set of analytical formulae for the
 * computation of the bootstrap current and the neoclassical conductivity in tokamaks", Phys. Plasmas 28 (2021) 022502, eqs. (10)–(21).
 * The formulae have the structure of Sauter, Angioni and Lin-Liu (Phys. Plasmas 6 (1999) 2834; 9 (2002) 5140) and keep its definitions of the
 * trapped fraction f_trap, of the collisionalities ν*_e, ν*_i and of Z_eff (Sauter eqs. (12), (18a)–(18e): `nuStarE`, `nuStarI`, `sigmaSpitzer`
 * of neoclassical.ts); the coefficients were refitted to the numerical neoclassical code NEO. Sauter's fit overestimates the
 * bootstrap current in the collisional edge (ν*_e above a few, the pedestal) and treats impurities badly; the new fit is within 5 % of NEO
 * where the analytic structure allows it, and 10 % for ρ_pol > 0.95 of an ASDEX Upgrade pedestal where Sauter's is off by up to 100 %.
 * Differences from the model of Sauter: L34 = L31 (the ion flow coefficient α absorbs the difference), the Z_eff dependence of every term,
 * α → −0.5 at high collisionality (Sauter: 2.1), and the conductivity.
 *
 * The bootstrap current is ⟨j_bs·B⟩ = −F p [L31 ∂ln p/∂ψ + R_pe L32 ∂ln T_e/∂ψ + (1 − R_pe) α L34 ∂ln T_i/∂ψ] (`bootstrapJB`, unchanged: the
 * current source uses the coefficient set that the option selects); σ_neo = σ_Spitzer F33.
 *
 * The limits of the formulae are the analytical ones of the model of Sauter and the tests pin them: L31(f_trap = 1, ν* → 0) = 1 for every Z_eff,
 * L31(0) = L32(0) = 0, L32 → 0 at f_trap = 1, σ_neo → σ_Spitzer for ν* → ∞ and → 0 for f_trap = 1, ν* → 0, α → −0.5 for large ν*_i.
 */
import { sigmaSpitzer, type BootstrapCoeffs } from '../neoclassical';

/**
 * The fit polynomial of L31 and L34 (eq. 10, with the effective trapped fraction X of eq. 11 as its argument):
 * (1 + 0.15/(Z^1.2 − 0.71)) X − 0.22/(Z^1.2 − 0.71) X² + 0.01/(Z^1.2 − 0.71) X³ + 0.06/(Z^1.2 − 0.71) X⁴.
 */
function F31(X: number, Z: number): number {
  const zf = Math.pow(Z, 1.2) - 0.71;
  const X2 = X * X;
  return (1 + 0.15 / zf) * X - (0.22 / zf) * X2 + (0.01 / zf) * X2 * X + (0.06 / zf) * X2 * X2;
}

/** L31, L32, L34 and α of Redl et al. for the trapped fraction ft, the collisionalities nuE (ν*_e) and nuI (ν*_i) and the effective charge Z ≥ 1 */
export function redlCoefficients(ft: number, nuE: number, nuI: number, Z: number): BootstrapCoeffs {
  const sqe = Math.sqrt(nuE), sqi = Math.sqrt(nuI);
  const Zm1 = Math.max(Z - 1, 0);
  // L31 (eqs. 10, 11)
  const X31 = ft / (1 + (0.67 * (1 - 0.7 * ft) * sqe) / (0.56 + 0.44 * Z) + ((0.52 + 0.086 * sqe) * (1 + 0.87 * ft) * nuE) / (1 + 1.13 * Math.sqrt(Zm1)));
  const L31 = F31(X31, Z);
  // L32 = F32ee + F32ei (eqs. 12–16)
  const Xee = ft / (1 + (0.23 * (1 - 0.96 * ft) * sqe) / Math.sqrt(Z)
    + ((0.13 * (1 - 0.38 * ft) * nuE) / (Z * Z)) * (Math.sqrt(1 + 2 * Math.sqrt(Zm1)) + ft * ft * Math.sqrt((0.075 + 0.25 * Zm1 * Zm1) * nuE)));
  const e2 = Xee * Xee, e3 = e2 * Xee, e4 = e2 * e2;
  const F32ee = ((0.1 + 0.6 * Z) / (Z * (0.77 + 0.63 * (1 + Math.pow(Zm1, 1.1))))) * (Xee - e4)
    + (0.7 / (1 + 0.2 * Z)) * (e2 - e4 - 1.2 * (e3 - e4)) + (1.3 / (1 + 0.5 * Z)) * e4;
  const Xei = ft / (1 + (0.87 * (1 + 0.39 * ft) * sqe) / (1 + 2.95 * Zm1 * Zm1) + 1.53 * (1 - 0.37 * ft) * nuE * (2 + 0.375 * Zm1));
  const i2 = Xei * Xei, i3 = i2 * Xei, i4 = i2 * i2;
  const F32ei = (-(0.4 + 1.93 * Z) / (Z * (0.8 + 0.6 * Z))) * (Xei - i4)
    + (5.5 / (1.5 + 2 * Z)) * (i2 - i4 - 0.8 * (i3 - i4)) - (1.3 / (1 + 0.5 * Z)) * i4;
  const L32 = F32ei + F32ee;
  // L34 = L31 (eq. 19)
  const L34 = L31;
  // α (eqs. 20, 21)
  const a0 = (-(0.62 + 0.055 * Zm1) / (0.53 + 0.17 * Zm1)) * ((1 - ft) / (1 - (0.31 - 0.065 * Zm1) * ft - 0.25 * ft * ft));
  const f6 = ft ** 6, n2 = nuI * nuI;
  const alpha = ((a0 + 0.7 * Z * Math.sqrt(ft) * sqi) / (1 + 0.18 * sqi) - 0.002 * n2 * f6) / (1 + 0.004 * n2 * f6);
  return { L31, L32, L34, alpha };
}

/** Neoclassical conductivity σ_neo = σ_Spitzer F33 [S/m] of Redl et al. (eqs. 17, 18); ne [m⁻³], TeV [eV], Z the effective charge ≥ 1 */
export function sigmaNeoRedl(ft: number, nuE: number, ne: number, TeV: number, Z: number): number {
  const X = ft / (1 + 0.25 * (1 - 0.7 * ft) * Math.sqrt(nuE) * (1 + 0.45 * Math.sqrt(Math.max(Z - 1, 0))) + (0.61 * (1 - 0.41 * ft) * nuE) / Math.sqrt(Z));
  const F33 = 1 - (1 + 0.21 / Z) * X + (0.54 / Z) * X * X - (0.33 / Z) * X * X * X;
  return sigmaSpitzer(ne, TeV, Z) * F33;
}
