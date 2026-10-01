/**
 * Shared state of one 1.5D shot: configuration, current equilibrium and transport geometry, work
 * arrays, and the plasma and controller state that is not part of the state vector y.
 *
 * Every physics module of the profile model (composition, sources, transport, controllers,
 * events, diagnostics) reads and writes this object; ProfileModel owns it and orders the calls.
 * Modules keep their own private state (event timers, caches) and register geometry-dependent
 * caches with onGeometry so that they are rebuilt whenever an equilibrium is adopted.
 */
import { boundaryShape, type Geometry } from '../geometry';
import { FUEL_SPECIES } from '../reactivity';
import type { DisruptionCause } from '../disruption';
import { RNG } from '../rng';
import type { Equilibrium } from '../equilibrium/gs';
import type { MagneticConfig, ProfileSettings, SimEvent, TerminationInfo } from '../types';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { checkProfileSettings, type SettingNote } from './settings';
import { CurrentProgramme, currentWaveform, IP_PROGRAMME_FLOOR } from './control/plasmaCurrent';
import { gridSpec, type GridSpec, type TransportGeometry } from './geometry1d';
import { FluxLedger } from './current/flux';
import { CurrentSolver, DensitySolver, HeatSolver } from './fvsolver';
import { impurityStateSize } from './impurity/config';
import type { ImpurityModel } from './impurity/model';
import { volumeIntegral } from './sources/deposition';
import type { BootstrapCoeffs } from './neoclassical';
import { ProfileState, StateLayout } from './state';
import { WorkArrays, allocateWorkArrays } from './work';

export const KEV = 1.602176634e-16; // J/keV
export const MU0 = 1.25663706212e-6;
export const AMU = 1.66053906660e-27;

/** Operating phase of the discharge */
export type Phase = 'normal' | 'thermal_quench' | 'current_quench' | 'ended';
/** Phase codes of the checkpoint record (index into this list) */
export const PHASES: readonly Phase[] = ['normal', 'thermal_quench', 'current_quench', 'ended'];

/** An accepted equilibrium and the transport geometry built from it (shared by reference) */
export interface EqGeometry { eq: Equilibrium; tg: TransportGeometry }

/** Quantities held fixed over one implicit step (evaluated from the old state) */
export interface StepConstants {
  /** absorbed auxiliary powers after the ramp [W] */
  P_NBI: number; P_IC: number; P_EC: number;
  /** NBI shine-through fraction */
  shine: number;
  /** beam-target reaction rate per channel of the fuel (FUEL_CHANNELS order) and cell [m⁻³ s⁻¹] */
  btR: Float64Array[];
  /** effective beam energy for current drive [keV] */
  Eb: number;
  /** total synchrotron power [W] */
  Psync: number;
  /** NBI particle source [1/s] */
  S_nbi: number;
}

/** Separatrix boundary values of the transport equations: T_e, T_i [keV], n_e [m⁻³] */
export interface BoundaryValues { Te: number; Ti: number; n: number }

/** Actuator set-points (live control: Simulation.applyControl) */
export interface Actuators {
  P_NBI_MW: number; P_ICRH_MW: number; P_ECRH_MW: number;
  n_target_1e20: number; H98: number; cZ: number; fuelRate_1e20s: number;
  /**
   * plasma current [MA]: the boundary condition of the current diffusion for the next step (control/plasmaCurrent.ts). Present unless a
   * programme I_p(t) (`ProfileSettings.IpWaveform`, `ProfileModules.plasmaCurrent`) drives the current: then the programme is the only source
   */
  Ip_MA?: number;
}

/** State of a disruption once a limit has been crossed */
export interface DisruptionState {
  cause: DisruptionCause;
  /** time of the thermal-quench onset [s] */
  t: number;
  /** stored energy and plasma current at the onset [J, A] */
  W: number;
  Ip: number;
  /** what crossed which limit */
  text: string;
}

/** MHD crash snapshot at the cell centres: T [keV], n_e [10²⁰ m⁻³], q */
export interface CrashSnapshot { rho: number[]; Te: number[]; Ti: number[]; ne: number[]; q: number[] }
export type CrashHook = (kind: 'sawtooth' | 'ELM', t: number, before: CrashSnapshot, after: CrashSnapshot) => void;

