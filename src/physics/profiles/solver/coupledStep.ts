/**
 * Coupled implicit transport step of the 1.5D model.
 *
 * TR-BDF2 (solver/trbdf2.ts: Bank et al., IEEE Trans. CAD 4 (1985) 436; Hosea & Shampine, Appl. Numer. Math. 20 (1996) 21)
 * for T_e, T_i, n_e and ψ: second order, L-stable, one step, with an embedded error estimate that costs no further evaluation.
 * Both stages are backward-Euler-like solves with the interval d·Δt (d = 1 − √2/2): the trapezoidal stage to t + γΔt takes
 * the rate of the old state as an explicit source, the BDF2 stage a reference state that combines the old and the
 * intermediate one (HeatInputs.U0e, Xe, …). Within a stage the nonlinear coefficients (χ, D, v, the sources, σ∥, the
 * bootstrap current) are iterated by Picard iteration, accelerated by Anderson mixing of (T_e, T_i, n_e), which converges in
 * a few iterations also where χ depends steeply on the gradient (the critical-gradient model) and Picard alone oscillates;
 * within an iteration the equations are solved in sequence: density, then heat (T_e and T_i together, e–i exchange implicit),
 * then current diffusion. That is the fast path ('scaling' transport). A predictive model, whose χ depends on the gradient so steeply
 * that the frozen-coefficient iteration is not a contraction where the differential diffusivity exceeds twice χ, is solved by Newton–Raphson
 * on the four fields together (newtonStage.ts: coloured finite-difference block-tridiagonal Jacobian, line search), and a Newton solve that
 * does not converge is repeated by the Pereverzev–Corrigan stabilised Picard iteration (HeatInputs.pcFactor); ProfileSettings.nonlinearSolver
 * chooses. The inputs held fixed over a step (heating powers, boundary values, the fueling source, the sources'
 * prepare) are those of the old state.
 *
 * Δt control: the scaled error estimate of the step (ProfileSettings.rtol and atol on T_e, T_i, n_e and ψ; max-norm over the cells)
 * decides acceptance and sets the next Δt through an integral controller on it (trbdf2.ts). A step that misses the tolerance is repeated
 * with a smaller Δt. Events that fire when a threshold on the profiles is crossed (ELM, sawtooth; EventTrigger) are localised:
 * a step whose trigger margin changes sign ends at the crossing (localise.ts). A failed attempt (Picard not converged,
 * change above 35 %, non-finite state, or a numerical failure thrown by a module: a singular linear system, a Grad–Shafranov
 * failure; see failures.ts) is retried with Δt × 0.4. After STEP_MAX_ATTEMPTS failed attempts, or once Δt would fall below
 * STEP_DT_FLOOR, one forced attempt at that last Δt is accepted even without Picard convergence, but only if its whole state
 * is finite; otherwise the shot ends with a StepFailure at the last accepted state. Time advances only by the Δt of the attempt
 * whose state is committed. Any other exception is a programming error: it propagates, with the state restored. That holds for
 * an exception inside an implicit attempt and for one in the update after the accepted step (a plug-in's `accepted` hook, the
 * equilibrium update): y and the scalars of the shared context that a step changes (StepSnapshot) are put back, so that a
 * caller that catches the error and steps on continues exactly as if the failed step had not been tried. What a plug-in keeps
 * in its own fields is its own business (an `accepted` hook that fails half-way must not leave itself half-updated).
 *
 * What the error estimate does not see: the quantities that are updated once per accepted step and held fixed within it (the
 * scalars of the state: C_χ and its integral term, the inventories, the fast-ion pools, P_SOL and the boundary values, the fueling
 * command; the sources' prepare) are first order in Δt. A relative change of a profile above STEP_MAX_CHANGE (35 %) within a step counts
 * as an error above the tolerance, in proportion to the change.
 */
import { AndersonMixer } from '../../numerics/anderson';
import { KEV, ProfileContext, StepConstants } from '../context';
import { composition } from '../composition';
import { updateBoundary } from '../boundary/sol';
import type { FuelingControl } from '../control/fueling';
import { powerTotals } from '../diagnostics';
import type { DisruptionEvents } from '../events/disruption';
import type { EventModel, EventTrigger, TriggerScratch, TriggerState } from '../events/EventModel';
import { triggerScratch } from '../events/triggers';
import { solverErrorMessage } from '../eqguard';
import { StepFailure, isNumericalFailure } from '../failures';
import { Checkpointable, CheckpointRecord, recNum } from '../checkpoint';
import { CurrentInputs, DensityInputs, HEAT_CONVECTION, HeatInputs } from '../fvsolver';
import { currentProfiles } from '../qprofile';
import type { ProfileState } from '../state';
import { assembleHeatSources } from '../sources';
import type { PhysicsPipeline } from './pipeline';
import { EVENT_DT_MIN, locateEvent, stageWeights } from './localise';
import { STEP_DT_MIN } from '../settings';
import { NewtonStage } from './newtonStage';
import { TRBDF2_A, TRBDF2_B, TRBDF2_D, TRBDF2_EST, TRBDF2_GAMMA, acceptedFactor, errorExponent, rejectedFactor } from './trbdf2';

