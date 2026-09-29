/**
 * The predictive closures 'bgb' (mixed Bohm/gyro-Bohm) and 'ifspppl' (IFS-PPPL) on whole shots: they run through the Newton solve without
 * a Jacobian outside the block-tridiagonal band (what `TransportModel.prepare` is for), stay chunk invariant and rewind exactly, and report
 * the confinement they arrive at (the diagnostics H98y2 and HITPA20 and the report entries).
 */
import { describe, expect, it } from 'vitest';
import { blockTridiag, coloredJacobian } from '../../numerics/blockTridiagN';
import { Simulation } from '../../simulation';
import { tauHmode } from '../../transport';
import { advanceRandomly, expectSameRun, normalizeRng, presetCfg, referenceRun, rewindAt, runChunked } from '../../kernel/testkit';
import type { Geometry } from '../../geometry';
import type { MagneticConfig } from '../../types';
import { ProfileModel } from '../model';
import type { NewtonStage } from '../solver/newtonStage';
import type { TransportModel } from '.';
import { createTransportModel } from '.';

type Model = 'bgb' | 'ifspppl';
const MODELS: Model[] = ['bgb', 'ifspppl'];
const M = 4;

const jet = (model: Model | 'scaling', tEnd: number): MagneticConfig => {
  const c = presetCfg('JET15', tEnd) as MagneticConfig;
  return { ...c, profiles: { ...c.profiles, transportModel: model } } as MagneticConfig;
};

class Stop extends Error {}

describe.each(MODELS)("'%s' on a JET15 ramp-up", (model) => {
  it('runs through the Newton solve to its end without a forced step, with C_χ = 1 and τ_E = W/P_loss in every frame', () => {
    const sim = new Simulation(jet(model, 0.6));
    const m = sim.model as ProfileModel;
    sim.runAll();
    expect(m.terminated?.reason).toBe('Scheduled end');
    expect(m.forcedSteps).toBe(0);
    expect(m.stepFailure).toBeNull();
    const st = m.stepper.stats;
    expect(st.newtonIters).toBeGreaterThan(100);
    expect(st.fallbacks).toBeLessThan(0.05 * st.accepted);
    for (const h of sim.history) {
      for (const [k, v] of Object.entries(h.d)) if (!Number.isFinite(v)) throw new Error(`t = ${h.t}: ${k} = ${v}`);
    }
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
    for (const h of sim.history.slice(1)) {
      expect(rel(h.d.tauE, h.d.W / h.d.P_loss)).toBeLessThan(1e-12);
      expect(h.d.chi_mult).toBe(1);
    }
    expect(sim.history[sim.history.length - 1].d.Te0).toBeGreaterThan(1);
  }, 120000);

  it('reports the confinement it arrives at: H98y2 and HITPA20 are τ_E over the two H-mode scalings at the same loss power, in every frame and in the report', () => {
    const sim = new Simulation(jet(model, 0.3));
    const m = sim.model as ProfileModel;
    sim.runAll();
    const g = m.ctx.tg;
    const gS: Geometry = { R: g.R0, a: g.a, kappa: m.ctx.kappaA, delta: m.ctx.geomB.delta };
    for (const h of sim.history) {
      const d = h.d;
      const args = [gS, d.Ip, g.B0, d.nbar * 1e20, d.P_loss * 1e6, m.ctx.M] as const;
      // to 1e-5: κ_a of the transport geometry changes with the equilibrium updates, by 1e-7 over this run, and only the last one is at hand here
      expect(d.H98y2 / (d.tauE / tauHmode('IPB98y2', ...args)) - 1).toBeCloseTo(0, 5);
      expect(d.HITPA20 / (d.tauE / tauHmode('ITPA20', ...args)) - 1).toBeCloseTo(0, 5);
    }
    const rep = sim.report().engineering;
    for (const k of ['Emergent τ_E (flat-top mean, s)', 'Emergent H98(y,2) (flat-top mean)', 'Emergent H(ITPA20) (flat-top mean)']) {
      expect(typeof rep[k]).toBe('number');
      expect(rep[k] as number).toBeGreaterThan(0);
    }
    // the diagnostics have specs: the UI and the exports know them
    const keys = new Set(sim.model.diagSpecs.map((s) => s.key));
    expect(keys.has('H98y2') && keys.has('HITPA20')).toBe(true);
  }, 120000);

  it('has a block-tridiagonal Jacobian at a stage of the shot: the coloured finite-difference one equals the column-by-column one and nothing lies outside the band', () => {
    const sim = new Simulation(jet(model, 1.0));
    const m = sim.model as ProfileModel;
    const nst = (m.stepper as unknown as { newton: NewtonStage }).newton;
    const orig = nst.solve.bind(nst);
    let call = 0, done = false;
    nst.solve = (v, K, heat, dens, cur, opts) => {
      if (++call < 120) return orig(v, K, heat, dens, cur, opts);
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
          worst = Math.max(worst, Math.abs(arr[i * mm + (r % M) * M + (c % M)] - full[r * n + c]) / rowMax);
          inside = Math.max(inside, Math.abs(full[r * n + c]) / rowMax);
        }
      }
      expect(inside).toBeGreaterThan(0.5);
      expect(worst).toBeLessThan(1e-3);
      expect(outside).toBeLessThan(1e-4);
      done = true;
      throw new Stop();
    };
    try { sim.runAll(); } catch (e) { if (!(e instanceof Stop)) throw e; }
    expect(done).toBe(true);
  }, 120000);

  it('is chunk invariant and rewinds exactly (the held quantities are a function of the old state, nothing is checkpointed)', () => {
    const c = jet(model, 0.3);
    const ref = referenceRun(c);
    for (let s = 1; s <= 2; s++) expectSameRun(runChunked(c, 7000 + s), ref, `${model} schedule ${s}`);
    const sim = rewindAt(c, 0.5, 7100);
    advanceRandomly(sim, 7101);
    expectSameRun(normalizeRng(sim), normalizeRng(ref), `${model} rewound at 50 %`);
  }, 240000);
});

