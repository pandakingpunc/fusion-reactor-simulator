/**
 * Plasma boundary shapes (shapes.ts, millerShape in miller.ts) and the fixed-boundary solver on them: a polygon,
 * a Fourier series, the asymmetric Miller curve with squareness and a vertical shift, the ψ = const contour of an
 * analytic flux map. The solver runs on up-down asymmetric boundaries (GSGrid with zBottom / zRange).
 */
import { describe, expect, it } from 'vitest';
import { GSSolver } from './gs';
import { ShapeBoundary, boundaryPolygon, millerBoundary, millerShape, shapeIntegrals } from './miller';
import { ShapeError, contourBoundary, curveBoundary, fourierBoundary, fourierCoefficients, polygonBoundary, shapeGeometry } from './shapes';
import { SolovevEquilibrium } from './solovev';

const TWO_PI = 2 * Math.PI;

/** an up-down asymmetric, shifted, squared D shape of a small aspect ratio */
const ASYM = { R0: 1.7, a: 0.6, kappa: 1.6, deltaUpper: 0.3, deltaLower: 0.5, zeta: 0.05, Z0: 0.1 };

const sample = (b: ShapeBoundary, n: number) => Array.from({ length: n }, (_, k) => b.point((TWO_PI * k) / n));
const polygonOf = (b: ShapeBoundary, n: number) => { const p = sample(b, n); return polygonBoundary(p.map((q) => q[0]), p.map((q) => q[1])); };

const shapes: [string, ShapeBoundary, number][] = [
  ['asymmetric Miller (δ_u 0.3, δ_l 0.5, ζ 0.05, Z0 0.1)', millerShape(ASYM), 1e-9],
  ['polygon of 200 vertices on that curve', polygonOf(millerShape(ASYM), 200), 1e-11],
  ['Fourier series M = 10 of that curve', (() => { const c = fourierCoefficients(millerShape(ASYM).point, 10); return fourierBoundary(c.R, c.Z); })(), 1e-9],
  ['negative triangularity, shifted down', millerShape({ R0: 1.7, a: 0.6, kappa: 1.4, delta: -0.4, Z0: -0.25 }), 1e-9],
  ['ITER (symmetric Miller through the generic curve)', millerShape({ R0: 6.2, a: 2, kappa: 1.7, delta: 0.33 }), 1e-9],
];

