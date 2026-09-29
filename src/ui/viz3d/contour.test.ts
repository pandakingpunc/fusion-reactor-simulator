import { describe, expect, it } from 'vitest';
import { millerBoundary, shapeIntegrals } from '../../physics/equilibrium/miller';
import {
  Contour, R_MIN, centroid, contourLength, millerAxis, millerContour, millerShift, offsetContour, outwardNormals, pointInPolygon,
  resampleByAngle, revolvedVolume, scaleAbout, signedArea, toContour,
} from './contour';

const ellipse = (R0: number, Z0: number, a: number, b: number, n: number): Contour => {
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let j = 0; j < n; j++) { const t = (2 * Math.PI * j) / n; R[j] = R0 + a * Math.cos(t); Z[j] = Z0 + b * Math.sin(t); }
  return { R, Z };
};

describe('polygon measures', () => {
  it('area, centroid, length and revolved volume of an ellipse', () => {
    const c = ellipse(6, 0.5, 2, 3, 720);
    expect(signedArea(c)).toBeCloseTo(Math.PI * 2 * 3, 3);
    const m = centroid(c);
    expect(m[0]).toBeCloseTo(6, 6); expect(m[1]).toBeCloseTo(0.5, 6);
    // Ramanujan's approximation of the perimeter
    const A = 2, B = 3, h = ((A - B) / (A + B)) ** 2;
    expect(contourLength(c)).toBeCloseTo(Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), 2);
    // Pappus: V = 2 pi R A
    expect(Math.abs(revolvedVolume(c) / (2 * Math.PI * 6 * Math.PI * 6) - 1)).toBeLessThan(2e-5);
  });

  it('tests points against the polygon', () => {
    const c = ellipse(6, 0, 2, 3, 64);
    expect(pointInPolygon(c, [6, 0])).toBe(true);
    expect(pointInPolygon(c, [7.9, 0])).toBe(true);
    expect(pointInPolygon(c, [8.2, 0])).toBe(false);
    expect(pointInPolygon(c, [6, 3.1])).toBe(false);
  });
});

describe('toContour', () => {
  it('drops a repeated closing vertex and turns a clockwise polygon counter-clockwise', () => {
    const sq = { R: [1, 2, 2, 1, 1], Z: [0, 0, 1, 1, 0] };
    const c = toContour(sq.R, sq.Z)!;
    expect(c.R.length).toBe(4);
    expect(signedArea(c)).toBeCloseTo(1, 12);
    const cw = toContour(sq.R.slice(0, 4).reverse(), sq.Z.slice(0, 4).reverse())!;
    expect(signedArea(cw)).toBeCloseTo(1, 12);
  });

  it('rejects unusable input', () => {
    expect(toContour([1, 2, 3], [0, 1, 0])).toBeNull(); // too few vertices
    expect(toContour([1, 2, 2, NaN], [0, 0, 1, 1])).toBeNull();
    expect(toContour([1, 2, 2, 0], [0, 0, 1, 1])).toBeNull(); // reaches the axis
    expect(toContour([1, 2, 3, 4], [0, 0, 0, 0])).toBeNull(); // zero area
    expect(toContour([1, 2, 2, 1, 1], [0, 0, 1, 1, 0].map((z) => z * 0))).toBeNull();
  });
});

describe('resampleByAngle', () => {
  it('samples a star-shaped contour on equal polar angles about the axis', () => {
    const c = ellipse(6, 0, 2, 3, 200);
    const axis: [number, number] = [6.3, 0.2];
    const r = resampleByAngle(c, axis, 48)!;
    expect(r.R.length).toBe(48);
    for (let j = 0; j < 48; j++) {
      const th = (2 * Math.PI * j) / 48;
      expect(Math.atan2(r.Z[j] - axis[1], r.R[j] - axis[0])).toBeCloseTo(Math.atan2(Math.sin(th), Math.cos(th)), 9);
      // on the ellipse (the 200-gon lies within its own sagitta of it)
      expect(Math.abs(((r.R[j] - 6) / 2) ** 2 + (r.Z[j] / 3) ** 2 - 1)).toBeLessThan(2e-3);
    }
    expect(signedArea(r)).toBeCloseTo(Math.PI * 6, 0);
  });

  it('returns null when the axis is outside the polygon', () => {
    expect(resampleByAngle(ellipse(6, 0, 2, 3, 100), [20, 0], 16)).toBeNull();
  });

  it('is independent of the direction the polygon was given in', () => {
    const c = ellipse(6, 0, 2, 3, 100);
    const rev: Contour = { R: Float64Array.from(c.R).reverse(), Z: Float64Array.from(c.Z).reverse() };
    const a = resampleByAngle(toContour(rev.R, rev.Z)!, [6, 0], 24)!, b = resampleByAngle(c, [6, 0], 24)!;
    for (let j = 0; j < 24; j++) { expect(a.R[j]).toBeCloseTo(b.R[j], 9); expect(a.Z[j]).toBeCloseTo(b.Z[j], 9); }
  });
});

