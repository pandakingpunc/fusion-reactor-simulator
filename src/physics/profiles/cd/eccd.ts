/**
 * Electron-cyclotron current-drive efficiency of Lin-Liu, Chan and Prater, Phys. Plasmas 10 (2003) 4064 (General Atomics report GA-A24257): the
 * Green's-function (adjoint) formulation of rf current drive in the banana regime, with fully relativistic electron dynamics in Fisch's
 * high-velocity collision model (Fisch, Phys. Rev. A 24 (1981) 3245), the slowing-down part of the collision operator reduced to the first term of
 * its Legendre expansion so that the response function separates in the energy and the pitch variable, and the model equilibrium of circular
 * flux surfaces, B = B_0/(1 + ε cos θ_p). Section and equation numbers are those of the paper.
 *
 * The response function of the driven current is χ̃ = sgn(u∥) F(u) H(λ) (equation 27), with u = p/m the momentum per unit mass, u∥ its parallel
 * component and λ = (B_max/B) u⊥²/u² the trapping variable (22). H is the response of the pitch-angle scattering operator in the flux-surface geometry,
 *
 *   H(λ) = θ(1 − λ) ½ ∫_λ^1 dλ' / ⟨(1 − λ' B/B_max)^{1/2}⟩,      f_c = (3/4)⟨B²/B_max²⟩ ∫_0^1 λ dλ / ⟨(1 − λ B/B_max)^{1/2}⟩         (29, 32)
 *
 * (f_c the effective circulating fraction, 1 − f_t of the neoclassical theory; H = 0 for the trapped electrons), with the flux-surface averages
 * evaluated by the interpolation formula of Appendix A (A.5-A.13, accurate for the model equilibrium with 0 < ε < 0.9). F solves the
 * slowing-down part,
 *
 *   (γ²/u²) dF/du + (Z_eff + 1)/f_c (γ/u³) F = u / (f_c γ u_e⁴),      F(0) = 0,      γ = √(1 + u²/c²),  u_e² = 2 T_e/m            (31)
 *
 * whose solution is F(u) = (1/f_c) (u/u_e)⁴ ∫_0^1 dx x^{ρ̂+3} (1 + (ux/c)²)^{−3/2} [(1 + γ)/(1 + γ')]^ρ̂, γ' = √(1 + (ux/c)²), ρ̂ = (Z_eff + 1)/f_c
 * (33); non-relativistically F = (u/u_e)⁴/(Z_eff + 1 + 4 f_c) (34, Taguchi).
 *
 * For the quasi-linear diffusion of an electron-cyclotron wave (harmonic ℓ, y = ℓ ω_c/ω, parallel index n∥, small Larmor radius, equation 35-37) the wave
 * heats the electrons on the resonance curve γ − n∥ u∥/c = y (41), and the local efficiency ζ* of equation 10 is (40-43)
 *
 *   ζ* = −(4/ln Λ) ⟨B/B_max⟩ ∫ dγ u⊥^{2ℓ} f_M (m u_e² Λ̃χ̃) / ∫ dγ u⊥^{2ℓ} f_M,
 *   m u_e² Λ̃χ̃ = sgn(u∥) { γ (u_e²/u) F' H + 2 (B_max/B)(u∥ u_e²/u³)(γ u∥/u − n∥ u/c) F dH/dλ },        f_M ∝ exp(−(γ − 1) mc²/T_e),
 *
 * the integral over the resonance curve from γ_min to γ_max, the roots of γ² − 1 = ((γ − y)/n∥)² (43). B/B_max is the local value at the poloidal angle of the
 * absorption. ζ* is the current-drive figure of merit ζ = e³ n_e R_p I/(ε0² T_e P) = 32.7 n_20 R I/(T_keV P) of the experiments up to the geometric
 * factor of B.7. It has the sign of the electron flow reversed: positive ζ* is the ordinary Fisch-Boozer current (in the direction opposite to the
 * flow of the driven electrons), negative the current the trapped-electron (Ohkawa) effect turns round.
 *
 * APPROXIMATION (as in the paper): linear response (no ohmic electric field, no synergy with it), banana regime, no quasilinear flattening at
 * high power, circular flux surfaces (the shaping enters only through ε), no dependence on the polarisation of the wave.
 */
