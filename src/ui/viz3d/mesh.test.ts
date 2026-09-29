import { describe, expect, it } from 'vitest';
import {
  Mesh, MeshBuilder, checkTopology, mergeMeshes, meshArea, meshBounds, meshVolume, normalsAgreeFraction, outwardFraction, rotateZ,
  triangleCount, unionBounds, vertexCount,
} from './mesh';

/** the unit cube [0,1]^3 as a closed solid with outward winding; `skip` drops one triangle (a hole), `flip` reverses one */
function cube(opts: { skip?: number; flip?: number } = {}): Mesh {
  const b = new MeshBuilder(2, 2); // tiny reservation: exercises the growth path
  const P: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  for (const p of P) b.vertex(p[0], p[1], p[2], 0, 0, 1);
  // faces as counter-clockwise quads seen from outside
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  let t = 0;
  for (const f of faces) {
    for (const tri of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
      if (t !== opts.skip) b.triangle(...(t === opts.flip ? [tri[0], tri[2], tri[1]] : tri) as [number, number, number]);
      t++;
    }
  }
  return b.build();
}

describe('MeshBuilder and mesh measures', () => {
  it('builds a cube of volume 1, area 6 and the right counts', () => {
    const m = cube();
    expect(vertexCount(m)).toBe(8);
    expect(triangleCount(m)).toBe(12);
    expect(meshVolume(m)).toBeCloseTo(1, 12);
    expect(meshArea(m)).toBeCloseTo(6, 12);
    expect(meshBounds(m)).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('merges meshes with re-based indices and unions their bounds', () => {
    const a = cube(), b = rotateZ(cube(), Math.PI); // the second cube sits in [-1,0]^2 x [0,1]
    const m = mergeMeshes([a, b]);
    expect(vertexCount(m)).toBe(16);
    expect(triangleCount(m)).toBe(24);
    expect(meshVolume(m)).toBeCloseTo(2, 6);
    const bb = unionBounds([meshBounds(a), meshBounds(b)]);
    expect(bb.min[0]).toBeCloseTo(-1, 6);
    expect(bb.max[0]).toBeCloseTo(1, 6);
  });

  it('rotates positions and normals about z and keeps the indices', () => {
    const b = new MeshBuilder();
    b.vertex(1, 0, 2, 1, 0, 0); b.vertex(0, 1, 2, 0, 1, 0); b.vertex(0, 0, 3, 0, 0, 1);
    b.triangle(0, 1, 2);
    const m = rotateZ(b.build(), Math.PI / 2);
    expect(m.positions[0]).toBeCloseTo(0, 6); expect(m.positions[1]).toBeCloseTo(1, 6); expect(m.positions[2]).toBe(2);
    expect(m.normals[0]).toBeCloseTo(0, 6); expect(m.normals[1]).toBeCloseTo(1, 6);
    expect(Array.from(m.indices)).toEqual([0, 1, 2]);
  });
});

describe('checkTopology', () => {
  it('accepts a closed, consistently wound solid', () => {
    const r = checkTopology(cube());
    expect(r).toMatchObject({ welded: 8, edges: 18, openEdges: 0, badEdges: 0, degenerate: 0, closed: true });
  });

  it('welds vertices that share a position (a shell and its cap keep separate normals)', () => {
    const m = cube();
    // duplicate every vertex with a different normal and point half of the triangles at the copies
    const b = new MeshBuilder();
    for (let i = 0; i < vertexCount(m); i++) b.vertex(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2], 1, 0, 0);
    for (let i = 0; i < vertexCount(m); i++) b.vertex(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2], 0, 1, 0);
    for (let t = 0; t < triangleCount(m); t++) {
      const off = t % 2 ? 8 : 0;
      b.triangle(m.indices[3 * t] + off, m.indices[3 * t + 1] + off, m.indices[3 * t + 2] + off);
    }
    expect(checkTopology(b.build()).closed).toBe(true);
  });

  it('reports a hole as open edges', () => {
    const r = checkTopology(cube({ skip: 3 }));
    expect(r.closed).toBe(false);
    expect(r.openEdges).toBe(3);
  });

  it('reports a flipped face as inconsistent edges', () => {
    const r = checkTopology(cube({ flip: 5 }));
    expect(r.closed).toBe(false);
    expect(r.badEdges).toBeGreaterThan(0);
  });

  it('counts triangles that collapse to a line', () => {
    const b = new MeshBuilder();
    b.vertex(0, 0, 0, 0, 0, 1); b.vertex(1, 0, 0, 0, 0, 1); b.vertex(0, 0, 0, 0, 0, 1);
    b.triangle(0, 1, 2);
    expect(checkTopology(b.build()).degenerate).toBe(1);
  });
});

describe('outward checks', () => {
  it('outwardFraction is 1 for the cube seen from its centre and 0 when it is turned inside out', () => {
    const m = cube();
    const inside = () => [0.5, 0.5, 0.5] as [number, number, number];
    expect(outwardFraction(m, inside)).toBe(1);
    const idx = Uint32Array.from(m.indices);
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
    const inv: Mesh = { ...m, indices: idx };
    expect(outwardFraction(inv, inside)).toBe(0);
    expect(meshVolume(inv)).toBeCloseTo(-1, 12);
  });

  it('normalsAgreeFraction compares the stored normals with the winding', () => {
    const b = new MeshBuilder();
    b.vertex(0, 0, 0, 0, 0, 1); b.vertex(1, 0, 0, 0, 0, 1); b.vertex(0, 1, 0, 0, 0, 1);
    b.triangle(0, 1, 2);
    expect(normalsAgreeFraction(b.build())).toBe(1);
    const c = new MeshBuilder();
    c.vertex(0, 0, 0, 0, 0, -1); c.vertex(1, 0, 0, 0, 0, -1); c.vertex(0, 1, 0, 0, 0, -1);
    c.triangle(0, 1, 2);
    expect(normalsAgreeFraction(c.build())).toBe(0);
  });
});
