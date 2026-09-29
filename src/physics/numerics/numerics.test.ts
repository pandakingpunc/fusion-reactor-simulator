import { describe, expect, it } from 'vitest';
import { BandedLU, SingularMatrixError, luFactor, luSolve, solveBlockTridiag2, solveDense, solveTridiag } from './linalg';
import { gaussLegendre, integrateGL, profileNodes } from './quadrature';
import { Bicubic, CubicSpline, Pchip, lerpTable } from './interp';
import { brent } from './roots';
import { eulerFixed, rk4Fixed } from './rk4';
import { AndersonMixer } from './anderson';

describe('linalg', () => {
  it('Thomas algorithm solves a diagonally dominant tridiagonal system', () => {
    const n = 50;
    const a = new Float64Array(n).fill(-1), b = new Float64Array(n).fill(4), c = new Float64Array(n).fill(-1);
    const xTrue = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = (i > 0 ? a[i] * xTrue[i - 1] : 0) + b[i] * xTrue[i] + (i < n - 1 ? c[i] * xTrue[i + 1] : 0);
    const x = solveTridiag(a, b, c, d, new Float64Array(n));
    for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(xTrue[i], 12);
  });

  it('2×2 block tridiagonal solver matches the dense solution', () => {
    const n = 7, N = 2 * n;
    const A = new Float64Array(4 * n), B = new Float64Array(4 * n), C = new Float64Array(4 * n);
    const dense = new Float64Array(N * N);
    for (let i = 0; i < n; i++) {
      const blk = (arr: Float64Array, di: number, vals: number[]) => {
        arr.set(vals, 4 * i);
        const j = i + di;
        if (j < 0 || j >= n) return;
        dense[(2 * i) * N + 2 * j] = vals[0]; dense[(2 * i) * N + 2 * j + 1] = vals[1];
        dense[(2 * i + 1) * N + 2 * j] = vals[2]; dense[(2 * i + 1) * N + 2 * j + 1] = vals[3];
      };
      blk(A, -1, [-1, 0.1 * i, 0, -0.5]);
      blk(B, 0, [5 + i, -1, 0.7, 6]);
      blk(C, 1, [-1.2, 0, 0.3, -1]);
    }
    const d = Float64Array.from({ length: N }, (_, k) => Math.cos(k) + 2);
    const u = solveBlockTridiag2(A, B, C, d, new Float64Array(N), n);
    const ref = solveDense(dense, d, N);
    for (let k = 0; k < N; k++) expect(u[k]).toBeCloseTo(ref[k], 11);
  });

  it('dense LU with pivoting', () => {
    const M = Float64Array.from([0, 2, 1, 1, 1, 1, 2, 1, 3]);
    const b = [3, 3, 6];
    const piv = luFactor(M, 3);
    const x = luSolve(M, 3, piv, b);
    expect(Array.from(x).map((v) => +v.toFixed(12))).toEqual([1, 1, 1]);
  });

  it('banded LU reproduces the 2-D Poisson operator solution', () => {
    const nx = 12, ny = 9, n = nx * ny;
    const L = new BandedLU(n, nx, nx);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const r = j * nx + i;
      L.set(r, r, 4 + 0.01 * i);
      if (i > 0) L.set(r, r - 1, -1);
      if (i < nx - 1) L.set(r, r + 1, -1.1);
      if (j > 0) L.set(r, r - nx, -0.9);
      if (j < ny - 1) L.set(r, r + nx, -1);
    }
    const xTrue = Float64Array.from({ length: n }, (_, k) => Math.sin(0.3 * k) + 0.5);
    const b = L.mul(xTrue, new Float64Array(n));
    L.factor();
    const x = L.solve(b);
    for (let k = 0; k < n; k++) expect(x[k]).toBeCloseTo(xTrue[k], 11);
  });

  it('banded LU with an irregular envelope (rows narrower than the band) matches the dense solve', () => {
    // variable-width rows: the envelope-skipping factorisation must still see every fill-in entry
    const n = 60, ml = 9, mu = 7;
    const L = new BandedLU(n, ml, mu);
    const dense = new Float64Array(n * n);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < n; r++) {
      const lo = Math.max(0, r - Math.floor(rnd() * (ml + 1))), hi = Math.min(n - 1, r + Math.floor(rnd() * (mu + 1)));
      for (let c = lo; c <= hi; c++) {
        const v = c === r ? 8 + 4 * rnd() : rnd() - 0.5;
        L.set(r, c, v); dense[r * n + c] = v;
      }
    }
    const b = Float64Array.from({ length: n }, (_, k) => Math.cos(0.7 * k));
    L.factor();
    const x = L.solve(b), ref = solveDense(dense, b, n);
    for (let k = 0; k < n; k++) expect(x[k]).toBeCloseTo(ref[k], 12);
  });

  // A singular system is reported as a SingularMatrixError (callers such as the 1.5D transport step tell it from a
  // programming error by its type); a wrong call stays a plain Error.
  it('every solver reports a singular system as a SingularMatrixError, with its message', () => {
    const f = (v: number[]) => Float64Array.from(v);
    // Thomas: a zero first pivot, and one that only appears in the elimination (beta_1 = 1 − 1·1 = 0)
    expect(() => solveTridiag(f([0, 1, 1]), f([0, 1, 1]), f([1, 1, 0]), f([1, 1, 1]), new Float64Array(3))).toThrow(SingularMatrixError);
    const elim = () => solveTridiag(f([0, 1, 1]), f([1, 1, 1]), f([1, 1, 0]), f([1, 1, 1]), new Float64Array(3));
    expect(elim).toThrow(SingularMatrixError);
    expect(elim).toThrow(/solveTridiag: sıfır pivot/);
    // 2×2 block Thomas: a zero block and a non-finite one
    const n = 2;
    const solveBlocks = (B: Float64Array) => solveBlockTridiag2(new Float64Array(4 * n), B, new Float64Array(4 * n), new Float64Array(2 * n), new Float64Array(2 * n), n);
    const eye = () => f([2, 0, 0, 2, 2, 0, 0, 2]);
    expect(() => solveBlocks(new Float64Array(4 * n))).toThrow(SingularMatrixError);
    const nan = eye(); nan[0] = NaN;
    expect(() => solveBlocks(nan)).toThrow(SingularMatrixError);
    expect(() => solveBlocks(nan)).toThrow(/solveBlockTridiag2: tekil blok/);
    expect(() => solveBlocks(eye())).not.toThrow();
    // dense LU (directly and through solveDense) on [[1, 2], [2, 4]]
    expect(() => luFactor(f([1, 2, 2, 4]), 2)).toThrow(SingularMatrixError);
    expect(() => solveDense(f([1, 2, 2, 4]), f([1, 2]), 2)).toThrow(/luFactor: tekil matris/);
    // banded LU: a zero pivot in row 1, and an infinite one
    const L = new BandedLU(3, 1, 1);
    L.set(0, 0, 1); L.set(1, 1, 0); L.set(2, 2, 1);
    expect(() => L.factor()).toThrow(SingularMatrixError);
    expect(() => L.factor()).toThrow('BandedLU: sıfır pivot (satır 1)');
    const M = new BandedLU(2, 0, 0);
    M.set(0, 0, Infinity); M.set(1, 1, 1);
    expect(() => M.factor()).toThrow(SingularMatrixError);
  });

  it('a wrong call is not a singular system: out-of-band writes and a solve before factor() stay plain errors', () => {
    const L = new BandedLU(3, 1, 1);
    for (const f of [() => L.set(0, 2, 1), () => L.add(2, 0, 1), () => L.solve(new Float64Array(3))]) {
      let err: unknown;
      try { f(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SingularMatrixError);
      expect((err as Error).constructor).toBe(Error);
    }
    expect(new SingularMatrixError('x')).toBeInstanceOf(Error);
    expect(new SingularMatrixError('x').name).toBe('SingularMatrixError');
  });
});

