import { describe, expect, it } from 'vitest';
import { Contour, contourLength, offsetContour, resampleByAngle, revolvedVolume, signedArea } from './contour';
import { TWO_PI, capBand, capFan, latheShell, latheSolid, sweepTube } from './lathe';
import { Mesh, checkTopology, meshArea, meshVolume, normalsAgreeFraction, outwardFraction, triangleCount, vertexCount } from './mesh';

const ellipse = (R0: number, Z0: number, a: number, b: number, n: number): Contour => {
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let j = 0; j < n; j++) { const t = (2 * Math.PI * j) / n; R[j] = R0 + a * Math.cos(t); Z[j] = Z0 + b * Math.sin(t); }
  return { R, Z };
};

/** the point of the axis circle in the plane of (x, y): a point inside a lathe solid, near the given position */
const onAxisCircle = (Ra: number, Za: number) => (x: number, y: number): [number, number, number] => {
  const p = Math.atan2(y, x);
  return [Ra * Math.cos(p), Ra * Math.sin(p), Za];
};

describe('latheShell', () => {
  const c = ellipse(6, 0, 2, 3, 64);

  it('a full turn is a closed torus with the volume 2 pi R_c A of Pappus (0.1 % at 64 x 128)', () => {
    const m = latheShell(c, { nPhi: 128 });
    expect(vertexCount(m)).toBe(64 * 128);
    expect(triangleCount(m)).toBe(2 * 64 * 128);
    const t = checkTopology(m);
    expect(t).toMatchObject({ openEdges: 0, badEdges: 0, degenerate: 0, closed: true });
    expect(Math.abs(meshVolume(m) / revolvedVolume(c) - 1)).toBeLessThan(1e-3);
    expect(Math.abs(meshVolume(m) / (2 * Math.PI * 6 * Math.PI * 6) - 1)).toBeLessThan(5e-3);
  });

  it('winds outwards: the face normals point away from the axis circle and agree with the stored normals', () => {
    const m = latheShell(c, { nPhi: 48 });
    expect(outwardFraction(m, onAxisCircle(6, 0))).toBe(1);
    expect(normalsAgreeFraction(m)).toBe(1);
    // stored normals are unit vectors
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 5);
  });

  it('a partial range has open rims until the caps are added', () => {
    const o = { nPhi: 40, phi0: 0.5, phi1: 0.5 + 4.2 };
    const shell = latheShell(c, o);
    expect(vertexCount(shell)).toBe(64 * 41);
    const t = checkTopology(shell);
    expect(t.closed).toBe(false);
    expect(t.openEdges).toBe(2 * 64);
    const solid = latheSolid(c, [6, 0], o);
    expect(checkTopology(solid)).toMatchObject({ closed: true, openEdges: 0, badEdges: 0 });
    // closed and consistently wound with a positive volume, the caps included: outward everywhere
    expect(meshVolume(solid)).toBeGreaterThan(0);
    expect(normalsAgreeFraction(solid)).toBe(1);
    // the volume of the wedge-shaped part is the fraction of the full turn
    const full = meshVolume(latheShell(c, { nPhi: 160 }));
    expect(meshVolume(solid) / full).toBeCloseTo(4.2 / TWO_PI, 2);
  });

  it('covers the swept range exactly: first and last ring lie in the planes phi0 and phi1', () => {
    const m = latheShell(c, { nPhi: 10, phi0: 1, phi1: 2 });
    const p = m.positions;
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(1, 6);
    const last = 3 * (64 * 10);
    expect(Math.atan2(p[last + 1], p[last])).toBeCloseTo(2, 6);
  });

  it('works for a contour with a sharp point (an X-point)', () => {
    const R = new Float64Array(40), Z = new Float64Array(40);
    for (let j = 0; j < 40; j++) {
      const t = (TWO_PI * j) / 40, st = Math.sin(t);
      R[j] = 6 + 2 * Math.cos(t + 0.3 * st);
      Z[j] = 3 * st * (st < 0 ? 1 + 0.12 * Math.pow(-st, 8) : 1);
    }
    const m = latheShell({ R, Z }, { nPhi: 32 });
    expect(checkTopology(m).closed).toBe(true);
    expect(meshVolume(m)).toBeGreaterThan(0);
    expect(outwardFraction(m, onAxisCircle(6, 0))).toBe(1);
  });
});

