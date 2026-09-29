/**
 * Enerji hapsetme süresi ölçeklemeleri ve L-H geçiş eşiği.
 * Girdiler: Ip [MA], B [T], n [m^-3], P [W], R,a [m], κ, M [amu]. Çıkış: τ_E [s].
 */
import { Geometry } from './geometry';

export type ConfinementScaling = 'IPB98y2' | 'ITPA20' | 'ITPA20-IL' | 'ITER89P' | 'ISS04' | 'ST_Valovic' | 'Bohm' | 'Pastukhov';

/**
 * ITER IPB98(y,2) ELMy H-mode ölçeklemesi — ITER Physics Basis, Nucl. Fusion 39 (1999) 2175,
 * Böl. 2, Denk. (20):
 *  τ_E,th = 0.0562 · I^0.93 · B^0.15 · n19^0.41 · P^-0.69 · R^1.97 · κ_a^0.78 · ε^0.58 · M^0.19
 *  (I MA, B T, n 10^19 m^-3, P MW, R m, κ_a = S/(πa²) alan elongasyonu)
 */
export function tauIPB98y2(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  const eps = g.a / g.R;
  return 0.0562 * Math.pow(Ip_MA, 0.93) * Math.pow(B, 0.15) * Math.pow(n19, 0.41) * Math.pow(P_MW, -0.69) *
    Math.pow(g.R, 1.97) * Math.pow(g.kappa, 0.78) * Math.pow(eps, 0.58) * Math.pow(M, 0.19);
}

/**
 * H-mode scalings in power-law form as data (for later models / comparison):
 *  τ_E = C · I^αI · B^αB · n19^αn · P^αP · R^αR · κ_a^ακ · ε^αε · M^αM · (1+δ)^αδ
 *  (I MA, B T, n19 10^19 m^-3 line-averaged, P MW loss power, R m, κ_a area elongation, ε = a/R, M amu)
 */
export interface ConfinementScalingParams {
  /** prefactor [s] */
  C: number;
  exponents: { Ip: number; B: number; n19: number; P: number; R: number; kappa: number; eps: number; M: number; onePlusDelta: number };
  /** kaynak */
  ref: string;
}

/** IPB98(y,2) (the same as tauIPB98y2 above; that function stays unchanged) */
export const IPB98Y2_PARAMS: ConfinementScalingParams = {
  C: 0.0562, exponents: { Ip: 0.93, B: 0.15, n19: 0.41, P: -0.69, R: 1.97, kappa: 0.78, eps: 0.58, M: 0.19, onePlusDelta: 0 },
  ref: 'ITER Physics Basis, Nucl. Fusion 39 (1999) 2175, eq. (20)',
};

/**
 * ITPA20 — regression of the updated ITPA H-mode database (DB5.2.3-STD5, ELMy H-modes): Verdoolaege et al., Nucl. Fusion 61
 * (2021) 076006, eq. (7) = WLS estimates of table 16, printed to 2–3 digits. The coefficients also agree with the UKAEA PROCESS
 * documentation (confinement time, i_confinement_time = 49 and 50). Variables (the definitions of tauFromParams): I_p [MA],
 * B_t [T], the line-averaged n̄_e [10¹⁹ m⁻³], the thermal loss power through the LCFS P_l,th [MW], R_geo, the AVERAGE LCFS
 * triangularity δ (ITER 0.48; the presets carry the 95 %-surface δ95 = 0.33 in `geometry.delta`, which would lower τ_E by 3.8 %
 * for ITPA20 and 5.8 % for ITPA20-IL: callers pass the LCFS value, `profiles.lcfsDelta ?? geometry.delta` in boundaryShape),
 * the areal elongation κ_a = V/(2π² R a²) (arealElongation), ε = a/R and M_eff [amu]. At the paper's ITER point (I_p 15 MA,
 * B_t 5.3 T, n̄_e 10.3e19 m⁻³, P_l,th 87 MW, R 6.2 m, δ 0.48, κ_a 1.7, ε 0.32, M 2.5) the paper predicts 3.07 s
 * (2.79 s at P_l,th = 100 MW); this implementation gives 3.07 s (validation/primarySources.test.ts reproduces both to 1.5 %).
 */
export const ITPA20_PARAMS: ConfinementScalingParams = {
  C: 0.053, exponents: { Ip: 0.98, B: 0.22, n19: 0.24, P: -0.669, R: 1.71, kappa: 0.8, eps: 0.35, M: 0.2, onePlusDelta: 0.36 },
  ref: 'G. Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 (ITPA20)',
};

