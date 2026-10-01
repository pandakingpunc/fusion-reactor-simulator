/**
 * Gerçek makine preset'leri. Kaynaklar yorumlarda. Değerler açık literatürden (tasarım/nominal).
 */
import { FRCConfig, ICFConfig, MagneticConfig, MirrorConfig, MTFConfig, MuonConfig, ReactorConfig } from './types';

const MERGED_SECTIONS = ['heating', 'fueling', 'impurity', 'limits', 'transport', 'events', 'magnet', 'blanket', 'divertor', 'economics', 'stellarator'] as const;

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
  // the sections of a preset merge into those of the base (the keys keep the order of the base object)
  const out: Record<string, unknown> = { ...base, ...over };
  for (const k of MERGED_SECTIONS) out[k] = { ...base[k], ...(over[k] ?? {}) };
  return out as unknown as MagneticConfig;
}

export interface Preset { id: string; name: string; desc: string; cfg: ReactorConfig; validation?: string }

// ITER: R=6.2, a=2.0, κ95=1.7 (κ_sep 1.85), δ95=0.33 (δ_sep 0.49), B=5.3 T, Ip=15 MA, n≈1.0e20, P_aux=50 MW (33 NBI + 17 ICRH ... 20 EC), Q=10 hedef, 400 s. (ITER Physics Basis 1999; Shimada 2007)
// `geometry` carries the 95 % values (q95, the τ_E scalings); `profiles.lcfsKappa/lcfsDelta` the LCFS shape, which sets the plasma volume
// and surface of the 0D model (geometry.boundaryShape: 842 m³, 683 m² against the design 837 m³, 678 m²) and the shape of the 1.5D model.
// `lcfsRef95` is the 95 % shape those LCFS values belong to: the 0D volume, surface and area follow an edited κ or δ in that ratio.
export const ITER = defaultMagnetic({
  geometry: { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 }, B0: 5.3, Ip_MA: 15,
  profiles: { lcfsKappa: 1.85, lcfsDelta: 0.49, lcfsRef95: { kappa: 1.7, delta: 0.33 } },
  // n_target of the 0D model is the VOLUME average (the 1.5D model regulates the line average). The design point is n̄/n_G = 0.85 with the
  // LINE-averaged n̄ (ITER Physics Basis; Shimada et al. 2007; T.A. Casper et al., Nucl. Fusion 54 (2014) 013005: "densities at 85 % of the
  // Greenwald density limit"): n_G = I_p/(π a²) = 1.194e20, n̄ = 1.015e20 = f_line(α_n = 0.3) × 0.914e20 (f_line = 1.110). The earlier
  // 1.0e20 volume average was n̄ = 1.09e20 = 0.915 n_G.
  n_target: 0.914e20, n_rampTime: 30,
  heating: { P_NBI_MW: 33, E_NBI_keV: 1000, P_ICRH_MW: 17, f_ICRH_ion: 0.6, P_ECRH_MW: 0, rampTime: 10, autoOff: false },
  // ITER Q=10 senaryosu: Be %2 + Ar %0.12 tohumlama (divertör radyasyonu) → Z_eff ≈ 1.65 (Shimada 2007, Tablo 2)
  impurity: { species: 'Be', concentration: 0.02, wallReflectivity: 0.7, W_source_frac: 0, seedSpecies: 'Ar', seedConcentration: 0.0012 },
  magnet: { tech: 'Nb3Sn', gap_m: 1.3, coilThickness_m: 0.9 }, t_end: 400,
  // Design data of the systems-lite report (the plasma models never read them). Pulse: the inductive 15 MA scenario burns 300-500 s at Q = 10
  // (T.A. Casper et al., Nucl. Fusion 54 (2014) 013005; 400 s in the ITER Physics Basis and Shimada 2007), 500 s is taken as the plasma pulse
  // of the plant. Central solenoid: inner radius 1.3 m, outer radius 2.08 m (0.78 m thick), 13 T on the conductor (J.H. Schultz et al., "The ITER
  // Central Solenoid", MIT PSFC, 2005; General Atomics ITER CS booklet 2021), which the model turns into 13.3 MA/m2 and 237 V s of swing
  // against the 266.6 V s quoted for the solenoid (the CS and the PF coils together supply the 277 V s of the scenario, Shimada 2007).
  systems: { pulseLength_s: 500, cs: { outerRadius_m: 2.08, thickness_m: 0.78, B_max_T: 13 } },
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
// Radial build and design data (Wave 2B review of the 0.25 m gap and 0.5 m leg, which came from no source). Creely et al. 2020 gives the build
// only as Figure 2, the V2 poloidal cross-section, whose vector data carry the axis scale: at the midplane the toroidal field coil (light grey)
// spans R = 0.735 to 1.060 m (thickness 0.325 m, the outer surface 0.22 m from the plasma at R - a = 1.28 m), the vacuum vessel 1.175 to 1.240 m,
// the central solenoid CS1-CS3 R = 0.405 to 0.681 m (0.276 m thick) over Z = -1.9 to 1.9 m (measured from the figure to about 0.01 m; the
// figure draws the coil as one band, case and winding pack together). The field on the conductor is then 12.2 T x 1.85 / 1.06 = 21.3 T, the
// "approximately 22 T peak field-on-coil" of Z.S. Hartwig et al., IEEE Trans. Appl. Supercond. 34 (2024), "The SPARC Toroidal Field Model Coil
// Program" (arXiv:2308.12301, section III). 18 TF coils, a flat top of 10 s and 42 Wb of flux from the CS and PF coils together (Creely,
// section 3 and table 1); the plant pulse is the TSC discharge of Creely Figure 3: ramp-up 8.5 s, flat top 10 s, ramp-down 12 s, 31 s in all.
// The peak field of the solenoid is not in the open literature: the technology limit (23 T) is used, which gives 44 V s. This build is OVER
// the stress limit of this model (Tresca about 1300 MPa against 800 MPa: 'TF coil stress' warning kept): the leg of the model is a free
// cylinder, while the SPARC coil is bucked against the solenoid, is a stack-in-plate design in Nitronic steel plates (the winding pack carries
// load; structure fraction 0.8 here) and its allowable is that of a high-strength steel, not of 316LN; the published build is not made
// thicker to hide the warning.
export const SPARC = defaultMagnetic({
  geometry: { R: 1.85, a: 0.57, kappa: 1.97, delta: 0.54 }, B0: 12.2, Ip_MA: 8.7,
  n_target: 3.0e20, n_rampTime: 3,
  heating: { P_NBI_MW: 0, E_NBI_keV: 100, P_ICRH_MW: 25, f_ICRH_ion: 0.6, P_ECRH_MW: 0, rampTime: 1.5, autoOff: false },
  impurity: { species: 'W', concentration: 1.5e-5, wallReflectivity: 0.7, W_source_frac: 0 },
  magnet: { tech: 'REBCO', gap_m: 0.22, coilThickness_m: 0.325 }, blanket: { type: 'none', li6_enrichment: 0.075, coverage: 0 },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.3, alpha_T: 1.5 },
  // systems.pulseLength_s is the FULL plant pulse of the machine (the semantics of the key, types.ts: the pulsed-field energy of the PF
  // system and CS is spread over the whole discharge in the cryoplant load), here the 31 s TSC discharge above. The "about 10 s" of the
  // design-pulse task is the flat top (the burn, Creely section 3), which the model runs as t_end 10 s; the ramps belong to the plant
  // pulse because the cryoplant load and the flux swing cover them.
  systems: { pulseLength_s: 31, tf: { nCoils: 18 }, cs: { outerRadius_m: 0.681, thickness_m: 0.276, height_m: 3.8 } },
  t_end: 10, seed: 3,
});
// DIII-D: R=1.67, a=0.67, κ=1.8, δ=0.5, B=2.2 T, Ip=1.6 MA, 20 MW NBI (80 keV), D-D
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
// MAST-U first-campaign H-mode scenario (the shape of the machine's design maximum, R = 0.85 m, a = 0.65 m, κ = 2.5, gave q95 = 18 against the
// campaign's 5–10): R = 0.8 m, a = 0.5 m (R/a ≈ 1.6), κ = 2.1 (2.0–2.2), I_p = 0.75 MA, B_T = 0.55 T: J.R. Harrison et al., Plasma Phys. Control.
// Fusion 66 (2024) 065019, section 2 and 4 (typical R and a; 450 kA ≤ I_p ≤ 1000 kA, 0.42 T < B < 0.64 T, κ 2.0–2.2; the scenario at 750 kA) and
// K. Imada et al., Nucl. Fusion 64 (2024) 086002, table 1 (discharges #45261, #45270, #45272 at 722–740 kA, 0.55–0.56 T, κ = 2.10–2.15, δ = 0.45–0.49
// averaged over the upper and lower halves, EFIT q95 6.3–6.7: the Sauter fit gives 6.6). q95 of the preset is inside the published band 5–10 of
// J.W. Berkery et al., Plasma Phys. Control. Fusion 65 (2023) 045001. NBI: 3 MW are injected in the 750 kA scenario and TRANSP predicts 1.5–2.2 MW
// absorbed (Harrison, section 4.4); the 0D model has no first-orbit loss, so the preset takes 2 MW (75 keV) as the power that reaches the plasma
// (the design 5 MW of the two beams, or 3.5 MW, disrupt the small plasma on the beta limit within 0.4 s of the start-up). D-D. n̄/n_G = 0.46 (Harrison:
// 0.4–0.6).
export const MASTU = defaultMagnetic({
  method: 'spherical_tokamak', scaling: 'ST_Valovic',
  geometry: { R: 0.8, a: 0.5, kappa: 2.1, delta: 0.47 }, B0: 0.55, Ip_MA: 0.75,
  fuel: 'DD', fuelFracA: 1.0, n_target: 0.4e20, n_rampTime: 0.3,
  heating: { P_NBI_MW: 2, E_NBI_keV: 75, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 0, rampTime: 0.1, autoOff: false },
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
// LCFS shape (APPROXIMATION, no published DEMO LCFS values were found): M. Siccinio et al., Fusion Eng. Des. 176 (2022) 113047, table 1, gives
// κ95 = 1.65 and δ95 = 0.33 only. The LCFS values κ = 1.65 · 1.12 = 1.85 and δ = 0.33 · 1.5 = 0.5 invert the PROCESS conversion κ95 = κ/1.12,
// δ95 = δ/1.5 (M. Kovari et al., Fusion Eng. Des. 89 (2014) 3054, section 7, after N.A. Uckan, ITER Physics Design Guidelines 1989,
// IAEA/ITER/DS/10) that the DEMO baselines were produced with. The Miller boundary of that shape has 2637 m³ and 1462 m² against 2434 m³ and
// 1371 m² of the 95 % shape (+8.3 % and +6.6 %); measured on the 600 s shot, the LCFS shape lowers P_fus and Q by 3.0 % (1836 against 1892 MW),
// because the bigger volume at a given stored energy is a lower temperature. ITER's 1.70 → 1.85 and 0.33 → 0.49 are the published Shimada et al. 2007 values.
// Radial build and design data (Wave 2B review of the 1.9 m gap and 1.0 m leg, which came from no source): G. Federici et al., "Overview of the DEMO
// staged design approach in Europe", Nucl. Fusion 59 (2019) 066013 (IAEA FEC 2018 preprint WPPMI-CPR(18)19367), table 3 with its text: 16 TF coils,
// 12.1 T on the conductor, 660 MPa Tresca, 60-90 kA per turn, inboard blanket 0.755 m, inboard shield with the vessel 0.600 m, vessel-to-TF gap
// 0.020 m, plasma-to-wall 0.225 m; "for a 12.5 T peak field in DEMO we obtain an inboard leg width of around 1.3 m" (section 3.3.1); a burn of 2 h;
// flux 380 Wb for the start-up and 340 Wb for the burn, of which the PF system supplies about 320 Wb (44 %) and the CS 400 Wb, at 13 T on the CS
// conductor (table 3). The gap follows the field on the conductor, r_o = B0 R / 12.1 T = 4.39 m, i.e. 1.75 m to the winding pack (the published inboard
// layers sum to 1.60 m and the first wall, the thermal shield and the gaps of the radial build make up the rest); the model turns the
// published 1.3 m leg into 570 MPa against the 660 MPa limit, so this preset no longer carries the permanent 'TF coil stress' warning.
// Pulse: the 2 h burn, 7200 s (the ramps add a few percent: the PROCESS unit test of the 2018 baseline has 10364 s for the whole cycle).
export const DEMO = defaultMagnetic({
  geometry: { R: 9.07, a: 2.93, kappa: 1.65, delta: 0.33 }, B0: 5.86, Ip_MA: 17.75,
  profiles: { lcfsKappa: 1.85, lcfsDelta: 0.5, lcfsRef95: { kappa: 1.65, delta: 0.33 } },
  // DEMO n_G = 0.658e20 (I_p/(π a²)): the 2018 baseline has n/n_G = 1.2 (Siccinio et al. 2022, table 1, written ⟨n⟩/n_GW). APPROXIMATION on the
  // basis: the angle brackets can mean the VOLUME average (PROCESS's ⟨n_e⟩, Kovari et al. 2014 nomenclature), while the text says the pedestal
  // top is imposed at 0.85 n_G and "the line-averaged density is an output" of the systems code (the 2015 study has n̄ = 1.1 n_G, R. Wenninger
  // et al., Nucl. Fusion 55 (2015) 063003). This preset takes 1.2 as the LINE average, the quantity of the Greenwald fraction: n_target of the
  // 0D model is the VOLUME average, n̄ = 1.2 n_G = 0.790e20 = f_line(0.3) × 0.711e20 (1.5D: the line average). The earlier 0.75e20 volume average
  // was n̄ = 1.24 n_G. Read as a volume average (0.790e20) the preset's peaking α_n = 0.3 (DEMO's ASTRA profile is flatter, Siccinio Fig. 3) would
  // give n̄ = 1.33 n_G, above the limit 1.3 below: the shot then ends in a density-limit disruption at 81 s (measured). Limit 1.3: a peaked profile
  // with the pedestal below the Greenwald density (APPROXIMATION).
  n_target: 0.711e20, n_rampTime: 80,
  // Flat-top P_aux = 50 MW; H-mod erişimi (P_LH ≈ 100+ MW) için rampa sırasında ek ECRH gerekir (Siccinio 2020)
  heating: { P_NBI_MW: 50, E_NBI_keV: 1000, P_ICRH_MW: 0, f_ICRH_ion: 0.5, P_ECRH_MW: 50, rampTime: 20, autoOff: false },
  impurity: { species: 'W', concentration: 1e-5, wallReflectivity: 0.7, W_source_frac: 0, seedSpecies: 'Ar', seedConcentration: 0.001 },
  limits: { betaN_limit: 3.5, greenwald_limit: 1.3, q95_limit: 2.0, W_conc_limit: 3e-4 },
  H98: 1.1, magnet: { tech: 'Nb3Sn', gap_m: 1.75, coilThickness_m: 1.3 },
  blanket: { type: 'HCPB', li6_enrichment: 0.6, coverage: 0.85 },
  systems: { pulseLength_s: 7200, tf: { nCoils: 16 }, cs: { B_max_T: 13, pfFlux_Vs: 320 } },
  transport: { tau_p_over_tau_E: 3, tau_He_over_tau_E: 5, alpha_n: 0.3, alpha_T: 1.5 },
  economics: { availability: 0.3, thermalEff: 0.38, wallPlugEff: 0.4, discountRate: 0.07, lifetime_yr: 30 },
  t_end: 2000, seed: 21,
});

// 1.5D profil modeli preset'leri: aynı makineler, radyal taşınım + Grad–Shafranov dengesi.
// ITER/DEMO için LCFS şekli (κ_sep, δ_sep) kullanılır; 0D preset'lerdeki κ, δ 95% yüzey değerleridir
// (ITER: κ95 = 1.70 → κ_sep = 1.85, δ95 = 0.33 → δ_sep = 0.49; ITER Physics Basis 1999).
// n_target of the 1.5D model is the LINE-averaged density (control/fueling.ts): ITER15 and DEMO15 keep the targets of v3.0.0 (1.0e20 = 0.84 n_G against
// the design 0.85; 0.75e20 = 1.14 n_G, between the 1.1 and 1.2 of the DEMO studies), where the 0D presets re-based their volume-average targets.
// profiles: the LCFS shape of ITER and DEMO above.
export const ITER_15D: MagneticConfig = { ...ITER, fidelity: '1.5D', n_target: 1.0e20 };
export const JET_15D: MagneticConfig = { ...JET, fidelity: '1.5D' };
export const SPARC_15D: MagneticConfig = { ...SPARC, fidelity: '1.5D' };
export const DEMO_15D: MagneticConfig = { ...DEMO, fidelity: '1.5D', n_target: 0.75e20 };

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
  { id: 'MASTU', name: 'MAST-U', desc: 'Spherical tokamak A=1.6, B=0.55 T, I_p=0.75 MA', cfg: MASTU },
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
