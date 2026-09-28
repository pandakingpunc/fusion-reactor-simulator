/**
 * ANALİTİK SOLOV'EV DENGELERİ — Cerfon & Freidberg, "One size fits all" analytic solutions
 * to the Grad–Shafranov equation, Phys. Plasmas 17 (2010) 032502.
 *
 * Normalize koordinatlar x = R/R0, y = Z/R0; normalize GS denklemi
 *   x ∂/∂x( (1/x) ∂ψ̄/∂x ) + ∂²ψ̄/∂y² = (1 − A) x² + A          (p', FF' sabit)
 * Genel çözüm: ψ̄ = ψ_p + Σ c_i ψ_i ; ψ_p = x⁴/8 + A(x² ln x /2 − x⁴/8),
 * ψ_1..ψ_7 çift (yukarı-aşağı simetrik), ψ_8..ψ_12 tek (X-noktalı tek-null) homojen çözümler.
 * c_i katsayıları sınır üzerindeki nokta/eğim/eğrilik koşullarından lineer sistemle bulunur
 * (simetrik: 7×7, tek-null: 12×12). Her homojen çözümün Δ*ψ_i = 0 sağladığı birim testle
 * sayısal olarak doğrulanır.
 *
 * Fiziksel ölçek (bu koddaki işaret kuralı: plazma içinde ψ > 0, eksende maksimum):
 *   ψ(R,Z) = −Ψ0 ψ̄(R/R0, Z/R0),  μ0 p' = Ψ0 (1−A)/R0⁴,  FF' = Ψ0 A/R0²  (Δ*ψ = −μ0R²p' − FF').
 * Ψ0 plazma akımından: I_p = ∫ j_φ dA, j_φ = R p' + FF'/(μ0 R) — Ψ0'a doğrusal.
 */
import { solveDense } from '../numerics/linalg';
import { ShapeBoundary } from './miller';

const MU0 = 1.25663706212e-6;

/** Terim: coef · x^p · y^q · (ln x)^r */
type Term = [number, number, number, number];

const HOMOGENEOUS: Term[][] = [
  [[1, 0, 0, 0]], // ψ1 = 1
  [[1, 2, 0, 0]], // ψ2 = x²
  [[1, 0, 2, 0], [-1, 2, 0, 1]], // ψ3 = y² − x² ln x
  [[1, 4, 0, 0], [-4, 2, 2, 0]], // ψ4 = x⁴ − 4x²y²
  [[2, 0, 4, 0], [-9, 2, 2, 0], [3, 4, 0, 1], [-12, 2, 2, 1]], // ψ5
  [[1, 6, 0, 0], [-12, 4, 2, 0], [8, 2, 4, 0]], // ψ6
  [[8, 0, 6, 0], [-140, 2, 4, 0], [75, 4, 2, 0], [-15, 6, 0, 1], [180, 4, 2, 1], [-120, 2, 4, 1]], // ψ7
  [[1, 0, 1, 0]], // ψ8 = y
  [[1, 2, 1, 0]], // ψ9 = y x²
  [[1, 0, 3, 0], [-3, 2, 1, 1]], // ψ10 = y³ − 3 y x² ln x
  [[3, 4, 1, 0], [-4, 2, 3, 0]], // ψ11 = 3 y x⁴ − 4 y³ x²
  [[8, 0, 5, 0], [-45, 4, 1, 0], [-80, 2, 3, 1], [60, 4, 1, 1]], // ψ12
];

function particular(A: number): Term[] {
  return [[(1 - A) / 8, 4, 0, 0], [A / 2, 2, 0, 1]];
}