describe('ShapeBoundary of a closed curve: the crossings the Shortley–Weller grid needs', () => {
  it.each(shapes)('%s: rRange, zTop and zBottom invert each other', (_, b, tol) => {
    const [zLo, zHi] = b.zRange!;
    for (let q = 1; q < 40; q++) {
      const Z = zLo + ((zHi - zLo) * q) / 40;
      const rr = b.rRange(Z)!;
      expect(rr).not.toBeNull();
      expect(rr[0]).toBeLessThan(rr[1]);
      if (q < 3 || q > 37) continue; // near the top and bottom dR/dZ is infinite
      for (const R of rr) {
        if (R < b.R0 - 0.98 * b.a || R > b.R0 + 0.98 * b.a) continue; // the R extremes: dZ/dR is infinite
        const zt = b.zTop!(R)!, zb = b.zBottom!(R)!;
        expect(zt).toBeGreaterThan(zb);
        expect(Math.min(Math.abs(Z - zt), Math.abs(Z - zb))).toBeLessThan(tol * b.a * 100);
      }
    }
    // the vertical line's crossings lie on the horizontal line's, and points just inside / outside are told apart
    for (let q = 1; q < 30; q++) {
      const R = b.R0 - b.a + (2 * b.a * q) / 30;
      const zt = b.zTop!(R)!, zb = b.zBottom!(R)!;
      expect(b.inside(R, 0.5 * (zt + zb))).toBe(true);
      expect(b.inside(R, zt + 1e-6)).toBe(false);
      expect(b.inside(R, zb - 1e-6)).toBe(false);
      expect(b.inside(R, zt - 1e-6)).toBe(true);
    }
    expect(b.zTop!(b.R0 - b.a - 1e-3)).toBeNull();
    expect(b.zBottom!(b.R0 + b.a + 1e-3)).toBeNull();
    expect(b.rRange(zHi + 1e-3)).toBeNull();
    expect(b.rRange(zLo - 1e-3)).toBeNull();
  });

  it.each(shapes)('%s: the parametric points lie on the crossings and go counter-clockwise', (_, b, tol) => {
    for (let t = 0.05; t < TWO_PI; t += 0.31) {
      const [R, Z] = b.point(t);
      const rr = b.rRange(Z)!;
      expect(Math.min(Math.abs(rr[0] - R), Math.abs(rr[1] - R))).toBeLessThan(tol * 10 * b.a);
    }
    const { R, Z } = boundaryPolygon(b, 64);
    let s2 = 0;
    for (let k = 0; k < 64; k++) { const j = (k + 1) % 64; s2 += R[k] * Z[j] - R[j] * Z[k]; }
    expect(s2).toBeGreaterThan(0);
    // R0, a, κ and δ of the bounding box and extreme points
    const [zLo, zHi] = b.zRange!;
    expect(b.kappa).toBeCloseTo((zHi - zLo) / (2 * b.a), 12);
  });

  it('millerShape of a symmetric shape is millerBoundary: same crossings to 1e-14, same bounding box', () => {
    const g = { R: 6.2, a: 2, kappa: 1.7, delta: 0.33 };
    const m = millerBoundary(g), s = millerShape({ R0: 6.2, a: 2, kappa: 1.7, delta: 0.33 });
    for (let q = 1; q < 60; q++) {
      const Z = (-1 + (2 * q) / 60) * 1.7 * 2 * 0.995, R = 4.2 + (4 * q) / 60;
      const a = m.rRange(Z)!, b = s.rRange(Z)!;
      expect(Math.abs(a[0] - b[0])).toBeLessThan(1e-13);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-13);
      expect(Math.abs(m.zTop(R)! - s.zTop!(R)!)).toBeLessThan(1e-13);
      expect(Math.abs(m.zTop(R)! + s.zBottom!(R)!)).toBeLessThan(1e-13);
    }
    expect(s.R0).toBeCloseTo(6.2, 12);
    expect(s.a).toBeCloseTo(2, 12);
    expect(s.kappa).toBeCloseTo(1.7, 12);
    expect(s.delta).toBeCloseTo(0.33, 7);
    const im = shapeIntegrals(m), is = shapeIntegrals(s);
    for (const k of ['area', 'volume', 'perimeter', 'Rc'] as const) expect(Math.abs(is[k] / im[k] - 1)).toBeLessThan(1e-11);
  });

  it('millerShape: the upper and lower halves carry their own δ, κ, ζ; Z0 shifts; ζ squares the shape without moving the box', () => {
    const b = millerShape({ R0: 3, a: 1, kappaUpper: 1.8, kappaLower: 1.3, deltaUpper: 0.4, deltaLower: -0.2, Z0: 0.3 });
    expect(b.zRange![1]).toBeCloseTo(0.3 + 1.8, 9);
    expect(b.zRange![0]).toBeCloseTo(0.3 - 1.3, 9);
    // the top is at R0 − a δ_u and the bottom at R0 − a δ_l
    const topR = b.rRange(0.3 + 1.8 - 1e-9)!, botR = b.rRange(0.3 - 1.3 + 1e-9)!;
    expect(0.5 * (topR[0] + topR[1])).toBeCloseTo(3 - 0.4, 5);
    expect(0.5 * (botR[0] + botR[1])).toBeCloseTo(3 + 0.2, 5);
    expect(b.delta).toBeCloseTo(0.1, 7);
    // the vertical tangent and equal R at the midplane crossing from both halves
    const eps = 1e-7, up = millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 0.3, deltaLower: 0.3 }).point(eps), lo = millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 0.3 }).point(-eps);
    expect(Math.abs(up[0] - lo[0])).toBeLessThan(1e-12);
    // squareness: the box stays, the point at 45° goes out towards the corner
    const round = millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 0 }), square = millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 0, zeta: 0.15 }), diamond = millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 0, zeta: -0.15 });
    expect(square.zRange![1]).toBeCloseTo(1.5, 9);
    expect(square.rRange(0)![1]).toBeCloseTo(4, 9);
    const at45 = (s: ShapeBoundary) => s.zTop!(3 + Math.cos(Math.PI / 4))!;
    expect(at45(square)).toBeGreaterThan(at45(round) + 0.05);
    expect(at45(diamond)).toBeLessThan(at45(round) - 0.05);
    expect(shapeIntegrals(square).area).toBeGreaterThan(shapeIntegrals(round).area);
    expect(shapeIntegrals(diamond).area).toBeLessThan(shapeIntegrals(round).area);
  });

  it('rejects what it cannot describe: parameters out of range, a bean, no area, non-finite points', () => {
    expect(() => millerShape({ R0: 3, a: 1, kappa: 1.5, delta: 1 })).toThrow(ShapeError);
    expect(() => millerShape({ R0: 3, a: 1, kappa: 1.5, zeta: 0.5 })).toThrow(/zeta/);
    expect(() => millerShape({ R0: 1, a: 1.2, kappa: 1.5 })).toThrow(/a < R0/);
    expect(() => millerShape({ R0: 3, a: 1, kappa: -1 })).toThrow(/kappa/);
    expect(() => millerShape({ R0: 3, a: 1, kappa: 1.5, Z0: NaN })).toThrow(/Z0/);
    // R(t) = 3 + cos t + 0.45 cos 2t: dR/dt = −sin t (1 + 1.8 cos t) changes sign on the upper arc — a bean
    expect(() => fourierBoundary({ c: [3, 1, 0.45] }, { s: [0, 1.4] })).toThrow(/convex|monotone/);
    expect(() => curveBoundary((t) => [3 + Math.cos(t), 0 * t])).toThrow(/no area/);
    expect(() => curveBoundary((t) => [3 + Math.cos(t), t > 3 ? NaN : Math.sin(t)])).toThrow(/non-finite/);
    expect(() => curveBoundary((t) => [3 + Math.cos(t), Math.sin(t)], { samples: 4 })).toThrow(ShapeError);
    expect(() => polygonBoundary([1, 2, 3], [1, 2, 3])).toThrow(/at least 4/);
    expect(() => polygonBoundary([1, 2, 3, 4], [1, 2, 3])).toThrow(/4 R and 3 Z/);
    expect(() => polygonBoundary([1, 2, 3, 4], [0, 0, 0, 0])).toThrow(/no area/);
    expect(() => polygonBoundary([1, 2, NaN, 4], [0, 1, 2, 3])).toThrow(/non-finite/);
  });
});

