/**
 * Radyasyon kayıpları: Bremsstrahlung, senkrotron, safsızlık çizgi radyasyonu.
 * Tüm girişler SI (n [m^-3], T [keV], B [T], uzunluk [m]); çıkışlar W/m³ veya W.
 */
import { ImpuritySpecies, IMPURITIES } from './constants';

/**
 * Bremsstrahlung güç yoğunluğu [W/m³].
 * P_br = 5.35e-37 · n_e · Σ_j n_j Z_j² · sqrt(T_e)   (NRL Formulary 2022 s.58; Wesson §4.x)
 * Relativistik düzeltme (T_e ≳ 50 keV, p-B11 için kritik):
 *   Rider (1995) / Nevins (1998):  ×[1 + 0.7936 t + 1.874 t²] + e-e terimi (3/√2) t ,  t = T_e/m_e c²
 *   (Z_eff ağırlıklı: P = 5.35e-37 n_e² √T [ Z_eff(1+0.7936t+1.874t²) + (3/√2) t ])
 */
export function bremsstrahlung(ne: number, Te_keV: number, Zeff: number): number {
  if (Te_keV <= 0 || ne <= 0) return 0;
  const t = Te_keV / 510.99895;
  const rel = Zeff * (1 + 0.7936 * t + 1.874 * t * t) + (3 / Math.SQRT2) * t;
  return 5.35e-37 * ne * ne * Math.sqrt(Te_keV) * rel;
}

/**
 * Senkrotron (elektron siklotron) toplam gücü [W] — Albajar, Johner & Granata,
 * Nucl. Fusion 41 (2001) 665, Denk. (7),(13),(15),(16); duvar yansıması düzeltmesi
 * Fidone, Giruzzi & Granata, Nucl. Fusion 41 (2001) 1755 (üsler 0.62 ve 0.41).
 * PROCESS (Kovari 2014 §10) ile aynı biçim.
 *   T0 [keV], ne0 [1e20 m^-3] eksen değerleri; αn, αT profil üsleri: n ∝ (1−ρ²)^αn, T ∝ (1−ρ^βT)^αT
 */
export function synchrotronTotal(p: {
  R: number; a: number; kappa: number; B0: number;
  ne0_1e20: number; Te0_keV: number; alpha_n: number; alpha_T: number; beta_T?: number;
  wallReflectivity: number;
}): number {
  const { R, a, kappa, B0, ne0_1e20: ne0, Te0_keV: T0, alpha_n: an, wallReflectivity: Rw } = p;
  if (T0 <= 0 || ne0 <= 0 || B0 <= 0) return 0;
  const aT = Math.max(p.alpha_T, 0.1);
  const bT = Math.max(p.beta_T ?? 2, 0.5);
  const A = R / a;
  const pa0 = 6.04e3 * a * ne0 / B0; // opaklık parametresi (Denk. 7)
  const K = Math.pow(an + 3.87 * aT + 1.46, -0.79) * Math.pow(1.98 + aT, 1.36) * Math.pow(bT, 2.14) /
    Math.pow(Math.pow(bT, 1.53) + 1.87 * aT - 0.16, 1.33); // Denk. 13
  const G = 0.93 * (1 + 0.85 * Math.exp(-0.82 * A)); // Denk. 15
  const dum = Math.pow(1 + 0.12 * (T0 / Math.pow(pa0, 0.41)) * Math.pow(1 - Rw, 0.41), -1.51);
  const P_MW = 3.84e-8 * Math.pow(1 - Rw, 0.62) * R * Math.pow(a, 1.38) * Math.pow(kappa, 0.79) *
    Math.pow(B0, 2.62) * Math.pow(ne0, 0.38) * T0 * Math.pow(16 + T0, 2.61) * dum * K * G;
  return P_MW * 1e6;
}

/**
 * Koronal denge radyatif soğuma hızı L_z(T_e) [W m³] ve ortalama yük <Z>(T_e).
 * Kaynak: A.A. Mavrin, "Improved fits of coronal radiative cooling rates for
 * high-temperature plasmas", Radiat. Eff. Defects Solids 173 (2018) 388.
 *   log10(L_z) = Σ_i A_i X^i ,  X = log10(T_e[keV]),  0.1 ≤ T_e ≤ 100 keV
 * L_z çizgi + rekombinasyon + safsızlığın kendi brems'ini içerir (toplam radyasyon).
 * Katsayılar D0FUS (IRFM) ve TORAX (google-deepmind) açık kaynak kodlarındaki
 * kopyalarla çapraz kontrol edilmiş.
 */
