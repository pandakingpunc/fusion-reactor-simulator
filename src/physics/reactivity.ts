/**
 * Füzyon reaktivitesi <σv>(T) — Maxwell dağılımı.
 *
 * Kaynak: H.-S. Bosch & G.M. Hale, "Improved formulas for fusion cross-sections
 * and thermal reactivities", Nucl. Fusion 32 (1992) 611, Tablo VII.
 *   <σv> = C1 · θ · sqrt(ξ / (m_r c² T³)) · exp(−3ξ)      [cm³/s], T [keV]
 *   θ = T / (1 − T(C2 + T(C4 + T·C6)) / (1 + T(C3 + T(C5 + T·C7))))
 *   ξ = (B_G² / (4θ))^(1/3)
 *
 * p-11B: W.M. Nevins & R. Swain, Nucl. Fusion 40 (2000) 865 — bkz. aşağıda.
 */
import { U } from './units';

export type FuelType = 'DT' | 'DD' | 'DHe3' | 'pB11';

interface BHCoeffs {
  BG: number; // keV^1/2
  mrc2: number; // keV
  C: [number, number, number, number, number, number, number];
  Tmin: number; // keV, geçerlilik
  Tmax: number;
}

/** Bosch-Hale 1992, Tablo VII */
const BH: Record<'DT' | 'DD_pT' | 'DD_nHe3' | 'DHe3', BHCoeffs> = {
  // T(d,n)4He
  DT: {
    BG: 34.3827,
    mrc2: 1124656,
    C: [1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35e-2, -1.0675e-4, 1.366e-5],
    Tmin: 0.2,
    Tmax: 100,
  },
  // D(d,p)T
  DD_pT: {
    BG: 31.397,
    mrc2: 937814,
    C: [5.65718e-12, 3.41267e-3, 1.99167e-3, 0, 1.0506e-5, 0, 0],
    Tmin: 0.2,
    Tmax: 100,
  },
  // D(d,n)3He
  DD_nHe3: {
    BG: 31.397,
    mrc2: 937814,
    C: [5.4336e-12, 5.85778e-3, 7.68222e-3, 0, -2.964e-6, 0, 0],
    Tmin: 0.2,
    Tmax: 100,
  },
  // 3He(d,p)4He
  DHe3: {
    BG: 68.7508,
    mrc2: 1124572,
    C: [5.51036e-10, 6.41918e-3, -2.02896e-3, -1.9108e-5, 1.35776e-4, 0, 0],
    Tmin: 0.5,
    Tmax: 190,
  },
};

function boschHale(c: BHCoeffs, T_keV: number): number {
  if (T_keV <= 0) return 0;
  // APPROXIMATION: geçerlilik aralığı dışında fit uzatılır (T<Tmin için exp(-3ξ) zaten ~0 verir)
  const T = Math.min(T_keV, c.Tmax * 1.5);
  const [C1, C2, C3, C4, C5, C6, C7] = c.C;
  const theta = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))));
  if (theta <= 0) return 0;
  const xi = Math.cbrt((c.BG * c.BG) / (4 * theta));
  return C1 * theta * Math.sqrt(xi / (c.mrc2 * T * T * T)) * Math.exp(-3 * xi);
}

/** Bosch-Hale <σv> [m³/s] */
export const sigmav = {
  DT: (T: number) => U.sigv_cgs_to_SI(boschHale(BH.DT, T)),
  DD_pT: (T: number) => U.sigv_cgs_to_SI(boschHale(BH.DD_pT, T)),
  DD_nHe3: (T: number) => U.sigv_cgs_to_SI(boschHale(BH.DD_nHe3, T)),
  DD_total: (T: number) => U.sigv_cgs_to_SI(boschHale(BH.DD_pT, T) + boschHale(BH.DD_nHe3, T)),
  DHe3: (T: number) => U.sigv_cgs_to_SI(boschHale(BH.DHe3, T)),
  pB11: (T: number) => U.sigv_cgs_to_SI(pB11_cgs(T)),
};

