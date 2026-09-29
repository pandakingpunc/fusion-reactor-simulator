import { describe, expect, it } from 'vitest';
import { SamplerKind } from './samplers';
import { mapUnitToParams, saltelliDesign, saltelliRuns, sobolIndices, sobolIndicesOfFunction } from './sensitivity';
import type { DistSpec } from './distributions';

/*
 * Ishigami function f = sin x1 + a sin^2 x2 + b x3^4 sin x1 with x_i ~ U(-pi, pi), a = 7, b = 0.1
 * (T. Ishigami & T. Homma, Proc. ISUMA'90 (1990) 398; T. Homma & A. Saltelli, Reliab. Eng. Syst. Saf. 52 (1996) 1).
 * Analytic partial variances (Homma & Saltelli 1996, appendix):
 *   V  = a^2/8 + b pi^4/5 + b^2 pi^8/18 + 1/2
 *   V1 = b pi^4/5 + b^2 pi^8/50 + 1/2,  V2 = a^2/8,  V3 = 0,  V13 = 8 b^2 pi^8/225
 * so S1 = V1/V = 0.3139, S2 = V2/V = 0.4424, S3 = 0, ST1 = (V1 + V13)/V = 0.5576, ST2 = S2, ST3 = V13/V = 0.2437.
 */
const A = 7, B = 0.1;
const ishigami = (x: Float64Array) => Math.sin(x[0]) + A * Math.sin(x[1]) ** 2 + B * x[2] ** 4 * Math.sin(x[0]);
const UNI: DistSpec = { type: 'uniform', lo: -Math.PI, hi: Math.PI };
const V = (A * A) / 8 + (B * Math.PI ** 4) / 5 + (B * B * Math.PI ** 8) / 18 + 0.5;
const V1 = (B * Math.PI ** 4) / 5 + (B * B * Math.PI ** 8) / 50 + 0.5;
const V2 = (A * A) / 8;
const V13 = (8 * B * B * Math.PI ** 8) / 225;
const S_TRUE = [V1 / V, V2 / V, 0];
const ST_TRUE = [(V1 + V13) / V, V2 / V, V13 / V];

describe('Saltelli design', () => {
  it('has (d + 2) n rows in the order A, B, AB_1 ... AB_d, each AB_i equal to A but for column i (taken from B)', () => {
    const n = 16, d = 3;
    const { U } = saltelliDesign(n, d, 'sobol', 5);
    expect(U).toHaveLength(saltelliRuns(n, d) * d);
    expect(saltelliRuns(n, d)).toBe(80);
    const at = (block: number, j: number, c: number) => U[((block * n) + j) * d + c];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < d; i++) {
        for (let c = 0; c < d; c++) expect(at(2 + i, j, c)).toBe(c === i ? at(1, j, c) : at(0, j, c));
      }
    }
    // A and B are different points
    expect(at(0, 3, 0)).not.toBe(at(1, 3, 0));
  });

  it('A and B are the two halves of one 2d-dimensional sample, so a Sobol design keeps every column stratified', () => {
    const n = 64, d = 4;
    const { U } = saltelliDesign(n, d, 'sobol', 2);
    for (const block of [0, 1]) {
      for (let c = 0; c < d; c++) {
        const strata = Array.from({ length: n }, (_, j) => Math.floor(U[(block * n + j) * d + c] * n)).sort((a, b) => a - b);
        expect(strata).toEqual(Array.from({ length: n }, (_, k) => k));
      }
    }
    expect(() => saltelliDesign(8, 0)).toThrow(/positive integer/);
  });

  it('mapUnitToParams applies the quantile function of each column', () => {
    const X = mapUnitToParams(Float64Array.from([0.25, 0.5, 0.75, 0.5]), [{ type: 'uniform', lo: 0, hi: 4 }, { type: 'loguniform', lo: 1, hi: 100 }]);
    expect(X[0]).toBe(1);
    expect(X[1]).toBeCloseTo(10, 12);
    expect(X[2]).toBe(3);
    expect(X[3]).toBeCloseTo(10, 12);
  });
});

