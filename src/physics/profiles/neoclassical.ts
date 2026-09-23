/**
 * NEOKLASİK TAŞINIM — Sauter bootstrap akımı ve neoklasik iletkenlik, çarpışma sıklıkları,
 * Coulomb logaritmaları, neoklasik iyon ısı difüzivitesi (taban değer).
 *
 * Kaynaklar:
 *  O. Sauter, C. Angioni, Y. R. Lin-Liu, Phys. Plasmas 6 (1999) 2834, Denk. (5), (13)–(18);
 *  düzeltme: Phys. Plasmas 9 (2002) 5140 (α katsayısı).
 *  Aynı bağıntılar TORAX (google-deepmind), ASTRA ve CRONOS'ta kullanılır.
 *
 * Birimler: n [m⁻³], T [eV] (fonksiyon adında belirtilmişse keV), R [m], q, ε boyutsuz.
 */

/** Coulomb log (elektron) — Sauter 1999 Denk. (18d): lnΛ_e = 31.3 − ln(√n_e / T_e[eV]) */
export function lnLambdaE(ne: number, TeV: number): number {
  return Math.max(31.3 - Math.log(Math.sqrt(Math.max(ne, 1e10)) / Math.max(TeV, 1)), 5);
}
/** Coulomb log (iyon-iyon) — Sauter 1999 Denk. (18e): lnΛ_ii = 30 − ln(Z³ √n_i / T_i^{3/2}) */
export function lnLambdaI(ni: number, TiV: number, Z: number): number {
  return Math.max(30 - Math.log((Z * Z * Z * Math.sqrt(Math.max(ni, 1e10))) / Math.pow(Math.max(TiV, 1), 1.5)), 5);
}

/** Elektron çarpışmalılığı ν_e* — Sauter 1999 Denk. (18b) */
export function nuStarE(q: number, R: number, eps: number, ne: number, TeV: number, Z: number): number {
  return (6.921e-18 * q * R * ne * Z * lnLambdaE(ne, TeV)) / (Math.max(TeV, 1) ** 2 * Math.pow(Math.max(eps, 1e-4), 1.5));
}
/** İyon çarpışmalılığı ν_i* — Sauter 1999 Denk. (18c) */
export function nuStarI(q: number, R: number, eps: number, ni: number, TiV: number, Z: number): number {
  return (4.9e-18 * q * R * ni * Z ** 4 * lnLambdaI(ni, TiV, Z)) / (Math.max(TiV, 1) ** 2 * Math.pow(Math.max(eps, 1e-4), 1.5));
}

/** Spitzer paralel iletkenliği [S/m] — Sauter 1999 Denk. (18a): σ = 1.9012e4 T^{3/2} / (Z N(Z) lnΛ_e) */
export function sigmaSpitzer(ne: number, TeV: number, Z: number): number {
  const NZ = 0.58 + 0.74 / (0.76 + Z);
  return (1.9012e4 * Math.pow(Math.max(TeV, 1), 1.5)) / (Z * NZ * lnLambdaE(ne, TeV));
}

/** Neoklasik iletkenlik σ_neo [S/m] — Sauter 1999 Denk. (13) */
export function sigmaNeo(ft: number, nuE: number, ne: number, TeV: number, Z: number): number {
  const sq = Math.sqrt(nuE);
  const X = ft / (1 + (0.55 - 0.1 * ft) * sq + (0.45 * (1 - ft) * nuE) / Math.pow(Z, 1.5));
  const F33 = 1 - (1 + 0.36 / Z) * X + (0.59 / Z) * X * X - (0.23 / Z) * X * X * X;
  return sigmaSpitzer(ne, TeV, Z) * F33;
}

function F31(X: number, Z: number): number {
  const X2 = X * X;
  return (1 + 1.4 / (Z + 1)) * X - (1.9 / (Z + 1)) * X2 + (0.3 / (Z + 1)) * X2 * X + (0.2 / (Z + 1)) * X2 * X2;
}

export interface BootstrapCoeffs { L31: number; L32: number; L34: number; alpha: number }

