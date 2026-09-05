/**
 * EYLEMSİZLİK HAPSETMELİ FÜZYON (ICF) — 0D patlama + yanma modeli (zaman: ns).
 *
 * Yaklaşım: sıkışma geometriden durgunluk (stagnation) koşullarını verir; yanma
 * oranı ρR ile burn-up kesri Φ = ρR/(ρR + H_B) (Atzeni & Meyer-ter-Vehn §11) ile
 * hesaplanır; ateşleme eşiği (hız, ρR, asimetri, pürüzlülük) bir "cliff" çarpanıyla
 * modellenir. Yanma zaman içinde bang-time çevresinde Gauss darbesi olarak verilir.
 *
 * Kalibrasyon: NIF N221204 preset'i G ≈ 1.5 verir (Abu-Shawareb 2024).
 * Durum y: [0] E_fus [J]  [1] E_in [J]  [2] N_n
 * APPROXIMATION: 0D, tek noktalı hotspot; hidrodinamik ayrıntı yok.
 */
import { ICFConfig } from '../types';
import { FUEL_SPECIES } from '../reactivity';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase } from './common';

const IDX = { Efus: 0, Ein: 1, Nn: 2 } as const;
const NSTATE = 3;
const H_B = 7.0; // g/cm², DT burn parametresi (Atzeni)
const ICF_CAL = 0.07; // geometrik ρR → gerçekçi ρR kalibrasyonu (NIF'e ayarlı)
const E_DT_MeV = 17.589;

const ICF_DIAGS: DiagSpec[] = [
  { key: 'P_fus', label: 'P_fusion (instantaneous)', unit: 'MW', group: 'Power' },
  { key: 'Ti', label: 'Hotspot T', unit: 'keV', group: 'Temperature' },
  { key: 'rhoR', label: 'ρR (areal density)', unit: 'g/cm²', group: 'Compression' },
  { key: 'Q', label: 'Gain G (cumulative)', unit: '', group: 'Performance' },
  { key: 'Efus_MJ', label: 'E_fusion (accumulated)', unit: 'MJ', group: 'Energy' },
  { key: 'Nn', label: 'Neutron count', unit: '', group: 'Neutrons', log: true },
  { key: 'ignited', label: 'Ignition (0/1)', unit: '', group: 'Performance' },
];

export class ICFModel extends PulsedBase {
  readonly method: ICFConfig['method'];
  readonly nState = NSTATE;
  readonly diagSpecs = ICF_DIAGS;

  private cfg: ICFConfig;
  private E_laser_J: number;
  private E_fus_total: number; // toplam füzyon enerjisi [J]
  private N_fus_total: number; // toplam füzyon reaksiyonu
  private rhoR_eff: number; // g/cm²
  private chi_ig: number; // ateşleme parametresi
  private T_hs: number; // hotspot sıcaklığı [keV]
  private bang: number; // ns
  private sigma = 0.08; // ns, yanma darbe genişliği
  private ignited: boolean;

