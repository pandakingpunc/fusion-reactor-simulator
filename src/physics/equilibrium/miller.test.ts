import { describe, expect, it } from 'vitest';
import { ShapeBoundary, millerBoundary, shapeIntegrals } from './miller';
import { SolovevEquilibrium, solovevBoundary } from './solovev';

const shapes: [string, ShapeBoundary][] = [
  ['ITER (κ 1.7, δ 0.33)', millerBoundary({ R: 6.2, a: 2, kappa: 1.7, delta: 0.33 })],
  ['circle', millerBoundary({ R: 3, a: 1, kappa: 1, delta: 0 })],
  ['negative triangularity', millerBoundary({ R: 1.7, a: 0.6, kappa: 1.4, delta: -0.4 })],
  ['spherical tokamak (A 1.3, κ 2.5, δ 0.5)', millerBoundary({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 })],
  ["Solov'ev flux contour", solovevBoundary(new SolovevEquilibrium({ epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 }), 6.2)],
];

describe('plasma boundary crossings (Shortley–Weller input)', () => {
  it.each(shapes)('%s: rRange and zTop invert each other', (_, b) => {
    const zMax = b.kappa * b.a;
    // horizontal line → its crossings lie on vertical lines whose top is |Z| (the extreme points,
    // where dZ/dR is infinite, are excluded: there the inversion is ill-conditioned)
    for (let q = 0; q < 34; q++) {
      const Z = (q < 17 ? -1 : 1) * (0.1 + (0.8 * (q % 17)) / 16) * zMax;
      const rr = b.rRange(Z)!;
      expect(rr).not.toBeNull();
      expect(rr[0]).toBeLessThan(rr[1]);
      for (const R of rr) expect(b.zTop(R)!).toBeCloseTo(Math.abs(Z), 8);
    }
    // vertical line → the horizontal line at its top crosses the boundary at R
    const [Rin, Rout] = b.rRange(0)!;
    for (let q = 0; q <= 16; q++) {
      const R = Rin + (0.1 + (0.8 * q) / 16) * (Rout - Rin);
      const zt = b.zTop(R)!;
      expect(zt).toBeGreaterThan(0);
      if (zt > 0.98 * zMax) continue; // near the top tangent point dR/dZ is infinite
      const rr = b.rRange(zt)!;
      expect(Math.min(Math.abs(rr[0] - R), Math.abs(rr[1] - R))).toBeLessThan(1e-7 * b.a);
      // just inside / outside
      expect(b.inside(R, 0.999 * zt)).toBe(true);
      expect(b.inside(R, 1.001 * zt)).toBe(false);
    }
    expect(b.rRange(1.001 * zMax)).toBeNull();
    expect(b.zTop(Rin - 1e-3 * b.a)).toBeNull();
    expect(b.zTop(Rout + 1e-3 * b.a)).toBeNull();
  });

  it.each(shapes)('%s: parametric points lie on the crossings', (_, b) => {
    for (let t = 0.05; t < 2 * Math.PI; t += 0.3) {
      const [R, Z] = b.point(t);
      const rr = b.rRange(Z)!;
      expect(Math.min(Math.abs(rr[0] - R), Math.abs(rr[1] - R))).toBeLessThan(1e-9 * b.a);
    }
  });

  it('Miller shape integrals: circle area, volume and perimeter are exact', () => {
    const s = shapeIntegrals(millerBoundary({ R: 3, a: 1, kappa: 1, delta: 0 }));
    expect(s.area).toBeCloseTo(Math.PI, 9);
    expect(s.volume).toBeCloseTo(2 * Math.PI * Math.PI * 3, 8);
    expect(s.perimeter).toBeCloseTo(2 * Math.PI, 8);
    expect(s.Rc).toBeCloseTo(3, 9);
  });
});
