/**
 * Profile-resolved helium ash and impurities of the 1.5D model (ProfileSettings.impurityTransport 'anomalous' | 'facit').
 *
 * WHAT IT DOES. The densities n_He(rho) and n_Z(rho) of the intrinsic impurity, of the seeded species and of an optional third species
 * are part of the state vector (state.ts extras, one block of N cells per species) and evolve by the particle equation
 *
 *     dn_z/dt = -(1/V') d/drho V' Gamma_z + S_z,     Gamma_z = -g1 D_z dn_z/drho + <|grad rho|> v_z n_z,
 *
 * on the exponentially fitted (Scharfetter-Gummel) finite-volume solver of the electrons (fvsolver.ts DensitySolver: one implicit
 * backward-Euler solve per species and accepted step, positive and conservative to round-off), with D_z and v_z from transport.ts:
 * the electron D and v scaled (anomalous) plus, in mode 'facit', the neoclassical coefficients of FACIT (facit.ts). The quasi-neutral
 * composition (fuel ions, Z_eff(rho), the ion sum) reads the profiles (composition() delegates here), so Z_eff(rho) feeds the neoclassical
 * conductivity and the bootstrap current, the line radiation of the species is local (n_e n_z L_z(T_e), Mavrin 2018 in radiation.ts) and the
 * dilution acts where the impurity sits.
 *
 * SPLITTING. The species are advanced once per accepted step, after the coupled T_e, T_i, n_e, psi step, with the coefficients and the fusion
 * source of that step (first order in Delta t; the profiles relax in seconds, a step lasts milliseconds to a fraction of a second, the steady
 * state of the implicit scheme does not depend on Delta t). Inside a step the impurity profiles are held fixed. The FACIT table is refreshed
 * every NEO_REFRESH seconds (it costs about a millisecond per species) and the convection is formed from it with the current gradients.
 *
 * SOURCES AND BOUNDARIES.
 *  - He ash: the local fusion rate, S_He = w.ash (ash of every channel, fusion.ts). The separatrix is absorbing (n_He,sep = 0); what leaves
 *    (the diffusive outflux and the He that an ELM expels) is exhausted with the confinement time tau_He* = (transport.tau_He_over_tau_E) tau_T
 *    of the scalar model, the same definition of legacy mode: the amount E that left in a step returns to the edge (deposited like a gas puff,
 *    the outer layer of e-folding EDGE_LAMBDA) except N_He dt/tau_He*, the exhaust of the pumps, so that the steady content is N_He = tau_He* Gamma_ash
 *    whatever the radial transport, and the radial transport sets the profile.
 *  - impurities: the density at the separatrix is a boundary condition, n_z,sep = c_sep n_sep (Dirichlet), the interior follows from transport. The
 *    configured concentration is the set-point of the VOLUME-AVERAGE concentration N_z/N_e, the meaning it has in the scalar model
 *    (`impurity.concentration`, the live control cZ, for the intrinsic species; `impurity.seedConcentration`; `impurityExtraConcentration`):
 *    the separatrix value is that concentration times a multiplier m that a slow integral controller adjusts (d ln m/dt = ln(c_set/c_vol)/tau_Z, tau_Z
 *    the impurity particle time of the scalar model, within [M_MIN, M_MAX]) so that screening or accumulation by the transport does not move the
 *    design point of a preset (Z_eff, radiation). `impuritySetpoint` 'separatrix' turns the controller off (m = 1: the set-point is the
 *    separatrix concentration and the profile is whatever the transport makes of it: with the electron D and v the core concentration is the
 *    separatrix value times about n_sep/n_e,axis). Tungsten (`impurity.species` = 'W') has in addition the wall source of the scalar model,
 *    S_W = W_source_frac P_SOL/(5 MeV) (per particle: the volume-average basis of the scalar model and of the 0D model, S_W/N_e = S_W/(n-bar V),
 *    is the same in both fidelities and independent of the density definition of the fuelling), deposited in the outer layer. Its steady
 *    inventory, S_W times the confinement time that the D and v of the species give it (a steady solve, `wallInventory`), is added to the
 *    set-point: it replaces the scalar model's S_W tau_Z, tau_Z x 4 without ELMs and sawteeth (the crashes are in the profiles here, and the
 *    inward neoclassical convection of W lengthens tau_W where it matters).
 *  - ELM crashes flush every species like the electrons (the fraction of the excess over the separatrix value that n_e loses at each cell,
 *    elmCrash) and sawtooth crashes flatten every species inside the mixing radius conserving its particles (flattenConserving).
 *
 * BOOKKEEPING. For each species N_z = N_z(0) + injected - lost holds to round-off every step (Nsrc, Nout); for helium also
 * N_He + pumped + recycling in transit = integral of the ash (`heliumBalance`). The scalars NHe and cZ of the state mirror the profiles
 * (inventory and volume-average concentration ∫n_Z dV / ∫n_e dV, the basis of the scalar model) so that the disruption limit and
 * the report see the same quantities; the diagnostics fHe and cZ are computed from the profiles.
 *
 * NOT DONE: no charge-state resolution (one mean charge from coronal equilibrium per species, as radiation.ts), no neutral
 * dynamics in the edge (the edge concentration is a boundary condition), no poloidal asymmetry (rotation, ICRH: FACIT's rotating
 * models are not ported), no fast-ion or beam-driven He source, He line radiation not counted.
 */
