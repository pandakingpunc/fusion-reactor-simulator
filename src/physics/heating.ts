/**
 * Isıtma: ohmik, NBI, ICRH, ECRH ve hızlı iyon (alfa/NBI) enerji paylaşımı.
 */
import { coulombLog } from './transport';

/**
 * Spitzer paralel direnç [Ω m] — Wesson "Tokamaks" §2.16:
 *  η_∥ = 1.65e-9 · Z_eff · lnΛ / T_e[keV]^1.5    (Z_eff=1 için; Z bağımlılığı N(Z) yaklaşımı)
 * Neoklasik (tuzaklı parçacık) düzeltme — Hirshman-Sigmar yaklaşımı:
 *  η_neo = η_Sp / (1 − sqrt(ε))²      (APPROXIMATION: çarpışma bölgesinden bağımsız)
 */
export function resistivity(Te_keV: number, Zeff: number, ne: number, eps: number): number {
  const lnL = coulombLog(ne, Te_keV);
  // Z bağımlılığı: Spitzer N(Z) faktörü ≈ Z(1+1.198Z+0.222Z²)/(1+2.966Z+0.753Z²) normalize
  const NZ = (Zeff * (1 + 1.198 * Zeff + 0.222 * Zeff * Zeff)) / (1 + 2.966 * Zeff + 0.753 * Zeff * Zeff);
  const N1 = (1 + 1.198 + 0.222) / (1 + 2.966 + 0.753);
  const etaSp = (1.65e-9 * lnL * (NZ / N1)) / Math.pow(Math.max(Te_keV, 0.01), 1.5);
  // Hacim ortalaması için ε_eff ≈ ε/2 (akım yoğunluğu merkezde tepe yapar; APPROXIMATION)
  const ft = Math.sqrt(Math.max(eps / 2, 0));
  return etaSp / Math.pow(1 - Math.min(ft, 0.9), 2);
}

/** Ohmik güç [W]: P = η j² V, j = I_p / A_kesit */
export function ohmicPower(Ip_A: number, area_m2: number, volume_m3: number, eta: number): number {
  const j = Ip_A / area_m2;
  return eta * j * j * volume_m3;
}

/**
 * Stix (1972) kritik enerji: hızlı iyonun elektron ve iyonlara eşit güç verdiği enerji.
 *  E_c = 14.8 · T_e · A_f · [ Σ_j (n_j Z_j² / (n_e A_j)) ]^(2/3)   [keV]
 */
export function criticalEnergy(Te_keV: number, A_fast: number, ionSum: number): number {
  return 14.8 * Te_keV * A_fast * Math.pow(ionSum, 2 / 3);
}

/**
 * Hızlı iyonun iyonlara aktardığı enerji oranı — Stix, Plasma Phys. 14 (1972) 367:
 *  G(x) = (1/x) ∫₀ˣ dy / (1 + y^1.5),  x = E_0 / E_c
 *  Kapalı form: (1/x)[ (1/3) ln((1 − √x + x)/(1 + √x)²) + (2/√3)(atan((2√x − 1)/√3) + π/6) ]
 */
export function ionHeatingFraction(E0_keV: number, Ec_keV: number): number {
  const x = E0_keV / Math.max(Ec_keV, 1e-6);
  if (x < 1e-6) return 1;
  const sx = Math.sqrt(x);
  const val = (1 / x) * ((1 / 3) * Math.log((1 - sx + x) / Math.pow(1 + sx, 2)) +
    (2 / Math.sqrt(3)) * (Math.atan((2 * sx - 1) / Math.sqrt(3)) + Math.PI / 6));
  return Math.min(Math.max(val, 0), 1);
}

/**
 * Spitzer yavaşlama süresi (elektronlar üzerinde) — NRL Formulary:
 *  τ_se = 6.27e8 · A_f · T_e[eV]^1.5 / (Z_f² · n_e[cm^-3] · lnΛ)   [s]
 * Termalleşme süresi: τ_th = (τ_se/3) · ln(1 + (E_0/E_c)^1.5)
 */
export function slowingDownTime(Te_keV: number, ne: number, A_fast: number, Z_fast: number, E0_keV: number, Ec_keV: number): number {
  const lnL = coulombLog(ne, Te_keV);
  const tau_se = (6.27e8 * A_fast * Math.pow(Math.max(Te_keV, 0.01) * 1e3, 1.5)) / (Z_fast * Z_fast * ne * 1e-6 * lnL);
  return (tau_se / 3) * Math.log(1 + Math.pow(E0_keV / Math.max(Ec_keV, 1e-6), 1.5));
}

/** NBI shine-through — APPROXIMATION: exp(−n_e a σ_stop) ; σ_stop ~ 1e-20 m² /(E/100keV)^0.5 */
export function nbiShineThrough(ne: number, a: number, E_keV: number): number {
  const sigma = 4e-20 / Math.sqrt(Math.max(E_keV, 10) / 100);
  return Math.exp(-2 * a * ne * sigma);
}