/**
 * ITPA20-IL — the ITER-like subset of the same study (ELMy H-modes under ITER-like constraints, no ε exponent): Verdoolaege et al.
 * 2021, eq. (5) = WLS estimates of table 10 (n̄_e exponent 0.147, table 10: 0.1473). At the paper's ITER point (see ITPA20) the paper
 * predicts 2.90 s (2.65 s at P_l,th = 100 MW); this implementation gives 2.90 s. The first v4 implementation (ws2b) rounded the n̄_e
 * exponent to 0.15 (+0.7 % in τ_E at n̄ = 10²⁰ m⁻³), the value of secondary quotations.
 */
export const ITPA20_IL_PARAMS: ConfinementScalingParams = {
  C: 0.067, exponents: { Ip: 1.29, B: -0.13, n19: 0.147, P: -0.644, R: 1.19, kappa: 0.67, eps: 0, M: 0.3, onePlusDelta: 0.56 },
  ref: 'G. Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 (ITPA20-IL)',
};

/** The H-mode scalings a magnetic configuration can select (MagneticConfig.scaling); IPB98(y,2) is the default */
export type HModeScaling = 'IPB98y2' | 'ITPA20' | 'ITPA20-IL' | 'ST_Valovic';

export const CONFINEMENT_SCALINGS: Record<'IPB98y2' | 'ITPA20' | 'ITPA20-IL', ConfinementScalingParams> = {
  IPB98y2: IPB98Y2_PARAMS, ITPA20: ITPA20_PARAMS, 'ITPA20-IL': ITPA20_IL_PARAMS,
};

/** Evaluate a ConfinementScalingParams scaling [s]; the inputs have the same units as in tauIPB98y2. */
export function tauFromParams(s: ConfinementScalingParams, g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const e = s.exponents;
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  return s.C * Math.pow(Ip_MA, e.Ip) * Math.pow(B, e.B) * Math.pow(n19, e.n19) * Math.pow(P_MW, e.P) * Math.pow(g.R, e.R) *
    Math.pow(g.kappa, e.kappa) * Math.pow(g.a / g.R, e.eps) * Math.pow(M, e.M) * Math.pow(1 + g.delta, e.onePlusDelta);
}

/** ITPA20 H-mode scaling (Verdoolaege et al. 2021) */
export function tauITPA20(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  return tauFromParams(ITPA20_PARAMS, g, Ip_MA, B, n, P_W, M);
}

/** ITPA20-IL (ITER-like subset) H-mode scaling (Verdoolaege et al. 2021) */
export function tauITPA20IL(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  return tauFromParams(ITPA20_IL_PARAMS, g, Ip_MA, B, n, P_W, M);
}

/**
 * H-mode τ_E of the selected scaling [s]; the inputs have the units of tauIPB98y2. For 'ITPA20' and 'ITPA20-IL' the geometry
 * must carry the AREAL elongation κ_a = V/(2π² R a²) and the average LCFS triangularity (see ITPA20_PARAMS); the 0D model and the
 * 1.5D confinement controller build it (arealElongation, boundaryShape / ProfileContext.kappaA, geomB).
 */
export function tauHmode(scaling: HModeScaling, g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  switch (scaling) {
    case 'ST_Valovic': return tauSTValovic(g, Ip_MA, B, n, P_W, M);
    case 'ITPA20': return tauITPA20(g, Ip_MA, B, n, P_W, M);
    case 'ITPA20-IL': return tauITPA20IL(g, Ip_MA, B, n, P_W, M);
    default: return tauIPB98y2(g, Ip_MA, B, n, P_W, M);
  }
}

/**
 * ITER89-P L-mode ölçeklemesi — Yushmanov et al., Nucl. Fusion 30 (1990) 1999:
 *  τ_E = 0.048 · I^0.85 · R^1.2 · a^0.3 · κ^0.5 · n20^0.1 · B^0.2 · M^0.5 · P^-0.5
 */
export function tauITER89P(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n20 = Math.max(n / 1e20, 0.001);
  return 0.048 * Math.pow(Ip_MA, 0.85) * Math.pow(g.R, 1.2) * Math.pow(g.a, 0.3) * Math.pow(g.kappa, 0.5) *
    Math.pow(n20, 0.1) * Math.pow(B, 0.2) * Math.pow(M, 0.5) * Math.pow(P_MW, -0.5);
}

/**
 * ISS04 stellarator ölçeklemesi — Yamada et al., Nucl. Fusion 45 (2005) 1684:
 *  τ_E = H_ISS04 · 0.134 · a^2.28 · R^0.64 · P^-0.61 · n19^0.54 · B^0.84 · ι_{2/3}^0.41
 *  H_ISS04: configuration-specific renormalisation (f_ren in ISS04; W7-X ~0.7–1.0, LHD ~0.9)
 */
