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

/** Füzyon reaksiyon enerjileri (MeV) — kaynak: Bosch & Hale 1994, Tablo I ve NRL Formulary */
export const FUSION = {
  DT: { Etot: 17.589, Echarged: 3.5, Eneutron: 14.1, products: 'He4 (3.5 MeV) + n (14.1 MeV)' },
  DD_pT: { Etot: 4.03, Echarged: 4.03, Eneutron: 0, products: 'T (1.01 MeV) + p (3.02 MeV)' },
  DD_nHe3: { Etot: 3.27, Echarged: 0.82, Eneutron: 2.45, products: 'He3 (0.82 MeV) + n (2.45 MeV)' },
  DHe3: { Etot: 18.35, Echarged: 18.35, Eneutron: 0, products: 'He4 (3.6 MeV) + p (14.7 MeV)' },
  pB11: { Etot: 8.68, Echarged: 8.68, Eneutron: 0, products: '3 He4 (8.68 MeV total)' },
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
