/**
 * Bağımlılıksız lineer cebir çekirdekleri (Float64Array, tahsisat-dostu).
 *
 *  - solveTridiag       Thomas algoritması, O(N) — 1D taşınım denklemleri
 *  - solveBlockTridiag2 2×2 blok üçlü-köşegen — T_e/T_i örtük eşitlenme bağlaşımı
 *  - luFactor/luSolve   kısmi pivotlu yoğun LU — küçük sistemler (Solov'ev katsayıları, Rosenbrock)
 *  - BandedLU           bantlı LU (pivotsuz) — Grad–Shafranov 5-nokta operatörü; bir kez
 *                       faktörize edilip her Picard iterasyonunda yalnız geri-yerine-koyma yapılır.
 *
 * Kaynak: Golub & Van Loan, "Matrix Computations" (4. bs.) §4.3 (bantlı), §3.4 (pivotlama).
 */

/**
 * A linear system that is singular in working precision: an exactly zero (or non-finite) pivot or block.
 * A class of its own so that a caller can tell the numerics refusing a system, which a smaller step or a
 * different iterate may cure, from a programming error (a wrong argument, a call out of order), which stays a
 * plain Error or TypeError. The messages are unchanged.
 */
export class SingularMatrixError extends Error {
  override readonly name = 'SingularMatrixError';
}

/**
 * Üçlü-köşegen sistem: a[i] x[i−1] + b[i] x[i] + c[i] x[i+1] = d[i]  (a[0], c[n−1] kullanılmaz).
 * Köşegen baskın matrislerde pivotsuz kararlıdır (difüzyon operatörleri böyledir).
 * cp/dp: isteğe bağlı çalışma dizileri (sıcak döngüde tahsisatı önler).
 */
export function solveTridiag(
  a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>,
  x: Float64Array, n = b.length, cp: Float64Array = new Float64Array(n), dp: Float64Array = new Float64Array(n),
): Float64Array {
  let beta = b[0];
  if (beta === 0) throw new SingularMatrixError('solveTridiag: sıfır pivot');
  cp[0] = c[0] / beta;
  dp[0] = d[0] / beta;
  for (let i = 1; i < n; i++) {
    beta = b[i] - a[i] * cp[i - 1];
    if (beta === 0) throw new SingularMatrixError('solveTridiag: sıfır pivot');
    cp[i] = i < n - 1 ? c[i] / beta : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / beta;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/**
 * 2×2 blok üçlü-köşegen sistem: A_i u_{i−1} + B_i u_i + C_i u_{i+1} = d_i,  u_i ∈ ℝ².
 * Bloklar satır-öncelikli [m00, m01, m10, m11] olarak 4n uzunluklu dizilerde; d, u 2n uzunluklu.
 * Blok Thomas (blok LU) — köşegen blok baskın ise kararlı.
 */
export function solveBlockTridiag2(
  A: Float64Array, B: Float64Array, C: Float64Array, d: Float64Array, u: Float64Array, n: number,
  Cp: Float64Array = new Float64Array(4 * n), dp: Float64Array = new Float64Array(2 * n),
): Float64Array {
  for (let i = 0; i < n; i++) {
    const k = 4 * i, k2 = 2 * i;
    // M = B_i − A_i C'_{i−1} ;  r = d_i − A_i d'_{i−1}
    let m00 = B[k], m01 = B[k + 1], m10 = B[k + 2], m11 = B[k + 3];
    let r0 = d[k2], r1 = d[k2 + 1];
    if (i > 0) {
      const p = 4 * (i - 1), p2 = 2 * (i - 1);
      const a00 = A[k], a01 = A[k + 1], a10 = A[k + 2], a11 = A[k + 3];
      const c00 = Cp[p], c01 = Cp[p + 1], c10 = Cp[p + 2], c11 = Cp[p + 3];
      m00 -= a00 * c00 + a01 * c10; m01 -= a00 * c01 + a01 * c11;
      m10 -= a10 * c00 + a11 * c10; m11 -= a10 * c01 + a11 * c11;
      r0 -= a00 * dp[p2] + a01 * dp[p2 + 1];
      r1 -= a10 * dp[p2] + a11 * dp[p2 + 1];
    }
    const det = m00 * m11 - m01 * m10;
    if (det === 0 || !isFinite(det)) throw new SingularMatrixError('solveBlockTridiag2: tekil blok');
    const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
    if (i < n - 1) {
      const c00 = C[k], c01 = C[k + 1], c10 = C[k + 2], c11 = C[k + 3];
      Cp[k] = i00 * c00 + i01 * c10; Cp[k + 1] = i00 * c01 + i01 * c11;
      Cp[k + 2] = i10 * c00 + i11 * c10; Cp[k + 3] = i10 * c01 + i11 * c11;
    }
    dp[k2] = i00 * r0 + i01 * r1;
    dp[k2 + 1] = i10 * r0 + i11 * r1;
  }
  u[2 * (n - 1)] = dp[2 * (n - 1)];
  u[2 * (n - 1) + 1] = dp[2 * (n - 1) + 1];
  for (let i = n - 2; i >= 0; i--) {
    const k = 4 * i, k2 = 2 * i;
    const u0 = u[k2 + 2], u1 = u[k2 + 3];
    u[k2] = dp[k2] - (Cp[k] * u0 + Cp[k + 1] * u1);
    u[k2 + 1] = dp[k2 + 1] - (Cp[k + 2] * u0 + Cp[k + 3] * u1);
  }
  return u;
}

/** Kısmi pivotlu yoğun LU; M satır-öncelikli n×n, yerinde. piv: satır permütasyonu. */
export function luFactor(M: Float64Array, n: number, piv: Int32Array = new Int32Array(n)): Int32Array {
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(M[i * n + k]); if (v > best) { best = v; p = i; } }
    if (best === 0) throw new SingularMatrixError('luFactor: tekil matris');
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = M[k * n + j]; M[k * n + j] = M[p * n + j]; M[p * n + j] = t; }
      const t = piv[k]; piv[k] = piv[p]; piv[p] = t;
    }
    const inv = 1 / M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const l = (M[i * n + k] *= inv);
      if (l === 0) continue;
      for (let j = k + 1; j < n; j++) M[i * n + j] -= l * M[k * n + j];
    }
  }
  return piv;
}

