/**
 * Detachment: the state classification and the empirical detachment qualifier q_det of A. Kallenbach
 * for nitrogen-, neon- or argon-seeded H-modes.
 *
 * State (from the target electron temperature T_t of the two-point solution):
 *   attached            T_t ≥ 10 eV   the operating window of a reactor divertor needs T_t < 10 eV, above it
 *                                     the momentum loss is negligible (Stangeby, Plasma Phys. Control. Fusion 60
 *                                     (2018) 044022)
 *   partially detached  2 eV ≤ T_t < 10 eV   momentum and power losses set in
 *   detached            T_t < 2 eV    ion-flux rollover: the mean rollover temperature of the SOLPS-4.3 ITER
 *                                     Q = 10 neon database is 1.8 ± 0.4 eV (D. Moulton et al., Nucl. Fusion 61
 *                                     (2021) 046029); B. Zhu et al., arXiv:2206.09964, use 2.1 eV
 *
 * Qualifier (semi-empirical scaling of the divertor radiation of ASDEX Upgrade; A. Kallenbach et al., Nucl. Fusion 55
 * (2015) 053026 and Plasma Phys. Control. Fusion 58 (2016) 045013; the separatrix density – neutral pressure relation
 * of Plasma Phys. Control. Fusion 60 (2018) 045006; in the form of S. S. Henderson et al., Nucl. Mater. Energy 28 (2021)
 * 101000 and of T. Body, A. Kallenbach and T. Eich, arXiv:2504.05486 (2025), eqs. 5–7, which is where it was read):
 *   q_det = 1.3 / (1 + Σ f_z c_z) · (P_sep/MW) / (R/m) · (1 Pa / p_div) · (5 mm / λ_int)
 *   < 1 pronounced detachment, ≈ 1 partial detachment, > 1 attached
 * with the radiative efficiencies f_z = 18 (N), 45 (Ne), 90 (Ar), the divertor neutral pressure p_div and the integral heat-flux
 * width λ_int. p_div follows from the separatrix density by inverting n_e,sep = 2.65·10^19 m⁻³ (p_div/Pa)^0.31
 * (Kallenbach et al. 2018, as used by Body et al.). The scaling was derived for ASDEX Upgrade (R = 1.65 m, P_sep/R ≲ 10
 * MW/m) and tested on JET and MAST-U; its use at ITER-size P_sep/R is an extrapolation.
 */

export type DetachmentState = 0 | 1 | 2;
export const ATTACHED: DetachmentState = 0;
export const PARTIALLY_DETACHED: DetachmentState = 1;
export const DETACHED: DetachmentState = 2;

/** T_t above which the divertor is attached [eV] */
export const TT_ATTACHED_EV = 10;
/** T_t below which the divertor is detached (ion-flux rollover) [eV] */
export const TT_DETACHED_EV = 2;

export function detachmentState(Tt_eV: number): DetachmentState {
  return Tt_eV >= TT_ATTACHED_EV ? ATTACHED : Tt_eV >= TT_DETACHED_EV ? PARTIALLY_DETACHED : DETACHED;
}

export const DETACHMENT_LABELS: readonly string[] = ['attached', 'partially detached', 'detached'];

/** radiative efficiencies f_z of the seed impurities in q_det (Kallenbach et al.; Body et al. eq. 7) */
export const QDET_FZ: Readonly<Record<string, number>> = { N: 18, Ne: 45, Ar: 90 };

/** Empirical relation of the separatrix density to the divertor neutral pressure (Kallenbach et al. 2018) */
export const NSEP_AT_1PA = 2.65e19; // m⁻³
export const NSEP_PDIV_EXPONENT = 0.31;

/** Divertor neutral pressure [Pa] that goes with a separatrix density [m⁻³] */
export function divertorPressure(n_sep: number): number {
  return Math.pow(Math.max(n_sep, 1e17) / NSEP_AT_1PA, 1 / NSEP_PDIV_EXPONENT);
}

/**
 * q_det for the power P_sep [W], major radius R [m], separatrix density n_sep [m⁻³], integral width λ_int [mm]
 * and the seed impurity (species, concentration c_z); a species without a radiative efficiency contributes nothing.
 */
export function detachmentQualifier(P_sep: number, R: number, n_sep: number, lambdaInt_mm: number, seed?: { species: string; c: number }): number {
  const dilution = 1 + (seed && Number.isFinite(seed.c) && seed.c > 0 ? (QDET_FZ[seed.species] ?? 0) * seed.c : 0);
  return (1.3 / dilution) * (P_sep / 1e6 / R) * (1 / divertorPressure(n_sep)) * (5 / lambdaInt_mm);
}

/**
 * Concentration of the seed impurity at which q_det = 1: c_z = (q_det(0) − 1)/f_z; 0 if the divertor is detached
 * without seeding, NaN for a species without a radiative efficiency.
 */
export function detachmentConcentration(P_sep: number, R: number, n_sep: number, lambdaInt_mm: number, species: string): number {
  const fz = QDET_FZ[species];
  if (!fz) return NaN;
  return Math.max(0, (detachmentQualifier(P_sep, R, n_sep, lambdaInt_mm) - 1) / fz);
}
