import { describe, expect, it } from 'vitest';
import { DormandPrince, IntegratorOptions, RHS } from '../integrator';
import { NonFiniteStateError } from './errors';

/** Fixed-step integration: dtMin = dtMax = h and loose tolerances, so every step is accepted. */
function fixedStep(rhs: RHS, y0: number[], T: number, N: number): Float64Array {
  const h = T / N;
  const y = Float64Array.from(y0);
  const dp = new DormandPrince(y.length, rhs, { rtol: 1e3, atol: 1e3, dtMin: h, dtMax: h }, h);
  let t = 0, guard = 0;
  while (t < T - 1e-12 && guard++ < 10 * N) t = dp.step(t, y, T);
  expect(t).toBeCloseTo(T, 12);
  expect(dp.nSteps).toBe(N);
  return y;
}

/** log2 of successive error ratios under step halving. */
function observedOrders(err: (N: number) => number, Ns: number[]): number[] {
  const e = Ns.map(err);
  return e.slice(1).map((v, i) => Math.log2(e[i] / v));
}

describe('Dormand–Prince RK5(4)', () => {
  it('shows order 5 on smooth problems (global error under step halving)', () => {
    // harmonic oscillator y'' = −y: y = (cos t, −sin t)
    const osc: RHS = (_t, y, d) => { d[0] = y[1]; d[1] = -y[0]; };
    const T = 2;
    const errOsc = (N: number) => {
      const y = fixedStep(osc, [1, 0], T, N);
      return Math.hypot(y[0] - Math.cos(T), y[1] + Math.sin(T));
    };
    // non-autonomous scalar y' = y cos t: y = exp(sin t)
    const scal: RHS = (t, y, d) => { d[0] = y[0] * Math.cos(t); };
    const errScal = (N: number) => Math.abs(fixedStep(scal, [1], T, N)[0] - Math.exp(Math.sin(T)));
    for (const p of [...observedOrders(errOsc, [8, 16, 32, 64]), ...observedOrders(errScal, [8, 16, 32, 64])]) {
      expect(p).toBeGreaterThan(4.6);
      expect(p).toBeLessThan(5.4);
    }
  });

  it('meets the tolerance in adaptive mode', () => {
    const osc: RHS = (_t, y, d) => { d[0] = y[1]; d[1] = -y[0]; };
    const y = Float64Array.from([1, 0]);
    const dp = new DormandPrince(2, osc, { rtol: 1e-8, atol: 1e-10, dtMin: 1e-9, dtMax: 1 }, 1e-3);
    let t = 0;
    while (t < 10 - 1e-12) t = dp.step(t, y, 10);
    expect(Math.abs(y[0] - Math.cos(10))).toBeLessThan(1e-6);
    expect(Math.abs(y[1] + Math.sin(10))).toBeLessThan(1e-6);
  });

  describe('nonNegative', () => {
    const sink: RHS = (_t, _y, d) => d.fill(-1);
    const stepOnce = (nonNegative: IntegratorOptions['nonNegative']) => {
      const y = Float64Array.from([1e-3, 1e-3, 1e-3]);
      new DormandPrince(3, sink, { rtol: 1, atol: 1, dtMin: 0.01, dtMax: 0.01, nonNegative }, 0.01).step(0, y, 1);
      return Array.from(y);
    };
    it('array form clamps exactly the listed components', () => {
      const y = stepOnce([0, 2]);
      expect(y[0]).toBe(0);
      expect(y[1]).toBeCloseTo(-9e-3, 15);
      expect(y[2]).toBe(0);
    });
    it('true clamps every component, absent clamps none', () => {
      expect(stepOnce(true)).toEqual([0, 0, 0]);
      expect(stepOnce(undefined).every((v) => v < 0)).toBe(true);
      expect(stepOnce(false).every((v) => v < 0)).toBe(true);
    });
  });

  describe('non-finite states', () => {
    it('raises NonFiniteStateError at dtMin and leaves y unchanged', () => {
      const rhs: RHS = (t, _y, d) => { d[0] = t > 0.05 ? NaN : 1; };
      const y = Float64Array.from([2]);
      const dp = new DormandPrince(1, rhs, { rtol: 1e-6, atol: 1e-9, dtMin: 0.1, dtMax: 0.1 }, 0.1);
      let err: unknown;
      try { dp.step(0, y, 1); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(NonFiniteStateError);
      expect((err as NonFiniteStateError).index).toBe(0);
      expect((err as NonFiniteStateError).t).toBe(0);
      expect(y[0]).toBe(2);
      expect(dp.nSteps).toBe(0);
    });

    it('rejects a non-finite candidate above dtMin and retries with a smaller, finite step', () => {
      // the right-hand side is NaN beyond t = 0.5: the first attempt (h = 1) fails, a shorter one succeeds
      const rhs: RHS = (t, _y, d) => { d[0] = t > 0.5 ? NaN : 1; };
      const y = Float64Array.from([0]);
      const dp = new DormandPrince(1, rhs, { rtol: 1e-6, atol: 1e-9, dtMin: 1e-6, dtMax: 1 }, 1);
      const t = dp.step(0, y, 1);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(0.5);
      expect(y[0]).toBeCloseTo(t, 12);
      expect(dp.nRejected).toBeGreaterThan(0);
      expect(Number.isFinite(dp.dt)).toBe(true);
    });
  });

  it('snapshot()/restore() continue bitwise like the uninterrupted integration', () => {
    // Van der Pol oscillator (μ = 5): stiff-ish, so the step size varies strongly
    const vdp: RHS = (_t, y, d) => { d[0] = y[1]; d[1] = 5 * (1 - y[0] * y[0]) * y[1] - y[0]; };
    const opts: IntegratorOptions = { rtol: 1e-6, atol: 1e-9, dtMin: 1e-9, dtMax: 0.5 };
    const run = (from?: { t: number; y: Float64Array; snap: ReturnType<DormandPrince['snapshot']> }) => {
      const dp = new DormandPrince(2, vdp, opts, 1e-3);
      let t = 0, y = Float64Array.from([2, 0]);
      if (from) { t = from.t; y = Float64Array.from(from.y); dp.restore(from.snap); }
      const ts: number[] = [], ys: number[] = [];
      let saved: { t: number; y: Float64Array; snap: ReturnType<DormandPrince['snapshot']> } | undefined;
      while (t < 20 - 1e-12) {
        t = dp.step(t, y, 20);
        ts.push(t); ys.push(y[0], y[1]);
        if (!saved && t > 7) saved = { t, y: Float64Array.from(y), snap: dp.snapshot() };
      }
      return { ts, ys, saved: saved!, nSteps: dp.nSteps, nRejected: dp.nRejected };
    };
    const full = run();
    const resumed = run(full.saved);
    const k = full.ts.indexOf(full.saved.t) + 1;
    expect(resumed.ts).toEqual(full.ts.slice(k));
    expect(resumed.ys).toEqual(full.ys.slice(2 * k));
    expect(resumed.nSteps).toBe(full.nSteps);
    expect(resumed.nRejected).toBe(full.nRejected);
  });
});