describe('Sobol indices of the Ishigami function (analytic reference)', () => {
  it('the analytic partial variances are the published values (S1 = 0.314, S2 = 0.442, S3 = 0)', () => {
    expect(V).toBeCloseTo(13.8446, 4);
    expect(S_TRUE[0]).toBeCloseTo(0.3139, 4);
    expect(S_TRUE[1]).toBeCloseTo(0.4424, 4);
    expect(ST_TRUE[0]).toBeCloseTo(0.5576, 4);
    expect(ST_TRUE[2]).toBeCloseTo(0.2437, 4);
  });

  it('N = 2^14 with a scrambled Sobol design: S and ST lie inside their bootstrap intervals and close to the analytic values', () => {
    const n = 2 ** 14;
    const r = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], n, { sampler: 'sobol', designSeed: 1, resamples: 300, seed: 7 });
    expect(r.nUsed).toBe(n);
    expect(r.variance).toBeCloseTo(V, 1);
    for (let i = 0; i < 3; i++) {
      expect(r.firstCI![i][0], `S${i + 1} lower`).toBeLessThanOrEqual(S_TRUE[i]);
      expect(r.firstCI![i][1], `S${i + 1} upper`).toBeGreaterThanOrEqual(S_TRUE[i]);
      expect(r.totalCI![i][0], `ST${i + 1} lower`).toBeLessThanOrEqual(ST_TRUE[i]);
      expect(r.totalCI![i][1], `ST${i + 1} upper`).toBeGreaterThanOrEqual(ST_TRUE[i]);
      expect(Math.abs(r.first[i] - S_TRUE[i]), `S${i + 1}`).toBeLessThan(0.01);
      expect(Math.abs(r.total[i] - ST_TRUE[i]), `ST${i + 1}`).toBeLessThan(0.01);
    }
    expect(r.level).toBe(0.95);
    expect(r.resamples).toBe(300);
    // the interval is a proper interval around the estimate, not degenerate
    expect(r.firstCI![0][1] - r.firstCI![0][0]).toBeGreaterThan(0.005);
    expect(r.firstSd![0]).toBeGreaterThan(0);
    // sanity: sum of first-order indices <= 1 <= sum of total indices (ST >= S, the interaction is between x1 and x3)
    expect(r.first.reduce((a, b) => a + b, 0)).toBeLessThan(1);
    expect(r.total.reduce((a, b) => a + b, 0)).toBeGreaterThan(1);
    expect(r.total[2]).toBeGreaterThan(r.first[2] + 0.2);
  });

  it('the first-order Jansen and the total Sobol estimators agree with the analytic values as well', () => {
    const r = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 2 ** 14, { first: 'jansen', total: 'sobol', resamples: 0, designSeed: 3 });
    expect(r.firstCI).toBeUndefined();
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(r.first[i] - S_TRUE[i])).toBeLessThan(0.01);
      expect(Math.abs(r.total[i] - ST_TRUE[i])).toBeLessThan(0.01);
    }
  });

  it('Latin hypercube and Monte Carlo designs converge more slowly but stay within a few percent at N = 2^14', () => {
    for (const [sampler, tol] of [['lhs', 0.05], ['mc', 0.08]] as [SamplerKind, number][]) {
      const r = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 2 ** 14, { sampler, designSeed: 2, resamples: 0 });
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(r.first[i] - S_TRUE[i]), `${sampler} S${i + 1}`).toBeLessThan(tol);
        expect(Math.abs(r.total[i] - ST_TRUE[i]), `${sampler} ST${i + 1}`).toBeLessThan(tol);
      }
    }
  });

  it('the 95 % bootstrap intervals of a Monte Carlo design cover the truth at about the nominal rate', () => {
    // 20 independent designs of n = 2048, six indices each: 120 intervals; a 95 % interval covers about 114 of them
    let covered = 0, total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 2048, { sampler: 'mc', designSeed: seed, resamples: 100, seed });
      for (let i = 0; i < 3; i++) {
        covered += (r.firstCI![i][0] <= S_TRUE[i] && S_TRUE[i] <= r.firstCI![i][1] ? 1 : 0) + (r.totalCI![i][0] <= ST_TRUE[i] && ST_TRUE[i] <= r.totalCI![i][1] ? 1 : 0);
        total += 2;
      }
    }
    expect(total).toBe(120);
    expect(covered / total).toBeGreaterThan(0.85);
  });

  it('the same seeds give identical indices and intervals', () => {
    const a = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 512, { designSeed: 4, resamples: 50, seed: 9 });
    const b = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 512, { designSeed: 4, resamples: 50, seed: 9 });
    expect(a).toEqual(b);
    const c = sobolIndicesOfFunction(ishigami, [UNI, UNI, UNI], 512, { designSeed: 4, resamples: 50, seed: 10 });
    expect(c.first).toEqual(a.first);
    expect(c.firstCI).not.toEqual(a.firstCI);
  });
});

