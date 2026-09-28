/**
 * Fast-ion pressure and the thermal β_N of the 1.5D model, with the definitions of the 0D model
 * (confinement/magnetic.ts): β_T and β_N carry the pressure of the NBI ions and of the fast fusion
 * products, β_N,th (the drive of the NTMs) the thermal pressure only. The energy content of the fast
 * ions is a pool that builds up with τ_W and decays after the source stops (fastIons.ts), so that it
 * cannot exceed the injected energy: a content that jumped to its steady value P τ_W at the first
 * step exceeded the injected energy several times over and ended JET15 with a beam of 300 keV or more
 * in a spurious Troyon-limit disruption.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { JET_15D } from '../presets';
import { criticalEnergy, fastIonEnergyTime } from '../heating';
import type { MagneticConfig } from '../types';
import { MU0 } from './context';
import { powerTotals } from './diagnostics';
import { relaxPool } from './fastIons';
import { ProfileModel } from './model';
import { volumeIntegral } from './sources/deposition';
import { rel, stepChecks } from './testkit';

const jetBeam = (E_NBI_keV: number, t_end: number): MagneticConfig => ({ ...JET_15D, heating: { ...JET_15D.heating, E_NBI_keV }, t_end });

/**
 * Steps a model of cfg to its end and calls fn after every accepted step with the time of the step,
 * its length and the diagnostics (before the equilibrium update check).
 */
function stepEach(cfg: MagneticConfig, fn: (t: number, dt: number, d: Readonly<Record<string, number>>, m: ProfileModel) => void): ProfileModel {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  let tPrev = 0;
  const check = m.coupling.check.bind(m.coupling);
  m.coupling.check = (ctx, t, yy, update) => { fn(t, t - tPrev, ctx.lastDiag, m); tPrev = t; return check(ctx, t, yy, update); };
  let t = 0;
  while (t < cfg.t_end - 1e-9 && !m.terminated) { const t0 = t; t = m.step(t, y, cfg.t_end); m.postStep(t, t - t0, y); }
  return m;
}

