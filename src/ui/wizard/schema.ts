/**
 * Sihirbaz alan şeması: her yöntem için adım → alan listesi. Değerler cfg üzerindeki
 * noktalı yolla okunur/yazılır (ör. "heating.P_NBI_MW"). `scale` gösterim ölçeğidir
 * (UI değeri = cfg değeri / scale) — böylece n [m⁻³] arayüzde 1e20 biriminde görünür.
 */
import { Method, ReactorConfig } from '../../physics/types';
import { DEFAULT_PROFILE_SETTINGS as PS } from '../../physics/profiles/defaults';
import { DIIID, DIRECT_DRIVE, GF_PISTON, ITER, JET, JT60SA, MASTU, MIRROR, MTF_LINER, MUON, NIF, PRESETS, SPARC, TAE, W7X, ZAP, ZMACHINE, DEMO } from '../../physics/presets';

export type FieldType = 'number' | 'select' | 'bool';
export interface FieldDef {
  path: string;
  label: string;
  unit?: string;
  type?: FieldType;
  min?: number; max?: number; step?: number;
  scale?: number;
  options?: { value: string; label: string }[];
  hint?: string;
  /** cfg'de değer yoksa gösterilen (modelin kullandığı) varsayılan */
  def?: unknown;
  /**
   * Blank is a valid setting: the model then applies its own rule, which `hint` explains
   * (e.g. "Blank = two-point model"). A numeric field with neither `def` nor `optional` is
   * required: RUN stays blocked while it is empty (see missingRequired).
   */
  optional?: boolean;
}
export interface StepDef { id: string; title: string; fields: FieldDef[]; note?: string }

export const STEP_IDS = ['method', 'geometry', 'fuel', 'driver', 'heating', 'run'] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_TITLES: Record<StepId, string> = {
  method: 'Method', geometry: 'Geometry', fuel: 'Fuel', driver: 'Magnet / Driver', heating: 'Heating & Fueling', run: 'RUN',
};

export const METHOD_INFO: Record<Method, { name: string; desc: string; group: string }> = {
  tokamak: { name: 'Tokamak', desc: 'Conventional A≈3; IPB98(y,2) H-mode; disruption limits', group: 'Magnetic' },
  spherical_tokamak: { name: 'Spherical Tokamak', desc: 'A≈1.3–1.6, high β_N; ST scaling', group: 'Magnetic' },
  stellarator: { name: 'Stellarator', desc: 'No current → no disruption; ISS04; Sudo density limit', group: 'Magnetic' },
  icf_indirect: { name: 'Laser ICF — indirect', desc: 'Hohlraum X-ray drive (NIF); ns scale, single-shot gain', group: 'Inertial' },
  icf_direct: { name: 'Laser ICF — direct', desc: 'Laser directly onto the capsule; LPI and imprint warnings', group: 'Inertial' },
  mtf_liner: { name: 'MTF — EM liner', desc: 'Adiabatic compression with a metal liner, µs', group: 'Magnetized target' },
  mtf_piston: { name: 'MTF — liquid-metal piston', desc: 'General Fusion type; piston jitter → asymmetry', group: 'Magnetized target' },
  maglif: { name: 'MagLIF', desc: 'Z Machine: B_z + laser preheat + liner', group: 'Magnetized target' },
  zpinch_sfs: { name: 'Z-pinch (sheared flow)', desc: 'Bennett equilibrium; sheared-flow stabilization', group: 'Magnetized target' },
  frc: { name: 'FRC', desc: 'Field-reversed configuration; β≈1, NBI', group: 'Alternative' },
  mirror: { name: 'Magnetic mirror', desc: 'Loss cone → end losses; Q≲1 (intentional)', group: 'Alternative' },
  muon: { name: 'Muon-catalyzed', desc: 'Easter egg: ~150 fusions/muon; no net energy gain', group: 'Alternative' },
};

export const METHOD_DEFAULT: Record<Method, ReactorConfig> = {
  tokamak: ITER, spherical_tokamak: MASTU, stellarator: W7X,
  icf_indirect: NIF, icf_direct: DIRECT_DRIVE,
  mtf_liner: MTF_LINER, mtf_piston: GF_PISTON, maglif: ZMACHINE, zpinch_sfs: ZAP,
  frc: TAE, mirror: MIRROR, muon: MUON,
};
export { PRESETS, ITER, JET, SPARC, DIIID, JT60SA, DEMO };

