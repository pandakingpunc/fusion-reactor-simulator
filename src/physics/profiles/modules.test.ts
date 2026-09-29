/**
 * Module structure of the 1.5D model: state layout, work arrays, and the SourceModel,
 * TransportModel and EventModel plug-in interfaces with their checkpoint hooks.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D, JET_15D } from '../presets';
import type { MagneticConfig, SimEvent } from '../types';
import { ProfileModel, SourceModel, TransportModel, EventModel } from './model';
import { defaultSources } from './sources';
import { N_SCALARS, SCALAR_NAMES, StateLayout } from './state';
import { CELL_ARRAYS, FACE_ARRAYS, allocateWorkArrays } from './work';
import { createTransportModel } from './transport';
import { ScalingTransport } from './transport/scaling';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { profileSettings } from './context';
import type { ProfileContext, StepConstants } from './context';
import type { ProfileState } from './state';
import type { CheckpointAux, CheckpointRecord } from './checkpoint';

const cfg = (tEnd: number, over: Partial<MagneticConfig> = {}): MagneticConfig => ({ ...JET_15D, t_end: tEnd, ...over });

/** Minimal driver with Simulation's call sequence (step, postStep, diagnostics per frame) for a model built with plug-ins */
function drive(m: ProfileModel, tEnd: number) {
  const y = m.initialState();
  const frames: { t: number; d: Record<string, number>; y: number[] }[] = [{ t: 0, d: m.diagnostics(0, y), y: Array.from(y) }];
  const events: SimEvent[] = [];
  let t = 0, nextOut = m.outputDt, steps = 0;
  while (t < tEnd - 1e-12 && !m.terminated) {
    const t0 = t;
    t = m.step(t, y, Math.min(tEnd, nextOut));
    if (t > t0) steps++;
    const ev = m.postStep(t, t - t0, y);
    events.push(...ev);
    const regular = t >= nextOut - 1e-12;
    if (regular || m.terminated || ev.some((e) => e.kind === 'ELM' || e.kind === 'sawtooth')) {
      frames.push({ t, d: m.diagnostics(t, y), y: Array.from(y) });
      if (regular) nextOut = t + m.outputDt;
    }
  }
  return { frames, events, y, steps, t };
}

describe('state layout and work arrays', () => {
  it('keeps the historical scalar order (stored histories and rewinds index y by it)', () => {
    expect([...SCALAR_NAMES]).toEqual(['NHe', 'cZ', 'fA', 'Efus', 'Ein', 'Nn', 'NTburn', 'NTfuel', 'Cchi', 'Sfuel', 'Ip', 'w32', 'w21', 'Pelm', 'CI']);
    expect(N_SCALARS).toBe(15);
  });

  it('views share the state vector and name the scalars by position', () => {
    const L = new StateLayout(4);
    expect(L.size).toBe(4 * 4 + N_SCALARS);
    const y = Float64Array.from({ length: L.size }, (_, i) => i);
    const v = L.view(y);
    expect(Array.from(v.Te)).toEqual([0, 1, 2, 3]);
    expect(Array.from(v.psi)).toEqual([12, 13, 14, 15]);
    SCALAR_NAMES.forEach((k, i) => expect(v.s[k]).toBe(16 + i));
    v.s.Ip = -1; v.ne[0] = -2;
    expect(y[16 + SCALAR_NAMES.indexOf('Ip')]).toBe(-1);
    expect(y[8]).toBe(-2);
  });

  it('allocates cell arrays of N and face arrays of N + 1 entries', () => {
    const w = allocateWorkArrays(7);
    for (const k of CELL_ARRAYS) expect(w[k].length).toBe(7);
    for (const k of FACE_ARRAYS) expect(w[k].length).toBe(8);
  });
});

