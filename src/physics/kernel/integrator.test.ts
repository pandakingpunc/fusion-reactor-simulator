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

describe('FSAL stage reuse (first same as last)', () => {
  // Van der Pol oscillator (μ = 5): the step size varies strongly and steps get rejected
  const vdp: RHS = (_t, y, d) => { d[0] = y[1]; d[1] = 5 * (1 - y[0] * y[0]) * y[1] - y[0]; };
  const opts: IntegratorOptions = { rtol: 1e-6, atol: 1e-9, dtMin: 1e-9, dtMax: 0.5 };

  /** counts the right-hand side evaluations */
  const counted = (f: RHS): { rhs: RHS; calls: () => number } => {
    let n = 0;
    return { rhs: (t, y, d) => { n++; f(t, y, d); }, calls: () => n };
  };

  const integrate = (fsal: boolean) => {
    const c = counted(vdp);
    const dp = new DormandPrince(2, c.rhs, opts, 1e-3);
    dp.fsal = fsal;
    const y = Float64Array.from([2, 0]);
    const trace: number[] = [];
    let t = 0;
    while (t < 20 - 1e-12) { t = dp.step(t, y, 20); trace.push(t, y[0], y[1]); }
    return { trace, calls: c.calls(), nSteps: dp.nSteps, nRejected: dp.nRejected, dt: dp.dt };
  };

  it('gives bitwise the same integration as evaluating the first stage again, with one evaluation fewer per step', () => {
    const on = integrate(true), off = integrate(false);
    expect(on.trace).toEqual(off.trace);
    expect(on.nSteps).toBe(off.nSteps);
    expect(on.nRejected).toBe(off.nRejected);
    expect(on.dt).toBe(off.dt);
    expect(off.nRejected).toBeGreaterThan(0); // rejected attempts are part of the comparison
    // per accepted step one evaluation of the first stage, and six per attempt (accepted or rejected)
    expect(off.calls).toBe(off.nSteps + 6 * (off.nSteps + off.nRejected));
    expect(on.calls).toBe(off.calls - (off.nSteps - 1));
  });

  it('reuses the stage only for a step that starts at the end of the last one, from the state it produced', () => {
    const c = counted(vdp);
    const dp = new DormandPrince(2, c.rhs, opts, 0.01);
    const y = Float64Array.from([2, 0]);
    const t1 = dp.step(0, y, 20);
    expect(dp.canReuseStage(t1, y)).toBe(true);
    expect(dp.canReuseStage(t1 + 1e-9, y)).toBe(false); // another time
    const moved = Float64Array.from(y);
    moved[1] += Number.EPSILON * Math.abs(y[1]);
    expect(dp.canReuseStage(t1, moved)).toBe(false); // another state, by one ulp
    const before = c.calls();
    dp.step(t1, y, 20);
    expect(c.calls() - before).toBeGreaterThanOrEqual(6); // 6 stages, no first one (more if it was rejected)
    expect(dp.canReuseStage(t1, y)).toBe(false); // the stage was consumed by that step
  });

  it('invalidate() and restore() forget the stage; fsal = false never has one', () => {
    const dp = new DormandPrince(2, vdp, opts, 0.01);
    const y = Float64Array.from([2, 0]);
    let t = dp.step(0, y, 20);
    expect(dp.canReuseStage(t, y)).toBe(true);
    dp.invalidate();
    expect(dp.canReuseStage(t, y)).toBe(false);
    t = dp.step(t, y, 20);
    const snap = dp.snapshot();
    expect(dp.canReuseStage(t, y)).toBe(true);
    dp.restore(snap);
    expect(dp.canReuseStage(t, y)).toBe(false);
    dp.fsal = false;
    t = dp.step(t, y, 20);
    expect(dp.canReuseStage(t, y)).toBe(false);
  });

  it('a right-hand side that changes between steps is followed as long as the caller invalidates', () => {
    // dy/dt = −k y with k switched between 1 and 3 every few steps, as a model state that postStep() changes
    const run = (fsal: boolean, invalidate: boolean) => {
      let k = 1;
      const dp = new DormandPrince(1, (_t, y, d) => { d[0] = -k * y[0]; }, { rtol: 1e-8, atol: 1e-12, dtMin: 1e-9, dtMax: 0.05 }, 0.05);
      dp.fsal = fsal;
      const y = Float64Array.from([1]);
      let t = 0;
      for (let n = 0; t < 2 - 1e-12; n++) {
        t = dp.step(t, y, 2);
        if (n % 7 === 6) { k = k === 1 ? 3 : 1; if (invalidate) dp.invalidate(); }
      }
      return y[0];
    };
    const ref = run(false, false);
    expect(run(true, true)).toBe(ref);
    expect(run(true, false)).not.toBe(ref); // without the call the old first stage is used: the hazard invalidate() removes
  });

  it('does not reuse the stage when the clamp of a non-negative component changed the state', () => {
    const sink: RHS = (_t, _y, d) => d.fill(-1);
    const c = counted(sink);
    const dp = new DormandPrince(2, c.rhs, { rtol: 1, atol: 1, dtMin: 0.01, dtMax: 0.01, nonNegative: [0] }, 0.01);
    const y = Float64Array.from([1e-3, 1]);
    const t = dp.step(0, y, 1);
    expect(y[0]).toBe(0); // clamped
    expect(dp.canReuseStage(t, y)).toBe(false);
    const before = c.calls();
    dp.step(t, y, 1);
    expect(c.calls() - before).toBe(7); // the first stage is evaluated again
  });

  it('a step that fails leaves no stage to reuse', () => {
    const rhs: RHS = (t, _y, d) => { d[0] = t > 0.05 ? NaN : 1; };
    const dp = new DormandPrince(1, rhs, { rtol: 1e-6, atol: 1e-9, dtMin: 0.1, dtMax: 0.1 }, 0.1);
    const y = Float64Array.from([2]);
    expect(() => dp.step(0, y, 1)).toThrow(NonFiniteStateError);
    expect(dp.canReuseStage(0, y)).toBe(false);
    expect(dp.canReuseStage(0.1, y)).toBe(false);
  });
});
