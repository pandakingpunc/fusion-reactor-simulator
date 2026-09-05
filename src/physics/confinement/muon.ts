/**
 * MÜON-KATALİZLİ FÜZYON (µCF) — algebraik verim modeli (easter egg).
 *
 * Bir müon, He'ye yapışana (α-sticking) kadar dtµ molekülünü katalize eder.
 * Müon başına füzyon:  Y_f = 1 / ( w_s + 1/(λ_c τ_µ) )
 *   w_s = α-yapışma olasılığı, λ_c = döngü hızı (yoğunlukla artar), τ_µ = 2.197 µs.
 * Enerji dengesi: her DT füzyonu 17.6 MeV; müon üretimi ~ birkaç GeV.
 * Kaynak: Jones (1986); Nagamine, "Introductory Muon Science" (2003).
 * SONUÇ: Q < 1 — yapışma ve müon maliyeti nedeniyle net enerji üretmez (kayırma yok).
 */
import { MuonConfig } from '../types';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase } from './common';

const IDX = { Efus: 0, Ein: 1, Nn: 2 } as const;
const NSTATE = 3;
const TAU_MU = 2.197e-6; // s, müon ömrü
const E_DT_MeV = 17.589;

const MUON_DIAGS: DiagSpec[] = [
  { key: 'Yf', label: 'Fusions / muon', unit: '', group: 'Catalyst' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_in', label: 'P_muon production', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'Nn', label: 'Neutron count', unit: '', group: 'Neutrons', log: true },
  { key: 'Ti', label: 'Temperature (cold!)', unit: 'keV', group: 'Temperature', log: true },
];

export class MuonModel extends PulsedBase {
  readonly method = 'muon' as const;
  readonly nState = NSTATE;
  readonly diagSpecs = MUON_DIAGS;

  private cfg: MuonConfig;
  private Yf: number;
  private Ti_keV: number;

  constructor(cfg: MuonConfig) {
    const atol = new Float64Array(NSTATE);
    atol.set([1, 1, 1e12]);
    super({ seed: cfg.seed, tEnd: 1, timeUnit: 's', dt0: 1e-3,
      integratorOpts: { rtol: 1e-5, atol, dtMin: 1e-6, dtMax: 0.02, nonNegative: true } });
    this.cfg = cfg;
    // Döngü hızı: sıvı hidrojen yoğunluğunda λ_c ≈ 1e8 /s (Nagamine 2003); yoğunlukla ölçekle
    const lambda_c = 1.0e8 * Math.max(cfg.density_LHD, 0.01);
    this.Yf = 1 / (cfg.stickingProb + 1 / (lambda_c * TAU_MU));
    this.Ti_keV = cfg.T_K / C.keV_K; // µCF soğuk (moleküler) ortamda çalışır
    this.ctrl = { muonRate_per_s: cfg.muonRate_per_s };
  }

  initialState(): Float64Array { return new Float64Array(NSTATE); }

  rhs(_t: number, _y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const rate = this.ctrl.muonRate_per_s; // müon/s
    const fusRate = rate * this.Yf; // füzyon/s
    d[IDX.Efus] = fusRate * U.MeV_to_J(E_DT_MeV);
    d[IDX.Ein] = rate * this.cfg.muonCost_GeV * 1e9 * C.e; // GeV → J
    d[IDX.Nn] = fusRate; // her DT füzyonu 1 nötron
  }

  diagnostics(_t: number, y: Float64Array): Record<string, number> {
    const rate = this.ctrl.muonRate_per_s;
    const P_fus = rate * this.Yf * U.MeV_to_J(E_DT_MeV);
    const P_in = rate * this.cfg.muonCost_GeV * 1e9 * C.e;
    return {
      Yf: this.Yf, P_fus: P_fus / 1e6, P_in: P_in / 1e6, Q: P_fus / Math.max(P_in, 1e-9),
      Ti: this.Ti_keV, triple: 0, Nn: y[IDX.Nn], Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6,
    };
  }

  geometryInfo(): Record<string, number> {
    return { Yf: this.Yf, stickingProb: this.cfg.stickingProb, density_LHD: this.cfg.density_LHD, muonCost_GeV: this.cfg.muonCost_GeV };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const last = hist[hist.length - 1];
    const Q = last.d.Q ?? 0;
    return this.buildReport(hist, events, {
      fuel: 'DT',
      scoreBreakdown: [
        { label: 'Q_scientific', value: Q, ref: 1, unit: '', note: 'Breakeven = 1 (µCF ~0.3-0.4)' },
        { label: 'Fusions / muon', value: this.Yf, ref: 150, unit: '', note: 'Sticking limit ~150' },
        { label: 'Fusion energy', value: last.d.Efus_MJ ?? 0, ref: 1, unit: 'MJ', note: 'Over 1 s' },
      ],
      historical: [
        { label: 'Experimental µCF: ~150 fusions/muon', ratio: this.Yf / 150, note: 'catalyst yield' },
        { label: 'Breakeven (Q=1)', ratio: Q / 1, note: 'Q' },
      ],
      engineering: {
        'Fusions / muon': +this.Yf.toFixed(1), 'α-sticking probability': this.cfg.stickingProb,
        'Muon cost (GeV)': this.cfg.muonCost_GeV, 'Operating temperature (K)': this.cfg.T_K,
      },
      extras: {
        'Why Q<1?': 'α-sticking consumes muons (~0.5%/cycle) + muon production is expensive (~5 GeV)',
        'Status': 'No net energy production under known physics (easter egg)',
      },
      warnings: ['Muon-catalyzed fusion works at room/cold temperatures but remains at Q<1 due to α-sticking and muon production costs (a fundamental physics limit).'],
      Q_eng_note: 'For µCF, scientific Q is already <1; engineering Q is even lower.',
      tempKey: 'Ti',
    });
  }
}
