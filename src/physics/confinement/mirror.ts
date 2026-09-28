/**
 * MANYETİK AYNA — 0D güç dengesi (tek sıcaklık), kayıp konisi hapsetmesi.
 *
 * Durum y: [0] W [J]  [1] E_fus [J]  [2] E_in [J]  [3] N_n
 * Hapsetme: basit ayna τ_E ≈ κ · R_m · L / v_th (uç kaybı, bkz. tauE). Tandem: uç tıkaçlarının
 * ambipolar potansiyel bariyeri eφ_c iyonları ayrıca tutar; Pastukhov çözümünün asimptotik
 * biçimiyle τ_tandem = τ_basit · (1 + F(x)), F(x) = x e^x / (1 + 1/(2x)), x = eφ_c/T_i
 * (V.P. Pastukhov, Nucl. Fusion 14 (1974) 3; R.H. Cohen et al., Nucl. Fusion 18 (1978) 1229).
 * x = MirrorConfig.plugPotential (varsayılan 1). x → 0'da tandem basit aynaya indirgenir.
 * APPROXIMATION: 0D, sabit yoğunluk, izotropik dağılım; tıkaç gücü ve tıkaç plazması modellenmez.
 */
import { MirrorConfig } from '../types';
import { FUEL_SPECIES } from '../reactivity';
import { bremsstrahlung } from '../radiation';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase, fusionRates } from './common';

const IDX = { W: 0, Efus: 1, Ein: 2, Nn: 3 } as const;
const NSTATE = 4;
/** Varsayılan tıkaç potansiyeli eφ_c/T_i (MirrorConfig.plugPotential verilmezse) */
const PLUG_POTENTIAL_DEFAULT = 1;

/** Pastukhov potansiyel-kuyusu çarpanı F(x) = x e^x / (1 + 1/(2x)), x = eφ/T (x ≤ 0 → 0) */
export function pastukhovFactor(x: number): number {
  if (!(x > 0)) return 0;
  return (x * Math.exp(x)) / (1 + 1 / (2 * x));
}

const MIRROR_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T (ion≈electron)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_auxiliary (NBI/ECRH)', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_charged', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_cond', label: 'P_end loss (W/τ)', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E (end loss)', unit: 's', group: 'Confinement' },
  { key: 'triple', label: 'n·T·τ', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'W', label: 'W_thermal', unit: 'MJ', group: 'Energy' },
  { key: 'Rm', label: 'Mirror ratio', unit: '', group: 'MHD' },
];

export class MirrorModel extends PulsedBase {
  readonly method = 'mirror' as const;
  readonly nState = NSTATE;
  readonly diagSpecs = MIRROR_DIAGS;

  private cfg: MirrorConfig;
  private V: number;
  private na: number;
  private nb: number;
  private ne: number;
  /** iyon yoğunluğu n_a + n_b (D-³He, p-¹¹B'de n_e'den farklı) */
  private ni: number;
  private Zeff: number;
  private Aavg: number;
  private lastTauE = 1e-3;

