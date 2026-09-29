/**
 * Nelder-Mead simplex minimiser for box-bounded, derivative-free problems.
 *
 * J. A. Nelder & R. Mead, "A simplex method for function minimization", Comput. J. 7 (1965) 308-313, in the well-defined form
 * of J. C. Lagarias, J. A. Reeds, M. H. Wright & P. E. Wright, SIAM J. Optim. 9 (1998) 112-147: reflection, expansion, outside
 * and inside contraction, shrink, with the coefficients reflection 1, expansion 2, contraction 1/2, shrink 1/2. With
 * `adaptive` the coefficients depend on the dimension n (F. Gao & L. Han, "Implementing the Nelder-Mead simplex algorithm with
 * adaptive parameters", Comput. Optim. Appl. 51 (2012) 259-277): expansion 1 + 2/n, contraction 3/4 - 1/(2n), shrink 1 - 1/n, which
 * avoids the collapse of the simplex in higher dimensions.
 *
 * Bounds are handled by projection: every trial point is clipped into the box (the method SciPy uses). A simplex flattened onto
 * a face of the box can stall, and Nelder-Mead can converge to a non-stationary point in any case (McKinnon 1998), so the
 * minimiser restarts from the best point with a fresh, smaller simplex until a restart no longer improves the value
 * (the remedy of C. T. Kelley, SIAM J. Optim. 10 (1999) 43-55).
 *
 * A non-finite objective value counts as +Infinity, so a failed evaluation is simply a bad point.
 * Pure TypeScript, no DOM or Node API.
 */

export interface OptimResult {
  x: number[];
  f: number;
  /** objective evaluations */
  evals: number;
  /** simplex iterations over all restarts */
  iterations: number;
  converged: boolean;
  /** why it stopped: 'tolerance', 'maxEvals' or 'no improvement' */
  reason: string;
}

export interface NelderMeadOptions {
  lower?: readonly number[];
  upper?: readonly number[];
  /** edge of the initial simplex per coordinate (a number for all): default 10 % of the box width, or 5 % of |x0| (at least 1e-4) without bounds */
  step?: number | readonly number[];
  /** budget of objective evaluations (default 500 n, counted over all restarts) */
  maxEvals?: number;
  /** stop when the simplex is smaller than xTol (relative to 1 + |x|) in every coordinate ... (default 1e-9) */
  xTol?: number;
  /** ... and the values of its vertices differ by less than fTol (relative to 1 + |f|) (default 1e-12) */
  fTol?: number;
  /** dimension-dependent coefficients (default: only for n >= 5) */
  adaptive?: boolean;
  /** maximum number of restarts after the first run (default 4) */
  restarts?: number;
  /** each restart starts with the edge multiplied by this (default 0.5) */
  restartShrink?: number;
}

const safe = (v: number): number => (Number.isFinite(v) ? v : Infinity);

function initialSteps(x0: readonly number[], o: NelderMeadOptions): number[] {
  return x0.map((x, i) => {
    if (o.step !== undefined) return typeof o.step === 'number' ? o.step : o.step[i];
    const lo = o.lower?.[i] ?? -Infinity, hi = o.upper?.[i] ?? Infinity;
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return 0.1 * (hi - lo);
    return Math.max(0.05 * Math.abs(x), 1e-4);
  });
}

