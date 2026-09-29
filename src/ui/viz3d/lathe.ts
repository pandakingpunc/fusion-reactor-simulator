/**
 * Lathing: a poloidal contour revolved about the torus axis (z) into a triangle mesh, the flat faces that close a cut-away, and
 * the tube swept along a closed curve (the toroidal field coils). See mesh.ts for the conventions (outward normals,
 * counter-clockwise winding seen from outside).
 */
import { Contour, Point2, outwardNormals } from './contour';
import { Mesh, MeshBuilder, Vec3, mergeMeshes } from './mesh';

export const TWO_PI = 2 * Math.PI;

export interface LatheOptions {
  /** segments over the swept toroidal range */
  nPhi: number;
  /** swept range [phi0, phi1] in rad (default the full turn, a closed ring) */
  phi0?: number;
  phi1?: number;
}

const isFullTurn = (phi0: number, phi1: number) => phi1 - phi0 >= TWO_PI - 1e-9;

/**
 * The surface of revolution of `c`. A full turn wraps around (no seam vertices); a partial range has two open rims, which
 * `capFan` / `capBand` close.
 */
export function latheShell(c: Contour, o: LatheOptions): Mesh {
  const n = c.R.length, nPhi = Math.max(3, Math.floor(o.nPhi));
  const phi0 = o.phi0 ?? 0, phi1 = o.phi1 ?? phi0 + TWO_PI;
  const full = isFullTurn(phi0, phi1);
  const rings = full ? nPhi : nPhi + 1;
  const { nR, nZ } = outwardNormals(c);
  const b = new MeshBuilder(rings * n, 2 * nPhi * n);
  for (let k = 0; k < rings; k++) {
    const phi = phi0 + ((phi1 - phi0) * k) / nPhi, cp = Math.cos(phi), sp = Math.sin(phi);
    for (let j = 0; j < n; j++) b.vertex(c.R[j] * cp, c.R[j] * sp, c.Z[j], nR[j] * cp, nR[j] * sp, nZ[j]);
  }
  for (let k = 0; k < nPhi; k++) {
    const k1 = full ? (k + 1) % nPhi : k + 1;
    for (let j = 0; j < n; j++) {
      const j1 = j + 1 === n ? 0 : j + 1;
      // A=(j,k) B=(j+1,k) C=(j+1,k+1) D=(j,k+1); (A, D, C) and (A, C, B) face outwards (see mesh.ts)
      b.quad(k * n + j, k1 * n + j, k1 * n + j1, k * n + j1);
    }
  }
  return b.build();
}

/** unit vector of increasing phi at `phi` */
const phiHat = (phi: number): Vec3 => [-Math.sin(phi), Math.cos(phi), 0];

/**
 * The flat face of the contour's interior in the plane phi = const, as a fan around `axis` (a point inside the contour from which
 * it is star-shaped). `facing` = +1: the face points towards increasing phi (closes the end of a swept range at phi1),
 * -1: towards decreasing phi (closes the start, at phi0).
 */
export function capFan(c: Contour, axis: Point2, phi: number, facing: 1 | -1): Mesh {
  const n = c.R.length, cp = Math.cos(phi), sp = Math.sin(phi), h = phiHat(phi);
  const b = new MeshBuilder(n + 1, n);
  const nx = facing * h[0], ny = facing * h[1];
  const centre = b.vertex(axis[0] * cp, axis[0] * sp, axis[1], nx, ny, 0);
  for (let j = 0; j < n; j++) b.vertex(c.R[j] * cp, c.R[j] * sp, c.Z[j], nx, ny, 0);
  for (let j = 0; j < n; j++) {
    const a = centre + 1 + j, d = centre + 1 + (j + 1 === n ? 0 : j + 1);
    // (R, Z) counter-clockwise has the right-hand normal R x Z = -phi
    if (facing === -1) b.triangle(centre, a, d); else b.triangle(centre, d, a);
  }
  return b.build();
}

