/**
 * ALAN-TERSİNMİŞ KONFİGÜRASYON (FRC) — 0D güç dengesi (tek sıcaklık).
 *
 * Durum y: [0] W [J] termal enerji  [1] E_fus [J]  [2] E_in [J]  [3] N_n (nötron)
 * Yoğunluk sabit (n0) varsayılır; sıcaklık NBI + alfa ısıtması ile evrilir.
 * Hapsetme: Bohm-benzeri τ_E = κ_conf · r_s² / (6 χ_Bohm) (Steinhauer 2011 mertebesi).
 * APPROXIMATION: 0D, sabit yoğunluk, safsızlık yok, MHD (tilt/kink) yalnızca κ_conf ile.
 */
import { FRCConfig } from '../types';
import { FUEL_SPECIES } from '../reactivity';
import { bremsstrahlung } from '../radiation';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase, fusionRates } from './common';

const IDX = { W: 0, Efus: 1, Ein: 2, Nn: 3 } as const;
const NSTATE = 4;

const FRC_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T (ion≈electron)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_NBI', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_charged (self-heating)', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_cond', label: 'P_conduction (W/τ_E)', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E', unit: 's', group: 'Confinement' },
  { key: 'triple', label: 'n·T·τ_E', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'W', label: 'W_thermal', unit: 'MJ', group: 'Energy' },
  { key: 'beta', label: 'β (FRC ~1)', unit: '', group: 'MHD' },
];

export class FRCModel extends PulsedBase {
  readonly method = 'frc' as const;
  readonly nState = NSTATE;
  readonly diagSpecs = FRC_DIAGS;

  private cfg: FRCConfig;
  private V: number;
  private na: number;
  private nb: number;
  private ne: number;
  /** ion density n_a + n_b (differs from n_e for D-³He and p-¹¹B) */
  private ni: number;
  private Zeff: number;
  private lastTauE = 1e-3;