describe('profile settings', () => {
  it('a blank setting (undefined or null) leaves the default in force, a value overrides it', () => {
    const blank = { nRho: undefined, DoverChi: undefined, pedestalWidth: null, chiShape: undefined } as unknown as MagneticConfig['profiles'];
    const ps = profileSettings(cfg(1, { profiles: { ...blank, stiffness: 3.5, eccdEff: 0 } }));
    expect(ps.nRho).toBe(DEFAULT_PROFILE_SETTINGS.nRho);
    expect(ps.DoverChi).toBe(DEFAULT_PROFILE_SETTINGS.DoverChi);
    expect(ps.pedestalWidth).toBe(DEFAULT_PROFILE_SETTINGS.pedestalWidth);
    expect(ps.chiShape).toBe(DEFAULT_PROFILE_SETTINGS.chiShape);
    expect(ps.stiffness).toBe(3.5);
    expect(ps.eccdEff).toBe(0); // zero is a value, not a blank
  });

  it('the optional settings without a default stay unset when blank (LCFS shape from the geometry, two-point T_sep)', () => {
    const ps = profileSettings(cfg(1, { profiles: { lcfsKappa: undefined, lcfsDelta: undefined, Tsep_keV: undefined } }));
    expect(ps.lcfsKappa).toBeUndefined();
    expect(ps.lcfsDelta).toBeUndefined();
    expect(ps.Tsep_keV).toBeUndefined();
    expect(profileSettings(cfg(1, { profiles: { Tsep_keV: 0.1 } })).Tsep_keV).toBe(0.1);
  });

  it('the equilibrium update interval follows the shot length unless set', () => {
    expect(profileSettings(cfg(100)).eqUpdateInterval).toBe(5);
    expect(profileSettings(cfg(100, { profiles: { eqUpdateInterval: undefined } })).eqUpdateInterval).toBe(5);
    expect(profileSettings(cfg(100, { profiles: { eqUpdateInterval: 2 } })).eqUpdateInterval).toBe(2);
  });
});

describe('module wiring', () => {
  it('Simulation builds the model with the standard modules, in order', () => {
    const m = new Simulation(cfg(0.01)).model as ProfileModel;
    expect(m.physics.transport.id).toBe('scaling');
    expect(m.physics.sources.map((s) => s.id)).toEqual(['nbi', 'rf', 'fusion', 'radiation', 'exchange']);
    expect(m.events.map((e) => e.id)).toEqual(['LH', 'ELM', 'sawtooth', 'NTM', 'burn', 'warnings', 'disruption']);
  });

  it('transport models are chosen by ProfileSettings.transportModel', () => {
    expect(createTransportModel('scaling').predictive).toBe(false);
    expect(createTransportModel('cgm').predictive).toBe(true);
    expect(() => createTransportModel('nope' as 'scaling')).toThrow(/unknown 1\.5D transport model/);
    expect((new Simulation(cfg(0.01, { profiles: { transportModel: 'cgm' } })).model as ProfileModel).physics.transport.id).toBe('cgm');
  });

  it('checkpoint records keep their key names (saved histories restore across versions)', () => {
    const sim = new Simulation(cfg(0.2));
    sim.runAll();
    const keys = Object.keys(sim.history[sim.history.length - 1].internal).sort();
    expect(keys).toEqual([
      'GammaB', 'IpD', 'PSOL', 'TeB', 'TiB', 'Wd', 'WfAlpha', 'WfBeam', 'alphaRatio', 'burning', 'ck', 'crashE', 'dWdtS', 'dt', 'eqBetaP', 'eqFailStreak', 'eqLi',
      'eqRejected', 'eqRetried', 'eqRetryAt', 'eqTime', 'eqUpdates', 'fluxClosure', 'fluxIp0', 'fluxLi0', 'fluxOn', 'fluxPsiB', 'fluxPsiR', 'fluxVB', 'fluxVR', 'forcedSteps', 'hmode', 'ignited', 'lastElm', 'lastSaw', 'lastVloop',
      'nB', 'nsepGain', 'ntmOn21', 'ntmOn32', 'phase', 'rng', 'stepAccepted', 'stepFailed', 'stepFallbacks', 'stepJacobians', 'stepLocalised', 'stepNewtonEvals', 'stepNewtonIters', 'stepPicardIters', 'stepRejected', 'tAuxOff', 'tDisrupt', 'tauE',
    ].sort());
  });
});

