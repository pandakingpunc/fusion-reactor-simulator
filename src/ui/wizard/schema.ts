/**
 * Sihirbaz alan şeması: her yöntem için adım → alan listesi. Değerler cfg üzerindeki
 * noktalı yolla okunur/yazılır (ör. "heating.P_NBI_MW"). `scale` gösterim ölçeğidir
 * (UI değeri = cfg değeri / scale) — böylece n [m⁻³] arayüzde 1e20 biriminde görünür.
 */
import { Method, ReactorConfig } from '../../physics/types';
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
}
export interface StepDef { id: string; title: string; fields: FieldDef[]; note?: string }

export const STEP_IDS = ['method', 'geometry', 'fuel', 'driver', 'heating', 'run'] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_TITLES: Record<StepId, string> = {
  method: 'Yöntem', geometry: 'Geometri', fuel: 'Yakıt', driver: 'Mıknatıs / Sürücü', heating: 'Isıtma & Besleme', run: 'ÇALIŞTIR',
};

export const METHOD_INFO: Record<Method, { name: string; desc: string; group: string }> = {
  tokamak: { name: 'Tokamak', desc: 'Konvansiyonel A≈3; IPB98(y,2) H-mod; disruption limitleri', group: 'Manyetik' },
  spherical_tokamak: { name: 'Sferik Tokamak', desc: 'A≈1.3–1.6, yüksek β_N; ST ölçeklemesi', group: 'Manyetik' },
  stellarator: { name: 'Stellarator', desc: 'Akım yok → disruption yok; ISS04; Sudo yoğunluk limiti', group: 'Manyetik' },
  icf_indirect: { name: 'Lazer ICF — dolaylı', desc: 'Hohlraum x-ışını tahriki (NIF); ns ölçeği, tek atış kazancı', group: 'Eylemsizlik' },
  icf_direct: { name: 'Lazer ICF — doğrudan', desc: 'Lazer doğrudan kapsüle; LPI ve baskı uyarıları', group: 'Eylemsizlik' },
  mtf_liner: { name: 'MTF — EM liner', desc: 'Metal liner ile adiabatik sıkıştırma, µs', group: 'Manyetize hedef' },
  mtf_piston: { name: 'MTF — sıvı metal piston', desc: 'General Fusion tipi; piston titremesi → asimetri', group: 'Manyetize hedef' },
  maglif: { name: 'MagLIF', desc: 'Z Machine: B_z + lazer ön-ısıtma + liner', group: 'Manyetize hedef' },
  zpinch_sfs: { name: 'Z-pinch (kesme-akış)', desc: 'Bennett dengesi; kesme-akış stabilizasyonu', group: 'Manyetize hedef' },
  frc: { name: 'FRC', desc: 'Alan tersinmiş konfigürasyon; β≈1, NBI', group: 'Alternatif' },
  mirror: { name: 'Manyetik ayna', desc: 'Kayıp konisi → uç kayıpları; Q≲1 (kasıtlı)', group: 'Alternatif' },
  muon: { name: 'Müon-katalizli', desc: 'Easter egg: ~150 füzyon/müon; enerji dengesi tutmaz', group: 'Alternatif' },
};

export const METHOD_DEFAULT: Record<Method, ReactorConfig> = {
  tokamak: ITER, spherical_tokamak: MASTU, stellarator: W7X,
  icf_indirect: NIF, icf_direct: DIRECT_DRIVE,
  mtf_liner: MTF_LINER, mtf_piston: GF_PISTON, maglif: ZMACHINE, zpinch_sfs: ZAP,
  frc: TAE, mirror: MIRROR, muon: MUON,
};
export { PRESETS, ITER, JET, SPARC, DIIID, JT60SA, DEMO };

const FUEL_OPTS = [
  { value: 'DT', label: 'D-T' }, { value: 'DD', label: 'D-D' }, { value: 'DHe3', label: 'D-³He' }, { value: 'pB11', label: 'p-¹¹B (aneutronik)' },
];
const fuel = (path = 'fuel'): FieldDef => ({ path, label: 'Yakıt', type: 'select', options: FUEL_OPTS, hint: 'p-B11: Z²∝brems, Bosch-Hale dışı S-faktör; ateşlenmez' });