describe('quadrature', () => {
  it('n-point Gauss–Legendre integrates degree 2n−1 polynomials exactly', () => {
    const { w } = gaussLegendre(8);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(2, 14);
    expect(integrateGL((x) => x ** 15 + 3 * x ** 14, -1, 1, 8)).toBeCloseTo(6 / 15, 12);
    expect(integrateGL(Math.exp, 0, 1, 12)).toBeCloseTo(Math.E - 1, 13);
  });
  it('profile nodes give volume averages ∫ f 2ρ dρ', () => {
    const { rho, wt } = profileNodes(10);
    let s = 0, s2 = 0;
    for (let i = 0; i < rho.length; i++) { s += wt[i]; s2 += wt[i] * (1 - rho[i] ** 2) ** 2; }
    expect(s).toBeCloseTo(1, 14);
    expect(s2).toBeCloseTo(1 / 3, 13); // <(1−ρ²)^2> = 1/3
  });
});

describe('interpolation', () => {
  it('clamped cubic spline reproduces a cubic exactly (value, derivative, integral)', () => {
    const f = (x: number) => x ** 3 - 2 * x + 1, df = (x: number) => 3 * x * x - 2;
    const xs = [0, 0.3, 0.7, 1.2, 2.0];
    const s = new CubicSpline(xs, xs.map(f), { d1Start: df(0), d1End: df(2) });
    for (const x of [0.1, 0.55, 1.0, 1.9]) {
      expect(s.eval(x)).toBeCloseTo(f(x), 12);
      expect(s.deriv(x)).toBeCloseTo(df(x), 11);
    }
    expect(s.integral(2)).toBeCloseTo(2 ** 4 / 4 - 4 + 2, 12);
  });
  it('PCHIP is monotone and exact at nodes', () => {
    const xs = [0, 1, 2, 3, 4], ys = [0, 0.1, 0.1, 5, 5.1];
    const p = new Pchip(xs, ys);
    let prev = -Infinity;
    for (let x = 0; x <= 4; x += 0.01) { const v = p.eval(x); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    expect(p.eval(3)).toBeCloseTo(5, 14);
    expect(lerpTable(xs, ys, 2.5)).toBeCloseTo(2.55, 14);
  });
  it('bicubic spline interpolates a smooth field with accurate gradients', () => {
    const F = (x: number, y: number) => Math.exp(-x * x - 2 * y * y) * (1 + 0.3 * x);
    const nx = 41, ny = 61, x0 = -2, y0 = -3, hx = 4 / (nx - 1), hy = 6 / (ny - 1);
    const f = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = F(x0 + i * hx, y0 + j * hy);
    const bi = new Bicubic(f, nx, ny, x0, y0, hx, hy);
    const out = new Float64Array(3);
    for (const [x, y] of [[0.123, -0.456], [-0.7, 0.3], [0.9, 0.05]]) {
      bi.evalGrad(x, y, out);
      const e = 1e-6;
      expect(out[0]).toBeCloseTo(F(x, y), 4);
      expect(out[1]).toBeCloseTo((F(x + e, y) - F(x - e, y)) / (2 * e), 3);
      expect(out[2]).toBeCloseTo((F(x, y + e) - F(x, y - e)) / (2 * e), 3);
    }
  });
});

describe('bicubic spline order of accuracy', () => {
  it('converges at fourth order in value and third order in gradient away from the natural edges', () => {
    const F = (x: number, y: number) => Math.exp(-x * x - 2 * y * y) * (1 + 0.3 * x);
    const Fx = (x: number, y: number) => Math.exp(-x * x - 2 * y * y) * (0.3 - 2 * x * (1 + 0.3 * x));
    const Fy = (x: number, y: number) => -4 * y * F(x, y);
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // interior sample points (≥ 1 from the edges of [−2, 2] × [−3, 3], where f'' ≠ 0 breaks the natural end condition)
    const pts = Array.from({ length: 300 }, () => [-1 + 2 * rnd(), -1.5 + 3 * rnd()]);
    const e0: number[] = [], e1: number[] = [];
    for (const n of [21, 41, 81]) {
      const nx = n, ny = (3 * (n - 1)) / 2 + 1, hx = 4 / (nx - 1), hy = 6 / (ny - 1);
      const f = new Float64Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = F(-2 + i * hx, -3 + j * hy);
      const bi = new Bicubic(f, nx, ny, -2, -3, hx, hy);
      const o = new Float64Array(3);
      let a = 0, b = 0;
      for (const [x, y] of pts) {
        bi.evalGrad(x, y, o);
        a = Math.max(a, Math.abs(o[0] - F(x, y)));
        b = Math.max(b, Math.abs(o[1] - Fx(x, y)), Math.abs(o[2] - Fy(x, y)));
      }
      e0.push(a); e1.push(b);
    }
    for (let i = 0; i < 2; i++) {
      expect(Math.log2(e0[i] / e0[i + 1])).toBeGreaterThan(3.7);
      expect(Math.log2(e1[i] / e1[i + 1])).toBeGreaterThan(2.7);
    }
    expect(e0[2]).toBeLessThan(2e-6);
  });

  it('reproduces bilinear functions exactly (zero second derivatives are natural)', () => {
    const nx = 9, ny = 7;
    const f = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = 1 + 2 * i * 0.5 - 3 * j * 0.25 + 0.7 * (i * 0.5) * (j * 0.25);
    const bi = new Bicubic(f, nx, ny, 0, 0, 0.5, 0.25);
    const o = new Float64Array(3);
    for (const [x, y] of [[0.3, 0.2], [2.1, 1.3], [3.9, 0.05]]) {
      bi.evalGrad(x, y, o);
      expect(o[0]).toBeCloseTo(1 + 2 * x - 3 * y + 0.7 * x * y, 12);
      expect(o[1]).toBeCloseTo(2 + 0.7 * y, 12);
      expect(o[2]).toBeCloseTo(-3 + 0.7 * x, 12);
    }
  });
});

describe('roots', () => {
  it('Brent finds roots to machine precision', () => {
    expect(brent((x) => Math.cos(x) - x, 0, 1)).toBeCloseTo(0.7390851332151607, 14);
    expect(brent((x) => x ** 3 - 2, 0, 2)).toBeCloseTo(Math.cbrt(2), 12);
  });
});

describe('fixed-step integrators (order of accuracy)', () => {
  // y' = −2 t y, y(0) = 1  →  y(1) = e^{−1}
  const rhs = (t: number, y: Float64Array, d: Float64Array) => { d[0] = -2 * t * y[0]; };
  const err = (f: typeof rk4Fixed, n: number) => { const y = Float64Array.of(1); f(rhs, y, 0, 1, n); return Math.abs(y[0] - Math.exp(-1)); };
  it('classical RK4 converges at fourth order', () => {
    expect(Math.log2(err(rk4Fixed, 20) / err(rk4Fixed, 40))).toBeCloseTo(4, 0);
  });
  it('explicit Euler converges at first order', () => {
    expect(Math.log2(err(eulerFixed, 200) / err(eulerFixed, 400))).toBeCloseTo(1, 1);
  });
});

describe('Anderson acceleration', () => {
  // linear contraction G(x) = A x + b, A = 0.95·(symmetric tridiagonal with spectrum in (−1, 1))
  const n = 40;
  const G = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const l = i > 0 ? x[i - 1] : 0, r = i < n - 1 ? x[i + 1] : 0;
      out[i] = 0.95 * (0.5 * x[i] + 0.25 * (l + r)) + Math.sin(i);
    }
    return out;
  };
  const iterate = (depth: number, beta: number, maxIt = 5000) => {
    const acc = new AndersonMixer(n, depth);
    const x = new Float64Array(n), g = new Float64Array(n);
    for (let it = 1; it <= maxIt; it++) {
      G(x, g);
      let r = 0;
      for (let i = 0; i < n; i++) r = Math.max(r, Math.abs(g[i] - x[i]));
      if (r < 1e-11) return { it, x: g };
      acc.step(x, g, beta);
    }
    return { it: Infinity, x };
  };

  it('depth 0 is damped Picard iteration', () => {
    const acc = new AndersonMixer(3, 0);
    const x = Float64Array.of(1, 2, 3), g = Float64Array.of(2, 2, 5);
    acc.step(x, g, 0.5);
    expect(Array.from(x)).toEqual([1.5, 2, 4]);
  });

  it('reaches the same fixed point as Picard in far fewer iterations', () => {
    const plain = iterate(0, 1), aa = iterate(4, 1);
    expect(plain.it).toBeGreaterThan(200);
    expect(aa.it).toBeLessThan(plain.it / 3);
    for (let i = 0; i < n; i++) expect(aa.x[i]).toBeCloseTo(plain.x[i], 9);
  });

  it('works with damping and after a reset', () => {
    const ref = iterate(0, 1).x;
    const acc = new AndersonMixer(n, 3);
    const x = new Float64Array(n), g = new Float64Array(n);
    let it = 0, r = Infinity;
    while (r > 1e-11 && it++ < 2000) {
      G(x, g);
      r = 0;
      for (let i = 0; i < n; i++) r = Math.max(r, Math.abs(g[i] - x[i]));
      if (it === 10) acc.reset();
      acc.step(x, g, 0.7);
    }
    expect(it).toBeLessThan(200);
    for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(ref[i], 9);
  });
});