const FUEL_OPTS = [
  { value: 'DT', label: 'D-T' }, { value: 'DD', label: 'D-D' }, { value: 'DHe3', label: 'D-³He' }, { value: 'pB11', label: 'p-¹¹B (aneutronic)' },
];
const fuel = (path = 'fuel'): FieldDef => ({ path, label: 'Fuel', type: 'select', options: FUEL_OPTS, hint: 'p-B11: Z²∝brems, non-Bosch-Hale S-factor; no ignition' });

const MAGNETIC_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometry & field', fields: [
    { path: 'fidelity', label: 'Model fidelity', type: 'select', def: '0D', options: [{ value: '0D', label: '0D — global power balance (fast)' }, { value: '1.5D', label: '1.5D — radial profiles + Grad–Shafranov equilibrium' }],
      hint: '1.5D: T_e, T_i, n_e and poloidal flux on ρ_tor with sawteeth, ELMs, NTMs, bootstrap/NBCD; ~10–100× slower than 0D' },
    { path: 'geometry.R', label: 'Major radius R', unit: 'm', min: 0.3, max: 12, step: 0.01 },
    { path: 'geometry.a', label: 'Minor radius a', unit: 'm', min: 0.1, max: 4, step: 0.01 },
    { path: 'geometry.kappa', label: 'Elongation κ', min: 1, max: 3, step: 0.01 },
    { path: 'geometry.delta', label: 'Triangularity δ', min: -0.3, max: 0.8, step: 0.01 },
    { path: 'B0', label: 'Toroidal field B₀', unit: 'T', min: 0.2, max: 20, step: 0.1 },
    { path: 'Ip_MA', label: 'Plasma current I_p', unit: 'MA', min: 0, max: 30, step: 0.1, hint: 'Stellarator: 0' },
    { path: 't_end', label: 'Shot duration', unit: 's', min: 0.2, max: 5000, step: 0.5 },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1, hint: 'Same seed = same ELM/sawtooth sequence' },
    { path: 'stellarator.iota23', label: 'ι (2/3 radius)', min: 0.2, max: 2, step: 0.01, hint: 'Stellarator only' },
    { path: 'stellarator.f_ren', label: 'ISS04 f_ren', min: 0.3, max: 1.5, step: 0.01, hint: 'Configuration multiplier (W7-X ≈ 0.7–1)' },
  ] },
  { id: 'fuel', title: 'Fuel & impurities', fields: [
    fuel(),
    { path: 'fuelFracA', label: 'Species a fraction (n_D/(n_D+n_T))', min: 0.05, max: 1, step: 0.01 },
    { path: 'n_target', label: 'Target n_e', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.01, max: 20, step: 0.01 },
    { path: 'n_rampTime', label: 'Density ramp', unit: 's', min: 0.01, max: 500, step: 0.1 },
    { path: 'impurity.species', label: 'Main impurity', type: 'select', options: ['Be', 'C', 'Ne', 'Ar', 'W'].map((v) => ({ value: v, label: v })) },
    { path: 'impurity.concentration', label: 'Impurity c_Z = n_Z/n_e', min: 0, max: 0.1, step: 1e-5 },
    { path: 'impurity.wallReflectivity', label: 'Wall reflectivity (synchrotron)', min: 0, max: 0.99, step: 0.01 },
    { path: 'impurity.W_source_frac', label: 'Additional W source', min: 0, max: 1, step: 0.01, hint: 'Divertor W erosion → core accumulation' },
    { path: 'impurity.seedSpecies', label: 'Seeding impurity', type: 'select', options: [{ value: '', label: 'none' }, ...['Ne', 'Ar'].map((v) => ({ value: v, label: v }))] },
    { path: 'impurity.seedConcentration', label: 'Seed c_s', min: 0, max: 0.05, step: 1e-4, optional: true, hint: 'Blank or 0 = no seeding' },
  ] },
  { id: 'driver', title: 'Magnet, blanket, divertor, economics', fields: [
    { path: 'magnet.tech', label: 'Magnet technology', type: 'select', options: [{ value: 'Cu', label: 'Copper (normal conducting)' }, { value: 'NbTi', label: 'NbTi (≈ 9 T)' }, { value: 'Nb3Sn', label: 'Nb₃Sn (≈ 13 T)' }, { value: 'REBCO', label: 'REBCO HTS (≈ 20+ T)' }], hint: 'B_coil > B_max → quench, shot aborted' },
    { path: 'magnet.gap_m', label: 'Plasma–coil gap', unit: 'm', min: 0, max: 3, step: 0.01, hint: 'Blanket + vacuum vessel thickness' },
    { path: 'magnet.coilThickness_m', label: 'Coil thickness', unit: 'm', min: 0.05, max: 2, step: 0.01 },
    { path: 'blanket.type', label: 'Blanket', type: 'select', options: ['HCPB', 'HCLL', 'WCLL', 'DCLL', 'FLiBe', 'none'].map((v) => ({ value: v, label: v })) },
    { path: 'blanket.li6_enrichment', label: '⁶Li enrichment', min: 0.075, max: 0.95, step: 0.005 },
    { path: 'blanket.coverage', label: 'Blanket coverage', min: 0, max: 1, step: 0.01 },
    { path: 'divertor.f_rad_div', label: 'Divertor radiation fraction', min: 0, max: 0.95, step: 0.01 },
    { path: 'divertor.flux_expansion', label: 'Flux expansion', min: 1, max: 30, step: 0.5 },
    { path: 'economics.availability', label: 'Availability', min: 0.01, max: 1, step: 0.01 },
    { path: 'economics.thermalEff', label: 'Thermal efficiency', min: 0.2, max: 0.6, step: 0.01 },
    { path: 'economics.wallPlugEff', label: 'Heating wall-plug efficiency', min: 0.1, max: 0.8, step: 0.01 },
    { path: 'economics.discountRate', label: 'Discount rate', min: 0, max: 0.2, step: 0.005 },
    { path: 'economics.lifetime_yr', label: 'Lifetime', unit: 'years', min: 5, max: 60, step: 1 },
  ] },
  { id: 'heating', title: 'Heating, fueling, confinement', fields: [
    { path: 'heating.P_NBI_MW', label: 'P_NBI', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'heating.E_NBI_keV', label: 'NBI energy', unit: 'keV', min: 20, max: 2000, step: 5, hint: 'Higher E → less ion heating, greater shine-through risk' },
    { path: 'heating.P_ICRH_MW', label: 'P_ICRH', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'heating.f_ICRH_ion', label: 'ICRH ion fraction', min: 0, max: 1, step: 0.05 },
    { path: 'heating.P_ECRH_MW', label: 'P_ECRH', unit: 'MW', min: 0, max: 200, step: 0.5, hint: 'Heats electrons only' },
    { path: 'heating.rampTime', label: 'Heating ramp', unit: 's', min: 0.01, max: 200, step: 0.1 },
    { path: 'heating.autoOff', label: 'Ignition test: Q ≥ 5 → turn off heating', type: 'bool' },
    { path: 'fueling.method', label: 'Fueling method', type: 'select', options: [{ value: 'gas', label: 'Gas puffing (edge, efficiency ~0.3)' }, { value: 'pellet', label: 'Pellet (deep)' }, { value: 'nbi', label: 'NBI' }, { value: 'mixed', label: 'Mixed' }] },
    { path: 'fueling.maxRate_1e20s', label: 'Max. fueling rate', unit: '10²⁰ /s', min: 0, max: 5000, step: 1 },
    { path: 'fueling.pelletDepth', label: 'Pellet penetration depth', min: 0.05, max: 1, step: 0.05 },
    { path: 'H98', label: 'H₉₈ factor', min: 0.3, max: 2, step: 0.01, hint: 'IPB98(y,2) multiplier; 1 = standard H-mode' },
    { path: 'H89', label: 'H₈₉ (L-mode) factor', min: 0.3, max: 3, step: 0.01 },
    { path: 'scaling', label: 'Confinement scaling', type: 'select', options: [{ value: 'IPB98y2', label: 'IPB98(y,2)' }, { value: 'ST_Valovic', label: 'ST (Valovic)' }] },
    { path: 'transport.tau_p_over_tau_E', label: 'τ_p / τ_E', min: 0.5, max: 10, step: 0.1 },
    { path: 'transport.tau_He_over_tau_E', label: 'τ_He* / τ_E', min: 1, max: 20, step: 0.5, hint: 'He ash removal; ≈5 typical' },
    { path: 'transport.alpha_n', label: 'Density profile peaking α_n', min: 0, max: 2, step: 0.05 },
    { path: 'transport.alpha_T', label: 'Temperature profile peaking α_T', min: 0.2, max: 3, step: 0.05 },
    { path: 'limits.betaN_limit', label: 'Troyon β_N limit', min: 1.5, max: 6, step: 0.1 },
    { path: 'limits.greenwald_limit', label: 'Greenwald limit n/n_G', min: 0.5, max: 2, step: 0.05 },
    { path: 'limits.q95_limit', label: 'q₉₅ limit', min: 1.5, max: 4, step: 0.1 },
    { path: 'limits.W_conc_limit', label: 'W accumulation limit c_W', min: 1e-5, max: 1e-3, step: 1e-5 },
    { path: 'events.elms', label: 'Type-I ELM', type: 'bool' },
    { path: 'events.sawteeth', label: 'Sawteeth', type: 'bool' },
    { path: 'events.ntm', label: 'NTM', type: 'bool' },
    // ---- 1.5D profil modeli (yalnız fidelity = 1.5D)
    { path: 'profiles.transportModel', label: '1.5D · transport model', type: 'select', def: PS.transportModel, options: [{ value: 'scaling', label: 'τ_E-scaling constrained (validated)' }, { value: 'cgm', label: 'Critical-gradient model (predictive, experimental)' }] },
    { path: 'profiles.nRho', label: '1.5D · radial cells N_ρ', min: 16, max: 200, step: 1, def: PS.nRho },
    { path: 'profiles.eqNR', label: '1.5D · Grad–Shafranov grid N_R', min: 25, max: 129, step: 2, def: PS.eqNR },
    { path: 'profiles.lcfsKappa', label: '1.5D · LCFS elongation', min: 1, max: 3, step: 0.01, optional: true, hint: 'Blank = geometry κ (κ_95 ≈ κ_LCFS/1.1)' },
    { path: 'profiles.lcfsDelta', label: '1.5D · LCFS triangularity', min: -0.3, max: 0.8, step: 0.01, optional: true, hint: 'Blank = geometry δ' },
    { path: 'profiles.chiShape', label: '1.5D · χ shape c in (1 + cρ²)', min: 0, max: 10, step: 0.1, def: PS.chiShape },
    { path: 'profiles.chiRatio', label: '1.5D · χ_i / χ_e', min: 0.2, max: 5, step: 0.05, def: PS.chiRatio },
    { path: 'profiles.DoverChi', label: '1.5D · D / χ_e', min: 0.05, max: 2, step: 0.05, def: PS.DoverChi },
    { path: 'profiles.stiffness', label: '1.5D · profile stiffness', min: 0, max: 10, step: 0.1, def: PS.stiffness, hint: 'χ ×= 1 + stiffness·max(0, (R/L_T)/(R/L_T)_crit − 1)' },
    { path: 'profiles.critGrad', label: '1.5D · critical R/L_T', min: 1, max: 15, step: 0.1, def: PS.critGrad },
    { path: 'profiles.pedestalWidth', label: '1.5D · pedestal width Δ_ped', unit: 'ρ', min: 0.02, max: 0.15, step: 0.005, def: PS.pedestalWidth },
    { path: 'profiles.etbFactor', label: '1.5D · ETB χ reduction', min: 0.01, max: 1, step: 0.01, def: PS.etbFactor },
    { path: 'profiles.alphaCritFactor', label: '1.5D · ballooning limit × α_crit', min: 0.5, max: 2, step: 0.05, def: PS.alphaCritFactor, hint: 'ELM trigger: α_ped > factor · α_crit(s, κ, δ)' },
    { path: 'profiles.elmFraction', label: '1.5D · ELM crash depth ΔW/W_ped', min: 0.05, max: 0.8, step: 0.01, def: PS.elmFraction },
    { path: 'profiles.sawtoothShear', label: '1.5D · sawtooth trigger shear s₁', min: 0.05, max: 1, step: 0.01, def: PS.sawtoothShear },
    { path: 'profiles.ecrhRho', label: '1.5D · ECRH deposition ρ', min: 0, max: 0.9, step: 0.01, def: PS.ecrhRho },
    { path: 'profiles.ecrhWidth', label: '1.5D · ECRH width', min: 0.02, max: 0.3, step: 0.01, def: PS.ecrhWidth },
    { path: 'profiles.icrhWidth', label: '1.5D · ICRH width', min: 0.05, max: 0.6, step: 0.01, def: PS.icrhWidth },
    { path: 'profiles.nbiRtan', label: '1.5D · NBI tangency radius / R', min: 0.3, max: 1.3, step: 0.01, def: PS.nbiRtan },
    { path: 'profiles.nbcdEff', label: '1.5D · NBCD efficiency factor', min: 0, max: 1, step: 0.01, def: PS.nbcdEff },
    { path: 'profiles.eccdEff', label: '1.5D · ECCD efficiency factor', min: 0, max: 1, step: 0.01, def: PS.eccdEff },
    { path: 'profiles.nsepFrac', label: '1.5D · separatrix density n_sep/⟨n_e⟩', min: 0.1, max: 0.8, step: 0.01, def: PS.nsepFrac },
    { path: 'profiles.Tsep_keV', label: '1.5D · separatrix T_e', unit: 'keV', min: 0.02, max: 0.5, step: 0.005, optional: true, hint: 'Blank = two-point model (Eich λ_q)' },
  ] },
];

