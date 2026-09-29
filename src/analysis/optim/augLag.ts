/**
 * Augmented Lagrangian method for nonlinear programs with inequality and equality constraints and box bounds, with
 * Nelder-Mead (neldermead.ts) as the inner minimiser, so the objective and the constraints need no derivatives.
 *
 *   minimise f(x)   subject to   g_i(x) <= 0,   h_j(x) = 0,   lower <= x <= upper
 *
 * The method is the multiplier method of M. R. Hestenes (J. Optim. Theory Appl. 4 (1969) 303) and M. J. D. Powell (in R.
 * Fletcher, ed., Optimization, Academic Press 1969, 283-298), with the treatment of inequalities of R. T. Rockafellar (SIAM J.
 * Control 12 (1974) 268), as in J. Nocedal & S. J. Wright, Numerical Optimization, 2nd ed., Springer 2006, section 17.4 (algorithm
 * 17.4, eq. (17.65)). With penalty parameter mu and multiplier estimates lambda_i >= 0 (inequalities), nu_j (equalities) the
 * inner problem, over the box, is
 *   L(x) = f + sum_j [nu_j h_j + (mu/2) h_j^2] + (1/(2 mu)) sum_i [max(0, lambda_i + mu g_i)^2 - lambda_i^2]
 * and after each inner solve  lambda_i <- max(0, lambda_i + mu g_i),  nu_j <- nu_j + mu h_j;  mu is multiplied by `muGrowth`
 * when the constraint violation did not fall to a quarter of its previous value. The iteration ends when the violation is
 * below `feasTol` and the point moved by less than `xTol` (relative) over an outer iteration.
 *
 * Constraints should be scaled to be of order one (the design problem of design.ts normalises them). Because the inner
 * solver is a direct search the method is meant for small problems (tens of variables at most).
 * Pure TypeScript, no DOM or Node API.
 */
import { NelderMeadOptions, OptimResult, nelderMead } from './neldermead';

export interface ConstrainedProblem {
  n: number;
  f: (x: number[]) => number;
  /** inequality constraints, g_i(x) <= 0 */
  ineq?: (x: number[]) => number[];
  /** equality constraints, h_j(x) = 0 */
  eq?: (x: number[]) => number[];
  lower?: readonly number[];
  upper?: readonly number[];
}

export interface AugLagOptions {
  /** outer iterations (default 40) */
  maxOuter?: number;
  /** total budget of objective evaluations (default 200000) */
  maxEvals?: number;
  /** tolerance on the largest constraint violation (default 1e-6) */
  feasTol?: number;
  /** relative movement of the point over an outer iteration below which the iteration has converged (default 1e-7) */
  xTol?: number;
  /** initial penalty parameter (default 10) */
  mu0?: number;
  muGrowth?: number;
  muMax?: number;
  /** options of the inner Nelder-Mead solves (bounds are set from the problem) */
  inner?: Omit<NelderMeadOptions, 'lower' | 'upper'>;
  /**
   * Replaces Nelder-Mead as the inner minimiser (e.g. CMA-ES for a rugged problem): given the augmented function, the start point, the
   * bounds, the evaluation budget of this solve and the outer iteration (1, 2, ...), returns the minimiser found.
   */
  minimizer?: (f: (x: number[]) => number, x0: number[], lower: readonly number[] | undefined, upper: readonly number[] | undefined, maxEvals: number, outer: number) => OptimResult;
}

export interface OuterRecord {
  outer: number;
  f: number;
  violation: number;
  mu: number;
  evals: number;
}

export interface AugLagResult {
  x: number[];
  /** the objective at x */
  f: number;
  /** largest constraint violation at x: max(0, g_i, |h_j|) */
  violation: number;
  feasible: boolean;
  converged: boolean;
  /** multiplier estimates of the inequality and equality constraints */
  lambda: number[];
  nu: number[];
  outer: number;
  /** objective/constraint evaluations (one per inner objective call) */
  evals: number;
  reason: string;
  history: OuterRecord[];
}

