import { describe, expect, it } from 'vitest';
import { augmentedLagrangian } from './augLag';
import { nelderMead } from './neldermead';

const rosenbrock = (x: number[]) => 100 * (x[1] - x[0] ** 2) ** 2 + (1 - x[0]) ** 2;
const sphere = (x: number[]) => x.reduce((s, v, i) => s + (v - i) ** 2, 0);

describe('Nelder-Mead', () => {
  it('finds the minimum of the Rosenbrock function from the standard start (-1.2, 1)', () => {
    const r = nelderMead(rosenbrock, [-1.2, 1]);
    expect(r.x[0]).toBeCloseTo(1, 6);
    expect(r.x[1]).toBeCloseTo(1, 6);
    expect(r.f).toBeLessThan(1e-12);
    expect(r.converged).toBe(true);
    expect(r.reason).toBe('tolerance');
    expect(r.evals).toBeGreaterThan(100);
    expect(r.iterations).toBeGreaterThan(50);
  });

  it('minimises a shifted sphere in 8 dimensions with the adaptive coefficients (default for n >= 5)', () => {
    const r = nelderMead(sphere, new Array(8).fill(3), { maxEvals: 20000 });
    expect(r.f).toBeLessThan(1e-9);
    r.x.forEach((v, i) => expect(v).toBeCloseTo(i, 4));
  });

  it('the classical coefficients also work in low dimension, and adaptive can be forced', () => {
    expect(nelderMead(sphere, [5, 5], { adaptive: false }).f).toBeLessThan(1e-12);
    expect(nelderMead(sphere, [5, 5, 5], { adaptive: true }).f).toBeLessThan(1e-12);
  });

  it('respects box bounds: the minimum of (x - 3)^2 over [0, 2] is at the upper bound', () => {
    const r = nelderMead((x) => (x[0] - 3) ** 2 + (x[1] + 1) ** 2, [1, 1], { lower: [0, 0], upper: [2, 2] });
    expect(r.x[0]).toBe(2);
    expect(r.x[1]).toBe(0);
    expect(r.f).toBeCloseTo(2, 12);
    // every evaluated point stayed in the box
    let outside = 0;
    nelderMead((x) => { if (x[0] < 0 || x[0] > 2 || x[1] < 0 || x[1] > 2) outside++; return (x[0] - 3) ** 2 + (x[1] + 1) ** 2; }, [1, 1], { lower: [0, 0], upper: [2, 2] });
    expect(outside).toBe(0);
  });

  it('starts from a point on a bound (the simplex goes inward) and from a point at the upper bound', () => {
    expect(nelderMead((x) => (x[0] - 0.4) ** 2, [0], { lower: [0], upper: [1] }).x[0]).toBeCloseTo(0.4, 6);
    expect(nelderMead((x) => (x[0] - 0.4) ** 2, [1], { lower: [0], upper: [1] }).x[0]).toBeCloseTo(0.4, 6);
    expect(nelderMead((x) => (x[0] - 5) ** 2, [1], { lower: [1], upper: [1] }).x[0]).toBe(1); // a degenerate box
  });

  it('treats non-finite objective values as very bad points', () => {
    const f = (x: number[]) => (x[0] < 1 ? NaN : x[0] > 4 ? Infinity : (x[0] - 3) ** 2);
    const r = nelderMead(f, [2]);
    expect(r.x[0]).toBeCloseTo(3, 5);
    expect(Number.isFinite(r.f)).toBe(true);
  });

  it('stops at the evaluation budget and says so', () => {
    const r = nelderMead(rosenbrock, [-1.2, 1], { maxEvals: 40 });
    expect(r.reason).toBe('maxEvals');
    expect(r.converged).toBe(false);
    expect(r.evals).toBeLessThanOrEqual(45);
  });

  it('restarts recover from a premature stop of a coarse first simplex', () => {
    const noRestart = nelderMead(rosenbrock, [-1.2, 1], { restarts: 0, xTol: 1e-3, fTol: 1e-3 });
    const withRestart = nelderMead(rosenbrock, [-1.2, 1], { restarts: 6, xTol: 1e-3, fTol: 1e-3 });
    expect(withRestart.f).toBeLessThanOrEqual(noRestart.f);
  });

  it('is deterministic', () => {
    expect(nelderMead(rosenbrock, [-1.2, 1])).toEqual(nelderMead(rosenbrock, [-1.2, 1]));
  });

  it('rejects invalid input', () => {
    expect(() => nelderMead(sphere, [])).toThrow(/at least one variable/);
    expect(() => nelderMead(sphere, [1], { lower: [2], upper: [1] })).toThrow(/upper\[0\] < lower\[0\]/);
  });

  it('custom simplex edges', () => {
    const r = nelderMead((x) => (x[0] - 1e3) ** 2 + (x[1] - 1e-3) ** 2 * 1e6, [0, 0], { step: [100, 1e-4] });
    expect(r.x[0]).toBeCloseTo(1e3, 3);
    expect(r.x[1]).toBeCloseTo(1e-3, 6);
    expect(nelderMead(sphere, [4, 4], { step: 0.5 }).f).toBeLessThan(1e-12);
  });
});

