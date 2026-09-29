/**
 * 1.5D SONLU HACİM ÇÖZÜCÜLERİ — örtük (geri Euler, θ = 1; L-kararlı) adımlar.
 *
 * Hücre-merkezli ızgara (merkezler yüzey orta noktalarında; düzgün ρ̂_i = (i+½)Δρ veya kenara
 * sıkıştırılmış, geometry1d.ts); akılar yüzeylerde, yüz mesafesi g.distF (iki komşu düğüm arası),
 * hücre değerinden yüz değerine doğrusal ağırlık g.wR. Eksende akı sıfır (V'=0),
 * dış sınırda Dirichlet (T, n) veya Neumann (ψ' ← I_p) koşulu yarım hücre mesafesiyle.
 * Yönetici denklemler (V' = dV/dρ̂, g1 = ⟨|∇ρ̂|²⟩, g2 = ⟨|∇ρ̂|²/R²⟩):
 *
 *   (3/2) ∂(n T)/∂t = (1/V') ∂ρ[V' g1 n χ ∂ρT − (5/2) T Γ] + Q  ∓ (3/2) n_e ν_eq (T_e − T_i)
 *   ∂n/∂t          = −(1/V') ∂ρ Γ + S,   Γ = V'(−g1 D ∂ρn + ⟨|∇ρ̂|⟩ v n)
 *   σ∥ F⟨R⁻²⟩ ∂ψ/∂t = (1/(μ0 V')) ∂ρ(V' F g2 ∂ρψ) − ⟨j_ni·B⟩     (ψ rad başına, dışa artan)
 *
 * Isı denklemleri T_e/T_i için 2×2 blok üçlü-köşegen sistem olarak birlikte çözülür
 * (eşitlenme örtük → τ_eq ≪ Δt'de de kararlı). Yoğunlukta konveksiyon–difüzyon için
 * üstel uydurma (Scharfetter–Gummel) akısı: B(x) = x/(eˣ − 1).
 * Kaynak: Patankar, "Numerical Heat Transfer and Fluid Flow" (1980); Pereverzev & Yushmanov,
 * ASTRA (IPP 5/98, 2002); Citrin et al., TORAX (arXiv:2406.06718).
 */
import { solveBlockTridiag2, solveTridiag } from '../numerics/linalg';
import { asLinearAlgebraFailure } from './failures';
import { TransportGeometry, faceValue } from './geometry1d';

const MU0 = 1.25663706212e-6;

/** Bernoulli fonksiyonu B(x) = x/(eˣ−1), küçük x için seri */
export function bernoulli(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-6) return 1 - x / 2;
  if (x > 700) return x * Math.exp(-x);
  return x / Math.expm1(x);
}

export interface HeatInputs {
  dt: number;
  ne0: Float64Array; ne1: Float64Array; // eski / yeni elektron yoğunluğu [m⁻³]
  ni0: Float64Array; ni1: Float64Array; // eski / yeni toplam iyon yoğunluğu
  Te0: Float64Array; Ti0: Float64Array; // eski sıcaklıklar [keV]
  chiE: Float64Array; chiI: Float64Array; // yüzeylerde (N+1) [m²/s]
  Qe: Float64Array; Qi: Float64Array; // açık kaynak [keV m⁻³ s⁻¹]
  Le: Float64Array; Li: Float64Array; // doğrusallaştırılmış yutak katsayısı ≥ 0 [m⁻³ s⁻¹]: Q ≈ Q0 − L(T − T*)
  TeStar: Float64Array; TiStar: Float64Array; // doğrusallaştırma noktası
  nuEq: Float64Array; // eşitlenme hızı [1/s]  (Q_ei = 1.5 n_e ν (T_e − T_i))
  GammaF: Float64Array; // yüzey parçacık akısı [1/s] (dışa +), konvektif ısı için
  convCoef: number; // 5/2 (veya 0)
  TeB: number; TiB: number; // sınır değerleri [keV]
  nB: number; // sınır yoğunluğu (yüzey χ ağırlığı için)
}

/** Convected energy per particle of the heat flux, in units of T: q_conv = (5/2) T Γ */
export const HEAT_CONVECTION = 2.5;

