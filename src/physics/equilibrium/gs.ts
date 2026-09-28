/**
 * NUMERICAL FIXED-BOUNDARY GRAD–SHAFRANOV SOLVER
 *
 *   Δ*ψ ≡ R ∂/∂R (R⁻¹ ∂ψ/∂R) + ∂²ψ/∂Z² = −μ0 R j_φ ,   j_φ = R p'(ψ) + FF'(ψ)/(μ0 R)
 *
 * Convention: ψ [Wb/rad] is positive in the plasma and maximal on the magnetic axis, ψ_b = 0 on
 * the boundary; ψ_N = (ψ_ax − ψ)/(ψ_ax − ψ_b) ∈ [0, 1].
 *
 * Discretisation: 5-point finite differences on a regular (R, Z) grid; where the plasma boundary
 * (Miller shape) cuts a grid line the Shortley–Weller unequal-arm formulas are used (local
 * truncation error O(h) at the boundary, global convergence O(h²) — G. H. Shortley & R. Weller,
 * J. Appl. Phys. 9 (1938) 334). Only interior nodes are unknowns. The operator does not depend on
 * ψ, so its banded LU is factorised once — and shared per worker through a small LRU cache
 * (GSGrid.shared) — and every Picard iteration costs one forward/back substitution.
 *
 * Nonlinearity: fixed-point (Picard) iteration x_{k+1} = G(x_k), G = linear solve with j_φ from
 * ψ_k, accelerated by Anderson mixing (H. F. Walker & P. Ni, SIAM J. Numer. Anal. 49 (2011) 1715).
 * The mixing factor ω stays at its maximum (default 1) while the residual decreases; when the
 * residual grows ω is halved and the Anderson history restarted.
 *
 * Profile modes:
 *  (a) 'shape': j_φ = λ[β0 R/R0 + (1−β0) R0/R](1 − ψ_N^αm)^αn (Y. M. Jeon, J. Korean Phys. Soc. 67
 *      (2015) 843; as in FreeGS, B. D. Dudson et al.). λ ← I_p. With a β_p target, β0 follows in
 *      closed form each iteration: for fixed ψ, β_p(β0) = K β0 / (I_1/R + β0 (I_R − I_1/R)) is a
 *      Möbius function of β0. β0 > 1 (FF' < 0, diamagnetic) is allowed; a target that would need
 *      a reversed toroidal current (β0 above 1/(1 − (R_in/R0)²)) or has no finite β0 is flagged
 *      with betaPTargetMet = false and β0 is held at that limit.
 *  (b) 'table': transport p(ψ_N) and either the enclosed current I(ψ_N) or ⟨j_φ/R⟩(ψ_N). With
 *      ⟨j_φ/R⟩ = p' + FF'⟨R⁻²⟩/μ0 (S. P. Hirshman & S. C. Jardin, Phys. Fluids 22 (1979) 731),
 *        FF'(ψ_N) = μ0 (c ⟨j_φ/R⟩ − p') / ⟨R⁻²⟩
 *      from the flux-surface metrics of the current iterate. I_p is met through c: only FF'
 *      absorbs the normalisation, as in EFIT/FreeGS practice, and p' is never rescaled, so the
 *      reported p, β_p and W_th are the ones the field actually balances (forceBalanceResidual).
 *      A pure multiplicative FF' scale was not used: near β_p ≈ 1 FF' ≈ 0 on average, and the
 *      scale factor (I_p − I_p')/I_FF' becomes ill-conditioned or changes sign; scaling ⟨j_φ/R⟩
 *      (c ≈ I_p/I_table) keeps the current-profile shape and is always well conditioned.
 */
import { Geometry } from '../geometry';
import { BandedLU } from '../numerics/linalg';
import { Bicubic, CubicSpline, Pchip } from '../numerics/interp';
import { gaussLegendre } from '../numerics/quadrature';
import { AndersonMixer } from '../numerics/anderson';
import { ShapeBoundary, millerBoundary, shapeIntegrals } from './miller';
import { PsiField, TracedSurfaces, magneticAverages, surfaceMetrics, traceSurfaces } from './fluxsurface';

const MU0 = 1.25663706212e-6;

// ----------------------------------------------------------------------------------------- errors

export type GSFailureReason =
  /** invalid options or grid parameters (thrown before any iteration) */
  | 'bad-input'
  /** ψ on the magnetic axis ≤ 0: the iteration lost the plasma */
  | 'diverged'
  /** NaN/Inf appeared in ψ */
  | 'non-finite'
  /** the requested plasma current cannot be produced by the given profiles */
  | 'current-unreachable';

/** Typed Grad–Shafranov failure: callers can tell bad input from a diverged iteration. */
export class GSFailure extends Error {
  readonly reason: GSFailureReason;
  /** Picard iterations completed when the failure occurred (0 for bad input) */
  readonly iterations: number;
  /** last fixed-point residual max|G(ψ) − ψ|/ψ_axis (NaN if none yet) */
  readonly residual: number;
  constructor(reason: GSFailureReason, message: string, iterations = 0, residual = NaN) {
    super(`Grad–Shafranov (${reason}): ${message}`);
    this.name = 'GSFailure';
    this.reason = reason;
    this.iterations = iterations;
    this.residual = residual;
  }
}

function badInput(msg: string): never { throw new GSFailure('bad-input', msg); }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------------------------------- grid

export interface GSGridOptions {
  /** number of nodes along R (the Z spacing is chosen close to the R spacing); default 65 */
  NR?: number;
  /** box margin around the plasma, in units of a; default 0.06 */
  margin?: number;
  /**
   * Plasma boundary (default: Miller shape of geom). It must be up-down symmetric and cut every
   * grid line at most twice. Grids with a custom boundary are never cached.
   */
  boundary?: ShapeBoundary;
  /** GSSolver only: reuse the per-worker grid/LU cache for identical parameters (default true) */
  cache?: boolean;
}

/** Boundary values g(R, Z) (default 0) */
export type BoundaryValue = (R: number, Z: number) => number;

/**
 * Exterior-fill plan: sequential linear updates ψ[tgt] = Σ w ψ[src] (+ c) — each may use values
 * written by earlier updates — followed by a fixed number of weighted-Jacobi sweeps of Δ*ψ = 0 on
 * the remaining ("free") nodes. Entirely determined by the grid, hence recorded once.
 */
interface ExtensionPlan {
  tgt: Int32Array;
  start: Int32Array;
  src: Int32Array;
  w: Float64Array;
  cst: Float64Array | null;
  free: Int32Array;
  /** 4 neighbours per free node (mirrored at the box edge) */
  jNb: Int32Array;
  /** matching weights (Δ* stencil divided by its centre coefficient) */
  jW: Float64Array;
  tmp: Float64Array;
}

/**
 * Exterior fill: extrapolated layers (the first through the boundary crossing), then weighted-Jacobi
 * sweeps of Δ*ψ = 0 on the far exterior with weight 4/5 (the optimal 2-D smoother, W. L. Briggs,
 * V. E. Henson & S. F. McCormick, "A Multigrid Tutorial", 2nd ed., SIAM 2000, §2).
 * Why 8 layers: the natural bicubic spline couples nodes with a decay of 2 − √3 ≈ 0.27 per node,
 * so the kink where extrapolation hands over to the harmonic fill perturbs |∇ψ| on the boundary by
 * ~0.27^L of an O(1) relative amount, independently of h. Measured on an exact Solov'ev contour
 * (NR = 33/65/129), the maximum |∇ψ| error on the boundary is 7.2/7.7/6.8 % with 2 layers,
 * 1.3/1.1/0.6 % with 4 and 0.84/0.18/0.015 % with 8 — the same as extrapolating every layer, but
 * with |ψ| bounded by ~ψ_axis instead of growing ~7× per layer (1e13·ψ_axis at NR = 129).
 */
const EXT_LAYERS = 8;
const EXT_JACOBI_SWEEPS = 8;
const EXT_JACOBI_OMEGA = 0.8;

/** per-worker LRU cache of factorised grids */
const GRID_CACHE = new Map<string, GSGrid>();
const GRID_CACHE_MAX_ENTRIES = 8;
const GRID_CACHE_MAX_BYTES = 96 * 1024 * 1024;

