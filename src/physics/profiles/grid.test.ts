/**
 * The radial grid of the 1.5D model (geometry1d.ts): the legacy uniform grid (ProfileSettings.gridPacking
 * = 0) and the tanh edge packing; the finite-volume solvers on a packed grid (a manufactured solution
 * of the diffusion operator with observed order above 1.8, exact conservation of energy, particles and
 * enclosed current), the spacing-dependent helpers (alphaMHD with the separatrix face, rhoOfQ, shearAt),
 * the number of cells across the pedestal, and pins of the uniform-grid results of the last release,
 * so that gridPacking 0 stays the model of v3 bit for bit.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D, SPARC_15D } from '../presets';
import { ProfileModel } from './model';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { CurrentSolver, DensitySolver, HEAT_CONVECTION, HeatInputs, HeatSolver } from './fvsolver';
import {
  GridSpec, PACKING_CENTER, PACKING_WIDTH, buildGrid, cellIndex, centerInterval, circularGeometry, faceValue, gridSpec, interpCells, nearestFace, packedFaces,
} from './geometry1d';
import { alphaMHD, rhoOfQ, shearAt } from './mhd';
import { volumeIntegral } from './sources/deposition';
import type { MagneticConfig } from '../types';
import { rel } from './testkit';

const PACK: GridSpec = gridSpec({ gridPacking: 4, pedestalWidth: 0.06 })!;

describe('gridSpec', () => {
  it('no packing without a positive gridPacking; the step follows the pedestal width', () => {
    expect(gridSpec({ pedestalWidth: 0.06 })).toBeUndefined();
    expect(gridSpec({ gridPacking: 0, pedestalWidth: 0.06 })).toBeUndefined();
    const s = gridSpec({ gridPacking: 4, pedestalWidth: 0.08 })!;
    expect(s.packing).toBe(4);
    expect(s.rhoT).toBeCloseTo(1 - PACKING_CENTER * 0.08, 14);
    expect(s.width).toBeCloseTo(PACKING_WIDTH * 0.08, 14);
  });
  it('an invalid packing is refused', () => {
    expect(() => packedFaces(20, { packing: 4, rhoT: 0.9, width: 0 })).toThrow(RangeError);
    expect(() => packedFaces(20, { packing: NaN, rhoT: 0.9, width: 0.02 })).toThrow(RangeError);
  });
});

describe('the uniform grid (gridPacking 0) is the grid of the old code, double for double', () => {
  it.each([16, 37, 50])('N = %i: centres, faces, widths, distances, weights and stencils', (N) => {
    const g = buildGrid(N);
    const dRho = 1 / N;
    expect(g.uniform).toBe(true);
    expect(g.dRho).toBe(dRho);
    for (let i = 0; i < N; i++) {
      expect(g.rhoC[i]).toBe((i + 0.5) / N);
      expect(g.dRhoC[i]).toBe(dRho);
      expect(g.spanC[i]).toBe(i === 0 ? dRho : i === N - 1 ? 1.5 * dRho : 2 * dRho);
    }
    for (let f = 0; f <= N; f++) {
      expect(g.rhoF[f]).toBe(f / N);
      expect(g.distF[f]).toBe(f === 0 || f === N ? 0.5 * dRho : dRho);
      expect(g.wR[f]).toBe(0.5);
    }
    for (let f = 1; f < N; f++) expect(g.spanF[f]).toBe(2 * dRho);
  });
  it('the lookups are the expressions of the old code', () => {
    const N = 50, g = buildGrid(N);
    for (const r of [0, 0.019999, 0.02, 0.3, 0.94, 0.9999, 1, 1.2]) {
      expect(cellIndex(g, r)).toBe(Math.min(N - 1, Math.floor(r / g.dRho)));
      expect(nearestFace(g, r)).toBe(Math.min(N - 1, Math.max(1, Math.round(r / g.dRho))));
    }
    for (const r of [0.01, 0.5, 0.94, 0.985, 0.99]) expect(centerInterval(g, r)).toBe(Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho)));
    const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i));
    for (let f = 1; f < N; f++) expect(faceValue(g, a, f)).toBe(0.5 * (a[f] + a[f - 1]));
  });
});

describe('the packed grid', () => {
  const N = 50, g = buildGrid(N, PACK);

  it('faces increase from 0 to 1, the centres are the midpoints, the widths add up to 1', () => {
    expect(g.uniform).toBe(false);
    expect(g.rhoF[0]).toBe(0);
    expect(g.rhoF[N]).toBe(1);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      expect(g.rhoF[i + 1]).toBeGreaterThan(g.rhoF[i]);
      expect(g.rhoC[i]).toBeCloseTo(0.5 * (g.rhoF[i] + g.rhoF[i + 1]), 15);
      expect(g.dRhoC[i]).toBe(g.rhoF[i + 1] - g.rhoF[i]);
      sum += g.dRhoC[i];
    }
    expect(sum).toBeCloseTo(1, 14);
    for (let f = 1; f < N; f++) {
      expect(g.distF[f]).toBeCloseTo(g.rhoC[f] - g.rhoC[f - 1], 15);
      expect(g.spanF[f]).toBeCloseTo(g.rhoF[f + 1] - g.rhoF[f - 1], 15);
    }
    expect(g.distF[N]).toBeCloseTo(0.5 * g.dRhoC[N - 1], 15);
    expect(g.distF[0]).toBeCloseTo(0.5 * g.dRhoC[0], 15);
  });

  it('the edge cells are (1 + p) times narrower than the core cells (tanh step)', () => {
    const ratio = g.dRhoC[N - 1] / g.dRhoC[0];
    expect(ratio).toBeGreaterThan(0.95 / (1 + PACK.packing));
    expect(ratio).toBeLessThan(1.05 / (1 + PACK.packing));
    // smooth: neighbouring cells differ by at most 25 %, and the widths only decrease outwards
    for (let i = 1; i < N; i++) {
      expect(g.dRhoC[i] / g.dRhoC[i - 1]).toBeGreaterThan(0.79);
      expect(g.dRhoC[i] / g.dRhoC[i - 1]).toBeLessThan(1 + 1e-9);
    }
  });

  it('every N is the image of a uniform grid under the same smooth map (a consistent refinement)', () => {
    const f100 = buildGrid(100, PACK).rhoF, f200 = buildGrid(200, PACK).rhoF;
    for (let i = 0; i <= N; i++) {
      expect(Math.abs(f100[2 * i] - g.rhoF[i])).toBeLessThan(1e-13);
      expect(Math.abs(f200[4 * i] - g.rhoF[i])).toBeLessThan(1e-13);
    }
  });

  it('cells across the pedestal: at least 8 at N = 50 (the uniform grid has 3)', () => {
    const across = (grid: ReturnType<typeof buildGrid>, w: number) => { let n = 0; for (let i = 0; i < grid.N; i++) if (grid.rhoC[i] >= 1 - w) n++; return n; };
    expect(across(buildGrid(N), 0.06)).toBe(3);
    expect(across(g, 0.06)).toBeGreaterThanOrEqual(8);
    expect(across(g, 0.06)).toBe(10);
    // a wider pedestal moves the step with it
    for (const w of [0.08, 0.1]) expect(across(buildGrid(N, gridSpec({ gridPacking: 4, pedestalWidth: w })), w)).toBeGreaterThanOrEqual(8);
    // the default settings of the model
    const ps = DEFAULT_PROFILE_SETTINGS;
    expect(ps.gridPacking).toBe(4);
    const spec = gridSpec(ps)!;
    expect(spec).toBeDefined();
    expect(across(buildGrid(ps.nRho, spec), ps.pedestalWidth)).toBeGreaterThanOrEqual(8);
  });

  it('lookups: the cell that contains ρ, the nearest face, the interval between centres', () => {
    for (let k = 0; k <= 400; k++) {
      const r = k / 400;
      const i = cellIndex(g, r);
      expect(g.rhoF[i]).toBeLessThanOrEqual(r);
      expect(r <= g.rhoF[i + 1]).toBe(true);
      const f = nearestFace(g, r);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(N - 1);
      if (r > g.rhoF[1] && r < g.rhoF[N - 1]) for (let q = 1; q < N; q++) expect(Math.abs(g.rhoF[f] - r)).toBeLessThanOrEqual(Math.abs(g.rhoF[q] - r) + 1e-15);
      if (r >= g.rhoC[0] && r < g.rhoC[N - 1]) {
        const j = centerInterval(g, r);
        expect(g.rhoC[j]).toBeLessThanOrEqual(r);
        expect(r).toBeLessThan(g.rhoC[j + 1]);
      }
    }
    expect(cellIndex(g, -0.1)).toBe(0);
    expect(cellIndex(g, 1)).toBe(N - 1);
    expect(cellIndex(g, 1.5)).toBe(N - 1);
  });

  it('face values, cell interpolation and the difference stencils are exact for a linear field', () => {
    const a = Float64Array.from(g.rhoC, (r) => 3 - 2 * r);
    for (let f = 1; f < N; f++) expect(faceValue(g, a, f)).toBeCloseTo(3 - 2 * g.rhoF[f], 14);
    for (const r of [g.rhoC[0], 0.31, 0.7, 0.93, 0.97, g.rhoC[N - 1]]) expect(interpCells(g, a, r)).toBeCloseTo(3 - 2 * r, 14);
    expect(interpCells(g, a, 0)).toBe(a[0]);
    expect(interpCells(g, a, 1)).toBe(a[N - 1]);
    for (let i = 0; i < N; i++) {
      const im = Math.max(i - 1, 0), ip = Math.min(i + 1, N - 1);
      if (i === 0) expect((a[1] - a[0]) / g.spanC[0]).toBeCloseTo(-2, 12);
      else if (i < N - 1) expect((a[ip] - a[im]) / g.spanC[i]).toBeCloseTo(-2, 12);
    }
    // the last cell: one-sided to the separatrix value
    expect((3 - 2 * 1 - a[N - 2]) / g.spanC[N - 1]).toBeCloseTo(-2, 12);
  });
});

describe('transport geometry on the packed grid', () => {
  it('cell volumes add up to the volume, faces and centres are the packed ones', () => {
    const N = 50, R0 = 3, a = 1;
    const g = circularGeometry(R0, a, 3, N, undefined, PACK);
    expect(g.uniform).toBe(false);
    expect(g.rhoF[N]).toBe(1);
    expect(g.dV.reduce((s, x) => s + x, 0)).toBeCloseTo(2 * Math.PI * Math.PI * R0 * a * a, 8);
    for (let i = 0; i < N; i++) expect(rel(g.dV[i], 4 * Math.PI * Math.PI * R0 * a * a * g.rhoC[i] * g.dRhoC[i])).toBeLessThan(1e-12);
  });
});

/** Polynomial helpers of the manufactured solution: coefficient arrays, lowest power first */
const pmul = (p: number[], q: number[]) => { const r = new Array(p.length + q.length - 1).fill(0); p.forEach((a, i) => q.forEach((b, j) => { r[i + j] += a * b; })); return r; };
const pder = (p: number[]) => p.slice(1).map((c, i) => c * (i + 1));
const peval = (p: number[], x: number) => p.reduceRight((s, c) => s * x + c, 0);

