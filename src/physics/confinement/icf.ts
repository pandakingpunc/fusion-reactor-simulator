/**
 * EYLEMSİZLİK HAPSETMELİ FÜZYON (ICF) — 0D patlama + yanma modeli (zaman: ns).
 *
 * Yaklaşım: sıkışma geometriden durgunluk (stagnation) koşullarını verir; yanma
 * oranı ρR ile burn-up kesri Φ = ρR/(ρR + H_B) (Atzeni & Meyer-ter-Vehn §11) ile
 * hesaplanır; ateşleme eşiği (hız, ρR, asimetri, pürüzlülük) bir "cliff" çarpanıyla
 * modellenir. Yanma zaman içinde bang-time çevresinde Gauss darbesi olarak verilir.
 *
 * Kalibrasyon: NIF N221204 preset'i G ≈ 1.5 verir (Abu-Shawareb 2024).
 * Fuel: the energy and the neutron number per reaction, H_B and the ignition threshold come from the selected fuel (icfFuelData);
 * the D-T values keep the calibration exactly.
 * Durum y: [0] E_fus [J]  [1] E_in [J]  [2] N_n
 * APPROXIMATION: 0D, tek noktalı hotspot; hidrodinamik ayrıntı yok.
 */
import { ICFConfig } from '../types';
import { FUEL_CHANNELS, FUEL_SPECIES, FuelType, isSingleSpecies, pairDensity } from '../reactivity';
import { U } from '../units';
import { C } from '../constants';
import { DiagSpec, HistoryFrame, ShotReport, SimEvent } from '../types';
import { PulsedBase } from './common';

const IDX = { Efus: 0, Ein: 1, Nn: 2 } as const;
const NSTATE = 3;
const H_B_DT = 7.0; // g/cm², D-T burn parameter (Atzeni & Meyer-ter-Vehn 2004; calibration point)
export const ICF_CAL = 0.07; // geometrik ρR → gerçekçi ρR kalibrasyonu (NIF'e ayarlı)
/** Default driver (laser) wall-plug efficiency and thermal conversion efficiency (used when ICFConfig gives none) */
const DRIVER_EFF_DEFAULT = 0.1;
const THERMAL_EFF_DEFAULT = 0.4;

export interface ICFFuelData {
  /** mean fuel-ion mass [amu] and mean charge (x_a, x_b = FUEL_SPECIES.fracA) */
  m_f_amu: number;
  Zbar: number;
  /** burn-up parametresi H_B [g/cm²]: Φ = ρR/(ρR + H_B) */
  H_B: number;
  /** burn temperature at which H_B is minimal (the optimum) [keV] */
  T_burn_keV: number;
  /** mean energy per reaction [MeV] and neutrons per reaction at that temperature (with the branching ratios) */
  E_rx_MeV: number;
  neutronsPerReaction: number;
  /** ignition-parameter factor: self-heating figure of merit max_T ⟨σv E_ch⟩/((1+Z̄)² T²) relative to D-T (D-T = 1) */
  ignitionScale: number;
}

/**
 * Fuel-specific ICF burn data.
 * Burn-up (Atzeni & Meyer-ter-Vehn, "The Physics of Inertial Fusion", OUP 2004, burn-fraction model):
 * for equimolar D-T Φ = ρR/(ρR + H_B), H_B = 8 m_f c_s/⟨σv⟩. For a general mixture the burn rate of the fuel ions
 * is dn/dt = −n² K, K = Σ_ch 2 x_ch ⟨σv⟩_ch (x_ch = x_a x_b or x_a²/2; each reaction consumes two
 * ions) and the same derivation gives H(T) = 4 m_f c_s/K (D-T: K = ⟨σv⟩/2 → 8 m_f c_s/⟨σv⟩);
 * c_s = √((1+Z̄)T/m_f) is the isothermal sound speed. The minimum of H(T) is ≈ 7.3 g/cm² for D-T (T ≈ 39 keV);
 * the calibrated D-T value of the model, 7 g/cm², is kept and the other fuels are scaled by the ratio:
 *   H_B,fuel = 7 · min_T H_fuel / min_T H_DT.
 * The energy and neutron number per reaction use the branching ratios at this optimal burn temperature.
 * The ignition threshold (Lawson-type figure of merit at constant pressure, self-heating ∝ p² ⟨σv⟩E_ch/((1+Z̄)²T²)) is scaled
 * relative to D-T. APPROXIMATION: Maxwellian ⟨σv⟩ (Bosch-Hale / p-¹¹B table), T_e = T_i.
 */