import { coolingRate, meanCharge } from '../../radiation';
import { FUEL_SPECIES } from '../../reactivity';
import type { CheckpointAux, CheckpointRecord } from '../checkpoint';
import { recNum } from '../checkpoint';
import { KEV, type ProfileContext, type StepConstants } from '../context';
import { DensitySolver } from '../fvsolver';
import { flattenConserving } from '../mhd';
import type { TransportGeometry } from '../geometry1d';
import { edgeDeposition, volumeIntegral } from '../sources/deposition';
import type { SourceModel } from '../sources/SourceModel';
import type { ProfileState, ScalarView } from '../state';
import { IMPURITIES } from '../../constants';
import { impurityMode, impuritySpecies, type ImpurityRole, type ImpuritySpeciesSpec, type ImpurityTransportMode } from './config';
import { NeoTable, faceCoefficients, faceLogGradient, facitTable } from './transport';

/** Plasma time between two refreshes of the FACIT table [s] */
export const NEO_REFRESH = 0.25;
/** e-folding length of the edge deposition of sources in rho (the gas puff of control/fueling.ts) */
export const EDGE_LAMBDA = 0.04;
/** an initial value of the last refresh: finite (a checkpoint record must hold numbers) and long before t = 0 */
const NEVER = -1e9;
/** bounds of the multiplier of the separatrix concentration (the set-point controller) and the largest change of its logarithm per step */
export const M_MIN = 0.02;
export const M_MAX = 50;
const M_STEP = 0.3;
/** the interval of the steady solve of the wall source [s]: many orders beyond the confinement times of the model (b = dV/dt is then negligible against the fluxes) */
const STEADY_DT = 1e9;

/**
 * Particle balance of helium: content, particles exhausted by the pumps, helium expelled by ELMs and not yet booked, the time integral of the ash
 * source and the change of the content by the adoptions of a new equilibrium (see `Nremap`): N + pumped + inTransit = ash + remap
 */
export interface HeliumBalance { N: number; pumped: number; inTransit: number; ash: number; remap: number }