/**
 * Grid + Shortley–Weller operator. The operator depends only on the geometry; it is assembled for
 * the interior unknowns and factorised in the constructor. Instances are immutable afterwards
 * (safe to share between solvers).
 */
export class GSGrid {
  readonly geom: Readonly<Geometry>;
  readonly NR: number;
  readonly NZ: number;
  readonly Rmin: number;
  readonly Zmin: number;
  readonly dR: number;
  readonly dZ: number;
  /** 0: exterior, 1: interior (unknown), 2: node on the boundary (value = g) */
  readonly kind: Int8Array;
  readonly boundary: ShapeBoundary;
  readonly nInside: number;
  /** interior nodes (full-grid indices, row-major); position = unknown number */
  readonly interior: Int32Array;
  /** R of each interior node */
  readonly interiorR: Float64Array;
  /** full-grid index → unknown number (−1 if not interior) */
  private readonly uIdx: Int32Array;
  /** stencil per interior node: [centre, W, E, S, N] */
  private readonly stCoef: Float64Array;
  /** neighbour (W, E, S, N) grid index, or −1 when the arm ends on the boundary crossing */
  private readonly stNb: Int32Array;
  /** crossing point of an arm that ends on the boundary (where ψ = g) */
  private readonly crR: Float64Array;
  private readonly crZ: Float64Array;
  /** per row j / column i: horizontal and vertical boundary crossings */
  private readonly rowRange: ([number, number] | null)[];
  private readonly colTop: (number | null)[];
  private readonly lu: BandedLU;
  private readonly plan: ExtensionPlan;

  constructor(geom: Geometry, opts: GSGridOptions = {}) {
    const NR = opts.NR ?? 65;
    const m = opts.margin ?? 0.06;
    if (!(Number.isInteger(NR) && NR >= 9 && NR <= 1025)) badInput(`grid NR must be an integer in [9, 1025] (got ${NR})`);
    if (!(finite(m) && m >= 0 && m <= 2)) badInput(`grid margin must be in [0, 2] (got ${m})`);
    if (!(finite(geom.R) && finite(geom.a) && finite(geom.kappa) && finite(geom.delta))) badInput('geometry must be finite');
    if (!(geom.a > 0 && geom.kappa > 0 && geom.R - geom.a * (1 + m) > 0)) badInput(`need a > 0, κ > 0 and R − a(1 + margin) > 0 (R = ${geom.R}, a = ${geom.a}, κ = ${geom.kappa})`);
    this.geom = Object.freeze({ R: geom.R, a: geom.a, kappa: geom.kappa, delta: geom.delta });
    const b = (this.boundary = opts.boundary ?? millerBoundary(geom));
    const Rlo = geom.R - geom.a * (1 + m), Rhi = geom.R + geom.a * (1 + m);
    const dR = (Rhi - Rlo) / (NR - 1);
    const Zext = geom.kappa * geom.a * (1 + m);
    const NZ = 2 * Math.ceil(Zext / dR) + 1; // odd → a Z = 0 row exists
    const dZ = (2 * Zext) / (NZ - 1);
    this.NR = NR; this.NZ = NZ; this.Rmin = Rlo; this.Zmin = -Zext; this.dR = dR; this.dZ = dZ;
    const N = NR * NZ;
    // boundary crossings of every grid line (evaluated once: custom boundaries may be expensive)
    this.rowRange = Array.from({ length: NZ }, (_, j) => b.rRange(this.Z(j)));
    this.colTop = Array.from({ length: NR }, (_, i) => b.zTop(this.R(i)));
    const kind = (this.kind = new Int8Array(N));
    const snap = 1e-3;
    for (let j = 0; j < NZ; j++) {
      const Z = this.Z(j);
      const rr = this.rowRange[j];
      if (!rr) continue;
      for (let i = 0; i < NR; i++) {
        const R = this.R(i);
        if (R <= rr[0] || R >= rr[1]) continue;
        const zt = this.colTop[i];
        const dh = Math.min(R - rr[0], rr[1] - R) / dR;
        const dv = zt === null ? 0 : (zt - Math.abs(Z)) / dZ;
        if (zt === null || dv <= 0) continue;
        kind[j * NR + i] = dh < snap || dv < snap ? 2 : 1;
      }
    }
    // interior numbering and bandwidth
    const uIdx = (this.uIdx = new Int32Array(N).fill(-1));
    const ins: number[] = [];
    for (let k = 0; k < N; k++) if (kind[k] === 1) { uIdx[k] = ins.length; ins.push(k); }
    const nIn = (this.nInside = ins.length);
    if (nIn < 4) badInput(`grid too coarse: ${nIn} interior nodes (NR = ${NR})`);
    this.interior = Int32Array.from(ins);
    this.interiorR = Float64Array.from(ins, (k) => this.R(k % NR));
    let bw = 1;
    for (const k of ins) for (const nb of [k - 1, k + 1, k - NR, k + NR]) if (kind[nb] === 1) bw = Math.max(bw, Math.abs(uIdx[nb] - uIdx[k]));
    this.stCoef = new Float64Array(5 * nIn);
    this.stNb = new Int32Array(4 * nIn);
    this.crR = new Float64Array(4 * nIn); this.crZ = new Float64Array(4 * nIn);
    const lu = (this.lu = new BandedLU(nIn, bw, bw));
    for (let u = 0; u < nIn; u++) {
      const k = ins[u], i = k % NR, j = (k - i) / NR;
      const R = this.R(i), Z = this.Z(j);
      const rr = this.rowRange[j]!, zt = this.colTop[i]!;
      // arm lengths (to the boundary crossing when the neighbour is outside)
      const outW = kind[k - 1] === 0, outE = kind[k + 1] === 0, outS = kind[k - NR] === 0, outN = kind[k + NR] === 0;
      const h1 = outW ? R - rr[0] : dR, h2 = outE ? rr[1] - R : dR;
      const k1 = outS ? Z + zt : dZ, k2 = outN ? zt - Z : dZ;
      const den = h1 * h2 * (h1 + h2);
      const cE = (2 * h1 - (h1 * h1) / R) / den;
      const cW = (2 * h2 + (h2 * h2) / R) / den;
      const cN = 2 / (k2 * (k1 + k2)), cS = 2 / (k1 * (k1 + k2));
      const cC = (-2 * (h1 + h2) + (h1 * h1 - h2 * h2) / R) / den - 2 / (k1 * k2);
      this.stCoef[5 * u] = cC;
      lu.set(u, u, cC);
      const arm = (d: number, nb: number, c: number, out: boolean, Rb: number, Zb: number) => {
        this.stCoef[5 * u + 1 + d] = c;
        if (out) { this.stNb[4 * u + d] = -1; this.crR[4 * u + d] = Rb; this.crZ[4 * u + d] = Zb; return; }
        this.stNb[4 * u + d] = nb;
        if (kind[nb] === 1) lu.set(u, uIdx[nb], c);
      };
      arm(0, k - 1, cW, outW, rr[0], Z);
      arm(1, k + 1, cE, outE, rr[1], Z);
      arm(2, k - NR, cS, outS, R, -zt);
      arm(3, k + NR, cN, outN, R, zt);
    }
    lu.factor();
    this.plan = this.buildExtension(null);
  }

  /**
   * Shared (per worker) grid for these parameters: an LRU cache keyed by (R, a, κ, δ, NR, margin)
   * holding at most 8 grids / 96 MB of LU storage. Grids are immutable after construction, so a
   * cached grid gives bitwise the same results as a fresh one.
   */
  static shared(geom: Geometry, opts: GSGridOptions = {}): GSGrid {
    if (opts.boundary || opts.cache === false) return new GSGrid(geom, opts);
    const key = [geom.R, geom.a, geom.kappa, geom.delta, opts.NR ?? 65, opts.margin ?? 0.06].join('|');
    const hit = GRID_CACHE.get(key);
    if (hit) { GRID_CACHE.delete(key); GRID_CACHE.set(key, hit); return hit; }
    const grid = new GSGrid(geom, opts);
    GRID_CACHE.set(key, grid);
    let bytes = 0;
    for (const g of GRID_CACHE.values()) bytes += g.bytes;
    for (const [k, g] of GRID_CACHE) {
      if (GRID_CACHE.size <= 1 || (GRID_CACHE.size <= GRID_CACHE_MAX_ENTRIES && bytes <= GRID_CACHE_MAX_BYTES)) break;
      GRID_CACHE.delete(k); bytes -= g.bytes;
    }
    return grid;
  }
  /** Drop all cached grids (tests / memory pressure). */
  static clearCache(): void { GRID_CACHE.clear(); }
  /** Number of cached grids (diagnostics). */
  static get cacheSize(): number { return GRID_CACHE.size; }