import { gaussLegendre } from '../../numerics/quadrature';

/** electron rest energy [keV] */
export const MC2_KEV = 510.99895;

/** e³/ε0² over 1 keV·10²⁰ m⁻³ in SI: ζ = 32.7 n_20 R I/(T_keV P) (equation 44; e³/(ε0² 1 keV 10²⁰) = 32.74) */
export const ZETA_CONSTANT = 32.74;

/** The flux-surface averages of the circular model equilibrium (A.11-A.13) and the coefficients of the interpolation formula (A.6, A.7) */
export interface SurfaceAverages {
  /** inverse aspect ratio */
  eps: number;
  /** ⟨h⟩ = 1 − ε, ⟨h²⟩ = (1 − ε)²/√(1 − ε²), h = B/B_max */
  h1: number; h2: number;
  c2: number; c4: number;
}

/** Averages and interpolation coefficients of the model equilibrium of inverse aspect ratio ε (0 ≤ ε < 1) */
export function surfaceAverages(eps: number): SurfaceAverages {
  const e = Math.min(Math.max(eps, 1e-6), 0.98);
  const h1 = 1 - e;
  const h2 = ((1 - e) * (1 - e)) / Math.sqrt(1 - e * e);
  // ⟨(1 − h)^{1/2}⟩ = (1/π)[(1 + ε) asin(√(2ε/(1 + ε))) + √(2ε(1 − ε))]   (A.13). The preprint prints √(2ε(1 + ε)) under the second root; the integral
  // (1/π) ∫_0^π √(ε(1 + cos θ)(1 + ε cos θ)) dθ is 2√(2ε)/π ∫_0^1 √(1 + ε − 2ε s²) ds, whose closed form has √(1 − ε), the value used here (checked
  // against the average over θ_p in eccd.test.ts; with the misprint the interpolation formula misses ⟨(1 − λh)^{1/2}⟩ by 20 % at ε = 0.5 and λ → 1)
  const hs = ((1 + e) * Math.asin(Math.sqrt((2 * e) / (1 + e))) + Math.sqrt(2 * e * (1 - e))) / Math.PI;
  const c2 = -0.25 * (h2 - h1 * h1) / ((1 - h1) * (1 - h1));
  const c4 = (hs * hs) / (1 - h1) - 1;
  return { eps: e, h1, h2, c2, c4 };
}

/** ⟨g⟩ of the interpolation formula (A.5): [1 + s²(c_2 (1 − s²) + c_4 s²)]^{1/2}, s = λ(1 − ⟨h⟩)/(1 − λ⟨h⟩) */
function avgG(s: number, a: SurfaceAverages): number {
  const s2 = s * s;
  return Math.sqrt(1 + s2 * (a.c2 * (1 - s2) + a.c4 * s2));
}

/** ⟨(1 − λ B/B_max)^{1/2}⟩ for 0 ≤ λ ≤ 1 by the interpolation formula (A.2, A.5): (1 − λ⟨h⟩)^{1/2} ⟨g⟩ */
export function avgSqrtOneMinusLambdaH(lambda: number, a: SurfaceAverages): number {
  const l = Math.min(Math.max(lambda, 0), 1);
  const den = 1 - l * a.h1;
  const s = (l * (1 - a.h1)) / den;
  return Math.sqrt(den) * avgG(s, a);
}

/** dH/dλ = −1/(2 ⟨(1 − λ B/B_max)^{1/2}⟩) for 0 ≤ λ < 1 (from 29; A.8) */
export function dHdLambda(lambda: number, a: SurfaceAverages): number {
  return -0.5 / avgSqrtOneMinusLambdaH(lambda, a);
}

const GL10 = gaussLegendre(10);

/**
 * H(λ) of equation 29 through the form A.9: ½ (1 − ⟨h⟩)^{1/2} ∫_s^1 dz D^{−3/2} ⟨g(z)⟩^{−1}, D = 1 − ⟨h⟩ + z⟨h⟩ = ε + z (1 − ε). The integrand is
 * D^{−3/2} times a smooth function; the substitution t = D^{−1/2} (D^{−3/2} dz = −2 dt/⟨h⟩) leaves the smooth function alone and integrates it over t from 1
 * (z = 1) to D(s)^{−1/2}: H = (1 − ⟨h⟩)^{1/2}/⟨h⟩ ∫_1^{t_s} ⟨g(z(t))⟩^{−1} dt, z(t) = (t^{−2} − ε)/⟨h⟩. (Without it the quadrature misses H for ε ≲ 0.01,
 * where the integrand varies by orders of magnitude over [s, 1].)
 */
