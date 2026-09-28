/**
 * Coupled implicit transport step of the 1.5D model.
 *
 * Backward Euler (L-stable) for T_e, T_i, n_e and ψ with a Picard iteration on the nonlinear
 * coefficients (at most 8 iterations, converged below a relative change of 2·10⁻³; χ is relaxed
 * by 0.5 between iterations against the oscillation of stiff, gradient-dependent transport).
 * Within an iteration the equations are solved in sequence: density, then heat (T_e and T_i
 * together, e–i exchange implicit), then current diffusion.
 *
 * Δt control: the target is a largest relative profile change of 8 %; a failed attempt (Picard
 * not converged, change above 35 %, non-finite state, or a numerical failure thrown by a module:
 * a singular linear system, a Grad–Shafranov failure; see failures.ts) is retried with Δt × 0.4.
 * After STEP_MAX_ATTEMPTS attempts, or once Δt would fall below STEP_DT_FLOOR, one forced attempt
 * at that last Δt is accepted even without Picard convergence, but only if its whole state is
 * finite; otherwise the shot ends with a StepFailure at the last accepted state. Time advances
 * only by the Δt of the attempt whose state is committed. Any other exception is a programming
 * error: it propagates, with the state restored. That holds for an exception inside an implicit
 * attempt and for one in the update after the accepted step (a plug-in's `accepted` hook, the
 * equilibrium update): y and the scalars of the shared context that a step changes (StepSnapshot)
 * are put back, so that a caller that catches the error and steps on continues exactly as if the
 * failed step had not been tried. What a plug-in keeps in its own fields is its own business (an
 * `accepted` hook that fails half-way must not leave itself half-updated).
 */
import { KEV, ProfileContext, StepConstants } from '../context';
import { composition } from '../composition';
import { updateBoundary } from '../boundary/sol';
import type { FuelingControl } from '../control/fueling';
import type { DisruptionEvents } from '../events/disruption';
import { solverErrorMessage } from '../eqguard';
import { StepFailure, isNumericalFailure } from '../failures';
import { Checkpointable, CheckpointRecord, recNum } from '../checkpoint';
import { HEAT_CONVECTION, HeatInputs } from '../fvsolver';
import { currentProfiles } from '../qprofile';
import { assembleHeatSources } from '../sources';
import type { PhysicsPipeline } from './pipeline';

// implicit step retry policy
export const STEP_SHRINK = 0.4;
export const STEP_MAX_ATTEMPTS = 12;
export const STEP_DT_FLOOR = 1e-7;

/** Result of one implicit attempt: accepted, largest relative change, what it threw */
export interface StepAttempt { ok: boolean; change: number; error?: unknown }

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

export class CoupledStepper implements Checkpointable {
  /** steps accepted by the forced last resort (Picard not converged at the smallest Δt) */
  forcedSteps = 0;
  /** set when the shot was ended by a numerical failure */
  stepFailure: StepFailure | null = null;

  constructor(
    private readonly ctx: ProfileContext,
    private readonly physics: PhysicsPipeline,
    private readonly fueling: FuelingControl,
    private readonly disruption: DisruptionEvents,
    /** update after an accepted step from t to t + dt (scalars, controllers, diagnostics, equilibrium) */
    private readonly accept: (t: number, dt: number, yOld: Float64Array, y: Float64Array) => void,
  ) {}