export class ImpurityModel implements SourceModel {
  readonly id = 'impurity';
  readonly mode: ImpurityTransportMode;
  readonly species: readonly ImpuritySpeciesSpec[];
  readonly nSp: number;
  /** block indices of the roles in the state extras (-1: absent) */
  private readonly iHe = 0;
  private readonly iZ: number;
  private readonly iSeed: number;
  private readonly iExtra: number;
  private readonly N: number;
  private solver!: DensitySolver;
  private edgeDep!: Float64Array;
  /** face coefficients of the last advance, per species (diagnostics, tests) */
  readonly Dface: Float64Array[];
  readonly vface: Float64Array[];
  /** FACIT table per species, and the time of its last refresh */
  private neo: NeoTable[];
  private tNeo = NEVER;
  private readonly nfuel: Float64Array;
  private readonly gradN: Float64Array;
  private readonly gradT: Float64Array;
  private readonly S: Float64Array;
  /** particles injected by the sources (helium: the ash and the recycling) and lost through the separatrix or by ELMs, per species */
  readonly Nsrc: Float64Array;
  readonly Nout: Float64Array;
  /** the particles of the initial state, per species */
  readonly N0: Float64Array;
  /**
   * The change of the content of each species by the adoptions of a new equilibrium: the cell volumes change (V' of a face by up to 1.7 %, the total volume
   * fixed) while the densities stay, as for n_e (the coupling lane's remap of the contents is an open item). N_z = N_z(0) + injected - lost + Nremap.
   */
  readonly Nremap: Float64Array;
  private tgSeen: TransportGeometry | null = null;
  /** outflux through the separatrix of the last advance [1/s], per species */
  readonly lastOut: Float64Array;
  /** helium: ash injected in total, exhausted by the pumps, and expelled by ELMs since the last advance (counted as outflux of the next step) */
  private ashTotal = 0;
  private pumped = 0;
  private elmOut = 0;
  /** the unit response of the helium solve to a source deposited at the edge (scratch), and zeros */
  private readonly unit: Float64Array;
  private readonly zeros: Float64Array;
  /** last wall source of tungsten [1/s] */
  private lastWsrc = 0;
  /** multiplier of the configured concentration at the separatrix, per species (the set-point controller; 1 for helium and for the 'separatrix' set-point) */
  private readonly mult: Float64Array;

  constructor(private readonly ctx: ProfileContext) {
    this.mode = impurityMode(ctx.ps);
    this.species = impuritySpecies(ctx.cfg, ctx.ps);
    this.nSp = this.species.length;
    this.N = ctx.N;
    const idx = (role: ImpurityRole) => this.species.find((s) => s.role === role)?.index ?? -1;
    this.iZ = idx('intrinsic'); this.iSeed = idx('seed'); this.iExtra = idx('extra');
    const N = ctx.N;
    const arrs = (n: number) => Array.from({ length: this.nSp }, () => new Float64Array(n));
    this.Dface = arrs(N + 1); this.vface = arrs(N + 1);
    this.neo = Array.from({ length: this.nSp }, () => ({ D: new Float64Array(N + 1), K: new Float64Array(N + 1), H: new Float64Array(N + 1) }));
    this.nfuel = new Float64Array(N); this.S = new Float64Array(N);
    this.gradN = new Float64Array(N + 1); this.gradT = new Float64Array(N + 1);
    this.Nsrc = new Float64Array(this.nSp); this.Nout = new Float64Array(this.nSp);
    this.N0 = new Float64Array(this.nSp); this.lastOut = new Float64Array(this.nSp); this.Nremap = new Float64Array(this.nSp);
    this.mult = new Float64Array(this.nSp).fill(1);
    this.unit = new Float64Array(N); this.zeros = new Float64Array(N);
    ctx.onGeometry((tg) => {
      this.solver = new DensitySolver(tg);
      this.edgeDep = edgeDeposition(tg, EDGE_LAMBDA);
    });
  }

  /** plasma time of the last refresh of the FACIT table [s] (a very negative value before the first) */
  get lastNeoRefresh(): number { return this.tNeo; }

  // ---------------------------------------------------------------------------------------------------- state and composition

  /** The density block of species k in a state's extras (a view) */
  block(s: ScalarView, k: number): Float64Array { return s.imp.subarray(k * this.N, (k + 1) * this.N); }

  /**
   * Books the change of the content of every species by an equilibrium adoption since the module last looked: the cell volumes changed (V' of a face by
   * up to 1.7 %, the total volume fixed) and the densities stayed, as for n_e (the remap of the contents is the coupling lane's open item). Called before
   * anything changes the densities (the advance and every event), so that the booking is with the densities the adoption met and the balance
   * N_z = N_z(0) + injected - lost + Nremap holds to round-off between any two calls.
   */
  private syncGeometry(s: ScalarView): void {
    const g = this.ctx.tg, old = this.tgSeen;
    if (old === g) return;
    this.tgSeen = g;
    if (!old) return;
    for (let k = 0; k < this.nSp; k++) {
      const b = this.block(s, k);
      let d = 0;
      for (let i = 0; i < this.N; i++) d += b[i] * (g.dV[i] - old.dV[i]);
      this.Nremap[k] += d;
    }
  }

