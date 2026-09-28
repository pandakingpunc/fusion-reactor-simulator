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
/**
 * MagLIF stagnation (dwell) time. A liner dwells near its minimum radius for about r_min/v_imp
 * (I. R. Lindemuth & R. C. Kirkpatrick, Nucl. Fusion 23 (1983) 263). For a self-similar implosion
 * r_min = r_0/CR and v_imp ∝ r_0/t_c, so the width σ of the compression pulse scales as t_c/CR:
 * σ = MAGLIF_DWELL · t_c / CR_eff. The constant is set on Z, where t_c = 100 ns and CR = 30 give the
 * observed 1–2 ns burn (Gomez et al., PRL 113 (2014) 155003; PRL 125 (2020) 155002): σ = 2 ns, burn
 * FWHM ≈ 2 ns. It is capped at the 0.3 t_c of the slow liner/piston compressions (reached at CR_eff ≤ 2).
 * A fixed 2 ns for every t_c would be unphysical for the wizard's slow compressions (up to 20 ms) and
 * forced a 0.2 ns time step over the whole shot.
 */
const MAGLIF_DWELL = 0.6;
/** width σ of the compression pulse of slow liner/piston compressions, in units of t_c */
const SLOW_STAGNATION = 0.3;

/** Effective convergence ratio after the instability (jitter, flow shear) losses. */
function effectiveCompression(cfg: MTFConfig, tc: number): number {
  const jitter0 = Math.max(0.1 * tc, 0.02);
  let f_stab = Math.exp(-Math.pow(cfg.jitter_us / jitter0, 2));
  if (cfg.method === 'zpinch_sfs') f_stab *= 0.3 + 0.7 * Math.min(cfg.flowShear, 1); // flow-shear stabilisation
  return 1 + (Math.max(cfg.compressionRatio, 1) - 1) * f_stab;
}

const MTF_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T (compressed)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n (compressed)', unit: '1e20 m⁻³', group: 'Density', log: true },
  { key: 'C', label: 'Compression C(t)', unit: '', group: 'Compression' },
  { key: 'P_fus', label: 'P_fusion (instantaneous)', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Q (cumulative)', unit: '', group: 'Performance' },
  { key: 'triple', label: 'n·T·τ', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'Nn', label: 'Neutron count', unit: '', group: 'Neutrons', log: true },
  { key: 'B', label: 'B (compressed)', unit: 'T', group: 'MHD' },
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
    const CR_eff = effectiveCompression(cfg, tc);
    const width = tc * (cfg.method === 'maglif' ? Math.min(SLOW_STAGNATION, MAGLIF_DWELL / CR_eff) : SLOW_STAGNATION); // µs
    const dtMax = Math.min(tc / 40, width / 10);
    super({ seed: cfg.seed, tEnd, timeUnit: 'µs', dt0: Math.min(tc / 200, dtMax),
      integratorOpts: { rtol: 1e-5, atol, dtMin: Math.min(tc / 1e5, dtMax / 10), dtMax, nonNegative: true }, outputDt: tEnd / 1000 });
    this.method = cfg.method;
    this.cfg = cfg;
    this.tc = tc;
    this.width = width;
    this.V0 = Math.PI * cfg.r0_m * cfg.r0_m * cfg.L_m;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.fracA = fs.fracA;
    this.na0 = cfg.n0 * fs.fracA;
    this.nb0 = cfg.n0 * (1 - fs.fracA);

    // ön-ısıtma → başlangıç sıcaklığı
    const preheat_J = cfg.preheat_kJ * 1e3;
    this.T0_eff = cfg.T0_keV + preheat_J / Math.max(3 * cfg.n0 * this.V0 * C.keV_J, 1e-30);

    // instabilities → effective convergence ratio
    this.CR_eff = CR_eff;

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
      ev.push({ t, kind: 'stagnation', msg: `Stagnation: C = ${s.Cc.toFixed(1)}, n = ${(s.n / 1e20).toExponential(1)}e20 m⁻³, T = ${s.T.toFixed(2)} keV, B = ${s.B.toFixed(0)} T` });
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
    if (this.CR_eff < 0.9 * this.cfg.compressionRatio) warnings.push(`Instability reduced effective compression: CR ${this.cfg.compressionRatio} → ${this.CR_eff.toFixed(1)} (jitter/liner/flow shear).`);
    if (G < 0.01) warnings.push('MTF is far from net energy at these parameters (G≪1) — consistent with current experiments.');
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea: 2 * Math.PI * this.cfg.r0_m * this.cfg.L_m,
      scoreBreakdown: [
        { label: 'Gain G', value: G, ref: 1, unit: '', note: 'Relative to driver energy' },
        { label: 'Stagnation T (max)', value: max(col('Ti')), ref: 10, unit: 'keV', note: 'Compression temperature' },
        { label: 'Triple product', value: max(col('triple')), ref: 1e21, unit: 'keV s m⁻³', note: 'Ignition ≈ 3e21 (DT)' },
        { label: 'Neutron yield', value: last.d.Nn ?? 0, ref: 1e17, unit: '', note: 'MagLIF target ~1e17-1e18' },
        { label: 'Fusion energy', value: last.d.Efus_MJ ?? 0, ref: 1, unit: 'MJ', note: 'Per shot' },
      ],
      historical: [
        { label: 'MagLIF (Z): ~1e13 neutrons', ratio: (last.d.Nn ?? 0) / 1e13, note: 'neutron yield' },
        { label: 'Breakeven (G=1)', ratio: G / 1, note: 'gain' },
      ],
      engineering: {
        'Initial radius r0 (mm)': +(this.cfg.r0_m * 1e3).toFixed(2), 'Compression CR (nominal)': this.cfg.compressionRatio,
        'Compression CR (effective)': +this.CR_eff.toFixed(1), 'Driver current (MA)': this.cfg.current_MA,
        'Driver energy (MJ)': this.cfg.driverEnergy_MJ, 'Preheat (kJ)': this.cfg.preheat_kJ, 'Gain G': +G.toFixed(4),
      },
      extras: { 'Compression time (µs)': this.cfg.compressionTime_us, 'Flow shear': this.cfg.flowShear },
      warnings,
      stableDefinition: 'MTF is pulsed: "duration" is the compression+stagnation window (µs). G = E_fusion / E_driver.',
      Q_eng_note: 'MTF/MagLIF/Z-pinch are experimental; Q_eng is not modeled.',
    });
  }
}