const ICF_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Capsule', fields: [
    { path: 'capsuleRadius_um', label: 'Capsule outer radius', unit: 'µm', min: 200, max: 5000, step: 10 },
    { path: 'fuelMass_ug', label: 'DT fuel mass', unit: 'µg', min: 10, max: 5000, step: 5 },
    { path: 'ablatorMass_ug', label: 'Ablator mass', unit: 'µg', min: 100, max: 50000, step: 50 },
    { path: 'ablator', label: 'Ablator', type: 'select', options: [{ value: 'HDC', label: 'HDC (diamond)' }, { value: 'CH', label: 'CH plastic' }, { value: 'Be', label: 'Beryllium' }] },
    { path: 'convergenceRatio', label: 'Convergence ratio CR', min: 5, max: 60, step: 1, hint: 'Higher CR → higher ρR, greater sensitivity to asymmetry' },
    { path: 'adiabat', label: 'Adiabat α', min: 1, max: 6, step: 0.1, hint: 'Lower α → more compressible but prone to RT' },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Fuel & imperfections', fields: [
    fuel(),
    { path: 'asymmetry_rms', label: 'Low-mode asymmetry (rms)', unit: '%', min: 0, max: 15, step: 0.1 },
    { path: 'surfaceRoughness_nm', label: 'Surface roughness', unit: 'nm', min: 1, max: 500, step: 1, hint: 'Rayleigh-Taylor seed' },
  ] },
  { id: 'driver', title: 'Laser driver', fields: [
    { path: 'E_laser_MJ', label: 'Laser energy', unit: 'MJ', min: 0.05, max: 10, step: 0.05 },
    { path: 'wavelength_nm', label: 'Wavelength', unit: 'nm', min: 248, max: 1064, step: 1, hint: '351 nm = 3ω Nd:glass' },
    { path: 'pulse_ns', label: 'Pulse duration', unit: 'ns', min: 1, max: 30, step: 0.5 },
    { path: 'implosionVelocity_kms', label: 'Implosion velocity', unit: 'km/s', min: 100, max: 600, step: 5, hint: 'Ignition ≳ 350–400 km/s' },
    { path: 'hohlraumEff', label: 'Hohlraum efficiency (indirect)', min: 0.02, max: 0.3, step: 0.005 },
    { path: 'absorption', label: 'Absorption (direct)', min: 0.2, max: 1, step: 0.01 },
  ] },
  { id: 'heating', title: 'Heating', fields: [], note: 'In ICF, the driver supplies heating: the hotspot is heated by PdV work from the shell\'s kinetic energy; alpha deposition initiates the burn wave.' },
];