/** x^e for small integer e (e = 0 → 1 exactly) */
function pw(x: number, e: number): number { return e === 0 ? 1 : Math.pow(x, e); }
/** x^p (ln x)^r teriminin x'e göre k'ıncı türevi (k ≤ 2), r ∈ {0,1}; lx = ln x */
function dxTerm(p: number, r: number, x: number, k: number, lx = Math.log(x)): number {
  if (r === 0) {
    if (k === 0) return pw(x, p);
    if (k === 1) return p === 0 ? 0 : p * pw(x, p - 1);
    return p < 2 ? 0 : p * (p - 1) * pw(x, p - 2);
  }
  // f = x^p ln x
  if (k === 0) return pw(x, p) * lx;
  if (k === 1) return p * pw(x, p - 1) * lx + pw(x, p - 1);
  return p * (p - 1) * pw(x, p - 2) * lx + (2 * p - 1) * pw(x, p - 2);
}
function dyTerm(q: number, y: number, k: number): number {
  if (k === 0) return q === 0 ? 1 : Math.pow(y, q);
  if (k === 1) return q === 0 ? 0 : q * (q === 1 ? 1 : Math.pow(y, q - 1));
  return q < 2 ? 0 : q * (q - 1) * (q === 2 ? 1 : Math.pow(y, q - 2));
}
/** Terim listesinin (kx, ky) karışık türevi */
function evalTerms(terms: Term[], x: number, y: number, kx: number, ky: number): number {
  let s = 0;
  const lx = Math.log(x);
  for (const [c, p, q, r] of terms) s += c * dxTerm(p, r, x, kx, lx) * dyTerm(q, y, ky);
  return s;
}

/** c·(terms) summed into one list, equal monomials merged (fast evaluation of ψ̄) */
function combine(parts: [number, Term[]][]): Term[] {
  const acc = new Map<string, Term>();
  for (const [c, terms] of parts) for (const [a, p, q, r] of terms) {
    const key = `${p},${q},${r}`;
    const t = acc.get(key);
    if (t) t[0] += c * a; else acc.set(key, [c * a, p, q, r]);
  }
  return [...acc.values()];
}

export interface SolovevShape {
  epsilon: number; // a/R0
  kappa: number;
  delta: number;
  A: number; // FF' / p' karışım parametresi
  /** tek-null (alt X-noktası) — ψ_8..ψ_12 dahil 12 koşul */
  singleNull?: boolean;
  /** X-noktası konumu (normalize); varsayılan (1 − 1.1 δ ε, −1.1 κ ε) — Cerfon & Freidberg Böl. V */
  xPoint?: [number, number];
}

export class SolovevEquilibrium {
  readonly coeffs: Float64Array;
  private terms: Term[][];
  private part: Term[];
  /** particular + Σ c_i ψ_i as one merged monomial list */
  private flat: Term[];
  constructor(readonly shape: SolovevShape) {
    const { epsilon: e, kappa: k, delta: d, A } = shape;
    const al = Math.asin(d);
    const N1 = -((1 + al) ** 2) / (e * k * k);
    const N2 = ((1 - al) ** 2) / (e * k * k);
    const N3 = -k / (e * Math.cos(al) ** 2);
    const sn = !!shape.singleNull;
    const nC = sn ? 12 : 7;
    this.terms = HOMOGENEOUS.slice(0, nC);
    this.part = particular(A);
    const out: [number, number] = [1 + e, 0], inn: [number, number] = [1 - e, 0], top: [number, number] = [1 - d * e, k * e];
    const xp = shape.xPoint ?? [1 - 1.1 * d * e, -1.1 * k * e];
    // koşul: (nokta, kx, ky, ek terim (katsayı, kx2, ky2))
    type Cond = { pt: [number, number]; kx: number; ky: number; extra?: [number, number, number] };
    const conds: Cond[] = [
      { pt: out, kx: 0, ky: 0 }, { pt: inn, kx: 0, ky: 0 }, { pt: top, kx: 0, ky: 0 },
      { pt: top, kx: 1, ky: 0 },
      { pt: out, kx: 0, ky: 2, extra: [N1, 1, 0] },
      { pt: inn, kx: 0, ky: 2, extra: [N2, 1, 0] },
      { pt: top, kx: 2, ky: 0, extra: [N3, 0, 1] },
    ];
    if (sn) {
      conds.push(
        { pt: xp, kx: 0, ky: 0 }, { pt: xp, kx: 1, ky: 0 }, { pt: xp, kx: 0, ky: 1 },
        { pt: out, kx: 0, ky: 1 }, { pt: inn, kx: 0, ky: 1 },
      );
    }
    const M = new Float64Array(nC * nC), rhs = new Float64Array(nC);
    conds.forEach((c, row) => {
      const apply = (t: Term[]) => {
        let v = evalTerms(t, c.pt[0], c.pt[1], c.kx, c.ky);
        if (c.extra) v += c.extra[0] * evalTerms(t, c.pt[0], c.pt[1], c.extra[1], c.extra[2]);
        return v;
      };
      for (let i = 0; i < nC; i++) M[row * nC + i] = apply(this.terms[i]);
      rhs[row] = -apply(this.part);
    });
    this.coeffs = solveDense(M, rhs, nC);
    this.flat = combine([[1, this.part], ...this.terms.map((t, i): [number, Term[]] => [this.coeffs[i], t])]);
  }