/** Minimises f over the box [lower, upper] starting from x0. */
export function nelderMead(f: (x: number[]) => number, x0: readonly number[], opts: NelderMeadOptions = {}): OptimResult {
  const n = x0.length;
  if (n < 1) throw new RangeError('nelderMead: needs at least one variable');
  const lo = Array.from({ length: n }, (_, i) => opts.lower?.[i] ?? -Infinity);
  const hi = Array.from({ length: n }, (_, i) => opts.upper?.[i] ?? Infinity);
  for (let i = 0; i < n; i++) if (!(hi[i] >= lo[i])) throw new RangeError(`nelderMead: upper[${i}] < lower[${i}]`);
  const clip = (x: number[]): number[] => x.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i]));
  const maxEvals = opts.maxEvals ?? 500 * n;
  const xTol = opts.xTol ?? 1e-9, fTol = opts.fTol ?? 1e-12;
  const adaptive = opts.adaptive ?? n >= 5;
  const chi = adaptive ? 1 + 2 / n : 2, gam = adaptive ? 0.75 - 1 / (2 * n) : 0.5, sig = adaptive ? 1 - 1 / n : 0.5;
  let evals = 0, iterations = 0;
  const fe = (x: number[]): number => { evals++; return safe(f(x)); };

  let best = clip([...x0]);
  let fbest = fe(best);
  let steps = initialSteps(x0, opts);
  let reason = 'no improvement';
  let converged = false;
  const maxRestarts = opts.restarts ?? 4;

  for (let run = 0; run <= maxRestarts; run++) {
    // simplex around the best point; a step that would leave the box goes the other way
    const X: number[][] = [best];
    const F: number[] = [fbest];
    for (let i = 0; i < n; i++) {
      const p = [...best];
      p[i] = best[i] + steps[i] <= hi[i] ? best[i] + steps[i] : best[i] - steps[i];
      const q = clip(p);
      if (q[i] === best[i]) q[i] = best[i] + (hi[i] > best[i] ? Math.min(steps[i], hi[i] - best[i]) : -Math.min(steps[i], best[i] - lo[i]));
      X.push(q); F.push(fe(q));
    }
    const start = fbest;
    let runConverged = false;
    while (evals < maxEvals) {
      iterations++;
      const order = X.map((_, k) => k).sort((a, b) => F[a] - F[b]);
      const Xs = order.map((k) => X[k]), Fs = order.map((k) => F[k]);
      for (let k = 0; k <= n; k++) { X[k] = Xs[k]; F[k] = Fs[k]; }
      // convergence: small simplex in x and a flat function
      let dx = 0;
      for (let k = 1; k <= n; k++) for (let i = 0; i < n; i++) dx = Math.max(dx, Math.abs(X[k][i] - X[0][i]) / (1 + Math.abs(X[0][i])));
      const df = Math.abs(F[n] - F[0]) / (1 + Math.abs(F[0]));
      if (dx <= xTol && (df <= fTol || !Number.isFinite(F[n]))) { runConverged = true; break; }
      // centroid of the n best points
      const c = new Array<number>(n).fill(0);
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) c[i] += X[k][i] / n;
      const xw = X[n];
      const xr = clip(c.map((v, i) => v + (v - xw[i])));
      const fr = fe(xr);
      if (fr < F[0]) {
        const xe = clip(c.map((v, i) => v + chi * (xr[i] - v)));
        const fx = fe(xe);
        if (fx < fr) { X[n] = xe; F[n] = fx; } else { X[n] = xr; F[n] = fr; }
      } else if (fr < F[n - 1]) {
        X[n] = xr; F[n] = fr;
      } else {
        let shrink = false;
        if (fr < F[n]) { // outside contraction
          const xc = clip(c.map((v, i) => v + gam * (xr[i] - v)));
          const fc = fe(xc);
          if (fc <= fr) { X[n] = xc; F[n] = fc; } else shrink = true;
        } else { // inside contraction
          const xc = clip(c.map((v, i) => v - gam * (v - xw[i])));
          const fc = fe(xc);
          if (fc < F[n]) { X[n] = xc; F[n] = fc; } else shrink = true;
        }
        if (shrink) {
          for (let k = 1; k <= n; k++) {
            X[k] = clip(X[k].map((v, i) => X[0][i] + sig * (v - X[0][i])));
            F[k] = fe(X[k]);
          }
        }
      }
    }
    // best vertex of this run
    let kb = 0;
    for (let k = 1; k <= n; k++) if (F[k] < F[kb]) kb = k;
    if (F[kb] < fbest) { best = X[kb]; fbest = F[kb]; }
    if (evals >= maxEvals) { reason = 'maxEvals'; converged = false; break; }
    // converged simplex: restart only if it might not be a stationary point (the run improved the value appreciably)
    const gained = start - fbest;
    if (runConverged && !(gained > fTol * (1 + Math.abs(start)) * 10) && run > 0) { converged = true; reason = 'tolerance'; break; }
    if (run === maxRestarts) { converged = runConverged; reason = runConverged ? 'tolerance' : 'no improvement'; break; }
    steps = steps.map((s) => s * (opts.restartShrink ?? 0.5));
  }
  return { x: best, f: fbest, evals, iterations, converged, reason };
}