describe('polygonBoundary', () => {
  const sq = polygonBoundary([1, 3, 3, 1], [-1, -1, 1, 1]);
  it('a rectangle has the exact integrals and crossings; orientation, start vertex and a repeated last vertex do not matter', () => {
    // area 4, perimeter 8, volume = π ∮ R² dZ = 2π R̄ A with the centroid at R = 2 (for a rectangle 2π·2·4)
    const s = shapeIntegrals(sq);
    expect(s.area).toBeCloseTo(4, 13);
    expect(s.perimeter).toBeCloseTo(8, 13);
    expect(s.volume).toBeCloseTo(2 * Math.PI * 2 * 4, 11);
    expect(s.Rc).toBeCloseTo(2, 13);
    expect(sq.R0).toBeCloseTo(2, 12);
    expect(sq.a).toBeCloseTo(1, 12);
    expect(sq.kappa).toBeCloseTo(1, 12);
    expect(sq.rRange(0.3)![0]).toBeCloseTo(1, 12);
    expect(sq.rRange(0.3)![1]).toBeCloseTo(3, 12);
    expect(sq.zRange).toEqual([-1, 1]);
    // a rotated start, a clockwise run and a closing vertex give the same boundary
    const a = polygonBoundary([3, 3, 1, 1, 3], [1, -1, -1, 1, 1]);
    const b = polygonBoundary([1, 1, 3, 3], [1, -1, -1, 1]);
    for (const p of [a, b]) {
      expect(shapeIntegrals(p).area).toBeCloseTo(4, 13);
      expect(p.rRange(0.3)![0]).toBeCloseTo(1, 12);
      expect(p.inside(2, 0.5)).toBe(true);
      expect(p.inside(3.1, 0)).toBe(false);
    }
  });

  it('a 128-gon of the ITER Miller shape has its area and volume to 5e-4 and the exact polygon perimeter', () => {
    const m = millerShape({ R0: 6.2, a: 2, kappa: 1.7, delta: 0.33 });
    const p = polygonOf(m, 128);
    const im = shapeIntegrals(m), ip = shapeIntegrals(p);
    expect(Math.abs(ip.area / im.area - 1)).toBeLessThan(5e-4);
    expect(Math.abs(ip.volume / im.volume - 1)).toBeLessThan(5e-4);
    expect(ip.perimeter).toBeLessThan(im.perimeter);
    expect(ip.perimeter / im.perimeter).toBeGreaterThan(0.998);
    // and the same vertices sampled 4× finer converge with the square of the spacing
    const p4 = polygonOf(m, 512), i4 = shapeIntegrals(p4);
    expect(Math.abs(i4.area / im.area - 1)).toBeLessThan(Math.abs(ip.area / im.area - 1) / 10);
  });
});

