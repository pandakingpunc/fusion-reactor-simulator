/**
 * PLASMA BOUNDARY SHAPES beyond the up-down symmetric Miller curve.
 *
 * The fixed-boundary Grad–Shafranov solver (gs.ts) needs a boundary only through the four questions of the
 * ShapeBoundary interface (miller.ts): where a horizontal line crosses it (rRange), where a vertical line crosses it
 * (zTop, zBottom), whether a point is inside, and a parametrisation for integrals and plots. Shortley–Weller
 * needs the crossings exactly, so they are not sampled: the closed counter-clockwise curve R(t), Z(t) is split at the
 * extremes of R and of Z into four arcs on which R or Z is monotone, and each crossing is one bisection of the
 * parameter on the right arc (60 halvings, to machine precision of t).
 *
 * Every shape that is convex enough for that — each horizontal and vertical line cuts the curve at most twice, the
 * requirement gs.ts already has — goes through `curveBoundary`: a polygon (an imported LCFS), a Fourier series, the
 * asymmetric Miller curve (miller.ts) and the ψ = const contour of a flux map.
 */
import type { Geometry } from '../geometry';
import type { ShapeBoundary } from './miller';

const TWO_PI = 2 * Math.PI;

/** point (R, Z) of a closed curve at parameter t; periodic with period 2π */
export type CurvePoint = (t: number) => [number, number];

/** a bad boundary description (too few points, not finite, not convex enough) */
export class ShapeError extends Error {
  constructor(message: string) {
    super(`plasma boundary: ${message}`);
    this.name = 'ShapeError';
  }
}

const wrap = (t: number): number => {
  const u = t % TWO_PI;
  return u < 0 ? u + TWO_PI : u;
};

/** maximiser of f on [lo, hi] by golden-section search (f unimodal there; a polygon's maximum is a vertex) */
function goldenMax(f: (t: number) => number, lo: number, hi: number): number {
  const g = 0.5 * (Math.sqrt(5) - 1);
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let it = 0; it < 80; it++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return 0.5 * (a + b);
}

export interface CurveBoundaryOptions {
  /** samples used to locate the extremes and to check the convexity (default 2048) */
  samples?: number;
  /** exact area, volume, perimeter and centroid radius, if the curve has them in closed form (shapeIntegrals uses them) */
  integrals?: () => { area: number; volume: number; perimeter: number; Rc: number };
}

/**
 * ShapeBoundary of a closed curve given by a parametrisation. The curve may run in either sense (it is
 * re-oriented counter-clockwise: `point` returns the counter-clockwise curve) and starts anywhere. R0, a, κ and δ are
 * those of its bounding box and extreme points: R0 = (R_max + R_min)/2, a = (R_max − R_min)/2, κ = (Z_max − Z_min)/(2a),
 * δ = the mean of the upper and lower triangularity (R0 − R at Z_max)/a and (R0 − R at Z_min)/a.
 * Throws ShapeError for a curve that is not finite or that a horizontal or vertical line can cut more than twice.
 */
