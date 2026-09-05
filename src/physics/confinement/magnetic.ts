/**
 * MANYETİK HAPSETME 0D MODELİ — tokamak, sferik tokamak, stellarator.
 *
 * Durum vektörü y:
 *  0 W_e   [J]  elektron termal enerjisi        1 W_i  [J] iyon termal enerjisi
 *  2 n_a   [m^-3] yakıt a (D)                   3 n_b  [m^-3] yakıt b (T / D / He3 / B11)
 *  4 n_He  [m^-3] kül (He4)                     5 n_Z  [m^-3] safsızlık
 *  6 W_f   [J]  hızlı alfa + NBI iyon enerjisi (yavaşlama gecikmesi)
 *  7 I_p   [A]                                  8 E_fus [J] toplam füzyon enerjisi
 *  9 E_in  [J] toplam yardımcı+ohmik enerji     10 N_n  nötron sayısı
 *  11 N_Tburn  yanan T atomu                    12 N_Tfuel  enjekte edilen T atomu
 *  13 S_fuel [m^-3 s^-1] gecikmeli besleme kaynağı (1. derece lag)
 *
 * Güç dengesi (hacim ortalaması, sabit profil şekli):
 *  dW_e/dt = P_oh + P_aux,e + P_f,e − P_brems − P_sync − P_line − P_ei − W_e/τ_E
 *  dW_i/dt = P_aux,i + P_f,i + P_ei − W_i/τ_E
 *  dn/dt   = S − n/τ_p − yanma ;  dn_He/dt = R_fus − n_He/τ_He
 * APPROXIMATION: 0D. Profiller n∝(1−ρ²)^αn, T∝(1−ρ²)^αT ile sabit; pedestal, Shafranov kayması,
 * türbülans ve MHD sadece τ_E ölçeklemesi + eşik olayları (ELM/sawtooth/NTM/disruption) ile.
 */