  /** Normalize ψ̄ ve türevleri: kx, ky ≤ 2 */
  psiBar(x: number, y: number, kx = 0, ky = 0): number {
    return evalTerms(this.flat, x, y, kx, ky);
  }
  /** Normalize GS kaynağı (1 − A) x² + A */
  sourceBar(x: number): number { return (1 - this.shape.A) * x * x + this.shape.A; }
}

/**
 * Fiziksel ölçekli Solov'ev dengesi: R0 [m], B0 [T], I_p [A].
 * ψ(R,Z) [Wb/rad], p(ψ) [Pa], F(ψ) [T m]. Ψ0, I_p'den plazma kesiti üzerinde sayısal
 * integral ile belirlenir (ψ̄ < 0 bölgesi = plazma).
 */
export class PhysicalSolovev {
  readonly eq: SolovevEquilibrium;
  readonly Psi0: number;
  readonly pPrime: number; // dp/dψ [Pa/(Wb/rad)]
  readonly FFprime: number; // FF' [T² m² /(Wb/rad)]
  constructor(readonly R0: number, readonly B0: number, readonly Ip: number, shape: SolovevShape, nGrid = 400) {
    this.eq = new SolovevEquilibrium(shape);
    const { epsilon: e, kappa: k, A } = shape;
    // I_1 = ∫ [ (1−A) R/(μ0 R0⁴) + A/(μ0 R0² R) ] dA  (Ψ0 = 1 için), plazma: ψ̄ < 0 ve sınır kutusu içinde
    const xMin = 1 - 1.3 * e, xMax = 1 + 1.3 * e, yMax = 1.4 * k * e;
    const hx = (xMax - xMin) / nGrid, hy = (2 * yMax) / nGrid;
    let I1 = 0;
    for (let j = 0; j < nGrid; j++) {
      const y = -yMax + (j + 0.5) * hy;
      for (let i = 0; i < nGrid; i++) {
        const x = xMin + (i + 0.5) * hx;
        if (!this.inPlasma(x, y)) continue;
        const R = x * R0;
        I1 += ((1 - A) * R / (MU0 * R0 ** 4) + A / (MU0 * R0 * R0 * R)) * (hx * R0) * (hy * R0);
      }
    }
    this.Psi0 = Ip / I1;
    this.pPrime = (this.Psi0 * (1 - A)) / (MU0 * R0 ** 4);
    this.FFprime = (this.Psi0 * A) / (R0 * R0);
  }
  /** Normalize noktada plazma içinde mi: ψ̄ < 0 ve (tek-null'da) X-noktasının üstünde */
  inPlasma(x: number, y: number): boolean {
    const sh = this.eq.shape;
    if (this.eq.psiBar(x, y) >= 0) return false;
    if (sh.singleNull) {
      const xp = sh.xPoint ?? [1 - 1.1 * sh.delta * sh.epsilon, -1.1 * sh.kappa * sh.epsilon];
      if (y < xp[1]) return false;
    }
    return Math.abs(x - 1) < 1.3 * sh.epsilon && Math.abs(y) < 1.4 * sh.kappa * sh.epsilon;
  }
  psi(R: number, Z: number): number { return -this.Psi0 * this.eq.psiBar(R / this.R0, Z / this.R0); }
  /** Δ*ψ (fiziksel) = −(Ψ0/R0²)((1−A)x² + A) */
  source(R: number): number { return -(this.Psi0 / (this.R0 * this.R0)) * this.eq.sourceBar(R / this.R0); }
  /** ∂ψ/∂R, ∂ψ/∂Z */
  grad(R: number, Z: number): [number, number] {
    const x = R / this.R0, y = Z / this.R0, s = -this.Psi0 / this.R0;
    return [s * this.eq.psiBar(x, y, 1, 0), s * this.eq.psiBar(x, y, 0, 1)];
  }
  /** p(ψ) = p' ψ (sınırda ψ = 0) */
  pressure(psi: number): number { return Math.max(this.pPrime * psi, 0); }
  /** F(ψ)² = (R0 B0)² + 2 FF' ψ */
  F(psi: number): number { return Math.sqrt(Math.max((this.R0 * this.B0) ** 2 + 2 * this.FFprime * psi, 1e-12)); }
}

