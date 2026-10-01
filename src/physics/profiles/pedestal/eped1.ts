/**
 * EPED1-type pedestal: the two constraints on the pedestal width Δ (full width in normalised poloidal flux ψ_N) and the
 * pedestal-top pressure p_ped, as pure functions of the poloidal beta β_p,ped = 2 μ0 p_ped / B̄_p². Free of the 1.5D context: the
 * model that applies them to a shot is `PedestalModel` (PedestalModel.ts).
 *
 * KBM width constraint (Snyder et al., Phys. Plasmas 16 (2009) 056118; Snyder et al., Nucl. Fusion 51 (2011) 103016). EPED1 takes the width from
 * the empirical DIII-D scaling of Groebner et al. (General Atomics report GA-A26243, 22nd IAEA Fusion Energy Conference, Geneva 2008, EX/P3-5):
 *
 *     Δ = 0.076 β_p,ped^{1/2}                                                  (KBM, "EPED1")
 *
 * where β_p,ped = 2 μ0 p_ped / B̄_p² with the TOTAL pedestal pressure p_ped (taken as 2 n_e,ped T_e,ped there: T_i = T_e, n_i = n_e) and B̄_p the
 * flux-surface average poloidal field at the separatrix, B̄_p = μ0 I_p / L with L the length of the poloidal cross-section of the last closed
 * flux surface; Δ is the average of the full widths of the density and the temperature pedestal (twice the parameter of the modified-tanh fit). Data:
 * type-I ELMing DIII-D discharges over a wide range of I_p, B_T and heating power, including ITER-shape demonstration discharges, from the last 80 % of
 * the ELM cycle. EPED1.6 keeps the form and calculates the coefficient, Δ = β_p,ped^{1/2} G(ν*, ε, ...) (Snyder, 53rd APS-DPP, Chicago 2010).
 *
 * Peeling–ballooning height constraint. EPED obtains it from ELITE stability calculations of model equilibria: there is no closed-form fit in
 * the cited papers, only two published statements about its dependences: at fixed width it rises roughly linearly with I_p B_T
 * (Groebner, GA-A26243, section 2, quoting Snyder 2009) and, at fixed I_p B_T, roughly as Δ^{3/4} (β_N,ped ~ Δ_ψ^{3/4}; the KBM curve rises as Δ²;
 * Snyder, APS-DPP 2010, slides "The Peeling-Ballooning Model Explains ELM Onset" and "Mechanics of the EPED Predictive Model"). This module uses a
 * reduced form that is anchored to published data and says so:
 *
 *     β_PB(Δ) = β_ref (Δ/Δ_ref)^{3/4},     β_ref = (0.076 C)²,   Δ_ref = 0.076² C,
 *
 * where C = dβ_p/dψ_N = 2 μ0 (∇p)_max / B̄_p² is the normalised maximum pressure gradient before an ELM (for a tanh pedestal the maximum gradient is
 * p_ped/Δ, so it is the P–B limit at the operating width). C comes from the published parametric fit of that gradient, Groebner et al. (GA-A26243, Fig. 3;
 * the data of the EPED1 test of the same report):
 *
 *     (∇p)_max = 103 (I_p B_T)^0.94   [kPa per unit ψ_N, I_p in MA, B_T in T]
 *
 * over I_p B_T ≈ 0.4 to 3.1 MA T (a factor of 3 in B_T, I_p and in average triangularity; n_e,ped/n_G = 0.4 to 0.6, β_N ≈ 2, type-I ELMing), evaluated at
 * the top of that range, I_p B_T = 3.2 MA T, where the ITER-shape demonstration discharges lie (the fit gives 307 kPa/ψ_N; those discharges lie 10 to 20 % above it,
 * which would raise C by that much and the pedestal pressure by twice as much). The pair (Δ_ref, β_ref) lies on the KBM curve, so the two constraints intersect there:
 * a similarity closure, P–B height in β_N-like units and KBM width in β_p coincide for machines of the shape and safety factor of that reference (the ITER
 * demonstration discharges were run to match the ITER shape, q95 and β_N), so p_ped = β_ref B̄_p²/(2 μ0) ∝ I_p²/L² and Δ = Δ_ref (ASSUMPTION: shape and q95 of
 * the reference; the P–B dependence on them is not modelled). It was not fitted to any ITER prediction; for ITER at 15 MA (L = 18.4 m) it gives
 * Δ = 0.036, β_p,ped = 0.223, p_ped = 93 kPa, against 92 kPa (Snyder 2009, quoted by Saarelma et al., Nucl. Fusion 52 (2012) 103020, who find 107 to
 * 110 kPa with their own stability analysis) and β_N,ped = 0.6 to 0.7, Δ_ψ ≈ 0.04, i.e. 95 to 111 kPa (Snyder, APS-DPP 2010, summary slide).
 *
 * Density. The EPED height rises with the pedestal density (a weaker peeling drive at lower ν*). The published EPED prediction for the ITER baseline
 * (Snyder, ITER International School, December 2015, slide "Predicted Super H-Mode Regime Should Enable further ITER Optimization", the H-mode branch) is
 * p_ped = 64, 74, 81, 89, 100, 105 kPa at n_ped Z_eff^{1/2} = 4, 5.7, 7.1, 11.3, 14.1, 15.6·10¹⁹ m⁻³ (read from the vector graphics of the slide; `EPED_ITER_2015` in
 * the tests), a power law p_ped ∝ n_ped^0.34 (least squares over 4 to 15.6, rms scatter of ln p 2 %). The intersection of the two curves is taken to scale so with
 * n̂ = n_ped/n_G (Greenwald density), relative to n̂ = 0.5, the middle of the range of the DIII-D dataset that fixes C (ASSUMPTIONS: the published scan is in
 * absolute density and Z_eff^{1/2} n_ped for one machine, and normalising by n_G, dropping Z_eff, is this reduction's choice):
 *
 *     β_p,ped = β_ref (n̂/0.5)^{0.34},     the P–B curve scaling as (n̂/0.5)^{0.34 (1 − 3/8)} so that the intersection does.
 *
 * ITER at n_ped = 7·10¹⁹ m⁻³ (n̂ = 0.59) then gives β_p,ped = 0.236, p_ped = 98 kPa. Not kept: the dependence on the global β_N (the Shafranov shift of higher
 * β_N raises the EPED height), on the shape and on ν* beyond the density.
 */

