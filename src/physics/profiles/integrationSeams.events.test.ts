/**
 * Real crashes through the merged opt-in profile modules, bitwise under chunking, slicing and rewind.
 *
 * The combined fixture of integrationSeams.test.ts ends at 0.04 s: before the L-H guard and with no q = 1 surface, so it never
 * fires an ELM or a sawtooth. These two shots do, with every module of that fixture switched on (profile-resolved FACIT impurities
 * with a Ne seed, profile fast ions, physics current drive, Redl bootstrap, Grad-Shafranov updates):
 *
 *  - ELM shot: JET_15D to 1.0 s with the EPED1 pedestal and Loarte ELM sizes. L-H at 0.356 s, a Grad-Shafranov update rejected at
 *    0.662 s (retried from 0.79 s), then Type-I ELMs from 0.685 s on (10 of them, measured at c99ebcd), accepted equilibrium updates
 *    at 0.788 s and 0.928 s between them and the FACIT table refresh at 0.752 s. t_end = 1.0 s rather than 0.8 or 0.9 s on purpose:
 *    only with it an accepted equilibrium update (0.788 s) falls between ELMs, so that a rewind to the first inter-ELM frame has to
 *    undo an adoption (the retry state of the coupling with it), a table refresh and two ELMs of its future. It takes about 3 s.
 *  - sawtooth shot: JET_15D to 0.15 s without ELMs, the Porcelli trigger with the Kadomtsev helical-flux reset, on the initial
 *    q = 0.85 + 2.5 rho^2 of events/porcelli.test.ts (a q = 1 surface from the start): two crashes, at 1.6e-6 s and 0.0500026 s,
 *    each with an actual reset of q0, and an equilibrium adoption at 0.126 s (after them, in the future of a rewind to between them).
 *
 * For each shot: the activity is asserted from concrete evidence (events, frames, the before and after of the impurity crash
 * hooks), then the run is compared bitwise (frames, events, final state vector, the save() record and aux of every checkpoint
 * part, the fast-ion and flux snapshots, the stepper statistics, the report) between the direct run and
 *  - random uneven chunks;
 *  - slices that suspend steps (also across the crash steps and the Grad-Shafranov update);
 *  - a replay after a rewind to a frame strictly between the first and the second crash, whose discarded future (suspended in the
 *    middle of a step) holds the second crash and an accepted equilibrium update, replayed with a different slicing;
 *  - the same from the frame of the first crash itself, where the crash energy, the in-transit helium and the crash restart step
 *    are booked but not yet consumed by a step;
 *  - the same from a frame well before the first crash (in the ELM shot: in H-mode before the rejected Grad-Shafranov update at
 *    0.662 s, so the future holds that rejection, the first ELM and everything after it).
 * Right after each rewind the module state must equal the one the run had at the checkpoint, part by part (the paths of a difference name the part).
 */
import { describe, expect, it, vi } from 'vitest';
import { JET_15D } from '../presets';
import { RNG } from '../rng';
import { Simulation, type SimulationOptions } from '../simulation';
import type { MagneticConfig, ReactorConfig, SimEvent } from '../types';
import { runDigest } from '../kernel/fingerprint';
import { advanceRandomly, advanceSliced, expectSameRun, type Run } from '../kernel/testkit';
import type { Checkpointable, CheckpointAux, CheckpointRecord } from './checkpoint';
import { ImpurityModel, NEO_REFRESH } from './impurity/model';
import { ProfileModel } from './model';
import { currentProfiles } from './qprofile';
import { volumeIntegral } from './sources/deposition';
import type { ProfileState } from './state';

/** each of these shots takes 1 to 4 s; the global testTimeout is 30 s and a loaded machine stretches it */
const LONG = 180_000;

const COMMON = {
  nRho: 24, eqNR: 33, impurityTransport: 'facit', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3,
  fastIonModel: 'profile', cdModel: 'physics', neoclassicalModel: 'redl',
} as const;

interface Shot {
  name: string;
  kind: 'ELM' | 'sawtooth';
  cfg: MagneticConfig;
  opts: SimulationOptions;
}

