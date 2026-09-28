/**
 * 1.5D model integrity regressions: state that events, checkpoints and reports read must always
 * describe the current plasma and the current equilibrium.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../simulation';
import { DEMO_15D, ITER_15D, JET_15D, MASTU } from '../presets';
import { MagneticConfig } from '../types';
import { EquilibriumOptions, GSFailure, GSSolver } from '../equilibrium/gs';
import { CURRENT_SCALE_LIMIT } from './coupling/equilibrium';
import { ProfileModel } from './model';
import { EquilibriumInitFailure, LinearAlgebraFailure, NumericalFailure, StepFailure } from './failures';
import { defaultSources } from './sources';
import type { SourceModel } from './sources';
import type { TransportModel } from './transport';
import { ScalingTransport } from './transport/scaling';


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

  // The work arrays are persistent, so after a swap the stale ones are nonzero and finite: a
  // positivity check alone cannot see them. Compare against a fresh evaluation on the new state.
  it.each([
    ['JET15', JET_15D, 3, 4],
    ['ITER15', ITER_15D, 30, 10],
  ] as [string, MagneticConfig, number, number][])('%s: right after a swap postStep sees the arrays of a fresh evaluation on the new geometry', (_id, cfg, tEnd, minSwaps) => {
    const sim = new Simulation({ ...cfg, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    const names = ['q', 'qF', 'dpsiF', 'IencF', 'sigma', 'jB', 'p', 'ni', 'chiE', 'chiI'] as const;
    let seen = m.eqUpdates, checked = 0, worst = 0;
    const stale: string[] = [];
    m.postStep = (t, dt, y) => {
      if (m.eqUpdates !== seen) {
        seen = m.eqUpdates;
        const before = names.map((k) => Float64Array.from(m.ctx.w[k]));
        m.physics.evaluateWorkArrays(t, m.ctx.view(y));
        names.forEach((k, j) => {
          const a = before[j], b = m.ctx.w[k];
          let scale = 0, diff = 0;
          for (let i = 0; i < a.length; i++) { scale = Math.max(scale, Math.abs(b[i])); diff = Math.max(diff, Math.abs(a[i] - b[i])); }
          const r = diff / scale;
          if (r > 1e-12 && !stale.includes(k)) stale.push(k);
          worst = Math.max(worst, r);
        });
        checked++;
      }
      return post(t, dt, y);
    };
    sim.runAll();
    expect(checked).toBe(m.eqUpdates);
    expect(checked).toBeGreaterThanOrEqual(minSwaps);
    expect(stale).toEqual([]);
    expect(worst).toBeLessThan(1e-12);
  }, 120000);
});

describe('Grad–Shafranov updates during a shot', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // 17 updates are attempted in the 5.5 s shot; the old code dropped 14 of them silently (3 accepted), the
  // retry ladder with the Picard of before ws4 accepted all 17, with ws4's Anderson solver one update
  // (t = 0.676 s) stalls in every stage: it is rejected, retried later and reported, as required
  it('JET15: nearly all updates are accepted, the rest is reported, and the report counts both', () => {
    const sim = new Simulation(JET_15D);
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    const swaps = sim.history.filter((h) => h.eq).length - 1; // frame 0 carries the initial equilibrium
    expect(swaps).toBeGreaterThanOrEqual(14);
    expect(m.eqUpdates).toBe(swaps);
    expect(r.engineering['GS updates accepted']).toBe(m.eqUpdates);
    const rejected = r.engineering['GS updates rejected'] as number;
    expect(rejected).toBe(m.eqRejected);
    expect(rejected).toBeLessThanOrEqual(2);
    expect(rejected / (m.eqUpdates + rejected)).toBeLessThan(0.15);
    if (rejected > 0) expect(r.warnings.some((w) => w.includes('Grad–Shafranov'))).toBe(true);
  }, 60000);

  /**
   * Table-mode (update) solves are replaced by `f(call)`: 'real' runs the solver, 'residual'
   * returns it flagged as not converged, 'rescaled' returns it as an equilibrium of a current table
   * that had to be scaled by 2 to meet I_p (with the solver's 'table-current-rescaled' warning),
   * 'throw' raises a plain Error, 'diverged' and 'bad-input' the solver's typed GSFailure. `call` counts updateEquilibrium calls (1-based); returns the times and the
   * proposed step sizes of those calls and the options of every table solve.
   */
  const stubUpdates = (f: (call: number) => 'real' | 'residual' | 'rescaled' | 'throw' | 'diverged' | 'bad-input') => {
    const solve = GSSolver.prototype.solve;
    let call = 0;
    const options: EquilibriumOptions[] = [];
    vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o: EquilibriumOptions) {
      if (o.profile.kind !== 'table') return solve.call(this, o);
      options.push(o);
      const what = f(call);
      if (what === 'throw') throw new Error('GS: diverged');
      if (what === 'diverged') throw new GSFailure('diverged', 'the plasma was lost (stub)', 7, 0.5);
      if (what === 'bad-input') throw new GSFailure('bad-input', 'invalid table (stub)');
      const eq = solve.call(this, o);
      if (what === 'rescaled') return { ...eq, currentScale: 2, warnings: [...eq.warnings, { code: 'table-current-rescaled' as const, message: 'stub' }] };
      return what === 'residual' ? { ...eq, converged: false, residual: 1e-2 } : eq;
    });
    const times: number[] = [], dts: number[] = [];
    const update = ProfileModel.prototype.updateEquilibrium;
    vi.spyOn(ProfileModel.prototype, 'updateEquilibrium').mockImplementation(function (this: ProfileModel, t: number, y: Float64Array) {
      call++;
      times.push(t); dts.push(this.ctx.dt);
      return update.call(this, t, y);
    });
    return { times, dts, options };
  };
  /** spacing[k] = times[k+1] − times[k] lies in [want, want + max Δt]: the update is retried when it is due again, not earlier and not later */
  const expectSpacing = (times: number[], dts: number[], want: (k: number) => number) => {
    const slack = Math.max(...dts) + 1e-9;
    for (let k = 0; k + 1 < times.length; k++) {
      const gap = times[k + 1] - times[k];
      expect(gap, `gap after attempt ${k + 1}`).toBeGreaterThanOrEqual(want(k) - 1e-9);
      expect(gap, `gap after attempt ${k + 1}`).toBeLessThanOrEqual(want(k) + slack);
    }
  };

  it.each([
    ['a non-converged result', 'residual'],
    ['a solver exception', 'throw'],
  ] as const)('%s is rejected, retried later and reported loudly', (_name, mode) => {
    const { times, dts } = stubUpdates(() => mode);
    const sim = new Simulation({ ...JET_15D, t_end: 2 });
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    expect(r.termination.natural).toBe(true);
    expect(sim.history.filter((h) => h.eq).length).toBe(1); // geometry never swapped
    expect(m.eqUpdates).toBe(0);
    const rejected = r.engineering['GS updates rejected'] as number;
    expect(rejected).toBe(times.length);
    expect(rejected).toBeGreaterThanOrEqual(4);
    // eqTime advances only on success: nothing was accepted, so it is still the initial equilibrium
    // and the update stays due; it is retried after ¼, ½, 1, 1, … intervals (not every step, not never)
    const interval = m.ps.eqUpdateInterval;
    expect(m.coupling.eqTime).toBe(0);
    expectSpacing(times, dts, (k) => 0.25 * interval * Math.min(2 ** k, 4));
    expect(times[times.length - 1]).toBeGreaterThan(2 - 2 * interval);
    expect(r.warnings.some((w) => w.includes('Grad–Shafranov') && w.includes(`${rejected} of ${rejected}`))).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'warning' && e.msg.includes('Grad–Shafranov')).length).toBe(1);
  }, 60000);

  it('after an accepted update a rejection leaves eqTime at the last accepted equilibrium', () => {
    const { times, dts } = stubUpdates((call) => (call <= 1 ? 'real' : 'throw'));
    const sim = new Simulation({ ...JET_15D, t_end: 2 });
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    expect(m.eqUpdates).toBe(1);
    expect(m.eqRejected).toBe(times.length - 1);
    expect(m.eqRejected).toBeGreaterThanOrEqual(4);
    expect(m.coupling.eqTime).toBe(times[0]); // the time of the one accepted update, not of a later rejected attempt
    expect(sim.history.filter((h) => h.eq).length).toBe(2); // initial equilibrium and the accepted update
    // after the acceptance the next attempt is due again a quarter interval later at the earliest
    // (β_p or ℓ_i changed); every rejection then backs off ¼, ½, 1, 1, … intervals
    const interval = m.ps.eqUpdateInterval;
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(0.25 * interval);
    expectSpacing(times.slice(1), dts.slice(1), (k) => 0.25 * interval * Math.min(2 ** k, 4));
    expect(r.warnings.some((w) => w.includes('Grad–Shafranov') && w.includes(`${m.eqRejected} of ${m.eqRejected + 1}`))).toBe(true);
  }, 60000);

  it('an update whose current table had to be rescaled by more than the limit is rejected and reported', () => {
    const { times, options } = stubUpdates(() => 'rescaled');
    const sim = new Simulation({ ...JET_15D, t_end: 2 });
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    expect(m.eqUpdates).toBe(0);
    expect(sim.history.filter((h) => h.eq).length).toBe(1); // geometry never swapped
    expect(m.eqRejected).toBe(times.length);
    expect(m.eqRejected).toBeGreaterThanOrEqual(4);
    // the solver is asked to flag exactly what the coupling refuses
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o.currentScaleWarn).toBe(CURRENT_SCALE_LIMIT);
    // every ladder stage was tried and the reason is the one that is reported (not a residual)
    expect(m.coupling.eqAttempts.length).toBe(3);
    expect(m.coupling.eqAttempts.every((a) => a.rejected?.includes('rescaled by 2.00'))).toBe(true);
    const evs = sim.events.filter((e) => e.kind === 'warning' && e.msg.includes('Grad–Shafranov'));
    expect(evs.length).toBe(1);
    expect(evs[0].msg).toContain('current table rescaled by 2.00');
    expect(r.warnings.some((w) => w.includes('Grad–Shafranov') && w.includes(`${m.eqRejected} of ${m.eqRejected}`))).toBe(true);
  }, 60000);

  // ws4's solver converges MASTU15 tables that carry half of I_p on the new surfaces (c = 2.07, 1.95);
  // taking them ended the shot in a β-limit disruption at 1.06 s instead of the scheduled end
  it('MASTU15: current tables mapped through a stale geometry are held back, the shot ends as scheduled', () => {
    const sim = new Simulation({ ...MASTU, fidelity: '1.5D' });
    const r = sim.runAll();
    const m = sim.model as ProfileModel;
    expect(r.termination.reason).toBe('Scheduled end');
    expect(sim.events.some((e) => e.kind === 'disruption')).toBe(false);
    expect(m.eqRejected).toBeGreaterThan(0);
    expect(r.engineering['GS updates rejected']).toBe(m.eqRejected);
    expect(Math.abs((m.ctx.eq.currentScale ?? 1) - 1)).toBeLessThanOrEqual(CURRENT_SCALE_LIMIT);
    expect(r.warnings.some((w) => w.includes('Grad–Shafranov'))).toBe(true);
  }, 120000);

  it('a typed GSFailure keeps its iterations, residual and one message; bad input is not retried', () => {
    const diverged = stubUpdates(() => 'diverged');
    let sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.runAll();
    let m = sim.model as ProfileModel;
    expect(m.eqRejected).toBe(diverged.times.length);
    expect(m.eqRejected).toBeGreaterThanOrEqual(2);
    expect(m.coupling.eqAttempts.length).toBe(3);
    for (const a of m.coupling.eqAttempts) {
      expect(a.iterations).toBe(7);
      expect(a.residual).toBe(0.5);
      expect(a.error).toBe('Grad–Shafranov (diverged): the plasma was lost (stub)');
    }
    const msg = sim.events.find((e) => e.kind === 'warning' && e.msg.includes('Grad–Shafranov update rejected'))?.msg ?? '';
    expect(msg).toContain('(Grad–Shafranov (diverged): the plasma was lost (stub);');
    expect(msg).not.toContain('GSFailure');
    vi.restoreAllMocks();

    // no option of the ladder changes invalid input: one attempt per update
    const bad = stubUpdates(() => 'bad-input');
    sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.runAll();
    m = sim.model as ProfileModel;
    expect(m.eqRejected).toBe(bad.times.length);
    expect(bad.options.length).toBe(bad.times.length); // one table solve per update
    expect(m.coupling.eqAttempts.length).toBe(1);
    expect(m.coupling.eqAttempts[0].error).toContain('Grad–Shafranov (bad-input)');
  }, 60000);
});