  /** Sets the initial profiles in st: no helium, the impurities at their configured concentration times n_e (the scalar model starts there) */
  initialise(st: ProfileState): void {
    const N = this.N, c = this.ctx.cfg, ps = this.ctx.ps;
    st.s.imp.fill(0);
    const put = (k: number, conc: number) => { if (k >= 0) { const b = this.block(st.s, k); for (let i = 0; i < N; i++) b[i] = Math.max(conc, 0) * st.ne[i]; } };
    put(this.iZ, c.impurity.concentration);
    put(this.iSeed, c.impurity.seedConcentration ?? 0);
    put(this.iExtra, ps.impurityExtraConcentration ?? 0);
    this.Nsrc.fill(0); this.Nout.fill(0); this.lastOut.fill(0); this.Nremap.fill(0);
    this.tgSeen = this.ctx.tg;
    this.ashTotal = 0; this.pumped = 0; this.elmOut = 0; this.lastWsrc = 0;
    this.mult.fill(1);
    this.tNeo = NEVER;
    for (let k = 0; k < this.nSp; k++) this.N0[k] = volumeIntegral(this.ctx.tg, this.block(st.s, k));
  }

  /**
   * Quasi-neutral composition from the profiles (the replacement of composition.ts for this mode): fuel ions n_a, n_b from n_e minus
   * the charge of helium and of the impurities at their mean charge at T_e, Z_eff, the ion sum sum n_j Z_j^2/A_j / n_e and the arrays of the
   * species (w.nHe, w.nZ, w.ns, mean charges).
   */
  composition(Te: ArrayLike<number>, ne: ArrayLike<number>, s: ScalarView): void {
    const ctx = this.ctx, w = ctx.w, N = this.N;
    const fs = FUEL_SPECIES[ctx.cfg.fuel];
    const fA = Math.min(Math.max(s.fA, 0), 1);
    const imp = s.imp;
    const sp = this.species;
    const spZ = this.iZ >= 0 ? sp[this.iZ] : null, spS = this.iSeed >= 0 ? sp[this.iSeed] : null, spX = this.iExtra >= 0 ? sp[this.iExtra] : null;
    const oHe = this.iHe * N, oZ = this.iZ * N, oS = this.iSeed * N, oX = this.iExtra * N;
    const AZ = spZ?.A ?? 20, As = spS?.A ?? 20, Ax = spX?.A ?? 20;
    for (let i = 0; i < N; i++) {
      const T = Math.max(Te[i], 0.1);
      const Zz = spZ ? meanCharge(spZ.species, T) : 0, Zs = spS ? meanCharge(spS.species, T) : 0, Zx = spX ? meanCharge(spX.species, T) : 0;
      const n = ne[i];
      const nHe = Math.max(imp[oHe + i], 0), nZ = spZ ? Math.max(imp[oZ + i], 0) : 0, ns = spS ? Math.max(imp[oS + i], 0) : 0, nx = spX ? Math.max(imp[oX + i], 0) : 0;
      const neFuel = Math.max(n - 2 * nHe - Zz * nZ - Zs * ns - Zx * nx, 0.05 * n);
      const nf = neFuel / (fA * fs.a.Z + (1 - fA) * fs.b.Z);
      const na = fA * nf, nb = (1 - fA) * nf;
      w.na[i] = na; w.nb[i] = nb; w.nHe[i] = nHe; w.nZ[i] = nZ; w.ns[i] = ns; w.Zimp[i] = Zz; w.Zseed[i] = Zs;
      w.ni[i] = na + nb + nHe + nZ + ns + nx;
      const main = na * fs.a.Z ** 2 + nb * fs.b.Z ** 2 + 4 * nHe;
      w.ZeffMain[i] = main / n;
      w.Zeff[i] = (main + Zz * Zz * nZ + Zs * Zs * ns + Zx * Zx * nx) / n;
      w.ionSum[i] = (na * fs.a.Z ** 2 / fs.a.A + nb * fs.b.Z ** 2 / fs.b.A + nHe + nZ * Zz * Zz / AZ + ns * Zs * Zs / As + nx * Zx * Zx / Ax) / n;
    }
  }

