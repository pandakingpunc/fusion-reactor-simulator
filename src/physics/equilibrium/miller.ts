/**
 * Miller sınır parametrizasyonu (Miller et al., Phys. Plasmas 5 (1998) 973):
 *   R(τ) = R0 + a cos(τ + x_δ sin τ),   Z(τ) = κ a sin τ,   x_δ = arcsin δ.
 * τ ∈ [0, π] üzerinde R(τ) monoton azalır (|δ| < 1 için φ = τ + x_δ sin τ monoton), bu yüzden
 * yatay ve dikey ızgara çizgilerinin sınırı kestiği noktalar kapalı formda / ikiye bölmeyle
 * TAM bulunur — Shortley–Weller sınır ayrıklaştırmasının ihtiyaç duyduğu tek bilgi budur.
 */
import { Geometry } from '../geometry';

export interface ShapeBoundary {
  readonly R0: number;
  readonly a: number;
  readonly kappa: number;
  readonly delta: number;
  /** Z yüksekliğindeki yatay çizginin sınır kesişimleri [R_iç, R_dış]; |Z| ≥ κa ise null */
  rRange(Z: number): [number, number] | null;
  /** R konumundaki dikey çizginin üst sınır yüksekliği Z_üst(R) (> 0); dışarıdaysa null */
  zTop(R: number): number | null;
  /** (R, Z) sınırın kesin içinde mi */
  inside(R: number, Z: number): boolean;
  /** Parametrik sınır noktası */
  point(tau: number): [number, number];
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
    // R(τ) = R, τ ∈ (0, π): R(τ) azalan → ikiye bölme (60 adım ≈ makine hassasiyeti)
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

/** Sınırı n noktayla örnekle (çizim / test) */
export function boundaryPolygon(b: ShapeBoundary, n = 256): { R: Float64Array; Z: Float64Array } {
  const R = new Float64Array(n), Z = new Float64Array(n);
  for (let k = 0; k < n; k++) { const [r, z] = b.point((2 * Math.PI * k) / n); R[k] = r; Z[k] = z; }
  return { R, Z };
}

/** Kesin sınır geometrisi: alan, hacim (Pappus), çevre — Gauss–Legendre/trapez ile sınır integrali */
export function shapeIntegrals(b: ShapeBoundary, n = 2048): { area: number; volume: number; perimeter: number; Rc: number } {
  // A = ∮ R dZ ; V = 2π ∮ R²/2 dZ (Green); çevre = ∮ dl  (periyodik trapez — spektral doğruluk)
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