export function tauISS04(g: Geometry, B: number, n: number, P_W: number, iota23: number, H_ISS04: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  return H_ISS04 * 0.134 * Math.pow(g.a, 2.28) * Math.pow(g.R, 0.64) * Math.pow(P_MW, -0.61) *
    Math.pow(n19, 0.54) * Math.pow(B, 0.84) * Math.pow(iota23, 0.41);
}

/**
 * Confinement multiplier of a stellarator relative to ISS04: τ_E = H_ISS04 · τ_ISS04 (a single multiplier; the tokamak H98
 * does not apply to a stellarator). If stellarator.H_ISS04 is not given, old configurations give the same result:
 * H_ISS04 = f_ren · H98 (f_ren: deprecated alias).
 */
export function stellaratorHISS04(st: { f_ren: number; H_ISS04?: number }, H98: number): number {
  return st.H_ISS04 ?? st.f_ren * H98;
}

/**
 * Sferik tokamak ölçeklemesi — Valovič et al., Nucl. Fusion 51 (2011) 073045 (MAST) /
 * Kaye et al. NSTX: τ_E ∝ I^0.59 B^1.4 n^0.44 P^-0.73 ; ön çarpan IPB98 ile
 * MAST referans noktasında (Ip=0.8 MA, B=0.5 T) eşleştirilir.
 * APPROXIMATION: ön çarpan normalizasyonu; sadece ST için B bağımlılığının güçlü
 * olduğunu göstermek amacıyla.
 */
export function tauSTValovic(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const ref = tauIPB98y2(g, Ip_MA, B, n, P_W, M);
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  // IPB98 üsleri: I^0.93 B^0.15 n^0.41 P^-0.69 → ST üsleri: I^0.59 B^1.4 n^0.44 P^-0.73
  // Referans: I=0.8 MA, B=0.5 T, n19=3, P=2 MW → oran 1
  const ratio = Math.pow(Ip_MA / 0.8, 0.59 - 0.93) * Math.pow(B / 0.5, 1.4 - 0.15) *
    Math.pow(n19 / 3, 0.44 - 0.41) * Math.pow(P_MW / 2, -0.73 + 0.69);
  return ref * ratio;
}

/**
 * L-H geçiş güç eşiği — Martin et al., J. Phys. Conf. Ser. 123 (2008) 012033:
 *  P_LH [MW] = 0.0488 · n20^0.717 · B^0.803 · S^0.941 · (2/M)   (S plazma yüzeyi m²)
 * İzotop düzeltmesi (2/M) Righi 1999; D-T için M=2.5.
 */
export function pLH_Martin(n: number, B: number, S: number, M: number): number {
  const n20 = Math.max(n / 1e20, 0.01);
  return 0.0488e6 * Math.pow(n20, 0.717) * Math.pow(B, 0.803) * Math.pow(S, 0.941) * (2 / M);
}

/**
 * Line-averaged density at which the L-H threshold is minimal [m^-3] — F. Ryter et al., Nucl. Fusion 54 (2014) 083003, eq. (3),
 * the multi-machine scaling of the density minimum (ASDEX Upgrade, C-Mod, DIII-D, JET; as quoted by T. Eich et al., arXiv:2407.13539
 * (2024), eq. (12), and in the SPARC POPCON tool):
 *  n̄_e,min [10^19 m^-3] = 0.7 · I_p[MA]^0.34 · B[T]^0.62 · a[m]^-0.95 · (R/a)^0.4
 */
export function nLHmin(Ip_MA: number, B: number, a: number, R: number): number {
  return 0.7 * Math.pow(Math.max(Ip_MA, 0.01), 0.34) * Math.pow(B, 0.62) * Math.pow(a, -0.95) * Math.pow(R / a, 0.4) * 1e19;
}

