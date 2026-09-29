import { describe, expect, it } from 'vitest';
import { Individual, assignCrowding, dominates, hypervolume2D, nonDominatedSort, nsga2 } from './nsga2';

const ind = (f: number[], violation = 0): Individual => ({ x: [], f, violation, rank: -1, crowding: 0 });

describe('constrained domination and sorting', () => {
  it('Pareto dominance among feasible points; feasible beats infeasible; less violation beats more', () => {
    expect(dominates(ind([1, 1]), ind([2, 2]))).toBe(true);
    expect(dominates(ind([1, 2]), ind([2, 1]))).toBe(false);
    expect(dominates(ind([1, 1]), ind([1, 1]))).toBe(false);
    expect(dominates(ind([1, 1]), ind([1, 2]))).toBe(true);
    expect(dominates(ind([9, 9]), ind([0, 0], 0.1))).toBe(true);
    expect(dominates(ind([0, 0], 0.1), ind([9, 9]))).toBe(false);
    expect(dominates(ind([9, 9], 0.1), ind([0, 0], 0.2))).toBe(true);
    expect(dominates(ind([0, 0], 0.2), ind([9, 9], 0.1))).toBe(false);
  });

  it('fast non-dominated sorting on a hand-worked set: fronts and ranks', () => {
    const pop = [ind([1, 5]), ind([2, 3]), ind([4, 1]), ind([3, 4]), ind([5, 2]), ind([6, 6]), ind([2, 6])];
    const fronts = nonDominatedSort(pop);
    // front 0: (1,5) (2,3) (4,1); front 1: (3,4) (5,2) (2,6); front 2: (6,6)
    expect(fronts.map((f) => [...f].sort((a, b) => a - b))).toEqual([[0, 1, 2], [3, 4, 6], [5]]);
    expect(pop.map((p) => p.rank)).toEqual([0, 0, 0, 1, 1, 2, 1]);
  });

  it('constraint violation orders the fronts of infeasible points', () => {
    const pop = [ind([5, 5]), ind([0, 0], 1), ind([9, 9], 2)];
    const fronts = nonDominatedSort(pop);
    expect(fronts).toEqual([[0], [1], [2]]);
  });

  it('crowding distance: boundary points are infinite, interior ones the normalised neighbour spacing', () => {
    const pop = [ind([0, 4]), ind([1, 3]), ind([3, 1]), ind([4, 0])];
    assignCrowding(pop, [0, 1, 2, 3]);
    expect(pop[0].crowding).toBe(Infinity);
    expect(pop[3].crowding).toBe(Infinity);
    // point 1: objective 1 (3 - 0)/4 + objective 2 (4 - 1)/4 (neighbours by f2 are points 2 and 0)... = 0.75 + 0.75
    expect(pop[1].crowding).toBeCloseTo(0.75 + 0.75, 12);
    expect(pop[2].crowding).toBeCloseTo(0.75 + 0.75, 12);
    const two = [ind([0, 1]), ind([1, 0])];
    assignCrowding(two, [0, 1]);
    expect(two.map((p) => p.crowding)).toEqual([Infinity, Infinity]);
  });
});

describe('hypervolume', () => {
  it('two points against a reference: the union of two boxes', () => {
    // boxes [1,4]x[3,4] (area 3) and [2,4]x[1,4] (area 6) overlap in [2,4]x[3,4] (area 2): 7
    expect(hypervolume2D([[1, 3], [2, 1]], [4, 4])).toBeCloseTo(7, 12);
    expect(hypervolume2D([[1, 1]], [3, 3])).toBe(4);
    expect(hypervolume2D([[5, 5]], [3, 3])).toBe(0);
    expect(hypervolume2D([], [3, 3])).toBe(0);
    // a dominated point adds nothing, order does not matter
    expect(hypervolume2D([[2, 2], [1, 3], [3, 1], [2.5, 2.5]], [4, 4])).toBeCloseTo(hypervolume2D([[3, 1], [1, 3], [2, 2]], [4, 4]), 12);
    // staircase (1,3), (2,2), (3,1) against (4,4): 3 x 1 + 2 x 1 + 1 x 1 = 6
    expect(hypervolume2D([[1, 3], [3, 1], [2, 2]], [4, 4])).toBeCloseTo(6, 12);
  });
});