/**
 * Settings of a shot: defaults, the interval rule for equilibrium updates, then the user's. A user
 * setting that is `undefined` (or `null`) is blank, not a value: the setup wizard stores that for
 * an emptied input, and it leaves the default (or, for the optional settings without one, the
 * documented "blank" behaviour) in force. Spreading it would overwrite the default with undefined.
 *
 * The step-control settings rtol, atol and dtMax that are outside their domain (settings.ts) are replaced by the default; `notes` lists
 * what was replaced.
 */
export function resolveProfileSettings(cfg: MagneticConfig): { ps: ProfileSettings; notes: SettingNote[] } {
  const user: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.profiles ?? {})) if (v !== undefined && v !== null) user[k] = v;
  return checkProfileSettings({ ...DEFAULT_PROFILE_SETTINGS, eqUpdateInterval: Math.min(Math.max(cfg.t_end / 20, 0.5), 20), ...(user as Partial<ProfileSettings>) });
}

/** The settings of a shot (resolveProfileSettings without the notes) */
export function profileSettings(cfg: MagneticConfig): ProfileSettings { return resolveProfileSettings(cfg).ps; }

export class ProfileContext {
  // ---------------------------------------------------------------- configuration
  readonly cfg: MagneticConfig;
  readonly ps: ProfileSettings;
  /** radial cells */
  readonly N: number;
  /** edge packing of the cells (ProfileSettings.gridPacking; undefined: the uniform grid); every transport geometry is built with it */
  readonly grid: GridSpec | undefined;
  readonly layout: StateLayout;
  /** Grad–Shafranov boundary shape (LCFS) */
  readonly geomB: Geometry;
  /** mean fuel ion mass [amu] */
  readonly M: number;
  /** density pinch shape: source-free steady state n ∝ exp(−P ρ²) */
  readonly Pn: number;
  /** stochastic events (ELM size); part of the checkpoint */
  readonly rng: RNG;
  readonly ctrl: Actuators;
  /** plasma-current programme I_p(t) [A] (control/plasmaCurrent.ts); null: I_p is the control `Ip_MA` (the configured current until it is changed) */
  ipProgramme: CurrentProgramme | null;

  // ---------------------------------------------------------------- equilibrium and geometry
  geo!: EqGeometry;
  eq!: Equilibrium;
  tg!: TransportGeometry;
  heat!: HeatSolver;
  dens!: DensitySolver;
  cur!: CurrentSolver;
  /** volume-equivalent elongation V/(2π² R a²) of the transport geometry */
  kappaA = 1;
  /** the equilibrium changed since the last flux-surface snapshot */
  eqDirty = true;
  private geometryListeners: ((tg: TransportGeometry) => void)[] = [];

  // ---------------------------------------------------------------- work arrays
  readonly w: WorkArrays;
  /** Sauter bootstrap coefficients per cell, evaluated once per step */
  sauter: BootstrapCoeffs[] = [];
  /** step constants of the last evaluation (read by the accepted-step update and diagnostics) */
  lastK: StepConstants | null = null;
  /** profile-resolved He ash and impurities (impurity/, ProfileSettings.impurityTransport other than 'legacy'); null: the scalar inventories of composition.ts */
  impurity: ImpurityModel | null = null;

