import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOV, MAX_ELEVATION, clipPlanes, eyeOf, fitCamera, identity, lookAt, multiply, orbit, pan, perspective, transformPoint, viewMatrix,
  viewProjection, worldPerPixel, zoom,
} from './camera';

const near = (a: ArrayLike<number>, b: ArrayLike<number>, d = 5) => { for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], d); };

describe('matrices', () => {
  it('multiply: identity is neutral and the product applies the right factor first', () => {
    const t = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1); // translate (5, 6, 7)
    const s = Float32Array.of(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1); // scale 2
    near(multiply(identity(), t), t);
    near(multiply(t, identity()), t);
    // t * s: scale first, then translate
    near(transformPoint(multiply(t, s), [1, 1, 1]), [7, 8, 9, 1]);
    near(transformPoint(multiply(s, t), [1, 1, 1]), [12, 14, 16, 1]);
  });

  it('lookAt puts the target on the -z axis at the eye distance and keeps the up vector up', () => {
    const v = lookAt([10, 0, 0], [0, 0, 0], [0, 0, 1]);
    near(transformPoint(v, [0, 0, 0]), [0, 0, -10, 1]);
    near(transformPoint(v, [0, 0, 1]), [0, 1, -10, 1]); // +z of the world is +y of the view
    near(transformPoint(v, [0, 1, 0]), [1, 0, -10, 1]); // looking from +x towards the origin, +y of the world is to the right
    near(transformPoint(v, [10, 0, 0]), [0, 0, 0, 1]);
  });

  it('perspective maps the near and far planes to -1 and +1 and divides by the distance', () => {
    const p = perspective(Math.PI / 2, 2, 1, 11);
    const n = transformPoint(p, [0, 0, -1]), f = transformPoint(p, [0, 0, -11]);
    expect(n[2] / n[3]).toBeCloseTo(-1, 6);
    expect(f[2] / f[3]).toBeCloseTo(1, 5);
    // 90 degree vertical field of view: a point at (0, d, -d) is at the top edge, y = 1; aspect 2 halves x
    const e = transformPoint(p, [0, 4, -4]);
    expect(e[1] / e[3]).toBeCloseTo(1, 6);
    const x = transformPoint(p, [4, 0, -4]);
    expect(x[0] / x[3]).toBeCloseTo(0.5, 6);
  });
});

describe('orbit camera', () => {
  const cam = fitCamera([1, 2, 3], 10, 0.5);

  it('fitCamera frames the bounding sphere: it just fits the vertical field of view', () => {
    expect(cam.target).toEqual([1, 2, 3]);
    expect(cam.fovY).toBe(DEFAULT_FOV);
    expect(Math.asin(10 / cam.distance)).toBeLessThan(DEFAULT_FOV / 2);
    expect(Math.asin(10 / cam.distance)).toBeGreaterThan(0.9 * (DEFAULT_FOV / 2));
  });

  it('the eye is at the given azimuth and elevation, distance away from the target', () => {
    const c = { ...cam, azimuth: Math.PI / 2, elevation: 0, distance: 5 };
    near(eyeOf(c), [1, 7, 3]);
    const top = { ...cam, azimuth: 0, elevation: Math.PI / 2, distance: 5 };
    near(eyeOf(top), [1, 2, 8]);
    const e = eyeOf(cam);
    expect(Math.hypot(e[0] - cam.target[0], e[1] - cam.target[1], e[2] - cam.target[2])).toBeCloseTo(cam.distance, 9);
  });

  it('the view matrix sends the target to the centre of the view, straight ahead', () => {
    const p = transformPoint(viewMatrix(cam), cam.target);
    near(p, [0, 0, -cam.distance, 1]);
    const vp = viewProjection(cam, 1.5, 10), q = transformPoint(vp, cam.target);
    expect(q[0] / q[3]).toBeCloseTo(0, 6); expect(q[1] / q[3]).toBeCloseTo(0, 6);
    expect(Math.abs(q[2] / q[3])).toBeLessThan(1);
  });

  it('orbit wraps the azimuth into [0, 2 pi) and clamps the elevation below the poles', () => {
    expect(orbit(cam, -1, 0).azimuth).toBeCloseTo(0.5 - 1 + 2 * Math.PI, 12);
    expect(orbit(cam, 7, 0).azimuth).toBeCloseTo((0.5 + 7) % (2 * Math.PI), 12);
    expect(orbit(cam, 0, 10).elevation).toBe(MAX_ELEVATION);
    expect(orbit(cam, 0, -10).elevation).toBe(-MAX_ELEVATION);
    expect(orbit(cam, 0.1, 0.1).distance).toBe(cam.distance);
  });

  it('zoom multiplies the distance within limits', () => {
    expect(zoom(cam, 0.5, 1, 1000).distance).toBeCloseTo(cam.distance * 0.5, 9);
    expect(zoom(cam, 1e-6, 3, 1000).distance).toBe(3);
    expect(zoom(cam, 1e6, 3, 1000).distance).toBe(1000);
  });

  it('pan moves the target in the image plane and stays within the limit of home', () => {
    const c = { ...cam, azimuth: 0, elevation: 0, target: [0, 0, 0] as [number, number, number], distance: 10 };
    // looking from +x: image right is +y, image up is +z; dragging right by 10 px moves the scene right, so the target moves to -y
    const p = pan(c, 10, 0, 0.1, [0, 0, 0], 100);
    near(p.target, [0, -1, 0]);
    const q = pan(c, 0, 10, 0.1, [0, 0, 0], 100); // dragging down moves the target up
    near(q.target, [0, 0, 1]);
    const far = pan(c, 1e6, 0, 1, [0, 0, 0], 5);
    expect(Math.hypot(far.target[0], far.target[1], far.target[2])).toBeCloseTo(5, 9);
    expect(worldPerPixel(c, 500)).toBeCloseTo((2 * 10 * Math.tan(DEFAULT_FOV / 2)) / 500, 12);
    expect(worldPerPixel(c, 0)).toBeGreaterThan(0);
  });

  it('clip planes keep the scene between near and far from any distance', () => {
    for (const d of [5, 25, 200]) {
      const { near: n, far: f } = clipPlanes({ ...cam, distance: d }, 10);
      expect(n).toBeGreaterThan(0);
      expect(f).toBeGreaterThan(n);
      expect(f).toBeGreaterThanOrEqual(d + 10); // the far side of the sphere
      if (d > 20) expect(n).toBeLessThanOrEqual(d - 10);
    }
  });
});
