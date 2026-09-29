import { describe, expect, it } from 'vitest';
import { SAMPLER_KINDS, mixSeed, unitSample } from './samplers';
import { SOBOL_MAX_DIM } from './sobol';
import { pearson } from './stats';

const col = (P: Float64Array, dim: number, j: number): number[] => Array.from({ length: P.length / dim }, (_, i) => P[i * dim + j]);

/** Kolmogorov-Smirnov distance of a sample from the uniform law on [0, 1] */
function ksUniform(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  let d = 0;
  s.forEach((v, i) => { d = Math.max(d, Math.abs((i + 1) / s.length - v), Math.abs(v - i / s.length)); });
  return d;
}

describe('unit-cube samplers', () => {
  it('produce n x dim points in [0, 1), reproducibly for a seed and differently for another', () => {
    for (const kind of SAMPLER_KINDS) {
      const P = unitSample(kind, 64, 5, { seed: 11 });
      expect(P).toHaveLength(64 * 5);
      for (const v of P) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
      expect(Array.from(unitSample(kind, 64, 5, { seed: 11 })), kind).toEqual(Array.from(P));
      expect(Array.from(unitSample(kind, 64, 5, { seed: 12 })), kind).not.toEqual(Array.from(P));
    }
  });

  it('a column does not depend on the number of columns (mc, lhs and sobol)', () => {
    for (const kind of SAMPLER_KINDS) {
      const a = unitSample(kind, 32, 3, { seed: 9 });
      const b = unitSample(kind, 32, 7, { seed: 9 });
      for (let j = 0; j < 3; j++) expect(col(a, 3, j), `${kind} column ${j}`).toEqual(col(b, 7, j));
    }
  });

  it('Latin hypercube: exactly one point per stratum in every coordinate; centred variant sits on the stratum centres', () => {
    const n = 50, dim = 4;
    const P = unitSample('lhs', n, dim, { seed: 3 });
    for (let j = 0; j < dim; j++) {
      const strata = col(P, dim, j).map((v) => Math.floor(v * n)).sort((a, b) => a - b);
      expect(strata).toEqual(Array.from({ length: n }, (_, i) => i));
    }
    // the coordinates are permuted independently: no two columns are the same ordering
    expect(col(P, dim, 0)).not.toEqual(col(P, dim, 1));
    const C = unitSample('lhs', 10, 2, { seed: 3, centered: true });
    expect(col(C, 2, 0).map((v) => Math.round(v * 20)).sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
  });

  it('Monte Carlo columns are uniform and uncorrelated', () => {
    const n = 4000;
    const P = unitSample('mc', n, 3, { seed: 21 });
    for (let j = 0; j < 3; j++) expect(ksUniform(col(P, 3, j))).toBeLessThan(0.03);
    expect(Math.abs(pearson(col(P, 3, 0), col(P, 3, 1)))).toBeLessThan(0.05);
    expect(Math.abs(pearson(col(P, 3, 1), col(P, 3, 2)))).toBeLessThan(0.05);
  });

  it('scrambled Sobol columns are far more uniform than Monte Carlo ones (KS distance)', () => {
    const n = 1024;
    const S = unitSample('sobol', n, 6, { seed: 4 });
    const M = unitSample('mc', n, 6, { seed: 4 });
    const L = unitSample('lhs', n, 6, { seed: 4 });
    for (let j = 0; j < 6; j++) {
      expect(ksUniform(col(S, 6, j)), `sobol ${j}`).toBeLessThan(2 / n);
      expect(ksUniform(col(L, 6, j)), `lhs ${j}`).toBeLessThan(1 / n + 1e-12);
    }
    expect(Math.max(...[0, 1, 2, 3, 4, 5].map((j) => ksUniform(col(M, 6, j))))).toBeGreaterThan(0.01);
  });

  it('sobol options: scramble none gives the classical sequence, skip drops leading points', () => {
    const plain = unitSample('sobol', 4, 2, { scramble: 'none' });
    expect(Array.from(plain)).toEqual([0, 0, 0.5, 0.5, 0.75, 0.25, 0.25, 0.75]);
    const skipped = unitSample('sobol', 2, 2, { scramble: 'none', skip: 2 });
    expect(Array.from(skipped)).toEqual([0.75, 0.25, 0.25, 0.75]);
  });

  it('rejects invalid sizes, too many Sobol dimensions and unknown samplers', () => {
    expect(() => unitSample('mc', 0, 2)).toThrow(/positive integer/);
    expect(() => unitSample('mc', 2.5, 2)).toThrow(/positive integer/);
    expect(() => unitSample('mc', 2, 0)).toThrow(/positive integer/);
    expect(() => unitSample('sobol', 2, SOBOL_MAX_DIM + 1)).toThrow(/at most 256 dimensions/);
    expect(() => unitSample('halton' as never, 2, 2)).toThrow(/unknown sampler 'halton'/);
  });

  it('mixSeed gives distinct, well-spread 32-bit seeds', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 20; s++) for (let k = 0; k < 20; k++) seen.add(mixSeed(s, k));
    expect(seen.size).toBe(400);
    for (const v of seen) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(2 ** 32); }
    expect(mixSeed(1, 2)).toBe(mixSeed(1, 2));
  });
});
