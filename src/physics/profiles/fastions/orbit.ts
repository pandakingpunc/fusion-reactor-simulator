/**
 * Finite orbit width of the fast ions: the radial smoothing kernel that turns the birth profile of a fast-ion source into the profile
 * of the ions where they slow down.
 *
 * A fast ion does not stay on the flux surface it is born on. The drift of a passing ion from its surface is of the order of the
 * poloidal Larmor radius, q ρ_L, and a trapped ion has the banana width q ρ_L/√ε (Wesson, Tokamaks, 4th ed., sections 3.7 and 3.9;
 * Heidbrink and Sadler, Nucl. Fusion 34 (1994) 535, section 2), with ρ_L = m v/(Z e B) the Larmor radius of the birth energy. The model
 * takes the displacement of an ion born at ρ_j as an isotropic Gaussian in the poloidal plane, of rms width (radial)
 *
 *   σ_j = c_orb q_j ρ_L / a_mid,    c_orb = ORBIT_RMS = 1/2 (× ProfileSettings.fastOrbitScale),
 *
 * with q_j the safety factor at the birth cell and a_mid the mid-plane minor radius. APPROXIMATION: the rms of a displacement that is
 * spread over the passing-orbit width q ρ_L is about q ρ_L/(2√2) to q ρ_L/√12, the trapped fraction √ε of the ions (banana width larger by
 * 1/√ε at the same number of particles per unit displacement) is not treated separately, the width does not depend on the pitch of the
 * birth, and ions born within an orbit width of the separatrix are not lost but renormalised to the plasma (no first-orbit loss).
 *
 * The kernel conserves the energy exactly: a source of power P_j in cell j reaches cell i with the probability p_ji, Σ_i p_ji = 1, and the
 * smoothed power density is S_i = Σ_j P_j ΔV_j p_ji / ΔV_i (PoolField.smooth), so Σ_i S_i ΔV_i = Σ_j P_j ΔV_j to round-off.
 */
const QE = 1.602176634e-19; // C
const KEV = 1.602176634e-16; // J/keV
const AMU = 1.66053906660e-27; // kg

/** rms width of the radial displacement over q ρ_L (see above) */
export const ORBIT_RMS = 0.5;

/** Larmor radius m v/(Z e B) of a particle of mass number A and charge Z at energy E [keV] in a field B [T], in metres */
export function larmorRadius(E_keV: number, A: number, Z: number, B: number): number {
  const m = A * AMU;
  return Math.sqrt(2 * m * E_keV * KEV) / (Z * QE * Math.max(B, 1e-6));
}

/** One energy the birth of a species is spread over: energy [keV], mass number, charge and the weight of the power it carries */
export interface BirthEnergy { E_keV: number; A: number; Z: number; weight: number }

/**
 * rms displacement of the ions born in every cell in ρ̂ [dimensionless], σ_j² = Σ_k w_k (c_orb · scale · q_j ρ_L(E_k) / a_mid)² / Σ_k w_k.
 * `q`: safety factor of the cell centres; `B0` the field on the axis [T]; `aMid` the mid-plane minor radius [m].
 */
export function orbitSigma(out: Float64Array, q: ArrayLike<number>, birth: readonly BirthEnergy[], B0: number, aMid: number, scale: number): void {
  let wSum = 0, rho2 = 0;
  for (const b of birth) { const rl = larmorRadius(b.E_keV, b.A, b.Z, B0); rho2 += b.weight * rl * rl; wSum += b.weight; }
  const rhoL = wSum > 0 ? Math.sqrt(rho2 / wSum) : 0;
  const c = (ORBIT_RMS * Math.max(scale, 0) * rhoL) / Math.max(aMid, 1e-6);
  // q is bounded below (a q near zero would switch the smoothing off) and the width above at half the plasma radius (a hollow current
  // profile has q of 10 and more where the current density vanishes)
  for (let j = 0; j < out.length; j++) out[j] = Math.min(c * Math.max(q[j], 0.2), MAX_SIGMA);
}

/** the largest rms displacement, in ρ̂ */
export const MAX_SIGMA = 0.5;

/**
 * The exponentially scaled modified Bessel function e^{−x} I_0(x), x ≥ 0 (Abramowitz and Stegun, Handbook of Mathematical Functions, 9.8.1
 * and 9.8.2: polynomial approximations, relative error below 2e-7).
 */
export function besselI0e(x: number): number {
  if (x < 3.75) {
    const y = (x / 3.75) ** 2;
    const i0 = 1 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
    return i0 * Math.exp(-x);
  }
  const y = 3.75 / x;
  const p = 0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377)))))));
  return p / Math.sqrt(x);
}

/**
 * The probabilities p_ji (row j = birth cell, N × N, row-major) that a fast ion born in cell j is found in cell i. The displacement is an
 * isotropic Gaussian in the poloidal plane whose radial rms is σ_j, the kernel of the convolution of the source with it, seen from the axis,
 *
 *   K(ρ, ρ') = σ⁻² exp(−(ρ² + ρ'²)/(2σ²)) I_0(ρ ρ'/σ²)       (∫ K ρ dρ = 1),
 *
 * so that the smoothed power density S_i = Σ_j P_j (ΔV_j/n_j) K(ρ_i, ρ_j) stays finite and smooth at the axis (a Gaussian in ρ alone, divided by
 * the volume of the cell, has a 1/ρ cusp there: the pressure table of the equilibrium solver cannot take it). With the cell volumes ΔV_i as the
 * measure p_ji = ΔV_i K(ρ_i, ρ_j)/n_j, n_j = Σ_i ΔV_i K(ρ_i, ρ_j): a source that reaches the edge is renormalised to the plasma. A width below a
 * millionth of the cell is the identity.
 */
export function orbitKernel(T: Float64Array, rhoC: ArrayLike<number>, dRhoC: ArrayLike<number>, dV: ArrayLike<number>, sigma: ArrayLike<number>): void {
  const N = rhoC.length;
  for (let j = 0; j < N; j++) {
    const row = j * N, s = sigma[j];
    if (!(s > 1e-6 * dRhoC[j])) {
      for (let i = 0; i < N; i++) T[row + i] = i === j ? 1 : 0;
      continue;
    }
    let norm = 0;
    const inv = 1 / (2 * s * s), rj = rhoC[j];
    for (let i = 0; i < N; i++) {
      const d = rhoC[i] - rj;
      // σ⁻² e^{−(ρ² + ρ'²)/2σ²} I_0(ρρ'/σ²) = σ⁻² e^{−(ρ − ρ')²/2σ²} [e^{−x} I_0(x)], x = ρρ'/σ²; the constant σ⁻² cancels in the normalisation
      const p = Math.exp(-d * d * inv) * besselI0e((rhoC[i] * rj) / (s * s)) * dV[i];
      T[row + i] = p; norm += p;
    }
    for (let i = 0; i < N; i++) T[row + i] /= norm;
  }
}
