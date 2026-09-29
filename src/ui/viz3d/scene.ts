/**
 * The geometry of the 3D view, built from plain numbers: nested flux surfaces of the plasma (from an equilibrium snapshot, or
 * Miller surfaces from R, a, kappa, delta), the cut-away with its coloured faces, the vacuum vessel, the toroidal field coils
 * and the X-point ring. Pure and deterministic: no DOM, no WebGL, no clock; the renderers only draw what is built here.
 */
import type { EqSnapshot } from '../../physics/types';
import {
  Contour, Point2, R_MIN, millerAxis, millerContour, millerShift, offsetContour, resampleByAngle, revolvedVolume, toContour,
} from './contour';
import { TWO_PI, capBand, capFan, latheShell, latheSolid, sweepTube } from './lathe';
import { Bounds, Mesh, Vec3, meshBounds, mergeMeshes, unionBounds } from './mesh';

export type Quality = 'high' | 'low' | 'minimal';

interface QualitySpec {
  /** vertices per poloidal contour */
  nTheta: number;
  /** toroidal segments of the outer shells (the inner ones use half) */
  nPhi: number;
  /** number of flux surfaces drawn (at most) */
  maxSurfaces: number;
  /** points along the centre line of a coil, and vertices of its section circle */
  coilPath: number;
  coilSeg: number;
}

export const QUALITY: Readonly<Record<Quality, QualitySpec>> = {
  high: { nTheta: 96, nPhi: 120, maxSurfaces: 10, coilPath: 72, coilSeg: 12 },
  low: { nTheta: 56, nPhi: 72, maxSurfaces: 5, coilPath: 48, coilSeg: 8 },
  minimal: { nTheta: 28, nPhi: 40, maxSurfaces: 3, coilPath: 32, coilSeg: 6 },
};

export interface SceneShape {
  R: number; a: number; kappa: number; delta: number;
  /** distance from the plasma boundary to the coil [m], and the coil thickness [m] */
  gap: number;
  coilThickness: number;
  method: 'tokamak' | 'spherical_tokamak' | 'stellarator';
  /** flux surfaces of the 1.5D equilibrium; when absent or unusable, Miller surfaces are built from the shape */
  eq?: EqSnapshot | null;
}

export interface SceneOptions {
  /** open a wedge of the torus to show the poloidal cross-section */
  cutaway: boolean;
  coils: boolean;
  quality: Quality;
  /** number of toroidal field coils (schematic); default by method */
  nCoils?: number;
  /** azimuth of the centre of the cut wedge [rad] and its width [rad] */
  cutCentre?: number;
  cutWidth?: number;
}

export const DEFAULT_CUT_CENTRE = 0;
export const DEFAULT_CUT_WIDTH = (110 * Math.PI) / 180;

export type ItemKind =
  /** a flux surface of the plasma (translucent, glowing) */
  | 'shell'
  /** the coloured face of the cut-away between two flux surfaces (both sides of the wedge in one mesh) */
  | 'cap'
  | 'vessel'
  | 'vesselCap'
  | 'coil'
  | 'xpoint';

export interface SceneItem {
  kind: ItemKind;
  mesh: Mesh;
  /** shell: normalised radius of the surface; cap: of the middle of the band; other kinds: 0 */
  rho: number;
  /** shell: index of the surface; cap: index of the outer surface of the band; other kinds: -1 */
  k: number;
}

export interface Scene3D {
  /** where the flux surfaces come from */
  source: 'equilibrium' | 'miller';
  items: SceneItem[];
  /** magnetic axis (R, Z) */
  axis: Point2;
  /** normalised radius of every drawn surface */
  rho: number[];
  /** minor radius scale for the disruption displacement [m] */
  a: number;
  /** bounding sphere of everything drawn */
  center: Vec3;
  radius: number;
  /** the cut wedge [rad], or null */
  cut: { centre: number; width: number } | null;
  /** volume of the solid of revolution of the outermost surface [m^3] (Pappus, exact for the polygon) */
  plasmaVolume: number;
  /** centre lines of the coils, one closed polyline (x, y, z, ...) each, for a renderer that draws wires */
  coilLoops: Float32Array[];
  triangles: number;
}

export function defaultCoilCount(method: SceneShape['method']): number {
  return method === 'spherical_tokamak' ? 12 : method === 'stellarator' ? 30 : 18;
}

const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

interface Surfaces { contours: Contour[]; rho: number[]; axis: Point2; source: Scene3D['source'] }

/** Radial distance of contour vertex j from the axis, for the nesting test. */
function radialDistances(c: Contour, axis: Point2): Float64Array {
  const d = new Float64Array(c.R.length);
  for (let j = 0; j < d.length; j++) d[j] = Math.hypot(c.R[j] - axis[0], c.Z[j] - axis[1]);
  return d;
}

