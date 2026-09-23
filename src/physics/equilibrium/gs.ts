/**
 * SAYISAL SABİT-SINIRLI GRAD–SHAFRANOV ÇÖZÜCÜSÜ
 *
 *   Δ*ψ ≡ R ∂/∂R (R⁻¹ ∂ψ/∂R) + ∂²ψ/∂Z² = −μ0 R j_φ ,   j_φ = R p'(ψ) + FF'(ψ)/(μ0 R)
 *
 * Kural: ψ [Wb/rad] plazmada pozitif, manyetik eksende maksimum, sınırda ψ_b = 0;
 * ψ_N = (ψ_ax − ψ)/(ψ_ax − ψ_b) ∈ [0, 1].
 *
 * Ayrıklaştırma: (R, Z) düzenli ızgarasında 5-nokta sonlu fark; plazma sınırı (Miller şekli)
 * ızgara çizgilerini keserken Shortley–Weller eşit olmayan adımlı fark formülleri kullanılır
 * (yerel kesme hatası O(h) sınırda, global yakınsama O(h²) — Shortley & Weller, J. Appl. Phys.
 * 9 (1938) 334). Operatör ψ'den bağımsız → bantlı LU bir kez faktörize edilir; her Picard
 * iterasyonu yalnız bir geri-yerine-koyma (O(N·NR)) maliyetindedir.
 *
 * Doğrusal olmayanlık: Picard iterasyonu (gevşetmeli) — p'(ψ_N), FF'(ψ_N) her adımda önceki
 * ψ'den; akım I_p kısıtı ile genlik normalize edilir.
 *
 * Profil modları:
 *  (a) 'shape': Jeon (2015)/FreeGS tipi  j_φ = λ[β0 R/R0 + (1−β0) R0/R](1 − ψ_N^αm)^αn;
 *      λ ← I_p, β0 ← hedef β_p (sekant/oran güncellemesi).
 *  (b) 'table': taşınımdan p(ψ_N) ve çevrelenen akım I(ψ_N) — FF' akı yüzeyi metriklerinden:
 *      dI/dψ_N = (1/2π)(dV/dψ_N)⟨j_φ/R⟩,  ⟨j_φ/R⟩ = p' + FF'⟨R⁻²⟩/μ0  → FF'.
 */
import { Geometry } from '../geometry';
import { BandedLU } from '../numerics/linalg';
import { Bicubic, CubicSpline, Pchip } from '../numerics/interp';
import { gaussLegendre } from '../numerics/quadrature';
import { ShapeBoundary, millerBoundary, shapeIntegrals } from './miller';
import { PsiField, TracedSurfaces, magneticAverages, surfaceMetrics, traceSurfaces } from './fluxsurface';

const MU0 = 1.25663706212e-6;

export interface GSGridOptions {
  /** R yönünde düğüm sayısı (Z yönü eşit aralığa göre seçilir) */
  NR?: number;
  /** kutu kenar payı (a biriminde) */
  margin?: number;
}

/** Sınır değerleri g(R,Z) (varsayılan 0) */
export type BoundaryValue = (R: number, Z: number) => number;

/**
 * Izgara + Shortley–Weller operatörü. Operatör yalnız geometriye bağlıdır; yapıcıda kurulup
 * faktörize edilir.
 */
export class GSGrid {
  readonly NR: number;
  readonly NZ: number;
  readonly Rmin: number;
  readonly Zmin: number;
  readonly dR: number;
  readonly dZ: number;
  /** 0: dış, 1: iç (bilinmeyen), 2: sınıra yapışık düğüm (değer = g) */
  readonly kind: Int8Array;
  /** her iç düğüm için sınır kesişimleri: yön (W,E,S,N) → katsayı ve kesişim noktası */
  private bcCoef: Float64Array; // 4 per node
  private bcR: Float64Array; private bcZ: Float64Array; // 4 per node
  private lu: BandedLU;
  readonly boundary: ShapeBoundary;
  readonly nInside: number;