export function curveBoundary(point: CurvePoint, opts: CurveBoundaryOptions = {}): ShapeBoundary {
  const n = opts.samples ?? 2048;
  if (!(Number.isInteger(n) && n >= 16)) throw new ShapeError(`samples must be an integer ≥ 16 (got ${n})`);
  const Rs = new Float64Array(n), Zs = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const [R, Z] = point((TWO_PI * k) / n);
    if (!(Number.isFinite(R) && Number.isFinite(Z))) throw new ShapeError('the curve has non-finite points');
    Rs[k] = R; Zs[k] = Z;
  }
  let area2 = 0;
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; area2 += Rs[k] * Zs[k1] - Rs[k1] * Zs[k]; }
  if (!(Math.abs(area2) > 0)) throw new ShapeError('the curve encloses no area');
  // counter-clockwise curve; the sample indices follow it
  const P: CurvePoint = area2 > 0 ? (t) => point(wrap(t)) : (t) => point(wrap(TWO_PI - t));
  const Rof = (t: number) => P(t)[0], Zof = (t: number) => P(t)[1];
  const Pr = area2 > 0 ? (k: number) => k : (k: number) => (n - k) % n; // ccw sample k ↔ sample index of the input
  const Rc = (k: number) => Rs[Pr((k + n) % n)], Zc = (k: number) => Zs[Pr((k + n) % n)];
  const dt = TWO_PI / n;
  // extremes: coarse from the samples, refined by golden section within ±1 sample
  const extreme = (val: (k: number) => number, f: (t: number) => number): number => {
    let kb = 0;
    for (let k = 1; k < n; k++) if (val(k) > val(kb)) kb = k;
    return goldenMax(f, (kb - 1) * dt, (kb + 1) * dt);
  };
  const tRmax = extreme((k) => Rc(k), (t) => Rof(t));
  const tZmax = extreme((k) => Zc(k), (t) => Zof(t));
  const tRmin = extreme((k) => -Rc(k), (t) => -Rof(t));
  const tZmin = extreme((k) => -Zc(k), (t) => -Zof(t));
  // cyclic order along the counter-clockwise curve: R max → Z max → R min → Z min → R max
  const after = (t: number, ref: number) => { let u = t; while (u < ref) u += TWO_PI; while (u >= ref + TWO_PI) u -= TWO_PI; return u; };
  const t0 = tRmax, t1 = after(tZmax, t0), t2 = after(tRmin, t1), t3 = after(tZmin, t2);
  if (!(t0 <= t1 && t1 <= t2 && t2 <= t3 && t3 <= t0 + TWO_PI)) throw new ShapeError('the extreme points do not follow each other around the curve: the shape is not convex enough');
  const Rmax = Rof(t0), Zmax = Zof(t1), Rmin = Rof(t2), Zmin = Zof(t3);
  // monotone arcs: upper (R falls), lower (R rises), outer (Z rises), inner (Z falls)
  const arcCheck = (f: (t: number) => number, lo: number, hi: number, sign: number, what: string) => {
    const m = Math.max(8, Math.ceil(((hi - lo) / TWO_PI) * n));
    const tol = 1e-9 * (Rmax - Rmin + Zmax - Zmin);
    let prev = f(lo);
    for (let k = 1; k <= m; k++) {
      const v = f(lo + ((hi - lo) * k) / m);
      if (sign * (v - prev) < -tol) throw new ShapeError(`${what} is not monotone: a horizontal or vertical line cuts the shape more than twice`);
      prev = v;
    }
  };
  arcCheck(Rof, t0, t2, -1, 'R along the upper boundary');
  arcCheck(Rof, t2, t0 + TWO_PI, 1, 'R along the lower boundary');
  arcCheck(Zof, t3 - TWO_PI, t1, 1, 'Z along the outboard boundary');
  arcCheck(Zof, t1, t3, -1, 'Z along the inboard boundary');
  /** t on [lo, hi] where the monotone f crosses value; f falls if `falling` */
  const solve = (f: (t: number) => number, value: number, lo: number, hi: number, falling: boolean): number => {
    for (let it = 0; it < 60; it++) {
      const m = 0.5 * (lo + hi);
      if ((f(m) > value) === falling) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  const R0 = 0.5 * (Rmax + Rmin), a = 0.5 * (Rmax - Rmin);
  const kappa = (Zmax - Zmin) / (2 * a);
  const delta = 0.5 * ((R0 - Rof(t1)) / a + (R0 - Rof(t3)) / a);
  return {
    R0, a, kappa, delta,
    zRange: [Zmin, Zmax],
    rRange(Z) {
      if (!(Z > Zmin && Z < Zmax)) return null;
      const tOut = solve(Zof, Z, t3 - TWO_PI, t1, false), tIn = solve(Zof, Z, t1, t3, true);
      return [Rof(tIn), Rof(tOut)];
    },
    zTop(R) {
      if (!(R > Rmin && R < Rmax)) return null;
      return Zof(solve(Rof, R, t0, t2, true));
    },
    zBottom(R) {
      if (!(R > Rmin && R < Rmax)) return null;
      return Zof(solve(Rof, R, t2, t0 + TWO_PI, false));
    },
    inside(R, Z) {
      if (!(Z > Zmin && Z < Zmax)) return false;
      const rr = [Rof(solve(Zof, Z, t1, t3, true)), Rof(solve(Zof, Z, t3 - TWO_PI, t1, false))];
      return R > rr[0] && R < rr[1];
    },
    point: P,
    integrals: opts.integrals,
  };
}

/** The bounding-box description of a boundary as the Geometry of GSSolver / GSGrid */
export function shapeGeometry(b: ShapeBoundary): Geometry {
  return { R: b.R0, a: b.a, kappa: b.kappa, delta: b.delta };
}

// ---------------------------------------------------------------------------------------------- polygon

/**
 * A closed polygon as a ShapeBoundary: the plasma is the polygon (an LCFS from a G-EQDSK file, a traced flux contour).
 * The vertices (R_k, Z_k) run in either sense; a last vertex equal to the first is dropped. The curve is piecewise
 * linear with the vertices at equal steps of the parameter, so the crossings are exact intersections with the edges.
 * Area, volume and perimeter are the exact polygon values: A = ½ Σ (R_k Z_{k+1} − R_{k+1} Z_k),
 * V = π Σ (R_k² + R_k R_{k+1} + R_{k+1}²) ΔZ_k / 3 (Pappus / Green on straight edges), L = Σ |edge|.
 */
export function polygonBoundary(Rv: ArrayLike<number>, Zv: ArrayLike<number>): ShapeBoundary {
  if (Rv.length !== Zv.length) throw new ShapeError(`the polygon has ${Rv.length} R and ${Zv.length} Z values`);
  let m = Rv.length;
  if (m >= 2 && Rv[0] === Rv[m - 1] && Zv[0] === Zv[m - 1]) m -= 1;
  if (m < 4) throw new ShapeError(`a polygon needs at least 4 distinct vertices (got ${m})`);
  let s2 = 0;
  for (let k = 0; k < m; k++) {
    if (!(Number.isFinite(Rv[k]) && Number.isFinite(Zv[k]))) throw new ShapeError('the polygon has non-finite vertices');
    const k1 = (k + 1) % m;
    s2 += Rv[k] * Zv[k1] - Rv[k1] * Zv[k];
  }
  if (!(Math.abs(s2) > 0)) throw new ShapeError('the polygon encloses no area');
  const R = new Float64Array(m), Z = new Float64Array(m);
  for (let k = 0; k < m; k++) { const src = s2 > 0 ? k : m - 1 - k; R[k] = Rv[src]; Z[k] = Zv[src]; }
  const point: CurvePoint = (t) => {
    const u = (wrap(t) / TWO_PI) * m;
    const i = Math.min(Math.floor(u), m - 1), f = u - i, j = (i + 1) % m;
    return [R[i] + f * (R[j] - R[i]), Z[i] + f * (Z[j] - Z[i])];
  };
  const integrals = () => {
    let A = 0, V = 0, L = 0;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m, dZ = Z[j] - Z[k];
      A += 0.5 * (R[k] * Z[j] - R[j] * Z[k]);
      V += (Math.PI * (R[k] * R[k] + R[k] * R[j] + R[j] * R[j]) * dZ) / 3;
      L += Math.hypot(R[j] - R[k], dZ);
    }
    return { area: A, volume: V, perimeter: L, Rc: V / (2 * Math.PI * A) };
  };
  return curveBoundary(point, { samples: Math.max(2048, 8 * m), integrals });
}

