/**
 * Coupling of the 1.5D transport to the fixed-boundary Grad–Shafranov equilibrium (quasi-static:
 * the equilibrium evolves slowly on the transport time scale).
 *
 *  - Initial equilibrium: shape profile j ∝ (1 − ψ_N²)^1.3 with β_p = 0.1 (cold start).
 *  - Updates: from the transport profiles (table mode: p and ⟨j_φ/R⟩ tabulated on the equilibrium's own flux
 *    surfaces) at least every eqUpdateInterval, earlier (but not before a quarter interval) when β_p or ℓ_i
 *    changed by 10 % / 5 %. An accepted update replaces the transport geometry; the work arrays
 *    are then re-evaluated on it before the MHD events read them.
 *  - The update is a self-consistent solve (outer.ts): the tables are remapped through the new equilibrium and
 *    re-solved, under-relaxed and with stagnation detection, until the equilibrium's ρ_tor(ψ_N) agrees with the
 *    map the tables were built with, instead of taking the solve of a table mapped through the previous
 *    equilibrium (stale) or leaving the update out. Nothing fails silently: a rejected update is counted, reported and
 *    retried with a back-off. An update whose current table had to be rescaled by more than CURRENT_SCALE_LIMIT
 *    to meet I_p is rejected as well.
 */
import { GSSolver, Equilibrium, EquilibriumOptions } from '../../equilibrium/gs';
import { SingularMatrixError } from '../../numerics/linalg';
import type { EqSnapshot } from '../../types';
import { KEV, ProfileContext } from '../context';
import type { Checkpointable, CheckpointRecord } from '../checkpoint';
import { recNum } from '../checkpoint';
import { GsAttempt, GsStage, isUsableEquilibrium, isUsableGeometry, solveGuarded, solverErrorMessage } from '../eqguard';
import { EquilibriumInitFailure } from '../failures';
import { geometryFromEquilibrium } from '../geometry1d';
import type { ProfileState } from '../state';
import { solveConsistent } from './outer';
import { coreFlat } from './tables';

/**
 * Largest |c − 1| of a table-mode solve that is accepted, c being the factor the Grad–Shafranov
 * solver applies to the ⟨j_φ/R⟩ table to meet I_p (Equilibrium.currentScale). A table that
 * integrates to I_p/c over the new flux surfaces was not built on that equilibrium (typically it
 * was mapped to ψ_N through a stale geometry, after held-back updates at a strongly changing β_p),
 * so the solve returns a correct equilibrium of a current profile the transport does not have.
 * Taking it swaps the geometry under the run in one step: MASTU15 with ws4's solver accepted c =
 * 2.07 and 1.95 and ended in a β-limit disruption at 1.06 s. The solver flags it
 * as 'table-current-rescaled' beyond `currentScaleWarn`, which is set to this limit.
 * The value is a measurement, not a derivation. Converged table solves of the golden 1.5D cases
 * have |c − 1| ≤ 0.08 (JET15), ≤ 0.05 (ITER15, DEMO15, DIIID15) and ≤ 0.02 (the SPARC15 cases); the
 * one JET15 solve accepted on the residual threshold alone has 0.20; MASTU15 goes to 0.7–1.07.
 * The solver's own default of 0.1 would hold back most JET15 updates (that 0.20 solve, then a stale
 * geometry that keeps c away from 1); limits of 0.3 and 0.5 give the same trajectories in all nine cases.
 */
export const CURRENT_SCALE_LIMIT = 0.5;

/**
 * The outer iteration of an update (outer.ts): the mapping mismatch (rms over the radius of ρ_tor of the equilibrium
 * minus the ρ the table node was made for) below which the tables are taken as consistent with the equilibrium, 10 % of a
 * transport cell of the default 50 (the normal updates of the golden 1.5D cases reach 1e−3 in two or three iterations;
 * the noise floor of the innermost nodes, where the GS grid cannot resolve the surfaces, is a few 1e−4); the outer
 * iterations at most; and the mismatch up to which an iteration that did not get below the tolerance is still accepted
 * (a quarter of a cell) because its current table is consistent to within CURRENT_SCALE_LIMIT.
 */
export const OUTER_TOL = 2e-3;
export const OUTER_MAX = 8;
export const OUTER_ACCEPT = 5e-3;

/** options of every table solve of an update: warm start, at most 60 Anderson iterations to 1e−5 (mixing 1, restart when the residual is 3 times the smallest so far) */
const UPDATE_SOLVE: Partial<EquilibriumOptions> = { tol: 1e-5, maxIter: 60, relax: 1, restartGrowth: 3 };

