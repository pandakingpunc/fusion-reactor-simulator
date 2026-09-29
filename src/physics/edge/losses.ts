/**
 * Momentum and power loss factors of the divertor leg as functions of the target electron
 * temperature T_t, for the two-point model with volumetric losses
 * (P. C. Stangeby, "Basic physical processes and reduced models for plasma detachment",
 * Plasma Phys. Control. Fusion 60 (2018) 044022):
 *
 *   f_mom  = 1 − p_t,tot / p_u,tot     fraction of the total (static + dynamic) pressure lost between the
 *                                      upstream point and the target (ion–neutral friction, charge exchange)
 *   f_cool = fraction of the parallel power lost in the recycling (convective) region next to the target
 *            by ionisation, charge exchange and hydrogenic radiation
 *
 * Both are fitted, as functions of T_t alone, by  1 − f = A (1 − exp(−T_t/w))^s  (T_t in eV): both
 * losses are negligible above T_t ≈ 10 eV, the momentum loss becomes strong below 5 eV and near
 * complete by 1 eV, the power loss follows at lower T_t. Stangeby's 2018 paper gives two
 * fit sets to SOLPS-type solutions; they are quoted here as printed by B. Zhu et al., "Data-driven model
 * for divertor plasma detachment prediction", J. Plasma Phys. (2022), arXiv:2206.09964, eqs. 6.1–6.4
 * (the coefficients are theirs to Stangeby's; the paper itself was not accessible to the author of this
 * file):
 *   fit 1:  1 − f_cool = [1 − exp(−T_t/2.4)]^1.9              1 − f_mom = [1 − exp(−T_t/0.8)]^2.1
 *   fit 2:  1 − f_cool = 0.9 [1 − exp(−T_t/6)]^1.7            1 − f_mom = 1.3 [1 − exp(−T_t/1.8)]^1.6
 * Zhu et al. find that fit 1 tracks 1D UEDGE solutions better; it is the default. The prefactor 1.3
 * of fit 2 makes 1 − f_mom exceed 1 at high T_t (a pressure gain): the factors are clipped to [0, 1].
 *
 * A third set is the fit of T. Body, A. Kallenbach and T. Eich, "A simple, accurate model for detachment
 * access", arXiv:2504.05486 (2025), Table 1, to the convective region of the 1D Kallenbach model
 * (1 % nitrogen, 1 MW/m² target heat flux): 1 − f_cool = 0.853 (1 − e^(−T_t/5.2))^0.964,
 * 1 − f_mom = 0.886 (1 − e^(−T_t/3.83))^0.828. It belongs to the convective region alone and is
 * offered for comparison.
 */

/** One fit curve: 1 − f = A (1 − exp(−T/w))^s */
export interface LossCurve { A: number; w: number; s: number }

export interface LossFit { name: string; mom: LossCurve; cool: LossCurve }

export const STANGEBY_FIT_1: LossFit = { name: 'stangeby1', mom: { A: 1, w: 0.8, s: 2.1 }, cool: { A: 1, w: 2.4, s: 1.9 } };
export const STANGEBY_FIT_2: LossFit = { name: 'stangeby2', mom: { A: 1.3, w: 1.8, s: 1.6 }, cool: { A: 0.9, w: 6, s: 1.7 } };
export const BODY_2025_FIT: LossFit = { name: 'body2025', mom: { A: 0.886, w: 3.83, s: 0.828 }, cool: { A: 0.853, w: 5.2, s: 0.964 } };

export type LossFitName = 'stangeby1' | 'stangeby2' | 'body2025';

const FITS: Record<LossFitName, LossFit> = { stangeby1: STANGEBY_FIT_1, stangeby2: STANGEBY_FIT_2, body2025: BODY_2025_FIT };

export function lossFit(name: LossFitName | undefined): LossFit {
  return (name && FITS[name]) || STANGEBY_FIT_1;
}

const clip01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 1 − f of a curve at T_t [eV] (unclipped) */
export function transmission(c: LossCurve, Tt_eV: number): number {
  if (!(Tt_eV > 0)) return 0;
  return c.A * Math.pow(1 - Math.exp(-Tt_eV / c.w), c.s);
}

/** Momentum loss factor f_mom(T_t) ∈ [0, 1] */
export function momentumLoss(Tt_eV: number, fit: LossFit = STANGEBY_FIT_1): number {
  return clip01(1 - transmission(fit.mom, Tt_eV));
}

/** Power loss factor of the recycling region f_cool(T_t) ∈ [0, 1] */
export function coolingLoss(Tt_eV: number, fit: LossFit = STANGEBY_FIT_1): number {
  return clip01(1 - transmission(fit.cool, Tt_eV));
}

/**
 * Total power loss factor f_pwr = 1 − P_t / P_leg of the loss chain of one divertor leg: the fraction
 * f_rad of the power is radiated upstream of the recycling region (impurity or divertor radiation),
 * then the fraction f_cool of the rest is lost in it. The heat-flux density of the peak flux tube at the
 * target is q_t = (1 − f_pwr) q_u / b: the target flux tube is b = λ_int/λ_q times wider than the
 * upstream one (the divertor spreading dilutes the density of the power, it does not remove any).
 */
export function powerLoss(fRad: number, fCool: number): number {
  return 1 - (1 - fRad) * (1 - fCool);
}
