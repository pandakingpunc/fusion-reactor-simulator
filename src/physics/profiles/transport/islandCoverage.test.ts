/**
 * Island flattening of the transport coefficients (transport/islandCoverage.ts, transport/coefficients.ts): the extra χ of an NTM
 * island is weighted by the part of each face's control interval that lies inside the island, so the flattened width is the island's
 * width on any radial grid. The earlier rule (the whole 5 m²/s on every face with |ρ − ρ_s| < w/2) is kept below as `legacyWidth` to show that
 * these tests fail on it: at 50 cells it flattened 0.78 of the width of the ITER15 flat-top (3,2) island, at 100 cells 0.98, which made the
 * saturated island width and Q depend on the grid (ITER15 flat-top Q −1.74 % between 50 and 100 cells).
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D } from '../../presets';
import { ProfileModel } from '../model';
import { buildGrid, interpCells, type RadialGrid } from '../geometry1d';
import { islandRegions } from '../events/ntm';
import { faceControlInterval, ISLAND_CHI, islandCoverage } from './islandCoverage';

type Faces = Pick<RadialGrid, 'N' | 'rhoF'>;

/** the edge-packed grid of the model default (gridPacking 4, pedestal width 0.05) */
const packed = (N: number, p = 4) => buildGrid(N, { packing: p, rhoT: 1 - 1.25 * 0.05, width: 0.75 * 0.05 });
const uniform = (N: number) => buildGrid(N);

/** a grid of N cells with random faces (seeded), to exercise strongly non-uniform spacings */
function randomGrid(N: number, rnd: () => number): Faces {
  const w = Array.from({ length: N }, () => 0.2 + rnd());
  const sum = w.reduce((s, x) => s + x, 0);
  const rhoF = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) rhoF[i + 1] = rhoF[i] + w[i] / sum;
  rhoF[N] = 1;
  return { N, rhoF };
}

/** mulberry32: a small deterministic generator, so that the random cases are the same on every run */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the coverage of every face of the grid */
const coverages = (g: Faces, rs: number, w: number) => Array.from({ length: g.N + 1 }, (_, f) => islandCoverage(g, f, rs, w));

/** Σ coverage × (control interval): the width over which the profiles are flattened */
function flattenedWidth(g: Faces, rs: number, w: number): number {
  let sum = 0;
  for (let f = 0; f <= g.N; f++) {
    const [lo, hi] = faceControlInterval(g, f);
    sum += islandCoverage(g, f, rs, w) * (hi - lo);
  }
  return sum;
}

/** the width the earlier rule flattened: the control intervals of the faces with |ρ − ρ_s| < w/2, whole */
function legacyWidth(g: Faces, rs: number, w: number): number {
  let sum = 0;
  for (let f = 0; f <= g.N; f++) {
    if (Math.abs(g.rhoF[f] - rs) < 0.5 * w) {
      const [lo, hi] = faceControlInterval(g, f);
      sum += hi - lo;
    }
  }
  return sum;
}