const MAGNETIC_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometri & alan', fields: [
    { path: 'geometry.R', label: 'Büyük yarıçap R', unit: 'm', min: 0.3, max: 12, step: 0.01 },
    { path: 'geometry.a', label: 'Küçük yarıçap a', unit: 'm', min: 0.1, max: 4, step: 0.01 },
    { path: 'geometry.kappa', label: 'Elongasyon κ', min: 1, max: 3, step: 0.01 },
    { path: 'geometry.delta', label: 'Üçgensellik δ', min: -0.3, max: 0.8, step: 0.01 },
    { path: 'B0', label: 'Toroidal alan B₀', unit: 'T', min: 0.2, max: 20, step: 0.1 },
    { path: 'Ip_MA', label: 'Plazma akımı I_p', unit: 'MA', min: 0, max: 30, step: 0.1, hint: 'Stellarator: 0' },
    { path: 't_end', label: 'Atış süresi', unit: 's', min: 0.2, max: 5000, step: 0.5 },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1, hint: 'Aynı tohum = aynı ELM/testere dişi dizisi' },
    { path: 'stellarator.iota23', label: 'ι (2/3 yarıçap)', min: 0.2, max: 2, step: 0.01, hint: 'Yalnızca stellarator' },
    { path: 'stellarator.f_ren', label: 'ISS04 f_ren', min: 0.3, max: 1.5, step: 0.01, hint: 'Konfigürasyon çarpanı (W7-X ≈ 0.7–1)' },
  ] },
  { id: 'fuel', title: 'Yakıt & safsızlık', fields: [
    fuel(),
    { path: 'fuelFracA', label: 'Tür a oranı (n_D/(n_D+n_T))', min: 0.05, max: 1, step: 0.01 },
    { path: 'n_target', label: 'Hedef n_e', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.01, max: 20, step: 0.01 },
    { path: 'n_rampTime', label: 'Yoğunluk rampası', unit: 's', min: 0.01, max: 500, step: 0.1 },
    { path: 'impurity.species', label: 'Ana safsızlık', type: 'select', options: ['Be', 'C', 'W', 'Ar', 'Ne', 'N', 'Fe'].map((v) => ({ value: v, label: v })) },
    { path: 'impurity.concentration', label: 'Safsızlık c_Z = n_Z/n_e', min: 0, max: 0.1, step: 1e-5 },
    { path: 'impurity.wallReflectivity', label: 'Duvar yansıtıcılığı (senkrotron)', min: 0, max: 0.99, step: 0.01 },
    { path: 'impurity.W_source_frac', label: 'Ek W kaynağı', min: 0, max: 1, step: 0.01, hint: 'Divertör W erozyonu → merkez birikimi' },
    { path: 'impurity.seedSpecies', label: 'Tohumlama safsızlığı', type: 'select', options: [{ value: '', label: 'yok' }, ...['Ar', 'Ne', 'N'].map((v) => ({ value: v, label: v }))] },
    { path: 'impurity.seedConcentration', label: 'Tohum c_s', min: 0, max: 0.05, step: 1e-4 },
  ] },
  { id: 'driver', title: 'Mıknatıs, blanket, divertör, ekonomi', fields: [
    { path: 'magnet.tech', label: 'Mıknatıs teknolojisi', type: 'select', options: [{ value: 'Cu', label: 'Bakır (normal)' }, { value: 'NbTi', label: 'NbTi (≈ 9 T)' }, { value: 'Nb3Sn', label: 'Nb₃Sn (≈ 13 T)' }, { value: 'REBCO', label: 'REBCO HTS (≈ 20+ T)' }], hint: 'B_coil > B_max → quench, atış iptal' },
    { path: 'magnet.gap_m', label: 'Plazma–bobin boşluğu', unit: 'm', min: 0, max: 3, step: 0.01, hint: 'Blanket + vakum kabı kalınlığı' },
    { path: 'magnet.coilThickness_m', label: 'Bobin kalınlığı', unit: 'm', min: 0.05, max: 2, step: 0.01 },
    { path: 'blanket.type', label: 'Blanket', type: 'select', options: ['HCPB', 'HCLL', 'WCLL', 'DCLL', 'FLiBe', 'none'].map((v) => ({ value: v, label: v })) },
    { path: 'blanket.li6_enrichment', label: '⁶Li zenginleştirme', min: 0.075, max: 0.95, step: 0.005 },
    { path: 'blanket.coverage', label: 'Blanket kapsama', min: 0, max: 1, step: 0.01 },
    { path: 'divertor.f_rad_div', label: 'Divertör radyasyon oranı', min: 0, max: 0.95, step: 0.01 },
    { path: 'divertor.flux_expansion', label: 'Akı genişlemesi', min: 1, max: 30, step: 0.5 },
    { path: 'economics.availability', label: 'Kullanılabilirlik', min: 0.01, max: 1, step: 0.01 },
    { path: 'economics.thermalEff', label: 'Termal verim', min: 0.2, max: 0.6, step: 0.01 },
    { path: 'economics.wallPlugEff', label: 'Isıtma duvar-prizi verimi', min: 0.1, max: 0.8, step: 0.01 },
    { path: 'economics.discountRate', label: 'İskonto oranı', min: 0, max: 0.2, step: 0.005 },
    { path: 'economics.lifetime_yr', label: 'Ömür', unit: 'yıl', min: 5, max: 60, step: 1 },
  ] },
  { id: 'heating', title: 'Isıtma, besleme, hapsetme', fields: [
    { path: 'heating.P_NBI_MW', label: 'P_NBI', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'heating.E_NBI_keV', label: 'NBI enerjisi', unit: 'keV', min: 20, max: 2000, step: 5, hint: 'Yüksek E → daha az iyon ısıtması, daha çok shine-through riski' },
    { path: 'heating.P_ICRH_MW', label: 'P_ICRH', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'heating.f_ICRH_ion', label: 'ICRH iyon payı', min: 0, max: 1, step: 0.05 },
    { path: 'heating.P_ECRH_MW', label: 'P_ECRH', unit: 'MW', min: 0, max: 200, step: 0.5, hint: 'Yalnızca elektron ısıtır' },
    { path: 'heating.rampTime', label: 'Isıtma rampası', unit: 's', min: 0.01, max: 200, step: 0.1 },
    { path: 'heating.autoOff', label: 'Ateşleme testi: Q ≥ 5 → ısıtmayı kapat', type: 'bool' },
    { path: 'fueling.method', label: 'Besleme yöntemi', type: 'select', options: [{ value: 'gas', label: 'Gaz üfleme (kenar, verim ~0.3)' }, { value: 'pellet', label: 'Pellet (derin)' }, { value: 'nbi', label: 'NBI' }, { value: 'mixed', label: 'Karışık' }] },
    { path: 'fueling.maxRate_1e20s', label: 'Maks. besleme hızı', unit: '10²⁰ /s', min: 0, max: 5000, step: 1 },
    { path: 'fueling.pelletDepth', label: 'Pellet nüfuz derinliği', min: 0.05, max: 1, step: 0.05 },
    { path: 'H98', label: 'H₉₈ faktörü', min: 0.3, max: 2, step: 0.01, hint: 'IPB98(y,2) çarpanı; 1 = standart H-mod' },
    { path: 'H89', label: 'H₈₉ (L-mod) faktörü', min: 0.3, max: 3, step: 0.01 },
    { path: 'scaling', label: 'Hapsetme ölçeklemesi', type: 'select', options: [{ value: 'IPB98y2', label: 'IPB98(y,2)' }, { value: 'ST_Valovic', label: 'ST (Valovic)' }] },
    { path: 'transport.tau_p_over_tau_E', label: 'τ_p / τ_E', min: 0.5, max: 10, step: 0.1 },
    { path: 'transport.tau_He_over_tau_E', label: 'τ_He* / τ_E', min: 1, max: 20, step: 0.5, hint: 'He kül tahliyesi; ≈5 tipik' },
    { path: 'transport.alpha_n', label: 'Yoğunluk profil tepeliliği α_n', min: 0, max: 2, step: 0.05 },
    { path: 'transport.alpha_T', label: 'Sıcaklık profil tepeliliği α_T', min: 0.2, max: 3, step: 0.05 },
    { path: 'limits.betaN_limit', label: 'Troyon β_N limiti', min: 1.5, max: 6, step: 0.1 },
    { path: 'limits.greenwald_limit', label: 'Greenwald limiti n/n_G', min: 0.5, max: 2, step: 0.05 },
    { path: 'limits.q95_limit', label: 'q₉₅ limiti', min: 1.5, max: 4, step: 0.1 },
    { path: 'limits.W_conc_limit', label: 'W birikim limiti c_W', min: 1e-5, max: 1e-3, step: 1e-5 },
    { path: 'events.elms', label: 'Tip-I ELM', type: 'bool' },
    { path: 'events.sawteeth', label: 'Testere dişi', type: 'bool' },
    { path: 'events.ntm', label: 'NTM', type: 'bool' },
  ] },
];