// implicit step retry policy
export const STEP_SHRINK = 0.4;
export const STEP_MAX_ATTEMPTS = 12;
export const STEP_DT_FLOOR = 1e-7;
/** relative change of a profile within one step above which an attempt fails */
export const STEP_MAX_CHANGE = 0.35;
/** bounds of the proposed Δt [s]; the upper one is ProfileSettings.dtMax when that is smaller (the lower one lives with the check of the settings, settings.ts, which keeps dtMax above it) */
export { STEP_DT_MIN };
export const STEP_DT_MAX = 0.5;
/** repetitions of a step after a rejection by the error test before the step is accepted at the floor */
export const STEP_MAX_REJECTS = 40;
/** repetitions of a step to end it at an event */
export const STEP_MAX_LOCALISE = 3;
/** Picard iterations per stage and depth of the Anderson mixing */
export const PICARD_MAX_ITER = 12;
export const PICARD_DEPTH = 4;
/** defaults of ProfileSettings.rtol and atol */
export const DEFAULT_RTOL = 1e-2;
export const DEFAULT_ATOL = 1e-4;
/** Newton solve of a stage (newtonStage.ts): iterations at most, and the contraction of the residual above which a kept Jacobian is renewed */
export const NEWTON_MAX_ITER = 12;
export const NEWTON_SLOW = 0.5;
/** Pereverzev–Corrigan factor c of the fallback iteration (HeatInputs.pcFactor): χ_PC = c χ on every face */
export const PC_FACTOR = 10;

/** Result of one implicit attempt: accepted, largest relative change, what it threw, the scaled error estimate (1 = the tolerance) */
export interface StepAttempt { ok: boolean; change: number; error?: unknown; err?: number }

/** Counters of the step control (diagnostics; part of the checkpoint so that a replay reports the same) */
export interface StepStats {
  /** accepted steps, steps rejected by the error test, failed attempts (Picard not converged, change too large, non-finite, thrown) */
  accepted: number; rejected: number; failed: number;
  /** steps shortened to end at an event */
  localised: number;
  /** Picard iterations of all attempts */
  picardIters: number;
  /** Newton iterations, Jacobians built, evaluations of the residual (Jacobians and line searches included), and Newton solves that failed and were repeated as Pereverzev–Corrigan Picard */
  newtonIters: number; jacobians: number; newtonEvals: number; fallbacks: number;
}

/**
 * The scalars and references of the shared context that a step changes besides y (the boundary
 * values and P_SOL, the loop voltage, the smoothed dW/dt and the ELM energy booked in it, the fast-ion
 * pools, the diagnostics, the equilibrium of an update, the pending events and issued warnings). The
 * work arrays are not part of it: every step evaluates them afresh.
 */
interface StepSnapshot {
  PSOL: number; GammaB: number; lastVloop: number; dWdtS: number; crashE: number; nsepGain: number; alphaRatio: number;
  WfAlpha: number; WfBeam: number; Pbound: number;
  /** replaced, never mutated, by a step */
  bc: ProfileContext['bc']; lastK: ProfileContext['lastK']; lastDiag: ProfileContext['lastDiag']; lastProf: ProfileContext['lastProf'];
  geo: ProfileContext['geo']; pending: number; warned: ReadonlySet<string>; forcedSteps: number;
}

function snapshotStep(ctx: ProfileContext, forcedSteps: number): StepSnapshot {
  return {
    PSOL: ctx.PSOL, GammaB: ctx.GammaB, lastVloop: ctx.lastVloop, dWdtS: ctx.dWdtS, crashE: ctx.crashE, nsepGain: ctx.nsepGain,
    alphaRatio: ctx.alphaRatio, WfAlpha: ctx.WfAlpha, WfBeam: ctx.WfBeam, Pbound: ctx.Pbound,
    bc: ctx.bc, lastK: ctx.lastK, lastDiag: ctx.lastDiag, lastProf: ctx.lastProf,
    geo: ctx.geo, pending: ctx.pending.length, warned: new Set(ctx.warned), forcedSteps,
  };
}

/** Puts the context back; returns the number of forced steps of the snapshot */
function restoreStep(ctx: ProfileContext, s: StepSnapshot): number {
  const { geo, pending, warned, forcedSteps, ...scalars } = s;
  Object.assign(ctx, scalars);
  if (ctx.geo !== geo) ctx.adoptGeometry(geo);
  ctx.pending.length = pending;
  ctx.warned = new Set(warned);
  return forcedSteps;
}

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