describe('outward normals, offset and scaling', () => {
  it('normals of a counter-clockwise ellipse point away from its centre', () => {
    const c = ellipse(6, 0, 2, 3, 96);
    const { nR, nZ } = outwardNormals(c);
    for (let j = 0; j < 96; j++) {
      expect(Math.hypot(nR[j], nZ[j])).toBeCloseTo(1, 9);
      expect(nR[j] * (c.R[j] - 6) + nZ[j] * c.Z[j]).toBeGreaterThan(0);
    }
  });

  it('an outward offset of a circle is a larger circle; a negative offset a smaller one; R stays positive', () => {
    const c = ellipse(6, 0, 2, 2, 720);
    const o = offsetContour(c, 0.5);
    for (let j = 0; j < 720; j += 37) expect(Math.hypot(o.R[j] - 6, o.Z[j])).toBeCloseTo(2.5, 4);
    const i = offsetContour(c, -0.5);
    expect(Math.hypot(i.R[10] - 6, i.Z[10])).toBeCloseTo(1.5, 4);
    const big = offsetContour(ellipse(1, 0, 0.5, 0.5, 64), -5);
    expect(Math.min(...big.R)).toBeGreaterThanOrEqual(R_MIN);
  });

  it('scales about a point', () => {
    const c = ellipse(6, 0, 2, 3, 64);
    const s = scaleAbout(c, [6, 0], 0.5);
    expect(signedArea(s)).toBeCloseTo(0.25 * signedArea(c), 9);
    expect(s.R[0]).toBeCloseTo(7, 9);
  });
});

describe('Miller surfaces', () => {
  const shapes = [
    { name: 'ITER', R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 },
    { name: 'SPARC', R: 1.85, a: 0.57, kappa: 1.97, delta: 0.54 },
    { name: 'MAST-U', R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 },
    { name: 'W7-X', R: 5.5, a: 0.53, kappa: 1.0, delta: 0 },
    { name: 'negative triangularity', R: 3, a: 1, kappa: 1.5, delta: -0.4 },
  ];

  it('the boundary is the analytic Miller boundary point for point', () => {
    for (const g of shapes) {
      const c = millerContour(g, 1, 64);
      const b = millerBoundary(g);
      for (let j = 0; j < 64; j++) {
        const [r, z] = b.point((2 * Math.PI * j) / 64);
        expect(c.R[j]).toBeCloseTo(r, 12); expect(c.Z[j]).toBeCloseTo(z, 12);
      }
    }
  });

  it('the revolved volume of the boundary equals the Miller volume (Green/Pappus) to 0.2 %', () => {
    for (const g of shapes) {
      const ref = shapeIntegrals(millerBoundary(g)).volume;
      expect(Math.abs(revolvedVolume(millerContour(g, 1, 128)) / ref - 1), g.name).toBeLessThan(2e-3);
    }
  });

  it('surfaces nest, are counter-clockwise, and shift towards the outboard side inside', () => {
    const g = shapes[0];
    let prev = 0;
    for (let i = 1; i <= 10; i++) {
      const rho = i / 10, c = millerContour(g, rho, 96, millerShift(g, rho));
      const A = signedArea(c);
      expect(A).toBeGreaterThan(prev);
      prev = A;
    }
    expect(millerShift(g, 1)).toBe(0);
    expect(millerShift(g, 0)).toBeCloseTo(0.06 * g.a, 12);
    expect(millerAxis(g)).toEqual([g.R + 0.06 * g.a, 0]);
  });

  it('every Miller surface is star-shaped about the model axis (the polar resampling finds a point at every angle)', () => {
    for (const g of shapes) {
      for (const rho of [0.1, 0.5, 1]) {
        const c = millerContour(g, rho, 200, millerShift(g, rho));
        expect(resampleByAngle(c, millerAxis(g), 64), `${g.name} ${rho}`).not.toBeNull();
      }
    }
  });
});
