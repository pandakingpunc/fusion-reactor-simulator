/**
 * İşletme limitleri (tokamak). Her biri saf fonksiyon; sim döngüsü her adımda kontrol eder.
 */

/** Greenwald yoğunluk limiti — Greenwald et al., Nucl. Fusion 28 (1988) 2199:
 *  n_G [10^20 m^-3] = I_p[MA] / (π a²)  */
export function greenwaldDensity(Ip_MA: number, a: number): number {
  return (Ip_MA / (Math.PI * a * a)) * 1e20; // m^-3
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
