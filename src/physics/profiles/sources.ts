/**
 * 1.5D KAYNAK PROFİLLERİ — yardımcı ısıtma/akım sürme birikimi, NBI demet zayıflaması.
 *
 *  - ECRH/ICRH: Gauss biçimli birikim (hacim-normalize) — APPROXIMATION (ışın izleme yok).
 *  - NBI: orta-düzlemde teğet kiriş (R_tan) boyunca demet zayıflaması
 *      dI/dℓ = −n_e σ_s(E/A) I ,  σ_s ≈ 1.8×10⁻²⁰ (E_amu/50 keV)^−0.7 m²
 *    (Janev, Boley & Post, Nucl. Fusion 29 (1989) 2125 eğilimine uyum; APPROXIMATION),
 *    yerel ρ̂ orta-düzlem R ↔ ρ̂ eşlemesinden (dengeden). Geçen güç = shine-through.
 *  - Akım sürme verimi γ = n_e[1e20] R I_CD / P [10²⁰ A W⁻¹ m⁻²] (ITER tipik: NBCD ≈ 0.3,
 *    ECCD ≈ 0.2 T_e ölçekli) — APPROXIMATION.
 */
import { TransportGeometry } from './geometry1d';

/** Gauss birikim profili; Σ p_i ΔV_i = 1 olacak şekilde normalize [1/m³] */
export function gaussianDeposition(g: TransportGeometry, rho0: number, width: number, out: Float64Array = new Float64Array(g.N)): Float64Array {
  let s = 0;
  const w = Math.max(width, 0.5 * g.dRho);
  for (let i = 0; i < g.N; i++) {
    const x = (g.rhoC[i] - rho0) / w;
    out[i] = Math.exp(-x * x);
    s += out[i] * g.dV[i];
  }
  for (let i = 0; i < g.N; i++) out[i] /= s;
  return out;
}

/** Kenar birikimi (gaz besleme): p ∝ exp(−(1−ρ)/λ) */
export function edgeDeposition(g: TransportGeometry, lambda: number, out: Float64Array = new Float64Array(g.N)): Float64Array {
  let s = 0;
  for (let i = 0; i < g.N; i++) { out[i] = Math.exp(-(1 - g.rhoC[i]) / lambda); s += out[i] * g.dV[i]; }
  for (let i = 0; i < g.N; i++) out[i] /= s;
  return out;
}

/** NBI durdurma tesir kesiti [m²], E_amu = demet enerjisi / kütle numarası [keV/amu] */
export function beamStoppingSigma(E_amu_keV: number): number {
  return 1.8e-20 * Math.pow(Math.max(E_amu_keV, 5) / 50, -0.7);
}

/** R (orta düzlem) → ρ̂ ; eksenin dışında R_out, içinde R_in eşlemesi. Plazma dışı → −1 */
function rhoOfR(g: TransportGeometry, R: number): number {
  const N = g.N;
  if (R >= g.Raxis) {
    if (R > g.RoutF[N]) return -1;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.RoutF[m] <= R) lo = m; else hi = m; }
    const t = (R - g.RoutF[lo]) / Math.max(g.RoutF[hi] - g.RoutF[lo], 1e-12);
    return g.rhoF[lo] + t * (g.rhoF[hi] - g.rhoF[lo]);
  }
  if (R < g.RinF[N]) return -1;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.RinF[m] >= R) lo = m; else hi = m; }
  const t = (g.RinF[lo] - R) / Math.max(g.RinF[lo] - g.RinF[hi], 1e-12);
  return g.rhoF[lo] + t * (g.rhoF[hi] - g.rhoF[lo]);
}

/**
 * NBI birikimi: güç yoğunluğu profili [1/m³] (Σ p ΔV = soğurulan kesir) ve shine-through.
 * Demet dış orta-düzlem kenarından girer, R_tan teğet kirişi boyunca ilerler.
 */
export function nbiDeposition(g: TransportGeometry, ne: Float64Array, E_keV: number, A_beam: number, Rtan: number, out: Float64Array = new Float64Array(g.N), smooth = 0.08): { dep: Float64Array; shine: number } {
  const raw = pencilBeam(g, ne, E_keV, A_beam, Rtan);
  // sonlu demet genişliği + hızlı iyon yörünge genişliği: Gauss yumuşatma (Σ p ΔV korunur)
  out.fill(0);
  const N = g.N;
  for (let j = 0; j < N; j++) {
    const Pj = raw.dep[j] * g.dV[j];
    if (Pj <= 0) continue;
    let s = 0;
    for (let i = 0; i < N; i++) { const x = (g.rhoC[i] - g.rhoC[j]) / smooth; s += Math.exp(-x * x) * g.dV[i]; }
    for (let i = 0; i < N; i++) { const x = (g.rhoC[i] - g.rhoC[j]) / smooth; out[i] += (Pj * Math.exp(-x * x)) / s; }
  }
  return { dep: out, shine: raw.shine };
}