  constructor(cfg: MirrorConfig) {
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e2, 1e12]);
    super({ seed: cfg.seed, tEnd: cfg.t_end, timeUnit: 's', dt0: Math.min(1e-4, cfg.t_end / 1000),
      integratorOpts: { rtol: 2e-5, atol, dtMin: 1e-8, dtMax: cfg.t_end / 300, nonNegative: true } });
    this.cfg = cfg;
    this.V = Math.PI * cfg.a_m * cfg.a_m * cfg.L_m;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.na = cfg.n0 * fs.fracA;
    this.nb = cfg.n0 * (1 - fs.fracA);
    this.ne = this.na * fs.a.Z + this.nb * fs.b.Z;
    this.ni = this.na + this.nb;
    this.Zeff = (this.na * fs.a.Z ** 2 + this.nb * fs.b.Z ** 2) / Math.max(this.ne, 1);
    this.Aavg = fs.fracA * fs.a.A + (1 - fs.fracA) * fs.b.A;
    this.ctrl = { P_aux_MW: cfg.P_aux_MW, kappa_conf: 50 };
  }

  private T(y: Float64Array): number {
    // W = 3/2 (n_e + n_i) T V (T_e = T_i)
    return Math.max(y[IDX.W] / (1.5 * (this.ne + this.ni) * this.V * C.keV_J), 0.01);
  }
  /**
   * Uç (end-loss) hapsetme süresi [s]. Kayıp konisindeki parçacıklar bir geçiş
   * süresinde kaçar; ayna oranı R ile iyileşir: τ ≈ κ · R · L / v_th.
   * τ ∝ 1/√T olduğundan P_kayıp = W/τ ∝ n T^{3/2} artar → sıcaklık SINIRLANIR
   * (Pastukhov τ ∝ τ_ii ∝ T^{3/2} kullanılırsa 0D'de termal kaçış olur; bu daha
   * fiziksel uç-kaybı sınırıdır).
   */
  private tauE(T_keV: number): number {
    const m_i = this.Aavg * C.amu;
    const v_th = Math.sqrt((2 * Math.max(T_keV, 0.01) * C.keV_J) / m_i);
    const R = Math.max(this.cfg.mirrorRatio, 1.5);
    const tauSimple = (this.ctrl.kappa_conf * R * this.cfg.L_m) / v_th;
    const plug = this.cfg.tandem ? 1 + pastukhovFactor(this.cfg.plugPotential ?? PLUG_POTENTIAL_DEFAULT) : 1;
    return Math.max(tauSimple * plug, 1e-7);
  }

  initialState(): Float64Array {
    const y = new Float64Array(NSTATE);
    y[IDX.W] = 1.5 * (this.ne + this.ni) * U.keV_to_J(this.cfg.T_keV) * this.V;
    return y;
  }

  rhs(_t: number, y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const T = this.T(y);
    const fus = fusionRates(this.cfg.fuel, this.na, this.nb, T);
    const P_ch = fus.P_charged * this.V;
    const P_brems = bremsstrahlung(this.ne, T, this.Zeff) * this.V;
    const P_aux_inj = this.ctrl.P_aux_MW * 1e6;
    const P_aux = P_aux_inj * 0.7;
    const tauE = this.tauE(T);
    this.lastTauE = tauE;
    const P_cond = y[IDX.W] / tauE;
    d[IDX.W] = P_aux + P_ch - P_brems - P_cond;
    d[IDX.Efus] = fus.P_total * this.V;
    d[IDX.Ein] = P_aux_inj;
    d[IDX.Nn] = fus.neutrons * this.V;
  }

  diagnostics(_t: number, y: Float64Array): Record<string, number> {
    const T = this.T(y);
    const fus = fusionRates(this.cfg.fuel, this.na, this.nb, T);
    const P_fus = fus.P_total * this.V;
    const P_ch = fus.P_charged * this.V;
    const P_brems = bremsstrahlung(this.ne, T, this.Zeff) * this.V;
    const tauE = this.tauE(T);
    const P_aux_inj = this.ctrl.P_aux_MW * 1e6;
    const P_cond = y[IDX.W] / tauE;
    return {
      Ti: T, Te: T, ne: this.ne / 1e20, P_fus: P_fus / 1e6, P_aux: P_aux_inj / 1e6, P_alpha: P_ch / 1e6,
      P_brems: P_brems / 1e6, P_cond: P_cond / 1e6, Q: P_fus / Math.max(P_aux_inj, 1e4), tauE,
      triple: this.ne * T * tauE, W: y[IDX.W] / 1e6, Rm: this.cfg.mirrorRatio,
      Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
    };
  }

  protected extraSave(): Record<string, number> { return { lastTauE: this.lastTauE }; }
  protected extraRestore(s: Record<string, number>): void { this.lastTauE = s.lastTauE ?? 1e-3; }

  geometryInfo(): Record<string, number> {
    return { L: this.cfg.L_m, a: this.cfg.a_m, B: this.cfg.B_center_T, mirrorRatio: this.cfg.mirrorRatio, V: this.V, tandem: this.cfg.tandem ? 1 : 0 };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const col = (k: string) => hist.map((h) => h.d[k] ?? 0);
    const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea: 2 * Math.PI * this.cfg.a_m * this.cfg.L_m,
      scoreBreakdown: [
        { label: 'Q_scientific (max)', value: max(col('Q')), ref: 1, unit: '', note: 'Breakeven is very difficult for a mirror' },
        { label: 'Temperature (max)', value: max(col('Ti')), ref: 10, unit: 'keV', note: 'Ion temperature' },
        { label: 'Triple product', value: max(col('triple')), ref: 1e21, unit: 'keV s m⁻³', note: 'Ignition ≈ 3e21 (DT)' },
        { label: 'Stable time', value: hist[hist.length - 1].t, ref: this.cfg.t_end, unit: 's', note: 'Scheduled duration' },
        { label: 'Fusion energy', value: hist[hist.length - 1].d.Efus_MJ ?? 0, ref: 1, unit: 'MJ', note: 'Per shot' },
      ],
      historical: [
        { label: 'GDT / GAMMA-10: T_i ~keV', ratio: max(col('Ti')) / 10, note: 'temperature' },
        { label: 'Q≥1 target (WHAM/scaled)', ratio: max(col('Q')) / 1, note: 'Q' },
      ],
      engineering: {
        'Volume (m³)': +this.V.toFixed(3), 'Central B (T)': this.cfg.B_center_T, 'Mirror ratio': this.cfg.mirrorRatio,
        'Tandem': this.cfg.tandem, 'Final τ_E (ms)': +(this.lastTauE * 1e3).toFixed(3),
      },
      extras: { 'End loss dominant': 'yes (loss cone)', 'Auxiliary power (MW)': this.cfg.P_aux_MW },
      warnings: max(col('Q')) < 0.05 ? ['Simple/tandem mirrors yield low Q due to the loss cone — net energy is not expected without flow shear or a deep potential barrier.'] : [],
      Q_eng_note: 'Mirrors are conceptual/experimental; Q_eng is not modeled.',
    });
  }
}