  /** approximate memory held by the factorisation [bytes] */
  get bytes(): number { return this.lu.bytes + 8 * (9 * this.nInside) + this.NR * this.NZ * 5; }

  R(i: number): number { return this.Rmin + i * this.dR; }
  Z(j: number): number { return this.Zmin + j * this.dZ; }

  /**
   * Linear solve Δ*ψ = S(R, Z) with boundary value g. S is evaluated at interior nodes only.
   * out: NR·NZ; exterior nodes are set to 0 (fill them with extend() before interpolating).
   */
  solveLinear(S: (R: number, Z: number, k: number) => number, g?: BoundaryValue, out: Float64Array = new Float64Array(this.NR * this.NZ)): Float64Array {
    const { NR, NZ, kind, interior, stCoef, stNb } = this;
    const nIn = this.nInside;
    const b = new Float64Array(nIn);
    for (let u = 0; u < nIn; u++) {
      const k = interior[u], i = k % NR, j = (k - i) / NR;
      let rhs = S(this.R(i), this.Z(j), k);
      if (g) {
        for (let d = 0; d < 4; d++) {
          const c = stCoef[5 * u + 1 + d], nb = stNb[4 * u + d];
          if (nb < 0) rhs -= c * g(this.crR[4 * u + d], this.crZ[4 * u + d]);
          else if (kind[nb] === 2) { const inb = nb % NR; rhs -= c * g(this.R(inb), this.Z((nb - inb) / NR)); }
        }
      }
      b[u] = rhs;
    }
    this.lu.solve(b, b);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const k = j * NR + i;
      const t = kind[k];
      out[k] = t === 1 ? b[this.uIdx[k]] : t === 2 && g ? g(this.R(i), this.Z(j)) : 0;
    }
    return out;
  }

  /**
   * Discrete Δ*ψ (the operator of solveLinear) at interior nodes, 0 elsewhere. Boundary nodes
   * are read from psi; arms ending on a boundary crossing use g there (default 0).
   */
  applyOperator(psi: ArrayLike<number>, out: Float64Array = new Float64Array(this.NR * this.NZ), g?: BoundaryValue): Float64Array {
    const { interior, stCoef, stNb } = this;
    out.fill(0);
    for (let u = 0; u < this.nInside; u++) {
      const k = interior[u];
      let s = stCoef[5 * u] * psi[k];
      for (let d = 0; d < 4; d++) {
        const nb = stNb[4 * u + d];
        const v = nb >= 0 ? psi[nb] : g ? g(this.crR[4 * u + d], this.crZ[4 * u + d]) : 0;
        s += stCoef[5 * u + 1 + d] * v;
      }
      out[k] = s;
    }
    return out;
  }

  /**
   * Fill the exterior nodes from the interior solution so that the global bicubic spline stays
   * smooth near the boundary:
   *  layer 1: along each grid line, quadratic Lagrange extrapolation through the boundary crossing
   *     B (ψ = g) and interior nodes (if B nearly coincides with the first interior node, the next
   *     one is used instead to avoid ill-conditioning), averaged over the available directions;
   *  layers 2…8: quadratic (or linear) extrapolation along grid lines from known nodes;
   *  the rest: initialised layer by layer with the mean of known neighbours, then a fixed number
   *     of weighted-Jacobi sweeps of Δ*ψ = 0 (mirror condition at the box edge).
   * Every step is linear in ψ and fixed by the grid, so for g = 0 (all physics solutions) the whole
   * procedure is a recorded plan that is always valid; values stay O(ψ_axis) (see EXT_LAYERS).
   * The previous scheme extrapolated every reachable layer, amplifying round-off by up to 7× per
   * layer (1e13·ψ_axis at NR = 129), which invalidated the recorded plan.
   */
  extend(psi: Float64Array, g?: BoundaryValue): Float64Array {
    this.runPlan(g ? this.buildExtension(g) : this.plan, psi);
    return psi;
  }

  private runPlan(p: ExtensionPlan, psi: Float64Array): void {
    const { tgt, start, src, w, cst, free, jNb, jW, tmp } = p;
    for (let o = 0; o < tgt.length; o++) {
      let v = cst ? cst[o] : 0;
      for (let m = start[o]; m < start[o + 1]; m++) v += w[m] * psi[src[m]];
      psi[tgt[o]] = v;
    }
    const nF = free.length, om = EXT_JACOBI_OMEGA;
    for (let s = 0; s < EXT_JACOBI_SWEEPS && nF > 0; s++) {
      for (let q = 0; q < nF; q++) {
        const b4 = 4 * q;
        const nv = jW[b4] * psi[jNb[b4]] + jW[b4 + 1] * psi[jNb[b4 + 1]] + jW[b4 + 2] * psi[jNb[b4 + 2]] + jW[b4 + 3] * psi[jNb[b4 + 3]];
        tmp[q] = psi[free[q]] + om * (nv - psi[free[q]]);
      }
      for (let q = 0; q < nF; q++) psi[free[q]] = tmp[q];
    }
  }

  /** Build the exterior-fill plan (g = null: homogeneous boundary values, recordable). */
  private buildExtension(g: BoundaryValue | null): ExtensionPlan {
    const { NR, NZ, kind } = this;
    const N = NR * NZ;
    const known = new Uint8Array(N);
    for (let k = 0; k < N; k++) known[k] = kind[k] !== 0 ? 1 : 0;
    const tgt: number[] = [], start: number[] = [0], src: number[] = [], wts: number[] = [], cst: number[] = [];
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const inGrid = (i: number, j: number) => i >= 0 && i < NR && j >= 0 && j < NZ;
    /** Lagrange basis weights L_a(s) */
    const lagW = (xs: number[], s: number) => xs.map((_, a) => {
      let w = 1;
      for (let c = 0; c < xs.length; c++) if (c !== a) w *= (s - xs[c]) / (xs[a] - xs[c]);
      return w;
    });
    // Every pass scans nodes in increasing index order and finishes one node before the next, so a
    // node's terms (averaged over its directions, duplicate sources merged) are emitted right away;
    // the pass's nodes become "known" only after the pass.
    const tS = new Int32Array(16), tW = new Float64Array(16);
    let nt = 0, cSum = 0, nDir = 0;
    const pend: number[] = [];
    const term = (sIdx: number, w: number) => {
      for (let q = 0; q < nt; q++) if (tS[q] === sIdx) { tW[q] += w; return; }
      tS[nt] = sIdx; tW[nt++] = w;
    };
    const endNode = (k: number) => {
      if (nDir > 0) {
        tgt.push(k);
        for (let q = 0; q < nt; q++) { src.push(tS[q]); wts.push(tW[q] / nDir); }
        start.push(src.length);
        cst.push(cSum / nDir);
        pend.push(k);
      }
      nt = 0; cSum = 0; nDir = 0;
    };
    const commit = (mark: number) => {
      for (const k of pend) known[k] = mark;
      const done = pend.slice();
      pend.length = 0;
      return done;
    };
    // layer 1: exterior nodes next to the boundary
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const k = j * NR + i;
      if (known[k]) continue;
      for (const [di, dj] of dirs) {
        const i1 = i - di, j1 = j - dj; // neighbour on the plasma side
        if (!inGrid(i1, j1)) continue;
        const k1 = j1 * NR + i1;
        if (kind[k1] === 0) continue;
        const RI = this.R(i1), ZI = this.Z(j1);
        const h = di !== 0 ? this.dR : this.dZ;
        let hb: number, Rb: number, Zb: number;
        if (di !== 0) {
          const rr = this.rowRange[j1];
          if (!rr) continue;
          Rb = di > 0 ? rr[1] : rr[0]; Zb = ZI; hb = Math.abs(Rb - RI);
        } else {
          const zt = this.colTop[i1];
          if (zt === null) continue;
          Rb = RI; Zb = dj > 0 ? zt : -zt; hb = Math.abs(Zb - ZI);
        }
        hb = Math.min(hb, h);
        const gb = g ? g(Rb, Zb) : 0;
        // points: B (s = hb, value g; idx −1), interior nodes s = 0, −h, −2h
        const xs: number[] = [hb], idx: number[] = [-1];
        const useI = hb >= 0.3 * h;
        for (let m = 0; m < 3 && xs.length < 3; m++) {
          const ii = i1 - m * di, jj = j1 - m * dj;
          if (!inGrid(ii, jj) || kind[jj * NR + ii] === 0) break;
          if (!useI && m === 0) continue; // B ≈ I: skip I to avoid ill-conditioning
          xs.push(-m * h); idx.push(jj * NR + ii);
        }
        if (xs.length < 2) { xs.push(0); idx.push(k1); }
        const wv = lagW(xs, h);
        for (let a = 0; a < xs.length; a++) {
          if (idx[a] < 0) cSum += wv[a] * gb; else term(idx[a], wv[a]);
        }
        nDir++;
      }
      endNode(k);
    }
    commit(2);
    // layers 2…EXT_LAYERS: quadratic (or linear) extrapolation along grid lines from known nodes
    const W3 = [3, -3, 1], W2 = [2, -1];
    for (let layer = 2; layer <= EXT_LAYERS; layer++) {
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
        const k = j * NR + i;
        if (known[k]) continue;
        for (const [di, dj] of dirs) {
          let np = 0;
          const p3 = [0, 0, 0];
          for (let m = 1; m <= 3; m++) {
            const ii = i - m * di, jj = j - m * dj;
            if (!inGrid(ii, jj) || !known[jj * NR + ii]) break;
            p3[np++] = jj * NR + ii;
          }
          const w = np === 3 ? W3 : np === 2 ? W2 : null;
          if (!w) continue;
          for (let m = 0; m < np; m++) term(p3[m], w[m]);
          nDir++;
        }
        endNode(k);
      }
      if (commit(3).length === 0) break;
    }
    // remaining nodes: layer-by-layer mean of known neighbours, then Jacobi sweeps
    const free: number[] = [];
    for (;;) {
      for (let k = 0; k < N; k++) {
        if (known[k]) continue;
        const i = k % NR, j = (k - i) / NR;
        for (const [di, dj] of dirs) {
          const ii = i + di, jj = j + dj;
          if (inGrid(ii, jj) && known[jj * NR + ii]) { term(jj * NR + ii, 1); nDir++; }
        }
        endNode(k);
      }
      const done = commit(4);
      if (done.length === 0) break;
      for (const k of done) free.push(k);
    }
    free.sort((x, y) => x - y);
    const nF = free.length;
    const jNb = new Int32Array(4 * nF), jW = new Float64Array(4 * nF);
    const dR2 = 1 / (this.dR * this.dR), dZ2 = 1 / (this.dZ * this.dZ), D = 2 * dR2 + 2 * dZ2;
    for (let q = 0; q < nF; q++) {
      const k = free[q], i = k % NR, j = (k - i) / NR;
      const R = this.R(i), a = 1 / (2 * R * this.dR);
      jNb[4 * q] = i > 0 ? k - 1 : k + 1; jW[4 * q] = (dR2 + a) / D;
      jNb[4 * q + 1] = i < NR - 1 ? k + 1 : k - 1; jW[4 * q + 1] = (dR2 - a) / D;
      jNb[4 * q + 2] = j > 0 ? k - NR : k + NR; jW[4 * q + 2] = dZ2 / D;
      jNb[4 * q + 3] = j < NZ - 1 ? k + NR : k - NR; jW[4 * q + 3] = dZ2 / D;
    }
    return {
      tgt: Int32Array.from(tgt), start: Int32Array.from(start), src: Int32Array.from(src), w: Float64Array.from(wts),
      cst: g ? Float64Array.from(cst) : null,
      free: Int32Array.from(free), jNb, jW, tmp: new Float64Array(nF),
    };
  }

  bicubic(psi: Float64Array): Bicubic {
    return new Bicubic(psi, this.NR, this.NZ, this.Rmin, this.Zmin, this.dR, this.dZ);
  }
}

