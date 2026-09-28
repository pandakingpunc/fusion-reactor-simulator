/**
 * 1.5D PROFİL MODELİ — tokamak / sferik tokamak.
 *
 * Radyal taşınım (ρ̂ = √(Φ/Φ_b), hücre-merkezli sonlu hacim) + sabit-sınırlı Grad–Shafranov
 * dengesi (periyodik, yarı-statik bağlaşım). Durum: T_e(ρ), T_i(ρ), n_e(ρ), ψ(ρ) + küresel
 * skalerler (He külü envanteri, safsızlık, yakıt oranı, sayaçlar, taşınım çarpanı, ada genişlikleri).
 *
 * Zaman adımı: örtük geri Euler (L-kararlı) + Picard iterasyonu (doğrusal olmayan katsayılar);
 * uyarlanır Δt (profil değişimi ≤ %8 hedefi), reddedilen adım yarılanır.
 *
 * Taşınım ('scaling' modu): χ(ρ) = C_χ(t)·(1 + c ρ²) [+ ETB + neoklasik taban + NTM adası].
 * C_χ, depolanan enerjiyi W → τ_E,ölçekleme(P_kayıp)·P_kayıp değerine çeken bir PI denetleyiciyle
 * ayarlanır: küresel dinamik doğrulanmış 0D ölçeklemesiyle tutarlı, profil ŞEKLİ ise kaynak
 * birikimi, pedestal, testere dişi, bootstrap ve akım difüzyonundan fiziksel olarak çıkar
 * (METIS/CRONOS 'τ_E-ölçekli' yaklaşımı — Artaud et al., Nucl. Fusion 58 (2018) 105001).
 * 'cgm' modu: kritik-gradyan modeli (Garbet et al., PPCF 46 (2004) 1351) — öngörücü, deneysel.
 *
 * Sınır koşulları: T_sep iki-nokta modeli (Stangeby, "The Plasma Boundary of Magnetic Fusion
 * Devices" §5): T_u = (7 q∥ L∥ / 2κ0e)^{2/7}, q∥ = P_SOL B/(2π R λ_q B_p), λ_q Eich (2013);
 * n_sep = f_sep ⟨n_e⟩; ψ' ← I_p (akım kontrollü).
 */