/**
 * Exponent of the low-density branch of the L-H threshold: for n̄ < n̄_min, P_LH = P_Martin(n̄_min) · (n̄_min/n̄)^LH_LOW_DENSITY_EXPONENT.
 * Neither source of the two ends of the branch gives it: Martin et al. (2008) is a fit of the HIGH-density branch only, and Ryter et
 * al. (2014) supply n̄_min (their eq. 3) and show that the threshold rises below it (the low-density branch, from the ion heat channel:
 * less electron-ion coupling), but no multi-machine law for the rise. The exponent is that of the SPARC design studies: J.W. Hughes et
 * al., "Projections of H-mode access and edge pedestal in the SPARC tokamak", J. Plasma Phys. 86 (2020) 865860504, add a penalty to the
 * ITPA (Martin) threshold below n_min, implemented in the open-source POPCON tool cfspopcon (CFS, formulas/separatrix_conditions/
 * threshold_power.py, "Added in low density branch from Ryter 2014") as (n_min/n)². APPROXIMATION: that penalty (the paper's text was
 * not read, only the tool's source). v4.0-dev (ws2b) used the first power, the first Wave-1 assumption; the choice moves the first L-H
 * transition of a ramp-up only where the plasma starts below n_min. Measured on the presets (exponent 0 = Martin only / 1 / 2): JET 0D
 * 0.17 / 0.34 / 0.44 s, JET15 0.10 / 0.22 / 0.32 s, JT-60SA 0.06 / 0.44 / 0.50 s, DIII-D 0.05 / 0.10 / 0.18 s, SPARC15 1.37 / 1.50 / 1.57 s,
 * DEMO15 14.25 / 14.55 / 14.85 s; the ITER, DEMO and SPARC 0D and ITER15 transitions (9.4, 16.25, 1.35 and 8.2 s) are set by the heating ramp
 * and move by 0.02 s at most.
 */
export const LH_LOW_DENSITY_EXPONENT = 2;

/**
 * L-H power threshold, including the low-density branch: Martin (2008) for n̄ ≥ n̄_min (bit-for-bit the same);
 * for n̄ < n̄_min the threshold rises again: P_LH = P_Martin(n̄_min) · (n̄_min/n̄)^LH_LOW_DENSITY_EXPONENT (Ryter 2014 supply n̄_min and
 * the rise; the exponent is the SPARC-study penalty, see LH_LOW_DENSITY_EXPONENT). n: LINE-averaged density [m^-3] (Martin's definition).
 */
export function pLH_threshold(nbar: number, B: number, S: number, M: number, Ip_MA: number, a: number, R: number): number {
  const nmin = nLHmin(Ip_MA, B, a, R);
  if (nbar >= nmin) return pLH_Martin(nbar, B, S, M);
  return pLH_Martin(nmin, B, S, M) * Math.pow(nmin / Math.max(nbar, 1e17), LH_LOW_DENSITY_EXPONENT);
}

/**
 * Electron-ion temperature equilibration time (Spitzer; NRL Formulary), single ion species:
 *  ν_ie = 3.2e-9 · Z² · lnΛ / (μ · T_e[eV]^1.5) · n_e[cm^-3]  [s^-1]  (energy equilibration rate)
 * @deprecated For a multi-species plasma use equilibrationRate (Σ n_j Z_j²/A_j, computed lnΛ); the 0D model uses it.
 */
export function tauEquilibration(ne: number, Te_keV: number, mu_amu: number, Zeff: number, lnLambda = 17): number {
  const ne_cm3 = ne * 1e-6;
  const Te_eV = Math.max(Te_keV, 0.01) * 1e3;
  const nu = (3.2e-9 * Zeff * Zeff * lnLambda * ne_cm3) / (mu_amu * Math.pow(Te_eV, 1.5));
  return 1 / Math.max(nu, 1e-12);
}

/**
 * Electron-ion energy equilibration rate in a multi-species plasma [1/s] (NRL Plasma Formulary, temperature
 * equilibration, limit T_e/m_e ≫ T_i/m_i):
 *  ν_eq = 3.2e-9 · lnΛ · Σ_j n_j Z_j²/A_j [cm^-3] / T_e[eV]^1.5 ,   P_ei = (3/2) n_e (T_e − T_i) ν_eq
 * ionSum = Σ_j n_j Z_j² / (n_e A_j) (fuel, ash, impurities; the same sum as in the Stix E_c).
 * If lnΛ is not given it is computed from n_e, T_e (coulombLog).
 */
export function equilibrationRate(ne: number, Te_keV: number, ionSum: number, lnLambda = coulombLog(ne, Te_keV)): number {
  const Te_eV = Math.max(Te_keV, 0.01) * 1e3;
  return (3.2e-9 * lnLambda * ne * 1e-6 * ionSum) / Math.pow(Te_eV, 1.5);
}

/**
 * Coulomb logaritması (e-i), NRL Formulary: lnΛ = 24 − ln(n_e^0.5 / T_e) (T_e>10 eV, n cm^-3, T eV)
 */
export function coulombLog(ne: number, Te_keV: number): number {
  const ne_cm3 = Math.max(ne * 1e-6, 1);
  const Te_eV = Math.max(Te_keV * 1e3, 10);
  return Math.max(24 - Math.log(Math.sqrt(ne_cm3) / Te_eV), 5);
}
