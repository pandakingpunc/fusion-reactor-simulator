/**
 * EPED1-type pedestal: the two constraints on the pedestal width Δ (full width in normalised poloidal flux ψ_N) and the
 * pedestal-top pressure p_ped, as pure functions of the poloidal beta β_p,ped = 2 μ0 p_ped / B̄_p². Free of the 1.5D context: the
 * model that applies them to a shot is `PedestalModel` (PedestalModel.ts).
 *
 * KBM width constraint (Snyder et al., Phys. Plasmas 16 (2009) 056118; Snyder et al., Nucl. Fusion 51 (2011) 103016; the form as
 * tested against DIII-D in Groebner et al., 22nd IAEA Fusion Energy Conference, Geneva 2008, EX/P3-5, GA-A26243):
 *
 *     Δ = 0.076 β_p,ped^{1/2}                                                  (KBM, "EPED1")
 *
 * with β_p,ped = 2 μ0 p_ped / B̄_p² built from the total pedestal pressure p_ped = 2 n_ped T_ped (the pedestal ions have the
 * electron temperature and density) and B̄_p, the flux-surface average poloidal field at the separatrix, B̄_p = μ0 I_p / L with
 * L the length of the poloidal cross-section of the last closed flux surface. Δ is the average of the full widths of the density
 * and the temperature pedestal (twice the parameter of the modified-tanh fit), in ψ_N. The coefficient 0.076 was fitted to the DIII-D
 * data (Snyder 2009); EPED1.6 finds Δ = G(ν*, ε) β_p,ped^{1/2} with G between 0.07 and 0.1 for AUG, JET and DIII-D (Beurskens et al.,
 * Phys. Plasmas 18 (2011) 056120, quoting Snyder). Validity: type-I ELMing H-mode, β_p,ped 0.2 to 1.4 (the DIII-D scan of the test).
 *
 * Peeling–ballooning height constraint. EPED1 obtains it from ELITE stability calculations of model equilibria (Snyder 2009, 2011):
 * there is no closed-form fit in the cited papers, only the statement that at fixed width the critical pedestal pressure rises
 * roughly as Δ^{3/4} (Snyder et al., invited talk, 53rd APS-DPP meeting, Chicago 2010; the KBM curve rises as Δ²). This module therefore uses a reduced
 * form that is anchored to published data and says so:
 *
 *     β_PB(Δ) = β_ref (Δ/Δ_ref)^{3/4},     β_ref = (0.076 C)²,   Δ_ref = 0.076² C,
 *
 * where C = dβ_p/dψ_N is the maximum normalised pedestal pressure gradient at the onset of the ELM (the P–B limit at the
 * operating width), dimensionless. C comes from the one published parametric fit of that limit, the DIII-D EPED1 test of Groebner et al.
 * (GA-A26243, Fig. 3): (∇p)_max = 103 (I_p B_T)^0.94 kPa per unit ψ_N, I_p in MA, B_T in T, over I_p B_T = 0.3 to 3.3 MA T (I_p 0.5 to 1.5 MA,
 * B_T 0.7 to 2.1 T, triangularity 0.2 to 0.55, β_N ≈ 2, n_ped/n_G 0.4 to 0.6, type-I ELMing H-mode), evaluated at the top of that range,
 * where the ITER-shaped demonstration discharges lie (PB_GRADIENT below; those discharges themselves lie 10 to 20 % above the fit, which
 * would raise C by that much and the pedestal pressure by twice as much). The pair (Δ_ref, β_ref) lies on the KBM curve, so for a given C the two
 * constraints intersect there for every machine of the same shape family: p_ped = β_ref B̄_p²/(2 μ0) ∝ I_p²/L², Δ = Δ_ref: the content of the
 * EPED1 prediction that this reduced model keeps. ITER 15 MA (L = 18.4 m): Δ = 0.036, β_p,ped = 0.223, p_ped = 93 kPa; the EPED1.6 baseline
 * of Snyder et al. (Nucl. Fusion 51 (2011) 103016; talk at the 2011 Pedestal and ELM workshop) is Δ ≈ 0.04 (4.4 cm), β_N,ped ≈ 0.6 (p_ped ≈ 95 kPa,
 * T_ped ≈ 4.5 keV) at n_ped = 7·10¹⁹ m⁻³ and global β_N = 1.7, and β_N,top ≈ 0.74 one half-width further in.
 *
 * Density. The height of the ELITE constraint rises with the pedestal density (a weaker peeling drive): the EPED1.6 scan for ITER of the same talk
 * gives β_N,ped = 0.581, 0.643, 0.678, 0.781 at n_ped = 6.97, 8.13, 9.05, 11.03·10¹⁹ m⁻³ (global β_N = 1.7; read from the vector graphics of the
 * slide), a power law n_ped^0.64 (0.71 for the value one half-width further in; the higher curves of β_N = 2.5, the larger Shafranov shift, are not modelled). The
 * intersection of the two curves is taken to scale so with n̂ = n_ped/n_G (Greenwald density), relative to n̂ = 0.5, the middle of the range of the DIII-D
 * dataset that fixes C (ASSUMPTION: the ITER scan is in absolute density and one machine; normalising by n_G is this reduction's choice):
 *
 *     β_p,ped = β_ref (n̂/0.5)^{0.64},     the P–B curve scaling as (n̂/0.5)^{0.64 (1 − 3/8)} so that the intersection does.
 *
 * ITER at the density of the EPED baseline (n̂ = 0.59) then gives β_p,ped = 0.248, p_ped = 103 kPa, 8 % above the published 95 kPa. Not kept: the
 * dependence on the global β_N and on the shape (open).
 */