/**
 * Flux surfaces of an equilibrium snapshot as contours on the common polar grid about the magnetic axis. A surface that is
 * unusable or does not enclose the previous one is left out; null when the snapshot has no usable outer surface or fewer than two.
 */
export function eqSurfaces(eq: EqSnapshot, nTheta: number): Surfaces | null {
  const n = eq.R?.length ?? 0;
  if (n < 2 || eq.Z?.length !== n || eq.rho?.length !== n || !finite(eq.Raxis, eq.Zaxis)) return null;
  const axis: Point2 = [eq.Raxis, eq.Zaxis];
  const contours: Contour[] = [], rho: number[] = [];
  let prev: Float64Array | null = null;
  for (let i = 0; i < n; i++) {
    const raw = toContour(eq.R[i], eq.Z[i]);
    const c = raw ? resampleByAngle(raw, axis, nTheta) : null;
    if (!c || !Number.isFinite(eq.rho[i]) || eq.rho[i] <= 0) continue;
    if (rho.length && eq.rho[i] <= rho[rho.length - 1]) continue;
    const d = radialDistances(c, axis);
    if (prev) { let nested = true; for (let j = 0; j < d.length && nested; j++) nested = d[j] > prev[j]; if (!nested) continue; }
    contours.push(c); rho.push(eq.rho[i]); prev = d;
  }
  return contours.length >= 2 ? { contours, rho, axis, source: 'equilibrium' } : null;
}

/** Miller surfaces rho = 1/N ... 1 of the shape (the boundary is the exact Miller boundary), with the model's Shafranov shift. */
export function millerSurfaces(shape: SceneShape, nTheta: number, nSurf = 10): Surfaces {
  const contours: Contour[] = [], rho: number[] = [];
  for (let i = 1; i <= nSurf; i++) {
    const r = i / nSurf;
    contours.push(millerContour(shape, r, nTheta, millerShift(shape, r))); rho.push(r);
  }
  return { contours, rho, axis: millerAxis(shape), source: 'miller' };
}

/** indices of the `count` surfaces to draw out of `total`, evenly spread and always including the outermost */
export function pickSurfaces(total: number, count: number): number[] {
  const m = Math.max(1, Math.min(total, count));
  const out: number[] = [];
  for (let i = 1; i <= m; i++) { const k = Math.round((i * total) / m) - 1; if (!out.length || k > out[out.length - 1]) out.push(k); }
  return out;
}

/** a circle of radius r about (R, Z), counter-clockwise */
function circle(R: number, Z: number, r: number, n: number): Contour {
  const cr = new Float64Array(n), cz = new Float64Array(n);
  for (let j = 0; j < n; j++) { const t = (TWO_PI * j) / n; cr[j] = Math.max(R_MIN, R + r * Math.cos(t)); cz[j] = Z + r * Math.sin(t); }
  return { R: cr, Z: cz };
}

/** the vessel wall between two offsets of the plasma boundary [m] (clear of the coils by construction) */
export function vesselOffsets(shape: Pick<SceneShape, 'a' | 'gap'>): { inner: number; outer: number } {
  const { a, gap } = shape;
  const g = Math.max(gap, 0);
  const inner = Math.min(Math.max(0.06 * a, 0.3 * g), 0.75 * g);
  const wall = Math.min(Math.min(Math.max(0.08 * g, 0.02 * a), 0.06 * a), 0.2 * g);
  return { inner, outer: inner + wall };
}

