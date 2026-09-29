/**
 * Steady slowing-down distribution of fast ions from a monoenergetic source (Stix, Plasma Phys. 14 (1972) 367; the pitch-angle
 * dependence of Gaffey, J. Plasma Phys. 16 (1976) 149), the moments the 1.5D fast-ion module is built on, and the closed
 * forms they reduce to.
 *
 * A fast ion of speed v slows down on the electrons and the ions of the plasma as
 *
 *   dv/dt = −(v/τ_s) (1 + v_c³/v³),   τ_s = τ_se the electron slowing-down time (heating.ts spitzerSlowingDownTime),
 *
 * where v_c (E_c = m_f v_c²/2, heating.ts criticalEnergy) is the speed at which the drag on the electrons and on the ions is equal.
 * A source S [m⁻³ s⁻¹] at the birth speed v_b in a plasma at rest gives the steady state
 *
 *   f(v) = S τ_s / (4π (v³ + v_c³)),   v ≤ v_b        (isotropic part)
 *
 * and with the scattering of the pitch ξ = v_∥/v on the plasma ions (Gaffey; Cordey, Nucl. Fusion 16 (1976) 499)
 *
 *   f(v, ξ) = S τ_s / (2π (v³ + v_c³)) Σ_l (2l + 1)/2 P_l(ξ) P_l(ξ_b) [ v³ (v_b³ + v_c³) / (v_b³ (v³ + v_c³)) ]^{l(l+1) Ẑ/6},
 *
 * Ẑ = ν_d^ions τ_s (v/v_c)³ = (Σ_j n_j Z_j²) / (A_f Σ_j n_j Z_j²/A_j) = Z_eff / (A_f × ionSum) (pitchScatteringZhat): the pitch-angle
 * scattering rate on the ions (Rutherford, ∝ n_j Z_j² / m_f² v³, independent of the mass of the target) over the ion energy drag (∝ n_j Z_j² /
 * (m_f m_j v³), which defines v_c). One species of mass A_j: Ẑ = A_j/A_f (a deuteron beam into deuterium 1; heavier targets scatter more per
 * unit of drag). The moments the model uses, all in closed form except the current integral:
 *
 *   density        n_f = ∫ f d³v = S τ_s/3 · ln(1 + (E_0/E_c)^{3/2})      (= S τ_th, heating.ts slowingDownTime)
 *   energy         W   = ∫ (m v²/2) f d³v = S E_0 τ_W,  τ_W = (τ_s/2) (1 − G(E_0/E_c))   (heating.ts fastIonEnergyTime)
 *   ion heating    P_i = S E_0 G(E_0/E_c),  electron heating P_e = S E_0 (1 − G),   G(x) = (1/x) ∫_0^x dy/(1 + y^{3/2})
 *   parallel flow  ∫ v_∥ f d³v = S τ_s v_b ξ_b I(y_c, Ẑ),   y_c = v_c/v_b,
 *                  I(y_c, Ẑ) = (1 + y_c³)^{Ẑ/3} ∫_0^1 [y³/(y³ + y_c³)]^{Ẑ/3 + 1} dy      (the l = 1 term; neutral-beam current drive,
 *                  cd/nbcd.ts)
 *
 * Only the l = 0 and l = 1 terms enter a moment of the density, the energy and the parallel flow; the l = 2 term gives the
 * anisotropy of the pressure (not used: the pressure of the fast ions is isotropic in the model, an APPROXIMATION).
 * APPROXIMATION: no energy diffusion, no thermal tail, a plasma at rest, no fast-ion loss or transport.
 */
import { gaussLegendre } from '../../numerics/quadrature';
import { fastIonEnergyTime, ionHeatingFraction, slowingDownTime } from '../../heating';

/** Parameters of one steady slowing-down distribution */
export interface SlowingDownParams {
  /** birth energy [keV] and critical energy [keV] */
  E0_keV: number; Ec_keV: number;
  /** electron slowing-down time τ_s [s] (spitzerSlowingDownTime) */
  tauS: number;
  /** source rate S [m⁻³ s⁻¹] */
  S: number;
}

/** Moments of the isotropic steady distribution: density [m⁻³], energy density [keV m⁻³], the heating power to the ions and the electrons [keV m⁻³ s⁻¹] */
export interface SlowingDownMoments {
  n: number; W: number; Pi: number; Pe: number;
  /** thermalisation time τ_th = n/S and energy time τ_W = W/(S E_0) [s], and the ion fraction G of the heating */
  tauTh: number; tauW: number; G: number;
}

/**
 * The moments of the steady slowing-down distribution in closed form (the Stix loss law, heating.ts): n = S τ_th,
 * W = S E_0 τ_W, P_i = S E_0 G, P_e = S E_0 (1 − G).
 */
