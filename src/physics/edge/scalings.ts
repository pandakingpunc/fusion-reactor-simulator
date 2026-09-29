/**
 * Scalings of the divertor heat-flux width: the near-SOL power decay length λ_q, the divertor
 * spreading S and the integral width λ_int of the target profile.
 *
 * Pure functions of SI/mm inputs, shared by the 0D model, the 1.5D boundary and POPCON.
 */

/**
 * Multi-machine H-mode regression #14 of T. Eich et al., "Scaling of the tokamak near the
 * scrape-off layer H-mode power width and implications for ITER", Nucl. Fusion 53 (2013) 093031:
 *   λ_q [mm] = 0.63 (± 0.08) · B_pol,MP [T]^(−1.19 (± 0.08)),
 * B_pol,MP the poloidal field at the outer midplane (here: the mean poloidal field μ0 I_p / L_pol of
 * the last closed flux surface, the definition of geometry.poloidalField). λ_q is the power decay
 * length mapped to the outer midplane (ELM-averaged H-mode, attached divertor).
 */
export const EICH14_COEFFICIENT_MM = 0.63;
export const EICH14_EXPONENT = -1.19;
/** B_pol below which the regression is not evaluated [T] (start-up, I_p → 0) */
export const B_POL_FLOOR = 0.05;

export function eichLambdaQ_mm(Bpol_T: number): number {
  return EICH14_COEFFICIENT_MM * Math.pow(Math.max(Bpol_T, B_POL_FLOOR), EICH14_EXPONENT);
}

/**
 * Integral width of the Eich profile: the heat-flux profile on the target is a Gaussian of width S
 * (the divertor spreading, mapped to the midplane) convolved with an exponential of decay length λ_q;
 * its integral over the peak value is λ_int = λ_q + 1.64 S
 * (T. Eich et al., Nucl. Fusion 53 (2013) 093031; M. A. Makowski et al., "Analysis of a multi-machine
 * database on divertor heat fluxes", Phys. Plasmas 19 (2012) 056122).
 */
export const INTEGRAL_WIDTH_FACTOR = 1.64;

export function integralWidth_mm(lambdaQ_mm: number, S_mm: number): number {
  return lambdaQ_mm + INTEGRAL_WIDTH_FACTOR * Math.max(S_mm, 0);
}

/**
 * Divertor broadening factor b = λ_int / λ_q: the factor by which the parallel heat-flux density of
 * the peak flux tube drops below the X-point when cross-field transport spreads the power over
 * λ_int (Kallenbach et al., Plasma Phys. Control. Fusion 58 (2016) 045013 use b = 3, i.e. S = 1.22 λ_q).
 */
export function broadeningFactor(lambdaQ_mm: number, S_mm: number): number {
  return integralWidth_mm(lambdaQ_mm, S_mm) / lambdaQ_mm;
}