describe('fast-ion pressure and the thermal β_N', () => {
  let flat: Simulation['history'];
  beforeAll(() => {
    const sim = new Simulation({ ...JET_15D, t_end: 5 });
    sim.runAll();
    flat = sim.history.filter((h) => h.t > 3);
  }, 120000);

  it('β_N follows the total pressure, β_N,th the thermal one: β_N = β_N,th (1 + W_f/W), and β_N,th is the thermal stored energy over the volume', () => {
    const n = stepChecks({ ...JET_15D, t_end: 1.5 }, 1.5, (ctx, d) => {
      const g = ctx.tg;
      expect(rel(d.Wf, d.W_alpha + d.W_beam)).toBeLessThan(1e-12);
      expect(rel(d.betaN, d.betaN_th * (1 + d.Wf / d.W))).toBeLessThan(1e-12);
      const betaTh = (2 * MU0 * (d.W * 1e6) / (1.5 * g.volume)) / (g.B0 * g.B0);
      expect(rel(d.betaN_th, (betaTh * 100 * g.a * g.B0) / d.Ip)).toBeLessThan(1e-12);
      expect(d.betaN).toBeGreaterThanOrEqual(d.betaN_th);
    });
    expect(n).toBeGreaterThan(50);
    // the frames of the whole run agree as well, to the accuracy of the equilibrium changes of B0
    for (const h of flat) expect(rel(h.d.betaN, h.d.betaN_th * (1 + h.d.Wf / h.d.W))).toBeLessThan(1e-12);
  });

  it('JET15 (NBI): the fast ions are a substantial part of the pressure, most of it the beam', () => {
    const d = flat[flat.length - 1].d;
    expect(d.P_beam_heat).toBeGreaterThan(0.8 * JET_15D.heating.P_NBI_MW); // absorbed part of the injected NBI power
    expect(d.P_beam_heat).toBeLessThan(JET_15D.heating.P_NBI_MW + 1e-9);
    expect(d.W_beam).toBeGreaterThan(0.1);
    expect(d.W_beam).toBeGreaterThan(5 * d.W_alpha);
    expect(d.Wf / d.W).toBeGreaterThan(0.08);
    expect(d.betaN).toBeGreaterThan(1.08 * d.betaN_th);
  });

  it('the steady content w.Wbeam is P τ_W of the slowing-down distribution, cell by cell (Stix: τ_W = τ_se (1 − G)/2, at least 1 ms)', () => {
    const cfg: MagneticConfig = { ...JET_15D, heating: { ...JET_15D.heating, P_NBI_MW: 30, P_ICRH_MW: 0, P_ECRH_MW: 0, E_NBI_keV: 800 } };
    const m = new ProfileModel(cfg);
    const y = m.initialState();
    const st = m.ctx.view(y);
    st.Te.fill(6); st.Ti.fill(6); st.ne.fill(4e19);
    const K = m.physics.evaluateWorkArrays(100, st);
    const w = m.ctx.w, ctx = m.ctx;
    let total = 0;
    for (let i = 0; i < ctx.N; i++) {
      const Ec = criticalEnergy(6, 2.014, w.ionSum[i]);
      const want = K.P_NBI * w.nbiDep[i] * Math.max(fastIonEnergyTime(6, 4e19, 2.014, 1, 800, Ec), 1e-3);
      expect(rel(w.Wbeam[i], want)).toBeLessThan(1e-12);
      // the time constant per cell (a single 800 keV component), the ratio of the content to the deposited power
      expect(rel(w.tauWb[i], Math.max(fastIonEnergyTime(6, 4e19, 2.014, 1, 800, Ec), 1e-3))).toBeLessThan(1e-12);
      total += w.Wbeam[i] * ctx.tg.dV[i];
    }
    expect(total).toBeGreaterThan(1e5);
    expect(rel(powerTotals(ctx, K).Wss_beam, total)).toBeLessThan(1e-12);
    expect(rel(volumeIntegral(ctx.tg, w.Wbeam), total)).toBeLessThan(1e-12);
  });
});

describe('the beam time constant does not depend on the beam power', () => {
  const evaluate = (poolJ: number, P_NBI_MW: number) => {
    const m = new ProfileModel({ ...JET_15D, heating: { ...JET_15D.heating, P_NBI_MW } });
    const y = m.initialState();
    const st = m.ctx.view(y);
    st.Te.fill(5); st.Ti.fill(5); st.ne.fill(5e19);
    m.ctx.WfBeam = poolJ;
    m.physics.evaluateWorkArrays(100, st);
    return m.ctx;
  };
  it('τ_W per cell is the mix of the three energy components of a positive-ion beam (0.75/0.15/0.10 of E, E/2, E/3), with the beam on or, while its pool is not empty, off', () => {
    const E = JET_15D.heating.E_NBI_keV;
    for (const [pool, P] of [[0, 20], [2e6, 0]] as const) {
      const ctx = evaluate(pool, P), w = ctx.w;
      const Ec = criticalEnergy(5, 2.014, w.ionSum[0]);
      const want = [[E, 0.75], [E / 2, 0.15], [E / 3, 0.1]].reduce((a, [Ek, fk]) => a + fk * Math.max(fastIonEnergyTime(5, 5e19, 2.014, 1, Ek, Ec), 1e-3), 0);
      expect(want).toBeGreaterThan(1e-3);
      for (let i = 0; i < ctx.N; i++) expect(rel(w.tauWb[i], want)).toBeLessThan(1e-12);
    }
  });

  it('with the beam off and an empty pool nothing is evaluated (the arrays are zero)', () => {
    const ctx = evaluate(0, 0);
    for (let i = 0; i < ctx.N; i++) { expect(ctx.w.tauWb[i]).toBe(0); expect(ctx.w.Wbeam[i]).toBe(0); }
  });
});