/** luFactor çıktısıyla M x = b çöz (x ve b aynı dizi olabilir değil — x ayrı). */
export function luSolve(LU: Float64Array, n: number, piv: Int32Array, b: ArrayLike<number>, x: Float64Array = new Float64Array(n)): Float64Array {
  for (let i = 0; i < n; i++) x[i] = b[piv[i]];
  for (let i = 1; i < n; i++) { let s = x[i]; for (let j = 0; j < i; j++) s -= LU[i * n + j] * x[j]; x[i] = s; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < n; j++) s -= LU[i * n + j] * x[j]; x[i] = s / LU[i * n + i]; }
  return x;
}

/** Kolaylık: yoğun sistemi kopyalayarak çöz. */
export function solveDense(M: ArrayLike<number>, b: ArrayLike<number>, n: number): Float64Array {
  const A = Float64Array.from(M as ArrayLike<number>);
  const piv = luFactor(A, n);
  return luSolve(A, n, piv, b);
}

/**
 * Bantlı matris (alt bant ml, üst bant mu), pivotsuz Doolittle LU.
 * Yalnızca köşegen baskın / M-matris operatörler için (GS Shortley–Weller operatörü böyledir).
 * Depolama: satır r, sütun c → band[r·w + (c − r + ml)],  w = ml + mu + 1.
 *
 * Envelope (profile) skipping: without pivoting, fill-in stays inside the envelope of the
 * matrix — L[i][k] ≠ 0 only if k ≥ fc(i) (first nonzero column of row i) and U[k][j] ≠ 0 only
 * if k ≥ fr(j) (first nonzero row of column j) (George & Liu, "Computer Solution of Large Sparse
 * Positive Definite Systems", Prentice-Hall 1981, §4.2). factor() and solve() therefore skip the
 * structurally zero parts of the band; the arithmetic that remains is identical, so results are
 * bitwise unchanged while rows whose envelope is narrower than the band run proportionally faster.
 */