  constructor(cfg: FRCConfig) {
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e2, 1e12]);
    super({ seed: cfg.seed, tEnd: cfg.t_end, timeUnit: 's', dt0: Math.min(1e-5, cfg.t_end / 1000),
      integratorOpts: { rtol: 2e-5, atol, dtMin: 1e-9, dtMax: cfg.t_end / 300, nonNegative: true } });
    this.cfg = cfg;
    this.V = Math.PI * cfg.rs_m * cfg.rs_m * cfg.L_m;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.na = cfg.n0 * fs.fracA;
    this.nb = cfg.n0 * (1 - fs.fracA);
    this.ne = this.na * fs.a.Z + this.nb * fs.b.Z;
    this.ni = this.na + this.nb;
    this.Zeff = (this.na * fs.a.Z ** 2 + this.nb * fs.b.Z ** 2) / Math.max(this.ne, 1);
    this.ctrl = { P_NBI_MW: cfg.P_NBI_MW, kappa_conf: 10 };
  }

  private T(y: Float64Array): number {
    // W = 3/2 (n_e + n_i) T V (T_e = T_i)
    return Math.max(y[IDX.W] / (1.5 * (this.ne + this.ni) * this.V * C.keV_J), 0.01);
  }
  private tauE(T_keV: number): number {
    // Bohm: χ = T[eV]/(16 B) [m²/s]; τ_E = κ · r_s²/(6χ)
    const chi = (T_keV * 1000) / (16 * Math.max(this.cfg.Be_T, 0.02));
    return Math.max((this.ctrl.kappa_conf * this.cfg.rs_m * this.cfg.rs_m) / (6 * Math.max(chi, 1e-6)), 1e-6);
  }

  initialState(): Float64Array {
    const y = new Float64Array(NSTATE);
    y[IDX.W] = 1.5 * (this.ne + this.ni) * U.keV_to_J(this.cfg.T0_keV) * this.V;
    return y;
  }

  rhs(_t: number, y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const T = this.T(y);
    const fus = fusionRates(this.cfg.fuel, this.na, this.nb, T);
    const P_ch = fus.P_charged * this.V;
    const P_brems = bremsstrahlung(this.ne, T, this.Zeff) * this.V;
    const P_nbi_inj = this.ctrl.P_NBI_MW * 1e6;
    const P_nbi = P_nbi_inj * 0.8; // soğurma verimi (APPROXIMATION)
    const tauE = this.tauE(T);
    this.lastTauE = tauE;
    const P_cond = y[IDX.W] / tauE;
    d[IDX.W] = P_nbi + P_ch - P_brems - P_cond;
    d[IDX.Efus] = fus.P_total * this.V;
    d[IDX.Ein] = P_nbi_inj;
    d[IDX.Nn] = fus.neutrons * this.V;
  }

  diagnostics(_t: number, y: Float64Array): Record<string, number> {
    const T = this.T(y);
    const fus = fusionRates(this.cfg.fuel, this.na, this.nb, T);
    const P_fus = fus.P_total * this.V;
    const P_ch = fus.P_charged * this.V;
    const P_brems = bremsstrahlung(this.ne, T, this.Zeff) * this.V;
    const tauE = this.tauE(T);
    const P_nbi_inj = this.ctrl.P_NBI_MW * 1e6;
    const P_cond = y[IDX.W] / tauE;
    const Q = P_fus / Math.max(P_nbi_inj, 1e4);
    return {
      Ti: T, Te: T, ne: this.ne / 1e20, P_fus: P_fus / 1e6, P_aux: P_nbi_inj / 1e6, P_alpha: P_ch / 1e6,
      P_brems: P_brems / 1e6, P_cond: P_cond / 1e6, Q, tauE, triple: this.ne * T * tauE,
      W: y[IDX.W] / 1e6, beta: 0.9, Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
    };
  }

  protected extraSave(): Record<string, number> { return { lastTauE: this.lastTauE }; }
  protected extraRestore(s: Record<string, number>): void { this.lastTauE = s.lastTauE ?? 1e-3; }

  geometryInfo(): Record<string, number> {
    return { rs: this.cfg.rs_m, L: this.cfg.L_m, B: this.cfg.Be_T, V: this.V, n0: this.cfg.n0 };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const col = (k: string) => hist.map((h) => h.d[k] ?? 0);
    const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
    const wallArea = 2 * Math.PI * this.cfg.rs_m * this.cfg.L_m;
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea,
      scoreBreakdown: [
        { label: 'Q_scientific (max)', value: max(col('Q')), ref: 1, unit: '', note: 'Breakeven target for FRC/NBI' },
        { label: 'Temperature (max)', value: max(col('Ti')), ref: 10, unit: 'keV', note: 'High-β FRC target' },
        { label: 'Triple product', value: max(col('triple')), ref: 1e21, unit: 'keV s m⁻³', note: 'Ignition ≈ 3e21 (DT)' },
        { label: 'Fusion energy', value: hist[hist.length - 1].d.Efus_MJ ?? 0, ref: 1, unit: 'MJ', note: 'Per shot' },
        { label: 'Stable time', value: hist[hist.length - 1].t, ref: this.cfg.t_end, unit: 's', note: 'Scheduled duration' },
      ],
      historical: [
        { label: 'TAE Norman: T_e ~1 keV, τ~ms', ratio: max(col('Ti')) / 1, note: 'temperature' },
        { label: 'ITER target: Q=10', ratio: max(col('Q')) / 10, note: 'Q' },
      ],
      engineering: {
        'Volume (m³)': +this.V.toFixed(3), 'External field B_e (T)': this.cfg.Be_T,
        'Final τ_E (ms)': +(this.lastTauE * 1e3).toFixed(3), 'n_0 (1e20 m⁻³)': +(this.cfg.n0 / 1e20).toFixed(3),
      },
      extras: { 'NBI power (MW)': this.cfg.P_NBI_MW, 'β (FRC)': '~1 (high-β configuration)' },
      warnings: max(col('Q')) < 0.01 ? ['FRC is far from scientific breakeven at these parameters (Q≪1) — as expected: current FRC experiments do not yet produce net energy.'] : [],
      Q_eng_note: 'FRC is an experimental configuration; Q_eng is not modeled.',
    });
  }
}
