/**
 * Poloidal contours (closed curves in the (R, Z) plane) of the 3D view: flux surfaces from an equilibrium snapshot,
 * Miller surfaces from the shape parameters, and the operations the mesh generators need (orientation, resampling on a common
 * polar grid, outward offset). Pure functions on plain arrays.
 *
 * A `Contour` is a closed polygon whose closing vertex is NOT repeated, oriented counter-clockwise in (R, Z) (positive area),
 * with R > 0 everywhere. Contours resampled by `resampleByAngle` about the same axis share their parametrisation: vertex j of
 * every surface lies on the same ray from the axis, which is what lets a mesh join two neighbouring surfaces vertex by vertex.
 */

export interface Contour {
  R: Float64Array;
  Z: Float64Array;
}

export type Point2 = readonly [number, number];

/** the smallest R the 3D view accepts (a contour that reaches the torus axis would collapse a lathe ring to a point) */
export const R_MIN = 1e-3;

export function signedArea(c: Contour): number {
  const n = c.R.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    s += c.R[i] * c.Z[j] - c.R[j] * c.Z[i];
  }
  return 0.5 * s;
}

/** Length of the closed polygon. */
export function contourLength(c: Contour): number {
  const n = c.R.length;
  let s = 0;
  for (let i = 0; i < n; i++) { const j = i + 1 === n ? 0 : i + 1; s += Math.hypot(c.R[j] - c.R[i], c.Z[j] - c.Z[i]); }
  return s;
}

/** Volume of the solid of revolution of the polygon about the z axis (Pappus: V = 2 pi R_centroid A), exact for the polygon. */
export function revolvedVolume(c: Contour): number {
  const n = c.R.length;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    // integral of R over the polygon: (1/6) sum (R_i + R_j) (R_i Z_j - R_j Z_i)
    v += (c.R[i] + c.R[j]) * (c.R[i] * c.Z[j] - c.R[j] * c.Z[i]);
  }
  return (2 * Math.PI * v) / 6;
}

/**
 * Validated, oriented copy of raw R/Z arrays (a snapshot from the equilibrium): a repeated closing vertex is dropped, the
 * orientation made counter-clockwise. Returns null when the polygon cannot be used (fewer than 4 vertices, a non-finite
 * coordinate, R <= R_MIN, zero area).
 */
export function toContour(R: ArrayLike<number>, Z: ArrayLike<number>): Contour | null {
  let n = Math.min(R.length, Z.length);
  if (n < 4) return null;
  for (let i = 0; i < n; i++) if (!Number.isFinite(R[i]) || !Number.isFinite(Z[i]) || R[i] <= R_MIN) return null;
  const scale = Math.max(...Array.from({ length: n }, (_, i) => Math.abs(R[i])), 1e-9);
  if (Math.hypot(R[0] - R[n - 1], Z[0] - Z[n - 1]) < 1e-9 * scale) n--;
  if (n < 4) return null;
  const c: Contour = { R: Float64Array.from(Array.prototype.slice.call(R, 0, n) as number[]), Z: Float64Array.from(Array.prototype.slice.call(Z, 0, n) as number[]) };
  const a = signedArea(c);
  if (!(Math.abs(a) > 1e-12 * scale * scale)) return null;
  if (a < 0) { c.R.reverse(); c.Z.reverse(); }
  return c;
}

/**
 * The polygon sampled at `n` equal steps of the polar angle about `axis` (angle 0 = +R direction, counter-clockwise): vertex j is
 * where the ray from the axis at angle 2 pi j / n leaves the polygon. Needs a contour that is star-shaped about the axis, as
 * every flux surface around the magnetic axis is; returns null when a ray meets no edge (the axis is outside the polygon).
 */
export function resampleByAngle(c: Contour, axis: Point2, n: number): Contour | null {
  const m = c.R.length;
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const th = (2 * Math.PI * j) / n;
    const dx = Math.cos(th), dy = Math.sin(th);
    let best = -1;
    for (let i = 0; i < m; i++) {
      const k = i + 1 === m ? 0 : i + 1;
      const ex = c.R[k] - c.R[i], ey = c.Z[k] - c.Z[i];
      const wx = c.R[i] - axis[0], wy = c.Z[i] - axis[1];
      const den = dx * ey - dy * ex; // cross(d, e)
      if (Math.abs(den) < 1e-300) continue;
      const s = (wx * ey - wy * ex) / den; // cross(w, e) / cross(d, e)
      const u = (wx * dy - wy * dx) / den; // cross(w, d) / cross(d, e)
      // a ray through a vertex meets both edges there: a small tolerance keeps rounding from missing both
      if (u >= -1e-9 && u <= 1 + 1e-9 && s > 0 && s > best) best = s;
    }
    if (best < 0) return null;
    R[j] = axis[0] + best * dx; Z[j] = axis[1] + best * dy;
  }
  return { R, Z };
}

