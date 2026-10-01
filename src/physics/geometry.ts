/**
 * Toroidal geometri ve profil yardımcıları.
 *
 * Plasma cross-section: the Miller boundary R(τ) = R0 + a cos(τ + arcsin(δ) sin τ), Z(τ) = κ a sin τ
 * (R.L. Miller et al., Phys. Plasmas 5 (1998) 973), the shape the 1.5D / Grad–Shafranov model builds
 * (equilibrium/miller.ts). Since v4.0 the volume, the surface and the cross-section area of the 0D model
 * are the exact integrals over that boundary (closed forms below); v3.0.0 used the ellipse formulas
 * V = 2π² R a² κ and S = 4π² R a √((1 + κ²)/2), which overestimate the Miller shape of the same (κ, δ) by
 * 3.6 % (JET) to 14 % (MAST-U) in volume and 4–18 % in surface, although their comment claimed "about 3 %".
 * (κ, δ) are the boundary values: see boundaryShape for the presets that carry 95 %-surface values.
 */
export interface Geometry {
  R: number; // büyük yarıçap [m]
  a: number; // küçük yarıçap [m]
  kappa: number; // elongasyon (κ95 ~ κ_a)
  delta: number; // üçgensellik
}

/** J_n(z) for integer n ≥ 0 by its power series (|z| ≤ π here: 30 terms give the double-precision limit) */
function besselJ(n: number, z: number): number {
  let term = 1;
  for (let k = 1; k <= n; k++) term *= z / 2 / k;
  let s = 0;
  for (let m = 0; m < 30; m++) { s += term; term *= -(z * z) / 4 / ((m + 1) * (m + 1 + n)); }
  return s;
}

/**
 * Miller boundary: x = arcsin δ. With Green's theorem, A = ∮ R dZ and V = π ∮ R² dZ, and the Bessel integral
 * J_n(z) = (1/2π) ∫ cos(nτ − z sin τ) dτ (Abramowitz & Stegun 9.1.21):
 *  A = π a² κ · 2J₁(x)/x        V = 2π² R a² κ · [2J₁(x)/x − (a/R) J₂(2x)/(2x)]
 * Both reduce to the ellipse (π a² κ, 2π² R a² κ) for δ = 0 and are checked against the boundary integral
 * to 1e-12 in reference/geometry.test.ts.
 */
function millerAreaFactor(delta: number): number {
  const x = Math.asin(Math.max(-1, Math.min(1, delta)));
  return x === 0 ? 1 : (2 * besselJ(1, x)) / x;
}
function millerVolumeFactor(delta: number, eps: number): number {
  const x = Math.asin(Math.max(-1, Math.min(1, delta)));
  return x === 0 ? 1 : millerAreaFactor(delta) - (eps * besselJ(2, 2 * x)) / (2 * x);
}

/** Plasma volume V of the Miller boundary [m³] (closed form) */
export function plasmaVolume(g: Geometry): number {
  return 2 * Math.PI * Math.PI * g.R * g.a * g.a * g.kappa * millerVolumeFactor(g.delta, g.a / g.R);
}

/** last surface evaluated (the diagnostics ask for it every step) */
let surfaceKey = '', surfaceValue = 0;
/**
 * Plasma surface area S = ∮ 2π R dl of the Miller boundary [m²]: the periodic trapezoid rule on the boundary
 * (converges geometrically for a smooth closed curve: 1e-13 relative at the 128 points used, κ ≤ 3, |δ| ≤ 0.9).
 */
export function plasmaSurface(g: Geometry): number {
  const key = `${g.R}|${g.a}|${g.kappa}|${g.delta}`;
  if (key === surfaceKey) return surfaceValue;
  const N = 128, x = Math.asin(Math.max(-1, Math.min(1, g.delta))), h = (2 * Math.PI) / N;
  let s = 0;
  for (let j = 0; j < N; j++) {
    const t = j * h, ph = t + x * Math.sin(t);
    const R = g.R + g.a * Math.cos(ph);
    const dR = -g.a * Math.sin(ph) * (1 + x * Math.cos(t)), dZ = g.kappa * g.a * Math.cos(t);
    s += R * Math.hypot(dR, dZ);
  }
  surfaceKey = key; surfaceValue = 2 * Math.PI * s * h;
  return surfaceValue;
}
/** Cross-section area of the Miller boundary [m²] (closed form) */
export function crossSectionArea(g: Geometry): number {
  return Math.PI * g.a * g.a * g.kappa * millerAreaFactor(g.delta);
}

