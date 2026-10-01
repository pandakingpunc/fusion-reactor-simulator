/**
 * 1.5D TAŞINIM GEOMETRİSİ — Grad–Shafranov dengesinden, normalize toroidal akı koordinatı
 * ρ̂ = √(Φ/Φ_b) üzerinde hücre-merkezli sonlu hacim ızgarası için metrik katsayılar.
 *
 * ψ_N → ρ̂ dönüşümü (ψ rad başına):  dΦ = 2π q dψ  ⇒  dρ̂/dψ_N = π q Δψ /(Φ_b ρ̂)
 *   V' = dV/dρ̂ = (dV/dψ_N)/(dρ̂/dψ_N),   g1 = ⟨|∇ρ̂|²⟩ = ⟨|∇ψ|²⟩ (π q /(Φ_b ρ̂))²,
 *   g2 = ⟨|∇ρ̂|²/R²⟩,   ⟨|∇ρ̂|⟩,   q = Φ_b ρ̂ /(π ∂ψ/∂ρ̂).
 * Eksende düzenli kalan büyüklükler (V'/ρ̂, g1, g2, …) spline ile interpolasyon yapılır.
 * Silindirik yedek geometri (circularGeometry) birim testlerde analitik çözümler için.
 */
import { CubicSpline, findInterval } from '../numerics/interp';
import { integrateGL } from '../numerics/quadrature';
import { invertMonotone } from '../numerics/roots';
import type { EqProfiles } from '../equilibrium/gs';
import type { TracedSurfaces } from '../equilibrium/fluxsurface';
import type { ProfileSettings } from '../types';
import { PEDESTAL_GRID_WIDTH } from './pedestal/eped1';

/**
 * The radial grid of the transport equations: N cells between the faces ρ_f (ρ_0 = 0 the axis,
 * ρ_N = 1 the separatrix), the cell centres at the midpoints of the faces. With `ProfileSettings.gridPacking`
 * = 0 the grid is uniform and every quantity below reproduces the expression of the uniform-grid
 * code bit for bit (the legacy path, `uniform`); otherwise the cells are packed towards the edge
 * (`packedFaces`) and the solvers use the per-cell and per-face spacings.
 */
export interface RadialGrid {
  N: number;
  /** the legacy uniform grid (ProfileSettings.gridPacking = 0) */
  uniform: boolean;
  rhoC: Float64Array; // cell centres (N)
  rhoF: Float64Array; // faces (N+1), 0 … 1
  /** mean cell width 1/N; the width of every cell of a uniform grid. A difference over a packed grid uses the arrays below */
  dRho: number;
  /** cell widths ρ_{i+1} − ρ_i (N) */
  dRhoC: Float64Array;
  /**
   * distance across face f between the two nodes that flank it (N+1): the centres f − 1 and f for an
   * interior face, the last centre and the separatrix for f = N (half a cell), the axis and the first centre for f = 0
   */
  distF: Float64Array;
  /** weight of the right-hand cell in the linear interpolation of a cell value to the interior face f (N+1; 0.5 on a uniform grid) */
  wR: Float64Array;
  /** ρ_{f+1} − ρ_{f−1}: the stencil of a central difference over the faces (N+1; ends: the adjacent cell width) */
  spanF: Float64Array;
  /** width of the central-difference stencil of a cell-centre derivative (N): ρ_{i+1} − ρ_{i−1} in the interior, one-sided at the axis, to the separatrix at the edge */
  spanC: Float64Array;
}

/**
 * Edge packing of the radial cells: the cell density (cells per unit ρ) is ∝ 1 + p S(ρ) with the
 * tanh step S(ρ) = ½ (1 + tanh((ρ − ρ_T)/w)), p = `packing`. The cells of the edge region are
 * (1 + p) times narrower than the core cells. p = 0 is the uniform grid.
 */
export interface GridSpec { packing: number; rhoT: number; width: number }

/**
 * Centre and width of the packing step in units of the pedestal width w_ped: the edge transport
 * barrier (transport/pedestal.ts) steps at ρ_ped = 1 − w_ped over 0.01 and the pedestal spans
 * [ρ_ped, 1], so the fine cells must start inside the pedestal top. With ρ_T = 1 − 1.25 w_ped and
 * w = 0.75 w_ped the step S is 0.66 at ρ_ped, 0.34 at ρ_ped − 0.03 and 0.04 at ρ_ped − 0.1, and
 * neighbouring cells differ in width by at most 25 % (a narrower step, 0.4 w_ped, gives 48 %:
 * the error of a second-order scheme grows with the stretching of the grid).
 */