const MTF_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Target geometry', fields: [
    { path: 'r0_m', label: 'Initial radius r₀', unit: 'm', min: 1e-4, max: 3, step: 1e-3 },
    { path: 'L_m', label: 'Length L', unit: 'm', min: 1e-3, max: 5, step: 1e-3 },
    { path: 'compressionRatio', label: 'Compression ratio r₀/r_min', min: 1, max: 60, step: 0.5 },
    { path: 'linerThicknessRatio', label: 'Liner Δr/r', min: 0, max: 1, step: 0.01, hint: 'Thin liner → magneto-RT growth' },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Fuel & initial plasma', fields: [
    fuel(),
    { path: 'n0', label: 'Initial n', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.01, max: 1e5, step: 0.1 },
    { path: 'T0_keV', label: 'Initial T', unit: 'keV', min: 0.01, max: 5, step: 0.01 },
    { path: 'B0', label: 'Initial B', unit: 'T', min: 0, max: 50, step: 0.1 },
  ] },
  { id: 'driver', title: 'Driver', fields: [
    { path: 'driverEnergy_MJ', label: 'Driver energy', unit: 'MJ', min: 0.01, max: 1000, step: 0.1 },
    { path: 'compressionTime_us', label: 'Compression duration', unit: 'µs', min: 0.01, max: 20000, step: 0.1 },
    { path: 'jitter_us', label: 'Piston/liner jitter', unit: 'µs', min: 0, max: 500, step: 0.1, hint: 'Synchronization error → asymmetry → gain loss' },
    { path: 'current_MA', label: 'Driver current', unit: 'MA', min: 0, max: 60, step: 0.1, hint: 'Z-pinch / MagLIF' },
    { path: 'flowShear', label: 'Flow shear (0–1)', min: 0, max: 1, step: 0.05 },
  ] },
  { id: 'heating', title: 'Preheat', fields: [
    { path: 'preheat_kJ', label: 'Laser preheat', unit: 'kJ', min: 0, max: 50, step: 0.1 },
  ] },
];