export function slowingDownMoments(p: SlowingDownParams): SlowingDownMoments {
  // heating.ts takes the density and temperature of the plasma for τ_s; here τ_s is given, so the same closed forms are written out
  const x = p.E0_keV / Math.max(p.Ec_keV, 1e-6);
  const G = ionHeatingFraction(p.E0_keV, p.Ec_keV);
  const tauTh = (p.tauS / 3) * Math.log(1 + Math.pow(x, 1.5));
  const tauW = 0.5 * p.tauS * (1 - G);
  return {
    n: p.S * tauTh, W: p.S * p.E0_keV * tauW, Pi: p.S * p.E0_keV * G, Pe: p.S * p.E0_keV * (1 - G), tauTh, tauW, G,
  };
}

/** The same τ_th and τ_W from the plasma parameters through heating.ts (a consistency handle for tests): [τ_th, τ_W] */
export function slowingDownTimes(Te_keV: number, ne: number, A: number, Z: number, E0_keV: number, Ec_keV: number): [number, number] {
  return [slowingDownTime(Te_keV, ne, A, Z, E0_keV, Ec_keV), fastIonEnergyTime(Te_keV, ne, A, Z, E0_keV, Ec_keV)];
}

/**
 * Ẑ of the Gaffey distribution: the pitch-angle scattering of the fast ion on the plasma ions over their energy drag, in units of the
 * v_c³/(τ_s v³) of the drag: Ẑ = (Σ n_j Z_j²/n_e) / (A_f Σ n_j Z_j²/(n_e A_j)) = Z_eff,ions / (A_f × ionSum). `zeff`: Σ n_j Z_j²/n_e of the ions (the plasma
 * Z_eff), `ionSum`: Σ n_j Z_j²/(n_e A_j) (composition.ts, criticalEnergy), `A_f` the mass number of the fast ion.
 */
export function pitchScatteringZhat(zeff: number, ionSum: number, A_f: number): number {
  return zeff / (A_f * Math.max(ionSum, 1e-30));
}

/** Legendre polynomial P_l(x), l = 0…4 (the terms of the pitch expansion that the moments and the tests need) */
export function legendre(l: number, x: number): number {
  switch (l) {
    case 0: return 1;
    case 1: return x;
    case 2: return 0.5 * (3 * x * x - 1);
    case 3: return 0.5 * (5 * x * x * x - 3 * x);
    case 4: return (35 * x ** 4 - 30 * x * x + 3) / 8;
    default: throw new RangeError(`legendre: l = ${l} is outside 0…4`);
  }
}

/**
 * The steady distribution f(v, ξ) [s³ m⁻⁶] of a source S at birth speed v_b and pitch ξ_b, with the pitch-angle scattering of
 * the plasma ions (Gaffey), the Legendre series up to lMax (l = 0 is the isotropic Stix distribution). Speeds in units
 * of v_c: `u = v/v_c`, `ub = v_b/v_c`; f is 0 above v_b. Zhat = Ẑ (0: no pitch-angle scattering, ξ is conserved).
 */
export function gaffeyDistribution(u: number, xi: number, ub: number, xib: number, Zhat: number, S: number, tauS: number, vc: number, lMax = 4): number {
  if (!(u > 0) || u > ub) return 0;
  const u3 = u * u * u, ub3 = ub * ub * ub;
  const base = (u3 * (ub3 + 1)) / (ub3 * (u3 + 1));
  let sum = 0;
  for (let l = 0; l <= lMax; l++) sum += ((2 * l + 1) / 2) * legendre(l, xi) * legendre(l, xib) * Math.pow(base, (l * (l + 1) * Zhat) / 6);
  // f = S τ_s / (2π (v³ + v_c³)) Σ …, with v = u v_c
  return (S * tauS * sum) / (2 * Math.PI * vc * vc * vc * (u3 + 1));
}

/**
 * I(y_c, Ẑ) of the parallel flow of the fast ions, ∫ v_∥ f d³v = S τ_s v_b ξ_b I: (1 + y_c³)^{Ẑ/3} ∫_0^1 [y³/(y³ + y_c³)]^{Ẑ/3 + 1} dy,
 * y_c = v_c/v_b. Gauss–Legendre (24 nodes) on panels that grow geometrically (a factor 3) from y_c to 1, where the integrand rises
 * from 0 to 1, and one panel on [0, y_c] where it is ∝ y^{3(Ẑ/3+1)}. With Ẑ = 0 it is ∫_0^1 y³/(y³ + y_c³) dy = 1 − y_c³ ∫_0^1 dy/(y³ + y_c³),
 * the parallel speed (in units of v_b) the ion carries until it has slowed down, when scattering is neglected.
 */
export function gaffeyCurrentIntegral(yc: number, Zhat: number): number {
  const c = Math.max(yc, 0), p = Zhat / 3 + 1;
  const f = (y: number) => {
    const y3 = y * y * y;
    return Math.pow(y3 / (y3 + c * c * c), p);
  };
  const { x, w } = gaussLegendre(24);
  const bounds: number[] = [0];
  if (c > 0 && c < 1) {
    for (let b = c; b < 1; b *= 3) bounds.push(b);
  }
  bounds.push(1);
  let s = 0;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1], h = 0.5 * (b - a), m = 0.5 * (b + a);
    for (let q = 0; q < x.length; q++) s += w[q] * h * f(m + h * x[q]);
  }
  return Math.pow(1 + c * c * c, Zhat / 3) * s;
}