  // ---------------------------------------------------------------- plasma and controller state
  phase: Phase = 'normal';
  hmode = false;
  /** α_ped/α_crit of the last diagnostics (kinetic-ballooning clamp of the pedestal) */
  alphaRatio = 0;
  bc: BoundaryValues = { Te: 0.1, Ti: 0.1, n: 1e19 };
  /** P_SOL, filtered global power balance [W] */
  PSOL = 0;
  /**
   * dW/dt of the loss power P_L = P_heat − P_rad,core − dW/dt: the rate of change of the stored
   * energy including the energy the ELM crashes take out of it, low-pass filtered with τ_E [W]
   */
  dWdtS = 0;
  /** energy taken out of the plasma by the ELM crashes since the last accepted step [J] */
  crashE = 0;
  /**
   * energy content of the fast charged fusion products and of the NBI fast ions [J]: pools that
   * relax towards the steady slowing-down content with τ_W (fastIons.ts), as in the 0D model
   */
  WfAlpha = 0;
  WfBeam = 0;
  /** ignition state (P_α ≥ P_rad + W/τ_E, with hysteresis): a diagnostic and the report's ignition time */
  ignited = false;
  /** heating.autoOff: the time at which the external heating starts to ramp down (Infinity = it stays on) */
  tAuxOff = Infinity;
  /** particle outflux through the boundary Γ_b [1/s] */
  GammaB = 0;
  /**
   * power conducted and convected across the separatrix by the solution of the last implicit
   * attempt [W] (HeatSolver.boundaryLoss with that attempt's inputs; diagnostics only)
   */
  Pbound = 0;
  /** gas-puff gain of the separatrix density */
  nsepGain = 1;
  /** proposed next time step [s] */
  dt = 1e-3;
  /** loop voltage of the last step [V] (current/flux.ts sets it) */
  lastVloop = 0;
  /** flux accounting: boundary and resistive flux, the flux drawn from the solenoid (current/flux.ts) */
  readonly flux: FluxLedger;
  disruption: DisruptionState = { cause: 'none', t: 0, W: 0, Ip: 0, text: '' };

  // ---------------------------------------------------------------- output
  lastDiag: Record<string, number> = {};
  lastProf: Record<string, number[]> = {};
  /** the state was changed outside a step (MHD crash): diagnostics are re-evaluated from y */
  diagStale = false;
  terminated: TerminationInfo | null = null;
  /** events raised inside step() (GS rejection, numerical trouble); postStep emits them */
  pending: SimEvent[] = [];
  /** keys of the one-time warnings already issued */
  warned = new Set<string>();
  /** optional profile snapshots just before and after an MHD crash (figures; no effect on the run) */
  crashHook: CrashHook | null = null;

  constructor(cfg: MagneticConfig) {
    this.cfg = cfg;
    const resolved = resolveProfileSettings(cfg);
    this.ps = resolved.ps;
    // a setting that was replaced is said once, at the start of the shot (the first step's events)
    for (const n of resolved.notes) this.warnOnce(`settings.${n.key}`, 0, `${n.message}.`);
    this.N = Math.max(16, Math.round(this.ps.nRho));
    this.grid = gridSpec(this.ps);
    this.layout = new StateLayout(this.N, impurityStateSize(cfg, this.ps, this.N));
    this.w = allocateWorkArrays(this.N);
    this.flux = new FluxLedger(this.N);
    const g0 = cfg.geometry;
    // the LCFS shape of the boundary is the one the 0D volume, surface and scalings use (geometry.boundaryShape): an edited geometry.kappa or
    // geometry.delta of a preset that carries profiles.lcfsRef95 (ITER15, DEMO15) moves it in the ratio to the 95 % shape (bitwise unchanged at the presets)
    const gb = boundaryShape({ geometry: g0, profiles: this.ps });
    this.geomB = { R: gb.R, a: gb.a, kappa: gb.kappa, delta: gb.delta };
    const fs = FUEL_SPECIES[cfg.fuel];
    this.M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    this.rng = new RNG(cfg.seed);
    this.ipProgramme = this.ps.IpWaveform ? currentWaveform(this.ps.IpWaveform) : null;
    this.ctrl = {
      P_NBI_MW: cfg.heating.P_NBI_MW, P_ICRH_MW: cfg.heating.P_ICRH_MW, P_ECRH_MW: cfg.heating.P_ECRH_MW,
      n_target_1e20: cfg.n_target / 1e20, H98: cfg.H98, cZ: cfg.impurity.concentration,
      fuelRate_1e20s: cfg.fueling.maxRate_1e20s,
    };
    if (!this.ipProgramme) this.ctrl.Ip_MA = cfg.Ip_MA;
    // pinch parameter: source-free equilibrium n ∝ exp(−P ρ²) has n(0)/⟨n⟩ = 1 + α_n
    const target = 1 + cfg.transport.alpha_n;
    let P = 0.5;
    for (let it = 0; it < 60; it++) { const f = P / (1 - Math.exp(-P)) - target; const df = (1 - Math.exp(-P) - P * Math.exp(-P)) / (1 - Math.exp(-P)) ** 2; P = Math.max(1e-3, P - f / df); }
    this.Pn = cfg.transport.alpha_n > 1e-3 ? P : 1e-3;
  }