import { Geometry, plasmaVolume, plasmaSurface, crossSectionArea, q95 as q95fn, profileIntegral, poloidalField } from '../geometry';
import { FUEL_CHANNELS, FUEL_SPECIES, beamTargetReactivity } from '../reactivity';
import { bremsstrahlung, synchrotronTotal, coolingRate, meanCharge } from '../radiation';
import { tauIPB98y2, tauITER89P, tauISS04, tauSTValovic, pLH_Martin, tauEquilibration } from '../transport';
import { resistivity, ohmicPower, criticalEnergy, ionHeatingFraction, slowingDownTime, nbiShineThrough } from '../heating';
import { greenwaldDensity, betaToroidal, betaNormalized, betaPoloidal } from '../limits';
import { disruptionReport, DisruptionCause, DISRUPTION_LABELS, DISRUPTION_FIXES } from '../disruption';
import { checkMagnet, MAGNET_TECH, divertorHeatFlux, divertorHeatFluxStellarator, neutronWallLoad, tritiumBreedingRatio, economics } from '../engineering';
import { RNG } from '../rng';
import { C } from '../constants';
import { U } from '../units';
import { DiagSpec, HistoryFrame, MagneticConfig, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';

const IDX = { We: 0, Wi: 1, na: 2, nb: 3, nHe: 4, nZ: 5, Wf: 6, Ip: 7, Efus: 8, Ein: 9, Nn: 10, NTburn: 11, NTfuel: 12, Sfuel: 13 } as const;
const NSTATE = 14;

/** Lawson ateşleme referansı: D-T için nTτ_E ≈ 3e21 keV s m^-3 (Wesson; T≈15 keV, profil düz) */
export const LAWSON_DT = 3e21;

export const MAGNETIC_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T_i (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Te', label: 'T_e (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Ti0', label: 'T_i (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nG_frac', label: 'n/n_Greenwald', unit: '', group: 'Density' },
  { key: 'fHe', label: 'He ash fraction', unit: '', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_alpha (deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_bt', label: 'P_fusion beam-target', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_auxiliary', unit: 'MW', group: 'Power' },
  { key: 'P_oh', label: 'P_ohmic', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_sync', label: 'P_synchrotron', unit: 'MW', group: 'Radiation' },
  { key: 'P_line', label: 'P_line', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad', label: 'P_rad total', unit: 'MW', group: 'Radiation' },
  { key: 'P_cond', label: 'P_conduction (W/τ_E)', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E', unit: 's', group: 'Confinement' },
  { key: 'H_mode', label: 'Mode (1=H, 0=L)', unit: '', group: 'Confinement' },
  { key: 'P_LH', label: 'P_LH threshold', unit: 'MW', group: 'Confinement' },
  { key: 'betaN', label: 'β_N', unit: '', group: 'MHD' },
  { key: 'betaT', label: 'β_T', unit: '%', group: 'MHD' },
  { key: 'q95', label: 'q95', unit: '', group: 'MHD' },
  { key: 'NTM', label: 'NTM (0/1)', unit: '', group: 'MHD' },
  { key: 'W', label: 'W_plasma', unit: 'MJ', group: 'Energy' },
  { key: 'Wf', label: 'W_fast ions', unit: 'MJ', group: 'Energy' },
  { key: 'triple', label: 'n·T·τ_E', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'lawson', label: 'Lawson ratio', unit: '', group: 'Performance' },
  { key: 'Zeff', label: 'Z_eff', unit: '', group: 'Impurities' },
  { key: 'cZ', label: 'c_Z (n_Z/n_e)', unit: '', group: 'Impurities', log: true },
  { key: 'Ip', label: 'I_p', unit: 'MA', group: 'MHD' },
  { key: 'S_fuel', label: 'Fueling', unit: '1e20 /s', group: 'Density' },
  { key: 'burnFrac', label: 'T burn fraction', unit: '', group: 'Fuel' },
  { key: 'q_div', label: 'Divertor heat flux', unit: 'MW/m²', group: 'Engineering' },
  { key: 'n_wall', label: 'Neutron wall load', unit: 'MW/m²', group: 'Engineering' },
  { key: 'fuelFracA', label: 'D fraction n_D/(n_D+n_T)', unit: '', group: 'Fuel' },
];

type Phase = 'normal' | 'thermal_quench' | 'current_quench' | 'ended';

export class MagneticModel implements SimModel {
  readonly kind = 'magnetic' as const;
  readonly method: MagneticConfig['method'];
  readonly timeUnit = 's' as const;
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState = NSTATE;
  readonly diagSpecs = MAGNETIC_DIAGS;
  readonly integratorOpts;
  readonly dt0 = 1e-3;
  terminated: TerminationInfo | null = null;

  private cfg: MagneticConfig;
  private g: Geometry;
  private V: number;
  private S: number;
  private A: number;
  private eps: number;
  private M: number; // ortalama yakıt kütlesi (amu)
  private rng: RNG;
  private isStell: boolean;

  // dahili durum
  private phase: Phase = 'normal';
  private hmode = false;
  private ntm = false;
  private tNextELM = Infinity;
  private tNextSaw = 0.3;
  private elmAvgPower = 0; // ELM ortalama gücü (sürekli kayıptan düşülür)
  private elmDW = 0;
  private elmPartRate = 0; // ELM'lerin ortalama parçacık atım hızı [1/s]
  private tauW_accum = 1; // W birikim çarpanı
  private disruptCause: DisruptionCause = 'none';
  private tDisrupt = 0;
  private Wd = 0; // disruption anındaki W
  private Ip0: number;
  private tauE_last = 1;
  private lastDiag: Record<string, number> = {};
  private ignited = false;
  private burning = false;
  private warned = new Set<string>();
  private magnetInfo;

  // canlı kontroller
  private ctrl: Record<string, number>;

  constructor(cfg: MagneticConfig) {
    this.cfg = cfg;
    this.method = cfg.method;
    this.g = cfg.geometry;
    this.isStell = cfg.method === 'stellarator';
    this.V = plasmaVolume(this.g);
    this.S = plasmaSurface(this.g);
    this.A = crossSectionArea(this.g);
    this.eps = this.g.a / this.g.R;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    this.rng = new RNG(cfg.seed);
    this.tEnd = cfg.t_end;
    this.outputDt = Math.max(cfg.t_end / 1500, 0.002);
    this.Ip0 = this.isStell ? 0 : cfg.Ip_MA * 1e6;
    this.ctrl = {
      P_NBI_MW: cfg.heating.P_NBI_MW, P_ICRH_MW: cfg.heating.P_ICRH_MW, P_ECRH_MW: cfg.heating.P_ECRH_MW,
      n_target_1e20: cfg.n_target / 1e20, H98: cfg.H98, cZ: cfg.impurity.concentration,
      fuelRate_1e20s: cfg.fueling.maxRate_1e20s,
    };
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e13, 1e13, 1e12, 1e11, 1e2, 1e2, 1e3, 1e3, 1e12, 1e12, 1e12, 1e14]);
    this.integratorOpts = { rtol: 2e-5, atol, dtMin: 1e-6, dtMax: Math.min(0.05, cfg.t_end / 400), nonNegative: true };
    this.magnetInfo = checkMagnet(this.g, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m);
    if (this.magnetInfo.quench) {
      this.phase = 'ended';
      this.terminated = {
        t: 0, natural: false, reason: 'Magnet quench',
        diagnosis: `Peak field in the toroidal field coil B_coil = ${this.magnetInfo.B_coil.toFixed(1)} T, ${MAGNET_TECH[cfg.magnet.tech].label} has a limit of ${this.magnetInfo.B_max} T. The coil quenched; shot aborted.`,
        fix: DISRUPTION_FIXES.magnet_quench,
      };
    }
  }

  // ---------- yardımcılar ----------
  private seedZ(Te: number): number {
    const im = this.cfg.impurity;
    return im.seedSpecies && im.seedConcentration ? meanCharge(im.seedSpecies, Math.max(Te, 0.1)) : 0;
  }
  private seedC(): number { return this.cfg.impurity.seedConcentration ?? 0; }
  /** n_e = Σ Z_j n_j ; tohum safsızlığı n_s = c_s n_e → n_e = n_e,main / (1 − Z_s c_s) */
  private ne(y: Float64Array, Te: number): number {
    const fs = FUEL_SPECIES[this.cfg.fuel];
    const Zz = meanCharge(this.cfg.impurity.species, Math.max(Te, 0.1));
    const main = y[IDX.na] * fs.a.Z + y[IDX.nb] * fs.b.Z + 2 * y[IDX.nHe] + Zz * y[IDX.nZ];
    return main / Math.max(1 - this.seedZ(Te) * this.seedC(), 0.5);
  }
  private ni(y: Float64Array, ne = 0): number {
    return y[IDX.na] + y[IDX.nb] + y[IDX.nHe] + y[IDX.nZ] + this.seedC() * ne;
  }
  private temps(y: Float64Array): { Te: number; Ti: number; ne: number; ni: number } {
    // ne, Te'ye zayıf bağlı (<Z>(Te)); bir iterasyon yeterli
    let Te = 1;
    let ne = this.ne(y, Te);
    Te = Math.max(U.J_to_keV(y[IDX.We] / (1.5 * ne * this.V)), 0.01);
    ne = this.ne(y, Te);
    Te = Math.max(U.J_to_keV(y[IDX.We] / (1.5 * ne * this.V)), 0.01);
    const ni = Math.max(this.ni(y, ne), 1e15);
    const Ti = Math.max(U.J_to_keV(y[IDX.Wi] / (1.5 * ni * this.V)), 0.01);
    return { Te, Ti, ne, ni };
  }
  private Zeff(y: Float64Array, ne: number, Te: number): number {
    const fs = FUEL_SPECIES[this.cfg.fuel];
    const Zz = meanCharge(this.cfg.impurity.species, Math.max(Te, 0.1));
    const Zs = this.seedZ(Te);
    return (y[IDX.na] * fs.a.Z ** 2 + y[IDX.nb] * fs.b.Z ** 2 + 4 * y[IDX.nHe] + Zz * Zz * y[IDX.nZ] + Zs * Zs * this.seedC() * ne) / ne;
  }
  /** eksen sıcaklığı: <nT>/<n> = T0 (1+αn)/(1+αn+αT) */
  private peakT(Tavg: number): number {
    const { alpha_n: an, alpha_T: aT } = this.cfg.transport;
    return (Tavg * (1 + an + aT)) / (1 + an);
  }
  private nTarget(t: number): number {
    const n0 = 0.3 * this.ctrl.n_target_1e20 * 1e20;
    const nt = this.ctrl.n_target_1e20 * 1e20;
    const f = Math.min(1, t / Math.max(this.cfg.n_rampTime, 0.01));
    return n0 + (nt - n0) * f;
  }
  private auxRamp(t: number): number {
    return Math.min(1, t / Math.max(this.cfg.heating.rampTime, 0.01));
  }

  /** Füzyon hızı (profil-integre): reaksiyon/s, güçler */
  private fusion(y: Float64Array, Ti: number) {
    const { alpha_n: an, alpha_T: aT } = this.cfg.transport;
    const T0 = this.peakT(Ti);
    const na = y[IDX.na], nb = y[IDX.nb];
    const chans = FUEL_CHANNELS[this.cfg.fuel];
    let rate = 0, P_charged = 0, P_neutron = 0, P_total = 0, neutrons = 0;
    for (const ch of chans) {
      // ∫ n_a n_b <σv>(T(ρ)) dV = V (1+αn)² ∫ (1−ρ²)^{2αn} σv(T0 (1−ρ²)^αT) 2ρ dρ
      const I = profileIntegral((rho) => {
        const s = 1 - rho * rho;
        return Math.pow(s, 2 * an) * ch.sigmav(T0 * Math.pow(s, aT));
      });
      let R = (ch.sameSpecies ? 0.5 * na * na : na * nb) * (1 + an) * (1 + an) * I * this.V; // reaksiyon/s
      rate += R;
      P_total += R * U.MeV_to_J(ch.Etot_MeV);
      P_charged += R * U.MeV_to_J(ch.Echarged_MeV);
      P_neutron += R * U.MeV_to_J(ch.Eneutron_MeV);
      if (ch.Eneutron_MeV > 0) neutrons += R;
    }
    return { rate, P_total, P_charged, P_neutron, neutrons, T0, P_bt: 0 };
  }

  private radiation(y: Float64Array, Te: number, ne: number, Zeff: number) {
    const { alpha_n: an, alpha_T: aT } = this.cfg.transport;
    const Te0 = this.peakT(Te);
    const fs = FUEL_SPECIES[this.cfg.fuel];
    // Brems: ana iyonlar + He (safsızlığın brems'i Mavrin L_z içinde)
    const Zeff_main = (y[IDX.na] * fs.a.Z ** 2 + y[IDX.nb] * fs.b.Z ** 2 + 4 * y[IDX.nHe]) / ne;
    const Ibr = profileIntegral((rho) => {
      const s = 1 - rho * rho;
      return Math.pow(s, 2 * an) * bremsstrahlung(1, Te0 * Math.pow(s, aT), Zeff_main);
    });
    const P_brems = ne * ne * (1 + an) * (1 + an) * Ibr * this.V;
    const Iline = profileIntegral((rho) => {
      const s = 1 - rho * rho;
      return Math.pow(s, 2 * an) * coolingRate(this.cfg.impurity.species, Te0 * Math.pow(s, aT));
    });
    let P_line = ne * y[IDX.nZ] * (1 + an) * (1 + an) * Iline * this.V;
    const im = this.cfg.impurity;
    if (im.seedSpecies && im.seedConcentration) {
      const Iseed = profileIntegral((rho) => {
        const s = 1 - rho * rho;
        return Math.pow(s, 2 * an) * coolingRate(im.seedSpecies!, Te0 * Math.pow(s, aT));
      });
      P_line += ne * ne * im.seedConcentration * (1 + an) * (1 + an) * Iseed * this.V;
    }
    const P_sync = synchrotronTotal({
      R: this.g.R, a: this.g.a, kappa: this.g.kappa, B0: this.cfg.B0,
      ne0_1e20: (ne * (1 + an)) / 1e20, Te0_keV: Te0, alpha_n: an, alpha_T: aT,
      wallReflectivity: this.cfg.impurity.wallReflectivity,
    });
    return { P_brems, P_line, P_sync, P_rad: P_brems + P_line + P_sync };
  }

  private tauE(ne: number, P_loss: number, hmode: boolean): number {
    const c = this.cfg;
    if (this.isStell) return tauISS04(this.g, c.B0, ne, P_loss, c.stellarator.iota23, c.stellarator.f_ren) * this.ctrl.H98;
    const Ip = Math.max(this.Ip0 / 1e6, 0.05);
    if (hmode) {
      const base = c.scaling === 'ST_Valovic' ? tauSTValovic(this.g, Ip, c.B0, ne, P_loss, this.M) : tauIPB98y2(this.g, Ip, c.B0, ne, P_loss, this.M);
      return this.ctrl.H98 * base;
    }
    return c.H89 * tauITER89P(this.g, Ip, c.B0, ne, P_loss, this.M);
  }

  // ---------- SimModel ----------
  initialState(): Float64Array {
    const y = new Float64Array(NSTATE);
    const c = this.cfg;
    const n0 = 0.3 * c.n_target;
    const fs = FUEL_SPECIES[c.fuel];
    y[IDX.na] = n0 * c.fuelFracA / (c.fuelFracA * fs.a.Z + (1 - c.fuelFracA) * fs.b.Z);
    y[IDX.nb] = n0 * (1 - c.fuelFracA) / (c.fuelFracA * fs.a.Z + (1 - c.fuelFracA) * fs.b.Z);
    y[IDX.nHe] = 0;
    y[IDX.nZ] = c.impurity.concentration * n0;
    const T0 = this.isStell ? 0.5 : 1.0; // ohmik başlangıç plazması ~1 keV
    y[IDX.We] = 1.5 * n0 * U.keV_to_J(T0) * this.V;
    y[IDX.Wi] = 1.5 * this.ni(y, n0) * U.keV_to_J(T0 * 0.8) * this.V;
    y[IDX.Wf] = 0;
    y[IDX.Ip] = this.Ip0;
    y[IDX.Sfuel] = 0;
    return y;
  }

  rhs(t: number, y: Float64Array, d: Float64Array): void {
    d.fill(0);
    const c = this.cfg;
    const { Te, Ti, ne, ni } = this.temps(y);
    const Zeff = this.Zeff(y, ne, Te);
    const fs = FUEL_SPECIES[c.fuel];
    const V = this.V;

    // ---- füzyon ----
    const fus = this.fusion(y, Ti);
    // ---- radyasyon ----
    const rad = this.radiation(y, Te, ne, Zeff);
    // ---- yardımcı ısıtma ----
    const ramp = this.auxRamp(t);
    const quenchFac = this.phase === 'normal' ? 1 : 0; // disruption'da ısıtma kesilir
    const P_NBI_inj = this.ctrl.P_NBI_MW * 1e6 * ramp * quenchFac;
    const shine = nbiShineThrough(ne, this.g.a, c.heating.E_NBI_keV);
    const P_NBI = P_NBI_inj * (1 - shine);
    const P_ICRH = this.ctrl.P_ICRH_MW * 1e6 * ramp * quenchFac;
    const P_ECRH = this.ctrl.P_ECRH_MW * 1e6 * ramp * quenchFac;
    // Stix kritik enerji: Σ n_j Z_j²/(n_e A_j)
    const ionSum = (y[IDX.na] * fs.a.Z ** 2 / fs.a.A + y[IDX.nb] * fs.b.Z ** 2 / fs.b.A + y[IDX.nHe] * 4 / 4) / ne;
    // NBI hızlı iyonları: enerji W_f havuzuna girer, oradan yavaşlayarak paylaşılır
    const Ec_nbi = criticalEnergy(Te, fs.a.A, ionSum);
    const fi_nbi = ionHeatingFraction(c.heating.E_NBI_keV, Ec_nbi);
    // Demet-hedef füzyonu: n_f = P_NBI τ_sd / (E_b V) (yarı-kararlı), R_bt = n_f n_hedef <σv>_bt V
    // (JET DTE2'de füzyon gücünün ~%30–50'si demet-hedef kaynaklıdır; Maslov 2023)
    if (P_NBI > 0 && c.fuel !== 'pB11') {
      const tau_sd_nbi = slowingDownTime(Te, ne, fs.a.A, fs.a.Z, c.heating.E_NBI_keV, Ec_nbi);
      const n_f = (P_NBI * tau_sd_nbi) / (U.keV_to_J(c.heating.E_NBI_keV) * V);
      const sv = beamTargetReactivity(c.fuel, c.heating.E_NBI_keV, Ec_nbi, Ti);
      FUEL_CHANNELS[c.fuel].forEach((ch, j) => {
        const nTarget = ch.sameSpecies ? y[IDX.na] : y[IDX.nb];
        const R = n_f * nTarget * sv[j] * V;
        fus.rate += R; fus.P_total += R * U.MeV_to_J(ch.Etot_MeV); fus.P_bt += R * U.MeV_to_J(ch.Etot_MeV); fus.P_charged += R * U.MeV_to_J(ch.Echarged_MeV);
        fus.P_neutron += R * U.MeV_to_J(ch.Eneutron_MeV); if (ch.Eneutron_MeV > 0) fus.neutrons += R;
      });
    }
    // Alfa (yüklü ürün) — E_α = 3.5 MeV (D-T); diğer yakıtlarda ortalama yüklü ürün enerjisi
    const chans = FUEL_CHANNELS[c.fuel];
    const E_alpha_keV = (chans[0].Echarged_MeV * 1000) / (c.fuel === 'pB11' ? 3 : 1);
    const Ec_a = criticalEnergy(Te, 4, ionSum);
    const fi_a = ionHeatingFraction(E_alpha_keV, Ec_a);
    const tau_sd = Math.max(slowingDownTime(Te, ne, 4, 2, E_alpha_keV, Ec_a), 1e-3);
    // Hızlı iyon havuzu: giriş = P_charged + P_NBI ; çıkış = W_f/τ_sd (ısıtma). Kayıp: hızlı iyon
    // hapsetmesi mükemmel varsayılır (APPROXIMATION: ripple/TAE kaybı yok)
    const P_fast_out = y[IDX.Wf] / tau_sd;
    const fracNBI = P_NBI / Math.max(P_NBI + fus.P_charged, 1);
    const fi_mix = fracNBI * fi_nbi + (1 - fracNBI) * fi_a;
    const P_fast_i = P_fast_out * fi_mix;
    const P_fast_e = P_fast_out * (1 - fi_mix);
    // ICRH/ECRH doğrudan
    const P_aux_i = P_ICRH * c.heating.f_ICRH_ion;
    const P_aux_e = P_ICRH * (1 - c.heating.f_ICRH_ion) + P_ECRH;
    // ---- ohmik ----
    let P_oh = 0;
    if (!this.isStell && y[IDX.Ip] > 0) {
      const eta = resistivity(Te, Zeff, ne, this.eps);
      P_oh = ohmicPower(y[IDX.Ip], this.A, V, eta);
    }
    // ---- toplam ısıtma ve τ_E ----
    const P_heat = P_oh + P_aux_i + P_aux_e + P_fast_out; // plazmaya biriken toplam
    const P_loss_scaling = Math.max(P_heat - rad.P_rad, 0.1 * P_heat, 0.5e6 * (V / 100));
    let tauE = this.tauE(ne, P_loss_scaling, this.hmode);
    if (this.ntm) tauE *= this.ntmFactor(y, ne, Te, Ti);
    tauE = Math.max(tauE, 1e-3);
    this.tauE_last = tauE;
    const W = y[IDX.We] + y[IDX.Wi];
    // ELM ortalama gücü zaten IPB98 içinde: sürekli kayıptan düş
    const P_cond_total = Math.max(W / tauE - this.elmAvgPower, 0);
    const P_cond_e = P_cond_total * (y[IDX.We] / Math.max(W, 1));
    const P_cond_i = P_cond_total * (y[IDX.Wi] / Math.max(W, 1));
    // ---- e-i eşitlenme ----
    const tau_eq = tauEquilibration(ne, Te, this.M, 1) * (ne / ni); // Z_eff ağırlığı Zeff_main ile yaklaşık
    const P_ei = (1.5 * ne * U.keV_to_J(Te - Ti) * V) / tau_eq;

    // ---- disruption fazları ----
    let quenchE = 0, quenchI = 0, dIp = 0;
    if (this.phase === 'thermal_quench') {
      const tauTQ = this.tqTime() * 1e-3;
      quenchE = y[IDX.We] / tauTQ * 3; quenchI = y[IDX.Wi] / tauTQ * 3;
    } else if (this.phase === 'current_quench') {
      const tauCQ = 4.0 * this.A * 1e-3; // ms→s ; τ_CQ/S = 4 ms/m²
      dIp = -y[IDX.Ip] / tauCQ;
      quenchE = y[IDX.We] / 1e-3; quenchI = y[IDX.Wi] / 1e-3;
    }

    d[IDX.We] = P_oh + P_aux_e + P_fast_e - rad.P_rad - P_ei - P_cond_e - quenchE;
    d[IDX.Wi] = P_aux_i + P_fast_i + P_ei - P_cond_i - quenchI;
    d[IDX.Wf] = fus.P_charged + P_NBI - P_fast_out - (this.phase !== 'normal' ? y[IDX.Wf] / 1e-3 : 0);
    d[IDX.Ip] = dIp;

    // ---- parçacık dengesi ----
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauE, 1e-3);
    const tau_He = Math.max(c.transport.tau_He_over_tau_E * tauE, 1e-3);
    // ELM/sawtooth parçacık atımı τ_p ve τ_He'nin (zaman-ortalamalı) PARÇASIdır: sürekli kaybı o kadar azalt
    const lossP = Math.max(1 / tau_p - this.elmPartRate, 0.3 / tau_p);
    const lossHe = Math.max(1 / tau_He - this.elmPartRate, 0.3 / tau_He);
    // yanma: her reaksiyon 1 a + 1 b tüketir (DD: 2 D)
    const burn_a = fus.rate * (FUEL_CHANNELS[c.fuel][0].sameSpecies ? 2 : 1) / V;
    const burn_b = FUEL_CHANNELS[c.fuel][0].sameSpecies ? 0 : fus.rate / V;
    // Besleme komutu: yoğunluk kontrolörü (P) + kayıp/yanma telafisi, sınırlı
    const nT = this.nTarget(t);
    const Smax = this.ctrl.fuelRate_1e20s * 1e20 / V; // m^-3 s^-1
    const fuelEff = this.fuelingEfficiency();
    let S_cmd = 0;
    if (this.phase === 'normal') {
      const kp = 6 / Math.max(tau_p, 0.05);
      S_cmd = Math.max(0, Math.min(Smax, (kp * (nT - ne) + ne * lossP + burn_a + burn_b) / fuelEff));
    }
    const tauDelay = this.fuelingDelay();
    d[IDX.Sfuel] = (S_cmd - y[IDX.Sfuel]) / tauDelay;
    const S_eff = y[IDX.Sfuel] * fuelEff; // m^-3 s^-1 (elektron eşdeğeri)
    // NBI beslemesi: sadece tür a (D). Karışım kontrolü: gaz/pellet varsa oranı hedefe çeker.
    const S_nbi = c.fueling.method === 'nbi' || c.fueling.method === 'mixed' ? P_NBI_inj / U.keV_to_J(c.heating.E_NBI_keV) / V : 0;
    const wA = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
    const S_a = S_eff * wA + S_nbi;
    const S_b = S_eff * (1 - wA);
    d[IDX.na] = S_a - y[IDX.na] * lossP - burn_a;
    d[IDX.nb] = S_b - y[IDX.nb] * lossP - burn_b;
    // kül: D-T → He4 ; D-D → He3+T (basitleştirme: yarısı kül gibi davranır); D-He3 → He4; pB11 → 3 He4
    const ashPerRx = c.fuel === 'pB11' ? 3 : c.fuel === 'DD' ? 0.5 : 1;
    d[IDX.nHe] = (fus.rate * ashPerRx) / V - y[IDX.nHe] * lossHe;
    // safsızlık: hedef konsantrasyona gevşeme + W kaynağı (P_SOL ile sıçratma) ; W birikimi çarpanı
    const cZ_target = this.ctrl.cZ;
    const tauZ = tau_p * this.tauW_accum;
    const P_SOL = Math.max(P_heat - rad.P_rad, 0);
    const S_W = c.impurity.species === 'W' ? (c.impurity.W_source_frac * P_SOL) / (U.keV_to_J(5000) * V) : 0; // 5 keV başına 1 W atomu·frac
    d[IDX.nZ] = (cZ_target * ne) / tau_p - y[IDX.nZ] * Math.max(1 / tauZ - 2 * this.elmPartRate, 0.3 / tauZ) + S_W;
    if (this.phase !== 'normal') { d[IDX.na] = -y[IDX.na] / 0.05; d[IDX.nb] = -y[IDX.nb] / 0.05; d[IDX.nHe] = -y[IDX.nHe] / 0.05; d[IDX.nZ] = 0; d[IDX.Sfuel] = -y[IDX.Sfuel] / 0.01; }

    // ---- sayaçlar ----
    d[IDX.Efus] = fus.P_total;
    d[IDX.Ein] = P_NBI_inj + P_ICRH + P_ECRH + P_oh;
    d[IDX.Nn] = fus.neutrons;
    if (c.fuel === 'DT') { d[IDX.NTburn] = fus.rate; d[IDX.NTfuel] = S_b * V; }

    // teşhis için sakla (diagnostics() aynı hesabı tekrar etmesin)
    this.lastDiag = {
      Te, Ti, ne, ni, Zeff, P_fus: fus.P_total, P_bt: fus.P_bt, P_charged: fus.P_charged, P_neutron: fus.P_neutron, T0: fus.T0,
      P_brems: rad.P_brems, P_line: rad.P_line, P_sync: rad.P_sync, P_rad: rad.P_rad,
      P_NBI: P_NBI_inj, P_ICRH, P_ECRH, P_oh, P_fast_out, P_heat, P_cond: P_cond_total, tauE, P_SOL, S_fuel: y[IDX.Sfuel] * V,
      P_aux_abs: P_NBI + P_ICRH + P_ECRH,
    };
  }

  private fuelingEfficiency(): number {
    // APPROXIMATION: gaz püskürtme kenar besleme verimi ~0.3 (SOL taraması), pellet ~0.9 (derinliğe bağlı), NBI 1
    switch (this.cfg.fueling.method) {
      case 'gas': return 0.3;
      case 'pellet': return 0.5 + 0.45 * Math.min(1, this.cfg.fueling.pelletDepth);
      case 'nbi': return 1.0;
      default: return 0.6;
    }
  }
  private fuelingDelay(): number {
    switch (this.cfg.fueling.method) {
      case 'gas': return 0.25; // gaz akışı + iyonizasyon gecikmesi
      case 'pellet': return 0.03;
      case 'nbi': return 0.05;
      default: return 0.12;
    }
  }
  private tqTime(): number {
    return 1.0 * (this.g.a / 2.0) * (1 + 0.5 * Math.log(1 + this.Ip0 / 5e6));
  }
  /** NTM ile hapsetme bozunumu: Δτ/τ ≈ −(w/a)·k ; doymuş ada w/a ∝ β_p (APPROXIMATION, Sauter 1997 eğilimi) */
  private ntmFactor(y: Float64Array, ne: number, Te: number, Ti: number): number {
    const p = ne * U.keV_to_J(Te) + this.ni(y) * U.keV_to_J(Ti);
    const bp = betaPoloidal(p, Math.max(y[IDX.Ip], 1), this.g.a, this.g.kappa);
    return Math.max(0.7, 1 - 0.25 * Math.min(bp, 1.2));
  }

  diagnostics(t: number, y: Float64Array): Record<string, number> {
    const L = this.lastDiag;
    if (!L.Te) this.rhs(t, y, new Float64Array(NSTATE));
    const D = this.lastDiag;
    const c = this.cfg;
    const W = y[IDX.We] + y[IDX.Wi];
    const p = D.ne * U.keV_to_J(D.Te) + D.ni * U.keV_to_J(D.Ti); // <nT> hacim ort. basınç (J/m³)
    const Ip_MA = y[IDX.Ip] / 1e6;
    const bT = betaToroidal(p, c.B0);
    const bN = this.isStell ? 0 : betaNormalized(bT, this.g.a, c.B0, Math.max(Ip_MA, 0.01));
    const P_in = D.P_aux_abs + D.P_oh;
    const Q = D.P_fus / Math.max(P_in, 1e4);
    const triple = D.ne * D.Ti * D.tauE;
    const nG = this.isStell ? this.sudoLimit(D) : greenwaldDensity(Math.max(Ip_MA, 0.01), this.g.a);
    const P_LH = this.isStell ? 0 : pLH_Martin(D.ne, c.B0, this.S, this.M);
    let q_div = 0;
    if (this.isStell) q_div = divertorHeatFluxStellarator(this.g, c.B0, c.stellarator.iota23, D.P_SOL, c.divertor.f_rad_div);
    else q_div = divertorHeatFlux(this.g, Math.max(y[IDX.Ip], 1e5), D.P_SOL, c.divertor.f_rad_div, c.divertor.flux_expansion).q_div_MWm2;
    const nw = neutronWallLoad(this.g, D.P_neutron, 1).load_MWm2;
    const na = y[IDX.na], nb = y[IDX.nb];
    return {
      Ti: D.Ti, Te: D.Te, Ti0: D.T0, ne: D.ne / 1e20, nG_frac: D.ne / nG, fHe: y[IDX.nHe] / D.ne,
      P_fus: D.P_fus / 1e6, P_bt: D.P_bt / 1e6, P_alpha: D.P_fast_out / 1e6, P_aux: (D.P_NBI + D.P_ICRH + D.P_ECRH) / 1e6, P_oh: D.P_oh / 1e6,
      P_brems: D.P_brems / 1e6, P_sync: D.P_sync / 1e6, P_line: D.P_line / 1e6, P_rad: D.P_rad / 1e6, P_cond: D.P_cond / 1e6,
      Q, tauE: D.tauE, H_mode: this.hmode ? 1 : 0, P_LH: P_LH / 1e6,
      betaN: bN, betaT: bT * 100, q95: this.isStell ? 0 : q95fn(this.g, c.B0, Math.max(Ip_MA, 0.01)), NTM: this.ntm ? 1 : 0,
      W: W / 1e6, Wf: y[IDX.Wf] / 1e6, triple, lawson: triple / LAWSON_DT,
      Zeff: D.Zeff, cZ: y[IDX.nZ] / D.ne, Ip: Ip_MA, S_fuel: D.S_fuel / 1e20,
      burnFrac: y[IDX.NTfuel] > 0 ? y[IDX.NTburn] / y[IDX.NTfuel] : 0,
      q_div, n_wall: nw, fuelFracA: na / Math.max(na + nb, 1),
      P_heat: D.P_heat / 1e6, P_charged: D.P_charged / 1e6, P_neutron: D.P_neutron / 1e6,
      Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
    };
  }

  /** Stellarator yoğunluk limiti — Sudo et al., Nucl. Fusion 30 (1990) 11:
   *  n_Sudo [10^20 m^-3] = 0.25 · sqrt(P[MW] B / (a² R)) */
  private sudoLimit(D: Record<string, number>): number {
    // Rampa sırasında sahte limit vermesin: taban = kurulu yardımcı gücün yarısı (APPROXIMATION)
    const c = this.cfg.heating;
    const P = Math.max(D.P_heat / 1e6, 0.5 * (c.P_NBI_MW + c.P_ICRH_MW + c.P_ECRH_MW), 0.1);
    return 0.25 * Math.sqrt((P * this.cfg.B0) / (this.g.a * this.g.a * this.g.R)) * 1e20;
  }

  postStep(t: number, dt: number, y: Float64Array): SimEvent[] {
    const ev: SimEvent[] = [];
    if (this.terminated) return ev;
    const c = this.cfg;
    const dg = this.diagnostics(t, y);
    const W = y[IDX.We] + y[IDX.Wi];

    if (this.phase === 'normal') {
      // ---- L-H geçişi (Martin eşiği, histerezis 0.7) ----
      if (!this.isStell) {
        const P_L = dg.P_heat; // P_heat − dW/dt ≈ P_heat (APPROXIMATION)
        if (!this.hmode && P_L > dg.P_LH && t > 0.05) {
          this.hmode = true; ev.push({ t, kind: 'LH', msg: `L→H transition: P_heat ${P_L.toFixed(1)} MW > P_LH ${dg.P_LH.toFixed(1)} MW` });
          this.tNextELM = t + 0.05;
        } else if (this.hmode && P_L < 0.7 * dg.P_LH) {
          this.hmode = false; ev.push({ t, kind: 'HL', msg: `H→L back-transition: P_heat ${P_L.toFixed(1)} MW < 0.7·P_LH ${(0.7 * dg.P_LH).toFixed(1)} MW — τ_E collapsed` });
          this.tNextELM = Infinity; this.elmAvgPower = 0; this.elmPartRate = 0;
        }
      }
      // ---- ELM'ler (Type-I): ΔW ≈ 3% W (pedestal enerjisinin ~%10'u), f_ELM = 0.3 P_heat/ΔW ----
      if (this.hmode && c.events.elms && !this.isStell) {
        this.elmDW = 0.03 * W;
        const f = (0.3 * dg.P_heat * 1e6) / Math.max(this.elmDW, 1e5);
        this.elmAvgPower = 0.3 * dg.P_heat * 1e6;
        this.elmPartRate = f * 0.03 * 0.3; // ortalama kesirli parçacık atım hızı
        if (t >= this.tNextELM) {
          const frac = 0.03 * (0.7 + 0.6 * this.rng.next());
          y[IDX.We] *= 1 - frac; y[IDX.Wi] *= 1 - frac;
          // ELM parçacık da atar (~%1 n; pedestal yoğunluğunun birkaç %'i — Loarte 2003)
          y[IDX.na] *= 1 - frac * 0.3; y[IDX.nb] *= 1 - frac * 0.3; y[IDX.nZ] *= 1 - frac * 0.6; y[IDX.nHe] *= 1 - frac * 0.3;
          ev.push({ t, kind: 'ELM', msg: `Type-I ELM: ΔW = ${(frac * W / 1e6).toFixed(2)} MJ`, value: frac * W / 1e6 });
          this.tNextELM = t + (1 / f) * (0.7 + 0.6 * this.rng.next());
        }
      } else { this.elmAvgPower = 0; this.elmPartRate = 0; }
      // ---- Testere dişi (sawtooth): τ_st ≈ 0.6 τ_E ; merkez T düşer, 0D'de ~%2 W dışa taşınır ----
      if (c.events.sawteeth && !this.isStell && t >= this.tNextSaw) {
        const drop = 0.02 * (0.8 + 0.4 * this.rng.next());
        y[IDX.We] *= 1 - drop; y[IDX.Wi] *= 1 - drop;
        // kül ve safsızlığı merkezden karıştırır → kaybı artırır
        y[IDX.nHe] *= 0.97; y[IDX.nZ] *= 0.97;
        ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash: ΔW ≈ ${(drop * 100).toFixed(1)}%`, value: drop });
        this.tNextSaw = t + Math.max(0.05, 0.6 * this.tauE_last * (0.8 + 0.4 * this.rng.next()));
        // NTM tohumu: β_N > β_onset ise sawtooth NTM tetikler (Sauter 2002: β_N,onset ~ 2 ITER'de)
        if (c.events.ntm && !this.ntm && dg.betaN > 0.7 * c.limits.betaN_limit) {
          this.ntm = true; ev.push({ t, kind: 'NTM_onset', msg: `Sawtooth-seeded NTM (3/2) started: β_N = ${dg.betaN.toFixed(2)} — τ_E is degrading` });
        }
      }
      if (this.ntm && dg.betaN < 0.5 * c.limits.betaN_limit) {
        this.ntm = false; ev.push({ t, kind: 'NTM_gone', msg: `NTM decayed: β_N ${dg.betaN.toFixed(2)} below the marginal threshold` });
      }
      // ---- W birikimi: ELM/sawtooth yoksa merkez birikimi (neoklasik pinch) ----
      this.tauW_accum = c.impurity.species === 'W' && (!c.events.elms || !c.events.sawteeth) ? 4 : 1;

      // ---- Ateşleme / yanma olayları ----
      const P_loss_total = dg.P_rad + dg.P_cond;
      // Ateşleme: alfa ısıtması tüm kayıpları karşılıyor VE dış ısıtma baskın değil (Q ≥ 5, aksi halde geçici W artışı yanıltır)
      // Histerezis (ELM titreşimi olay yağmuruna yol açmasın): giriş P_α ≥ P_kayıp, çıkış P_α < 0.9 P_kayıp
      const ignOn = dg.P_alpha >= P_loss_total && dg.P_fus > 1 && dg.Q >= 5;
      const ignOff = dg.P_alpha < 0.9 * P_loss_total || dg.Q < 4;
      if (ignOn && !this.ignited) { this.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${dg.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
      if (ignOff && this.ignited) { this.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
      if (dg.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: `Q ≥ 1 (scientific breakeven)` }); }
      if (dg.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }

      // ---- uyarılar ----
      if (dg.q_div > 10 && !this.warned.has('div')) { this.warned.add('div'); ev.push({ t, kind: 'warning', msg: `Divertor heat flux ${dg.q_div.toFixed(0)} MW/m² > 10 MW/m² — material lifetime at risk` }); }
      if (dg.nG_frac > 0.85 && !this.warned.has('nG')) { this.warned.add('nG'); ev.push({ t, kind: 'warning', msg: `n/n_G = ${dg.nG_frac.toFixed(2)} — approaching the density limit` }); }
      if (dg.betaN > 0.85 * c.limits.betaN_limit && !this.warned.has('bN')) { this.warned.add('bN'); ev.push({ t, kind: 'warning', msg: `β_N = ${dg.betaN.toFixed(2)} — approaching the Troyon limit` }); }

      // ---- LİMİT KONTROLLERİ → disruption ----
      let cause: DisruptionCause = 'none';
      let diag = '';
      if (!this.isStell) {
        if (dg.nG_frac > c.limits.greenwald_limit) { cause = 'density_limit'; diag = `n/n_G reached ${dg.nG_frac.toFixed(2)}`; }
        else if (dg.betaN > c.limits.betaN_limit) { cause = 'beta_limit'; diag = `β_N ${dg.betaN.toFixed(2)} > ${c.limits.betaN_limit}`; }
        else if (dg.q95 < c.limits.q95_limit) { cause = 'q95_limit'; diag = `q95 = ${dg.q95.toFixed(2)} < ${c.limits.q95_limit}`; }
        else if (dg.cZ > c.limits.W_conc_limit && c.impurity.species === 'W') { cause = 'tungsten_accumulation'; diag = `c_W = ${dg.cZ.toExponential(1)} > ${c.limits.W_conc_limit.toExponential(1)}`; }
        else if (dg.P_rad > dg.P_heat && t > 0.5 && dg.Te < 2) { cause = 'radiative_collapse'; diag = `P_rad ${dg.P_rad.toFixed(1)} MW > P_heat ${dg.P_heat.toFixed(1)} MW, T_e fell to ${dg.Te.toFixed(2)} keV`; }
      } else {
        // Stellarator: disruption yok; radyatif çöküş (Sudo limiti) plazmayı söndürür
        if (dg.nG_frac > 1.0 && dg.P_rad > dg.P_heat && t > 0.5 && dg.Te < 0.5) { cause = 'radiative_collapse'; diag = `n/n_Sudo = ${dg.nG_frac.toFixed(2)} and P_rad > P_heat — radiative collapse (soft extinction, not a disruption)`; }
      }
      if (cause !== 'none') {
        this.disruptCause = cause; this.tDisrupt = t; this.Wd = W;
        this.phase = this.isStell ? 'current_quench' : 'thermal_quench';
        this.elmAvgPower = 0; this.tNextELM = Infinity;
        ev.push({ t, kind: 'disruption', msg: `${this.isStell ? 'RADIATIVE COLLAPSE' : 'DISRUPTION'}: ${DISRUPTION_LABELS[cause]} — ${diag}` });
        this.diagText = diag;
      }
    } else if (this.phase === 'thermal_quench') {
      if (W < 0.02 * this.Wd || t - this.tDisrupt > 0.05) {
        this.phase = 'current_quench';
        ev.push({ t, kind: 'quench', msg: `Thermal quench complete (${((t - this.tDisrupt) * 1e3).toFixed(1)} ms) → current quench starting` });
      }
    } else if (this.phase === 'current_quench') {
      const done = this.isStell ? W < 0.02 * this.Wd || t - this.tDisrupt > 0.2 : y[IDX.Ip] < 0.03 * this.Ip0;
      if (done) {
        this.phase = 'ended';
        const rep = disruptionReport({ cause: this.disruptCause, t: this.tDisrupt, g: this.g, Ip_MA: this.Ip0 / 1e6, W_th_J: this.Wd, B0: c.B0 });
        this.terminated = {
          t, natural: false, reason: DISRUPTION_LABELS[this.disruptCause],
          diagnosis: `${DISRUPTION_LABELS[this.disruptCause]} — ${this.diagText}, t = ${this.tDisrupt.toFixed(2)} s. ${this.isStell ? '' : `Thermal quench ${rep.tau_TQ_ms.toFixed(1)} ms, current quench ${rep.tau_CQ_ms.toFixed(0)} ms; halo current I_h/I_p·TPF = ${rep.halo_TPF_product.toFixed(2)}; runaway electron avalanche e^${rep.runaway_avalanche_efolds.toFixed(0)} → ~${rep.runaway_current_MA.toFixed(1)} MA; wall deposition ${rep.wall_energy_density_MJm2.toFixed(1)} MJ/m².`}`,
          fix: DISRUPTION_FIXES[this.disruptCause],
          disruption: this.isStell ? undefined : rep,
        };
        ev.push({ t, kind: 'end', msg: 'Plasma extinguished' });
      }
    }
    if (!this.terminated && t >= this.tEnd - 1e-9) {
      this.phase = 'ended';
      this.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: `The shot completed the scheduled duration of ${this.tEnd} s without disruption.`, fix: '' };
      ev.push({ t, kind: 'end', msg: 'Scheduled end of shot' });
    }
    return ev;
  }
  private diagText = '';

  applyControl(patch: Record<string, number>): void {
    for (const k of Object.keys(patch)) if (k in this.ctrl) this.ctrl[k] = patch[k];
  }
  getControls(): Record<string, number> {
    return { ...this.ctrl };
  }
  saveInternal(): Record<string, number> {
    return {
      rng: this.rng.getState(), phase: ['normal', 'thermal_quench', 'current_quench', 'ended'].indexOf(this.phase),
      hmode: +this.hmode, ntm: +this.ntm, tNextELM: this.tNextELM, tNextSaw: this.tNextSaw, elmAvgPower: this.elmAvgPower, elmPartRate: this.elmPartRate,
      tauW_accum: this.tauW_accum, ignited: +this.ignited, burning: +this.burning, tauE_last: this.tauE_last,
    };
  }
  restoreInternal(s: Record<string, number>): void {
    this.rng.setState(s.rng);
    this.phase = (['normal', 'thermal_quench', 'current_quench', 'ended'] as Phase[])[s.phase] ?? 'normal';
    this.hmode = !!s.hmode; this.ntm = !!s.ntm; this.tNextELM = s.tNextELM; this.tNextSaw = s.tNextSaw;
    this.elmAvgPower = s.elmAvgPower; this.elmPartRate = s.elmPartRate ?? 0; this.tauW_accum = s.tauW_accum; this.ignited = !!s.ignited; this.burning = !!s.burning;
    this.tauE_last = s.tauE_last; this.terminated = null; this.warned.clear(); this.lastDiag = {};
  }
  geometryInfo(): Record<string, number> {
    const c = this.cfg;
    return { R: this.g.R, a: this.g.a, kappa: this.g.kappa, delta: this.g.delta, B0: c.B0, Ip_MA: c.Ip_MA, V: this.V, S: this.S, stellarator: +this.isStell, gap: c.magnet.gap_m, coilThickness: c.magnet.coilThickness_m, B_coil: this.magnetInfo.B_coil };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const c = this.cfg;
    const last = hist[hist.length - 1];
    const d = (k: string) => hist.map((h) => h.d[k] ?? 0);
    const max = (arr: number[]) => arr.reduce((m, v) => (v > m ? v : m), -Infinity);
    const Ti0 = d('Ti0'), Ti = d('Ti'), Te = d('Te'), Q = d('Q'), Pf = d('P_fus');
    const Tmax = max(Ti0);
    // süreler
    let burnTime = 0, ignTime = 0;
    for (let i = 1; i < hist.length; i++) {
      const dt = hist[i].t - hist[i - 1].t;
      if (hist[i].d.Q >= 1) burnTime += dt;
      if (hist[i].d.P_alpha >= hist[i].d.P_rad + hist[i].d.P_cond && hist[i].d.P_fus > 1 && hist[i].d.Q >= 5) ignTime += dt;
    }
    const term = this.terminated ?? { t: last.t, natural: true, reason: 'In progress', diagnosis: '', fix: '' };
    const stableTime = this.tDisrupt > 0 && !term.natural ? this.tDisrupt : last.t;
    const Efus = last.d.Efus_MJ, Ein = last.d.Ein_MJ;
    const Qavg = Ein > 0 ? Efus / Ein : 0;
    const triple = max(d('triple'));
    const lawsonRef = c.fuel === 'DT' ? LAWSON_DT : c.fuel === 'DHe3' ? 4e22 : c.fuel === 'DD' ? 1e23 : 1e24;
    // mühendislik (atış ortalaması, son %30)
    const i0 = Math.floor(hist.length * 0.7);
    const avg = (k: string) => { let s = 0, n = 0; for (let i = i0; i < hist.length; i++) { s += hist[i].d[k] ?? 0; n++; } return n ? s / n : 0; };
    const Pfus_avg = avg('P_fus'), Paux_avg = avg('P_aux') + avg('P_oh');
    const Pn_avg = avg('P_neutron');
    const nwl = neutronWallLoad(this.g, Pn_avg * 1e6, c.economics.availability);
    const tbr = tritiumBreedingRatio(c.blanket.type, c.blanket.li6_enrichment, c.blanket.coverage);
    const mag = this.magnetInfo;
    const P_recirc_other = 0.05 * Pfus_avg + 20 + (c.magnet.tech === 'Cu' ? 0.02 * mag.storedEnergy_GJ * 1e3 * 10 : 5); // pompalar/kriyo/bakır bobin direnci (APPROXIMATION)
    const eco = economics({
      V_core_m3: this.V, magnetCostRel: MAGNET_TECH[c.magnet.tech].cost_rel, P_fus_MW: Pfus_avg, P_aux_MW: Paux_avg, P_recirc_MW: P_recirc_other,
      thermalEff: c.economics.thermalEff, wallPlugEff: c.economics.wallPlugEff, availability: c.economics.availability,
      discountRate: c.economics.discountRate, lifetime_yr: c.economics.lifetime_yr, blanketGain: c.fuel === 'DT' ? 1.18 : 1.0,
      capitalOverride_MUSD: c.economics.capital_MUSD_override,
    });
    const warnings: string[] = [];
    if (tbr < 1.05 && c.fuel === 'DT') warnings.push(`TBR = ${tbr.toFixed(2)} < 1.05 — this reactor cannot breed its own tritium.`);
    if (max(d('q_div')) > 10) warnings.push(`Peak divertor heat flux ${max(d('q_div')).toFixed(0)} MW/m² > 10 MW/m² — target plates cannot withstand this; increase the divertor radiation fraction.`);
    if (mag.overstress) warnings.push(`TF coil stress ${mag.stress_MPa.toFixed(0)} MPa > ${mag.stress_limit} MPa limit.`);
    if (nwl.dpa_per_year > 20) warnings.push(`Neutron damage ${nwl.dpa_per_year.toFixed(0)} dpa/year — the first wall needs replacement within a few years.`);
    if (eco.P_net_MW < 0) warnings.push(`Negative net electricity (${eco.P_net_MW.toFixed(0)} MW): Q_eng < 1, the plant draws power from the grid.`);
    // skor
    const scoreBreakdown = [
      { label: 'Q_scientific (max)', value: max(Q), ref: 10, unit: '', note: 'ITER target Q=10' },
      { label: 'Fusion energy', value: Efus, ref: 59, unit: 'MJ', note: 'JET DTE2 record 59 MJ (2021)' },
      { label: 'Triple product', value: triple, ref: lawsonRef, unit: 'keV s m⁻³', note: 'Ignition ≈ 3e21' },
      { label: 'Stable time', value: stableTime, ref: c.t_end, unit: 's', note: 'Scheduled duration' },
      { label: 'Temperature', value: Tmax, ref: 20, unit: 'keV', note: 'ITER axis ~20 keV' },
    ];
    let score = 0;
    for (const s of scoreBreakdown) score += 20 * Math.min(1, s.value / s.ref);
    if (!term.natural && !this.isStell) score *= 0.7;
    const historical = [
      { label: 'JET DTE2 (2021): 59 MJ', ratio: Efus / 59, note: 'fusion energy' },
      { label: 'JET 1997: P_fus 16.1 MW', ratio: max(Pf) / 16.1, note: 'peak fusion power' },
      { label: 'JT-60U (1996): nTτ 1.5e21', ratio: triple / 1.53e21, note: 'triple product (D-D equivalent)' },
      { label: 'ITER target: Q=10, 500 MW', ratio: max(Q) / 10, note: 'Q' },
      { label: 'NIF 2022: 3.15 MJ', ratio: Efus / 3.15, note: 'fusion energy per shot' },
    ];
    return {
      method: this.method, duration: last.t, timeUnit: 's',
      Tmax_keV: Tmax, Tmax_MC: U.keV_to_MC(Tmax), Timax_keV: max(Ti), Temax_keV: max(Te),
      stableTime_s: stableTime, burnTime_s: burnTime, ignitionTime_s: ignTime,
      stableDefinition: 'Stable time = duration for which the plasma is sustained without disruption/extinction. Burn time = duration with Q ≥ 1 (P_fusion ≥ P_auxiliary+P_ohmic). Ignition time = duration with P_alpha ≥ P_rad + P_conduction (self-sustaining without external heating).',
      Q_sci_max: max(Q), Q_sci_avg: Qavg, Q_eng: eco.Q_eng,
      Q_eng_note: `Q_eng = P_electric,gross / P_recirculating = (${eco.P_gross_MW.toFixed(0)} MW) / (${eco.P_recirc_MW.toFixed(0)} MW). Scientific Q is measured at the plasma boundary (P_fusion/P_heating,absorbed), Q_eng at the wall plug: heating wall-plug efficiency ${(c.economics.wallPlugEff * 100).toFixed(0)}%, thermal efficiency ${(c.economics.thermalEff * 100).toFixed(0)}%.`,
      E_fusion_MJ: Efus, E_input_MJ: Ein,
      neutronYield: last.d.Nn, neutronFluence_m2: last.d.Nn / nwl.S_wall,
      tripleProduct_max: triple, lawson_ratio: triple / lawsonRef,
      lawsonNote: `Reference (nTτ_E)_ignition ≈ ${lawsonRef.toExponential(1)} keV s m⁻³ (${c.fuel}); 1.0 = ignition threshold (profile effects neglected).`,
      termination: term, score: Math.round(score), scoreBreakdown, historical, warnings,
      engineering: {
        'B_coil (T)': +mag.B_coil.toFixed(2), 'Technology B_max (T)': mag.B_max, 'TF stress (MPa)': +mag.stress_MPa.toFixed(0), 'Stress limit (MPa)': mag.stress_limit,
        'Magnetic energy (GJ)': +mag.storedEnergy_GJ.toFixed(2),
        'Divertor q_max (MW/m²)': +max(d('q_div')).toFixed(1), 'Neutron wall load (MW/m²)': +nwl.load_MWm2.toFixed(2), 'dpa/year': +nwl.dpa_per_year.toFixed(1),
        'TBR': +tbr.toFixed(3), 'Tritium burn fraction': +(last.d.burnFrac ?? 0).toFixed(3),
        'Avg. P_fusion (MW)': +Pfus_avg.toFixed(1), 'P_thermal (MW)': +eco.P_th_MW.toFixed(0), 'Gross P_electric (MW)': +eco.P_gross_MW.toFixed(0),
        'P_recirculating (MW)': +eco.P_recirc_MW.toFixed(0), 'Net P_electric (MW)': +eco.P_net_MW.toFixed(0),
        'Capital cost (M$)': +eco.Ccap_MUSD.toFixed(0), 'LCOE ($/MWh)': isFinite(eco.LCOE_USD_MWh) ? +eco.LCOE_USD_MWh.toFixed(0) : 'n/a (net<0)', 'EROI': +eco.EROI.toFixed(1),
      },
      extras: { 'He ash fraction (final)': +(last.d.fHe ?? 0).toFixed(3), 'Z_eff (final)': +(last.d.Zeff ?? 0).toFixed(2), 'ELM count': events.filter((e) => e.kind === 'ELM').length, 'Sawtooth count': events.filter((e) => e.kind === 'sawtooth').length },
    };
  }
}