// ------------------------------------------------------------------------------------ profiles

export interface ShapeProfileSpec {
  kind: 'shape';
  /** exponent of ψ_N */
  alphaM: number;
  /** exponent of (1 − ψ_N^αm); 0 gives constant p' and FF' (Solov'ev) */
  alphaN: number;
  /** target β_p (β0 is then solved for) or a fixed β0 (> 1 allowed: FF' < 0) */
  betaP?: number;
  beta0?: number;
}
export interface TableProfileSpec {
  kind: 'table';
  /** ψ_N nodes (0…1, strictly increasing) */
  psiN: ArrayLike<number>;
  /** pressure p(ψ_N) [Pa] */
  p: ArrayLike<number>;
  /** enclosed toroidal current I(ψ_N) [A]; I(0) = 0, I(1) ≈ I_p */
  I?: ArrayLike<number>;
  /**
   * flux-surface averaged ⟨j_φ/R⟩(ψ_N) [A/m³] — used instead of I when given:
   * FF' = μ0(c⟨j_φ/R⟩ − p')/⟨R⁻²⟩ depends only weakly on the iterate (well conditioned like an
   * FF'-prescribed problem; no dI/dψ_N ÷ dV/dψ_N feedback as in the I(ψ_N) form).
   */
  jR?: ArrayLike<number>;
}
export type ProfileSpec = ShapeProfileSpec | TableProfileSpec;

export interface EquilibriumOptions {
  Ip: number; // A (> 0)
  B0: number; // T (> 0), vacuum field at the geometric centre R0 = geom.R
  profile: ProfileSpec;
  maxIter?: number;
  tol?: number;
  /** maximum mixing factor ω ∈ (0, 1] (default 1); halved whenever the residual grows */
  relax?: number;
  /** fixed-point acceleration (default 'anderson'; 'none' = damped Picard) */
  acceleration?: 'anderson' | 'none';
  /** Anderson depth m (default 4) */
  andersonDepth?: number;
  /** number of output flux surfaces and poloidal resolution */
  nSurf?: number;
  nTheta?: number;
  /** previous solution on the same grid (warm start) */
  psiInit?: Float64Array;
  /** diagnostics: called every Picard iteration with (iteration, residual, ψ_axis) */
  onIter?: (it: number, resid: number, psiAxis: number) => void;
}

/** Flux-surface tables (on the ψ_N grid, axis included) */
export interface EqProfiles {
  psiN: Float64Array;
  rhoTor: Float64Array; // √(Φ/Φ_b)
  q: Float64Array;
  F: Float64Array;
  p: Float64Array;
  FFp: Float64Array; // FF' [T²m²/(Wb/rad)]
  pp: Float64Array; // p' = dp/dψ [Pa/(Wb/rad)]
  V: Float64Array;
  dVdpsiN: Float64Array;
  area: Float64Array;
  Ienc: Float64Array;
  avgR2inv: Float64Array;
  avgRinv: Float64Array;
  avgGrad2R2: Float64Array; // ⟨|∇ψ|²/R²⟩
  avgGrad2: Float64Array;
  avgGrad: Float64Array;
  avgB2: Float64Array;
  Bmax: Float64Array;
  Bmin: Float64Array;
  ft: Float64Array;
  Rin: Float64Array; // min R of the surface
  Rout: Float64Array; // max R
  kappa: Float64Array;
  delta: Float64Array;
  Phi: Float64Array; // toroidal flux [Wb]
}

