/**
 * İnterpolasyon: 1D kübik spline (doğal / sabitlenmiş uçlar), monoton PCHIP
 * (Fritsch–Carlson), doğrusal tablo araması ve düzenli ızgarada tensör-çarpım bikübik spline
 * (değer + gradyan; akı yüzeyi izleme için).
 * Kaynak: de Boor, "A Practical Guide to Splines"; Fritsch & Carlson, SIAM J. Numer. Anal. 17 (1980) 238.
 */
import { solveTridiag } from './linalg';

/** Artan xs dizisinde x'i içeren aralığın sol indeksi (0 … n−2) */
export function findInterval(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 2;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return lo;
}

/** Parçalı doğrusal interpolasyon (uçlarda sabit değer) */
export function lerpTable(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const i = findInterval(xs, x);
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

export type SplineBC = { d1Start?: number; d1End?: number };

/** 1D kübik spline. Varsayılan doğal (M=0) uçlar; d1Start/d1End verilirse sabitlenmiş uç. */
export class CubicSpline {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly m: Float64Array; // ikinci türevler
  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>, bc: SplineBC = {}) {
    const n = xs.length;
    if (n < 2) throw new Error('CubicSpline: en az 2 nokta');
    this.x = Float64Array.from(xs);
    this.y = Float64Array.from(ys);
    this.m = new Float64Array(n);
    // two knots with natural ends are a straight line (M = 0); a clamped end is a condition of the 2 × 2 system below
    if (n === 2 && bc.d1Start === undefined && bc.d1End === undefined) return;
    const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), d = new Float64Array(n);
    const X = this.x, Y = this.y;
    for (let i = 1; i < n - 1; i++) {
      const h0 = X[i] - X[i - 1], h1 = X[i + 1] - X[i];
      a[i] = h0 / 6; b[i] = (h0 + h1) / 3; c[i] = h1 / 6;
      d[i] = (Y[i + 1] - Y[i]) / h1 - (Y[i] - Y[i - 1]) / h0;
    }
    if (bc.d1Start !== undefined) {
      const h = X[1] - X[0];
      b[0] = h / 3; c[0] = h / 6; d[0] = (Y[1] - Y[0]) / h - bc.d1Start;
    } else { b[0] = 1; c[0] = 0; d[0] = 0; }
    if (bc.d1End !== undefined) {
      const h = X[n - 1] - X[n - 2];
      a[n - 1] = h / 6; b[n - 1] = h / 3; d[n - 1] = bc.d1End - (Y[n - 1] - Y[n - 2]) / h;
    } else { a[n - 1] = 0; b[n - 1] = 1; d[n - 1] = 0; }
    solveTridiag(a, b, c, d, this.m, n);
  }
  eval(x: number): number {
    const { x: X, y: Y, m: M } = this;
    const i = findInterval(X, x);
    const h = X[i + 1] - X[i];
    const A = (X[i + 1] - x) / h, B = 1 - A;
    return A * Y[i] + B * Y[i + 1] + ((A * A * A - A) * M[i] + (B * B * B - B) * M[i + 1]) * (h * h) / 6;
  }
  deriv(x: number): number {
    const { x: X, y: Y, m: M } = this;
    const i = findInterval(X, x);
    const h = X[i + 1] - X[i];
    const A = (X[i + 1] - x) / h, B = 1 - A;
    return (Y[i + 1] - Y[i]) / h + ((1 - 3 * A * A) * M[i] + (3 * B * B - 1) * M[i + 1]) * h / 6;
  }
  /** ∫_{x0}^{x} y dx (x0 = ilk düğüm) */
  integral(x: number): number {
    const { x: X, y: Y, m: M } = this;
    let s = 0;
    const iEnd = findInterval(X, x);
    for (let i = 0; i <= iEnd; i++) {
      const h = X[i + 1] - X[i];
      const xe = i === iEnd ? Math.min(Math.max(x, X[i]), X[i + 1]) : X[i + 1];
      // ∫ A y_i + B y_{i+1} + ... ; kapalı form, yerel t = (xe − X[i])/h
      const t = (xe - X[i]) / h;
      const iA = t - 0.5 * t * t, iB = 0.5 * t * t; // ∫A, ∫B (dt)
      const iA3 = -(Math.pow(1 - t, 4) - 1) / 4, iB3 = Math.pow(t, 4) / 4; // ∫A³, ∫B³
      s += h * (iA * Y[i] + iB * Y[i + 1] + ((iA3 - iA) * M[i] + (iB3 - iB) * M[i + 1]) * (h * h) / 6);
    }
    return s;
  }
}