describe('diffusion operator on a packed grid: manufactured solution', () => {
  // −(1/V') ∂ρ(V' g1 n χ ∂ρT) = Q in the cylinder (V' ∝ ρ, g1 = 1/a², a = 1), with a steep step at the edge
  //   n = n0 (1 + 0.4 ρ²), χ = 0.8 + 1.5 ρ², T = 0.1 + 3 (1 − ρ²) + (1 − ρ)(1 + tanh((ρ − c)/w))
  const n0 = 1e20, c = 0.94, w = 0.02, TB = 0.1;
  const nP = [n0, 0, 0.4 * n0], chiP = [0.8, 0, 1.5], uP = pmul(nP, chiP), duP = pder(uP);
  const T = (r: number) => TB + 3 * (1 - r * r) + (1 - r) * (1 + Math.tanh((r - c) / w));
  const source = (r: number) => {
    const th = Math.tanh((r - c) / w), sech2 = 1 - th * th;
    const B = 1 + th, B1 = sech2 / w, B2 = (-2 * th * sech2) / (w * w);
    const T1 = -6 * r + B1 * (1 - r) - B, T2 = -6 + B2 * (1 - r) - 2 * B1;
    return -((peval(uP, r) * T1) / r + peval(duP, r) * T1 + peval(uP, r) * T2);
  };

  function maxError(N: number, spec: GridSpec | undefined): number {
    const g = circularGeometry(3, 1, 3, N, undefined, spec);
    const z = () => new Float64Array(N), zf = () => new Float64Array(N + 1);
    const ne = Float64Array.from(g.rhoC, (r) => peval(nP, r));
    const chi = Float64Array.from(g.rhoF, (r) => peval(chiP, r));
    const Q = Float64Array.from(g.rhoC, source);
    const h: HeatInputs = {
      dt: 1e30, ne0: ne, ne1: ne, ni0: ne, ni1: ne, Te0: z(), Ti0: z(), chiE: chi, chiI: chi, Qe: Q, Qi: Q,
      Le: z(), Li: z(), TeStar: z(), TiStar: z(), nuEq: z(), GammaF: zf(), convCoef: 0, TeB: TB, TiB: TB, nB: peval(nP, 1),
    };
    const Te = new Float64Array(N), Ti = new Float64Array(N);
    new HeatSolver(g).solve(h, Te, Ti);
    let e = 0;
    for (let i = 0; i < N; i++) e = Math.max(e, Math.abs(Te[i] - T(g.rhoC[i])), Math.abs(Ti[i] - T(g.rhoC[i])));
    return e / 3;
  }

  it('the observed order on the packed grid is above 1.8 (N = 100 → 200 → 400)', () => {
    const e = [100, 200, 400].map((N) => maxError(N, PACK));
    const orders = [Math.log2(e[0] / e[1]), Math.log2(e[1] / e[2])];
    for (const o of orders) { expect(o).toBeGreaterThan(1.8); expect(o).toBeLessThan(2.4); }
    expect(e[2]).toBeLessThan(1e-5);
  });

  it('and for a mild packing over the whole range of N; the same solution on the uniform grid is less accurate', () => {
    const mild = gridSpec({ gridPacking: 1.5, pedestalWidth: 0.06 })!;
    const e = [100, 200, 400].map((N) => maxError(N, mild));
    expect(Math.log2(e[0] / e[1])).toBeGreaterThan(1.8);
    expect(Math.log2(e[1] / e[2])).toBeGreaterThan(1.8);
    // the packing puts the resolution where the solution needs it
    expect(maxError(100, PACK)).toBeLessThan(0.2 * maxError(100, undefined));
    expect(maxError(200, undefined)).toBeGreaterThan(3 * maxError(200, PACK));
  });
});