  constructor(readonly geom: Geometry, opts: GSGridOptions = {}) {
    const b = (this.boundary = millerBoundary(geom));
    const NR = opts.NR ?? 65;
    const m = opts.margin ?? 0.06;
    const Rlo = geom.R - geom.a * (1 + m), Rhi = geom.R + geom.a * (1 + m);
    const dR = (Rhi - Rlo) / (NR - 1);
    const Zext = geom.kappa * geom.a * (1 + m);
    const NZ = 2 * Math.ceil(Zext / dR) + 1; // tek → Z = 0 düğümü var
    const dZ = (2 * Zext) / (NZ - 1);
    this.NR = NR; this.NZ = NZ; this.Rmin = Rlo; this.Zmin = -Zext; this.dR = dR; this.dZ = dZ;
    const N = NR * NZ;
    const kind = (this.kind = new Int8Array(N));
    const snap = 1e-3;
    let nIn = 0;
    for (let j = 0; j < NZ; j++) {
      const Z = this.Zmin + j * dZ;
      const rr = b.rRange(Z);
      if (!rr) continue;
      for (let i = 0; i < NR; i++) {
        const R = Rlo + i * dR;
        if (R <= rr[0] || R >= rr[1]) continue;
        const zt = b.zTop(R);
        const dh = Math.min(R - rr[0], rr[1] - R) / dR;
        const dv = zt === null ? 0 : (zt - Math.abs(Z)) / dZ;
        if (zt === null || dv <= 0) continue;
        if (dh < snap || dv < snap) { kind[j * NR + i] = 2; continue; }
        kind[j * NR + i] = 1; nIn++;
      }
    }
    this.nInside = nIn;
    this.bcCoef = new Float64Array(4 * N);
    this.bcR = new Float64Array(4 * N); this.bcZ = new Float64Array(4 * N);
    const lu = (this.lu = new BandedLU(N, NR, NR));
    for (let j = 0; j < NZ; j++) {
      const Z = this.Zmin + j * dZ;
      for (let i = 0; i < NR; i++) {
        const k = j * NR + i;
        if (kind[k] !== 1) { lu.set(k, k, 1); continue; }
        const R = Rlo + i * dR;
        const rr = b.rRange(Z)!;
        const zt = b.zTop(R)!;
        // mesafeler (komşu dışarıdaysa sınır kesişimine)
        const outW = kind[k - 1] === 0, outE = kind[k + 1] === 0, outS = kind[k - NR] === 0, outN = kind[k + NR] === 0;
        const h1 = outW ? R - rr[0] : dR, h2 = outE ? rr[1] - R : dR;
        const k1 = outS ? Z + zt : dZ, k2 = outN ? zt - Z : dZ;
        const den = h1 * h2 * (h1 + h2);
        const cE = (2 * h1 - (h1 * h1) / R) / den;
        const cW = (2 * h2 + (h2 * h2) / R) / den;
        const cN = 2 / (k2 * (k1 + k2)), cS = 2 / (k1 * (k1 + k2));
        const cC = (-2 * (h1 + h2) + (h1 * h1 - h2 * h2) / R) / den - 2 / (k1 * k2);
        lu.set(k, k, cC);
        const put = (dir: number, nb: number, c: number, out: boolean, Rb: number, Zb: number) => {
          if (out) { this.bcCoef[4 * k + dir] = c; this.bcR[4 * k + dir] = Rb; this.bcZ[4 * k + dir] = Zb; }
          else lu.set(k, nb, c);
        };
        put(0, k - 1, cW, outW, rr[0], Z);
        put(1, k + 1, cE, outE, rr[1], Z);
        put(2, k - NR, cS, outS, R, -zt);
        put(3, k + NR, cN, outN, R, zt);
      }
    }
    lu.factor();
  }

  /** extend(): kuadratik ekstrapolasyon katman sayısı (1. katmandan sonra); kalanlar harmonik dolgu.
   *  Tüm katmanların ekstrapolasyonu sınırdaki |∇ψ| hatasını ~%3'ten ~%0.2'ye indirir (NR=65). */
  extLayers = 64;

  R(i: number): number { return this.Rmin + i * this.dR; }
  Z(j: number): number { return this.Zmin + j * this.dZ; }

  /**
   * Δ*ψ = S(R, Z) doğrusal çözümü; sınır değeri g. S yalnız iç düğümlerde çağrılır.
   * out: NR·NZ (dış düğümler 0 ile doldurulur — interpolasyon için sonradan extend edilir).
   */
  solveLinear(S: (R: number, Z: number, k: number) => number, g: BoundaryValue = () => 0, out: Float64Array = new Float64Array(this.NR * this.NZ)): Float64Array {
    const { NR, NZ, kind } = this;
    for (let j = 0; j < NZ; j++) {
      const Z = this.Z(j);
      for (let i = 0; i < NR; i++) {
        const k = j * NR + i;
        const R = this.R(i);
        if (kind[k] === 0) { out[k] = 0; continue; }
        if (kind[k] === 2) { out[k] = g(R, Z); continue; }
        let rhs = S(R, Z, k);
        for (let d = 0; d < 4; d++) {
          const c = this.bcCoef[4 * k + d];
          if (c !== 0) rhs -= c * g(this.bcR[4 * k + d], this.bcZ[4 * k + d]);
        }
        out[k] = rhs;
      }
    }
    return this.lu.solve(out, out);
  }