export class BandedLU {
  readonly w: number;
  readonly band: Float64Array;
  private factored = false;
  /** row r: first column with a nonzero entry of L (≥ r − ml) */
  private fc: Int32Array | null = null;
  /** row k: last column that can hold a nonzero entry of U (≤ k + mu) */
  private ue: Int32Array | null = null;
  /** column k: last row that can hold a nonzero entry of L (≤ k + ml) */
  private le: Int32Array | null = null;
  constructor(readonly n: number, readonly ml: number, readonly mu: number) {
    this.w = ml + mu + 1;
    this.band = new Float64Array(n * this.w);
  }
  /** Bytes held by the band storage (for cache budgeting). */
  get bytes(): number { return this.band.byteLength; }
  set(r: number, c: number, v: number): void {
    const off = c - r + this.ml;
    if (off < 0 || off >= this.w) throw new Error(`BandedLU.set: (${r},${c}) bant dışında`);
    this.band[r * this.w + off] = v;
  }
  add(r: number, c: number, v: number): void {
    const off = c - r + this.ml;
    if (off < 0 || off >= this.w) throw new Error(`BandedLU.add: (${r},${c}) bant dışında`);
    this.band[r * this.w + off] += v;
  }
  get(r: number, c: number): number {
    const off = c - r + this.ml;
    return off < 0 || off >= this.w ? 0 : this.band[r * this.w + off];
  }
  /** y = A x (faktörizasyondan ÖNCE çağrılmalı; test/artık hesabı için) */
  mul(x: ArrayLike<number>, y: Float64Array): Float64Array {
    const { n, ml, mu, w, band } = this;
    for (let r = 0; r < n; r++) {
      let s = 0;
      const c0 = Math.max(0, r - ml), c1 = Math.min(n - 1, r + mu);
      for (let c = c0; c <= c1; c++) s += band[r * w + (c - r + ml)] * x[c];
      y[r] = s;
    }
    return y;
  }
  /** Envelope of the (unfactored) matrix: fc, le (L part) and ue (U part), see class comment. */
  private envelope(): void {
    const { n, ml, mu, w, band } = this;
    const fc = new Int32Array(n), fr = new Int32Array(n).fill(n);
    for (let r = 0; r < n; r++) {
      const c0 = Math.max(0, r - ml), c1 = Math.min(n - 1, r + mu);
      let first = r;
      for (let c = c0; c <= c1; c++) {
        if (band[r * w + (c - r + ml)] === 0) continue;
        if (c < first) first = c;
        if (r < fr[c]) fr[c] = r;
      }
      fc[r] = first;
      if (r < fr[r]) fr[r] = r;
    }
    // ue[k] = max{ j : fr(j) ≤ k },  le[k] = max{ i : fc(i) ≤ k }  (running maxima → nondecreasing)
    const ue = new Int32Array(n), le = new Int32Array(n);
    const byFr = new Int32Array(n).fill(-1), byFc = new Int32Array(n).fill(-1);
    for (let j = 0; j < n; j++) { if (j > byFr[fr[j]]) byFr[fr[j]] = j; if (j > byFc[fc[j]]) byFc[fc[j]] = j; }
    let mU = -1, mL = -1;
    for (let k = 0; k < n; k++) {
      mU = Math.max(mU, byFr[k], k); mL = Math.max(mL, byFc[k], k);
      ue[k] = Math.min(mU, k + mu, n - 1); le[k] = Math.min(mL, k + ml, n - 1);
    }
    this.fc = fc; this.ue = ue; this.le = le;
  }
  factor(): void {
    this.envelope();
    const { n, ml, w, band } = this;
    const ue = this.ue!, le = this.le!;
    for (let k = 0; k < n; k++) {
      const pk = band[k * w + ml];
      if (pk === 0 || !isFinite(pk)) throw new SingularMatrixError(`BandedLU: sıfır pivot (satır ${k})`);
      const iMax = le[k], jMax = ue[k];
      for (let i = k + 1; i <= iMax; i++) {
        const idx = i * w + (k - i + ml);
        const l = band[idx];
        if (l === 0) continue;
        const f = l / pk;
        band[idx] = f;
        const rowI = i * w - i + ml, rowK = k * w - k + ml;
        for (let j = k + 1; j <= jMax; j++) band[rowI + j] -= f * band[rowK + j];
      }
    }
    this.factored = true;
  }
  /** A x = b (factor() sonrası). x ile b aynı dizi olabilir. */
  solve(b: ArrayLike<number>, x: Float64Array = new Float64Array(this.n)): Float64Array {
    if (!this.factored) throw new Error('BandedLU.solve: önce factor()');
    const { n, ml, w, band } = this;
    const fc = this.fc!, ue = this.ue!;
    if (x !== b) for (let i = 0; i < n; i++) x[i] = b[i];
    for (let i = 1; i < n; i++) {
      let s = x[i];
      const j0 = fc[i], row = i * w - i + ml;
      for (let j = j0; j < i; j++) s -= band[row + j] * x[j];
      x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i];
      const j1 = ue[i], row = i * w - i + ml;
      for (let j = i + 1; j <= j1; j++) s -= band[row + j] * x[j];
      x[i] = s / band[row + i];
    }
    return x;
  }
}
