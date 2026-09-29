/**
 * Orbit camera and the small amount of matrix algebra the 3D view needs (column-major 4x4 matrices, the WebGL convention).
 * The world is z-up: the torus axis is z, the camera orbits a target point at azimuth / elevation.
 */
import type { Vec3 } from './mesh';

export type Mat4 = Float32Array;

export interface OrbitCamera {
  /** angle of the eye around the z axis [rad], 0 = looking from +x */
  azimuth: number;
  /** angle of the eye above the xy plane [rad], limited to +-MAX_ELEVATION */
  elevation: number;
  /** eye distance from the target */
  distance: number;
  target: Vec3;
  /** vertical field of view [rad] */
  fovY: number;
}

export const DEFAULT_FOV = (40 * Math.PI) / 180;
export const MAX_ELEVATION = (86 * Math.PI) / 180;

export const identity = (): Mat4 => Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** a * b (apply b first) */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return Float32Array.of(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = norm(sub(target, eye)), s = norm(cross(f, up)), u = cross(s, f);
  return Float32Array.of(s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1);
}

/** m * (x, y, z, 1) */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

export function eyeOf(c: OrbitCamera): Vec3 {
  const ce = Math.cos(c.elevation);
  return [
    c.target[0] + c.distance * ce * Math.cos(c.azimuth),
    c.target[1] + c.distance * ce * Math.sin(c.azimuth),
    c.target[2] + c.distance * Math.sin(c.elevation),
  ];
}

export function viewMatrix(c: OrbitCamera): Mat4 {
  return lookAt(eyeOf(c), c.target, [0, 0, 1]);
}

/** Clip planes from the scene radius: near enough to keep depth precision, far enough for the whole scene from any orbit angle. */
export function clipPlanes(c: OrbitCamera, sceneRadius: number): { near: number; far: number } {
  const near = Math.max(0.02 * sceneRadius, c.distance - 1.5 * sceneRadius);
  return { near, far: Math.max(near * 2, c.distance + 1.5 * sceneRadius) };
}

export function viewProjection(c: OrbitCamera, aspect: number, sceneRadius: number): Mat4 {
  const { near, far } = clipPlanes(c, sceneRadius);
  return multiply(perspective(c.fovY, aspect, near, far), viewMatrix(c));
}

/** The camera that frames a bounding sphere, looking at the given azimuth from a raised angle. */
export function fitCamera(center: Vec3, radius: number, azimuth = 0, elevation = (26 * Math.PI) / 180, fovY = DEFAULT_FOV): OrbitCamera {
  return { azimuth, elevation, distance: (radius / Math.sin(fovY / 2)) * 1.05, target: [...center] as Vec3, fovY };
}

const TWO_PI = 2 * Math.PI;

/** Turn the eye by (dAzimuth, dElevation) rad; the azimuth wraps, the elevation is kept below the poles. */
export function orbit(c: OrbitCamera, dAzimuth: number, dElevation: number): OrbitCamera {
  let az = (c.azimuth + dAzimuth) % TWO_PI;
  if (az < 0) az += TWO_PI;
  return { ...c, azimuth: az, elevation: Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, c.elevation + dElevation)) };
}

/** Multiply the eye distance by `factor` (< 1 moves closer), within [minDistance, maxDistance]. */
export function zoom(c: OrbitCamera, factor: number, minDistance: number, maxDistance: number): OrbitCamera {
  return { ...c, distance: Math.max(minDistance, Math.min(maxDistance, c.distance * factor)) };
}

/** Move the target in the image plane by (dx, dy) in units of `worldPerPixel`, the panned point staying within `limit` of `home`. */
export function pan(c: OrbitCamera, dxPixels: number, dyPixels: number, worldPerPixel: number, home: Vec3, limit: number): OrbitCamera {
  const eye = eyeOf(c), f = norm(sub(c.target, eye)), s = norm(cross(f, [0, 0, 1])), u = cross(s, f);
  const t: Vec3 = [
    c.target[0] - (dxPixels * s[0] - dyPixels * u[0]) * worldPerPixel,
    c.target[1] - (dxPixels * s[1] - dyPixels * u[1]) * worldPerPixel,
    c.target[2] - (dxPixels * s[2] - dyPixels * u[2]) * worldPerPixel,
  ];
  const d = sub(t, home), len = Math.hypot(d[0], d[1], d[2]);
  if (len > limit) for (let k = 0; k < 3; k++) t[k] = home[k] + (d[k] * limit) / len;
  return { ...c, target: t };
}

/** World size of one pixel at the target distance (for panning). */
export function worldPerPixel(c: OrbitCamera, viewportHeightPx: number): number {
  return (2 * c.distance * Math.tan(c.fovY / 2)) / Math.max(1, viewportHeightPx);
}
