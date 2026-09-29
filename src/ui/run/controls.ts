/** Canlı müdahale kaydırıcıları için bilinen kontrol anahtarlarının etiket/aralıkları. */
import { MessageKey, Translate } from '../../i18n';
import { DiagSpec } from '../../physics/types';
import { fmtNum } from '../format';

export interface CtrlDef {
  /** untranslated physics symbol (P_NBI, H₉₈) … */
  sym?: string;
  /** … or a translated descriptive label */
  label?: MessageKey;
  hint?: MessageKey;
  unit: string;
  min: number; max: number; step: number;
  log?: boolean;
  /**
   * Multiplicative control: logarithmic slider spanning [default/mult, default·mult] around the
   * model default (the value the model reported at load time), whatever its magnitude.
   */
  mult?: number;
}

export const CONTROL_DEFS: Record<string, CtrlDef> = {
  P_NBI_MW: { sym: 'P_NBI', unit: 'MW', min: 0, max: 150, step: 0.5, hint: 'ctrl.nbiHint' },
  P_ICRH_MW: { sym: 'P_ICRH', unit: 'MW', min: 0, max: 100, step: 0.5, hint: 'ctrl.icrhHint' },
  P_ECRH_MW: { sym: 'P_ECRH', unit: 'MW', min: 0, max: 100, step: 0.5, hint: 'ctrl.ecrhHint' },
  P_aux_MW: { sym: 'P_aux', unit: 'MW', min: 0, max: 300, step: 1 },
  n_target_1e20: { label: 'ctrl.nTarget', unit: '10²⁰', min: 0.01, max: 15, step: 0.01, hint: 'ctrl.nTargetHint' },
  fuelRate_1e20s: { label: 'ctrl.fuelRate', unit: '10²⁰/s', min: 0, max: 3000, step: 1 },
  H98: { sym: 'H₉₈', unit: '', min: 0.3, max: 2, step: 0.01, hint: 'ctrl.h98Hint' },
  H_ISS04: { sym: 'H_ISS04', unit: '', min: 0.3, max: 2, step: 0.01, hint: 'ctrl.h98Hint' },
  cZ: { label: 'ctrl.cZ', unit: '', min: 0, max: 0.03, step: 0.0001, hint: 'ctrl.cZHint' },
  // FRC default 10, mirror default 50: a fixed linear range cannot serve both
  kappa_conf: { label: 'ctrl.kappa', unit: '', min: 0.1, max: 5, step: 0.05, mult: 10 },
  muonRate_per_s: { label: 'ctrl.muonRate', unit: '/s', min: 1e10, max: 1e18, step: 1, log: true },
};

/** Resolved slider definition for a control (unknown keys get an automatic range). */
export interface Slider { label: string; unit: string; hint?: string; min: number; max: number; step: number; log: boolean; known: boolean }

/**
 * @param current  current control value
 * @param modelDefault  value reported by the model at load time (centre of multiplicative sliders)
 */
export function ctrlSlider(key: string, current: number, modelDefault: number | undefined, t: Translate): Slider {
  const d = CONTROL_DEFS[key];
  if (!d) {
    // range from the load-time value, so it does not stretch while the slider is dragged
    const max = Math.max(1, (modelDefault ?? current) * 3);
    return { label: key, unit: '', min: 0, max, step: max / 200, log: false, known: false };
  }
  const label = d.label ? t(d.label) : d.sym ?? key;
  const base = { label, unit: d.unit, known: true };
  if (d.mult) {
    const c = modelDefault !== undefined && modelDefault > 0 ? modelDefault : 1;
    return { ...base, min: c / d.mult, max: c * d.mult, step: 0, log: true, hint: t('ctrl.multHint', { span: d.mult, def: fmtNum(c) }) };
  }
  return { ...base, min: d.min, max: d.max, step: d.step, log: !!d.log, hint: d.hint && t(d.hint) };
}

/** slider position ↔ control value (log sliders move in log10 space, 1/100 decade per step) */
export const sliderPos = (s: Slider, x: number) => (s.log ? Math.log10(Math.max(x, s.min)) : x);
export const sliderValue = (s: Slider, pos: number) => (s.log ? Math.pow(10, pos) : pos);
export const sliderStep = (s: Slider) => (s.log ? 0.01 : s.step);

/** KPI olarak öncelikli gösterilecek diagnostik anahtarları (mevcutsa) */
export const KPI_PREF = ['Ti', 'Te', 'ne', 'P_fus', 'P_aux', 'P_rad', 'Q', 'tauE', 'betaN', 'q95', 'nG_frac', 'fHe', 'Zeff', 'rhoR', 'C', 'B', 'Yf', 'Rm', 'beta', 'Efus_MJ', 'Nn'];
/** headline KPIs shown at once (the rest of KPI_PREF is for the methods that lack the first ones) */
export const KPI_HEADLINE_MAX = 12;

/**
 * Power balance and energy content of a magnetic plasma, in a collapsible block under the headline KPIs.
 * P_cond is the continuous conduction only in 0D (P_cond + P_ELM = P_transport); in 1.5D `P_cond` is
 * W/τ_E, so the ELM-free split appears in 0D only. `dWdt_s` is the 1.5D name of the smoothed dW/dt.
 */
export const KPI_DETAIL = [
  'P_alpha', 'P_beam_heat', 'P_rad_core', 'P_transport', 'P_cond', 'P_ELM', 'P_ei', 'P_loss', 'dWdt', 'dWdt_s', 'P_bound',
  'W', 'Wf', 'W_alpha', 'W_beam', 'nbar', 'betaN_th', 'ignited',
];
/** yes/no diagnostics (0 or 1): shown as words, not as numbers */
export const KPI_FLAGS: ReadonlySet<string> = new Set(['ignited']);

export interface Kpi { key: string; spec: DiagSpec; v: number }

/** The KPIs of a frame: the headline block and the power-balance block (only keys that have a spec and a value). */
export function selectKpis(specs: readonly DiagSpec[], d: Record<string, number>): { headline: Kpi[]; detail: Kpi[] } {
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const pick = (keys: readonly string[], exclude: ReadonlySet<string> = new Set()): Kpi[] =>
    keys.filter((k) => byKey.has(k) && d[k] !== undefined && !exclude.has(k)).map((k) => ({ key: k, spec: byKey.get(k)!, v: d[k] }));
  const headline = pick(KPI_PREF).slice(0, KPI_HEADLINE_MAX);
  return { headline, detail: pick(KPI_DETAIL, new Set(headline.map((h) => h.key))) };
}

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 100];

export const DEFAULT_CHART_GROUPS = ['Temperature', 'Power', 'Density', 'Performance'];

/** Units and yes/no flags of the geometry summary keys (labels are i18n keys `geom.<key>`). */
export const GEOM_UNITS: Record<string, string> = {
  R: 'm', a: 'm', B0: 'T', Ip_MA: 'MA', V: 'm³', S: 'm²', gap: 'm', coilThickness: 'm', B_coil: 'T',
  rs: 'm', L: 'm', B: 'T', n0: 'm⁻³', capsuleRadius_um: 'µm', rhoR: 'g/cm²', T_hs: 'keV',
  r0: 'm', V0: 'm³', current_MA: 'MA', density_LHD: 'LHD', muonCost_GeV: 'GeV',
};
export const GEOM_FLAGS = new Set(['stellarator', 'indirect', 'tandem', 'profiles']);
