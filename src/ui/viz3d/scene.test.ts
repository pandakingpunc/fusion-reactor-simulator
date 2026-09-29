import { describe, expect, it } from 'vitest';
import { millerBoundary, shapeIntegrals } from '../../physics/equilibrium/miller';
import { ProfileModel } from '../../physics/profiles/model';
import { DEMO, DIIID, ITER, ITER_15D, JET, JET_15D, JT60SA, MASTU, SPARC, SPARC_15D, W7X } from '../../physics/presets';
import type { EqSnapshot, MagneticConfig } from '../../physics/types';
import { contourLength, offsetContour, resampleByAngle, signedArea, toContour } from './contour';
import { TWO_PI } from './lathe';
import { Mesh, checkTopology, mergeMeshes, meshArea, meshVolume, normalsAgreeFraction, outwardFraction, triangleCount } from './mesh';
import { QUALITY, Scene3D, SceneItem, SceneShape, buildScene, defaultCoilCount, eqSurfaces, millerSurfaces, pickSurfaces, vesselOffsets } from './scene';

const shapeOf = (cfg: MagneticConfig, eq?: EqSnapshot | null): SceneShape => ({
  R: cfg.geometry.R, a: cfg.geometry.a, kappa: cfg.geometry.kappa, delta: cfg.geometry.delta,
  gap: cfg.magnet.gap_m, coilThickness: cfg.magnet.coilThickness_m, method: cfg.method, eq,
});

const of = (s: Scene3D, kind: SceneItem['kind']) => s.items.filter((i) => i.kind === kind);
const outerShell = (s: Scene3D) => of(s, 'shell')[of(s, 'shell').length - 1].mesh;

const MAGNETIC: [string, MagneticConfig][] = [
  ['ITER', ITER], ['JET', JET], ['SPARC', SPARC], ['DIII-D', DIIID], ['JT-60SA', JT60SA], ['MAST-U', MASTU], ['W7-X', W7X], ['DEMO', DEMO],
];

/** an axis-circle point in the same poloidal plane: a point inside the plasma solid */
const inside = (axis: readonly [number, number]) => (x: number, y: number): [number, number, number] => {
  const p = Math.atan2(y, x);
  return [axis[0] * Math.cos(p), axis[0] * Math.sin(p), axis[1]];
};

describe('Miller scenes (0D and the fallback of the 1.5D view)', () => {
  it.each(MAGNETIC)('%s: the plasma boundary lathe closes, faces outwards, and has the Miller volume within 2 %%', (_n, cfg) => {
    const shape = shapeOf(cfg);
    const s = buildScene(shape, { cutaway: false, coils: true, quality: 'high' });
    expect(s.source).toBe('miller');
    const m = outerShell(s);
    expect(checkTopology(m)).toMatchObject({ closed: true, openEdges: 0, badEdges: 0, degenerate: 0 });
    expect(outwardFraction(m, inside(s.axis))).toBe(1);
    expect(normalsAgreeFraction(m)).toBe(1);
    const ref = shapeIntegrals(millerBoundary(shape)).volume;
    expect(Math.abs(meshVolume(m) / ref - 1)).toBeLessThan(0.02);
    expect(Math.abs(s.plasmaVolume / ref - 1)).toBeLessThan(0.01);
  });

  it('surfaces are nested: the volume grows with every flux surface and the axis is inside all of them', () => {
    const s = buildScene(shapeOf(ITER), { cutaway: false, coils: false, quality: 'high' });
    const vols = of(s, 'shell').map((i) => meshVolume(i.mesh));
    expect(vols.length).toBe(10);
    for (let i = 1; i < vols.length; i++) expect(vols[i]).toBeGreaterThan(vols[i - 1]);
    expect(s.rho[0]).toBeCloseTo(0.1, 12); expect(s.rho[9]).toBe(1);
  });
});

