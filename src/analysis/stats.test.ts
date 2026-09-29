import { describe, expect, it } from 'vitest';
import { bootstrap, mean, pearson, quantileSorted, quantiles, ranks, sd, sortedFinite, spearman, variance, wilsonInterval } from './stats';

describe('moments and quantiles', () => {
  it('mean, variance and standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNaN();
    expect(variance([1, 2, 3, 4])).toBeCloseTo(5 / 3, 14);
    expect(variance([1, 2, 3, 4], 0)).toBeCloseTo(1.25, 14);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9], 0)).toBe(2);
    expect(variance([5])).toBeNaN();
  });

  it('sample quantiles use linear interpolation of the order statistics (type 7)', () => {
    // reference values computed with the definition h = (n - 1) p in Python, independent of this code
    expect(quantiles([1, 2, 3, 4, 10], [0.3, 0.9])).toEqual([2.2, 7.6000000000000005]);
    expect(quantiles([7, 1, 5], [0.25, 0, 1, 0.5])).toEqual([3, 1, 7, 5]);
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([], 0.5)).toBeNaN();
    expect(quantileSorted([4], 0.3)).toBe(4);
    expect(() => quantileSorted([1, 2], 1.5)).toThrow(RangeError);
    // NaN entries are ignored
    expect(Array.from(sortedFinite([3, NaN, 1, 2]))).toEqual([1, 2, 3]);
    expect(quantiles([3, NaN, 1, 2], [0.5])).toEqual([2]);
  });
});

describe('Wilson interval', () => {
  it('matches the closed form (Python reference) and stays inside [0, 1]', () => {
    const cases: [number, number, number, number][] = [
      [0, 10, 0, 0.27753279986288915], [10, 10, 0.7224672001371109, 1], [5, 10, 0.23659309051256405, 0.763406909487436],
      [3, 100, 0.010254524024038925, 0.08451936429052759], [120, 1000, 0.10129926060130913, 0.14160907584771273],
    ];
    for (const [k, n, lo, hi] of cases) {
      const [a, b] = wilsonInterval(k, n);
      expect(a).toBeCloseTo(lo, 12);
      expect(b).toBeCloseTo(hi, 12);
    }
    expect(wilsonInterval(1, 0)[0]).toBeNaN();
    const [lo99, hi99] = wilsonInterval(5, 10, 0.99);
    const [lo95, hi95] = wilsonInterval(5, 10, 0.95);
    expect(lo99).toBeLessThan(lo95);
    expect(hi99).toBeGreaterThan(hi95);
  });
});

describe('rank correlation', () => {
  it('ranks ties by their average position', () => {
    expect(Array.from(ranks([1, 3, 2, 3, 6, 5]))).toEqual([1, 3.5, 2, 3.5, 6, 5]);
    expect(Array.from(ranks([5, 5, 5]))).toEqual([2, 2, 2]);
  });

  it('Pearson and Spearman', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 14);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 14);
    expect(pearson([1, 1, 1], [3, 2, 1])).toBeNaN();
    expect(pearson([1, 2], [1])).toBeNaN();
    // monotone but strongly non-linear: Spearman 1, Pearson < 1
    const x = [1, 2, 3, 4, 5, 6], y = x.map((v) => Math.exp(v));
    expect(spearman(x, y)).toBeCloseTo(1, 14);
    expect(pearson(x, y)).toBeLessThan(0.95);
    // with ties: the Pearson correlation of the average ranks (Python reference)
    expect(spearman([1, 2, 3, 4, 5, 6], [1, 3, 2, 3, 6, 5])).toBeCloseTo(0.8406680016960503, 12);
  });
});

describe('bootstrap', () => {
  it('is deterministic per seed and its interval brackets the estimate', () => {
    const x = Array.from({ length: 200 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
    const a = bootstrap(x, mean, 300, 5);
    const b = bootstrap(x, mean, 300, 5);
    const c = bootstrap(x, mean, 300, 6);
    expect(a).toEqual(b);
    expect(c.ci).not.toEqual(a.ci);
    expect(a.estimate).toBe(mean(x));
    expect(a.ci[0]).toBeLessThan(a.estimate);
    expect(a.ci[1]).toBeGreaterThan(a.estimate);
    // the bootstrap standard deviation of a mean approximates s / sqrt(n)
    expect(a.sd / (sd(x) / Math.sqrt(x.length))).toBeGreaterThan(0.85);
    expect(a.sd / (sd(x) / Math.sqrt(x.length))).toBeLessThan(1.15);
  });

  it('a constant sample has a degenerate interval; an empty one has none', () => {
    const r = bootstrap([2, 2, 2, 2], mean, 50, 1);
    expect(r.ci).toEqual([2, 2]);
    expect(r.sd).toBe(0);
    expect(bootstrap([], mean, 50, 1).ci[0]).toBeNaN();
    expect(bootstrap([1, 2, 3], mean, 0, 1).ci[0]).toBeNaN();
  });
});