  /**
   * Dış düğümleri iç çözümden ekstrapolasyonla doldur (bikübik spline sınır yakınında
   * salınım yapmasın):
   *  1. katman: ızgara çizgisi boyunca sınır kesişimi B (ψ = g) + iç düğümlerden kuadratik
   *     Lagrange ekstrapolasyonu (B, iç düğüme çok yakınsa kötü koşullanmayı önlemek için bir
   *     sonraki iç düğüm kullanılır);
   *  sonraki katmanlar (extLayers): çizgi boyunca kuadratik/doğrusal ekstrapolasyon — global
   *     spline'ın sınır yakınında gördüğü veri pürüzsüz kalır;
   *  kalan (erişilemeyen) düğümler: harmonik (Laplace) dolgu.
   */
  extend(psi: Float64Array, g?: BoundaryValue): Float64Array {
    // g = 0 (fizik çözümleri): işlem sırası ψ'den bağımsız → doğrusal "plan" bir kez kaydedilip
    // her çağrıda tek geçişte uygulanır (Picard döngüsünde ~20× hızlanma).
    if (!g && !this.planInvalid) {
      if (!this.plan) this.plan = this.recordExtension();
      if (this.planInvalid) return this.extendGeneral(psi, () => 0);
      const { tgt, start, src, w } = this.plan;
      for (let o = 0; o < tgt.length; o++) {
        let v = 0;
        for (let m = start[o]; m < start[o + 1]; m++) v += w[m] * psi[src[m]];
        psi[tgt[o]] = v;
      }
      return psi;
    }
    return this.extendGeneral(psi, g ?? (() => 0));
  }
  private plan: { tgt: Int32Array; start: Int32Array; src: Int32Array; w: Float64Array } | null = null;
  private planInvalid = false;

  /** extendGeneral'i g = 0 için sembolik koşturup ağırlıkları kaydet */
  private recordExtension() {
    const tgt: number[] = [], start: number[] = [0], src: number[] = [], wts: number[] = [];
    this.extendGeneral(new Float64Array(this.NR * this.NZ), () => 0, (k, terms) => {
      tgt.push(k);
      for (const [s, w] of terms) { src.push(s); wts.push(w); }
      start.push(src.length);
    });
    return { tgt: Int32Array.from(tgt), start: Int32Array.from(start), src: Int32Array.from(src), w: Float64Array.from(wts) };
  }