  /** Views of a state vector */
  view(y: Float64Array): ProfileState { return this.layout.view(y); }

  /**
   * The plasma current that a step ending at time t takes as its boundary condition [A], at least 0.05 MA: the programme at t, or without one
   * the control `Ip_MA` (a set-point that holds over the whole step: the kernel changes it at step boundaries). A control that is not a number
   * is the configured current.
   */
  ipAt(t: number): number {
    const p = this.ipProgramme;
    if (p) return Math.max(p(t), IP_PROGRAMME_FLOOR);
    const c = this.ctrl.Ip_MA;
    return Math.max(c !== undefined && Number.isFinite(c) ? c : this.cfg.Ip_MA, 0.05) * 1e6;
  }

  /** Puts a programme I_p(t) in place of the control `Ip_MA`, which is then no longer one of the controls (the programme is the only source of the current) */
  setCurrentProgramme(p: CurrentProgramme): void {
    this.ipProgramme = p;
    delete this.ctrl.Ip_MA;
  }

  /** Registers a cache that depends on the transport geometry; called now if a geometry exists and on every adoptGeometry */
  onGeometry(f: (tg: TransportGeometry) => void): void {
    this.geometryListeners.push(f);
    if (this.tg) f(this.tg);
  }

  /**
   * Makes an accepted equilibrium and its transport geometry current. The work arrays depend only
   * on N and keep their values; after a swap mid-shot the caller re-evaluates them on the new
   * geometry before anything reads them.
   */
  adoptGeometry(geo: EqGeometry): void {
    this.geo = geo;
    this.eq = geo.eq;
    const tg = geo.tg;
    this.tg = tg;
    this.heat = new HeatSolver(tg);
    this.dens = new DensitySolver(tg);
    this.cur = new CurrentSolver(tg);
    this.kappaA = tg.volume / (2 * Math.PI * Math.PI * this.geomB.R * this.geomB.a * this.geomB.a);
    for (const f of this.geometryListeners) f(tg);
    this.eqDirty = true;
  }

  /** Volume average */
  volAvg(a: ArrayLike<number>): number { return volumeIntegral(this.tg, a) / this.tg.volume; }
  /** Mid-plane line average */
  lineAvg(a: ArrayLike<number>): number {
    const g = this.tg;
    let s = 0;
    for (let i = 0; i < g.N; i++) s += a[i] * (g.RoutF[i + 1] - g.RoutF[i] + g.RinF[i] - g.RinF[i + 1]);
    return s / (g.RoutF[g.N] - g.RinF[g.N]);
  }

  /** Pushes a warning event the first time `key` is seen; returns whether it did */
  warnOnce(key: string, t: number, msg: string, out: SimEvent[] = this.pending): boolean {
    if (this.warned.has(key)) return false;
    this.warned.add(key);
    out.push({ t, kind: 'warning', msg });
    return true;
  }

  /**
   * Stored thermal energy W = Σ 3/2 (n_e T_e + n_i T_i) ΔV [J]: the one definition of W of the model
   * (accepted step, diagnostics of a state no step produced, quench). ni: the ion density of the
   * state (default: the work array of the current composition; ctx.w.ni0 for the old state of a step).
   */
  storedEnergy(st: ProfileState, ni: ArrayLike<number> = this.w.ni): number {
    const g = this.tg, N = this.N;
    let W = 0;
    for (let i = 0; i < N; i++) W += 1.5 * (st.ne[i] * st.Te[i] + ni[i] * st.Ti[i]) * KEV * g.dV[i];
    return W;
  }

  crashSnapshot(st: ProfileState): CrashSnapshot {
    return { rho: Array.from(this.tg.rhoC), Te: Array.from(st.Te), Ti: Array.from(st.Ti), ne: Array.from(st.ne, (x) => x * 1e-20), q: Array.from(this.w.q) };
  }
}
