/**
 * Block-tridiagonal linear systems with dense m × m blocks (any m), and the finite-difference Jacobian of a map with that structure.
 *
 *   A_i u_{i−1} + B_i u_i + C_i u_{i+1} = d_i,   i = 0 … n − 1   (A_0 and C_{n−1} are not used)
 *
 * Blocks are row-major, m² numbers each, in arrays of n m² numbers (block i at i m²); d and u have n m numbers (cell i at i m).
 * This is the structure of a one-dimensional finite-volume discretisation of m coupled fields with a three-point stencil: the
 * Jacobian of the coupled transport equations (T_e, T_i, n_e, ψ) of the 1.5D model is a 4 × 4 block-tridiagonal matrix.
 *
 * The solver is the block form of the Thomas algorithm: each pivot block M_i = B_i − A_i Y_{i−1} (Y_i = M_i⁻¹ C_i) is factored
 * by LU with partial pivoting inside the block; there is no pivoting across blocks, so the system must be block-diagonally
 * dominant or of the kind that the block elimination is stable for (diffusion operators plus a mass term are; Golub and Van Loan,
 * "Matrix Computations", 4th ed., section 4.5.1). A singular pivot block throws SingularMatrixError (numerics/linalg.ts).
 * The factorisation is kept, so that any number of right-hand sides can be solved with it.
 *
 * coloredJacobian builds the blocks of the Jacobian of F: ℝ^{n m} → ℝ^{n m} whose cell i depends on the cells i − 1, i and i + 1
 * only, by forward differences with the cells coloured modulo 3 (Curtis, Powell and Reid, J. Inst. Math. Appl. 13 (1974) 117):
 * the cells i ≡ c (mod 3) are perturbed together, one field at a time, so that every row of F feels exactly one perturbed cell
 * and 3 m evaluations of F give the whole Jacobian instead of n m.
 */
import { SingularMatrixError } from './linalg';

/** LU factorisation of a block-tridiagonal matrix of n blocks of size m */
export class BlockTridiagLU {
  private readonly A: Float64Array;
  /** LU of the pivot blocks (in place, L unit lower, U upper) */
  private readonly LU: Float64Array;
  private readonly piv: Int32Array;
  /** Y_i = M_i⁻¹ C_i */
  private readonly Y: Float64Array;
  private readonly z: Float64Array;
  private readonly col: Float64Array;
  private readonly tmp: Float64Array;
  private factored = false;

  constructor(readonly n: number, readonly m: number) {
    if (!(Number.isInteger(n) && n >= 1) || !(Number.isInteger(m) && m >= 1)) throw new Error('BlockTridiagLU: invalid size');
    const mm = m * m;
    this.A = new Float64Array(n * mm); this.LU = new Float64Array(n * mm); this.Y = new Float64Array(n * mm);
    this.piv = new Int32Array(n * m);
    this.z = new Float64Array(n * m); this.col = new Float64Array(m); this.tmp = new Float64Array(m);
  }

  /** Factors the matrix with the blocks A, B, C (not modified). Throws SingularMatrixError on a singular pivot block. */
  factor(A: ArrayLike<number>, B: ArrayLike<number>, C: ArrayLike<number>): void {
    const { n, m, LU, Y, piv, col } = this;
    const mm = m * m;
    this.factored = false;
    for (let i = 0; i < n; i++) {
      const o = i * mm;
      // M = B_i − A_i Y_{i−1}
      for (let k = 0; k < mm; k++) LU[o + k] = B[o + k];
      if (i > 0) {
        const p = (i - 1) * mm;
        for (let r = 0; r < m; r++) {
          for (let c = 0; c < m; c++) {
            let s = 0;
            for (let k = 0; k < m; k++) s += A[o + r * m + k] * Y[p + k * m + c];
            LU[o + r * m + c] -= s;
          }
        }
      }
      for (let k = 0; k < mm; k++) this.A[o + k] = A[o + k];
      this.luBlock(o, i * m);
      // Y_i = M_i⁻¹ C_i, column by column
      if (i < n - 1) {
        for (let c = 0; c < m; c++) {
          for (let r = 0; r < m; r++) col[r] = C[o + r * m + c];
          this.solveBlock(o, i * m, col);
          for (let r = 0; r < m; r++) Y[o + r * m + c] = col[r];
        }
      }
    }
    this.factored = true;
  }

  /** Solves the factored system for the right-hand side d (n m numbers); u may be d itself */
  solve(d: ArrayLike<number>, u: Float64Array): Float64Array {
    if (!this.factored) throw new Error('BlockTridiagLU: solve before factor');
    const { n, m, A, Y, z } = this;
    const mm = m * m;
    // forward: z_i = M_i⁻¹ (d_i − A_i z_{i−1})
    for (let i = 0; i < n; i++) {
      const o = i * mm, q = i * m;
      for (let r = 0; r < m; r++) z[q + r] = d[q + r];
      if (i > 0) {
        const p = (i - 1) * m;
        for (let r = 0; r < m; r++) {
          let s = 0;
          for (let k = 0; k < m; k++) s += A[o + r * m + k] * z[p + k];
          z[q + r] -= s;
        }
      }
      this.solveBlock(o, q, z, q);
    }
    // backward: u_i = z_i − Y_i u_{i+1}
    for (let i = n - 1; i >= 0; i--) {
      const o = i * mm, q = i * m;
      for (let r = 0; r < m; r++) {
        let s = z[q + r];
        if (i < n - 1) for (let k = 0; k < m; k++) s -= Y[o + r * m + k] * u[q + m + k];
        u[q + r] = s;
      }
    }
    return u;
  }