export function buildScene(shape: SceneShape, opts: SceneOptions): Scene3D {
  const q = QUALITY[opts.quality];
  const surf = (shape.eq ? eqSurfaces(shape.eq, q.nTheta) : null) ?? millerSurfaces(shape, q.nTheta);
  const pick = pickSurfaces(surf.contours.length, q.maxSurfaces);
  const contours = pick.map((i) => surf.contours[i]), rho = pick.map((i) => surf.rho[i]);
  const axis = surf.axis;
  const nS = contours.length, lcfs = contours[nS - 1];

  const cutWidth = opts.cutaway ? Math.min(Math.max(opts.cutWidth ?? DEFAULT_CUT_WIDTH, 0.2), TWO_PI - 0.6) : 0;
  const cutCentre = opts.cutCentre ?? DEFAULT_CUT_CENTRE;
  const phi0 = cutCentre + cutWidth / 2, phi1 = cutCentre + TWO_PI - cutWidth / 2;
  const segments = (base: number) => Math.max(6, Math.ceil((base * (phi1 - phi0)) / TWO_PI));
  const range = (base: number) => ({ nPhi: segments(base), phi0, phi1 });

  const items: SceneItem[] = [];
  // plasma flux surfaces
  for (let k = 0; k < nS; k++) {
    const outer = k === nS - 1;
    items.push({ kind: 'shell', mesh: latheShell(contours[k], range(outer ? q.nPhi : Math.ceil(q.nPhi / 2))), rho: rho[k], k });
  }
  // the coloured faces of the cut, one band per surface (both sides of the wedge in one mesh)
  if (opts.cutaway) {
    for (let k = 0; k < nS; k++) {
      const faces = (phi: number, facing: 1 | -1) => (k === 0 ? capFan(contours[0], axis, phi, facing) : capBand(contours[k - 1], contours[k], phi, facing));
      items.push({ kind: 'cap', mesh: mergeMeshes([faces(phi0, -1), faces(phi1, 1)]), rho: k === 0 ? 0.5 * rho[0] : 0.5 * (rho[k - 1] + rho[k]), k });
    }
  }

  // the vacuum vessel: a shell outside the plasma and, in the cut, its wall in section
  const vo = vesselOffsets(shape);
  const vIn = offsetContour(lcfs, vo.inner), vOut = offsetContour(lcfs, vo.outer);
  items.push({ kind: 'vessel', mesh: latheShell(vOut, range(q.nPhi)), rho: 0, k: -1 });
  if (opts.cutaway) items.push({ kind: 'vesselCap', mesh: mergeMeshes([capBand(vIn, vOut, phi0, -1), capBand(vIn, vOut, phi1, 1)]), rho: 0, k: -1 });

  // the X-point ring of a diverted plasma: the lowest point of the boundary
  const diverted = shape.kappa > 1.25 && shape.method !== 'stellarator';
  if (diverted) {
    let low = 0;
    for (let j = 1; j < lcfs.Z.length; j++) if (lcfs.Z[j] < lcfs.Z[low]) low = j;
    const r = Math.min(0.035 * shape.a, 0.4 * lcfs.R[low]);
    items.push({ kind: 'xpoint', mesh: latheSolid(circle(lcfs.R[low], lcfs.Z[low], r, 10), [lcfs.R[low], lcfs.Z[low]], range(q.nPhi)), rho: 0, k: -1 });
  }

  // toroidal field coils: tubes along the plasma boundary pushed out by the gap and half the coil thickness
  const coilLoops: Float32Array[] = [];
  if (opts.coils) {
    const path0 = resampleByAngle(lcfs, axis, q.coilPath);
    const nC = Math.max(1, Math.floor(opts.nCoils ?? defaultCoilCount(shape.method)));
    if (path0 && nC > 0) {
      const half = Math.max(shape.coilThickness, 0.02 * shape.a) / 2;
      const path = offsetContour(path0, Math.max(shape.gap, 0) + half);
      let minR = Infinity;
      for (let j = 0; j < path.R.length; j++) minR = Math.min(minR, path.R[j]);
      const r = Math.min(half, 0.9 * minR);
      const tubes: Mesh[] = [];
      const pitch = TWO_PI / nC;
      for (let i = 0; i < nC; i++) {
        const phi = (i + 0.5) * pitch;
        if (opts.cutaway) { // a coil inside the wedge would hide the cut
          let d = Math.abs(((phi - cutCentre + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI);
          d = Math.max(0, d - 0.5 * pitch);
          if (d < cutWidth / 2) continue;
        }
        tubes.push(sweepTube(path, phi, r, q.coilSeg));
        const loop = new Float32Array(3 * path.R.length);
        for (let j = 0; j < path.R.length; j++) { loop[3 * j] = path.R[j] * Math.cos(phi); loop[3 * j + 1] = path.R[j] * Math.sin(phi); loop[3 * j + 2] = path.Z[j]; }
        coilLoops.push(loop);
      }
      if (tubes.length) items.push({ kind: 'coil', mesh: mergeMeshes(tubes), rho: 0, k: -1 });
    }
  }

  const bounds: Bounds = unionBounds(items.map((it) => meshBounds(it.mesh)));
  const center: Vec3 = [0, 1, 2].map((i) => 0.5 * (bounds.min[i] + bounds.max[i])) as Vec3;
  const radius = 0.5 * Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  let triangles = 0;
  for (const it of items) triangles += it.mesh.indices.length / 3;
  return {
    source: surf.source, items, axis, rho, a: shape.a, center, radius: Math.max(radius, 1e-6),
    cut: opts.cutaway ? { centre: cutCentre, width: cutWidth } : null,
    plasmaVolume: revolvedVolume(lcfs), coilLoops, triangles,
  };
}
