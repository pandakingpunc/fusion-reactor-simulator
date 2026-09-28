/**
 * 1.5D MHD OLAYLARI VE KARARLILIK ANALİZİ
 *
 *  - Testere dişi (sawtooth): q=1 yüzeyindeki manyetik kayma s₁ > s_kritik tetikler
 *    (Porcelli et al., PPCF 38 (1996) 2163 tetikleyicisinin basitleştirilmiş kayma biçimi).
 *    Çöküş: Kadomtsev tam yeniden bağlanması — helisel akı ψ*(ρ) = ∫₀^ρ (1/q − 1) dΦ/2π
 *    korunur; karışım yarıçapı ψ*(ρ_mix) = ψ*(0). ρ_mix içindeki T_e, T_i, n_e enerji ve
 *    parçacık korunarak düzleşir, q → max(q, 1.01). (Kadomtsev, Sov. J. Plasma Phys. 1 (1975) 389)
 *  - ELM: pedestal normalize basınç gradyanı α = 2μ0 R q² |∂p/∂r| / B² kritik değeri aşınca
 *    (ideal balonlama/peeling sınırı; şekil faktörü (1 + κ²(1+5δ²))/2 — EPED eğilimi) pedestal
 *    ΔW_ELM/W_ped oranında çöker.
 *  - NTM: modifiye Rutherford denklemi (La Haye, Phys. Plasmas 13 (2006) 055501, Denk. 1):
 *      dw/dt = 1.22 (η/μ0) [ Δ'₀ + a_bs √ε β_θ (L_q/L_p) w/(w² + w_d²) − a_pol w_d²/w³ ]
 *    Δ'₀ = −m/r_s (klasik kararlı), tohum: testere dişi çöküşü.
 *  - Kararlılık: Mercier (büyük en-boy oranı) D_M = s²/4 − α_M(1 − q²), ideal balonlama
 *    s–α birinci kararlılık sınırı α_c ≈ 0.6 s (Connor, Hastie & Taylor, PRL 40 (1978) 396).
 */
import { TransportGeometry } from './geometry1d';

const MU0 = 1.25663706212e-6;
const KEV = 1.602176634e-16;

/** q profili merkezlerde ve yüzeylerde: q = Φ_b ρ /(π ψ') */
export function qFromDpsi(g: TransportGeometry, dpsiF: Float64Array, qF: Float64Array, qC: Float64Array): void {
  const N = g.N;
  // akım boşluğu / ters akımda ψ' → 0: q ≤ 50 ile sınırlanır (sayısal sağlamlık)
  for (let f = 1; f <= N; f++) qF[f] = Math.min((g.PhiB * g.rhoF[f]) / (Math.PI * Math.max(dpsiF[f], 1e-30)), 50);
  // eksen: ψ' ∝ ρ → q(0) ekstrapolasyon
  qF[0] = Math.max(2 * qF[1] - qF[2], 0.05);
  for (let i = 0; i < N; i++) qC[i] = 0.5 * (qF[i] + qF[i + 1]);
}

/** q = qval kesişimi (dıştaki), bulunamazsa −1 — yüzey ızgarasında doğrusal */
export function rhoOfQ(g: TransportGeometry, qF: Float64Array, qval: number, outermost = true): number {
  const N = g.N;
  if (outermost) {
    for (let f = N; f >= 1; f--) if ((qF[f] - qval) * (qF[f - 1] - qval) <= 0 && qF[f] !== qF[f - 1]) {
      const t = (qval - qF[f - 1]) / (qF[f] - qF[f - 1]);
      return g.rhoF[f - 1] + t * g.dRho;
    }
  } else {
    for (let f = 1; f <= N; f++) if ((qF[f] - qval) * (qF[f - 1] - qval) <= 0 && qF[f] !== qF[f - 1]) {
      const t = (qval - qF[f - 1]) / (qF[f] - qF[f - 1]);
      return g.rhoF[f - 1] + t * g.dRho;
    }
  }
  return -1;
}

/** Manyetik kayma s = ρ q'/q verilen ρ'de (yüzey ızgarası) */
export function shearAt(g: TransportGeometry, qF: Float64Array, rho: number): number {
  const N = g.N;
  const f = Math.min(N - 1, Math.max(1, Math.round(rho / g.dRho)));
  const dq = (qF[f + 1] - qF[f - 1]) / (2 * g.dRho);
  return (rho * dq) / Math.max(qF[f], 1e-6);
}

