/**
 * Property tests of the numerical kernels (src/physics/numerics, src/physics/integrator.ts).
 *  - linear solvers against dense Gaussian elimination with partial pivoting written here (Golub & Van
 *    Loan, "Matrix Computations", 4th ed., Alg. 3.4.1) on random diagonally dominant systems;
 *  - Gauss–Legendre exactness degree 2n − 1 and the classical remainder for x^{2n}
 *    (Abramowitz & Stegun 25.4.30: E = 2^{2n+1} (n!)^4 / ((2n+1) ((2n)!)^2) for f = x^{2n});
 *  - spline reproduction (a clamped cubic spline is exact for cubics — de Boor, "A Practical Guide to
 *    Splines", Ch. IV), PCHIP monotonicity (Fritsch & Carlson, SIAM J. Numer. Anal. 17 (1980) 238);
 *  - Brent root bracketing (R.P. Brent, "Algorithms for Minimization without Derivatives", 1973, Ch. 4).
 */
import { describe, expect, it } from 'vitest';
import { BandedLU, luFactor, luSolve, solveBlockTridiag2, solveDense, solveTridiag } from '../numerics/linalg';
import { gaussLegendre, integrateGL, profileNodes } from '../numerics/quadrature';
import { Bicubic, CubicSpline, Pchip, findInterval, lerpTable } from '../numerics/interp';
import { brent, invertMonotone } from '../numerics/roots';
import { DormandPrince } from '../integrator';
import { Rand, forAll, gen, mulberry32 } from '../../testing/prop';
import { INTEGRATOR_FIXED, pinUntil } from '../../testing/knownBugs';

/** dense Gaussian elimination with partial pivoting; A row-major n×n (copied) */
function gauss(A: ArrayLike<number>, b: ArrayLike<number>, n: number): Float64Array {
  const M = Float64Array.from(A), x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i * n + k]) > Math.abs(M[p * n + k])) p = i;
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = M[k * n + j]; M[k * n + j] = M[p * n + j]; M[p * n + j] = t; }
      const t = x[k]; x[k] = x[p]; x[p] = t;
    }
    for (let i = k + 1; i < n; i++) {
      const l = M[i * n + k] / M[k * n + k];
      for (let j = k; j < n; j++) M[i * n + j] -= l * M[k * n + j];
      x[i] -= l * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return x;
}

const maxAbs = (v: ArrayLike<number>) => { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m; };
const expectClose = (got: ArrayLike<number>, ref: ArrayLike<number>, tol: number, what: string) => {
  const scale = Math.max(maxAbs(ref), 1e-300);
  for (let i = 0; i < ref.length; i++) if (Math.abs(got[i] - ref[i]) > tol * scale) expect.fail(`${what}[${i}]: ${got[i]} vs ${ref[i]}`);
};

/** a system is drawn from its own seed so that shrinking the seed/size keeps it reproducible */
const system = gen.record({ n: gen.int(1, 40), seed: gen.int(1, 2 ** 31 - 1), margin: gen.logFloat(0.05, 10) });
const sym = (r: Rand) => 2 * r() - 1;