/** Monoton kübik Hermite (PCHIP): aşım yok — tablo ters çevirme ve profil haritalama için */
export class Pchip {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly d: Float64Array;
  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    const n = xs.length;
    this.x = Float64Array.from(xs);
    this.y = Float64Array.from(ys);
    this.d = new Float64Array(n);
    const X = this.x, Y = this.y, D = this.d;
    if (n === 2) { D[0] = D[1] = (Y[1] - Y[0]) / (X[1] - X[0]); return; }
    const h = new Float64Array(n - 1), del = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) { h[i] = X[i + 1] - X[i]; del[i] = (Y[i + 1] - Y[i]) / h[i]; }
    for (let i = 1; i < n - 1; i++) {
      if (del[i - 1] * del[i] <= 0) { D[i] = 0; continue; }
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      D[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
    }
    const edge = (h0: number, h1: number, d0: number, d1: number) => {
      let dd = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(dd) !== Math.sign(d0)) dd = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(dd) > Math.abs(3 * d0)) dd = 3 * d0;
      return dd;
    };
    D[0] = edge(h[0], h[1], del[0], del[1]);
    D[n - 1] = edge(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  }
  eval(x: number): number {
    const { x: X, y: Y, d: D } = this;
    const i = findInterval(X, x);
    const h = X[i + 1] - X[i];
    const t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * D[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * D[i + 1];
  }
  deriv(x: number): number {
    const { x: X, y: Y, d: D } = this;
    const i = findInterval(X, x);
    const h = X[i + 1] - X[i];
    const t = (x - X[i]) / h, t2 = t * t;
    return ((6 * t2 - 6 * t) * Y[i] + (-6 * t2 + 6 * t) * Y[i + 1]) / h + (3 * t2 - 4 * t + 1) * D[i] + (3 * t2 - 2 * t) * D[i + 1];
  }
}

/** Düzenli ızgarada doğal-uçlu 1D spline ikinci türevleri (eşit aralık h) */
function naturalSecondDerivs(f: ArrayLike<number>, stride: number, off: number, n: number, h: number, out: Float64Array, outStride: number, outOff: number,
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array, tmp: Float64Array): void {
  for (let i = 1; i < n - 1; i++) {
    a[i] = h / 6; b[i] = (2 * h) / 3; c[i] = h / 6;
    d[i] = (f[off + (i + 1) * stride] - 2 * f[off + i * stride] + f[off + (i - 1) * stride]) / h;
  }
  a[0] = 0; b[0] = 1; c[0] = 0; d[0] = 0;
  a[n - 1] = 0; b[n - 1] = 1; c[n - 1] = 0; d[n - 1] = 0;
  solveTridiag(a, b, c, d, tmp, n);
  for (let i = 0; i < n; i++) out[outOff + i * outStride] = tmp[i];
}

/**
 * Düzenli (x_i = x0 + i hx, y_j = y0 + j hy) ızgarada tensör-çarpım doğal bikübik spline.
 * f: nx·ny, indeks j·nx + i. Değer ve gradyan döndürür (akı yüzeyi / eksen arama için).
 * Değerlendirme: satır j ve j+1 boyunca x-spline'ları (f ve f_yy için), ardından y-spline.
 */
