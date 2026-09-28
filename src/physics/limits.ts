/**
 * İşletme limitleri (tokamak). Her biri saf fonksiyon; sim döngüsü her adımda kontrol eder.
 */

/** Greenwald yoğunluk limiti — Greenwald et al., Nucl. Fusion 28 (1988) 2199:
 *  n_G [10^20 m^-3] = I_p[MA] / (π a²). The limit applies to the LINE-averaged density n̄_e (see lineAverageFactor). */
export function greenwaldDensity(Ip_MA: number, a: number): number {
  return (Ip_MA / (Math.PI * a * a)) * 1e20; // m^-3
}

/** ln Γ(x), x > 0 — Lanczos approximation (C. Lanczos, J. SIAM Numer. Anal. B 1 (1964) 86; g = 7, 9 terms), relative error ~1e-15 */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const z = x - 1;
  let s = c[0];
  for (let i = 1; i < 9; i++) s += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
}

/**
 * Ratio of the line-averaged to the volume-averaged density for the profile n = n0 (1 − ρ²)^α_n:
 *  n̄ = n0 ∫₀¹ (1 − ρ²)^α dρ = n0 √π Γ(α+1) / (2 Γ(α+3/2))   (horizontal chord through the axis)
 *  ⟨n⟩ = n0/(1+α)   (2ρ dρ volume weight, the same as geometry.profileIntegral)
 * Flat profile 1, parabolic (α=1) 4/3. APPROXIMATION: cylindrical cross-section, Shafranov shift neglected.
 */
export function lineAverageFactor(alpha_n: number): number {
  const a = Math.max(alpha_n, 0);
  return ((1 + a) * Math.sqrt(Math.PI) * Math.exp(lnGamma(a + 1) - lnGamma(a + 1.5))) / 2;
}

/** Toroidal beta (%): β_T = 2μ0 <p> / B² ; <p> = Σ n T (J/m³) */
export function betaToroidal(pressure_Pa: number, B: number): number {
  return (2 * 1.25663706212e-6 * pressure_Pa) / (B * B);
}

/** Normalize beta — Troyon et al., Plasma Phys. Control. Fusion 26 (1984) 209:
 *  β_N = β_T[%] · a[m] · B[T] / I_p[MA]  ; ideal MHD limiti ≈ 2.8 (duvarsız), 3.5–4 (duvarlı/şekilli) */
export function betaNormalized(betaT_frac: number, a: number, B: number, Ip_MA: number): number {
  if (Ip_MA <= 0) return 0;
  return (betaT_frac * 100 * a * B) / Ip_MA;
}

/** Poloidal beta: β_p = 2μ0<p>/B_p² ; B_p = μ0 I_p/(2π a sqrt((1+κ²)/2)) */
export function betaPoloidal(pressure_Pa: number, Ip_A: number, a: number, kappa: number): number {
  const Bp = (1.25663706212e-6 * Ip_A) / (2 * Math.PI * a * Math.sqrt((1 + kappa * kappa) / 2));
  return (2 * 1.25663706212e-6 * pressure_Pa) / (Bp * Bp);
}
