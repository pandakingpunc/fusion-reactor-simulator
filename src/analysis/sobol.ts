/**
 * Sobol' low-discrepancy sequence (base 2, 32 digits) with the Joe & Kuo direction numbers and optional random
 * scrambling.
 *
 * Direction numbers. Dimension 1 is the van der Corput sequence (v_k = 2^-k). Dimensions 2 ... SOBOL_MAX_DIM take the
 * primitive polynomial x^s + a_1 x^(s-1) + ... + a_(s-1) x + 1 and the initial numbers m_1 ... m_s of the table in
 * sobolDirections.ts (S. Joe and F. Y. Kuo, SIAM J. Sci. Comput. 30 (2008) 2635-2654, "new-joe-kuo-6.21201"), and
 * extend them with the recurrence of P. Bratley and B. L. Fox, ACM Trans. Math. Softw. 14 (1988) 88-100 (Algorithm
 * 659, as in Joe & Kuo, ACM Trans. Math. Softw. 29 (2003) 49-57):
 *   m_i = 2 a_1 m_(i-1) xor 2^2 a_2 m_(i-2) xor ... xor 2^(s-1) a_(s-1) m_(i-s+1) xor 2^s m_(i-s) xor m_(i-s)
 * held as 32-bit integers v_i = m_i 2^(32-i), i.e. v_i = v_(i-s) xor (v_(i-s) >> s) xor (a_k v_(i-k) for k = 1 ... s-1).
 * Points are generated in Gray-code order (I. M. Sobol' 1967; Antonov & Saleev 1979): x_n = x_(n-1) xor v_c with c the
 * position of the lowest zero bit of n-1, so a point costs one xor per dimension. The first 2^m points of every
 * dimension are one point per interval [j 2^-m, (j+1) 2^-m) (a (0, m, 1)-net), and those of the leading dimensions
 * are (t, m, 2)-nets in every pair of coordinates with small t.
 *
 * Scrambling (random, seeded with the project RNG; it keeps the net structure, so the convergence rate of a
 * quasi-Monte Carlo estimate is kept while the points become random and unbiased):
 *  - 'shift': a random digital shift, x xor s per dimension (Cranley & Patterson's rotation for digits);
 *  - 'lms': J. Matousek, "On the L2-discrepancy for anchored boxes", J. Complexity 14 (1998) 527-556, linear matrix
 *    scrambling (the digits of the point are multiplied by a random lower-triangular binary matrix with a unit
 *    diagonal) followed by the digital shift. The recommended choice.
 * The random draws of dimension j do not depend on the total number of dimensions, so the first d columns of a
 * D-dimensional scrambled sequence are the d-dimensional scrambled sequence of the same seed.
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../physics/rng';
import { JOE_KUO_DIRECTIONS, SOBOL_MAX_DIM } from './sobolDirections';

export { SOBOL_MAX_DIM };

const BITS = 32;
const TWO32 = 4294967296;
/** the sequence has 2^32 points */
export const SOBOL_MAX_POINTS = TWO32;

export type SobolScramble = 'none' | 'shift' | 'lms';

export interface SobolOptions {
  /** number of dimensions, 1 ... SOBOL_MAX_DIM */
  dim: number;
  /** default 'none' (the classical sequence, whose first point is the origin) */
  scramble?: SobolScramble;
  /** seed of the scrambling (default 1); ignored for 'none' */
  seed?: number;
  /** number of leading points to leave out (default 0); the index of the first point returned */
  skip?: number;
}

/**
 * The 32 direction numbers v_1 ... v_32 of a dimension (0-based), as unsigned 32-bit integers: entry k-1 is v_k.
 * Dimension 0 is the van der Corput sequence.
 */
export function directionNumbers(dim: number): Uint32Array {
  if (!Number.isInteger(dim) || dim < 0 || dim >= SOBOL_MAX_DIM) {
    throw new RangeError(`Sobol dimension must be an integer in [0, ${SOBOL_MAX_DIM - 1}], got ${dim}`);
  }
  const v = new Uint32Array(BITS);
  if (dim === 0) {
    for (let k = 1; k <= BITS; k++) v[k - 1] = 2 ** (BITS - k);
    return v;
  }
  const [s, a, m] = JOE_KUO_DIRECTIONS[dim - 1];
  for (let i = 1; i <= BITS; i++) {
    if (i <= s) {
      v[i - 1] = m[i - 1] * 2 ** (BITS - i);
    } else {
      let x = v[i - s - 1] ^ (v[i - s - 1] >>> s);
      for (let k = 1; k <= s - 1; k++) if ((a >>> (s - 1 - k)) & 1) x ^= v[i - k - 1];
      v[i - 1] = x >>> 0;
    }
  }
  return v;
}