/** A JET15 model whose initial state has q = 0.85 + 2.5 rho^2 (the recipe of the running-model tests of events/porcelli.test.ts) */
const withInitialQ = (rc: ReactorConfig): ProfileModel => {
  const m = new ProfileModel(rc as MagneticConfig), orig = m.initialState.bind(m);
  m.initialState = () => {
    const y = orig(), ctx = m.ctx, st = ctx.view(y), g = ctx.tg;
    st.psi[0] = 0;
    for (let f = 1; f < ctx.N; f++) st.psi[f] = st.psi[f - 1] + (g.distF[f] * g.PhiB * g.rhoF[f]) / (Math.PI * (0.85 + 2.5 * g.rhoF[f] ** 2));
    currentProfiles(ctx, st.psi, st.s.Ip);
    return y;
  };
  return m;
};

const ELM_SHOT: Shot = {
  name: 'ELM shot', kind: 'ELM', opts: {},
  cfg: { ...JET_15D, t_end: 1.0, profiles: { ...JET_15D.profiles, ...COMMON, pedestalModel: 'eped1', elmLoss: 'loarte' } },
};
const SAW_SHOT: Shot = {
  name: 'sawtooth shot', kind: 'sawtooth', opts: { modelFactory: withInitialQ },
  cfg: { ...JET_15D, t_end: 0.15, events: { ...JET_15D.events, elms: false }, profiles: { ...JET_15D.profiles, ...COMMON, sawtoothTrigger: 'porcelli', sawtoothReconnection: 'kadomtsev' } },
};
const SHOTS = [ELM_SHOT, SAW_SHOT];

// ---------------------------------------------------------------------------------------------------- comparing states