const FRC_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometry', fields: [
    { path: 'rs_m', label: 'Separatrix radius r_s', unit: 'm', min: 0.05, max: 2, step: 0.01 },
    { path: 'L_m', label: 'Length', unit: 'm', min: 0.2, max: 20, step: 0.1 },
    { path: 't_end', label: 'Duration', unit: 's', min: 0.001, max: 100, step: 0.001 },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Fuel', fields: [fuel(),
    { path: 'n0', label: 'n₀', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.001, max: 100, step: 0.01 },
    { path: 'T0_keV', label: 'T₀', unit: 'keV', min: 0.01, max: 20, step: 0.01 }] },
  { id: 'driver', title: 'Field', fields: [{ path: 'Be_T', label: 'External field B_e', unit: 'T', min: 0.01, max: 10, step: 0.01 }] },
  { id: 'heating', title: 'NBI', fields: [
    { path: 'P_NBI_MW', label: 'P_NBI', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'E_NBI_keV', label: 'E_NBI', unit: 'keV', min: 5, max: 500, step: 1 },
  ] },
];

const MIRROR_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometry', fields: [
    { path: 'L_m', label: 'Length', unit: 'm', min: 0.5, max: 100, step: 0.5 },
    { path: 'a_m', label: 'Radius', unit: 'm', min: 0.02, max: 2, step: 0.01 },
    { path: 'mirrorRatio', label: 'Mirror ratio R_m', min: 1.5, max: 50, step: 0.5, hint: 'Loss cone angle sin²θ = 1/R_m' },
    { path: 't_end', label: 'Duration', unit: 's', min: 0.01, max: 100, step: 0.01 },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Fuel', fields: [fuel(),
    { path: 'n0', label: 'n₀', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.001, max: 100, step: 0.01 },
    { path: 'T_keV', label: 'T', unit: 'keV', min: 0.1, max: 100, step: 0.1 }] },
  { id: 'driver', title: 'Field', fields: [
    { path: 'B_center_T', label: 'Central B', unit: 'T', min: 0.1, max: 20, step: 0.1 },
    { path: 'tandem', label: 'Tandem (end plugs)', type: 'bool' }] },
  { id: 'heating', title: 'Heating', fields: [{ path: 'P_aux_MW', label: 'P_aux', unit: 'MW', min: 0, max: 500, step: 0.5 }] },
];