/** parity (xor of all bits) of a 32-bit integer */
function parity32(x: number): number {
  x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1;
  return x & 1;
}

/**
 * Random lower-triangular scrambling matrix of the 32 digits, as one mask per digit: digit r (1 = most significant)
 * of the result is the parity of (the digits of the input, masked with rowMask[r-1]); the mask holds the digit r
 * itself (unit diagonal) and random digits c < r (more significant ones).
 */
function lmsMasks(rng: RNG): Uint32Array {
  const masks = new Uint32Array(BITS);
  for (let r = 1; r <= BITS; r++) {
    const b = BITS - r; // bit position of digit r
    const higher = b === BITS - 1 ? 0 : (0xffffffff << (b + 1)) >>> 0; // bit positions above b
    const rand = (rng.next() * TWO32) >>> 0;
    masks[r - 1] = (((1 << b) >>> 0) | (rand & higher)) >>> 0;
  }
  return masks;
}

function applyMasks(masks: Uint32Array, x: number): number {
  let out = 0;
  for (let r = 1; r <= BITS; r++) if (parity32(masks[r - 1] & x)) out |= (1 << (BITS - r)) >>> 0;
  return out >>> 0;
}

/** Sobol' sequence generator; next() returns the points in order, seek() jumps to an index. */
export class Sobol {
  readonly dim: number;
  private readonly v: Uint32Array[];
  private readonly shift: Uint32Array;
  private readonly x: Uint32Array;
  private n = 0;

  constructor(opts: SobolOptions) {
    const { dim } = opts;
    if (!Number.isInteger(dim) || dim < 1 || dim > SOBOL_MAX_DIM) {
      throw new RangeError(`Sobol dim must be an integer in [1, ${SOBOL_MAX_DIM}], got ${dim}`);
    }
    const scramble = opts.scramble ?? 'none';
    this.dim = dim;
    this.v = [];
    this.shift = new Uint32Array(dim);
    this.x = new Uint32Array(dim);
    const rng = new RNG(opts.seed ?? 1);
    for (let j = 0; j < dim; j++) {
      let vj = directionNumbers(j);
      if (scramble === 'lms') {
        const masks = lmsMasks(rng);
        vj = vj.map((w) => applyMasks(masks, w));
      }
      if (scramble !== 'none') this.shift[j] = (rng.next() * TWO32) >>> 0;
      this.v.push(vj);
    }
    const skip = opts.skip ?? 0;
    if (skip !== 0) this.seek(skip);
  }

  /** index of the point next() returns */
  get index(): number {
    return this.n;
  }

  /** Positions the generator so that next() returns point `index` (0-based). */
  seek(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > TWO32) {
      throw new RangeError(`Sobol index must be an integer in [0, 2^32], got ${index}`);
    }
    const gray = (index ^ Math.floor(index / 2)) >>> 0;
    for (let j = 0; j < this.dim; j++) {
      let x = 0;
      for (let b = 0; b < BITS; b++) if ((gray >>> b) & 1) x ^= this.v[j][b];
      this.x[j] = x >>> 0;
    }
    this.n = index;
  }

  /** Writes the next point (dim values in [0, 1)) to out[offset ...] and advances. */
  next(out: Float64Array, offset = 0): void {
    if (this.n >= TWO32) throw new RangeError('Sobol sequence exhausted (2^32 points)');
    for (let j = 0; j < this.dim; j++) out[offset + j] = ((this.x[j] ^ this.shift[j]) >>> 0) / TWO32;
    // Gray-code step to the following point: flip the direction number of the lowest zero bit of n
    let c = 0;
    let m = this.n;
    while (m % 2 === 1) { m = Math.floor(m / 2); c++; }
    if (c < BITS) for (let j = 0; j < this.dim; j++) this.x[j] ^= this.v[j][c];
    this.n++;
  }
}

/** n points of a dim-dimensional Sobol' sequence as a row-major n x dim array (point i = row i). */
export function sobolPoints(n: number, opts: SobolOptions): Float64Array {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`sobolPoints: n must be a non-negative integer, got ${n}`);
  const g = new Sobol(opts);
  const out = new Float64Array(n * opts.dim);
  for (let i = 0; i < n; i++) g.next(out, i * opts.dim);
  return out;
}