// ------------------------------------------------------------------------------------------------ Fourier

/** cosine and sine coefficients of one coordinate, m = 0, 1, …: Σ c[m] cos(m t) + s[m] sin(m t) (s[0] is unused) */
export interface FourierSeries {
  c?: ArrayLike<number>;
  s?: ArrayLike<number>;
}

const evalSeries = (f: FourierSeries, t: number): number => {
  let v = 0;
  if (f.c) for (let m = 0; m < f.c.length; m++) v += f.c[m] * Math.cos(m * t);
  if (f.s) for (let m = 1; m < f.s.length; m++) v += f.s[m] * Math.sin(m * t);
  return v;
};

/**
 * A boundary from a Fourier series: R(t) = Σ_m R.c[m] cos(mt) + R.s[m] sin(mt), likewise Z(t). R.c[0] is the centre
 * radius and Z.c[0] the height of the centre; an ellipse is R.c = [R0, a], Z.s = [0, κa]; triangularity, squareness and
 * up-down asymmetry are the higher harmonics (to lowest order R.c[2] ≈ a arcsin(δ)/2 and Z.s[3] ≈ κ a ζ/2 for the
 * Miller curve of miller.ts).
 * A curve has to be convex enough for ShapeBoundary (see curveBoundary); the series itself is not checked.
 */