/** The inputs of a heat step that the energy flux through the outer face depends on */
export type BoundaryFluxInputs = Pick<HeatInputs, 'ne1' | 'ni1' | 'chiE' | 'chiI' | 'GammaF' | 'convCoef' | 'TeB' | 'TiB' | 'nB'>;

/** Birleşik T_e/T_i örtük adımı; sonuç Te, Ti dizilerine yazılır. */
export class HeatSolver {
  private A: Float64Array; private B: Float64Array; private C: Float64Array; private d: Float64Array; private u: Float64Array;
  private Cp: Float64Array; private dp: Float64Array;
  constructor(readonly g: TransportGeometry) {
    const N = g.N;
    this.A = new Float64Array(4 * N); this.B = new Float64Array(4 * N); this.C = new Float64Array(4 * N);
    this.d = new Float64Array(2 * N); this.u = new Float64Array(2 * N);
    this.Cp = new Float64Array(4 * N); this.dp = new Float64Array(2 * N);
  }
  solve(h: HeatInputs, Te: Float64Array, Ti: Float64Array): void {
    const g = this.g, N = g.N;
    const { A, B, C, d } = this;
    A.fill(0); B.fill(0); C.fill(0); d.fill(0);
    for (let i = 0; i < N; i++) {
      const dV = g.dV[i], k = 4 * i, k2 = 2 * i;
      // yüzey iletkenlikleri D = V' g1 n χ / Δρ_f  (Δρ_f = g.distF: iki komşu düğüm arası; dış yüz: yarım hücre)
      const nL = i > 0 ? faceValue(g, h.ne1, i) : h.ne1[i];
      const nR = i < N - 1 ? faceValue(g, h.ne1, i + 1) : h.nB;
      const niL = i > 0 ? faceValue(g, h.ni1, i) : h.ni1[i];
      const niR = i < N - 1 ? faceValue(g, h.ni1, i + 1) : h.nB * (h.ni1[N - 1] / Math.max(h.ne1[N - 1], 1));
      const distL = g.distF[i], distR = g.distF[i + 1];
      const DeL = i > 0 ? (g.VpF[i] * g.g1F[i] * nL * h.chiE[i]) / distL : 0;
      const DeR = (g.VpF[i + 1] * g.g1F[i + 1] * nR * h.chiE[i + 1]) / distR;
      const DiL = i > 0 ? (g.VpF[i] * g.g1F[i] * niL * h.chiI[i]) / distL : 0;
      const DiR = (g.VpF[i + 1] * g.g1F[i + 1] * niR * h.chiI[i + 1]) / distR;
      const cE = 1.5 * h.ne1[i] * dV / h.dt, cI = 1.5 * h.ni1[i] * dV / h.dt;
      const eq = 1.5 * h.ne1[i] * h.nuEq[i] * dV;
      B[k] = cE + DeL + DeR + h.Le[i] * dV + eq;
      B[k + 1] = -eq;
      B[k + 2] = -eq;
      B[k + 3] = cI + DiL + DiR + h.Li[i] * dV + eq;
      d[k2] = 1.5 * h.ne0[i] * h.Te0[i] * dV / h.dt + (h.Qe[i] + h.Le[i] * h.TeStar[i]) * dV;
      d[k2 + 1] = 1.5 * h.ni0[i] * h.Ti0[i] * dV / h.dt + (h.Qi[i] + h.Li[i] * h.TiStar[i]) * dV;
      if (i > 0) { A[k] = -DeL; A[k + 3] = -DiL; }
      if (i < N - 1) { C[k] = -DeR; C[k + 3] = -DiR; }
      else { d[k2] += DeR * h.TeB; d[k2 + 1] += DiR * h.TiB; }
      // konvektif ısı akısı (5/2) T Γ — iyon ve elektron için aynı Γ (yarı-nötrallik), upwind
      if (h.convCoef > 0) {
        const GR = h.GammaF[i + 1] * h.convCoef, GL = h.GammaF[i] * h.convCoef;
        // sağ yüz: Γ>0 → hücre i'den enerji çıkar (T_i), Γ<0 → i+1'den girer
        if (GR > 0) { B[k] += GR; B[k + 3] += GR * (h.ni1[i] / Math.max(h.ne1[i], 1)); }
        else if (i < N - 1) { C[k] += GR; C[k + 3] += GR * (h.ni1[i + 1] / Math.max(h.ne1[i + 1], 1)); }
        // inflow through the separatrix: the ion flux is Γ n_i/n_e with the boundary composition of
        // the last cell, as in the ion conduction there (n_i,B = n_B n_i/n_e)
        else { d[k2] -= GR * h.TeB; d[k2 + 1] -= GR * h.TiB * (h.ni1[i] / Math.max(h.ne1[i], 1)); }
        // sol yüz: Γ>0 → i−1'den girer
        if (i > 0) {
          if (GL > 0) { A[k] -= GL; A[k + 3] -= GL * (h.ni1[i - 1] / Math.max(h.ne1[i - 1], 1)); }
          else { B[k] -= GL; B[k + 3] -= GL * (h.ni1[i] / Math.max(h.ne1[i], 1)); }
        }
      }
    }
    try { solveBlockTridiag2(A, B, C, d, this.u, N, this.Cp, this.dp); } catch (e) { throw asLinearAlgebraFailure('heat', e); }
    for (let i = 0; i < N; i++) { Te[i] = this.u[2 * i]; Ti[i] = this.u[2 * i + 1]; }
  }
  /**
   * Power conducted and convected through the outer face (the separatrix) by the solution Te, Ti
   * [keV/s], discretised exactly as in solve(): with the inputs and the solution of a step,
   * Σ (3/2)(n_e T_e + n_i T_i) ΔV changes over Δt by Δt [Σ_e,i (Q + L (T* − T)) ΔV − e − i]
   * (the interior fluxes and the e–i exchange cancel in pairs).
   */
  boundaryLoss(h: BoundaryFluxInputs, Te: ArrayLike<number>, Ti: ArrayLike<number>): { e: number; i: number } {
    const g = this.g, N = g.N;
    const f = g.VpF[N] * g.g1F[N] / g.distF[N];
    const niB = h.nB * (h.ni1[N - 1] / Math.max(h.ne1[N - 1], 1));
    let e = f * h.nB * h.chiE[N] * (Te[N - 1] - h.TeB);
    let i = f * niB * h.chiI[N] * (Ti[N - 1] - h.TiB);
    if (h.convCoef > 0) {
      const G = h.GammaF[N] * h.convCoef;
      e += G > 0 ? G * Te[N - 1] : G * h.TeB;
      i += G * (G > 0 ? Ti[N - 1] : h.TiB) * (h.ni1[N - 1] / Math.max(h.ne1[N - 1], 1));
    }
    return { e, i };
  }
}

