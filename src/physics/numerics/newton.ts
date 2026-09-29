/**
 * Damped Newton–Raphson iteration for a nonlinear system F(z) = 0 whose Jacobian is block-tridiagonal (blockTridiagN.ts): the
 * unknowns of n cells with m fields each, the residual of a cell depending on the cell and its two neighbours.
 *
 *   J(z_k) Δ_k = −F(z_k),   z_{k+1} = z_k + λ_k Δ_k,   λ_k by backtracking on the merit function ½‖F‖²
 *
 * The Jacobian is built by coloured finite differences (coloredJacobian: 3 m evaluations of F). It may be renewed at every iteration
 * (the Newton method proper, quadratic convergence up to the accuracy of the differences) or kept while it works (the chord
 * method: linear convergence with the contraction that the Jacobian of an earlier point allows), and a Jacobian that was
 * passed in (built at an earlier point, e.g. by the first stage of a Runge–Kutta step) is used for the first iteration and
 * renewed as soon as the residual does not contract by at least `slow`.
 *
 * Backtracking: the step is shortened (λ = 1, ½, ¼ …) until ½‖F(z + λΔ)‖² ≤ (1 − 2 c λ) ½‖F(z)‖² with c = 10⁻⁴ (the Armijo
 * condition for the exact Newton direction, whose slope of the merit function is −‖F‖²; Dennis and Schnabel, "Numerical Methods for
 * Unconstrained Optimization and Nonlinear Equations", SIAM 1996, section 6.3.1; Kelley, "Iterative Methods for Linear and Nonlinear
 * Equations", SIAM 1995, section 8.1). The step is also cut so that no unknown changes by more than `maxRelStep` of its value, and
 * the iterate is projected onto the lower bounds. A line search that fails with a reused Jacobian renews the Jacobian and tries
 * again; with a fresh one the iteration has failed.
 *
 * The caller owns the meaning of the numbers: F and z should be scaled to order one (the merit function adds the squares of all
 * rows), and `residual` may have side effects (the physics evaluates its work arrays in it): the last call of `residual` is
 * always at the returned z when the iteration converged, so that state that F leaves behind belongs to the solution.
 */
import { BlockTridiag, BlockTridiagLU, blockTridiag, coloredJacobian } from './blockTridiagN';
import { SingularMatrixError } from './linalg';

export interface NewtonProblem {
  /** number of cells and fields per cell */
  n: number; m: number;
  /** F(z) → out; must not change z */
  residual(z: Float64Array, out: Float64Array): void;
}

export interface NewtonOptions {
  /** converged when the largest |Δz_j| / max(|z_j|, floor_j) of the applied step is below tol */
  tol: number;
  /** floor of the relative measure: one number, or one per unknown (default 1e-3) */
  floor?: number | ArrayLike<number>;
  maxIter: number;
  /** lower bounds of the unknowns (default: none) */
  lower?: ArrayLike<number>;
  /** largest change of an unknown in one step relative to max(|z_j|, floor_j) (default 0.5) */
  maxRelStep?: number;
  /** 'always': a new Jacobian at every iteration; 'adaptive': keep it while the residual contracts by at least `slow` per iteration */
  jacobian: 'always' | 'adaptive';
  /** contraction ‖F_{k+1}‖/‖F_k‖ above which a kept Jacobian is renewed (default 0.5) */
  slow?: number;
  /** perturbation of the finite differences (default 1e-7 max(|z|, 1)) */
  delta?: (i: number, k: number, zik: number) => number;
  /** smallest fraction of the Newton step tried by the line search (default 2⁻⁶) */
  minLambda?: number;
  /** stop as converged when ‖F‖₂ falls below this (default 0: only the step test) */
  residualTol?: number;
}

/** A Jacobian that a caller keeps between solves: `valid` says that J holds the Jacobian of some earlier point */
export interface JacobianStore { J: BlockTridiag; valid: boolean }
export const jacobianStore = (n: number, m: number): JacobianStore => ({ J: blockTridiag(n, m), valid: false });

export interface NewtonResult {
  converged: boolean;
  /** why it stopped */
  reason: 'converged' | 'residual' | 'maxIter' | 'lineSearch' | 'singular' | 'nonFinite';
  iterations: number;
  /** evaluations of F, in the line searches and in the Jacobians */
  evaluations: number;
  /** Jacobians built */
  jacobians: number;
  /** ‖F‖₂ at the start and at the end */
  norm0: number; norm: number;
  /** relative size of the applied step of each iteration (the measure of the convergence test) */
  steps: number[];
}