  /** Line radiation of the third species (the first two are radiation.ts's intrinsic and seeded species): added to w.Pline, w.Prad, w.dPrad after the radiation source */
  heat(ctx: ProfileContext, st: ProfileState, _K: StepConstants): void {
    if (this.iExtra < 0) return;
    const w = ctx.w, N = this.N, sp = this.species[this.iExtra].species as keyof typeof IMPURITIES;
    const b = this.block(st.s, this.iExtra);
    for (let i = 0; i < N; i++) {
      const Tev = Math.max(st.Te[i], 0.01);
      const nx = Math.max(b[i], 0);
      const pl = st.ne[i] * nx * coolingRate(sp, Tev);
      const dpl = st.ne[i] * nx * (coolingRate(sp, Tev * 1.02) - coolingRate(sp, Tev)) / (0.02 * Tev);
      w.Pline[i] += pl; w.Prad[i] += pl; w.dPrad[i] += Math.max(0, dpl);
    }
  }

  // ---------------------------------------------------------------------------------------------------- the step

  /** The configured concentration of species k: the set-point of N_z/N_e (or of the separatrix value with the 'separatrix' set-point); helium has none */
  setpoint(k: number): number {
    const c = this.ctx.cfg.impurity;
    if (k === this.iZ) return Math.max(this.ctx.ctrl.cZ, 0);
    if (k === this.iSeed) return Math.max(c.seedConcentration ?? 0, 0);
    if (k === this.iExtra) return Math.max(this.ctx.ps.impurityExtraConcentration ?? 0, 0);
    return 0;
  }

  /** The concentration n_z/n_e held at the separatrix by species k: the set-point times the multiplier of the controller (helium: none) */
  edgeConcentration(k: number): number { return this.setpoint(k) * this.mult[k]; }

  /** The separatrix density of species k [m^-3] */
  private edgeDensity(k: number): number { return this.edgeConcentration(k) * this.ctx.bc.n; }

  /** Refreshes the FACIT table of every species with the state st */
  private refreshNeo(st: ProfileState, t: number): void {
    for (let k = 0; k < this.nSp; k++) facitTable(this.ctx, st, this.species[k], this.block(st.s, k), this.edgeDensity(k), this.neo[k]);
    this.tNeo = t;
  }

  /** Source-model hook: advances every species over the accepted step from t to t + dt (the new state v holds the old impurity profiles on entry) */
  accepted(ctx: ProfileContext, t: number, dt: number, _o: ProfileState, v: ProfileState): void {
    if (!(dt > 0)) return;
    const g = ctx.tg, w = ctx.w, N = this.N, c = ctx.cfg, ps = ctx.ps;
    this.syncGeometry(v.s);
    const rD = Math.max(ps.impurityDoverDe ?? 1, 0), rV = Math.max(ps.impurityPinchOverPe ?? 1, 0);
    const facit = this.mode === 'facit';
    if (facit && t + dt - this.tNeo >= NEO_REFRESH) this.refreshNeo(v, t + dt);
    if (facit) {
      for (let i = 0; i < N; i++) this.nfuel[i] = w.na[i] + w.nb[i];
      faceLogGradient(g, this.nfuel, this.nfuel[N - 1] * ctx.bc.n / Math.max(v.ne[N - 1], 1), this.gradN);
      faceLogGradient(g, v.Ti, ctx.bc.Ti, this.gradT);
    }
    const tauT = Math.max(ctx.lastDiag.tauE ?? 1, 1e-3);
    const tauHe = Math.max(c.transport.tau_He_over_tau_E * tauT, 1e-2);
    const S_W = c.impurity.species === 'W' && this.iZ >= 0 ? (c.impurity.W_source_frac * ctx.PSOL) / (5000 * KEV) : 0;
    this.lastWsrc = S_W;
    for (let k = 0; k < this.nSp; k++) {
      const b = this.block(v.s, k);
      faceCoefficients(ctx, rD, rV, facit ? this.neo[k] : undefined, this.gradN, this.gradT, this.Dface[k], this.vface[k]);
      const S = this.S;
      if (k === this.iHe) { this.advanceHelium(b, dt, tauHe); continue; }
      let srcTotal = 0;
      if (k === this.iZ && S_W > 0) {
        for (let i = 0; i < N; i++) S[i] = S_W * this.edgeDep[i];
        srcTotal = S_W * dt;
      } else S.fill(0);
      this.solver.solve({ dt, n0: b, D: this.Dface[k], v: this.vface[k], S, nB: this.edgeDensity(k) }, b);
      for (let i = 0; i < N; i++) if (!(b[i] > 0)) b[i] = 0;
      const out = this.solver.GammaF[N];
      this.lastOut[k] = out;
      this.Nsrc[k] += srcTotal; this.Nout[k] += out * dt;
    }
    // set-point controller of the separatrix concentration: ln m follows the error of the volume-average concentration (the particle time of the scalar model)
    const Ne = Math.max(volumeIntegral(g, v.ne), 1);
    if (ps.impuritySetpoint !== 'separatrix') {
      const tauZ = Math.max(c.transport.tau_p_over_tau_E * tauT, 1e-2);
      // the wall source adds what the transport keeps of it (the steady inventory of the source, S_W times the confinement time of D and v below)
      // to the set-point: the scalar model's S_W tau_Z (with tau_Z x 4 without ELMs and sawteeth) is not used, the crashes are in the profiles
      const cWall = S_W > 0 ? this.wallInventory(S_W) / Ne : 0;
      for (let k = 0; k < this.nSp; k++) {
        const cSet = this.setpoint(k);
        if (k === this.iHe || !(cSet > 0)) continue;
        const cTarget = cSet + (k === this.iZ ? cWall : 0);
        const cVol = volumeIntegral(g, this.block(v.s, k)) / Ne;
        const err = Math.log(cTarget / Math.max(cVol, 1e-3 * cTarget));
        this.mult[k] = Math.min(Math.max(this.mult[k] * Math.exp(Math.min(Math.max((dt / tauZ) * err, -M_STEP), M_STEP)), M_MIN), M_MAX);
      }
    }
    this.mirror(v);
  }

