/**
 * The IFS-PPPL thermal transport formula: the analytic fit of Kotschenreuther, Dorland, Beer and Hammett,
 * "Quantitative predictions of tokamak energy confinement from first-principles simulations with kinetic effects",
 * Phys. Plasmas 2 (1995) 2381, section III, equations (1)-(4). Nothing in it is calibrated here: every coefficient,
 * exponent and limit is the paper's.
 *
 * The paper fits the ion heat diffusivity of nonlinear gyrofluid simulations of toroidal ion-temperature-gradient
 * (ITG) turbulence, completed by linear gyrokinetic ballooning calculations with non-adiabatic electrons for the critical
 * gradient and for the ratio of the electron to the ion heat flux. There are two branches: the deuterium mode (1) and a carbon
 * mode (2) that matters at a large carbon charge fraction (TFTR supershots: Z*_eff above 3), and
 *
 *   χ_i = C0 max(χ_i^(1), χ_i^(2)) ρ_i² v_ti / R,                                                C0 = 12                    (1)
 *   χ_i^(1) = (q/τ_b)^1.1 / (1 + ŝ^0.84) (1 + 6.7 ε / (q ν^0.26)) Z(Z*_eff) G(R/L_T − R/L_Tcrit^(1))
 *   χ_i^(2) = 0.66 τ_b^−0.8 / (1 + ŝ) max[0.25, Z*_eff − 3] G(R/L_T − R/L_Tcrit^(2))
 *   G(x) = min(x, x^1/2) H(x),   Z = min[1, (3/Z*_eff)^1.8],   τ = T_i/T_e,   τ_b = τ/(1 − σ_b)
 *   R/L_Tcrit^(1) = f g h                                                                                                    (2)
 *     f = 1 − 0.2 Z*_eff^0.5 ŝ^−0.7 (14 ε^1.3 ν^−0.2 − 1)
 *     g = (0.7 + 0.6 ŝ − 0.2 R/L*_n)² + 0.4 + 0.3 R/L*_n − 0.8 ŝ + 0.2 ŝ²
 *     h = 1.5 (1 + 2.8/q²)^0.26 Z*_eff^0.7 τ_b^0.5
 *   R/L_Tcrit^(2) = 0.75 (1 + τ_b)(1 + ŝ) D(R/L*_n) E(Z*_eff),  D = max(1, 3 − 0.67 R/L*_n),  E = 1 + 6 max(0, 2.9 − Z*_eff)  (3)
 *   χ_e = C0 max(χ_e^(1), χ_e^(2)) ρ_i² v_ti / R,                                                                            (4)
 *     χ_e^(1) = χ_i^(1) 0.72 ε* ν^0.14 (q/ŝ)^0.3 τ^0.4 J_1.5(R/L_n),  ε* = max(0.17, ε)
 *     χ_e^(2) = χ_i^(2) 0.26 τ ν^0.22 J_2(R/L*_n),                     J_ξ(x) = max[ξ, 1 + 0.3 x]
 *
 * with the collisionality ν = 2.1 R n_e19 / (T_e^1.5 T_i^0.5) (R in m, T in keV, n_e in 1e19 m^-3), ε = r/R, ŝ = d ln q/d ln r,
 * Z*_eff = (n_D + 36 n_C)/(n_D + 6 n_C) and σ_b the charge fraction of the beam ions; ρ_i = √(m_i T_i)/(e B) and v_ti = √(T_i/m_i)
 * (the normalisation that puts the TFTR NTP test case of the paper's figure 1 at χ_i of 5-8 m²/s at mid radius). The model is
 * for the confinement zone: the paper predicts the profiles inside r/a = 0.8 and takes the measured temperature at r/a = 0.8 as the
 * boundary condition, because the formula is often below the measured χ in the last 10-20 % of the minor radius.
 *
 * Domain of validity (the paper, section III): 0.7 < q < 8, 0.5 < ŝ < 2, 0 < R/L_n < 6, 0.5 < T_i/T_e < 4, 1 < Z*_eff < 4, 0.5 < ν < 10,
 * 0.1 < r/R < 0.3. A fit is not to be extrapolated ("we should not expect it to reproduce extreme limits, such as ν approaching zero or
 * infinity, shear approaching zero"): `clampToDomain` puts every argument except ε (the trapped-particle terms vanish smoothly towards
 * the axis) into that box, so a cold edge, a flat-q core or an X-point q cannot send a power law to infinity.
 *
 * Two reading choices, stated where they matter: R/L*_n is min(6, R/L_n) (the journal prints "max" and a stray multiplication sign,
 * while the domain 0 < R/L_n < 6 and the density dependence of D and J only make sense as a cap); the beam charge fraction σ_b is neglected
 * (0; ITER and JET beams hold a few per cent of the electrons), and Z*_eff is the plasma Z_eff (for carbon the two are the same number).
 */

/** The amplitude C0 of equations (1) and (4) */
export const IFS_C0 = 12;

/** The local plasma parameters the fit is written in */
export interface IfsInputs {
  /** R/L_Ti = −R ∂T_i/∂r / T_i (a negative gradient is no drive) */
  RLT: number;
  /** R/L_n = −R ∂n/∂r / n; every density scale length is taken equal (n_e, n_D, n_C) */
  RLn: number;
  /** safety factor */
  q: number;
  /** magnetic shear ŝ = d ln q / d ln r (the sign is not used) */
  shear: number;
  /** T_i / T_e */
  tau: number;
  /** inverse aspect ratio r/R */
  eps: number;
  /** collisionality 2.1 R n_e19 / (T_e^1.5 T_i^0.5) */
  nu: number;
  /** Z*_eff */
  Zeff: number;
  /** charge fraction of the beam ions σ_b (default 0) */
  sigmaB?: number;
}

