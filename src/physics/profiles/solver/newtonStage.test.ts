/**
 * The Newton solve of a transport stage (newtonStage.ts) on stages of real shots: the residual is a function of the state alone, its
 * coloured finite-difference Jacobian is the Jacobian, its root is the fixed point of the Picard iteration, the convergence is quadratic
 * on a smooth stage, the solver is chosen by ProfileSettings.nonlinearSolver, a failed Newton solve falls back to the Pereverzev–Corrigan
 * iteration, and a shot that uses it is chunk invariant and rewinds exactly.
 */
import { describe, expect, it } from 'vitest';
import { blockTridiag, coloredJacobian } from '../../numerics/blockTridiagN';
import { ITER_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { canonicalString } from '../../kernel/canonical';
import { advanceRandomly, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked } from '../../kernel/testkit';
import type { MagneticConfig } from '../../types';
import type { ProfileModel } from '../model';
import type { ProfileState } from '../state';
import type { CurrentInputs, DensityInputs, HeatInputs } from '../fvsolver';
import type { StepConstants } from '../context';
import type { NewtonStage } from './newtonStage';

const M = 4;

interface Stage { m: ProfileModel; nst: NewtonStage; /** the Newton solve of the stage, not the hook of this file */ solve: NewtonStage['solve']; stepper: StepperInternals; v: ProfileState; K: StepConstants; heat: HeatInputs; dens: DensityInputs; cur: CurrentInputs; opts: { tol: number; maxIter: number; slow: number } }
interface StepperInternals { picard(v: ProfileState, K: StepConstants, h: HeatInputs, d: DensityInputs, c: CurrentInputs, tol: number, pc: number): boolean }

class Stop extends Error {}

/** Runs the shot until the nth Newton solve of a stage begins, hands the stage to fn, and stops the shot there */
function atStage(cfg: MagneticConfig, nth: number, fn: (s: Stage) => void): void {
  const sim = new Simulation(cfg);
  const m = sim.model as ProfileModel;
  const stepper = m.stepper as unknown as StepperInternals & { newton: NewtonStage };
  const nst = stepper.newton;
  const orig = nst.solve.bind(nst);
  let call = 0;
  nst.solve = (v, K, heat, dens, cur, opts) => {
    if (++call < nth) return orig(v, K, heat, dens, cur, opts);
    fn({ m, nst, solve: orig, stepper, v, K, heat, dens, cur, opts });
    throw new Stop();
  };
  try { sim.runAll(); } catch (e) { if (e instanceof Stop) return; throw e; }
  throw new Error(`the shot ended before the Newton solve number ${nth}`);
}

const withSolver = (nonlinearSolver: 'auto' | 'picard' | 'newton' | 'pc', model: 'scaling' | 'cgm', tEnd: number): MagneticConfig =>
  ({ ...ITER_15D, t_end: tEnd, profiles: { ...ITER_15D.profiles, transportModel: model, nonlinearSolver } }) as MagneticConfig;

const copy = (st: ProfileState) => ({ Te: Float64Array.from(st.Te), Ti: Float64Array.from(st.Ti), ne: Float64Array.from(st.ne), psi: Float64Array.from(st.psi) });
const put = (st: ProfileState, c: ReturnType<typeof copy>) => { st.Te.set(c.Te); st.Ti.set(c.Ti); st.ne.set(c.ne); st.psi.set(c.psi); };
/** largest relative difference of T_e, T_i, n_e (floors 0.05 keV, 1e17) and ψ (2 % of its maximum) */
function diff(a: ReturnType<typeof copy>, b: ReturnType<typeof copy>): number {
  let d = 0;
  const psiFloor = 0.02 * Math.max(...Array.from(b.psi, Math.abs));
  for (let i = 0; i < b.Te.length; i++) {
    d = Math.max(d, Math.abs(a.Te[i] - b.Te[i]) / Math.max(Math.abs(b.Te[i]), 0.05), Math.abs(a.Ti[i] - b.Ti[i]) / Math.max(Math.abs(b.Ti[i]), 0.05),
      Math.abs(a.ne[i] - b.ne[i]) / Math.max(Math.abs(b.ne[i]), 1e17), Math.abs(a.psi[i] - b.psi[i]) / Math.max(Math.abs(b.psi[i]), psiFloor));
  }
  return d;
}

describe('the residual of a stage', () => {
  it('is a function of the unknowns alone: evaluating at z, at another point and at z again gives the same numbers bit for bit (no stale read of a work array)', () => {
    atStage(withSolver('newton', 'cgm', 3), 150, ({ m, nst, v, K, heat, dens, cur }) => {
      const N = m.ctx.N;
      nst.bind(v, K, heat, dens, cur);
      const z = new Float64Array(M * N);
      nst.unknowns(v, z);
      const f1 = new Float64Array(M * N), f2 = new Float64Array(M * N), f3 = new Float64Array(M * N);
      nst.residual(z, f1);
      const zp = z.map((x, k) => x * (1 + 3e-3 * Math.sin(k)));
      nst.residual(zp, f2);
      nst.residual(z, f3);
      expect(Array.from(f3)).toEqual(Array.from(f1));
      let moved = 0;
      for (let k = 0; k < M * N; k++) moved = Math.max(moved, Math.abs(f2[k] - f1[k]));
      expect(moved).toBeGreaterThan(1e-3);
    });
  }, 60000);

  it('has a block-tridiagonal Jacobian: the coloured finite-difference one equals the column-by-column one, and nothing lies outside the band', () => {
    atStage(withSolver('newton', 'cgm', 3), 400, ({ m, nst, v, K, heat, dens, cur }) => {
      const N = m.ctx.N, n = M * N;
      nst.bind(v, K, heat, dens, cur);
      const z = new Float64Array(n);
      nst.unknowns(v, z);
      const F = (x: Float64Array, out: Float64Array) => nst.residual(x, out);
      const F0 = new Float64Array(n);
      F(z, F0);
      const delta = (_i: number, _k: number, x: number) => 1e-7 * Math.max(Math.abs(x), 0.05);
      const J = blockTridiag(N, M);
      coloredJacobian(F, z, F0, N, M, J, delta);
      const full = new Float64Array(n * n), Fp = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const zp = Float64Array.from(z);
        zp[j] += delta(0, 0, z[j]);
        const dx = zp[j] - z[j];
        F(zp, Fp);
        for (let r = 0; r < n; r++) full[r * n + j] = (Fp[r] - F0[r]) / dx;
      }
      const mm = M * M;
      let worst = 0, outside = 0, inside = 0;
      for (let r = 0; r < n; r++) {
        let rowMax = 0;
        for (let c = 0; c < n; c++) rowMax = Math.max(rowMax, Math.abs(full[r * n + c]));
        const i = Math.floor(r / M);
        for (let c = 0; c < n; c++) {
          const j = Math.floor(c / M);
          if (Math.abs(i - j) > 1) { outside = Math.max(outside, Math.abs(full[r * n + c]) / rowMax); continue; }
          const arr = j === i ? J.B : j === i - 1 ? J.A : J.C;
          const cv = arr[i * mm + (r % M) * M + (c % M)];
          worst = Math.max(worst, Math.abs(cv - full[r * n + c]) / rowMax);
          inside = Math.max(inside, Math.abs(full[r * n + c]) / rowMax);
        }
      }
      expect(inside).toBeGreaterThan(0.5);
      expect(worst).toBeLessThan(1e-3);
      expect(outside).toBeLessThan(1e-4);
    });
  }, 120000);

  it('has the Picard fixed point as its root: the Newton solution and the tightly converged Picard solution of a stage agree to 1e-6', () => {
    atStage(withSolver('newton', 'scaling', 2), 100, ({ m, solve, stepper, v, K, heat, dens, cur, opts }) => {
      const v0 = copy(v);
      const r = solve(v, K, heat, dens, cur, { tol: 1e-11, maxIter: 15, slow: 0 });
      expect(r.converged).toBe(true);
      const root = copy(v);
      put(v, v0);
      expect(stepper.picard(v, K, heat, dens, cur, 1e-8, 0)).toBe(true);
      expect(diff(copy(v), root)).toBeLessThan(1e-6);
      // the default (chord, tolerance of the step) solve is within its tolerance of the root
      put(v, v0);
      const r2 = solve(v, K, heat, dens, cur, opts);
      expect(r2.converged).toBe(true);
      expect(diff(copy(v), root)).toBeLessThan(1e-4);
      expect(m.ctx.N).toBe(50);
    });
  }, 120000);

  it('converges quadratically on a smooth stage: with a new Jacobian at every iteration the step of an iteration is proportional to the square of the previous one', () => {
    atStage(withSolver('newton', 'scaling', 2), 100, ({ solve, v, K, heat, dens, cur }) => {
      const r = solve(v, K, heat, dens, cur, { tol: 1e-12, maxIter: 15, slow: 0 });
      expect(r.converged).toBe(true);
      // a Jacobian at every iteration (the first may be the one that the first stage of the attempt left)
      expect(r.jacobians).toBeGreaterThanOrEqual(r.iterations - 1);
      // e_{k+1} ≤ C e_k² + ε e_k inside the basin: the first term is Newton's, the second the error ε of the finite-difference Jacobian
      // (a few 1e-3 of a row here), which makes the last steps a linear convergence with the rate ε
      const s = r.steps;
      let checked = 0;
      for (let k = 0; k + 1 < s.length; k++) {
        if (s[k] < 2e-3) { expect(s[k + 1]).toBeLessThan(60 * s[k] * s[k] + 5e-3 * s[k]); checked++; }
      }
      expect(checked).toBeGreaterThanOrEqual(3);
      // the pair that is above the accuracy of the Jacobian is quadratic (1.5e-3 → 1.2e-6 here)
      expect(s.some((x, k) => k + 1 < s.length && x > 1e-4 && x < 2e-3 && s[k + 1] < 5 * x * x)).toBe(true);
      expect(s[s.length - 1]).toBeLessThan(1e-11);
    });
  }, 120000);

  it('the Jacobian of the first stage serves the second one, and an attempt starts without one', () => {
    let firstCalls = 0, jacobiansFirst = -1;
    const sim = new Simulation(withSolver('newton', 'cgm', 2));
    const m = sim.model as ProfileModel;
    const nst = (m.stepper as unknown as { newton: NewtonStage }).newton;
    const orig = nst.solve.bind(nst);
    const perStage: number[] = [];
    nst.solve = (...a) => { const r = orig(...a); perStage.push(r.jacobians); return r; };
    sim.runAll();
    // stage 1 of every attempt has no Jacobian to start from, so it builds at least one; stage 2 (odd positions) often builds none
    expect(perStage.length).toBeGreaterThan(200);
    for (let k = 0; k < perStage.length; k += 2) { firstCalls++; if (perStage[k] >= 1) jacobiansFirst++; }
    expect(jacobiansFirst + 1).toBe(firstCalls);
    let secondZero = 0;
    for (let k = 1; k < perStage.length; k += 2) if (perStage[k] === 0) secondZero++;
    expect(secondZero).toBeGreaterThan(0.2 * (perStage.length / 2));
  }, 120000);
});