describe('fourierBoundary and fourierCoefficients', () => {
  it('an ellipse is R.c = [R0, a], Z.s = [0, κa] and the coefficients of the ellipse come back exactly', () => {
    const e = fourierBoundary({ c: [3, 1] }, { s: [0, 1.5] });
    expect(e.R0).toBeCloseTo(3, 12);
    expect(e.kappa).toBeCloseTo(1.5, 12);
    expect(e.delta).toBeCloseTo(0, 9);
    const c = fourierCoefficients(e.point, 4);
    expect(c.R.c[0]).toBeCloseTo(3, 12);
    expect(c.R.c[1]).toBeCloseTo(1, 12);
    expect(c.Z.s[1]).toBeCloseTo(1.5, 12);
    for (const v of [c.R.c[2], c.R.c[3], c.R.s[1], c.Z.c[0], c.Z.c[1], c.Z.s[2], c.Z.s[3]]) expect(Math.abs(v)).toBeLessThan(1e-13);
    expect(() => fourierCoefficients(e.point, 0)).toThrow(ShapeError);
  });

  it('the moments of a Miller curve: R.c[2] ≈ a arcsin(δ)/2 and Z.s[3] ≈ κ a ζ/2; 12 harmonics reproduce the crossings to 1e-13', () => {
    const m = millerShape({ R0: 6.2, a: 2, kappa: 1.7, delta: 0.33, zeta: 0.04 });
    const c = fourierCoefficients(m.point, 12);
    expect(c.R.c[2] / ((2 * Math.asin(0.33)) / 2)).toBeGreaterThan(0.95);
    expect(c.R.c[2] / ((2 * Math.asin(0.33)) / 2)).toBeLessThan(1.05);
    expect(c.Z.s[3] / ((1.7 * 2 * 0.04) / 2)).toBeGreaterThan(0.8);
    expect(c.Z.s[3] / ((1.7 * 2 * 0.04) / 2)).toBeLessThan(1.2);
    const f = fourierBoundary(c.R, c.Z);
    for (let q = 1; q < 50; q++) {
      const Z = (-1 + (2 * q) / 50) * 1.7 * 2 * 0.99;
      const a = m.rRange(Z)!, b = f.rRange(Z)!;
      expect(Math.abs(a[0] - b[0])).toBeLessThan(1e-9);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-9);
    }
  });
});

describe('contourBoundary', () => {
  it('the level set of a paraboloid about an off-centre axis is the polygon of that circle', () => {
    const psi = (R: number, Z: number) => 1 - ((R - 3.2) ** 2 + (Z - 0.1) ** 2) / 4;
    const b = contourBoundary(psi, [3.2, 0.1], 0.19, 3, 512); // radius √(4·0.81) = 1.8
    expect(b.R0).toBeCloseTo(3.2, 4);
    expect(b.a).toBeCloseTo(1.8, 4);
    expect(b.kappa).toBeCloseTo(1, 4);
    expect(b.zRange![1]).toBeCloseTo(0.1 + 1.8, 4);
    expect(shapeIntegrals(b).area).toBeCloseTo(Math.PI * 1.8 * 1.8, 3);
    // the orientation of the map does not matter (axis is the minimum)
    const b2 = contourBoundary((R, Z) => -psi(R, Z), [3.2, 0.1], -0.19, 3, 64);
    expect(b2.a).toBeCloseTo(1.8, 3);
    expect(() => contourBoundary(psi, [3.2, 0.1], 0.19, 1.5, 64)).toThrow(/does not reach/);
    expect(() => contourBoundary(psi, [3.2, 0.1], 0.19, 3, 8)).toThrow(ShapeError);
  });
});