/**
 * The ψ = 0 flux contour of an up-down symmetric Solov'ev equilibrium as a ShapeBoundary
 * (physical units, major radius R0). Cerfon & Freidberg's conditions pin only the outboard,
 * inboard and top points of the Miller shape, so the exact separatrix-free contour differs from
 * the Miller curve by ~1 % of ψ_axis in between; with this boundary the numerical fixed-boundary
 * solver has an exact nonlinear reference solution (constant p' and FF').
 * Crossings are found by bisection to ~1e-15 of the minor radius; the contour must be star-shaped
 * about (R0, 0) and cut by every horizontal/vertical grid line at most twice (true for D shapes).
 */
export function solovevBoundary(eq: SolovevEquilibrium, R0: number): ShapeBoundary {
  if (eq.shape.singleNull) throw new Error('solovevBoundary: only up-down symmetric equilibria');
  const { epsilon: e, kappa: k, delta: d } = eq.shape;
  const f = (x: number, y: number) => eq.psiBar(x, y);
  /** root of g on [lo, hi] (g(lo), g(hi) of opposite sign) */
  const bisect = (g: (t: number) => number, lo: number, hi: number, n = 64) => {
    const sLo = g(lo) < 0;
    for (let it = 0; it < n; it++) {
      const m = 0.5 * (lo + hi);
      if ((g(m) < 0) === sLo) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  const xLo = 1 - 1.02 * e, xHi = 1 + 1.02 * e, yTop = k * e;
  const rRangeN = (y: number): [number, number] | null => {
    if (Math.abs(y) >= yTop) return null;
    // minimum of ψ̄ along the chord (golden section; unimodal inside a nested-surface domain)
    let a = 1 - e, b = 1 + e;
    const gr = 0.5 * (Math.sqrt(5) - 1);
    let c = b - gr * (b - a), dd = a + gr * (b - a), fc = f(c, y), fd = f(dd, y);
    for (let it = 0; it < 60; it++) {
      if (fc < fd) { b = dd; dd = c; fd = fc; c = b - gr * (b - a); fc = f(c, y); }
      else { a = c; c = dd; fc = fd; dd = a + gr * (b - a); fd = f(dd, y); }
    }
    const xm = 0.5 * (a + b);
    if (!(f(xm, y) < 0)) return null;
    return [bisect((x) => f(x, y), xLo, xm), bisect((x) => f(x, y), xm, xHi)];
  };
  const rRange = (Z: number): [number, number] | null => {
    const rr = rRangeN(Z / R0);
    return rr ? [rr[0] * R0, rr[1] * R0] : null;
  };
  const zTop = (R: number): number | null => {
    const x = R / R0;
    if (x <= 1 - e || x >= 1 + e || !(f(x, 0) < 0)) return null;
    return bisect((y) => f(x, y), 0, 1.02 * yTop) * R0;
  };
  const radius = (tau: number) => {
    const c = Math.cos(tau), s = Math.sin(tau);
    const g = (r: number) => f(1 + r * c, r * s);
    // Newton from the Miller radius (fast), bisection as the fallback
    const xm = Math.cos(tau + Math.asin(d) * Math.sin(tau)) * e, ym = k * e * Math.sin(tau);
    let r = Math.hypot(xm, ym);
    for (let it = 0; it < 30; it++) {
      const x = 1 + r * c, y = r * s;
      const dr = eq.psiBar(x, y) / (eq.psiBar(x, y, 1, 0) * c + eq.psiBar(x, y, 0, 1) * s);
      if (!Number.isFinite(dr)) break;
      r -= dr;
      if (Math.abs(dr) < 1e-15 * e) return r;
    }
    return bisect(g, 0, 1.05 * Math.max(1, k) * e);
  };
  return {
    R0, a: e * R0, kappa: k, delta: d,
    rRange, zTop,
    inside(R, Z) {
      const x = R / R0, y = Z / R0;
      return Math.abs(y) < yTop && x > 1 - e && x < 1 + e && f(x, y) < 0;
    },
    point(tau) {
      const r = radius(tau);
      return [R0 * (1 + r * Math.cos(tau)), R0 * r * Math.sin(tau)];
    },
  };
}