describe('finite-volume solvers on a packed grid: conservation and analytic states', () => {
  it('heat: one implicit step conserves energy to round-off with the boundary flux (also with convection)', () => {
    const N = 30, g = circularGeometry(2, 0.6, 2.5, N, undefined, PACK);
    const cell = (f: (r: number, i: number) => number) => Float64Array.from(g.rhoC, f);
    const face = (f: (r: number, i: number) => number) => Float64Array.from(g.rhoF, f);
    const ne0 = cell((r, i) => 1e20 * (1 - 0.6 * r * r) * (1 + 0.03 * Math.sin(i))), ne1 = ne0.map((x) => 1.05 * x);
    const ni0 = ne0.map((x) => 0.82 * x), ni1 = ne1.map((x, i) => (0.78 + 0.004 * i) * x);
    const GammaF = face((r) => 6e21 * Math.sin(3 * Math.PI * r)); GammaF[0] = 0; GammaF[N] = 4e21;
    const h: HeatInputs = {
      dt: 0.02, ne0, ne1, ni0, ni1, Te0: cell((r) => 6 * (1 - r * r) + 0.2), Ti0: cell((r) => 5 * (1 - r * r) + 0.2),
      chiE: face((r) => 0.4 + 2 * r * r), chiI: face((r) => 0.6 + 1.5 * r * r),
      Qe: cell((r) => 3e21 * Math.exp(-8 * r * r) - 2e20), Qi: cell((r) => 2e21 * Math.exp(-5 * r * r)),
      Le: cell(() => 4e19), Li: cell(() => 1e19), TeStar: cell((r) => 6 * (1 - r * r) + 0.3), TiStar: cell((r) => 5 * (1 - r * r) + 0.3),
      nuEq: cell(() => 30), GammaF, convCoef: HEAT_CONVECTION, TeB: 0.1, TiB: 0.12, nB: 3e19,
    };
    const solver = new HeatSolver(g);
    const Te = new Float64Array(N), Ti = new Float64Array(N);
    solver.solve(h, Te, Ti);
    const b = solver.boundaryLoss(h, Te, Ti);
    let E1 = 0, E0 = 0, S = 0, scale = 0;
    for (let i = 0; i < N; i++) {
      const dV = g.dV[i];
      E1 += 1.5 * (ne1[i] * Te[i] + ni1[i] * Ti[i]) * dV;
      E0 += 1.5 * (ne0[i] * h.Te0[i] + ni0[i] * h.Ti0[i]) * dV;
      const se = (h.Qe[i] + h.Le[i] * (h.TeStar[i] - Te[i])) * dV, si = (h.Qi[i] + h.Li[i] * (h.TiStar[i] - Ti[i])) * dV;
      S += se + si; scale += Math.abs(se) + Math.abs(si);
    }
    expect(Math.abs((E1 - E0) / h.dt - (S - b.e - b.i)) / scale).toBeLessThan(1e-12);
  });

  it('density: one implicit step conserves the particles to round-off, with the boundary flux of the solver', () => {
    const N = 40, g = circularGeometry(3, 1, 3, N, undefined, PACK);
    const D = Float64Array.from(g.rhoF, (r) => 0.3 + r * r), v = Float64Array.from(g.rhoF, (r) => -3 * r);
    const n0 = Float64Array.from(g.rhoC, (r) => 1e19 * (1 + 2 * (1 - r * r))), S = Float64Array.from(g.rhoC, (r) => 2e18 * Math.exp(-r * r * 30));
    const dens = new DensitySolver(g), n = new Float64Array(N);
    const dt = 0.05;
    dens.solve({ dt, n0, D, v, S, nB: 2e18 }, n);
    let dN = 0, src = 0;
    for (let i = 0; i < N; i++) { dN += (n[i] - n0[i]) * g.dV[i]; src += S[i] * g.dV[i]; }
    expect(dens.GammaF[0]).toBe(0);
    expect(Math.abs(dN / dt - (src - dens.GammaF[N])) / (Math.abs(src) + Math.abs(dens.GammaF[N]))).toBeLessThan(1e-10);
  });

  it('density: the source-free steady state with the model pinch is n ∝ exp(−Pρ²)', () => {
    const N = 60, P = 0.8, g = circularGeometry(3, 1, 3, N, undefined, PACK);
    const D = new Float64Array(N + 1).fill(0.5), v = new Float64Array(N + 1);
    for (let f = 1; f <= N; f++) v[f] = -D[f] * 2 * P * g.rhoF[f] * (g.g1F[f] / g.gradRhoF[f]);
    const n = new Float64Array(N);
    new DensitySolver(g).solve({ dt: 1e9, n0: new Float64Array(N).fill(1e19), D, v, S: new Float64Array(N), nB: 1e19 }, n);
    for (let i = 0; i < N; i += 7) expect(n[i] / (1e19 * Math.exp(P * (1 - g.rhoC[i] ** 2)))).toBeCloseTo(1, 2);
  });

  it('current diffusion relaxes to j ∝ σ with the enclosed current fixed by I_p', () => {
    const N = 40, Ip = 2e6, g = circularGeometry(3, 1, 3, N, undefined, PACK);
    const sigma = Float64Array.from(g.rhoC, (r) => 1e8 * (1 - 0.6 * r * r));
    const cs = new CurrentSolver(g);
    let psi = Float64Array.from(g.rhoC, (r) => 0.5 * r * r);
    const tmp = new Float64Array(N);
    const tauR = 1.25663706212e-6 * 1 * 1e8;
    for (let k = 0; k < 400; k++) { cs.solve({ dt: tauR / 20, psi0: psi, sigma, jniB: new Float64Array(N), Ip }, tmp); psi = Float64Array.from(tmp); }
    const dpsi = cs.dpsiF(psi, Ip, new Float64Array(N + 1));
    const jB = cs.jB(dpsi, new Float64Array(N));
    const I = cs.Ienc(dpsi, new Float64Array(N + 1));
    expect(I[N] / Ip).toBeCloseTo(1, 10);
    for (let i = 2; i < N - 2; i += 5) expect((jB[i] / sigma[i]) / (jB[0] / sigma[0])).toBeCloseTo(1, 2);
    const Iint = volumeIntegral(g, jB.map((x) => x / 3)) / (2 * Math.PI * 3);
    expect(Iint / Ip).toBeCloseTo(1, 3);
  });
});