export interface DensityInputs {
  dt: number;
  n0: Float64Array; // eski
  D: Float64Array; v: Float64Array; // yüzeylerde (N+1): D [m²/s], v [m/s] (içe < 0)
  S: Float64Array; // kaynak [m⁻³ s⁻¹]
  nB: number;
}

export class DensitySolver {
  private a: Float64Array; private b: Float64Array; private c: Float64Array; private d: Float64Array;
  private cp: Float64Array; private dp: Float64Array;
  /** son çözümün yüzey akıları [1/s] (dışa +) */
  readonly GammaF: Float64Array;
  constructor(readonly g: TransportGeometry) {
    const N = g.N;
    this.a = new Float64Array(N); this.b = new Float64Array(N); this.c = new Float64Array(N); this.d = new Float64Array(N);
    this.cp = new Float64Array(N); this.dp = new Float64Array(N);
    this.GammaF = new Float64Array(N + 1);
  }
  /** yüz katsayıları: Γ_f = W_L n_sol − W_R n_sağ */
  private faceCoef(f: number, dist: number, D: number, v: number): [number, number] {
    const g = this.g;
    const diff = (g.VpF[f] * g.g1F[f] * D) / dist;
    if (diff <= 0) return [0, 0];
    const Pe = (v * g.gradRhoF[f] * dist) / (g.g1F[f] * D);
    return [diff * bernoulli(-Pe), diff * bernoulli(Pe)];
  }
  solve(h: DensityInputs, n: Float64Array): void {
    const g = this.g, N = g.N;
    const { a, b, c, d } = this;
    for (let i = 0; i < N; i++) {
      const dV = g.dV[i];
      b[i] = dV / h.dt; a[i] = 0; c[i] = 0;
      d[i] = h.n0[i] * dV / h.dt + h.S[i] * dV;
      // sağ yüz i+1
      const [WL, WR] = this.faceCoef(i + 1, g.distF[i + 1], h.D[i + 1], h.v[i + 1]);
      b[i] += WL;
      if (i < N - 1) c[i] -= WR; else d[i] += WR * h.nB;
      // sol yüz i
      if (i > 0) {
        const [wl, wr] = this.faceCoef(i, g.distF[i], h.D[i], h.v[i]);
        b[i] += wr; a[i] -= wl;
      }
    }
    try { solveTridiag(a, b, c, d, n, N, this.cp, this.dp); } catch (e) { throw asLinearAlgebraFailure('density', e); }
    // akılar
    this.GammaF[0] = 0;
    for (let f = 1; f <= N; f++) {
      const [WL, WR] = this.faceCoef(f, g.distF[f], h.D[f], h.v[f]);
      this.GammaF[f] = WL * n[f - 1] - WR * (f < N ? n[f] : h.nB);
    }
  }
}

