import { describe, expect, it } from 'vitest';
import { Sobol, SOBOL_MAX_DIM, directionNumbers, sobolPoints } from './sobol';
import { JOE_KUO_DIRECTIONS } from './sobolDirections';

/** number of points of the first 2^m that fall in each interval [j 2^-m, (j+1) 2^-m) of coordinate `col` */
function stratification(P: Float64Array, dim: number, col: number, m: number): number[] {
  const n = 2 ** m;
  const cnt = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) cnt[Math.floor(P[i * dim + col] * n)]++;
  return cnt;
}

/** smallest t such that the first 2^m points of coordinates (c1, c2) form a (t, m, 2)-net in base 2 */
function netT(P: Float64Array, dim: number, c1: number, c2: number, m: number): number {
  const n = 2 ** m;
  for (let t = 0; t <= m; t++) {
    let ok = true;
    for (let a = 0; a <= m - t && ok; a++) {
      const b = m - t - a;
      const cnt = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const key = Math.floor(P[i * dim + c1] * 2 ** a) * 2 ** b + Math.floor(P[i * dim + c2] * 2 ** b);
        cnt.set(key, (cnt.get(key) ?? 0) + 1);
      }
      // 2^(a+b) boxes of volume 2^-(m-t): each holds exactly 2^t points
      if (cnt.size !== 2 ** (a + b)) { ok = false; break; }
      for (const c of cnt.values()) if (c !== 2 ** t) { ok = false; break; }
    }
    if (ok) return t;
  }
  return m;
}

/** order of x modulo the polynomial x^s + a_1 x^(s-1) + ... + a_(s-1) x + 1 over GF(2) is 2^s - 1 (the polynomial is primitive) */
function isPrimitive(s: number, a: number): boolean {
  let p = (1 << s) | 1; // x^s + 1
  for (let k = 1; k <= s - 1; k++) if ((a >>> (s - 1 - k)) & 1) p |= 1 << (s - k);
  const mulmod = (u: number, v: number): number => {
    let r = 0;
    for (let i = 0; i < s; i++) if ((v >>> i) & 1) r ^= u << i;
    for (let d = 2 * s - 2; d >= s; d--) if ((r >>> d) & 1) r ^= p << (d - s);
    return r;
  };
  const powx = (e: number): number => {
    let r = 1, base = s === 1 ? 1 : 2; // x mod p (for s = 1: x = 1 mod x + 1)
    for (let k = e; k > 0; k = Math.floor(k / 2)) { if (k % 2 === 1) r = mulmod(r, base); base = mulmod(base, base); }
    return r;
  };
  const order = 2 ** s - 1;
  if (powx(order) !== 1) return false;
  for (let q = 2; q <= order; q++) {
    if (order % q === 0 && [...Array(q).keys()].slice(2).every((d) => q % d !== 0)) if (powx(order / q) === 1) return false;
  }
  return true;
}

describe('Sobol direction numbers', () => {
  it('the table is Joe & Kuo new-joe-kuo-6.21201: size and leading rows', () => {
    expect(SOBOL_MAX_DIM).toBe(256);
    expect(JOE_KUO_DIRECTIONS).toHaveLength(SOBOL_MAX_DIM - 1);
    expect(JOE_KUO_DIRECTIONS[0]).toEqual([1, 0, [1]]);
    expect(JOE_KUO_DIRECTIONS[1]).toEqual([2, 1, [1, 3]]);
    expect(JOE_KUO_DIRECTIONS[2]).toEqual([3, 1, [1, 3, 1]]);
    expect(JOE_KUO_DIRECTIONS[JOE_KUO_DIRECTIONS.length - 1]).toEqual([11, 560, [1, 1, 1, 5, 19, 3, 53, 133, 97, 863, 983]]);
  });

  it('every row has s initial numbers that are odd and below 2^i, and a valid primitive polynomial', () => {
    JOE_KUO_DIRECTIONS.forEach(([s, a, m], row) => {
      expect(m, `row d = ${row + 2}`).toHaveLength(s);
      m.forEach((mi, i) => {
        expect(mi % 2, `d = ${row + 2}, m_${i + 1}`).toBe(1);
        expect(mi, `d = ${row + 2}, m_${i + 1}`).toBeLessThan(2 ** (i + 1));
      });
      expect(a).toBeLessThan(2 ** (s - 1));
      expect(isPrimitive(s, a), `d = ${row + 2}: x^${s} + ... is primitive`).toBe(true);
    });
  });

  it('dimension 1 is the van der Corput sequence, the direction numbers are v_k = m_k 2^(32-k)', () => {
    const v = directionNumbers(0);
    expect([v[0], v[1], v[31]]).toEqual([2 ** 31, 2 ** 30, 1]);
    const v2 = directionNumbers(2); // d = 3: s = 2, a = 1, m = (1, 3), then v_3 = v_1 xor (v_1 >> 2) xor v_2
    expect(v2[0]).toBe(2 ** 31);
    expect(v2[1]).toBe(3 * 2 ** 30);
    expect(v2[2]).toBe(((2 ** 31 ^ (2 ** 31 >>> 2)) ^ (3 * 2 ** 30)) >>> 0);
    expect(() => directionNumbers(-1)).toThrow(RangeError);
    expect(() => directionNumbers(SOBOL_MAX_DIM)).toThrow(RangeError);
  });
});

