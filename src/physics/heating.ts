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
 * Spitzer slowing-down time (on electrons) — NRL Formulary:
 *  τ_se = 6.27e8 · A_f · T_e[eV]^1.5 / (Z_f² · n_e[cm^-3] · lnΛ)   [s]
 * Energy loss of a fast ion (Stix, Plasma Phys. 14 (1972) 367):
 *  dE/dt = −(2E/τ_se) · [1 + (E_c/E)^{3/2}]
 */
export function spitzerSlowingDownTime(Te_keV: number, ne: number, A_fast: number, Z_fast: number): number {
  const lnL = coulombLog(ne, Te_keV);
  return (6.27e8 * A_fast * Math.pow(Math.max(Te_keV, 0.01) * 1e3, 1.5)) / (Z_fast * Z_fast * ne * 1e-6 * lnL);
}

/**
 * Thermalisation time (E_0 → 0): τ_th = (τ_se/3) · ln(1 + (E_0/E_c)^1.5).
 * The fast-ion DENSITY of a steady source is n_f = S · τ_th (for beam-target fusion).
 */
export function slowingDownTime(Te_keV: number, ne: number, A_fast: number, Z_fast: number, E0_keV: number, Ec_keV: number): number {
  const tau_se = spitzerSlowingDownTime(Te_keV, ne, A_fast, Z_fast);
  return (tau_se / 3) * Math.log(1 + Math.pow(E0_keV / Math.max(Ec_keV, 1e-6), 1.5));
}

/**
 * ENERGY content of the steady slowing-down distribution / source power [s]:
 *  τ_W = W_f / P_f = (1/E_0) ∫₀^{E_0} E dE / |dE/dt| = (τ_se/2) · (1 − G(E_0/E_c))
 * (the direct integral of the Stix loss law above; G = ionHeatingFraction). The 0D fast-ion
 * pool dW_f/dt = P_f − W_f/τ_W gives, in steady state, the correct stored energy (fast-particle pressure)
 * and the correct heating power (P_f). APPROXIMATION: velocity-space diffusion and the thermal tail are neglected,
 * no fast-ion loss.
 */
export function fastIonEnergyTime(Te_keV: number, ne: number, A_fast: number, Z_fast: number, E0_keV: number, Ec_keV: number): number {
  const tau_se = spitzerSlowingDownTime(Te_keV, ne, A_fast, Z_fast);
  return 0.5 * tau_se * (1 - ionHeatingFraction(E0_keV, Ec_keV));
}

/** One fast-ion species: birth energy and source power (power weight) */
export interface FastSpecies {
  A: number;
  Z: number;
  E0_keV: number;
  /** source power [W] (used only as a weight) */
  P: number;
}

/**
 * Power-weighted Stix quantities of fast species that feed the same pool (e.g. the α and p of D-³He):
 *  G = Σ P_k G_k / Σ P_k ,  τ_W = Σ P_k τ_W,k / Σ P_k  (in steady state W = Σ P_k τ_W,k).
 * E_c,k = criticalEnergy(T_e, A_k, ionSum). Equal weights if all powers are zero.
 */
export function fastPoolMix(species: readonly FastSpecies[], Te_keV: number, ne: number, ionSum: number): { G: number; tauW: number } {
  let wSum = 0, G = 0, tauW = 0;
  const equal = species.every((s) => !(s.P > 0));
  for (const s of species) {
    const w = equal ? 1 : Math.max(s.P, 0);
    if (w === 0) continue;
    const Ec = criticalEnergy(Te_keV, s.A, ionSum);
    G += w * ionHeatingFraction(s.E0_keV, Ec);
    tauW += w * fastIonEnergyTime(Te_keV, ne, s.A, s.Z, s.E0_keV, Ec);
    wSum += w;
  }
  return wSum > 0 ? { G: G / wSum, tauW: tauW / wSum } : { G: 0, tauW: 0 };
}

/** NBI shine-through — APPROXIMATION: exp(−n_e a σ_stop) ; σ_stop ~ 1e-20 m² /(E/100keV)^0.5 */
export function nbiShineThrough(ne: number, a: number, E_keV: number): number {
  const sigma = 4e-20 / Math.sqrt(Math.max(E_keV, 10) / 100);
  return Math.exp(-2 * a * ne * sigma);
}