const ICF_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Kapsül', fields: [
    { path: 'capsuleRadius_um', label: 'Kapsül dış yarıçapı', unit: 'µm', min: 200, max: 5000, step: 10 },
    { path: 'fuelMass_ug', label: 'DT yakıt kütlesi', unit: 'µg', min: 10, max: 5000, step: 5 },
    { path: 'ablatorMass_ug', label: 'Ablatör kütlesi', unit: 'µg', min: 100, max: 50000, step: 50 },
    { path: 'ablator', label: 'Ablatör', type: 'select', options: [{ value: 'HDC', label: 'HDC (elmas)' }, { value: 'CH', label: 'CH plastik' }, { value: 'Be', label: 'Berilyum' }] },
    { path: 'convergenceRatio', label: 'Sıkışma oranı CR', min: 5, max: 60, step: 1, hint: 'Yüksek CR → ρR artar, asimetriye duyarlılık artar' },
    { path: 'adiabat', label: 'Adiabat α', min: 1, max: 6, step: 0.1, hint: 'Düşük α → daha sıkışabilir ama RT\'ye açık' },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Yakıt & kusurlar', fields: [
    fuel(),
    { path: 'asymmetry_rms', label: 'Düşük-mod asimetri (rms)', unit: '%', min: 0, max: 15, step: 0.1 },
    { path: 'surfaceRoughness_nm', label: 'Yüzey pürüzlülüğü', unit: 'nm', min: 1, max: 500, step: 1, hint: 'Rayleigh-Taylor tohumu' },
  ] },
  { id: 'driver', title: 'Lazer sürücü', fields: [
    { path: 'E_laser_MJ', label: 'Lazer enerjisi', unit: 'MJ', min: 0.05, max: 10, step: 0.05 },
    { path: 'wavelength_nm', label: 'Dalga boyu', unit: 'nm', min: 248, max: 1064, step: 1, hint: '351 nm = 3ω Nd:cam' },
    { path: 'pulse_ns', label: 'Darbe süresi', unit: 'ns', min: 1, max: 30, step: 0.5 },
    { path: 'implosionVelocity_kms', label: 'İmplozyon hızı', unit: 'km/s', min: 100, max: 600, step: 5, hint: 'Ateşleme ≳ 350–400 km/s' },
    { path: 'hohlraumEff', label: 'Hohlraum verimi (dolaylı)', min: 0.02, max: 0.3, step: 0.005 },
    { path: 'absorption', label: 'Soğurma (doğrudan)', min: 0.2, max: 1, step: 0.01 },
  ] },
  { id: 'heating', title: 'Isıtma', fields: [], note: 'ICF\'de ısıtma sürücüdür: hotspot, kabuğun kinetik enerjisinin PdV işiyle ısınır; alfa depolanması yanma dalgasını başlatır.' },
];