describe('Sobol sequence', () => {
  it('reproduces the first points of the classical Joe-Kuo sequence (dimensions 1 and 2)', () => {
    const P = sobolPoints(8, { dim: 3 });
    const col = (j: number) => Array.from({ length: 8 }, (_, i) => P[i * 3 + j]);
    expect(col(0)).toEqual([0, 0.5, 0.75, 0.25, 0.375, 0.875, 0.625, 0.125]);
    expect(col(1)).toEqual([0, 0.5, 0.25, 0.75, 0.375, 0.875, 0.125, 0.625]);
    // third dimension (s = 2, a = 1, m = (1, 3): v_1 = .1, v_2 = .11, v_3 = .011 in binary), worked out by hand from the
    // Gray-code recurrence x_n = x_(n-1) xor v_c: 0, .1, .01, .11, .101, .001, .111, .011
    expect(col(2)).toEqual([0, 0.5, 0.25, 0.75, 0.625, 0.125, 0.875, 0.375]);
  });

  it('the first 2^m points of every dimension have exactly one point per interval of length 2^-m (all 256 dimensions)', () => {
    const P = sobolPoints(1024, { dim: SOBOL_MAX_DIM });
    for (let j = 0; j < SOBOL_MAX_DIM; j++) {
      for (const m of [3, 6, 10]) {
        expect(stratification(P, SOBOL_MAX_DIM, j, m).every((c) => c === 1), `dim ${j + 1}, m = ${m}`).toBe(true);
      }
    }
  });

  it('two-dimensional projections of the leading dimensions are good nets', () => {
    const dim = 12;
    const P = sobolPoints(256, { dim });
    // the first two dimensions form a (0, m, 2)-net; the Joe-Kuo dimensions keep t small in every pair
    expect(netT(P, dim, 0, 1, 8)).toBe(0);
    let worst = 0;
    for (let i = 0; i < dim; i++) for (let j = i + 1; j < dim; j++) worst = Math.max(worst, netT(P, dim, i, j, 8));
    expect(worst).toBeLessThanOrEqual(4);
  });

  it('seek(k) and skip give the k-th point of the sequence; the generator continues in order', () => {
    const dim = 5;
    const all = sobolPoints(64, { dim });
    const g = new Sobol({ dim });
    g.seek(37);
    expect(g.index).toBe(37);
    const out = new Float64Array(dim);
    for (let i = 37; i < 64; i++) {
      g.next(out);
      expect(Array.from(out)).toEqual(Array.from(all.subarray(i * dim, (i + 1) * dim)));
    }
    const skipped = sobolPoints(10, { dim, skip: 20 });
    expect(Array.from(skipped)).toEqual(Array.from(all.subarray(20 * dim, 30 * dim)));
    // an index that is a power of two changes many Gray-code bits at once
    const h = new Sobol({ dim, skip: 32 });
    h.next(out);
    expect(Array.from(out)).toEqual(Array.from(sobolPoints(33, { dim }).subarray(32 * dim, 33 * dim)));
    expect(() => g.seek(-1)).toThrow(RangeError);
    expect(() => g.seek(1.5)).toThrow(RangeError);
    expect(() => new Sobol({ dim: 0 })).toThrow(RangeError);
    expect(() => new Sobol({ dim: SOBOL_MAX_DIM + 1 })).toThrow(RangeError);
    expect(() => sobolPoints(-1, { dim: 2 })).toThrow(RangeError);
  });

  it('stops after 2^32 points', () => {
    const g = new Sobol({ dim: 2, skip: 2 ** 32 - 1 });
    const out = new Float64Array(2);
    g.next(out); // the last one
    expect(() => g.next(out)).toThrow(/exhausted/);
  });

  it('scrambled sequences (shift, lms) are random, reproducible per seed, in [0, 1), and keep the net property', () => {
    const dim = 8;
    for (const scramble of ['shift', 'lms'] as const) {
      const P = sobolPoints(1024, { dim, scramble, seed: 7 });
      const Q = sobolPoints(1024, { dim, scramble, seed: 7 });
      const R = sobolPoints(1024, { dim, scramble, seed: 8 });
      expect(Array.from(Q)).toEqual(Array.from(P));
      expect(Array.from(R)).not.toEqual(Array.from(P));
      expect(Array.from(sobolPoints(16, { dim })), scramble).not.toEqual(Array.from(sobolPoints(16, { dim, scramble, seed: 7 })));
      for (const v of P) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
      for (let j = 0; j < dim; j++) {
        for (const m of [4, 10]) expect(stratification(P, dim, j, m).every((c) => c === 1), `${scramble}, dim ${j + 1}, m = ${m}`).toBe(true);
      }
      // the point set of 2^m points in two coordinates stays a net (linear scrambling keeps t; a shift keeps it as well)
      expect(netT(P, dim, 0, 1, 8), scramble).toBe(0);
    }
  });

  it('the scrambling of a dimension does not depend on how many dimensions are generated', () => {
    for (const scramble of ['shift', 'lms'] as const) {
      const a = sobolPoints(32, { dim: 3, scramble, seed: 5 });
      const b = sobolPoints(32, { dim: 9, scramble, seed: 5 });
      for (let i = 0; i < 32; i++) for (let j = 0; j < 3; j++) expect(a[i * 3 + j]).toBe(b[i * 9 + j]);
    }
  });

  it('quasi-Monte Carlo integration converges far faster than 1/sqrt(N)', () => {
    // integral of prod x_i over the unit 5-cube is 2^-5
    const dim = 5, N = 4096, exact = 1 / 32;
    const P = sobolPoints(N, { dim, scramble: 'lms', seed: 3 });
    let s = 0;
    for (let i = 0; i < N; i++) { let p = 1; for (let j = 0; j < dim; j++) p *= P[i * dim + j]; s += p; }
    const err = Math.abs(s / N - exact);
    // plain Monte Carlo: standard error sqrt((3^-5 - 4^-5)/N) = 7.4e-4
    expect(err).toBeLessThan(1.5e-4);
  });
});