describe('augmented Lagrangian', () => {
  /*
   * Hock & Schittkowski, "Test examples for nonlinear programming codes", Lecture Notes in Economics and Mathematical Systems
   * 187, Springer 1981. Problem 71:  min x1 x4 (x1 + x2 + x3) + x3  s.t.  x1 x2 x3 x4 >= 25,  x1^2 + x2^2 + x3^2 + x4^2 = 40,
   * 1 <= x_i <= 5, start (1, 5, 5, 1); solution x* = (1, 4.7429994, 3.8211503, 1.3794082), f* = 17.0140173.
   */
  const hs71 = {
    n: 4,
    f: (x: number[]) => x[0] * x[3] * (x[0] + x[1] + x[2]) + x[2],
    ineq: (x: number[]) => [25 - x[0] * x[1] * x[2] * x[3]],
    eq: (x: number[]) => [x[0] ** 2 + x[1] ** 2 + x[2] ** 2 + x[3] ** 2 - 40],
    lower: [1, 1, 1, 1], upper: [5, 5, 5, 5],
  };

  it('Hock-Schittkowski #71: f* = 17.0140173 and x* to six digits, feasible', () => {
    const r = augmentedLagrangian(hs71, [1, 5, 5, 1]);
    expect(r.converged).toBe(true);
    expect(r.reason).toBe('converged');
    expect(r.f).toBeCloseTo(17.0140173, 6);
    expect(Math.abs(r.f - 17.0140173)).toBeLessThan(1e-6);
    const xs = [1, 4.7429994, 3.8211503, 1.3794082];
    r.x.forEach((v, i) => expect(Math.abs(v - xs[i]), `x${i + 1}`).toBeLessThan(1e-5));
    expect(r.violation).toBeLessThan(1e-6);
    expect(r.feasible).toBe(true);
    // the product constraint is active (multiplier > 0), the sum of squares equality holds
    expect(r.lambda[0]).toBeGreaterThan(0.5);
    expect(hs71.eq(r.x)[0]).toBeCloseTo(0, 6);
    expect(25 - hs71.ineq(r.x)[0]).toBeGreaterThanOrEqual(25 - 1e-6);
    expect(r.x[0]).toBeCloseTo(1, 10); // x1 sits on its lower bound
    expect(r.evals).toBeGreaterThan(500);
    expect(r.history.length).toBe(r.outer);
    expect(r.history[r.history.length - 1].violation).toBeLessThan(1e-6);
  });

  it('is deterministic and reaches the same optimum from another feasible-ish start', () => {
    expect(augmentedLagrangian(hs71, [1, 5, 5, 1])).toEqual(augmentedLagrangian(hs71, [1, 5, 5, 1]));
    const r = augmentedLagrangian(hs71, [2, 3, 3, 2]);
    expect(Math.abs(r.f - 17.0140173)).toBeLessThan(1e-5);
  });

  it('HS #6: an equality constraint. min (1 - x1)^2  s.t.  10 (x2 - x1^2) = 0, start (-1.2, 1); f* = 0 at (1, 1)', () => {
    const r = augmentedLagrangian({ n: 2, f: (x) => (1 - x[0]) ** 2, eq: (x) => [10 * (x[1] - x[0] ** 2)] }, [-1.2, 1]);
    expect(r.f).toBeLessThan(1e-9);
    expect(r.x[0]).toBeCloseTo(1, 4);
    expect(r.x[1]).toBeCloseTo(1, 4);
    expect(r.violation).toBeLessThan(1e-6);
  });

  it('HS #12: an inequality constraint. min 0.5 x1^2 + x2^2 - x1 x2 - 7 x1 - 7 x2  s.t.  25 - 4 x1^2 - x2^2 >= 0, start (0, 0); f* = -30 at (2, 3)', () => {
    const r = augmentedLagrangian({ n: 2, f: (x) => 0.5 * x[0] ** 2 + x[1] ** 2 - x[0] * x[1] - 7 * x[0] - 7 * x[1], ineq: (x) => [4 * x[0] ** 2 + x[1] ** 2 - 25] }, [0, 0]);
    expect(r.f).toBeCloseTo(-30, 5);
    expect(r.x[0]).toBeCloseTo(2, 3);
    expect(r.x[1]).toBeCloseTo(3, 3);
    expect(r.lambda[0]).toBeGreaterThan(0.1); // active
  });

  it('KKT multiplier: min x^2 s.t. 1 - x <= 0 has x = 1 and lambda = 2; an inactive constraint has lambda = 0', () => {
    const active = augmentedLagrangian({ n: 1, f: (x) => x[0] ** 2, ineq: (x) => [1 - x[0]] }, [3]);
    expect(active.x[0]).toBeCloseTo(1, 5);
    expect(active.lambda[0]).toBeCloseTo(2, 3);
    const inactive = augmentedLagrangian({ n: 1, f: (x) => (x[0] - 1) ** 2, ineq: (x) => [-1 - x[0]] }, [3]);
    expect(inactive.x[0]).toBeCloseTo(1, 5);
    expect(inactive.lambda[0]).toBe(0);
  });

  it('an infeasible problem is reported as such', () => {
    const r = augmentedLagrangian({ n: 1, f: (x) => x[0], ineq: (x) => [x[0] - 1, 2 - x[0]] }, [0.5], { maxOuter: 8 });
    expect(r.feasible).toBe(false);
    expect(r.converged).toBe(false);
    expect(r.violation).toBeGreaterThan(0.1);
  });

  it('a bound-only problem needs no constraints; the budget is honoured', () => {
    const r = augmentedLagrangian({ n: 2, f: (x) => (x[0] - 2) ** 2 + (x[1] + 1) ** 2, lower: [0, 0], upper: [1, 1] }, [0.5, 0.5]);
    expect(r.x).toEqual([1, 0]);
    expect(r.violation).toBe(0);
    expect(r.lambda).toEqual([]);
    const cut = augmentedLagrangian(hs71, [1, 5, 5, 1], { maxEvals: 300 });
    expect(cut.reason).toBe('maxEvals');
    expect(cut.converged).toBe(false);
  });

  it('rejects a start point of the wrong size', () => {
    expect(() => augmentedLagrangian(hs71, [1, 2])).toThrow(/x0 has 2 entries, the problem has 4 variables/);
  });
});

describe('augmented Lagrangian with another inner minimiser', () => {
  it('CMA-ES as the inner solver reaches the Hock-Schittkowski #71 optimum as well', async () => {
    const { cmaes } = await import('./cmaes');
    const hs71 = {
      n: 4,
      f: (x: number[]) => x[0] * x[3] * (x[0] + x[1] + x[2]) + x[2],
      ineq: (x: number[]) => [25 - x[0] * x[1] * x[2] * x[3]],
      eq: (x: number[]) => [x[0] ** 2 + x[1] ** 2 + x[2] ** 2 + x[3] ** 2 - 40],
      lower: [1, 1, 1, 1], upper: [5, 5, 5, 5],
    };
    const r = augmentedLagrangian(hs71, [1, 5, 5, 1], {
      minimizer: (f, x0, lower, upper, maxEvals, outer) => cmaes(f, x0, { lower, upper, maxEvals, sigma0: outer === 1 ? 0.5 : 0.05, seed: 7, tolFun: 1e-14, tolX: 1e-10 }),
    });
    expect(r.feasible).toBe(true);
    expect(Math.abs(r.f - 17.0140173)).toBeLessThan(1e-4);
    expect(r.violation).toBeLessThan(1e-5);
  });
});
