/**
 * Miller boundary parametrisation (Miller et al., Phys. Plasmas 5 (1998) 973):
 *   R(τ) = R0 + a cos(τ + x_δ sin τ),   Z(τ) = κ a sin τ,   x_δ = arcsin δ.
 * On τ ∈ [0, π] R(τ) falls monotonically (φ = τ + x_δ sin τ is monotone for |δ| < 1), so the points where horizontal
 * and vertical grid lines cut the boundary are found in closed form / by bisection EXACTLY — the only thing the
 * Shortley–Weller boundary discretisation needs. `millerShape` adds the up-down asymmetric form (separate upper and
 * lower triangularity, elongation and squareness, and a vertical shift); polygons, Fourier series and flux contours
 * are in shapes.ts.
 */
import { Geometry } from '../geometry';
import { ShapeError, curveBoundary } from './shapes';

export interface ShapeBoundary {
  readonly R0: number;
  readonly a: number;
  readonly kappa: number;
  readonly delta: number;
  /** crossings [R_inner, R_outer] of the horizontal line at height Z; null if Z is outside the boundary's vertical extent */
  rRange(Z: number): [number, number] | null;
  /** height of the upper boundary at R, Z_top(R) (> 0 for a boundary symmetric about Z = 0); null outside (R_min, R_max) */
  zTop(R: number): number | null;
  /**
   * height of the lower boundary at R (< Z_top(R)); null outside (R_min, R_max). Absent = the boundary is
   * up-down symmetric about Z = 0 (Z_bottom = −Z_top), the only shape the grid handled before v4.
   */
  zBottom?(R: number): number | null;
  /** [Z_min, Z_max] of the boundary; absent = [−κa, κa] */
  readonly zRange?: readonly [number, number];
  /** is (R, Z) strictly inside */
  inside(R: number, Z: number): boolean;
  /** boundary point at parameter τ (period 2π, counter-clockwise) */
  point(tau: number): [number, number];
  /** exact area, volume, perimeter and centroid radius when known in closed form (shapeIntegrals then returns them) */
  integrals?(): { area: number; volume: number; perimeter: number; Rc: number };
}

export function millerBoundary(g: Geometry): ShapeBoundary {
  const { R: R0, a, kappa } = g;
  const delta = Math.max(-0.95, Math.min(0.95, g.delta));
  const xd = Math.asin(delta);
  const Rof = (tau: number) => R0 + a * Math.cos(tau + xd * Math.sin(tau));
  const rRange = (Z: number): [number, number] | null => {
    const s = Z / (kappa * a);
    if (Math.abs(s) >= 1) return null;
    const t1 = Math.asin(s);
    return [Rof(Math.PI - t1), Rof(t1)];
  };
  const zTop = (R: number): number | null => {
    if (R <= R0 - a || R >= R0 + a) return null;
    // R(τ) = R, τ ∈ (0, π): R(τ) falls → bisection (60 steps ≈ machine precision)
    let lo = 0, hi = Math.PI;
    for (let k = 0; k < 60; k++) { const m = 0.5 * (lo + hi); if (Rof(m) > R) lo = m; else hi = m; }
    return kappa * a * Math.sin(0.5 * (lo + hi));
  };
  return {
    R0, a, kappa, delta,
    rRange, zTop,
    inside(R, Z) { const rr = rRange(Z); return !!rr && R > rr[0] && R < rr[1]; },
    point(tau) { return [Rof(tau), kappa * a * Math.sin(tau)]; },
  };
}

/**
 * Up-down asymmetric Miller shape with squareness:
 *   R(θ) = R0 + a cos(θ + arcsin(δ) sin θ),   Z(θ) = Z0 + κ a sin(θ + ζ sin 2θ),
 * the curve of Miller et al. (Phys. Plasmas 5 (1998) 973) with a squareness term ζ sin 2θ in the argument of Z (the form of
 * local-equilibrium codes; this is a convention of this module, its source is not cited because it could not be checked
 * offline, and nothing in the solver depends on it beyond the curve itself). The upper half (sin θ ≥ 0) takes δ_u, κ_u, ζ_u and the
 * lower half δ_l, κ_l, ζ_l, so the curve is continuous with a vertical tangent at the outboard and inboard points. The
 * bounding box is [R0 − a, R0 + a] × [Z0 − κ_l a, Z0 + κ_u a] (ζ does not move it); ζ > 0 pushes the boundary towards the
 * corners of the box (a squarer plasma), ζ < 0 towards a diamond. |arcsin δ| < 1 (|δ| < sin 1 = 0.841: dR/dθ ∝ 1 +
 * arcsin δ cos θ > 0 for R monotone) and |ζ| < 1/2 (dZ/dθ ∝ 1 + 2ζ cos 2θ > 0 for Z monotone) keep R and Z monotone on the
 * four arcs between the extreme points, which the crossings need; a boundary beyond them is refused.
 */