  private extendGeneral(psi: Float64Array, g: BoundaryValue, rec?: (k: number, terms: [number, number][]) => void): Float64Array {
    const { NR, NZ, kind } = this;
    const N = NR * NZ;
    const known = new Uint8Array(N);
    for (let k = 0; k < N; k++) known[k] = kind[k] !== 0 ? 1 : 0;
    const b = this.boundary;
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const inGrid = (i: number, j: number) => i >= 0 && i < NR && j >= 0 && j < NZ;
    /** Lagrange taban ağırlıkları L_a(s) */
    const lagW = (xs: number[], s: number) => xs.map((_, a) => {
      let w = 1;
      for (let c = 0; c < xs.length; c++) if (c !== a) w *= (s - xs[c]) / (xs[a] - xs[c]);
      return w;
    });
    const terms: [number, number][][] | null = rec ? Array.from({ length: N }, () => []) : null;
    // 1. katman: sınıra komşu dış düğümler
    const acc = new Float64Array(N), cnt = new Uint8Array(N);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const k = j * NR + i;
      if (known[k]) continue;
      for (const [di, dj] of dirs) {
        const i1 = i - di, j1 = j - dj; // iç tarafa doğru komşu I
        if (!inGrid(i1, j1)) continue;
        const k1 = j1 * NR + i1;
        if (kind[k1] === 0) continue;
        const RI = this.R(i1), ZI = this.Z(j1);
        const h = di !== 0 ? this.dR : this.dZ;
        let hb: number, Rb: number, Zb: number;
        if (di !== 0) {
          const rr = b.rRange(ZI);
          if (!rr) continue;
          Rb = di > 0 ? rr[1] : rr[0]; Zb = ZI; hb = Math.abs(Rb - RI);
        } else {
          const zt = b.zTop(RI);
          if (zt === null) continue;
          Rb = RI; Zb = dj > 0 ? zt : -zt; hb = Math.abs(Zb - ZI);
        }
        hb = Math.min(hb, h);
        const gb = g(Rb, Zb);
        // noktalar: B (s = hb, değer g; idx −1), iç düğümler s = 0, −h, −2h
        const xs: number[] = [hb], idx: number[] = [-1];
        const useI = hb >= 0.3 * h;
        for (let m = 0; m < 3 && xs.length < 3; m++) {
          const ii = i1 - m * di, jj = j1 - m * dj;
          if (!inGrid(ii, jj) || kind[jj * NR + ii] === 0) break;
          if (!useI && m === 0) continue; // B ≈ I: kötü koşullanmayı önlemek için I'yı atla
          xs.push(-m * h); idx.push(jj * NR + ii);
        }
        if (xs.length < 2) { xs.push(0); idx.push(k1); }
        const wv = lagW(xs, h);
        let v = 0;
        for (let a = 0; a < xs.length; a++) {
          v += wv[a] * (idx[a] < 0 ? gb : psi[idx[a]]);
          if (terms && idx[a] >= 0) terms[k].push([idx[a], wv[a]]);
        }
        acc[k] += v; cnt[k]++;
      }
    }
    const commit = (k: number) => {
      psi[k] = acc[k] / cnt[k]; known[k] = 2;
      if (rec && terms) rec(k, terms[k].map(([s, w]) => [s, w / cnt[k]]));
    };
    for (let k = 0; k < N; k++) if (cnt[k]) commit(k);
    // sonraki katmanlar: çizgi boyunca kuadratik ekstrapolasyon
    for (let layer = 0; layer < this.extLayers; layer++) {
      acc.fill(0); cnt.fill(0);
      if (terms) for (const tl of terms) tl.length = 0;
      let any = false;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
        const k = j * NR + i;
        if (known[k]) continue;
        for (const [di, dj] of dirs) {
          const pts: number[] = [];
          for (let m = 1; m <= 3; m++) {
            const ii = i - m * di, jj = j - m * dj;
            if (!inGrid(ii, jj) || !known[jj * NR + ii]) break;
            pts.push(jj * NR + ii);
          }
          const wts = pts.length === 3 ? [3, -3, 1] : pts.length === 2 ? [2, -1] : null;
          if (!wts) continue;
          for (let m = 0; m < wts.length; m++) {
            acc[k] += wts[m] * psi[pts[m]];
            if (terms) terms[k].push([pts[m], wts[m]]);
          }
          cnt[k]++;
        }
      }
      for (let k = 0; k < N; k++) if (cnt[k]) { commit(k); any = true; }
      if (!any) break;
    }
    // uzak düğümler: harmonik dolgu (SOR, kutu kenarında Neumann)
    const free: number[] = [];
    for (let k = 0; k < N; k++) if (!known[k]) free.push(k);
    if (free.length && rec) this.planInvalid = true;
    if (free.length) {
      let mean = 0, nm = 0;
      for (let k = 0; k < N; k++) if (known[k] === 2) { mean += psi[k]; nm++; }
      mean = nm ? mean / nm : 0;
      for (const k of free) psi[k] = mean;
      const om = 1.85;
      for (let sweep = 0; sweep < 400; sweep++) {
        let dmax = 0;
        for (const k of free) {
          const i = k % NR, j = (k - i) / NR;
          const w = psi[i > 0 ? k - 1 : k + 1], e = psi[i < NR - 1 ? k + 1 : k - 1];
          const s = psi[j > 0 ? k - NR : k + NR], n = psi[j < NZ - 1 ? k + NR : k - NR];
          const nv = 0.25 * (w + e + s + n);
          const d = nv - psi[k];
          psi[k] += om * d;
          if (Math.abs(d) > dmax) dmax = Math.abs(d);
        }
        if (dmax < 1e-10 * (Math.abs(mean) + 1e-30)) break;
      }
    }
    return psi;
  }

  bicubic(psi: Float64Array): Bicubic {
    return new Bicubic(psi, this.NR, this.NZ, this.Rmin, this.Zmin, this.dR, this.dZ);
  }
}

// ----------------------------------------------------------------------------------------