const safe = (v: number): number => (Number.isFinite(v) ? v : 1e30);

/** Solves the constrained problem starting from x0. */
export function augmentedLagrangian(p: ConstrainedProblem, x0: readonly number[], opts: AugLagOptions = {}): AugLagResult {
  const n = p.n;
  if (x0.length !== n) throw new RangeError(`augmentedLagrangian: x0 has ${x0.length} entries, the problem has ${n} variables`);
  const maxOuter = opts.maxOuter ?? 40, maxEvals = opts.maxEvals ?? 200000;
  const feasTol = opts.feasTol ?? 1e-6, xTol = opts.xTol ?? 1e-7;
  const growth = opts.muGrowth ?? 10, muMax = opts.muMax ?? 1e10;
  let mu = opts.mu0 ?? 10;
  const lo = p.lower, hi = p.upper;
  const clip = (x: readonly number[]) => x.map((v, i) => Math.min(Math.max(v, lo?.[i] ?? -Infinity), hi?.[i] ?? Infinity));
  let x = clip(x0);
  const g0 = p.ineq ? p.ineq(x) : [], h0 = p.eq ? p.eq(x) : [];
  let lambda = new Array<number>(g0.length).fill(0), nu = new Array<number>(h0.length).fill(0);
  const history: OuterRecord[] = [];
  let evals = 0;
  const violationAt = (xx: number[]): number => {
    let v = 0;
    if (p.ineq) for (const g of p.ineq(xx)) v = Math.max(v, g);
    if (p.eq) for (const h of p.eq(xx)) v = Math.max(v, Math.abs(h));
    return Number.isFinite(v) ? v : Infinity;
  };
  let prevViolation = violationAt(x);
  let reason = 'maxOuter';
  let converged = false;
  let outer = 0;
  for (outer = 1; outer <= maxOuter; outer++) {
    const L = (y: number[]): number => {
      evals++;
      let v = safe(p.f(y));
      if (p.eq) { const h = p.eq(y); for (let j = 0; j < h.length; j++) v += nu[j] * h[j] + 0.5 * mu * h[j] * h[j]; }
      if (p.ineq) {
        const g = p.ineq(y);
        for (let i = 0; i < g.length; i++) { const t = Math.max(0, lambda[i] + mu * g[i]); v += (t * t - lambda[i] * lambda[i]) / (2 * mu); }
      }
      return safe(v);
    };
    const budget = Math.min(opts.inner?.maxEvals ?? 20000 * Math.max(1, n / 2), Math.max(maxEvals - evals, 10));
    const inner = opts.minimizer ? opts.minimizer(L, x, lo, hi, budget, outer) : nelderMead(L, x, { ...opts.inner, lower: lo, upper: hi, maxEvals: budget });
    const xNew = inner.x;
    // multiplier updates
    if (p.ineq) { const g = p.ineq(xNew); lambda = lambda.map((l, i) => Math.max(0, l + mu * g[i])); }
    if (p.eq) { const h = p.eq(xNew); nu = nu.map((v, j) => v + mu * h[j]); }
    const viol = violationAt(xNew);
    let move = 0;
    for (let i = 0; i < n; i++) move = Math.max(move, Math.abs(xNew[i] - x[i]) / (1 + Math.abs(x[i])));
    x = xNew;
    history.push({ outer, f: p.f(x), violation: viol, mu, evals });
    if (viol <= feasTol && move <= xTol && outer > 1) { converged = true; reason = 'converged'; break; }
    if (evals >= maxEvals) { reason = 'maxEvals'; break; }
    if (viol > 0.25 * prevViolation && viol > feasTol) mu = Math.min(mu * growth, muMax);
    prevViolation = viol;
  }
  const violation = violationAt(x);
  return {
    x, f: p.f(x), violation, feasible: violation <= Math.max(feasTol, 1e-6) * 10, converged, lambda, nu,
    outer: Math.min(outer, maxOuter), evals, reason, history,
  };
}