  /** The scalars NHe and cZ of the state mirror the profiles (inventory and volume-average concentration, the basis of the scalar model): the disruption limit and the report read them */
  private mirror(st: ProfileState): void {
    const g = this.ctx.tg;
    st.s.NHe = volumeIntegral(g, this.block(st.s, this.iHe));
    if (this.iZ >= 0) st.s.cZ = volumeIntegral(g, this.block(st.s, this.iZ)) / Math.max(volumeIntegral(g, st.ne), 1);
  }

  /**
   * The steady content of the intrinsic species that the wall source S_W [1/s] keeps with the face coefficients of the last advance (zero boundary value,
   * the source in the outer layer): the solve of one interval that is long against every transport time, N = S_W tau_W with tau_W the confinement time
   * of the source (the inward neoclassical convection of a heavy impurity makes it long; an outward one short).
   */
  private wallInventory(S_W: number): number {
    const k = this.iZ, N = this.N, S = this.S, u = this.unit;
    for (let i = 0; i < N; i++) S[i] = S_W * this.edgeDep[i];
    this.solver.solve({ dt: STEADY_DT, n0: this.zeros, D: this.Dface[k], v: this.vface[k], S, nB: 0 }, u);
    return volumeIntegral(this.ctx.tg, u);
  }

  /**
   * The helium step: the ash of the local fusion rate as the source, an absorbing separatrix, and the exhaust. What leaves the plasma in the
   * step (the outflux of the new profile times dt and the helium the ELMs expelled before it) returns as a recycling source R deposited at the
   * edge, all but the exhaust of the pumps N_new dt/tau_He*: R = Gamma_out - N_new/tau_He* + (ELM helium)/dt, at least 0. The profile is linear in R
   * (superposition of the solve with the ash and the unit response to an edge source), so the closure is implicit and exact for the backward-Euler
   * step: N_new = N_old + dt (Gamma_ash - N_new/tau_He*) (+ the ELM helium), the confinement time of the scalar model at any step length.
   */
  private advanceHelium(b: Float64Array, dt: number, tauHe: number): void {
    const g = this.ctx.tg, w = this.ctx.w, N = this.N, k = this.iHe;
    const S = this.S, D = this.Dface[k], v = this.vface[k], u = this.unit;
    const ash = volumeIntegral(g, w.ash) * dt;
    S.set(w.ash);
    this.solver.solve({ dt, n0: b, D, v, S, nB: 0 }, b);
    const G0 = this.solver.GammaF[N], N0 = volumeIntegral(g, b);
    this.solver.solve({ dt, n0: this.zeros, D, v, S: this.edgeDep, nB: 0 }, u);
    const gam = this.solver.GammaF[N], nu = volumeIntegral(g, u);
    const R = Math.max((G0 - N0 / tauHe + this.elmOut / dt) / (1 - gam + nu / tauHe), 0);
    for (let i = 0; i < N; i++) { b[i] += R * u[i]; if (!(b[i] > 0)) b[i] = 0; }
    const out = G0 + R * gam;
    this.lastOut[k] = out;
    this.ashTotal += ash;
    this.Nsrc[k] += ash + R * dt; this.Nout[k] += out * dt;
    this.pumped += out * dt + this.elmOut - R * dt;
    this.elmOut = 0;
  }