/** μ0 [H/m] (the constant of the 1.5D model) */
export const MU0 = 1.25663706212e-6;

/** KBM coefficient of Δ = c β_p,ped^{1/2} [Snyder 2009] */
export const KBM_COEFFICIENT = 0.076;

/** Exponent of the width in the peeling–ballooning height, p_ped ∝ Δ^ζ (roughly 3/4, Snyder 2011; the KBM curve has 2) */
export const PB_EXPONENT = 0.75;

/** Exponent of n̂ = n_ped/n_G in the pedestal poloidal beta of the intersection (EPED1.6 for ITER, Snyder 2011 talk: β_N,ped ∝ n_ped^0.64) and the n̂ it is 1 at */
export const PB_DENSITY_EXPONENT = 0.64;
export const PB_DENSITY_REF = 0.5;

/**
 * The DIII-D fit of the maximum pedestal pressure gradient before an ELM (Groebner et al., GA-A26243, Fig. 3): (∇p)_max = 103 (I_p B_T)^0.94
 * kPa per unit ψ_N, valid for I_p B_T = 0.3 to 3.3 MA T; `IpBT` is the point it is evaluated at for C (the top of the range, I_p = 1.5 MA, the
 * ITER-shaped demonstration discharges: the fit gives 307 kPa/ψ_N there). L: the poloidal perimeter of the LCFS of a plasma of that shape and
 * minor radius 0.58 m, 1.467 · 2π a (the ratio of the ITER equilibrium of this code, 18.43 m for a = 2 m, κ = 1.85, δ = 0.49); the perimeter is an
 * estimate of this reduction, the shape of those discharges is not in the report (C scales with L², so ±5 % in L is ±10 % in C).
 */
export const DIIID_PB_FIT = { coefficient: 103e3, exponent: 0.94, IpBTRange: [0.3, 3.3], IpBT: 3.2, Ip: 1.5e6, a: 0.58, perimeterPerCircumference: 1.467 } as const;

/** dβ_p/dψ_N = (dp/dψ_N)/(B̄_p²/2 μ0) for a gradient dp/dψ_N [Pa per unit ψ_N] at the current I_p [A] and the perimeter L [m] of the LCFS */
export function normalisedGradient(gradP: number, Ip: number, perimeter: number): number {
  return (2 * gradP * perimeter * perimeter) / (MU0 * Ip * Ip);
}

/** C: the maximum normalised pedestal gradient at the ELM onset of the DIII-D fit at its ITER-shaped reference point, 6.2 */
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