export interface Equilibrium {
  grid: GSGrid;
  psi: Float64Array; // NR·NZ (exterior nodes extrapolated)
  psiAxis: number;
  psiB: number;
  Raxis: number;
  Zaxis: number;
  Ip: number;
  B0: number;
  R0: number;
  prof: EqProfiles;
  surfaces: TracedSurfaces;
  PhiB: number;
  rhoTorB: number; // √(Φ_b/(π B0)) [m]
  // global
  volume: number;
  area: number;
  perimeter: number;
  W_th: number; // (3/2)∫p dV [J]
  pAvg: number; // ⟨p⟩_V [Pa]
  betaT: number; // ratio
  betaP: number;
  betaN: number; // % m T / MA
  li3: number;
  q95: number;
  q0: number;
  qmin: number;
  shafranovShift: number; // R_ax − R_geo [m], R_geo = (R_max + R_min)/2 of the LCFS (= Miller R0)
  iterations: number;
  converged: boolean;
  residual: number;
  /**
   * Force balance of the returned state: ∫|J×B − ∇p| dV / ∫|∇p| dV, with J from the discrete Δ*
   * of the returned ψ and p', FF' the reported profiles. Using J×B − ∇p =
   * −(Δ*ψ + μ0R²p' + FF')∇ψ/(μ0R²), it is Σ|j_h − j(p', FF')| |∇ψ| dA / Σ|p'| R |∇ψ| dA over
   * interior nodes. A consistent equilibrium gives O(Picard tolerance); if p' ≡ 0 the
   * normalisation is ∫|J_φ B_p| dV instead.
   */
  forceBalanceResidual: number;
  /**
   * ∫(J×B)·∇ψ̂ dV / ∫∇p·∇ψ̂ dV (∇ψ̂ = ∇ψ/|∇ψ|): the pressure force the field actually holds
   * relative to the reported pressure. 1 in equilibrium; NaN if p' ≡ 0.
   */
  forceBalanceRatio: number;
  /** shape mode: β0 of the returned state */
  beta0?: number;
  /**
   * shape mode with a β_p target: false when the target is unreachable (it would need a reversed
   * inboard current, β0 > 1/(1 − (R_in/R0)²), or no finite β0); β0 is then held at that limit
   */
  betaPTargetMet?: boolean;
  /** table mode: factor c applied to ⟨j_φ/R⟩ to meet I_p (1 for a self-consistent table) */
  currentScale?: number;
}

/**
 * Magnetic axis: start at the grid maximum, then maximise the bicubic ψ with Newton steps
 * −H⁻¹∇ψ where the Hessian H is negative definite and saddle-free Newton steps |H|⁻¹∇ψ otherwise
 * (|H|: eigenvalues replaced by their magnitudes — an ascent direction for any curvature;
 * Y. N. Dauphin et al., "Identifying and attacking the saddle point problem in high-dimensional
 * non-convex optimization", NeurIPS 2014), with backtracking so that ψ never decreases. A flat or
 * hollow-current core can put a node on a saddle of the spline (∂²ψ/∂Z² > 0 at the grid maximum),
 * where plain Newton would stop on the node below the true maximum.
 */
function findAxis(grid: GSGrid, psi: Float64Array, bi: Bicubic): { R: number; Z: number; psi: number } {
  let kmax = -1, vmax = -Infinity;
  for (let k = 0; k < psi.length; k++) if (grid.kind[k] === 1 && psi[k] > vmax) { vmax = psi[k]; kmax = k; }
  let R = grid.R(kmax % grid.NR), Z = grid.Z(Math.floor(kmax / grid.NR));
  const g = new Float64Array(3), gp = new Float64Array(3), gm = new Float64Array(3), gt = new Float64Array(3);
  const e = 1e-4 * grid.dR, lim = grid.dR;
  bi.evalGrad(R, Z, g);
  for (let it = 0; it < 40; it++) {
    bi.evalGrad(R + e, Z, gp); bi.evalGrad(R - e, Z, gm);
    const hRR = (gp[1] - gm[1]) / (2 * e), hRZ = (gp[2] - gm[2]) / (2 * e);
    bi.evalGrad(R, Z + e, gp); bi.evalGrad(R, Z - e, gm);
    const hZZ = (gp[2] - gm[2]) / (2 * e);
    const det = hRR * hZZ - hRZ * hRZ;
    let dRn: number, dZn: number;
    if (hRR < 0 && det > 0) {
      dRn = -(hZZ * g[1] - hRZ * g[2]) / det; dZn = -(-hRZ * g[1] + hRR * g[2]) / det;
    } else {
      // saddle-free step Σ v_i (v_i·∇ψ)/|λ_i| over the eigenpairs of H
      const m = 0.5 * (hRR + hZZ), d = Math.hypot(0.5 * (hRR - hZZ), hRZ);
      const l1 = m + d, l2 = m - d;
      const floor = 1e-8 * Math.max(Math.abs(l1), Math.abs(l2)) + 1e-300;
      // eigenvector of l1: (hRZ, l1 − hRR) or (l1 − hZZ, hRZ), whichever is better conditioned
      let v1R = hRZ, v1Z = l1 - hRR;
      if (Math.hypot(v1R, v1Z) < Math.hypot(l1 - hZZ, hRZ)) { v1R = l1 - hZZ; v1Z = hRZ; }
      const n1 = Math.hypot(v1R, v1Z);
      if (n1 > 0) { v1R /= n1; v1Z /= n1; } else { v1R = 1; v1Z = 0; }
      const v2R = -v1Z, v2Z = v1R;
      const c1 = (v1R * g[1] + v1Z * g[2]) / Math.max(Math.abs(l1), floor);
      const c2 = (v2R * g[1] + v2Z * g[2]) / Math.max(Math.abs(l2), floor);
      dRn = c1 * v1R + c2 * v2R; dZn = c1 * v1Z + c2 * v2Z;
    }
    dRn = Math.max(-lim, Math.min(lim, dRn)); dZn = Math.max(-lim, Math.min(lim, dZn));
    if (!(Number.isFinite(dRn) && Number.isFinite(dZn))) break;
    // backtracking: ψ must not decrease
    let t = 1;
    for (; t > 1e-6; t *= 0.5) {
      bi.evalGrad(R + t * dRn, Z + t * dZn, gt);
      if (gt[0] >= g[0] - 1e-15 * Math.abs(g[0])) break;
    }
    if (!(t > 1e-6)) break;
    R += t * dRn; Z += t * dZn;
    g.set(gt);
    if (Math.hypot(t * dRn, t * dZn) < 1e-12 * grid.geom.a) break;
  }
  return { R, Z, psi: g[0] };
}

/**
 * Shape function s(x) = (1 − x^αm)^αn and its tail integral T(x) = ∫_x^1 s dσ. T is tabulated
 * once per solve by composite 10-point Gauss–Legendre on 256 equal panels (accumulated from
 * x = 1) and interpolated by cubic Hermite with the exact derivative T' = −s. The β_p controller
 * (grid integral) and the post-processed pressure use this same T, so both β_p paths share one
 * quadrature.
 */
class ShapeTail {
  private static readonly PANELS = 256;
  private readonly T: Float64Array;
  private readonly D: Float64Array;
  constructor(readonly aM: number, readonly aN: number) {
    const n = ShapeTail.PANELS;
    const { x: gx, w: gw } = gaussLegendre(10);
    const T = (this.T = new Float64Array(n + 1)), D = (this.D = new Float64Array(n + 1));
    for (let i = n - 1; i >= 0; i--) {
      const h = 0.5 / n, c = (i + 0.5) / n;
      let s = 0;
      for (let q = 0; q < 10; q++) s += gw[q] * this.s(c + h * gx[q]);
      T[i] = T[i + 1] + s * h;
    }
    for (let i = 0; i <= n; i++) D[i] = -this.s(i / n);
  }
  /** s(x) for x ∈ [0, 1] (s(1) = 1 when αn = 0) */
  s(x: number): number { return Math.pow(Math.max(1 - Math.pow(x, this.aM), 0), this.aN); }
  /** T(x), x clamped to [0, 1] */
  tail(x: number): number {
    const n = ShapeTail.PANELS;
    const u = Math.min(Math.max(x, 0), 1) * n;
    const i = Math.min(Math.floor(u), n - 1), t = u - i, h = 1 / n;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * this.T[i] + (t3 - 2 * t2 + t) * h * this.D[i] + (-2 * t3 + 3 * t2) * this.T[i + 1] + (t3 - t2) * h * this.D[i + 1];
  }
}

