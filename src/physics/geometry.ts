/**
 * Toroidal geometri ve profil yardımcıları.
 * APPROXIMATION: Plazma kesiti D-şekilli (Miller-benzeri) parametrik eğri; hacim ve
 * yüzey için standart analitik yaklaşımlar (ITER Physics Basis 1999, Böl. 1).
 */
export interface Geometry {
  R: number; // büyük yarıçap [m]
  a: number; // küçük yarıçap [m]
  kappa: number; // elongasyon (κ95 ~ κ_a)
  delta: number; // üçgensellik
}

export function plasmaVolume(g: Geometry): number {
  // V ≈ 2π² R a² κ · (1 − δ²/8 ...)  — düşük dereceden düzeltmeler ihmal (APPROXIMATION ~%3)
  return 2 * Math.PI * Math.PI * g.R * g.a * g.a * g.kappa;
}
export function plasmaSurface(g: Geometry): number {
  // S ≈ 4π² R a sqrt((1+κ²)/2)   (poloidal çevre eliptik yaklaşımı)
  return 4 * Math.PI * Math.PI * g.R * g.a * Math.sqrt((1 + g.kappa * g.kappa) / 2);
}
export function crossSectionArea(g: Geometry): number {
  return Math.PI * g.a * g.a * g.kappa;
}
export function aspectRatio(g: Geometry): number {
  return g.R / g.a;
}
export function inverseAspect(g: Geometry): number {
  return g.a / g.R;
}
/** Poloidal çevre uzunluğu (Ramanujan elips yaklaşımı) */
export function poloidalPerimeter(g: Geometry): number {
  const A = g.a, B = g.a * g.kappa;
  const h = ((A - B) / (A + B)) ** 2;
  return Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
/** Ortalama poloidal alan B_p = μ0 I_p / L_pol */
export function poloidalField(g: Geometry, Ip_A: number): number {
  return (1.25663706212e-6 * Ip_A) / poloidalPerimeter(g);
}

/**
 * q95 — ITER Physics Basis (Nucl. Fusion 39 (1999) 2175), Denk. 1 (Uckan 1990):
 *  q95 = (5 a² B / (R I_p[MA])) · (1 + κ²(1 + 2δ² − 1.2δ³))/2 · (1.17 − 0.65ε)/(1 − ε²)²
 */
export function q95(g: Geometry, B0: number, Ip_MA: number): number {
  if (Ip_MA <= 0) return Infinity;
  const eps = g.a / g.R;
  const shape = (1 + g.kappa * g.kappa * (1 + 2 * g.delta * g.delta - 1.2 * g.delta ** 3)) / 2;
  const asp = (1.17 - 0.65 * eps) / Math.pow(1 - eps * eps, 2);
  return ((5 * g.a * g.a * B0) / (g.R * Ip_MA)) * shape * asp;
}

/**
 * Profil şekilleri: f(ρ) = f0 (1 − ρ²)^α ; hacim ort. <f> = f0/(1+α)
 * Silindirik hacim ağırlığı 2ρ dρ (APPROXIMATION: Shafranov kayması ve şekil ihmal).
 */
export function peakFromAverage(avg: number, alpha: number): number {
  return avg * (1 + alpha);
}
/** <f^p g^q> / (<f>^p <g>^q) tipi profil çarpanları için sayısal integral */
export function profileIntegral(fn: (rho: number) => number, N = 40): number {
  // Gauss-Legendre yerine orta nokta (yeterli, integrand düzgün)
  let s = 0;
  for (let i = 0; i < N; i++) {
    const rho = (i + 0.5) / N;
    s += fn(rho) * 2 * rho;
  }
  return s / N;
}

/**
 * profileIntegral ile aynı integral (bit bit aynı toplam) ve ρ < rhoSplit iç bölgenin payı
 * (orta noktası rhoSplit'in altında kalan hücreler).
 */
export function profileIntegralSplit(fn: (rho: number) => number, rhoSplit: number, N = 40): { total: number; inner: number } {
  let s = 0, si = 0;
  for (let i = 0; i < N; i++) {
    const rho = (i + 0.5) / N;
    const v = fn(rho) * 2 * rho;
    s += v;
    if (rho < rhoSplit) si += v;
  }
  return { total: s / N, inner: si / N };
}