export class EquilibriumCoupling implements Checkpointable {
  readonly gsSolver: GSSolver;
  /** time of the last accepted equilibrium, and its β_p and ℓ_i (the update triggers) */
  eqTime = 0;
  eqBetaP = 0;
  eqLi = 0;
  /** accepted Grad–Shafranov updates after the initial solve */
  eqUpdates = 0;
  /** accepted updates in which a solve needed Newton–Krylov, a shorter continuation step or failed; updates that were rejected */
  eqRetried = 0;
  eqRejected = 0;
  /** no update attempt before this time (back-off after a rejected update); consecutive rejections */
  private eqRetryAt = 0;
  private eqFailStreak = 0;
  /** last GS solve statistics and the attempt log of the last update (diagnostics) */
  eqStats = { it: 0, res: 0 };
  eqAttempts: GsAttempt[] = [];
  /** residual of an initial equilibrium kept without convergence (null: it converged) */
  eqInitResidual: number | null = null;
  /** set when no initial equilibrium existed for the requested boundary (the shot ends at t = 0) */
  eqInitFailure: EquilibriumInitFailure | null = null;

  constructor(ctx: ProfileContext) {
    // an impossible boundary (e.g. a > R) is refused by the solver's grid: the same typed failure as an
    // initial solve that finds no equilibrium
    try {
      this.gsSolver = new GSSolver(ctx.geomB, { NR: ctx.ps.eqNR });
    } catch (e) {
      throw new EquilibriumInitFailure(solverErrorMessage(e), { cause: e });
    }
  }

  /**
   * Solves the initial equilibrium and adopts it with its transport geometry. Retry ladder: nominal
   * (relaxation 0.6, 200 iterations), then relaxation 0.3 with 600 iterations. A result that did
   * not converge but is usable is kept, reported in the shot report and raised as a warning event
   * at t = 0. If no attempt gives a usable equilibrium the shot cannot run: the model is built on a
   * stand-in equilibrium with a circular boundary of the same R and a (so that the diagnostics of
   * the aborted shot can be evaluated) and eqInitFailure is set (the shot ends at t = 0); if even
   * that fails, EquilibriumInitFailure is thrown.
   */
  initialize(ctx: ProfileContext): void {
    const eq0 = this.initialEquilibrium(ctx);
    ctx.adoptGeometry({ eq: eq0, tg: geometryFromEquilibrium(eq0, ctx.N, ctx.geomB) });
    this.eqBetaP = ctx.eq.betaP; this.eqLi = ctx.eq.li3;
  }