describe('spacing-dependent MHD helpers on a packed grid', () => {
  const N = 50, g = circularGeometry(3, 1, 3, N, undefined, PACK);

  it('rhoOfQ and shearAt follow the packed faces', () => {
    const qF = Float64Array.from(g.rhoF, (r) => 1 + 2 * r * r);
    expect(rhoOfQ(g, qF, 1.5)).toBeCloseTo(0.5, 2);
    expect(rhoOfQ(g, qF, 2.5, false)).toBeCloseTo(Math.sqrt(0.75), 2);
    expect(rhoOfQ(g, qF, 7)).toBe(-1);
    // s = ρ q′/q at ρ = 0.5: 0.5·2/1.5
    expect(shearAt(g, qF, 0.5)).toBeCloseTo(2 / 3, 1);
    const lin = Float64Array.from(g.rhoF, (r) => 1 + 2 * r);
    expect(rhoOfQ(g, lin, 2)).toBeCloseTo(0.5, 14);
  });

  it('alphaMHD: the gradient of face f is over the distance of its two cells, and the separatrix face joins the maximum on a packed grid only', () => {
    const p = Float64Array.from(g.rhoC, (r) => 5e5 * (1 - r) ** 2 + 1e3);
    const qF = new Float64Array(N + 1).fill(3);
    const out = new Float64Array(N + 1);
    const pSep = 2e3;
    const aPacked = alphaMHD(g, p, qF, 0.9, out, pSep);
    const MU0 = 1.25663706212e-6;
    const alphaOf = (f: number, dp: number) => (2 * MU0 * 0.5 * (g.RinF[f] + g.RoutF[f]) * 9 * Math.abs(Math.min(dp, 0)) * g.gradRhoF[f]) / (g.B0 * g.B0);
    for (const f of [1, 20, 45, N - 1]) expect(out[f]).toBeCloseTo(alphaOf(f, (p[f] - p[f - 1]) / (g.rhoC[f] - g.rhoC[f - 1])), 10);
    // the separatrix face: half a cell from the last centre
    expect(out[N]).toBeCloseTo(alphaOf(N, (pSep - p[N - 1]) / (1 - g.rhoC[N - 1])), 10);
    expect(aPacked).toBeGreaterThanOrEqual(out[N]);
    // without pSep the old range of faces
    const outNo = new Float64Array(N + 1);
    alphaMHD(g, p, qF, 0.9, outNo);
    expect(outNo[N]).toBe(0);
    // the legacy uniform grid never looks at the separatrix face
    const gu = circularGeometry(3, 1, 3, N);
    const outU = new Float64Array(N + 1);
    alphaMHD(gu, p, qF, 0.9, outU, pSep);
    expect(outU[N]).toBe(0);
    expect(outU[N - 1]).toBeGreaterThan(0);
  });
});

