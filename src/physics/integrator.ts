/**
 * Adaptive Dormand–Prince RK5(4) integrator (J. R. Dormand & P. J. Prince, "A family of embedded
 * Runge–Kutta formulae", J. Comput. Appl. Math. 6 (1980) 19–26; step size control as in
 * E. Hairer, S. P. Nørsett & G. Wanner, "Solving Ordinary Differential Equations I", 2nd ed.,
 * Springer 1993, §II.4). The 5th-order solution is propagated (local extrapolation).
 * No fixed dt: the step size follows the error estimate (it shrinks at a disruption).
 *
 * The controller state (proposed step size and counters) can be saved with snapshot() and put
 * back with restore(), so that a rewound simulation continues with exactly the same steps.
 *
 * FSAL ("first same as last"): the Dormand–Prince pair is constructed so that the last stage of a
 * step, k7 = f(t + h, y_new), is the first stage of the next one, f(t, y). step() reuses it when the
 * next step starts exactly where the previous one ended (same t, bitwise the same y) and nobody has
 * called invalidate() in between, which the caller must do whenever f itself may have changed (a
 * control, or model state that f reads). For a right-hand side that is a pure function of (t, y)
 * this is bitwise identical to evaluating f again, and saves one evaluation in seven. `fsal = false`
 * switches the reuse off.
 */
import { NonFiniteStateError } from './kernel/errors';

export type RHS = (t: number, y: Float64Array, dydt: Float64Array) => void;

export interface IntegratorOptions {
  rtol: number;
  atol: number | Float64Array;
  dtMin: number;
  dtMax: number;
  /** non-negative components (n, W), clamped at 0 after each step; true = all, array = these indices */
  nonNegative?: boolean | number[];
}

/** Controller state of a DormandPrince instance (everything that carries over between steps). */
export interface IntegratorSnapshot {
  /** step size proposed for the next step */
  dt: number;
  /** accepted steps */
  nSteps: number;
  /** rejected step attempts */
  nRejected: number;
}

/** Maximum attempts (one accepted, the rest rejected) per step() call. */
const MAX_ATTEMPTS = 30;

const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
// error coefficients (5th − 4th order)
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

/** Index of the first non-finite entry, or −1. */
function firstNonFinite(v: Float64Array): number {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return i;
  return -1;
}

export class DormandPrince {
  private k1: Float64Array; private k2: Float64Array; private k3: Float64Array; private k4: Float64Array;
  private k5: Float64Array; private k6: Float64Array; private k7: Float64Array;
  private ytmp: Float64Array; private ynew: Float64Array;
  dt: number;
  nRejected = 0;
  nSteps = 0;
  /** reuse the last stage of an accepted step as the first stage of the next (see the file header) */
  fsal = true;
  /** end time of the last accepted step while its k7 is reusable, NaN otherwise */
  private fsalT = NaN;