/**
 * The boundary shape of a configuration for its 0D volume, surface and cross-section area. The presets carry κ, δ of the
 * 95 % flux surface (ITER: κ95 = 1.70, δ95 = 0.33, the values q95 and the scalings are written for) and the LCFS shape in
 * `profiles.lcfsKappa/lcfsDelta` (ITER: κ = 1.85, δ = 0.49, Shimada et al. 2007, the shape the 1.5D model builds); where it
 * is given the volume and the surface belong to it. The Miller boundary of the ITER LCFS shape has 842 m³ and 683 m², the
 * ITER design values are 837 m³ and 678 m² (ITER Physics Basis, Nucl. Fusion 39 (1999) 2137, ch. 1, design parameters; +0.6 %
 * and +0.7 %); the 95 % shape would give 799 m³ and 653 m² (−4.6 % and −3.7 %). Without `profiles` the geometry is the
 * boundary itself.
 *
 * The LCFS values follow the configuration's own κ, δ when `profiles.lcfsRef95` names the 95 % shape they belong to (the ITER and DEMO
 * presets): κ_LCFS = lcfsKappa · κ/κ95_ref and δ_LCFS = lcfsDelta · δ/δ95_ref, the system-code convention of a fixed LCFS-to-95 % ratio
 * (equal to the given values at the preset's own κ, δ, exactly). An edited κ or δ therefore moves V, S and A as it moves q95 and the scalings,
 * with no override hidden in the 1.5D-only settings (the 0D wizard does not show them). Without the reference the LCFS values are absolute,
 * as the 1.5D model always reads them (ProfileContext.geomB); a reference δ of 0 or a non-positive κ cannot scale and leaves that value absolute.
 */
export function boundaryShape(cfg: {
  geometry: Geometry;
  profiles?: { lcfsKappa?: number; lcfsDelta?: number; lcfsRef95?: { kappa: number; delta: number } };
}): Geometry {
  const g = cfg.geometry, p = cfg.profiles;
  if (!p || (p.lcfsKappa == null && p.lcfsDelta == null)) return g;
  const ref = p.lcfsRef95;
  const sk = ref && Number.isFinite(ref.kappa) && ref.kappa > 0 ? g.kappa / ref.kappa : 1;
  const sd = ref && Number.isFinite(ref.delta) && ref.delta !== 0 ? g.delta / ref.delta : 1;
  return { R: g.R, a: g.a, kappa: p.lcfsKappa != null ? p.lcfsKappa * sk : g.kappa, delta: p.lcfsDelta != null ? p.lcfsDelta * sd : g.delta };
}

