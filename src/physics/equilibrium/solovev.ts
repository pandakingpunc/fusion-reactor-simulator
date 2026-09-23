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

/** x^p (ln x)^r teriminin x'e göre k'ıncı türevi (k ≤ 2), r ∈ {0,1} */
function dxTerm(p: number, r: number, x: number, k: number): number {
  const lx = Math.log(x);
  const pw = (e: number) => (e === 0 ? 1 : Math.pow(x, e));
  if (r === 0) {
    if (k === 0) return pw(p);
    if (k === 1) return p === 0 ? 0 : p * pw(p - 1);
    return p < 2 ? 0 : p * (p - 1) * pw(p - 2);
  }
  // f = x^p ln x
  if (k === 0) return pw(p) * lx;
  if (k === 1) return p * pw(p - 1) * lx + pw(p - 1);
  return p * (p - 1) * pw(p - 2) * lx + (2 * p - 1) * pw(p - 2);
}
function dyTerm(q: number, y: number, k: number): number {
  if (k === 0) return q === 0 ? 1 : Math.pow(y, q);
  if (k === 1) return q === 0 ? 0 : q * (q === 1 ? 1 : Math.pow(y, q - 1));
  return q < 2 ? 0 : q * (q - 1) * (q === 2 ? 1 : Math.pow(y, q - 2));
}
/** Terim listesinin (kx, ky) karışık türevi */
function evalTerms(terms: Term[], x: number, y: number, kx: number, ky: number): number {
  let s = 0;
  for (const [c, p, q, r] of terms) s += c * dxTerm(p, r, x, kx) * dyTerm(q, y, ky);
  return s;
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
  }

  /** Normalize ψ̄ ve türevleri: kx, ky ≤ 2 */
  psiBar(x: number, y: number, kx = 0, ky = 0): number {
    let s = evalTerms(this.part, x, y, kx, ky);
    for (let i = 0; i < this.terms.length; i++) s += this.coeffs[i] * evalTerms(this.terms[i], x, y, kx, ky);
    return s;
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