describe('linear solvers vs dense Gaussian elimination', () => {
  it('Thomas algorithm (tridiagonal)', () => {
    forAll(system, ({ n, seed, margin }) => {
      const r = mulberry32(seed);
      const a = Float64Array.from({ length: n }, () => (sym(r) * 5)), c = Float64Array.from({ length: n }, () => (sym(r) * 5));
      a[0] = 0; c[n - 1] = 0;
      const b = Float64Array.from({ length: n }, (_, i) => (r() < 0.5 ? -1 : 1) * (Math.abs(a[i]) + Math.abs(c[i]) + margin));
      const d = Float64Array.from({ length: n }, () => sym(r) * 10);
      const A = new Float64Array(n * n);
      for (let i = 0; i < n; i++) { A[i * n + i] = b[i]; if (i > 0) A[i * n + i - 1] = a[i]; if (i < n - 1) A[i * n + i + 1] = c[i]; }
      expectClose(solveTridiag(a, b, c, d, new Float64Array(n)), gauss(A, d, n), 1e-10, 'x');
    }, { runs: 150, label: 'Thomas' });
  });

  it('2×2 block tridiagonal solver', () => {
    forAll(system, ({ n, seed, margin }) => {
      const r = mulberry32(seed), N = 2 * n;
      const A = Float64Array.from({ length: 4 * n }, () => sym(r)), C = Float64Array.from({ length: 4 * n }, () => sym(r));
      const B = Float64Array.from({ length: 4 * n }, () => sym(r));
      const dense = new Float64Array(N * N);
      for (let i = 0; i < n; i++) {
        if (i === 0) A.fill(0, 0, 4);
        if (i === n - 1) C.fill(0, 4 * i, 4 * i + 4);
        // row dominance of the scalar matrix: |B_rr| > Σ other |entries| of the row
        for (let row = 0; row < 2; row++) {
          const off = [A[4 * i + 2 * row], A[4 * i + 2 * row + 1], C[4 * i + 2 * row], C[4 * i + 2 * row + 1], B[4 * i + 2 * row + 1 - row]]
            .reduce((s, v) => s + Math.abs(v), 0);
          B[4 * i + 3 * row] = (r() < 0.5 ? -1 : 1) * (off + margin);
        }
        const put = (blk: Float64Array, j: number) => {
          if (j < 0 || j >= n) return;
          dense[2 * i * N + 2 * j] = blk[4 * i]; dense[2 * i * N + 2 * j + 1] = blk[4 * i + 1];
          dense[(2 * i + 1) * N + 2 * j] = blk[4 * i + 2]; dense[(2 * i + 1) * N + 2 * j + 1] = blk[4 * i + 3];
        };
        put(A, i - 1); put(B, i); put(C, i + 1);
      }
      const d = Float64Array.from({ length: N }, () => sym(r) * 10);
      expectClose(solveBlockTridiag2(A, B, C, d, new Float64Array(N), n), gauss(dense, d, N), 1e-10, 'u');
    }, { runs: 150, label: 'block tridiagonal' });
  });

  it('banded LU (pivot-free) and its matrix–vector product', () => {
    forAll(gen.tuple(system, gen.int(0, 5), gen.int(0, 5)), ([{ n, seed, margin }, ml, mu]) => {
      const r = mulberry32(seed);
      const L = new BandedLU(n, ml, mu), A = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        let off = 0;
        for (let j = Math.max(0, i - ml); j <= Math.min(n - 1, i + mu); j++) {
          if (j === i) continue;
          const v = sym(r) * 3; L.set(i, j, v); A[i * n + j] = v; off += Math.abs(v);
        }
        const dgn = (r() < 0.5 ? -1 : 1) * (off + margin);
        L.set(i, i, dgn); A[i * n + i] = dgn;
      }
      const x0 = Float64Array.from({ length: n }, () => sym(r));
      const b = L.mul(x0, new Float64Array(n));
      const bRef = new Float64Array(n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) bRef[i] += A[i * n + j] * x0[j];
      expectClose(b, bRef, 1e-14, 'Ax');
      L.factor();
      expectClose(L.solve(b), gauss(A, b, n), 1e-10, 'x');
    }, { runs: 150, label: 'banded LU' });
  });

  it('dense LU with partial pivoting on general random matrices (small residual)', () => {
    forAll(system, ({ n, seed }) => {
      const r = mulberry32(seed);
      const A = Float64Array.from({ length: n * n }, () => sym(r));
      for (let i = 0; i < n; i++) A[i * n + i] += 0.5 * sym(r); // not dominant: pivoting matters
      const b = Float64Array.from({ length: n }, () => sym(r));
      let x: Float64Array;
      try { x = solveDense(A, b, n); } catch { return; } // exactly singular draws are skipped
      const res = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = -b[i]; for (let j = 0; j < n; j++) s += A[i * n + j] * x[j]; res[i] = s; }
      expect(maxAbs(res)).toBeLessThan(1e-9 * Math.max(1, maxAbs(x)) * n);
      const M = Float64Array.from(A), piv = luFactor(M, n);
      expectClose(luSolve(M, n, piv, b), x, 1e-12, 'luSolve');
    }, { runs: 150, label: 'dense LU' });
  });
});

