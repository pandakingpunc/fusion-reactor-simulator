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
 * not converged, change above 35 %, non-finite state, or an exception such as a zero pivot in the
 * linear algebra) is retried with Δt × 0.4. After STEP_MAX_ATTEMPTS attempts, or once Δt would fall
 * below STEP_DT_FLOOR, one forced attempt at that last Δt is accepted even without Picard
 * convergence, but only if its whole state is finite; otherwise the shot ends with a StepFailure
 * at the last accepted state. Time advances only by the Δt of the attempt whose state is
 * committed.
 */
import { KEV, ProfileContext, StepConstants } from '../context';
import { composition } from '../composition';
import { updateBoundary } from '../boundary/sol';
import type { FuelingControl } from '../control/fueling';
import type { DisruptionEvents } from '../events/disruption';
import { solverErrorMessage } from '../eqguard';
import { StepFailure } from '../failures';
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

  /** implicitStep with anything it throws (linear algebra, non-finite coefficients) turned into a failed attempt */
  private tryImplicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): StepAttempt {
    try {
      return this.implicitStep(t, dt, yOld, y);
    } catch (e) {
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