  private initialEquilibrium(ctx: ProfileContext): Equilibrium {
    const c = ctx.cfg;
    const base: EquilibriumOptions = { Ip: Math.max(c.Ip_MA, 0.05) * 1e6, B0: c.B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.1 }, tol: 1e-7 };
    const stages: GsStage[] = [{ label: 'nominal', opts: {} }, { label: 'relaxation 0.3', opts: { relax: 0.3, maxIter: 600 } }];
    const out = solveGuarded(this.gsSolver, base, stages);
    if (out.eq) return out.eq;
    if (out.best) {
      const best = out.best;
      this.eqInitResidual = best.residual;
      ctx.pending.push({ t: 0, kind: 'warning', msg: `Initial Grad–Shafranov equilibrium did not converge (residual ${best.residual.toExponential(1)} after ${best.iterations} iterations) — used until the first accepted update` });
      return best;
    }
    const detail = out.attempts.map((a) => `${a.stage}: ${a.error ?? `residual ${a.residual.toExponential(1)}`}`).join('; ');
    try {
      const b = ctx.geomB;
      const standIn = new GSSolver({ R: b.R, a: b.a, kappa: 1, delta: 0 }, { NR: ctx.ps.eqNR }).solve({ ...base, relax: 0.3, maxIter: 600 });
      if (!isUsableEquilibrium(standIn)) throw new Error(`stand-in equilibrium unusable (residual ${standIn.residual.toExponential(1)})`);
      this.eqInitFailure = new EquilibriumInitFailure(detail);
      return standIn;
    } catch (e) {
      throw new EquilibriumInitFailure(`${detail}; circular stand-in: ${solverErrorMessage(e)}`, { cause: e });
    }
  }

  /**
   * Update policy, after each accepted step (t: time of y): at the latest every eqUpdateInterval;
   * earlier if β_p or ℓ_i changed markedly (10 % / 5 %), but at least a quarter interval after the
   * last update. `update` performs the update (ProfileModel.updateEquilibrium) and returns whether
   * it was accepted.
   */
  check(ctx: ProfileContext, t: number, y: Float64Array, update: (t: number, y: Float64Array) => boolean): void {
    const d = ctx.lastDiag;
    const dBp = Math.abs((d.betaP ?? 0) - this.eqBetaP) / Math.max(this.eqBetaP, 0.05);
    const dLi = Math.abs((d.li ?? 0) - this.eqLi) / Math.max(this.eqLi, 0.1);
    const since = t - this.eqTime;
    const due = since >= ctx.ps.eqUpdateInterval || ((dBp > 0.1 || dLi > 0.05) && since > 0.25 * ctx.ps.eqUpdateInterval);
    if (!due || ctx.phase !== 'normal' || t < this.eqRetryAt) return;
    if (update(t, y)) {
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
    this.eqRetryAt = t + 0.25 * ctx.ps.eqUpdateInterval * Math.min(2 ** (this.eqFailStreak - 1), 4);
    if (!ctx.warned.has('gs')) {
      const last = this.eqAttempts[this.eqAttempts.length - 1];
      const why = last?.error ?? last?.rejected ?? `residual ${last ? last.residual.toExponential(1) : '?'} after ${last?.iterations ?? 0} iterations`;
      ctx.warnOnce('gs', t, `Grad–Shafranov update rejected (${why}; ${this.eqAttempts.length} attempts) — geometry held at the equilibrium of t = ${this.eqTime.toFixed(2)} s, retried from t = ${this.eqRetryAt.toFixed(2)} s`);
    }
  }

  /**
   * Grad–Shafranov update from the transport profiles p(ρ) and ⟨j_φ/R⟩(ρ) (table mode); on success the transport
   * geometry is replaced and `evaluate` re-evaluates the work arrays on it. t is the time of y. Returns whether the new
   * equilibrium was accepted.
   *
   * The equilibrium is the self-consistent one (solveConsistent): its tables sit on its own flux surfaces to within
   * OUTER_TOL. It is accepted if its current table needs no rescaling beyond CURRENT_SCALE_LIMIT to meet I_p (the
   * gate against a stale geometry, which the outer iteration normally removes), if the outer iteration converged
   * or stopped within OUTER_ACCEPT, and if the transport geometry built from it is usable (finite metrics, positive
   * cell volumes). The attempt log of the update is `eqAttempts`, one entry per solve.
   */
  update(ctx: ProfileContext, t: number, y: Float64Array, evaluate: (t: number, st: ProfileState) => void): boolean {
    const g = ctx.tg, w = ctx.w, N = ctx.N, v = ctx.view(y);
    const niB = ctx.bc.n * (w.ni[N - 1] / Math.max(v.ne[N - 1], 1));
    const pB = (ctx.bc.n * ctx.bc.Te + niB * ctx.bc.Ti) * KEV;
    const pAt = (r: number) => {
      if (r <= g.rhoC[0]) return w.p[0];
      if (r >= g.rhoC[N - 1]) { const t = (r - g.rhoC[N - 1]) / (1 - g.rhoC[N - 1]); return w.p[N - 1] + t * (pB - w.p[N - 1]); }
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return w.p[i] + t * (w.p[i + 1] - w.p[i]);
    };
    // flux-surface averaged ⟨j_φ/R⟩ = 2π dI/dV on the transport geometry, at the cell centres
    const jRc = new Float64Array(N);
    for (let i = 0; i < N; i++) jRc[i] = Math.max((2 * Math.PI * (w.IencF[i + 1] - w.IencF[i])) / g.dV[i], 0);
    const jRAt = (r: number) => {
      if (r <= g.rhoC[0]) return jRc[0];
      if (r >= g.rhoC[N - 1]) return jRc[N - 1];
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return jRc[i] + t * (jRc[i + 1] - jRc[i]);
    };
    const rho = Float64Array.from({ length: N + 1 }, (_, j) => j / N);
    // the grid resolves ρ_tor down to a couple of its spacings (in units of a) from the axis: the current table is flat inside
    const rhoCore = 2 * this.gsSolver.grid.dR / ctx.geomB.a;
    const pT = Float64Array.from(rho, pAt), jT = coreFlat(Float64Array.from(rho, jRAt), rho, rhoCore);
    const res = solveConsistent(this.gsSolver, ctx.eq, {
      Ip: v.s.Ip, B0: ctx.cfg.B0, rho, p: pT, jR: jT, rhoMin: rhoCore, currentScaleLimit: CURRENT_SCALE_LIMIT,
    }, { tol: OUTER_TOL, accept: OUTER_ACCEPT, maxOuter: OUTER_MAX, solve: UPDATE_SOLVE });
    this.eqAttempts = res.attempts;
    const last = res.attempts[res.attempts.length - 1];
    this.eqStats = { it: last.iterations, res: last.residual };
    const reject = (why: string): false => { last.rejected = why; return false; };
    if (!res.eq) return reject(last.rejected ?? res.reason ?? 'no equilibrium');
    if (!res.converged && (res.delta > OUTER_ACCEPT * (res.fraction < 1 ? 2 : 1))) return reject(res.reason ?? `the tables did not converge to the equilibrium's surfaces (rms Δρ_tor = ${res.delta.toExponential(1)})`);
    // only a singular system of the metric splines is a numerical failure of the geometry; anything else is a bug and propagates
    let tg;
    try { tg = geometryFromEquilibrium(res.eq, N, ctx.geomB); } catch (e) { if (e instanceof SingularMatrixError) return reject(solverErrorMessage(e)); throw e; }
    if (!isUsableGeometry(tg)) return reject('the transport geometry of the equilibrium has non-finite metrics or a non-positive cell volume');
    if (res.hard) this.eqRetried++;
    if (res.fraction < 1) {
      ctx.warnOnce('gs-limited', t, `Grad–Shafranov update followed only ${(100 * res.fraction).toFixed(0)} % of the change of the transport profiles: the equilibrium of the whole change did not converge (pressure and current tables at the limit of what the boundary can hold); the geometry lags the profiles by the rest — reported once, at t = ${t.toFixed(2)} s`);
    }
    ctx.adoptGeometry({ eq: res.eq, tg });
    // postStep (ELM, sawtooth) runs next and reads n_i, q, p: evaluate them on the new geometry
    evaluate(t, v);
    return true;
  }

  /** Flux surfaces for the cross-section plot (ρ_tor = 0.1 … 1.0) */
  snapshot(ctx: ProfileContext, nSurf = 10, nPts = 72): EqSnapshot {
    const eq = ctx.eq, tr = eq.surfaces, P = eq.prof;
    const R: number[][] = [], Z: number[][] = [], rho: number[] = [];
    const nS = tr.R.length;
    for (let s = 1; s <= nSurf; s++) {
      const target = s / nSurf;
      // nearest ρ_tor surface (P index k + 1 ↔ surface k)
      let best = 0, bd = Infinity;
      for (let k = 0; k < nS; k++) { const d = Math.abs(P.rhoTor[k + 1] - target); if (d < bd) { bd = d; best = k; } }
      const rr: number[] = [], zz: number[] = [];
      const n = tr.R[best].length, stride = Math.max(1, Math.floor(n / nPts));
      for (let j = 0; j < n; j += stride) { rr.push(tr.R[best][j]); zz.push(tr.Z[best][j]); }
      R.push(rr); Z.push(zz); rho.push(P.rhoTor[best + 1]);
    }
    return { R, Z, rho, Raxis: eq.Raxis, Zaxis: eq.Zaxis, q95: eq.q95, li: eq.li3, betaP: eq.betaP };
  }

  save(rec: CheckpointRecord): void {
    Object.assign(rec, {
      eqTime: this.eqTime, eqBetaP: this.eqBetaP, eqLi: this.eqLi, eqRetryAt: this.eqRetryAt, eqFailStreak: this.eqFailStreak,
      eqUpdates: this.eqUpdates, eqRetried: this.eqRetried, eqRejected: this.eqRejected,
    });
  }
  restore(rec: Readonly<CheckpointRecord>): void {
    const num = (k: string, dflt: number) => recNum(rec, k, dflt);
    this.eqTime = num('eqTime', 0);
    this.eqBetaP = num('eqBetaP', this.eqBetaP); this.eqLi = num('eqLi', this.eqLi);
    this.eqRetryAt = num('eqRetryAt', 0); this.eqFailStreak = num('eqFailStreak', 0);
    this.eqUpdates = num('eqUpdates', this.eqUpdates); this.eqRetried = num('eqRetried', this.eqRetried);
    this.eqRejected = num('eqRejected', this.eqRejected);
  }
}
