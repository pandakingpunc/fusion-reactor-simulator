/**
 * UQ figures on synthetic ensembles: statistics helpers (quantiles, Silverman bandwidth, kernel density)
 * and the violin and tornado builders (structure of the rendered SVG, edge cases).
 */
import { describe, expect, it } from 'vitest';
import { nodeFontSet } from '../fontsNode';
import { figTornado, figViolin, gaussianKDE, quantileSorted, silvermanBandwidth, sortedFinite, tornadoSwing, violinShape } from './uq';
import { lcg, linspace, normals } from './testdata/synthetic';

const fonts = nodeFontSet();
const svgOf = (f: { toSVG: (o: { fonts: typeof fonts }) => string }) => f.toSVG({ fonts });
/** y attribute of the <text> whose only tspan is `label` */
const yOfLabel = (svg: string, label: string): number => {
  const m = new RegExp(`<text [^>]*?y="([\\d.]+)"[^>]*><tspan>${label}</tspan></text>`).exec(svg);
  if (!m) throw new Error(`label ${label} not found`);
  return parseFloat(m[1]);
};

describe('sample statistics', () => {
  it('sortedFinite drops non-finite values and sorts a copy', () => {
    const x = [3, NaN, 1, Infinity, -Infinity, 2];
    expect(sortedFinite(x)).toEqual([1, 2, 3]);
    expect(x[1]).toBeNaN(); // the input is untouched
    expect(sortedFinite(Float64Array.from([2, 1]))).toEqual([1, 2]);
  });

  it('quantiles interpolate the order statistics (Hyndman & Fan type 7)', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(quantileSorted([1, 2, 3, 4], 7)).toBe(4); // p is clamped
    expect(quantileSorted([5], 0.3)).toBe(5);
    expect(quantileSorted([], 0.5)).toBeNaN();
  });

  it('Silverman bandwidth of a standard normal sample is about 0.9 n^(-1/5); zero without spread', () => {
    const s = sortedFinite(normals(lcg(7), 1000));
    const h = silvermanBandwidth(s);
    expect(h).toBeGreaterThan(0.18);
    expect(h).toBeLessThan(0.26);
    expect(silvermanBandwidth([3, 3, 3])).toBe(0);
    expect(silvermanBandwidth([1])).toBe(0);
    // more than half of the values equal: the IQR is zero, the standard deviation sets the scale
    expect(silvermanBandwidth([1, 1, 1, 1, 1, 1, 1, 9])).toBeGreaterThan(0);
  });

  it('the kernel density estimate integrates to one and peaks near the mode', () => {
    const s = normals(lcg(3), 2000);
    const grid = linspace(-6, 6, 601);
    const d = gaussianKDE(s, grid, silvermanBandwidth(sortedFinite(s)));
    let area = 0;
    for (let i = 1; i < grid.length; i++) area += 0.5 * (d[i] + d[i - 1]) * (grid[i] - grid[i - 1]);
    expect(area).toBeCloseTo(1, 2);
    const top = d.indexOf(Math.max(...d));
    expect(Math.abs(grid[top])).toBeLessThan(0.5);
  });

  it('violin outline: spans the sample range, positive on log axes, null when there is no spread', () => {
    const s = sortedFinite(normals(lcg(11), 400).map((v) => 2 + v));
    const sh = violinShape(s, false, 64)!;
    expect(sh.y.length).toBe(64);
    expect(sh.y[0]).toBe(s[0]);
    expect(sh.y[63]).toBeCloseTo(s[s.length - 1], 12);
    expect(Math.min(...sh.d)).toBeGreaterThan(0);
    const pos = sortedFinite(s.map((v) => Math.exp(v)));
    const lg = violinShape(pos, true, 32)!;
    expect(lg.y[0]).toBeCloseTo(pos[0], 8);
    expect(lg.y.every((v) => v > 0)).toBe(true);
    expect(violinShape([4, 4, 4], false, 32)).toBeNull();
    expect(violinShape([4], false, 32)).toBeNull();
    expect(violinShape([-1, -2, 0], true, 32)).toBeNull(); // no positive sample on a log axis
    // a very long sample is thinned for the density but keeps the range
    const big = sortedFinite(normals(lcg(5), 9000));
    const bs = violinShape(big, false, 40)!;
    expect(bs.y[0]).toBe(big[0]);
    expect(bs.d.length).toBe(40);
  });
});

