/**
 * Ortak tipler: konfigürasyon, model arayüzü, olaylar, rapor.
 */
import { Geometry } from './geometry';
import { FuelType } from './reactivity';
import { ImpuritySpecies } from './constants';
import { DisruptionReport } from './disruption';
import { IntegratorOptions } from './integrator';

export type Method =
  | 'tokamak' | 'spherical_tokamak' | 'stellarator'
  | 'icf_direct' | 'icf_indirect'
  | 'mtf_liner' | 'mtf_piston'
  | 'zpinch_sfs' | 'maglif'
  | 'frc' | 'mirror' | 'muon';

export const METHOD_LABELS: Record<Method, string> = {
  tokamak: 'Tokamak (konvansiyonel)',
  spherical_tokamak: 'Sferik Tokamak (ST)',
  stellarator: 'Stellarator',
  icf_direct: 'Lazer ICF — doğrudan tahrik',
  icf_indirect: 'Lazer ICF — dolaylı tahrik (hohlraum)',
  mtf_liner: 'MTF — elektromanyetik liner',
  mtf_piston: 'MTF — sıvı metal piston',
  zpinch_sfs: 'Z-pinch (kesme-akış stabilize)',
  maglif: 'MagLIF',
  frc: 'Alan Tersinmiş Konfigürasyon (FRC)',
  mirror: 'Manyetik Ayna',
  muon: 'Müon-katalizli füzyon (easter egg)',
};

export type MagnetTech = 'Cu' | 'NbTi' | 'Nb3Sn' | 'REBCO';
export type BlanketType = 'HCPB' | 'HCLL' | 'WCLL' | 'DCLL' | 'FLiBe' | 'none';
export type FuelingMethod = 'gas' | 'pellet' | 'nbi' | 'mixed';

export interface MagneticConfig {
  method: 'tokamak' | 'spherical_tokamak' | 'stellarator';
  geometry: Geometry;
  B0: number; // T eksen
  Ip_MA: number; // stellarator için 0 (bootstrap ihmal)
  fuel: FuelType;
  fuelFracA: number; // tür a oranı (D-T: n_D/(n_D+n_T))
  n_target: number; // hedef hacim-ort. elektron yoğunluğu [m^-3]
  n_rampTime: number; // s
  heating: {
    P_NBI_MW: number; E_NBI_keV: number;
    P_ICRH_MW: number; f_ICRH_ion: number;
    P_ECRH_MW: number;
    rampTime: number; // s
    /** ısıtmayı Q hedefine göre kapat (ateşleme testi) */
    autoOff: boolean;
  };
  fueling: { method: FuelingMethod; maxRate_1e20s: number; pelletDepth: number };
  impurity: {
    species: ImpuritySpecies; concentration: number; wallReflectivity: number; W_source_frac: number;
    /** Divertör tohumlama safsızlığı (Ar/Ne/N): sabit n_seed/n_e oranı (dinamik yok) */
    seedSpecies?: ImpuritySpecies; seedConcentration?: number;
  };
  H98: number; H89: number;
  scaling: 'IPB98y2' | 'ST_Valovic';
  stellarator: { iota23: number; f_ren: number };
  limits: { betaN_limit: number; greenwald_limit: number; q95_limit: number; W_conc_limit: number };
  transport: { tau_p_over_tau_E: number; tau_He_over_tau_E: number; alpha_n: number; alpha_T: number };
  events: { elms: boolean; sawteeth: boolean; ntm: boolean };
  magnet: { tech: MagnetTech; gap_m: number; coilThickness_m: number };
  blanket: { type: BlanketType; li6_enrichment: number; coverage: number };
  divertor: { f_rad_div: number; flux_expansion: number };
  economics: { capital_MUSD_override?: number; availability: number; thermalEff: number; wallPlugEff: number; discountRate: number; lifetime_yr: number };
  t_end: number; // s
  seed: number;
}

export interface ICFConfig {
  method: 'icf_direct' | 'icf_indirect';
  E_laser_MJ: number;
  wavelength_nm: number;
  pulse_ns: number;
  capsuleRadius_um: number; // dış yarıçap
  fuelMass_ug: number; // DT
  ablatorMass_ug: number;
  ablator: 'CH' | 'HDC' | 'Be';
  adiabat: number; // α
  convergenceRatio: number; // CR hedef
  implosionVelocity_kms: number; // v_imp
  hohlraumEff: number; // dolaylı: lazer→x-ışını→kapsül
  absorption: number; // doğrudan: lazer soğurma
  asymmetry_rms: number; // % (düşük mod)
  surfaceRoughness_nm: number; // RT tohumu
  fuel: FuelType;
  seed: number;
}