export const PACKING_CENTER = 1.25;
export const PACKING_WIDTH = 0.75;

/** The packing of a shot from its settings (undefined: uniform grid) */
export function gridSpec(ps: Pick<ProfileSettings, 'gridPacking' | 'pedestalWidth'> & Partial<Pick<ProfileSettings, 'pedestalModel'>>): GridSpec | undefined {
  const p = ps.gridPacking ?? 0;
  if (!(p > 0)) return undefined;
  // the EPED1-type pedestal has its own width (0.036 in ψ_N, about 0.045 in ρ̂), which the shot cannot report before its grid exists
  const pw = Math.max(ps.pedestalModel === 'eped1' ? PEDESTAL_GRID_WIDTH : ps.pedestalWidth, 1e-3);
  return { packing: p, rhoT: 1 - PACKING_CENTER * pw, width: PACKING_WIDTH * pw };
}

/** ln cosh z without overflow */
function lnCosh(z: number): number {
  const a = Math.abs(z);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/**
 * Faces of the packed grid: ρ_f = X(f/N) with X the inverse of the normalised cumulative cell density
 * F(ρ) = ∫₀^ρ (1 + p S) dρ' = ρ (1 + p/2) + (p w/2)[ln cosh((ρ − ρ_T)/w) − ln cosh(ρ_T/w)] over F(1). Every N
 * gives the image of a uniform grid of the same smooth map, so a refinement study is consistent (the
 * grid converges in a fixed metric, with h ∝ 1/N).
 */
export function packedFaces(N: number, spec: GridSpec): Float64Array {
  const { packing: p, rhoT, width } = spec;
  if (!(p >= 0) || !(width > 0) || !Number.isFinite(p + rhoT + width)) throw new RangeError(`packedFaces: invalid packing ${JSON.stringify(spec)}`);
  const F = (x: number) => x * (1 + p / 2) + ((p * width) / 2) * (lnCosh((x - rhoT) / width) - lnCosh(rhoT / width));
  const F1 = F(1);
  const faces = new Float64Array(N + 1);
  faces[N] = 1;
  for (let i = 1; i < N; i++) faces[i] = invertMonotone(F, (i / N) * F1, 0, 1, 1e-15);
  return faces;
}

/** The radial grid of N cells (uniform without a packing) */
export function buildGrid(N: number, spec?: GridSpec): RadialGrid {
  const packed = spec !== undefined && spec.packing > 0;
  const rhoC = new Float64Array(N), rhoF = new Float64Array(N + 1);
  const dRho = 1 / N;
  if (!packed) {
    const dRhoC = new Float64Array(N), distF = new Float64Array(N + 1), wR = new Float64Array(N + 1);
    const spanF = new Float64Array(N + 1), spanC = new Float64Array(N);
    // the expressions of the uniform-grid code, so that its results do not change by a bit
    for (let i = 0; i < N; i++) rhoC[i] = (i + 0.5) / N;
    for (let i = 0; i <= N; i++) rhoF[i] = i / N;
    dRhoC.fill(dRho);
    distF.fill(dRho); distF[0] = 0.5 * dRho; distF[N] = 0.5 * dRho;
    wR.fill(0.5);
    spanF.fill(2 * dRho); spanF[0] = dRho; spanF[N] = dRho;
    spanC.fill(2 * dRho); spanC[0] = dRho; spanC[N - 1] = 1.5 * dRho;
    return { N, uniform: true, rhoC, rhoF, dRho, dRhoC, distF, wR, spanF, spanC };
  }
  rhoF.set(packedFaces(N, spec!));
  for (let i = 0; i < N; i++) rhoC[i] = 0.5 * (rhoF[i] + rhoF[i + 1]);
  return nonUniformGrid(N, rhoC, rhoF, dRho);
}

/**
 * The grid of the faces `rhoF` (N + 1, 0 … 1) and the cell centres `rhoC` (N, each inside its cell), with the per-cell and
 * per-face spacings of a non-uniform grid. The arrays are taken over, not copied.
 */
function nonUniformGrid(N: number, rhoC: Float64Array, rhoF: Float64Array, dRho: number): RadialGrid {
  const dRhoC = new Float64Array(N), distF = new Float64Array(N + 1), wR = new Float64Array(N + 1);
  const spanF = new Float64Array(N + 1), spanC = new Float64Array(N);
  for (let i = 0; i < N; i++) dRhoC[i] = rhoF[i + 1] - rhoF[i];
  distF[0] = rhoC[0] - rhoF[0]; distF[N] = rhoF[N] - rhoC[N - 1];
  wR[0] = 0.5; wR[N] = 0.5;
  spanF[0] = dRhoC[0]; spanF[N] = dRhoC[N - 1];
  for (let f = 1; f < N; f++) {
    distF[f] = rhoC[f] - rhoC[f - 1];
    wR[f] = dRhoC[f - 1] / (dRhoC[f - 1] + dRhoC[f]);
    spanF[f] = rhoF[f + 1] - rhoF[f - 1];
  }
  for (let i = 0; i < N; i++) spanC[i] = i === 0 ? rhoC[1] - rhoC[0] : i === N - 1 ? rhoF[N] - rhoC[N - 2] : rhoC[i + 1] - rhoC[i - 1];
  return { N, uniform: false, rhoC, rhoF, dRho, dRhoC, distF, wR, spanF, spanC };
}

/** Index of the cell that contains ρ, 0 … N − 1 (the last cell for ρ ≥ 1, the first for ρ ≤ 0) */
export function cellIndex(g: RadialGrid, r: number): number {
  if (g.uniform) return Math.max(0, Math.min(g.N - 1, Math.floor(r / g.dRho)));
  return findInterval(g.rhoF, r);
}

/** Index of the interval between the centres i and i + 1 that contains ρ, 0 … N − 2 (clamped) */
export function centerInterval(g: RadialGrid, r: number): number {
  if (g.uniform) return Math.max(0, Math.min(g.N - 2, Math.floor((r - g.rhoC[0]) / g.dRho)));
  return findInterval(g.rhoC, r);
}

/** Index of the face nearest to ρ, 1 … N − 1 (an interior face) */
export function nearestFace(g: RadialGrid, r: number): number {
  if (g.uniform) return Math.min(g.N - 1, Math.max(1, Math.round(r / g.dRho)));
  const i = findInterval(g.rhoF, r);
  const f = r - g.rhoF[i] <= g.rhoF[i + 1] - r ? i : i + 1;
  return Math.min(g.N - 1, Math.max(1, f));
}

/** Linear interpolation of a cell array at ρ between the cell centres (the end values outside them) */
export function interpCells(g: RadialGrid, a: ArrayLike<number>, r: number): number {
  if (r <= g.rhoC[0]) return a[0];
  if (r >= g.rhoC[g.N - 1]) return a[g.N - 1];
  const i = centerInterval(g, r);
  const t = (r - g.rhoC[i]) / g.distF[i + 1];
  return a[i] + t * (a[i + 1] - a[i]);
}

/** Value at the interior face f, linear between the two cells that share it: a[f − 1] (1 − w) + a[f] w */
export function faceValue(g: RadialGrid, a: ArrayLike<number>, f: number): number {
  const w = g.wR[f];
  return (1 - w) * a[f - 1] + w * a[f];
}

export interface TransportGeometry extends RadialGrid {
  // merkezlerde
  VpC: Float64Array; g1C: Float64Array; g2C: Float64Array; R2invC: Float64Array; FC: Float64Array;
  B2C: Float64Array; ftC: Float64Array; epsC: Float64Array; RgeoC: Float64Array; gradRhoC: Float64Array; qEqC: Float64Array;
  RinC: Float64Array; RoutC: Float64Array;
  // yüzeylerde
  VpF: Float64Array; g1F: Float64Array; g2F: Float64Array; FF: Float64Array; gradRhoF: Float64Array;
  VF: Float64Array; AF: Float64Array; RinF: Float64Array; RoutF: Float64Array;
  dV: Float64Array; // hücre hacimleri
  PhiB: number; rhoTorB: number; B0: number; R0: number; a: number; kappa: number; delta: number;
  Raxis: number;
  volume: number; surface: number; perimeter: number;
}

/**
 * The radial grid of a transport geometry: N cells between the faces ρ_f (ρ_0 = 0 the axis, ρ_N = 1 the separatrix),
 * the cell centres inside them, and the mean cell width. A geometry that replaces another one (the Grad–Shafranov
 * update of a running shot) is built on the grid of the geometry it replaces, so the transport equations keep the
 * grid they were set up on whatever it is: a geometry built without one is on the uniform grid.
 *
 * The three arrays define the grid; the per-cell and per-face spacings the solvers use (`RadialGrid`) follow from them
 * and are derived when they are not given. A TransportGeometry is a full RadialGrid, so an update passes the whole
 * geometry it replaces and every array is copied, bit for bit.
 */
export type RadialGridArrays = Pick<RadialGrid, 'rhoC' | 'rhoF' | 'dRho'> & Partial<Pick<RadialGrid, 'uniform' | 'dRhoC' | 'distF' | 'wR' | 'spanF' | 'spanC'>>;

/** The grid `g` for N cells (copied: a geometry owns its arrays), or a RangeError if it is not a grid of N cells */
function ownGrid(g: RadialGridArrays, N: number): RadialGrid {
  const { rhoC, rhoF } = g;
  if (rhoF.length !== N + 1 || rhoC.length !== N) throw new RangeError(`geometryFromEquilibrium: the grid has ${rhoC.length} cells and ${rhoF.length} faces, ${N} cells were asked for`);
  if (rhoF[0] !== 0 || rhoF[N] !== 1) throw new RangeError(`geometryFromEquilibrium: the faces of the grid run from ${rhoF[0]} to ${rhoF[N]}, not from 0 to 1`);
  for (let i = 0; i < N; i++) {
    if (!(rhoF[i + 1] > rhoF[i]) || !(rhoC[i] > rhoF[i] && rhoC[i] < rhoF[i + 1])) throw new RangeError(`geometryFromEquilibrium: the grid is not increasing in cell ${i}`);
  }
  const { dRhoC, distF, wR, spanF, spanC } = g;
  if (dRhoC && distF && wR && spanF && spanC) {
    if (dRhoC.length !== N || spanC.length !== N || distF.length !== N + 1 || wR.length !== N + 1 || spanF.length !== N + 1) {
      throw new RangeError(`geometryFromEquilibrium: the spacings of the grid are not those of a grid of ${N} cells`);
    }
    return {
      N, uniform: g.uniform ?? false, rhoC: Float64Array.from(rhoC), rhoF: Float64Array.from(rhoF), dRho: g.dRho,
      dRhoC: Float64Array.from(dRhoC), distF: Float64Array.from(distF), wR: Float64Array.from(wR), spanF: Float64Array.from(spanF), spanC: Float64Array.from(spanC),
    };
  }
  // the uniform grid, double for double: the legacy expressions of the uniform-grid code
  let uniform = g.dRho === 1 / N;
  for (let i = 0; uniform && i < N; i++) uniform = rhoC[i] === (i + 0.5) / N && rhoF[i] === i / N;
  if (uniform) return buildGrid(N);
  return nonUniformGrid(N, Float64Array.from(rhoC), Float64Array.from(rhoF), g.dRho);
}

/**
 * What the transport geometry is built from: the flux-surface tables (on the ψ_N levels, axis
 * first) and the global values of a Grad–Shafranov equilibrium. An Equilibrium is one; tests
 * build them from analytic equilibria.
 */
export interface EquilibriumTables {
  prof: Pick<EqProfiles, 'psiN' | 'rhoTor' | 'q' | 'F' | 'V' | 'dVdpsiN' | 'area' | 'avgR2inv' | 'avgGrad2R2' | 'avgGrad2' | 'avgGrad' | 'avgB2' | 'ft' | 'Rin' | 'Rout'>;
  /** traced flux surfaces; the last one (the LCFS) gives the plasma surface area */
  surfaces: Pick<TracedSurfaces, 'R' | 'dlw'>;
  /** ψ on the magnetic axis (ψ = 0 on the LCFS) [Wb/rad], axis radius [m], toroidal flux inside the LCFS [Wb] */
  psiAxis: number; Raxis: number; PhiB: number;
  rhoTorB: number; B0: number; R0: number; volume: number; perimeter: number;
}

/**
 * Dengeden taşınım geometrisi. `grid`: the radial grid of the geometry, either the edge packing of the cells (a GridSpec;
 * it is built by `buildGrid`) or the grid of the model that the geometry is for (the faces, the centres and the mean cell
 * width, or a whole RadialGrid such as the TransportGeometry it replaces); undefined: N uniform cells.
 */
export function geometryFromEquilibrium(eq: EquilibriumTables, N: number, geom: { a: number; kappa: number; delta: number }, grid?: GridSpec | RadialGridArrays): TransportGeometry {
  const P = eq.prof;
  const n = P.psiN.length;
  const PhiB = eq.PhiB, dpsi = eq.psiAxis;
  const x = P.rhoTor;
  const u = new Float64Array(n), g1 = new Float64Array(n), g2 = new Float64Array(n), gr = new Float64Array(n), eps = new Float64Array(n), Rg = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const r = Math.max(x[k], 1e-6);
    const drdpsiN = (Math.PI * P.q[k] * dpsi) / (PhiB * r);
    u[k] = P.dVdpsiN[k] / drdpsiN / r; // V'/ρ̂
    const c = (Math.PI * P.q[k]) / (PhiB * r);
    g1[k] = P.avgGrad2[k] * c * c;
    g2[k] = P.avgGrad2R2[k] * c * c;
    gr[k] = P.avgGrad[k] * c;
    eps[k] = (P.Rout[k] - P.Rin[k]) / (P.Rout[k] + P.Rin[k]);
    Rg[k] = 0.5 * (P.Rout[k] + P.Rin[k]);
  }
  // eksen: ρ̂'de (ψ_N'de değil) ikinci dereceden düzgün → ilk iki noktadan doğrusal ekstrapolasyon ρ̂²'de
  const ext = (a: Float64Array) => { const r1 = x[1] ** 2, r2 = x[2] ** 2; a[0] = a[1] - (a[2] - a[1]) * (r1 / (r2 - r1)); };
  ext(u); ext(g1); ext(g2); ext(gr);
  eps[0] = 0; Rg[0] = eq.Raxis;
  const sp = (a: ArrayLike<number>) => new CubicSpline(x, a);
  const Su = sp(u), Sg1 = sp(g1), Sg2 = sp(g2), Sgr = sp(gr), SR2 = sp(P.avgR2inv), SF = sp(P.F), SB2 = sp(P.avgB2), Sft = sp(P.ft), Seps = sp(eps), SRg = sp(Rg), Sq = sp(P.q);
  const SRin = sp(P.Rin), SRout = sp(P.Rout);
  // the poloidal area vanishes as ρ̂² at the axis: spline it against ρ̂²
  const x2 = Float64Array.from(x, (r) => r * r);
  const SA = new CubicSpline(x2, P.area);
  const rg = grid && 'rhoF' in grid ? ownGrid(grid, N) : buildGrid(N, grid);
  const { rhoC, rhoF } = rg;
  const f = (S: CubicSpline, r: ArrayLike<number>) => Float64Array.from(r, (v) => S.eval(v));
  const vp = (r: number) => Su.eval(r) * r;
  const VpC = Float64Array.from(rhoC, vp);
  const VpF = Float64Array.from(rhoF, vp);
  // Cell volumes: the integral of V' over the cell, the metric the finite-volume fluxes use, so that ΔV = V'Δρ̂ (the
  // continuum operator (1/V') ∂ρ(V' …) needs it). V(ρ̂) itself is the poorer function on the tables: they sit at
  // ψ_N = (k/(n−1))², so their last interval spans ρ̂ ≈ 0.95 → 1 (ITER15) or 0.89 → 1 (MASTU15), and the ρ̂ of
  // the outer nodes, a cumulative integral of q that diverges at the X-point, is too small on such a coarse table
  // (ITER15 5e-4 at ψ_N = 0.96, MASTU15 1.2e-2). V is exact at the nodes, but paired with those ρ̂ it interpolated
  // to cell volumes 1–2 % off in the outer cells of the large machines and 15 % off in MASTU15 (against tables of
  // 8 times the surfaces), whereas ∫V' is within 0.1 % (MASTU15 2 %, mostly at the axis). The interpolated V' does
  // not integrate to the tabulated volume exactly (ITER15 +0.06 %, MASTU15 +0.8 %, that of the ρ̂ error): one scale
  // factor for all cells restores ΣΔV = V of the equilibrium. geometry.test.ts: real Grad–Shafranov tables.
  const dV = new Float64Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) { dV[i] = integrateGL(vp, rhoF[i], rhoF[i + 1], 3); sum += dV[i]; }
  const vscale = sum > 0 ? eq.volume / sum : 1;
  for (let i = 0; i < N; i++) dV[i] *= vscale;
  const VF = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) VF[i + 1] = VF[i] + dV[i];
  const ftC = f(Sft, rhoC).map((v) => Math.min(Math.max(v, 0), 1));
  const epsC = f(Seps, rhoC).map((v) => Math.max(v, 1e-4));
  const AF = Float64Array.from(rhoF, (r) => SA.eval(r * r)); AF[0] = 0;
  const RinF = f(SRin, rhoF), RoutF = f(SRout, rhoF);
  RinF[0] = RoutF[0] = eq.Raxis;
  // plazma yüzey alanı S = 2π ∮ R dl (son akı yüzeyi)
  const kb = eq.surfaces.R.length - 1;
  let surf = 0;
  for (let j = 0; j < eq.surfaces.R[kb].length; j++) surf += 2 * Math.PI * eq.surfaces.R[kb][j] * eq.surfaces.dlw[kb][j];
  return {
    ...rg,
    VpC, g1C: f(Sg1, rhoC), g2C: f(Sg2, rhoC), R2invC: f(SR2, rhoC), FC: f(SF, rhoC), B2C: f(SB2, rhoC), ftC, epsC,
    RgeoC: f(SRg, rhoC), gradRhoC: f(Sgr, rhoC), qEqC: f(Sq, rhoC), RinC: f(SRin, rhoC), RoutC: f(SRout, rhoC),
    VpF, g1F: f(Sg1, rhoF), g2F: f(Sg2, rhoF), FF: f(SF, rhoF), gradRhoF: f(Sgr, rhoF), VF, AF, RinF, RoutF, dV,
    PhiB, rhoTorB: eq.rhoTorB, B0: eq.B0, R0: eq.R0, a: geom.a, kappa: geom.kappa, delta: geom.delta, Raxis: eq.Raxis,
    volume: eq.volume, surface: surf, perimeter: eq.perimeter,
  };
}

