/**
 * 1.5D PROFILE MODEL — tokamak and spherical tokamak.
 *
 * Radial transport on ρ̂ = √(Φ/Φ_b) (cell-centred finite volumes) coupled to a fixed-boundary
 * Grad–Shafranov equilibrium (periodic, quasi-static). State: T_e(ρ), T_i(ρ), n_e(ρ), ψ(ρ) and the
 * global scalars of state.ts (He ash, impurity, fuel mix, counters, transport multiplier, NTM
 * island widths). TR-BDF2 steps with a Picard iteration and an error-controlled Δt; ELMs and
 * sawtooth crashes end the step at the crossing of their threshold.
 *
 * This class is the orchestrator implementing SimModel; the physics lives in the modules:
 *
 *   context.ts           shared state of the shot (geometry, work arrays, plasma/controller state)
 *   state.ts, work.ts    state vector layout, work arrays
 *   composition.ts       quasi-neutral composition, He ash / impurity / fuel-mix inventories
 *   qprofile.ts          ψ → q, ψ', enclosed current; q95
 *   boundary/sol.ts      separatrix values (two-point model), P_SOL
 *   sources/             SourceModel plug-ins: NBI, RF, fusion, radiation, exchange; current sources
 *   transport/           TransportModel plug-ins ('scaling', 'cgm'), barrier, neoclassical floor
 *   control/             actuators, fueling feedback, confinement (τ_E scaling, C_χ controller)
 *   solver/              evaluation pipeline, coupled TR-BDF2 step (Δt control, event localisation), accepted-step update
 *   coupling/            Grad–Shafranov coupling (initial solve, update policy, guarded updates)
 *   events/              EventModel plug-ins: L–H, ELM, sawtooth, NTM, burn, warnings, disruption
 *   diagnostics.ts       time traces and profiles; checkpoint.ts: rewind checkpoints
 *
 * Transport ('scaling' mode) is τ_E-constrained: χ(ρ) = C_χ(t)·(1 + c ρ²) with C_χ set by a PI
 * controller so that W follows the τ_E scaling, while the profile shape comes from the physics
 * (Artaud et al., Nucl. Fusion 58 (2018) 105001); 'cgm' is the predictive critical-gradient model
 * (Garbet et al., Plasma Phys. Control. Fusion 46 (2004) 1351).
 */