/** μ0 [H/m] (the constant of the 1.5D model) */
export const MU0 = 1.25663706212e-6;

/** KBM coefficient of Δ = c β_p,ped^{1/2} [Snyder 2009] */
export const KBM_COEFFICIENT = 0.076;

/** Exponent of the width in the peeling–ballooning height, p_ped ∝ Δ^ζ (roughly 3/4, Snyder 2011; the KBM curve has 2) */
export const PB_EXPONENT = 0.75;

/** Exponent of n̂ = n_ped/n_G in the pedestal poloidal beta of the intersection (least-squares power law through the EPED prediction for the ITER baseline, Snyder 2015) and the n̂ it is 1 at */
export const PB_DENSITY_EXPONENT = 0.34;
export const PB_DENSITY_REF = 0.5;

/**
 * The DIII-D fit of the maximum pedestal pressure gradient before an ELM (Groebner et al., GA-A26243, Fig. 3): (∇p)_max = 103 (I_p B_T)^0.94
 * kPa per unit ψ_N, from data over I_p B_T ≈ 0.4 to 3.1 MA T; `IpBT` is the point it is evaluated at for C (the top of the range, I_p = 1.5 MA, the
 * ITER-shaped demonstration discharges: the fit gives 307 kPa/ψ_N there). L: the poloidal perimeter of the LCFS of a plasma of that shape and
 * minor radius 0.58 m, 1.467 · 2π a (the ratio of the ITER equilibrium of this code, 18.43 m for a = 2 m, κ = 1.85, δ = 0.49); the perimeter is an
 * estimate of this reduction, the shape of those discharges is not in the report (C scales with L², so ±5 % in L is ±10 % in C).
 */
export const DIIID_PB_FIT = { coefficient: 103e3, exponent: 0.94, IpBTRange: [0.4, 3.1], IpBT: 3.2, Ip: 1.5e6, a: 0.58, perimeterPerCircumference: 1.467 } as const;

/** dβ_p/dψ_N = (dp/dψ_N)/(B̄_p²/2 μ0) for a gradient dp/dψ_N [Pa per unit ψ_N] at the current I_p [A] and the perimeter L [m] of the LCFS */
export function normalisedGradient(gradP: number, Ip: number, perimeter: number): number {
  return (2 * gradP * perimeter * perimeter) / (MU0 * Ip * Ip);
}

/** C: the maximum normalised pedestal gradient at the ELM onset of the DIII-D fit at its ITER-shaped reference point, 6.21 */
export const PB_GRADIENT = normalisedGradient(
  DIIID_PB_FIT.coefficient * Math.pow(DIIID_PB_FIT.IpBT, DIIID_PB_FIT.exponent), DIIID_PB_FIT.Ip, DIIID_PB_FIT.perimeterPerCircumference * 2 * Math.PI * DIIID_PB_FIT.a,
);

/**
 * The width in ρ̂ that the radial grid is packed for with the EPED1-type pedestal (ProfileSettings.pedestalModel 'eped1'; geometry1d.gridSpec): the KBM width at the
 * DIII-D reference, Δψ_N = 0.036, is 0.045 in ρ̂ on the ITER, DEMO and SPARC equilibria (0.046 to 0.050 with the density dependence). The packed grid needs the width
 * before the first equilibrium exists, so it cannot follow the width of the shot; `pedestalWidth` (0.06) is that of the fixed pedestal.
 */
export const PEDESTAL_GRID_WIDTH = 0.045;

/** B̄_p = μ0 I_p / L [T] */
export function poloidalField(Ip: number, perimeter: number): number { return (MU0 * Ip) / perimeter; }

