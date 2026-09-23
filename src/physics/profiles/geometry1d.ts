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
import { CubicSpline } from '../numerics/interp';
import { Equilibrium } from '../equilibrium/gs';

export interface TransportGeometry {
  N: number;
  rhoC: Float64Array; // hücre merkezleri (N)
  rhoF: Float64Array; // yüzeyler (N+1), 0 … 1
  dRho: number;
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

/** Eşit aralıklı ızgara noktaları */
function grids(N: number) {
  const rhoC = new Float64Array(N), rhoF = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) rhoC[i] = (i + 0.5) / N;
  for (let i = 0; i <= N; i++) rhoF[i] = i / N;
  return { rhoC, rhoF, dRho: 1 / N };
}

/** Dengeden taşınım geometrisi */
export function geometryFromEquilibrium(eq: Equilibrium, N: number, geom: { a: number; kappa: number; delta: number }): TransportGeometry {
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
  const SV = sp(P.V), SA = sp(P.area), SRin = sp(P.Rin), SRout = sp(P.Rout);
  const { rhoC, rhoF, dRho } = grids(N);
  const f = (S: CubicSpline, r: ArrayLike<number>) => Float64Array.from(r, (v) => S.eval(v));
  const VpC = Float64Array.from(rhoC, (r) => Su.eval(r) * r);
  const VpF = Float64Array.from(rhoF, (r) => Su.eval(r) * r);
  const VF = f(SV, rhoF);
  VF[0] = 0; VF[N] = eq.volume;
  const dV = new Float64Array(N);
  for (let i = 0; i < N; i++) dV[i] = VF[i + 1] - VF[i];
  const ftC = f(Sft, rhoC).map((v) => Math.min(Math.max(v, 0), 1));
  const epsC = f(Seps, rhoC).map((v) => Math.max(v, 1e-4));
  const AF = f(SA, rhoF); AF[0] = 0;
  const RinF = f(SRin, rhoF), RoutF = f(SRout, rhoF);
  RinF[0] = RoutF[0] = eq.Raxis;
  // plazma yüzey alanı S = 2π ∮ R dl (son akı yüzeyi)
  const kb = eq.surfaces.R.length - 1;
  let surf = 0;
  for (let j = 0; j < eq.surfaces.R[kb].length; j++) surf += 2 * Math.PI * eq.surfaces.R[kb][j] * eq.surfaces.dlw[kb][j];
  return {
    N, rhoC, rhoF, dRho,
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
export function circularGeometry(R0: number, a: number, B0: number, N: number, qProfile: (r: number) => number = (r) => 1 + 2 * r * r): TransportGeometry {
  const { rhoC, rhoF, dRho } = grids(N);
  const c = (arr: Float64Array, fn: (r: number) => number) => Float64Array.from(arr, fn);
  const Vp = (r: number) => 4 * Math.PI * Math.PI * R0 * a * a * r;
  const VF = c(rhoF, (r) => 2 * Math.PI * Math.PI * R0 * a * a * r * r);
  const dV = new Float64Array(N);
  for (let i = 0; i < N; i++) dV[i] = VF[i + 1] - VF[i];
  const ft = (r: number) => { const e = (r * a) / R0; return Math.max(0, 1.46 * Math.sqrt(e) - 0.46 * e); };
  return {
    N, rhoC, rhoF, dRho,
    VpC: c(rhoC, Vp), g1C: c(rhoC, () => 1 / (a * a)), g2C: c(rhoC, () => 1 / (a * a * R0 * R0)), R2invC: c(rhoC, () => 1 / (R0 * R0)),
    FC: c(rhoC, () => R0 * B0), B2C: c(rhoC, () => B0 * B0), ftC: c(rhoC, ft), epsC: c(rhoC, (r) => Math.max((r * a) / R0, 1e-4)),
    RgeoC: c(rhoC, () => R0), gradRhoC: c(rhoC, () => 1 / a), qEqC: c(rhoC, qProfile), RinC: c(rhoC, (r) => R0 - r * a), RoutC: c(rhoC, (r) => R0 + r * a),
    VpF: c(rhoF, Vp), g1F: c(rhoF, () => 1 / (a * a)), g2F: c(rhoF, () => 1 / (a * a * R0 * R0)), FF: c(rhoF, () => R0 * B0), gradRhoF: c(rhoF, () => 1 / a),
    VF, AF: c(rhoF, (r) => Math.PI * a * a * r * r), RinF: c(rhoF, (r) => R0 - r * a), RoutF: c(rhoF, (r) => R0 + r * a), dV,
    PhiB: Math.PI * a * a * B0, rhoTorB: a, B0, R0, a, kappa: 1, delta: 0, Raxis: R0,
    volume: VF[N], surface: 4 * Math.PI * Math.PI * R0 * a, perimeter: 2 * Math.PI * a,
  };
}