/** Options validation: throws GSFailure('bad-input') */
function validateOptions(o: EquilibriumOptions, nGrid: number): void {
  if (!o || typeof o !== 'object') badInput('options missing');
  if (!(finite(o.Ip) && o.Ip > 0)) badInput(`I_p must be a positive finite current (got ${o.Ip})`);
  if (!(finite(o.B0) && o.B0 > 0)) badInput(`B0 must be a positive finite field (got ${o.B0})`);
  if (o.maxIter !== undefined && !(Number.isInteger(o.maxIter) && o.maxIter >= 1)) badInput(`maxIter must be a positive integer (got ${o.maxIter})`);
  if (o.tol !== undefined && !(finite(o.tol) && o.tol > 0)) badInput(`tol must be positive (got ${o.tol})`);
  if (o.relax !== undefined && !(finite(o.relax) && o.relax > 0 && o.relax <= 1)) badInput(`relax must be in (0, 1] (got ${o.relax})`);
  if (o.andersonDepth !== undefined && !(Number.isInteger(o.andersonDepth) && o.andersonDepth >= 0 && o.andersonDepth <= 20)) badInput(`andersonDepth must be an integer in [0, 20] (got ${o.andersonDepth})`);
  if (o.nSurf !== undefined && !(Number.isInteger(o.nSurf) && o.nSurf >= 4)) badInput(`nSurf must be an integer ≥ 4 (got ${o.nSurf})`);
  if (o.nTheta !== undefined && !(Number.isInteger(o.nTheta) && o.nTheta >= 8)) badInput(`nTheta must be an integer ≥ 8 (got ${o.nTheta})`);
  if (o.psiInit !== undefined) {
    if (o.psiInit.length !== nGrid) badInput(`psiInit has ${o.psiInit.length} values, the grid ${nGrid}`);
    for (let k = 0; k < nGrid; k++) if (!Number.isFinite(o.psiInit[k])) badInput('psiInit contains non-finite values');
  }
  const pr = o.profile;
  if (!pr || (pr.kind !== 'shape' && pr.kind !== 'table')) badInput('profile.kind must be "shape" or "table"');
  if (pr.kind === 'shape') {
    if (!(finite(pr.alphaM) && pr.alphaM > 0)) badInput(`alphaM must be positive (got ${pr.alphaM})`);
    if (!(finite(pr.alphaN) && pr.alphaN >= 0)) badInput(`alphaN must be ≥ 0 (got ${pr.alphaN})`);
    if (pr.betaP !== undefined && !(finite(pr.betaP) && pr.betaP >= 0)) badInput(`betaP target must be ≥ 0 (got ${pr.betaP})`);
    if (pr.beta0 !== undefined && !(finite(pr.beta0) && pr.beta0 >= 0)) badInput(`beta0 must be ≥ 0 (got ${pr.beta0})`);
  } else {
    const n = pr.psiN?.length ?? 0;
    if (n < 3) badInput(`table needs at least 3 ψ_N nodes (got ${n})`);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(pr.psiN[i]) || (i > 0 && !(pr.psiN[i] > pr.psiN[i - 1]))) badInput('table ψ_N must be finite and strictly increasing');
    }
    if (!(pr.psiN[0] <= 1e-12 && pr.psiN[n - 1] >= 1 - 1e-12)) badInput('table ψ_N must span [0, 1]');
    const col = (a: ArrayLike<number> | undefined, name: string) => {
      if (a === undefined) return;
      if (a.length !== n) badInput(`table ${name} has ${a.length} values, ψ_N has ${n}`);
      for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) badInput(`table ${name} contains non-finite values`);
    };
    if (!pr.p) badInput('table p missing');
    col(pr.p, 'p'); col(pr.I, 'I'); col(pr.jR, 'jR');
    if (!pr.I && !pr.jR) badInput('table needs I or jR');
  }
}

/** mixing-factor floor after repeated residual growth */
const OMEGA_MIN = 0.1;

export class GSSolver {
  readonly grid: GSGrid;
  readonly shape: { area: number; volume: number; perimeter: number; Rc: number };
  private lamNodes = gaussLegendre(24);
  /** smallest R of the plasma boundary (current-positivity limit of β0) */
  private readonly Rin: number;

  constructor(readonly geom: Geometry, opts: GSGridOptions = {}) {
    this.grid = GSGrid.shared(geom, opts);
    this.shape = shapeIntegrals(this.grid.boundary);
    let Rin = Infinity;
    for (let k = 0; k < 720; k++) Rin = Math.min(Rin, this.grid.boundary.point((2 * Math.PI * k) / 720)[0]);
    this.Rin = Rin;
  }

  /** Output surface levels: ψ_N = (k/(n−1))², k = 1…n−1 (the axis is added separately) */
  private levels(n: number): Float64Array {
    const L = new Float64Array(n - 1);
    for (let k = 1; k < n; k++) L[k - 1] = (k / (n - 1)) ** 2;
    return L;
  }

  /** Upper bound of β0 keeping j_φ ≥ 0 everywhere: β0 R/R0 + (1 − β0) R0/R ≥ 0 for R ≥ R_in. */
  get beta0Max(): number {
    const r = this.Rin / this.geom.R;
    return r < 1 ? 1 / (1 - r * r) : Infinity;
  }