export interface ShapeProfileSpec {
  kind: 'shape';
  alphaM: number; // ψ_N üssü
  alphaN: number; // (1 − ψ_N^αm) üssü
  /** hedef β_p (verilirse β0 ayarlanır) veya sabit β0 */
  betaP?: number;
  beta0?: number;
}
export interface TableProfileSpec {
  kind: 'table';
  /** ψ_N düğümleri (0…1, artan) */
  psiN: ArrayLike<number>;
  /** basınç p(ψ_N) [Pa] */
  p: ArrayLike<number>;
  /** çevrelenen toroidal akım I(ψ_N) [A]; I(0) = 0, I(1) ≈ I_p */
  I?: ArrayLike<number>;
  /**
   * akı-yüzeyi ortalamalı ⟨j_φ/R⟩(ψ_N) [A/m³] — verilirse I yerine kullanılır:
   * FF' = μ0(⟨j_φ/R⟩ − p')/⟨R⁻²⟩ yalnız zayıfça iterasyona bağlıdır (FF'-dayatmalı problem gibi
   * iyi koşullu; I(ψ_N) formundaki dI/dψ_N ÷ dV/dψ_N geri beslemesi yoktur).
   */
  jR?: ArrayLike<number>;
}
export type ProfileSpec = ShapeProfileSpec | TableProfileSpec;

export interface EquilibriumOptions {
  Ip: number; // A
  B0: number; // T, geometrik merkezde (R0 = geom.R) vakum alanı
  profile: ProfileSpec;
  maxIter?: number;
  tol?: number;
  relax?: number;
  /** çıktı akı yüzeyi sayısı ve poloidal çözünürlük */
  nSurf?: number;
  nTheta?: number;
  /** önceki çözüm (sıcak başlangıç) */
  psiInit?: Float64Array;
  /** teşhis: her Picard iterasyonunda (iterasyon, artık, ψ_eksen) */
  onIter?: (it: number, resid: number, psiAxis: number) => void;
}

/** Akı yüzeyi tabloları (ψ_N ızgarasında, eksen dahil) */
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
  Rin: Float64Array; // yüzeyin min R'si
  Rout: Float64Array; // max R
  kappa: Float64Array;
  delta: Float64Array;
  Phi: Float64Array; // toroidal akı [Wb]
}

export interface Equilibrium {
  grid: GSGrid;
  psi: Float64Array; // NR·NZ (dış düğümler ekstrapole)
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
  betaT: number; // oran
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
}

/** Manyetik eksen: ızgara maksimumu + bikübik Newton */
function findAxis(grid: GSGrid, psi: Float64Array, bi: Bicubic): { R: number; Z: number; psi: number } {
  let kmax = -1, vmax = -Infinity;
  for (let k = 0; k < psi.length; k++) if (grid.kind[k] === 1 && psi[k] > vmax) { vmax = psi[k]; kmax = k; }
  let R = grid.R(kmax % grid.NR), Z = grid.Z(Math.floor(kmax / grid.NR));
  const g = new Float64Array(3), gp = new Float64Array(3), gm = new Float64Array(3);
  const e = 1e-4 * grid.dR;
  for (let it = 0; it < 20; it++) {
    bi.evalGrad(R, Z, g);
    bi.evalGrad(R + e, Z, gp); bi.evalGrad(R - e, Z, gm);
    const hRR = (gp[1] - gm[1]) / (2 * e), hRZ = (gp[2] - gm[2]) / (2 * e);
    bi.evalGrad(R, Z + e, gp); bi.evalGrad(R, Z - e, gm);
    const hZZ = (gp[2] - gm[2]) / (2 * e);
    const det = hRR * hZZ - hRZ * hRZ;
    if (!(det > 0)) break;
    const dRn = -(hZZ * g[1] - hRZ * g[2]) / det, dZn = -(-hRZ * g[1] + hRR * g[2]) / det;
    const lim = grid.dR;
    R += Math.max(-lim, Math.min(lim, dRn)); Z += Math.max(-lim, Math.min(lim, dZn));
    if (Math.hypot(dRn, dZn) < 1e-12 * grid.geom.a) break;
  }
  bi.evalGrad(R, Z, g);
  return { R, Z, psi: g[0] };
}

/** ∫_x^1 f(s) ds (Gauss–Legendre) */
function tailIntegral(f: (s: number) => number, x: number, n = 12): number {
  if (x >= 1) return 0;
  const { x: gx, w: gw } = gaussLegendre(n);
  const h = 0.5 * (1 - x), c = 0.5 * (1 + x);
  let s = 0;
  for (let i = 0; i < n; i++) s += gw[i] * f(c + h * gx[i]);
  return s * h;
}

