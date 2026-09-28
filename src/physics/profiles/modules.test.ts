/**
 * Module structure of the 1.5D model: state layout, work arrays, and the SourceModel,
 * TransportModel and EventModel plug-in interfaces with their checkpoint hooks.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { JET_15D } from '../presets';
import type { MagneticConfig, SimEvent } from '../types';
import { ProfileModel, SourceModel, TransportModel, EventModel } from './model';
import { defaultSources } from './sources';
import { N_SCALARS, SCALAR_NAMES, StateLayout } from './state';
import { CELL_ARRAYS, FACE_ARRAYS, allocateWorkArrays } from './work';
import { createTransportModel } from './transport';
import { ScalingTransport } from './transport/scaling';
import type { ProfileContext, StepConstants } from './context';
import type { ProfileState } from './state';
import type { CheckpointAux, CheckpointRecord } from './checkpoint';

const cfg = (tEnd: number, over: Partial<MagneticConfig> = {}): MagneticConfig => ({ ...JET_15D, t_end: tEnd, ...over });

/** Minimal driver with Simulation's call sequence (step, postStep, diagnostics per frame) for a model built with plug-ins */
function drive(m: ProfileModel, tEnd: number) {
  const y = m.initialState();
  const frames: { t: number; d: Record<string, number>; y: number[] }[] = [{ t: 0, d: m.diagnostics(0, y), y: Array.from(y) }];
  const events: SimEvent[] = [];
  let t = 0, nextOut = m.outputDt;
  while (t < tEnd - 1e-12 && !m.terminated) {
    const t0 = t;
    t = m.step(t, y, Math.min(tEnd, nextOut));
    const ev = m.postStep(t, t - t0, y);
    events.push(...ev);
    const regular = t >= nextOut - 1e-12;
    if (regular || m.terminated || ev.some((e) => e.kind === 'ELM' || e.kind === 'sawtooth')) {
      frames.push({ t, d: m.diagnostics(t, y), y: Array.from(y) });
      if (regular) nextOut = t + m.outputDt;
    }
  }
  return { frames, events, y };
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
      'GammaB', 'IpD', 'PSOL', 'TeB', 'TiB', 'Wd', 'alphaRatio', 'burning', 'ck', 'dt', 'eqBetaP', 'eqFailStreak', 'eqLi', 'eqRejected',
      'eqRetried', 'eqRetryAt', 'eqTime', 'eqUpdates', 'forcedSteps', 'hmode', 'ignited', 'lastElm', 'lastSaw', 'lastVloop', 'nB',
      'nsepGain', 'ntmOn21', 'ntmOn32', 'phase', 'rng', 'tDisrupt', 'tauE',
    ].sort());
  });
});

describe('plug-in interfaces', () => {
  const T = 0.3;

  it('SourceModel: hooks run once per step (prepare) and per Picard iteration (heat, current); a no-op source changes nothing', () => {
    const calls = { prepare: 0, heat: 0, current: 0, geometry: 0 };
    const probe: SourceModel = {
      id: 'probe',
      prepare: (_c: ProfileContext, _t: number, _s: ProfileState, K: StepConstants) => { calls.prepare++; expect(K.P_NBI).toBeGreaterThanOrEqual(0); },
      heat: () => { calls.heat++; },
      current: () => { calls.current++; },
      geometryChanged: () => { calls.geometry++; },
    };
    const ref = drive(new ProfileModel(cfg(T)), T);
    const withProbe = new ProfileModel(cfg(T), { sources: [...defaultSources(), probe] });
    const run = drive(withProbe, T);
    expect(run.y).toEqual(ref.y);
    expect(run.frames.map((f) => f.d)).toEqual(ref.frames.map((f) => f.d));
    expect(calls.geometry).toBe(1 + withProbe.eqUpdates);
    expect(calls.prepare).toBeGreaterThan(10);
    // prepare: once per implicit attempt (and per evaluation of a state); heat and current: once per
    // Picard iteration, at least two per attempt
    expect(calls.heat).toBeGreaterThan(calls.prepare);
    expect(calls.current).toBe(calls.heat);
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