/** β_p,ped = 2 μ0 p / B̄_p² */
export function poloidalBeta(p: number, Bp: number): number { return (2 * MU0 * p) / (Bp * Bp); }

/** p = β_p B̄_p²/(2 μ0) [Pa] */
export function pressureOfBeta(betaP: number, Bp: number): number { return (betaP * Bp * Bp) / (2 * MU0); }

/** The KBM width Δ = c β_p^{1/2} in ψ_N */
export function kbmWidth(betaP: number, coefficient: number = KBM_COEFFICIENT): number { return coefficient * Math.sqrt(Math.max(betaP, 0)); }

export interface Eped1Options {
  /** C: the normalised P–B pressure gradient; default PB_GRADIENT */
  pbGradient?: number;
  /** the KBM coefficient; default 0.076 */
  kbmCoefficient?: number;
  /** ζ of the P–B curve; default 3/4 */
  pbExponent?: number;
  /** exponent of n̂/n̂_ref in the intersection β_p,ped; default PB_DENSITY_EXPONENT (0: no density dependence) */
  densityExponent?: number;
}

export interface Eped1Solution {
  /** the pedestal poloidal beta and full width (ψ_N) at the intersection of the two curves */
  betaP: number;
  width: number;
  /** iterations of the fixed point and whether it converged (|ΔΔ| ≤ 1e-13 within 200 iterations) */
  iterations: number;
  converged: boolean;
  /** the anchor of the P–B curve (β_ref, Δ_ref) */
  betaRef: number;
  widthRef: number;
}

/**
 * The peeling–ballooning height at the width Δ [β_p]: β_ref (nRatio^{γ (1 − ζ/2)}) (Δ/Δ_ref)^ζ, on the curve anchored at the point of the KBM line with gradient C,
 * lifted with the pedestal density (nRatio = n̂/n̂_ref, γ the density exponent of the intersection)
 */
export function pbBeta(width: number, o: Eped1Options = {}, nRatio = 1): number {
  const c = o.kbmCoefficient ?? KBM_COEFFICIENT, C = o.pbGradient ?? PB_GRADIENT, zeta = o.pbExponent ?? PB_EXPONENT;
  const gamma = o.densityExponent ?? PB_DENSITY_EXPONENT;
  const betaRef = (c * C) ** 2, widthRef = c * c * C;
  const lift = Math.pow(Math.max(nRatio, 1e-3), gamma * (1 - 0.5 * zeta));
  return betaRef * lift * Math.pow(Math.max(width, 0) / widthRef, zeta);
}

/**
 * The self-consistent pedestal (Δ, β_p,ped) at the pedestal density nRatio = n̂/n̂_ref: the fixed point of Δ → c β_PB(Δ)^{1/2}, where the KBM width and the
 * P–B height meet. The map has slope ζ/2 < 1 for ζ < 2, so the iteration converges from any start; the fixed point is β_ref nRatio^γ (Δ from the KBM line).
 */
export function solveEped1(o: Eped1Options = {}, nRatio = 1): Eped1Solution {
  const c = o.kbmCoefficient ?? KBM_COEFFICIENT, C = o.pbGradient ?? PB_GRADIENT;
  if (!(c > 0) || !(C > 0)) throw new RangeError(`solveEped1: the KBM coefficient and the P–B gradient must be positive (got ${c}, ${C})`);
  let width = 0.05, iterations = 0, converged = false;
  for (; iterations < 200; iterations++) {
    const next = kbmWidth(pbBeta(width, o, nRatio), c);
    const done = Math.abs(next - width) <= 1e-13;
    width = next;
    if (done) { converged = true; iterations++; break; }
  }
  return { betaP: pbBeta(width, o, nRatio), width, iterations, converged, betaRef: (c * C) ** 2, widthRef: c * c * C };
}

/**
 * ρ̂ = √(Φ/Φ_b) at the normalised poloidal flux ψ_N of a table (`psiN` increasing from 0 on the axis to 1, `rhoTor` the ρ̂ of its
 * nodes), linear between the nodes; the ends outside them.
 */
export function rhoOfPsiN(psiN: ArrayLike<number>, rhoTor: ArrayLike<number>, x: number): number {
  const n = psiN.length;
  if (n === 0) return NaN;
  if (x <= psiN[0]) return rhoTor[0];
  if (x >= psiN[n - 1]) return rhoTor[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (psiN[mid] <= x) lo = mid; else hi = mid; }
  const t = (x - psiN[lo]) / (psiN[hi] - psiN[lo]);
  return rhoTor[lo] + t * (rhoTor[hi] - rhoTor[lo]);
}

/** The full pedestal width Δψ_N in ρ̂: 1 − ρ̂(1 − Δψ_N), limited to [0.005, 0.25] (the barrier must be resolved and stay in the outer quarter) */
export function widthInRho(psiN: ArrayLike<number>, rhoTor: ArrayLike<number>, widthPsi: number): number {
  const w = 1 - rhoOfPsiN(psiN, rhoTor, 1 - widthPsi);
  return Math.min(0.25, Math.max(0.005, Number.isFinite(w) ? w : widthPsi));
}