/**
 * Bosch-Hale 1992 Tablo IV — tesir kesiti:
 *   σ(E) = S(E) / (E · exp(B_G/√E))   [mb],  E = kütle-merkezi enerjisi [keV]
 *   S(E) = (A1 + E(A2 + E(A3 + E(A4 + E A5)))) / (1 + E(B1 + E(B2 + E(B3 + E B4))))
 * Geçerlilik: D-T 0.5–550 keV, D-D 0.5–5000 keV, D-He3 0.3–900 keV.
 * APPROXIMATION: üst sınırın ötesinde E sabitlenir (yüksek enerjide σ zaten yavaş değişir).
 */
const BH_SIGMA: Record<'DT' | 'DD_pT' | 'DD_nHe3' | 'DHe3', { BG: number; A: number[]; B: number[]; Emax: number }> = {
  DT: { BG: 34.3827, A: [6.927e4, 7.454e8, 2.05e6, 5.2002e4, 0], B: [6.38e1, -9.95e-1, 6.981e-5, 1.728e-4], Emax: 550 },
  DD_pT: { BG: 31.397, A: [5.5576e4, 2.1054e2, -3.2638e-2, 1.4987e-6, 1.8181e-10], B: [0, 0, 0, 0], Emax: 5000 },
  DD_nHe3: { BG: 31.397, A: [5.3701e4, 3.3027e2, -1.2706e-1, 2.9327e-5, -2.5151e-9], B: [0, 0, 0, 0], Emax: 4900 },
  DHe3: { BG: 68.7508, A: [5.7501e6, 2.5226e3, 4.5566e1, 0, 0], B: [-3.1995e-3, -8.553e-6, 5.9014e-8, 0], Emax: 900 },
};

/** Tesir kesiti [m²], E kütle-merkezi [keV] */
export function crossSection(ch: keyof typeof BH_SIGMA, E_cm_keV: number): number {
  const c = BH_SIGMA[ch];
  const E = Math.min(Math.max(E_cm_keV, 0.3), c.Emax);
  const [A1, A2, A3, A4, A5] = c.A;
  const [B1, B2, B3, B4] = c.B;
  const S = (A1 + E * (A2 + E * (A3 + E * (A4 + E * A5)))) / (1 + E * (B1 + E * (B2 + E * (B3 + E * B4))));
  const sigma_mb = S / (E * Math.exp(c.BG / Math.sqrt(E)));
  return sigma_mb * 1e-31; // 1 mb = 1e-31 m²
}

/**
 * Beam-target reactivity: averaged over the slowing-down distribution of the fast ion.
 * For a steady source f(E) ∝ dt/dE ∝ 1 / (E (1 + (E_c/E)^{3/2})) · E^{1/2}  (Stix 1972)
 *   <σv>_bt = ∫ σ(E_cm) v_b(E) f(E) dE / ∫ f(E) dE ,  E_cm = E_lab · m_t/(m_b + m_t)
 * The target is the second reactant of the channel: species a in the a+a channels (D-D, the D-D side branches of D-³He)
 * (E_cm = E_lab/2), species b in the others. For the target density see beamTargetDensity.
 * APPROXIMATION: the target ions are at rest (E_b ≫ T_i), the beam is isotropic, 48-point log grid.
 * Returns an array of m³/s per channel (in FUEL_CHANNELS order).
 */