/** The domain of validity of the fit (Kotschenreuther et al. 1995, section III): [min, max] of each argument that is clamped */
export const IFS_DOMAIN = {
  q: [0.7, 8], shear: [0.5, 2], RLn: [0, 6], tau: [0.5, 4], Zeff: [1, 4], nu: [0.5, 10],
} as const satisfies Record<string, readonly [number, number]>;

/** Result of the fit: the diffusivities in units of ρ_i² v_ti / R, the two critical gradients and the branch that is active */
export interface IfsResult {
  /** C0 max(χ_i^(1), χ_i^(2)) [ρ_i² v_ti / R] */
  chiI: number;
  /** C0 max(χ_e^(1), χ_e^(2)) [ρ_i² v_ti / R] */
  chiE: number;
  /** R/L_Tcrit of the deuterium and of the carbon mode */
  crit1: number; crit2: number;
  /** 0: neither branch is above its threshold, 1: the deuterium mode, 2: the carbon mode */
  branch: 0 | 1 | 2;
}

const clamp = (x: number, r: readonly [number, number]): number => (x < r[0] ? r[0] : x > r[1] ? r[1] : x);

/** The arguments of the fit inside its domain of validity (ε, R/L_T and σ_b are left alone; a value that is not a number becomes the lower limit) */
export function clampToDomain(p: IfsInputs): IfsInputs {
  const c = (x: number, r: readonly [number, number]) => (Number.isFinite(x) ? clamp(x, r) : r[0]);
  return {
    ...p, q: c(p.q, IFS_DOMAIN.q), shear: c(Math.abs(p.shear), IFS_DOMAIN.shear), RLn: c(p.RLn, IFS_DOMAIN.RLn), tau: c(p.tau, IFS_DOMAIN.tau),
    Zeff: c(p.Zeff, IFS_DOMAIN.Zeff), nu: c(p.nu, IFS_DOMAIN.nu),
  };
}

/** G(x) = min(x, x^1/2) H(x): linear above the threshold up to one unit, then the square root */
export function stiffnessG(x: number): number {
  return x > 0 ? Math.min(x, Math.sqrt(x)) : 0;
}

/** R/L_Tcrit^(1), equation (2), of the deuterium (main-ion) mode; the arguments are already inside the domain */
export function critGradientDeuterium(p: IfsInputs): number {
  const { q, shear: s, tau, eps, nu, Zeff, RLn } = p;
  const tauB = tau / (1 - (p.sigmaB ?? 0));
  const f = 1 - 0.2 * Math.sqrt(Zeff) * Math.pow(s, -0.7) * (14 * Math.pow(eps, 1.3) * Math.pow(nu, -0.2) - 1);
  const a = 0.7 + 0.6 * s - 0.2 * RLn;
  const g = a * a + 0.4 + 0.3 * RLn - 0.8 * s + 0.2 * s * s;
  const h = 1.5 * Math.pow(1 + 2.8 / (q * q), 0.26) * Math.pow(Zeff, 0.7) * Math.sqrt(tauB);
  return f * g * h;
}

/** R/L_Tcrit^(2), equation (3), of the carbon mode */
export function critGradientCarbon(p: IfsInputs): number {
  const tauB = p.tau / (1 - (p.sigmaB ?? 0));
  const D = Math.max(1, 3 - 0.67 * p.RLn);
  const E = 1 + 6 * Math.max(0, 2.9 - p.Zeff);
  return 0.75 * (1 + tauB) * (1 + p.shear) * D * E;
}

/** The IFS-PPPL diffusivities, equations (1)-(4), for the local parameters `raw` (clamped to the domain of the fit first) */
export function ifsChi(raw: IfsInputs): IfsResult {
  const p = clampToDomain(raw);
  const { q, shear: s, tau, eps, nu, Zeff, RLT, RLn } = p;
  const tauB = tau / (1 - (p.sigmaB ?? 0));
  const crit1 = critGradientDeuterium(p), crit2 = critGradientCarbon(p);
  const Z = Math.min(1, Math.pow(3 / Zeff, 1.8));
  const chi1 = (Math.pow(q / tauB, 1.1) / (1 + Math.pow(s, 0.84))) * (1 + (6.7 * eps) / (q * Math.pow(nu, 0.26))) * Z * stiffnessG(RLT - crit1);
  const chi2 = ((0.66 * Math.pow(tauB, -0.8)) / (1 + s)) * Math.max(0.25, Zeff - 3) * stiffnessG(RLT - crit2);
  const J = (xi: number) => Math.max(xi, 1 + 0.3 * RLn);
  const epsStar = Math.max(0.17, eps);
  const ratio1 = 0.72 * epsStar * Math.pow(nu, 0.14) * Math.pow(q / s, 0.3) * Math.pow(tau, 0.4) * J(1.5);
  const ratio2 = 0.26 * tau * Math.pow(nu, 0.22) * J(2);
  const chiI = IFS_C0 * Math.max(chi1, chi2);
  const chiE = IFS_C0 * Math.max(ratio1 * chi1, ratio2 * chi2);
  return { chiI, chiE, crit1, crit2, branch: chi1 <= 0 && chi2 <= 0 ? 0 : chi1 >= chi2 ? 1 : 2 };
}