describe('capFan and capBand', () => {
  const inner = ellipse(6, 0, 1, 1.5, 32), outer = ellipse(6, 0, 2, 3, 32);

  it('the fan covers the polygon and faces the requested side', () => {
    const phi = 0.8;
    for (const facing of [1, -1] as const) {
      const m = capFan(outer, [6, 0], phi, facing);
      expect(Math.abs(meshArea(m) / signedArea(outer) - 1)).toBeLessThan(1e-6);
      const want = [-Math.sin(phi) * facing, Math.cos(phi) * facing];
      // geometric normal of the first triangle
      const p = m.positions, ix = m.indices;
      const u = [p[3 * ix[1]] - p[3 * ix[0]], p[3 * ix[1] + 1] - p[3 * ix[0] + 1], p[3 * ix[1] + 2] - p[3 * ix[0] + 2]];
      const v = [p[3 * ix[2]] - p[3 * ix[0]], p[3 * ix[2] + 1] - p[3 * ix[0] + 1], p[3 * ix[2] + 2] - p[3 * ix[0] + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      expect(n[0] / l).toBeCloseTo(want[0], 5); expect(n[1] / l).toBeCloseTo(want[1], 5); expect(n[2] / l).toBeCloseTo(0, 5);
      expect(normalsAgreeFraction(m)).toBe(1);
    }
  });

  it('the band is the area between the two contours and faces the requested side', () => {
    for (const facing of [1, -1] as const) {
      const m = capBand(inner, outer, 0, facing);
      expect(Math.abs(meshArea(m) / (signedArea(outer) - signedArea(inner)) - 1)).toBeLessThan(1e-6);
      expect(normalsAgreeFraction(m)).toBe(1);
      // facing +1 at phi = 0 is +y
      expect(m.normals[1]).toBe(facing);
    }
    expect(() => capBand(inner, ellipse(6, 0, 2, 3, 16), 0, 1)).toThrow(/differ in size/);
  });
});

describe('sweepTube', () => {
  const path = ellipse(6, 0, 2.5, 3.5, 96);
  const r = 0.4;

  it('is a closed torus with outward normals and the volume pi r^2 L', () => {
    const m = sweepTube(path, 0.7, r, 16);
    expect(vertexCount(m)).toBe(96 * 16);
    expect(checkTopology(m)).toMatchObject({ closed: true, openEdges: 0, badEdges: 0, degenerate: 0 });
    // the section circle is a 16-gon: its area is (n / 2 pi) sin(2 pi / n) of the circle's
    const poly = (16 / TWO_PI) * Math.sin(TWO_PI / 16);
    const rel = meshVolume(m) / (poly * Math.PI * r * r * contourLength(path)) - 1;
    expect(Math.abs(rel)).toBeLessThan(0.01);
    expect(normalsAgreeFraction(m)).toBe(1);
  });

  it('every face points away from the centre line (nearest point of the path in its plane)', () => {
    const phi = 2.1;
    const m = sweepTube(path, phi, r, 12);
    const near = (x: number, y: number, z: number): [number, number, number] => {
      const R = Math.hypot(x, y);
      let best = 0, bd = Infinity;
      for (let j = 0; j < path.R.length; j++) { const d = Math.hypot(path.R[j] - R, path.Z[j] - z); if (d < bd) { bd = d; best = j; } }
      return [path.R[best] * Math.cos(phi), path.R[best] * Math.sin(phi), path.Z[best]];
    };
    expect(outwardFraction(m, near)).toBe(1);
  });

  it('lies in the plane of its toroidal angle: the ring centres are at phi and the section extends by r on either side', () => {
    const phi = 1.2;
    const m = sweepTube(path, phi, r, 8);
    let maxOff = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const off = -Math.sin(phi) * m.positions[i] + Math.cos(phi) * m.positions[i + 1]; // component along phi-hat
      maxOff = Math.max(maxOff, Math.abs(off));
    }
    expect(maxOff).toBeCloseTo(r, 6);
  });

  it('a tube around a resampled, offset flux contour is still closed and outward', () => {
    const lcfs = resampleByAngle(ellipse(6, 0, 2, 3, 200), [6, 0], 48)!;
    const centre = offsetContour(lcfs, 1.2 + 0.45);
    const m: Mesh = sweepTube(centre, 0, 0.45, 10);
    expect(checkTopology(m).closed).toBe(true);
    const poly = (10 / TWO_PI) * Math.sin(TWO_PI / 10);
    expect(Math.abs(meshVolume(m) / (poly * Math.PI * 0.45 * 0.45 * contourLength(centre)) - 1)).toBeLessThan(0.02);
  });
});
