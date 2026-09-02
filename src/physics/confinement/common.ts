/**
 * Darbeli / alternatif hapsetme modelleri için ortak altyapı.
 *
 * PulsedBase: SimModel arayüzünün fizik-dışı ("boilerplate") kısmını genelleştirir
 * (kontrol, kaydet/yükle, planlı bitiş, rapor üretimi). Her somut model (ICF, MTF,
 * FRC, ayna, müon) yalnızca initialState/rhs/diagnostics/geometryInfo ve olay
 * mantığını (stepEvents) sağlar.
 *
 * APPROXIMATION: Bu modeller manyetik modele göre daha sadedir; amaç mertebe-
 * doğruluğunda, kararlı ve öğretici bir 0D davranıştır.
 */
import { IntegratorOptions } from '../integrator';
import { RNG } from '../rng';
import { U } from '../units';
import { FUEL_CHANNELS, FuelType } from '../reactivity';
import { DiagSpec, HistoryFrame, Method, ScoreEntry, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';

/** Lawson ateşleme referansı nTτ_E (yakıta göre) [keV s m^-3] */
export const LAWSON_REF: Record<FuelType, number> = { DT: 3e21, DHe3: 4e22, DD: 1e23, pB11: 1e24 };

/** Hacimsel füzyon güçleri [W/m³] ve reaksiyon hızı yoğunluğu [1/m³/s] (düz profil). */
export function fusionRates(fuel: FuelType, na: number, nb: number, T_keV: number) {
  let rate = 0, P_total = 0, P_charged = 0, P_neutron = 0, neutrons = 0;
  const T = Math.max(T_keV, 0.01);
  for (const ch of FUEL_CHANNELS[fuel]) {
    const sv = ch.sigmav(T);
    const R = (ch.sameSpecies ? 0.5 * na * na : na * nb) * sv; // reaksiyon / m³ / s
    rate += R;
    P_total += R * U.MeV_to_J(ch.Etot_MeV);
    P_charged += R * U.MeV_to_J(ch.Echarged_MeV);
    P_neutron += R * U.MeV_to_J(ch.Eneutron_MeV);
    if (ch.Eneutron_MeV > 0) neutrons += R;
  }
  return { rate, P_total, P_charged, P_neutron, neutrons };
}

export interface ReportOpts {
  fuel: FuelType;
  scoreBreakdown: ScoreEntry[];
  engineering: Record<string, number | string | boolean>;
  extras: Record<string, number | string>;
  warnings: string[];
  historical: { label: string; ratio: number; note: string }[];
  /** teşhis anahtarı (sıcaklık); varsayılan 'Ti' */
  tempKey?: string;
  stableTime?: number;
  stableDefinition?: string;
  Q_eng?: number;
  Q_eng_note?: string;
  /** nötron akısı için duvar alanı [m²] (varsayılan 1 → toplam sayı) */
  wallArea?: number;
}

export abstract class PulsedBase implements SimModel {
  readonly kind = 'pulsed' as const;
  abstract readonly method: Method;
  readonly timeUnit: 's' | 'ns' | 'µs';
  readonly tEnd: number;
  readonly outputDt: number;
  abstract readonly nState: number;
  abstract readonly diagSpecs: DiagSpec[];
  readonly integratorOpts: IntegratorOptions;
  readonly dt0: number;
  terminated: TerminationInfo | null = null;

  protected rng: RNG;
  protected ctrl: Record<string, number> = {};

  constructor(init: { seed: number; tEnd: number; timeUnit: 's' | 'ns' | 'µs'; dt0: number; integratorOpts: IntegratorOptions; outputDt?: number }) {
    this.rng = new RNG(init.seed);
    this.tEnd = init.tEnd;
    this.timeUnit = init.timeUnit;
    this.dt0 = init.dt0;
    this.integratorOpts = init.integratorOpts;
    this.outputDt = init.outputDt ?? Math.max(init.tEnd / 800, init.tEnd * 1e-9);
  }

  abstract initialState(): Float64Array;
  abstract rhs(t: number, y: Float64Array, d: Float64Array): void;
  abstract diagnostics(t: number, y: Float64Array): Record<string, number>;
  abstract geometryInfo(): Record<string, number>;
  abstract report(history: HistoryFrame[], events: SimEvent[]): ShotReport;

  postStep(t: number, dt: number, y: Float64Array): SimEvent[] {
    if (this.terminated) return [];
    const ev = this.stepEvents(t, dt, y);
    if (!this.terminated && t >= this.tEnd - Math.max(1e-9, this.tEnd * 1e-6)) {
      this.terminated = { t, natural: true, reason: 'Planlı bitiş', diagnosis: `Atış planlanan ${this.tEnd} ${this.timeUnit} süreyi tamamladı.`, fix: '' };
      ev.push({ t, kind: 'end', msg: 'Planlı atış sonu' });
    }
    return ev;
  }

  /** Somut modelin olay mantığı (disruption/ateşleme/uyarı). Varsayılan: yok. */
  protected stepEvents(_t: number, _dt: number, _y: Float64Array): SimEvent[] { return []; }

  applyControl(patch: Record<string, number>): void {
    for (const k of Object.keys(patch)) if (k in this.ctrl) this.ctrl[k] = patch[k];
  }
  getControls(): Record<string, number> { return { ...this.ctrl }; }
  saveInternal(): Record<string, number> { return { rng: this.rng.getState(), ...this.extraSave() }; }
  restoreInternal(s: Record<string, number>): void { this.rng.setState(s.rng ?? 0); this.terminated = null; this.extraRestore(s); }
  protected extraSave(): Record<string, number> { return {}; }
  protected extraRestore(_s: Record<string, number>): void { /* alt sınıf doldurur */ }

  /** Geçmişten standart bir ShotReport üret. */
  protected buildReport(hist: HistoryFrame[], events: SimEvent[], o: ReportOpts): ShotReport {
    const last = hist[hist.length - 1];
    const col = (k: string) => hist.map((h) => h.d[k] ?? 0);
    const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
    const Tmax = maxOf(col(o.tempKey ?? 'Ti'));
    const Q = col('Q');
    const Efus = last.d.Efus_MJ ?? 0;
    const Ein = last.d.Ein_MJ ?? 0;
    const Qavg = Ein > 0 ? Efus / Ein : 0;
    const triple = maxOf(col('triple'));
    const lawsonRef = LAWSON_REF[o.fuel] ?? 3e21;
    let burnTime = 0, ignTime = 0;
    for (let i = 1; i < hist.length; i++) {
      const dt = hist[i].t - hist[i - 1].t;
      if ((hist[i].d.Q ?? 0) >= 1) burnTime += dt;
      if ((hist[i].d.ignited ?? 0) > 0) ignTime += dt;
    }
    const term: TerminationInfo = this.terminated ?? { t: last.t, natural: true, reason: 'Devam ediyor', diagnosis: '', fix: '' };
    let raw = 0;
    for (const s of o.scoreBreakdown) raw += s.ref > 0 ? Math.min(1, s.value / s.ref) : 0;
    let score = Math.round((100 / Math.max(o.scoreBreakdown.length, 1)) * raw);
    if (!term.natural) score = Math.round(score * 0.7);
    const TeMax = maxOf(col('Te'));
    return {
      method: this.method, duration: last.t, timeUnit: this.timeUnit,
      Tmax_keV: Tmax, Tmax_MC: U.keV_to_MC(Tmax), Timax_keV: Tmax, Temax_keV: TeMax > 0 ? TeMax : Tmax,
      stableTime_s: o.stableTime ?? last.t, burnTime_s: burnTime, ignitionTime_s: ignTime,
      stableDefinition: o.stableDefinition ?? 'Stabil süre = plazmanın sürdürüldüğü süre. Yanma süresi = Q ≥ 1 süresi. Ateşleme süresi = kendini besleyen (P_alfa ≥ kayıplar) süre.',
      Q_sci_max: maxOf(Q), Q_sci_avg: Qavg, Q_eng: o.Q_eng ?? 0,
      Q_eng_note: o.Q_eng_note ?? 'Q_müh (duvar prizi) bu deneysel/kavramsal cihaz için ayrıntılı modellenmedi.',
      E_fusion_MJ: Efus, E_input_MJ: Ein,
      neutronYield: last.d.Nn ?? 0, neutronFluence_m2: (last.d.Nn ?? 0) / Math.max(o.wallArea ?? 1, 1e-9),
      tripleProduct_max: triple, lawson_ratio: triple / lawsonRef,
      lawsonNote: `Referans (nTτ)_ateşleme ≈ ${lawsonRef.toExponential(1)} keV s m⁻³ (${o.fuel}); 1.0 = ateşleme eşiği.`,
      termination: term, score, scoreBreakdown: o.scoreBreakdown, historical: o.historical, warnings: o.warnings,
      engineering: o.engineering, extras: o.extras,
    };
  }
}