const MUON_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Target', fields: [
    { path: 'density_LHD', label: 'Density (in units of liquid hydrogen density)', min: 0.01, max: 2, step: 0.01 },
    { path: 'T_K', label: 'Temperature', unit: 'K', min: 20, max: 2000, step: 10 },
    { path: 'seed', label: 'RNG seed', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Fuel', fields: [{ path: 'stickingProb', label: 'α-sticking probability ω_s', min: 0.001, max: 0.02, step: 0.0001, hint: '≈0.0056 → max ~150–180 fusions/muon' }], note: 'D-T fuel (µ-catalyzed d-t cycle).' },
  { id: 'driver', title: 'Muon source', fields: [
    { path: 'muonRate_per_s', label: 'Muon production rate', unit: '/s', min: 1e10, max: 1e18, step: 1e12 },
    { path: 'muonCost_GeV', label: 'Muon cost', unit: 'GeV', min: 0.5, max: 20, step: 0.1, hint: 'Including accelerator efficiency; ~5 GeV typical' },
  ] },
  { id: 'heating', title: 'Heating', fields: [], note: 'Cold fusion: no plasma, no heating. Gain is limited by sticking → Q < 1.' },
];

export function stepsFor(method: Method): StepDef[] {
  switch (method) {
    case 'tokamak': case 'spherical_tokamak': case 'stellarator': return MAGNETIC_STEPS;
    case 'icf_direct': case 'icf_indirect': return ICF_STEPS;
    case 'mtf_liner': case 'mtf_piston': case 'maglif': case 'zpinch_sfs': return MTF_STEPS;
    case 'frc': return FRC_STEPS;
    case 'mirror': return MIRROR_STEPS;
    case 'muon': return MUON_STEPS;
  }
}

