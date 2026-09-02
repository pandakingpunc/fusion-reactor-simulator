/**
 * MANYETİZE HEDEF FÜZYON (MTF) — liner/piston sıkıştırma, MagLIF, kesme-akış Z-pinch.
 * Zaman: µs. Sıkıştırma yörüngesi C(t) verilir; yoğunluk/sıcaklık adyabatik ölçeklenir,
 * durgunlukta füzyon yanması birikir.
 *
 * Silindirik liner: n ∝ C², T ∝ C^p (p≈0.68, ideal 4/3'ten kayıplı), B ∝ C².
 * Kararsızlık (MRT / kink) jitter, liner kalınlığı ve kesme-akış ile modellenir.
 * Kaynaklar: Lindemuth & Kirkpatrick, Nucl. Fusion 23 (1983) 263; Slutz 2010 (MagLIF);
 * Shumlak 2020 (kesme-akış Z-pinch).
 * Durum y: [0] E_fus [J]  [1] E_in [J]  [2] N_n
 */
import { MTFConfig } from '../types';
import { FUEL_SPECIES } from '../reactivity';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase, fusionRates } from './common';

const IDX = { Efus: 0, Ein: 1, Nn: 2 } as const;
const NSTATE = 3;
const TU = 1e-6; // µs → s
const P_T = 0.68; // sıcaklık sıkışma üssü (kayıplı adyabatik)

const MTF_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T (sıkışmış)', unit: 'keV', group: 'Sıcaklık' },
  { key: 'ne', label: 'n (sıkışmış)', unit: '1e20 m⁻³', group: 'Yoğunluk', log: true },
  { key: 'C', label: 'Sıkışma C(t)', unit: '', group: 'Sıkışma' },
  { key: 'P_fus', label: 'P_füzyon (anlık)', unit: 'MW', group: 'Güç' },
  { key: 'Q', label: 'Q (kümülatif)', unit: '', group: 'Performans' },
  { key: 'triple', label: 'n·T·τ', unit: 'keV s m⁻³', group: 'Performans', log: true },
  { key: 'Nn', label: 'Nötron sayısı', unit: '', group: 'Nötron', log: true },
  { key: 'B', label: 'B (sıkışmış)', unit: 'T', group: 'MHD' },
];

export class MTFModel extends PulsedBase {
  readonly method: MTFConfig['method'];
  readonly nState = NSTATE;
  readonly diagSpecs = MTF_DIAGS;

  private cfg: MTFConfig;
  private V0: number;
  private T0_eff: number;
  private CR_eff: number;
  private tc: number;
  private width: number;
  private na0: number;
  private nb0: number;
  private fracA: number;
  private E_in_total: number;