/** The flat face between two contours with the same number of vertices (the annulus), in the plane phi = const. */
export function capBand(inner: Contour, outer: Contour, phi: number, facing: 1 | -1): Mesh {
  const n = inner.R.length;
  if (outer.R.length !== n) throw new Error(`capBand: contours differ in size (${n} vs ${outer.R.length})`);
  const cp = Math.cos(phi), sp = Math.sin(phi), h = phiHat(phi);
  const nx = facing * h[0], ny = facing * h[1];
  const b = new MeshBuilder(2 * n, 2 * n);
  for (let j = 0; j < n; j++) b.vertex(inner.R[j] * cp, inner.R[j] * sp, inner.Z[j], nx, ny, 0);
  for (let j = 0; j < n; j++) b.vertex(outer.R[j] * cp, outer.R[j] * sp, outer.Z[j], nx, ny, 0);
  for (let j = 0; j < n; j++) {
    const j1 = j + 1 === n ? 0 : j + 1;
    const i0 = j, i1 = j1, o0 = n + j, o1 = n + j1;
    // (inner_j, outer_j, outer_j+1, inner_j+1) is counter-clockwise in (R, Z): normal -phi
    if (facing === -1) b.quad(i0, o0, o1, i1); else b.quad(i0, i1, o1, o0);
  }
  return b.build();
}

/** A closed solid of revolution: the shell, and for a partial range the two flat end faces. */
export function latheSolid(c: Contour, axis: Point2, o: LatheOptions): Mesh {
  const phi0 = o.phi0 ?? 0, phi1 = o.phi1 ?? phi0 + TWO_PI;
  const shell = latheShell(c, o);
  if (isFullTurn(phi0, phi1)) return shell;
  return mergeMeshes([shell, capFan(c, axis, phi0, -1), capFan(c, axis, phi1, 1)]);
}

/**
 * The tube of circular section `radius` swept along a closed planar curve in the poloidal plane phi = const (a toroidal field coil).
 * The curve is `centre` (a counter-clockwise polygon in (R, Z)); the section circle is spanned by the in-plane outward normal and
 * the toroidal direction, so the tube is a closed 2-manifold (a torus) with outward normals. Its volume is pi radius^2 times the
 * curve length as long as radius is below the smallest radius of curvature.
 */
export function sweepTube(centre: Contour, phi: number, radius: number, nSeg: number): Mesh {
  const n = centre.R.length, ns = Math.max(3, Math.floor(nSeg));
  const { nR, nZ } = outwardNormals(centre);
  const cp = Math.cos(phi), sp = Math.sin(phi), h = phiHat(phi);
  const b = new MeshBuilder(n * ns, 2 * n * ns);
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < ns; s++) {
      const a = (TWO_PI * s) / ns, ca = Math.cos(a), sa = Math.sin(a);
      // e(s) = cos s N + sin s B with N the in-plane outward normal and B = phi-hat
      const ex = ca * nR[i] * cp + sa * h[0], ey = ca * nR[i] * sp + sa * h[1], ez = ca * nZ[i];
      const R = centre.R[i] + radius * ca * nR[i];
      b.vertex(R * cp + radius * sa * h[0], R * sp + radius * sa * h[1], centre.Z[i] + radius * ca * nZ[i], ex, ey, ez);
    }
  }
  for (let i = 0; i < n; i++) {
    const i1 = i + 1 === n ? 0 : i + 1;
    for (let s = 0; s < ns; s++) {
      const s1 = s + 1 === ns ? 0 : s + 1;
      // the same pattern as the lathe: A=(i,s) B=(i+1,s) C=(i+1,s+1) D=(i,s+1) -> quad(A, D, C, B)
      b.quad(i * ns + s, i * ns + s1, i1 * ns + s1, i1 * ns + s);
    }
  }
  return b.build();
}
