/**
 * İşletme limitleri (tokamak). Her biri saf fonksiyon; sim döngüsü her adımda kontrol eder.
 */
import { Geometry, q95 } from './geometry';

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

export interface LimitCheck {
  name: string;
  value: number; // normalize (1 = limit)
  ok: boolean;
  desc: string;
}

export interface LimitInputs {
  g: Geometry;
  B0: number;
  Ip_MA: number;
  ne: number; // hacim ort m^-3 (Greenwald için çizgi ort ~ hacim ort kabul; APPROXIMATION)
  pressure_Pa: number;
  P_rad_W: number;
  P_heat_W: number;
  betaN_limit: number; // kullanıcı: 2.8 – 4
  q95_limit: number; // 2.0
  greenwald_frac_limit: number; // 1.0 (deneysel: 0.8-1.2 arası disruption olasılığı artar)
  W_conc: number; // tungsten konsantrasyonu n_W/n_e
  W_conc_limit: number; // ~ 1e-4 ile 3e-4 (ITER için ≤ 1e-5 istenir, çöküş ~ birkaç 1e-4)
}

export function checkLimits(x: LimitInputs): LimitCheck[] {
  const nG = greenwaldDensity(x.Ip_MA, x.g.a);
  const fG = x.ne / nG;
  const bT = betaToroidal(x.pressure_Pa, x.B0);
  const bN = betaNormalized(bT, x.g.a, x.B0, x.Ip_MA);
  const q = q95(x.g, x.B0, x.Ip_MA);
  const fRad = x.P_rad_W / Math.max(x.P_heat_W, 1);
  return [
    { name: 'Greenwald', value: fG / x.greenwald_frac_limit, ok: fG < x.greenwald_frac_limit, desc: `n/n_G = ${fG.toFixed(2)}` },
    { name: 'Troyon', value: bN / x.betaN_limit, ok: bN < x.betaN_limit, desc: `β_N = ${bN.toFixed(2)}` },
    { name: 'q95', value: x.q95_limit / q, ok: q > x.q95_limit, desc: `q95 = ${q.toFixed(2)}` },
    { name: 'Radyatif', value: fRad, ok: fRad < 1, desc: `P_rad/P_heat = ${fRad.toFixed(2)}` },
    { name: 'Tungsten', value: x.W_conc / x.W_conc_limit, ok: x.W_conc < x.W_conc_limit, desc: `c_W = ${x.W_conc.toExponential(1)}` },
  ];
}