describe('initial equilibrium of an impossible boundary', () => {
  it('a > R is refused with the typed initial-equilibrium failure that names the solver diagnosis', () => {
    const cfg = { ...MASTU, fidelity: '1.5D' as const, geometry: { ...MASTU.geometry, a: 2 } };
    let err: unknown;
    try { new Simulation(cfg); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EquilibriumInitFailure);
    expect((err as EquilibriumInitFailure).detail).toContain('Grad–Shafranov (bad-input)');
    expect((err as EquilibriumInitFailure).cause).toBeInstanceOf(GSFailure);
  });
});

describe('implicit step failures', () => {
  type StepFn = (t: number, dt: number, yOld: Float64Array, y: Float64Array) => { ok: boolean; change: number };
  const stubStep = (m: ProfileModel, f: StepFn) => { m.stepper.implicitStep = f; };
  const started = () => {
    const sim = new Simulation({ ...JET_15D, t_end: 1 });
    sim.advance(0.3);
    return { sim, m: sim.model as ProfileModel, t0: sim.t, y0: Array.from(sim.y) };
  };

  it('a numerical failure in every retry (linear algebra) ends the shot explicitly without advancing time', () => {
    const { sim, m, t0, y0 } = started();
    stubStep(m, () => { throw new LinearAlgebraFailure('heat', new Error('solveTridiag: sıfır pivot')); });
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

  it('a real singular system: NaN diffusivities make the heat solve singular, the retries fail, the shot ends as a numerical failure', () => {
    const nan: TransportModel = { id: 'nan', predictive: true, diffusivities: (_c, _s, chiE, chiI) => { chiE.fill(NaN); chiI.fill(NaN); } };
    let armed = false;
    const m = new ProfileModel({ ...JET_15D, t_end: 1 }, { transport: { ...nan, diffusivities: (c, s, chiE, chiI) => (armed ? nan.diffusivities(c, s, chiE, chiI) : new ScalingTransport().diffusivities(c, s, chiE, chiI)) } });
    const y = m.initialState();
    m.diagnostics(0, y);
    armed = true;
    const y0 = Array.from(y);
    expect(m.step(0, y, 0.1)).toBe(0);
    expect(Array.from(y)).toEqual(y0);
    expect(m.terminated?.reason).toBe('Numerical failure');
    expect(m.stepFailure).toBeInstanceOf(StepFailure);
    expect(m.stepFailure?.cause).toBeInstanceOf(LinearAlgebraFailure);
    expect((m.stepFailure?.cause as LinearAlgebraFailure).system).toBe('heat');
    expect(m.stepFailure?.message).toContain('singular heat system');
  }, 60000);

  it('a numerical failure of a plug-in at a large Δt is retried at a smaller one and the shot goes on', () => {
    class PlugInSingular extends NumericalFailure { override readonly name = 'PlugInSingular'; }
    let thrown = 0;
    const stiff: SourceModel = { id: 'stiff', particles: (_c, _t, dt) => { if (dt > 1e-3) { thrown++; throw new PlugInSingular('too stiff for this Δt'); } } };
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 }, { sources: [...defaultSources(), stiff] });
    const y = m.initialState();
    m.diagnostics(0, y);
    m.ctx.dt = 0.02;
    const t1 = m.step(0, y, 0.1);
    expect(thrown).toBeGreaterThan(0);
    expect(t1).toBeGreaterThan(0);
    expect(t1).toBeLessThanOrEqual(1e-3 + 1e-12);
    expect(m.terminated).toBeNull();
    expect(m.stepFailure).toBeNull();
    expect(m.forcedSteps).toBe(0);
  }, 60000);

  it('a Grad–Shafranov failure raised inside a step is a numerical failure too', () => {
    let armed = false;
    const gs: SourceModel = { id: 'gs', heat: () => { if (armed) throw new GSFailure('diverged', 'the equilibrium of the plug-in diverged', 3, 1e-2); } };
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 }, { sources: [...defaultSources(), gs] });
    const y = m.initialState();
    m.diagnostics(0, y);
    armed = true;
    expect(m.step(0, y, 0.1)).toBe(0);
    expect(m.terminated?.reason).toBe('Numerical failure');
    expect(m.stepFailure?.message).toContain('Grad–Shafranov (diverged)');
  }, 60000);

  // A TypeError or ReferenceError of a module is a bug, not a solver failure: it used to end the shot as
  // 'Numerical failure — try a coarser radial grid' with the stack hidden in the cause.
  it.each([
    ['a source', 'source'],
    ['a transport model', 'transport'],
    ['a source hook that runs once per attempt', 'prepare'],
  ] as const)('a programming error in %s propagates and leaves the state as it was', (_label, where) => {
    // armed after the first frame: the state evaluation of t = 0 runs the same hooks outside a step
    let armed = false;
    const boom = () => { if (!armed) return; const o = undefined as unknown as { length: number }; o.length; };
    const modules = where === 'transport'
      ? { transport: { ...new ScalingTransport(), id: 'buggy', predictive: false, diffusivities: () => { boom(); } } satisfies TransportModel }
      : { sources: [...defaultSources(), where === 'prepare' ? { id: 'buggy', prepare: () => { boom(); } } : { id: 'buggy', heat: () => { boom(); } }] as SourceModel[] };
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 }, modules);
    const y = m.initialState();
    m.diagnostics(0, y);
    armed = true;
    const y0 = Array.from(y);
    expect(() => m.step(0, y, 0.1)).toThrow(TypeError);
    expect(Array.from(y)).toEqual(y0);
    expect(m.terminated).toBeNull();
    expect(m.stepFailure).toBeNull();
    expect(m.ctx.phase).toBe('normal');
  }, 60000);

  it('the same through Simulation.advance: the caller sees the error, not a terminated shot', () => {
    const buggy: SourceModel = { id: 'buggy', heat: (_c, st) => { (st as unknown as { doesNotExist: { length: number } }).doesNotExist.length; } };
    const sim = new Simulation({ ...JET_15D, t_end: 0.5 });
    sim.advance(0.1);
    const m = sim.model as ProfileModel;
    (m.physics.sources as SourceModel[]).push(buggy);
    const t0 = sim.t, y0 = Array.from(sim.y);
    expect(() => sim.advance(0.2)).toThrow(/doesNotExist|undefined/);
    expect(sim.t).toBe(t0);
    expect(Array.from(sim.y)).toEqual(y0);
    expect(m.terminated).toBeNull();
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

describe('checkpoints and replays', () => {
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

  // density limit → thermal and current quench: the quench phases patch the last diagnostics in
  // place, so a checkpoint must carry all of them
  const disrupting = (): MagneticConfig => ({ ...JET_15D, t_end: 3, n_target: JET_15D.n_target * 3 });
  // User breakpoints every 2.9 ms end steps off the output grid (3.75 ms): the step of the disruption onset then
  // ends at a time that is not an output time and is recorded as an irregular frame. Without them the
  // Δt of the density ramp is longer than the output interval, every step is cut at an output time and the onset
  // frame is a regular one.
  const grid = { breakpoints: Array.from({ length: 1034 }, (_, k) => (k + 1) * 2.9e-3) };

  it('a replay from a thermal- or current-quench frame reproduces the frames and the report', () => {
    const ref = new Simulation(disrupting(), grid);
    ref.runAll();
    const refFrames = ref.history.map((h) => ({ t: h.t, y: h.y, d: { ...h.d }, prof: h.prof }));
    const refReport = JSON.stringify(ref.report());
    expect(ref.report().termination.reason).toContain('disruption');
    const nKeys = Object.keys(refFrames[refFrames.length - 1].d).length;
    expect(nKeys).toBeGreaterThan(50);
    // regular frames (they carry profiles) and the irregular frame of the disruption onset: the
    // kernel checkpoints its output clock (frame.sim.nextOut), so a replay from an irregular frame
    // continues on the original output grid as well
    const inPhase = (ph: number, regular: boolean) => ref.history.findIndex((h) => h.internal.phase === ph && !!h.prof === regular);
    const tq = inPhase(1, true), cq = inPhase(2, true), onset = inPhase(1, false);
    expect(tq).toBeGreaterThan(0);
    expect(cq).toBeGreaterThan(tq);
    expect(onset).toBeGreaterThan(0);
    expect(ref.history[onset].t).toBeLessThan(ref.history[tq].t);
    for (const idx of [onset, tq, cq]) {
      const sim = new Simulation(disrupting(), grid);
      sim.runAll();
      sim.rewindTo(idx);
      // the checkpoint restores the diagnostics and profiles of that frame
      expect(sim.model.diagnostics(sim.t, sim.y)).toEqual(refFrames[idx].d);
      expect(sim.model.profiles?.(sim.y)).toEqual(sim.history[idx].prof ?? sim.model.profiles?.(sim.y));
      sim.advance(3);
      expect(sim.history.length).toBe(refFrames.length);
      for (let k = idx + 1; k < refFrames.length; k++) {
        const f = sim.history[k];
        expect(f.t).toBe(refFrames[k].t);
        expect(f.y).toEqual(refFrames[k].y);
        expect(Object.keys(f.d).length, `frame ${k}`).toBe(Object.keys(refFrames[k].d).length);
        for (const key of Object.keys(refFrames[k].d)) expect(rel(f.d[key], refFrames[k].d[key]), `frame ${k} ${key}`).toBeLessThan(1e-12);
        if (refFrames[k].prof) expect(f.prof).toEqual(refFrames[k].prof);
      }
      expect(Object.keys(sim.history[sim.history.length - 1].d).length).toBe(nKeys);
      expect(JSON.stringify(sim.report())).toBe(refReport);
    }
  }, 60000);

  it('a rewind restores the diagnostics of a normal-phase frame, regular or not', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 120 }); // ELM frames from t = 11 s
    sim.runAll();
    const irregular = sim.history.findIndex((h, k) => k > 0 && !h.prof);
    const regular = sim.history.findIndex((h, k) => k > irregular && !!h.prof);
    expect(irregular).toBeGreaterThan(0);
    expect(sim.history[irregular].t).toBeGreaterThan(5);
    for (const idx of [regular, irregular]) {
      const want = { ...sim.history[idx].d };
      sim.rewindTo(idx);
      expect(sim.model.diagnostics(sim.t, sim.y)).toEqual(want);
    }
  }, 60000);
});