describe('Sobol indices of other analytic models', () => {
  it('an additive linear model of independent normals: S_i = ST_i = a_i^2 s_i^2 / sum', () => {
    const coef = [1, 2, 3], sds = [1, 0.5, 2];
    const f = (x: Float64Array) => coef[0] * x[0] + coef[1] * x[1] + coef[2] * x[2];
    const dists: DistSpec[] = sds.map((s, i) => ({ type: 'normal', mean: i, sd: s }));
    const parts = coef.map((c, i) => (c * sds[i]) ** 2);
    const tot = parts.reduce((a, b) => a + b, 0);
    const r = sobolIndicesOfFunction(f, dists, 4096, { resamples: 0 });
    for (let i = 0; i < 3; i++) {
      expect(r.first[i]).toBeCloseTo(parts[i] / tot, 2);
      expect(r.total[i]).toBeCloseTo(parts[i] / tot, 2);
    }
  });

  it('the product X1 X2 of uniforms has S = 3/7 and ST = 4/7 for both factors (a pure interaction)', () => {
    const f = (x: Float64Array) => x[0] * x[1];
    const dists: DistSpec[] = [{ type: 'uniform', lo: 0, hi: 1 }, { type: 'uniform', lo: 0, hi: 1 }];
    const r = sobolIndicesOfFunction(f, dists, 2 ** 14, { resamples: 0 });
    for (let i = 0; i < 2; i++) {
      expect(r.first[i]).toBeCloseTo(3 / 7, 2);
      expect(r.total[i]).toBeCloseTo(4 / 7, 2);
    }
  });

  it('a parameter the output does not depend on has zero indices; a constant output gives NaN', () => {
    const r = sobolIndicesOfFunction((x) => x[0], [{ type: 'uniform', lo: 0, hi: 1 }, { type: 'uniform', lo: 0, hi: 1 }], 1024, { resamples: 0 });
    expect(r.first[1]).toBeCloseTo(0, 12);
    expect(r.total[1]).toBeCloseTo(0, 12);
    expect(r.total[0]).toBeCloseTo(1, 12);
    const c = sobolIndicesOfFunction(() => 5, [{ type: 'uniform', lo: 0, hi: 1 }], 64, { resamples: 10 });
    expect(c.first[0]).toBeNaN();
    expect(c.variance).toBe(0);
  });
});

describe('shift invariance of the estimators (regression: un-centred products)', () => {
  // y = shift + 2 x1 + x2 + 0.5 x3 with x_i ~ U(0, 1): S_i = ST_i = c_i^2 / (4 + 1 + 0.25)
  const coef = [2, 1, 0.5];
  const truth = coef.map((c) => (c * c) / coef.reduce((a, b) => a + b * b, 0));
  const dists: DistSpec[] = coef.map(() => ({ type: 'uniform', lo: 0, hi: 1 }));
  const run = (shift: number, sampler: SamplerKind, seed: number, first: 'saltelli' | 'jansen', total: 'jansen' | 'sobol') =>
    sobolIndicesOfFunction((x) => shift + coef[0] * x[0] + coef[1] * x[1] + coef[2] * x[2], dists, 256, { sampler, designSeed: seed, first, total, resamples: 0 });

  it('a large constant offset of the output leaves every estimator unchanged (mc, lhs, sobol)', () => {
    for (const sampler of ['mc', 'lhs', 'sobol'] as SamplerKind[]) {
      for (const seed of [1, 2, 3]) {
        for (const [first, total] of [['saltelli', 'sobol'], ['saltelli', 'jansen'], ['jansen', 'jansen']] as const) {
          const a = run(0, sampler, seed, first, total), b = run(1000, sampler, seed, first, total);
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(b.first[i] - a.first[i])).toBeLessThan(1e-8);
            expect(Math.abs(b.total[i] - a.total[i])).toBeLessThan(1e-8);
          }
        }
      }
    }
  });

  it('with the offset 1000 the plain Monte Carlo first-order index stays near the truth at n = 256', () => {
    let err = 0, cnt = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = run(1000, 'mc', seed, 'saltelli', 'sobol');
      for (let i = 0; i < 3; i++) { err += Math.abs(r.first[i] - truth[i]); cnt++; }
    }
    expect(err / cnt).toBeLessThan(0.08);
  });
});

describe('Sobol indices from raw outputs', () => {
  it('drop the rows with a non-finite output and report how many were used', () => {
    const n = 256, d = 2;
    const design = saltelliDesign(n, d, 'sobol', 1);
    const X = mapUnitToParams(design.U, [{ type: 'uniform', lo: 0, hi: 1 }, { type: 'uniform', lo: 0, hi: 1 }]);
    const rows = saltelliRuns(n, d);
    const y = new Float64Array(rows);
    for (let r = 0; r < rows; r++) y[r] = X[r * d] + 2 * X[r * d + 1];
    const clean = sobolIndices(y, n, d, { resamples: 0 });
    y[3] = NaN; // a failed run in block A, row 3
    y[2 * n + 10] = Infinity; // a failed run in block AB_1, row 10
    const dropped = sobolIndices(y, n, d, { resamples: 20 });
    expect(dropped.nUsed).toBe(n - 2);
    expect(dropped.first[0]).toBeCloseTo(clean.first[0], 1);
    expect(dropped.first[1]).toBeCloseTo(0.8, 1); // Var(2 x2) / (Var(x1) + Var(2 x2)) = 4/5
  });

  it('validates the length and copes with too few usable rows', () => {
    expect(() => sobolIndices(new Float64Array(10), 4, 2)).toThrow(/expected 16 outputs/);
    const all = new Float64Array(16).fill(NaN);
    const r = sobolIndices(all, 4, 2);
    expect(r.nUsed).toBe(0);
    expect(r.first).toEqual([NaN, NaN]);
  });
});