  /** SimModel.step: advances y in place from t towards tMax, returns the new time */
  step(t: number, y: Float64Array, tMax: number): number {
    const ctx = this.ctx;
    if (ctx.phase === 'ended') return tMax;
    if (ctx.phase !== 'normal') return this.disruption.quenchStep(ctx, t, y, tMax);
    const dtWant = ctx.dt;
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
    const truncated = dt < dtWant;
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
      this.fail(new StepFailure(t, dt, attempts, detail, { cause: r.error }));
      return t;
    }
    if (forced) {
      this.forcedSteps++;
      ctx.warnOnce('forced', t + dt, `Transport step at t = ${t.toFixed(4)} s did not converge in ${attempts - 1} attempts; forced at Δt = ${dt.toExponential(1)} s (Picard not converged) — accuracy is reduced here`);
    }
    this.accept(t, dt, yOld, y);
    // adaptive Δt: target largest relative change 8 %. A step truncated at an output time does not
    // shrink the proposal (else Δt would have to grow from scratch after every output frame).
    const change = r.change;
    const fac = change > 0 ? Math.min(1.5, Math.max(0.3, 0.08 / change)) : 1.5;
    const next = truncated && !retried ? Math.max(dtWant, dt * fac) : dt * fac;
    ctx.dt = Math.min(Math.max(next, 1e-6), 0.5);
    return t + dt;
  }

  save(rec: CheckpointRecord): void { rec.forcedSteps = this.forcedSteps; }
  restore(rec: Readonly<CheckpointRecord>): void {
    this.forcedSteps = recNum(rec, 'forcedSteps', this.forcedSteps);
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

  /** One implicit step of length dt from yOld into y (y holds yOld on entry); returns acceptance and the largest relative change */
  implicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): StepAttempt {
    const ctx = this.ctx, physics = this.physics;
    const N = ctx.N, w = ctx.w;
    const o = ctx.view(yOld);
    const v = ctx.view(y);
    const s = v.s;
    // old composition and current profiles
    composition(ctx, o.Te, o.ne, o.s);
    w.ni0.set(w.ni);
    currentProfiles(ctx, o.psi, o.s.Ip);
    // boundary values (lagged P_SOL)
    updateBoundary(ctx, t, o);
    const K: StepConstants = physics.stepConstants(t, o);
    // fueling feedback and particle source
    this.fueling.particleSource(ctx, t, dt, o, v, K);
    physics.particleSources(t, dt, o, K);
    // Picard
    const heatIn: HeatInputs = {
      dt, ne0: o.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: o.Te, Ti0: o.Ti, chiE: w.chiE, chiI: w.chiI,
      Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: w.TeIt, TiStar: w.TiIt, nuEq: w.nuEq, GammaF: ctx.dens.GammaF,
      convCoef: HEAT_CONVECTION, TeB: ctx.bc.Te, TiB: ctx.bc.Ti, nB: ctx.bc.n,
    };
    let conv = false;
    for (let it = 0; it < 8; it++) {
      w.TeIt.set(v.Te); w.TiIt.set(v.Ti); w.neIt.set(v.ne);
      physics.transportCoefficients(v);
      // χ relaxation against Picard oscillation with stiff (gradient-dependent) transport
      if (it > 0) for (let f = 0; f <= N; f++) { w.chiE[f] = 0.5 * (w.chiE[f] + w.chiEp[f]); w.chiI[f] = 0.5 * (w.chiI[f] + w.chiIp[f]); }
      w.chiEp.set(w.chiE); w.chiIp.set(w.chiI);
      // 1) density
      ctx.dens.solve({ dt, n0: o.ne, D: w.D, v: w.v, S: w.Sn, nB: ctx.bc.n }, v.ne);
      for (let i = 0; i < N; i++) if (!(v.ne[i] > 1e15)) v.ne[i] = 1e15;
      composition(ctx, v.Te, v.ne, s);
      // 2) sources
      physics.heatSources(v, K);
      currentProfiles(ctx, v.psi, s.Ip);
      physics.currentSources(v, K);
      assembleHeatSources(ctx);
      // 3) heat (T_e, T_i together)
      ctx.heat.solve(heatIn, v.Te, v.Ti);
      for (let i = 0; i < N; i++) { if (!(v.Te[i] > 0.005)) v.Te[i] = 0.005; if (!(v.Ti[i] > 0.005)) v.Ti[i] = 0.005; }
      // 4) current
      ctx.cur.solve({ dt, psi0: o.psi, sigma: w.sigma, jniB: w.jniB, Ip: s.Ip }, v.psi);
      // convergence
      let dmax = 0;
      for (let i = 0; i < N; i++) {
        dmax = Math.max(dmax, Math.abs(v.Te[i] - w.TeIt[i]) / Math.max(w.TeIt[i], 0.05),
          Math.abs(v.Ti[i] - w.TiIt[i]) / Math.max(w.TiIt[i], 0.05), Math.abs(v.ne[i] - w.neIt[i]) / Math.max(w.neIt[i], 1e17));
      }
      if (dmax < 2e-3 && it > 0) { conv = true; break; }
    }
    // power across the separatrix with the inputs of the last heat solve (before the final
    // composition replaces w.ni): closes the discrete energy balance of the step
    const lb = ctx.heat.boundaryLoss(heatIn, v.Te, v.Ti);
    ctx.Pbound = (lb.e + lb.i) * KEV;
    // final consistency
    composition(ctx, v.Te, v.ne, s);
    currentProfiles(ctx, v.psi, s.Ip);
    let change = 0, finite = true;
    for (let i = 0; i < N; i++) {
      if (!isFinite(v.Te[i]) || !isFinite(v.Ti[i]) || !isFinite(v.ne[i]) || !isFinite(v.psi[i])) finite = false;
      change = Math.max(change, Math.abs(v.Te[i] - o.Te[i]) / Math.max(o.Te[i], 0.1), Math.abs(v.Ti[i] - o.Ti[i]) / Math.max(o.Ti[i], 0.1),
        Math.abs(v.ne[i] - o.ne[i]) / Math.max(o.ne[i], 1e18));
    }
    ctx.lastK = K;
    return { ok: finite && (conv || dt < 1e-4) && change < 0.35, change };
  }
}