describe('the TransportModel.prepare hook', () => {
  it('runs once per implicit attempt on the OLD state, before any evaluation of the diffusivities of that attempt, and for a state no step produced', () => {
    const real = createTransportModel('bgb');
    const log: string[] = [];
    let yOldNow: Float64Array | null = null;
    let preparedOn: Float64Array | null = null;
    const spy: TransportModel = {
      id: 'spy', predictive: true,
      prepare: (ctx, t, st) => { log.push('prepare'); preparedOn = Float64Array.from(st.Te); real.prepare!(ctx, t, st); },
      diffusivities: (ctx, st, chiE, chiI) => { log.push('diffusivities'); real.diffusivities(ctx, st, chiE, chiI); },
    };
    const m = new ProfileModel(jet('bgb', 0.05), { transport: spy });
    const y = m.initialState();
    m.diagnostics(0, y);
    // the evaluation of a state that no step produced: prepare, then the coefficients
    expect(log.slice(0, 2)).toEqual(['prepare', 'diffusivities']);
    log.length = 0;
    const implicitStep = m.stepper.implicitStep.bind(m.stepper);
    let attempts = 0;
    m.stepper.implicitStep = (t, dt, yOld, yNew) => { attempts++; yOldNow = yOld; log.push('attempt'); return implicitStep(t, dt, yOld, yNew); };
    let t = 0;
    for (let k = 0; k < 20; k++) t = m.step(t, y, 0.05);
    expect(attempts).toBeGreaterThanOrEqual(20);
    // every attempt: attempt, prepare, then diffusivities (rates of the old state and every Newton evaluation) — never a diffusivities before its prepare
    let prepared = 0;
    for (let i = 0; i < log.length; i++) {
      if (log[i] === 'attempt') { expect(log[i + 1]).toBe('prepare'); prepared++; }
      if (log[i] === 'diffusivities') expect(['prepare', 'diffusivities']).toContain(log[i - 1]);
    }
    expect(prepared).toBe(attempts);
    expect(yOldNow).not.toBeNull();
    expect(preparedOn).not.toBeNull();
  }, 60000);
});