export interface MillerShape {
  /** geometric major radius [m] */
  R0: number;
  /** minor radius [m] */
  a: number;
  /** elongation of both halves (needed unless both kappaUpper and kappaLower are given) */
  kappa?: number;
  kappaUpper?: number;
  kappaLower?: number;
  /** triangularity of both halves (default 0; deltaUpper / deltaLower override it) */
  delta?: number;
  deltaUpper?: number;
  deltaLower?: number;
  /** squareness of both halves (default 0; zetaUpper / zetaLower override it) */
  zeta?: number;
  zetaUpper?: number;
  zetaLower?: number;
  /** height of the geometric centre [m] (default 0) */
  Z0?: number;
}

export function millerShape(p: MillerShape): ShapeBoundary {
  const { R0, a } = p;
  const Z0 = p.Z0 ?? 0;
  const ku = p.kappaUpper ?? p.kappa ?? NaN, kl = p.kappaLower ?? p.kappa ?? NaN;
  const du = p.deltaUpper ?? p.delta ?? 0, dl = p.deltaLower ?? p.delta ?? 0;
  const zu = p.zetaUpper ?? p.zeta ?? 0, zl = p.zetaLower ?? p.zeta ?? 0;
  if (!(Number.isFinite(R0) && Number.isFinite(a) && a > 0 && R0 - a > 0)) throw new ShapeError(`need 0 < a < R0 (R0 = ${R0}, a = ${a})`);
  for (const [name, k] of [['kappa (upper)', ku], ['kappa (lower)', kl]] as const) if (!(Number.isFinite(k) && k > 0)) throw new ShapeError(`${name} must be a positive number (got ${k})`);
  for (const [name, d] of [['delta upper', du], ['delta lower', dl]] as const) if (!(Number.isFinite(d) && Math.abs(d) < Math.sin(1))) throw new ShapeError(`${name} must be in (−sin 1, sin 1) = (−0.841, 0.841), where R along the boundary stays monotone (got ${d})`);
  for (const [name, z] of [['zeta upper', zu], ['zeta lower', zl]] as const) if (!(Number.isFinite(z) && Math.abs(z) < 0.5)) throw new ShapeError(`${name} must be in (−1/2, 1/2) (got ${z})`);
  if (!Number.isFinite(Z0)) throw new ShapeError(`Z0 must be finite (got ${Z0})`);
  const xu = Math.asin(du), xl = Math.asin(dl);
  return curveBoundary((t) => {
    const s = Math.sin(t), up = s >= 0;
    return [R0 + a * Math.cos(t + (up ? xu : xl) * s), Z0 + (up ? ku : kl) * a * Math.sin(t + (up ? zu : zl) * Math.sin(2 * t))];
  });
}

/** Sample the boundary with n points (plots / tests) */
export function boundaryPolygon(b: ShapeBoundary, n = 256): { R: Float64Array; Z: Float64Array } {
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let k = 0; k < n; k++) { const [r, z] = b.point((2 * Math.PI * k) / n); R[k] = r; Z[k] = z; }
  return { R, Z };
}

/** Exact boundary geometry: area, volume (Pappus), perimeter — boundary integrals by Green / the periodic trapezoid rule; the closed form of ShapeBoundary.integrals when it has one */
export function shapeIntegrals(b: ShapeBoundary, n = 2048): { area: number; volume: number; perimeter: number; Rc: number } {
  const exact = b.integrals?.();
  if (exact) return exact;
  // A = ∮ R dZ ; V = 2π ∮ R²/2 dZ (Green); perimeter = ∮ dl  (periodic trapezoid — spectral accuracy)
  let A = 0, V = 0, L = 0;
  const h = (2 * Math.PI) / n, e = 1e-6;
  for (let k = 0; k < n; k++) {
    const t = k * h;
    const [R, Z] = b.point(t);
    const [Rp, Zp] = b.point(t + e), [Rm, Zm] = b.point(t - e);
    const dR = (Rp - Rm) / (2 * e), dZ = (Zp - Zm) / (2 * e);
    A += R * dZ * h;
    V += Math.PI * R * R * dZ * h;
    L += Math.hypot(dR, dZ) * h;
  }
  return { area: A, volume: V, perimeter: L, Rc: V / (2 * Math.PI * A) };
}