/** Kalem-demet birikimi (yumuşatmasız) */
function pencilBeam(g: TransportGeometry, ne: Float64Array, E_keV: number, A_beam: number, Rtan: number): { dep: Float64Array; shine: number } {
  const out = new Float64Array(g.N);
  const sig = beamStoppingSigma(E_keV / A_beam);
  const Redge = g.RoutF[g.N];
  const Rt = Math.min(Rtan, 0.999 * Redge);
  const L = Math.sqrt(Redge * Redge - Rt * Rt);
  const M = 400;
  const dl = (2 * L) / M;
  let I = 1;
  for (let m = 0; m < M; m++) {
    const ell = L - (m + 0.5) * dl;
    const R = Math.sqrt(Rt * Rt + ell * ell);
    const r = rhoOfR(g, R);
    if (r < 0 || r >= 1) continue;
    const i = Math.min(g.N - 1, Math.floor(r / g.dRho));
    const dI = I * (1 - Math.exp(-ne[i] * sig * dl));
    out[i] += dI;
    I -= dI;
  }
  for (let i = 0; i < g.N; i++) out[i] /= g.dV[i];
  return { dep: out, shine: I };
}

/**
 * Önbellekli NBI kirişi: kiriş parçalarının hücre eşlemesi ve yumuşatma çekirdeği geometri başına
 * bir kez hesaplanır; her adımda yalnız zayıflama (O(M)) ve çekirdek çarpımı (O(N²)) yapılır.
 * nbiDeposition ile aynı sonucu verir.
 */
export class NbiChord {
  private cell: Int32Array;
  private dl: number;
  private kernel: Float64Array; // K[j·N + i]: j kaynağından i'ye (Σ_i K ΔV_i = 1)
  private raw: Float64Array;
  constructor(readonly g: TransportGeometry, Rtan: number, readonly M = 400, smooth = 0.08) {
    const N = g.N;
    const Redge = g.RoutF[N];
    const Rt = Math.min(Rtan, 0.999 * Redge);
    const L = Math.sqrt(Redge * Redge - Rt * Rt);
    this.dl = (2 * L) / M;
    this.cell = new Int32Array(M);
    for (let m = 0; m < M; m++) {
      const ell = L - (m + 0.5) * this.dl;
      const r = rhoOfR(g, Math.sqrt(Rt * Rt + ell * ell));
      this.cell[m] = r < 0 || r >= 1 ? -1 : Math.min(N - 1, Math.floor(r / g.dRho));
    }
    this.kernel = new Float64Array(N * N);
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let i = 0; i < N; i++) { const x = (g.rhoC[i] - g.rhoC[j]) / smooth; s += Math.exp(-x * x) * g.dV[i]; }
      for (let i = 0; i < N; i++) { const x = (g.rhoC[i] - g.rhoC[j]) / smooth; this.kernel[j * N + i] = Math.exp(-x * x) / s; }
    }
    this.raw = new Float64Array(N);
  }
  deposit(ne: ArrayLike<number>, E_keV: number, A_beam: number, out: Float64Array): { dep: Float64Array; shine: number } {
    const g = this.g, N = g.N, raw = this.raw;
    raw.fill(0);
    const sig = beamStoppingSigma(E_keV / A_beam);
    let I = 1;
    for (let m = 0; m < this.M; m++) {
      const i = this.cell[m];
      if (i < 0) continue;
      const dI = I * (1 - Math.exp(-ne[i] * sig * this.dl));
      raw[i] += dI;
      I -= dI;
    }
    out.fill(0);
    for (let j = 0; j < N; j++) {
      const Pj = raw[j];
      if (Pj <= 0) continue;
      const row = j * N;
      for (let i = 0; i < N; i++) out[i] += Pj * this.kernel[row + i];
    }
    return { dep: out, shine: I };
  }
}

/** Profil normalizasyonu: Σ p ΔV */
export function volumeIntegral(g: TransportGeometry, p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < g.N; i++) s += p[i] * g.dV[i];
  return s;
}
