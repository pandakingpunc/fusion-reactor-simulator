/**
 * Triangle meshes of the 3D view: the data type, a builder, and the checks the tests (and the scene builder) rely on.
 *
 * Conventions used by every generator in this directory:
 *  - world axes: x = R cos(phi), y = R sin(phi), z = Z; the torus axis is z (z up);
 *  - triangles wind counter-clockwise seen from OUTSIDE, so the face normal (v1 - v0) x (v2 - v0) points out of the solid;
 *  - per-vertex normals are unit vectors pointing out of the solid.
 * No DOM, no WebGL, no Node API: everything here runs (and is tested) in plain Node.
 */

export interface Mesh {
  /** x, y, z per vertex */
  positions: Float32Array;
  /** unit outward normal per vertex (x, y, z) */
  normals: Float32Array;
  /** three vertex indices per triangle */
  indices: Uint32Array;
}

export type Vec3 = [number, number, number];

export const vertexCount = (m: Mesh): number => m.positions.length / 3;
export const triangleCount = (m: Mesh): number => m.indices.length / 3;

export const EMPTY_MESH: Mesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };

/** Grows typed arrays as vertices and triangles are added (generators know their sizes, so `reserve` avoids regrowth). */
export class MeshBuilder {
  private pos: Float32Array;
  private nrm: Float32Array;
  private idx: Uint32Array;
  private nv = 0;
  private nt = 0;

  constructor(reserveVertices = 64, reserveTriangles = 128) {
    this.pos = new Float32Array(3 * Math.max(4, reserveVertices));
    this.nrm = new Float32Array(3 * Math.max(4, reserveVertices));
    this.idx = new Uint32Array(3 * Math.max(4, reserveTriangles));
  }

  get vertices(): number { return this.nv; }
  get triangles(): number { return this.nt; }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    if (3 * (this.nv + 1) > this.pos.length) {
      const grow = (a: Float32Array) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
      this.pos = grow(this.pos); this.nrm = grow(this.nrm);
    }
    const o = 3 * this.nv;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
    return this.nv++;
  }

  triangle(a: number, b: number, c: number): void {
    if (3 * (this.nt + 1) > this.idx.length) { const g = new Uint32Array(this.idx.length * 2); g.set(this.idx); this.idx = g; }
    const o = 3 * this.nt++;
    this.idx[o] = a; this.idx[o + 1] = b; this.idx[o + 2] = c;
  }

  /** two triangles of the quad (a, b, c, d) in the order a-b-c-d around the quad */
  quad(a: number, b: number, c: number, d: number): void { this.triangle(a, b, c); this.triangle(a, c, d); }

  build(): Mesh {
    return { positions: this.pos.slice(0, 3 * this.nv), normals: this.nrm.slice(0, 3 * this.nv), indices: this.idx.slice(0, 3 * this.nt) };
  }
}

/** One mesh from several (indices are re-based). */
export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov); normals.set(m.normals, ov);
    const base = ov / 3;
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + base;
    ov += m.positions.length; oi += m.indices.length;
  }
  return { positions, normals, indices };
}

/** A copy rotated by `angle` [rad] about the z axis (normals included). */
export function rotateZ(m: Mesh, angle: number): Mesh {
  const c = Math.cos(angle), s = Math.sin(angle);
  const rot = (a: Float32Array) => {
    const b = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) { b[i] = c * a[i] - s * a[i + 1]; b[i + 1] = s * a[i] + c * a[i + 1]; b[i + 2] = a[i + 2]; }
    return b;
  };
  return { positions: rot(m.positions), normals: rot(m.normals), indices: m.indices };
}

/** Enclosed volume by the divergence theorem, sum of p0 . (p1 x p2) / 6 over the triangles; positive for outward winding of a closed mesh. */
export function meshVolume(m: Mesh): number {
  const p = m.positions, ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function meshArea(m: Mesh): number {
  const p = m.positions, ix = m.indices;
  let s = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    s += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s;
}

export interface Bounds { min: Vec3; max: Vec3 }

export function meshBounds(m: Mesh): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < min[k]) min[k] = p[i + k]; if (p[i + k] > max[k]) max[k] = p[i + k]; }
  return { min, max };
}

