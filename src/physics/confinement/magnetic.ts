/**
 * ZERO-DIMENSIONAL MAGNETIC-CONFINEMENT MODEL — tokamak, spherical tokamak, stellarator.
 *
 * State vector y:
 *  0 W_e   [J]  electron thermal energy        1 W_i  [J] ion thermal energy
 *  2 n_a   [m^-3] fuel a (D)                   3 n_b  [m^-3] fuel b (T / D / He3 / B11)
 *  4 n_He  [m^-3] ash (He4)                     5 n_Z  [m^-3] impurity
 *  6 W_α   [J]  charged-fusion-product pool     7 I_p   [A]
 *  8 E_fus [J] total fusion energy              9 E_in  [J] total auxiliary + ohmic energy
 *  10 N_n  neutron number                       11 N_Tburn  burnt T atoms
 *  12 N_Tfuel  injected T atoms                 13 S_fuel [m^-3 s^-1] delayed fuelling (first-order lag)
 *  14 W_b  [J]  NBI fast-ion pool                  15 dW/dt [W] smoothed thermal-energy change (for P_L)
 *
 * Power balance (volume average, fixed profile shape):
 *  dW_e/dt = P_oh + P_aux,e + P_α,e + P_b,e − P_brems − P_sync − P_line − P_ei − W_e/τ_E
 *  dW_i/dt = P_aux,i + P_α,i + P_b,i + P_ei − W_i/τ_E
 *  dW_α/dt = P_charged − W_α/τ_W,α   dW_b/dt = P_NBI,abs − W_b/τ_W,b   (Stix slowing down, heating.ts)
 *  Each pool slows down with its own E_c, ion fraction G(E_0/E_c) and energy-content time τ_W;
 *  P_alpha = W_α/τ_W,α is the heating by the fusion products only, P_beam_heat = W_b/τ_W,b is a separate diagnostic.
 *  dn/dt   = S − n/τ_p − burn ;  dn_He/dt = R_fus − n_He/τ_He
 * APPROXIMATION: 0D. Profiles are fixed, n∝(1−ρ²)^αn, T∝(1−ρ²)^αT; pedestal, Shafranov shift,
 * turbulence and MHD enter only through the τ_E scaling and the threshold events (ELM/sawtooth/NTM/disruption).
 */