/** Belirli bir alan bu yöntem (ve model seçimi) için anlamlı mı (stellarator/ICF/1.5D dallanmaları) */
export function fieldVisible(method: Method, path: string, cfg?: ReactorConfig): boolean {
  if (path === 'fidelity') return method === 'tokamak' || method === 'spherical_tokamak';
  if (path.startsWith('profiles.')) return (method === 'tokamak' || method === 'spherical_tokamak') && (cfg as { fidelity?: string } | undefined)?.fidelity === '1.5D';
  if (path.startsWith('stellarator.')) return method === 'stellarator';
  if (path === 'Ip_MA' || path === 'scaling') return method !== 'stellarator';
  if (path.startsWith('limits.') || path.startsWith('events.')) return method !== 'stellarator';
  if (path === 'hohlraumEff') return method === 'icf_indirect';
  if (path === 'absorption') return method === 'icf_direct';
  if (path === 'current_MA') return method === 'maglif' || method === 'zpinch_sfs' || method === 'mtf_liner';
  if (path === 'flowShear') return method === 'zpinch_sfs';
  if (path === 'preheat_kJ') return method === 'maglif';
  if (path === 'jitter_us') return method !== 'zpinch_sfs';
  if (path === 'linerThicknessRatio' || path === 'compressionRatio' || path === 'driverEnergy_MJ' || path === 'compressionTime_us') return method !== 'zpinch_sfs' || path !== 'linerThicknessRatio';
  return true;
}

/** A numeric field must have a value before a run: blank is neither a documented model default nor a documented setting. */
export function isRequired(f: FieldDef): boolean {
  return (f.type ?? 'number') === 'number' && f.def === undefined && !f.optional;
}

/**
 * Visible required fields of `cfg` that are empty (a blank wizard input stores undefined).
 * The model has no default for them, so running would give non-finite results.
 */
export function missingRequired(cfg: ReactorConfig): { step: StepDef; field: FieldDef }[] {
  const out: { step: StepDef; field: FieldDef }[] = [];
  for (const step of stepsFor(cfg.method)) {
    for (const field of step.fields) {
      if (!isRequired(field) || !fieldVisible(cfg.method, field.path, cfg)) continue;
      const v = getPath(cfg, field.path);
      if (typeof v !== 'number' || !Number.isFinite(v)) out.push({ step, field });
    }
  }
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const clone = (o: unknown): Record<string, unknown> => ({ ...(o as Record<string, unknown>) });
  const root = clone(obj);
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = clone(cur[keys[i]] ?? {});
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}