describe('the model on a packed grid', () => {
  it('the presets get the packed grid by default (ITER15: 10 cells across the pedestal at N = 50)', () => {
    const m = new ProfileModel(ITER_15D);
    const g = m.ctx.tg;
    expect(g.uniform).toBe(false);
    expect(g.N).toBe(50);
    let across = 0; for (let i = 0; i < g.N; i++) if (g.rhoC[i] >= 1 - m.ctx.ps.pedestalWidth) across++;
    expect(across).toBe(10);
    // a blank setting keeps the default, gridPacking 0 asks for the uniform grid
    expect(new ProfileModel({ ...ITER_15D, profiles: { ...ITER_15D.profiles, gridPacking: undefined } }).ctx.tg.uniform).toBe(false);
    expect(new ProfileModel({ ...ITER_15D, profiles: { ...ITER_15D.profiles, gridPacking: 0 } }).ctx.tg.uniform).toBe(true);
  });

  const cfg = (packing: number) => ({ ...SPARC_15D, t_end: 3, profiles: { ...SPARC_15D.profiles, gridPacking: packing } });

  it('ProfileContext builds the geometry on the packed grid, also after a Grad–Shafranov update', () => {
    const m = new ProfileModel(cfg(4));
    const y = m.initialState();
    const g = m.ctx.tg;
    expect(g.uniform).toBe(false);
    expect(m.ctx.grid).toEqual(gridSpec({ gridPacking: 4, pedestalWidth: m.ctx.ps.pedestalWidth }));
    let across = 0; for (let i = 0; i < g.N; i++) if (g.rhoC[i] >= 1 - m.ctx.ps.pedestalWidth) across++;
    expect(across).toBeGreaterThanOrEqual(8);
    const rho0 = Array.from(g.rhoF);
    m.diagnostics(0, y);
    expect(m.updateEquilibrium(0.1, y)).toBe(true);
    expect(Array.from(m.ctx.tg.rhoF)).toEqual(rho0);
    expect(m.ctx.tg.uniform).toBe(false);
    // the profile frames carry the packed centres
    expect(m.profiles(y).rho[g.N - 1]).toBe(g.rhoC[g.N - 1]);
  });

  it('a short SPARC15 shot runs on the packed grid: finite, H-mode, the energy balance closes on every step', () => {
    const sim = new Simulation(cfg(4));
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let worst = 0, n = 0;
    m.postStep = (t, dt, y) => {
      const d = m.ctx.lastDiag;
      if (dt > 0 && t > 1.6 && m.ctx.phase === 'normal') { worst = Math.max(worst, Math.abs((d.dWdt - (d.P_heat - d.P_rad - d.P_bound)) / d.P_heat)); n++; }
      return post(t, dt, y);
    };
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    const d = sim.history[sim.history.length - 1].d;
    for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
    expect(d.H_mode).toBe(1);
    expect(n).toBeGreaterThan(50);
    expect(worst).toBeLessThan(1e-4);
    // T_ped is the temperature at ρ_ped, interpolated between the two centres around it
    const last = sim.history[sim.history.length - 1].prof!;
    const rhoPed = 1 - m.ctx.ps.pedestalWidth;
    const i = last.rho.findIndex((r) => r >= rhoPed) - 1;
    const t = (rhoPed - last.rho[i]) / (last.rho[i + 1] - last.rho[i]);
    expect(d.Tped).toBeCloseTo(last.Te[i] + t * (last.Te[i + 1] - last.Te[i]), 10);
  }, 60000);
});