export function icfFuelData(fuel: FuelType): ICFFuelData {
  const cached = FUEL_DATA_CACHE.get(fuel);
  if (cached) return cached;
  const raw = (f: FuelType) => {
    const fs = FUEL_SPECIES[f];
    const xa = isSingleSpecies(f) ? 1 : fs.fracA, xb = 1 - xa;
    const m_f_amu = xa * fs.a.A + xb * fs.b.A, Zbar = xa * fs.a.Z + xb * fs.b.Z;
    const m_f = m_f_amu * C.amu;
    let Hmin = Infinity, Tbest = 0, Smax = 0;
    for (let i = 0; i <= 600; i++) {
      const T = Math.exp((Math.log(1000) * i) / 600); // 1 … 1000 keV
      let K = 0, Pch = 0;
      for (const ch of FUEL_CHANNELS[f]) {
        const r = pairDensity(f, ch, xa, xb) * ch.sigmav(T);
        K += 2 * r; Pch += r * ch.Echarged_MeV;
      }
      const cs = Math.sqrt(((1 + Zbar) * T * C.keV_J) / m_f);
      const H = K > 0 ? (4 * m_f * cs) / K / 10 : Infinity; // kg/m² → g/cm²
      if (H < Hmin) { Hmin = H; Tbest = T; }
      Smax = Math.max(Smax, Pch / ((1 + Zbar) * (1 + Zbar) * T * T));
    }
    let R = 0, E = 0, Nn = 0;
    for (const ch of FUEL_CHANNELS[f]) {
      const r = pairDensity(f, ch, xa, xb) * ch.sigmav(Tbest);
      R += r; E += r * ch.Etot_MeV; if (ch.Eneutron_MeV > 0) Nn += r;
    }
    return { m_f_amu, Zbar, Hmin, Tbest, Smax, E_rx: E / R, nPerRx: Nn / R };
  };
  const dt = raw('DT'), me = fuel === 'DT' ? dt : raw(fuel);
  const d: ICFFuelData = {
    m_f_amu: me.m_f_amu, Zbar: me.Zbar, H_B: H_B_DT * (me.Hmin / dt.Hmin), T_burn_keV: me.Tbest,
    E_rx_MeV: me.E_rx, neutronsPerReaction: me.nPerRx, ignitionScale: me.Smax / dt.Smax,
  };
  FUEL_DATA_CACHE.set(fuel, d);
  return d;
}
const FUEL_DATA_CACHE = new Map<FuelType, ICFFuelData>();

/** Stagnation and burn state of one implosion, everything {@link ICFModel} takes from the capsule inputs. */
export interface ICFStagnation {
  /** geometric areal density of the fuel at stagnation, m / (4/3 π R_stag²) [g/cm²] */
  rhoR_geo: number;
  /** effective (burn-weighted) areal density, rhoRScale · ρR_geo · √(2.8/α) [g/cm²] */
  rhoR_eff: number;
  /** ignition parameter χ_ig of the cliff multiplier */
  chi_ig: number;
  ignited: boolean;
  /** cliff multiplier on the burn: 1 when ignited, χ_ig³ below the threshold */
  burnMult: number;
  /** burn-up fraction of the fuel ions, ρR/(ρR + H_B), before the cliff multiplier */
  Phi: number;
  N_fus_total: number;
  E_fus_total: number;
  N_n_total: number;
  T_hs: number;
}

/**
 * The 0D implosion model in closed form: capsule inputs → stagnation ρR, ignition parameter and total yield.
 * ICFModel uses this function; `rhoRScale` is the one calibration knob of the model (ICF_CAL, see icfCalibration.ts),
 * a parameter here so that the calibration can solve for it and the tests can reproduce it.
 */
