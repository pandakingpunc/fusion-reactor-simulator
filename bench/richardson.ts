/**
 * Richardson extrapolation from three resolutions, for bench/convergence.ts.
 *
 * With f(h) = f₀ + C·h^p and three step sizes h₁ > h₂ > h₃ (any ratios), the observed order p solves
 *   (h₁^p − h₂^p) / (h₂^p − h₃^p) = (f₁ − f₂) / (f₂ − f₃),
 * the extrapolated value is f₀ = f₃ − (f₂ − f₃)·h₃^p / (h₂^p − h₃^p), and |f₃ − f₀| estimates the
 * discretisation error of the finest result. The grid convergence index of the finest result is
 * GCI = F_s·|(f₂ − f₃)/f₃| / (r^p − 1), r = h₂/h₃, with safety factor F_s = 1.25.
 * L.F. Richardson, Phil. Trans. R. Soc. A 210 (1911) 307, doi:10.1098/rsta.1911.0009;
 * P.J. Roache, "Quantification of uncertainty in computational fluid dynamics", Annu. Rev. Fluid
 * Mech. 29 (1997) 123, doi:10.1146/annurev.fluid.29.1.123.
 *
 * When the differences change sign (oscillatory convergence) or no order in [P_MIN, P_MAX] fits,
 * the results are not in the asymptotic range: p and f₀ are NaN and the error estimate falls back to
 * the larger of the two differences, a conservative bound.
 */
export const P_MIN = 0.05;
export const P_MAX = 10;
const FS = 1.25;

export type ConvergenceKind = 'monotone' | 'oscillatory' | 'converged' | 'no-fit';

export interface Richardson {
  kind: ConvergenceKind;
  /** observed order of accuracy */
  p: number;
  /** extrapolated value at h → 0 */
  extrapolated: number;
  /** estimated absolute error of the finest result f₃ */
  error: number;
  /** grid convergence index of f₃ (relative) */
  gci: number;
}

/** h: step sizes, largest first (h₁ > h₂ > h₃); f: results at those step sizes. */
export function richardson(h: readonly [number, number, number], f: readonly [number, number, number]): Richardson {
  const [h1, h2, h3] = h;
  const [f1, f2, f3] = f;
  if (!(h1 > h2 && h2 > h3 && h3 > 0)) throw new Error(`step sizes must satisfy h1 > h2 > h3 > 0, got ${h.join(', ')}`);
  const d12 = f1 - f2, d23 = f2 - f3;
  const fallback = (kind: ConvergenceKind): Richardson => {
    const error = Math.max(Math.abs(d12), Math.abs(d23));
    return { kind, p: NaN, extrapolated: NaN, error, gci: f3 !== 0 ? (3 * error) / Math.abs(f3) : NaN };
  };
  if (![f1, f2, f3].every(Number.isFinite)) return { kind: 'no-fit', p: NaN, extrapolated: NaN, error: NaN, gci: NaN };
  if (d12 === 0 && d23 === 0) return { kind: 'converged', p: NaN, extrapolated: f3, error: 0, gci: 0 };
  if (d23 === 0 || d12 === 0 || Math.sign(d12) !== Math.sign(d23)) return fallback(d23 === 0 || d12 === 0 ? 'no-fit' : 'oscillatory');
  const target = d12 / d23;
  const g = (p: number) => (h1 ** p - h2 ** p) / (h2 ** p - h3 ** p) - target;
  let lo = P_MIN, hi = P_MAX;
  let glo = g(lo);
  const ghi = g(hi);
  if (Math.sign(glo) === Math.sign(ghi)) return fallback('no-fit');
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = 0.5 * (lo + hi);
    const gm = g(mid);
    if (Math.sign(gm) === Math.sign(glo)) { lo = mid; glo = gm; } else hi = mid;
  }
  const p = 0.5 * (lo + hi);
  const corr = (d23 * h3 ** p) / (h2 ** p - h3 ** p);
  const extrapolated = f3 - corr;
  const r = h2 / h3;
  return { kind: 'monotone', p, extrapolated, error: Math.abs(corr), gci: f3 !== 0 ? (FS * Math.abs(d23 / f3)) / (r ** p - 1) : NaN };
}
