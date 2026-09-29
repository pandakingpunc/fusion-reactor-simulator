/**
 * The output flux-surface table of the Grad–Shafranov solver: where its surfaces sit (surfaceLevels) and what the
 * metrics of the outer transport cells are made of. On ψ_N = (k/50)² tables, the last interval of a fixed-boundary
 * D-shape spans 0.04 of ψ_N, where q, ⟨|∇ψ|²⟩ and dV/dψ_N follow a boundary layer of about 1e-3 (|∇ψ| on the last
 * surface is small where the boundary is strongly shaped): ρ_tor of the outer nodes, a cumulative integral of q, came
 * out too small and the g1, g2 and q of the outer cells were off by 1.2 % (ITER15) to 14.7 % (MASTU15).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_N_SURF, Equilibrium, GSFailure, GSSolver, surfaceLevels } from './gs';
import { geometryFromEquilibrium, TransportGeometry } from '../profiles/geometry1d';
import { ITER_15D, MASTU, PRESETS } from '../presets';
import type { MagneticConfig } from '../types';
import { Pchip } from '../numerics/interp';

/** the ψ_N = t² levels of the old default table */
const quadraticLevels = (n: number) => Float64Array.from({ length: n - 1 }, (_, k) => ((k + 1) / (n - 1)) ** 2);

describe('surfaceLevels', () => {
  it('is monotone, ends on the boundary and follows ψ_N ≈ t² at the axis', () => {
    for (const n of [4, 11, 51, 101, 401]) {
      const L = surfaceLevels(n);
      expect(L.length).toBe(n - 1);
      expect(L[n - 2]).toBe(1);
      for (let k = 1; k < L.length; k++) expect(L[k]).toBeGreaterThan(L[k - 1]);
      expect(L[0]).toBeGreaterThan(0);
      // near the axis ψ_N = s + s² − s³ with s = t²: within 2t² of t²
      const t = 1 / (n - 1);
      expect(L[0] / (t * t)).toBeGreaterThan(1);
      expect(L[0] / (t * t)).toBeLessThan(1 + 2 * t * t);
    }
  });

  it('clusters the surfaces at the edge: 1 − ψ_N ≈ 2(1 − t²)² instead of the 0.04 (n = 51) or 0.02 (n = 101) of ψ_N = t²', () => {
    const L51 = surfaceLevels(51), L101 = surfaceLevels(101);
    expect(1 - L51[L51.length - 2]).toBeGreaterThan(2e-3);
    expect(1 - L51[L51.length - 2]).toBeLessThan(4e-3);
    expect(1 - L101[L101.length - 2]).toBeGreaterThan(6e-4);
    expect(1 - L101[L101.length - 2]).toBeLessThan(1e-3);
    // the last interval of ψ_N shrinks by 4 when the number of surfaces doubles (slope 0 at the boundary)
    const d = (L: Float64Array) => L[L.length - 1] - L[L.length - 2];
    expect(d(surfaceLevels(51)) / d(surfaceLevels(101))).toBeGreaterThan(3.5);
    // the plain table has 0.04 and 0.02 there
    expect(1 - quadraticLevels(51)[48]).toBeCloseTo(0.0396, 4);
  });

  it('refuses fewer than 4 nodes; the default table has DEFAULT_N_SURF nodes', () => {
    expect(() => surfaceLevels(3)).toThrow(GSFailure);
    expect(() => surfaceLevels(10.5)).toThrow(/integer/);
    const solver = new GSSolver({ R: 3, a: 1, kappa: 1.5, delta: 0.3 }, { NR: 33 });
    const eq = solver.solve({ Ip: 1e6, B0: 2, profile: { kind: 'shape', alphaM: 2, alphaN: 1, betaP: 0.3 } });
    expect(eq.prof.psiN.length).toBe(DEFAULT_N_SURF);
    expect(eq.prof.psiN[0]).toBe(0);
    expect(eq.prof.psiN[DEFAULT_N_SURF - 1]).toBe(1);
    expect(Array.from(eq.prof.psiN.slice(1))).toEqual(Array.from(surfaceLevels(DEFAULT_N_SURF)));
    const small = solver.solve({ Ip: 1e6, B0: 2, profile: { kind: 'shape', alphaM: 2, alphaN: 1, betaP: 0.3 }, nSurf: 21 });
    expect(small.prof.psiN.length).toBe(21);
  });

  it('psiLevels sets the surfaces explicitly and is validated', () => {
    const solver = new GSSolver({ R: 3, a: 1, kappa: 1.5, delta: 0.3 }, { NR: 33 });
    const o = { Ip: 1e6, B0: 2, profile: { kind: 'shape' as const, alphaM: 2, alphaN: 1, betaP: 0.3 } };
    const eq = solver.solve({ ...o, psiLevels: [0.1, 0.4, 0.9, 1] });
    expect(Array.from(eq.prof.psiN)).toEqual([0, 0.1, 0.4, 0.9, 1]);
    expect(eq.prof.rhoTor[4]).toBeCloseTo(1, 12);
    const bad: [string, number[]][] = [['too few', [0.5, 1]], ['not increasing', [0.5, 0.4, 1]], ['does not end at 1', [0.2, 0.5, 0.9]], ['above 1', [0.2, 1, 1.2]], ['zero', [0, 0.5, 1]]];
    for (const [name, psiLevels] of bad) {
      let e: unknown;
      try { solver.solve({ ...o, psiLevels }); } catch (x) { e = x; }
      expect(e, name).toBeInstanceOf(GSFailure);
      expect((e as GSFailure).reason, name).toBe('bad-input');
    }
  });
});