describe('the choice of the stage solver', () => {
  const stats = (cfg: MagneticConfig) => { const sim = new Simulation(cfg); sim.runAll(); return (sim.model as ProfileModel).stepper.stats; };

  it("'auto' is Newton for the predictive 'cgm' and Picard for 'scaling'; 'picard' and 'pc' never run Newton, 'newton' does", () => {
    const cgm = stats(withSolver('auto', 'cgm', 1.5));
    expect(cgm.newtonIters).toBeGreaterThan(100);
    expect(cgm.jacobians).toBeGreaterThan(10);
    expect(cgm.newtonEvals).toBeGreaterThan(12 * cgm.jacobians);
    expect(cgm.fallbacks).toBeLessThan(0.05 * cgm.accepted);
    const scal = stats(withSolver('auto', 'scaling', 1.5));
    expect(scal.newtonIters).toBe(0);
    expect(scal.picardIters).toBeGreaterThan(100);
    const forcedPicard = stats(withSolver('picard', 'cgm', 1.5));
    expect(forcedPicard.newtonIters).toBe(0);
    expect(forcedPicard.picardIters).toBeGreaterThan(100);
    const pc = stats(withSolver('pc', 'scaling', 1.5));
    expect(pc.newtonIters).toBe(0);
    expect(pc.picardIters).toBeGreaterThan(100);
    const forcedNewton = stats(withSolver('newton', 'scaling', 1.5));
    expect(forcedNewton.newtonIters).toBeGreaterThan(100);
  }, 120000);

  it('the fallback: when every Newton solve fails, the shot is the Pereverzev–Corrigan Picard shot bit for bit, and each failure is counted', () => {
    const pcSim = new Simulation(withSolver('pc', 'cgm', 1));
    pcSim.runAll();
    const sim = new Simulation(withSolver('newton', 'cgm', 1));
    const m = sim.model as ProfileModel;
    const nst = (m.stepper as unknown as { newton: NewtonStage }).newton;
    let calls = 0;
    nst.solve = () => { calls++; return { converged: false, reason: 'lineSearch', iterations: 0, evaluations: 0, jacobians: 0, norm0: 1, norm: 1, steps: [] }; };
    sim.runAll();
    expect(calls).toBeGreaterThan(100);
    expect(m.stepper.stats.fallbacks).toBe(calls);
    // the counters of the step control differ (fallbacks), everything else is the same
    const strip = (s: Simulation) => canonicalString({ frames: s.history.map((f) => ({ t: f.t, y: f.y, d: f.d, prof: f.prof })), events: s.events });
    expect(strip(sim)).toBe(strip(pcSim));
  }, 120000);

  it('a Newton shot of the critical-gradient model agrees with the Picard one: the profile of the stored energy and the peak temperature within 3 % at 4 s', () => {
    const run = (nonlinearSolver: 'picard' | 'newton') => { const sim = new Simulation(withSolver(nonlinearSolver, 'cgm', 4)); sim.runAll(); return sim.history[sim.history.length - 1].d; };
    const a = run('newton'), b = run('picard');
    expect(Math.abs(a.W / b.W - 1)).toBeLessThan(0.03);
    expect(Math.abs(a.Te0 / b.Te0 - 1)).toBeLessThan(0.03);
  }, 120000);
});

describe('a shot that solves its stages by Newton', () => {
  const cfg = (): MagneticConfig => ({ ...presetCfg('ITER15', 0.8), profiles: { ...ITER_15D.profiles, transportModel: 'cgm' } }) as MagneticConfig;

  it('is chunk invariant: random chunk schedules equal runAll() bitwise', () => {
    const c = cfg();
    const ref = referenceRun(c);
    for (let s = 1; s <= 3; s++) expectSameRun(runChunked(c, 6000 + s), ref, `cgm Newton schedule ${s}`);
  }, 180000);

  it('rewinds exactly: a rewind at 40 % and a replay equal the uninterrupted run bitwise, counters included', () => {
    const c = cfg();
    const ref = normalizeRng(referenceRun(c));
    const sim = rewindAt(c, 0.4, 6100);
    advanceRandomly(sim, 6101);
    expectSameRun(normalizeRng(sim), ref, 'cgm Newton rewound at 40 %');
    const straight = new Simulation(c);
    straight.runAll();
    expect({ ...(sim.model as ProfileModel).stepper.stats }).toEqual({ ...(straight.model as ProfileModel).stepper.stats });
  }, 180000);
});