export function beamTargetReactivity(fuel: FuelType, E0_lab_keV: number, Ec_keV: number, Ti_keV: number): number[] {
  const sp = FUEL_SPECIES[fuel];
  const mb = sp.a.A, mt = sp.b.A; // demet = tür a (D veya p)
  const chans = FUEL_CHANNELS[fuel];
  const keys: Record<FuelType, (keyof typeof BH_SIGMA | 'pB11')[]> = { DT: ['DT'], DD: ['DD_pT', 'DD_nHe3'], DHe3: ['DHe3', 'DD_pT', 'DD_nHe3'], pB11: ['pB11'] };
  const Emin = Math.max(1.5 * Ti_keV, 1);
  if (E0_lab_keV <= Emin) return chans.map(() => 0);
  const N = 48;
  const lnMin = Math.log(Emin), lnMax = Math.log(E0_lab_keV);
  const num = chans.map(() => 0);
  let den = 0;
  const amu = 1.66053906660e-27, keVJ = 1.602176634e-16;
  for (let i = 0; i < N; i++) {
    const E = Math.exp(lnMin + ((i + 0.5) / N) * (lnMax - lnMin));
    const dE = E * (lnMax - lnMin) / N;
    const f = Math.sqrt(E) / (Math.pow(E, 1.5) + Math.pow(Ec_keV, 1.5));
    const v = Math.sqrt((2 * E * keVJ) / (mb * amu));
    const EcmAB = (E * mt) / (mb + mt), EcmAA = E / 2;
    den += f * dE;
    keys[fuel].forEach((k, j) => {
      const Ecm = chans[j].sameSpecies ? EcmAA : EcmAB;
      const sig = k === 'pB11' ? pB11_sigma_m2(Ecm) : crossSection(k, Ecm);
      num[j] += sig * v * f * dE;
    });
  }
  return num.map((x) => x / den);
}

/**
 * p-11B reaktivitesi — tesir kesitinden DOĞRUDAN Maxwell integrali.
 *
 * Tesir kesiti S-faktörü fiti: H.-Y. Wang, Y.-Q. Li, Q. Wu, Z.-F. Cui,
 * "Revisiting p-11B Fusion: Updated Cross-sections, Reactivity, and Energy Balance",
 * arXiv:2601.00241 (2026), Tablo 1 ve Denk. (1)-(5). Düşük enerji kısmı
 * (E ≤ 400 keV) Nevins & Swain (Nucl. Fusion 40 (2000) 865) S-faktörü ile aynıdır:
 *   S(E) = C0 + C1·E + C2·E² + A_L / ((E−E_L)² + δE_L²)     [MeV b], E keV
 *   σ(E) = S(E)/E · exp(−sqrt(E_G/E)),  E_G = 22.589 MeV (Gamow enerjisi)
 * Reaktivite (Denk. 6):
 *   <σv> = sqrt(8/(π μ)) · (kT)^(-3/2) · ∫ σ(E) E exp(−E/kT) dE
 *
 * NOT: Bu, Nevins-Swain (2000) fitinden T>100 keV'de ~%10-30 daha yüksek reaktivite
 * verir (Sikora-Weller 2016 tesir kesitleri dahil). p-B11 için sonuç yine de
 * "ateşlenmez"e yakındır — kayırma yok, güncel veri kullanıldı.
 */
const PB = {
  EG_MeV: 22.589,
  // E ≤ 0.4 MeV (Denk. 3), E keV cinsinden
  C0: 197, C1: 0.24, C2: 2.31e-4, AL: 1.82e4, EL: 148, dEL: 2.35,
  // 0.4 < E ≤ 0.7 MeV (Denk. 4), x = (E−400 keV)/100 keV
  D0: 330.2, D1: 102.436, D2: -58.481, D5: 0.0933,
  // 0.7 < E ≤ 10 MeV (Denk. 5), Breit-Wigner toplamı, E keV
  B: 0.209689,
  A: [2.0235e6, 4.0102e6, 1.322e6, 4.9451e6, 4.343e5],
  E: [622.2, 1388.4, 2492.4, 3528.6, 4703.6],
  dE: [99.6, 449.9, 238.6, 398.5, 152.5],
} as const;

/** S-faktörü [MeV b], E kütle merkezi enerjisi [keV] */
function pB11_Sfactor_MeVb(E_keV: number): number {
  if (E_keV <= 400) {
    const d = E_keV - PB.EL;
    return PB.C0 + PB.C1 * E_keV + PB.C2 * E_keV * E_keV + PB.AL / (d * d + PB.dEL * PB.dEL);
  }
  if (E_keV <= 700) {
    const x = (E_keV - 400) / 100;
    return PB.D0 + PB.D1 * x + PB.D2 * x * x + PB.D5 * x ** 5;
  }
  let s = PB.B;
  for (let k = 0; k < 5; k++) {
    const d = E_keV - PB.E[k];
    s += PB.A[k] / (d * d + PB.dE[k] * PB.dE[k]);
  }
  return s;
}

