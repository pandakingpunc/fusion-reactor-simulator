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
import { StepFailure } from './failures';

/** Work arrays are private; the tests read them through this view only. */
type Internals = { w: Record<string, Float64Array> };
const internals = (m: ProfileModel) => m as unknown as Internals;

describe('work arrays after an equilibrium swap', () => {
  it.each([
    ['ITER15', ITER_15D, 400],
    ['DEMO15', DEMO_15D, 500],
  ] as [string, MagneticConfig, number][])('%s: no postStep sees n_i = 0 and every sawtooth flattens T_i', (_id, cfg, tEnd) => {
    const sim = new Simulation({ ...cfg, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let calls = 0, zero = 0;
    m.postStep = (t, dt, y) => {
      calls++;
      if (internals(m).w.ni.some((v) => !(v > 0))) zero++;
      return post(t, dt, y);
    };
    const tiFlattened: boolean[] = [];
    m.crashHook = (kind, _t, before, after) => { if (kind === 'sawtooth') tiFlattened.push(after.Ti[0] < before.Ti[0]); };
    sim.runAll();
    expect(m.eqUpdates).toBeGreaterThan(10); // the shot crosses many equilibrium swaps
    expect(calls).toBeGreaterThan(1000);
    expect(zero).toBe(0);
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
    (m as unknown as { dt: number }).dt = 0.01; // twelve halvings by 0.4 stay above the Δt floor
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