const ARMIJO = 1e-4;

export function newtonSolve(p: NewtonProblem, z: Float64Array, o: NewtonOptions, store: JacobianStore = jacobianStore(p.n, p.m)): NewtonResult {
  const { n, m } = p, nm = n * m;
  const floor = (j: number): number => (typeof o.floor === 'number' ? o.floor : o.floor ? o.floor[j] : 1e-3);
  const maxRel = o.maxRelStep ?? 0.5, slow = o.slow ?? 0.5, minLam = o.minLambda ?? 1 / 64;
  const f0 = new Float64Array(nm), ft = new Float64Array(nm), dz = new Float64Array(nm), zt = new Float64Array(nm), rhs = new Float64Array(nm);
  const lu = new BlockTridiagLU(n, m);
  const res: NewtonResult = { converged: false, reason: 'maxIter', iterations: 0, evaluations: 0, jacobians: 0, norm0: 0, norm: 0, steps: [] };
  const sumSq = (a: Float64Array) => { let s = 0; for (let j = 0; j < nm; j++) s += a[j] * a[j]; return s; };
  const evalF = (x: Float64Array, out: Float64Array): number => { p.residual(x, out); res.evaluations++; return sumSq(out); };

  let s0 = evalF(z, f0);
  res.norm0 = res.norm = Math.sqrt(s0);
  if (!Number.isFinite(s0)) { res.reason = 'nonFinite'; return res; }
  if (Math.sqrt(s0) <= (o.residualTol ?? 0)) { res.converged = true; res.reason = 'residual'; return res; }

  let fresh = false;
  let needJ = !store.valid;
  for (let it = 0; it < o.maxIter; it++) {
    let accepted = false;
    for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
      if (needJ) {
        res.evaluations += coloredJacobian(p.residual, z, f0, n, p.m, store.J, o.delta);
        res.jacobians++; store.valid = true; fresh = true; needJ = false;
      }
      try { lu.factor(store.J.A, store.J.B, store.J.C); } catch (e) {
        if (!(e instanceof SingularMatrixError)) throw e;
        if (fresh) { res.reason = 'singular'; return res; }
        needJ = true; continue;
      }
      for (let j = 0; j < nm; j++) rhs[j] = -f0[j];
      lu.solve(rhs, dz);
      let relFull = 0;
      for (let j = 0; j < nm; j++) relFull = Math.max(relFull, Math.abs(dz[j]) / Math.max(Math.abs(z[j]), floor(j)));
      if (!Number.isFinite(relFull)) { if (fresh) { res.reason = 'nonFinite'; return res; } needJ = true; continue; }
      let lam = relFull > maxRel ? maxRel / relFull : 1;
      // a step already below the tolerance is taken whole: at the noise floor of F the merit function cannot decrease
      const tiny = relFull < o.tol;
      let ok = false, st = 0;
      for (;;) {
        for (let j = 0; j < nm; j++) {
          const v = z[j] + lam * dz[j];
          zt[j] = o.lower && v < o.lower[j] ? o.lower[j] : v;
        }
        st = evalF(zt, ft);
        if (Number.isFinite(st) && (tiny || st <= (1 - 2 * ARMIJO * lam) * s0)) { ok = true; break; }
        lam *= 0.5;
        if (lam < minLam) break;
      }
      if (!ok) {
        if (fresh) { res.reason = 'lineSearch'; return res; }
        needJ = true; // the Jacobian of an earlier point did not give a descent direction: renew it and try again
        continue;
      }
      // the step that was applied
      let rel = 0;
      for (let j = 0; j < nm; j++) rel = Math.max(rel, Math.abs(zt[j] - z[j]) / Math.max(Math.abs(zt[j]), floor(j)));
      res.steps.push(rel);
      z.set(zt); f0.set(ft);
      const ratio = Math.sqrt(st / Math.max(s0, 1e-300));
      s0 = st;
      res.iterations++;
      res.norm = Math.sqrt(st);
      accepted = true;
      if (rel < o.tol) { res.converged = true; res.reason = 'converged'; return res; }
      if (Math.sqrt(st) <= (o.residualTol ?? 0)) { res.converged = true; res.reason = 'residual'; return res; }
      needJ = o.jacobian === 'always' || ratio > slow;
      fresh = false;
    }
    if (!accepted) { res.reason = 'lineSearch'; return res; }
  }
  return res;
}
