/**
 * Fiziksel sabitler — tümü SI.
 * Kaynak: CODATA 2018.
 */
export const C = {
  e: 1.602176634e-19, // C, elementer yük
  kB: 1.380649e-23, // J/K
  me: 9.1093837015e-31, // kg
  mp: 1.67262192369e-27, // kg
  amu: 1.66053906660e-27, // kg
  eps0: 8.8541878128e-12, // F/m
  mu0: 1.25663706212e-6, // H/m
  c: 299792458, // m/s
  h: 6.62607015e-34, // J s
  keV_J: 1.602176634e-16, // J per keV
  MeV_J: 1.602176634e-13, // J per MeV
  eV_K: 11604.51812, // K per eV
  keV_K: 11604518.12, // K per keV (1 keV = 11.6 milyon K)
  me_c2_keV: 510.99895, // keV
} as const;

/** Safsızlık iyonlarının atom numaraları ve kütleleri */
export const IMPURITIES = {
  Be: { Z: 4, A: 9.012, name: 'Beryllium' },
  C: { Z: 6, A: 12.011, name: 'Carbon' },
  Ne: { Z: 10, A: 20.18, name: 'Neon' },
  Ar: { Z: 18, A: 39.948, name: 'Argon' },
  W: { Z: 74, A: 183.84, name: 'Tungsten' },
} as const;
export type ImpuritySpecies = keyof typeof IMPURITIES;