  // ---------------------------------------------------------------------------------------------------- MHD events

  /**
   * An ELM crash of the electrons (mhd.ts elmCrash: the excess of n_e over the separatrix value drops by the fraction fN times the weight of the
   * cell, 1 from rho_ped and linear over the width wIn before it) expels every species by the same fraction of its excess over its own
   * separatrix value. What leaves counts as outflux (helium: the exhaust of the next advance).
   */
  elmCrash(st: ProfileState, rhoPed: number, fN: number, wIn: number): void {
    const g = this.ctx.tg, N = this.N;
    this.syncGeometry(st.s);
    for (let k = 0; k < this.nSp; k++) {
      const b = this.block(st.s, k), nB = this.edgeDensity(k);
      let lost = 0;
      for (let i = 0; i < N; i++) {
        const r = g.rhoC[i];
        if (r < rhoPed - wIn) continue;
        const wgt = r >= rhoPed ? 1 : (r - (rhoPed - wIn)) / wIn;
        const old = b[i];
        if (!(old > nB)) continue;
        b[i] = nB + (old - nB) * (1 - fN * wgt);
        lost += (old - b[i]) * g.dV[i];
      }
      this.Nout[k] += lost;
      if (k === this.iHe) this.elmOut += lost;
    }
    this.mirror(st);
  }

  /** The particle loss of a disruption quench: every species decays with the electrons, by the factor f in the step (the concentrations stay) */
  quench(st: ProfileState, f: number): void {
    this.syncGeometry(st.s);
    for (let k = 0; k < this.nSp; k++) {
      const b = this.block(st.s, k);
      let lost = 0;
      for (let i = 0; i < this.N; i++) { lost += b[i] * (1 - f) * this.ctx.tg.dV[i]; b[i] *= f; }
      this.Nout[k] += lost;
    }
    this.mirror(st);
  }

  /** A sawtooth crash of the electrons (Kadomtsev, flattenConserving inside rho_mix): flattens every species conserving its particles */
  sawtoothCrash(st: ProfileState, rho1: number, rhoMix: number): void {
    const g = this.ctx.tg;
    this.syncGeometry(st.s);
    for (let k = 0; k < this.nSp; k++) flattenConserving(g, this.block(st.s, k), null, rho1, rhoMix);
    this.mirror(st);
  }

  // ---------------------------------------------------------------------------------------------------- output

  /** Particle balance of helium (see the header): N + pumped + inTransit = ash, to round-off */
  heliumBalance(st: ProfileState): HeliumBalance {
    return { N: volumeIntegral(this.ctx.tg, this.block(st.s, this.iHe)), pumped: this.pumped, inTransit: this.elmOut, ash: this.ashTotal, remap: this.Nremap[this.iHe] };
  }