  /**
   * Solve the fixed-boundary equilibrium. Throws GSFailure for invalid options ('bad-input'),
   * a lost plasma ('diverged'), NaN/Inf ('non-finite') or an unreachable plasma current
   * ('current-unreachable'). Not converging within maxIter is not an error: converged = false.
   */
  solve(o: EquilibriumOptions): Equilibrium {
    const grid = this.grid;
    const { NR, NZ } = grid;
    const N = NR * NZ;
    validateOptions(o, N);
    const R0 = this.geom.R;
    const maxIter = o.maxIter ?? 200, tol = o.tol ?? 1e-9, omegaMax = o.relax ?? 1;
    const depth = (o.acceleration ?? 'anderson') === 'anderson' ? (o.andersonDepth ?? 4) : 0;
    const Bpa = (MU0 * o.Ip) / this.shape.perimeter;
    const V = this.shape.volume;
    const dA = grid.dR * grid.dZ;
    const inIdx = grid.interior, Rn = grid.interiorR, nIn = grid.nInside;
    let psi: Float64Array;
    if (o.psiInit) {
      psi = Float64Array.from(o.psiInit);
      for (let k = 0; k < N; k++) if (grid.kind[k] === 2) psi[k] = 0;
    } else psi = grid.solveLinear((R) => -MU0 * R * (o.Ip / this.shape.area));
    const gx = new Float64Array(N); // G(ψ)
    const jphi = new Float64Array(N), jb = new Float64Array(N);
    const prof = o.profile;
    // shape mode state
    const tail = prof.kind === 'shape' ? new ShapeTail(prof.alphaM, prof.alphaN) : null;
    const betaTarget = prof.kind === 'shape' ? prof.betaP : undefined;
    let beta0 = prof.kind === 'shape' ? (prof.beta0 ?? 0.5) : 0;
    let beta0Pinned = false;
    // table mode state
    let ppN: ((x: number) => number) | null = null; // dp/dψ_N
    let IS: Pchip | null = null, JS: Pchip | null = null;
    if (prof.kind === 'table') {
      const pS = new Pchip(prof.psiN, prof.p);
      ppN = (x) => pS.deriv(Math.min(Math.max(x, 0), 1));
      IS = prof.I ? new Pchip(prof.psiN, prof.I) : null;
      JS = prof.jR ? new Pchip(prof.psiN, prof.jR) : null;
    }
    let tabXs: number[] = [], tabA: number[] = [], tabB: number[] = [], cScale = NaN;
    const acc = new AndersonMixer(nIn, depth);
    const xv = new Float64Array(nIn), gv = new Float64Array(nIn);
    let omega = omegaMax, prevResid = Infinity;
    let converged = false, it = 0, resid = NaN;
    for (it = 1; it <= maxIter; it++) {
      grid.extend(psi);
      const bi = grid.bicubic(psi);
      const ax = findAxis(grid, psi, bi);
      const dpsi = ax.psi; // ψ_b = 0
      if (!Number.isFinite(dpsi)) throw new GSFailure('non-finite', 'ψ on the magnetic axis is not finite', it - 1, resid);
      if (!(dpsi > 0)) throw new GSFailure('diverged', 'ψ on the magnetic axis ≤ 0 — the iteration lost the plasma', it - 1, resid);
      if (tail) {
        let I_R = 0, I_1R = 0, Ts = 0;
        for (let u = 0; u < nIn; u++) {
          const k = inIdx[u];
          let x = (dpsi - psi[k]) / dpsi;
          if (!(x < 1)) { jphi[k] = 0; continue; }
          if (x < 0) x = 0;
          const R = Rn[u], sh = tail.s(x);
          I_R += (R / R0) * sh; I_1R += (R0 / R) * sh;
          if (betaTarget !== undefined) Ts += tail.tail(x) * R;
          jphi[k] = sh; // shape only, scaled below
        }
        I_R *= dA; I_1R *= dA; Ts *= dA;
        if (betaTarget !== undefined) {
          // p = (λβ0/R0) Δψ T(ψ_N), λ = I_p/(I_1/R + β0 ΔI) → β_p(β0) = K β0 / (I_1/R + β0 ΔI)
          const K = ((2 * MU0) / (Bpa * Bpa)) * ((o.Ip * dpsi) / (R0 * V)) * 2 * Math.PI * Ts;
          const dI = I_R - I_1R, den = K - betaTarget * dI;
          const b0 = den > 0 ? (betaTarget * I_1R) / den : Infinity;
          const bMax = this.beta0Max;
          beta0Pinned = !(b0 <= bMax);
          beta0 = beta0Pinned ? bMax : b0;
        }
        const lam = o.Ip / (beta0 * I_R + (1 - beta0) * I_1R);
        if (!(Number.isFinite(lam) && lam > 0)) throw new GSFailure('current-unreachable', `shape profile with β0 = ${beta0} carries no net positive current`, it - 1, resid);
        for (let u = 0; u < nIn; u++) {
          const k = inIdx[u];
          if (jphi[k] === 0) continue;
          const R = Rn[u];
          jphi[k] = lam * ((beta0 * R) / R0 + ((1 - beta0) * R0) / R) * jphi[k];
        }
      } else {
        // metrics of the current iterate (coarse trace) → FF'(ψ_N) = c A(ψ_N) + B(ψ_N)
        const tr = traceSurfaces({ bi, psiAxis: dpsi, psiB: 0, Rax: ax.R, Zax: ax.Z }, grid.boundary, this.levels(25), 64, 32);
        const xs: number[] = [0], A: number[] = [], B: number[] = [];
        for (let k = 0; k < tr.psiN.length; k++) {
          const m = surfaceMetrics(tr, k);
          const x = tr.psiN[k];
          const pp = -ppN!(x) / dpsi; // dp/dψ
          // ⟨j_φ/R⟩ from the table, or 2π (dI/dψ_N)/(dV/dψ_N) from I(ψ_N)
          const J = JS ? JS.eval(x) : (2 * Math.PI * IS!.deriv(x)) / (m.dVdpsi * dpsi);
          xs.push(x); A.push((MU0 * J) / m.avgR2inv); B.push((-MU0 * pp) / m.avgR2inv);
        }
        // axis values: linear extrapolation
        const ex = (v: number[]) => v[0] - (v[1] - v[0]) * (xs[1] / (xs[2] - xs[1]));
        A.unshift(ex(A)); B.unshift(ex(B));
        const SA = new CubicSpline(xs, A), SB = new CubicSpline(xs, B);
        let Ia = 0, Ib = 0;
        for (let u = 0; u < nIn; u++) {
          const k = inIdx[u];
          let x = (dpsi - psi[k]) / dpsi;
          if (!(x < 1)) { jphi[k] = 0; jb[k] = 0; continue; }
          if (x < 0) x = 0;
          const R = Rn[u];
          jphi[k] = R * (-ppN!(x) / dpsi) + SB.eval(x) / (MU0 * R);
          jb[k] = SA.eval(x) / (MU0 * R);
          Ia += jphi[k]; Ib += jb[k];
        }
        Ia *= dA; Ib *= dA;
        const c = (o.Ip - Ia) / Ib;
        if (!(Ib > 0 && Number.isFinite(c) && c > 0)) throw new GSFailure('current-unreachable', `table current cannot be normalised to I_p (∫⟨j_φ/R⟩-part = ${Ib.toExponential(3)} A, pressure part = ${Ia.toExponential(3)} A)`, it - 1, resid);
        for (let u = 0; u < nIn; u++) { const k = inIdx[u]; jphi[k] += c * jb[k]; }
        tabXs = xs; tabA = A; tabB = B; cScale = c;
      }
      grid.solveLinear((R, _Z, k) => -MU0 * R * jphi[k], undefined, gx);
      let dmax = 0;
      for (let u = 0; u < nIn; u++) {
        const k = inIdx[u];
        const d = Math.abs(gx[k] - psi[k]);
        if (!(d <= dmax)) {
          if (!Number.isFinite(d)) throw new GSFailure('non-finite', 'ψ became non-finite', it, resid);
          dmax = d;
        }
      }
      resid = dmax / dpsi;
      o.onIter?.(it, resid, dpsi);
      if (resid < tol) { converged = true; break; }
      if (it === maxIter) break;
      if (resid > prevResid) { omega = Math.max(0.5 * omega, OMEGA_MIN); acc.reset(); }
      prevResid = resid;
      for (let u = 0; u < nIn; u++) { const k = inIdx[u]; xv[u] = psi[k]; gv[u] = gx[k]; }
      acc.step(xv, gv, omega);
      for (let u = 0; u < nIn; u++) psi[inIdx[u]] = xv[u];
    }
    const ffpTable = prof.kind === 'table' ? new CubicSpline(tabXs, tabA.map((a, i) => cScale * a + tabB[i])) : null;
    const eq = this.postProcess(gx, o, beta0, tail, ffpTable, ppN, Math.min(it, maxIter), converged, resid);
    if (prof.kind === 'shape') {
      eq.beta0 = beta0;
      if (betaTarget !== undefined) eq.betaPTargetMet = !beta0Pinned;
    } else eq.currentScale = cScale;
    return eq;
  }