type Seg = [number, number, number[]]; // [Tmin, Tmax, A0..A4]
const MAVRIN_LZ: Record<string, Seg[]> = {
  He: [[0.1, 100, [-3.5551e1, 3.1469e-1, 1.0156e-1, -9.373e-2, 2.502e-2]]],
  Be: [[0.1, 100, [-3.4765e1, 3.727e-2, 3.8363e-1, -2.1384e-1, 4.169e-2]]],
  C: [
    [0.1, 0.5, [-3.4738e1, -5.0085, -1.2788e1, -1.6637e1, -7.2904]],
    [0.5, 100, [-3.4174e1, -3.6687e-1, 6.8856e-1, -2.9191e-1, 4.447e-2]],
  ],
  Ne: [
    [0.1, 0.7, [-3.3132e1, 1.7309, 1.523e1, 2.8939e1, 1.5648e1]],
    [0.7, 5.0, [-3.329e1, -8.775e-1, 8.6842e-1, -3.9544e-1, 1.7244e-1]],
    [5.0, 100, [-3.341e1, -4.5345e-1, 2.9731e-1, 4.396e-2, -2.693e-2]],
  ],
  Ar: [
    [0.1, 0.6, [-3.2155e1, 6.5221, 3.0769e1, 3.9161e1, 1.5353e1]],
    [0.6, 3.0, [-3.253e1, 5.449e-1, 1.5389, -7.6887, 4.9806]],
    [3.0, 100, [-3.1853e1, -1.6674, 6.1339e-1, 1.748e-1, -8.226e-2]],
  ],
  W: [
    [0.1, 1.5, [-3.0374e1, 3.8304e-1, -9.5126e-1, -1.0311, -1.0103e-1]],
    [1.5, 4.0, [-3.0238e1, -2.9208, 2.2824e1, -6.3303e1, 5.1849e1]],
    [4.0, 100, [-3.2153e1, 5.2499, -6.274, 2.6627, -3.6759e-1]],
  ],
};

// <Z>(Te) — Mavrin 2018; katsayılar AZALAN derece sırasında (a4 X^4 + ... + a0)
const MAVRIN_Z: Record<string, { bounds: number[]; rows: number[][] }> = {
  C: { bounds: [0.7], rows: [[-7.2007, -1.2217e1, -7.3521, -1.7632, 5.8588], [0, 0, 0, 0, 6]] },
  Ne: { bounds: [0.5, 2.0], rows: [[-2.5303e1, -6.4696e1, -5.3631e1, -1.3242e1, 8.9737], [-7.0678, 3.6868, -8.0723e-1, 2.1413e-1, 9.9532], [0, 0, 0, 0, 10]] },
  Ar: { bounds: [0.6, 3.0], rows: [[6.8717, -1.1595e1, -4.3776e1, -2.0781e1, 1.3171e1], [-4.883e-2, 1.8455, 2.5023, 1.1413, 1.5986e1], [-5.9213e-1, 3.5667, -8.0048, 7.9986, 1.4948e1]] },
  W: { bounds: [1.5, 4.0], rows: [[1.6823e1, 3.4582e1, 2.1027e1, 1.6518e1, 2.6703e1], [-2.5887e2, -1.0577e1, 2.5532e2, -7.9611e1, 3.6902e1], [1.5119e1, -8.4207e1, 1.5985e2, -1.0011e2, 6.3795e1]] },
};

/** L_z [W m³] — T_e 0.1–100 keV dışında en yakın uca kenetlenir (APPROXIMATION) */
export function coolingRate(species: ImpuritySpecies | 'He', Te_keV: number): number {
  const segs = MAVRIN_LZ[species];
  if (!segs) return 0;
  const T = Math.min(Math.max(Te_keV, 0.1), 100);
  const X = Math.log10(T);
  let seg = segs[segs.length - 1];
  for (const s of segs) if (T >= s[0] && T <= s[1]) { seg = s; break; }
  const A = seg[2];
  const l = A[0] + X * (A[1] + X * (A[2] + X * (A[3] + X * A[4])));
  return Math.pow(10, l);
}

/** Ortalama yük durumu <Z>(T_e); He/Be tam soyulmuş kabul edilir */
export function meanCharge(species: ImpuritySpecies | 'He', Te_keV: number): number {
  if (species === 'He') return 2;
  if (species === 'Be') return 4;
  const d = MAVRIN_Z[species];
  const Znuc = IMPURITIES[species].Z;
  if (!d) return Znuc;
  const T = Math.min(Math.max(Te_keV, 0.1), 100);
  const X = Math.log10(T);
  let k = 0;
  while (k < d.bounds.length && T > d.bounds[k]) k++;
  const r = d.rows[k];
  const Z = r[4] + X * (r[3] + X * (r[2] + X * (r[1] + X * r[0])));
  return Math.min(Math.max(Z, 0), Znuc);
}

/** Çizgi radyasyon güç yoğunluğu [W/m³] = n_e n_z L_z */
export function lineRadiation(ne: number, nz: number, species: ImpuritySpecies, Te_keV: number): number {
  return ne * nz * coolingRate(species, Te_keV);
}