describe('figViolin', () => {
  const rng = lcg(2024);
  const Q = normals(rng, 300).map((v) => 9.6 + 1.1 * v);
  const Q2 = normals(rng, 300).map((v) => 5.2 + 0.4 * v);
  const P = normals(rng, 300).map((v) => 470 + 40 * v);
  const positive = normals(rng, 300).map((v) => Math.exp(1 + 0.7 * v));

  it('one panel per output with a violin per group: labels, reference, sample count, no NaN', () => {
    const fig = figViolin([
      { label: '$Q$', groups: [{ name: 'A', samples: Q }, { name: 'B', samples: Q2 }], ref: 10, refLabel: 'design' },
      { label: '$P_{\\mathrm{fus}}$', unit: 'MW', groups: [{ name: 'A', samples: P }, { name: 'B', samples: P.map((v) => v * 0.8) }], ref: 500 },
    ], { title: 'UQ' });
    const svg = svgOf(fig);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<title>UQ</title>');
    expect(svg).toContain('<tspan>design</tspan>'); // legend entry of the reference
    expect(svg).toContain('<tspan>A</tspan>');
    expect(svg).toContain('<tspan>B</tspan>');
    expect(svg).toContain('MW'); // unit in the axis label
    expect(svg).toContain('300'); // n = 300 (all groups have the same n)
    // 4 violins, two polygons each (fill and outline) + frames, whiskers, boxes: many paths
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(30);
    expect(fig.axes.length).toBe(2);
  });

  it('log panels, a group without spread, an empty group and non-finite samples render without throwing', () => {
    const fig = figViolin([
      { label: '$t$', log: true, groups: [{ name: 'lin', samples: positive }, { name: 'neg', samples: [-1, 0, NaN] }] },
      { label: 'const', groups: [{ name: 'one', samples: [3, 3, 3, 3] }, { name: 'none', samples: [] }, { name: 'nan', samples: [NaN, NaN] }, { name: 'single', samples: [2] }] },
    ]);
    expect(svgOf(fig)).not.toMatch(/NaN|Infinity/);
  });

  it('a reference outside the ensemble stays on the axis; no panels renders an empty axes; layout grows with the rows', () => {
    const fig = figViolin([{ label: 'x', groups: [{ name: 'g', samples: Q }], ref: 100 }]);
    expect(fig.axes[0].opts.ylim![1]).toBeGreaterThanOrEqual(100);
    expect(svgOf(figViolin([]))).not.toMatch(/NaN/);
    const panels = Array.from({ length: 5 }, (_, k) => ({ label: `y${k}`, groups: [{ name: 'g', samples: Q }] }));
    const five = figViolin(panels), one = figViolin(panels.slice(0, 3));
    expect(five.H).toBeGreaterThan(one.H); // 3 columns: five panels need two rows
    expect(figViolin(panels, { ncols: 1 }).W).toBeLessThan(five.W); // a single column is a single-column figure
    expect(figViolin(panels, { gridPoints: 24 }).axes.length).toBe(5);
  });
});

describe('figTornado', () => {
  const bars = [
    { label: 'small', low: 9.7, high: 10.3, lowInput: '-10 %', highInput: '+10 %' },
    { label: 'large', low: 13, high: 6, lowInput: '-10 %', highInput: '+10 %' },
    { label: 'medium', low: 9, high: 11.4 },
    { label: 'broken', low: NaN, high: 12 },
  ];

  it('swing is |high - low| and zero when a value is missing', () => {
    expect(tornadoSwing(bars[1])).toBe(7);
    expect(tornadoSwing(bars[3])).toBe(0);
  });

  it('draws the largest swing on top and marks the base value', () => {
    const svg = svgOf(figTornado({ base: 10, output: '$Q$', bars, title: 'Sensitivity of Q' }));
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<title>Sensitivity of Q</title>');
    const y = (l: string) => yOfLabel(svg, l);
    expect(y('large')).toBeLessThan(y('medium'));
    expect(y('medium')).toBeLessThan(y('small'));
    expect(y('small')).toBeLessThan(y('broken')); // no swing: last
    expect(svg).toContain('<tspan>low setting</tspan>');
    expect(svg).toContain('<tspan>high setting</tspan>');
    expect(svg).toContain('+10 %'); // input setting written next to a bar end
  });

  it('maxBars keeps the largest; flat and empty inputs still render', () => {
    const svg = svgOf(figTornado({ base: 10, output: 'Q', bars, maxBars: 2 }));
    expect(svg).toContain('<tspan>large</tspan>');
    expect(svg).toContain('<tspan>medium</tspan>');
    expect(svg).not.toContain('<tspan>small</tspan>');
    expect(svgOf(figTornado({ base: 5, output: 'Q', bars: [{ label: 'flat', low: 5, high: 5 }] }))).not.toMatch(/NaN|Infinity/);
    expect(svgOf(figTornado({ base: 5, output: 'Q', bars: [] }))).not.toMatch(/NaN|Infinity/);
    expect(svgOf(figTornado({ base: 0, output: 'Q', bars: [{ label: 'zero', low: 0, high: 0 }] }))).not.toMatch(/NaN|Infinity/);
  });
});