/** Areal elongation κ_a = V / (2π² R a²) — the definition of IPB98(y,2) and of the ITPA20 scalings (Verdoolaege et al. 2021) */
export function arealElongation(g: Geometry): number {
  return plasmaVolume(g) / (2 * Math.PI * Math.PI * g.R * g.a * g.a);
}
export function aspectRatio(g: Geometry): number {
  return g.R / g.a;
}
export function inverseAspect(g: Geometry): number {
  return g.a / g.R;
}
/** Poloidal çevre uzunluğu (Ramanujan elips yaklaşımı) */
export function poloidalPerimeter(g: Geometry): number {
  const A = g.a, B = g.a * g.kappa;
  const h = ((A - B) / (A + B)) ** 2;
  return Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
/** Ortalama poloidal alan B_p = μ0 I_p / L_pol */
export function poloidalField(g: Geometry, Ip_A: number): number {
  return (1.25663706212e-6 * Ip_A) / poloidalPerimeter(g);
}

/**
 * q95 — ITER Physics Basis (Nucl. Fusion 39 (1999) 2175), Denk. 1 (Uckan 1990):
 *  q95 = (5 a² B / (R I_p[MA])) · (1 + κ²(1 + 2δ² − 1.2δ³))/2 · (1.17 − 0.65ε)/(1 − ε²)²
 */
export function q95(g: Geometry, B0: number, Ip_MA: number): number {
  if (Ip_MA <= 0) return Infinity;
  const eps = g.a / g.R;
  const shape = (1 + g.kappa * g.kappa * (1 + 2 * g.delta * g.delta - 1.2 * g.delta ** 3)) / 2;
  const asp = (1.17 - 0.65 * eps) / Math.pow(1 - eps * eps, 2);
  return ((5 * g.a * g.a * B0) / (g.R * Ip_MA)) * shape * asp;
}

/**
 * q95 — a fit that is also valid at low aspect ratio: O. Sauter, "Geometric formulas for system codes
 * including the effect of negative triangularity", Fusion Eng. Des. 112 (2016) 633:
 *  q95 = (4.1 a² B / (R I_p[MA])) · [1 + 1.2(κ−1) + 0.56(κ−1)²] · (1 + 0.09δ + 0.16δ²)
 *        · (1 + 0.45 δ ε) / (1 − 0.74 ε) · [1 + 0.55 (w07 − 1)],   w07 = 1 (no squareness)
 * The (1 − ε²)⁻² factor of the Uckan formula diverges as ε → 1 (MAST-U, ε = 0.76: q95 = 34); this fit
 * stays bounded through (1 − 0.74 ε)⁻¹. It has the same form as the 'Sauter' current scaling of PROCESS.
 * The constants (4.1, 1.2, 0.56, 0.09, 0.16, 0.45, 0.74, w07 = 1) agree with the UKAEA PROCESS documentation
 * (plasma current, i_plasma_current = 8, which cites Sauter) and with eq. (8) of arXiv:2407.06439v2 (main text), which prints
 * the fit as F(κ95, δ95, ε) for the 95 % surface (validation/primarySources.test.ts pins the constants to it; the primary paper
 * was not read); PROCESS evaluates it with the separatrix κ and δ, and the model's κ, δ are used as given.
 */
export function q95Sauter(g: Geometry, B0: number, Ip_MA: number): number {
  if (Ip_MA <= 0) return Infinity;
  const eps = g.a / g.R, k = g.kappa - 1, d = g.delta;
  const fk = 1 + 1.2 * k + 0.56 * k * k;
  const fd = 1 + 0.09 * d + 0.16 * d * d;
  const fe = (1 + 0.45 * d * eps) / (1 - 0.74 * eps);
  return ((4.1 * g.a * g.a * B0) / (g.R * Ip_MA)) * fk * fd * fe;
}

/** q95 by method: spherical tokamak → Sauter (2016) low-aspect-ratio fit; others → ITER (Uckan) formula */
export function q95ForMethod(method: string, g: Geometry, B0: number, Ip_MA: number): number {
  return method === 'spherical_tokamak' ? q95Sauter(g, B0, Ip_MA) : q95(g, B0, Ip_MA);
}

/**
 * Profil şekilleri: f(ρ) = f0 (1 − ρ²)^α ; hacim ort. <f> = f0/(1+α)
 * Silindirik hacim ağırlığı 2ρ dρ (APPROXIMATION: Shafranov kayması ve şekil ihmal).
 */
export function peakFromAverage(avg: number, alpha: number): number {
  return avg * (1 + alpha);
}
/** <f^p g^q> / (<f>^p <g>^q) tipi profil çarpanları için sayısal integral */
export function profileIntegral(fn: (rho: number) => number, N = 40): number {
  // Gauss-Legendre yerine orta nokta (yeterli, integrand düzgün)
  let s = 0;
  for (let i = 0; i < N; i++) {
    const rho = (i + 0.5) / N;
    s += fn(rho) * 2 * rho;
  }
  return s / N;
}

/**
 * The same integral as profileIntegral (bit-for-bit the same sum) and the share of the inner region ρ < rhoSplit
 * (the cells whose midpoint lies below rhoSplit).
 */
export function profileIntegralSplit(fn: (rho: number) => number, rhoSplit: number, N = 40): { total: number; inner: number } {
  let s = 0, si = 0;
  for (let i = 0; i < N; i++) {
    const rho = (i + 0.5) / N;
    const v = fn(rho) * 2 * rho;
    s += v;
    if (rho < rhoSplit) si += v;
  }
  return { total: s / N, inner: si / N };
}
