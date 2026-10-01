/**
 * The mixed Bohm/gyro-Bohm heat transport model of Erba et al.: a Bohm term with a non-local dependence on the edge temperature
 * gradient plus a gyro-Bohm term, with the coefficients that the JET (Bohm) and START/Tore Supra/ITER-database (gyro-Bohm) validation
 * fixed. Sources: M. Erba, A. Cherubini, V.V. Parail, E. Springmann and A. Taroni, "Development of a non-local model for tokamak heat
 * transport in L-mode, H-mode and transient regimes", Plasma Phys. Control. Fusion 39 (1997) 261 (the non-local Bohm term, from the
 * earlier Bohm-type model of Taroni et al., Plasma Phys. Control. Fusion 36 (1994) 1629); and M. Erba, T. Aniel, V. Basiuk, A. Becoulet
 * and X. Litaudon, "Validation of a new mixed Bohm/gyro-Bohm model for electron and ion heat transport against the ITER, Tore Supra and
 * START database discharges", Nucl. Fusion 38 (1998) 1013 (the gyro-Bohm term and the final coefficients); the form below is the one of
 * the National Transport Code Collaboration module of the JETTO model (https://w3.pppl.gov/ntcc/JETTO/mixed_Bohm_gyro_Bohm/).
 *
 *   χ_e = α_Be χ_B + α_gBe χ_gB,   χ_i = α_Bi χ_B + α_gBi χ_gB
 *   χ_B  = (T_e/(e B)) (a |∇p_e|/p_e) q² Λ,                Λ = [T_e(x = 0.8) − T_e(x = 1)] / T_e(x = 1)       (Bohm, non-local)
 *   χ_gB = (T_e/(e B)) (a |∇T_e|/T_e) ρ*,                  ρ* = m_i^1/2 T_e^1/2 / (Z_i e B_t a)                 (gyro-Bohm)
 *   α_Be = 8·10⁻⁵,  α_Bi = 2 α_Be,  α_gBe = 3.5·10⁻²,  α_gBi = α_gBe/2
 *
 * (T_e/(eB) is the Bohm diffusivity: T_e in eV over B in T gives m²/s.) The Bohm term is linear in the gyro-radius and non-local (the
 * transport everywhere depends on the temperature drop over the outer fifth of the radius, which the JET non-stationary experiments
 * — ELMs, cold pulses, sawteeth, the L–H transition — asked for); it carries the JET results. The gyro-Bohm term is local and quadratic
 * in the gyro-radius: it is negligible in JET and TFTR and matters in small machines with a large ρ*, near the centre. The particle
 * diffusivity of the original (D = α_d χ_e χ_i/(χ_e + χ_i)) is not used: the 1.5D model has its own D/χ_e (transport/coefficients.ts).
 */

/** The coefficients of the model (Erba et al. 1998): Bohm and gyro-Bohm, electrons and ions */
export const BGB = {
  alphaBe: 8e-5,
  alphaBi: 1.6e-4,
  alphaGBe: 3.5e-2,
  alphaGBi: 1.75e-2,
  /** the inner radius x = r/a of the non-local temperature drop; the outer one is the edge (x = 1, or the top of the pedestal in H-mode) */
  xInner: 0.8,
} as const;

/** Local quantities of the model on one face */
export interface BgbInputs {
  /** T_e [keV] */
  TeKeV: number;
  /** toroidal field [T] and minor radius [m] */
  B: number; a: number;
  /** a |∇p_e|/p_e and a |∇T_e|/T_e (dimensionless, any sign is taken absolute) */
  invLp: number; invLT: number;
  /** safety factor */
  q: number;
  /** the non-local edge factor Λ = (T_e(0.8) − T_e(edge))/T_e(edge), at least 0 */
  lambda: number;
  /** ρ* = ρ_s/a with ρ_s = m_i^1/2 T_e^1/2/(Z_i e B_t) */
  rhoStar: number;
}

/** Bohm diffusivity T_e/(e B) [m²/s] for T_e in keV and B in T */
export function bohmDiffusivity(TeKeV: number, B: number): number {
  return (1e3 * TeKeV) / B;
}

/** ρ* = ρ_s/a of a hydrogenic plasma of mass m_i [kg] and charge Z_i: √(m_i T_e)/(Z_i e B a) with T_e in J */
export function rhoStar(TeJ: number, mi: number, B: number, a: number, Zi = 1): number {
  return Math.sqrt(mi * TeJ) / (Zi * 1.602176634e-19 * B * a);
}

/** The two terms and the totals of the model on one face [m²/s] */
export interface BgbResult { bohm: number; gyroBohm: number; chiE: number; chiI: number }

/** χ_e, χ_i of the mixed Bohm/gyro-Bohm model for the local quantities x; `bohm` and `gyroBohm` are χ_B and χ_gB before the coefficients */
export function bgbChi(x: BgbInputs): BgbResult {
  const chi0 = bohmDiffusivity(x.TeKeV, x.B);
  const bohm = chi0 * Math.abs(x.invLp) * x.q * x.q * Math.max(x.lambda, 0);
  const gyroBohm = chi0 * Math.abs(x.invLT) * x.rhoStar;
  return {
    bohm, gyroBohm,
    chiE: BGB.alphaBe * bohm + BGB.alphaGBe * gyroBohm,
    chiI: BGB.alphaBi * bohm + BGB.alphaGBi * gyroBohm,
  };
}

/** The non-local factor Λ = (T_e(0.8) − T_e(edge))/T_e(edge) from the two temperatures [keV] (0 when the drop is negative; the edge is floored at 20 eV) */
export function nonLocalFactor(TeInner: number, TeEdge: number): number {
  const edge = Math.max(TeEdge, 0.02);
  return Math.max(TeInner - edge, 0) / edge;
}