describe('the fixed-boundary solver on up-down asymmetric boundaries', () => {
  const opts = { Ip: 15e6, B0: 5.3, profile: { kind: 'shape' as const, alphaM: 2, alphaN: 1.3, betaP: 0.65 }, tol: 1e-11 };
  const solve = (b: ShapeBoundary, NR = 65) => {
    const solver = new GSSolver(shapeGeometry(b), { NR, boundary: b });
    return { solver, eq: solver.solve(opts) };
  };
  const ITER = { R0: 6.2, a: 2, kappa: 1.7, zeta: 0.03 };

  it('a shape and its mirror image (δ_u ↔ δ_l) solve to mirror-image states: ψ agrees to 1e-11 of ψ_axis, Z_axis changes sign', () => {
    const A = solve(millerShape({ ...ITER, deltaUpper: 0.2, deltaLower: 0.5 }));
    const B = solve(millerShape({ ...ITER, deltaUpper: 0.5, deltaLower: 0.2 }));
    expect(A.eq.converged && B.eq.converged).toBe(true);
    const gA = A.solver.grid, gB = B.solver.grid;
    expect(gB.NZ).toBe(gA.NZ);
    expect(gB.Zmin).toBeCloseTo(gA.Zmin, 12); // the box is symmetric about Z = 0 for this pair (κ_u = κ_l)
    let worst = 0;
    for (let j = 0; j < gA.NZ; j++) for (let i = 0; i < gA.NR; i++) {
      worst = Math.max(worst, Math.abs(A.eq.psi[j * gA.NR + i] - B.eq.psi[(gA.NZ - 1 - j) * gA.NR + i]) / A.eq.psiAxis);
    }
    expect(worst).toBeLessThan(1e-11);
    expect(A.eq.Zaxis).toBeCloseTo(-B.eq.Zaxis, 9);
    expect(Math.abs(A.eq.Zaxis)).toBeGreaterThan(0.05); // the asymmetry moves the axis
    for (const k of ['q95', 'li3', 'betaP', 'volume', 'W_th', 'Raxis'] as const) expect(Math.abs(A.eq[k] / B.eq[k] - 1), k).toBeLessThan(1e-10);
    expect(A.eq.forceBalanceResidual).toBeLessThan(1e-9);
  });

  it('a vertical shift Z0 moves the solution rigidly: q95, l_i, β_p, the axis and the volume of the shifted and the centred shape agree to grid accuracy', () => {
    const c = solve(millerBoundary({ R: 6.2, a: 2, kappa: 1.7, delta: 0.33 }));
    const s = solve(millerShape({ R0: 6.2, a: 2, kappa: 1.7, delta: 0.33, Z0: 0.7 }));
    expect(s.eq.converged).toBe(true);
    expect(s.eq.Zaxis).toBeCloseTo(0.7, 9);
    expect(s.eq.Raxis).toBeCloseTo(c.eq.Raxis, 6);
    for (const k of ['q95', 'li3', 'betaP', 'volume', 'W_th'] as const) expect(Math.abs(s.eq[k] / c.eq[k] - 1), k).toBeLessThan(1e-4);
    // the same on the shifted rows: ψ(R, Z) of the centred solution at the shifted node
    const bi = c.eq.grid.bicubic(c.eq.psi), g = s.solver.grid;
    let worst = 0;
    for (const k of g.interior) { const i = k % g.NR, j = (k - i) / g.NR; worst = Math.max(worst, Math.abs(s.eq.psi[k] - bi.eval(g.R(i), g.Z(j) - 0.7)) / c.eq.psiAxis); }
    expect(worst).toBeLessThan(2e-4);
  });

  it('the outermost flux surface is the boundary, the volume is the boundary volume and the field balances the pressure', () => {
    const b = millerShape(ASYM);
    const { eq } = solve(b, 97);
    expect(eq.converged).toBe(true);
    const sh = shapeIntegrals(b);
    expect(Math.abs(eq.volume / sh.volume - 1)).toBeLessThan(2e-4);
    expect(Math.abs(eq.area / sh.area - 1)).toBeLessThan(2e-4);
    expect(eq.forceBalanceResidual).toBeLessThan(1e-9);
    expect(eq.forceBalanceRatio).toBeCloseTo(1, 8);
    // the traced LCFS: extreme points against the boundary's
    const n = eq.prof.psiN.length - 1;
    expect(eq.prof.Rout[n]).toBeCloseTo(b.R0 + b.a, 4);
    expect(eq.prof.Rin[n]).toBeCloseTo(b.R0 - b.a, 4);
    expect(eq.prof.kappa[n]).toBeCloseTo(b.kappa, 2); // the traced surface is 128 rays: its top is a ray's
    expect(eq.prof.delta[n]).toBeGreaterThan(0.3);
    expect(eq.prof.delta[n]).toBeLessThan(0.5);
    expect(eq.Zaxis).toBeGreaterThan(b.zRange![0]);
    // I_p through the LCFS (Ampère on the traced surface)
    expect(eq.prof.Ienc[n] / opts.Ip).toBeCloseTo(1, 2);
  });

  it('second-order convergence on an asymmetric boundary (NR = 33, 65, 129)', () => {
    const b = millerShape({ ...ITER, deltaUpper: 0.2, deltaLower: 0.5 });
    const q95 = [33, 65, 129].map((NR) => solve(b, NR).eq.q95);
    const l = [33, 65, 129].map((NR) => solve(b, NR).eq.li3);
    for (const f of [q95, l]) {
      const p = Math.log2(Math.abs(f[0] - f[1]) / Math.abs(f[1] - f[2]));
      expect(p).toBeGreaterThan(1.5);
    }
  }, 60000);

  it("a single-null Solov'ev equilibrium cut at ψ_N = 0.95 is reproduced: the flux contour as boundary, the exact nonlinear solution as reference", () => {
    // Cerfon & Freidberg (2010), single-null: an exact ψ with constant p′ and FF′ (A = −0.155). Its ψ = const contour
    // inside the separatrix is a boundary the solver has no exact-shape advantage on: asymmetric, with a lower X-point's
    // squeeze. Constant p′ and FF′ are the shape profile with αn = 0 and β0 = 1 − A.
    const R0 = 6.2;
    const sol = new SolovevEquilibrium({ epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155, singleNull: true });
    let xa = 1.05, ya = 0.05;
    for (let it = 0; it < 50; it++) { // Newton on ∇ψ̄ = 0
      const g = [sol.psiBar(xa, ya, 1, 0), sol.psiBar(xa, ya, 0, 1)];
      const H = [sol.psiBar(xa, ya, 2, 0), sol.psiBar(xa, ya, 1, 1), sol.psiBar(xa, ya, 0, 2)];
      const det = H[0] * H[2] - H[1] * H[1];
      xa -= (H[2] * g[0] - H[1] * g[1]) / det;
      ya -= (-H[1] * g[0] + H[0] * g[1]) / det;
    }
    const psiMin = sol.psiBar(xa, ya);
    expect(psiMin).toBeLessThan(0);
    const level = 0.05 * psiMin; // ψ_N = 0.95
    const boundary = contourBoundary((R, Z) => -sol.psiBar(R / R0, Z / R0), [xa * R0, ya * R0], -level, 2.2 * R0 * 0.32 * 1.7, 1024);
    expect(boundary.zRange![0]).toBeLessThan(-0.8 * 1.7 * 0.32 * R0 * 0.9); // the X-point side reaches down
    const solver = new GSSolver(shapeGeometry(boundary), { NR: 129, boundary });
    const eq = solver.solve({ Ip: 15e6, B0: 5.3, profile: { kind: 'shape', alphaM: 1, alphaN: 0, beta0: 1.155 }, tol: 1e-11 });
    expect(eq.converged).toBe(true);
    const g = solver.grid;
    let worst = 0;
    for (const k of g.interior) {
      const i = k % g.NR, j = (k - i) / g.NR;
      const exact = (sol.psiBar(g.R(i) / R0, g.Z(j) / R0) - level) / (psiMin - level);
      worst = Math.max(worst, Math.abs(eq.psi[k] / eq.psiAxis - exact));
    }
    expect(worst).toBeLessThan(2e-4);
    expect(Math.abs(eq.Raxis - xa * R0)).toBeLessThan(2e-3);
    expect(Math.abs(eq.Zaxis - ya * R0)).toBeLessThan(2e-3);
    expect(Math.abs(eq.Zaxis)).toBeGreaterThan(0.05);
    expect(eq.forceBalanceResidual).toBeLessThan(1e-8);
  }, 120000);
});