export class GSSolver {
  readonly grid: GSGrid;
  readonly shape: { area: number; volume: number; perimeter: number; Rc: number };
  private lamNodes = gaussLegendre(24);

  constructor(readonly geom: Geometry, opts: GSGridOptions = {}) {
    this.grid = new GSGrid(geom, opts);
    this.shape = shapeIntegrals(this.grid.boundary);
  }

  /** Çıktı yüzey seviyeleri: ψ_N = (k/(n−1))², k = 1…n−1 (eksen ayrıca) */
  private levels(n: number): Float64Array {
    const L = new Float64Array(n - 1);
    for (let k = 1; k < n; k++) L[k - 1] = (k / (n - 1)) ** 2;
    return L;
  }

  solve(o: EquilibriumOptions): Equilibrium {
    const grid = this.grid;
    const { NR, NZ } = grid;
    const N = NR * NZ;
    const R0 = this.geom.R;
    const maxIter = o.maxIter ?? 200, tol = o.tol ?? 1e-9, relax = o.relax ?? 0.6;
    const Lpol = this.shape.perimeter;
    const Bpa = (MU0 * o.Ip) / Lpol;
    let psi: Float64Array = o.psiInit ? Float64Array.from(o.psiInit) : grid.solveLinear((R) => -MU0 * R * (o.Ip / this.shape.area));
    let psiNew: Float64Array = new Float64Array(N);
    const jphi = new Float64Array(N);
    let beta0 = o.profile.kind === 'shape' ? (o.profile.beta0 ?? 0.5) : 0;
    let converged = false, it = 0, resid = Infinity;
    // tablo modu: FF'(ψ_N) spline'ı (metriklerle güncellenir)
    let ffpTable: CubicSpline | null = null;
    let ppN: ((x: number) => number) | null = null; // dp/dψ_N
    if (o.profile.kind === 'table') {
      const pS = new Pchip(o.profile.psiN, o.profile.p);
      ppN = (x) => pS.deriv(Math.min(Math.max(x, 0), 1));
    }
    const dA = grid.dR * grid.dZ;
    for (it = 1; it <= maxIter; it++) {
      grid.extend(psi);
      const bi = grid.bicubic(psi);
      const ax = findAxis(grid, psi, bi);
      const dpsi = ax.psi; // ψ_b = 0
      if (!(dpsi > 0)) throw new Error('GS: eksende ψ ≤ 0 — çözüm ıraksadı');
      if (o.profile.kind === 'shape') {
        const { alphaM, alphaN } = o.profile;
        let I_R = 0, I_1R = 0;
        for (let k = 0; k < N; k++) {
          if (grid.kind[k] !== 1) { jphi[k] = 0; continue; }
          const x = (dpsi - psi[k]) / dpsi;
          if (x >= 1 || x < 0) { jphi[k] = 0; continue; }
          const sh = Math.pow(1 - Math.pow(x, alphaM), alphaN);
          const R = grid.R(k % NR);
          I_R += (R / R0) * sh * dA; I_1R += (R0 / R) * sh * dA;
          jphi[k] = sh; // geçici: şekil
        }
        // β_p hedefi → β0 güncelle (basınç ∝ λβ0 Δψ)
        if (o.profile.betaP !== undefined && it > 2) {
          const lam = o.Ip / (beta0 * I_R + (1 - beta0) * I_1R);
          const bp = this.betaPofShape(psi, dpsi, lam, beta0, alphaM, alphaN, Bpa);
          if (bp > 0) beta0 = Math.min(Math.max(beta0 * Math.pow(o.profile.betaP / bp, 0.7), 1e-4), 0.999);
        }
        const lam2 = o.Ip / (beta0 * I_R + (1 - beta0) * I_1R);
        for (let k = 0; k < N; k++) {
          if (jphi[k] === 0) continue;
          const R = grid.R(k % NR);
          jphi[k] = lam2 * (beta0 * R / R0 + (1 - beta0) * R0 / R) * jphi[k];
        }
      } else {
        // metrikler (kaba iz) → FF'(ψ_N)
        const pr = o.profile;
        const IS = pr.I ? new Pchip(pr.psiN, pr.I) : null;
        const JS = pr.jR ? new Pchip(pr.psiN, pr.jR) : null;
        if (!IS && !JS) throw new Error('GS table: I veya jR gerekli');
        const tr = traceSurfaces({ bi, psiAxis: dpsi, psiB: 0, Rax: ax.R, Zax: ax.Z }, grid.boundary, this.levels(25), 64, 32);
        const xs: number[] = [0], vals: number[] = [];
        for (let k = 0; k < tr.psiN.length; k++) {
          const m = surfaceMetrics(tr, k);
          const x = tr.psiN[k];
          const pp = -ppN!(x) / dpsi; // dp/dψ
          // ⟨j_φ/R⟩ = p' + FF'⟨R⁻²⟩/μ0 ; I verilmişse ⟨j_φ/R⟩ = 2π (dI/dψ_N)/(dV/dψ_N)
          const jR = JS ? JS.eval(x) : (2 * Math.PI * IS!.deriv(x)) / (m.dVdpsi * dpsi);
          const ffp = (MU0 * (jR - pp)) / m.avgR2inv;
          xs.push(x); vals.push(ffp);
        }
        // eksen değeri: doğrusal ekstrapolasyon
        const v0 = vals[0] - (vals[1] - vals[0]) * (xs[1] / (xs[2] - xs[1]));
        ffpTable = new CubicSpline(xs, [v0, ...vals]);
        let Itot = 0;
        for (let k = 0; k < N; k++) {
          if (grid.kind[k] !== 1) { jphi[k] = 0; continue; }
          const x = (dpsi - psi[k]) / dpsi;
          if (x >= 1 || x < 0) { jphi[k] = 0; continue; }
          const R = grid.R(k % NR);
          const pp = -ppN!(x) / dpsi;
          jphi[k] = R * pp + ffpTable.eval(x) / (MU0 * R);
          Itot += jphi[k] * dA;
        }
        const sc = o.Ip / Itot;
        if (isFinite(sc) && sc > 0) for (let k = 0; k < N; k++) jphi[k] *= sc;
      }
      grid.solveLinear((_R, _Z, k) => -MU0 * grid.R(k % NR) * jphi[k], () => 0, psiNew);
      // yakınsama + gevşetme
      let dmax = 0;
      for (let k = 0; k < N; k++) {
        if (grid.kind[k] === 0) continue;
        const d = psiNew[k] - psi[k];
        if (Math.abs(d) > dmax) dmax = Math.abs(d);
        psiNew[k] = psi[k] + relax * d;
      }
      resid = dmax / Math.max(dpsi, 1e-30);
      o.onIter?.(it, resid, dpsi);
      const tmp = psi; psi = psiNew; psiNew = tmp;
      if (resid < tol && it > 3) { converged = true; break; }
    }
    return this.postProcess(psi, o, beta0, ffpTable, ppN, it, converged, resid);
  }

