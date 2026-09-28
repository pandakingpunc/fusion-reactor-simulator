/**
 * Coupling of the 1.5D transport to the fixed-boundary Grad–Shafranov equilibrium (quasi-static:
 * the equilibrium evolves slowly on the transport time scale).
 *
 *  - Initial equilibrium: shape profile j ∝ (1 − ψ_N²)^1.3 with β_p = 0.1 (cold start).
 *  - Updates: from the transport profiles (table mode: p and ⟨j_φ/R⟩ on the current ψ_N nodes)
 *    at least every eqUpdateInterval, earlier (but not before a quarter interval) when β_p or ℓ_i
 *    changed by 10 % / 5 %. An accepted update replaces the transport geometry; the work arrays
 *    are then re-evaluated on it before the MHD events read them.
 *  - Guarding (eqguard.ts): every solve runs through a retry ladder, a rejected update is counted,
 *    reported and retried with a back-off; nothing fails silently.
 */
import { GSSolver, Equilibrium, EquilibriumOptions } from '../../equilibrium/gs';
import type { EqSnapshot } from '../../types';
import { KEV, ProfileContext } from '../context';
import type { Checkpointable, CheckpointRecord } from '../checkpoint';
import { recNum } from '../checkpoint';
import { GsAttempt, GsStage, acceptableEquilibrium, binomialSmooth, gridScalePasses, isUsableEquilibrium, isUsableGeometry, solveGuarded, solverErrorMessage } from '../eqguard';
import { EquilibriumInitFailure } from '../failures';
import { TransportGeometry, geometryFromEquilibrium } from '../geometry1d';
import type { ProfileState } from '../state';

export class EquilibriumCoupling implements Checkpointable {
  readonly gsSolver: GSSolver;
  /** time of the last accepted equilibrium, and its β_p and ℓ_i (the update triggers) */
  eqTime = 0;
  eqBetaP = 0;
  eqLi = 0;
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
  /** residual of an initial equilibrium kept without convergence (null: it converged) */
  eqInitResidual: number | null = null;
  /** set when no initial equilibrium existed for the requested boundary (the shot ends at t = 0) */
  eqInitFailure: EquilibriumInitFailure | null = null;

  constructor(ctx: ProfileContext) {
    this.gsSolver = new GSSolver(ctx.geomB, { NR: ctx.ps.eqNR });
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
      const why = last?.error ?? `residual ${last ? last.residual.toExponential(1) : '?'} after ${last?.iterations ?? 0} iterations`;
      ctx.warnOnce('gs', t, `Grad–Shafranov update rejected (${why}; ${this.eqAttempts.length} attempts) — geometry held at the equilibrium of t = ${this.eqTime.toFixed(2)} s, retried from t = ${this.eqRetryAt.toFixed(2)} s`);
    }
  }

  /**
   * Grad–Shafranov update from the transport profiles (table mode: p, ⟨j_φ/R⟩ on the current ψ_N
   * nodes); on success the transport geometry is replaced and `evaluate` re-evaluates the work
   * arrays on it. t is the time of y. Returns whether the new equilibrium was accepted.
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
  update(ctx: ProfileContext, t: number, y: Float64Array, evaluate: (t: number, st: ProfileState) => void): boolean {
    const g = ctx.tg, w = ctx.w, N = ctx.N, v = ctx.view(y);
    const P = ctx.eq.prof;
    const niB = ctx.bc.n * (w.ni[N - 1] / Math.max(v.ne[N - 1], 1));
    const pB = (ctx.bc.n * ctx.bc.Te + niB * ctx.bc.Ti) * KEV;
    const pAt = (r: number) => {
      if (r <= g.rhoC[0]) return w.p[0];
      if (r >= g.rhoC[N - 1]) { const t = (r - g.rhoC[N - 1]) / (1 - g.rhoC[N - 1]); return w.p[N - 1] + t * (pB - w.p[N - 1]); }
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return w.p[i] + t * (w.p[i + 1] - w.p[i]);
    };
    // flux-surface averaged ⟨j_φ/R⟩ = 2π dI/dV (on the transport geometry, at the cell centres)
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
    const Ip = v.s.Ip;
    const base: EquilibriumOptions = { Ip, B0: ctx.cfg.B0, profile: { kind: 'table', psiN: P.psiN, p: pT, jR: jT }, psiInit: ctx.eq.psi, tol: 1e-5, maxIter: 40, relax: 0.9 };
    const passes = gridScalePasses(this.gsSolver.grid.dR / ctx.geomB.a, 1 / (P.psiN.length - 1));
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
      try { built.tg = geometryFromEquilibrium(eq, N, ctx.geomB); } catch { return false; }
      return isUsableGeometry(built.tg);
    };
    const out = solveGuarded(this.gsSolver, base, stages, accept);
    this.eqAttempts = out.attempts;
    const last = out.attempts[out.attempts.length - 1];
    this.eqStats = { it: last.iterations, res: last.residual };
    if (!out.eq || !built.tg) return false;
    if (out.stage > 0) this.eqRetried++;
    ctx.adoptGeometry({ eq: out.eq, tg: built.tg });
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
