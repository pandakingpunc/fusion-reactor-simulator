/**
 * Block-tridiagonal solver (any block size) against dense LU, and the coloured finite-difference Jacobian against the
 * column-by-column one and against a linear map whose Jacobian is known.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../rng';
import { BlockTridiagLU, blockTridiag, blockTridiagMul, coloredJacobian, solveBlockTridiagN } from './blockTridiagN';
import { SingularMatrixError, solveBlockTridiag2, solveDense } from './linalg';

/** Random non-symmetric block-tridiagonal matrix, block-diagonally dominant when `dominant` */
function randomSystem(n: number, m: number, seed: number, dominant = true) {
  const rng = new RNG(seed);
  const s = blockTridiag(n, m);
  const mm = m * m;
  const fill = (arr: Float64Array, shift: number) => {
    for (let k = 0; k < arr.length; k++) arr[k] = 2 * rng.next() - 1;
    if (shift) for (let i = 0; i < n; i++) for (let r = 0; r < m; r++) arr[i * mm + r * m + r] += shift * (r % 2 ? -1 : 1);
  };
  fill(s.A, 0); fill(s.C, 0); fill(s.B, dominant ? 3 * m : 0);
  if (n > 0) { s.A.fill(0, 0, mm); s.C.fill(0, (n - 1) * mm); } // the unused blocks stay zero, as in the dense matrix
  const d = Float64Array.from({ length: n * m }, () => 4 * rng.next() - 2);
  return { s, d };
}

/** The dense matrix of a block-tridiagonal one */
function dense(A: Float64Array, B: Float64Array, C: Float64Array, n: number, m: number): Float64Array {
  const N = n * m, D = new Float64Array(N * N), mm = m * m;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) {
        D[(i * m + r) * N + i * m + c] = B[i * mm + r * m + c];
        if (i > 0) D[(i * m + r) * N + (i - 1) * m + c] = A[i * mm + r * m + c];
        if (i < n - 1) D[(i * m + r) * N + (i + 1) * m + c] = C[i * mm + r * m + c];
      }
    }
  }
  return D;
}

describe('BlockTridiagLU', () => {
  it.each([[1, 1], [1, 4], [2, 3], [3, 2], [8, 1], [8, 4], [31, 4], [17, 5], [40, 3]])('n = %i blocks of size m = %i: the solution equals the dense LU one and closes the system', (n, m) => {
    const { s, d } = randomSystem(n, m, 100 * n + m);
    const u = solveBlockTridiagN(s.A, s.B, s.C, d, new Float64Array(n * m), n, m);
    const ref = solveDense(dense(s.A, s.B, s.C, n, m), d, n * m);
    let worst = 0;
    for (let k = 0; k < n * m; k++) worst = Math.max(worst, Math.abs(u[k] - ref[k]) / (1 + Math.abs(ref[k])));
    expect(worst).toBeLessThan(1e-12);
    const back = blockTridiagMul(s.A, s.B, s.C, u, new Float64Array(n * m), n, m);
    for (let k = 0; k < n * m; k++) expect(Math.abs(back[k] - d[k])).toBeLessThan(1e-11 * (1 + Math.abs(d[k])));
  });

  it('pivots inside a block: blocks with a zero diagonal (a permutation) are solved', () => {
    const n = 6, m = 3, mm = 9;
    const { s, d } = randomSystem(n, m, 7);
    // B_i = a cyclic permutation matrix plus a small part: every diagonal entry is exactly zero, the block is nonsingular
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) s.B[i * mm + r * m + c] = c === (r + 1) % m ? 4 : 0.01 * (r + c);
      for (let r = 0; r < m; r++) s.B[i * mm + r * m + r] = 0;
    }
    const u = solveBlockTridiagN(s.A, s.B, s.C, d, new Float64Array(n * m), n, m);
    const ref = solveDense(dense(s.A, s.B, s.C, n, m), d, n * m);
    for (let k = 0; k < n * m; k++) expect(Math.abs(u[k] - ref[k])).toBeLessThan(1e-11 * (1 + Math.abs(ref[k])));
  });

  it('agrees with the 2 × 2 solver of linalg.ts', () => {
    const n = 25, m = 2;
    const { s, d } = randomSystem(n, m, 3);
    const a = solveBlockTridiagN(s.A, s.B, s.C, d, new Float64Array(n * m), n, m);
    const b = solveBlockTridiag2(s.A, s.B, s.C, d, new Float64Array(n * m), n);
    for (let k = 0; k < n * m; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-12 * (1 + Math.abs(b[k])));
  });

  it('a factorisation serves several right-hand sides, and solve may overwrite its own right-hand side', () => {
    const n = 20, m = 4;
    const { s } = randomSystem(n, m, 11);
    const lu = new BlockTridiagLU(n, m);
    lu.factor(s.A, s.B, s.C);
    const D = dense(s.A, s.B, s.C, n, m);
    for (let trial = 0; trial < 3; trial++) {
      const rng = new RNG(50 + trial);
      const d = Float64Array.from({ length: n * m }, () => rng.next() - 0.5);
      const ref = solveDense(D, d, n * m);
      const u = lu.solve(d, new Float64Array(n * m));
      for (let k = 0; k < n * m; k++) expect(Math.abs(u[k] - ref[k])).toBeLessThan(1e-12 * (1 + Math.abs(ref[k])));
      const inPlace = Float64Array.from(d);
      lu.solve(inPlace, inPlace);
      for (let k = 0; k < n * m; k++) expect(inPlace[k]).toBe(u[k]);
    }
  });

  it('a singular pivot block throws SingularMatrixError; a non-finite one too; solve before factor is a programming error', () => {
    const n = 5, m = 3;
    const { s, d } = randomSystem(n, m, 2);
    s.B.fill(0, 2 * 9, 3 * 9); // block 2 of the diagonal is zero: the pivot block is singular (A_2 Y_1 may leave something, so zero A too)
    s.A.fill(0, 2 * 9, 3 * 9);
    expect(() => solveBlockTridiagN(s.A, s.B, s.C, d, new Float64Array(n * m), n, m)).toThrow(SingularMatrixError);
    const t = randomSystem(n, m, 2);
    t.s.B[4] = NaN;
    expect(() => solveBlockTridiagN(t.s.A, t.s.B, t.s.C, t.d, new Float64Array(n * m), n, m)).toThrow(SingularMatrixError);
    expect(() => new BlockTridiagLU(3, 2).solve(new Float64Array(6), new Float64Array(6))).toThrow(/before factor/);
    expect(() => new BlockTridiagLU(0, 2)).toThrow(/invalid size/);
  });
});