  /** In-place LU with partial pivoting of the block at LU[o …]; pivots into piv[q …] */
  private luBlock(o: number, q: number): void {
    const { m, LU, piv } = this;
    for (let k = 0; k < m; k++) piv[q + k] = k;
    for (let k = 0; k < m; k++) {
      let p = k, best = Math.abs(LU[o + k * m + k]);
      for (let r = k + 1; r < m; r++) { const v = Math.abs(LU[o + r * m + k]); if (v > best) { best = v; p = r; } }
      if (!(best > 0) || !Number.isFinite(best)) throw new SingularMatrixError('BlockTridiagLU: singular pivot block');
      if (p !== k) {
        for (let c = 0; c < m; c++) { const t = LU[o + k * m + c]; LU[o + k * m + c] = LU[o + p * m + c]; LU[o + p * m + c] = t; }
        const t = piv[q + k]; piv[q + k] = piv[q + p]; piv[q + p] = t;
      }
      const inv = 1 / LU[o + k * m + k];
      for (let r = k + 1; r < m; r++) {
        const l = (LU[o + r * m + k] *= inv);
        if (l === 0) continue;
        for (let c = k + 1; c < m; c++) LU[o + r * m + c] -= l * LU[o + k * m + c];
      }
    }
  }

  /** Solves M x = b in place for the block at LU[o …] (b holds the right-hand side at b[qb …], the result replaces it) */
  private solveBlock(o: number, q: number, b: Float64Array, qb = 0): void {
    const { m, LU, piv } = this;
    const t = this.tmp;
    for (let r = 0; r < m; r++) t[r] = b[qb + piv[q + r]];
    for (let r = 1; r < m; r++) { let s = t[r]; for (let c = 0; c < r; c++) s -= LU[o + r * m + c] * t[c]; t[r] = s; }
    for (let r = m - 1; r >= 0; r--) { let s = t[r]; for (let c = r + 1; c < m; c++) s -= LU[o + r * m + c] * t[c]; t[r] = s / LU[o + r * m + r]; }
    for (let r = 0; r < m; r++) b[qb + r] = t[r];
  }

}

/** One-shot solve of A u_{i−1} + B u_i + C u_{i+1} = d (blocks of size m); u is returned */
export function solveBlockTridiagN(
  A: ArrayLike<number>, B: ArrayLike<number>, C: ArrayLike<number>, d: ArrayLike<number>, u: Float64Array, n: number, m: number,
): Float64Array {
  const f = new BlockTridiagLU(n, m);
  f.factor(A, B, C);
  return f.solve(d, u);
}

/** out = M u for the block-tridiagonal matrix M = (A, B, C) */
export function blockTridiagMul(
  A: ArrayLike<number>, B: ArrayLike<number>, C: ArrayLike<number>, u: ArrayLike<number>, out: Float64Array, n: number, m: number,
): Float64Array {
  const mm = m * m;
  for (let i = 0; i < n; i++) {
    const o = i * mm, q = i * m;
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let k = 0; k < m; k++) {
        s += B[o + r * m + k] * u[q + k];
        if (i > 0) s += A[o + r * m + k] * u[q - m + k];
        if (i < n - 1) s += C[o + r * m + k] * u[q + m + k];
      }
      out[q + r] = s;
    }
  }
  return out;
}

/** The three block arrays of a block-tridiagonal matrix */
export interface BlockTridiag { A: Float64Array; B: Float64Array; C: Float64Array }

/** Zero blocks for n cells of m fields */
export function blockTridiag(n: number, m: number): BlockTridiag {
  return { A: new Float64Array(n * m * m), B: new Float64Array(n * m * m), C: new Float64Array(n * m * m) };
}

/**
 * Finite-difference Jacobian J of F (cell i of F depends on the cells i − 1, i, i + 1 of z) into J = (A, B, C), with 3 m
 * evaluations of F. F0 is F(z). `delta(i, k, zik)` is the perturbation of field k of cell i at the value zik (default: 1e-7 max(|zik|, 1)).
 * F must leave z untouched. Returns the number of evaluations. A dependence of a row on a cell outside its three-point
 * neighbourhood is not represented (it is attributed to the neighbour that is perturbed at the same time).
 */
export function coloredJacobian(
  F: (z: Float64Array, out: Float64Array) => void, z: Float64Array, F0: ArrayLike<number>, n: number, m: number, J: BlockTridiag,
  delta: (i: number, k: number, zik: number) => number = (_i, _k, v) => 1e-7 * Math.max(Math.abs(v), 1),
): number {
  const mm = m * m, nm = n * m;
  const zp = new Float64Array(nm), Fp = new Float64Array(nm), h = new Float64Array(nm);
  J.A.fill(0); J.B.fill(0); J.C.fill(0);
  let evals = 0;
  for (let colour = 0; colour < 3; colour++) {
    if (colour >= n) break; // no cell of this colour
    for (let k = 0; k < m; k++) {
      zp.set(z);
      for (let i = colour; i < n; i += 3) {
        const x = z[i * m + k];
        let dx = delta(i, k, x);
        // the perturbation must be representable: (x + dx) − x is the step actually taken
        dx = (x + dx) - x;
        if (dx === 0) dx = 1e-7 * Math.max(Math.abs(x), 1);
        h[i * m + k] = dx;
        zp[i * m + k] = x + dx;
      }
      F(zp, Fp); evals++;
      for (let i = colour; i < n; i += 3) {
        const dx = h[i * m + k];
        // rows of the neighbouring cells j = i − 1, i, i + 1: column k of the block (j, i)
        for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
          const arr = j === i ? J.B : j === i + 1 ? J.A : J.C;
          const o = j * mm;
          for (let r = 0; r < m; r++) arr[o + r * m + k] = (Fp[j * m + r] - F0[j * m + r]) / dx;
        }
      }
    }
  }
  return evals;
}