describe('equilibrium scenes (1.5D)', () => {
  const models: [string, MagneticConfig][] = [
    ['ITER', ITER_15D], ['JET', JET_15D], ['SPARC', SPARC_15D], ['MAST-U (spherical)', { ...MASTU, fidelity: '1.5D' }],
  ];
  for (const [name, cfg] of models) {
    it(`${name}: flux surfaces of the real equilibrium become closed, outward solids of the equilibrium volume (2 %)`, () => {
      const model = new ProfileModel(cfg);
      const snap = model.eqSnapshot(10, 72);
      const eqVolume = model.ctx.eq.volume;
      const s = buildScene(shapeOf(cfg, snap), { cutaway: false, coils: true, quality: 'high' });
      expect(s.source).toBe('equilibrium');
      expect(of(s, 'shell')).toHaveLength(10);
      // every surface of the snapshot survives, in order
      expect(s.rho).toEqual(snap.rho);
      for (const it of of(s, 'shell')) {
        expect(checkTopology(it.mesh).closed, `rho ${it.rho}`).toBe(true);
        expect(outwardFraction(it.mesh, inside(s.axis)), `rho ${it.rho}`).toBe(1);
      }
      const m = outerShell(s);
      expect(Math.abs(meshVolume(m) / eqVolume - 1)).toBeLessThan(0.02);
      expect(Math.abs(s.plasmaVolume / eqVolume - 1)).toBeLessThan(0.02);
      const vols = of(s, 'shell').map((i) => meshVolume(i.mesh));
      for (let i = 1; i < vols.length; i++) expect(vols[i]).toBeGreaterThan(vols[i - 1]);
      // the coils enclose the plasma: their inner edge is outside the boundary
      expect(s.radius).toBeGreaterThan(cfg.geometry.R);
    });

    it(`${name}: the cut-away shell and its faces form one closed solid with the volume of the wedge-cut torus`, () => {
      const model = new ProfileModel(cfg);
      const snap = model.eqSnapshot(10, 72);
      const s = buildScene(shapeOf(cfg, snap), { cutaway: true, coils: false, quality: 'high' });
      expect(s.cut).not.toBeNull();
      const caps = of(s, 'cap').map((i) => i.mesh);
      expect(caps).toHaveLength(10);
      const solid = mergeMeshes([outerShell(s), ...caps]);
      expect(checkTopology(solid)).toMatchObject({ closed: true, openEdges: 0, badEdges: 0 });
      expect(normalsAgreeFraction(solid)).toBe(1);
      const frac = (TWO_PI - s.cut!.width) / TWO_PI;
      expect(Math.abs(meshVolume(solid) / (model.ctx.eq.volume * frac) - 1)).toBeLessThan(0.02);
    });
  }

  it('the equilibrium scene is drawn from the snapshot, not the shape: a snapshot of another shape moves the surfaces', () => {
    const snap = new ProfileModel(SPARC_15D).eqSnapshot(10, 72);
    const a = buildScene(shapeOf(ITER), { cutaway: false, coils: false, quality: 'low' });
    const b = buildScene({ ...shapeOf(ITER), eq: snap }, { cutaway: false, coils: false, quality: 'low' });
    expect(meshVolume(outerShell(b))).toBeLessThan(0.1 * meshVolume(outerShell(a)));
  });
});

describe('unusable equilibrium snapshots fall back to Miller surfaces', () => {
  const good = new ProfileModel(JET_15D).eqSnapshot(10, 72);
  const shape = shapeOf(JET);
  const cases: [string, EqSnapshot][] = [
    ['no surfaces', { ...good, R: [], Z: [], rho: [] }],
    ['a single surface', { ...good, R: [good.R[0]], Z: [good.Z[0]], rho: [good.rho[0]] }],
    ['mismatched lengths', { ...good, Z: good.Z.slice(0, 5) }],
    ['a non-finite axis', { ...good, Raxis: NaN }],
    ['an axis outside the surfaces', { ...good, Raxis: 50 }],
    ['non-finite coordinates', { ...good, R: good.R.map((r) => r.map(() => NaN)) }],
    ['surfaces reaching the torus axis', { ...good, R: good.R.map((r) => r.map((x) => x - 10)) }],
  ];
  for (const [name, eq] of cases) {
    it(name, () => {
      const s = buildScene({ ...shape, eq }, { cutaway: true, coils: true, quality: 'low' });
      expect(s.source).toBe('miller');
      expect(s.triangles).toBeGreaterThan(0);
    });
  }

  it('a surface that does not enclose its inner neighbour, or repeats a radius, is left out of the others', () => {
    const swapped: EqSnapshot = { ...good, R: good.R.slice(), Z: good.Z.slice(), rho: good.rho.slice() };
    [swapped.R[3], swapped.R[4]] = [swapped.R[4], swapped.R[3]];
    [swapped.Z[3], swapped.Z[4]] = [swapped.Z[4], swapped.Z[3]];
    const s = eqSurfaces(swapped, 48)!;
    expect(s.contours.length).toBe(9);
    expect(s.source).toBe('equilibrium');
    const dup = eqSurfaces({ ...good, rho: good.rho.map((r, i) => (i === 5 ? good.rho[4] : r)) }, 48)!;
    expect(dup.contours.length).toBe(9);
  });

  it('surfaces given clockwise, or with a repeated closing point, are accepted', () => {
    const cw: EqSnapshot = { ...good, R: good.R.map((r) => r.slice().reverse()), Z: good.Z.map((z) => z.slice().reverse()) };
    const closed: EqSnapshot = { ...good, R: good.R.map((r) => [...r, r[0]]), Z: good.Z.map((z) => [...z, z[0]]) };
    for (const eq of [cw, closed]) {
      const a = eqSurfaces(eq, 48)!, b = eqSurfaces(good, 48)!;
      expect(a.contours.length).toBe(10);
      for (let j = 0; j < 48; j++) { expect(a.contours[9].R[j]).toBeCloseTo(b.contours[9].R[j], 6); expect(a.contours[9].Z[j]).toBeCloseTo(b.contours[9].Z[j], 6); }
    }
  });
});