describe('Gauss–Legendre quadrature', () => {
  const exact = (k: number) => (k % 2 ? 0 : 2 / (k + 1)); // ∫_{−1}^{1} x^k dx
  const quad = (n: number, k: number) => { const { x, w } = gaussLegendre(n); let s = 0; for (let i = 0; i < n; i++) s += w[i] * x[i] ** k; return s; };
  const factorial = (m: number) => { let f = 1; for (let i = 2; i <= m; i++) f *= i; return f; };

  it('n points integrate x^k exactly for k ≤ 2n − 1 (n = 1 … 24); nodes symmetric, weights positive, Σw = 2', () => {
    for (let n = 1; n <= 24; n++) {
      const { x, w } = gaussLegendre(n);
      expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(2, 13);
      for (let i = 0; i < n; i++) {
        expect(w[i]).toBeGreaterThan(0);
        expect(Math.abs(x[i])).toBeLessThan(1);
        expect(x[i] + x[n - 1 - i]).toBeCloseTo(0, 14);
        if (i > 0) expect(x[i]).toBeGreaterThan(x[i - 1]);
      }
      for (let k = 0; k <= 2 * n - 1; k++) expect(Math.abs(quad(n, k) - exact(k)), `n=${n}, k=${k}`).toBeLessThan(1e-13);
    }
  });

  it('degree 2n is the first inexact one, with the classical remainder 2^{2n+1}(n!)^4/((2n+1)((2n)!)^2)', () => {
    for (let n = 1; n <= 10; n++) {
      const E = (2 ** (2 * n + 1) * factorial(n) ** 4) / ((2 * n + 1) * factorial(2 * n) ** 2);
      expect(Math.abs((exact(2 * n) - quad(n, 2 * n)) / E - 1), `n=${n}`).toBeLessThan(1e-6);
    }
  });

  it('integrateGL on [a, b] is exact for random polynomials of degree ≤ 2n − 1', () => {
    forAll(gen.record({ n: gen.int(1, 16), seed: gen.int(1, 2 ** 31 - 1), a: gen.float(-3, 3), len: gen.float(0.1, 4) }), ({ n, seed, a, len }) => {
      const r = mulberry32(seed), b = a + len;
      const c = Array.from({ length: 2 * n }, () => sym(r));
      const p = (x: number) => c.reduce((s, ck, k) => s + ck * x ** k, 0);
      const P = (x: number) => c.reduce((s, ck, k) => s + (ck * x ** (k + 1)) / (k + 1), 0);
      const ref = P(b) - P(a);
      expect(Math.abs(integrateGL(p, a, b, n) - ref)).toBeLessThan(1e-11 * Math.max(1, Math.abs(ref), maxAbs(c) * Math.max(1, Math.abs(a), Math.abs(b)) ** (2 * n)));
    }, { runs: 150 });
  });

  it('profileNodes volume-average polynomials in ρ of degree ≤ 2n − 2 exactly', () => {
    for (let n = 1; n <= 16; n++) {
      const { rho, wt } = profileNodes(n);
      for (let k = 0; k <= 2 * n - 2; k++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += wt[i] * rho[i] ** k;
        expect(s, `n=${n}, ρ^${k}`).toBeCloseTo(2 / (k + 2), 13); // ∫₀¹ ρ^k 2ρ dρ
      }
    }
  });
});