export interface MTFConfig {
  method: 'mtf_liner' | 'mtf_piston' | 'maglif' | 'zpinch_sfs';
  r0_m: number; // başlangıç plazma yarıçapı
  L_m: number; // uzunluk
  n0: number; // m^-3
  T0_keV: number;
  B0: number; // T
  compressionRatio: number; // r0/r_min
  driverEnergy_MJ: number;
  compressionTime_us: number;
  jitter_us: number; // piston senkron hatası
  linerThicknessRatio: number; // Δr/r (MRT için)
  preheat_kJ: number; // MagLIF lazer ön-ısıtma
  current_MA: number; // Z-pinch / MagLIF sürücü akımı
  flowShear: number; // Z-pinch kesme-akış (0-1) — stabilizasyon
  fuel: FuelType;
  seed: number;
}

export interface FRCConfig {
  method: 'frc';
  rs_m: number; // ayırıcı yarıçap
  L_m: number;
  Be_T: number; // dış alan
  n0: number; T0_keV: number;
  P_NBI_MW: number; E_NBI_keV: number;
  t_end: number; seed: number; fuel: FuelType;
}
export interface MirrorConfig {
  method: 'mirror';
  L_m: number; a_m: number; B_center_T: number; mirrorRatio: number;
  n0: number; T_keV: number; P_aux_MW: number; tandem: boolean;
  t_end: number; seed: number; fuel: FuelType;
}
export interface MuonConfig {
  method: 'muon';
  muonRate_per_s: number; muonCost_GeV: number; stickingProb: number; density_LHD: number; T_K: number;
  seed: number;
}

export type ReactorConfig = MagneticConfig | ICFConfig | MTFConfig | FRCConfig | MirrorConfig | MuonConfig;

/** Zaman serisi kanalı tanımı (UI grafikleri bu listeden okur) */
export interface DiagSpec {
  key: string;
  label: string;
  unit: string;
  group: string;
  log?: boolean;
}

export type EventKind = 'ELM' | 'sawtooth' | 'NTM_onset' | 'NTM_gone' | 'LH' | 'HL' | 'disruption' | 'quench' | 'ignition' | 'burn_start' | 'burn_end' | 'warning' | 'info' | 'stagnation' | 'end';

export interface SimEvent {
  t: number;
  kind: EventKind;
  msg: string;
  value?: number;
}

export interface TerminationInfo {
  t: number;
  reason: string; // kısa
  diagnosis: string; // öğretici cümle
  fix: string;
  disruption?: DisruptionReport;
  natural: boolean; // planlı bitiş (t_end)
}

export interface SimModel {
  readonly kind: 'magnetic' | 'pulsed';
  readonly method: Method;
  readonly timeUnit: 's' | 'ns' | 'µs';
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState: number;
  readonly diagSpecs: DiagSpec[];
  readonly integratorOpts: IntegratorOptions;
  readonly dt0: number;
  initialState(): Float64Array;
  rhs(t: number, y: Float64Array, dydt: Float64Array): void;
  diagnostics(t: number, y: Float64Array): Record<string, number>;
  /** kabul edilen adımdan sonra; y'yi değiştirebilir (ELM vb.) ve olay üretebilir */
  postStep(t: number, dt: number, y: Float64Array): SimEvent[];
  readonly terminated: TerminationInfo | null;
  /** canlı müdahale */
  applyControl(patch: Record<string, number>): void;
  getControls(): Record<string, number>;
  /** RNG/dahili durumun kaydı (geri sarma için) */
  saveInternal(): Record<string, number>;
  restoreInternal(s: Record<string, number>): void;
  /** atış sonu raporu */
  report(history: HistoryFrame[], events: SimEvent[]): ShotReport;
  /** statik: geometrik çizim verisi */
  geometryInfo(): Record<string, number>;
}

export interface HistoryFrame {
  t: number;
  y: number[]; // durum (geri sarma için)
  d: Record<string, number>;
  internal: Record<string, number>;
}

export interface ScoreEntry {
  label: string;
  value: number;
  ref: number;
  unit: string;
  note: string;
}

export interface ShotReport {
  method: Method;
  duration: number; // s veya ns
  timeUnit: string;
  Tmax_keV: number;
  Tmax_MC: number; // milyon °C
  Timax_keV: number;
  Temax_keV: number;
  stableTime_s: number;
  burnTime_s: number;
  ignitionTime_s: number;
  stableDefinition: string;
  Q_sci_max: number;
  Q_sci_avg: number;
  Q_eng: number;
  Q_eng_note: string;
  E_fusion_MJ: number;
  E_input_MJ: number;
  neutronYield: number; // toplam nötron sayısı
  neutronFluence_m2: number; // n/m²
  tripleProduct_max: number; // keV s m^-3
  lawson_ratio: number; // nTτ / (nTτ)_ateşleme
  lawsonNote: string;
  termination: TerminationInfo;
  score: number; // 0-100
  scoreBreakdown: ScoreEntry[];
  historical: { label: string; ratio: number; note: string }[];
  warnings: string[];
  engineering: Record<string, number | string | boolean>;
  extras: Record<string, number | string>;
}
