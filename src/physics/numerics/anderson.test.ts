/**
 * Anderson mixing (numerics/anderson.ts) step by step against an independent implementation of the published algorithm
 * (Walker and Ni 2011, algorithm AA with damping): the least-squares problem of the history is solved here by the normal equations
 * and a dense LU factorisation, the mixer does it by modified Gram-Schmidt QR. numerics.test.ts checks that the iteration converges;
 * these tests pin the iterates themselves, so a change of the update formula, of the damping or of the treatment of dependent
 * columns cannot hide behind a fixed point that every such variant shares.
 */
import { describe, expect, it } from 'vitest';
import { AndersonMixer } from './anderson';
import { solveDense } from './linalg';

/**
 * x_{k+1} of the algorithm from the whole history of the pairs (x_i, g_i = G(x_i)), i = 0…k: the columns are the last `depth`
 * differences (`skip`: indices of columns, counted from the oldest one used, that the mixer must have dropped as dependent).
 */
function reference(xs: Float64Array[], gs: Float64Array[], depth: number, beta: number, skip: number[] = []): Float64Array {
  const k = xs.length - 1, n = xs[0].length;
  const f = gs.map((g, i) => Float64Array.from(g, (v, j) => v - xs[i][j]));
  const m = Math.min(depth, k);
  const cols: { dF: Float64Array; dG: Float64Array }[] = [];
  for (let c = 0; c < m; c++) {
    if (skip.includes(c)) continue;
    const i = k - m + c;
    cols.push({ dF: Float64Array.from(f[i + 1], (v, j) => v - f[i][j]), dG: Float64Array.from(gs[i + 1], (v, j) => v - gs[i][j]) });
  }
  const out = Float64Array.from(gs[k], (v, j) => v - (1 - beta) * f[k][j]);
  if (cols.length === 0) return Float64Array.from(xs[k], (v, j) => v + beta * f[k][j]);
  const q = cols.length;
  const A = new Float64Array(q * q), b = new Float64Array(q);
  for (let p = 0; p < q; p++) {
    for (let r = 0; r < q; r++) for (let j = 0; j < n; j++) A[p * q + r] += cols[p].dF[j] * cols[r].dF[j];
    for (let j = 0; j < n; j++) b[p] += cols[p].dF[j] * f[k][j];
  }
  const gam = solveDense(A, b, q);
  for (let p = 0; p < q; p++) {
    for (let j = 0; j < n; j++) out[j] -= gam[p] * (cols[p].dG[j] - (1 - beta) * cols[p].dF[j]);
  }
  return out;
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  let scale = 0, diff = 0;
  for (let i = 0; i < a.length; i++) { scale = Math.max(scale, Math.abs(b[i])); diff = Math.max(diff, Math.abs(a[i] - b[i])); }
  return diff <= tol * Math.max(scale, 1e-300);
};

/** a nonlinear map with a slowly converging fixed point (n = 6) */
const G6 = (x: Float64Array): Float64Array => Float64Array.from(x, (v, i) => 0.6 * Math.cos(v) + 0.25 * x[(i + 1) % x.length] + 0.1 * i);