/**
 * Kadomtsev karışım yarıçapı: ψ*(ρ) = ∫₀^ρ (1/q − 1) Φ_b 2ρ dρ ; ψ*(ρ_mix) = 0 (ρ_mix > ρ₁).
 * q ≥ 1 her yerde ise −1.
 */
export function kadomtsevMixingRadius(g: TransportGeometry, qF: Float64Array): number {
  const N = g.N;
  let psiS = 0, prev = 0, peaked = false;
  for (let f = 1; f <= N; f++) {
    const r0 = g.rhoF[f - 1], r1 = g.rhoF[f];
    const val = (0.5 * (1 / qF[f - 1] + 1 / qF[f]) - 1) * (r1 * r1 - r0 * r0);
    prev = psiS;
    psiS += val;
    if (val > 0) peaked = true;
    if (peaked && psiS <= 0) {
      const t = prev / Math.max(prev - psiS, 1e-30);
      return r0 + t * (r1 - r0);
    }
  }
  return peaked ? 1 : -1;
}

/**
 * Profili [0, ρ_mix] içinde düzleştir: [0, ρ₁] sabit X_c, [ρ₁, ρ_mix] doğrusal geçiş X(ρ_mix)'e;
 * X_c, Σ w_i X_i ΔV_i korunumundan (w: ağırlık, ör. n T için n). Dönüş: değişim var mı.
 * wBefore: the weights of the profile before the crash when they changed with it (T flattened
 * after n: Σ n_after T_after ΔV = Σ n_before T_before ΔV).
 */
export function flattenConserving(g: TransportGeometry, X: Float64Array, w: Float64Array | null, rho1: number, rhoMix: number, wBefore: Float64Array | null = w): void {
  const N = g.N;
  const iMix = Math.min(N - 1, Math.floor(rhoMix / g.dRho));
  if (iMix < 1) return;
  const Xmix = X[iMix];
  let target = 0, base = 0, coef = 0;
  for (let i = 0; i < iMix; i++) {
    const wi = w ? w[i] : 1;
    target += (wBefore ? wBefore[i] : 1) * X[i] * g.dV[i];
    const r = g.rhoC[i];
    // X_new = X_c·φ + Xmix·(1−φ);  φ = 1 (ρ<ρ₁), doğrusal azalan (ρ₁<ρ<ρ_mix)
    const phi = r <= rho1 ? 1 : Math.max(0, (rhoMix - r) / Math.max(rhoMix - rho1, 1e-9));
    coef += wi * phi * g.dV[i];
    base += wi * (1 - phi) * Xmix * g.dV[i];
  }
  if (coef <= 0) return;
  const Xc = (target - base) / coef;
  for (let i = 0; i < iMix; i++) {
    const r = g.rhoC[i];
    const phi = r <= rho1 ? 1 : Math.max(0, (rhoMix - r) / Math.max(rhoMix - rho1, 1e-9));
    X[i] = Xc * phi + Xmix * (1 - phi);
  }
}

/** ELM kritik α (şekil bağımlı) */
export function alphaCritical(kappa: number, delta: number, factor = 1): number {
  return factor * 1.1 * (1 + kappa * kappa * (1 + 5 * delta * delta)) / 2;
}

/**
 * Normalize basınç gradyanı α(ρ) = 2μ0 R q² |∂p/∂ρ| ⟨|∇ρ̂|⟩ / B0² (yüzeylerde), p [Pa].
 * Dönüş: pedestal bölgesindeki (ρ ≥ ρ_from) maksimum α.
 */
export function alphaMHD(g: TransportGeometry, p: Float64Array, qF: Float64Array, rhoFrom: number, outAlpha?: Float64Array): number {
  const N = g.N;
  let amax = 0;
  for (let f = 1; f < N; f++) {
    const dp = (p[f] - p[f - 1]) / g.dRho;
    const R = 0.5 * (g.RinF[f] + g.RoutF[f]);
    const a = (2 * MU0 * R * qF[f] * qF[f] * Math.abs(Math.min(dp, 0)) * g.gradRhoF[f]) / (g.B0 * g.B0);
    if (outAlpha) outAlpha[f] = a;
    if (g.rhoF[f] >= rhoFrom && a > amax) amax = a;
  }
  return amax;
}