/** Sauter L31, L32, L34, α katsayıları — Denk. (14)–(17) + 2002 düzeltmesi */
export function sauterCoefficients(ft: number, nuE: number, nuI: number, Z: number): BootstrapCoeffs {
  const sqe = Math.sqrt(nuE), sqi = Math.sqrt(nuI);
  // L31
  const X31 = ft / (1 + (1 - 0.1 * ft) * sqe + (0.5 * (1 - ft) * nuE) / Z);
  const L31 = F31(X31, Z);
  // L32
  const Xee = ft / (1 + 0.26 * (1 - ft) * sqe + (0.18 * (1 - 0.37 * ft) * nuE) / Math.sqrt(Z));
  const Xei = ft / (1 + (1 + 0.6 * ft) * sqe + 0.85 * (1 - 0.37 * ft) * nuE * (1 + Z));
  const e4 = Xee ** 4, i4 = Xei ** 4;
  const F32ee = ((0.05 + 0.62 * Z) / (Z * (1 + 0.44 * Z))) * (Xee - e4) + (1 / (1 + 0.22 * Z)) * (Xee ** 2 - e4 - 1.2 * (Xee ** 3 - e4)) + (1.2 / (1 + 0.5 * Z)) * e4;
  const F32ei = (-(0.56 + 1.93 * Z) / (Z * (1 + 0.44 * Z))) * (Xei - i4) + (4.95 / (1 + 2.48 * Z)) * (Xei ** 2 - i4 - 0.55 * (Xei ** 3 - i4)) - (1.2 / (1 + 0.5 * Z)) * i4;
  const L32 = F32ee + F32ei;
  // L34
  const X34 = ft / (1 + (1 - 0.1 * ft) * sqe + (0.5 * (1 - 0.5 * ft) * nuE) / Z);
  const L34 = F31(X34, Z);
  // α (iyon akış katsayısı), 2002 düzeltmesi
  const a0 = (-1.17 * (1 - ft)) / (1 - 0.22 * ft - 0.19 * ft * ft);
  const f6 = ft ** 6, n2 = nuI * nuI;
  const alpha = ((a0 + 0.25 * (1 - ft * ft) * sqi) / (1 + 0.5 * sqi) + 0.315 * n2 * f6) / (1 + 0.15 * n2 * f6);
  return { L31, L32, L34, alpha };
}

/**
 * Bootstrap akımı ⟨j_bs·B⟩ [A T/m²] — Sauter Denk. (5):
 *   ⟨j_bs·B⟩ = −F p [ L31 ∂ln p/∂ψ + R_pe L32 ∂ln T_e/∂ψ + (1−R_pe) α L34 ∂ln T_i/∂ψ ]
 * Türevler ψ'ye göre: burada ρ-türevleri ve dψ/dρ (> 0) verilir.
 *   p = p_e + p_i [Pa]; dlnX_drho = (1/X) dX/dρ.
 */
export function bootstrapJB(F: number, p: number, Rpe: number, c: BootstrapCoeffs,
  dlnp_drho: number, dlnTe_drho: number, dlnTi_drho: number, dpsi_drho: number): number {
  if (!(dpsi_drho > 0)) return 0;
  return -(F * p / dpsi_drho) * (c.L31 * dlnp_drho + Rpe * c.L32 * dlnTe_drho + (1 - Rpe) * c.alpha * c.L34 * dlnTi_drho);
}

/**
 * Neoklasik iyon ısı difüzivitesi (taban) [m²/s] — muz rejimi Hinton–Hazeltine katsayısı
 * 0.66 q² ρ_i² ν_ii / ε^{3/2}, çarpışmalı yuvarlama 1/(1 + 1.03√ν* + 0.31ν*) (Chang–Hinton
 * biçiminden esinlenilmiş). APPROXIMATION — yalnız anomal taşınımın altında kalan taban.
 */
export function chiNeoIon(q: number, eps: number, B: number, ni: number, TiV: number, Ai: number, Z: number, nuI: number): number {
  const mi = Ai * 1.66053906660e-27, e = 1.602176634e-19;
  const Ti = Math.max(TiV, 1) * e;
  const rho = Math.sqrt(2 * mi * Ti) / (e * Math.max(B, 1e-3));
  const lnL = lnLambdaI(ni, TiV, Z);
  const nuii = (4.8e-8 * Z ** 4 * (ni * 1e-6) * lnL) / (Math.sqrt(Ai) * Math.pow(Math.max(TiV, 1), 1.5));
  const e15 = Math.pow(Math.max(eps, 1e-3), 1.5);
  return (0.66 * q * q * rho * rho * nuii) / e15 / (1 + 1.03 * Math.sqrt(nuI) + 0.31 * nuI);
}