export function unionBounds(bs: readonly Bounds[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let k = 0; k < 3; k++) { if (b.min[k] < min[k]) min[k] = b.min[k]; if (b.max[k] > max[k]) max[k] = b.max[k]; }
  return { min, max };
}

/** Result of `checkTopology`. A closed, consistently wound 2-manifold has all three problem counts at zero. */
export interface TopologyReport {
  /** vertices after welding vertices at the same position */
  welded: number;
  edges: number;
  /** edges used by only one triangle (a hole or an open rim) */
  openEdges: number;
  /** edges used by more than two triangles, or twice in the same direction (flipped or overlapping faces) */
  badEdges: number;
  /** triangles with zero area (repeated welded vertex) */
  degenerate: number;
  closed: boolean;
}

/**
 * Watertightness: vertices at the same position are welded (a shell and its cap share their rim positions but not their
 * normals), then every undirected edge must be used by exactly two triangles, once in each direction.
 * Positions are compared as float32 values, which is exact for generators that compute a rim vertex with the same formula.
 */
export function checkTopology(m: Mesh): TopologyReport {
  const p = m.positions;
  const ids = new Map<string, number>();
  const weld = new Uint32Array(p.length / 3);
  for (let i = 0; i < weld.length; i++) {
    const key = `${p[3 * i]},${p[3 * i + 1]},${p[3 * i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    weld[i] = id;
  }
  const dir = new Map<number, number>(); // directed edge (a * N + b) -> count
  const N = ids.size + 1;
  let degenerate = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = weld[m.indices[t]], b = weld[m.indices[t + 1]], c = weld[m.indices[t + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) dir.set(u * N + v, (dir.get(u * N + v) ?? 0) + 1);
  }
  let edges = 0, open = 0, bad = 0;
  const seen = new Set<number>();
  for (const [key, count] of dir) {
    const u = Math.floor(key / N), v = key % N;
    const undirected = Math.min(u, v) * N + Math.max(u, v);
    if (seen.has(undirected)) continue;
    seen.add(undirected);
    edges++;
    const back = dir.get(v * N + u) ?? 0;
    if (count === 1 && back === 1) continue;
    if (count + back === 1) open++; else bad++;
  }
  return { welded: ids.size, edges, openEdges: open, badEdges: bad, degenerate, closed: open === 0 && bad === 0 };
}

/**
 * Fraction of triangles whose geometric normal (from the winding) points away from `inside(centroid)`,
 * a point of the solid's interior near the triangle (for a lathe surface: the point of the axis circle in the same poloidal
 * plane). 1 for a correctly wound solid.
 */
export function outwardFraction(m: Mesh, inside: (x: number, y: number, z: number) => Vec3): number {
  const p = m.positions, ix = m.indices;
  let ok = 0, n = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-30) continue; // degenerate: no direction
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const r = inside(cx, cy, cz);
    n++;
    if (nx * (cx - r[0]) + ny * (cy - r[1]) + nz * (cz - r[2]) > 0) ok++;
  }
  return n ? ok / n : 1;
}

/** Fraction of vertices whose stored normal agrees (positive dot product) with the average geometric normal of the triangles around it. */
export function normalsAgreeFraction(m: Mesh): number {
  const nv = m.positions.length / 3, acc = new Float64Array(3 * nv);
  const p = m.positions, ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz; }
  }
  let ok = 0, n = 0;
  for (let v = 0; v < nv; v++) {
    const ax = acc[3 * v], ay = acc[3 * v + 1], az = acc[3 * v + 2];
    if (ax * ax + ay * ay + az * az < 1e-30) continue;
    n++;
    if (ax * m.normals[3 * v] + ay * m.normals[3 * v + 1] + az * m.normals[3 * v + 2] > 0) ok++;
  }
  return n ? ok / n : 1;
}
