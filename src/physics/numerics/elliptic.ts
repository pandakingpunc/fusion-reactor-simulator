/**
 * CARLSON SYMMETRIC ELLIPTIC INTEGRALS and the complete integrals K and E.
 *
 * R_F(x, y, z) = ½ ∫_0^∞ dt / √((t + x)(t + y)(t + z)),
 * R_D(x, y, z) = (3/2) ∫_0^∞ dt / ((t + z) √((t + x)(t + y)(t + z))),
 * evaluated by the duplication algorithm (each step replaces x, y, z by ¼(x + λ), ¼(y + λ), ¼(z + λ) with
 * λ = √x√y + √y√z + √z√x and leaves the integral unchanged up to the known factor) until the arguments agree to
 * 2.5e−3 (R_F) or 1.5e−3 (R_D), then the Taylor series in the remaining differences to fifth order: the truncation error is
 * ≈ ε⁶/4 (R_F) and 3 ε⁶ (R_D), about 1e−16 (B. C. Carlson, "Computing elliptic integrals by duplication", Numer. Math. 33
 * (1979) 1–16; "Numerical computation of real or complex elliptic integrals", Numer. Algorithms 10 (1995) 13–26; the
 * coefficients are those of W. H. Press et al., Numerical Recipes, 3rd ed., Sec. 6.12). With them
 *
 *   K(m) = R_F(0, 1 − m, 1),   E(m) = K(m) − (m/3) R_D(0, 1 − m, 1),     m = k² ∈ [0, 1)
 *
 * (parameter m, not the modulus k). The Green's functions of a circular current filament (equilibrium/greens.ts) need
 * K and E with m near 1 (the point next to the filament) and near 0 (next to the axis), where 1 − m has to be
 * given as it is computed geometrically, not as a difference of two numbers close to 1: `ellipticKE(m, mc)`.
 */

const RF_ERRTOL = 0.0025;
const RD_ERRTOL = 0.0015;

/**
 * Carlson's R_F(x, y, z) for x, y, z ≥ 0 of which at most one is 0. Symmetric in its arguments; R_F(x, x, x) = 1/√x;
 * homogeneous of degree −½. Throws RangeError outside the domain.
 */
export function carlsonRF(x: number, y: number, z: number): number {
  if (!(x >= 0 && y >= 0 && z >= 0) || !Number.isFinite(x + y + z)) throw new RangeError(`R_F needs finite arguments ≥ 0 (got ${x}, ${y}, ${z})`);
  if ((x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0) > 1) throw new RangeError(`R_F needs at most one zero argument (got ${x}, ${y}, ${z})`);
  let xt = x, yt = y, zt = z, ave = 0, dx = 0, dy = 0, dz = 0;
  for (let it = 0; it < 200; it++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lam = sx * (sy + sz) + sy * sz;
    xt = 0.25 * (xt + lam); yt = 0.25 * (yt + lam); zt = 0.25 * (zt + lam);
    ave = (xt + yt + zt) / 3;
    dx = (ave - xt) / ave; dy = (ave - yt) / ave; dz = (ave - zt) / ave;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < RF_ERRTOL) break;
  }
  const e2 = dx * dy - dz * dz, e3 = dx * dy * dz;
  return (1 + (e2 / 24 - 0.1 - (3 * e3) / 44) * e2 + e3 / 14) / Math.sqrt(ave);
}

/**
 * Carlson's R_D(x, y, z) = R_J(x, y, z, z) for x, y ≥ 0 of which at most one is 0, and z > 0. Symmetric in x and y;
 * R_D(x, x, x) = x^(−3/2); homogeneous of degree −3/2. Throws RangeError outside the domain.
 */
export function carlsonRD(x: number, y: number, z: number): number {
  if (!(x >= 0 && y >= 0 && z > 0) || !Number.isFinite(x + y + z)) throw new RangeError(`R_D needs finite x, y ≥ 0 and z > 0 (got ${x}, ${y}, ${z})`);
  if (x === 0 && y === 0) throw new RangeError('R_D needs at most one of x, y equal to 0');
  let xt = x, yt = y, zt = z, sum = 0, fac = 1, ave = 0, dx = 0, dy = 0, dz = 0;
  for (let it = 0; it < 200; it++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lam = sx * (sy + sz) + sy * sz;
    sum += fac / (sz * (zt + lam));
    fac *= 0.25;
    xt = 0.25 * (xt + lam); yt = 0.25 * (yt + lam); zt = 0.25 * (zt + lam);
    ave = 0.2 * (xt + yt + 3 * zt);
    dx = (ave - xt) / ave; dy = (ave - yt) / ave; dz = (ave - zt) / ave;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < RD_ERRTOL) break;
  }
  const C1 = 3 / 14, C2 = 1 / 6, C3 = 9 / 22, C4 = 3 / 26, C5 = 0.25 * C3, C6 = 1.5 * C4;
  const ea = dx * dy, eb = dz * dz, ec = ea - eb, ed = ea - 6 * eb, ee = ed + ec + ec;
  return 3 * sum + (fac * (1 + ed * (-C1 + C5 * ed - C6 * dz * ee) + dz * (C2 * ee + dz * (-C3 * ec + dz * C4 * ea)))) / (ave * Math.sqrt(ave));
}

/**
 * The complete elliptic integrals of the first and second kind, K(m) and E(m), of the parameter m = k² ∈ [0, 1).
 * `mc` is the complementary parameter 1 − m; pass it when it is known more accurately than the difference
 * (m near 1: mc = (R − R′)² + ΔZ² over (R + R′)² + ΔZ²). K diverges logarithmically as mc → 0; mc must be > 0.
 */
export function ellipticKE(m: number, mc: number = 1 - m): { K: number; E: number } {
  if (!(m >= 0 && mc > 0) || !Number.isFinite(m + mc)) throw new RangeError(`K and E need the parameter m ≥ 0 and the complement 1 − m > 0 (got m = ${m}, 1 − m = ${mc})`);
  const K = carlsonRF(0, mc, 1);
  return { K, E: K - (m / 3) * carlsonRD(0, mc, 1) };
}

/** K(m), the complete elliptic integral of the first kind (see ellipticKE) */
export function ellipticK(m: number, mc: number = 1 - m): number { return ellipticKE(m, mc).K; }
/** E(m), the complete elliptic integral of the second kind (see ellipticKE) */
export function ellipticE(m: number, mc: number = 1 - m): number { return ellipticKE(m, mc).E; }