/** σ(E) [m²], E [keV] */
export function pB11_sigma_m2(E_keV: number): number {
  if (E_keV <= 0) return 0;
  const E_MeV = E_keV / 1000;
  const S = pB11_Sfactor_MeVb(E_keV);
  const sigma_b = (S / E_MeV) * Math.exp(-Math.sqrt(PB.EG_MeV / E_MeV));
  return sigma_b * 1e-28;
}

// Maxwell ortalaması: T 1 keV..2000 keV log tablo, modül yüklenirken hesaplanır.
const PB_MU_KG = ((1.007276 * 11.00931) / (1.007276 + 11.00931)) * 1.66053906660e-27;
const PB_TABLE_N = 160;
const PB_LOGT_MIN = Math.log(1), PB_LOGT_MAX = Math.log(2000);
const PB_TABLE: Float64Array = (() => {
  const out = new Float64Array(PB_TABLE_N);
  const keV_J = 1.602176634e-16;
  for (let i = 0; i < PB_TABLE_N; i++) {
    const T = Math.exp(PB_LOGT_MIN + ((PB_LOGT_MAX - PB_LOGT_MIN) * i) / (PB_TABLE_N - 1)); // keV
    // ∫ σ(E) E exp(−E/T) dE , E: 0.5 keV .. 40 T (log adım, yamuk)
    const N = 2000;
    const lo = Math.log(0.5), hi = Math.log(Math.max(40 * T, 6000));
    let sum = 0;
    let prev = 0;
    for (let j = 0; j <= N; j++) {
      const lnE = lo + ((hi - lo) * j) / N;
      const E = Math.exp(lnE);
      const f = pB11_sigma_m2(E) * E * Math.exp(-E / T) * E; // dE = E dlnE
      if (j > 0) sum += 0.5 * (f + prev) * ((hi - lo) / N);
      prev = f;
    }
    // birimler: σ[m²]·E[keV]·dE[keV] → keV² m²;  (kT)^-3/2 → keV^-3/2 ; sqrt(8/(π μ)) → 1/sqrt(kg)
    // <σv> = sqrt(8/(πμ)) (kT)^{-3/2} ∫σ E e^{-E/kT} dE  , E'yi J'e çevir: keV² → J²·(keV_J)², (kT)^-3/2 → keV_J^-3/2
    const integral_J2 = sum * keV_J * keV_J; // m² J²
    const kT_J = T * keV_J;
    out[i] = Math.sqrt(8 / (Math.PI * PB_MU_KG)) * Math.pow(kT_J, -1.5) * integral_J2; // m³/s
  }
  return out;
})();

function pB11_SI(T_keV: number): number {
  if (T_keV <= 0) return 0;
  const lnT = Math.log(Math.min(Math.max(T_keV, 1), 2000));
  const x = ((lnT - PB_LOGT_MIN) / (PB_LOGT_MAX - PB_LOGT_MIN)) * (PB_TABLE_N - 1);
  const i = Math.min(Math.floor(x), PB_TABLE_N - 2);
  const f = x - i;
  const v = Math.exp(Math.log(PB_TABLE[i]) * (1 - f) + Math.log(PB_TABLE[i + 1]) * f);
  // T < 1 keV: exp(-3ξ) davranışı ile aşağı uzat (pratikte 0)
  if (T_keV < 1) return v * Math.exp(-3 * (Math.cbrt(22589 / (4 * T_keV)) - Math.cbrt(22589 / 4)));
  return v;
}

function pB11_cgs(T_keV: number): number {
  return pB11_SI(T_keV) * 1e6;
}

/** Charged fusion product (at birth): mass [amu], charge, kinetic energy [MeV] */
export interface ChargedProduct {
  name: string;
  A: number;
  Z: number;
  E_MeV: number;
}