/** Unit outward normals of a counter-clockwise polygon, per vertex (from the chord between its neighbours). */
export function outwardNormals(c: Contour): { nR: Float64Array; nZ: Float64Array } {
  const n = c.R.length;
  const nR = new Float64Array(n), nZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? n - 1 : i - 1, q = i + 1 === n ? 0 : i + 1;
    const tR = c.R[q] - c.R[p], tZ = c.Z[q] - c.Z[p];
    const len = Math.hypot(tR, tZ) || 1;
    nR[i] = tZ / len; nZ[i] = -tR / len;
  }
  return { nR, nZ };
}

/** The polygon moved by `d` along its outward vertex normals (d < 0: inwards); R is kept above R_MIN. */
export function offsetContour(c: Contour, d: number): Contour {
  const { nR, nZ } = outwardNormals(c);
  const n = c.R.length;
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i++) { R[i] = Math.max(R_MIN, c.R[i] + d * nR[i]); Z[i] = c.Z[i] + d * nZ[i]; }
  return { R, Z };
}

/** The polygon scaled by `s` about `axis` (disruption collapse of the plasma and similar). */
export function scaleAbout(c: Contour, axis: Point2, s: number): Contour {
  const n = c.R.length;
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i++) { R[i] = Math.max(R_MIN, axis[0] + s * (c.R[i] - axis[0])); Z[i] = axis[1] + s * (c.Z[i] - axis[1]); }
  return { R, Z };
}

/** Is `p` inside the polygon (even-odd rule)? */
export function pointInPolygon(c: Contour, p: Point2): boolean {
  const n = c.R.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = c.Z[i], yj = c.Z[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((c.R[j] - c.R[i]) * (p[1] - yi)) / (yj - yi) + c.R[i]) inside = !inside;
  }
  return inside;
}

/** Centroid of the polygon area. */
export function centroid(c: Contour): Point2 {
  const n = c.R.length;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const cr = c.R[i] * c.Z[j] - c.R[j] * c.Z[i];
    a += cr; cx += (c.R[i] + c.R[j]) * cr; cy += (c.Z[i] + c.Z[j]) * cr;
  }
  return a === 0 ? [c.R[0], c.Z[0]] : [cx / (3 * a), cy / (3 * a)];
}

export interface MillerShape {
  R: number; a: number; kappa: number; delta: number;
}

/** Shafranov shift of the model surface rho (0 at the boundary): the same law as the 2D cross-section, 0.06 a (1 - rho^2). */
export function millerShift(g: MillerShape, rho: number): number {
  return 0.06 * g.a * (1 - rho * rho);
}

/**
 * Miller surface (Miller et al., Phys. Plasmas 5 (1998) 973) of minor radius rho a, in n equal steps of the poloidal angle tau:
 *   R = R0 + shift + rho a cos(tau + arcsin(delta rho) sin tau),  Z = rho kappa a sin(tau).
 * rho = 1 with no shift is the plasma boundary, so its area and volume are those of the analytic Miller boundary
 * (physics/equilibrium/miller.ts uses the same parametrisation, with delta limited to +-0.95 as here).
 */
export function millerContour(g: MillerShape, rho: number, n: number, shift = 0): Contour {
  const delta = Math.max(-0.95, Math.min(0.95, g.delta));
  const xd = Math.asin(Math.max(-0.95, Math.min(0.95, delta * rho)));
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const tau = (2 * Math.PI * j) / n, s = Math.sin(tau);
    R[j] = Math.max(R_MIN, g.R + shift + rho * g.a * Math.cos(tau + xd * s));
    Z[j] = rho * g.kappa * g.a * s;
  }
  return { R, Z };
}

/**
 * Where the magnetic axis of a Miller model sits: on the midplane at the shifted centre. The rays of `resampleByAngle` and the
 * cap fans of the lathe generator start here.
 */
export function millerAxis(g: MillerShape): Point2 {
  return [g.R + millerShift(g, 0), 0];
}