/**
 * ELM çöküşü: pedestal bölgesinde T ve n'yi sınır değerine doğru f oranında düşür.
 * [ρ_ped − wIn, ρ_ped] içinde yumuşak ağırlık; dönüş: atılan termal enerji [J].
 */
export function elmCrash(g: TransportGeometry, Te: Float64Array, Ti: Float64Array, ne: Float64Array, ni: Float64Array,
  TeB: number, TiB: number, nB: number, rhoPed: number, fW: number, fN: number, wIn = 0.06): number {
  const N = g.N;
  let dW = 0;
  for (let i = 0; i < N; i++) {
    const r = g.rhoC[i];
    if (r < rhoPed - wIn) continue;
    const wgt = r >= rhoPed ? 1 : (r - (rhoPed - wIn)) / wIn;
    const We0 = 1.5 * (ne[i] * Te[i] + ni[i] * Ti[i]);
    const fr = fW * wgt, fn = fN * wgt;
    Te[i] = TeB + (Te[i] - TeB) * (1 - fr);
    Ti[i] = TiB + (Ti[i] - TiB) * (1 - fr);
    const niRatio = ni[i] / Math.max(ne[i], 1);
    ne[i] = nB + (ne[i] - nB) * (1 - fn);
    ni[i] = ne[i] * niRatio;
    const We1 = 1.5 * (ne[i] * Te[i] + ni[i] * Ti[i]);
    dW += (We0 - We1) * KEV * g.dV[i];
  }
  return dW;
}

/**
 * Modifiye Rutherford denklemi sağ tarafı dw/dt [m/s].
 *   eta: yerel direnç [Ω m], m: poloidal mod sayısı, rs: rezonant yüzey küçük yarıçapı [m]
 */
export function mreRate(w: number, p: { eta: number; m: number; rs: number; eps: number; betaTheta: number; LqOverLp: number; wd: number; aBs: number; aPol: number }): number {
  const ww = Math.max(w, 1e-5);
  const D0 = -p.m / Math.max(p.rs, 1e-3);
  const bs = p.aBs * Math.sqrt(Math.max(p.eps, 0)) * p.betaTheta * p.LqOverLp * ww / (ww * ww + p.wd * p.wd);
  const pol = (p.aPol * p.wd * p.wd) / (ww * ww * ww);
  return 1.22 * (p.eta / MU0) * (D0 + bs - pol);
}

/** Mercier ve balonlama göstergeleri (yüzeylerde): D_M = s²/4 − α_M(1 − q²); α_c ≈ 0.6 s */
export function stabilityProfiles(g: TransportGeometry, p: Float64Array, qF: Float64Array, outMercier: Float64Array, outBallooningMargin: Float64Array): { minMercier: number; maxBallooning: number } {
  const N = g.N;
  let minM = Infinity, maxB = 0;
  for (let f = 1; f < N; f++) {
    const rho = g.rhoF[f];
    const dq = (qF[f + 1] - qF[f - 1]) / (2 * g.dRho);
    const s = (rho * dq) / Math.max(qF[f], 1e-6);
    const dp = (p[f] - p[f - 1]) / g.dRho;
    const R = 0.5 * (g.RinF[f] + g.RoutF[f]);
    const r = 0.5 * (g.RoutF[f] - g.RinF[f]);
    const alphaM = (2 * MU0 * r * Math.abs(Math.min(dp, 0)) * g.gradRhoF[f]) / (g.B0 * g.B0);
    const alpha = (alphaM * R * qF[f] * qF[f]) / Math.max(r, 1e-6);
    outMercier[f] = (s * s) / 4 - alphaM * (1 - qF[f] * qF[f]);
    const ac = 0.6 * Math.max(s, 0.05);
    outBallooningMargin[f] = alpha / ac;
    if (outMercier[f] < minM) minM = outMercier[f];
    if (rho < 0.9 && outBallooningMargin[f] > maxB) maxB = outBallooningMargin[f];
  }
  outMercier[0] = outMercier[1]; outMercier[N] = outMercier[N - 1];
  outBallooningMargin[0] = 0; outBallooningMargin[N] = outBallooningMargin[N - 1];
  return { minMercier: minM, maxBallooning: maxB };
}
