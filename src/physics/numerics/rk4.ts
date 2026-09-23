/**
 * Sabit adımlı açık tümleyiciler — klasik RK4 (4. derece) ve açık Euler (1. derece).
 * Üretim kodu uyarlanır Dormand–Prince RK5(4)'ü kullanır (integrator.ts); bunlar iş–hassasiyet
 * karşılaştırması ve doğrulama testleri içindir (Hairer, Nørsett & Wanner, "Solving ODEs I", §II.1).
 */
import type { RHS } from '../integrator';

/** y(t0) = y0'dan t1'e n eşit adım; y yerinde güncellenir. Dönüş: RHS çağrı sayısı. */
export function rk4Fixed(rhs: RHS, y: Float64Array, t0: number, t1: number, n: number): number {
  const m = y.length;
  const k1 = new Float64Array(m), k2 = new Float64Array(m), k3 = new Float64Array(m), k4 = new Float64Array(m), yt = new Float64Array(m);
  const h = (t1 - t0) / n;
  let t = t0;
  for (let s = 0; s < n; s++) {
    rhs(t, y, k1);
    for (let i = 0; i < m; i++) yt[i] = y[i] + 0.5 * h * k1[i];
    rhs(t + 0.5 * h, yt, k2);
    for (let i = 0; i < m; i++) yt[i] = y[i] + 0.5 * h * k2[i];
    rhs(t + 0.5 * h, yt, k3);
    for (let i = 0; i < m; i++) yt[i] = y[i] + h * k3[i];
    rhs(t + h, yt, k4);
    for (let i = 0; i < m; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    t = t0 + (s + 1) * h;
  }
  return 4 * n;
}

/** Açık Euler: y_{k+1} = y_k + h f(t_k, y_k). Dönüş: RHS çağrı sayısı. */
export function eulerFixed(rhs: RHS, y: Float64Array, t0: number, t1: number, n: number): number {
  const m = y.length, k = new Float64Array(m);
  const h = (t1 - t0) / n;
  for (let s = 0; s < n; s++) {
    rhs(t0 + s * h, y, k);
    for (let i = 0; i < m; i++) y[i] += h * k[i];
  }
  return n;
}
