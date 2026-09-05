/** Canlı müdahale kaydırıcıları için bilinen kontrol anahtarlarının etiket/aralıkları. */
export interface CtrlDef { label: string; unit: string; min: number; max: number; step: number; log?: boolean; hint?: string }

export const CONTROL_DEFS: Record<string, CtrlDef> = {
  P_NBI_MW: { label: 'P_NBI', unit: 'MW', min: 0, max: 150, step: 0.5, hint: 'Neutral beam — ion heating + fueling' },
  P_ICRH_MW: { label: 'P_ICRH', unit: 'MW', min: 0, max: 100, step: 0.5, hint: 'Ion cyclotron' },
  P_ECRH_MW: { label: 'P_ECRH', unit: 'MW', min: 0, max: 100, step: 0.5, hint: 'Electron cyclotron (e⁻ only)' },
  P_aux_MW: { label: 'P_aux', unit: 'MW', min: 0, max: 300, step: 1 },
  n_target_1e20: { label: 'Target n_e', unit: '10²⁰', min: 0.01, max: 15, step: 0.01, hint: 'Watch the Greenwald limit' },
  fuelRate_1e20s: { label: 'Fueling rate', unit: '10²⁰/s', min: 0, max: 3000, step: 1 },
  H98: { label: 'H₉₈', unit: '', min: 0.3, max: 2, step: 0.01, hint: 'Confinement quality (educational control)' },
  cZ: { label: 'Impurity c_Z', unit: '', min: 0, max: 0.03, step: 0.0001, hint: 'Radiative collapse test' },
  kappa_conf: { label: 'Confinement multiplier', unit: '', min: 0.1, max: 5, step: 0.05 },
  muonRate_per_s: { label: 'Muon rate', unit: '/s', min: 1e10, max: 1e18, step: 1, log: true },
};

export function ctrlDef(key: string, current: number): CtrlDef {
  return CONTROL_DEFS[key] ?? { label: key, unit: '', min: 0, max: Math.max(1, current * 3), step: Math.max(1, current * 3) / 200 };
}

/** KPI olarak öncelikli gösterilecek diagnostik anahtarları (mevcutsa) */
export const KPI_PREF = ['Ti', 'Te', 'ne', 'P_fus', 'P_aux', 'P_rad', 'Q', 'tauE', 'betaN', 'q95', 'nG_frac', 'fHe', 'Zeff', 'rhoR', 'C', 'B', 'Yf', 'Rm', 'beta', 'Efus_MJ', 'Nn'];

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 100];

export const DEFAULT_CHART_GROUPS = ['Temperature', 'Power', 'Density', 'Performance'];