import { Geometry, plasmaVolume, plasmaSurface, crossSectionArea, q95ForMethod, profileIntegral, profileIntegralSplit } from '../geometry';
import { FUEL_CHANNELS, FUEL_SPECIES, beamTargetReactivity, beamTargetDensity, burnPerReaction, pairDensity } from '../reactivity';
import { bremsstrahlung, synchrotronTotal, coolingRate, meanCharge, RHO_CORE } from '../radiation';
import { tauIPB98y2, tauITER89P, tauISS04, tauSTValovic, pLH_threshold, equilibrationRate, stellaratorHISS04 } from '../transport';
import { resistivity, ohmicPower, criticalEnergy, ionHeatingFraction, slowingDownTime, nbiShineThrough, fastIonEnergyTime, fastPoolMix, FastSpecies } from '../heating';
import { greenwaldDensity, betaToroidal, betaNormalized, betaPoloidal, lineAverageFactor } from '../limits';
import { disruptionReport, DisruptionCause, DISRUPTION_LABELS, DISRUPTION_FIXES } from '../disruption';
import { checkMagnet, MAGNET_TECH, divertorHeatFlux, divertorHeatFluxStellarator, neutronWallLoad } from '../engineering';
import { buildMagneticReport, LAWSON_DT } from './magneticReport';
import { EDGE_DIAGS, edgeDiagnostics } from '../edge';
import { RNG } from '../rng';
import { U } from '../units';
import { IMPURITIES } from '../constants';
import { DiagSpec, HistoryFrame, MagneticConfig, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';


const IDX = { We: 0, Wi: 1, na: 2, nb: 3, nHe: 4, nZ: 5, Wa: 6, Ip: 7, Efus: 8, Ein: 9, Nn: 10, NTburn: 11, NTfuel: 12, Sfuel: 13, Wb: 14, dWs: 15 } as const;
const NSTATE = 16;
/** ELM-averaged share of the transport loss W/τ_E (Loarte et al. 2003: 20–40 % of P_SOL) */
const ELM_POWER_FRACTION = 0.3;
/** upper bound of the temperatures at which the rates are evaluated [keV] (see temps()) */
const T_EVAL_MAX_KEV = 1e4;

export { LAWSON_DT };

export const MAGNETIC_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T_i (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Te', label: 'T_e (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Ti0', label: 'T_i (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nbar', label: 'n̄_e (line avg.)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nG_frac', label: 'n̄/n_Greenwald', unit: '', group: 'Density' },
  { key: 'fHe', label: 'He ash fraction', unit: '', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_alpha (charged fusion products, deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_beam_heat', label: 'P_beam (NBI ions, deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_bt', label: 'P_fusion beam-target', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_auxiliary', unit: 'MW', group: 'Power' },
  { key: 'P_oh', label: 'P_ohmic', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_sync', label: 'P_synchrotron', unit: 'MW', group: 'Radiation' },
  { key: 'P_line', label: 'P_line', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad', label: 'P_rad total', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad_core', label: 'P_rad core (ρ < 0.6)', unit: 'MW', group: 'Radiation' },
  { key: 'P_cond', label: 'P_conduction (continuous, W/τ_E − ⟨P_ELM⟩)', unit: 'MW', group: 'Power' },
  { key: 'P_transport', label: 'P_transport (W/τ_E, incl. ELMs)', unit: 'MW', group: 'Power' },
  { key: 'P_ELM', label: 'P_ELM (ELM-averaged loss)', unit: 'MW', group: 'Power' },
  { key: 'P_ei', label: 'P_ei (electron → ion)', unit: 'MW', group: 'Power' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E', unit: 's', group: 'Confinement' },
  { key: 'H_mode', label: 'Mode (1=H, 0=L)', unit: '', group: 'Confinement' },
  { key: 'P_LH', label: 'P_LH threshold', unit: 'MW', group: 'Confinement' },
  { key: 'P_loss', label: 'P_L = P_heat − P_rad,core − dW/dt', unit: 'MW', group: 'Confinement' },
  { key: 'dWdt', label: 'dW/dt (smoothed)', unit: 'MW', group: 'Energy' },
  { key: 'betaN', label: 'β_N', unit: '', group: 'MHD' },
  { key: 'betaT', label: 'β_T', unit: '%', group: 'MHD' },
  { key: 'q95', label: 'q95', unit: '', group: 'MHD' },
  { key: 'NTM', label: 'NTM (0/1)', unit: '', group: 'MHD' },
  { key: 'W', label: 'W_plasma', unit: 'MJ', group: 'Energy' },
  { key: 'Wf', label: 'W_fast ions (α + beam)', unit: 'MJ', group: 'Energy' },
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
  ...EDGE_DIAGS,
];

type Phase = 'normal' | 'thermal_quench' | 'current_quench' | 'ended';

export class MagneticModel implements SimModel {
  readonly kind = 'magnetic' as const;
  readonly method: MagneticConfig['method'];
  readonly timeUnit = 's' as const;
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState = NSTATE;
  readonly diagSpecs: DiagSpec[];
  readonly integratorOpts;
  readonly dt0 = 1e-3;
  terminated: TerminationInfo | null = null;

  private cfg: MagneticConfig;
  private g: Geometry;
  /** n̄/⟨n⟩ (from the profile exponent α_n) */
  private fLine: number;
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
  /** heating.autoOff: the time at which the external heating starts to ramp down (Infinity = on) */
  private tAuxOff = Infinity;
  private warned = new Set<string>();
  private magnetInfo;
  /** reaction rate per channel [1/s] (thermal + beam-target), from the last rhs call */
  private Rch: Float64Array;
  /** charged products (in channel order) and the channel each belongs to; the P field is filled with the birth power in rhs */
  private products: FastSpecies[];
  private productChannel: number[];

  // canlı kontroller
  private ctrl: Record<string, number>;
  /** state components that cannot be negative (all but the signed, smoothed dW/dt) */
  private readonly nonNeg: number[];

  constructor(cfg: MagneticConfig) {
    this.cfg = cfg;
    this.method = cfg.method;
    this.g = cfg.geometry;
    this.isStell = cfg.method === 'stellarator';
    this.diagSpecs = this.isStell ? MAGNETIC_DIAGS.filter((s) => s.group !== 'Edge') : MAGNETIC_DIAGS; // no two-point SOL in a stellarator
    this.V = plasmaVolume(this.g);
    this.S = plasmaSurface(this.g);
    this.A = crossSectionArea(this.g);
    this.eps = this.g.a / this.g.R;
    this.fLine = lineAverageFactor(cfg.transport.alpha_n);
    const fs = FUEL_SPECIES[cfg.fuel];
    this.M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    this.rng = new RNG(cfg.seed);
    this.Rch = new Float64Array(FUEL_CHANNELS[cfg.fuel].length);
    this.products = []; this.productChannel = [];
    FUEL_CHANNELS[cfg.fuel].forEach((ch, j) => ch.products.forEach((pr) => {
      this.products.push({ A: pr.A, Z: pr.Z, E0_keV: pr.E_MeV * 1000, P: 0 }); this.productChannel.push(j);
    }));
    this.tEnd = cfg.t_end;
    this.outputDt = Math.max(cfg.t_end / 1500, 0.002);
    this.Ip0 = this.isStell ? 0 : cfg.Ip_MA * 1e6;
    // live confinement multiplier: tokamak → H98 (IPB98/ST), stellarator → H_ISS04 (ISS04)
    const conf: Record<string, number> = this.isStell ? { H_ISS04: stellaratorHISS04(cfg.stellarator, cfg.H98) } : { H98: cfg.H98 };
    this.ctrl = {
      P_NBI_MW: cfg.heating.P_NBI_MW, P_ICRH_MW: cfg.heating.P_ICRH_MW, P_ECRH_MW: cfg.heating.P_ECRH_MW,
      n_target_1e20: cfg.n_target / 1e20, ...conf, cZ: cfg.impurity.concentration,
      fuelRate_1e20s: cfg.fueling.maxRate_1e20s,
    };
    const atol = new Float64Array(NSTATE);
    atol.set([1e2, 1e2, 1e13, 1e13, 1e12, 1e11, 1e2, 1e2, 1e3, 1e3, 1e12, 1e12, 1e12, 1e14, 1e2, 1e3]);
    // dW/dt is signed: it is not clamped
    const nonNeg = Array.from({ length: NSTATE }, (_, i) => i).filter((i) => i !== IDX.dWs);
    this.nonNeg = nonNeg;
    this.integratorOpts = { rtol: 2e-5, atol, dtMin: 1e-6, dtMax: Math.min(0.05, cfg.t_end / 400), nonNegative: nonNeg };
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
  /** Type-I ELMs in progress: H-mode, ELMs enabled, a tokamak, before any disruption. */
  private elmsActive(): boolean {
    return this.phase === 'normal' && this.hmode && this.cfg.events.elms && !this.isStell;
  }
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
  /**
   * Volume-averaged temperatures and densities of a state, with T bounded to [0.01, T_EVAL_MAX_KEV].
   * The upper bound never binds on an accepted state; it keeps the rates finite on the trial stages
   * of a stiff step (e.g. the first step into a thermal quench, where a stage can reach W ~ 1e100 J
   * and P_sync ∝ T^2 overflows), so that the step-size control rejects the step instead of meeting a
   * non-finite error norm.
   */
  private temps(y: Float64Array): { Te: number; Ti: number; ne: number; ni: number } {
    const T = (W: number, n: number) => Math.min(Math.max(U.J_to_keV(W / (1.5 * n * this.V)), 0.01), T_EVAL_MAX_KEV);
    // n_e depends weakly on T_e (<Z>(T_e)); one iteration is enough
    let Te = 1;
    let ne = this.ne(y, Te);
    Te = T(y[IDX.We], ne);
    ne = this.ne(y, Te);
    Te = T(y[IDX.We], ne);
    const ni = Math.max(this.ni(y, ne), 1e15);
    const Ti = T(y[IDX.Wi], ni);
    return { Te, Ti, ne, ni };
  }
  /**
   * Σ_j n_j Z_j² / (n_e A_j) — all ions: fuel, He ash, impurity, seed. The Stix critical energy
   * (Stix 1972) and the e-i equilibration rate (NRL) use the same sum.
   */
  private ionSum(y: Float64Array, ne: number, Te: number): number {
    const fs = FUEL_SPECIES[this.cfg.fuel];
    const im = this.cfg.impurity;
    const Zz = meanCharge(im.species, Math.max(Te, 0.1));
    let s = (y[IDX.na] * fs.a.Z ** 2) / fs.a.A + (y[IDX.nb] * fs.b.Z ** 2) / fs.b.A + (y[IDX.nHe] * 4) / 4.001506 +
      (y[IDX.nZ] * Zz * Zz) / IMPURITIES[im.species].A;
    if (im.seedSpecies && im.seedConcentration) {
      const Zs = this.seedZ(Te);
      s += (im.seedConcentration * ne * Zs * Zs) / IMPURITIES[im.seedSpecies].A;
    }
    return s / ne;
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
  /** Auxiliary-heating factor: ramps up over rampTime; with heating.autoOff it ramps down over the same time once Q ≥ 5 */
  private auxRamp(t: number): number {
    const tr = Math.max(this.cfg.heating.rampTime, 0.01);
    const up = Math.min(1, t / tr);
    return this.tAuxOff === Infinity ? up : up * Math.max(0, 1 - (t - this.tAuxOff) / tr);
  }

  /** Fusion rate (profile-integrated): reactions/s and powers; the thermal rate per channel is written to this.Rch */
  private fusion(y: Float64Array, Ti: number) {
    const { alpha_n: an, alpha_T: aT } = this.cfg.transport;
    const T0 = this.peakT(Ti);
    const na = y[IDX.na], nb = y[IDX.nb];
    const fuel = this.cfg.fuel;
    const chans = FUEL_CHANNELS[fuel];
    let rate = 0, P_charged = 0, P_neutron = 0, P_total = 0, neutrons = 0;
    for (let j = 0; j < chans.length; j++) {
      const ch = chans[j];
      // ∫ n_a n_b <σv>(T(ρ)) dV = V (1+αn)² ∫ (1−ρ²)^{2αn} σv(T0 (1−ρ²)^αT) 2ρ dρ
      const I = profileIntegral((rho) => {
        const s = 1 - rho * rho;
        return Math.pow(s, 2 * an) * ch.sigmav(T0 * Math.pow(s, aT));
      });
      // ½ n_D² in an a+a channel (n_D = n_a + n_b in D-D fuel; see pairDensity)
      const R = pairDensity(fuel, ch, na, nb) * (1 + an) * (1 + an) * I * this.V; // reaksiyon/s
      this.Rch[j] = R;
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
    const rc = RHO_CORE;
    const Ibr = profileIntegralSplit((rho) => {
      const s = 1 - rho * rho;
      return Math.pow(s, 2 * an) * bremsstrahlung(1, Te0 * Math.pow(s, aT), Zeff_main);
    }, rc);
    const kBr = ne * ne * (1 + an) * (1 + an) * this.V;
    const P_brems = kBr * Ibr.total;
    const Iline = profileIntegralSplit((rho) => {
      const s = 1 - rho * rho;
      return Math.pow(s, 2 * an) * coolingRate(this.cfg.impurity.species, Te0 * Math.pow(s, aT));
    }, rc);
    const kLine = ne * y[IDX.nZ] * (1 + an) * (1 + an) * this.V;
    let P_line = kLine * Iline.total;
    let P_line_core = kLine * Iline.inner;
    const im = this.cfg.impurity;
    if (im.seedSpecies && im.seedConcentration) {
      const Iseed = profileIntegralSplit((rho) => {
        const s = 1 - rho * rho;
        return Math.pow(s, 2 * an) * coolingRate(im.seedSpecies!, Te0 * Math.pow(s, aT));
      }, rc);
      const kSeed = ne * ne * im.seedConcentration * (1 + an) * (1 + an) * this.V;
      P_line += kSeed * Iseed.total;
      P_line_core += kSeed * Iseed.inner;
    }
    const P_sync = synchrotronTotal({
      R: this.g.R, a: this.g.a, kappa: this.g.kappa, B0: this.cfg.B0,
      ne0_1e20: (ne * (1 + an)) / 1e20, Te0_keV: Te0, alpha_n: an, alpha_T: aT,
      wallReflectivity: this.cfg.impurity.wallReflectivity,
    });
    // core radiation (ρ < RHO_CORE): brems + line; synchrotron comes from the hot core and counts entirely
    const P_rad_core = kBr * Ibr.inner + P_line_core + P_sync;
    return { P_brems, P_line, P_sync, P_rad: P_brems + P_line + P_sync, P_rad_core };
  }

  /** τ_E scaling; IPB98(y,2), ITER89-P, ST and ISS04 are fitted to the line-averaged density: n̄ = f_line ⟨n_e⟩ */
  private tauE(neVol: number, P_loss: number, hmode: boolean): number {
    const c = this.cfg;
    const ne = this.fLine * neVol;
    if (this.isStell) return tauISS04(this.g, c.B0, ne, P_loss, c.stellarator.iota23, this.ctrl.H_ISS04);
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
    y[IDX.Wa] = 0;
    y[IDX.Wb] = 0;
    y[IDX.dWs] = 0;
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
    // Stix critical energy and e-i equilibration: Σ n_j Z_j²/(n_e A_j), all ions
    const ionSum = this.ionSum(y, ne, Te);
    // NBI fast ions (species a, E_b): own pool W_b, own E_c, G and τ_W
    const Ec_nbi = criticalEnergy(Te, fs.a.A, ionSum);
    const fi_nbi = ionHeatingFraction(c.heating.E_NBI_keV, Ec_nbi);
    const tauW_b = Math.max(fastIonEnergyTime(Te, ne, fs.a.A, fs.a.Z, c.heating.E_NBI_keV, Ec_nbi), 1e-3);
    // Demet-hedef füzyonu: n_f = P_NBI τ_sd / (E_b V) (yarı-kararlı), R_bt = n_f n_hedef <σv>_bt V
    // (JET DTE2'de füzyon gücünün ~%30–50'si demet-hedef kaynaklıdır; Maslov 2023)
    if (P_NBI > 0 && c.fuel !== 'pB11') {
      const tau_sd_nbi = slowingDownTime(Te, ne, fs.a.A, fs.a.Z, c.heating.E_NBI_keV, Ec_nbi);
      const n_f = (P_NBI * tau_sd_nbi) / (U.keV_to_J(c.heating.E_NBI_keV) * V);
      const sv = beamTargetReactivity(c.fuel, c.heating.E_NBI_keV, Ec_nbi, Ti);
      FUEL_CHANNELS[c.fuel].forEach((ch, j) => {
        const nTarget = beamTargetDensity(c.fuel, ch, y[IDX.na], y[IDX.nb]);
        const R = n_f * nTarget * sv[j] * V;
        this.Rch[j] += R;
        fus.rate += R; fus.P_total += R * U.MeV_to_J(ch.Etot_MeV); fus.P_bt += R * U.MeV_to_J(ch.Etot_MeV); fus.P_charged += R * U.MeV_to_J(ch.Echarged_MeV);
        fus.P_neutron += R * U.MeV_to_J(ch.Eneutron_MeV); if (ch.Eneutron_MeV > 0) fus.neutrons += R;
      });
    }
    // Charged fusion products (thermal + beam-target): pool W_α. For each product (α, p, T, ³He) the Stix
    // E_c, G and τ_W, weighted by the birth power (heating.fastPoolMix).
    for (let k = 0; k < this.products.length; k++) {
      const pr = this.products[k];
      pr.P = this.Rch[this.productChannel[k]] * U.keV_to_J(pr.E0_keV);
    }
    const mixA = fastPoolMix(this.products, Te, ne, ionSum);
    const tauW_a = Math.max(mixA.tauW, 1e-3);
    // Pool outputs = the heating that accumulates in the plasma. APPROXIMATION: the fast-ion confinement is perfect
    // (no ripple/TAE loss).
    const P_alpha = y[IDX.Wa] / tauW_a;
    const P_beam = y[IDX.Wb] / tauW_b;
    const P_fast_out = P_alpha + P_beam;
    const P_fast_i = P_alpha * mixA.G + P_beam * fi_nbi;
    const P_fast_e = P_alpha * (1 - mixA.G) + P_beam * (1 - fi_nbi);
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
    // Loss power — one definition for the τ_E scaling (ITER Physics Basis, Nucl. Fusion 39 (1999) 2175) and the L-H threshold
    // (Martin 2008): P_L = P_heat − P_rad,core − dW/dt (P_rad,core: ρ < RHO_CORE).
    // dW/dt = y[dWs]: the ELM-averaged true power balance filtered with τ_E (below), so that
    // the τ_E(P_L) ↔ dW/dt feedback generates no noise (loop gain ≈ 0.69 < 1, stable).
    const dWdt_s = y[IDX.dWs];
    const P_loss_scaling = Math.max(P_heat - rad.P_rad_core - dWdt_s, 0.1 * P_heat, 0.5e6 * (V / 100));
    let tauE = this.tauE(ne, P_loss_scaling, this.hmode);
    if (this.ntm) tauE *= this.ntmFactor(y, ne, Te, Ti);
    tauE = Math.max(tauE, 1e-3);
    this.tauE_last = tauE;
    const W = y[IDX.We] + y[IDX.Wi];
    // The τ_E scaling contains the ELM losses: their average leaves in the discrete crashes of postStep
    // and is taken off the continuous conduction. Diagnostics: P_transport = W/τ_E (all of it),
    // P_cond = the continuous conduction applied here, P_ELM = the ELM average applied here.
    // A trial stage of a stiff step can have W < 0 (a cold, radiating post-disruption plasma); it
    // conducts nothing, as when the conduction was clipped at zero. A negative loss there fed the
    // stage error and held the current quench at ~2e-5 s steps (DEMO with 4.6 % W: 18 000 steps).
    const P_transport = Math.max(W, 0) / tauE;
    const P_ELM = this.elmsActive() ? ELM_POWER_FRACTION * P_transport : 0;
    const P_cond_total = P_transport - P_ELM;
    const P_cond_e = P_cond_total * (y[IDX.We] / Math.max(W, 1));
    const P_cond_i = P_cond_total * (y[IDX.Wi] / Math.max(W, 1));
    // ---- e-i equilibration (NRL): ν_eq = 3.2e-9 lnΛ Σ n_j Z_j²/A_j / T_e^1.5, lnΛ(n_e, T_e) ----
    const P_ei = 1.5 * ne * U.keV_to_J(Te - Ti) * V * equilibrationRate(ne, Te, ionSum);

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
    // filtered dW/dt: mean continuous balance P_heat − P_rad − W/τ_E (the ELM crashes are inside W/τ_E)
    d[IDX.dWs] = (P_heat - rad.P_rad - P_transport - dWdt_s) / Math.max(tauE, 5e-3);
    d[IDX.Wa] = fus.P_charged - P_alpha - (this.phase !== 'normal' ? y[IDX.Wa] / 1e-3 : 0);
    d[IDX.Wb] = P_NBI - P_beam - (this.phase !== 'normal' ? y[IDX.Wb] / 1e-3 : 0);
    d[IDX.Ip] = dIp;

    // ---- parçacık dengesi ----
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauE, 1e-3);
    const tau_He = Math.max(c.transport.tau_He_over_tau_E * tauE, 1e-3);
    // The ELM particle exhaust is a PART of τ_p and τ_He (time-averaged): the continuous loss is reduced by that much
    // (a sawtooth crash expels no particles in 0D; the scalings already contain it)
    const lossP = Math.max(1 / tau_p - this.elmPartRate, 0.3 / tau_p);
    const lossHe = Math.max(1 / tau_He - this.elmPartRate, 0.3 / tau_He);
    // burn: an a+b channel consumes 1 a + 1 b, an a+a channel 2 a (in D-D fuel shared between the two slots in proportion);
    // ash: ch.ash per reaction (D-T, D-³He → ⁴He; p-¹¹B → 3 ⁴He; D-D branches → ½)
    let burn_a = 0, burn_b = 0, ashRate = 0;
    FUEL_CHANNELS[c.fuel].forEach((ch, j) => {
      const [ba, bb] = burnPerReaction(c.fuel, ch, y[IDX.na], y[IDX.nb]);
      burn_a += (this.Rch[j] * ba) / V; burn_b += (this.Rch[j] * bb) / V; ashRate += this.Rch[j] * ch.ash;
    });
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
    d[IDX.nHe] = ashRate / V - y[IDX.nHe] * lossHe;
    // safsızlık: hedef konsantrasyona gevşeme + W kaynağı (P_SOL ile sıçratma) ; W birikimi çarpanı
    const cZ_target = this.ctrl.cZ;
    const tauZ = tau_p * this.tauW_accum;
    const P_SOL = Math.max(P_heat - rad.P_rad, 0);
    const S_W = c.impurity.species === 'W' ? (c.impurity.W_source_frac * P_SOL) / (U.keV_to_J(5000) * V) : 0; // APPROXIMATION: 1 W atom per 5 MeV of P_SOL (× W_source_frac)
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
      P_NBI: P_NBI_inj, P_ICRH, P_ECRH, P_oh, P_alpha, P_beam, P_heat, P_cond: P_cond_total, P_transport, P_ELM, P_loss: P_loss_scaling, dWdt: dWdt_s, P_rad_core: rad.P_rad_core, P_ei, tauE, P_SOL, S_fuel: y[IDX.Sfuel] * V,
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

  /**
   * Re-evaluates the cache that diagnostics() reads (lastDiag) at a state that postStep() has just
   * changed. rhs() also stores τ_E for the sawtooth timing later in postStep(), which must keep
   * the value of the step's own last evaluation, so that one is put back.
   */
  private refreshDiagnostics(t: number, y: Float64Array): void {
    const tauE = this.tauE_last;
    this.rhs(t, y, new Float64Array(NSTATE));
    this.tauE_last = tauE;
  }

  diagnostics(t: number, y: Float64Array): Record<string, number> {
    const L = this.lastDiag;
    if (!L.Te) this.rhs(t, y, new Float64Array(NSTATE));
    const D = this.lastDiag;
    const c = this.cfg;
    const W = y[IDX.We] + y[IDX.Wi];
    // volume-averaged pressure (J/m³): thermal <n_e T_e + n_i T_i> + fast particles (2/3)(W_α + W_b)/V
    // (isotropic assumed; the anisotropy of the beam ions is neglected — APPROXIMATION)
    const Wfast = y[IDX.Wa] + y[IDX.Wb];
    const p_th = D.ne * U.keV_to_J(D.Te) + D.ni * U.keV_to_J(D.Ti);
    const p = p_th + (2 / 3) * Wfast / this.V;
    const Ip_MA = y[IDX.Ip] / 1e6;
    const bT = betaToroidal(p, c.B0);
    const bN = this.isStell ? 0 : betaNormalized(bT, this.g.a, c.B0, Math.max(Ip_MA, 0.01));
    // thermal β_N: the NTM drive (bootstrap current) comes from the thermal pressure gradient only
    const bN_th = this.isStell ? 0 : betaNormalized(betaToroidal(p_th, c.B0), this.g.a, c.B0, Math.max(Ip_MA, 0.01));
    const P_in = D.P_aux_abs + D.P_oh;
    const Q = D.P_fus / Math.max(P_in, 1e4);
    const triple = D.ne * D.Ti * D.tauE;
    // The Greenwald (and Sudo) limits are for the line-averaged density: n̄ = f_line(α_n) ⟨n_e⟩
    const nbar = this.fLine * D.ne;
    const nG = this.isStell ? this.sudoLimit(D) : greenwaldDensity(Math.max(Ip_MA, 0.01), this.g.a);
    // L-H threshold: Martin 2008 (with the line-averaged density) + Ryter 2014 low-density branch
    const P_LH = this.isStell ? 0 : pLH_threshold(nbar, c.B0, this.S, this.M, Math.max(Ip_MA, 0.01), this.g.a, this.g.R);
    let q_div = 0;
    if (this.isStell) q_div = divertorHeatFluxStellarator(this.g, c.B0, c.stellarator.iota23, D.P_SOL, c.divertor.f_rad_div);
    else q_div = divertorHeatFlux(this.g, Math.max(y[IDX.Ip], 1e5), D.P_SOL, c.divertor.f_rad_div, c.divertor.flux_expansion).q_div_MWm2;
    const nw = neutronWallLoad(this.g, D.P_neutron, 1).load_MWm2;
    const na = y[IDX.na], nb = y[IDX.nb];
    return {
      Ti: D.Ti, Te: D.Te, Ti0: D.T0, ne: D.ne / 1e20, nbar: nbar / 1e20, nG_frac: nbar / nG, fHe: y[IDX.nHe] / D.ne,
      P_fus: D.P_fus / 1e6, P_bt: D.P_bt / 1e6, P_alpha: D.P_alpha / 1e6, P_beam_heat: D.P_beam / 1e6, P_aux: (D.P_NBI + D.P_ICRH + D.P_ECRH) / 1e6, P_oh: D.P_oh / 1e6,
      P_brems: D.P_brems / 1e6, P_sync: D.P_sync / 1e6, P_line: D.P_line / 1e6, P_rad: D.P_rad / 1e6, P_cond: D.P_cond / 1e6,
      P_transport: D.P_transport / 1e6, Q, tauE: D.tauE, H_mode: this.hmode ? 1 : 0, P_ELM: D.P_ELM / 1e6, P_LH: P_LH / 1e6, P_loss: D.P_loss / 1e6, dWdt: D.dWdt / 1e6, P_rad_core: D.P_rad_core / 1e6, P_ei: D.P_ei / 1e6,
      betaN: bN, betaN_th: bN_th, betaT: bT * 100, q95: this.isStell ? 0 : q95ForMethod(this.method, this.g, c.B0, Math.max(Ip_MA, 0.01)), NTM: this.ntm ? 1 : 0,
      W: W / 1e6, Wf: Wfast / 1e6, W_alpha: y[IDX.Wa] / 1e6, W_beam: y[IDX.Wb] / 1e6, ignited: this.ignited ? 1 : 0, triple, lawson: triple / LAWSON_DT,
      Zeff: D.Zeff, cZ: y[IDX.nZ] / D.ne, Ip: Ip_MA, S_fuel: D.S_fuel / 1e20,
      burnFrac: y[IDX.NTfuel] > 0 ? y[IDX.NTburn] / y[IDX.NTfuel] : 0,
      q_div, n_wall: nw, fuelFracA: na / Math.max(na + nb, 1),
      P_heat: D.P_heat / 1e6, P_charged: D.P_charged / 1e6, P_neutron: D.P_neutron / 1e6,
      Efus_MJ: y[IDX.Efus] / 1e6, Ein_MJ: y[IDX.Ein] / 1e6, Nn: y[IDX.Nn],
      // edge model (two-point): P_sep/R, T_t, q_peak, detachment state, c_z for detachment (tokamaks; a stellarator has no such SOL)
      ...(this.isStell ? {} : edgeDiagnostics(c, this.g, D.P_SOL, y[IDX.Ip], D.ne, this.M)),
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
    // Clamp the non-negative components here as well: integratorOpts.nonNegative is an index array
    // (dW/dt is signed), and the Dormand–Prince integrator of 3d04e96 clamps only for `true` (fixed in
    // the v4 kernel, commit dafd2bf). With a clamping integrator this is a no-op.
    for (const i of this.nonNeg) if (y[i] < 0) y[i] = 0;
    const c = this.cfg;
    const dg = this.diagnostics(t, y);
    const W = y[IDX.We] + y[IDX.Wi];

    if (this.phase === 'normal') {
      // ---- L-H transition (Martin threshold, with P_L = P_heat − P_rad,core − dW/dt; hysteresis 0.7) ----
      if (!this.isStell) {
        const P_L = dg.P_loss;
        if (!this.hmode && P_L > dg.P_LH && t > 0.05) {
          this.hmode = true; ev.push({ t, kind: 'LH', msg: `L→H transition: P_L ${P_L.toFixed(1)} MW > P_LH ${dg.P_LH.toFixed(1)} MW` });
          this.tNextELM = t + 0.05;
        } else if (this.hmode && P_L < 0.7 * dg.P_LH) {
          this.hmode = false; ev.push({ t, kind: 'HL', msg: `H→L back-transition: P_L ${P_L.toFixed(1)} MW < 0.7·P_LH ${(0.7 * dg.P_LH).toFixed(1)} MW — τ_E collapsed` });
          this.tNextELM = Infinity; this.elmPartRate = 0;
        }
      }
      // ---- Type-I ELMs: ΔW ≈ 3 % of W (~10 % of the pedestal energy), f_ELM = P_ELM/ΔW ----
      // The ELM-averaged power is a fraction of the transport loss W/τ_E (the scaling contains the
      // ELMs): P_ELM ≈ 0.2–0.4 P_SOL (A. Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549).
      // rhs() takes it off the continuous conduction (see elmsActive); here it sets the crash rate.
      // It used to be 0.3 P_heat, which in a strongly radiating plasma exceeded W/τ_E and clipped
      // the continuous conduction to zero.
      if (this.elmsActive()) {
        this.elmDW = 0.03 * W;
        const P_ELM = ELM_POWER_FRACTION * dg.P_transport * 1e6;
        const f = P_ELM / Math.max(this.elmDW, 1e5);
        this.elmPartRate = f * 0.03 * 0.3; // mean fractional particle exhaust rate [1/s]
        if (t >= this.tNextELM) {
          const frac = 0.03 * (0.7 + 0.6 * this.rng.next());
          y[IDX.We] *= 1 - frac; y[IDX.Wi] *= 1 - frac;
          // ELM parçacık da atar (~%1 n; pedestal yoğunluğunun birkaç %'i — Loarte 2003)
          y[IDX.na] *= 1 - frac * 0.3; y[IDX.nb] *= 1 - frac * 0.3; y[IDX.nZ] *= 1 - frac * 0.6; y[IDX.nHe] *= 1 - frac * 0.3;
          ev.push({ t, kind: 'ELM', msg: `Type-I ELM: ΔW = ${(frac * W / 1e6).toFixed(2)} MJ`, value: frac * W / 1e6 });
          // the frame recorded after this step must describe the post-crash y (SimModel.diagnostics), not the cached rhs() of the pre-crash state;
          // evaluated here, before a scheduled end of the shot can switch the heating off below (phase 'ended')
          this.refreshDiagnostics(t, y);
          this.tNextELM = t + (1 / f) * (0.7 + 0.6 * this.rng.next());
        }
      } else { this.elmPartRate = 0; }
      // ---- Sawtooth: τ_st ≈ 0.6 τ_E; the crash mixes the energy and the particles inside q = 1
      // outwards. The τ_E, τ_p, τ_He scalings are sawtooth-averaged, so in 0D the
      // crash conserves W and the inventories (the former ~2 % W and 3 % ash/impurity loss counted them twice).
      // Its effect on the impurity accumulation is modelled with tauW_accum (below).
      if (c.events.sawteeth && !this.isStell && t >= this.tNextSaw) {
        const mixed = 0.02 * (0.8 + 0.4 * this.rng.next()); // share of W redistributed from inside q = 1 (informational)
        ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash: ≈ ${(mixed * 100).toFixed(1)}% of W redistributed from inside q = 1`, value: mixed });
        this.tNextSaw = t + Math.max(0.05, 0.6 * this.tauE_last * (0.8 + 0.4 * this.rng.next()));
        // NTM seed: a sawtooth triggers an NTM if β_N > β_onset (Sauter 2002: β_N,onset ~ 2 in ITER).
        // The drive is the bootstrap current → the thermal β_N (fast ions carry no bootstrap current); the Troyon limit uses the total β_N.
        if (c.events.ntm && !this.ntm && dg.betaN_th > 0.7 * c.limits.betaN_limit) {
          this.ntm = true; ev.push({ t, kind: 'NTM_onset', msg: `Sawtooth-seeded NTM (3/2) started: thermal β_N = ${dg.betaN_th.toFixed(2)} — τ_E is degrading` });
        }
      }
      if (this.ntm && dg.betaN_th < 0.5 * c.limits.betaN_limit) {
        this.ntm = false; ev.push({ t, kind: 'NTM_gone', msg: `NTM decayed: thermal β_N ${dg.betaN_th.toFixed(2)} below the marginal threshold` });
      }
      // ---- W birikimi: ELM/sawtooth yoksa merkez birikimi (neoklasik pinch) ----
      this.tauW_accum = c.impurity.species === 'W' && (!c.events.elms || !c.events.sawteeth) ? 4 : 1;

      // ---- Ignition / burn events ----
      // Ignition (Lawson): the heating by charged fusion products alone covers radiation and
      // transport, P_α ≥ P_rad + W/τ_E, where W/τ_E = P_transport is the continuous conduction P_cond
      // plus the ELM-averaged loss; NBI heating is not part of P_α. τ_E is evaluated at the loss power
      // including the external heating (power degradation), so the test is conservative: τ_E rises
      // when the heating is switched off. Hysteresis (so that ELM ripple does not flood the event
      // log): on at P_α ≥ P_loss, off at P_α < 0.9 P_loss.
      const P_loss_total = dg.P_rad + dg.P_transport;
      const ignOn = dg.P_alpha >= P_loss_total && dg.P_fus > 1;
      const ignOff = dg.P_alpha < 0.9 * P_loss_total;
      if (ignOn && !this.ignited) { this.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${dg.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
      if (ignOff && this.ignited) { this.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
      if (dg.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: `Q ≥ 1 (scientific breakeven)` }); }
      // Ignition test (heating.autoOff): at Q ≥ 5 the external heating ramps down linearly within heating.rampTime;
      // the plasma ignites if it sustains itself with P_α, otherwise it dies out.
      if (c.heating.autoOff && this.tAuxOff === Infinity && dg.Q >= 5) {
        this.tAuxOff = t;
        ev.push({ t, kind: 'info', msg: `Ignition test: Q = ${dg.Q.toFixed(1)} ≥ 5 — external heating ramping off over ${c.heating.rampTime} s` });
      }
      if (dg.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }

      // ---- uyarılar ----
      if (dg.q_div > 10 && !this.warned.has('div')) { this.warned.add('div'); ev.push({ t, kind: 'warning', msg: `Divertor heat flux ${dg.q_div.toFixed(0)} MW/m² > 10 MW/m² — material lifetime at risk` }); }
      if (dg.nG_frac > 0.85 && !this.warned.has('nG')) { this.warned.add('nG'); ev.push({ t, kind: 'warning', msg: `n̄/n_G = ${dg.nG_frac.toFixed(2)} — approaching the density limit` }); }
      if (dg.betaN > 0.85 * c.limits.betaN_limit && !this.warned.has('bN')) { this.warned.add('bN'); ev.push({ t, kind: 'warning', msg: `β_N = ${dg.betaN.toFixed(2)} — approaching the Troyon limit` }); }

      // ---- LİMİT KONTROLLERİ → disruption ----
      let cause: DisruptionCause = 'none';
      let diag = '';
      if (!this.isStell) {
        if (dg.nG_frac > c.limits.greenwald_limit) { cause = 'density_limit'; diag = `n̄/n_G reached ${dg.nG_frac.toFixed(2)}`; }
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
        this.tNextELM = Infinity;
        // The burn ends with the quench: the ignition logic above runs in the normal phase only, so without this
        // the flag would stay set through the quench frames (P_α = 0 there) and the report's ignition time would
        // count them. The 1.5D model clears it at its disruption onset as well (profiles/events/disruption.ts).
        this.ignited = false;
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
      hmode: +this.hmode, ntm: +this.ntm, tNextELM: this.tNextELM, tNextSaw: this.tNextSaw, elmPartRate: this.elmPartRate,
      tauW_accum: this.tauW_accum, ignited: +this.ignited, burning: +this.burning, tauE_last: this.tauE_last,
      tAuxOff: this.tAuxOff,
      // once-only warning flags: a rewind must not issue an already-issued warning again
      warnDiv: +this.warned.has('div'), warnNG: +this.warned.has('nG'), warnBN: +this.warned.has('bN'),
    };
  }
  restoreInternal(s: Record<string, number>): void {
    this.rng.setState(s.rng);
    this.phase = (['normal', 'thermal_quench', 'current_quench', 'ended'] as Phase[])[s.phase] ?? 'normal';
    this.hmode = !!s.hmode; this.ntm = !!s.ntm; this.tNextELM = s.tNextELM; this.tNextSaw = s.tNextSaw;
    this.elmPartRate = s.elmPartRate ?? 0; this.tauW_accum = s.tauW_accum; this.ignited = !!s.ignited; this.burning = !!s.burning;
    this.tauE_last = s.tauE_last; this.tAuxOff = s.tAuxOff ?? Infinity; this.terminated = null; this.lastDiag = {};
    this.warned.clear();
    if (s.warnDiv) this.warned.add('div');
    if (s.warnNG) this.warned.add('nG');
    if (s.warnBN) this.warned.add('bN');
  }
  geometryInfo(): Record<string, number> {
    const c = this.cfg;
    return { R: this.g.R, a: this.g.a, kappa: this.g.kappa, delta: this.g.delta, B0: c.B0, Ip_MA: c.Ip_MA, V: this.V, S: this.S, stellarator: +this.isStell, gap: c.magnet.gap_m, coilThickness: c.magnet.coilThickness_m, B_coil: this.magnetInfo.B_coil };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    return buildMagneticReport({
      cfg: this.cfg, method: this.method, g: this.g, V: this.V, magnetInfo: this.magnetInfo,
      terminated: this.terminated, tDisrupt: this.tDisrupt, isStell: this.isStell,
    }, hist, events);
  }
}