describe('interpolation', () => {
  const knots = gen.record({ n: gen.int(2, 12), seed: gen.int(1, 2 ** 31 - 1) });
  const drawKnots = (n: number, r: Rand) => {
    const xs = [sym(r) * 5];
    for (let i = 1; i < n; i++) xs.push(xs[i - 1] + 0.05 + 2 * r());
    return xs;
  };

  /** random cubic on random knots and its clamped spline (exact end slopes) */
  const cubicCase = (n: number, seed: number) => {
    const r = mulberry32(seed);
    const xs = drawKnots(n, r);
    const [c0, c1, c2, c3] = [sym(r), sym(r), sym(r), sym(r)].map((v) => v * 3);
    const f = (x: number) => c0 + x * (c1 + x * (c2 + x * c3));
    const df = (x: number) => c1 + x * (2 * c2 + 3 * c3 * x);
    const F = (x: number) => x * (c0 + x * (c1 / 2 + x * (c2 / 3 + (x * c3) / 4)));
    const s = new CubicSpline(xs, xs.map(f), { d1Start: df(xs[0]), d1End: df(xs[xs.length - 1]) });
    const scale = 1 + Math.abs(c3) * 1e3 + Math.abs(c2) * 100 + Math.abs(c1) * 10 + Math.abs(c0);
    return { xs, f, df, F, s, scale };
  };

  it('clamped cubic spline reproduces any cubic exactly (value, derivative, integral)', () => {
    forAll(knots, ({ n, seed }) => {
      const { xs, f, df, F, s, scale } = cubicCase(Math.max(n, 3), seed); // n = 2: see the BUG below
      for (let k = 0; k <= 20; k++) {
        const x = xs[0] + ((xs[xs.length - 1] - xs[0]) * k) / 20;
        expect(Math.abs(s.eval(x) - f(x))).toBeLessThan(1e-10 * scale);
        expect(Math.abs(s.deriv(x) - df(x))).toBeLessThan(1e-9 * scale);
        expect(Math.abs(s.integral(x) - (F(x) - F(xs[0])))).toBeLessThan(1e-9 * scale);
      }
    }, { runs: 150, label: 'clamped spline' });
  });

  // BUG(ws2a): with exactly two knots CubicSpline returns before using the boundary conditions
  // (`if (n === 2) return;` leaves M = 0), so a clamped two-knot spline is a straight line and
  // silently ignores d1Start/d1End (documented as "clamped ends when given"); the Hermite cubic is
  // the correct result. Latent unless a caller builds a 2-point clamped spline.
  it.fails('a two-knot clamped spline honours its end slopes (BUG(ws2a): n = 2 ignores d1Start/d1End)', () => {
    const { xs, f, s, scale } = cubicCase(2, 12345);
    const xm = 0.5 * (xs[0] + xs[1]);
    expect(Math.abs(s.eval(xm) - f(xm))).toBeLessThan(1e-10 * scale);
  });

  it('natural spline and PCHIP interpolate the knots and reproduce straight lines; lerpTable too', () => {
    forAll(gen.tuple(knots, gen.float(-5, 5), gen.float(-5, 5)), ([{ n, seed }, p, q]) => {
      const r = mulberry32(seed);
      const xs = drawKnots(Math.max(n, 3), r), ys = xs.map(() => sym(r) * 4);
      const s = new CubicSpline(xs, ys), h = new Pchip(xs, ys);
      xs.forEach((x, i) => { expect(s.eval(x)).toBeCloseTo(ys[i], 11); expect(h.eval(x)).toBeCloseTo(ys[i], 11); });
      const line = xs.map((x) => p + q * x);
      const sl = new CubicSpline(xs, line), hl = new Pchip(xs, line);
      for (let k = 0; k <= 10; k++) {
        const x = xs[0] + ((xs[xs.length - 1] - xs[0]) * k) / 10;
        expect(sl.eval(x)).toBeCloseTo(p + q * x, 10);
        expect(hl.eval(x)).toBeCloseTo(p + q * x, 10);
        expect(lerpTable(xs, line, x)).toBeCloseTo(p + q * x, 10);
        const i = findInterval(xs, x);
        expect(xs[i] <= x + 1e-12 && x <= xs[i + 1] + 1e-12).toBe(true);
      }
      expect(lerpTable(xs, line, xs[0] - 1)).toBe(line[0]);
      expect(lerpTable(xs, line, xs[xs.length - 1] + 1)).toBe(line[line.length - 1]);
    }, { runs: 150 });
  });

  it('PCHIP preserves monotone data (no overshoot between knots)', () => {
    forAll(knots, ({ n, seed }) => {
      const r = mulberry32(seed);
      const xs = drawKnots(Math.max(n, 3), r);
      const ys = [sym(r)];
      for (let i = 1; i < xs.length; i++) ys.push(ys[i - 1] + (r() < 0.3 ? 0 : r() * 3)); // flat steps included
      const h = new Pchip(xs, ys);
      let prev = -Infinity, bad = '';
      for (let k = 0; k <= 300 && !bad; k++) {
        const x = xs[0] + ((xs[xs.length - 1] - xs[0]) * k) / 300;
        const v = h.eval(x), i = findInterval(xs, x);
        if (v < prev - 1e-12) bad = `decreases at x = ${x}`;
        else if (v < Math.min(ys[i], ys[i + 1]) - 1e-12 || v > Math.max(ys[i], ys[i + 1]) + 1e-12) bad = `overshoots at x = ${x}`;
        prev = v;
      }
      expect(bad).toBe('');
    }, { runs: 150, label: 'PCHIP monotone' });
  });

  it('natural bicubic spline reproduces bilinear fields and their gradients exactly', () => {
    forAll(gen.record({ nx: gen.int(3, 12), ny: gen.int(3, 12), a: gen.float(-3, 3), b: gen.float(-3, 3), c: gen.float(-3, 3), d: gen.float(-3, 3), u: gen.float(0, 1), v: gen.float(0, 1) }),
      ({ nx, ny, a, b, c, d, u, v }) => {
        const x0 = -1, y0 = 2, hx = 0.3, hy = 0.7;
        const F = (x: number, y: number) => a + b * x + c * y + d * x * y;
        const f = new Float64Array(nx * ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = F(x0 + i * hx, y0 + j * hy);
        const bi = new Bicubic(f, nx, ny, x0, y0, hx, hy);
        const x = x0 + u * (nx - 1) * hx, y = y0 + v * (ny - 1) * hy;
        const g = bi.evalGrad(x, y, new Float64Array(3));
        expect(g[0]).toBeCloseTo(F(x, y), 10);
        expect(g[1]).toBeCloseTo(b + d * y, 9);
        expect(g[2]).toBeCloseTo(c + d * x, 9);
      }, { runs: 150 });
  });
});

describe('Brent root finder', () => {
  it('returns the bracketed root to tolerance and never leaves the bracket', () => {
    forAll(gen.record({ root: gen.float(-10, 10), lo: gen.float(0.01, 5), hi: gen.float(0.01, 5), kind: gen.int(0, 3), s: gen.float(0.1, 5) }), ({ root, lo, hi, kind, s }) => {
      const fs = [
        (x: number) => x - root,
        (x: number) => (x - root) * (1 + (x - root) ** 2) * s,
        (x: number) => Math.exp(s * (x - root)) - 1,
        (x: number) => Math.cbrt(x - root) * s,
      ];
      const f = fs[kind];
      const a = root - lo, b = root + hi;
      const x = brent(f, a, b, 1e-12);
      expect(x).toBeGreaterThanOrEqual(a);
      expect(x).toBeLessThanOrEqual(b);
      expect(Math.abs(x - root)).toBeLessThan(1e-9 * Math.max(1, Math.abs(root)));
      expect(() => brent(f, root + 0.5 * hi, b, 1e-12)).toThrow(); // same sign at both ends
    }, { runs: 300, label: 'brent' });
  });

  it('invertMonotone solves g(x) = target and clamps outside the range', () => {
    forAll(gen.record({ p: gen.float(0.5, 4), t: gen.float(-1, 20) }), ({ p, t }) => {
      const g = (x: number) => x ** p; // increasing on [0, 2]
      const x = invertMonotone(g, t, 0, 2);
      if (t <= 0) expect(x).toBe(0);
      else if (t >= 2 ** p) expect(x).toBe(2);
      else expect(Math.abs(g(x) - t)).toBeLessThan(1e-10 * Math.max(1, t));
    }, { runs: 200 });
  });
});

describe('Dormand–Prince integrator', () => {
  it('meets the requested tolerance on exponential decay', () => {
    forAll(gen.record({ k: gen.logFloat(0.1, 100), rtol: gen.logFloat(1e-10, 1e-4) }), ({ k, rtol }) => {
      const dp = new DormandPrince(1, (_t, y, d) => { d[0] = -k * y[0]; }, { rtol, atol: 1e-14, dtMin: 1e-12, dtMax: 1 }, 1e-3);
      const y = Float64Array.of(1);
      let t = 0;
      const T = 3 / k;
      while (t < T - 1e-15) t = dp.step(t, y, T);
      expect(Math.abs(y[0] / Math.exp(-k * T) - 1)).toBeLessThan(200 * rtol);
    }, { runs: 60 });
  });

  // BUG(ws2a): integrator.ts `if (nn === true) for (…) if (y[i] < 0) y[i] = 0; else if (Array.isArray(nn)) …`
  // — the dangling `else` binds to the inner `if (y[i] < 0)`, so an index list (nonNegative: number[],
  // documented in IntegratorOptions) never clamps anything. Latent: every model passes `true` today.
  // Fixed by ws5 in dafd2bf (on v4/integration); with that integrator the pin runs as a plain test.
  pinUntil(INTEGRATOR_FIXED)('nonNegative as an index list clamps the listed components (BUG(ws2a): dangling else)', () => {
    // y0' = −1 from y0 = 1e-3 over a step of 0.01 goes negative; component 0 is listed as non-negative
    const dp = new DormandPrince(2, (_t, _y, d) => { d[0] = -1; d[1] = -1; }, { rtol: 1e-6, atol: 1e-9, dtMin: 1e-3, dtMax: 0.01, nonNegative: [0] }, 0.01);
    const y = Float64Array.of(1e-3, 1e-3);
    dp.step(0, y, 0.01);
    expect(y[0]).toBe(0);
    expect(y[1]).toBeLessThan(0);
  });

  // BUG(ws2a): when a trial step makes the RHS non-finite (here y^{3/2} of a negative intermediate
  // stage; in the 0D magnetic model (Σ n Z²/A)^{2/3} of a negative density), the error norm is NaN and
  // `h * Math.max(0.1, 0.9 * Math.pow(err, -0.25))` is NaN: the step size never shrinks, the loop gives up
  // after 30 tries, accepts the NaN state and returns t = NaN. Simulation.advance() then stops silently
  // with a NaN state (found by wizardSmoke.test.ts). Rejecting non-finite stages with h ← h/10 fixes it.
  // Fixed by ws5 in dafd2bf (on v4/integration); with that integrator the pin runs as a plain test.
  pinUntil(INTEGRATOR_FIXED)('recovers from trial steps whose stages leave the RHS domain (BUG(ws2a): NaN step size)', () => {
    const dp = new DormandPrince(1, (_t, y, d) => { d[0] = -1e4 * Math.pow(y[0], 1.5); }, { rtol: 1e-6, atol: 1e-12, dtMin: 1e-9, dtMax: 1 }, 1);
    const y = Float64Array.of(1);
    const t = dp.step(0, y, 1);
    expect(Number.isFinite(t) && t > 0).toBe(true);
    expect(Number.isFinite(y[0]) && y[0] >= 0).toBe(true);
    expect(Number.isFinite(dp.dt)).toBe(true);
  });
});
