/**
 * TOROIDAL GREEN'S FUNCTIONS of a circular current filament, the building block of a free-boundary Grad–Shafranov solver
 * (coil fields, plasma-to-boundary flux, vertical-stability filaments). For a filament of radius R_c at height Z_c carrying
 * the current I, the poloidal flux per radian ψ = R A_φ [Wb/rad] and the field (B_R, B_Z) = (−∂ψ/∂Z, ∂ψ/∂R)/R at (R, Z) are
 *
 *   ψ  = μ0 I/(2π) √(R R_c) [(2 − m) K(m) − 2 E(m)] / √m,        m = k² = 4 R R_c / ((R + R_c)² + Δ²),  Δ = Z − Z_c
 *   B_R = μ0 I/(2π) Δ / (R √D) [ ((R² + R_c² + Δ²)/((R − R_c)² + Δ²)) E − K ],          D = (R + R_c)² + Δ²
 *   B_Z = μ0 I/(2π) 1/√D [ ((R_c² − R² − Δ²)/((R − R_c)² + Δ²)) E + K ]
 *
 * (J. D. Jackson, Classical Electrodynamics, 3rd ed., Sec. 5.5, Eqs. 5.37–5.39), with K and E the complete elliptic integrals
 * of the parameter m, from Carlson's duplication algorithm (numerics/elliptic.ts). Two forms would lose digits and are not
 * used as written: [(2 − m)K − 2E] cancels to π m²/16 as m → 0 (the axis), so for m < 0.1 its Maclaurin series is summed;
 * and the bracket of B_R cancels the same way, so the field is obtained from the derivatives of ψ,
 * ∂ψ/∂Z and ∂ψ/∂R through dψ/dm, evaluated from the same series near the axis. On the axis (R = 0) the field is the
 * known on-axis value μ0 I R_c²/(2 (R_c² + Δ²)^(3/2)) and ψ = 0. A point on the filament (m = 1: ψ and B diverge) raises
 * RangeError. Units: metres, amperes, webers per radian, tesla; the functions return the value for a current of 1 A.
 */
import { ellipticKE } from '../numerics/elliptic';

const MU0 = 1.25663706212e-6;
const C = MU0 / (2 * Math.PI);

/** below this m the series is used (the closed form loses ε/m² of relative accuracy) */
const M_SERIES = 0.1;
const SERIES_TERMS = 40;

/**
 * F(m) = (2 − m)K − 2E and the two combinations the field needs, from the Maclaurin series
 * K = (π/2) Σ a_n m^n, E = (π/2) Σ a_n m^n/(1 − 2n), a_n = ((½)_n / n!)² = a_{n−1} ((2n − 1)/(2n))²:
 *   F = (π/2) Σ_{n≥2} c_n m^n,  c_n = 4n a_n/(2n − 1) − a_{n−1};   H = 2m F′ − F = (π/2) Σ (2n − 1) c_n m^n.
 */
function seriesFH(m: number): { F: number; H: number } {
  let a = 1, aPrev = 1, mn = 1, F = 0, H = 0;
  for (let n = 1; n < SERIES_TERMS; n++) {
    aPrev = a;
    a = aPrev * ((2 * n - 1) / (2 * n)) ** 2;
    mn *= m;
    const c = (4 * n * a) / (2 * n - 1) - aPrev;
    F += c * mn;
    H += (2 * n - 1) * c * mn;
    if (mn < 1e-18 * Math.abs(F) && n > 3) break;
  }
  return { F: 0.5 * Math.PI * F, H: 0.5 * Math.PI * H };
}

/** ψ per radian and the derivatives of its Green's function through the parameter m: g(m) = F/√m and g_m = H/(2 m^{3/2}) */
function gAndGm(m: number, mc: number): { g: number; gm: number } {
  if (m < M_SERIES) {
    const { F, H } = seriesFH(m);
    return { g: F / Math.sqrt(m), gm: H / (2 * m * Math.sqrt(m)) };
  }
  const { K, E } = ellipticKE(m, mc);
  const F = (2 - m) * K - 2 * E;
  const Fp = (E - mc * K) / (2 * mc); // dF/dm
  return { g: F / Math.sqrt(m), gm: (2 * m * Fp - F) / (2 * m * Math.sqrt(m)) };
}

function geometry(Rc: number, Zc: number, R: number, Z: number): { m: number; mc: number; D: number; d: number } {
  if (!(Rc > 0 && R >= 0) || !Number.isFinite(Rc + Zc + R + Z)) throw new RangeError(`need a filament radius > 0 and a field radius ≥ 0 (got R_c = ${Rc}, R = ${R})`);
  const d = Z - Zc, D = (R + Rc) * (R + Rc) + d * d;
  const mc = ((R - Rc) * (R - Rc) + d * d) / D;
  if (!(mc > 0)) throw new RangeError('the point is on the filament: ψ and B diverge there');
  return { m: (4 * R * Rc) / D, mc, D, d };
}

/** Poloidal flux per radian ψ = R A_φ [Wb/rad] at (R, Z) of a circular filament of radius R_c at height Z_c carrying 1 A */
export function filamentPsi(Rc: number, Zc: number, R: number, Z: number): number {
  const { m, mc } = geometry(Rc, Zc, R, Z);
  if (R === 0) return 0;
  return C * Math.sqrt(R * Rc) * gAndGm(m, mc).g;
}

/** (B_R, B_Z) [T] at (R, Z) of that filament (1 A): B = (−∂ψ/∂Z, ∂ψ/∂R)/R */
export function filamentField(Rc: number, Zc: number, R: number, Z: number): { BR: number; BZ: number } {
  const { m, mc, D, d } = geometry(Rc, Zc, R, Z);
  if (R === 0) return { BR: 0, BZ: (MU0 * Rc * Rc) / (2 * Math.pow(Rc * Rc + d * d, 1.5)) };
  const { g, gm } = gAndGm(m, mc);
  const dmdZ = (-2 * m * d) / D;
  const dmdR = (4 * Rc * (Rc * Rc - R * R + d * d)) / (D * D);
  const s = Math.sqrt(R * Rc);
  const dpsidZ = C * s * gm * dmdZ;
  const dpsidR = C * (0.5 * Math.sqrt(Rc / R) * g + s * gm * dmdR);
  return { BR: -dpsidZ / R, BZ: dpsidR / R };
}