describe('plug-in interfaces', () => {
  const T = 0.3;

  it('SourceModel: prepare and particles run per attempt, heat and current per Picard iteration, accepted once per accepted step; no-op hooks change nothing', () => {
    const calls = { prepare: 0, particles: 0, heat: 0, current: 0, accepted: 0, geometry: 0 };
    // accepted steps tile the time axis: each starts where the previous one ended
    let tNext = 0, gap = 0, dtSum = 0, moved = true;
    const probe: SourceModel = {
      id: 'probe',
      prepare: (_c: ProfileContext, _t: number, _s: ProfileState, K: StepConstants) => { calls.prepare++; expect(K.P_NBI).toBeGreaterThanOrEqual(0); },
      particles: (_c, _t, dt) => { calls.particles++; expect(dt).toBeGreaterThan(0); },
      heat: () => { calls.heat++; },
      current: () => { calls.current++; },
      accepted: (_c, t, dt, yOld, y) => {
        calls.accepted++;
        gap = Math.max(gap, Math.abs(t - tNext)); tNext = t + dt; dtSum += dt;
        moved = moved && y.Te.some((x, i) => x !== yOld.Te[i]);
      },
      geometryChanged: () => { calls.geometry++; },
    };
    const ref = drive(new ProfileModel(cfg(T)), T);
    const withProbe = new ProfileModel(cfg(T), { sources: [...defaultSources(), probe] });
    let attempts = 0;
    const implicitStep = withProbe.stepper.implicitStep.bind(withProbe.stepper);
    withProbe.stepper.implicitStep = (t, dt, yOld, y) => { attempts++; return implicitStep(t, dt, yOld, y); };
    const run = drive(withProbe, T);
    expect(run.y).toEqual(ref.y);
    expect(run.frames.map((f) => f.d)).toEqual(ref.frames.map((f) => f.d));
    expect(calls.geometry).toBe(1 + withProbe.eqUpdates);
    // once per implicit attempt (a retried step repeats it); prepare also by the evaluations of a
    // state no step produced (first frame, after an equilibrium swap or a crash)
    expect(attempts).toBeGreaterThan(10);
    expect(calls.particles).toBe(attempts);
    expect(calls.prepare).toBeGreaterThanOrEqual(attempts);
    // heat and current: once per Picard iteration, at least two per attempt
    expect(calls.heat).toBeGreaterThan(calls.prepare);
    expect(calls.current).toBe(calls.heat);
    // accepted: once per accepted step, with the step's Δt and the old and the new state
    expect(calls.accepted).toBe(run.steps);
    expect(calls.accepted).toBeLessThanOrEqual(attempts);
    expect(gap).toBeLessThan(1e-12);
    expect(Math.abs(dtSum - run.t)).toBeLessThan(1e-9);
    expect(moved).toBe(true);
  }, 60000);

  it('SourceModel.particles: an additional particle source is added into w.Sn once per attempt, after the fueling control', () => {
    const S0 = 1e20; // m⁻³ s⁻¹, uniform
    let after: number[] = [], drift = 0, calls = 0;
    const probe: SourceModel = {
      id: 'pellet',
      particles: (c) => {
        calls++;
        for (let i = 0; i < c.N; i++) c.w.Sn[i] += S0;
        after = Array.from(c.w.Sn);
      },
      // every Picard iteration must see exactly what particles left: the source was added once, not per iteration
      heat: (c) => { if (after.some((x, i) => c.w.Sn[i] !== x)) drift++; },
    };
    const base = drive(new ProfileModel(cfg(T)), T);
    const run = drive(new ProfileModel(cfg(T), { sources: [...defaultSources(), probe] }), T);
    expect(calls).toBeGreaterThan(10);
    expect(drift).toBe(0);
    // the fueling control assigns w.Sn (it would overwrite an earlier addition): the source survives
    // to the density solve, which raises n_e by about S0 · t (uniform), ~0.3·10²⁰ m⁻³ here
    const ne = (r: { frames: { d: Record<string, number> }[] }) => r.frames[r.frames.length - 1].d.ne;
    expect(ne(run) - ne(base)).toBeGreaterThan(0.15);
    expect(ne(run) - ne(base)).toBeLessThan(0.35);
  }, 60000);

  it('SourceModel and TransportModel with state that evolves per accepted step take part in the checkpoints', () => {
    class Clock implements SourceModel {
      readonly id = 'clock';
      time = 0; steps = 0;
      accepted(_c: ProfileContext, _t: number, dt: number) { this.time += dt; this.steps++; }
      save(rec: CheckpointRecord) { rec.clockTime = this.time; rec.clockSteps = this.steps; }
      restore(rec: Readonly<CheckpointRecord>) { this.time = rec.clockTime; this.steps = rec.clockSteps; }
    }
    class Counting extends ScalingTransport {
      accepts = 0; geometries = 0;
      accepted() { this.accepts++; }
      geometryChanged() { this.geometries++; }
      save(rec: CheckpointRecord) { rec.trAccepts = this.accepts; }
      restore(rec: Readonly<CheckpointRecord>) { this.accepts = rec.trAccepts; }
    }
    const clock = new Clock(), tr = new Counting();
    const m = new ProfileModel(cfg(T), { sources: [...defaultSources(), clock], transport: tr });
    const y = m.initialState();
    m.diagnostics(0, y);
    const advance = (from: number, to: number) => {
      let t = from;
      while (t < to - 1e-12 && !m.terminated) { const t0 = t; t = m.step(t, y, to); m.postStep(t, t - t0, y); }
      return t;
    };
    const tHalf = advance(0, T / 2);
    expect(clock.time).toBeCloseTo(tHalf, 12);
    expect(clock.steps).toBeGreaterThan(5);
    expect(tr.accepts).toBe(clock.steps);
    const rec = m.saveInternal();
    expect([rec.clockTime, rec.clockSteps, rec.trAccepts]).toEqual([clock.time, clock.steps, tr.accepts]);
    const yHalf = Float64Array.from(y);
    const tEnd = advance(tHalf, T);
    expect(m.eqUpdates).toBeGreaterThan(0); // the run crosses an equilibrium swap
    expect(tr.geometries).toBe(1 + m.eqUpdates);
    const first = { time: clock.time, steps: clock.steps, accepts: tr.accepts, y: Array.from(y) };
    expect(first.time).toBeCloseTo(tEnd, 12);
    // rewind: the state comes back and the replay accumulates the same values
    m.restoreInternal(rec);
    y.set(yHalf);
    expect([clock.time, clock.steps, tr.accepts]).toEqual([rec.clockTime, rec.clockSteps, rec.trAccepts]);
    expect(advance(tHalf, T)).toBe(tEnd);
    expect({ time: clock.time, steps: clock.steps, accepts: tr.accepts, y: Array.from(y) }).toEqual(first);
  }, 60000);

  it('TransportModel: a predictive model sets χ and closes τ_E as W/P_loss, without the C_χ controller', () => {
    const fixed: TransportModel = {
      id: 'fixed', predictive: true,
      diffusivities: (_c, _s, chiE, chiI) => { chiE.fill(1.5); chiI.fill(2.5); },
    };
    const m = new ProfileModel(cfg(T), { transport: fixed });
    const run = drive(m, T);
    expect(m.terminated?.natural).toBe(true);
    expect(Array.from(m.ctx.w.chiTurbE).every((x) => x === 1.5)).toBe(true);
    for (const f of run.frames.slice(1)) {
      expect(Math.abs(f.d.tauE - f.d.W / f.d.P_loss)).toBeLessThan(1e-12 * f.d.tauE);
      expect(f.d.chi_mult).toBe(1);
    }
    // the default ('scaling') closure ties τ_E to the scaling law instead
    const ref = drive(new ProfileModel(cfg(T), { transport: new ScalingTransport() }), T);
    for (const f of ref.frames.slice(1)) expect(f.d.tauE).toBe(f.d.tauE_scal);
  }, 60000);

  it('EventModel: runs after every accepted step before the disruption check, may raise events, takes part in checkpoints', () => {
    class Marker implements EventModel {
      readonly id = 'marker';
      fired = false;
      seen = 0;
      afterStep(_c: ProfileContext, t: number, _s: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]) {
        this.seen++;
        if (!this.fired && t > 0.15) { this.fired = true; ev.push({ t, kind: 'info', msg: `marker at W = ${d.W.toFixed(3)} MJ` }); }
      }
      save(rec: CheckpointRecord, aux: CheckpointAux) { rec.markerFired = +this.fired; aux.marker = 'x'; }
      restore(rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined) { this.fired = !!rec.markerFired; expect(aux?.marker).toBe('x'); }
    }
    const marker = new Marker();
    const m = new ProfileModel(cfg(T), { events: [marker] });
    expect(m.events.map((e) => e.id).slice(-2)).toEqual(['marker', 'disruption']);
    const y = m.initialState();
    m.diagnostics(0, y);
    const early = m.saveInternal();
    const yEarly = Float64Array.from(y);
    const run = (from: number) => {
      const ev: SimEvent[] = [];
      let t = from;
      while (t < T - 1e-12 && !m.terminated) { const t0 = t; t = m.step(t, y, T); ev.push(...m.postStep(t, t - t0, y)); }
      return ev.filter((e) => e.msg.startsWith('marker'));
    };
    const first = run(0);
    expect(first).toHaveLength(1);
    expect(marker.seen).toBeGreaterThan(10);
    expect(early.markerFired).toBe(0);
    // rewind to the start: the marker state comes back and it fires again at the same time
    m.restoreInternal(early);
    y.set(yEarly);
    expect(marker.fired).toBe(false);
    const again = run(0);
    expect(again).toEqual(first);
  }, 60000);
});