describe('the fast-ion energy content builds up and decays with τ_W (the 0D pool dynamics)', () => {
  it('relaxPool is the exact solution of dW/dt = P − W/τ: split steps compose, small Euler steps converge to it, and a step gains at most P Δt', () => {
    const P = 3e6, tau = 0.4, Wss = P * tau;
    // two half steps equal one step
    expect(rel(relaxPool(relaxPool(1e5, Wss, tau, 0.05), Wss, tau, 0.05), relaxPool(1e5, Wss, tau, 0.1))).toBeLessThan(1e-13);
    // the ODE with a small step
    let W = 1e5;
    const n = 200000, h = 0.7 / n;
    for (let k = 0; k < n; k++) W += h * (P - W / tau);
    expect(rel(relaxPool(1e5, Wss, tau, 0.7), W)).toBeLessThan(1e-5);
    // the gain of a step from an empty pool never exceeds the injected energy, for any τ_W and Δt
    for (const dt of [1e-6, 1e-3, 0.05, 1, 100]) for (const tw of [1e-3, 0.01, 0.4, 5]) expect(relaxPool(0, P * tw, tw, dt)).toBeLessThanOrEqual(P * dt * (1 + 1e-12));
    // steady: it stays; source off: it decays as exp(−Δt/τ_W); the time constant is floored at 1 ms
    expect(relaxPool(Wss, Wss, tau, 3)).toBeCloseTo(Wss, 6);
    expect(rel(relaxPool(Wss, 0, tau, tau), Wss * Math.exp(-1))).toBeLessThan(1e-13);
    expect(relaxPool(Wss, 0, 0, 1e-3)).toBeCloseTo(Wss * Math.exp(-1), 6);
  });

  // The energy content follows P − W/τ_W, so W_beam ≤ ∫ P_beam dt and W_α ≤ ∫ P_α dt after every step (the
  // first step gains at most P Δt). JET15 at 500 keV: the content that used to be P τ_W at once (τ_W ≈ 1.2 s at
  // the start-up density) was 4.6 times the injected energy at t = 0.44 s, 13.6 against 3.0 MJ.
  it('W_beam ≤ ∫ P_beam dt and W_α ≤ ∫ P_α dt after every accepted step, and the bound is nearly attained at the start', () => {
    let cumB = 0, cumA = 0, bestB = 0, bestA = 0, n = 0;
    stepEach(jetBeam(500, 1.5), (_t, dt, d) => {
      cumB += d.P_beam_heat * 1e6 * dt; cumA += d.P_alpha * 1e6 * dt; n++;
      expect(d.W_beam * 1e6).toBeLessThanOrEqual(cumB * (1 + 1e-9));
      expect(d.W_alpha * 1e6).toBeLessThanOrEqual(cumA * (1 + 1e-9));
      if (cumB > 1e3) bestB = Math.max(bestB, (d.W_beam * 1e6) / cumB);
      if (cumA > 1e3) bestA = Math.max(bestA, (d.W_alpha * 1e6) / cumA);
    });
    expect(n).toBeGreaterThan(100);
    expect(bestB).toBeGreaterThan(0.9); // not a vacuous bound: the content is close to the injected energy while τ_W ≫ t
    expect(bestA).toBeGreaterThan(0.5);
  });

  it.each([300, 500])('JET15 with a %s keV beam runs to its scheduled end (with the content at P τ_W from the first step β_N reached 3.6 at 0.5 s and the Troyon limit ended the shot)', (E) => {
    const cfg = jetBeam(E, 2);
    const sim = new Simulation(cfg);
    sim.runAll();
    expect(sim.report().termination.reason).toBe('Scheduled end');
    const bn = sim.history.map((h) => h.d.betaN);
    expect(Math.max(...bn)).toBeLessThan(cfg.limits.betaN_limit);
    // the pressure of the fast ions is still a large part of the total once the pool has built up
    const d = sim.history[sim.history.length - 1].d;
    expect(d.betaN / d.betaN_th).toBeGreaterThan(1.3);
  }, 120000);

  it('the pool lags the steady content P τ_W of its work arrays while τ_W is long (500 keV, t = 0.3 s) and reaches it after a few τ_W (110 keV, 2.9 s)', () => {
    let early = 0, late = 0;
    stepEach(jetBeam(500, 0.32), (t, _dt, d, m) => { if (t > 0.3) early = d.W_beam / (volumeIntegral(m.ctx.tg, m.ctx.w.Wbeam) * 1e-6); });
    stepEach(jetBeam(110, 3), (t, _dt, d, m) => { if (t > 2.9) late = d.W_beam / (volumeIntegral(m.ctx.tg, m.ctx.w.Wbeam) * 1e-6); });
    expect(early).toBeGreaterThan(0.02);
    expect(early).toBeLessThan(0.4); // it used to be 1
    expect(late).toBeGreaterThan(0.9);
    expect(late).toBeLessThan(1.1);
  }, 120000);

  it('after the beam is switched off its pool decays as exp(−Δt/τ_W) step by step, with τ_W of the plasma at that moment, while the heating stops at once', () => {
    let off = false, prev = 0, steps = 0, first = 0, afterFirst = 0, last = 0, worst = 0;
    stepEach(jetBeam(500, 2.6), (t, dt, d, m) => {
      if (!off && t > 1.5) { m.applyControl({ P_NBI_MW: 0 }); off = true; first = d.W_beam; prev = d.W_beam; return; }
      if (!off) return;
      const tau = Math.max(m.ctx.volAvg(m.ctx.w.tauWb), 1e-3);
      expect(d.P_beam_heat).toBe(0);
      worst = Math.max(worst, rel(d.W_beam, prev * Math.exp(-dt / tau)));
      if (steps === 0) afterFirst = d.W_beam;
      prev = d.W_beam; last = d.W_beam; steps++;
    });
    expect(steps).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-12);
    // the content does not vanish with the heating (τ_W is a few tens of ms in the flat-top density, not the 1 ms floor), and it decays
    expect(afterFirst).toBeGreaterThan(0.5 * first);
    expect(last).toBeLessThan(0.05 * first);
  }, 120000);

  it('a replay from a start-up frame, where the pools are far from their steady content, is bitwise identical (the pools are in the checkpoint)', () => {
    const cfg = jetBeam(300, 1.2);
    const ref = new Simulation(cfg);
    ref.runAll();
    const idx = ref.history.findIndex((h) => h.t > 0.25);
    expect(idx).toBeGreaterThan(3);
    expect(ref.history[idx].d.W_beam).toBeGreaterThan(0.1);
    const sim = new Simulation(cfg);
    sim.runAll();
    sim.rewindTo(idx);
    sim.advance(cfg.t_end);
    expect(sim.history.length).toBe(ref.history.length);
    for (let k = idx + 1; k < ref.history.length; k++) {
      expect(sim.history[k].y).toEqual(ref.history[k].y);
      for (const key of ['W_beam', 'W_alpha', 'Wf', 'betaN', 'betaN_th']) expect(sim.history[k].d[key], `${key} at frame ${k}`).toBe(ref.history[k].d[key]);
    }
  }, 120000);

  it('a disruption ends the fast-ion energy: the quench frames carry none, and the pools are empty', () => {
    const cfg: MagneticConfig = { ...JET_15D, t_end: 4, limits: { ...JET_15D.limits, betaN_limit: 1.1 } };
    const sim = new Simulation(cfg);
    sim.runAll();
    const idx = sim.history.findIndex((h) => h.internal.phase > 0);
    expect(idx).toBeGreaterThan(0);
    expect(sim.history[idx - 1].d.Wf).toBeGreaterThan(0);
    // the frame of the onset still shows the last normal step; the quench steps after it carry no fast ions
    expect(sim.history.length).toBeGreaterThan(idx + 3);
    for (const h of sim.history.slice(idx + 1)) expect(h.d.Wf).toBe(0);
    expect((sim.model as ProfileModel).ctx.WfBeam).toBe(0);
    expect((sim.model as ProfileModel).ctx.WfAlpha).toBe(0);
  }, 120000);
});
