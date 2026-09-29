/**
 * Type-I ELM energy loss from the pedestal collisionality (Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549).
 *
 * The paper correlates the plasma energy an ELM takes out of the main plasma, normalised to the pedestal energy
 *
 *     W_ped = (3/2) n_e,ped (T_e,ped + T_i,ped) V_plasma                                   (Loarte 2003, section 3)
 *
 * (the pedestal-top values taken over the whole plasma volume, not the energy of the pedestal region), with the collisionality of the
 * pedestal top ν*_ped(neo) = R q95 ε^{-3/2} / λ_e,e, λ_e,e the electron–electron Coulomb mean free path (their Fig. 11; JET, ASDEX
 * Upgrade, DIII-D and JT-60U, ν*_ped from 0.03 to 11): ΔW_ELM/W_ped decreases with ν*_ped. The paper gives the correlation as data
 * and no formula (only the ITER value: ν*_ped = 0.062, W_ped = 112 MJ, ΔW_ELM = 22 MJ, i.e. 0.196, and 0.04 to 0.1 for the
 * "minimum" type-I ELMs, whose loss is all particles). The power law below is a least-squares fit in log–log space to the 84 markers of
 * their Fig. 11, read from the vector graphics of the preprint (EFDA-JET-PR(03)32, axes calibrated on the tick marks):
 *
 *     ΔW_ELM/W_ped = 0.0642 ν*_ped^{-0.388},    valid for ν*_ped in [0.034, 11.4],    rms scatter of ln(ΔW/W_ped) 0.40
 *
 * It gives 0.189 at the ITER value 0.062 (paper: 0.196, −4 %) and is clamped at the ends of the plotted range (0.234 at 0.034,
 * 0.025 at 11.4; the plotted values run from 0.014 to 0.20). The paper itself calls the correlation an empirical law with no physics
 * model behind it, and a later multi-machine study of large type-I ELMs finds no clear trend of ΔE_ELM/W_plasma with ν*_e,neo (linear
 * and power-law fits with R² of 0.02 and 0.05; Perillo et al., arXiv:2608.21179, 2026): it orders the ELM size, it does not predict it.
 */

/** The fit to Fig. 11 of Loarte et al. (2003) */
export const LOARTE_FIT = { coefficient: 0.0642, exponent: -0.388, nuMin: 0.034, nuMax: 11.4, scatterLn: 0.4, samples: 84 } as const;

/** The ITER extrapolation of the paper, for reference: ν*_ped, W_ped [J], ΔW_ELM [J] */
export const LOARTE_ITER = { nuStar: 0.062, Wped: 112e6, dWelm: 22e6 } as const;

/** ln Λ_e = 31.3 − ln(√n_e / T_e), n_e [m⁻³], T_e [eV] (Sauter et al., Phys. Plasmas 6 (1999) 2834, eq. 18d) */
export function coulombLogarithm(ne: number, TeKeV: number): number {
  return 31.3 - Math.log(Math.sqrt(Math.max(ne, 1)) / Math.max(TeKeV * 1e3, 1));
}

/**
 * Electron collisionality of the pedestal top ν*_ped = R q95 ε^{-3/2}/λ_e,e with λ_e,e = T_e²/(6.921·10⁻¹⁸ n_e ln Λ_e) [m], the form
 * of Sauter et al. (Phys. Plasmas 6 (1999) 2834, eq. 18b) with Z_eff = 1 (an electron–electron mean free path); n_e [m⁻³], T_e [keV].
 */
export function pedestalCollisionality(ne: number, TeKeV: number, R: number, a: number, q95: number): number {
  const eps = Math.max(a / R, 1e-3);
  const Te = Math.max(TeKeV * 1e3, 1);
  return (6.921e-18 * q95 * R * ne * coulombLogarithm(ne, TeKeV)) / (Math.pow(eps, 1.5) * Te * Te);
}

/** ΔW_ELM/W_ped of the fit at ν*_ped (held at the ends of the plotted range) */
export function loarteEnergyFraction(nuStar: number): number {
  const nu = Math.min(LOARTE_FIT.nuMax, Math.max(LOARTE_FIT.nuMin, Number.isFinite(nuStar) ? nuStar : LOARTE_FIT.nuMin));
  return LOARTE_FIT.coefficient * Math.pow(nu, LOARTE_FIT.exponent);
}