export function fourierBoundary(R: FourierSeries, Z: FourierSeries, opts: CurveBoundaryOptions = {}): ShapeBoundary {
  return curveBoundary((t) => [evalSeries(R, t), evalSeries(Z, t)], opts);
}

/**
 * Fourier coefficients (c[0..M], s[0..M]) of the closed curve `point`, by the trapezoid rule on n equal steps of t
 * (spectrally accurate for a smooth periodic curve): c_0 = mean, c_m = (2/n) Σ f cos(m t_k), s_m = (2/n) Σ f sin(m t_k).
 */
export function fourierCoefficients(point: CurvePoint, M: number, n = 1024): { R: { c: Float64Array; s: Float64Array }; Z: { c: Float64Array; s: Float64Array } } {
  if (!(Number.isInteger(M) && M >= 1 && n > 2 * M)) throw new ShapeError(`need an integer M ≥ 1 and more than 2M samples (M = ${M}, n = ${n})`);
  const out = { R: { c: new Float64Array(M + 1), s: new Float64Array(M + 1) }, Z: { c: new Float64Array(M + 1), s: new Float64Array(M + 1) } };
  for (let k = 0; k < n; k++) {
    const t = (TWO_PI * k) / n;
    const [R, Z] = point(t);
    for (let m = 0; m <= M; m++) {
      const cs = Math.cos(m * t), sn = Math.sin(m * t);
      out.R.c[m] += R * cs; out.R.s[m] += R * sn;
      out.Z.c[m] += Z * cs; out.Z.s[m] += Z * sn;
    }
  }
  for (const q of [out.R, out.Z]) {
    q.c[0] /= n; q.s[0] = 0;
    for (let m = 1; m <= M; m++) { q.c[m] *= 2 / n; q.s[m] *= 2 / n; }
  }
  return out;
}

// ----------------------------------------------------------------------------------------- flux contour

/**
 * The ψ = `level` contour of a flux map around a magnetic axis as a polygon boundary: along `n` rays from the axis
 * the first crossing of the level (found by a scan of `rayMax`/400 steps and 60 bisections), so ψ − level must change
 * sign once from the axis outwards (nested surfaces, the contour star-shaped about the axis). This is the boundary of
 * an imported equilibrium whose file has no usable boundary, or one drawn inside a separatrix (`boundaryPsi` of the
 * G-EQDSK reader) where the X-point makes ψ_N = 1 singular. Throws ShapeError when a ray does not reach the level.
 */
export function contourBoundary(psi: (R: number, Z: number) => number, axis: readonly [number, number], level: number, rayMax: number, n = 256): ShapeBoundary {
  if (!(Number.isInteger(n) && n >= 16)) throw new ShapeError(`the contour needs an integer number of rays ≥ 16 (got ${n})`);
  const [Ra, Za] = axis;
  const sgn = psi(Ra, Za) > level ? 1 : -1;
  const h = (s: number, c: number, sn: number) => sgn * (psi(Ra + s * c, Za + s * sn) - level);
  const Rv = new Float64Array(n), Zv = new Float64Array(n);
  const steps = 400;
  for (let j = 0; j < n; j++) {
    const th = (TWO_PI * j) / n, c = Math.cos(th), sn = Math.sin(th);
    let lo = 0, hi = -1;
    for (let k = 1; k <= steps; k++) {
      const s = (rayMax * k) / steps;
      if (h(s, c, sn) <= 0) { hi = s; lo = (rayMax * (k - 1)) / steps; break; }
    }
    if (hi < 0) throw new ShapeError(`the ray at ${((th * 180) / Math.PI).toFixed(1)}° does not reach the level ψ = ${level} within ${rayMax} m of the axis`);
    for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (h(m, c, sn) > 0) lo = m; else hi = m; }
    const s = 0.5 * (lo + hi);
    Rv[j] = Ra + s * c; Zv[j] = Za + s * sn;
  }
  return polygonBoundary(Rv, Zv);
}