  /** shape modunda β_p (hızlı ızgara integrali) */
  private betaPofShape(psi: Float64Array, dpsi: number, lam: number, beta0: number, aM: number, aN: number, Bpa: number): number {
    const grid = this.grid, R0 = this.geom.R;
    let pV = 0, V = 0;
    const dA = grid.dR * grid.dZ;
    for (let k = 0; k < psi.length; k++) {
      if (grid.kind[k] !== 1) continue;
      const x = (dpsi - psi[k]) / dpsi;
      if (x >= 1 || x < 0) continue;
      const R = grid.R(k % grid.NR);
      // p(ψ_N) = (λβ0/R0) Δψ ∫_x^1 (1 − s^αm)^αn ds
      const p = ((lam * beta0) / R0) * dpsi * tailIntegral((s) => Math.pow(1 - Math.pow(s, aM), aN), x, 6);
      pV += p * 2 * Math.PI * R * dA; V += 2 * Math.PI * R * dA;
    }
    return (2 * MU0 * (pV / V)) / (Bpa * Bpa);
  }

  private postProcess(psi: Float64Array, o: EquilibriumOptions, beta0: number, ffpTable: CubicSpline | null, ppN: ((x: number) => number) | null,
    iterations: number, converged: boolean, residual: number): Equilibrium {
    const grid = this.grid;
    const R0 = this.geom.R;
    grid.extend(psi);
    const bi = grid.bicubic(psi);
    const ax = findAxis(grid, psi, bi);
    const dpsi = ax.psi;
    const field: PsiField = { bi, psiAxis: dpsi, psiB: 0, Rax: ax.R, Zax: ax.Z };
    const nS = o.nSurf ?? 51;
    const lev = this.levels(nS);
    const tr = traceSurfaces(field, grid.boundary, lev, o.nTheta ?? 128, 64);
    const Fb = R0 * o.B0;
    const n = nS; // eksen + lev
    const P: EqProfiles = {
      psiN: new Float64Array(n), rhoTor: new Float64Array(n), q: new Float64Array(n), F: new Float64Array(n), p: new Float64Array(n),
      FFp: new Float64Array(n), pp: new Float64Array(n), V: new Float64Array(n), dVdpsiN: new Float64Array(n), area: new Float64Array(n),
      Ienc: new Float64Array(n), avgR2inv: new Float64Array(n), avgRinv: new Float64Array(n), avgGrad2R2: new Float64Array(n), avgGrad2: new Float64Array(n),
      avgGrad: new Float64Array(n), avgB2: new Float64Array(n), Bmax: new Float64Array(n), Bmin: new Float64Array(n), ft: new Float64Array(n),
      Rin: new Float64Array(n), Rout: new Float64Array(n), kappa: new Float64Array(n), delta: new Float64Array(n), Phi: new Float64Array(n),
    };
    // basınç ve FF' profilleri (ψ_N'de)
    let pOf: (x: number) => number, ffpOf: (x: number) => number, ppOf: (x: number) => number;
    if (o.profile.kind === 'shape') {
      const { alphaM: aM, alphaN: aN } = o.profile;
      const shapeF = (s: number) => Math.pow(Math.max(1 - Math.pow(s, aM), 0), aN);
      // λ yeniden (son ψ ile)
      let I_R = 0, I_1R = 0;
      const dA = grid.dR * grid.dZ;
      for (let k = 0; k < psi.length; k++) {
        if (grid.kind[k] !== 1) continue;
        const x = (dpsi - psi[k]) / dpsi;
        if (x >= 1 || x < 0) continue;
        const R = grid.R(k % grid.NR);
        const sh = shapeF(x);
        I_R += (R / R0) * sh * dA; I_1R += (R0 / R) * sh * dA;
      }
      const lam = o.Ip / (beta0 * I_R + (1 - beta0) * I_1R);
      ppOf = (x) => ((lam * beta0) / R0) * shapeF(x);
      ffpOf = (x) => MU0 * lam * (1 - beta0) * R0 * shapeF(x);
      pOf = (x) => ((lam * beta0) / R0) * dpsi * tailIntegral(shapeF, x, 10);
    } else {
      const pS = new Pchip(o.profile.psiN, o.profile.p);
      pOf = (x) => Math.max(pS.eval(Math.min(Math.max(x, 0), 1)), 0);
      ppOf = (x) => -ppN!(x) / dpsi;
      ffpOf = (x) => ffpTable!.eval(x);
    }
    // F(ψ_N): F² = F_b² + 2∫_{ψ_b}^{ψ} FF' dψ = F_b² + 2Δψ ∫_x^1 FF'(s) ds
    const Fof = (x: number) => Math.sqrt(Math.max(Fb * Fb + 2 * dpsi * tailIntegral(ffpOf, x, 12), 1e-6 * Fb * Fb));
    // eksen değerleri
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
    // eksen limitleri: q, dV/dψ_N doğrusal ekstrapolasyon (ψ_N'de)
    const ex = (a: Float64Array) => a[1] - (a[2] - a[1]) * (P.psiN[1] / (P.psiN[2] - P.psiN[1]));
    P.q[0] = ex(P.q); P.dVdpsiN[0] = Math.max(ex(P.dVdpsiN), 0); P.kappa[0] = ex(P.kappa); P.delta[0] = 0;
    // toroidal akı Φ(ψ_N) = 2π Δψ ∫ q dψ_N
    const qS = new CubicSpline(P.psiN, P.q);
    for (let i = 0; i < n; i++) P.Phi[i] = 2 * Math.PI * dpsi * qS.integral(P.psiN[i]);
    const PhiB = P.Phi[n - 1];
    for (let i = 0; i < n; i++) P.rhoTor[i] = Math.sqrt(Math.max(P.Phi[i] / PhiB, 0));
    // global: ∫p dV ve ∫B_p² dV (ψ_N üzerinde, dV = (dV/dψ_N) dψ_N)
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
    return {
      grid, psi, psiAxis: dpsi, psiB: 0, Raxis: ax.R, Zaxis: ax.Z, Ip: o.Ip, B0: o.B0, R0,
      prof: P, surfaces: tr, PhiB, rhoTorB: Math.sqrt(PhiB / (Math.PI * o.B0)),
      volume: V, area: P.area[n - 1], perimeter: Lpol, W_th: 1.5 * intP, pAvg, betaT, betaP, betaN, li3,
      q95, q0: P.q[0], qmin, shafranovShift: ax.R - R0,
      iterations, converged, residual,
    };
  }
}
