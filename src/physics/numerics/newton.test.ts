/**
 * The damped Newton iteration on block-tridiagonal systems (newton.ts): quadratic convergence on a smooth coupled problem,
 * the chord variant, the line search, the bounds, a Jacobian passed in, and the failure reasons.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../rng';
import { blockTridiag } from './blockTridiagN';
import { jacobianStore, newtonSolve, NewtonProblem } from './newton';

/**
 * Two coupled fields on n cells: a nonlinear diffusion with a solution-dependent coefficient and a cubic reaction (u), and a
 * linear diffusion with a bilinear coupling (v), Dirichlet zero at both ends. The sources are set so that z* is the root.
 */
function coupledProblem(n: number) {
  const m = 2;
  const src = new Float64Array(n * m);
  const raw = (z: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const u = z[2 * i], v = z[2 * i + 1];
      const ul = i > 0 ? z[2 * i - 2] : 0, ur = i < n - 1 ? z[2 * i + 2] : 0, vl = i > 0 ? z[2 * i - 1] : 0, vr = i < n - 1 ? z[2 * i + 3] : 0;
      out[2 * i] = -(1 + 0.3 * u * u) * (ur - 2 * u + ul) * 40 + u * u * u + v;
      out[2 * i + 1] = -0.5 * (vr - 2 * v + vl) * 40 + v + u * v;
    }
  };
  const zStar = Float64Array.from({ length: n * m }, (_, k) => {
    const i = Math.floor(k / m), x = (i + 1) / (n + 1);
    return k % 2 === 0 ? Math.sin(Math.PI * x) : 0.5 * Math.sin(2 * Math.PI * x) + 0.3;
  });
  raw(zStar, src);
  const problem: NewtonProblem = { n, m, residual: (z, out) => { raw(z, out); for (let k = 0; k < n * m; k++) out[k] -= src[k]; } };
  return { problem, zStar, m };
}

const maxErr = (a: Float64Array, b: Float64Array) => a.reduce((s, x, k) => Math.max(s, Math.abs(x - b[k])), 0);

