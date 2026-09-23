/**
 * Gauss–Legendre kuadratürü: n noktalı kural polinomları 2n−1 dereceye kadar tam integre eder.
 * Düğümler Legendre polinomunun kökleri — Newton iterasyonuyla (Press et al., "Numerical
 * Recipes" 3. bs. §4.6, gauleg) hesaplanır ve n başına önbelleğe alınır.
 */
const cache = new Map<number, { x: Float64Array; w: Float64Array }>();

/** [−1, 1] üzerinde n noktalı Gauss–Legendre düğüm/ağırlıkları */
export function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const hit = cache.get(n);
  if (hit) return hit;
  const x = new Float64Array(n), w = new Float64Array(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 0; j < n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1); }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  const out = { x, w };
  cache.set(n, out);
  return out;
}

/** ∫_a^b f(x) dx, n noktalı Gauss–Legendre */
export function integrateGL(f: (x: number) => number, a: number, b: number, n = 16): number {
  const { x, w } = gaussLegendre(n);
  const h = 0.5 * (b - a), c = 0.5 * (b + a);
  let s = 0;
  for (let i = 0; i < n; i++) s += w[i] * f(c + h * x[i]);
  return s * h;
}

/**
 * Profil kuadratürü: ∫_0^1 f(ρ) 2ρ dρ  (silindirik hacim ağırlığı) için sabit düğümler.
 * rho[i], wt[i] döner; Σ wt[i] = 1 (hacim ortalaması ağırlıkları).
 */
export function profileNodes(n: number): { rho: Float64Array; wt: Float64Array } {
  const { x, w } = gaussLegendre(n);
  const rho = new Float64Array(n), wt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = 0.5 * (x[i] + 1);
    rho[i] = r;
    wt[i] = 0.5 * w[i] * 2 * r;
  }
  return { rho, wt };
}