  /** Diagnostics of the profiles of st added to (or replacing) the frame's keys */
  diagnostics(st: ProfileState, d: Record<string, number>): void {
    const ctx = this.ctx, g = ctx.tg, w = ctx.w;
    const Ne = Math.max(volumeIntegral(g, st.ne), 1);
    const ne0 = Math.max(st.ne[0], 1);
    const bHe = this.block(st.s, this.iHe);
    const NHe = volumeIntegral(g, bHe);
    d.fHe = NHe / Ne;
    d.fHe0 = bHe[0] / ne0;
    const ash = volumeIntegral(g, w.ash);
    d.tauHeStar = ash > 1e10 ? NHe / ash : 0;
    d.GammaHe = this.lastOut[this.iHe] / 1e20;
    const conc = (k: number, tag: string, tagPeak?: string) => {
      if (k < 0) return;
      const b = this.block(st.s, k), Nz = volumeIntegral(g, b);
      d[tag] = Nz / Ne;
      d[`${tag}0`] = b[0] / ne0;
      if (tagPeak) d[tagPeak] = Nz > 0 ? (b[0] * g.volume) / Nz : 1;
    };
    conc(this.iZ, 'cZ', 'cZpeak');
    conc(this.iSeed, 'cSeed');
    conc(this.iExtra, 'cExtra');
    // net particle flux INTO the plasma through the separatrix [1e20 /s], the seeding rate that holds the boundary concentration (the wall source of W is not in it)
    if (this.iZ >= 0) d.GammaZ = -this.lastOut[this.iZ] / 1e20;
    if (this.iSeed >= 0) d.GammaSeed = -this.lastOut[this.iSeed] / 1e20;
    if (this.iExtra >= 0) d.GammaExtra = -this.lastOut[this.iExtra] / 1e20;
    if (this.iZ >= 0) { d.S_W = this.lastWsrc / 1e20; d.mZ = this.mult[this.iZ]; }
  }

  /** Radial profiles of the species (10^20 m^-3) added to the frame's profiles */
  profiles(st: ProfileState, out: Record<string, number[]>): void {
    const conv = (k: number) => Array.from(this.block(st.s, k), (x) => x * 1e-20);
    out.nHe = conv(this.iHe);
    if (this.iZ >= 0) out.nZ = conv(this.iZ);
    if (this.iSeed >= 0) out.nSeed = conv(this.iSeed);
    if (this.iExtra >= 0) out.nExtra = conv(this.iExtra);
  }

  // ---------------------------------------------------------------------------------------------------- checkpoint

  save(rec: CheckpointRecord, aux: CheckpointAux): void {
    rec.imp_tNeo = this.tNeo; rec.imp_ash = this.ashTotal; rec.imp_pumped = this.pumped; rec.imp_elmOut = this.elmOut; rec.imp_Wsrc = this.lastWsrc;
    for (let k = 0; k < this.nSp; k++) { rec[`imp_Nsrc${k}`] = this.Nsrc[k]; rec[`imp_Nout${k}`] = this.Nout[k]; rec[`imp_N0${k}`] = this.N0[k]; rec[`imp_out${k}`] = this.lastOut[k]; rec[`imp_m${k}`] = this.mult[k]; rec[`imp_remap${k}`] = this.Nremap[k]; }
    aux.impNeo = this.neo.map((t) => ({ D: t.D.slice(), K: t.K.slice(), H: t.H.slice() }));
  }

  restore(rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined): void {
    this.tNeo = recNum(rec, 'imp_tNeo', NEVER);
    this.ashTotal = recNum(rec, 'imp_ash', 0); this.pumped = recNum(rec, 'imp_pumped', 0);
    this.elmOut = recNum(rec, 'imp_elmOut', 0); this.lastWsrc = recNum(rec, 'imp_Wsrc', 0);
    for (let k = 0; k < this.nSp; k++) {
      this.Nsrc[k] = recNum(rec, `imp_Nsrc${k}`, 0); this.Nout[k] = recNum(rec, `imp_Nout${k}`, 0);
      this.N0[k] = recNum(rec, `imp_N0${k}`, 0); this.lastOut[k] = recNum(rec, `imp_out${k}`, 0); this.mult[k] = recNum(rec, `imp_m${k}`, 1); this.Nremap[k] = recNum(rec, `imp_remap${k}`, 0);
    }
    this.tgSeen = this.ctx.tg; // the context part of the checkpoint restored its equilibrium first
    const saved = aux?.impNeo as { D: Float64Array; K: Float64Array; H: Float64Array }[] | undefined;
    if (saved && saved.length === this.nSp) {
      saved.forEach((t, k) => { this.neo[k].D.set(t.D); this.neo[k].K.set(t.K); this.neo[k].H.set(t.H); });
    } else this.tNeo = NEVER; // a record from elsewhere: the table is rebuilt at the next step
  }
}