/**
 * gridPacking 0 is the uniform grid of the last release: the result of these two shots is what
 * the code produced before the grid became a parameter (recorded from the commit before it, where the
 * tests of the whole suite passed on it).
 */
describe('gridPacking 0 reproduces the uniform-grid model', () => {
  const PINS: Record<string, { cfg: () => MagneticConfig; d: Record<string, number>; events: Record<string, number>; nSteps: number }> = {
    'SPARC15 3 s': {
      cfg: () => ({ ...SPARC_15D, t_end: 3, profiles: { ...SPARC_15D.profiles, gridPacking: 0 } }),
      d: {
        Te: 10.6239618289934, Ti: 10.3795237082012, Tped: 4.75377712700776, Tsep: 0.395225966949509, Q: 5.4422565477909, W: 24.4670675041086, q95: 4.15863324892357,
        q0: 0.963616120958095, li: 0.749876913418482, f_bs: 0.173285357639057, alpha_ped: 0.818384355919387, P_fus: 139.821506951894, tauE: 0.577396301184033,
        betaN: 1.14792242909926, P_bound: 42.5855725222923, P_SOL: 42.6273671535482,
      },
      events: { ELM: 0, sawtooth: 0, LH: 1 }, nSteps: 820,
    },
    'ITER15 60 s': {
      cfg: () => ({ ...ITER_15D, t_end: 60, profiles: { ...ITER_15D.profiles, gridPacking: 0 } }),
      d: {
        Te: 12.8291910551208, Ti: 12.0257848891266, Tped: 4.99703794212069, Tsep: 0.416451532395839, Q: 16.0838974681984, W: 390.93498261399, q95: 3.51509365865492,
        q0: 1.11563525758922, li: 0.75219325041469, f_bs: 0.291048180679776, alpha_ped: 1.10527199307346, P_fus: 804.488602800639, tauE: 2.17534404350504,
        betaN: 2.29309708122076, P_bound: 167.04972046627, P_SOL: 163.770519448464,
      },
      events: { ELM: 148, sawtooth: 0, LH: 1 }, nSteps: 1924,
    },
  };

  it.each(Object.keys(PINS))('%s', (name) => {
    const pin = PINS[name];
    const sim = new Simulation(pin.cfg());
    sim.runAll();
    const d = sim.history[sim.history.length - 1].d;
    for (const [k, v] of Object.entries(pin.d)) expect(rel(d[k], v), `${name}: ${k}`).toBeLessThan(1e-9);
    for (const [k, v] of Object.entries(pin.events)) expect(sim.events.filter((e) => e.kind === k).length, `${name}: ${k} events`).toBe(v);
    expect(sim.nSteps).toBe(pin.nSteps);
  }, 60000);
});
