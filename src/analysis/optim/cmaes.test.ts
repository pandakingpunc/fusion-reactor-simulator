import { describe, expect, it } from 'vitest';
import { cmaes, jacobiEigen } from './cmaes';

const sphere = (x: number[]) => x.reduce((s, v) => s + v * v, 0);
const rosenbrock = (x: number[]) => x.slice(0, -1).reduce((s, v, i) => s + 100 * (x[i + 1] - v * v) ** 2 + (1 - v) ** 2, 0);
/** axis ratio 1000: condition number 1e6 */
const ellipsoid = (x: number[]) => x.reduce((s, v, i) => s + 1e6 ** (i / (x.length - 1)) * v * v, 0);
const rastrigin = (x: number[]) => 10 * x.length + x.reduce((s, v) => s + v * v - 10 * Math.cos(2 * Math.PI * v), 0);

describe('Jacobi eigendecomposition', () => {
  it('a 2 x 2 matrix with known eigenvalues 1 and 3', () => {
    const e = jacobiEigen([[2, 1], [1, 2]]);
    expect([...e.values].sort((a, b) => a - b).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, 3]);
  });

  it('reconstructs a symmetric matrix from its eigenpairs and returns orthonormal eigenvectors', () => {
    const A = [[4, 1, -2, 0.5, 0], [1, 3, 0.3, -1, 0.2], [-2, 0.3, 5, 0.7, 1], [0.5, -1, 0.7, 2, -0.4], [0, 0.2, 1, -0.4, 6]];
    const { values, vectors } = jacobiEigen(A);
    const n = 5;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let rec = 0, dot = 0;
        for (let k = 0; k < n; k++) { rec += vectors[i][k] * values[k] * vectors[j][k]; dot += vectors[k][i] * vectors[k][j]; }
        expect(rec).toBeCloseTo(A[i][j], 12);
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
    // trace and determinant-free check: the eigenvalues sum to the trace
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 12);
  });

  it('a diagonal matrix is left alone', () => {
    const e = jacobiEigen([[3, 0], [0, 1]]);
    expect(e.values).toEqual([3, 1]);
  });
});

describe('CMA-ES', () => {
  it('minimises the sphere in 10 dimensions to 1e-12', () => {
    const r = cmaes(sphere, new Array(10).fill(1));
    expect(r.f).toBeLessThan(1e-12);
    expect(r.converged).toBe(true);
    expect(r.evals).toBeLessThan(20000);
    expect(r.generations).toBeGreaterThan(20);
  });

  it('solves an ill-conditioned ellipsoid (condition number 1e6), aligned with the axes and rotated', () => {
    const r = cmaes(ellipsoid, new Array(8).fill(1), { sigma0: 0.5 });
    expect(r.f).toBeLessThan(1e-10);
    expect(r.evals).toBeLessThan(80000);
    // the same ellipsoid in a frame rotated by the orthogonal Sylvester-Hadamard matrix H / sqrt(8): the covariance adaptation learns the rotation
    let H = [[1]];
    while (H.length < 8) H = H.map((row) => [...row, ...row]).concat(H.map((row) => [...row, ...row.map((v) => -v)]));
    const rotated = (x: number[]) => ellipsoid(H.map((row) => row.reduce((s, v, j) => s + v * x[j], 0) / Math.sqrt(8)));
    const q = cmaes(rotated, new Array(8).fill(1), { sigma0: 0.5 });
    expect(q.f).toBeLessThan(1e-10);
    expect(q.evals).toBeLessThan(80000);
  });

  it('finds the valley of the 5-dimensional Rosenbrock function', () => {
    const r = cmaes(rosenbrock, new Array(5).fill(-1), { sigma0: 0.5, maxEvals: 100000 });
    expect(r.f).toBeLessThan(1e-9);
    r.x.forEach((v) => expect(v).toBeCloseTo(1, 4));
  });

  it('respects box bounds: every evaluated point is inside, the constrained minimum is on the bound', () => {
    let outside = 0;
    const f = (x: number[]) => { if (x[0] < 0 || x[0] > 2 || x[1] < 0 || x[1] > 2) outside++; return (x[0] - 3) ** 2 + (x[1] + 1) ** 2; };
    const r = cmaes(f, [1, 1], { lower: [0, 0], upper: [2, 2], seed: 3 });
    expect(outside).toBe(0);
    expect(r.x[0]).toBeCloseTo(2, 6);
    expect(r.x[1]).toBeCloseTo(0, 6);
    expect(r.f).toBeCloseTo(2, 10);
  });

  it('is reproducible for a seed and different for another', () => {
    const a = cmaes(sphere, [2, 2, 2], { seed: 4 }), b = cmaes(sphere, [2, 2, 2], { seed: 4 }), c = cmaes(sphere, [2, 2, 2], { seed: 5 });
    expect(a).toEqual(b);
    expect(c.evals === a.evals && c.f === a.f).toBe(false);
  });

  it('IPOP restarts (doubled population) find the global minimum of the multimodal Rastrigin function in 4 of 5 seeded runs', () => {
    let solved = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const r = cmaes(rastrigin, [3, -3, 3, -3], { lower: [-5.12, -5.12, -5.12, -5.12], upper: [5.12, 5.12, 5.12, 5.12], sigma0: 1.5, restarts: 6, seed, maxEvals: 400000 });
      if (r.f < 1e-6) solved++;
    }
    expect(solved).toBeGreaterThanOrEqual(4);
  });

  it('reports the evaluation budget and copes with a region where the objective is not finite', () => {
    const cut = cmaes(rosenbrock, [-1, -1, -1], { maxEvals: 200 });
    expect(cut.reason).toBe('maxEvals');
    expect(cut.converged).toBe(false);
    expect(cut.evals).toBeLessThanOrEqual(200 + 8);
    const f = (x: number[]) => (x[0] < 0 ? NaN : (x[0] - 1) ** 2 + x[1] ** 2);
    const r = cmaes(f, [2, 1], { seed: 2 });
    expect(r.f).toBeLessThan(1e-9);
    expect(r.x[0]).toBeCloseTo(1, 4);
  });

  it('rejects invalid input', () => {
    expect(() => cmaes(sphere, [])).toThrow(/at least one variable/);
    expect(() => cmaes(sphere, [1], { lower: [2], upper: [1] })).toThrow(/upper\[0\] < lower\[0\]/);
    expect(() => cmaes(sphere, [1, 1], { sigma0: 0 })).toThrow(/sigma0 must be positive/);
    expect(() => cmaes(sphere, [1, 1], { popSize: 3 })).toThrow(/popSize must be an integer >= 4/);
  });
});
