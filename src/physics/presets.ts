/**
 * Gerçek makine preset'leri. Kaynaklar yorumlarda. Değerler açık literatürden (tasarım/nominal).
 */
import { FRCConfig, ICFConfig, MagneticConfig, MirrorConfig, MTFConfig, MuonConfig, ReactorConfig } from './types';

export function defaultMagnetic(over: Partial<MagneticConfig> & { geometry: MagneticConfig['geometry']; B0: number; Ip_MA: number }): MagneticConfig {
  const base: MagneticConfig = {
    method: 'tokamak',
    geometry: over.geometry, B0: over.B0, Ip_MA: over.Ip_MA,
    fuel: 'DT', fuelFracA: 0.5,
    n_target: 1.0e20, n_rampTime: 20,
    heating: { P_NBI_MW: 33, E_NBI_keV: 1000, P_ICRH_MW: 17, f_ICRH_ion: 0.6, P_ECRH_MW: 0, rampTime: 5, autoOff: false },
    fueling: { method: 'pellet', maxRate_1e20s: 500, pelletDepth: 0.5 },
    impurity: { species: 'Be', concentration: 0.02, wallReflectivity: 0.7, W_source_frac: 0 },
    H98: 1.0, H89: 1.0, scaling: 'IPB98y2',
    stellarator: { iota23: 0.9, f_ren: 0.8 },
    limits: { betaN_limit: 3.5, greenwald_limit: 1.0, q95_limit: 2.0, W_conc_limit: 3e-4 },
    transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.3, alpha_T: 1.5 },
    events: { elms: true, sawteeth: true, ntm: true },
    magnet: { tech: 'Nb3Sn', gap_m: 1.2, coilThickness_m: 0.9 },
    blanket: { type: 'HCPB', li6_enrichment: 0.6, coverage: 0.85 },
    divertor: { f_rad_div: 0.7, flux_expansion: 5 },
    economics: { availability: 0.6, thermalEff: 0.35, wallPlugEff: 0.4, discountRate: 0.07, lifetime_yr: 30 },
    t_end: 400, seed: 42,
  };
  return { ...base, ...over, heating: { ...base.heating, ...(over.heating ?? {}) }, fueling: { ...base.fueling, ...(over.fueling ?? {}) },
    impurity: { ...base.impurity, ...(over.impurity ?? {}) }, limits: { ...base.limits, ...(over.limits ?? {}) },
    transport: { ...base.transport, ...(over.transport ?? {}) }, events: { ...base.events, ...(over.events ?? {}) },
    magnet: { ...base.magnet, ...(over.magnet ?? {}) }, blanket: { ...base.blanket, ...(over.blanket ?? {}) },
    divertor: { ...base.divertor, ...(over.divertor ?? {}) }, economics: { ...base.economics, ...(over.economics ?? {}) },
    stellarator: { ...base.stellarator, ...(over.stellarator ?? {}) } };
}

export interface Preset { id: string; name: string; desc: string; cfg: ReactorConfig; validation?: string }

