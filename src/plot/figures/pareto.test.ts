/**
 * Pareto fronts: dominance, non-dominated sorting (checked against the definition on random sets),
 * the attainment staircase and the figure on synthetic trade-off data.
 */
import { describe, expect, it } from 'vitest';
import { nodeFontSet } from '../fontsNode';
import { Sense, dominates, figPareto, nonDominatedSort, paretoFront, staircase } from './pareto';
import { lcg } from './testdata/synthetic';

const fonts = nodeFontSet();

describe('dominance and non-dominated sorting', () => {
  it('a dominates b when it is no worse everywhere and better somewhere', () => {
    const mm: Sense[] = ['min', 'min'];
    expect(dominates([1, 2], [2, 3], mm)).toBe(true);
    expect(dominates([1, 3], [2, 3], mm)).toBe(true); // equal in one objective
    expect(dominates([1, 2], [1, 2], mm)).toBe(false); // identical points do not dominate each other
    expect(dominates([1, 4], [2, 3], mm)).toBe(false); // a trade-off
    expect(dominates([2, 3], [1, 2], mm)).toBe(false);
    expect(dominates([2, 1], [1, 2], ['max', 'min'])).toBe(true); // mixed senses
    expect(dominates([NaN, 1], [2, 2], mm)).toBe(false);
    expect(dominates([1, 1], [NaN, 2], mm)).toBe(false);
  });

  it('fronts of a small set (minimise both objectives)', () => {
    const pts = [[1, 5], [2, 3], [3, 1], [2, 4], [4, 4], [5, 5], [3, 3]];
    expect(nonDominatedSort(pts, ['min', 'min'])).toEqual([0, 0, 0, 1, 2, 3, 1]);
    expect(paretoFront(pts, ['min', 'min'])).toEqual([0, 1, 2]);
    // maximising both: (5, 5) is at least as large everywhere and dominates every other point
    expect(paretoFront(pts, ['max', 'max'])).toEqual([5]);
    // one of each: (1, 5) has the smallest x and the largest y (tied with (5, 5)), so it dominates the rest
    expect(paretoFront(pts, ['min', 'max'])).toEqual([0]);
    expect(paretoFront([[1, 1], [2, 4], [3, 3]], ['min', 'max'])).toEqual([0, 1]);
  });

  it('identical points share a front; points with a non-finite objective are excluded (rank -1)', () => {
    expect(nonDominatedSort([[1, 1], [1, 1], [2, 2], [NaN, 0], [0, Infinity]], ['min', 'min'])).toEqual([0, 0, 1, -1, -1]);
    expect(nonDominatedSort([], ['min', 'min'])).toEqual([]);
    expect(paretoFront([[3, 3]], ['min', 'min'])).toEqual([0]);
  });

  it('matches the definition on random sets in two and three objectives', () => {
    const rng = lcg(99);
    for (const m of [2, 3]) {
      const senses: Sense[] = m === 2 ? ['min', 'max'] : ['min', 'min', 'max'];
      const pts = Array.from({ length: 250 }, () => Array.from({ length: m }, () => Math.round(rng() * 40) / 4)); // ties are likely
      const rank = nonDominatedSort(pts, senses);
      const brute = pts.flatMap((p, i) => (pts.some((q, j) => j !== i && dominates(q, p, senses)) ? [] : [i]));
      expect(paretoFront(pts, senses)).toEqual(brute);
      pts.forEach((p, i) => {
        if (rank[i] > 0) expect(pts.some((q, j) => rank[j] === rank[i] - 1 && dominates(q, p, senses)), `point ${i}`).toBe(true);
        pts.forEach((q, j) => { if (rank[j] === rank[i]) expect(dominates(q, p, senses)).toBe(false); });
      });
    }
  });
});

describe('attainment staircase', () => {
  const front = [{ x: 3, y: 1 }, { x: 1, y: 5 }, { x: 2, y: 3 }];
  it('minimisation: right angles between neighbours sorted along x', () => {
    expect(staircase(front, ['min', 'min'])).toEqual({ x: [1, 2, 2, 3, 3], y: [5, 5, 3, 3, 1] });
  });
  it('maximisation and mixed senses bound the dominated region on the correct side', () => {
    expect(staircase(front, ['max', 'max'])).toEqual({ x: [3, 2, 2, 1, 1], y: [1, 1, 3, 3, 5] });
    const mixed = staircase([{ x: 1, y: 1 }, { x: 2, y: 4 }], ['min', 'max']);
    expect(mixed).toEqual({ x: [1, 2, 2], y: [1, 1, 4] });
    expect(staircase([], ['min', 'min'])).toEqual({ x: [], y: [] });
    expect(staircase([{ x: 1, y: 2 }], ['min', 'min'])).toEqual({ x: [1], y: [2] });
  });
});

describe('figPareto', () => {
  const rng = lcg(5);
  // trade-off between confinement cost (x, to minimise) and gain deficit (y, to minimise) with a cost colour
  const points = Array.from({ length: 220 }, () => {
    const u = rng(), noise = rng();
    return { x: 1 + 9 * u, y: 1 / (0.4 + u) + 1.6 * noise, c: 100 + 60 * rng() };
  });

  it('draws candidates, front, staircase, colour bar and marks', () => {
    const svg = figPareto({ points, xLabel: 'cost (arb.)', yLabel: '$1/Q$', colorLabel: 'B (T)', marks: [{ x: 5, y: 1.4, label: 'baseline' }], title: 'Trade-off' }).toSVG({ fonts });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<title>Trade-off</title>');
    for (const t of ['Pareto front', 'dominated', 'baseline']) expect(svg, t).toContain(t);
    expect(svg).toContain('<image '); // the colour bar
    const nFront = paretoFront(points.map((p) => [p.x, p.y]), ['min', 'min']).length;
    expect(nFront).toBeGreaterThan(2);
    expect(nFront).toBeLessThan(points.length / 2);
  });

  it('several fronts, maximisation, log axes, non-finite points and a constant third value', () => {
    const many = figPareto({ points, xLabel: 'x', yLabel: 'y', nFronts: 3, senses: ['max', 'min'] }).toSVG({ fonts });
    expect(many).toContain('front 2-3');
    expect(many).not.toMatch(/NaN|Infinity/);
    const messy = [...points.map((p) => ({ ...p, c: 7 })), { x: NaN, y: 1 }, { x: 2, y: Infinity }, { x: -1, y: 4 }];
    expect(figPareto({ points: messy, xLabel: 'x', yLabel: 'y', xlog: true, ylog: true, cmap: 'plasma' }).toSVG({ fonts })).not.toMatch(/NaN|Infinity/);
    // a point without the third value on a coloured front
    const partial = points.map((p, i) => (i % 5 === 0 ? { x: p.x, y: p.y } : p));
    expect(figPareto({ points: partial, xLabel: 'x', yLabel: 'y' }).toSVG({ fonts })).not.toMatch(/NaN|Infinity/);
  });

  it('empty input and one point render', () => {
    expect(figPareto({ points: [], xLabel: 'x', yLabel: 'y' }).toSVG({ fonts })).not.toMatch(/NaN|Infinity/);
    expect(figPareto({ points: [{ x: 1, y: 1 }], xLabel: 'x', yLabel: 'y', marks: [{ x: NaN, y: 1, label: 'bad' }] }).toSVG({ fonts })).not.toContain('bad');
  });
});