export function responseH(lambda: number, a: SurfaceAverages): number {
  if (!(lambda < 1)) return 0;
  const l = Math.max(lambda, 0);
  const s = (l * (1 - a.h1)) / (1 - l * a.h1);
  const eps = 1 - a.h1;
  const tS = 1 / Math.sqrt(eps + s * a.h1);
  const h = 0.5 * (tS - 1), m = 0.5 * (tS + 1);
  let sum = 0;
  for (let k = 0; k < GL10.x.length; k++) {
    const t = m + h * GL10.x[k];
    const z = Math.min(Math.max((1 / (t * t) - eps) / a.h1, 0), 1);
    sum += GL10.w[k] / avgG(z, a);
  }
  return (Math.sqrt(eps) / a.h1) * h * sum;
}

const GL24 = gaussLegendre(24);

/** The effective circulating fraction f_c of equation 32 (= 1 − f_t of the neoclassical theory) for the model equilibrium */
export function circulatingFraction(a: SurfaceAverages): number {
  // λ = 1 − s²: the integrand λ/⟨(1 − λ h)^{1/2}⟩ has the 1/√(1 − λ) of the straight-field limit, which the substitution turns into 2(1 − s²)
  let sum = 0;
  for (let k = 0; k < GL24.x.length; k++) {
    const s = 0.5 * (1 + GL24.x[k]);
    const l = 1 - s * s;
    sum += GL24.w[k] * 0.5 * 2 * s * l / avgSqrtOneMinusLambdaH(l, a);
  }
  return 0.75 * a.h2 * sum;
}

const GL8 = gaussLegendre(8);

/**
 * F(u) of equation 33 (in units of (1/f_c)(u_e)^{-4}... the dimensionless combination F u_e⁴ is returned): (1/f_c) u⁴ ∫_0^1 dx x^{ρ̂+3} (1 + (ux)²)^{−3/2}
 * [(1 + γ)/(1 + γ')]^ρ̂ with u in units of c and u_e² = 2 T_e/(m c²) applied by the caller; `rho` = ρ̂ = (Z_eff + 1)/f_c.
 */
export function responseFRaw(u: number, fc: number, rho: number): number {
  const gam = Math.sqrt(1 + u * u);
  let sum = 0;
  for (let k = 0; k < GL8.x.length; k++) {
    const x = 0.5 * (1 + GL8.x[k]);
    const g2 = 1 + u * u * x * x;
    sum += GL8.w[k] * 0.5 * Math.pow(x, rho + 3) * Math.pow(g2, -1.5) * Math.pow((1 + gam) / (1 + Math.sqrt(g2)), rho);
  }
  return (u * u * u * u * sum) / fc;
}

/** Inputs of the efficiency at one point of a flux surface */
export interface EccdPoint {
  /** electron temperature [keV] */
  Te_keV: number;
  Zeff: number;
  /** signed parallel refractive index n∥ = k∥ c/ω of the wave (its sign is the direction of the driven electrons) */
  nPar: number;
  /** cyclotron harmonic ℓ (1, 2, 3) */
  harmonic: number;
  /** y = ℓ ω_c/ω at the point of absorption */
  y: number;
  /** inverse aspect ratio of the flux surface */
  eps: number;
  /** poloidal angle of the absorption [rad], 0 on the outboard midplane (B/B_max = (1 − ε)/(1 + ε cos θ_p)) */
  thetaP: number;
  /** Coulomb logarithm */
  lnLambda: number;
}