export interface CurrentInputs {
  dt: number;
  psi0: Float64Array;
  sigma: Float64Array; // σ∥ merkezlerde [S/m]
  jniB: Float64Array; // ⟨j_ni·B⟩ merkezlerde [A T/m²]
  Ip: number; // A
}

/** Poloidal akı difüzyonu (akım difüzyonu), I_p sınır koşullu */
export class CurrentSolver {
  private a: Float64Array; private b: Float64Array; private c: Float64Array; private d: Float64Array;
  private cp: Float64Array; private dp: Float64Array;
  constructor(readonly g: TransportGeometry) {
    const N = g.N;
    this.a = new Float64Array(N); this.b = new Float64Array(N); this.c = new Float64Array(N); this.d = new Float64Array(N);
    this.cp = new Float64Array(N); this.dp = new Float64Array(N);
  }
  /** G = V' F g2 (yüzeylerde) */
  G(f: number): number { const g = this.g; return g.VpF[f] * g.FF[f] * g.g2F[f]; }
  solve(h: CurrentInputs, psi: Float64Array): void {
    const g = this.g, N = g.N;
    const { a, b, c, d } = this;
    for (let i = 0; i < N; i++) {
      const m = (h.sigma[i] * g.FC[i] * g.R2invC[i] * g.dV[i]) / h.dt;
      const GL = i > 0 ? this.G(i) / (MU0 * g.distF[i]) : 0;
      const GR = i < N - 1 ? this.G(i + 1) / (MU0 * g.distF[i + 1]) : 0;
      a[i] = -GL; c[i] = -GR; b[i] = m + GL + GR;
      d[i] = m * h.psi0[i] - h.jniB[i] * g.dV[i];
      if (i === N - 1) d[i] += 2 * Math.PI * g.FF[N] * h.Ip; // (1/μ0) G ψ' = 2π F I_p
    }
    try { solveTridiag(a, b, c, d, psi, N, this.cp, this.dp); } catch (e) { throw asLinearAlgebraFailure('current', e); }
  }
  /** ψ' yüzeylerde (dış yüz I_p koşulundan) */
  dpsiF(psi: Float64Array, Ip: number, out: Float64Array): Float64Array {
    const g = this.g, N = g.N;
    out[0] = 0;
    for (let f = 1; f < N; f++) out[f] = (psi[f] - psi[f - 1]) / g.distF[f];
    out[N] = (2 * Math.PI * MU0 * Ip) / (g.VpF[N] * g.g2F[N]);
    return out;
  }
  /** ⟨j·B⟩ merkezlerde [A T/m²] = (1/μ0 ΔV)(G ψ')|sağ − (G ψ')|sol */
  jB(dpsiF: Float64Array, out: Float64Array): Float64Array {
    const g = this.g, N = g.N;
    for (let i = 0; i < N; i++) out[i] = (this.G(i + 1) * dpsiF[i + 1] - this.G(i) * dpsiF[i]) / (MU0 * g.dV[i]);
    return out;
  }
  /** Çevrelenen akım I(ρ_f) [A] = V' g2 ψ'/(2π μ0) */
  Ienc(dpsiF: Float64Array, out: Float64Array): Float64Array {
    const g = this.g;
    for (let f = 0; f <= g.N; f++) out[f] = (g.VpF[f] * g.g2F[f] * dpsiF[f]) / (2 * Math.PI * MU0);
    return out;
  }
}