  constructor(private n: number, private rhs: RHS, public opts: IntegratorOptions, dt0: number) {
    this.k1 = new Float64Array(n); this.k2 = new Float64Array(n); this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n); this.k5 = new Float64Array(n); this.k6 = new Float64Array(n);
    this.k7 = new Float64Array(n); this.ytmp = new Float64Array(n); this.ynew = new Float64Array(n);
    this.dt = dt0;
  }

  /** Controller state (a copy). */
  snapshot(): IntegratorSnapshot {
    return { dt: this.dt, nSteps: this.nSteps, nRejected: this.nRejected };
  }

  /** Puts back a state taken with snapshot(); the next step() continues exactly as it would have. */
  restore(s: IntegratorSnapshot): void {
    this.dt = s.dt;
    this.nSteps = s.nSteps;
    this.nRejected = s.nRejected;
    this.fsalT = NaN;
  }

  /**
   * True if step(t, y, ·) would reuse k7 of the last accepted step as its first stage: FSAL is on,
   * the step ended at t and y is bitwise the state it produced (a postStep that changed y, a clamp
   * that changed it or an outside write all make this false).
   */
  canReuseStage(t: number, y: Float64Array): boolean {
    if (!this.fsal || this.fsalT !== t) return false; // NaN never equals t
    const { n, ynew } = this;
    for (let i = 0; i < n; i++) if (!Object.is(y[i], ynew[i])) return false;
    return true;
  }

  /** Forgets the reusable stage: call when the right-hand side may have changed since the last step. */
  invalidate(): void { this.fsalT = NaN; }

  /**
   * Takes one accepted step; y is updated in place and the new t is returned.
   * The step never goes past tMax (it is shortened to end there).
   * A step at dtMin is accepted even if its error norm exceeds 1, but never with a non-finite
   * state: that raises NonFiniteStateError and leaves y unchanged.
   */
  step(t: number, y: Float64Array, tMax: number): number {
    const { rtol, atol, dtMin, dtMax } = this.opts;
    let h = Math.min(this.dt, dtMax, tMax - t);
    if (h <= 0) return t;
    const reuse = this.canReuseStage(t, y);
    if (reuse) { const k = this.k1; this.k1 = this.k7; this.k7 = k; } // k7 of the last step is f(t, y)
    this.fsalT = NaN;
    const { n, rhs, k1, k2, k3, k4, k5, k6, k7, ytmp, ynew } = this;
    if (!reuse) rhs(t, y, k1);
    let hUsed = h, err = NaN;
    for (let iter = 0; iter < MAX_ATTEMPTS; iter++) {
      hUsed = h;
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * A21 * k1[i];
      rhs(t + h / 5, ytmp, k2);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
      rhs(t + (3 * h) / 10, ytmp, k3);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
      rhs(t + (4 * h) / 5, ytmp, k4);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
      rhs(t + (8 * h) / 9, ytmp, k5);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
      rhs(t + h, ytmp, k6);
      for (let i = 0; i < n; i++) ynew[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
      rhs(t + h, ynew, k7);
      // RMS error norm
      err = 0;
      for (let i = 0; i < n; i++) {
        const ei = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
        const sc = (typeof atol === 'number' ? atol : atol[i]) + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
        const r = ei / sc;
        err += r * r;
      }
      err = Math.sqrt(err / n);
      // a NaN norm compares false with everything: test for finiteness explicitly
      const finite = Number.isFinite(err) && firstNonFinite(ynew) < 0;
      if (finite && (err <= 1 || h <= dtMin)) return this.accept(t, h, err, y);
      if (h <= dtMin) this.fail(t, h);
      this.nRejected++;
      h = Math.max(dtMin, h * (finite ? Math.max(0.1, 0.9 * Math.pow(err, -0.25)) : 0.1));
    }
    // attempts exhausted above dtMin: take the last candidate (it belongs to hUsed, not to the
    // already shrunk h) unless it is not finite
    if (!Number.isFinite(err) || firstNonFinite(ynew) >= 0) this.fail(t, hUsed);
    for (let i = 0; i < n; i++) y[i] = ynew[i];
    this.clampNonNegative(y);
    this.dt = Math.max(dtMin, h);
    this.fsalT = t + hUsed; // k7 belongs to this last candidate
    return t + hUsed;
  }

  private accept(t: number, h: number, err: number, y: Float64Array): number {
    const { n, ynew } = this;
    const { dtMin, dtMax } = this.opts;
    for (let i = 0; i < n; i++) y[i] = ynew[i];
    this.clampNonNegative(y);
    const fac = Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
    this.dt = Math.min(dtMax, Math.max(dtMin, h * fac));
    this.nSteps++;
    this.fsalT = t + h; // k7 = f(t + h, ynew); canReuseStage() checks that y is still ynew (the clamp may have changed it)
    return t + h;
  }

  private clampNonNegative(y: Float64Array): void {
    const nn = this.opts.nonNegative;
    if (nn === true) {
      for (let i = 0; i < this.n; i++) if (y[i] < 0) y[i] = 0;
    } else if (Array.isArray(nn)) {
      for (const i of nn) if (y[i] < 0) y[i] = 0;
    }
  }

  private fail(t: number, h: number): never {
    const i = firstNonFinite(this.ynew);
    throw new NonFiniteStateError(t, h, i, i >= 0 ? this.ynew[i] : NaN);
  }
}
