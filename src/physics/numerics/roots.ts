/**
 * Kök bulma: Brent yöntemi (ters kuadratik interpolasyon + sekant + ikiye bölme güvencesi).
 * Kaynak: R. P. Brent, "Algorithms for Minimization without Derivatives" (1973), Böl. 4.
 */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxIter = 100): number {
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) throw new Error(`brent: kök sarılmamış [${a}, ${b}] → (${fa}, ${fb})`);
  let c = a, fc = fa, d = b - a, e = d;
  for (let it = 0; it < maxIter; it++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) { p = 2 * xm * s; q = 1 - s; }
      else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = xm; e = d; }
    } else { d = xm; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** Monoton artan g için g(x) = target çözümü [lo, hi] içinde (sarılmıyorsa uç değer). */
export function invertMonotone(g: (x: number) => number, target: number, lo: number, hi: number, tol = 1e-12): number {
  const glo = g(lo) - target, ghi = g(hi) - target;
  if (glo >= 0) return lo;
  if (ghi <= 0) return hi;
  return brent((x) => g(x) - target, lo, hi, tol);
}