function maxAbs(a: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

/** Quadrature weights of the energy balance of one TR-BDF2 step: ΔW/Δt = w (P_n + P_γ) + d P_{n+1}, w = √2/4 */
const W_TRAP = TRBDF2_A * TRBDF2_D;

export class CoupledStepper implements Checkpointable {
  /** steps accepted by the forced last resort (Picard not converged at the smallest Δt) */
  forcedSteps = 0;
  /** set when the shot was ended by a numerical failure */
  stepFailure: StepFailure | null = null;
  /** counters of the step control */
  stats: StepStats = { accepted: 0, rejected: 0, failed: 0, localised: 0, picardIters: 0, newtonIters: 0, jacobians: 0, newtonEvals: 0, fallbacks: 0 };
  /**
   * Discrete energy balance of the last attempt: (ΔW/Δt − (w P_n + w P_γ + d P_{n+1}))/P_heat with P = P_heat − P_rad − P_bound
   * at the old, the intermediate and the new state and w = √2/4: zero to the Picard tolerance (the interior fluxes and the
   * e–i exchange cancel in the sum over the cells; energy.test.ts).
   */
  energyResidual = 0;
  /** the scaled error estimate of the last attempt (1 = the tolerance), and where it is largest: profile (0 T_e, 1 T_i, 2 n_e, 3 ψ) and cell */
  lastErr = 0;
  lastErrAt = { field: 0, cell: 0 };

  private readonly triggers: readonly EventTrigger[];
  // old-state rates and references (per volume)
  private readonly U0e: Float64Array; private readonly U0i: Float64Array;
  private readonly Rne: Float64Array; private readonly RTe: Float64Array; private readonly RTi: Float64Array; private readonly Rpsi: Float64Array;
  private readonly GammaFn: Float64Array;
  // the filtered error estimate: raw and filtered per profile, references, a zero array
  private readonly eTe: Float64Array; private readonly eTi: Float64Array; private readonly eNe: Float64Array; private readonly ePsi: Float64Array;
  private readonly fTe: Float64Array; private readonly fTi: Float64Array; private readonly fNe: Float64Array; private readonly fPsi: Float64Array;
  private readonly fU0e: Float64Array; private readonly fU0i: Float64Array; private readonly zero: Float64Array;
  // stage-1 result and the reference state of stage 2
  private readonly yG: Float64Array; private readonly niG: Float64Array;
  private readonly refN: Float64Array; private readonly refUe: Float64Array; private readonly refUi: Float64Array; private readonly refPsi: Float64Array;
  // Anderson mixing of (T_e, T_i, n_e)
  private readonly mixer: AndersonMixer; private readonly xk: Float64Array; private readonly gk: Float64Array;
  // event localisation: composition ratios at the two ends, margins, interpolated state
  private readonly rOld: Float64Array; private readonly rNew: Float64Array;
  private mOld: number[]; private mNew: number[];
  private readonly iTe: Float64Array; private readonly iTi: Float64Array; private readonly ine: Float64Array; private readonly ipsi: Float64Array; private readonly irat: Float64Array;
  private readonly scratch: TriggerScratch;
  // Newton solve of a stage, and the iterate that it started from (restored when it fails)
  private readonly newton: NewtonStage;
  private readonly guess: Float64Array;
  private readonly wbuf: [number, number, number] = [0, 0, 0];
  private views: { o: ProfileState; g: ProfileState; v: ProfileState } | null = null;

  constructor(
    private readonly ctx: ProfileContext,
    private readonly physics: PhysicsPipeline,
    private readonly fueling: FuelingControl,
    private readonly disruption: DisruptionEvents,
    /** update after an accepted step from t to t + dt (scalars, controllers, diagnostics, equilibrium) */
    private readonly accept: (t: number, dt: number, yOld: Float64Array, y: Float64Array) => void,
    /** event models: those with a trigger are localised inside a step */
    events: readonly EventModel[] = [],
  ) {
    const N = ctx.N;
    const arr = () => new Float64Array(N);
    this.triggers = events.flatMap((e) => (e.trigger ? [e.trigger] : []));
    this.U0e = arr(); this.U0i = arr(); this.Rne = arr(); this.RTe = arr(); this.RTi = arr(); this.Rpsi = arr();
    this.GammaFn = new Float64Array(N + 1);
    this.eTe = arr(); this.eTi = arr(); this.eNe = arr(); this.ePsi = arr();
    this.fTe = arr(); this.fTi = arr(); this.fNe = arr(); this.fPsi = arr();
    this.fU0e = arr(); this.fU0i = arr(); this.zero = arr();
    this.yG = new Float64Array(ctx.layout.size); this.niG = arr();
    this.refN = arr(); this.refUe = arr(); this.refUi = arr(); this.refPsi = arr();
    this.mixer = new AndersonMixer(3 * N, PICARD_DEPTH); this.xk = new Float64Array(3 * N); this.gk = new Float64Array(3 * N);
    this.rOld = arr(); this.rNew = arr();
    this.mOld = new Array<number>(this.triggers.length).fill(-1); this.mNew = new Array<number>(this.triggers.length).fill(-1);
    this.iTe = arr(); this.iTi = arr(); this.ine = arr(); this.ipsi = arr(); this.irat = arr();
    this.scratch = triggerScratch(N);
    this.newton = new NewtonStage(ctx, physics);
    this.guess = new Float64Array(4 * N);
  }

  /** SimModel.step: advances y in place from t towards tMax, returns the new time */
  step(t: number, y: Float64Array, tMax: number): number {
    const ctx = this.ctx;
    if (ctx.phase === 'ended') return tMax;
    if (ctx.phase !== 'normal') return this.disruption.quenchStep(ctx, t, y, tMax);
    const dtWant = Math.min(ctx.dt, ctx.ps.dtMax ?? STEP_DT_MAX);
    const dt = Math.min(dtWant, tMax - t);
    if (dt <= 0) return t;
    const yOld = Float64Array.from(y);
    const snap = snapshotStep(ctx, this.forcedSteps);
    try {
      return this.advance(t, dt, dtWant, yOld, y);
    } catch (e) {
      // a programming error (an exception that is no numerical failure): the step did not happen
      y.set(yOld);
      this.forcedSteps = restoreStep(ctx, snap);
      throw e;
    }
  }

  /** The step from t: implicit attempts with retries, then the update after the accepted one */
  private advance(t: number, dt0: number, dtWant: number, yOld: Float64Array, y: Float64Array): number {
    const ctx = this.ctx;
    let dt = dt0;
    // the Δt of the attempt before it was cut short (by the output time or an event), for the controller
    let dtFull = dtWant, cut = dt0 < dtWant;
    let r = this.tryImplicitStep(t, dt, yOld, y);
    let attempts = 1, retried = false, forced = false, rejects = 0, located = 0;
    let prev: { dt: number; err: number } | null = null; // the previous rejected attempt of this step
    for (;;) {
      if (!r.ok) {
        this.stats.failed++;
        if (forced) break;
        y.set(yOld);
        dt *= STEP_SHRINK; dtFull = dt; cut = false; retried = true;
        forced = dt < STEP_DT_FLOOR || attempts >= STEP_MAX_ATTEMPTS;
        r = this.tryImplicitStep(t, dt, yOld, y);
        attempts++;
        continue;
      }
      const err = r.err ?? 0;
      if (err > 1 && dt > STEP_DT_FLOOR && rejects < STEP_MAX_REJECTS) {
        // the error test failed: the same step with a smaller Δt
        this.stats.rejected++;
        rejects++;
        y.set(yOld);
        const order = prev ? errorExponent(prev.dt, prev.err, dt, err) : 1;
        prev = { dt, err };
        dt *= rejectedFactor(err, order); dtFull = dt; cut = false; retried = true;
        r = this.tryImplicitStep(t, dt, yOld, y);
        attempts++;
        continue;
      }
      if (located < STEP_MAX_LOCALISE && !forced) {
        // an event whose trigger crosses its threshold inside the step: end the step at the crossing
        const theta = this.locate(t, dt);
        const dtEvent = Math.max(theta * dt, EVENT_DT_MIN);
        if (theta < 1 && dtEvent < dt) {
          this.stats.localised++;
          located++;
          y.set(yOld);
          if (!cut) dtFull = dt;
          cut = true; dt = dtEvent;
          r = this.tryImplicitStep(t, dt, yOld, y);
          attempts++;
          continue;
        }
      }
      break;
    }
    if (forced && (r.error !== undefined || !allFinite(y))) {
      y.set(yOld);
      const detail = r.error !== undefined ? solverErrorMessage(r.error) : 'the forced attempt produced a non-finite state';
      this.fail(new StepFailure(t, dt, attempts, detail, { cause: r.error }));
      return t;
    }
    if (forced) {
      this.forcedSteps++;
      ctx.warnOnce('forced', t + dt, `Transport step at t = ${t.toFixed(4)} s did not converge in ${attempts - 1} attempts; forced at Δt = ${dt.toExponential(1)} s (Picard not converged) — accuracy is reduced here`);
    }
    this.accept(t, dt, yOld, y);
    this.stats.accepted++;
    // Δt control: the integral controller on the error of the step, or, for a step that was cut short (by the output time
    // or an event: it says nothing about the length that was proposed), on the error that the full Δt would have had (∝ Δt³, the
    // asymptotic law; the error of a short step is small and the extrapolation makes the proposal for the next step no larger than 2 times it)
    const errFull = cut ? (r.err ?? 0) * Math.pow(dtFull / dt, 3) : (r.err ?? 0);
    const fac = acceptedFactor(errFull, retried);
    const next = (cut ? dtFull : dt) * fac;
    ctx.dt = Math.min(Math.max(next, STEP_DT_MIN), ctx.ps.dtMax ?? STEP_DT_MAX);
    return t + dt;
  }

  save(rec: CheckpointRecord): void {
    rec.forcedSteps = this.forcedSteps;
    rec.stepAccepted = this.stats.accepted; rec.stepRejected = this.stats.rejected; rec.stepFailed = this.stats.failed;
    rec.stepLocalised = this.stats.localised; rec.stepPicardIters = this.stats.picardIters;
    rec.stepNewtonIters = this.stats.newtonIters; rec.stepJacobians = this.stats.jacobians; rec.stepNewtonEvals = this.stats.newtonEvals; rec.stepFallbacks = this.stats.fallbacks;
  }
  restore(rec: Readonly<CheckpointRecord>): void {
    this.forcedSteps = recNum(rec, 'forcedSteps', this.forcedSteps);
    this.stats = {
      accepted: recNum(rec, 'stepAccepted', 0), rejected: recNum(rec, 'stepRejected', 0), failed: recNum(rec, 'stepFailed', 0),
      localised: recNum(rec, 'stepLocalised', 0), picardIters: recNum(rec, 'stepPicardIters', 0),
      newtonIters: recNum(rec, 'stepNewtonIters', 0), jacobians: recNum(rec, 'stepJacobians', 0), newtonEvals: recNum(rec, 'stepNewtonEvals', 0), fallbacks: recNum(rec, 'stepFallbacks', 0),
    };
    this.stepFailure = null;
  }

  /**
   * implicitStep with a numerical failure (singular linear system, Grad–Shafranov failure of a
   * module) turned into a failed attempt. Anything else it throws is a programming error of a
   * module or plug-in: it propagates (step() puts the state back).
   */
  private tryImplicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): StepAttempt {
    try {
      return this.implicitStep(t, dt, yOld, y);
    } catch (e) {
      if (!isNumericalFailure(e)) throw e;
      return { ok: false, change: Infinity, error: e };
    }
  }

  /** Ends the shot on a numerical failure: explicit termination and 'end' event, state kept at the last accepted step */
  private fail(e: StepFailure): void {
    const ctx = this.ctx;
    this.stepFailure = e;
    ctx.phase = 'ended';
    ctx.terminated = {
      t: e.t, natural: false, reason: 'Numerical failure',
      diagnosis: `The implicit transport solver could not advance the plasma: ${e.message}. The shot was stopped at the last accepted state rather than continued with a non-converged or non-finite one.`,
      fix: 'This is a solver failure, not a plasma limit: try a coarser radial grid (nRho) or slower heating/density ramps, or run the shot at 0D fidelity.',
    };
    ctx.pending.push({ t: e.t, kind: 'end', msg: `Numerical failure — ${e.message}` });
  }

  // ------------------------------------------------------------------------------------------------ one TR-BDF2 attempt

  /**
   * One TR-BDF2 step of length dt from yOld into y (y holds yOld on entry); returns acceptance (Picard converged in both
   * stages, a finite state, a change below 35 %), the largest relative change and the scaled error estimate. The parts held
   * fixed over the step (composition and q profile of the old state, boundary values, step constants, fueling source) are
   * evaluated once, then the rates of the old state, the trapezoidal stage and the BDF2 stage.
   */
  implicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): StepAttempt {
    const ctx = this.ctx, physics = this.physics;
    const N = ctx.N, w = ctx.w;
    const o = ctx.view(yOld);
    const v = ctx.view(y);
    const g1 = ctx.view(this.yG);
    const s = v.s;
    const dtEff = TRBDF2_D * dt;
    const rtol = ctx.ps.rtol ?? DEFAULT_RTOL;
    const tolPicard = Math.min(2e-3, 0.1 * rtol);
    // the boundary condition of the current diffusion at the end of each stage: the plasma-current programme, or the control Ip_MA
    const ip1 = ctx.ipAt(t + TRBDF2_GAMMA * dt), ip2 = ctx.ipAt(t + dt);
    // old composition and current profiles
    composition(ctx, o.Te, o.ne, o.s);
    w.ni0.set(w.ni);
    if (this.solverMode() === 'newton') this.newton.begin(o, dtEff, w.ni0);
    currentProfiles(ctx, o.psi, o.s.Ip);
    // boundary values (lagged P_SOL)
    updateBoundary(ctx, t, o);
    const K: StepConstants = physics.stepConstants(t, o);
    // fueling feedback and particle source
    this.fueling.particleSource(ctx, t, dt, o, v, K);
    physics.particleSources(t, dt, o, K);
    // rates of the old state, and the trigger margins of the events
    for (let i = 0; i < N; i++) this.rOld[i] = w.ni0[i] / Math.max(o.ne[i], 1);
    this.views = { o, g: g1, v };
    this.margins(this.mOld, o, this.rOld);
    const netOld = this.oldRates(o, K);
    const W0 = ctx.storedEnergy(o, w.ni0);

    // stage 1: trapezoidal rule to t + γΔt (backward Euler over d·Δt with the rate of the old state as an explicit source)
    for (let i = 0; i < N; i++) { this.U0e[i] = 1.5 * o.ne[i] * o.Te[i]; this.U0i[i] = 1.5 * w.ni0[i] * o.Ti[i]; }
    const heat1: HeatInputs = this.heatInputs(dtEff, o, v, this.U0e, this.U0i, this.RTe, this.RTi);
    const dens1: DensityInputs = { dt: dtEff, n0: o.ne, D: w.D, v: w.v, S: w.Sn, nB: ctx.bc.n, X: this.Rne };
    const cur1: CurrentInputs = { dt: dtEff, psi0: o.psi, sigma: w.sigma, jniB: w.jniB, Ip: ip1, rate0: this.Rpsi };
    s.Ip = ip1;
    const st1 = this.solveStage(v, K, heat1, dens1, cur1, tolPicard);
    const net1 = this.endStage(v, K, heat1);
    if (!allFinite(y)) return { ok: false, change: Infinity };
    this.yG.set(y); this.niG.set(w.ni);
    let conv = st1;

    // stage 2: BDF2 from the old and the intermediate state; the initial iterate extrapolates the first stage
    for (let i = 0; i < N; i++) {
      this.refN[i] = TRBDF2_A * g1.ne[i] + TRBDF2_B * o.ne[i];
      this.refUe[i] = TRBDF2_A * 1.5 * g1.ne[i] * g1.Te[i] + TRBDF2_B * this.U0e[i];
      this.refUi[i] = TRBDF2_A * 1.5 * this.niG[i] * g1.Ti[i] + TRBDF2_B * this.U0i[i];
      this.refPsi[i] = TRBDF2_A * g1.psi[i] + TRBDF2_B * o.psi[i];
      v.Te[i] = Math.max(g1.Te[i] + (g1.Te[i] - o.Te[i]) / TRBDF2_GAMMA, 0.005);
      v.Ti[i] = Math.max(g1.Ti[i] + (g1.Ti[i] - o.Ti[i]) / TRBDF2_GAMMA, 0.005);
      v.ne[i] = Math.max(g1.ne[i] + (g1.ne[i] - o.ne[i]) / TRBDF2_GAMMA, 1e15);
      v.psi[i] = g1.psi[i] + (g1.psi[i] - o.psi[i]) / TRBDF2_GAMMA;
    }
    const heat2: HeatInputs = this.heatInputs(dtEff, o, v, this.refUe, this.refUi);
    const dens2: DensityInputs = { dt: dtEff, n0: this.refN, D: w.D, v: w.v, S: w.Sn, nB: ctx.bc.n };
    const cur2: CurrentInputs = { dt: dtEff, psi0: this.refPsi, sigma: w.sigma, jniB: w.jniB, Ip: ip2 };
    s.Ip = ip2;
    conv = this.solveStage(v, K, heat2, dens2, cur2, tolPicard) && conv;
    // power across the separatrix with the inputs of the last heat solve (before the final composition replaces w.ni):
    // closes the discrete energy balance of the step
    const lb = ctx.heat.boundaryLoss(heat2, v.Te, v.Ti);
    ctx.Pbound = (lb.e + lb.i) * KEV;
    const P = powerTotals(ctx, K);
    const netNew = P.P_heat - P.P_rad - ctx.Pbound;
    // final consistency: the composition, the q profile and the pressure of the new state (the pressure of the work arrays is that of the
    // last Picard iterate, a step of the iteration behind, and the pedestal gradient α_ped/α_crit of the diagnostics and of the ELM
    // trigger amplifies the difference)
    composition(ctx, v.Te, v.ne, s);
    currentProfiles(ctx, v.psi, s.Ip);
    for (let i = 0; i < N; i++) w.p[i] = (v.ne[i] * Math.max(v.Te[i], 0.01) + w.ni[i] * Math.max(v.Ti[i], 0.01)) * KEV;
    let change = 0, finite = true;
    for (let i = 0; i < N; i++) {
      if (!isFinite(v.Te[i]) || !isFinite(v.Ti[i]) || !isFinite(v.ne[i]) || !isFinite(v.psi[i])) finite = false;
      change = Math.max(change, Math.abs(v.Te[i] - o.Te[i]) / Math.max(o.Te[i], 0.1), Math.abs(v.Ti[i] - o.Ti[i]) / Math.max(o.Ti[i], 0.1),
        Math.abs(v.ne[i] - o.ne[i]) / Math.max(o.ne[i], 1e18));
    }
    ctx.lastK = K;
    if (!finite) return { ok: false, change };
    const W1 = ctx.storedEnergy(v);
    this.energyResidual = ((W1 - W0) / dt - (W_TRAP * (netOld + net1) + TRBDF2_D * netNew)) / Math.max(P.P_heat, 1);
    for (let i = 0; i < N; i++) this.rNew[i] = w.ni[i] / Math.max(v.ne[i], 1);
    this.margins(this.mNew, v, this.rNew);
    // a change above STEP_MAX_CHANGE counts as an error above the tolerance, in proportion to the change
    const err = Math.max(this.errorNorm(dt, o, g1, v), change >= STEP_MAX_CHANGE ? (change / STEP_MAX_CHANGE) ** 2 : 0);
    this.lastErr = err;
    return { ok: conv || dt < 1e-4, change, err };
  }

  /** The inputs of a heat solve of a stage: the iterate and its composition, the coefficients of the work arrays */
  private heatInputs(dt: number, o: ProfileState, v: ProfileState, U0e: Float64Array, U0i: Float64Array, Xe?: Float64Array, Xi?: Float64Array): HeatInputs {
    const ctx = this.ctx, w = ctx.w;
    return {
      dt, ne0: o.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: o.Te, Ti0: o.Ti, U0e, U0i, Xe, Xi, chiE: w.chiE, chiI: w.chiI,
      Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: w.TeIt, TiStar: w.TiIt, nuEq: w.nuEq, GammaF: ctx.dens.GammaF,
      convCoef: HEAT_CONVECTION, TeB: ctx.bc.Te, TiB: ctx.bc.Ti, nB: ctx.bc.n,
    };
  }

  /**
   * The rates of the old state o (the explicit terms of the trapezoidal stage and the R_n of the error estimate), per volume:
   * evaluates the transport coefficients and the sources on o, then the right-hand sides of the density, energy and current
   * equations. Returns the net power P_heat − P_rad − P_bound of the old state [W] (energy balance).
   */
  private oldRates(o: ProfileState, K: StepConstants): number {
    const ctx = this.ctx, physics = this.physics, w = ctx.w;
    physics.transportCoefficients(o);
    physics.heatSources(o, K);
    physics.currentSources(o, K);
    assembleHeatSources(ctx);
    ctx.dens.residual({ D: w.D, v: w.v, S: w.Sn, nB: ctx.bc.n }, o.ne, this.GammaFn, this.Rne);
    const h: HeatInputs = {
      dt: 1, ne0: o.ne, ne1: o.ne, ni0: w.ni0, ni1: w.ni0, Te0: o.Te, Ti0: o.Ti, chiE: w.chiE, chiI: w.chiI,
      Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: o.Te, TiStar: o.Ti, nuEq: w.nuEq, GammaF: this.GammaFn,
      convCoef: HEAT_CONVECTION, TeB: ctx.bc.Te, TiB: ctx.bc.Ti, nB: ctx.bc.n,
    };
    ctx.heat.residual(h, o.Te, o.Ti, this.RTe, this.RTi);
    ctx.cur.rate({ sigma: w.sigma, jniB: w.jniB, Ip: o.s.Ip }, o.psi, this.Rpsi);
    const lb = ctx.heat.boundaryLoss(h, o.Te, o.Ti);
    const P = powerTotals(ctx, K);
    return P.P_heat - P.P_rad - (lb.e + lb.i) * KEV;
  }

  /**
   * How a stage is solved (ProfileSettings.nonlinearSolver): 'picard' (Picard with Anderson mixing, the fast path), 'newton'
   * (Newton–Raphson on the coupled system, with the Pereverzev–Corrigan Picard iteration as the fallback) or 'pc' (that Picard
   * iteration alone). 'auto', the default: Newton for a predictive transport model (χ depends on the gradient: the frozen-coefficient
   * iteration is not a contraction where the differential diffusivity is more than twice χ), Picard otherwise.
   */
  private solverMode(): 'picard' | 'newton' | 'pc' {
    const m = this.ctx.ps.nonlinearSolver ?? 'auto';
    if (m === 'auto') return this.physics.transport.predictive ? 'newton' : 'picard';
    return m;
  }

  /** One stage on the iterate v: Newton with the Pereverzev–Corrigan fallback, or Picard (solverMode) */
  private solveStage(v: ProfileState, K: StepConstants, heat: HeatInputs, dens: DensityInputs, cur: CurrentInputs, tol: number): boolean {
    const mode = this.solverMode();
    if (mode === 'picard') return this.picard(v, K, heat, dens, cur, tol, 0);
    if (mode === 'newton') {
      const N = this.ctx.N, g = this.guess;
      g.set(v.Te, 0); g.set(v.Ti, N); g.set(v.ne, 2 * N); g.set(v.psi, 3 * N);
      const r = this.newton.solve(v, K, heat, dens, cur, { tol, maxIter: NEWTON_MAX_ITER, slow: NEWTON_SLOW });
      this.stats.newtonIters += r.iterations; this.stats.jacobians += r.jacobians; this.stats.newtonEvals += r.evaluations;
      if (r.converged) return true;
      // Newton did not converge (a line search that found no descent, a singular Jacobian, too many iterations): the same stage by the
      // stabilised Picard iteration from where the stage started
      this.stats.fallbacks++;
      v.Te.set(g.subarray(0, N)); v.Ti.set(g.subarray(N, 2 * N)); v.ne.set(g.subarray(2 * N, 3 * N)); v.psi.set(g.subarray(3 * N, 4 * N));
    }
    return this.picard(v, K, heat, dens, cur, tol, PC_FACTOR);
  }

  /**
   * Picard iteration of one stage on the iterate v (T_e, T_i, n_e), accelerated by Anderson mixing: coefficients from the
   * iterate → density → composition → sources → q profile → current sources → heat → current. Converged when the largest
   * relative change of T_e, T_i, n_e between the iterate and its image is below tol. The last image is left in v. pcFactor > 0:
   * the Pereverzev–Corrigan stabilisation of the heat solve (HeatInputs.pcFactor).
   */
  private picard(v: ProfileState, K: StepConstants, heat: HeatInputs, dens: DensityInputs, cur: CurrentInputs, tol: number, pcFactor: number): boolean {
    const ctx = this.ctx, physics = this.physics, w = ctx.w, N = ctx.N, s = v.s;
    const { mixer, xk, gk } = this;
    mixer.reset();
    heat.pcFactor = pcFactor > 0 ? pcFactor : undefined;
    const sTe = Math.max(maxAbs(v.Te), 1e-3), sTi = Math.max(maxAbs(v.Ti), 1e-3), sNe = Math.max(maxAbs(v.ne), 1e15);
    let conv = false;
    for (let it = 0; it < PICARD_MAX_ITER; it++) {
      this.stats.picardIters++;
      w.TeIt.set(v.Te); w.TiIt.set(v.Ti); w.neIt.set(v.ne);
      physics.transportCoefficients(v);
      // 1) density
      ctx.dens.solve(dens, v.ne);
      for (let i = 0; i < N; i++) if (!(v.ne[i] > 1e15)) v.ne[i] = 1e15;
      composition(ctx, v.Te, v.ne, s);
      // 2) sources
      physics.heatSources(v, K);
      currentProfiles(ctx, v.psi, s.Ip);
      physics.currentSources(v, K);
      assembleHeatSources(ctx);
      // 3) heat (T_e, T_i together)
      ctx.heat.solve(heat, v.Te, v.Ti);
      for (let i = 0; i < N; i++) { if (!(v.Te[i] > 0.005)) v.Te[i] = 0.005; if (!(v.Ti[i] > 0.005)) v.Ti[i] = 0.005; }
      // 4) current
      ctx.cur.solve(cur, v.psi);
      // convergence
      let dmax = 0;
      for (let i = 0; i < N; i++) {
        dmax = Math.max(dmax, Math.abs(v.Te[i] - w.TeIt[i]) / Math.max(w.TeIt[i], 0.05),
          Math.abs(v.Ti[i] - w.TiIt[i]) / Math.max(w.TiIt[i], 0.05), Math.abs(v.ne[i] - w.neIt[i]) / Math.max(w.neIt[i], 1e17));
      }
      if (dmax < tol && it > 0) { conv = true; break; }
      if (!(dmax < Infinity) || it === PICARD_MAX_ITER - 1) break; // not finite, or out of iterations: the last image stays in v
      // Anderson step on the scaled iterate: x_{k+1} from G(x_k) = the solve above and its history
      for (let i = 0; i < N; i++) {
        xk[i] = w.TeIt[i] / sTe; xk[N + i] = w.TiIt[i] / sTi; xk[2 * N + i] = w.neIt[i] / sNe;
        gk[i] = v.Te[i] / sTe; gk[N + i] = v.Ti[i] / sTi; gk[2 * N + i] = v.ne[i] / sNe;
      }
      mixer.step(xk, gk, 1);
      for (let i = 0; i < N; i++) {
        v.Te[i] = Math.max(xk[i] * sTe, 0.005); v.Ti[i] = Math.max(xk[N + i] * sTi, 0.005); v.ne[i] = Math.max(xk[2 * N + i] * sNe, 1e15);
      }
    }
    heat.pcFactor = undefined;
    return conv;
  }

  /**
   * After a stage: the net power P_heat − P_rad − P_bound of the last iterate [W] (P_bound with the inputs of the last heat
   * solve), then the composition and q profile of the stage state. The last stage's P_bound is set by the caller.
   */
  private endStage(v: ProfileState, K: StepConstants, heat: HeatInputs): number {
    const ctx = this.ctx;
    const lb = ctx.heat.boundaryLoss(heat, v.Te, v.Ti);
    const P = powerTotals(ctx, K);
    const net = P.P_heat - P.P_rad - (lb.e + lb.i) * KEV;
    composition(ctx, v.Te, v.ne, v.s);
    currentProfiles(ctx, v.psi, v.s.Ip);
    return net;
  }

  /**
   * Scaled error estimate of the step (1 = the tolerance): the TR-BDF2 estimate of the local truncation error (trbdf2.ts) of the
   * density, the energy contents (3/2) n_e T_e and (3/2) n_i T_i and ψ, converted to T_e, T_i, n_e and ψ and filtered with
   * (I − d Δt J)⁻¹ (below), over atol · max|y| + rtol · |y| of each profile; the largest value over the cells and the four profiles.
   *
   * The raw estimate assumes a smooth solution. A component that is stiff over the step (the outermost cells: a half cell from
   * the separatrix, diffusion times of microseconds) responds to the change of its neighbours and of the boundary value within the
   * step at once, the trapezoidal stage rings on it, and the estimate reports the ringing, 100 to 1000 times the error of the
   * cells inside, although the BDF2 stage (L-stable) has damped it in the result. Hosea and Shampine (1996, section 5) filter the
   * estimate with the inverse of the iteration matrix, which is the operator of the last stage solve with its frozen
   * coefficients: components with λ d Δt ≫ 1 are damped by 1/(1 + λ d Δt), smooth ones are not changed.
   */
  private errorNorm(dt: number, o: ProfileState, g1: ProfileState, v: ProfileState): number {
    const ctx = this.ctx, w = ctx.w, N = ctx.N;
    const c = TRBDF2_EST;
    const dtEff = TRBDF2_D * dt;
    const rtol = ctx.ps.rtol ?? DEFAULT_RTOL, atol = ctx.ps.atol ?? DEFAULT_ATOL;
    const { eTe, eTi, eNe, ePsi, fTe, fTi, fNe, fPsi, zero } = this;
    for (let i = 0; i < N; i++) {
      const estN = c.cR * dt * this.Rne[i] + c.cN * o.ne[i] + c.cG * g1.ne[i] + c.cE * v.ne[i];
      const estUe = c.cR * dt * this.RTe[i] + c.cN * this.U0e[i] + c.cG * 1.5 * g1.ne[i] * g1.Te[i] + c.cE * 1.5 * v.ne[i] * v.Te[i];
      const estUi = c.cR * dt * this.RTi[i] + c.cN * this.U0i[i] + c.cG * 1.5 * this.niG[i] * g1.Ti[i] + c.cE * 1.5 * w.ni[i] * v.Ti[i];
      eNe[i] = estN;
      eTe[i] = (estUe - 1.5 * v.Te[i] * estN) / (1.5 * v.ne[i]);
      eTi[i] = (estUi - 1.5 * v.Ti[i] * (w.ni[i] / v.ne[i]) * estN) / (1.5 * w.ni[i]);
      ePsi[i] = c.cR * dt * this.Rpsi[i] + c.cN * o.psi[i] + c.cG * g1.psi[i] + c.cE * v.psi[i];
    }
    // the filter: one solve of each system with the coefficients of the last iterate, the estimate as the reference state, no sources
    // and zero boundary values
    const U0e = this.fU0e, U0i = this.fU0i;
    for (let i = 0; i < N; i++) { U0e[i] = 1.5 * v.ne[i] * eTe[i]; U0i[i] = 1.5 * w.ni[i] * eTi[i]; }
    ctx.dens.filter({ dt: dtEff, D: w.D, v: w.v }, eNe, fNe);
    ctx.heat.solve({
      dt: dtEff, ne0: v.ne, ne1: v.ne, ni0: w.ni, ni1: w.ni, Te0: zero, Ti0: zero, U0e, U0i, chiE: w.chiE, chiI: w.chiI,
      Qe: zero, Qi: zero, Le: w.Le, Li: w.Li, TeStar: zero, TiStar: zero, nuEq: w.nuEq, GammaF: ctx.dens.GammaF,
      convCoef: HEAT_CONVECTION, TeB: 0, TiB: 0, nB: ctx.bc.n,
    }, fTe, fTi);
    ctx.cur.solve({ dt: dtEff, psi0: ePsi, sigma: w.sigma, jniB: zero, Ip: 0 }, fPsi);
    const aTe = atol * Math.max(maxAbs(o.Te), maxAbs(v.Te)), aTi = atol * Math.max(maxAbs(o.Ti), maxAbs(v.Ti));
    const aNe = atol * Math.max(maxAbs(o.ne), maxAbs(v.ne)), aPsi = atol * Math.max(maxAbs(o.psi), maxAbs(v.psi));
    let err = 0;
    for (let i = 0; i < N; i++) {
      const e = [
        Math.abs(fTe[i]) / (aTe + rtol * Math.max(Math.abs(o.Te[i]), Math.abs(v.Te[i]))),
        Math.abs(fTi[i]) / (aTi + rtol * Math.max(Math.abs(o.Ti[i]), Math.abs(v.Ti[i]))),
        Math.abs(fNe[i]) / (aNe + rtol * Math.max(o.ne[i], v.ne[i])),
        Math.abs(fPsi[i]) / (aPsi + rtol * Math.max(Math.abs(o.psi[i]), Math.abs(v.psi[i]))),
      ];
      for (let f = 0; f < 4; f++) if (!(e[f] <= err)) { err = e[f]; this.lastErrAt = { field: f, cell: i }; }
    }
    return Number.isFinite(err) ? err : Infinity;
  }

  // ------------------------------------------------------------------------------------------------ event localisation

  /** Trigger margins of every event model with a trigger on the state st (composition ratio n_i/n_e: rat) */
  private margins(out: number[], st: ProfileState, rat: Float64Array): void {
    const ctx = this.ctx;
    if (this.triggers.length === 0) return;
    const ts: TriggerState = { Te: st.Te, Ti: st.Ti, ne: st.ne, psi: st.psi, niOverNe: rat, Ip: st.s.Ip };
    for (let k = 0; k < this.triggers.length; k++) out[k] = this.triggers[k].margin(ctx, ts, this.scratch);
  }

  /** Margin of trigger k on the dense output of the last attempt at the fraction theta of its step (the quadratic through the three states) */
  private marginAt(k: number, theta: number): number {
    const ctx = this.ctx, N = ctx.N;
    const { o, g, v } = this.views!;
    const [w0, w1, w2] = stageWeights(theta, this.wbuf);
    for (let i = 0; i < N; i++) {
      this.iTe[i] = w0 * o.Te[i] + w1 * g.Te[i] + w2 * v.Te[i];
      this.iTi[i] = w0 * o.Ti[i] + w1 * g.Ti[i] + w2 * v.Ti[i];
      this.ine[i] = w0 * o.ne[i] + w1 * g.ne[i] + w2 * v.ne[i];
      this.ipsi[i] = w0 * o.psi[i] + w1 * g.psi[i] + w2 * v.psi[i];
      this.irat[i] = (1 - theta) * this.rOld[i] + theta * this.rNew[i];
    }
    const ts: TriggerState = { Te: this.iTe, Ti: this.iTi, ne: this.ine, psi: this.ipsi, niOverNe: this.irat, Ip: o.s.Ip === v.s.Ip ? v.s.Ip : (1 - theta) * o.s.Ip + theta * v.s.Ip };
    return this.triggers[k].margin(ctx, ts, this.scratch);
  }

  /** Fraction of the step of the last attempt (from t, length dt) at which the first event fires: 1 if none is localised inside it */
  private locate(t: number, dt: number): number {
    let best = 1;
    for (let k = 0; k < this.triggers.length; k++) {
      if (!(this.mNew[k] > 0) && !(this.mOld[k] > 0)) continue; // the margin stays negative at both ends (a crossing pair inside is not resolved)
      const thetaReady = (this.triggers[k].readyAt(this.ctx) - t) / dt;
      best = Math.min(best, locateEvent((th) => this.marginAt(k, th), this.mOld[k], this.mNew[k], thetaReady));
    }
    return best;
  }
}