/** Bir reaksiyon için (E_total, E_charged, E_neutron) MeV ve <σv> */
export interface FuelChannel {
  name: string;
  Etot_MeV: number;
  Echarged_MeV: number;
  Eneutron_MeV: number;
  /**
   * true: both reactants are species a (a + a, rate ½ n_a² ⟨σv⟩); false: a + b (n_a n_b ⟨σv⟩).
   * In a single-species fuel (D-D: a and b are both deuterium) n_a + n_b is used instead of n_a —
   * see pairDensity / isSingleSpecies.
   */
  sameSpecies: boolean;
  sigmav: (T: number) => number;
  /**
   * Charged products and their birth energies (Σ E = Echarged). The Stix critical energy of the fast-product pool,
   * the ion-heating fraction G and the slowing-down time are computed per product and power-weighted.
   * The energies follow from two-body kinematics (E_1 = Q m_2/(m_1+m_2)); the 3 α of p-¹¹B share equally
   * (APPROXIMATION: the real α spectrum is broad). The D-T α has 3.561 MeV, see DT_ALPHA_MEV.
   */
  products: ChargedProduct[];
  /**
   * Particles per reaction for the ash counter (n_He): D-T, D-³He → 1 ⁴He; p-¹¹B → 3 ⁴He;
   * D-D branches → ½ (APPROXIMATION: the ³He/T/p products are not tracked separately, half of them dilutes like ash).
   */
  ash: number;
}

/**
 * D + T → ⁴He + n, reactants at rest: Q = 17.589 MeV (AME2020 atomic masses, Huang et al. and Wang et al., Chin. Phys. C 45
 * (2021) 030002 and 030003) shared by exact relativistic two-body kinematics, T_n = Q (Q + 2 m_α)/(2 (m_n + m_α + Q)):
 * 14.028 MeV for the neutron and 3.561 MeV for the ⁴He nucleus (T_α = Q − T_n; nuclear masses = atomic masses minus the
 * electrons). The round 3.5 + 14.1 MeV of the textbooks (sum 17.6 MeV) and the 3.52 + 14.07 MeV of the integer mass-number
 * rule Q/5 : 4Q/5 are 1.7 % and 1.2 % below the alpha energy: v3.0.0 used 3.5 + 14.1, so its P_charged + P_neutron
 * was 1.000625 P_fusion and its alpha heating 1.7 % low. reference/reactivity.test.ts recomputes the split from the masses.
 */
const DT_ALPHA_MEV = 3.561, DT_NEUTRON_MEV = 14.028;

// charged products (nuclear masses, amu — CODATA 2018)
const ALPHA = (E_MeV: number): ChargedProduct => ({ name: 'He4', A: 4.001506, Z: 2, E_MeV });
const PROTON = (E_MeV: number): ChargedProduct => ({ name: 'p', A: 1.007276, Z: 1, E_MeV });
const TRITON = (E_MeV: number): ChargedProduct => ({ name: 'T', A: 3.015501, Z: 1, E_MeV });
const HELION = (E_MeV: number): ChargedProduct => ({ name: 'He3', A: 3.014932, Z: 2, E_MeV });

const DD_PT: FuelChannel = { name: 'D+D→p+T', Etot_MeV: 4.03, Echarged_MeV: 4.03, Eneutron_MeV: 0, sameSpecies: true, sigmav: sigmav.DD_pT, products: [PROTON(3.02), TRITON(1.01)], ash: 0.5 };
const DD_NHE3: FuelChannel = { name: 'D+D→n+He3', Etot_MeV: 3.27, Echarged_MeV: 0.82, Eneutron_MeV: 2.45, sameSpecies: true, sigmav: sigmav.DD_nHe3, products: [HELION(0.82)], ash: 0.5 };

/**
 * Reaction channels per fuel; the main reaction is always first.
 * D-³He includes the deuterium reactions of its own (D(d,p)T and D(d,n)³He) as side branches: they are the only
 * neutron source of this fuel (reaction energies: J. Wesson, "Tokamaks", 4th ed., OUP 2011, ch. 1;
 * reactivities: Bosch & Hale 1992). APPROXIMATION: the secondary burn of the T and ³He products of the side
 * branches (D-T, D-³He) is not tracked — the products are assumed to be pumped out without returning as fuel.
 */