  private postProcess(psi: Float64Array, o: EquilibriumOptions, beta0: number, tail: ShapeTail | null, ffpTable: CubicSpline | null,
    ppN: ((x: number) => number) | null, iterations: number, converged: boolean, residual: number): Equilibrium {
    const grid = this.grid;
    const R0 = this.geom.R;
    grid.extend(psi);
    const bi = grid.bicubic(psi);
    const ax = findAxis(grid, psi, bi);
    const dpsi = ax.psi;
    if (!(Number.isFinite(dpsi) && dpsi > 0)) throw new GSFailure('diverged', 'ψ on the magnetic axis ≤ 0 in the final state', iterations, residual);
    const field: PsiField = { bi, psiAxis: dpsi, psiB: 0, Rax: ax.R, Zax: ax.Z };
    const nS = o.nSurf ?? 51;
    const lev = this.levels(nS);
    const tr = traceSurfaces(field, grid.boundary, lev, o.nTheta ?? 128, 64);
    const Fb = R0 * o.B0;
    const n = nS; // axis + levels
    const P: EqProfiles = {
      psiN: new Float64Array(n), rhoTor: new Float64Array(n), q: new Float64Array(n), F: new Float64Array(n), p: new Float64Array(n),
      FFp: new Float64Array(n), pp: new Float64Array(n), V: new Float64Array(n), dVdpsiN: new Float64Array(n), area: new Float64Array(n),
      Ienc: new Float64Array(n), avgR2inv: new Float64Array(n), avgRinv: new Float64Array(n), avgGrad2R2: new Float64Array(n), avgGrad2: new Float64Array(n),
      avgGrad: new Float64Array(n), avgB2: new Float64Array(n), Bmax: new Float64Array(n), Bmin: new Float64Array(n), ft: new Float64Array(n),
      Rin: new Float64Array(n), Rout: new Float64Array(n), kappa: new Float64Array(n), delta: new Float64Array(n), Phi: new Float64Array(n),
    };
    // pressure and FF' profiles (in ψ_N); tailFF(x) = ∫_x^1 FF' dψ_N
    let pOf: (x: number) => number, ffpOf: (x: number) => number, ppOf: (x: number) => number, tailFF: (x: number) => number;
    if (tail) {
      // λ again, from the returned ψ
      let I_R = 0, I_1R = 0;
      const inIdx = grid.interior, Rn = grid.interiorR;
      for (let u = 0; u < grid.nInside; u++) {
        let x = (dpsi - psi[inIdx[u]]) / dpsi;
        if (!(x < 1)) continue;
        if (x < 0) x = 0;
        const R = Rn[u], sh = tail.s(x);
        I_R += (R / R0) * sh; I_1R += (R0 / R) * sh;
      }
      const dA = grid.dR * grid.dZ;
      const lam = o.Ip / ((beta0 * I_R + (1 - beta0) * I_1R) * dA);
      ppOf = (x) => ((lam * beta0) / R0) * tail.s(x);
      ffpOf = (x) => MU0 * lam * (1 - beta0) * R0 * tail.s(x);
      pOf = (x) => ((lam * beta0) / R0) * dpsi * tail.tail(x);
      tailFF = (x) => MU0 * lam * (1 - beta0) * R0 * tail.tail(x);
    } else {
      const pr = o.profile as TableProfileSpec;
      const pS = new Pchip(pr.psiN, pr.p);
      const S = ffpTable!, S1 = S.integral(1);
      pOf = (x) => Math.max(pS.eval(Math.min(Math.max(x, 0), 1)), 0);
      ppOf = (x) => -ppN!(x) / dpsi;
      ffpOf = (x) => S.eval(x);
      tailFF = (x) => S1 - S.integral(Math.min(Math.max(x, 0), 1));
    }
    // F(ψ_N): F² = F_b² + 2∫_{ψ_b}^{ψ} FF' dψ = F_b² + 2Δψ ∫_x^1 FF'(s) ds
    const Fof = (x: number) => Math.sqrt(Math.max(Fb * Fb + 2 * dpsi * tailFF(x), 1e-6 * Fb * Fb));
    // axis values
    const Fax = Fof(0);
    P.psiN[0] = 0; P.F[0] = Fax; P.p[0] = pOf(0); P.FFp[0] = ffpOf(0); P.pp[0] = ppOf(0);
    P.avgR2inv[0] = 1 / (ax.R * ax.R); P.avgRinv[0] = 1 / ax.R; P.avgB2[0] = (Fax / ax.R) ** 2;
    P.Bmax[0] = P.Bmin[0] = Fax / ax.R; P.ft[0] = 0; P.Rin[0] = P.Rout[0] = ax.R;
    for (let k = 0; k < lev.length; k++) {
      const i = k + 1;
      const x = lev[k];
      const m = surfaceMetrics(tr, k);
      const F = Fof(x);
      const mag = magneticAverages(tr, k, F, this.lamNodes);
      P.psiN[i] = x; P.F[i] = F; P.p[i] = pOf(x); P.FFp[i] = ffpOf(x); P.pp[i] = ppOf(x);
      P.V[i] = m.V; P.area[i] = m.A; P.dVdpsiN[i] = m.dVdpsi * dpsi; P.Ienc[i] = m.Ienc;
      P.avgR2inv[i] = m.avgR2inv; P.avgRinv[i] = m.avgRinv; P.avgGrad2R2[i] = m.avgGrad2R2; P.avgGrad2[i] = m.avgGrad2; P.avgGrad[i] = m.avgGrad;
      P.avgB2[i] = mag.avgB2; P.Bmax[i] = mag.Bmax; P.Bmin[i] = mag.Bmin; P.ft[i] = mag.ft;
      P.q[i] = (F / (2 * Math.PI)) * m.intDlOverR2Grad;
      P.Rin[i] = m.Rmin; P.Rout[i] = m.Rmax;
      const aS = 0.5 * (m.Rmax - m.Rmin), RgS = 0.5 * (m.Rmax + m.Rmin);
      P.kappa[i] = (m.Zmax - m.Zmin) / (2 * Math.max(aS, 1e-12));
      P.delta[i] = (RgS - 0.5 * (m.RatZmax + m.RatZmin)) / Math.max(aS, 1e-12);
    }
    // axis limits: q, dV/dψ_N by linear extrapolation in ψ_N
    const ex = (a: Float64Array) => a[1] - (a[2] - a[1]) * (P.psiN[1] / (P.psiN[2] - P.psiN[1]));
    P.q[0] = ex(P.q); P.dVdpsiN[0] = Math.max(ex(P.dVdpsiN), 0); P.kappa[0] = ex(P.kappa); P.delta[0] = 0;
    // toroidal flux Φ(ψ_N) = 2π Δψ ∫ q dψ_N
    const qS = new CubicSpline(P.psiN, P.q);
    for (let i = 0; i < n; i++) P.Phi[i] = 2 * Math.PI * dpsi * qS.integral(P.psiN[i]);
    const PhiB = P.Phi[n - 1];
    for (let i = 0; i < n; i++) P.rhoTor[i] = Math.sqrt(Math.max(P.Phi[i] / PhiB, 0));
    // global: ∫p dV and ∫B_p² dV (over ψ_N, dV = (dV/dψ_N) dψ_N)
    const V = P.V[n - 1];
    const pdv = new Float64Array(n), bp2dv = new Float64Array(n);
    for (let i = 0; i < n; i++) { pdv[i] = P.p[i] * P.dVdpsiN[i]; bp2dv[i] = P.avgGrad2R2[i] * P.dVdpsiN[i]; }
    const intP = new CubicSpline(P.psiN, pdv).integral(1);
    const intBp2 = new CubicSpline(P.psiN, bp2dv).integral(1);
    const pAvg = intP / V;
    const Lpol = this.shape.perimeter;
    const Bpa = (MU0 * o.Ip) / Lpol;
    const betaT = (2 * MU0 * pAvg) / (o.B0 * o.B0);
    const betaP = (2 * MU0 * pAvg) / (Bpa * Bpa);
    const betaN = (betaT * 100 * this.geom.a * o.B0) / (o.Ip / 1e6);
    const li3 = (2 * intBp2) / (MU0 * MU0 * o.Ip * o.Ip * R0);
    const q95 = qS.eval(0.95);
    let qmin = Infinity;
    for (let i = 0; i < n; i++) qmin = Math.min(qmin, P.q[i]);
    const fb = this.forceBalance(psi, bi, dpsi, ppOf, ffpOf);
    return {
      grid, psi, psiAxis: dpsi, psiB: 0, Raxis: ax.R, Zaxis: ax.Z, Ip: o.Ip, B0: o.B0, R0,
      prof: P, surfaces: tr, PhiB, rhoTorB: Math.sqrt(PhiB / (Math.PI * o.B0)),
      volume: V, area: P.area[n - 1], perimeter: Lpol, W_th: 1.5 * intP, pAvg, betaT, betaP, betaN, li3,
      q95, q0: P.q[0], qmin, shafranovShift: ax.R - R0,
      iterations, converged, residual,
      forceBalanceResidual: fb.residual, forceBalanceRatio: fb.ratio,
    };
  }

  /** Volume-integrated force balance of (ψ, p', FF') — see Equilibrium.forceBalanceResidual. */
  private forceBalance(psi: Float64Array, bi: Bicubic, dpsi: number, ppOf: (x: number) => number, ffpOf: (x: number) => number): { residual: number; ratio: number } {
    const grid = this.grid, NR = grid.NR;
    const lap = grid.applyOperator(psi);
    const inIdx = grid.interior, Rn = grid.interiorR;
    const g3 = new Float64Array(3);
    let num = 0, denP = 0, denJ = 0, numRatio = 0, denRatio = 0;
    for (let u = 0; u < grid.nInside; u++) {
      const k = inIdx[u];
      let x = (dpsi - psi[k]) / dpsi;
      if (!(x < 1)) continue;
      if (x < 0) x = 0;
      const R = Rn[u], i = k % NR;
      bi.evalGrad(R, grid.Z((k - i) / NR), g3);
      const gp = Math.hypot(g3[1], g3[2]);
      const jh = -lap[k] / (MU0 * R);
      const pp = ppOf(x), jf = ffpOf(x) / (MU0 * R);
      num += Math.abs(jh - (R * pp + jf)) * gp;
      denP += Math.abs(pp) * R * gp;
      denJ += Math.abs(jh) * gp;
      numRatio += (jh - jf) * gp;
      denRatio += pp * R * gp;
    }
    const hasP = denP > 1e-12 * denJ;
    return { residual: hasP ? num / denP : denJ > 0 ? num / denJ : 0, ratio: hasP && denRatio !== 0 ? numRatio / denRatio : NaN };
  }
}