describe('coloredJacobian', () => {
  /** A smooth nonlinear map with a three-point stencil: cell i of F depends on the cells i − 1, i, i + 1 */
  function smoothMap(n: number, m: number) {
    const rng = new RNG(31);
    const W = Array.from({ length: 3 }, () => Array.from({ length: m * m }, () => rng.next() - 0.5));
    return (z: Float64Array, out: Float64Array) => {
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < m; r++) {
          let s = 0;
          for (let k = 0; k < m; k++) {
            const zl = i > 0 ? z[(i - 1) * m + k] : 0, zc = z[i * m + k], zr = i < n - 1 ? z[(i + 1) * m + k] : 0;
            s += W[0][r * m + k] * Math.sin(zl) + W[1][r * m + k] * (zc + 0.3 * zc * zc * z[i * m + ((k + 1) % m)]) + W[2][r * m + k] * zr / (1 + zc * zc);
          }
          out[i * m + r] = s;
        }
      }
    };
  }

  it.each([[1, 2], [2, 4], [3, 4], [4, 3], [10, 4], [31, 4], [16, 2]])('n = %i, m = %i: equals the column-by-column difference Jacobian and needs 3 m evaluations', (n, m) => {
    const F = smoothMap(n, m);
    const rng = new RNG(n + m);
    const z = Float64Array.from({ length: n * m }, () => 2 * rng.next() - 1);
    const F0 = new Float64Array(n * m);
    F(z, F0);
    let calls = 0;
    const counted = (x: Float64Array, out: Float64Array) => { calls++; F(x, out); };
    const J = blockTridiag(n, m);
    const evals = coloredJacobian(counted, z, F0, n, m, J);
    expect(evals).toBe(Math.min(3, n) * m);
    expect(calls).toBe(evals);
    // the dense Jacobian column by column (one perturbed unknown at a time), same step
    const D = new Float64Array((n * m) ** 2), Fp = new Float64Array(n * m);
    for (let j = 0; j < n * m; j++) {
      const zp = Float64Array.from(z);
      const h = 1e-7 * Math.max(Math.abs(z[j]), 1);
      zp[j] += h;
      const dx = zp[j] - z[j];
      F(zp, Fp);
      for (let r = 0; r < n * m; r++) D[r * n * m + j] = (Fp[r] - F0[r]) / dx;
    }
    const band = dense(J.A, J.B, J.C, n, m);
    let worst = 0;
    for (let k = 0; k < band.length; k++) worst = Math.max(worst, Math.abs(band[k] - D[k]));
    expect(worst).toBeLessThan(1e-12);
    // outside the band the map has no dependence: the column-by-column entries are zero there
    for (let r = 0; r < n * m; r++) for (let c = 0; c < n * m; c++) {
      if (Math.abs(Math.floor(r / m) - Math.floor(c / m)) > 1) expect(D[r * n * m + c]).toBe(0);
    }
  });

  it('a linear map: the Jacobian is the matrix (to the accuracy of the differences)', () => {
    const n = 12, m = 4;
    const { s } = randomSystem(n, m, 9);
    const F = (z: Float64Array, out: Float64Array) => { blockTridiagMul(s.A, s.B, s.C, z, out, n, m); };
    const z = Float64Array.from({ length: n * m }, (_, k) => Math.cos(k));
    const F0 = new Float64Array(n * m);
    F(z, F0);
    const J = blockTridiag(n, m);
    coloredJacobian(F, z, F0, n, m, J);
    for (const name of ['A', 'B', 'C'] as const) for (let k = 0; k < J[name].length; k++) expect(Math.abs(J[name][k] - s[name][k])).toBeLessThan(1e-6);
  });

  it('a dependence beyond the neighbouring cells is not represented (attributed to the cell that is perturbed with it): the documented limit', () => {
    const n = 9, m = 1;
    // F_i = z_{i+3}: the Jacobian has entries on the third super-diagonal, outside the stencil
    const F = (z: Float64Array, out: Float64Array) => { for (let i = 0; i < n; i++) out[i] = i + 3 < n ? z[i + 3] : 0; };
    const z = new Float64Array(n).fill(1);
    const F0 = new Float64Array(n);
    F(z, F0);
    const J = blockTridiag(n, m);
    coloredJacobian(F, z, F0, n, m, J);
    // cell i is perturbed together with i + 3, and row i feels z_{i+3}: the entry lands in the diagonal block, where the true value is zero
    expect(J.B[0]).toBeCloseTo(1, 6);
  });
});