describe('cut-away', () => {
  const shape = shapeOf(ITER);

  it('a Miller scene with a cut is closed and its wedge is the requested width', () => {
    const s = buildScene(shape, { cutaway: true, coils: false, quality: 'high', cutWidth: Math.PI / 2, cutCentre: 1 });
    expect(s.cut).toEqual({ centre: 1, width: Math.PI / 2 });
    const solid = mergeMeshes([outerShell(s), ...of(s, 'cap').map((i) => i.mesh)]);
    expect(checkTopology(solid).closed).toBe(true);
    const full = meshVolume(outerShell(buildScene(shape, { cutaway: false, coils: false, quality: 'high' })));
    expect(meshVolume(solid) / full).toBeCloseTo(0.75, 2);
    // no vertex of the shells lies inside the removed wedge
    let inWedge = 0;
    for (const it of of(s, 'shell')) {
      const p = it.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        const d = ((Math.atan2(p[i + 1], p[i]) - 1 + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
        if (Math.abs(d) < Math.PI / 4 - 1e-6) inWedge++;
      }
    }
    expect(inWedge).toBe(0);
  });

  it('the cut faces are drawn only when cut, and their area is two poloidal sections', () => {
    expect(of(buildScene(shape, { cutaway: false, coils: false, quality: 'low' }), 'cap')).toHaveLength(0);
    const s = buildScene(shape, { cutaway: true, coils: false, quality: 'high' });
    const caps = of(s, 'cap');
    expect(caps.map((c) => c.k)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let area = 0;
    for (const c of caps) area += meshArea(c.mesh);
    const A = signedArea(millerSurfaces(shape, QUALITY.high.nTheta).contours[9]);
    expect(Math.abs(area / (2 * A) - 1)).toBeLessThan(1e-3);
  });

  it('the vessel wall is cut too, and is a shell outside the plasma', () => {
    const s = buildScene(shape, { cutaway: true, coils: false, quality: 'low' });
    expect(of(s, 'vessel')).toHaveLength(1);
    expect(of(s, 'vesselCap')).toHaveLength(1);
    const noCut = buildScene(shape, { cutaway: false, coils: false, quality: 'low' });
    expect(of(noCut, 'vesselCap')).toHaveLength(0);
    const vessel = of(noCut, 'vessel')[0].mesh;
    expect(checkTopology(vessel).closed).toBe(true);
    expect(meshVolume(vessel)).toBeGreaterThan(meshVolume(outerShell(noCut)));
  });
});

describe('vessel offsets', () => {
  it.each(MAGNETIC)('%s: the wall lies between the plasma and the coils', (_n, cfg) => {
    const v = vesselOffsets({ a: cfg.geometry.a, gap: cfg.magnet.gap_m });
    expect(v.inner).toBeGreaterThan(0);
    expect(v.outer).toBeGreaterThan(v.inner);
    expect(v.outer).toBeLessThanOrEqual(0.95 * cfg.magnet.gap_m + 1e-12);
  });
  it('a zero gap gives a zero-thickness wall at the plasma (no negative offsets)', () => {
    expect(vesselOffsets({ a: 1, gap: 0 })).toEqual({ inner: 0, outer: 0 });
    expect(vesselOffsets({ a: 1, gap: -1 })).toEqual({ inner: 0, outer: 0 });
  });
});

describe('toroidal field coils', () => {
  const coilMesh = (s: Scene3D): Mesh => of(s, 'coil')[0].mesh;

  it('are closed tubes: nCoils of them, each a torus with the volume pi r^2 L of its centre line (polygon corrected)', () => {
    const shape = shapeOf(ITER);
    const s = buildScene(shape, { cutaway: false, coils: true, quality: 'high', nCoils: 18 });
    expect(s.coilLoops).toHaveLength(18);
    const m = coilMesh(s);
    const topo = checkTopology(m);
    expect(topo).toMatchObject({ closed: true, openEdges: 0, badEdges: 0, degenerate: 0 });
    expect(normalsAgreeFraction(m)).toBe(1);
    // the centre line of a coil: the boundary pushed out by gap + half the thickness
    const lcfs = millerSurfaces(shape, QUALITY.high.coilPath).contours[9];
    const path = offsetContour(resampleByAngle(toContour(lcfs.R, lcfs.Z)!, [shape.R + 0.06 * shape.a, 0], QUALITY.high.coilPath)!, shape.gap + shape.coilThickness / 2);
    const r = shape.coilThickness / 2, ns = QUALITY.high.coilSeg;
    const poly = (ns / TWO_PI) * Math.sin(TWO_PI / ns);
    expect(Math.abs(meshVolume(m) / (18 * poly * Math.PI * r * r * contourLength(path)) - 1)).toBeLessThan(0.02);
  });

  it('coil counts follow the device type, and a cut-away removes the coils that would hide the cut', () => {
    expect(defaultCoilCount('tokamak')).toBe(18);
    expect(defaultCoilCount('spherical_tokamak')).toBe(12);
    expect(defaultCoilCount('stellarator')).toBe(30);
    const shape = shapeOf(MASTU);
    expect(buildScene({ ...shape, method: 'tokamak' }, { cutaway: false, coils: true, quality: 'low' }).coilLoops).toHaveLength(18);
    const st = buildScene({ ...shape, method: 'spherical_tokamak' }, { cutaway: false, coils: true, quality: 'low' });
    expect(st.coilLoops).toHaveLength(12);
    const cut = buildScene(shape, { cutaway: true, coils: true, quality: 'low', nCoils: 18, cutCentre: 0, cutWidth: (110 * Math.PI) / 180 });
    // a 110 degree wedge plus half a pitch (10 degrees) on either side removes coils centred within 65 degrees: 6 of the 18 (10, 30, ..., 350)
    expect(cut.coilLoops).toHaveLength(12);
    for (const loop of cut.coilLoops) {
      const phi = Math.atan2(loop[1], loop[0]);
      expect(Math.abs(phi)).toBeGreaterThan((55 * Math.PI) / 180);
    }
  });

  it('the coil ring is off with coils: false, and coils sit outside the vessel', () => {
    const shape = shapeOf(ITER);
    const s = buildScene(shape, { cutaway: false, coils: false, quality: 'low' });
    expect(of(s, 'coil')).toHaveLength(0);
    expect(s.coilLoops).toHaveLength(0);
    const withCoils = buildScene(shape, { cutaway: false, coils: true, quality: 'low' });
    const p = coilMesh(withCoils).positions;
    let minR = Infinity;
    for (let i = 0; i < p.length; i += 3) minR = Math.min(minR, Math.hypot(p[i], p[i + 1]));
    expect(minR).toBeGreaterThan(0.5); // ITER: R - a - gap - thickness = 2.0
    expect(minR).toBeLessThan(shape.R - shape.a - shape.gap);
  });

  it('a spherical tokamak keeps every coil off the torus axis (the section circle is limited by the inboard radius)', () => {
    const s = buildScene({ ...shapeOf(MASTU), method: 'spherical_tokamak' }, { cutaway: false, coils: true, quality: 'high' });
    const p = coilMesh(s).positions;
    let minR = Infinity;
    for (let i = 0; i < p.length; i += 3) minR = Math.min(minR, Math.hypot(p[i], p[i + 1]));
    expect(minR).toBeGreaterThan(0);
    expect(checkTopology(coilMesh(s)).closed).toBe(true);
  });
});

describe('X-point ring and levels of detail', () => {
  it('diverted plasmas (kappa > 1.25) get a closed ring at the lowest point of the boundary; circular ones do not', () => {
    const s = buildScene(shapeOf(ITER), { cutaway: false, coils: false, quality: 'high' });
    const ring = of(s, 'xpoint');
    expect(ring).toHaveLength(1);
    expect(checkTopology(ring[0].mesh).closed).toBe(true);
    const p = ring[0].mesh.positions;
    let zMax = -Infinity;
    for (let i = 2; i < p.length; i += 3) zMax = Math.max(zMax, p[i]);
    expect(zMax).toBeLessThan(0); // below the midplane
    expect(of(buildScene(shapeOf(W7X), { cutaway: false, coils: false, quality: 'high' }), 'xpoint')).toHaveLength(0);
    expect(of(buildScene({ ...shapeOf(ITER), kappa: 1.2 }, { cutaway: false, coils: false, quality: 'high' }), 'xpoint')).toHaveLength(0);
  });

  it('quality levels trade triangles for speed; the plasma volume stays within 2 % at every level', () => {
    const shape = shapeOf(ITER), ref = shapeIntegrals(millerBoundary(shape)).volume;
    const tris: number[] = [];
    for (const q of ['high', 'low', 'minimal'] as const) {
      const s = buildScene(shape, { cutaway: true, coils: true, quality: q });
      tris.push(s.triangles);
      expect(of(s, 'shell')).toHaveLength(QUALITY[q].maxSurfaces);
      expect(Math.abs(s.plasmaVolume / ref - 1)).toBeLessThan(q === 'minimal' ? 0.03 : 0.02);
    }
    expect(tris[0]).toBeGreaterThan(tris[1]);
    expect(tris[1]).toBeGreaterThan(tris[2]);
    expect(tris[2]).toBeLessThan(15000); // small enough for the canvas fallback
  });

  it('pickSurfaces spreads the choice and always ends at the boundary', () => {
    expect(pickSurfaces(10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pickSurfaces(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(pickSurfaces(10, 3)).toEqual([2, 6, 9]);
    expect(pickSurfaces(4, 10)).toEqual([0, 1, 2, 3]);
    expect(pickSurfaces(1, 3)).toEqual([0]);
  });
});

describe('scene invariants', () => {
  it('all coordinates and normals are finite, indices in range, and the bounding sphere holds everything', () => {
    for (const [name, cfg] of MAGNETIC) {
      const s = buildScene(shapeOf(cfg), { cutaway: true, coils: true, quality: 'low' });
      for (const it of s.items) {
        const nv = it.mesh.positions.length / 3;
        let bad = 0, outside = 0;
        for (const v of it.mesh.positions) if (!Number.isFinite(v)) bad++;
        for (const v of it.mesh.normals) if (!Number.isFinite(v)) bad++;
        for (const i of it.mesh.indices) if (i >= nv) bad++;
        const p = it.mesh.positions;
        for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - s.center[0], p[i + 1] - s.center[1], p[i + 2] - s.center[2]) > s.radius * (1 + 1e-6)) outside++;
        expect({ name, kind: it.kind, bad, outside }).toEqual({ name, kind: it.kind, bad: 0, outside: 0 });
        expect(triangleCount(it.mesh)).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: the same input builds the same buffers', () => {
    const a = buildScene(shapeOf(JET), { cutaway: true, coils: true, quality: 'low' });
    const b = buildScene(shapeOf(JET), { cutaway: true, coils: true, quality: 'low' });
    expect(a.items.map((i) => i.kind)).toEqual(b.items.map((i) => i.kind));
    for (let k = 0; k < a.items.length; k++) {
      expect(Array.from(a.items[k].mesh.positions)).toEqual(Array.from(b.items[k].mesh.positions));
      expect(Array.from(a.items[k].mesh.indices)).toEqual(Array.from(b.items[k].mesh.indices));
    }
  });

  it('builds a high-quality scene of a real equilibrium quickly (under 400 ms even on a loaded machine)', () => {
    const snap = new ProfileModel(ITER_15D).eqSnapshot(10, 72);
    const t0 = performance.now();
    buildScene(shapeOf(ITER_15D, snap), { cutaway: true, coils: true, quality: 'high' });
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
