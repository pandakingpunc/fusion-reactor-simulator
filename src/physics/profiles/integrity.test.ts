/**
 * 1.5D model integrity regressions: state that events, checkpoints and reports read must always
 * describe the current plasma and the current equilibrium.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../simulation';
import { DEMO_15D, ITER_15D, JET_15D } from '../presets';
import { MagneticConfig } from '../types';
import { EquilibriumOptions, GSSolver } from '../equilibrium/gs';
import { ProfileModel } from './model';
import { EquilibriumInitFailure, StepFailure } from './failures';


describe('work arrays after an equilibrium swap', () => {
  it.each([
    ['ITER15', ITER_15D, 400, 10],
    ['DEMO15', DEMO_15D, 500, 0],
  ] as [string, MagneticConfig, number, number][])('%s: no postStep sees n_i = 0 and every sawtooth flattens T_i', (_id, cfg, tEnd, minSawteeth) => {
    const sim = new Simulation({ ...cfg, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let calls = 0, zero = 0;
    m.postStep = (t, dt, y) => {
      calls++;
      if (m.ctx.w.ni.some((v) => !(v > 0))) zero++;
      return post(t, dt, y);
    };
    const tiFlattened: boolean[] = [];
    m.crashHook = (kind, _t, before, after) => { if (kind === 'sawtooth') tiFlattened.push(after.Ti[0] < before.Ti[0]); };
    sim.runAll();
    expect(m.eqUpdates).toBeGreaterThan(10); // the shot crosses many equilibrium swaps
    expect(calls).toBeGreaterThan(1000);
    expect(zero).toBe(0);
    expect(tiFlattened.length).toBeGreaterThanOrEqual(minSawteeth);
    expect(tiFlattened.every(Boolean)).toBe(true);
  }, 180000);
});

describe('Grad–Shafranov updates during a shot', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('JET15: at least 16 of 17 updates are accepted and the report counts them', () => {
    const sim = new Simulation(JET_15D);
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    const swaps = sim.history.filter((h) => h.eq).length - 1; // frame 0 carries the initial equilibrium
    expect(swaps).toBeGreaterThanOrEqual(16);
    expect(m.eqUpdates).toBe(swaps);
    expect(r.engineering['GS updates accepted']).toBe(m.eqUpdates);
    expect(r.engineering['GS updates rejected']).toBeLessThanOrEqual(1);
  }, 60000);

  it.each([
    ['a non-converged result', 'residual'],
    ['a solver exception', 'throw'],
  ])('%s is rejected, retried later and reported loudly', (_name, mode) => {
    const solve = GSSolver.prototype.solve;
    vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o: EquilibriumOptions) {
      if (o.profile.kind !== 'table') return solve.call(this, o);
      if (mode === 'throw') throw new Error('GS: diverged');
      return { ...solve.call(this, o), converged: false, residual: 1e-2 };
    });
    const times: number[] = [];
    const update = ProfileModel.prototype.updateEquilibrium;
    vi.spyOn(ProfileModel.prototype, 'updateEquilibrium').mockImplementation(function (this: ProfileModel, t: number, y: Float64Array) {
      times.push(t);
      return update.call(this, t, y);
    });
    const sim = new Simulation({ ...JET_15D, t_end: 2 });
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    expect(r.termination.natural).toBe(true);
    expect(sim.history.filter((h) => h.eq).length).toBe(1); // geometry never swapped
    expect(m.eqUpdates).toBe(0);
    const rejected = r.engineering['GS updates rejected'] as number;
    expect(rejected).toBe(times.length);
    // eqTime does not advance on failure, so the update stays due; it is retried with a back-off
    // (¼, ½, 1, 1, … intervals), neither every step nor never again
    const interval = m.ps.eqUpdateInterval;
    expect(rejected).toBeGreaterThanOrEqual(4);
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(0.25 * interval * Math.min(2 ** (k - 1), 4) - 1e-9);
    expect(times[times.length - 1]).toBeGreaterThan(2 - 2 * interval);
    expect(r.warnings.some((w) => w.includes('Grad–Shafranov') && w.includes(`${rejected} of ${rejected}`))).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'warning' && e.msg.includes('Grad–Shafranov')).length).toBe(1);
  }, 60000);
});

describe('implicit step failures', () => {
  type StepFn = (t: number, dt: number, yOld: Float64Array, y: Float64Array) => { ok: boolean; change: number };
  const stubStep = (m: ProfileModel, f: StepFn) => { (m as unknown as { implicitStep: StepFn }).implicitStep = f; };
  const started = () => {
    const sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.advance(0.3);
    return { sim, m: sim.model as ProfileModel, t0: sim.t, y0: Array.from(sim.y) };
  };

  it('an exception in every retry (linear algebra) ends the shot explicitly without advancing time', () => {
    const { sim, m, t0, y0 } = started();
    stubStep(m, () => { throw new Error('solveTridiag: sıfır pivot'); });
    expect(() => sim.advance(0.2)).not.toThrow();
    expect(sim.t).toBe(t0);
    expect(Array.from(sim.y)).toEqual(y0);
    expect(m.terminated?.natural).toBe(false);
    expect(m.terminated?.reason).toBe('Numerical failure');
    expect(m.stepFailure).toBeInstanceOf(StepFailure);
    expect(m.stepFailure?.message).toContain('sıfır pivot');
    expect(sim.events.some((e) => e.kind === 'end' && e.msg.includes('Numerical failure'))).toBe(true);
    expect(sim.report().termination.reason).toBe('Numerical failure');
  }, 60000);

  it('the last-resort forced step never commits a non-finite state', () => {
    const { sim, m, t0, y0 } = started();
    stubStep(m, (_t, _dt, yOld, y) => { y.set(yOld); y[0] = NaN; return { ok: false, change: 1 }; });
    sim.advance(0.2);
    expect(sim.t).toBe(t0);
    expect(Array.from(sim.y)).toEqual(y0);
    expect(m.terminated?.reason).toBe('Numerical failure');
    expect(m.stepFailure?.message).toContain('non-finite');
  }, 60000);

  it('exhausted retries advance time only with the state of the step that took that Δt', () => {
    const { sim, m } = started();
    m.ctx.dt = 0.01; // twelve reductions by 0.4 stay above the Δt floor
    const dts: number[] = [];
    stubStep(m, (_t, dt, yOld, y) => { dts.push(dt); y.set(yOld); y[0] = yOld[0] + dt; return { ok: false, change: 1 }; });
    const y = Float64Array.from(sim.y), Te0 = y[0], t0 = sim.t;
    const t1 = m.step(t0, y, t0 + 1);
    expect(dts.length).toBe(13); // 12 attempts + the forced one at the last Δt
    expect(t1 - t0).toBeCloseTo(dts[dts.length - 1], 15);
    expect(y[0] - Te0).toBeCloseTo(t1 - t0, 12); // afterStep does not touch T_e
    expect(m.forcedSteps).toBe(1);
    const ev = m.postStep(t1, t1 - t0, y);
    expect(ev.some((e) => e.kind === 'warning' && e.msg.includes('forced'))).toBe(true);
  }, 60000);
});

describe('reported confinement time', () => {
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

  it("'cgm' transport: τ_E is the actual W/P_loss, the scaling law is reported beside it", () => {
    const sim = new Simulation({ ...JET_15D, t_end: 0.3, profiles: { transportModel: 'cgm' } });
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    const frames = sim.history.filter((h) => h.t > 0);
    expect(frames.length).toBeGreaterThan(100);
    for (const h of frames) {
      expect(rel(h.d.tauE, h.d.W / h.d.P_loss)).toBeLessThan(1e-12);
      expect(rel(h.d.P_cond, h.d.P_loss)).toBeLessThan(1e-12); // P_cond = W/τ_E
      expect(h.d.tauE_scal).toBeGreaterThan(0);
    }
    // predictive transport is not tied to the scaling law
    expect(frames.some((h) => rel(h.d.tauE, h.d.tauE_scal) > 0.05)).toBe(true);
  }, 60000);

  it("'scaling' transport: τ_E is the scaling-law target the C_χ controller tracks", () => {
    const sim = new Simulation({ ...JET_15D, t_end: 0.5 });
    sim.runAll();
    for (const h of sim.history.filter((f) => f.t > 0)) expect(h.d.tauE).toBe(h.d.tauE_scal);
  }, 60000);
});

describe('initial equilibrium', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  /** stubs the shape-mode (initial) solves; `f` gets the solver and the call index */
  const stubInitial = (f: (s: GSSolver, n: number) => 'throw' | 'residual' | null) => {
    const solve = GSSolver.prototype.solve;
    let n = 0;
    vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o: EquilibriumOptions) {
      if (o.profile.kind !== 'shape') return solve.call(this, o);
      const what = f(this, n++);
      if (what === 'throw') throw new Error('GS: eksende ψ ≤ 0 — çözüm ıraksadı');
      const eq = solve.call(this, o);
      return what === 'residual' ? { ...eq, converged: false, residual: 3e-3 } : eq;
    });
  };
  const requested = (s: GSSolver) => s.geom.kappa === JET_15D.geometry.kappa;

  it('a failed first attempt is retried and the shot runs normally', () => {
    stubInitial((_s, n) => (n === 0 ? 'throw' : null));
    const sim = new Simulation({ ...JET_15D, t_end: 0.2 });
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    expect(r.warnings.some((w) => w.includes('Initial Grad–Shafranov'))).toBe(false);
  }, 60000);

  it('a non-converged initial equilibrium is used but reported', () => {
    stubInitial(() => 'residual');
    const sim = new Simulation({ ...JET_15D, t_end: 0.2 });
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    expect(r.warnings.some((w) => w.includes('Initial Grad–Shafranov') && w.includes('3.0e-3'))).toBe(true);
    expect(sim.events.some((e) => e.kind === 'warning' && e.t === 0 && e.msg.includes('Initial Grad–Shafranov'))).toBe(true);
  }, 60000);

  it('an equilibrium that cannot be computed ends the shot at t = 0 with a diagnosis', () => {
    stubInitial((s) => (requested(s) ? 'throw' : null));
    let sim: Simulation | undefined;
    expect(() => { sim = new Simulation(JET_15D); }).not.toThrow();
    expect(sim!.done).toBe(true);
    const r = sim!.report();
    expect(r.termination.natural).toBe(false);
    expect(r.termination.t).toBe(0);
    expect(r.termination.reason).toBe('Equilibrium failure');
    expect(r.termination.diagnosis).toContain('ψ ≤ 0');
    expect((sim!.model as ProfileModel).eqInitFailure).toBeInstanceOf(EquilibriumInitFailure);
  }, 60000);

  it('if not even a stand-in equilibrium exists, construction throws a typed error', () => {
    stubInitial(() => 'throw');
    expect(() => new Simulation(JET_15D)).toThrow(EquilibriumInitFailure);
  });
});