export const FUEL_CHANNELS: Record<FuelType, FuelChannel[]> = {
  DT: [{ name: 'D+T', Etot_MeV: 17.589, Echarged_MeV: DT_ALPHA_MEV, Eneutron_MeV: DT_NEUTRON_MEV, sameSpecies: false, sigmav: sigmav.DT, products: [ALPHA(DT_ALPHA_MEV)], ash: 1 }],
  DD: [DD_PT, DD_NHE3],
  DHe3: [
    { name: 'D+He3', Etot_MeV: 18.35, Echarged_MeV: 18.35, Eneutron_MeV: 0, sameSpecies: false, sigmav: sigmav.DHe3, products: [ALPHA(3.67), PROTON(14.68)], ash: 1 },
    DD_PT, DD_NHE3,
  ],
  pB11: [{ name: 'p+B11', Etot_MeV: 8.68, Echarged_MeV: 8.68, Eneutron_MeV: 0, sameSpecies: false, sigmav: sigmav.pB11, products: [ALPHA(8.68 / 3), ALPHA(8.68 / 3), ALPHA(8.68 / 3)], ash: 3 }],
};

/** Yakıt bileşenlerinin yükleri ve kütleleri (amu) */
export const FUEL_SPECIES: Record<FuelType, { a: { Z: number; A: number; label: string }; b: { Z: number; A: number; label: string }; fracA: number }> = {
  DT: { a: { Z: 1, A: 2.014, label: 'D' }, b: { Z: 1, A: 3.016, label: 'T' }, fracA: 0.5 },
  DD: { a: { Z: 1, A: 2.014, label: 'D' }, b: { Z: 1, A: 2.014, label: 'D' }, fracA: 1.0 },
  DHe3: { a: { Z: 1, A: 2.014, label: 'D' }, b: { Z: 2, A: 3.016, label: 'He3' }, fracA: 0.5 },
  pB11: { a: { Z: 1, A: 1.007, label: 'p' }, b: { Z: 5, A: 11.009, label: 'B11' }, fracA: 0.85 }, // p zengin karışım tipik (Z_eff azaltmak için)
};

/** Single-species fuel (a and b are the same nucleus: D-D): the reacting density is n_a + n_b. */
export function isSingleSpecies(fuel: FuelType): boolean {
  return FUEL_SPECIES[fuel].a.label === FUEL_SPECIES[fuel].b.label;
}

/**
 * Reaction-rate density / ⟨σv⟩ [m⁻⁶]: ½ n_a² for an a+a channel, n_a n_b for a+b.
 * In a single-species fuel (D-D) n_a + n_b replaces n_a: the split between the slots (fuelFracA) does not change the physics.
 */
export function pairDensity(fuel: FuelType, ch: FuelChannel, na: number, nb: number): number {
  if (!ch.sameSpecies) return na * nb;
  const nD = isSingleSpecies(fuel) ? na + nb : na;
  return 0.5 * nD * nD;
}

/** Target density in a beam-target reaction (beam = species a): a+a channel → species a (n_a + n_b in D-D), otherwise species b. */
export function beamTargetDensity(fuel: FuelType, ch: FuelChannel, na: number, nb: number): number {
  if (!ch.sameSpecies) return nb;
  return isSingleSpecies(fuel) ? na + nb : na;
}

/**
 * Fuel consumed per reaction [Δn_a, Δn_b]: one ion of each for an a+b channel; two species-a ions for an a+a channel
 * (in a single-species fuel shared between the two slots in proportion to their densities).
 */
export function burnPerReaction(fuel: FuelType, ch: FuelChannel, na: number, nb: number): [number, number] {
  if (!ch.sameSpecies) return [1, 1];
  if (!isSingleSpecies(fuel)) return [2, 0];
  const n = na + nb;
  if (n <= 0) return [2, 0];
  return [(2 * na) / n, (2 * nb) / n];
}