  constructor(cfg: MTFConfig) {
    const tc = Math.max(cfg.compressionTime_us, 1e-3);
    const tEnd = tc * 2;
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e10]);
    super({ seed: cfg.seed, tEnd, timeUnit: 'µs', dt0: tc / 200,
      integratorOpts: { rtol: 1e-5, atol, dtMin: tc / 1e5, dtMax: tc / 40, nonNegative: true }, outputDt: tEnd / 1000 });
    this.method = cfg.method;
    this.cfg = cfg;
    this.tc = tc;
    this.width = 0.3 * tc;
    this.V0 = Math.PI * cfg.r0_m * cfg.r0_m * cfg.L_m;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.fracA = fs.fracA;
    this.na0 = cfg.n0 * fs.fracA;
    this.nb0 = cfg.n0 * (1 - fs.fracA);

    // ön-ısıtma → başlangıç sıcaklığı
    const preheat_J = cfg.preheat_kJ * 1e3;
    this.T0_eff = cfg.T0_keV + preheat_J / Math.max(3 * cfg.n0 * this.V0 * C.keV_J, 1e-30);

    // kararsızlık → etkin sıkışma oranı
    const jitter0 = Math.max(0.1 * tc, 0.02);
    let f_stab = Math.exp(-Math.pow(cfg.jitter_us / jitter0, 2));
    if (cfg.method === 'zpinch_sfs') f_stab *= 0.3 + 0.7 * Math.min(cfg.flowShear, 1); // kesme-akış stabilizasyonu
    this.CR_eff = 1 + (Math.max(cfg.compressionRatio, 1) - 1) * f_stab;

    this.E_in_total = cfg.driverEnergy_MJ * 1e6 + preheat_J;
    this.ctrl = {};
  }

  private compression(t: number): number {
    if (this.CR_eff <= 1.0001) return 1; // Z-pinch: sıkışma yok
    const z = (t - this.tc) / this.width;
    return 1 + (this.CR_eff - 1) * Math.exp(-0.5 * z * z);
  }
  private state(t: number) {
    const Cc = this.compression(t);
    const n = this.cfg.n0 * Cc * Cc;
    const T = this.T0_eff * Math.pow(Cc, P_T);
    return { Cc, n, T, na: this.na0 * Cc * Cc, nb: this.nb0 * Cc * Cc, V: this.V0 / (Cc * Cc), B: this.cfg.B0 * Cc * Cc };
  }

  initialState(): Float64Array { return new Float64Array(NSTATE); }

  rhs(t: number, _y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const s = this.state(t);
    const fus = fusionRates(this.cfg.fuel, s.na, s.nb, s.T);
    d[IDX.Efus] = fus.P_total * s.V * TU; // J/µs
    d[IDX.Nn] = fus.neutrons * s.V * TU; // 1/µs
    d[IDX.Ein] = t < this.tc ? this.E_in_total / this.tc : 0; // J/µs
  }

  diagnostics(t: number, y: Float64Array): Record<string, number> {
    const s = this.state(t);
    const fus = fusionRates(this.cfg.fuel, s.na, s.nb, s.T);
    const P_fus = fus.P_total * s.V; // W
    const tau_inert = this.width * TU; // inertial hapsetme ~ durgunluk süresi
    return {
      Ti: s.T, Te: s.T, ne: s.n / 1e20, C: s.Cc, P_fus: P_fus / 1e6,
      Q: y[IDX.Efus] / Math.max(y[IDX.Ein], 1), triple: s.n * s.T * tau_inert, B: s.B,
      Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
    };
  }

  protected stepEvents(t: number, _dt: number, _y: Float64Array): SimEvent[] {
    const ev: SimEvent[] = [];
    if (!this._peaked && t >= this.tc && this.CR_eff > 1.0001) {
      this._peaked = true;
      const s = this.state(this.tc);
      ev.push({ t, kind: 'stagnation', msg: `Durgunluk: C = ${s.Cc.toFixed(1)}, n = ${(s.n / 1e20).toExponential(1)}e20 m⁻³, T = ${s.T.toFixed(2)} keV, B = ${s.B.toFixed(0)} T` });
    }
    return ev;
  }
  private _peaked = false;
  protected extraSave(): Record<string, number> { return { peaked: this._peaked ? 1 : 0 }; }
  protected extraRestore(s: Record<string, number>): void { this._peaked = (s.peaked ?? 0) > 0; }

  geometryInfo(): Record<string, number> {
    return { r0: this.cfg.r0_m, L: this.cfg.L_m, CR: this.cfg.compressionRatio, CR_eff: this.CR_eff, V0: this.V0, current_MA: this.cfg.current_MA };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const col = (k: string) => hist.map((h) => h.d[k] ?? 0);
    const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
    const last = hist[hist.length - 1];
    const G = (last.d.Efus_MJ ?? 0) / Math.max(this.cfg.driverEnergy_MJ, 1e-6);
    const warnings: string[] = [];
    if (this.CR_eff < 0.9 * this.cfg.compressionRatio) warnings.push(`Kararsızlık etkin sıkışmayı düşürdü: CR ${this.cfg.compressionRatio} → ${this.CR_eff.toFixed(1)} (jitter/liner/kesme-akış).`);
    if (G < 0.01) warnings.push('MTF bu parametrelerde net enerjiden uzak (G≪1) — mevcut deneylerin durumuyla tutarlı.');
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea: 2 * Math.PI * this.cfg.r0_m * this.cfg.L_m,
      scoreBreakdown: [
        { label: 'Kazanç G', value: G, ref: 1, unit: '', note: 'Sürücü enerjisine göre' },
        { label: 'Durgunluk T (max)', value: max(col('Ti')), ref: 10, unit: 'keV', note: 'Sıkışma sıcaklığı' },
        { label: 'Üçlü çarpım', value: max(col('triple')), ref: 1e21, unit: 'keV s m⁻³', note: 'Ateşleme ≈ 3e21 (DT)' },
        { label: 'Nötron verimi', value: last.d.Nn ?? 0, ref: 1e17, unit: '', note: 'MagLIF hedefi ~1e17-1e18' },
        { label: 'Füzyon enerjisi', value: last.d.Efus_MJ ?? 0, ref: 1, unit: 'MJ', note: 'Atış başına' },
      ],
      historical: [
        { label: 'MagLIF (Z): ~1e13 nötron', ratio: (last.d.Nn ?? 0) / 1e13, note: 'nötron verimi' },
        { label: 'Başabaş (G=1)', ratio: G / 1, note: 'kazanç' },
      ],
      engineering: {
        'İlk yarıçap r0 (mm)': +(this.cfg.r0_m * 1e3).toFixed(2), 'Sıkışma CR (nominal)': this.cfg.compressionRatio,
        'Sıkışma CR (etkin)': +this.CR_eff.toFixed(1), 'Sürücü akımı (MA)': this.cfg.current_MA,
        'Sürücü enerjisi (MJ)': this.cfg.driverEnergy_MJ, 'Ön-ısıtma (kJ)': this.cfg.preheat_kJ, 'Kazanç G': +G.toFixed(4),
      },
      extras: { 'Sıkışma zamanı (µs)': this.cfg.compressionTime_us, 'Kesme-akış': this.cfg.flowShear },
      warnings,
      stableDefinition: 'MTF darbelidir: "süre" sıkışma+durgunluk penceresidir (µs). G = E_füzyon / E_sürücü.',
      Q_eng_note: 'MTF/MagLIF/Z-pinch deneyseldir; Q_müh modellenmedi.',
    });
  }
}