/** The path of the first bitwise difference (numbers by Object.is, typed arrays element by element), or null if the two are the same. */
function firstDiff(a: unknown, b: unknown, path = 'state', seen: readonly object[] = []): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (typeof a === 'function' && typeof b === 'function') return null; // behaviour, not state
    return `${path}: ${String(a)} vs ${String(b)}`;
  }
  if (seen.includes(a)) return null;
  const here = [...seen, a];
  const listA = a instanceof Set ? [...a] : a instanceof Map ? [...a] : a;
  const listB = b instanceof Set ? [...b] : b instanceof Map ? [...b] : b;
  const seqA = Array.isArray(listA) || ArrayBuffer.isView(listA), seqB = Array.isArray(listB) || ArrayBuffer.isView(listB);
  if (seqA !== seqB) return `${path}: ${seqA ? 'a sequence' : 'an object'} vs ${seqB ? 'a sequence' : 'an object'}`;
  if (seqA) {
    const x = listA as unknown as ArrayLike<unknown>, y = listB as unknown as ArrayLike<unknown>;
    if (x.length !== y.length) return `${path}.length: ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) {
      if (Object.is(x[i], y[i])) continue;
      const d = firstDiff(x[i], y[i], `${path}[${i}]`, here);
      if (d) return d;
    }
    return null;
  }
  const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
    const d = firstDiff(oa[k], ob[k], `${path}.${k}`, here);
    if (d) return d;
  }
  return null;
}

type Part = Partial<Checkpointable> & { id?: string };

/**
 * Everything the continuation of the shot depends on besides y, read without touching the checkpoint store: the save() record
 * and aux of every checkpoint part (the shared context with its RNG and geometry, the equilibrium coupling, the stepper, the transport
 * and source models with the fast-ion and impurity/FACIT state, every event model, the flux ledger and the pedestal), the fast-ion and flux
 * snapshots, the stepper statistics and the equilibrium counters.
 */
function moduleState(m: ProfileModel) {
  const parts = (m as unknown as { checkpointParts: readonly Part[] }).checkpointParts;
  const saved: Record<string, { rec: CheckpointRecord; aux: CheckpointAux }> = {};
  parts.forEach((p, i) => {
    const rec: CheckpointRecord = {}, aux: CheckpointAux = {};
    p.save?.(rec, aux);
    saved[`${i}:${p.id ?? p.constructor?.name ?? 'part'}`] = { rec, aux };
  });
  return {
    parts: saved, fast: m.ctx.fast?.snapshot() ?? null, flux: m.ctx.flux.snapshot(), stats: { ...m.stepper.stats },
    equilibrium: { updates: m.eqUpdates, retried: m.eqRetried, rejected: m.eqRejected, forced: m.forcedSteps },
  };
}

interface Final {
  sim: Simulation;
  y: number[];
  t: number;
  steps: number;
  module: ReturnType<typeof moduleState>;
  report: unknown;
}

const finish = (sim: Simulation): Final => ({ sim, y: Array.from(sim.y), t: sim.t, steps: sim.nSteps, module: moduleState(sim.model as ProfileModel), report: sim.report() });

/** Asserts that `got` is bitwise the run of `ref`: frames and events (by digest, a mismatch names the first difference), final vector, module state, report. */
function expectSameFinal(got: Final, ref: Final & { run: Run }, label: string): void {
  expect(got.sim.done, `${label}: finished`).toBe(true);
  expectSameRun(got.sim, ref.run, label);
  expect(firstDiff(got.y, ref.y), `${label}: final state vector`).toBeNull();
  expect(got.t, `${label}: final time`).toBe(ref.t);
  expect(got.steps, `${label}: kernel steps`).toBe(ref.steps);
  expect(firstDiff(got.module, ref.module), `${label}: module state`).toBeNull();
  expect(firstDiff(got.report, ref.report), `${label}: report`).toBeNull();
}

// ---------------------------------------------------------------------------------------------------- the direct runs

/** What an impurity crash hook did to the profile-resolved species, observed around the call */
interface Content {
  /** particles of each species [volume integral of its density] */
  N: number[];
  /** the density profile of each species (cell centres) */
  profiles: number[][];
  /** cumulative outflux booked for each species, and the helium in transit to the exhaust */
  Nout: number[];
  inTransit: number;
}
interface HookCall { kind: 'ELM' | 'sawtooth'; rhoPed: number; rhoMix: number; before: Content; after: Content; rhoC: number[] }

interface Direct extends Final {
  run: Run;
  hooks: HookCall[];
}

const directs = new Map<string, Direct>();

/**
 * runAll() of a shot, once per test file, with call-through observers on the impurity crash hooks (they read, they do not write: the
 * run is compared bitwise with unobserved ones below).
 */
function direct(shot: Shot): Direct {
  const cached = directs.get(shot.name);
  if (cached) return cached;
  const sim = new Simulation(shot.cfg, shot.opts), model = sim.model as ProfileModel, hooks: HookCall[] = [];
  const content = (imp: ImpurityModel, st: ProfileState): Content => {
    const N: number[] = [], profiles: number[][] = [];
    for (let k = 0; k < imp.nSp; k++) { const b = imp.block(st.s, k); N.push(volumeIntegral(model.ctx.tg, b)); profiles.push(Array.from(b)); }
    return { N, profiles, Nout: Array.from(imp.Nout), inTransit: imp.heliumBalance(st).inTransit };
  };
  const elmCrash = ImpurityModel.prototype.elmCrash, sawtoothCrash = ImpurityModel.prototype.sawtoothCrash;
  const elmSpy = vi.spyOn(ImpurityModel.prototype, 'elmCrash').mockImplementation(function (this: ImpurityModel, st: ProfileState, rhoPed: number, fN: number, wIn: number) {
    const before = content(this, st);
    elmCrash.call(this, st, rhoPed, fN, wIn);
    hooks.push({ kind: 'ELM', rhoPed, rhoMix: NaN, before, after: content(this, st), rhoC: Array.from(model.ctx.tg.rhoC) });
  });
  const sawSpy = vi.spyOn(ImpurityModel.prototype, 'sawtoothCrash').mockImplementation(function (this: ImpurityModel, st: ProfileState, rho1: number, rhoMix: number) {
    const before = content(this, st);
    sawtoothCrash.call(this, st, rho1, rhoMix);
    hooks.push({ kind: 'sawtooth', rhoPed: NaN, rhoMix, before, after: content(this, st), rhoC: Array.from(model.ctx.tg.rhoC) });
  });
  try { sim.runAll(); } finally { elmSpy.mockRestore(); sawSpy.mockRestore(); }
  const d: Direct = { ...finish(sim), run: { history: sim.history, events: sim.events, digest: runDigest(sim.history, sim.events) }, hooks };
  directs.set(shot.name, d);
  return d;
}

const kindEvents = (r: { events: readonly SimEvent[] }, kind: string): SimEvent[] => r.events.filter((e) => e.kind === kind);
const frameAt = (r: Run, t: number): number => r.history.findIndex((f) => f.t === t);
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

// ---------------------------------------------------------------------------------------------------- activity

describe('the shots really fire the crashes they are meant to cover', () => {
  it('ELM shot: Loarte-sized Type-I ELMs, pedestal and event bookkeeping, helium flush, fast ions, current drive, FACIT, equilibrium adoptions', () => {
    const d = direct(ELM_SHOT), hist = d.run.history, m = d.sim.model as ProfileModel, last = hist[hist.length - 1];
    const elms = kindEvents(d.sim, 'ELM');
    expect(elms.length, 'real ELMs fired').toBeGreaterThanOrEqual(2);
    elms.forEach((e, k) => {
      expect(e.msg, `ELM ${k} is sized by Loarte f(nu*_ped) W_ped, not by the fixed fraction`).toMatch(/W_ped at ν\*_ped = \d/);
      expect(e.value!, `ELM ${k} energy [MJ]`).toBeGreaterThan(0);
    });
    const lh = kindEvents(d.sim, 'LH');
    expect(lh.length, 'one L-H transition').toBe(1);
    expect(lh[0].t, 'H-mode before the first ELM').toBeLessThan(elms[0].t);
    expect(last.internal.hmode, 'H-mode at the end').toBe(1);
    // pedestal: ELMs seen from the frame of the first ELM on (and not before), the event model remembers the last one
    const seen = hist.findIndex((f) => f.internal.ped_elmSeen === 1);
    expect(seen, 'the pedestal has seen an ELM').toBeGreaterThan(0);
    expect(hist[seen].t, 'ped_elmSeen switches on at the first ELM').toBe(elms[0].t);
    expect(hist.slice(seen).every((f) => f.internal.ped_elmSeen === 1), 'ped_elmSeen stays on').toBe(true);
    expect(m.ctx.ped!.elmSeen, 'the live pedestal model has seen an ELM').toBe(true);
    expect(last.internal.lastElm, 'lastElm is the time of the last ELM').toBe(elms[elms.length - 1].t);
    // every ELM took stored energy out of the plasma: the frame at the ELM against the one before it
    elms.forEach((e, k) => {
      const i = frameAt(d.run, e.t);
      expect(i, `ELM ${k} has its own frame`).toBeGreaterThan(0);
      expect(hist[i - 1].d.W - hist[i].d.W, `ELM ${k}: stored energy drop [MJ] against the booked ${e.value!.toFixed(3)} MJ`).toBeGreaterThan(0.5 * e.value!);
    });
    // impurity crash hook: one call per ELM, helium (the species with an excess over its separatrix value) flushed, booked as outflux and in transit
    expect(d.hooks.filter((h) => h.kind === 'ELM').length, 'impurity.elmCrash calls = ELM events').toBe(elms.length);
    for (const h of d.hooks) {
      expect(h.after.N[0], 'helium content falls').toBeLessThan(h.before.N[0]);
      expect(rel(h.before.N[0] - h.after.N[0], h.after.Nout[0] - h.before.Nout[0]), 'helium flushed = helium booked as outflux').toBeLessThan(1e-9);
      expect(rel(h.before.N[0] - h.after.N[0], h.after.inTransit - h.before.inTransit), 'helium flushed = helium in transit to the exhaust').toBeLessThan(1e-9);
      h.before.N.forEach((n, k) => expect(rel(n - h.after.N[k], h.after.Nout[k] - h.before.Nout[k]), `species ${k}: removed = booked`).toBeLessThan(1e-9));
    }
    expect(hist.filter((f) => f.internal.impurity_elmOut > 0).map((f) => f.t), 'helium in transit only in the frames of ELMs').toEqual(elms.map((e) => e.t));
    // fast ions, driven current, FACIT table, equilibrium
    expect(last.d.W_beam, 'beam fast-ion energy [MJ]').toBeGreaterThan(0);
    expect(last.internal.WfBeam, 'beam energy of the checkpoint [J]').toBeGreaterThan(0);
    expect(last.d.I_nbcd, 'neutral-beam driven current [MA]').toBeGreaterThan(0);
    expect(last.d.f_cd, 'driven-current fraction').toBeGreaterThan(0);
    const imp = m.ctx.impurity!, rec: CheckpointRecord = {}, aux: CheckpointAux = {};
    imp.save(rec, aux);
    const tables = aux.impurity_neo as { D: Float64Array; K: Float64Array }[];
    expect(imp.mode).toBe('facit');
    expect(imp.lastNeoRefresh, 'FACIT table refreshed more than once').toBeGreaterThan(NEO_REFRESH);
    expect(tables.some((t) => t.D.some((x) => x > 0) && t.K.some((x) => x > 0)), 'FACIT table holds a nonzero diffusivity and convection').toBe(true);
    expect(m.eqUpdates, 'accepted equilibrium updates').toBeGreaterThanOrEqual(1);
    expect(hist.some((f) => f.t > elms[0].t && f.internal.eqUpdates > hist[frameAt(d.run, elms[0].t)].internal.eqUpdates), 'an equilibrium update was adopted after the first ELM').toBe(true);
  }, LONG);

  it('sawtooth shot: two Porcelli crashes with an actual Kadomtsev q0 reset, impurity species mixed, fast ions, current drive, FACIT, an equilibrium adoption', () => {
    const d = direct(SAW_SHOT), hist = d.run.history, m = d.sim.model as ProfileModel, last = hist[hist.length - 1];
    const saw = kindEvents(d.sim, 'sawtooth');
    expect(saw.length, 'real sawtooth crashes fired').toBeGreaterThanOrEqual(2);
    expect(saw[1].t - saw[0].t, 'the crashes are one refractory time apart at least').toBeGreaterThan(0.05 - 1e-9);
    expect(kindEvents(d.sim, 'ELM').length, 'ELMs are off').toBe(0);
    expect(m.ctx.ped, 'no EPED pedestal in this shot').toBeNull();
    saw.slice(0, 2).forEach((e, k) => {
      expect(e.msg, `crash ${k} is the Porcelli trigger`).toMatch(/Porcelli/);
      expect(e.msg, `crash ${k} reset q0 by the helical-flux reconnection (the event text carries the q0 arrow only then)`).toMatch(/q0 → \d\.\d\d/);
      const i = frameAt(d.run, e.t);
      expect(i, `crash ${k} has its own frame`).toBeGreaterThan(0);
      const before = hist[i - 1].d.q0, after = hist[i].d.q0;
      expect(before, `crash ${k}: q0 before`).toBeLessThan(1);
      expect(after, `crash ${k}: q0 after`).toBeGreaterThan(0.99);
      expect(after, `crash ${k}: q0 after`).toBeLessThan(1.2);
      expect(after - before, `crash ${k}: the reset raised q0`).toBeGreaterThan(0.02);
    });
    expect(last.internal.lastSaw, 'lastSaw is the time of the last crash').toBe(saw[saw.length - 1].t);
    // impurity crash hook: one call per crash, every species flattened inside the mixing radius, particles conserved, nothing changed outside it
    expect(d.hooks.filter((h) => h.kind === 'sawtooth').length, 'impurity.sawtoothCrash calls = sawtooth events').toBe(saw.length);
    for (const h of d.hooks) {
      h.before.N.forEach((n, k) => {
        expect(rel(n, h.after.N[k]), `species ${k}: particles conserved by the mixing`).toBeLessThan(1e-12);
        let inside = 0, outside = false;
        h.before.profiles[k].forEach((v, i) => {
          if (h.rhoC[i] < h.rhoMix) inside = Math.max(inside, Math.abs(h.after.profiles[k][i] - v) / v);
          else if (h.rhoC[i] > h.rhoMix && h.after.profiles[k][i] !== v) outside = true;
        });
        expect(inside, `species ${k}: flattened inside rho_mix`).toBeGreaterThan(1e-3);
        expect(outside, `species ${k}: unchanged outside rho_mix`).toBe(false);
      });
      expect(h.after.Nout, 'the mixing books no outflux').toEqual(h.before.Nout);
    }
    expect(last.d.W_beam, 'beam fast-ion energy [MJ]').toBeGreaterThan(0);
    expect(last.internal.WfBeam, 'beam energy of the checkpoint [J]').toBeGreaterThan(0);
    expect(last.d.I_nbcd, 'neutral-beam driven current [MA]').toBeGreaterThan(0);
    expect(last.d.f_cd, 'driven-current fraction').toBeGreaterThan(0);
    const imp = m.ctx.impurity!, rec: CheckpointRecord = {}, aux: CheckpointAux = {};
    imp.save(rec, aux);
    const tables = aux.impurity_neo as { D: Float64Array; K: Float64Array }[];
    expect(imp.mode).toBe('facit');
    expect(imp.lastNeoRefresh, 'FACIT table built').toBeGreaterThanOrEqual(0);
    expect(tables.some((t) => t.D.some((x) => x > 0) && t.K.some((x) => x > 0)), 'FACIT table holds a nonzero diffusivity and convection').toBe(true);
    expect(m.eqUpdates, 'accepted equilibrium updates').toBeGreaterThanOrEqual(1);
  }, LONG);
});

// ---------------------------------------------------------------------------------------------------- determinism

/** Slices of random lengths (1e-5 to 0.1 t_end) that suspend steps (stop at a fraction pStop of the yields) until the run has reached tStop */
function advanceSlicedUntil(sim: Simulation, tStop: number, seed: number, pStop: number): void {
  const rng = new RNG(seed), stop = new RNG(seed ^ 0x5bd1e995), T = sim.model.tEnd;
  const yieldWhen = () => stop.next() < pStop;
  let guard = 0;
  while (!sim.done && sim.t < tStop && guard++ < 1e6) {
    sim.advance(T * 10 ** (-5 + 4 * rng.next()), { yieldWhen });
    if (rng.next() < 0.05 && !sim.stepInProgress) sim.report();
  }
}

/**
 * A run to frame i of the direct run (one kernel step per call, so that the model stands exactly where that frame was recorded), on to the
 * time tStop with suspended steps and left suspended in the middle of a step, then rewound to frame i and finished with other slices.
 */
function rewoundRun(shot: Shot, ref: Direct, i: number, tStop: number, seeds: { future: number; replay: number }) {
  const sim = new Simulation(shot.cfg, shot.opts), model = sim.model as ProfileModel;
  let guard = 0;
  while (sim.history.length <= i && !sim.done && guard++ < 1e5) sim.advance(1e-9);
  const frame = ref.run.history[i];
  expect(sim.history.length, 'stepped to the frame').toBe(i + 1);
  expect(sim.t, 'at the time of the frame').toBe(frame.t);
  const atCheckpoint = moduleState(model), eqAtCheckpoint = model.eqUpdates;
  advanceSlicedUntil(sim, tStop, seeds.future, 0.8);
  for (let n = 0; n < 3 && !sim.stepInProgress; n++) sim.advance(1e-3, { yieldWhen: () => true });
  const future = { stepSuspended: sim.stepInProgress, crashes: kindEvents(sim, shot.kind).length, adoptions: model.eqUpdates - eqAtCheckpoint, frames: sim.history.length - i - 1 };
  sim.rewindTo(i);
  const rewound = { stepInProgress: sim.stepInProgress, frames: sim.history.length, events: sim.events.length, crashes: kindEvents(sim, shot.kind).length, t: sim.t };
  const restored = moduleState(model);
  advanceSliced(sim, seeds.replay, 0.5);
  return { sim, atCheckpoint, restored, future, rewound, final: finish(sim), checkpointEvents: frame.sim!.nEvents };
}

/** the checkpoint frames of the rewind tests, and how many crashes the events hold at them */
const REWINDS = [
  { where: 'a frame well before the first crash', at: 'before', kept: 0 },
  { where: 'a frame strictly between the first and the second crash', at: 'between', kept: 1 },
  { where: 'the frame of the first crash itself', at: 'first', kept: 1 },
] as const;

describe.each(SHOTS)('$name: bitwise determinism around the crashes', (shot) => {
  it('random uneven chunks reproduce the direct run', () => {
    const ref = direct(shot);
    expect(kindEvents(ref.sim, shot.kind).length, 'the crashes are in the direct run').toBeGreaterThanOrEqual(2);
    const got = finish(advanceRandomly(new Simulation(shot.cfg, shot.opts), 721));
    expectSameFinal(got, ref, 'random chunks');
  }, LONG);

  it('slices that suspend steps (across crash steps and Grad-Shafranov updates) reproduce the direct run', () => {
    const ref = direct(shot);
    const got = finish(advanceSliced(new Simulation(shot.cfg, shot.opts), 921, 0.8));
    expectSameFinal(got, ref, 'sliced steps');
  }, LONG);

  for (const { where, at, kept } of REWINDS) it(`a replay after a rewind to ${where} is the direct run, whatever the discarded future held`, () => {
    const ref = direct(shot), hist = ref.run.history;
    const [t1, t2] = kindEvents(ref.sim, shot.kind).map((e) => e.t);
    let i = 0;
    if (at === 'first') i = frameAt(ref.run, t1);
    else if (at === 'between') i = hist.findIndex((f) => f.t > 0.5 * (t1 + t2));
    else hist.forEach((f, j) => { if (f.t < t1 - 0.05) i = j; }); // the last frame 50 ms before the first crash (the initial frame if there is none)
    expect(i, 'the checkpoint frame exists').toBeGreaterThanOrEqual(at === 'before' ? 0 : 1);
    if (at === 'between') { expect(hist[i].t, 'after the first crash').toBeGreaterThan(t1); expect(hist[i].t, 'before the second crash').toBeLessThan(t2); }
    else if (at === 'first') expect(hist[i].t).toBe(t1);
    else expect(hist[i].t, 'before the first crash').toBeLessThan(t1);
    // the future to discard: the next accepted equilibrium update (and with it the second crash and, in the ELM shot, a FACIT table refresh)
    const adopt = hist.find((f, j) => j > i && f.internal.eqUpdates > hist[i].internal.eqUpdates);
    expect(adopt, 'an accepted equilibrium update follows the checkpoint').toBeDefined();
    expect(adopt!.t, 'it comes after the second crash').toBeGreaterThan(t2);
    const r = rewoundRun(shot, ref, i, adopt!.t, { future: 17, replay: 531 });
    // the future really happened before it was discarded
    expect(r.future.stepSuspended, 'the future ended inside a step').toBe(true);
    expect(r.future.crashes, 'the discarded future holds the second crash').toBeGreaterThanOrEqual(2);
    expect(r.future.adoptions, 'the discarded future holds an accepted equilibrium update').toBeGreaterThanOrEqual(1);
    // and the rewind took it all back
    expect(r.rewound.stepInProgress, 'the step in progress was dropped').toBe(false);
    expect(r.rewound.frames, 'frames after the checkpoint dropped').toBe(i + 1);
    expect(r.rewound.events, 'events after the checkpoint dropped').toBe(r.checkpointEvents);
    expect(r.rewound.crashes, 'the crashes after the checkpoint are gone from the events').toBe(kept);
    expect(r.rewound.t, 'at the time of the checkpoint').toBe(hist[i].t);
    expect(firstDiff(r.restored, r.atCheckpoint), 'module state right after the rewind = the state the run had at the checkpoint').toBeNull();
    expectSameFinal(r.final, ref, 'replay after rewind');
  }, LONG);
});
