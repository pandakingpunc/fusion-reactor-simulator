/**
 * Samplers of the unit hypercube [0, 1)^d, all reproducible from a seed (the project's mulberry32 RNG):
 *
 *  - 'mc':    plain Monte Carlo, independent uniform draws;
 *  - 'lhs':   Latin hypercube (M. D. McKay, R. J. Beckman & W. J. Conover, Technometrics 21 (1979) 239): every
 *             coordinate has exactly one point in each of the n equal strata, in an independent random order;
 *  - 'sobol': scrambled Sobol' low-discrepancy points (Joe & Kuo direction numbers, linear matrix scrambling plus a
 *             digital shift, see sobol.ts). The best choice for smooth outputs; use a power of two for n.
 *
 * The stream of a column depends on (seed, column) only, never on the number of columns, so adding a parameter to a
 * study leaves the samples of the others unchanged (for 'sobol' see the note in sobol.ts).
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { RNG } from '../physics/rng';
import { SOBOL_MAX_DIM, SobolScramble, sobolPoints } from './sobol';

export type SamplerKind = 'sobol' | 'lhs' | 'mc';
export const SAMPLER_KINDS: readonly SamplerKind[] = ['sobol', 'lhs', 'mc'];

export interface UnitSampleOptions {
  /** seed of the design (default 1) */
  seed?: number;
  /** 'sobol' only: the scrambling (default 'lms'); 'none' gives the classical sequence, whose first point is the origin */
  scramble?: SobolScramble;
  /** 'sobol' only: index of the first point (default 0) */
  skip?: number;
  /** 'lhs' only: put each point at the centre of its stratum instead of at a random position inside it */
  centered?: boolean;
}

/**
 * A 32-bit seed for stream `stream` of `seed` (the finalizer of MurmurHash3 applied to the pair). Used to give every
 * column, bootstrap or run of a study its own independent, reproducible RNG.
 */
export function mixSeed(seed: number, stream: number): number {
  let h = (seed >>> 0) ^ Math.imul((stream >>> 0) + 1, 0x9e3779b1);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** n x dim points, row-major (point i = elements i*dim ... i*dim + dim - 1), all in [0, 1). */
export function unitSample(kind: SamplerKind, n: number, dim: number, opts: UnitSampleOptions = {}): Float64Array {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`sample size must be a positive integer, got ${n}`);
  if (!Number.isInteger(dim) || dim < 1) throw new RangeError(`dimension must be a positive integer, got ${dim}`);
  const seed = opts.seed ?? 1;
  const out = new Float64Array(n * dim);
  switch (kind) {
    case 'sobol': {
      if (dim > SOBOL_MAX_DIM) throw new RangeError(`the Sobol' sampler supports at most ${SOBOL_MAX_DIM} dimensions, got ${dim}`);
      return sobolPoints(n, { dim, scramble: opts.scramble ?? 'lms', seed, skip: opts.skip });
    }
    case 'mc':
      for (let j = 0; j < dim; j++) {
        const rng = new RNG(mixSeed(seed, j));
        for (let i = 0; i < n; i++) out[i * dim + j] = rng.next();
      }
      return out;
    case 'lhs':
      for (let j = 0; j < dim; j++) {
        const rng = new RNG(mixSeed(seed, j));
        const perm = new Uint32Array(n);
        for (let i = 0; i < n; i++) perm[i] = i;
        for (let i = n - 1; i > 0; i--) { // Fisher-Yates
          const k = Math.floor(rng.next() * (i + 1));
          const t = perm[i]; perm[i] = perm[k]; perm[k] = t;
        }
        for (let i = 0; i < n; i++) out[i * dim + j] = (perm[i] + (opts.centered ? 0.5 : rng.next())) / n;
      }
      return out;
    default:
      throw new RangeError(`unknown sampler '${String(kind)}' (${SAMPLER_KINDS.join(', ')})`);
  }
}
