import { describe, expect, it } from 'vitest';
import { richardson } from './richardson';

describe('Richardson extrapolation from three resolutions', () => {
  it('recovers order, limit and error of f = f0 + C h^p for equal and unequal refinement ratios', () => {
    const quad = (h: number) => 1 + 2 * h * h;
    const a = richardson([0.4, 0.2, 0.1], [quad(0.4), quad(0.2), quad(0.1)]);
    expect(a.kind).toBe('monotone');
    expect(a.p).toBeCloseTo(2, 8);
    expect(a.extrapolated).toBeCloseTo(1, 10);
    expect(a.error).toBeCloseTo(0.02, 10);
    // GCI = 1.25 |f2 − f3| / |f3| / (2² − 1)
    expect(a.gci).toBeCloseTo((1.25 * (quad(0.2) - quad(0.1))) / quad(0.1) / 3, 10);

    const lin = (h: number) => 3 - 0.7 * h;
    const b = richardson([0.5, 0.05, 0.01], [lin(0.5), lin(0.05), lin(0.01)]);
    expect(b.p).toBeCloseTo(1, 8);
    expect(b.extrapolated).toBeCloseTo(3, 10);
    expect(b.error).toBeCloseTo(0.007, 10);

    // radial grid 25/50/100 cells: h = 1/N
    const c = richardson([1 / 25, 1 / 50, 1 / 100], [5 + 40 / 25 ** 1.5, 5 + 40 / 50 ** 1.5, 5 + 40 / 100 ** 1.5]);
    expect(c.p).toBeCloseTo(1.5, 8);
    expect(c.extrapolated).toBeCloseTo(5, 10);
  });

  it('flags oscillatory, converged and unfittable sequences with a conservative bound', () => {
    const o = richardson([0.4, 0.2, 0.1], [1, 2, 1.5]);
    expect(o.kind).toBe('oscillatory');
    expect(o.p).toBeNaN();
    expect(o.error).toBe(1);
    expect(richardson([0.4, 0.2, 0.1], [2, 2, 2])).toMatchObject({ kind: 'converged', error: 0, extrapolated: 2 });
    // differences growing under refinement: no positive order fits
    expect(richardson([0.4, 0.2, 0.1], [1, 1.01, 1.5]).kind).toBe('no-fit');
    expect(richardson([0.4, 0.2, 0.1], [1, NaN, 1]).error).toBeNaN();
    expect(() => richardson([0.1, 0.2, 0.4], [1, 2, 3])).toThrow(/h1 > h2 > h3/);
  });
});
