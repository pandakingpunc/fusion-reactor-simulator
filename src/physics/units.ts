/**
 * Birim dönüşümleri — TEK YER. Fizik kodu SI kullanır (J, m^-3, W, s, T);
 * arayüz keV / °C / MW / 1e20 m^-3 gösterir. Dönüşümler burada toplanır.
 */
import { C } from './constants';

export const U = {
  keV_to_J: (keV: number) => keV * C.keV_J,
  J_to_keV: (J: number) => J / C.keV_J,
  keV_to_K: (keV: number) => keV * C.keV_K,
  keV_to_C: (keV: number) => keV * C.keV_K - 273.15,
  keV_to_MC: (keV: number) => (keV * C.keV_K - 273.15) / 1e6, // milyon °C
  MeV_to_J: (MeV: number) => MeV * C.MeV_J,
  W_to_MW: (W: number) => W / 1e6,
  MW_to_W: (MW: number) => MW * 1e6,
  J_to_MJ: (J: number) => J / 1e6,
  J_to_GJ: (J: number) => J / 1e9,
  n_to_1e20: (n: number) => n / 1e20,
  n_to_1e19: (n: number) => n / 1e19,
  n1e20_to_SI: (n20: number) => n20 * 1e20,
  A_to_MA: (A: number) => A / 1e6,
  MA_to_A: (MA: number) => MA * 1e6,
  m3_to_cm3: (m3: number) => m3 * 1e6,
  cm3_to_m3: (cm3: number) => cm3 * 1e-6,
  /** cm^3/s -> m^3/s (reaktivite) */
  sigv_cgs_to_SI: (sv: number) => sv * 1e-6,
  /** g/cm^2 -> kg/m^2 */
  gcm2_to_SI: (x: number) => x * 10,
  kgm2_to_gcm2: (x: number) => x / 10,
  Pa_to_Gbar: (p: number) => p / 1e14,
  Pa_to_atm: (p: number) => p / 101325,
} as const;

/** Sayı biçimlendirme (mono gösterim için) */
export function fmt(x: number, digits = 3): string {
  if (!isFinite(x)) return '—';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e5 || ax < 1e-3) return x.toExponential(digits - 1);
  return x.toPrecision(digits);
}
export function fmtFixed(x: number, d = 2): string {
  if (!isFinite(x)) return '—';
  return x.toFixed(d);
}