/**
 * Büyük en-boy oranlı dairesel silindirik geometri (analitik): ρ̂ = r/a,
 * V' = 4π²R0a²ρ, g1 = 1/a², g2 = 1/(a²R0²), F = R0B0, Φ_b = πa²B0.
 * Tuzaklı oran ≈ 1.46√ε − 0.46ε (Hirshman–Sigmar yaklaşık).
 */
export function circularGeometry(R0: number, a: number, B0: number, N: number, qProfile: (r: number) => number = (r) => 1 + 2 * r * r, grid?: GridSpec): TransportGeometry {
  const rg = buildGrid(N, grid);
  const { rhoC, rhoF } = rg;
  const c = (arr: Float64Array, fn: (r: number) => number) => Float64Array.from(arr, fn);
  const Vp = (r: number) => 4 * Math.PI * Math.PI * R0 * a * a * r;
  const VF = c(rhoF, (r) => 2 * Math.PI * Math.PI * R0 * a * a * r * r);
  const dV = new Float64Array(N);
  for (let i = 0; i < N; i++) dV[i] = VF[i + 1] - VF[i];
  const ft = (r: number) => { const e = (r * a) / R0; return Math.max(0, 1.46 * Math.sqrt(e) - 0.46 * e); };
  return {
    ...rg,
    VpC: c(rhoC, Vp), g1C: c(rhoC, () => 1 / (a * a)), g2C: c(rhoC, () => 1 / (a * a * R0 * R0)), R2invC: c(rhoC, () => 1 / (R0 * R0)),
    FC: c(rhoC, () => R0 * B0), B2C: c(rhoC, () => B0 * B0), ftC: c(rhoC, ft), epsC: c(rhoC, (r) => Math.max((r * a) / R0, 1e-4)),
    RgeoC: c(rhoC, () => R0), gradRhoC: c(rhoC, () => 1 / a), qEqC: c(rhoC, qProfile), RinC: c(rhoC, (r) => R0 - r * a), RoutC: c(rhoC, (r) => R0 + r * a),
    VpF: c(rhoF, Vp), g1F: c(rhoF, () => 1 / (a * a)), g2F: c(rhoF, () => 1 / (a * a * R0 * R0)), FF: c(rhoF, () => R0 * B0), gradRhoF: c(rhoF, () => 1 / a),
    VF, AF: c(rhoF, (r) => Math.PI * a * a * r * r), RinF: c(rhoF, (r) => R0 - r * a), RoutF: c(rhoF, (r) => R0 + r * a), dV,
    PhiB: Math.PI * a * a * B0, rhoTorB: a, B0, R0, a, kappa: 1, delta: 0, Raxis: R0,
    volume: VF[N], surface: 4 * Math.PI * Math.PI * R0 * a, perimeter: 2 * Math.PI * a,
  };
}