  constructor(cfg: ICFConfig) {
    const tEnd = cfg.pulse_ns + 3;
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e12]);
    super({ seed: cfg.seed, tEnd, timeUnit: 'ns', dt0: 0.01,
      integratorOpts: { rtol: 1e-5, atol, dtMin: 1e-4, dtMax: 0.02, nonNegative: true }, outputDt: tEnd / 1000 });
    this.method = cfg.method;
    this.cfg = cfg;
    this.bang = cfg.pulse_ns;
    this.E_laser_J = cfg.E_laser_MJ * 1e6;

    const fs = FUEL_SPECIES[cfg.fuel];
    const m_fuel = cfg.fuelMass_ug * 1e-9; // kg
    const m_pair = (fs.a.A + fs.b.A) * C.amu;
    const N_pairs = m_fuel / m_pair;
    const m_i = 0.5 * (fs.a.A + fs.b.A) * C.amu; // ort. iyon kütlesi

    // durgunluk geometrisi
    const R0 = cfg.capsuleRadius_um * 1e-6;
    const R_stag = R0 / Math.max(cfg.convergenceRatio, 1);
    const rhoR_kg = m_fuel / ((4 / 3) * Math.PI * R_stag * R_stag); // kg/m²
    const rhoR_geo = rhoR_kg / 10; // g/cm²
    this.rhoR_eff = ICF_CAL * rhoR_geo * Math.sqrt(2.8 / Math.max(cfg.adiabat, 0.5));

    // ateşleme cliff: hız, ρR, asimetri, pürüzlülük
    const v = cfg.implosionVelocity_kms;
    const f_asym = Math.exp(-Math.pow(cfg.asymmetry_rms / 6, 2));
    const f_rough = Math.exp(-Math.pow(cfg.surfaceRoughness_nm / 200, 2));
    this.chi_ig = (this.rhoR_eff / 0.2) * Math.pow(v / 360, 3) * f_asym * f_rough;
    this.ignited = this.chi_ig >= 1;
    const burnMult = this.ignited ? 1 : Math.pow(Math.max(this.chi_ig, 0), 3);

    const Phi = this.rhoR_eff / (this.rhoR_eff + H_B); // burn-up kesri
    this.N_fus_total = Phi * N_pairs * burnMult;
    this.E_fus_total = this.N_fus_total * U.MeV_to_J(E_DT_MeV);

    // hotspot sıcaklığı: kinematik + ateşleme (alfa) yükseltmesi
    const T_kin = (m_i * Math.pow(v * 1e3, 2)) / (3 * C.keV_J); // keV
    this.T_hs = this.ignited ? Math.min(4 + (this.chi_ig - 1) * 4, 15) : Math.max(T_kin, 0.5);

    this.ctrl = {};
  }

  private gauss(t: number): number {
    const z = (t - this.bang) / this.sigma;
    return Math.exp(-0.5 * z * z) / (this.sigma * Math.sqrt(2 * Math.PI)); // 1/ns
  }

  initialState(): Float64Array { return new Float64Array(NSTATE); }

  rhs(t: number, _y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const g = this.gauss(t); // 1/ns
    d[IDX.Efus] = this.E_fus_total * g; // J/ns
    d[IDX.Nn] = this.N_fus_total * g; // 1/ns
    // lazer enerjisi darbe boyunca (t < pulse_ns)
    d[IDX.Ein] = t < this.cfg.pulse_ns ? this.E_laser_J / this.cfg.pulse_ns : 0;
  }

  diagnostics(t: number, y: Float64Array): Record<string, number> {
    const P_fus_W = this.E_fus_total * this.gauss(t) * 1e9; // J/ns → W
    const inBurn = Math.abs(t - this.bang) < 3 * this.sigma;
    return {
      P_fus: P_fus_W / 1e6, Ti: this.T_hs, rhoR: this.rhoR_eff,
      Q: y[IDX.Efus] / Math.max(y[IDX.Ein], 1), triple: 0,
      Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
      ignited: this.ignited && inBurn ? 1 : 0,
    };
  }

  protected stepEvents(t: number, _dt: number, _y: Float64Array): SimEvent[] {
    const ev: SimEvent[] = [];
    if (!this._banged && t >= this.bang) {
      this._banged = true;
      if (this.ignited) ev.push({ t, kind: 'ignition', msg: `Bang-time: IGNITION (χ_ig = ${this.chi_ig.toFixed(2)} ≥ 1), hotspot ${this.T_hs.toFixed(1)} keV, ρR = ${this.rhoR_eff.toFixed(2)} g/cm²` });
      else ev.push({ t, kind: 'warning', msg: `Bang-time: NO ignition (χ_ig = ${this.chi_ig.toFixed(2)} < 1) — low burn` });
    }
    return ev;
  }
  private _banged = false;
  protected extraSave(): Record<string, number> { return { banged: this._banged ? 1 : 0 }; }
  protected extraRestore(s: Record<string, number>): void { this._banged = (s.banged ?? 0) > 0; }

  geometryInfo(): Record<string, number> {
    return {
      capsuleRadius_um: this.cfg.capsuleRadius_um, convergenceRatio: this.cfg.convergenceRatio,
      rhoR: this.rhoR_eff, chi_ig: this.chi_ig, T_hs: this.T_hs, indirect: this.cfg.method === 'icf_indirect' ? 1 : 0,
    };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const G = this.E_fus_total / Math.max(this.E_laser_J, 1);
    const warnings: string[] = [];
    if (!this.ignited) warnings.push(`Below the ignition threshold (χ_ig = ${this.chi_ig.toFixed(2)} < 1): inadequate velocity, ρR, asymmetry, or roughness — low burn efficiency.`);
    if (this.cfg.asymmetry_rms > 3) warnings.push(`Low-mode asymmetry of ${this.cfg.asymmetry_rms}% is high — the hotspot degrades and yield drops.`);
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea: 314, // ~5 m yarıçaplı hedef odası
      Q_eng: G * (this.cfg.method === 'icf_indirect' ? this.cfg.hohlraumEff : this.cfg.absorption) * 0.1,
      Q_eng_note: 'For ICF, Q_eng ≈ G × coupling × wall-plug efficiency (including ~10% laser efficiency); net energy requires G ≳ 100.',
      scoreBreakdown: [
        { label: 'Gain G', value: G, ref: 1, unit: '', note: 'G>1 = scientific breakeven (NIF 2022)' },
        { label: 'Hotspot T', value: this.T_hs, ref: 5, unit: 'keV', note: 'Ignition ~ 4-5 keV' },
        { label: 'ρR', value: this.rhoR_eff, ref: 0.3, unit: 'g/cm²', note: 'Burn requires ρR ≳ 0.3' },
        { label: 'Ignition parameter', value: this.chi_ig, ref: 1, unit: '', note: 'χ_ig ≥ 1 = ignition' },
        { label: 'Fusion energy', value: this.E_fus_total / 1e6, ref: 3.15, unit: 'MJ', note: 'NIF 2022: 3.15 MJ' },
      ],
      historical: [
        { label: 'NIF 2022 (N221204): 3.15 MJ, G=1.5', ratio: G / 1.5, note: 'gain' },
        { label: 'NIF 2022: 3.15 MJ fusion', ratio: this.E_fus_total / 3.15e6, note: 'fusion energy' },
      ],
      engineering: {
        'Gain G': +G.toFixed(2), 'ρR (g/cm²)': +this.rhoR_eff.toFixed(3), 'Ignition χ_ig': +this.chi_ig.toFixed(2),
        'Hotspot T (keV)': +this.T_hs.toFixed(1), 'Coupling': this.cfg.method === 'icf_indirect' ? `hohlraum ${(this.cfg.hohlraumEff * 100).toFixed(0)}%` : `direct ${(this.cfg.absorption * 100).toFixed(0)}%`,
        'Laser (MJ)': this.cfg.E_laser_MJ, 'Ignited': this.ignited,
      },
      extras: {
        'Convergence ratio (CR)': this.cfg.convergenceRatio, 'Adiabat α': this.cfg.adiabat,
        'Implosion velocity (km/s)': this.cfg.implosionVelocity_kms,
      },
      warnings,
      stableDefinition: 'ICF is pulsed: "duration" is the burn window around bang-time (ns). Gain G = E_fusion / E_laser.',
      tempKey: 'Ti',
    });
  }
}