const MTF_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Hedef geometrisi', fields: [
    { path: 'r0_m', label: 'Başlangıç yarıçapı r₀', unit: 'm', min: 1e-4, max: 3, step: 1e-3 },
    { path: 'L_m', label: 'Uzunluk L', unit: 'm', min: 1e-3, max: 5, step: 1e-3 },
    { path: 'compressionRatio', label: 'Sıkışma oranı r₀/r_min', min: 1, max: 60, step: 0.5 },
    { path: 'linerThicknessRatio', label: 'Liner Δr/r', min: 0, max: 1, step: 0.01, hint: 'İnce liner → magneto-RT büyümesi' },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Yakıt & başlangıç plazması', fields: [
    fuel(),
    { path: 'n0', label: 'Başlangıç n', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.01, max: 1e5, step: 0.1 },
    { path: 'T0_keV', label: 'Başlangıç T', unit: 'keV', min: 0.01, max: 5, step: 0.01 },
    { path: 'B0', label: 'Başlangıç B', unit: 'T', min: 0, max: 50, step: 0.1 },
  ] },
  { id: 'driver', title: 'Sürücü', fields: [
    { path: 'driverEnergy_MJ', label: 'Sürücü enerjisi', unit: 'MJ', min: 0.01, max: 1000, step: 0.1 },
    { path: 'compressionTime_us', label: 'Sıkıştırma süresi', unit: 'µs', min: 0.01, max: 20000, step: 0.1 },
    { path: 'jitter_us', label: 'Piston/liner titremesi', unit: 'µs', min: 0, max: 500, step: 0.1, hint: 'Senkron hatası → asimetri → kazanç kaybı' },
    { path: 'current_MA', label: 'Sürücü akımı', unit: 'MA', min: 0, max: 60, step: 0.1, hint: 'Z-pinch / MagLIF' },
    { path: 'flowShear', label: 'Kesme-akış (0–1)', min: 0, max: 1, step: 0.05 },
  ] },
  { id: 'heating', title: 'Ön-ısıtma', fields: [
    { path: 'preheat_kJ', label: 'Lazer ön-ısıtma', unit: 'kJ', min: 0, max: 50, step: 0.1 },
  ] },
];