export function icfStagnation(cfg: ICFConfig, rhoRScale: number = ICF_CAL): ICFStagnation {
  const fd = icfFuelData(cfg.fuel);
  const m_fuel = cfg.fuelMass_ug * 1e-9; // kg
  const m_i = fd.m_f_amu * C.amu; // mean fuel-ion mass
  const N_ions = m_fuel / m_i;

  // stagnation geometry
  const R0 = cfg.capsuleRadius_um * 1e-6;
  const R_stag = R0 / Math.max(cfg.convergenceRatio, 1);
  const rhoR_kg = m_fuel / ((4 / 3) * Math.PI * R_stag * R_stag); // kg/m²
  const rhoR_geo = rhoR_kg / 10; // g/cm²
  const rhoR_eff = rhoRScale * rhoR_geo * Math.sqrt(2.8 / Math.max(cfg.adiabat, 0.5));

  // ignition cliff: rate, ρR, asymmetry, roughness (constants set for D-T), scaled by the self-heating figure of merit of the fuel
  const v = cfg.implosionVelocity_kms;
  const f_asym = Math.exp(-Math.pow(cfg.asymmetry_rms / 6, 2));
  const f_rough = Math.exp(-Math.pow(cfg.surfaceRoughness_nm / 200, 2));
  const chi_ig = fd.ignitionScale * (rhoR_eff / 0.2) * Math.pow(v / 360, 3) * f_asym * f_rough;
  const ignited = chi_ig >= 1;
  const burnMult = ignited ? 1 : Math.pow(Math.max(chi_ig, 0), 3);

  const Phi = rhoR_eff / (rhoR_eff + fd.H_B); // burn-up fraction (fuel ions)
  const N_fus_total = Phi * (N_ions / 2) * burnMult; // two ions per reaction
  const E_fus_total = N_fus_total * U.MeV_to_J(fd.E_rx_MeV);
  const N_n_total = N_fus_total * fd.neutronsPerReaction;

  // hot-spot temperature: kinematic + ignition (alpha) boost
  const T_kin = (m_i * Math.pow(v * 1e3, 2)) / (3 * C.keV_J); // keV
  const T_hs = ignited ? Math.min(4 + (chi_ig - 1) * 4, 15) : Math.max(T_kin, 0.5);
  return { rhoR_geo, rhoR_eff, chi_ig, ignited, burnMult, Phi, N_fus_total, E_fus_total, N_n_total, T_hs };
}

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
  private fuelData: ICFFuelData;
  private E_laser_J: number;
  private E_fus_total: number; // toplam füzyon enerjisi [J]
  private N_fus_total: number; // toplam füzyon reaksiyonu
  private N_n_total: number; // total number of neutrons
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

    this.fuelData = icfFuelData(cfg.fuel);
    const st = icfStagnation(cfg);
    this.rhoR_eff = st.rhoR_eff;
    this.chi_ig = st.chi_ig;
    this.ignited = st.ignited;
    this.N_fus_total = st.N_fus_total;
    this.E_fus_total = st.E_fus_total;
    this.N_n_total = st.N_n_total;
    this.T_hs = st.T_hs;

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
    d[IDX.Nn] = this.N_n_total * g; // 1/ns
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
    // Q_eng = P_el,gross / P_recirculating = (η_th E_fus) / (E_laser / η_driver) = G η_driver η_th. The hohlraum /
    // absorption efficiency is already inside G (G = E_fus / E_laser): it is not multiplied in a second time.
    const etaDriver = this.cfg.driverEff ?? DRIVER_EFF_DEFAULT, etaTh = this.cfg.thermalEff ?? THERMAL_EFF_DEFAULT;
    const warnings: string[] = [];
    if (!this.ignited) warnings.push(`Below the ignition threshold (χ_ig = ${this.chi_ig.toFixed(2)} < 1): inadequate velocity, ρR, asymmetry, or roughness — low burn efficiency.`);
    if (this.cfg.asymmetry_rms > 3) warnings.push(`Low-mode asymmetry of ${this.cfg.asymmetry_rms}% is high — the hotspot degrades and yield drops.`);
    return this.buildReport(hist, events, {
      fuel: this.cfg.fuel, wallArea: 314, // ~5 m yarıçaplı hedef odası
      Q_eng: G * etaDriver * etaTh,
      Q_eng_note: `For ICF, Q_eng = G × η_driver × η_thermal (laser wall-plug ${(etaDriver * 100).toFixed(0)}%, thermal conversion ${(etaTh * 100).toFixed(0)}%); the drive coupling is already inside G. Net energy requires G ≳ ${Math.ceil(1 / (etaDriver * etaTh))}.`,
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
        'Burn-up parameter H_B (g/cm²)': +this.fuelData.H_B.toFixed(2), 'Energy per reaction (MeV)': +this.fuelData.E_rx_MeV.toFixed(3),
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