import { DISRUPTION_FIXES } from '../disruption';
import { checkMagnet, MAGNET_TECH, MagnetCheck } from '../engineering';
import { buildMagneticReport } from '../confinement/magneticReport';
import { flatTopMean } from '../analysis/flatTop';
import type { EqSnapshot, HistoryFrame, MagneticConfig, ProfileSettings, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import type { Equilibrium } from '../equilibrium/gs';
import type { Geometry } from '../geometry';
import { CrashHook, ProfileContext, StepConstants } from './context';
import { CheckpointStore, Checkpointable, contextCheckpoint } from './checkpoint';
import { composition } from './composition';
import { FuelingControl } from './control/fueling';
import type { CurrentProgramme } from './control/plasmaCurrent';
import { EquilibriumCoupling } from './coupling/equilibrium';
import { PROFILE_DIAGS, stateDiagnostics } from './diagnostics';
import { defaultEvents, EventModel } from './events';
import type { DisruptionEvents } from './events/disruption';
import type { ElmEvents } from './events/elm';
import type { EquilibriumInitFailure, StepFailure } from './failures';
import type { TransportGeometry } from './geometry1d';
import type { GsAttempt } from './eqguard';
import { currentProfiles, equilibriumCurrentScale, matchEdgeCurrent } from './qprofile';
import { defaultSources, SourceModel } from './sources';
import { acceptStep } from './solver/acceptStep';
import { CoupledStepper } from './solver/coupledStep';
import { PhysicsPipeline } from './solver/pipeline';
import type { ProfileState } from './state';
import { createTransportModel, TransportModel } from './transport';

export { DEFAULT_PROFILE_SETTINGS } from './defaults';
export { PROFILE_DIAGS } from './diagnostics';
export type { CrashSnapshot } from './context';
export type { EventModel } from './events';
export type { SourceModel } from './sources';
export type { TransportModel } from './transport';

/**
 * Optional replacement or extension of the physics modules of a ProfileModel (plug-ins, tests).
 * Simulation builds the model with the defaults.
 */
export interface ProfileModules {
  /** transport model (default: the one named by ProfileSettings.transportModel) */
  transport?: TransportModel;
  /** sources in evaluation order (default: defaultSources()) */
  sources?: SourceModel[];
  /** additional event models, run after the standard ones and before the disruption check */
  events?: EventModel[];
  /** plasma-current programme I_p(t) [A], the boundary condition of the current diffusion (control/plasmaCurrent.ts); replaces ProfileSettings.IpWaveform */
  plasmaCurrent?: CurrentProgramme;
}

/** Configurations the profile model can run */
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
  readonly dt0 = 1e-3;

  /** shared state of the shot */
  readonly ctx: ProfileContext;
  /** work-array evaluation: transport model and sources */
  readonly physics: PhysicsPipeline;
  /** event models, in postStep order */
  readonly events: readonly EventModel[];
  readonly coupling: EquilibriumCoupling;
  readonly stepper: CoupledStepper;
  private readonly fueling: FuelingControl;
  private readonly elm: ElmEvents;
  private readonly disruption: DisruptionEvents;
  private readonly checkpoints = new CheckpointStore();
  private readonly checkpointParts: readonly Partial<Checkpointable>[];
  private readonly magnetInfo: MagnetCheck;

  constructor(cfg: MagneticConfig, modules: ProfileModules = {}) {
    const ctx = (this.ctx = new ProfileContext(cfg));
    this.method = cfg.method;
    this.tEnd = cfg.t_end;
    this.outputDt = Math.max(cfg.t_end / 800, 0.002);
    this.nState = ctx.layout.size;
    if (modules.plasmaCurrent) ctx.setCurrentProgramme(modules.plasmaCurrent);
    this.physics = new PhysicsPipeline(ctx, modules.transport ?? createTransportModel(ctx.ps.transportModel), modules.sources ?? defaultSources());
    this.fueling = new FuelingControl(ctx);
    const ev = defaultEvents(modules.events);
    this.events = ev.list; this.elm = ev.elm; this.disruption = ev.disruption;
    this.coupling = new EquilibriumCoupling(ctx);
    this.stepper = new CoupledStepper(ctx, this.physics, this.fueling, this.disruption, (t, dt, yOld, y) => {
      acceptStep(ctx, this.fueling, this.physics, t, dt, yOld, y);
      this.coupling.check(ctx, t + dt, y, (tu, yu) => this.updateEquilibrium(tu, yu));
    }, this.events);
    this.checkpointParts = [contextCheckpoint(ctx), this.coupling, this.stepper, this.physics.transport, ...this.physics.sources, ...this.events, ctx.flux];
    this.magnetInfo = checkMagnet(cfg.geometry, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m);
    this.coupling.initialize(ctx);
    if (this.magnetInfo.quench) {
      ctx.phase = 'ended';
      ctx.terminated = {
        t: 0, natural: false, reason: 'Magnet quench',
        diagnosis: `Peak field in the toroidal field coil B_coil = ${this.magnetInfo.B_coil.toFixed(1)} T, ${MAGNET_TECH[cfg.magnet.tech].label} has a limit of ${this.magnetInfo.B_max} T. The coil quenched; shot aborted.`,
        fix: DISRUPTION_FIXES.magnet_quench,
      };
    } else if (this.eqInitFailure) {
      ctx.phase = 'ended';
      const b = ctx.geomB;
      ctx.terminated = {
        t: 0, natural: false, reason: 'Equilibrium failure',
        diagnosis: `No Grad–Shafranov equilibrium could be computed for the requested boundary (R = ${b.R} m, a = ${b.a} m, κ = ${b.kappa}, δ = ${b.delta}): ${this.eqInitFailure.detail}. The 1.5D model needs it for its transport geometry; shot aborted.`,
        fix: 'Bring elongation, triangularity and aspect ratio into the usual range, or run the shot at 0D fidelity.',
      };
    }
  }

  // ------------------------------------------------------------------ state exposed to callers
  get terminated(): TerminationInfo | null { return this.ctx.terminated; }
  /** SimModel.terminated must stay writable: Simulation.rewindTo restores the termination of the frame (types.ts) */
  set terminated(v: TerminationInfo | null) { this.ctx.terminated = v; }
  get ps(): ProfileSettings { return this.ctx.ps; }
  get cfg(): MagneticConfig { return this.ctx.cfg; }
  /** Grad–Shafranov boundary shape (LCFS) */
  get geomB(): Geometry { return this.ctx.geomB; }
  get N(): number { return this.ctx.N; }
  get eq(): Equilibrium { return this.ctx.eq; }
  get tg(): TransportGeometry { return this.ctx.tg; }
  get currentDt(): number { return this.ctx.dt; }
  /** optional profile snapshots just before and after an MHD crash (figures; no effect on the run) */
  get crashHook(): CrashHook | null { return this.ctx.crashHook; }
  set crashHook(f: CrashHook | null) { this.ctx.crashHook = f; }
  get eqUpdates(): number { return this.coupling.eqUpdates; }
  get eqRetried(): number { return this.coupling.eqRetried; }
  get eqRejected(): number { return this.coupling.eqRejected; }
  get eqStats(): { it: number; res: number } { return this.coupling.eqStats; }
  get eqAttempts(): GsAttempt[] { return this.coupling.eqAttempts; }
  get eqInitResidual(): number | null { return this.coupling.eqInitResidual; }
  get eqInitFailure(): EquilibriumInitFailure | null { return this.coupling.eqInitFailure; }
  get forcedSteps(): number { return this.stepper.forcedSteps; }
  get stepFailure(): StepFailure | null { return this.stepper.stepFailure; }

  // ------------------------------------------------------------------ SimModel
  initialState(): Float64Array {
    const ctx = this.ctx, N = ctx.N, c = ctx.cfg, g = ctx.tg;
    const y = new Float64Array(this.nState);
    const { Te, Ti, ne, psi, s } = ctx.view(y);
    const n0 = 0.3 * c.n_target;
    const fsep = ctx.ps.nsepFrac, an = c.transport.alpha_n;
    for (let i = 0; i < N; i++) {
      const r = g.rhoC[i];
      Te[i] = 0.05 + 1.9 * (1 - r * r);
      Ti[i] = 0.8 * Te[i];
      ne[i] = n0 * (fsep + (1 - fsep) * (1 + an) * Math.pow(1 - r * r, an));
    }
    // ψ from the q profile of the equilibrium: ψ' = Φ_b ρ/(π q), scaled to carry the boundary current (equilibriumCurrentScale)
    const Ip0 = ctx.ipAt(0);
    const scale = equilibriumCurrentScale(ctx.eq, Ip0);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const r0 = i === 0 ? 0 : g.rhoC[i - 1], r1 = g.rhoC[i];
      const qm = i === 0 ? g.qEqC[0] : 0.5 * (g.qEqC[i - 1] + g.qEqC[i]);
      const rm = 0.5 * (r0 + r1);
      acc += ((scale * g.PhiB * rm) / (Math.PI * Math.max(qm, 0.3))) * (r1 - r0);
      psi[i] = acc;
    }
    matchEdgeCurrent(ctx, psi, scale, Ip0);
    s.NHe = 0;
    s.cZ = c.impurity.concentration;
    s.fA = c.fuelFracA;
    s.Cchi = 0.5; s.CI = 0.5;
    s.Ip = Ip0;
    s.Sfuel = 0;
    ctx.bc = { Te: 0.05, Ti: 0.05, n: fsep * n0 };
    composition(ctx, Te, ne, s);
    currentProfiles(ctx, psi, s.Ip);
    return y;
  }

  /** The model advances with its own implicit stepper; it has no rhs() and Simulation builds no Dormand–Prince stepper for it. */
  step(t: number, y: Float64Array, tMax: number): number { return this.stepper.step(t, y, tMax); }

  /** Grad–Shafranov update from the profiles of y at time t; returns whether it was accepted */
  updateEquilibrium(t: number, y: Float64Array): boolean {
    return this.coupling.update(this.ctx, t, y, (te, st) => { this.evaluateWorkArrays(te, st); });
  }

  takeEqSnapshot(): EqSnapshot | null {
    if (!this.ctx.eqDirty) return null;
    this.ctx.eqDirty = false;
    return this.eqSnapshot();
  }

  /** Flux surfaces for the cross-section plot (ρ_tor = 0.1 … 1.0) */
  eqSnapshot(nSurf = 10, nPts = 72): EqSnapshot { return this.coupling.snapshot(this.ctx, nSurf, nPts); }

  postStep(t: number, _dt: number, y: Float64Array): SimEvent[] {
    const ctx = this.ctx;
    const ev: SimEvent[] = ctx.pending.splice(0);
    if (ctx.terminated) return ev;
    const d = ctx.lastDiag;
    if (!d.Te) return ev;
    const st = ctx.view(y);
    if (ctx.phase === 'normal') for (const m of this.events) m.afterStep(ctx, t, st, d, ev);
    else this.disruption.quenchProgress(ctx, t, st, d, ev);
    if (!ctx.terminated && t >= this.tEnd - 1e-9) {
      ctx.phase = 'ended';
      ctx.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: `The shot completed the scheduled duration of ${this.tEnd} s without disruption.`, fix: '' };
      ev.push({ t, kind: 'end', msg: 'Scheduled end of shot' });
    }
    return ev;
  }

  diagnostics(t: number, y: Float64Array): Record<string, number> {
    const ctx = this.ctx;
    if (!ctx.lastDiag.Te || ctx.diagStale) {
      // first frame, or after an ELM/sawtooth crash: re-evaluate the diagnostics from y (no step)
      ctx.diagStale = false;
      const st = ctx.view(y);
      const K = this.evaluateWorkArrays(t, st);
      stateDiagnostics(ctx, st, K, this.physics.transport.predictive);
    }
    return { ...ctx.lastDiag };
  }

  /** Evaluates every work array from the state st without taking a step (see PhysicsPipeline) */
  private evaluateWorkArrays(t: number, st: ProfileState): StepConstants { return this.physics.evaluateWorkArrays(t, st); }

  profiles(_y: Float64Array): Record<string, number[]> { return this.ctx.lastProf; }

  applyControl(patch: Record<string, number>): void {
    const ctrl = this.ctx.ctrl as unknown as Record<string, number>;
    for (const k of Object.keys(patch)) if (k in ctrl) ctrl[k] = patch[k];
  }
  getControls(): Record<string, number> { return { ...this.ctx.ctrl }; }

  /** Checkpoint of everything the continuation depends on besides y (checkpoint.ts) */
  saveInternal(): Record<string, number> { return this.checkpoints.save(this.checkpointParts); }
  restoreInternal(st: Record<string, number>): void { this.checkpoints.restore(st, this.checkpointParts); }

  geometryInfo(): Record<string, number> {
    const c = this.ctx.cfg, eq = this.ctx.eq, b = this.ctx.geomB;
    return {
      R: b.R, a: b.a, kappa: b.kappa, delta: b.delta, B0: c.B0, Ip_MA: c.Ip_MA,
      V: this.ctx.tg.volume, S: this.ctx.tg.surface, stellarator: 0, gap: c.magnet.gap_m, coilThickness: c.magnet.coilThickness_m, B_coil: this.magnetInfo.B_coil,
      profiles: 1, nRho: this.ctx.N, Raxis: eq.Raxis, shafranov: eq.shafranovShift, rhoTorB: eq.rhoTorB,
    };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const ctx = this.ctx;
    const last = hist[hist.length - 1];
    const d = last.d;
    const avg = (k: string) => flatTopMean(hist, k, { samples: 'all' });
    const warnings: string[] = [];
    if (this.eqInitResidual !== null) warnings.push(`Initial Grad–Shafranov equilibrium did not converge (residual ${this.eqInitResidual.toExponential(1)}) — it was used until the first accepted update${this.eqUpdates ? '' : ' (there was none)'}; geometry coefficients may be inaccurate.`);
    else if (ctx.eq && !ctx.eq.converged) warnings.push('Grad–Shafranov equilibrium did not fully converge — geometry coefficients may be inaccurate.');
    const nEq = this.eqUpdates + this.eqRejected;
    if (this.eqRejected > 0) warnings.push(`Grad–Shafranov: ${this.eqRejected} of ${nEq} equilibrium updates were rejected (no equilibrium of the transport profiles was found, or its tables did not converge to its flux surfaces) — the transport geometry was held at the last accepted equilibrium in between.`);
    if (this.forcedSteps > 0) warnings.push(`${this.forcedSteps} transport step(s) exhausted the Δt retries and were forced at the smallest Δt without Picard convergence — accuracy is reduced around those times.`);
    const nElm = events.filter((e) => e.kind === 'ELM').length;
    const nSaw = events.filter((e) => e.kind === 'sawtooth').length;
    return buildMagneticReport({
      cfg: ctx.cfg, method: this.method, g: ctx.geomB, V: ctx.tg.volume, magnetInfo: this.magnetInfo,
      terminated: ctx.terminated, tDisrupt: ctx.disruption.t, isStell: false,
      extraWarnings: warnings,
      extraEngineering: {
        'Model': '1.5D profiles + Grad–Shafranov',
        'Bootstrap fraction (avg.)': +avg('f_bs').toFixed(3), 'Driven-current fraction (avg.)': +avg('f_cd').toFixed(3),
        'Loop voltage (avg., V)': +avg('V_loop').toFixed(3), 'ℓ_i(3) (avg.)': +avg('li').toFixed(3), 'β_p (avg.)': +avg('betaP').toFixed(3),
        'q(0) / q95 (final)': `${(d.q0 ?? 0).toFixed(2)} / ${(d.q95 ?? 0).toFixed(2)}`,
        'Shafranov shift (m)': +ctx.eq.shafranovShift.toFixed(3),
        'GS updates accepted': this.eqUpdates, 'GS updates needing a retry': this.eqRetried, 'GS updates rejected': this.eqRejected,
        'Forced transport steps': this.forcedSteps,
        'Transport steps (accepted / rejected by the error test)': `${this.stepper.stats.accepted} / ${this.stepper.stats.rejected}`,
        ...(this.stepper.stats.newtonIters > 0 ? { 'Newton iterations / Jacobians / Picard fallbacks': `${this.stepper.stats.newtonIters} / ${this.stepper.stats.jacobians} / ${this.stepper.stats.fallbacks}` } : {}),
      },
      extraExtras: {
        'T_e axis (final, keV)': +(d.Te0 ?? 0).toFixed(2), 'T_ped (final, keV)': +(d.Tped ?? 0).toFixed(2), 'T_sep (final, keV)': +(d.Tsep ?? 0).toFixed(3),
        'ELM frequency (Hz)': this.elm.frequency(),
        'Sawtooth period (s)': nSaw > 1 ? +(last.t / nSaw).toFixed(2) : 0,
        'ELM count (1.5D)': nElm,
      },
    }, hist, events);
  }
}