import { Geometry } from '../geometry';
import { FUEL_CHANNELS, FUEL_SPECIES } from '../reactivity';
import { bremsstrahlung, coolingRate, meanCharge, synchrotronTotal } from '../radiation';
import { tauIPB98y2, tauITER89P, tauSTValovic, pLH_Martin, coulombLog } from '../transport';
import { criticalEnergy, ionHeatingFraction, slowingDownTime } from '../heating';
import { greenwaldDensity } from '../limits';
import { disruptionReport, DisruptionCause, DISRUPTION_LABELS, DISRUPTION_FIXES } from '../disruption';
import { checkMagnet, divertorHeatFlux, neutronWallLoad, MAGNET_TECH, MagnetCheck } from '../engineering';
import { IMPURITIES, ImpuritySpecies } from '../constants';
import { RNG } from '../rng';
import { GSSolver, Equilibrium, EquilibriumOptions } from '../equilibrium/gs';
import { buildMagneticReport, LAWSON_DT } from '../confinement/magneticReport';
import { flatTopMean } from '../analysis/flatTop';
import { DiagSpec, EqSnapshot, HistoryFrame, MagneticConfig, ProfileSettings, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import { TransportGeometry, geometryFromEquilibrium } from './geometry1d';
import { GsAttempt, GsStage, acceptableEquilibrium, binomialSmooth, gridScalePasses, isUsableGeometry, solveGuarded, solverErrorMessage } from './eqguard';
import { StepFailure } from './failures';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { CurrentSolver, DensitySolver, HeatInputs, HeatSolver } from './fvsolver';
import { NbiChord, edgeDeposition, gaussianDeposition, volumeIntegral } from './sources';
import { BeamTargetTable } from './beamtarget';
import { chiNeoIon, nuStarE, nuStarI, sauterCoefficients, sigmaNeo, bootstrapJB, BootstrapCoeffs } from './neoclassical';
import { alphaCritical, alphaMHD, elmCrash, flattenConserving, kadomtsevMixingRadius, mreRate, qFromDpsi, rhoOfQ, shearAt, stabilityProfiles } from './mhd';

const KEV = 1.602176634e-16; // J/keV
const MU0 = 1.25663706212e-6;
const AMU = 1.66053906660e-27;

/** MHD çöküşü anlık görüntüsü: hücre merkezlerinde T [keV], n_e [10²⁰ m⁻³], q */
export interface CrashSnapshot { rho: number[]; Te: number[]; Ti: number[]; ne: number[]; q: number[] }

export { DEFAULT_PROFILE_SETTINGS };

// skaler durum indeksleri (y[4N + k])
const S = { NHe: 0, cZ: 1, fA: 2, Efus: 3, Ein: 4, Nn: 5, NTburn: 6, NTfuel: 7, Cchi: 8, Sfuel: 9, Ip: 10, w32: 11, w21: 12, Pelm: 13, CI: 14 } as const;
const NSCAL = 15;

// implicit step retry policy (see ProfileModel.step)
const STEP_SHRINK = 0.4;
const STEP_MAX_ATTEMPTS = 12;
const STEP_DT_FLOOR = 1e-7;

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

export const PROFILE_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T_i (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Te', label: 'T_e (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Ti0', label: 'T_i (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'Te0', label: 'T_e (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'Tped', label: 'T_e (pedestal top)', unit: 'keV', group: 'Temperature' },
  { key: 'Tsep', label: 'T_sep (two-point)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e (volume avg.)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nbar', label: 'n̄_e (line avg.)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'ne0', label: 'n_e (axis)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nG_frac', label: 'n̄/n_Greenwald', unit: '', group: 'Density' },
  { key: 'fHe', label: 'He ash fraction', unit: '', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_alpha (deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_bt', label: 'P_fusion beam-target', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_auxiliary', unit: 'MW', group: 'Power' },
  { key: 'P_oh', label: 'P_ohmic', unit: 'MW', group: 'Power' },
  { key: 'P_cond', label: 'P_transport (W/τ_E)', unit: 'MW', group: 'Power' },
  { key: 'P_SOL', label: 'P_SOL', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_sync', label: 'P_synchrotron', unit: 'MW', group: 'Radiation' },
  { key: 'P_line', label: 'P_line', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad', label: 'P_rad total', unit: 'MW', group: 'Radiation' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'triple', label: 'n·T·τ_E', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'lawson', label: 'Lawson ratio', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E', unit: 's', group: 'Confinement' },
  { key: 'tauE_scal', label: 'τ_E scaling law (C_χ target)', unit: 's', group: 'Confinement' },
  { key: 'H_mode', label: 'Mode (1=H, 0=L)', unit: '', group: 'Confinement' },
  { key: 'P_LH', label: 'P_LH threshold', unit: 'MW', group: 'Confinement' },
  { key: 'chi_mult', label: 'Transport multiplier C_χ', unit: 'm²/s', group: 'Confinement' },
  { key: 'betaN', label: 'β_N', unit: '', group: 'MHD' },
  { key: 'betaP', label: 'β_p', unit: '', group: 'MHD' },
  { key: 'q95', label: 'q95', unit: '', group: 'MHD' },
  { key: 'q0', label: 'q(0)', unit: '', group: 'MHD' },
  { key: 'li', label: 'ℓ_i(3)', unit: '', group: 'MHD' },
  { key: 'rho_q1', label: 'ρ(q=1)', unit: '', group: 'MHD' },
  { key: 'alpha_ped', label: 'α_ped / α_crit', unit: '', group: 'MHD' },
  { key: 'w32', label: 'NTM 3/2 island w/a', unit: '', group: 'MHD' },
  { key: 'w21', label: 'NTM 2/1 island w/a', unit: '', group: 'MHD' },
  { key: 'f_bs', label: 'Bootstrap fraction', unit: '', group: 'Current' },
  { key: 'f_cd', label: 'Driven-current fraction', unit: '', group: 'Current' },
  { key: 'V_loop', label: 'Loop voltage', unit: 'V', group: 'Current' },
  { key: 'Ip', label: 'I_p', unit: 'MA', group: 'Current' },
  { key: 'W', label: 'W_plasma', unit: 'MJ', group: 'Energy' },
  { key: 'Zeff', label: 'Z_eff', unit: '', group: 'Impurities' },
  { key: 'cZ', label: 'c_Z (n_Z/n_e)', unit: '', group: 'Impurities', log: true },
  { key: 'S_fuel', label: 'Fueling', unit: '1e20 /s', group: 'Density' },
  { key: 'burnFrac', label: 'T burn fraction', unit: '', group: 'Fuel' },
  { key: 'fuelFracA', label: 'D fraction n_D/(n_D+n_T)', unit: '', group: 'Fuel' },
  { key: 'q_div', label: 'Divertor heat flux', unit: 'MW/m²', group: 'Engineering' },
  { key: 'n_wall', label: 'Neutron wall load', unit: 'MW/m²', group: 'Engineering' },
];

type Phase = 'normal' | 'thermal_quench' | 'current_quench' | 'ended';
const PHASES: readonly Phase[] = ['normal', 'thermal_quench', 'current_quench', 'ended'];

/** An accepted equilibrium and the transport geometry built from it (shared by reference) */
interface EqGeometry { eq: Equilibrium; tg: TransportGeometry }

/** Quantities held fixed over one implicit step (evaluated from the old state) */
interface StepConstants { P_NBI: number; P_IC: number; P_EC: number; shine: number; btR: Float64Array; Eb: number; Psync: number; S_nbi: number }

/** Profil modelinin kullanılabilir olduğu yapılandırmalar */
export function supportsProfiles(cfg: MagneticConfig): boolean {
  return cfg.method !== 'stellarator';
}

export class ProfileModel implements SimModel {
  readonly kind = 'magnetic' as const;
  readonly method: MagneticConfig['method'];
  readonly timeUnit = 's' as const;
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState: number;
  readonly diagSpecs = PROFILE_DIAGS;
  readonly integratorOpts = { rtol: 1e-4, atol: 1, dtMin: 1e-7, dtMax: 1 };
  readonly dt0 = 1e-3;
  terminated: TerminationInfo | null = null;

  readonly ps: ProfileSettings;
  readonly cfg: MagneticConfig;
  /** GS sınır şekli (LCFS) */
  readonly geomB: Geometry;
  private gsSolver: GSSolver;
  eq!: Equilibrium;
  tg!: TransportGeometry;
  private heat!: HeatSolver;
  private dens!: DensitySolver;
  private cur!: CurrentSolver;
  readonly N: number;
  private M: number; // ortalama yakıt kütlesi [amu]
  private rng: RNG;
  private magnetInfo: MagnetCheck;
  private ctrl: Record<string, number>;
  private kappaA = 1;

  // dinamik iç durum
  private dt = 1e-3;
  private phase: Phase = 'normal';
  private hmode = false;
  private lastSaw = -1e9;
  private lastElm = -1e9;
  private elmTimes: number[] = [];
  private eqTime = 0;
  private eqBetaP = 0;
  private eqLi = 0;
  private eqDirty = true;
  private ignited = false;
  private burning = false;
  private warned = new Set<string>();
  private tDisrupt = 0;
  private Wd = 0;
  private IpD = 0;
  private disruptCause: DisruptionCause = 'none';
  private diagText = '';
  private ntmOn32 = false;
  private ntmOn21 = false;
  private tauW_accum = 1;

  // çalışma dizileri
  private w: Record<string, Float64Array> = {};
  private lastDiag: Record<string, number> = {};
  private lastProf: Record<string, number[]> = {};
  private sauter: BootstrapCoeffs[] = [];
  private depEC!: Float64Array; private depIC!: Float64Array; private depGas!: Float64Array; private depPel!: Float64Array;
  private chord: NbiChord | null = null;
  private btTables = new Map<number, BeamTargetTable>();
  private Pn = 0.5; // pinç şekil parametresi
  /** İsteğe bağlı: MHD çöküşünden hemen önce/sonra profil anlık görüntüsü (figür/teşhis; simülasyonu etkilemez) */
  crashHook: ((kind: 'sawtooth' | 'ELM', t: number, before: CrashSnapshot, after: CrashSnapshot) => void) | null = null;

  constructor(cfg: MagneticConfig) {
    this.cfg = cfg;
    this.method = cfg.method;
    this.ps = { ...DEFAULT_PROFILE_SETTINGS, eqUpdateInterval: Math.min(Math.max(cfg.t_end / 20, 0.5), 20), ...(cfg.profiles ?? {}) };
    this.N = Math.max(16, Math.round(this.ps.nRho));
    const g0 = cfg.geometry;
    this.geomB = { R: g0.R, a: g0.a, kappa: this.ps.lcfsKappa ?? g0.kappa, delta: this.ps.lcfsDelta ?? g0.delta };
    this.tEnd = cfg.t_end;
    this.outputDt = Math.max(cfg.t_end / 800, 0.002);
    this.nState = 4 * this.N + NSCAL;
    const fs = FUEL_SPECIES[cfg.fuel];
    this.M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    this.rng = new RNG(cfg.seed);
    this.ctrl = {
      P_NBI_MW: cfg.heating.P_NBI_MW, P_ICRH_MW: cfg.heating.P_ICRH_MW, P_ECRH_MW: cfg.heating.P_ECRH_MW,
      n_target_1e20: cfg.n_target / 1e20, H98: cfg.H98, cZ: cfg.impurity.concentration,
      fuelRate_1e20s: cfg.fueling.maxRate_1e20s,
    };
    // pinç parametresi: kaynaksız denge n ∝ exp(−P ρ²) için n(0)/⟨n⟩ = 1 + α_n
    const target = 1 + cfg.transport.alpha_n;
    let P = 0.5;
    for (let it = 0; it < 60; it++) { const f = P / (1 - Math.exp(-P)) - target; const df = (1 - Math.exp(-P) - P * Math.exp(-P)) / (1 - Math.exp(-P)) ** 2; P = Math.max(1e-3, P - f / df); }
    this.Pn = cfg.transport.alpha_n > 1e-3 ? P : 1e-3;
    this.magnetInfo = checkMagnet(cfg.geometry, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m);
    this.gsSolver = new GSSolver(this.geomB, { NR: this.ps.eqNR });
    this.eq = this.gsSolver.solve({ Ip: Math.max(cfg.Ip_MA, 0.05) * 1e6, B0: cfg.B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.1 }, tol: 1e-7 });
    this.adoptGeometry({ eq: this.eq, tg: geometryFromEquilibrium(this.eq, this.N, this.geomB) });
    this.eqBetaP = this.eq.betaP; this.eqLi = this.eq.li3;
    if (this.magnetInfo.quench) {
      this.phase = 'ended';
      this.terminated = {
        t: 0, natural: false, reason: 'Magnet quench',
        diagnosis: `Peak field in the toroidal field coil B_coil = ${this.magnetInfo.B_coil.toFixed(1)} T, ${MAGNET_TECH[cfg.magnet.tech].label} has a limit of ${this.magnetInfo.B_max} T. The coil quenched; shot aborted.`,
        fix: DISRUPTION_FIXES.magnet_quench,
      };
    }
  }

  get currentDt(): number { return this.dt; }

  /** Makes an accepted equilibrium and its transport geometry current */
  private adoptGeometry(geo: EqGeometry): void {
    this.geo = geo;
    this.eq = geo.eq;
    this.setGeometry(geo.tg);
  }
  private geo!: EqGeometry;

  /**
   * Switches the transport geometry. The work arrays depend only on N, so they are allocated once
   * and keep their values; after a swap mid-shot the caller re-evaluates them on the new geometry
   * (evaluateWorkArrays) before anything reads them.
   */
  private setGeometry(tg: TransportGeometry): void {
    this.tg = tg;
    this.heat = new HeatSolver(tg);
    this.dens = new DensitySolver(tg);
    this.cur = new CurrentSolver(tg);
    const N = this.N, N1 = N + 1;
    const names = ['ni', 'ni0', 'na', 'nb', 'nHe', 'nZ', 'ns', 'Zeff', 'ZeffMain', 'ionSum', 'Zimp', 'Zseed',
      'Pfus', 'Pchg', 'Pneut', 'Rfus', 'Nfus', 'burnA', 'burnB', 'Pbt', 'PaE', 'PaI', 'PnbiE', 'PnbiI', 'PicE', 'PicI', 'PecE',
      'Poh', 'Pbr', 'Pline', 'Psync', 'Prad', 'dPrad', 'nuEq', 'Qe', 'Qi', 'Le', 'Li', 'Sn', 'sigma', 'jB', 'jbsB', 'jcdB', 'jniB',
      'q', 'nbiDep', 'nbiTmp', 'nbiPart', 'nfast', 'TeIt', 'TiIt', 'neIt', 'chiNeo', 'zero', 'p', 'nuE', 'nuI'];
    for (const k of names) this.w[k] ??= new Float64Array(N);
    for (const k of ['chiE', 'chiI', 'chiEp', 'chiIp', 'D', 'v', 'qF', 'dpsiF', 'IencF', 'alphaF', 'mercF', 'ballF']) this.w[k] ??= new Float64Array(N1);
    this.depEC = gaussianDeposition(tg, this.ps.ecrhRho, this.ps.ecrhWidth);
    this.depIC = gaussianDeposition(tg, 0, this.ps.icrhWidth);
    this.depGas = edgeDeposition(tg, 0.04);
    const depth = Math.min(Math.max(this.cfg.fueling.pelletDepth, 0.05), 1);
    this.depPel = gaussianDeposition(tg, 1 - 0.8 * depth, 0.1);
    this.kappaA = tg.volume / (2 * Math.PI * Math.PI * this.geomB.R * this.geomB.a * this.geomB.a);
    this.chord = null; // geometri değişti → kiriş eşlemesi yeniden
    this.eqDirty = true;
  }

  // ------------------------------------------------------------------ yardımcılar
  private views(y: Float64Array) {
    const N = this.N;
    return { Te: y.subarray(0, N), Ti: y.subarray(N, 2 * N), ne: y.subarray(2 * N, 3 * N), psi: y.subarray(3 * N, 4 * N), s: y.subarray(4 * N) };
  }
  private crashSnap(v: { Te: Float64Array; Ti: Float64Array; ne: Float64Array }): CrashSnapshot {
    return { rho: Array.from(this.tg.rhoC), Te: Array.from(v.Te), Ti: Array.from(v.Ti), ne: Array.from(v.ne, (x) => x * 1e-20), q: Array.from(this.w.q) };
  }
  private nTarget(t: number): number {
    const nt = this.ctrl.n_target_1e20 * 1e20;
    const f = Math.min(1, t / Math.max(this.cfg.n_rampTime, 0.01));
    return 0.3 * nt + (nt - 0.3 * nt) * f;
  }
  private auxRamp(t: number): number { return Math.min(1, t / Math.max(this.cfg.heating.rampTime, 0.01)); }
  private fuelingEfficiency(): number {
    switch (this.cfg.fueling.method) { case 'gas': return 0.3; case 'pellet': return 0.5 + 0.45 * Math.min(1, this.cfg.fueling.pelletDepth); case 'nbi': return 1.0; default: return 0.6; }
  }
  private fuelingDelay(): number {
    switch (this.cfg.fueling.method) { case 'gas': return 0.25; case 'pellet': return 0.03; case 'nbi': return 0.05; default: return 0.12; }
  }
  private volAvg(a: ArrayLike<number>): number { return volumeIntegral(this.tg, a) / this.tg.volume; }
  /** orta-düzlem çizgi ortalaması */
  private lineAvg(a: ArrayLike<number>): number {
    const g = this.tg;
    let s = 0;
    for (let i = 0; i < g.N; i++) s += a[i] * (g.RoutF[i + 1] - g.RoutF[i] + g.RinF[i] - g.RinF[i + 1]);
    return s / (g.RoutF[g.N] - g.RinF[g.N]);
  }
  private seedSpecies(): ImpuritySpecies | null {
    const im = this.cfg.impurity;
    return im.seedSpecies && im.seedConcentration ? im.seedSpecies : null;
  }

  /** Bileşim: yarı-nötrallikten yakıt yoğunlukları, Z_eff, iyon toplamı */
  private composition(Te: ArrayLike<number>, ne: ArrayLike<number>, s: ArrayLike<number>): void {
    const w = this.w, N = this.N;
    const fs = FUEL_SPECIES[this.cfg.fuel];
    const im = this.cfg.impurity;
    const seed = this.seedSpecies();
    const cs = seed ? im.seedConcentration! : 0;
    const Ne = volumeIntegral(this.tg, ne);
    const fHe = Math.min(Math.max(s[S.NHe] / Math.max(Ne, 1), 0), 0.3);
    const cZ = Math.max(s[S.cZ], 0);
    const fA = Math.min(Math.max(s[S.fA], 0), 1);
    const AZ = IMPURITIES[im.species]?.A ?? 20;
    const As = seed ? IMPURITIES[seed].A : 20;
    for (let i = 0; i < N; i++) {
      const T = Math.max(Te[i], 0.01);
      const Zz = meanCharge(im.species, Math.max(T, 0.1));
      const Zs = seed ? meanCharge(seed, Math.max(T, 0.1)) : 0;
      const n = ne[i];
      const nHe = fHe * n, nZ = cZ * n, ns = cs * n;
      const neFuel = Math.max(n - 2 * nHe - Zz * nZ - Zs * ns, 0.05 * n);
      const nf = neFuel / (fA * fs.a.Z + (1 - fA) * fs.b.Z);
      const na = fA * nf, nb = (1 - fA) * nf;
      w.na[i] = na; w.nb[i] = nb; w.nHe[i] = nHe; w.nZ[i] = nZ; w.ns[i] = ns; w.Zimp[i] = Zz; w.Zseed[i] = Zs;
      w.ni[i] = na + nb + nHe + nZ + ns;
      const main = na * fs.a.Z ** 2 + nb * fs.b.Z ** 2 + 4 * nHe;
      w.ZeffMain[i] = main / n;
      w.Zeff[i] = (main + Zz * Zz * nZ + Zs * Zs * ns) / n;
      w.ionSum[i] = (na * fs.a.Z ** 2 / fs.a.A + nb * fs.b.Z ** 2 / fs.b.A + nHe + nZ * Zz * Zz / AZ + ns * Zs * Zs / As) / n;
    }
  }

  /** ψ → q, ψ', çevrelenen akım */
  private currentProfiles(psi: ArrayLike<number>, Ip: number): void {
    const w = this.w;
    this.cur.dpsiF(psi as Float64Array, Ip, w.dpsiF);
    qFromDpsi(this.tg, w.dpsiF, w.qF, w.q);
    this.cur.Ienc(w.dpsiF, w.IencF);
    this.cur.jB(w.dpsiF, w.jB);
  }

  /** T_sep iki-nokta modeli [keV] */
  private separatrixT(P_SOL: number, q95: number, Ip: number): number {
    if (this.ps.Tsep_keV !== undefined) return this.ps.Tsep_keV;
    const g = this.tg;
    const Rout = g.RoutF[g.N];
    const Bp = (MU0 * Ip) / g.perimeter;
    const lamq = 0.63e-3 * Math.pow(Math.max(Bp, 0.05), -1.19); // Eich #14 [m]
    const Bt = (g.B0 * g.R0) / Rout;
    const qpar = (Math.max(P_SOL, 1e5) * 0.6 * Math.hypot(Bt, Bp)) / (2 * Math.PI * Rout * lamq * Bp);
    const L = Math.PI * Math.max(q95, 1.5) * g.R0;
    const TeV = Math.pow((3.5 * qpar * L) / 2000, 2 / 7);
    return Math.min(Math.max(TeV / 1000, 0.03), 0.5);
  }

  // ------------------------------------------------------------------ kaynaklar ve katsayılar
  /** Adım başına sabit tutulan (eski durumdan) büyüklükler */
  private stepConstants(t: number, Te: Float64Array, Ti: Float64Array, ne: Float64Array, s: Float64Array): StepConstants {
    const c = this.cfg, w = this.w, N = this.N, g = this.tg;
    const fs = FUEL_SPECIES[c.fuel];
    // ısıtma yalnız disruption söndürme fazlarında kesilir ('ended' planlı bitişte son kare tutarlı kalsın)
    const on = this.phase === 'thermal_quench' || this.phase === 'current_quench' || (this.phase === 'ended' && this.disruptCause !== 'none') ? 0 : 1;
    const ramp = this.auxRamp(t) * on;
    const P_NBI = this.ctrl.P_NBI_MW * 1e6 * ramp;
    const P_IC = this.ctrl.P_ICRH_MW * 1e6 * ramp;
    const P_EC = this.ctrl.P_ECRH_MW * 1e6 * ramp;
    const Eb = c.heating.E_NBI_keV;
    // NBI enerji bileşenleri: pozitif-iyon kaynakları (E_b < 250 keV; JET/DIII-D PINI) tam/yarım/
    // üçte-bir enerji, güç kesirleri ≈ 0.75/0.15/0.10 (D⁺, D₂⁺, D₃⁺ iyon karışımı); negatif-iyon
    // kaynaklar (ITER/DEMO ≥ 250 keV) tek bileşen. APPROXIMATION: sabit tür karışımı.
    const comps: [number, number][] = Eb < 250 ? [[Eb, 0.75], [Eb / 2, 0.15], [Eb / 3, 0.1]] : [[Eb, 1]];
    let shine = 0, sqrtE = 0;
    w.nbiDep.fill(0); w.nfast.fill(0); w.nbiPart.fill(0); w.PnbiE.fill(0); w.PnbiI.fill(0); w.Pbt.fill(0);
    const btR = new Float64Array(N);
    const chans = FUEL_CHANNELS[c.fuel];
    if (!this.chord) this.chord = new NbiChord(g, this.ps.nbiRtan * g.R0);
    const svBuf: number[] = [0, 0];
    for (const [Ek, fk] of comps) {
      if (P_NBI <= 0) break;
      const r = this.chord.deposit(ne, Ek, fs.a.A, w.nbiTmp);
      let tab = this.btTables.get(Ek);
      if (!tab && c.fuel !== 'pB11') { tab = new BeamTargetTable(c.fuel, Ek); this.btTables.set(Ek, tab); }
      shine += fk * r.shine;
      sqrtE += fk * Math.sqrt(Ek);
      let maxPd = 0;
      for (let i = 0; i < N; i++) maxPd = Math.max(maxPd, w.nbiTmp[i]);
      for (let i = 0; i < N; i++) {
        const dep = fk * w.nbiTmp[i];
        if (dep <= 0) continue;
        const Ec = criticalEnergy(Math.max(Te[i], 0.01), fs.a.A, w.ionSum[i]);
        const fi = ionHeatingFraction(Ek, Ec);
        const pd = P_NBI * dep;
        w.nbiDep[i] += dep;
        w.PnbiE[i] += pd * (1 - fi); w.PnbiI[i] += pd * fi;
        w.nbiPart[i] += pd / (Ek * KEV);
        // demet-hedef: n_f = S τ_th (durağan yavaşlama dağılımı), R = n_f n_hedef ⟨σv⟩_bt
        if (tab && w.nbiTmp[i] > 1e-3 * maxPd) {
          const tsd = slowingDownTime(Math.max(Te[i], 0.01), ne[i], fs.a.A, fs.a.Z, Ek, Ec);
          const nf = (pd * tsd) / (Ek * KEV);
          w.nfast[i] += nf;
          const sv = tab.eval(Ec, Math.max(Ti[i], 0.01), svBuf);
          chans.forEach((ch, j) => {
            const nT = ch.sameSpecies ? w.na[i] : w.nb[i];
            const R = nf * nT * sv[j];
            btR[i] += R;
            w.Pbt[i] += R * ch.Etot_MeV * 1.602176634e-13;
          });
        }
      }
    }
    const EbEff = sqrtE > 0 ? sqrtE * sqrtE : Eb; // akım sürme için etkin demet enerjisi
    for (let i = 0; i < N; i++) {
      w.PicE[i] = P_IC * this.depIC[i] * (1 - c.heating.f_ICRH_ion);
      w.PicI[i] = P_IC * this.depIC[i] * c.heating.f_ICRH_ion;
      w.PecE[i] = P_EC * this.depEC[i];
    }
    // senkrotron (küresel AJG, n_e T_e ağırlıklı dağıtım)
    const nAvg = this.volAvg(ne), TAvg = volumeIntegral(g, Te.map((v, i) => v * ne[i])) / Math.max(volumeIntegral(g, ne), 1);
    const aN = Math.min(Math.max(ne[0] / Math.max(nAvg, 1) - 1, 0.01), 3), aT = Math.min(Math.max(Te[0] / Math.max(TAvg, 1e-3) - 1, 0.1), 4);
    const Psync = synchrotronTotal({ R: g.R0, a: g.a, kappa: this.kappaA, B0: g.B0, ne0_1e20: ne[0] / 1e20, Te0_keV: Te[0], alpha_n: aN, alpha_T: aT, wallReflectivity: c.impurity.wallReflectivity });
    let wsum = 0;
    for (let i = 0; i < N; i++) wsum += ne[i] * Te[i] * g.dV[i];
    for (let i = 0; i < N; i++) w.Psync[i] = wsum > 0 ? (Psync * ne[i] * Te[i]) / wsum : 0;
    // neoklasik (Sauter) katsayıları — adım başına (q eski ψ'den)
    this.sauter.length = N;
    for (let i = 0; i < N; i++) {
      const eps = g.epsC[i], R = g.RgeoC[i];
      const q = Math.min(Math.max(w.q[i], 0.3), 20);
      const Z = Math.max(w.Zeff[i], 1);
      w.nuE[i] = nuStarE(q, R, eps, ne[i], Math.max(Te[i], 0.01) * 1e3, Z);
      w.nuI[i] = nuStarI(q, R, eps, w.ni[i], Math.max(Ti[i], 0.01) * 1e3, Z);
      this.sauter[i] = sauterCoefficients(g.ftC[i], w.nuE[i], w.nuI[i], Z);
      w.chiNeo[i] = chiNeoIon(q, eps, g.B0, w.ni[i], Math.max(Ti[i], 0.01) * 1e3, this.M, Z, w.nuI[i]);
    }
    return { P_NBI, P_IC, P_EC, shine, btR, Eb: EbEff, Psync, S_nbi: volumeIntegral(g, w.nbiPart) };
  }

  /** Taşınım katsayıları yüzeylerde (mevcut iterasyon) */
  private transportCoefficients(Te: Float64Array, Ti: Float64Array, ne: Float64Array, s: Float64Array): void {
    const w = this.w, g = this.tg, N = this.N, ps = this.ps;
    const Cchi = Math.max(s[S.Cchi], 1e-4);
    const rhoPed = 1 - ps.pedestalWidth;
    // NTM ada bölgeleri
    const islands: [number, number][] = [];
    const a = g.a;
    for (const [key, qv] of [[S.w32, 1.5], [S.w21, 2]] as const) {
      const wi = s[key];
      if (wi > 0.002 * a) {
        const rs = rhoOfQ(g, w.qF, qv);
        if (rs > 0) {
          const i = Math.min(N - 1, Math.floor(rs / g.dRho));
          islands.push([rs, wi * g.gradRhoC[i]]);
        }
      }
    }
    const cgm = ps.transportModel === 'cgm';
    // yüzeyde R/L_T = −R ∂T/∂r / T  (T_e ve T_i için; dış yüzde sınır değeri)
    const RLT = (T: Float64Array, TB: number, f: number) => {
      if (f === 0) return 0;
      const TL = T[f - 1], TR = f < N ? T[f] : TB;
      const dist = f < N ? g.dRho : 0.5 * g.dRho;
      const Tf = Math.max(0.5 * (TL + TR), 0.01);
      return (-g.R0 * ((TR - TL) / dist) * g.gradRhoF[f]) / Tf;
    };
    const stiffF = (x: number) => 1 + ps.stiffness * Math.min(Math.max(x / ps.critGrad - 1, 0), 5);
    for (let f = 0; f <= N; f++) {
      const rho = g.rhoF[f];
      let chiT: number, chiTi: number;
      if (!cgm) {
        // ölçek-normalize şekil × kritik-gradyan sertliği (Garbet 2004 yapısı; genlik C_χ ile kısıtlı)
        const base = Cchi * (1 + ps.chiShape * rho * rho);
        // sertlik yalnız çekirdek türbülans bölgesinde (ρ < 0.85); kenar/pedestal fiziği farklıdır
        const core = rho < 0.85;
        chiT = base * (core ? stiffF(RLT(Te, this.bc.Te, f)) : 1);
        chiTi = ps.chiRatio * base * (core ? stiffF(RLT(Ti, this.bc.Ti, f)) : 1);
      } else {
        // kritik gradyan: χ_i = χ_s q^{3/2} χ_gB (R/L_Ti − κc)² H ; χ_e = χ_i/2
        const iL = Math.max(0, Math.min(N - 2, f - 1));
        const Tif = Math.max(0.5 * (Ti[iL] + Ti[iL + 1]), 0.01), Tef = Math.max(0.5 * (Te[iL] + Te[iL + 1]), 0.01);
        const dTi = (Ti[iL + 1] - Ti[iL]) / g.dRho * g.gradRhoF[f];
        const RLT = (-g.R0 * dTi) / Tif;
        const mi = this.M * AMU;
        const rhoS = Math.sqrt(mi * Tef * KEV) / (1.602176634e-19 * g.B0);
        const chiGB = (Tif * 1e3 / g.B0) * (rhoS / g.R0);
        const qf = Math.max(w.qF[f], 0.5);
        const x = Math.max(RLT - 4.5, 0);
        chiTi = Math.pow(qf, 1.5) * chiGB * x * x + 0.1 * chiGB + 0.05;
        chiT = chiTi / 2;
      }
      // ETB (H-modu): pedestal içinde türbülans bastırılır, χ → etbFactor·χ. Pedestal gradyanı
      // kinetik balonlama (KBM) sınırını aşarsa ELM'ler arası taşınım artar (EPED resmi:
      // gradyan KBM ile kenetlenir, yükseklik peeling–balonlama sınırında ELM ile düşer).
      if (this.hmode) {
        const wgt = 0.5 * (1 + Math.tanh((rho - rhoPed) / 0.01));
        const kbm = this.alphaRatio > 1 ? Math.min(Math.pow(this.alphaRatio, 6), 30) : 1;
        const sup = 1 - wgt * (1 - ps.etbFactor * kbm);
        chiT *= sup; chiTi *= sup;
      }
      let chiE = chiT, chiI = chiTi;
      for (const [rs, dr] of islands) if (Math.abs(rho - rs) < 0.5 * dr) { chiE += 5; chiI += 5; }
      // neoklasik taban (iyon)
      const i0 = Math.max(0, Math.min(N - 1, f - 1)), i1 = Math.min(N - 1, f);
      chiI += 0.5 * (w.chiNeo[i0] + w.chiNeo[i1]);
      w.chiE[f] = chiE + 0.01;
      w.chiI[f] = chiI + 0.01;
      w.D[f] = ps.DoverChi * chiT + 0.02;
      w.v[f] = f === 0 ? 0 : -w.D[f] * 2 * this.Pn * rho * (g.g1F[f] / Math.max(g.gradRhoF[f], 1e-9));
    }
  }

  /** Füzyon, ohmik, radyasyon, eşitlenme kaynakları (mevcut iterasyon) */
  private plasmaSources(Te: Float64Array, Ti: Float64Array, ne: Float64Array, K: { btR: Float64Array }): void {
    const w = this.w, N = this.N, c = this.cfg;
    const fs = FUEL_SPECIES[c.fuel];
    const chans = FUEL_CHANNELS[c.fuel];
    const E_ch_keV = (chans[0].Echarged_MeV * 1000) / (c.fuel === 'pB11' ? 3 : 1);
    const im = c.impurity;
    const seed = this.seedSpecies();
    for (let i = 0; i < N; i++) {
      const Tiv = Math.max(Ti[i], 0.01), Tev = Math.max(Te[i], 0.01);
      let R = 0, P = 0, Pc = 0, Pn = 0, Nn = 0, bA = 0, bB = 0;
      for (const ch of chans) {
        const sv = ch.sigmav(Tiv);
        const r = (ch.sameSpecies ? 0.5 * w.na[i] * w.na[i] : w.na[i] * w.nb[i]) * sv;
        R += r;
        P += r * ch.Etot_MeV * 1.602176634e-13;
        Pc += r * ch.Echarged_MeV * 1.602176634e-13;
        Pn += r * ch.Eneutron_MeV * 1.602176634e-13;
        if (ch.Eneutron_MeV > 0) Nn += r;
        if (ch.sameSpecies) bA += 2 * r; else { bA += r; bB += r; }
      }
      // demet-hedef katkısı
      const rbt = K.btR[i];
      if (rbt > 0) {
        R += rbt; P += w.Pbt[i];
        const fc = chans[0].Echarged_MeV / chans[0].Etot_MeV;
        Pc += w.Pbt[i] * fc; Pn += w.Pbt[i] * (1 - fc);
        if (chans[0].Eneutron_MeV > 0) Nn += rbt;
        bA += rbt; if (!chans[0].sameSpecies) bB += rbt;
      }
      w.Rfus[i] = R; w.Pfus[i] = P; w.Pchg[i] = Pc; w.Pneut[i] = Pn; w.Nfus[i] = Nn; w.burnA[i] = bA; w.burnB[i] = bB;
      // yüklü ürün ısıtması (anlık, yerel), Stix paylaşımı
      const Ec = criticalEnergy(Tev, 4, w.ionSum[i]);
      const fi = ionHeatingFraction(E_ch_keV, Ec);
      w.PaE[i] = Pc * (1 - fi); w.PaI[i] = Pc * fi;
      // radyasyon
      const pbr = bremsstrahlung(ne[i], Tev, w.ZeffMain[i]);
      let pl = ne[i] * w.nZ[i] * coolingRate(im.species, Tev);
      let dpl = ne[i] * w.nZ[i] * (coolingRate(im.species, Tev * 1.02) - coolingRate(im.species, Tev)) / (0.02 * Tev);
      if (seed) {
        pl += ne[i] * w.ns[i] * coolingRate(seed, Tev);
        dpl += ne[i] * w.ns[i] * (coolingRate(seed, Tev * 1.02) - coolingRate(seed, Tev)) / (0.02 * Tev);
      }
      w.Pbr[i] = pbr; w.Pline[i] = pl;
      w.Prad[i] = pbr + pl + w.Psync[i];
      w.dPrad[i] = Math.max(0, pbr / (2 * Tev) + dpl);
      // e-i eşitlenme hızı: ν = 3.2e-9 lnΛ Σ n_j Z_j²/A_j [cm⁻³] / T_e[eV]^{3/2}
      const lnL = coulombLog(ne[i], Tev);
      w.nuEq[i] = (3.2e-9 * lnL * ne[i] * w.ionSum[i] * 1e-6) / Math.pow(Tev * 1e3, 1.5);
    }
  }

  /** Neoklasik iletkenlik, bootstrap ve sürülen akımlar (mevcut iterasyon) */
  private currentSources(Te: Float64Array, Ti: Float64Array, ne: Float64Array, psi: Float64Array, K: { P_NBI: number; P_EC: number; Eb: number }): void {
    const w = this.w, g = this.tg, N = this.N;
    const dpsiC = (i: number) => 0.5 * (w.dpsiF[i] + w.dpsiF[i + 1]);
    for (let i = 0; i < N; i++) {
      const Tev = Math.max(Te[i], 0.01);
      w.sigma[i] = sigmaNeo(g.ftC[i], w.nuE[i], ne[i], Tev * 1e3, Math.max(w.Zeff[i], 1));
      w.p[i] = (ne[i] * Tev + w.ni[i] * Math.max(Ti[i], 0.01)) * KEV;
    }
    // bootstrap: ρ-türevleri merkezlerde (merkezi fark; kenarda sınır değerine tek taraflı)
    const TeB = this.bc.Te, TiB = this.bc.Ti, nB = this.bc.n;
    const niB = nB * (w.ni[N - 1] / Math.max(ne[N - 1], 1));
    const pB = (nB * TeB + niB * TiB) * KEV;
    for (let i = 0; i < N; i++) {
      const im = Math.max(i - 1, 0);
      const h = i === 0 ? g.dRho : i === N - 1 ? 1.5 * g.dRho : 2 * g.dRho;
      const pR = i < N - 1 ? w.p[i + 1] : pB, TeR = i < N - 1 ? Te[i + 1] : TeB, TiR = i < N - 1 ? Ti[i + 1] : TiB;
      const pL = i === 0 ? w.p[0] : w.p[im], TeL = i === 0 ? Te[0] : Te[im], TiL = i === 0 ? Ti[0] : Ti[im];
      const dlnp = (pR - pL) / h / Math.max(w.p[i], 1);
      const dlnTe = (TeR - TeL) / h / Math.max(Te[i], 1e-3);
      const dlnTi = (TiR - TiL) / h / Math.max(Ti[i], 1e-3);
      const pe = ne[i] * Math.max(Te[i], 0.01) * KEV;
      const Rpe = pe / Math.max(w.p[i], 1);
      w.jbsB[i] = Math.max(0, bootstrapJB(g.FC[i], w.p[i], Rpe, this.sauter[i], dlnp, dlnTe, dlnTi, Math.max(dpsiC(i), 1e-12)));
    }
    // akım sürme: I_CD = γ P/(n̄20 R0) ; j ∝ birikim, ⟨j·B⟩ ≈ j B0.
    // γ_NB ≈ γ0 (T_e/10 keV) √(E_b/1 MeV)  (Fisch/Cordey eğilimi: verim T_e ve demet hızıyla artar;
    // ITER 1 MeV, T_e≈12 keV → ≈0.25; JET 110 keV, T_e≈7 keV → ≈0.05) — APPROXIMATION
    w.jcdB.fill(0);
    const nbar20 = Math.max(this.lineAvg(ne) / 1e20, 0.05);
    const TeRef = (i: number) => Math.min(Math.max(Te[i] / 10, 0.05), 1.5);
    if (this.ps.nbcdEff > 0 && K.P_NBI > 0) {
      const s = volumeIntegral(g, w.nbiDep) || 1;
      let Tw = 0; for (let i = 0; i < N; i++) Tw += w.nbiDep[i] * g.dV[i] * TeRef(i);
      const gam = Math.min(this.ps.nbcdEff * (Tw / s) * Math.sqrt(Math.min(K.Eb / 1000, 1)), 0.5);
      const Icd = (gam * K.P_NBI * s) / (nbar20 * g.R0);
      for (let i = 0; i < N; i++) w.jcdB[i] += ((Icd * w.nbiDep[i]) / s) * 2 * Math.PI * g.RgeoC[i] * g.B0;
    }
    if (this.ps.eccdEff > 0 && K.P_EC > 0) {
      let Tw = 0; for (let i = 0; i < N; i++) Tw += this.depEC[i] * g.dV[i] * TeRef(i);
      const Icd = (Math.min(this.ps.eccdEff * Tw, 0.5) * K.P_EC) / (nbar20 * g.R0);
      for (let i = 0; i < N; i++) w.jcdB[i] += Icd * this.depEC[i] * 2 * Math.PI * g.RgeoC[i] * g.B0;
    }
    for (let i = 0; i < N; i++) w.jniB[i] = w.jbsB[i] + w.jcdB[i];
    // ohmik ısıtma (endüktif akım): P = (⟨j·B⟩ − ⟨j_ni·B⟩)² / (σ ⟨B²⟩)
    for (let i = 0; i < N; i++) {
      const jind = w.jB[i] - w.jniB[i];
      w.Poh[i] = (jind * jind) / (Math.max(w.sigma[i], 1) * g.B2C[i]);
    }
  }

  private bc = { Te: 0.1, Ti: 0.1, n: 1e19 };
  private nsepGain = 1;
  /** son teşhisteki α_ped/α_crit (KBM kenetlemesi için) */
  private alphaRatio = 0;
  private PSOL = 0;
  private GammaB = 0;

  // ------------------------------------------------------------------ SimModel
  initialState(): Float64Array {
    const N = this.N, c = this.cfg, g = this.tg;
    const y = new Float64Array(this.nState);
    const { Te, Ti, ne, psi, s } = this.views(y);
    const n0 = 0.3 * c.n_target;
    const fsep = this.ps.nsepFrac, an = c.transport.alpha_n;
    for (let i = 0; i < N; i++) {
      const r = g.rhoC[i];
      Te[i] = 0.05 + 1.9 * (1 - r * r);
      Ti[i] = 0.8 * Te[i];
      ne[i] = n0 * (fsep + (1 - fsep) * (1 + an) * Math.pow(1 - r * r, an));
    }
    // ψ: dengenin q profilinden ψ' = Φ_b ρ/(π q)
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const r0 = i === 0 ? 0 : g.rhoC[i - 1], r1 = g.rhoC[i];
      const qm = i === 0 ? g.qEqC[0] : 0.5 * (g.qEqC[i - 1] + g.qEqC[i]);
      const rm = 0.5 * (r0 + r1);
      acc += ((g.PhiB * rm) / (Math.PI * Math.max(qm, 0.3))) * (r1 - r0);
      psi[i] = acc;
    }
    s[S.NHe] = 0;
    s[S.cZ] = c.impurity.concentration;
    s[S.fA] = c.fuelFracA;
    s[S.Cchi] = 0.5; s[S.CI] = 0.5;
    s[S.Ip] = Math.max(c.Ip_MA, 0.05) * 1e6;
    s[S.Sfuel] = 0;
    this.bc = { Te: 0.05, Ti: 0.05, n: fsep * n0 };
    this.composition(Te, ne, s);
    this.currentProfiles(psi, s[S.Ip]);
    return y;
  }

  rhs(_t: number, _y: Float64Array, d: Float64Array): void { d.fill(0); }

  /**
   * One implicit transport step with Δt control. A failed attempt (Picard not converged, change
   * above 35 %, non-finite state, or an exception such as a zero pivot in the linear algebra) is
   * retried with Δt × 0.4. After STEP_MAX_ATTEMPTS attempts, or once Δt would fall below
   * STEP_DT_FLOOR, one forced attempt at that last Δt is accepted even without Picard convergence,
   * but only if its whole state is finite; otherwise the shot ends with a StepFailure at the last
   * accepted state. Time advances only by the Δt of the attempt whose state is committed.
   */
  step(t: number, y: Float64Array, tMax: number): number {
    if (this.phase === 'ended') return tMax;
    if (this.phase !== 'normal') return this.disruptionStep(t, y, tMax);
    const dtWant = this.dt;
    let dt = Math.min(dtWant, tMax - t);
    if (dt <= 0) return t;
    const truncated = dt < dtWant;
    const yOld = Float64Array.from(y);
    let r = this.tryImplicitStep(t, dt, yOld, y);
    let attempts = 1, retried = false, forced = false;
    while (!r.ok) {
      y.set(yOld);
      dt *= STEP_SHRINK; retried = true;
      forced = dt < STEP_DT_FLOOR || attempts >= STEP_MAX_ATTEMPTS;
      r = this.tryImplicitStep(t, dt, yOld, y);
      attempts++;
      if (forced) break;
    }
    if (forced && (r.error !== undefined || !allFinite(y))) {
      y.set(yOld);
      const detail = r.error !== undefined ? solverErrorMessage(r.error) : 'the forced attempt produced a non-finite state';
      this.failStep(new StepFailure(t, dt, attempts, detail, { cause: r.error }));
      return t;
    }
    if (forced) {
      this.forcedSteps++;
      if (!this.warned.has('forced')) {
        this.warned.add('forced');
        this.pending.push({ t: t + dt, kind: 'warning', msg: `Transport step at t = ${t.toFixed(4)} s did not converge in ${attempts - 1} attempts; forced at Δt = ${dt.toExponential(1)} s (Picard not converged) — accuracy is reduced here` });
      }
    }
    this.afterStep(t, dt, yOld, y);
    // uyarlanır Δt: hedef en büyük göreli değişim %8. Çıktı zamanına kesilmiş adım, önerilen
    // Δt'yi küçültmez (aksi halde her çıktı karesinden sonra Δt sıfırdan büyümek zorunda kalır).
    const change = r.change;
    const fac = change > 0 ? Math.min(1.5, Math.max(0.3, 0.08 / change)) : 1.5;
    const next = truncated && !retried ? Math.max(dtWant, dt * fac) : dt * fac;
    this.dt = Math.min(Math.max(next, 1e-6), 0.5);
    return t + dt;
  }

  /** implicitStep with anything it throws (linear algebra, non-finite coefficients) turned into a failed attempt */
  private tryImplicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): { ok: boolean; change: number; error?: unknown } {
    try {
      return this.implicitStep(t, dt, yOld, y);
    } catch (e) {
      return { ok: false, change: Infinity, error: e };
    }
  }

  /** Ends the shot on a numerical failure: explicit termination and 'end' event, state kept at the last accepted step */
  private failStep(e: StepFailure): void {
    this.stepFailure = e;
    this.phase = 'ended';
    this.terminated = {
      t: e.t, natural: false, reason: 'Numerical failure',
      diagnosis: `The implicit transport solver could not advance the plasma: ${e.message}. The shot was stopped at the last accepted state rather than continued with a non-converged or non-finite one.`,
      fix: 'This is a solver failure, not a plasma limit: try a coarser radial grid (nRho) or slower heating/density ramps, or run the shot at 0D fidelity.',
    };
    this.pending.push({ t: e.t, kind: 'end', msg: `Numerical failure — ${e.message}` });
  }
  /** set when the shot was ended by a numerical failure */
  stepFailure: StepFailure | null = null;
  /** steps accepted by the forced last resort (Picard not converged at the smallest Δt) */
  forcedSteps = 0;

  /** Örtük adım + Picard; dönüş: kabul ve en büyük göreli değişim */
  private implicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): { ok: boolean; change: number } {
    const N = this.N, w = this.w, g = this.tg, c = this.cfg;
    const o = this.views(yOld);
    const v = this.views(y);
    const s = v.s;
    // eski bileşim + akım profilleri
    this.composition(o.Te, o.ne, o.s);
    w.ni0.set(w.ni);
    this.currentProfiles(o.psi, o.s[S.Ip]);
    // sınır koşulları (gecikmeli P_SOL). n_sep: kenar/SOL tarafından belirlenir — gaz beslemesinin
    // asıl etkisi ayırıcı yoğunluğudur; hedef n̄'ye bağlanır (çekirdek yoğunluğu çöküşüne karşı sağlam)
    const q95 = this.q95();
    const Tsep = this.separatrixT(this.PSOL, q95, o.s[S.Ip]);
    // gaz beslemesi ayırıcı yoğunluğunu yükseltir: n_sep = f_sep n̄_hedef × kazanç (kazanç afterStep'te
    // integral denetleyiciyle güncellenir)
    const nT = this.nTarget(t);
    this.bc = { Te: Tsep, Ti: Tsep, n: Math.min(this.ps.nsepFrac * nT * this.nsepGain, 0.6 * nT) };
    const K = this.stepConstants(t, o.Te, o.Ti, o.ne, o.s);
    // besleme denetimi (açık): S_cmd = Γ_b − S_nbi + k_p V (n_T − ⟨n⟩)
    // (füzyon yanması elektron sayısını değiştirmez: D+T → He²⁺ + n; seyrelme bileşimde)
    const tauE = Math.max(this.lastDiag.tauE ?? 1, 0.01);
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauE, 0.05);
    const eff = this.fuelingEfficiency();
    const Smax = this.ctrl.fuelRate_1e20s * 1e20;
    // NBI parçacık kaynağı fiziksel olarak her zaman vardır (1.5D; enerji bileşenleri dahil)
    const S_nbi = K.S_nbi;
    let S_cmd = 0;
    if (this.phase === 'normal') {
      // hedef: çizgi-ortalamalı yoğunluk n̄ (deneysel/tasarım kuralı; Greenwald oranı da n̄ ile)
      const kp = 3 / tau_p;
      const nbar = this.lineAvg(o.ne);
      S_cmd = Math.max(0, Math.min(Smax, (Math.max(this.GammaB, 0) - S_nbi + kp * g.volume * (this.nTarget(t) - nbar)) / eff));
    }
    const lag = 1 - Math.exp(-dt / this.fuelingDelay());
    s[S.Sfuel] = o.s[S.Sfuel] + (S_cmd - o.s[S.Sfuel]) * lag;
    const Sfuel = s[S.Sfuel] * eff; // plazmaya giren [1/s]
    const absorbed = Math.max(volumeIntegral(g, w.nbiDep), 1e-6);
    for (let i = 0; i < N; i++) {
      let sh: number;
      switch (c.fueling.method) {
        case 'gas': sh = this.depGas[i]; break;
        case 'pellet': sh = this.depPel[i]; break;
        case 'nbi': sh = w.nbiDep[i] > 0 ? w.nbiDep[i] / absorbed : this.depGas[i]; break;
        default: sh = 0.5 * (this.depGas[i] + this.depPel[i]);
      }
      w.Sn[i] = Sfuel * sh + w.nbiPart[i];
    }
    // Picard
    const heatIn: HeatInputs = {
      dt, ne0: o.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: o.Te, Ti0: o.Ti, chiE: w.chiE, chiI: w.chiI,
      Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: w.TeIt, TiStar: w.TiIt, nuEq: w.nuEq, GammaF: this.dens.GammaF,
      convCoef: 2.5, TeB: this.bc.Te, TiB: this.bc.Ti, nB: this.bc.n,
    };
    let conv = false;
    for (let it = 0; it < 8; it++) {
      w.TeIt.set(v.Te); w.TiIt.set(v.Ti); w.neIt.set(v.ne);
      this.transportCoefficients(v.Te, v.Ti, v.ne, s);
      // sert (gradyana bağlı) taşınımda Picard salınımını önlemek için χ gevşetmesi
      if (it > 0) for (let f = 0; f <= N; f++) { w.chiE[f] = 0.5 * (w.chiE[f] + w.chiEp[f]); w.chiI[f] = 0.5 * (w.chiI[f] + w.chiIp[f]); }
      w.chiEp.set(w.chiE); w.chiIp.set(w.chiI);
      // 1) yoğunluk
      this.dens.solve({ dt, n0: o.ne, D: w.D, v: w.v, S: w.Sn, nB: this.bc.n }, v.ne);
      for (let i = 0; i < N; i++) if (!(v.ne[i] > 1e15)) v.ne[i] = 1e15;
      this.composition(v.Te, v.ne, s);
      // 2) kaynaklar
      this.plasmaSources(v.Te, v.Ti, v.ne, K);
      this.currentProfiles(v.psi, s[S.Ip]);
      this.currentSources(v.Te, v.Ti, v.ne, v.psi, K);
      for (let i = 0; i < N; i++) {
        const Pe = w.PnbiE[i] + w.PicE[i] + w.PecE[i] + w.PaE[i] + w.Poh[i] - w.Prad[i];
        const Pi = w.PnbiI[i] + w.PicI[i] + w.PaI[i];
        // radyasyon yutağı örtük doğrusallaştırılır: Q ≈ P(T*) − L (T − T*), L = ∂P_rad/∂T_e ≥ 0
        w.Qe[i] = Pe / KEV;
        w.Qi[i] = Pi / KEV;
        w.Le[i] = w.dPrad[i] / KEV; w.Li[i] = 0;
      }
      // 3) ısı (T_e, T_i birlikte)
      this.heat.solve(heatIn, v.Te, v.Ti);
      for (let i = 0; i < N; i++) { if (!(v.Te[i] > 0.005)) v.Te[i] = 0.005; if (!(v.Ti[i] > 0.005)) v.Ti[i] = 0.005; }
      // 4) akım
      this.cur.solve({ dt, psi0: o.psi, sigma: w.sigma, jniB: w.jniB, Ip: s[S.Ip] }, v.psi);
      // yakınsama
      let dmax = 0;
      for (let i = 0; i < N; i++) {
        dmax = Math.max(dmax, Math.abs(v.Te[i] - w.TeIt[i]) / Math.max(w.TeIt[i], 0.05),
          Math.abs(v.Ti[i] - w.TiIt[i]) / Math.max(w.TiIt[i], 0.05), Math.abs(v.ne[i] - w.neIt[i]) / Math.max(w.neIt[i], 1e17));
      }
      if (dmax < 2e-3 && it > 0) { conv = true; break; }
    }
    // son tutarlılık
    this.composition(v.Te, v.ne, s);
    this.currentProfiles(v.psi, s[S.Ip]);
    let change = 0, finite = true;
    for (let i = 0; i < N; i++) {
      if (!isFinite(v.Te[i]) || !isFinite(v.Ti[i]) || !isFinite(v.ne[i]) || !isFinite(v.psi[i])) finite = false;
      change = Math.max(change, Math.abs(v.Te[i] - o.Te[i]) / Math.max(o.Te[i], 0.1), Math.abs(v.Ti[i] - o.Ti[i]) / Math.max(o.Ti[i], 0.1),
        Math.abs(v.ne[i] - o.ne[i]) / Math.max(o.ne[i], 1e18));
    }
    this.lastK = K;
    return { ok: finite && (conv || dt < 1e-4) && change < 0.35, change };
  }
  private lastK: StepConstants | null = null;

  private q95(): number {
    const w = this.w, g = this.tg;
    // ψ_N ≈ 0.95 → ρ_tor (dengeden) ; q'yu yüzeylerden doğrusal
    const P = this.eq.prof;
    let k = 0; while (k < P.psiN.length - 2 && P.psiN[k + 1] < 0.95) k++;
    const t = (0.95 - P.psiN[k]) / (P.psiN[k + 1] - P.psiN[k]);
    const r95 = P.rhoTor[k] + t * (P.rhoTor[k + 1] - P.rhoTor[k]);
    const f = Math.min(g.N - 1, Math.floor(r95 / g.dRho));
    const u = (r95 - g.rhoF[f]) / g.dRho;
    return w.qF[f] + u * (w.qF[f + 1] - w.qF[f]);
  }

  /** Kabul edilen adım sonrası: skalerler, denetleyiciler, adalar, teşhis */
  private afterStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): void {
    const N = this.N, w = this.w, g = this.tg, c = this.cfg, ps = this.ps;
    const v = this.views(y), o = this.views(yOld), s = v.s;
    const K = this.lastK!;
    // integraller [W]
    const I = (a: Float64Array) => volumeIntegral(g, a);
    const P_fus = I(w.Pfus), P_chg = I(w.Pchg), P_neut = I(w.Pneut), P_bt = I(w.Pbt);
    const P_aux_abs = I(w.PnbiE) + I(w.PnbiI) + I(w.PicE) + I(w.PicI) + I(w.PecE);
    const P_oh = I(w.Poh), P_alpha = P_chg;
    const P_brems = I(w.Pbr), P_line = I(w.Pline), P_sync = K.Psync, P_rad = P_brems + P_line + P_sync;
    const P_heat = P_aux_abs + P_oh + P_alpha;
    const Rfus = I(w.Rfus), Nn = I(w.Nfus);
    let We = 0, Wi = 0;
    for (let i = 0; i < N; i++) { We += 1.5 * v.ne[i] * v.Te[i] * KEV * g.dV[i]; Wi += 1.5 * w.ni[i] * v.Ti[i] * KEV * g.dV[i]; }
    const W = We + Wi;
    let W0 = 0;
    for (let i = 0; i < N; i++) W0 += 1.5 * (o.ne[i] * o.Te[i] + w.ni0[i] * o.Ti[i]) * KEV * g.dV[i];
    const dWdt = (W - W0) / dt;
    // sınır kaybı
    const heatIn = { dt, ne0: o.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: o.Te, Ti0: o.Ti, chiE: w.chiE, chiI: w.chiI, Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: w.TeIt, TiStar: w.TiIt, nuEq: w.nuEq, GammaF: this.dens.GammaF, convCoef: 2.5, TeB: this.bc.Te, TiB: this.bc.Ti, nB: this.bc.n };
    const Lb = this.heat.boundaryLoss(heatIn, v.Te, v.Ti);
    const P_bound = (Lb.e + Lb.i) * KEV;
    this.GammaB = this.dens.GammaF[N];
    this.lastVloop = (2 * Math.PI * (v.psi[N - 1] - o.psi[N - 1])) / dt;
    // ELM ortalama gücü (üstel hafıza τ = 1 s)
    s[S.Pelm] = o.s[S.Pelm] * Math.exp(-dt / 1.0);
    // P_SOL: küresel güç dengesinden (anlık sınır akısından değil — T_sep ↔ akı geri beslemesi
    // adım-adım salınım üretir), τ ≈ 20 ms gecikmeli
    const PsolTarget = Math.max(P_heat - P_rad - dWdt, 0.05 * P_heat, 1e5);
    this.PSOL += (PsolTarget - this.PSOL) * (1 - Math.exp(-dt / 0.02));
    void P_bound;
    // τ_E ölçeklemesi
    const Ip_MA = s[S.Ip] / 1e6;
    const nbar = this.lineAvg(v.ne);
    const P_loss = this.lossPower(P_heat, P_rad);
    const gS: Geometry = { R: g.R0, a: g.a, kappa: this.kappaA, delta: this.geomB.delta };
    let tauS: number;
    if (this.hmode) tauS = this.ctrl.H98 * (c.scaling === 'ST_Valovic' ? tauSTValovic(gS, Ip_MA, g.B0, nbar, P_loss, this.M) : tauIPB98y2(gS, Ip_MA, g.B0, nbar, P_loss, this.M));
    else tauS = c.H89 * tauITER89P(gS, Math.max(Ip_MA, 0.05), g.B0, nbar, P_loss, this.M);
    // NTM kuşak modeli: ΔW/W ≈ −4 Σ ρ_s² w/a
    let fNTM = 1;
    for (const [key, qv] of [[S.w32, 1.5], [S.w21, 2]] as const) {
      const rs = rhoOfQ(g, w.qF, qv);
      if (rs > 0 && s[key] > 0) fNTM -= 4 * rs * rs * (s[key] / g.a);
    }
    fNTM = Math.max(fNTM, 0.5);
    // scaling-law confinement time with the NTM degradation: the target of the C_χ controller
    const tauScal = Math.max(tauS * fNTM, 1e-3);
    // Plasma confinement time. 'scaling': the controller holds W ≈ τ_scal·P_loss, so τ_E is the
    // scaling value. 'cgm': transport is predictive and nothing ties W to the scaling law, so τ_E is
    // what the profiles give, W/P_loss, with the same P_loss the scaling law is evaluated at.
    // tauT (floored) sets the particle, He-ash and impurity times, which are ratios to τ_E.
    const cgm = ps.transportModel === 'cgm';
    const tauE = cgm ? W / P_loss : tauScal;
    const tauT = cgm ? Math.max(tauE, 1e-3) : tauScal;
    // C_χ PI denetleyici (scaling modu): W → τ_scal · P_loss
    if (!cgm) {
      const Wt = tauScal * P_loss;
      const err = Math.log(Math.max(W, 1) / Math.max(Wt, 1));
      const tauI = 0.3 * tauScal;
      // anti-windup: integral terimi difüzyon tahmini C_est = a²κ_a/(6τ(1+c/2)) çevresinde sınırlı
      const Cest = (g.a * g.a * this.kappaA) / (6 * tauScal * (1 + 0.5 * ps.chiShape));
      const CI = o.s[S.CI] * Math.exp(Math.max(-0.5, Math.min(0.5, (dt / tauI) * err)));
      s[S.CI] = Math.min(Math.max(CI, 0.1 * Cest), 10 * Cest);
      s[S.Cchi] = Math.min(Math.max(s[S.CI] * Math.exp(Math.max(-1.5, Math.min(1.5, 1.5 * err))), 1e-4), 1e4);
    } else { s[S.CI] = o.s[S.CI]; s[S.Cchi] = 1; }
    // ayırıcı yoğunluk kazancı (yalnız gaz beslemesi — pellet/NBI çekirdeği doğrudan besler):
    // n̄ hedefin altındaysa n_sep yükselir (τ ≈ τ_p), [0.5, 2.5]
    if (this.phase === 'normal' && (c.fueling.method === 'gas' || c.fueling.method === 'mixed')) {
      const tauN = Math.max(c.transport.tau_p_over_tau_E * tauT, 0.1);
      const e = Math.log(this.nTarget(t + dt) / Math.max(nbar, 1e15));
      this.nsepGain = Math.min(Math.max(this.nsepGain * Math.exp(Math.max(-0.2, Math.min(0.2, (dt / tauN) * e))), 0.5), 2.5);
    }
    // He külü, safsızlık, yakıt oranı
    const Ne = volumeIntegral(g, v.ne);
    const tauHe = Math.max(c.transport.tau_He_over_tau_E * tauT, 1e-2);
    const ashPerRx = c.fuel === 'pB11' ? 3 : c.fuel === 'DD' ? 0.5 : 1;
    s[S.NHe] = Math.max(0, o.s[S.NHe] + dt * (Rfus * ashPerRx - o.s[S.NHe] / tauHe));
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauT, 1e-2);
    this.tauW_accum = c.impurity.species === 'W' && (!c.events.elms || !c.events.sawteeth) ? 4 : 1;
    const S_W = c.impurity.species === 'W' ? (c.impurity.W_source_frac * this.PSOL) / (5000 * KEV) : 0;
    const tauZ = tau_p * this.tauW_accum;
    s[S.cZ] = Math.max(0, o.s[S.cZ] + dt * ((this.ctrl.cZ - o.s[S.cZ]) / tauZ + S_W / Math.max(Ne, 1)));
    const fs = FUEL_SPECIES[c.fuel];
    let burnA = 0, burnAll = 0;
    for (let i = 0; i < N; i++) { burnA += w.burnA[i] * g.dV[i]; burnAll += (w.burnA[i] + w.burnB[i]) * g.dV[i]; }
    const eff = this.fuelingEfficiency();
    const Sf = s[S.Sfuel] * eff;
    const S_nbi = K.S_nbi;
    const wA = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
    // demet izotop karışımı: 'nbi' beslemede saf tür a (D); aksi halde yakıt karışımını izler
    // (JET DTE2'de D ve T demetleri birlikte — Mailloux et al., Nucl. Fusion 62 (2022) 042026)
    const wBeam = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
    const Nfuel = volumeIntegral(g, w.na) + volumeIntegral(g, w.nb);
    if (!FUEL_CHANNELS[c.fuel][0].sameSpecies && Nfuel > 0) {
      const Sa = Sf * wA + S_nbi * wBeam, Stot = Sf + S_nbi;
      const dfA = (Sa - burnA - o.s[S.fA] * (Stot - burnAll)) / Nfuel;
      s[S.fA] = Math.min(Math.max(o.s[S.fA] + dt * dfA, 0.01), 0.99);
    } else s[S.fA] = o.s[S.fA];
    // sayaçlar
    s[S.Efus] = o.s[S.Efus] + P_fus * dt;
    s[S.Ein] = o.s[S.Ein] + (K.P_NBI + K.P_IC + K.P_EC + P_oh) * dt;
    s[S.Nn] = o.s[S.Nn] + Nn * dt;
    if (c.fuel === 'DT') { s[S.NTburn] = o.s[S.NTburn] + Rfus * dt; s[S.NTfuel] = o.s[S.NTfuel] + Sf * (1 - wA) * dt; }
    // NTM adaları (MRE, açık Euler alt adımlarla)
    for (const [key, m, qv] of [[S.w32, 3, 1.5], [S.w21, 2, 2]] as const) {
      let wv = o.s[key];
      if (wv <= 0 || !c.events.ntm) { s[key] = 0; continue; }
      const rs = rhoOfQ(g, w.qF, qv);
      if (rs <= 0) { s[key] = 0; continue; }
      const i = Math.min(N - 2, Math.max(1, Math.floor(rs / g.dRho)));
      const rsm = 0.5 * (g.RoutC[i] - g.RinC[i]);
      const eta = 1 / Math.max(w.sigma[i], 1);
      const pS = w.p[i];
      const dp = (w.p[i + 1] - w.p[i - 1]) / (2 * g.dRho) * g.gradRhoC[i];
      const dq = (w.qF[i + 1] - w.qF[i]) / g.dRho * g.gradRhoC[i];
      const Lp = pS / Math.max(-dp, 1e-6), Lq = qv / Math.max(dq, 1e-6);
      const Bth = (g.epsC[i] * g.B0) / qv;
      const bth = (2 * MU0 * pS) / (Bth * Bth);
      const wd = 0.012 * (g.a / 2);
      // a_bs ≈ 1: doymuş ada w/a ≈ 0.05–0.1 (JET/DIII-D 3/2 NTM deneysel aralığı; La Haye 2006)
      const par = { eta, m, rs: rsm, eps: g.epsC[i], betaTheta: bth, LqOverLp: Math.min(Lq / Math.max(Lp, 1e-3), 5), wd, aBs: 1.0, aPol: 0.5 };
      const nsub = 20;
      for (let k = 0; k < nsub; k++) wv = Math.max(0, wv + (dt / nsub) * mreRate(wv, par));
      if (wv < 0.2 * wd) wv = 0;
      s[key] = Math.min(wv, 0.4 * g.a);
    }
    // teşhis
    this.writeDiagnostics(t + dt, y, { P_fus, P_chg, P_neut, P_bt, P_aux_abs, P_oh, P_alpha, P_brems, P_line, P_sync, P_rad, P_heat, W, dWdt, tauE, tauScal, P_loss, nbar, P_bound });
    this.eqCheck(t + dt, y);
  }

  private writeDiagnostics(t: number, y: Float64Array, X: Record<string, number>): void {
    const N = this.N, w = this.w, g = this.tg, c = this.cfg, s = this.views(y).s;
    const v = this.views(y);
    const Ip = s[S.Ip], Ip_MA = Ip / 1e6;
    const K = this.lastK!;
    const neAvg = this.volAvg(v.ne);
    let TeA = 0, TiA = 0;
    for (let i = 0; i < N; i++) { TeA += v.Te[i] * v.ne[i] * g.dV[i]; TiA += v.Ti[i] * w.ni[i] * g.dV[i]; }
    TeA /= Math.max(volumeIntegral(g, v.ne), 1); TiA /= Math.max(volumeIntegral(g, w.ni), 1);
    const pAvg = X.W / (1.5 * g.volume);
    const betaT = (2 * MU0 * pAvg) / (g.B0 * g.B0);
    const betaN = (betaT * 100 * g.a * g.B0) / Math.max(Ip_MA, 0.01);
    const Bpa = (MU0 * Ip) / g.perimeter;
    const betaP = (2 * MU0 * pAvg) / (Bpa * Bpa);
    // ℓ_i(3) = 2∫B_p² dV/(μ0² I_p² R0), B_p² ≈ g2 ψ'²
    let bp2 = 0;
    for (let i = 0; i < N; i++) { const dps = 0.5 * (w.dpsiF[i] + w.dpsiF[i + 1]); bp2 += g.g2C[i] * dps * dps * g.dV[i]; }
    const li = (2 * bp2) / (MU0 * MU0 * Ip * Ip * g.R0);
    const Ibs = volumeIntegral(g, w.jbsB.map((jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0)));
    const Icd = volumeIntegral(g, w.jcdB.map((jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0)));
    const P_in = X.P_aux_abs + X.P_oh;
    const Q = X.P_fus / Math.max(P_in, 1e4);
    const triple = neAvg * TiA * X.tauE;
    const nG = greenwaldDensity(Math.max(Ip_MA, 0.01), g.a);
    const P_LH = pLH_Martin(X.nbar, g.B0, g.surface, this.M);
    const rhoPed = 1 - this.ps.pedestalWidth;
    const iPed = Math.min(N - 1, Math.floor(rhoPed / g.dRho));
    const aMax = alphaMHD(g, w.p, w.qF, rhoPed - 0.02, w.alphaF);
    const aCrit = alphaCritical(this.geomB.kappa, this.geomB.delta, this.ps.alphaCritFactor);
    this.alphaRatio = aMax / aCrit;
    const rho1 = rhoOfQ(g, w.qF, 1);
    const q95 = this.q95();
    const qdiv = divertorHeatFlux(this.geomB, Math.max(Ip, 1e5), this.PSOL, c.divertor.f_rad_div, c.divertor.flux_expansion).q_div_MWm2;
    const nw = neutronWallLoad(this.geomB, X.P_neut, 1).load_MWm2;
    const Vloop = this.lastVloop;
    let qmin = Infinity; for (let f = 0; f <= N; f++) qmin = Math.min(qmin, w.qF[f]);
    const Ne = volumeIntegral(g, v.ne);
    this.lastDiag = {
      Ti: TiA, Te: TeA, Ti0: v.Ti[0], Te0: v.Te[0], Tped: v.Te[iPed], Tsep: this.bc.Te,
      ne: neAvg / 1e20, nbar: X.nbar / 1e20, ne0: v.ne[0] / 1e20, nG_frac: X.nbar / nG, fHe: s[S.NHe] / Math.max(Ne, 1),
      P_fus: X.P_fus / 1e6, P_alpha: X.P_alpha / 1e6, P_bt: X.P_bt / 1e6, P_aux: (K.P_NBI + K.P_IC + K.P_EC) / 1e6, P_oh: X.P_oh / 1e6,
      P_cond: X.W / X.tauE / 1e6, P_SOL: this.PSOL / 1e6, P_brems: X.P_brems / 1e6, P_sync: X.P_sync / 1e6, P_line: X.P_line / 1e6, P_rad: X.P_rad / 1e6,
      Q, triple, lawson: triple / LAWSON_DT, tauE: X.tauE, tauE_scal: X.tauScal, H_mode: this.hmode ? 1 : 0, P_LH: P_LH / 1e6, chi_mult: s[S.Cchi],
      betaN, betaT: betaT * 100, betaP, q95, q0: w.qF[0], qmin, li, rho_q1: rho1, alpha_ped: aMax / aCrit,
      w32: s[S.w32] / g.a, w21: s[S.w21] / g.a, NTM: s[S.w32] > 0.01 * g.a || s[S.w21] > 0.01 * g.a ? 1 : 0,
      f_bs: Ibs / Math.max(Ip, 1), f_cd: Icd / Math.max(Ip, 1), V_loop: Vloop, Ip: Ip_MA,
      W: X.W / 1e6, Wf: 0, Zeff: this.volAvg(w.Zeff), cZ: s[S.cZ], S_fuel: s[S.Sfuel] / 1e20,
      burnFrac: s[S.NTfuel] > 0 ? s[S.NTburn] / s[S.NTfuel] : 0, fuelFracA: s[S.fA],
      q_div: qdiv, n_wall: nw, P_heat: X.P_heat / 1e6, P_charged: X.P_chg / 1e6, P_neutron: X.P_neut / 1e6,
      Efus_MJ: s[S.Efus] / 1e6, Ein_MJ: s[S.Ein] / 1e6, Nn: s[S.Nn], P_loss: X.P_loss / 1e6, dWdt: X.dWdt / 1e6,
    };
    // profiller
    const mer = w.mercF, bal = w.ballF;
    stabilityProfiles(g, w.p, w.qF, mer, bal);
    const r = (a: ArrayLike<number>, sc = 1) => Array.from(a, (x) => x * sc);
    const jfac = (i: number) => 1 / (g.B0 * 1e6);
    this.lastProf = {
      rho: r(g.rhoC), Te: r(v.Te), Ti: r(v.Ti), ne: r(v.ne, 1e-20), q: r(w.q),
      j: Array.from(w.jB, (x, i) => x * jfac(i)), jbs: Array.from(w.jbsB, (x, i) => x * jfac(i)), jcd: Array.from(w.jcdB, (x, i) => x * jfac(i)),
      johm: Array.from(w.jB, (x, i) => (x - w.jniB[i]) * jfac(i)),
      chie: Array.from(g.rhoC, (_, i) => 0.5 * (w.chiE[i] + w.chiE[i + 1])), chii: Array.from(g.rhoC, (_, i) => 0.5 * (w.chiI[i] + w.chiI[i + 1])),
      Palpha: r(w.Pchg, 1e-6), Paux: Array.from(g.rhoC, (_, i) => (w.PnbiE[i] + w.PnbiI[i] + w.PicE[i] + w.PicI[i] + w.PecE[i]) * 1e-6),
      Prad: r(w.Prad, 1e-6), Pohm: r(w.Poh, 1e-6), p: r(w.p, 1e-3), Zeff: r(w.Zeff),
      shear: Array.from(g.rhoC, (rr, i) => (rr * (w.qF[i + 1] - w.qF[i]) / g.dRho) / Math.max(w.q[i], 1e-6)),
      alpha: Array.from(g.rhoC, (_, i) => 0.5 * (w.alphaF[i] + w.alphaF[i + 1])),
    };
  }
  private lastVloop = 0;

  // ------------------------------------------------------------------ denge güncellemesi
  /**
   * Denge güncelleme politikası: en geç eqUpdateInterval'da bir; β_p veya ℓ_i belirgin
   * değişirse (%10 / %5) daha erken — ama iki güncelleme arası en az ¼ aralık (yarı-statik
   * bağlaşım: denge, taşınım zaman ölçeğine göre yavaş evrilir).
   */
  private eqCheck(t: number, y: Float64Array): void {
    const d = this.lastDiag;
    const dBp = Math.abs((d.betaP ?? 0) - this.eqBetaP) / Math.max(this.eqBetaP, 0.05);
    const dLi = Math.abs((d.li ?? 0) - this.eqLi) / Math.max(this.eqLi, 0.1);
    const since = t - this.eqTime;
    const due = since >= this.ps.eqUpdateInterval || ((dBp > 0.1 || dLi > 0.05) && since > 0.25 * this.ps.eqUpdateInterval);
    if (!due || this.phase !== 'normal' || t < this.eqRetryAt) return;
    if (this.updateEquilibrium(t, y)) {
      this.eqTime = t;
      this.eqBetaP = d.betaP ?? this.eqBetaP; this.eqLi = d.li ?? this.eqLi;
      this.eqUpdates++;
      this.eqFailStreak = 0;
      return;
    }
    // eqTime advances only on success, so the update stays due. It is retried after a quarter
    // interval, doubling for consecutive rejections up to a full interval (a persistently failing
    // equilibrium must not cost a full retry ladder every quarter interval).
    this.eqRejected++;
    this.eqFailStreak++;
    this.eqRetryAt = t + 0.25 * this.ps.eqUpdateInterval * Math.min(2 ** (this.eqFailStreak - 1), 4);
    if (!this.warned.has('gs')) {
      this.warned.add('gs');
      const last = this.eqAttempts[this.eqAttempts.length - 1];
      const why = last?.error ?? `residual ${last ? last.residual.toExponential(1) : '?'} after ${last?.iterations ?? 0} iterations`;
      this.pending.push({ t, kind: 'warning', msg: `Grad–Shafranov update rejected (${why}; ${this.eqAttempts.length} attempts) — geometry held at the equilibrium of t = ${this.eqTime.toFixed(2)} s, retried from t = ${this.eqRetryAt.toFixed(2)} s` });
    }
  }
  /** accepted Grad–Shafranov updates after the initial solve */
  eqUpdates = 0;
  /** accepted updates that needed a retry stage; updates for which every stage failed */
  eqRetried = 0;
  eqRejected = 0;
  /** no update attempt before this time (back-off after a rejected update); consecutive rejections */
  private eqRetryAt = 0;
  private eqFailStreak = 0;
  /** last GS solve statistics and the attempt log of the last update (diagnostics) */
  eqStats = { it: 0, res: 0 };
  eqAttempts: GsAttempt[] = [];
  /** events raised inside step() (GS rejection, numerical trouble); postStep emits them */
  private pending: SimEvent[] = [];

  /**
   * Grad–Shafranov update from the transport profiles (table mode: p, ⟨j_φ/R⟩ on the current ψ_N
   * nodes); on success the transport geometry is replaced. t is the time of y. Returns whether the
   * new equilibrium was accepted.
   *
   * Retry ladder (each stage warm-starts from the last accepted equilibrium):
   *  1. nominal: relaxation 0.9, 40 Picard iterations (quasi-static change converges in ~8–12);
   *  2. relaxation 0.5, 80 iterations;
   *  3. pressure table low-pass filtered at the GS grid scale (binomialSmooth, Gaussian σ = grid
   *     spacing), relaxation 0.3, 120 iterations. The Dirichlet edge condition puts the drop to
   *     p_sep within half a transport cell (Δρ = 1/(2N)), well below the GS grid spacing (≈ 0.044
   *     in ρ for 49 nodes); the 5-point operator cannot represent that p', and Picard then cycles
   *     as nodes move in and out of the drop (JET15: 14 of 17 updates stalled at residuals
   *     1e-3–3e-2 with the nominal settings, and relaxation alone rescues few of them).
   */
  updateEquilibrium(t: number, y: Float64Array): boolean {
    const g = this.tg, w = this.w, N = this.N, v = this.views(y);
    const P = this.eq.prof;
    const niB = this.bc.n * (w.ni[N - 1] / Math.max(v.ne[N - 1], 1));
    const pB = (this.bc.n * this.bc.Te + niB * this.bc.Ti) * KEV;
    const pAt = (r: number) => {
      if (r <= g.rhoC[0]) return w.p[0];
      if (r >= g.rhoC[N - 1]) { const t = (r - g.rhoC[N - 1]) / (1 - g.rhoC[N - 1]); return w.p[N - 1] + t * (pB - w.p[N - 1]); }
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return w.p[i] + t * (w.p[i + 1] - w.p[i]);
    };
    // akı-yüzeyi ortalamalı ⟨j_φ/R⟩ = 2π dI/dV (taşınım geometrisinde; hücre merkezlerinde)
    const jRc = new Float64Array(N);
    for (let i = 0; i < N; i++) jRc[i] = Math.max((2 * Math.PI * (w.IencF[i + 1] - w.IencF[i])) / g.dV[i], 0);
    const jRAt = (r: number) => {
      if (r <= g.rhoC[0]) return jRc[0];
      if (r >= g.rhoC[N - 1]) return jRc[N - 1];
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return jRc[i] + t * (jRc[i + 1] - jRc[i]);
    };
    const pT = Array.from(P.rhoTor, pAt);
    const jT = Array.from(P.rhoTor, jRAt);
    const Ip = v.s[S.Ip];
    const base: EquilibriumOptions = { Ip, B0: this.cfg.B0, profile: { kind: 'table', psiN: P.psiN, p: pT, jR: jT }, psiInit: this.eq.psi, tol: 1e-5, maxIter: 40, relax: 0.9 };
    const passes = gridScalePasses(this.gsSolver.grid.dR / this.geomB.a, 1 / (P.psiN.length - 1));
    const stages: GsStage[] = [
      { label: 'nominal', opts: {} },
      { label: 'relaxation 0.5', opts: { relax: 0.5, maxIter: 80 } },
      { label: 'grid-scale pressure', opts: { relax: 0.3, maxIter: 120, profile: { kind: 'table', psiN: P.psiN, p: binomialSmooth(pT, passes), jR: jT } } },
    ];
    // the transport geometry built from it must be usable as well (finite metrics, positive cell volumes)
    const built: { tg?: TransportGeometry } = {};
    const accept = (eq: Equilibrium) => {
      built.tg = undefined;
      if (!acceptableEquilibrium(eq)) return false;
      try { built.tg = geometryFromEquilibrium(eq, N, this.geomB); } catch { return false; }
      return isUsableGeometry(built.tg);
    };
    const out = solveGuarded(this.gsSolver, base, stages, accept);
    this.eqAttempts = out.attempts;
    const last = out.attempts[out.attempts.length - 1];
    this.eqStats = { it: last.iterations, res: last.residual };
    if (!out.eq || !built.tg) return false;
    if (out.stage > 0) this.eqRetried++;
    this.adoptGeometry({ eq: out.eq, tg: built.tg });
    // postStep (ELM, sawtooth) runs next and reads n_i, q, p: evaluate them on the new geometry
    this.evaluateWorkArrays(t, y);
    return true;
  }

  takeEqSnapshot(): EqSnapshot | null {
    if (!this.eqDirty) return null;
    this.eqDirty = false;
    return this.eqSnapshot();
  }

  /** Kesit çizimi için akı yüzeyleri (ρ_tor = 0.1 … 1.0) */
  eqSnapshot(nSurf = 10, nPts = 72): EqSnapshot {
    const eq = this.eq, tr = eq.surfaces, P = eq.prof;
    const R: number[][] = [], Z: number[][] = [], rho: number[] = [];
    const nS = tr.R.length;
    for (let s = 1; s <= nSurf; s++) {
      const target = s / nSurf;
      // en yakın ρ_tor yüzeyi (P indeksleri: k+1 ↔ tr k)
      let best = 0, bd = Infinity;
      for (let k = 0; k < nS; k++) { const d = Math.abs(P.rhoTor[k + 1] - target); if (d < bd) { bd = d; best = k; } }
      const rr: number[] = [], zz: number[] = [];
      const n = tr.R[best].length, stride = Math.max(1, Math.floor(n / nPts));
      for (let j = 0; j < n; j += stride) { rr.push(tr.R[best][j]); zz.push(tr.Z[best][j]); }
      R.push(rr); Z.push(zz); rho.push(P.rhoTor[best + 1]);
    }
    return { R, Z, rho, Raxis: eq.Raxis, Zaxis: eq.Zaxis, q95: eq.q95, li: eq.li3, betaP: eq.betaP };
  }

  // ------------------------------------------------------------------ olaylar
  postStep(t: number, _dt: number, y: Float64Array): SimEvent[] {
    const ev: SimEvent[] = this.pending.splice(0);
    if (this.terminated) return ev;
    const c = this.cfg, g = this.tg, w = this.w, N = this.N, ps = this.ps;
    const v = this.views(y), s = v.s;
    const d = this.lastDiag;
    if (!d.Te) return ev;
    if (this.phase === 'normal') {
      // L-H geçişi (Martin eşiği, histerezis 0.7)
      const P_L = d.P_loss;
      if (!this.hmode && P_L > d.P_LH && t > 0.05) {
        this.hmode = true; ev.push({ t, kind: 'LH', msg: `L→H transition: P_loss ${P_L.toFixed(1)} MW > P_LH ${d.P_LH.toFixed(1)} MW — edge transport barrier forms` });
      } else if (this.hmode && P_L < 0.7 * d.P_LH) {
        this.hmode = false; ev.push({ t, kind: 'HL', msg: `H→L back-transition: P_loss ${P_L.toFixed(1)} MW < 0.7·P_LH ${(0.7 * d.P_LH).toFixed(1)} MW — pedestal lost` });
      }
      // ELM: α_ped > α_crit ve pedestal toparlanma (bekleme) süresi τ_E/8 geçti
      // (deneysel f_ELM τ_E ≈ 5–30: ITER ≈ 2 Hz, JET ≈ 30 Hz, DIII-D ≈ 50 Hz)
      const tRef = Math.max((d.tauE ?? 0.1) / 8, 2e-3);
      if (this.hmode && c.events.elms && d.alpha_ped > 1 && t - this.lastElm > tRef) {
        const rhoPed = 1 - ps.pedestalWidth;
        const fW = ps.elmFraction * (0.8 + 0.4 * this.rng.next());
        const before = this.crashHook ? this.crashSnap(v) : null;
        // tip-I ELM: pedestal + iç komşu bölge (~0.15 ρ) etkilenir (Loarte et al., PPCF 45 (2003) 1549)
        const dW = elmCrash(g, v.Te, v.Ti, v.ne, w.ni, this.bc.Te, this.bc.Ti, this.bc.n, rhoPed, fW, 0.5 * fW, 0.15);
        if (before) this.crashHook!('ELM', t, before, this.crashSnap(v));
        s[S.NHe] *= 1 - 0.1 * fW; s[S.cZ] *= 1 - 0.1 * fW;
        s[S.Pelm] += dW / 1.0; // üstel ortalama (τ = 1 s) içine enerji darbesi
        this.lastElm = t;
        this.elmTimes.push(t); if (this.elmTimes.length > 20) this.elmTimes.shift();
        this.dt = Math.min(this.dt, Math.max(0.01 * (d.tauE ?? 0.1), 5e-4));
        this.diagStale = true;
        ev.push({ t, kind: 'ELM', msg: `Type-I ELM (α_ped/α_crit = ${d.alpha_ped.toFixed(2)}): ΔW = ${(dW / 1e6).toFixed(2)} MJ`, value: dW / 1e6 });
      }
      // testere dişi: q=1 yüzeyinde kayma s₁ > s_kritik
      if (c.events.sawteeth && t - this.lastSaw > 0.05) {
        const r1 = rhoOfQ(g, w.qF, 1);
        if (r1 > 0.05 && r1 < 0.8) {
          const s1 = shearAt(g, w.qF, r1);
          if (s1 > ps.sawtoothShear) {
            const rmix = Math.min(kadomtsevMixingRadius(g, w.qF), 0.95);
            if (rmix > r1) {
              const Te0 = v.Te[0];
              const before = this.crashHook ? this.crashSnap(v) : null;
              flattenConserving(g, v.Te, v.ne, r1, rmix);
              flattenConserving(g, v.Ti, w.ni, r1, rmix);
              flattenConserving(g, v.ne, null, r1, rmix);
              // q → max(q, 1.01) karışım bölgesinde; ψ'yi ρ_mix'ten içe yeniden kur
              const iMix = Math.min(N - 1, Math.floor(rmix / g.dRho));
              for (let f = 1; f <= iMix; f++) {
                if (w.qF[f] < 1.01) w.dpsiF[f] = (g.PhiB * g.rhoF[f]) / (Math.PI * 1.01);
              }
              for (let i = iMix - 1; i >= 0; i--) v.psi[i] = v.psi[i + 1] - w.dpsiF[i + 1] * g.dRho;
              this.currentProfiles(v.psi, s[S.Ip]);
              if (before) this.crashHook!('sawtooth', t, before, this.crashSnap(v));
              this.lastSaw = t;
              this.dt = Math.min(this.dt, 5e-3);
              this.diagStale = true;
              ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash (s₁ = ${s1.toFixed(2)}): ρ(q=1) = ${r1.toFixed(2)}, ρ_mix = ${rmix.toFixed(2)}, T_e0 ${Te0.toFixed(1)} → ${v.Te[0].toFixed(1)} keV`, value: (Te0 - v.Te[0]) / Te0 });
              // NTM tohumu
              if (c.events.ntm) {
                const wd = 0.012 * (g.a / 2);
                if (rhoOfQ(g, w.qF, 1.5) > 0 && s[S.w32] < 2.5 * wd && d.betaN > 0.5 * c.limits.betaN_limit) s[S.w32] = 2.5 * wd;
                if (rhoOfQ(g, w.qF, 2) > 0 && s[S.w21] < 2 * wd && d.betaN > 0.75 * c.limits.betaN_limit) s[S.w21] = 2 * wd;
              }
            }
          }
        }
      }
      // NTM başlangıç / sönüm olayları
      for (const [key, name] of [[S.w32, '3/2'], [S.w21, '2/1']] as const) {
        const on = s[key] > 0.02 * g.a;
        const flag = key === S.w32 ? this.ntmOn32 : this.ntmOn21;
        if (on && !flag) ev.push({ t, kind: 'NTM_onset', msg: `NTM ${name} island grew to w/a = ${(s[key] / g.a).toFixed(3)} (β_N = ${d.betaN.toFixed(2)}) — local profile flattening, τ_E degrading` });
        if (!on && flag) ev.push({ t, kind: 'NTM_gone', msg: `NTM ${name} island decayed` });
        if (key === S.w32) this.ntmOn32 = on; else this.ntmOn21 = on;
      }
      // ateşleme / yanma
      const P_loss_total = d.P_rad + d.P_cond;
      const ignOn = d.P_alpha >= P_loss_total && d.P_fus > 1 && d.Q >= 5;
      const ignOff = d.P_alpha < 0.9 * P_loss_total || d.Q < 4;
      if (ignOn && !this.ignited) { this.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${d.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
      if (ignOff && this.ignited) { this.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
      if (d.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: 'Q ≥ 1 (scientific breakeven)' }); }
      if (d.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }
      // uyarılar
      if (d.q_div > 10 && !this.warned.has('div')) { this.warned.add('div'); ev.push({ t, kind: 'warning', msg: `Divertor heat flux ${d.q_div.toFixed(0)} MW/m² > 10 MW/m² — material lifetime at risk` }); }
      if (d.nG_frac > 0.85 && !this.warned.has('nG')) { this.warned.add('nG'); ev.push({ t, kind: 'warning', msg: `n̄/n_G = ${d.nG_frac.toFixed(2)} — approaching the density limit` }); }
      if (d.betaN > 0.85 * c.limits.betaN_limit && !this.warned.has('bN')) { this.warned.add('bN'); ev.push({ t, kind: 'warning', msg: `β_N = ${d.betaN.toFixed(2)} — approaching the Troyon limit` }); }
      // limitler → disruption
      let cause: DisruptionCause = 'none', diag = '';
      if (d.nG_frac > c.limits.greenwald_limit) { cause = 'density_limit'; diag = `n̄/n_G reached ${d.nG_frac.toFixed(2)}`; }
      else if (d.betaN > c.limits.betaN_limit) { cause = 'beta_limit'; diag = `β_N ${d.betaN.toFixed(2)} > ${c.limits.betaN_limit}`; }
      else if (d.q95 < c.limits.q95_limit) { cause = 'q95_limit'; diag = `q95 = ${d.q95.toFixed(2)} < ${c.limits.q95_limit}`; }
      else if (s[S.w21] > 0.1 * g.a) { cause = 'ntm_locked_mode'; diag = `2/1 island w/a = ${(s[S.w21] / g.a).toFixed(3)} > 0.10 — mode locked to the wall`; }
      else if (d.cZ > c.limits.W_conc_limit && c.impurity.species === 'W') { cause = 'tungsten_accumulation'; diag = `c_W = ${d.cZ.toExponential(1)} > ${c.limits.W_conc_limit.toExponential(1)}`; }
      else if (d.P_rad > d.P_heat && t > 0.5 && d.Te < 2) { cause = 'radiative_collapse'; diag = `P_rad ${d.P_rad.toFixed(1)} MW > P_heat ${d.P_heat.toFixed(1)} MW, ⟨T_e⟩ fell to ${d.Te.toFixed(2)} keV`; }
      if (cause !== 'none') {
        this.disruptCause = cause; this.tDisrupt = t; this.Wd = d.W * 1e6; this.IpD = s[S.Ip];
        this.phase = 'thermal_quench'; this.diagText = diag;
        ev.push({ t, kind: 'disruption', msg: `DISRUPTION: ${DISRUPTION_LABELS[cause]} — ${diag}` });
      }
    } else if (this.phase === 'thermal_quench') {
      if (d.W * 1e6 < 0.02 * this.Wd || t - this.tDisrupt > 0.05) {
        this.phase = 'current_quench';
        ev.push({ t, kind: 'quench', msg: `Thermal quench complete (${((t - this.tDisrupt) * 1e3).toFixed(1)} ms) → current quench starting` });
      }
    } else if (this.phase === 'current_quench') {
      if (s[S.Ip] < 0.03 * this.IpD) {
        this.phase = 'ended';
        const rep = disruptionReport({ cause: this.disruptCause, t: this.tDisrupt, g: this.geomB, Ip_MA: this.IpD / 1e6, W_th_J: this.Wd, B0: c.B0 });
        this.terminated = {
          t, natural: false, reason: DISRUPTION_LABELS[this.disruptCause],
          diagnosis: `${DISRUPTION_LABELS[this.disruptCause]} — ${this.diagText}, t = ${this.tDisrupt.toFixed(2)} s. Thermal quench ${rep.tau_TQ_ms.toFixed(1)} ms, current quench ${rep.tau_CQ_ms.toFixed(0)} ms; halo current I_h/I_p·TPF = ${rep.halo_TPF_product.toFixed(2)}; runaway electron avalanche e^${rep.runaway_avalanche_efolds.toFixed(0)} → ~${rep.runaway_current_MA.toFixed(1)} MA; wall deposition ${rep.wall_energy_density_MJm2.toFixed(1)} MJ/m².`,
          fix: DISRUPTION_FIXES[this.disruptCause], disruption: rep,
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

  /** Disruption fazları: termal söndürme (τ_TQ), akım söndürme (τ_CQ) — profiller ölçeklenir */
  private disruptionStep(t: number, y: Float64Array, tMax: number): number {
    const v = this.views(y), s = v.s, N = this.N, g = this.tg;
    const tauTQ = 1e-3 * (g.a / 2.0) * (1 + 0.5 * Math.log(1 + this.IpD / 5e6));
    const tauCQ = 4.0e-3 * Math.PI * g.a * g.a * this.geomB.kappa;
    const tau = this.phase === 'thermal_quench' ? tauTQ : tauCQ;
    const dt = Math.min(tau / 5, tMax - t);
    const fT = Math.exp(-dt / tauTQ), fN = Math.exp(-dt / 0.05);
    for (let i = 0; i < N; i++) {
      v.Te[i] = 0.005 + (v.Te[i] - 0.005) * fT;
      v.Ti[i] = 0.005 + (v.Ti[i] - 0.005) * fT;
      v.ne[i] *= fN;
    }
    if (this.phase === 'current_quench') s[S.Ip] *= Math.exp(-dt / tauCQ);
    this.composition(v.Te, v.ne, s);
    let W = 0;
    for (let i = 0; i < N; i++) W += 1.5 * (v.ne[i] * v.Te[i] + this.w.ni[i] * v.Ti[i]) * KEV * g.dV[i];
    Object.assign(this.lastDiag, {
      W: W / 1e6, Te: this.volAvg(v.Te), Ti: this.volAvg(v.Ti), Te0: v.Te[0], Ti0: v.Ti[0], Ip: s[S.Ip] / 1e6,
      P_fus: 0, P_alpha: 0, P_aux: 0, P_heat: 0, Q: 0, P_bt: 0, P_neutron: 0, P_charged: 0,
    });
    this.dt = dt;
    return t + dt;
  }

  // ------------------------------------------------------------------ SimModel arayüzü
  diagnostics(t: number, y: Float64Array): Record<string, number> {
    if (!this.lastDiag.Te || this.diagStale) {
      // ilk kare veya ELM/testere dişi çöküşünden sonra: teşhisi y'den yeniden üret (adım atmadan)
      this.diagStale = false;
      const tauPrev = this.lastDiag.tauE ?? 0.1;
      const tauScal = this.lastDiag.tauE_scal ?? tauPrev;
      const v = this.views(y);
      const K = this.evaluateWorkArrays(t, y);
      const g = this.tg, I = (a: Float64Array) => volumeIntegral(g, a);
      let W = 0;
      for (let i = 0; i < this.N; i++) W += 1.5 * (v.ne[i] * v.Te[i] + this.w.ni[i] * v.Ti[i]) * KEV * g.dV[i];
      const P_aux_abs = I(this.w.PnbiE) + I(this.w.PnbiI) + I(this.w.PicE) + I(this.w.PicI) + I(this.w.PecE);
      const P_rad = I(this.w.Pbr) + I(this.w.Pline) + K.Psync;
      const P_heat = P_aux_abs + I(this.w.Poh) + I(this.w.Pchg);
      const P_loss = this.lossPower(P_heat, P_rad);
      const tauE = this.ps.transportModel === 'cgm' ? W / P_loss : tauPrev;
      this.writeDiagnostics(t, y, {
        P_fus: I(this.w.Pfus), P_chg: I(this.w.Pchg), P_neut: I(this.w.Pneut), P_bt: I(this.w.Pbt), P_aux_abs, P_oh: I(this.w.Poh), P_alpha: I(this.w.Pchg),
        P_brems: I(this.w.Pbr), P_line: I(this.w.Pline), P_sync: K.Psync, P_rad, P_heat, W, dWdt: 0, tauE, tauScal, P_loss, nbar: this.lineAvg(v.ne), P_bound: 0,
      });
    }
    return { ...this.lastDiag };
  }
  private diagStale = false;

  /** Loss power for τ_E [W]: heating minus radiation, floored against radiation-dominated states */
  private lossPower(P_heat: number, P_rad: number): number {
    return Math.max(P_heat - P_rad, 0.1 * P_heat, 0.5e6 * (this.tg.volume / 100));
  }

  /**
   * Evaluates every work array (composition, q and current profiles, sources, transport
   * coefficients, pressure) from the state y without taking a step. Used for diagnostics of a
   * state no step produced (first frame, after an MHD crash) and after an equilibrium swap, so
   * that postStep and the MHD events never read arrays of the old geometry.
   */
  private evaluateWorkArrays(t: number, y: Float64Array): StepConstants {
    const v = this.views(y);
    this.composition(v.Te, v.ne, v.s);
    this.currentProfiles(v.psi, v.s[S.Ip]);
    const K = this.stepConstants(t, v.Te, v.Ti, v.ne, v.s);
    this.lastK = K;
    this.transportCoefficients(v.Te, v.Ti, v.ne, v.s);
    this.plasmaSources(v.Te, v.Ti, v.ne, K);
    this.currentSources(v.Te, v.Ti, v.ne, v.psi, K);
    return K;
  }

  profiles(_y: Float64Array): Record<string, number[]> { return this.lastProf; }

  applyControl(patch: Record<string, number>): void {
    for (const k of Object.keys(patch)) if (k in this.ctrl) this.ctrl[k] = patch[k];
  }
  getControls(): Record<string, number> { return { ...this.ctrl }; }
  /**
   * Checkpoint of everything that the continuation of the shot depends on besides y: the
   * equilibrium and transport geometry (with the GS warm start, eq.psi), the update bookkeeping,
   * the controller and filter states (n_sep gain, P_SOL filter, Γ_b, τ_E used by the fueling
   * loop; the C_χ integrator and the fueling lag live in y), MHD and disruption state, counters and
   * the RNG. Numbers go into the returned record; references and strings stay in a model-side
   * store under the record's `ck` key, which restoreInternal prunes of checkpoints after the one
   * restored (their frames are discarded by the rewind). Actuator set-points (applyControl) are
   * deliberately not part of it: after a rewind the latest controls stay in force.
   */
  saveInternal(): Record<string, number> {
    const ck = this.nextCheckpoint++;
    this.checkpoints.set(ck, { geo: this.geo, diagText: this.diagText, disruptCause: this.disruptCause, elmTimes: this.elmTimes.slice(), warned: [...this.warned] });
    return {
      ck, rng: this.rng.getState(), phase: PHASES.indexOf(this.phase),
      hmode: +this.hmode, lastSaw: this.lastSaw, lastElm: this.lastElm, ignited: +this.ignited, burning: +this.burning,
      dt: this.dt, eqTime: this.eqTime, PSOL: this.PSOL, GammaB: this.GammaB, TeB: this.bc.Te, TiB: this.bc.Ti, nB: this.bc.n, nsepGain: this.nsepGain,
      eqBetaP: this.eqBetaP, eqLi: this.eqLi, eqRetryAt: this.eqRetryAt, eqFailStreak: this.eqFailStreak,
      eqUpdates: this.eqUpdates, eqRetried: this.eqRetried, eqRejected: this.eqRejected, forcedSteps: this.forcedSteps,
      tauE: this.lastDiag.tauE ?? NaN, alphaRatio: this.alphaRatio, lastVloop: this.lastVloop,
      ntmOn32: +this.ntmOn32, ntmOn21: +this.ntmOn21, tDisrupt: this.tDisrupt, Wd: this.Wd, IpD: this.IpD,
    };
  }
  restoreInternal(st: Record<string, number>): void {
    const num = (k: string, dflt: number) => (Number.isFinite(st[k]) ? st[k] : dflt);
    this.rng.setState(st.rng);
    this.phase = PHASES[st.phase] ?? 'normal';
    this.hmode = !!st.hmode; this.lastSaw = st.lastSaw; this.lastElm = st.lastElm; this.ignited = !!st.ignited; this.burning = !!st.burning;
    this.dt = num('dt', 1e-3); this.eqTime = num('eqTime', 0); this.PSOL = num('PSOL', 0); this.GammaB = num('GammaB', 0);
    this.bc = { Te: num('TeB', 0.1), Ti: num('TiB', num('TeB', 0.1)), n: num('nB', 1e19) };
    this.nsepGain = num('nsepGain', 1);
    this.eqBetaP = num('eqBetaP', this.eqBetaP); this.eqLi = num('eqLi', this.eqLi);
    this.eqRetryAt = num('eqRetryAt', 0); this.eqFailStreak = num('eqFailStreak', 0);
    this.eqUpdates = num('eqUpdates', this.eqUpdates); this.eqRetried = num('eqRetried', this.eqRetried);
    this.eqRejected = num('eqRejected', this.eqRejected); this.forcedSteps = num('forcedSteps', this.forcedSteps);
    this.alphaRatio = num('alphaRatio', 0); this.lastVloop = num('lastVloop', 0);
    this.ntmOn32 = !!st.ntmOn32; this.ntmOn21 = !!st.ntmOn21;
    this.tDisrupt = num('tDisrupt', 0); this.Wd = num('Wd', 0); this.IpD = num('IpD', 0);
    this.terminated = null; this.stepFailure = null; this.pending = []; this.diagStale = false;
    // τ_E of the last diagnostics feeds the fueling loop of the next step; the rest is rebuilt from y
    this.lastDiag = Number.isFinite(st.tauE) ? { tauE: st.tauE } : {};
    const aux = this.checkpoints.get(st.ck);
    if (aux) {
      if (aux.geo !== this.geo) this.adoptGeometry(aux.geo);
      this.diagText = aux.diagText; this.disruptCause = aux.disruptCause;
      this.elmTimes = aux.elmTimes.slice(); this.warned = new Set(aux.warned);
      for (const k of this.checkpoints.keys()) if (k > st.ck) this.checkpoints.delete(k);
    } else {
      // a record from elsewhere (no stored references): keep the current equilibrium
      this.warned.clear(); this.elmTimes = [];
    }
  }
  /** references and strings of each checkpoint, by the record's `ck` */
  private checkpoints = new Map<number, { geo: EqGeometry; diagText: string; disruptCause: DisruptionCause; elmTimes: number[]; warned: string[] }>();
  private nextCheckpoint = 0;
  geometryInfo(): Record<string, number> {
    const c = this.cfg, eq = this.eq;
    return {
      R: this.geomB.R, a: this.geomB.a, kappa: this.geomB.kappa, delta: this.geomB.delta, B0: c.B0, Ip_MA: c.Ip_MA,
      V: this.tg.volume, S: this.tg.surface, stellarator: 0, gap: c.magnet.gap_m, coilThickness: c.magnet.coilThickness_m, B_coil: this.magnetInfo.B_coil,
      profiles: 1, nRho: this.N, Raxis: eq.Raxis, shafranov: eq.shafranovShift, rhoTorB: eq.rhoTorB,
    };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const last = hist[hist.length - 1];
    const d = last.d;
    const avg = (k: string) => flatTopMean(hist, k, { samples: 'all' });
    const warnings: string[] = [];
    if (this.eq && !this.eq.converged) warnings.push('Grad–Shafranov equilibrium did not fully converge — geometry coefficients may be inaccurate.');
    const nEq = this.eqUpdates + this.eqRejected;
    if (this.eqRejected > 0) warnings.push(`Grad–Shafranov: ${this.eqRejected} of ${nEq} equilibrium updates were rejected (no convergence in any retry stage) — the transport geometry was held at the last accepted equilibrium in between.`);
    if (this.forcedSteps > 0) warnings.push(`${this.forcedSteps} transport step(s) exhausted the Δt retries and were forced at the smallest Δt without Picard convergence — accuracy is reduced around those times.`);
    const nElm = events.filter((e) => e.kind === 'ELM').length;
    const nSaw = events.filter((e) => e.kind === 'sawtooth').length;
    return buildMagneticReport({
      cfg: this.cfg, method: this.method, g: this.geomB, V: this.tg.volume, magnetInfo: this.magnetInfo,
      terminated: this.terminated, tDisrupt: this.tDisrupt, isStell: false,
      extraWarnings: warnings,
      extraEngineering: {
        'Model': '1.5D profiles + Grad–Shafranov',
        'Bootstrap fraction (avg.)': +avg('f_bs').toFixed(3), 'Driven-current fraction (avg.)': +avg('f_cd').toFixed(3),
        'Loop voltage (avg., V)': +avg('V_loop').toFixed(3), 'ℓ_i(3) (avg.)': +avg('li').toFixed(3), 'β_p (avg.)': +avg('betaP').toFixed(3),
        'q(0) / q95 (final)': `${(d.q0 ?? 0).toFixed(2)} / ${(d.q95 ?? 0).toFixed(2)}`,
        'Shafranov shift (m)': +this.eq.shafranovShift.toFixed(3),
        'GS updates accepted': this.eqUpdates, 'GS updates needing a retry': this.eqRetried, 'GS updates rejected': this.eqRejected,
        'Forced transport steps': this.forcedSteps,
      },
      extraExtras: {
        'T_e axis (final, keV)': +(d.Te0 ?? 0).toFixed(2), 'T_ped (final, keV)': +(d.Tped ?? 0).toFixed(2), 'T_sep (final, keV)': +(d.Tsep ?? 0).toFixed(3),
        'ELM frequency (Hz)': this.elmTimes.length > 2 ? +((this.elmTimes.length - 1) / (this.elmTimes[this.elmTimes.length - 1] - this.elmTimes[0])).toFixed(2) : 0,
        'Sawtooth period (s)': nSaw > 1 ? +(last.t / nSaw).toFixed(2) : 0,
        'ELM count (1.5D)': nElm,
      },
    }, hist, events);
  }
}