describe('control interval of a face', () => {
  it('is bounded by the midpoints to the neighbouring faces: the stretch between the two cell centres that share the face, half a cell at the axis and the separatrix', () => {
    const grids: (Faces & { rhoC?: Float64Array })[] = [uniform(10), uniform(37), packed(50), packed(100, 2), randomGrid(23, mulberry32(7))];
    for (const g of grids) {
      // the cell centres of the model grids; the random grid has none, its cells are centred between the faces
      const rhoC = g.rhoC ?? Float64Array.from({ length: g.N }, (_, i) => 0.5 * (g.rhoF[i] + g.rhoF[i + 1]));
      for (let f = 0; f <= g.N; f++) {
        const [lo, hi] = faceControlInterval(g, f);
        expect(lo).toBeCloseTo(f > 0 ? rhoC[f - 1] : 0, 14);
        expect(hi).toBeCloseTo(f < g.N ? rhoC[f] : 1, 14);
        expect(hi).toBeGreaterThan(lo);
        // each interval contains its own face
        expect(g.rhoF[f]).toBeGreaterThanOrEqual(lo);
        expect(g.rhoF[f]).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('tile [0, 1] without a gap or an overlap', () => {
    for (const g of [uniform(10), packed(50), packed(100, 2), randomGrid(23, mulberry32(11))]) {
      expect(faceControlInterval(g, 0)[0]).toBe(0);
      expect(faceControlInterval(g, g.N)[1]).toBe(1);
      for (let f = 0; f < g.N; f++) expect(faceControlInterval(g, f)[1]).toBeCloseTo(faceControlInterval(g, f + 1)[0], 14);
    }
  });
});

describe('island coverage of a face', () => {
  const g = uniform(10); // faces 0, 0.1, … 1; the control interval of face f is [0.1 f − 0.05, 0.1 f + 0.05], that of face 0 is [0, 0.05], of face 10 [0.95, 1]
  const at = (rs: number, w: number) => coverages(g, rs, w);

  it('is the exact overlap fraction: an island [0.33, 0.57] covers faces 4 and 5 whole and the faces 3 and 6 by a fifth', () => {
    const c = at(0.45, 0.24);
    const expected = [0, 0, 0, 0.2, 1, 1, 0.2, 0, 0, 0, 0];
    for (let f = 0; f <= 10; f++) expect(c[f]).toBeCloseTo(expected[f], 12);
  });

  it('an island narrower than a face spacing gets its own width, not a whole face: [0.49, 0.51] covers a fifth of face 5 (the earlier rule flattened five times the island)', () => {
    const c = at(0.5, 0.02);
    for (let f = 0; f <= 10; f++) expect(c[f]).toBeCloseTo(f === 5 ? 0.2 : 0, 12);
    expect(flattenedWidth(g, 0.5, 0.02)).toBeCloseTo(0.02, 14);
    expect(legacyWidth(g, 0.5, 0.02)).toBeCloseTo(0.1, 14);
  });

  it('an island between two faces is not lost: [0.53, 0.57] covers a fifth of face 5 and of face 6 (the earlier rule flattened nothing)', () => {
    const c = at(0.55, 0.04);
    for (let f = 0; f <= 10; f++) expect(c[f]).toBeCloseTo(f === 5 || f === 6 ? 0.2 : 0, 12);
    expect(flattenedWidth(g, 0.55, 0.04)).toBeCloseTo(0.04, 14);
    expect(legacyWidth(g, 0.55, 0.04)).toBe(0);
  });

  it('an island at the separatrix is cut at ρ = 1: [0.93, 1.03] covers the last face whole and face 9 by a fifth; only the part inside the plasma counts', () => {
    const c = at(0.98, 0.1);
    for (let f = 0; f <= 10; f++) expect(c[f]).toBeCloseTo(f === 10 ? 1 : f === 9 ? 0.2 : 0, 12);
    expect(flattenedWidth(g, 0.98, 0.1)).toBeCloseTo(0.07, 14);
  });

  it('an island at the axis is cut at ρ = 0: [−0.03, 0.07] covers the axis face whole and face 1 by a fifth', () => {
    const c = at(0.02, 0.1);
    for (let f = 0; f <= 10; f++) expect(c[f]).toBeCloseTo(f === 0 ? 1 : f === 1 ? 0.2 : 0, 12);
    expect(flattenedWidth(g, 0.02, 0.1)).toBeCloseTo(0.07, 14);
  });

  it('an island wider than the plasma covers every face whole; an empty, negative, NaN or out-of-range island covers nothing', () => {
    for (const x of at(0.5, 3)) expect(x).toBe(1);
    for (const [rs, w] of [[0.5, 0], [0.5, -0.1], [0.5, Number.NaN], [Number.NaN, 0.1], [1.5, 0.2], [-0.5, 0.2]]) {
      for (const x of at(rs, w)) expect(x).toBe(0);
    }
  });

  it('on an edge-packed grid it is the overlap fraction of the (unequal) control intervals: against a midpoint-rule integration of the indicator of the island', () => {
    const p = packed(40);
    const rs = 0.62, w = 0.07, K = 20000;
    for (let f = 0; f <= p.N; f++) {
      const [lo, hi] = faceControlInterval(p, f);
      let inside = 0;
      for (let k = 0; k < K; k++) {
        const r = lo + ((k + 0.5) / K) * (hi - lo);
        if (r >= rs - 0.5 * w && r <= rs + 0.5 * w) inside++;
      }
      expect(islandCoverage(p, f, rs, w)).toBeCloseTo(inside / K, 3);
    }
    // the faces are unequal here: the outer cells are 5 times narrower than the core cells
    expect(p.rhoF[1] - p.rhoF[0]).toBeGreaterThan(3 * (p.rhoF[40] - p.rhoF[39]));
  });

  it('lies in [0, 1] and varies continuously with the island position and width (no cliff when a face edge is crossed, unlike the earlier rule)', () => {
    const rnd = mulberry32(2024);
    for (let k = 0; k < 200; k++) {
      const grid = k % 3 === 0 ? randomGrid(5 + Math.floor(rnd() * 120), rnd) : k % 3 === 1 ? uniform(5 + Math.floor(rnd() * 120)) : packed(10 + Math.floor(rnd() * 120));
      const rs = rnd(), w = 0.2 * rnd(), eps = 1e-6;
      for (let f = 0; f <= grid.N; f++) {
        const c = islandCoverage(grid, f, rs, w);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        const [lo, hi] = faceControlInterval(grid, f);
        // a shift of the island by eps changes the overlap by at most eps
        expect(Math.abs(islandCoverage(grid, f, rs + eps, w) - c)).toBeLessThanOrEqual((eps / (hi - lo)) * (1 + 1e-9) + 1e-15);
        // a change of the width by eps moves each edge by eps/2
        expect(Math.abs(islandCoverage(grid, f, rs, w + eps) - c)).toBeLessThanOrEqual((eps / (hi - lo)) * (1 + 1e-9) + 1e-15);
      }
    }
  });
});

describe('the flattened width does not depend on the grid', () => {
  // the flat-top (3,2) island of ITER15 (measured: rho_s 0.6138, width in rho 0.0667)
  const rs = 0.6138, w = 0.0667;
  const grids: [string, Faces][] = [
    ...[10, 20, 25, 35, 37, 40, 50, 64, 70, 100, 120, 200].map((N): [string, Faces] => [`uniform ${N}`, uniform(N)]),
    ...[25, 35, 50, 64, 100, 120].map((N): [string, Faces] => [`packed ${N}`, packed(N)]),
    ...[50, 100].map((N): [string, Faces] => [`packed(2) ${N}`, packed(N, 2)]),
    ['random 31', randomGrid(31, mulberry32(5))],
  ];

  it('Σ coverage × control interval equals the island width to round-off on every grid, wherever the island sits', () => {
    for (const [name, g] of grids) {
      for (let k = 0; k <= 40; k++) {
        const centre = 0.1 + 0.8 * (k / 40); // an island that stays inside the plasma
        expect(Math.abs(flattenedWidth(g, centre, w) - w), `${name}, rho_s = ${centre}`).toBeLessThan(2e-16 * 8);
      }
      expect(Math.abs(flattenedWidth(g, rs, w) - w), name).toBeLessThan(2e-16 * 8);
    }
  });

  it('the earlier face test does not: it flattens between 0.7 and 1.5 of the width over these grids, and its width jumps by a whole control interval when an island edge crosses a face', () => {
    const ratios = grids.map(([, g]) => legacyWidth(g, rs, w) / w);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.3);
    // 50 uniform cells: the island edge reaches face 30 at rho_s = rho_30 + w/2; moving the island by 2e-9 across it changes the legacy width by the
    // control interval of the face (0.02), the coverage weighting by 2e-9 (the island edge moves by that much)
    const g = uniform(50);
    const edge = g.rhoF[30] + 0.5 * w;
    expect(legacyWidth(g, edge - 1e-9, w) - legacyWidth(g, edge + 1e-9, w)).toBeCloseTo(0.02, 10);
    expect(Math.abs(flattenedWidth(g, edge - 1e-9, w) - flattenedWidth(g, edge + 1e-9, w))).toBeLessThan(1e-12);
    // at that position the island edge is at the face, the middle of its control interval: half of it is covered on both sides, where the earlier rule
    // switches from the whole interval to none
    expect(islandCoverage(g, 30, edge - 1e-9, w)).toBeCloseTo(0.5, 6);
    expect(islandCoverage(g, 30, edge + 1e-9, w)).toBeCloseTo(0.5, 6);
  });
});

describe('island flattening of the running model (ITER15 geometry)', () => {
  /** an ITER15 model at nRho cells with its work arrays evaluated on the initial state */
  function iter15(nRho: number, gridPacking?: number) {
    const cfg = { ...ITER_15D, profiles: { ...ITER_15D.profiles, nRho, ...(gridPacking === undefined ? {} : { gridPacking }) }, t_end: 400 };
    const m = new ProfileModel(cfg);
    const y = m.initialState();
    m.diagnostics(0, y);
    return { m, y, ctx: m.ctx, cfg };
  }

  it('the extra χ of the island integrates over ρ to 5 m²/s times the island width on every grid, and the widths agree between grids (the earlier rule flattened 0.78 to 1.12 of it)', () => {
    const widths: number[] = [];
    const legacy: number[] = [];
    for (const [n, packing] of [[25, undefined], [35, undefined], [50, undefined], [70, undefined], [100, undefined], [120, undefined], [50, 0], [100, 0]] as const) {
      const { m, y, ctx } = iter15(n, packing);
      const st = ctx.view(y), g = ctx.tg;
      st.s.w32 = 0.085 * g.a; // the saturated width of the ITER15 flat top, w/a ≈ 0.085
      const [[rs, dr]] = islandRegions(ctx, st.s);
      m.physics.transportCoefficients(st);
      const withIsland = { e: Float64Array.from(ctx.w.chiE), i: Float64Array.from(ctx.w.chiI) };
      st.s.w32 = 0;
      m.physics.transportCoefficients(st);
      let integralE = 0, integralI = 0;
      for (let f = 0; f <= ctx.N; f++) {
        const [lo, hi] = faceControlInterval(g, f);
        integralE += (withIsland.e[f] - ctx.w.chiE[f]) * (hi - lo);
        integralI += (withIsland.i[f] - ctx.w.chiI[f]) * (hi - lo);
      }
      expect(Math.abs(integralE / (ISLAND_CHI * dr) - 1), `chi_e, ${n} cells, packing ${packing}`).toBeLessThan(1e-12);
      expect(Math.abs(integralI / (ISLAND_CHI * dr) - 1), `chi_i, ${n} cells, packing ${packing}`).toBeLessThan(1e-12);
      widths.push(integralE / ISLAND_CHI);
      legacy.push(legacyWidth(g, rs, dr) / dr);
    }
    // the island's own width in rho (w γ with the gradient of rho at the cell that holds rho_s) differs by 0.3 % between grids
    expect(Math.max(...widths) / Math.min(...widths) - 1).toBeLessThan(0.01);
    // and the earlier rule flattened between 0.78 and 1.12 of it (measured: 0.78 at 25 and 50 cells, 1.12 at 35, 0.98 at 100)
    expect(Math.max(...legacy) - Math.min(...legacy)).toBeGreaterThan(0.25);
  });

  it('a forced island flattens the temperature across its width by the same fraction on 40, 50, 80 and 100 cells (within 0.02; the earlier rule: 0.72 to 0.91)', () => {
    /** 1 − ΔT(island)/ΔT(no island): the share of the temperature drop across the island's width that its flattening removes, after 2 s of the shot */
    function flattening(n: number, wa: number): number {
      const { m, y, ctx, cfg } = iter15(n);
      let t = 0;
      while (t < 2) {
        const st = ctx.view(y);
        st.s.w32 = wa * ctx.tg.a;
        st.s.w21 = 0;
        const t0 = t;
        t = m.step(t, y, cfg.t_end);
        m.postStep(t, t - t0, y);
      }
      const st = ctx.view(y), g = ctx.tg;
      st.s.w32 = 0.085 * g.a;
      const [[rs, dr]] = islandRegions(ctx, st.s);
      return interpCells(g, st.Te, rs - 0.5 * dr) - interpCells(g, st.Te, rs + 0.5 * dr);
    }
    const fractions = [40, 50, 80, 100].map((n) => 1 - flattening(n, 0.085) / flattening(n, 0));
    expect(Math.max(...fractions) - Math.min(...fractions)).toBeLessThan(0.02); // measured 0.009; the earlier rule: 0.19
    // the pair that the Wave-2A criterion compares: 0.005 (the earlier rule: 0.17)
    expect(Math.abs(fractions[1] - fractions[3])).toBeLessThan(0.02);
    // and the island does flatten: measured 0.93 to 0.94, the +5 m²/s removes most of the drop
    for (const x of fractions) {
      expect(x).toBeGreaterThan(0.85);
      expect(x).toBeLessThan(1);
    }
  }, 60_000);
});