// ITER: R=6.2, a=2.0, κ95=1.7 (κ_sep 1.85), δ95=0.33, B=5.3 T, Ip=15 MA, n≈1.0e20, P_aux=50 MW (33 NBI + 17 ICRH ... 20 EC), Q=10 hedef, 400 s. (ITER Physics Basis 1999; Shimada 2007)
export const ITER = defaultMagnetic({
  geometry: { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 }, B0: 5.3, Ip_MA: 15,
  n_target: 1.0e20, n_rampTime: 30,
  heating: { P_NBI_MW: 33, E_NBI_keV: 1000, P_ICRH_MW: 17, f_ICRH_ion: 0.6, P_ECRH_MW: 0, rampTime: 10, autoOff: false },
  // ITER Q=10 senaryosu: Be %2 + Ar %0.12 tohumlama (divertör radyasyonu) → Z_eff ≈ 1.65 (Shimada 2007, Tablo 2)
  impurity: { species: 'Be', concentration: 0.02, wallReflectivity: 0.7, W_source_frac: 0, seedSpecies: 'Ar', seedConcentration: 0.0012 },
  magnet: { tech: 'Nb3Sn', gap_m: 1.3, coilThickness_m: 0.9 }, t_end: 400,
});
// JET DTE2 (2021) rekor atışı #99971: R=2.96, a≈0.9, B=3.45–3.7 T, Ip=3.5 MA, ~33 MW NBI+ICRH, 5 s, 59 MJ (Maslov 2023 NF)
export const JET = defaultMagnetic({
  geometry: { R: 2.96, a: 0.93, kappa: 1.68, delta: 0.3 }, B0: 3.7, Ip_MA: 3.5,
  n_target: 0.7e20, n_rampTime: 1.5,
  heating: { P_NBI_MW: 29, E_NBI_keV: 110, P_ICRH_MW: 4, f_ICRH_ion: 0.7, P_ECRH_MW: 0, rampTime: 0.5, autoOff: false },
  fueling: { method: 'gas', maxRate_1e20s: 400, pelletDepth: 0.3 },
  impurity: { species: 'Be', concentration: 0.015, wallReflectivity: 0.6, W_source_frac: 0 },
  // ILW (Be/W duvar) baz senaryo: H98 ≈ 0.8–0.9 (Garzotti 2019; Maslov 2023)
  H98: 0.85, H89: 0.85,
  magnet: { tech: 'Cu', gap_m: 0.55, coilThickness_m: 0.6 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.2, alpha_T: 1.2 },
  economics: { availability: 0.1, thermalEff: 0.33, wallPlugEff: 0.3, discountRate: 0.07, lifetime_yr: 30 },
  t_end: 5.5, seed: 7,
});
// SPARC V2 (Creely et al., JPP 2020): R=1.85, a=0.57, κ=1.97, δ=0.54, B=12.2 T, Ip=8.7 MA, 25 MW ICRH, Q≈11 tahmini, n≈3e20, 10 s
export const SPARC = defaultMagnetic({
  geometry: { R: 1.85, a: 0.57, kappa: 1.97, delta: 0.54 }, B0: 12.2, Ip_MA: 8.7,
  n_target: 3.0e20, n_rampTime: 3,
  heating: { P_NBI_MW: 0, E_NBI_keV: 100, P_ICRH_MW: 25, f_ICRH_ion: 0.6, P_ECRH_MW: 0, rampTime: 1.5, autoOff: false },
  impurity: { species: 'W', concentration: 1.5e-5, wallReflectivity: 0.7, W_source_frac: 0 },
  magnet: { tech: 'REBCO', gap_m: 0.25, coilThickness_m: 0.5 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.3, alpha_T: 1.5 },
  t_end: 10, seed: 3,
});
// DIII-D: R=1.67, a=0.67, κ=1.8, δ=0.5, B=2.2 T, Ip=2.0 MA, 20 MW NBI (80 keV), D-D
export const DIIID = defaultMagnetic({
  geometry: { R: 1.67, a: 0.67, kappa: 1.8, delta: 0.5 }, B0: 2.2, Ip_MA: 1.6,
  fuel: 'DD', fuelFracA: 1.0, n_target: 0.6e20, n_rampTime: 1,
  heating: { P_NBI_MW: 12, E_NBI_keV: 80, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 3, rampTime: 0.3, autoOff: false },
  fueling: { method: 'gas', maxRate_1e20s: 300, pelletDepth: 0.3 },
  impurity: { species: 'C', concentration: 0.02, wallReflectivity: 0.5, W_source_frac: 0 },
  magnet: { tech: 'Cu', gap_m: 0.3, coilThickness_m: 0.3 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  t_end: 6, seed: 11,
});
// JT-60SA: R=2.96, a=1.18, κ=1.95, δ=0.53, B=2.25 T, Ip=5.5 MA, 41 MW (24 P-NBI 85 keV + 10 N-NBI 500 keV + 7 ECRH), 100 s, D-D
export const JT60SA = defaultMagnetic({
  geometry: { R: 2.96, a: 1.18, kappa: 1.95, delta: 0.53 }, B0: 2.25, Ip_MA: 5.5,
  fuel: 'DD', fuelFracA: 1.0, n_target: 0.6e20, n_rampTime: 5,
  heating: { P_NBI_MW: 34, E_NBI_keV: 200, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 7, rampTime: 2, autoOff: false },
  impurity: { species: 'C', concentration: 0.015, wallReflectivity: 0.6, W_source_frac: 0 },
  magnet: { tech: 'NbTi', gap_m: 0.5, coilThickness_m: 0.5 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  limits: { betaN_limit: 4.0, greenwald_limit: 1.0, q95_limit: 2.0, W_conc_limit: 3e-4 },
  t_end: 100, seed: 5,
});
// MAST-U: R=0.85, a=0.65, κ=2.5, δ=0.5, B=0.75 T, Ip=1.0–2 MA, 5 MW NBI (75 keV), D-D
export const MASTU = defaultMagnetic({
  method: 'spherical_tokamak', scaling: 'ST_Valovic',
  geometry: { R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, B0: 0.75, Ip_MA: 1.0,
  fuel: 'DD', fuelFracA: 1.0, n_target: 0.4e20, n_rampTime: 0.3,
  heating: { P_NBI_MW: 5, E_NBI_keV: 75, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 0, rampTime: 0.1, autoOff: false },
  fueling: { method: 'gas', maxRate_1e20s: 200, pelletDepth: 0.3 },
  impurity: { species: 'C', concentration: 0.02, wallReflectivity: 0.5, W_source_frac: 0 },
  limits: { betaN_limit: 5.5, greenwald_limit: 1.0, q95_limit: 2.0, W_conc_limit: 3e-4 },
  magnet: { tech: 'Cu', gap_m: 0.02, coilThickness_m: 0.15 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  t_end: 2, seed: 9,
});
// W7-X: R=5.5, a=0.53, B=2.5 T, ι≈0.9 (5/5 konfig.), 10 MW ECRH (2023: 1.3 GJ ile 8 dk), f_ren≈0.7–1 (Dinklage 2018)
export const W7X = defaultMagnetic({
  method: 'stellarator',
  geometry: { R: 5.5, a: 0.53, kappa: 1.0, delta: 0 }, B0: 2.5, Ip_MA: 0,
  fuel: 'DD', fuelFracA: 1.0, n_target: 0.8e20, n_rampTime: 3,
  heating: { P_NBI_MW: 0, E_NBI_keV: 55, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 7.5, rampTime: 0.5, autoOff: false },
  fueling: { method: 'pellet', maxRate_1e20s: 150, pelletDepth: 0.5 },
  impurity: { species: 'C', concentration: 0.01, wallReflectivity: 0.6, W_source_frac: 0 },
  stellarator: { iota23: 0.9, f_ren: 0.8 }, H98: 1.0,
  magnet: { tech: 'NbTi', gap_m: 0.6, coilThickness_m: 0.3 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.1, alpha_T: 1.5 },
  t_end: 30, seed: 13,
});
// EU DEMO 2018 baseline: R=9.07, a=2.93, κ95=1.65, δ95=0.33, B=5.86 T, Ip=17.75 MA, P_fus=2000 MW, P_aux=50 MW, n≈0.8e20, H98=1.1 (Siccinio 2020)
export const DEMO = defaultMagnetic({
  geometry: { R: 9.07, a: 2.93, kappa: 1.65, delta: 0.33 }, B0: 5.86, Ip_MA: 17.75,
  // DEMO n_G = 0.66e20: tasarım n/n_G ≈ 1.2 (pedestal Greenwald altında, tepeli profil) → limit 1.3 (APPROXIMATION)
  n_target: 0.75e20, n_rampTime: 80,
  // Flat-top P_aux = 50 MW; H-mod erişimi (P_LH ≈ 100+ MW) için rampa sırasında ek ECRH gerekir (Siccinio 2020)
  heating: { P_NBI_MW: 50, E_NBI_keV: 1000, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 50, rampTime: 20, autoOff: false },
  impurity: { species: 'W', concentration: 1e-5, wallReflectivity: 0.7, W_source_frac: 0, seedSpecies: 'Ar', seedConcentration: 0.001 },
  limits: { betaN_limit: 3.5, greenwald_limit: 1.3, q95_limit: 2.0, W_conc_limit: 3e-4 },
  H98: 1.1, magnet: { tech: 'Nb3Sn', gap_m: 1.9, coilThickness_m: 1.0 },
  blanket: { type: 'HCPB', li6_enrichment: 0.6, coverage: 0.85 },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.3, alpha_T: 1.5 },
  economics: { availability: 0.3, thermalEff: 0.38, wallPlugEff: 0.4, discountRate: 0.07, lifetime_yr: 30 },
  t_end: 2000, seed: 21,
});

// 1.5D profil modeli preset'leri: aynı makineler, radyal taşınım + Grad–Shafranov dengesi.
// ITER/DEMO için LCFS şekli (κ_sep, δ_sep) kullanılır; 0D preset'lerdeki κ, δ 95% yüzey değerleridir
// (ITER: κ95 = 1.70 → κ_sep = 1.85, δ95 = 0.33 → δ_sep = 0.49; ITER Physics Basis 1999).
export const ITER_15D: MagneticConfig = { ...ITER, fidelity: '1.5D', profiles: { lcfsKappa: 1.85, lcfsDelta: 0.49 } };
export const JET_15D: MagneticConfig = { ...JET, fidelity: '1.5D' };
export const SPARC_15D: MagneticConfig = { ...SPARC, fidelity: '1.5D' };
export const DEMO_15D: MagneticConfig = { ...DEMO, fidelity: '1.5D', profiles: { lcfsKappa: 1.85, lcfsDelta: 0.5 } };

// NIF N221204 (Aralık 2022): 2.05 MJ lazer (351 nm), 3.15 MJ verim (G≈1.5); HDC kapsül ~1.05 mm dış yarıçap,
// DT buz ~ 220 µg (≈ 0.065 mm kalınlık), v_imp ≈ 390 km/s, CR ≈ 30, α ≈ 2.5–3, hohlraum η ≈ 0.10–0.12 (Zylstra 2022, Abu-Shawareb 2024)
export const NIF: ICFConfig = {
  method: 'icf_indirect', E_laser_MJ: 2.05, wavelength_nm: 351, pulse_ns: 8, capsuleRadius_um: 1050, fuelMass_ug: 220, ablatorMass_ug: 4000,
  ablator: 'HDC', adiabat: 2.8, convergenceRatio: 30, implosionVelocity_kms: 390, hohlraumEff: 0.11, absorption: 0.9,
  asymmetry_rms: 1.5, surfaceRoughness_nm: 20, fuel: 'DT', seed: 1,
};
// Doğrudan tahrik (OMEGA benzeri, ölçekli): 1.9 MJ, CH ablatör
export const DIRECT_DRIVE: ICFConfig = {
  method: 'icf_direct', E_laser_MJ: 1.9, wavelength_nm: 351, pulse_ns: 10, capsuleRadius_um: 1700, fuelMass_ug: 600, ablatorMass_ug: 3000,
  ablator: 'CH', adiabat: 3.0, convergenceRatio: 25, implosionVelocity_kms: 380, hohlraumEff: 1, absorption: 0.6,
  asymmetry_rms: 2.0, surfaceRoughness_nm: 30, fuel: 'DT', seed: 2,
};
// Z Machine MagLIF (Gomez 2014/2020): 20 MA, ~100 ns, Be liner r=2.79 mm, Δr/r≈1/6, B_z 10–16 T, DD gaz 0.7–1.5 mg/cm³, lazer ön-ısıtma 1–2 kJ, CR≈25–40
export const ZMACHINE: MTFConfig = {
  method: 'maglif', r0_m: 2.325e-3, L_m: 7.5e-3, n0: 2.4e26, T0_keV: 0.2, B0: 12, compressionRatio: 30, driverEnergy_MJ: 3.0,
  compressionTime_us: 0.1, jitter_us: 0, linerThicknessRatio: 0.17, preheat_kJ: 2.0, current_MA: 20, flowShear: 0, fuel: 'DD', seed: 4,
};
// General Fusion tipi piston MTF: 3 m küre, sıvı Pb-Li, ~100 piston, sıkıştırma ~ 3 ms (10 ms'lik plazma ömrü ile) — hedef parametreler (Laberge 2019)
export const GF_PISTON: MTFConfig = {
  method: 'mtf_piston', r0_m: 0.7, L_m: 1.5, n0: 1e20, T0_keV: 0.3, B0: 0.5, compressionRatio: 10, driverEnergy_MJ: 100,
  compressionTime_us: 3000, jitter_us: 50, linerThicknessRatio: 1, preheat_kJ: 0, current_MA: 0, flowShear: 0, fuel: 'DT', seed: 6,
};
// FRX-L / Kirtland tipi EM liner MTF (Intrator 2004): FRC r≈3 cm, n~1e23, T~0.3 keV, Al liner 10:1, ~20 µs
export const MTF_LINER: MTFConfig = {
  method: 'mtf_liner', r0_m: 0.05, L_m: 0.3, n0: 5e22, T0_keV: 0.3, B0: 5, compressionRatio: 10, driverEnergy_MJ: 12,
  compressionTime_us: 25, jitter_us: 0.2, linerThicknessRatio: 0.1, preheat_kJ: 0, current_MA: 12, flowShear: 0, fuel: 'DT', seed: 8,
};
// FuZE-Q tipi kesme-akış Z-pinch (Zap Energy; Shumlak 2020): 500 kA → hedef 650 kA, r≈3 mm, L=50 cm, n~1e23-1e24, T~1-3 keV
export const ZAP: MTFConfig = {
  method: 'zpinch_sfs', r0_m: 3e-3, L_m: 0.5, n0: 1e23, T0_keV: 1.0, B0: 0, compressionRatio: 1, driverEnergy_MJ: 0.5,
  compressionTime_us: 10, jitter_us: 0, linerThicknessRatio: 0, preheat_kJ: 0, current_MA: 0.65, flowShear: 0.7, fuel: 'DT', seed: 12,
};
// TAE Norman / C-2W tipi FRC (Gota 2021): r_s≈0.4 m, L≈3 m, B_e≈0.1 T, n~2e19, T_e~0.5 keV, T_i~1 keV, 13 MW NBI (15 keV), 30 ms
export const TAE: FRCConfig = { method: 'frc', rs_m: 0.4, L_m: 3.0, Be_T: 0.12, n0: 2e19, T0_keV: 0.5, P_NBI_MW: 13, E_NBI_keV: 15, t_end: 0.05, seed: 14, fuel: 'DD' };
// Tandem ayna (GAMMA-10 ölçeği / WHAM hedefi): L=10 m, a=0.2 m, B=1 T merkez, R_m=10, ECRH+NBI 5 MW
export const MIRROR: MirrorConfig = { method: 'mirror', L_m: 10, a_m: 0.2, B_center_T: 1.0, mirrorRatio: 10, n0: 1e19, T_keV: 5, P_aux_MW: 5, tandem: true, t_end: 1, seed: 15, fuel: 'DT' };
// Müon-katalizli: 150 füzyon/müon (α-yapışma 0.6%), müon üretim maliyeti ~ 5 GeV
export const MUON: MuonConfig = { method: 'muon', muonRate_per_s: 1e14, muonCost_GeV: 5, stickingProb: 0.0056, density_LHD: 1.2, T_K: 900, seed: 16 };

export const PRESETS: Preset[] = [
  { id: 'ITER', name: 'ITER', desc: 'R=6.2 m, B=5.3 T, I_p=15 MA, 50 MW → Q≈10 target', cfg: ITER, validation: 'Q ≈ 10, T_i ≈ 8–20 keV, P_fus ≈ 500 MW' },
  { id: 'JET', name: 'JET DTE2 (2021)', desc: 'R=2.96 m, B=3.7 T, I_p=3.5 MA, 33 MW, 5 s → 59 MJ', cfg: JET, validation: 'E_fus ≈ 59 MJ (5 s)' },
  { id: 'SPARC', name: 'SPARC', desc: 'REBCO 12.2 T, R=1.85 m, 25 MW ICRH → Q≈11', cfg: SPARC, validation: 'Q ≈ 2–11' },
  { id: 'DIIID', name: 'DIII-D', desc: 'R=1.67 m, B=2.2 T, D-D experiment', cfg: DIIID },
  { id: 'JT60SA', name: 'JT-60SA', desc: 'R=2.96 m, B=2.25 T, superconducting, 41 MW, D-D', cfg: JT60SA },
  { id: 'MASTU', name: 'MAST-U', desc: 'Spherical tokamak A≈1.3, B=0.75 T', cfg: MASTU },
  { id: 'W7X', name: 'Wendelstein 7-X', desc: 'Stellarator R=5.5 m, B=2.5 T, 7.5 MW ECRH', cfg: W7X },
  { id: 'DEMO', name: 'EU DEMO', desc: 'R=9.07 m, B=5.86 T, I_p=17.75 MA, 2 GW fusion', cfg: DEMO },
  { id: 'ITER15', name: 'ITER · 1.5D profiles', desc: 'Radial transport + Grad–Shafranov equilibrium; sawteeth, ELMs, NTMs, bootstrap', cfg: ITER_15D, validation: 'Q ≈ 10, P_fus ≈ 500 MW, f_bs ≈ 0.2' },
  { id: 'JET15', name: 'JET DTE2 · 1.5D profiles', desc: 'Profiles with beam-target fusion from 3-component NBI', cfg: JET_15D, validation: 'E_fus ≈ 59 MJ (1.5D: +40%)' },
  { id: 'SPARC15', name: 'SPARC · 1.5D profiles', desc: 'High-field compact tokamak with profile physics', cfg: SPARC_15D },
  { id: 'DEMO15', name: 'EU DEMO · 1.5D profiles', desc: '2000 s burn, bootstrap ≈ 0.4, NBCD', cfg: DEMO_15D, validation: 'P_fus ≈ 2 GW' },
  { id: 'NIF', name: 'NIF (N221204)', desc: '2.05 MJ laser, indirect drive → 3.15 MJ (G=1.5)', cfg: NIF, validation: 'Gain ≈ 1–2' },
  { id: 'DIRECT', name: 'Direct-drive ICF', desc: '1.9 MJ, CH ablator', cfg: DIRECT_DRIVE },
  { id: 'Z', name: 'Z Machine (MagLIF)', desc: '20 MA, 100 ns, Be liner, 12 T, 2 kJ preheat', cfg: ZMACHINE },
  { id: 'GF', name: 'General Fusion (piston)', desc: 'Liquid-metal piston MTF, 3 ms compression', cfg: GF_PISTON },
  { id: 'FRXL', name: 'EM liner MTF (FRX-L)', desc: 'Al liner 10:1, 25 µs', cfg: MTF_LINER },
  { id: 'ZAP', name: 'Zap FuZE-Q', desc: 'Sheared-flow-stabilized Z-pinch, 650 kA', cfg: ZAP },
  { id: 'TAE', name: 'TAE Norman (FRC)', desc: 'FRC + 13 MW NBI, 30 ms', cfg: TAE },
  { id: 'MIRROR', name: 'Tandem mirror', desc: 'L=10 m, R_m=10 — loss cone', cfg: MIRROR },
  { id: 'MUON', name: 'Muon-catalyzed (easter egg)', desc: '150 fusions/muon sticking limit', cfg: MUON },
];