describe('the LCFS shape of the Grad-Shafranov boundary (ProfileContext.geomB)', () => {
  const model = (geometry: Partial<MagneticConfig['geometry']>, profiles: MagneticConfig['profiles'] = ITER_15D.profiles) =>
    new Simulation({ ...ITER_15D, t_end: 1, geometry: { ...ITER_15D.geometry, ...geometry }, profiles }).model as ProfileModel;

  it('is the preset LCFS shape (1.85, 0.49) at the preset 95 % shape and follows an edited kappa or delta in the ratio to lcfsRef95, as the 0D volume does', () => {
    const nominal = model({});
    expect(nominal.geomB.kappa).toBe(1.85);
    expect(nominal.geomB.delta).toBe(0.49);
    const edited = model({ kappa: 1.87, delta: 0.363 });
    expect(edited.geomB.kappa).toBeCloseTo(1.85 * (1.87 / 1.7), 12);
    expect(edited.geomB.delta).toBeCloseTo(0.49 * (0.363 / 0.33), 12);
    // the initial equilibrium is built on it: a more elongated boundary encloses a larger volume
    expect(edited.eq.volume).toBeGreaterThan(nominal.eq.volume * 1.05);
  });

  it('without lcfsRef95 the LCFS values are absolute, and without LCFS values the boundary is the geometry', () => {
    const noRef = model({ kappa: 1.87 }, { lcfsKappa: 1.85, lcfsDelta: 0.49 });
    expect(noRef.geomB.kappa).toBe(1.85);
    expect(noRef.geomB.delta).toBe(0.49);
    const plain = model({ kappa: 1.87, delta: 0.4 }, {});
    expect(plain.geomB.kappa).toBe(1.87);
    expect(plain.geomB.delta).toBe(0.4);
  });
});