/** ZDT1 (Zitzler, Deb & Thiele, Evol. Comput. 8 (2000) 173): 30 variables in [0, 1], true front f2 = 1 - sqrt(f1) at x2 = ... = x30 = 0 */
const zdt1 = {
  n: 30, m: 2,
  f: (x: number[]) => {
    const g = 1 + (9 / 29) * x.slice(1).reduce((s, v) => s + v, 0);
    return [x[0], g * (1 - Math.sqrt(x[0] / g))];
  },
  lower: new Array(30).fill(0), upper: new Array(30).fill(1),
};

describe('NSGA-II', () => {
  it('ZDT1 (population 100, 250 generations, as in Deb et al. 2002): converges to the true front and spreads over it', () => {
    const r = nsga2(zdt1, { seed: 11 });
    expect(r.evals).toBe(100 + 250 * 100);
    expect(r.front.length).toBeGreaterThan(50);
    // convergence metric: mean distance of the obtained front from the true front (Deb et al. report 0.033 +- 0.005 for real-coded NSGA-II)
    const dist = (p: number[]) => Math.abs(p[1] - (1 - Math.sqrt(p[0])));
    const gamma = r.front.reduce((s, i) => s + dist(i.f), 0) / r.front.length;
    expect(gamma).toBeLessThan(0.06);
    // the front runs from f1 = 0 to f1 = 1 (crowding keeps the boundary points)
    expect(r.front[0].f[0]).toBeLessThan(0.02);
    expect(r.front[r.front.length - 1].f[0]).toBeGreaterThan(0.98);
    // hypervolume against (1.1, 1.1): the true front dominates 0.1 + 2/3 + 0.11
    const hvTrue = 0.1 + 2 / 3 + 0.11;
    const hv = hypervolume2D(r.front.map((i) => i.f), [1.1, 1.1]);
    expect(hv).toBeGreaterThan(0.97 * hvTrue);
    expect(hv).toBeLessThanOrEqual(hvTrue + 1e-9);
    // all points of the front are mutually non-dominated and sorted by f1
    for (let i = 1; i < r.front.length; i++) expect(r.front[i].f[0]).toBeGreaterThanOrEqual(r.front[i - 1].f[0]);
    for (const a of r.front) for (const b of r.front) expect(dominates(a, b)).toBe(false);
    expect(r.population).toHaveLength(100);
  });

  it('Binh and Korn with two constraints: every front point is feasible and lies on the known Pareto front', () => {
    // f1 = 4 x1^2 + 4 x2^2, f2 = (x1 - 5)^2 + (x2 - 5)^2, (x1 - 5)^2 + x2^2 <= 25, (x1 - 8)^2 + (x2 + 3)^2 >= 7.7, x1 in [0, 5], x2 in [0, 3].
    // Pareto set (Binh & Korn 1997): x2 = x1 for x1 in [0, 3], x2 = 3 for x1 in [3, 5]; in the objective plane the curve
    // (8 t^2, 2 (5 - t)^2), t in [0, 3], continued by (4 x^2 + 36, (x - 5)^2 + 4), x in [3, 5]
    const bk = {
      n: 2, m: 2,
      f: (x: number[]) => [4 * x[0] ** 2 + 4 * x[1] ** 2, (x[0] - 5) ** 2 + (x[1] - 5) ** 2],
      g: (x: number[]) => [(x[0] - 5) ** 2 + x[1] ** 2 - 25, 7.7 - ((x[0] - 8) ** 2 + (x[1] + 3) ** 2)],
      lower: [0, 0], upper: [5, 3],
    };
    const curve: number[][] = [];
    for (let k = 0; k <= 3000; k++) { const t = (3 * k) / 3000; curve.push([8 * t * t, 2 * (5 - t) ** 2]); }
    for (let k = 0; k <= 2000; k++) { const x = 3 + (2 * k) / 2000; curve.push([4 * x * x + 36, (x - 5) ** 2 + 4]); }
    const dist = (f: number[]) => Math.min(...curve.map((c) => Math.hypot(c[0] - f[0], c[1] - f[1])));
    const r = nsga2(bk, { popSize: 100, generations: 120, seed: 2 });
    expect(r.front.length).toBeGreaterThan(40);
    const d = r.front.map((i) => dist(i.f));
    expect(d.reduce((a, b) => a + b, 0) / d.length).toBeLessThan(0.5); // objective ranges are about 130 and 50
    expect(Math.max(...d)).toBeLessThan(2.5);
    for (const i of r.front) expect(i.violation).toBe(0);
    // spans the front: from near (0, 50) to near (131, 4)
    expect(r.front[0].f[0]).toBeLessThan(1);
    expect(r.front[r.front.length - 1].f[0]).toBeGreaterThan(125);
    // decision variables stay inside the box, and the tail of the set is the bound x2 = 3
    for (const i of r.front) { expect(i.x[0]).toBeGreaterThanOrEqual(0); expect(i.x[0]).toBeLessThanOrEqual(5); expect(i.x[1]).toBeGreaterThanOrEqual(0); expect(i.x[1]).toBeLessThanOrEqual(3); }
    expect(r.front[r.front.length - 1].x[1]).toBeGreaterThan(2.95);
  });

  it('is reproducible for a seed', () => {
    const p = { ...zdt1, n: 5, lower: new Array(5).fill(0), upper: new Array(5).fill(1), f: (x: number[]) => [x[0], (1 + x[1]) * (1 - Math.sqrt(x[0]))] };
    const a = nsga2(p, { popSize: 20, generations: 15, seed: 3 }), b = nsga2(p, { popSize: 20, generations: 15, seed: 3 }), c = nsga2(p, { popSize: 20, generations: 15, seed: 4 });
    expect(a).toEqual(b);
    expect(c.front.map((i) => i.f)).not.toEqual(a.front.map((i) => i.f));
  });

  it('returns the least violated non-dominated set when no point is feasible', () => {
    const p = { n: 1, m: 2, f: (x: number[]) => [x[0], 1 - x[0]], g: (x: number[]) => [x[0] + 5], lower: [0], upper: [1] };
    const r = nsga2(p, { popSize: 8, generations: 5, seed: 1 });
    expect(r.front.length).toBeGreaterThan(0);
    expect(r.front.every((i) => i.violation > 0)).toBe(true);
  });

  it('non-finite objective values are treated as very bad', () => {
    const p = { n: 1, m: 2, f: (x: number[]) => (x[0] < 0.2 ? [NaN, Infinity] : [x[0], 1 - x[0]]), lower: [0], upper: [1] };
    const r = nsga2(p, { popSize: 8, generations: 10, seed: 1 });
    expect(r.front.every((i) => Number.isFinite(i.f[0]) && i.f[0] < 1e299)).toBe(true);
  });

  it('rejects invalid problems and options', () => {
    const ok = { n: 1, m: 2, f: (x: number[]) => [x[0], 1 - x[0]], lower: [0], upper: [1] };
    expect(() => nsga2({ ...ok, n: 0 })).toThrow(/at least one variable/);
    expect(() => nsga2({ ...ok, m: 1 })).toThrow(/at least two objectives/);
    expect(() => nsga2({ ...ok, lower: [0, 0] })).toThrow(/one entry per variable/);
    expect(() => nsga2({ ...ok, upper: [0] })).toThrow(/upper\[0\] must exceed lower\[0\]/);
    expect(() => nsga2(ok, { popSize: 10 })).toThrow(/multiple of 4/);
    expect(() => nsga2({ ...ok, f: () => [1] }, { popSize: 8, generations: 1 })).toThrow(/returned 1 values, expected 2/);
  });
});
