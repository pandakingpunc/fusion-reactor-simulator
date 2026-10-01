/** Cross-module seams: conservative adoption, cancelled/failed steps and composition-aware ELM loss. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JET_15D } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig, SimEvent } from '../types';
import { advanceRandomly, advanceSliced, expectSameRun, referenceRun, rewindAt } from '../kernel/testkit';
import { runSlices } from '../kernel/slices';
import type { CheckpointAux, CheckpointRecord } from './checkpoint';
import { composition } from './composition';
import { EquilibriumCoupling } from './coupling/equilibrium';
import * as outer from './coupling/outer';
import { boundaryFlux } from './current/flux';
import { ElmEvents } from './events/elm';
import type { TransportGeometry } from './geometry1d';
import { ProfileModel } from './model';
import { elmShapeForEnergy, loarteElmLoss } from './pedestal/elmSize';
import { CoupledStepper } from './solver/coupledStep';
import { volumeIntegral } from './sources/deposition';

afterEach(() => vi.restoreAllMocks());

const config = (): MagneticConfig => ({
  ...JET_15D, t_end: 0.04,
  profiles: { ...JET_15D.profiles, nRho: 24, eqNR: 33, impurityTransport: 'facit', impurityExtraSpecies: 'Ne',
    impurityExtraConcentration: 1e-3, fastIonModel: 'profile', cdModel: 'physics', neoclassicalModel: 'redl',
    pedestalModel: 'eped1', elmLoss: 'loarte', sawtoothTrigger: 'porcelli', sawtoothReconnection: 'kadomtsev',
    IpWaveform: [[0, JET_15D.Ip_MA], [0.02, 1.22 * JET_15D.Ip_MA], [0.04, 1.22 * JET_15D.Ip_MA]] },
});
const internals = (m: ProfileModel) => m as unknown as { coupling: EquilibriumCoupling; stepper: CoupledStepper };
const fresh = () => {
  const m = new ProfileModel(config()), y = m.initialState();
  m.diagnostics(0, y);
  return { m, y, ctx: m.ctx, st: m.ctx.view(y) };
};
const moduleState = (m: ProfileModel) => {
  const rec: CheckpointRecord = {}, aux: CheckpointAux = {};
  m.ctx.impurity!.save(rec, aux);
  const coupling: CheckpointRecord = {}, eqAux: CheckpointAux = {};
  internals(m).coupling.save(coupling, eqAux);
  return { rec, aux, coupling, eqAux, fast: m.ctx.fast!.snapshot(), flux: m.ctx.flux.snapshot(),
    ped: (() => { const p: CheckpointRecord = {}; m.ctx.ped!.save(p); return p; })(), stats: { ...internals(m).stepper.stats } };
};
const skewed = (g: TransportGeometry): TransportGeometry => ({ ...g,
  dV: Float64Array.from(g.dV, (x, i) => x * (1 + 0.05 * g.rhoC[i] ** 2)),
});
// A valid accepted outer result without an expensive new GS solve. The geometry builder still runs on the real equilibrium.
const stubOuter = () => vi.spyOn(outer, 'solveConsistentSlices').mockImplementation(function* (_solver, eq) {
  yield;
  return { eq, converged: true, delta: 0, outerIterations: 1,
    attempts: [{ stage: 'integration seam', iterations: 1, residual: 0, converged: true, currentScale: 1, outer: 1, fraction: 1 }], hard: false, fraction: 1 };
});

describe('merged profile-module seams', () => {
  it('adoption conserves all species, recomposed thermal energy and each fast component without a second booking', () => {
    const { m, y, ctx, st } = fresh(), imp = ctx.impurity!, fast = ctx.fast!;
    ctx.adoptGeometry({ eq: ctx.eq, tg: skewed(ctx.tg) });
    // Initialise the accounting on this geometry, then make distinct nonuniform species/pool profiles.
    imp.initialise(st);
    for (let i = 0; i < ctx.N; i++) {
      for (let k = 0; k < imp.nSp; k++) imp.block(st.s, k)[i] = st.ne[i] * (0.003 / (k + 1)) * (1 + 0.4 * ctx.tg.rhoC[i]);
      fast.alpha.W[i] = 8e3 * (1 + ctx.tg.rhoC[i]);
      fast.beam.forEach((b, k) => { b.W[i] = (k + 1) * 2e4 * (1 - 0.5 * ctx.tg.rhoC[i]); });
    }
    imp.quench(st, 1); // align scalar mirrors without loss
    for (let k = 0; k < imp.nSp; k++) imp.N0[k] = volumeIntegral(ctx.tg, imp.block(st.s, k));
    const contents = fast.contents(ctx.tg.dV);
    ctx.WfAlpha = contents.alpha; ctx.WfBeam = contents.beam;
    m.physics.evaluateWorkArrays(0, st);
    const old = ctx.tg, ne0 = st.ne.slice(), imp0 = st.s.imp.slice(), Te0 = st.Te.slice(), Ti0 = st.Ti.slice();
    const ni0 = ctx.w.ni.slice(), W0 = ctx.storedEnergy(st), f0 = fast.snapshot();
    const NHe0 = st.s.NHe, cZ0 = st.s.cZ, counters = { src: imp.Nsrc.slice(), out: imp.Nout.slice() };
    const dp0 = ctx.cur.dpsiF(st.psi, st.s.Ip, new Float64Array(ctx.N + 1));
    const I0 = ctx.cur.Ienc(dp0, new Float64Array(ctx.N + 1)), psiB0 = boundaryFlux(old, st.psi, dp0);
    stubOuter();
    expect(m.updateEquilibrium(0.01, y)).toBe(true);
    expect(ctx.tg).not.toBe(old);
    for (let i = 0; i < ctx.N; i++) {
      expect(st.ne[i] * ctx.tg.dV[i] / (ne0[i] * old.dV[i])).toBeCloseTo(1, 12);
      expect(ctx.w.ni[i] * ctx.tg.dV[i] / (ni0[i] * old.dV[i])).toBeCloseTo(1, 12);
      for (let k = 0; k < imp.nSp; k++) expect(imp.block(st.s, k)[i] * ctx.tg.dV[i] / (imp0[k * ctx.N + i] * old.dV[i])).toBeCloseTo(1, 12);
      expect(fast.alpha.W[i] * ctx.tg.dV[i] / (f0.alpha[i] * old.dV[i])).toBeCloseTo(1, 12);
      fast.beam.forEach((b, k) => expect(b.W[i] * ctx.tg.dV[i] / (f0.beam[k][i] * old.dV[i])).toBeCloseTo(1, 12));
    }
    expect(st.Te).toEqual(Te0); expect(st.Ti).toEqual(Ti0);
    expect(ctx.storedEnergy(st) / W0).toBeCloseTo(1, 12);
    expect(ctx.WfAlpha).toBe(contents.alpha); expect(ctx.WfBeam).toBe(contents.beam);
    const dp = ctx.cur.dpsiF(st.psi, st.s.Ip, new Float64Array(ctx.N + 1));
    const I = ctx.cur.Ienc(dp, new Float64Array(ctx.N + 1));
    for (let i = 0; i <= ctx.N; i++) expect(Math.abs(I[i] - I0[i]) / st.s.Ip).toBeLessThan(1e-12);
    expect(boundaryFlux(ctx.tg, st.psi, dp)).toBeCloseTo(psiB0, 12);
    const checkpoint = m.saveInternal(), savedY = y.slice();
    imp.quench(st, 1); // the first post-adoption call must not fabricate remap particles
    expect(imp.Nremap).toEqual(new Float64Array(imp.nSp));
    m.restoreInternal(checkpoint); y.set(savedY); imp.quench(st, 1);
    expect(imp.Nremap).toEqual(new Float64Array(imp.nSp));
    expect(imp.Nsrc).toEqual(counters.src); expect(imp.Nout).toEqual(counters.out);
    for (let k = 0; k < imp.nSp; k++) expect(volumeIntegral(ctx.tg, imp.block(st.s, k)) / imp.N0[k]).toBeCloseTo(1, 12);
    expect(st.s.NHe / NHe0).toBeCloseTo(1, 12); expect(st.s.cZ / cZ0).toBeCloseTo(1, 12);
  });

  it.each(['exception', 'cancel'] as const)('restores every module and coupling when an accepted sliced step ends by %s', (how) => {
    const { m, y, ctx } = fresh();
    ctx.adoptGeometry({ eq: ctx.eq, tg: skewed(ctx.tg) });
    ctx.impurity!.initialise(ctx.view(y));
    m.diagnostics(0, y);
    internals(m).coupling.eqTime = -1; // the next accepted step enters the outer generator
    const before = moduleState(m), y0 = y.slice(), geo = ctx.geo, dirty = ctx.eqDirty;
    stubOuter();
    const evaluate = vi.spyOn(m.physics, 'evaluateWorkArrays');
    if (how === 'exception') evaluate.mockImplementationOnce(() => { throw new Error('after adoption'); });
    const g = m.stepSlices(0, y, 0.002);
    let reachedAccepted = false;
    for (let n = 0; n < 100; n++) {
      const r = g.next();
      expect(r.done).toBe(false);
      if (ctx.flux.snapshot().on) { reachedAccepted = true; break; }
    }
    expect(reachedAccepted).toBe(true);
    expect(ctx.impurity!.lastNeoRefresh).toBeGreaterThan(before.rec.impurity_tNeo); // the accepted impurity hook has run
    if (how === 'exception') expect(() => runSlices(g)).toThrow('after adoption');
    else g.return(0);
    expect(y).toEqual(y0); expect(ctx.geo).toBe(geo); expect(ctx.eqDirty).toBe(dirty);
    expect(moduleState(m)).toEqual(before);
    evaluate.mockRestore();
    // Retry has the same state and bookkeeping as a fresh model that never attempted the cancelled step.
    const ref = fresh();
    ref.ctx.adoptGeometry({ eq: ref.ctx.eq, tg: skewed(ref.ctx.tg) });
    ref.ctx.impurity!.initialise(ref.st);
    internals(ref.m).coupling.eqTime = -1;
    const tm = m.step(0, y, 0.002), tr = ref.m.step(0, ref.y, 0.002);
    expect(tm).toBe(tr); expect(y).toEqual(ref.y);
    expect(ctx.lastDiag).toEqual(ref.ctx.lastDiag);
  });

  it('Loarte trials are pure and actual species flushing books the recomposed thermal loss with a widened shape', () => {
    const { m, y, ctx, st } = fresh(), imp = ctx.impurity!;
    ctx.hmode = true;
    // Low-collisionality pedestal and distinct species concentrations: frozen ni/ne cannot represent its cooling/flushing.
    for (let i = 0; i < ctx.N; i++) {
      st.Te[i] = 9; st.Ti[i] = 11; st.ne[i] = 8e19;
      for (let k = 0; k < imp.nSp; k++) imp.block(st.s, k)[i] = st.ne[i] * (k === 0 ? 0.02 : 0.006 / k) * (1 + ctx.tg.rhoC[i]);
    }
    ctx.ped!.width = 0.04;
    imp.quench(st, 1); composition(ctx, st.Te, st.ne, st.s);
    const W0 = ctx.storedEnergy(st), y0 = y.slice(), before = moduleState(m), rhoPed = 1 - ctx.pedWidth;
    const loss = loarteElmLoss(ctx, st, rhoPed, 3), shape = elmShapeForEnergy(ctx, st, rhoPed, loss.energy);
    expect(shape.capped).toBe(false); expect(shape.width).toBeGreaterThan(0.15);
    expect(moduleState(m)).toEqual(before); expect(y).toEqual(y0);
    let hookSawFlushed = false;
    ctx.crashHook = () => { hookSawFlushed = imp.Nout[0] > 0; };
    vi.spyOn(ctx.rng, 'next').mockReturnValue(0.5); // scatter exactly 1
    const ev: SimEvent[] = [];
    new ElmEvents().afterStep(ctx, 2, st, { ped_ratio: 2, tauE: 1, q95: 3 }, ev);
    composition(ctx, st.Te, st.ne, st.s);
    const actual = W0 - ctx.storedEnergy(st);
    expect(actual / loss.energy).toBeCloseTo(1, 8);
    expect(ctx.crashE).toBe(actual); expect(st.s.Pelm).toBe(actual);
    expect(ev[0].value! * 1e6 / actual).toBeCloseTo(1, 12); expect(hookSawFlushed).toBe(true);
    const original = ctx.view(y0);
    let widened = 0;
    for (let i = 0; i < ctx.N; i++) {
      const fn = 1 - (st.ne[i] - ctx.bc.n) / (original.ne[i] - ctx.bc.n);
      for (let k = 0; k < imp.nSp; k++) {
        const edge = imp.edgeConcentration(k) * ctx.bc.n;
        expect((imp.block(original.s, k)[i] - imp.block(st.s, k)[i]) / (imp.block(original.s, k)[i] - edge)).toBeCloseTo(fn, 10);
      }
      if (ctx.tg.rhoC[i] < rhoPed - 0.15 && fn > 1e-6) widened++;
    }
    expect(widened).toBeGreaterThan(0);
  });

  // Ends at 0.04 s, before the L-H guard and with no q = 1 surface: no ELM and no sawtooth fires here. The real Loarte ELMs and the
  // Porcelli trigger with the Kadomtsev reset under the same chunking, slicing and rewind are in integrationSeams.events.test.ts.
  it('the combined opt-ins preserve direct, chunked, sliced and rewound runs', () => {
    const cfg = config(), ref = referenceRun(cfg);
    const chunks = advanceRandomly(new Simulation(cfg), 721);
    expect((chunks.model as ProfileModel).eqUpdates).toBeGreaterThan(0);
    expectSameRun(ref, chunks, 'combined random chunks');
    expectSameRun(ref, advanceSliced(new Simulation(cfg), 921, 0.8), 'combined slices');
    const replay = rewindAt(cfg, 0.4, 117);
    expectSameRun(ref, advanceSliced(replay, 531, 0.8), 'combined sliced rewind');
  }, 60000);
});