describe('Anderson mixing: iterate by iterate', () => {
  it.each([[1, 1], [3, 1], [3, 0.6], [4, 0.35], [2, 0.8]])('depth %s, damping %s: every iterate is the one of the algorithm, ring buffer wrap-around included', (depth, beta) => {
    const n = 6;
    const acc = new AndersonMixer(n, depth);
    const x = new Float64Array(n);
    const xs: Float64Array[] = [], gs: Float64Array[] = [];
    for (let k = 0; k < 3 * depth + 4; k++) {
      const g = G6(x);
      xs.push(Float64Array.from(x)); gs.push(g);
      const want = reference(xs, gs, depth, beta);
      acc.step(x, g, beta);
      expect(close(x, want, 1e-9), `iterate ${k + 1}`).toBe(true);
      expect(acc.historySize).toBe(Math.min(depth, k));
    }
  });

  it('a reset forgets the history: the next step is a damped Picard step and the run continues as a fresh one', () => {
    const n = 6, beta = 0.7;
    const acc = new AndersonMixer(n, 3);
    const x = new Float64Array(n);
    for (let k = 0; k < 5; k++) acc.step(x, G6(x), beta);
    acc.reset();
    expect(acc.historySize).toBe(0);
    const g = G6(x);
    const picard = Float64Array.from(x, (v, i) => v + beta * (g[i] - v));
    const xs = [Float64Array.from(x)], gs = [g];
    acc.step(x, g, beta);
    expect(Array.from(x)).toEqual(Array.from(picard));
    for (let k = 0; k < 4; k++) {
      const g2 = G6(x);
      xs.push(Float64Array.from(x)); gs.push(g2);
      const want = reference(xs, gs, 3, beta);
      acc.step(x, g2, beta);
      expect(close(x, want, 1e-9), `iterate ${k + 2} after the reset`).toBe(true);
    }
  });

  it('a nearly dependent column (relative 1e-3 out of line) is kept, not dropped as dependent: the least-squares solution uses both columns', () => {
    const n = 4;
    // residuals: dF_0 = d0 = (1, 0.3, 0, 0) and dF_1 = d0 + (0, 0, 1e-3, 0): the columns are parallel to 1e-3, their squared distance is 1e-6 of the norm
    const f = [[1, 0, 0, 0], [2, 0.3, 0, 0], [3, 0.6, 1e-3, 0], [4.5, 0.7, -0.4, 0.5]].map((v) => Float64Array.from(v));
    const xs = [[0.2, 0.1, 0, 0.3], [0.4, -0.1, 0.2, 0], [0.1, 0.2, 0.1, 0.1], [0.3, 0.3, 0.3, 0.3]].map((v) => Float64Array.from(v));
    const gs = f.map((fi, i) => Float64Array.from(fi, (v, j) => v + xs[i][j]));
    const acc = new AndersonMixer(n, 2);
    for (let k = 0; k <= 3; k++) {
      const x = Float64Array.from(xs[k]);
      acc.step(x, gs[k], 1);
      const want = reference(xs.slice(0, k + 1), gs.slice(0, k + 1), 2, 1);
      expect(close(x, want, 1e-6), `step ${k}`).toBe(true);
    }
  });

  it('an exactly dependent column between two independent ones is skipped for that step (no NaN); the older and the newer independent ones are kept', () => {
    const n = 5;
    const d0 = Float64Array.of(0.5, -1, 0.25, 0, 2);
    const f: Float64Array[] = [Float64Array.of(1, 2, 0, 0, 1)];
    f.push(Float64Array.from(f[0], (v, j) => v + d0[j]));       // dF_0 = d0
    f.push(Float64Array.from(f[1], (v, j) => v + 3 * d0[j]));   // dF_1 = 3 d0: parallel to dF_0, dropped
    f.push(Float64Array.of(0.3, -0.2, 0.9, 0.4, -0.7));         // dF_2 independent
    const xs = [Float64Array.of(0, 0, 0, 0, 0), Float64Array.of(1, 1, 0, 0, 0), Float64Array.of(2, 0.5, 1, 0, 0), Float64Array.of(0, 1, 2, 1, 0)];
    const gs = f.map((fi, i) => Float64Array.from(fi, (v, j) => v + xs[i][j]));
    const acc = new AndersonMixer(n, 3);
    for (let k = 0; k <= 2; k++) acc.step(Float64Array.from(xs[k]), gs[k], 0.8);
    const x = Float64Array.from(xs[3]);
    acc.step(x, gs[3], 0.8);
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
    // k = 3, m = 3: the columns are c = 0 (dF_0), c = 1 (dF_1, dependent) and c = 2 (dF_2)
    expect(close(x, reference(xs, gs, 3, 0.8, [1]), 1e-9)).toBe(true);
  });

  it('two exactly parallel columns: the newer one is dropped and the result is that of the older column alone', () => {
    const n = 5;
    const d0 = Float64Array.of(0.5, -1, 0.25, 0, 2);
    const f = [Float64Array.of(1, 2, 0, 0, 1)];
    f.push(Float64Array.from(f[0], (v, j) => v + d0[j]));       // dF_0 = d0
    f.push(Float64Array.from(f[1], (v, j) => v + 3 * d0[j]));   // dF_1 = 3 d0: parallel to dF_0
    const xs = [Float64Array.of(0, 0, 0, 0, 0), Float64Array.of(1, 1, 0, 0, 0), Float64Array.of(2, 0.5, 1, 0, 0)];
    const gs = f.map((fi, i) => Float64Array.from(fi, (v, j) => v + xs[i][j]));
    const acc = new AndersonMixer(n, 2);
    acc.step(Float64Array.from(xs[0]), gs[0], 0.9);
    acc.step(Float64Array.from(xs[1]), gs[1], 0.9);
    const x = Float64Array.from(xs[2]);
    acc.step(x, gs[2], 0.9);
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
    // k = 2, m = 2: the columns are c = 0 (dF_0) and c = 1 (dF_1); the second is dependent and skipped
    expect(close(x, reference(xs, gs, 2, 0.9, [1]), 1e-9)).toBe(true);
  });

  it('is deterministic and does not modify g', () => {
    const n = 6;
    const run = () => {
      const acc = new AndersonMixer(n, 3), x = new Float64Array(n);
      for (let k = 0; k < 8; k++) { const g = G6(x), copy = Float64Array.from(g); acc.step(x, g, 0.9); expect(Array.from(g)).toEqual(Array.from(copy)); }
      return Array.from(x);
    };
    expect(run()).toEqual(run());
  });

  it('refuses a size or depth that is not a non-negative integer (n > 0)', () => {
    expect(() => new AndersonMixer(0, 2)).toThrow();
    expect(() => new AndersonMixer(3, -1)).toThrow();
    expect(() => new AndersonMixer(3, 1.5)).toThrow();
    expect(() => new AndersonMixer(2.5, 1)).toThrow();
  });
});