/** The roots γ_min, γ_max of the resonance curve (43) for |n∥| < 1: γ = [y ∓ |n∥|√(n∥² + y² − 1)]/(1 − n∥²); null if the curve is empty (n∥² + y² ≤ 1) */
export function resonanceRange(nPar: number, y: number): [number, number] | null {
  const n2 = nPar * nPar;
  if (!(n2 < 1) || !(n2 + y * y > 1)) return null;
  const r = Math.abs(nPar) * Math.sqrt(n2 + y * y - 1);
  const lo = (y - r) / (1 - n2), hi = (y + r) / (1 - n2);
  return [Math.max(lo, 1), hi];
}

/** Panels of the Gauss–Legendre integration over x = (γ − γ_min)/θ_T with the weight e^{−x}: [0, 2], [2, 6], [6, 14], [14, X] */
const X_PANELS = [0, 2, 6, 14];
const GL12 = gaussLegendre(12);

/** The parts of an evaluation that depend on the surface only (ε) or on the temperature and Z_eff (F), reusable between calls */
export interface EccdSurface {
  a: SurfaceAverages;
  fc: number;
}

/** Surface constants of the model equilibrium of inverse aspect ratio ε */
export function eccdSurface(eps: number): EccdSurface {
  const a = surfaceAverages(eps);
  return { a, fc: circulatingFraction(a) };
}

/**
 * The efficiency ζ* of equation 10 (see the header for the sign), 0 if the resonance curve is empty or lies at γ < 1 only. `surf` the constants
 * of the surface (eccdSurface(p.eps)), computed if not given.
 */
export function eccdZetaStar(p: EccdPoint, surf: EccdSurface = eccdSurface(p.eps)): number {
  const range = resonanceRange(p.nPar, p.y);
  if (!range || !(p.Te_keV > 0)) return 0;
  const { a, fc } = surf;
  const n = p.nPar, ell = p.harmonic;
  const theta = p.Te_keV / MC2_KEV;
  const ue2 = 2 * theta;
  const rho = (p.Zeff + 1) / fc;
  const hLoc = (1 - a.eps) / (1 + a.eps * Math.cos(p.thetaP));
  const [gLo, gHi] = range;
  const X = Math.min((gHi - gLo) / theta, 60);
  const bounds = X_PANELS.filter((b) => b < X).concat(X);
  let num = 0, den = 0;
  for (let q = 0; q + 1 < bounds.length; q++) {
    const xa = bounds[q], xb = bounds[q + 1], hw = 0.5 * (xb - xa), xm = 0.5 * (xb + xa);
    for (let k = 0; k < GL12.x.length; k++) {
      const x = xm + hw * GL12.x[k];
      const gam = gLo + theta * x;
      const wgt = GL12.w[k] * hw * theta * Math.exp(-x);
      const u2 = gam * gam - 1;
      const u = Math.sqrt(u2);
      const uPar = (gam - p.y) / n;
      const uPerp2 = Math.max(u2 - uPar * uPar, 0);
      if (!(u > 0)) continue;
      const xi = uPar / u;
      const lambda = (1 - xi * xi) / hLoc;
      const uPerpL = Math.pow(uPerp2, ell);
      // the response function and its derivatives on the resonance curve
      const Fu = responseFRaw(u, fc, rho) / (ue2 * ue2);
      const dF = (u * u * u) / (fc * gam * gam * gam * ue2 * ue2) - (rho * Fu) / (gam * u);
      let G = 0;
      if (lambda < 1) {
        const H = responseH(lambda, a);
        const dH = dHdLambda(lambda, a);
        G = (Math.sign(uPar) || 1) * (gam * (ue2 / u) * dF * H + (2 / hLoc) * ((uPar * ue2) / (u * u * u)) * (gam * xi - n * u) * Fu * dH);
      }
      num += wgt * uPerpL * G;
      den += wgt * uPerpL;
    }
  }
  if (!(den > 0)) return 0;
  return ((4 / p.lnLambda) * a.h1 * num) / den;
}

/**
 * ⟨j∥⟩ per absorbed power density [A m⁻² per W m⁻³] from ζ* (equations 10 and 44 with the constant of ζ_CONSTANT):
 * ⟨j∥⟩ = 2π ζ* T_keV Q/(32.74 n_20).
 */
export function currentPerPower(zetaStar: number, Te_keV: number, ne: number): number {
  return (2 * Math.PI * zetaStar * Te_keV) / (ZETA_CONSTANT * (ne / 1e20));
}
