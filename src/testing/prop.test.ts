import { describe, expect, it } from 'vitest';
import { PropertyFailure, caseSeed, forAll, gen, mulberry32 } from './prop';
import { RNG } from '../physics/rng';

/** runs forAll and returns the PropertyFailure it throws (fails the test if it does not throw) */
function failure<T>(run: () => void): PropertyFailure<T> {
  try {
    run();
  } catch (e) {
    if (e instanceof PropertyFailure) return e as PropertyFailure<T>;
    throw e;
  }
  throw new Error('expected the property to fail');
}

describe('mulberry32', () => {
  it('matches the simulator RNG (src/physics/rng.ts) draw for draw', () => {
    for (const seed of [1, 42, 0xdeadbeef, 0]) {
      const a = mulberry32(seed), b = new RNG(seed);
      for (let i = 0; i < 1000; i++) expect(a()).toBe(b.next());
    }
  });

  it('is deterministic, in [0, 1) and statistically uniform (mean, variance, 10-bin χ²)', () => {
    const r = mulberry32(12345), n = 20000;
    const bins = new Array(10).fill(0);
    let s = 0, s2 = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const u = r();
      lo = Math.min(lo, u); hi = Math.max(hi, u);
      s += u; s2 += u * u; bins[Math.floor(u * 10)]++;
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(s2 / n - (s / n) ** 2).toBeCloseTo(1 / 12, 2);
    const chi2 = bins.reduce((acc, c) => acc + (c - n / 10) ** 2 / (n / 10), 0);
    expect(chi2).toBeLessThan(27.88); // χ²(9 d.o.f.) 99.9 % quantile
    const again = mulberry32(12345);
    const first = mulberry32(12345)();
    expect(again()).toBe(first);
  });
});

describe('forAll', () => {
  it('runs the requested number of cases and generates within bounds', () => {
    let n = 0;
    forAll(gen.tuple(gen.float(-2, 3), gen.int(5, 9), gen.logFloat(1e-3, 1e3)), ([x, k, y]) => {
      n++;
      expect(x).toBeGreaterThanOrEqual(-2); expect(x).toBeLessThanOrEqual(3);
      expect(Number.isInteger(k) && k >= 5 && k <= 9).toBe(true);
      expect(y).toBeGreaterThanOrEqual(1e-3); expect(y).toBeLessThanOrEqual(1e3);
    }, { runs: 250 });
    expect(n).toBe(250);
  });

  it('is deterministic for a seed and different for another seed', () => {
    const draw = (seed: number) => { const xs: number[] = []; forAll(gen.float(0, 1), (x) => { xs.push(x); }, { runs: 20, seed }); return xs; };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('emits the range ends and the target as edge cases', () => {
    const seen = new Set<number>();
    forAll(gen.float(2, 5, { target: 3 }), (x) => { seen.add(x); }, { runs: 300 });
    for (const e of [2, 3, 5]) expect(seen.has(e)).toBe(true);
  });

  it('reports seeds, the original and the shrunk case, and the property error', () => {
    const f = failure(() => forAll(gen.int(0, 1000), (x) => { expect(x).toBeLessThan(500); }, { label: 'small', seed: 99 }));
    expect(f.message).toContain('Property "small" failed');
    expect(f.message).toContain('run seed 0x63');
    expect(f.message).toMatch(/case seed 0x[0-9a-f]+/);
    expect(f.message).toContain('original:');
    expect(f.message).toContain('shrunk');
    expect(f.message).toContain('expected'); // vitest's own assertion text
    expect(f.shrunk).toBe(500); // integers shrink to the boundary of the failing region
  });

  it('shrinks floats to the boundary through rounder values', () => {
    const f = failure<number>(() => forAll(gen.float(0, 1), (x) => x < 0.5, { seed: 3 }));
    expect(f.original).toBeGreaterThanOrEqual(0.5);
    expect(f.shrunk).toBe(0.5);
    expect(f.message).toContain('property returned false');
  });

  it('shrinks records field by field to a minimal counterexample', () => {
    const f = failure<{ a: number; b: number }>(() =>
      forAll(gen.record({ a: gen.int(0, 100), b: gen.int(0, 100) }), ({ a, b }) => a + b < 100, { seed: 11 }));
    expect(f.shrunk.a + f.shrunk.b).toBe(100);
  });

  it('drops irrelevant optional fields and array elements while shrinking', () => {
    const arb = gen.record({
      x: gen.optional(gen.float(0, 100), 0.9), y: gen.optional(gen.float(0, 100), 0.9),
      list: gen.array(gen.int(0, 9), 0, 8), mode: gen.oneOf(['a', 'b', 'c'] as const), flag: gen.bool(),
    });
    const f = failure<{ x?: number; y?: number; list: number[]; mode: string; flag: boolean }>(() =>
      forAll(arb, (v) => !(v.y !== undefined && v.y > 10), { seed: 5, runs: 200 }));
    expect(f.shrunk.x).toBeUndefined();
    expect(f.shrunk.y).toBeGreaterThan(10);
    expect(f.shrunk.y).toBeLessThanOrEqual(20); // bisection homes in on the boundary y = 10 from above
    expect(f.shrunk.list).toEqual([]);
    expect(f.shrunk.mode).toBe('a');
    expect(f.shrunk.flag).toBe(false);
  });

  it('replays a failing case exactly from its case seed', () => {
    const prop = (x: number) => x < 0.9;
    const f = failure<number>(() => forAll(gen.float(0, 1, { edgeProb: 0 }), prop, { seed: 2024 }));
    expect(f.caseIndex).toBeGreaterThan(0);
    expect(f.caseSeed).toBe(caseSeed(2024, f.caseIndex));
    const g = failure<number>(() => forAll(gen.float(0, 1, { edgeProb: 0 }), prop, { seed: f.caseSeed, runs: 1 }));
    expect(g.original).toBe(f.original);
    expect(g.caseIndex).toBe(0);
  });

  it('respects the shrink budget', () => {
    let evals = 0;
    // no edge cases: the first case fails (x ≥ 1 with probability 1 − 1e-6), then 5 shrink evaluations
    failure(() => forAll(gen.float(0, 1e6, { edgeProb: 0 }), (x) => { evals++; return x < 1; }, { seed: 1, maxShrinks: 5 }));
    expect(evals).toBe(1 + 5);
  });
});