/**
 * The transport geometry (50 cells) of the shapes of the 1.5D golden cases with the largest edge effect, from the
 * default table, against a table of 401 surfaces on the same law (and, for MASTU15, against 801 surfaces traced with
 * twice the rays).
 */
describe('outer-cell metrics of the default surface table', () => {
  const N = 50;
  // MASTU15 in the shape the numbers below (14 % on the plain table) were measured on: the machine's design-maximum shape, which the
  // preset had until v4.0 moved it to a first-campaign scenario (R 0.8 m, a 0.5 m, kappa 2.1, 0.75 MA, 0.55 T; `mastuNow`)
  const mastu = { ...MASTU, fidelity: '1.5D', geometry: { R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, B0: 0.75, Ip_MA: 1.0 } as MagneticConfig;
  const mastuNow = { ...MASTU, fidelity: '1.5D' } as MagneticConfig;
  const sparc = PRESETS.find((p) => p.id === 'SPARC15')!.cfg as MagneticConfig;
  const build = (cfg: MagneticConfig, betaP: number, opts: { nSurf?: number; psiLevels?: ArrayLike<number>; nTheta?: number } = {}) => {
    const shape = { R: cfg.geometry.R, a: cfg.geometry.a, kappa: cfg.profiles?.lcfsKappa ?? cfg.geometry.kappa, delta: cfg.profiles?.lcfsDelta ?? cfg.geometry.delta };
    const eq = new GSSolver(shape, { NR: 49 }).solve({ Ip: cfg.Ip_MA * 1e6, B0: cfg.B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP }, tol: 1e-9, ...opts });
    return { eq, g: geometryFromEquilibrium(eq, N, shape) };
  };
  const worst = (a: TransportGeometry, b: TransportGeometry, key: 'g1F' | 'g2F' | 'VpF' | 'qEqC' | 'dV' | 'gradRhoF', i0: number, i1: number) => {
    let m = 0;
    for (let i = i0; i <= i1; i++) m = Math.max(m, Math.abs(a[key][i] / b[key][i] - 1));
    return m;
  };
  const OUTER_FACES: [number, number] = [N - 3, N], OUTER_CELLS: [number, number] = [N - 3, N - 1];

  const cases: [string, MagneticConfig, number][] = [
    ['ITER15', ITER_15D, 0.5],
    ['SPARC15', sparc, 0.6],
    ['MASTU15 (design-maximum shape) at start-up (β_p 0.1)', mastu, 0.1],
    ['MASTU15 (design-maximum shape) at β_p 0.8', mastu, 0.8],
    ['MASTU15 (first-campaign preset) at start-up (β_p 0.1)', mastuNow, 0.1],
    ['MASTU15 (first-campaign preset) at β_p 0.8', mastuNow, 0.8],
  ];
  for (const [name, cfg, betaP] of cases) {
    it(`${name}: g1, g2, V′, ∇ρ, q and ΔV of the outer faces and cells are within 0.5 % of the 401-surface table`, () => {
      const ref = build(cfg, betaP, { nSurf: 401 }).g;
      const g = build(cfg, betaP).g;
      for (const key of ['g1F', 'g2F', 'VpF', 'gradRhoF'] as const) expect(worst(g, ref, key, ...OUTER_FACES), key).toBeLessThan(5e-3);
      for (const key of ['qEqC', 'dV'] as const) expect(worst(g, ref, key, ...OUTER_CELLS), key).toBeLessThan(5e-3);
      // and the whole radius
      expect(worst(g, ref, 'g1F', 1, N)).toBeLessThan(5e-3);
      expect(worst(g, ref, 'g2F', 1, N)).toBeLessThan(5e-3);
      expect(worst(g, ref, 'qEqC', 0, N - 1)).toBeLessThan(5e-3);
    }, 60000);
  }

  it('the ψ_N = t² table of 51 surfaces of the same equilibrium is far outside that: MASTU15 g1, g2 and q of the outer cells 14 %, ITER15 1.2 %', () => {
    const plain = (cfg: MagneticConfig, betaP: number) => build(cfg, betaP, { psiLevels: quadraticLevels(51) }).g;
    const m = worst(plain(mastu, 0.1), build(mastu, 0.1, { nSurf: 401 }).g, 'g1F', ...OUTER_FACES);
    expect(m).toBeGreaterThan(0.1);
    expect(m).toBeLessThan(0.2);
    const i = worst(plain(ITER_15D, 0.5), build(ITER_15D, 0.5, { nSurf: 401 }).g, 'g1F', ...OUTER_FACES);
    expect(i).toBeGreaterThan(0.01);
    expect(i).toBeLessThan(0.02);
  }, 60000);

  it('MASTU15: the default table follows an 801-surface table traced with 256 rays as well (the 401 reference is not the limit)', () => {
    const truth = build(mastu, 0.8, { nSurf: 801, nTheta: 256 }).g;
    const g = build(mastu, 0.8).g;
    for (const key of ['g1F', 'g2F', 'VpF'] as const) expect(worst(g, truth, key, 1, N), key).toBeLessThan(5e-3);
    expect(worst(g, truth, 'qEqC', 0, N - 1)).toBeLessThan(5e-3);
  }, 60000);

  it('ρ_tor of the outer nodes: 5e-4 (ITER15) and 1.2e-2 (MASTU15) too small at ψ_N = 0.96 on the plain table, within 1e-3 now', () => {
    const rhoAt = (eq: Equilibrium, x: number) => new Pchip(eq.prof.psiN, eq.prof.rhoTor).eval(x);
    for (const [cfg, betaP] of [[ITER_15D, 0.5], [mastu, 0.1]] as [MagneticConfig, number][]) {
      const ref = build(cfg, betaP, { nSurf: 801, nTheta: 256 }).eq;
      const now = build(cfg, betaP).eq;
      const plain = build(cfg, betaP, { psiLevels: quadraticLevels(51) }).eq;
      for (const x of [0.9, 0.96, 0.99]) expect(Math.abs(rhoAt(now, x) - rhoAt(ref, x)), `x = ${x}`).toBeLessThan(1e-3);
      expect(Math.abs(rhoAt(plain, 0.96) - rhoAt(ref, 0.96))).toBeGreaterThan(cfg === mastu ? 5e-3 : 1e-4);
    }
  }, 60000);
});