const FRC_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometri', fields: [
    { path: 'rs_m', label: 'Ayırıcı yarıçap r_s', unit: 'm', min: 0.05, max: 2, step: 0.01 },
    { path: 'L_m', label: 'Uzunluk', unit: 'm', min: 0.2, max: 20, step: 0.1 },
    { path: 't_end', label: 'Süre', unit: 's', min: 0.001, max: 100, step: 0.001 },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Yakıt', fields: [fuel(),
    { path: 'n0', label: 'n₀', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.001, max: 100, step: 0.01 },
    { path: 'T0_keV', label: 'T₀', unit: 'keV', min: 0.01, max: 20, step: 0.01 }] },
  { id: 'driver', title: 'Alan', fields: [{ path: 'Be_T', label: 'Dış alan B_e', unit: 'T', min: 0.01, max: 10, step: 0.01 }] },
  { id: 'heating', title: 'NBI', fields: [
    { path: 'P_NBI_MW', label: 'P_NBI', unit: 'MW', min: 0, max: 200, step: 0.5 },
    { path: 'E_NBI_keV', label: 'E_NBI', unit: 'keV', min: 5, max: 500, step: 1 },
  ] },
];

const MIRROR_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Geometri', fields: [
    { path: 'L_m', label: 'Uzunluk', unit: 'm', min: 0.5, max: 100, step: 0.5 },
    { path: 'a_m', label: 'Yarıçap', unit: 'm', min: 0.02, max: 2, step: 0.01 },
    { path: 'mirrorRatio', label: 'Ayna oranı R_m', min: 1.5, max: 50, step: 0.5, hint: 'Kayıp konisi açısı sin²θ = 1/R_m' },
    { path: 't_end', label: 'Süre', unit: 's', min: 0.01, max: 100, step: 0.01 },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Yakıt', fields: [fuel(),
    { path: 'n0', label: 'n₀', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.001, max: 100, step: 0.01 },
    { path: 'T_keV', label: 'T', unit: 'keV', min: 0.1, max: 100, step: 0.1 }] },
  { id: 'driver', title: 'Alan', fields: [
    { path: 'B_center_T', label: 'Merkez B', unit: 'T', min: 0.1, max: 20, step: 0.1 },
    { path: 'tandem', label: 'Tandem (uç tıkaçları)', type: 'bool' }] },
  { id: 'heating', title: 'Isıtma', fields: [{ path: 'P_aux_MW', label: 'P_aux', unit: 'MW', min: 0, max: 500, step: 0.5 }] },
];

const MUON_STEPS: StepDef[] = [
  { id: 'geometry', title: 'Hedef', fields: [
    { path: 'density_LHD', label: 'Yoğunluk (sıvı H yoğunluğu birimi)', min: 0.01, max: 2, step: 0.01 },
    { path: 'T_K', label: 'Sıcaklık', unit: 'K', min: 20, max: 2000, step: 10 },
    { path: 'seed', label: 'RNG tohumu', min: 0, max: 1e6, step: 1 },
  ] },
  { id: 'fuel', title: 'Yakıt', fields: [{ path: 'stickingProb', label: 'α-yapışma olasılığı ω_s', min: 0.001, max: 0.02, step: 0.0001, hint: '≈0.0056 → maks ~150–180 füzyon/müon' }], note: 'Yakıt D-T (µ-katalizli d-t döngüsü).' },
  { id: 'driver', title: 'Müon kaynağı', fields: [
    { path: 'muonRate_per_s', label: 'Müon üretim hızı', unit: '/s', min: 1e10, max: 1e18, step: 1e12 },
    { path: 'muonCost_GeV', label: 'Müon maliyeti', unit: 'GeV', min: 0.5, max: 20, step: 0.1, hint: 'Hızlandırıcı verimi dahil; ~5 GeV tipik' },
  ] },
  { id: 'heating', title: 'Isıtma', fields: [], note: 'Soğuk füzyon: plazma yok, ısıtma yok. Kazanç yapışma ile sınırlı → Q < 1.' },
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

/** Belirli bir alan bu yöntem için anlamlı mı (stellarator/ICF dallanmaları) */
export function fieldVisible(method: Method, path: string): boolean {
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