describe('newtonSolve', () => {
  it('quadratic convergence on a smooth coupled problem: the step of each iteration is proportional to the square of the previous one', () => {
    const n = 30;
    const { problem, zStar } = coupledProblem(n);
    const rng = new RNG(4);
    const z = Float64Array.from(zStar, (x) => x + 0.9 * (rng.next() - 0.5));
    const r = newtonSolve(problem, z, { tol: 1e-12, maxIter: 12, jacobian: 'always', maxRelStep: 5 });
    expect(r.converged).toBe(true);
    expect(r.jacobians).toBe(r.iterations);
    expect(r.iterations).toBeLessThanOrEqual(12);
    expect(maxErr(z, zStar)).toBeLessThan(1e-10);
    // e_{k+1} ≤ C e_k² once the iteration is inside the basin (the line search and the step limit govern the first iterations)
    const s = r.steps;
    let checked = 0;
    for (let k = 0; k + 1 < s.length; k++) {
      if (s[k] > 1e-6 && s[k] < 0.5) { expect(s[k + 1]).toBeLessThan(10 * s[k] * s[k]); checked++; }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
    // the last steps are below the tolerance, the residual is at round-off
    expect(r.norm).toBeLessThan(1e-9);
  });

  it('the chord variant reaches the same solution with fewer Jacobians', () => {
    const n = 30;
    const { problem, zStar } = coupledProblem(n);
    const rng = new RNG(4);
    const z0 = Float64Array.from(zStar, (x) => x + 0.05 * (rng.next() - 0.5));
    const zA = Float64Array.from(z0), zB = Float64Array.from(z0);
    const a = newtonSolve(problem, zA, { tol: 1e-10, maxIter: 30, jacobian: 'always' });
    const b = newtonSolve(problem, zB, { tol: 1e-10, maxIter: 30, jacobian: 'adaptive', slow: 0.7 });
    expect(a.converged && b.converged).toBe(true);
    expect(b.jacobians).toBeLessThan(a.jacobians + 1);
    expect(b.jacobians).toBeLessThan(b.iterations);
    expect(maxErr(zA, zStar)).toBeLessThan(1e-8);
    expect(maxErr(zB, zStar)).toBeLessThan(1e-8);
  });

  it('the line search rescues a start from which the full Newton step diverges (F = atan z), and every applied step decreases ‖F‖', () => {
    const n = 12;
    const norms: number[] = [];
    const problem: NewtonProblem = {
      n, m: 1,
      residual: (z, out) => {
        let s = 0;
        for (let i = 0; i < n; i++) { out[i] = Math.atan(z[i]) + 0.1 * (2 * z[i] - (i > 0 ? z[i - 1] : 0) - (i < n - 1 ? z[i + 1] : 0)); s += out[i] * out[i]; }
        norms.push(Math.sqrt(s));
      },
    };
    const z = new Float64Array(n).fill(4);
    const r = newtonSolve(problem, z, { tol: 1e-12, maxIter: 40, jacobian: 'always', maxRelStep: 10 });
    expect(r.converged).toBe(true);
    for (const v of z) expect(Math.abs(v)).toBeLessThan(1e-9);
    // without the line search (an unlimited undamped step) the same start diverges: Newton on atan from 4 goes to −29
    let x = 4;
    for (let k = 0; k < 4; k++) x -= Math.atan(x) * (1 + x * x);
    expect(Math.abs(x)).toBeGreaterThan(100);
  });

  it('the lower bound projects the iterate: F is never evaluated below it (F = √z − 1.5 is not defined for z < 0)', () => {
    let lowest = Infinity;
    const problem: NewtonProblem = {
      n: 3, m: 1,
      residual: (z, out) => { for (let i = 0; i < 3; i++) { lowest = Math.min(lowest, z[i]); out[i] = Math.sqrt(z[i]) - 1.5; } },
    };
    const z = Float64Array.from([9, 0.04, 4]);
    // the finite-difference step is far below the bound at 0.04, so the perturbation stays positive; the Newton step of the first cell would reach 0
    const r = newtonSolve(problem, z, { tol: 1e-10, maxIter: 30, jacobian: 'always', lower: [1e-9, 1e-9, 1e-9], maxRelStep: 100 });
    expect(r.converged).toBe(true);
    expect(lowest).toBeGreaterThanOrEqual(0);
    for (const v of z) expect(v).toBeCloseTo(2.25, 8);
  });

  it('a Jacobian passed in is used for the first iteration and kept while it contracts; a wrong one is renewed', () => {
    const n = 30;
    const { problem, zStar } = coupledProblem(n);
    const rng = new RNG(8);
    const zNear = Float64Array.from(zStar, (x) => x + 0.05 * (rng.next() - 0.5));
    // a Jacobian built at a nearby point
    const store = jacobianStore(n, 2);
    const zTmp = Float64Array.from(zNear);
    const first = newtonSolve(problem, zTmp, { tol: 1e-12, maxIter: 20, jacobian: 'adaptive' }, store);
    expect(first.converged).toBe(true);
    expect(store.valid).toBe(true);
    // a second solve from another start uses it: no Jacobian at all when it contracts well enough
    const z2 = Float64Array.from(zStar, (x) => x + 0.02 * (rng.next() - 0.5));
    const second = newtonSolve(problem, z2, { tol: 1e-10, maxIter: 30, jacobian: 'adaptive', slow: 0.9 }, store);
    expect(second.converged).toBe(true);
    expect(second.jacobians).toBeLessThanOrEqual(1);
    expect(maxErr(z2, zStar)).toBeLessThan(1e-8);
    // a Jacobian of nonsense is renewed
    const bad = jacobianStore(n, 2);
    for (let k = 0; k < bad.J.B.length; k++) bad.J.B[k] = (k % 4 === 0 || k % 4 === 3) ? -1 : 0.5;
    bad.valid = true;
    const z3 = Float64Array.from(zStar, (x) => x + 0.05 * (rng.next() - 0.5));
    const third = newtonSolve(problem, z3, { tol: 1e-10, maxIter: 30, jacobian: 'adaptive' }, bad);
    expect(third.converged).toBe(true);
    expect(third.jacobians).toBeGreaterThanOrEqual(1);
    expect(maxErr(z3, zStar)).toBeLessThan(1e-8);
  });

  it('failure reasons: a singular Jacobian, a non-finite residual, and running out of iterations', () => {
    const flat: NewtonProblem = { n: 4, m: 2, residual: (_z, out) => out.fill(1) };
    const r1 = newtonSolve(flat, new Float64Array(8).fill(1), { tol: 1e-10, maxIter: 5, jacobian: 'always' });
    expect(r1.converged).toBe(false);
    expect(r1.reason).toBe('singular');
    const nan: NewtonProblem = { n: 2, m: 1, residual: (_z, out) => out.fill(NaN) };
    expect(newtonSolve(nan, new Float64Array(2).fill(1), { tol: 1e-10, maxIter: 5, jacobian: 'always' }).reason).toBe('nonFinite');
    const { problem } = coupledProblem(20);
    const far = newtonSolve(problem, new Float64Array(40).fill(2), { tol: 1e-14, maxIter: 2, jacobian: 'always' });
    expect(far.converged).toBe(false);
    expect(far.reason).toBe('maxIter');
    expect(far.iterations).toBe(2);
  });

  it('a start that already satisfies the system converges without a Jacobian (residualTol), and the applied step measure honours the floor', () => {
    const { problem, zStar } = coupledProblem(10);
    const r = newtonSolve(problem, Float64Array.from(zStar), { tol: 1e-10, maxIter: 5, jacobian: 'always', residualTol: 1e-9 });
    expect(r.converged).toBe(true);
    expect(r.reason).toBe('residual');
    expect(r.jacobians).toBe(0);
    expect(r.iterations).toBe(0);
    // blocks of a store are the size of the problem
    expect(jacobianStore(5, 3).J.B.length).toBe(45);
    expect(blockTridiag(2, 4).A.length).toBe(32);
  });
});