export class Bicubic {
  private fxx: Float64Array; // ∂²f/∂x² (satırlar boyunca)
  private fyy: Float64Array; // ∂²f/∂y² (sütunlar boyunca)
  private fxxyy: Float64Array; // ∂²(fyy)/∂x²
  constructor(readonly f: Float64Array, readonly nx: number, readonly ny: number,
    readonly x0: number, readonly y0: number, readonly hx: number, readonly hy: number) {
    const N = Math.max(nx, ny);
    const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), d = new Float64Array(N), t = new Float64Array(N);
    this.fxx = new Float64Array(nx * ny);
    this.fyy = new Float64Array(nx * ny);
    this.fxxyy = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) naturalSecondDerivs(f, 1, j * nx, nx, hx, this.fxx, 1, j * nx, a, b, c, d, t);
    for (let i = 0; i < nx; i++) naturalSecondDerivs(f, nx, i, ny, hy, this.fyy, nx, i, a, b, c, d, t);
    for (let j = 0; j < ny; j++) naturalSecondDerivs(this.fyy, 1, j * nx, nx, hx, this.fxxyy, 1, j * nx, a, b, c, d, t);
  }
  /** (f, ∂f/∂x, ∂f/∂y) — out dizisine yazar */
  evalGrad(x: number, y: number, out: Float64Array | number[] = new Float64Array(3)): Float64Array | number[] {
    const { nx, ny, hx, hy, f, fxx, fyy, fxxyy } = this;
    let i = Math.floor((x - this.x0) / hx), j = Math.floor((y - this.y0) / hy);
    if (i < 0) i = 0; else if (i > nx - 2) i = nx - 2;
    if (j < 0) j = 0; else if (j > ny - 2) j = ny - 2;
    const Bx = (x - (this.x0 + i * hx)) / hx, Ax = 1 - Bx;
    const By = (y - (this.y0 + j * hy)) / hy, Ay = 1 - By;
    const cAx = (Ax * Ax * Ax - Ax) * hx * hx / 6, cBx = (Bx * Bx * Bx - Bx) * hx * hx / 6;
    const dAx = -1 / hx, dBx = 1 / hx;
    const dcAx = -(3 * Ax * Ax - 1) * hx / 6, dcBx = (3 * Bx * Bx - 1) * hx / 6;
    const k0 = j * nx + i, k1 = k0 + nx;
    // satır j ve j+1: f ve f_yy için x-spline değeri ve x-türevi
    const g0 = Ax * f[k0] + Bx * f[k0 + 1] + cAx * fxx[k0] + cBx * fxx[k0 + 1];
    const g1 = Ax * f[k1] + Bx * f[k1 + 1] + cAx * fxx[k1] + cBx * fxx[k1 + 1];
    const m0 = Ax * fyy[k0] + Bx * fyy[k0 + 1] + cAx * fxxyy[k0] + cBx * fxxyy[k0 + 1];
    const m1 = Ax * fyy[k1] + Bx * fyy[k1 + 1] + cAx * fxxyy[k1] + cBx * fxxyy[k1 + 1];
    const g0x = dAx * f[k0] + dBx * f[k0 + 1] + dcAx * fxx[k0] + dcBx * fxx[k0 + 1];
    const g1x = dAx * f[k1] + dBx * f[k1 + 1] + dcAx * fxx[k1] + dcBx * fxx[k1 + 1];
    const m0x = dAx * fyy[k0] + dBx * fyy[k0 + 1] + dcAx * fxxyy[k0] + dcBx * fxxyy[k0 + 1];
    const m1x = dAx * fyy[k1] + dBx * fyy[k1 + 1] + dcAx * fxxyy[k1] + dcBx * fxxyy[k1 + 1];
    const cAy = (Ay * Ay * Ay - Ay) * hy * hy / 6, cBy = (By * By * By - By) * hy * hy / 6;
    const dcAy = -(3 * Ay * Ay - 1) * hy / 6, dcBy = (3 * By * By - 1) * hy / 6;
    out[0] = Ay * g0 + By * g1 + cAy * m0 + cBy * m1;
    out[1] = Ay * g0x + By * g1x + cAy * m0x + cBy * m1x;
    out[2] = (g1 - g0) / hy + dcAy * m0 + dcBy * m1;
    return out;
  }
  eval(x: number, y: number): number {
    return this.evalGrad(x, y, this.scratch)[0];
  }
  private scratch = new Float64Array(3);
}
