/**
 * The 1.5D counterparts of the 0D physics fixes of ws2b (confinement/magnetic.ts) for the loss power,
 * tested where they meet the shot: the loss power P_L = P_heat − P_rad,core − dW/dt of the τ_E scaling
 * and of the L–H test (core radiation from ρ < RHO_CORE, dW/dt smoothed and including the ELM losses),
 * the L–H threshold with the low-density branch, and one definition of the stored energy. The reaction
 * physics has its own tests (sources/fusion.test.ts), ignition and the ignition test are in ignition.test.ts,
 * the fast-ion pressure in fastIons.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D, JET_15D } from '../presets';
import { FUEL_SPECIES } from '../reactivity';
import { pLH_Martin, pLH_threshold, nLHmin } from '../transport';
import type { MagneticConfig, SimEvent } from '../types';
import { RHO_CORE } from '../radiation';
import { scalingTauE } from './control/confinement';
import { powerTotals } from './diagnostics';
import { ntmConfinementFactor } from './events/ntm';
import { ProfileModel } from './model';
import { mean, rel, stepChecks } from './testkit';

describe('core radiation of the loss power', () => {
  it.each([50, 47, 40])('N = %s cells: bremsstrahlung and line radiation inside ρ < 0.6 (a straddling cell by its share) plus all the synchrotron radiation', (N) => {
    const m = new ProfileModel({ ...JET_15D, profiles: { ...JET_15D.profiles, nRho: N } });
    const y = m.initialState();
    const st = m.ctx.view(y);
    const K = m.physics.evaluateWorkArrays(100, st);
    const g = m.ctx.tg, w = m.ctx.w;
    let core = 0;
    for (let i = 0; i < N; i++) {
      const lo = i / N, hi = (i + 1) / N;
      const share = Math.max(0, Math.min(hi, RHO_CORE) - lo) / (hi - lo);
      core += share * (w.Pbr[i] + w.Pline[i]) * g.dV[i];
    }
    const P = powerTotals(m.ctx, K);
    expect(K.Psync).toBeGreaterThan(0);
    expect(rel(P.P_rad_core, core + K.Psync)).toBeLessThan(1e-12);
    // the mantle radiates too, so the core is a part of the total
    expect(P.P_rad_core).toBeLessThan(P.P_rad);
    expect(P.P_rad_core).toBeGreaterThan(K.Psync);
    // the cell-edge case: 40 cells put a face at exactly ρ = 0.6 (cells 0 … 23 end at or below it), so 24 cells count fully
    if (N === 40) {
      let full = 0;
      for (let i = 0; i < 24; i++) full += (w.Pbr[i] + w.Pline[i]) * g.dV[i];
      expect(rel(P.P_rad_core, full + K.Psync)).toBeLessThan(1e-12);
    }
  });
});

describe('loss power P_L = P_heat − P_rad,core − dW/dt', () => {
  let sim: Simulation;
  let V = 0;
  beforeAll(() => {
    sim = new Simulation({ ...ITER_15D, t_end: 30 });
    sim.runAll();
    V = (sim.model.geometryInfo() as { V: number }).V;
  }, 120000);

  it('every frame (steps, crash frames, the first frame) satisfies the definition, with the floors of the 0D model', () => {
    let free = 0;
    for (const h of sim.history) {
      const d = h.d;
      const cand = d.P_heat - d.P_rad_core - d.dWdt_s;
      const want = Math.max(cand, 0.1 * d.P_heat, 0.5 * (V / 100));
      expect(Math.abs(d.P_loss - want), `t = ${h.t}`).toBeLessThan(1e-9 * Math.max(want, 1));
      if (cand > Math.max(0.1 * d.P_heat, 0.5 * (V / 100))) free++;
      // the mantle radiation stays in P_L: the core is a part of the total radiation
      expect(d.P_rad_core).toBeLessThanOrEqual(d.P_rad + 1e-12);
    }
    expect(free).toBeGreaterThan(50); // not just the floors
    expect(sim.history.some((h) => h.d.H_mode === 1)).toBe(true);
  });
});

describe('the τ_E scaling and the C_χ controller use the loss power (scaling transport)', () => {
  // A scaling law evaluated at another P (say P_heat − P_rad, the definition before ws3d) changes tauE_scal at the
  // percent level and every golden number with it, but a monotonic-slope test does not see it: the scaling law is
  // recomputed here from the P_loss of each accepted step, exactly.
  it('every accepted step (L- and H-mode): τ_E,scal is the scaling law at P_L, τ_E is τ_E,scal, and C_χ is set against the target τ_scal P_L', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 1.5 });
    const y = m.initialState();
    m.diagnostics(0, y);
    let exact = 0, controlled = 0, lmode = 0, hmode = 0, worstTau = 0, worstC = 0, quiet = true;
    const check = m.coupling.check.bind(m.coupling);
    m.coupling.check = (ctx, t, yy, update) => {
      const d = ctx.lastDiag, s = ctx.view(yy).s;
      // the island widths of the step's start are what the scaling used: compare on steps without islands
      const islands = s.w32 > 0 || s.w21 > 0 || d.w32 > 0 || d.w21 > 0;
      if (!islands) {
        const want = Math.max(scalingTauE(ctx, d.Ip, d.nbar * 1e20, d.P_loss * 1e6) * ntmConfinementFactor(ctx, s), 1e-3);
        worstTau = Math.max(worstTau, rel(d.tauE_scal, want));
        expect(d.tauE).toBe(d.tauE_scal);
        exact++;
        if (d.H_mode === 1) hmode++; else lmode++;
        // C_χ = C_I exp(1.5 ln(W / (τ_scal P_L))) while the exponent is not clamped
        const err = Math.log((d.W * 1e6) / (d.tauE_scal * d.P_loss * 1e6));
        if (Math.abs(1.5 * err) < 1.4 && s.Cchi > 1e-3 && s.Cchi < 1e3) { worstC = Math.max(worstC, Math.abs(Math.log(s.Cchi / s.CI) - 1.5 * err)); controlled++; }
      }
      quiet = quiet && Number.isFinite(d.P_loss);
      return check(ctx, t, yy, update);
    };
    let t = 0;
    while (t < 1.5 && !m.terminated) { const t0 = t; t = m.step(t, y, 1.5); m.postStep(t, t - t0, y); }
    expect(quiet).toBe(true);
    expect(exact).toBeGreaterThan(60);
    expect(lmode).toBeGreaterThan(5); // ITER89-P branch (L-mode)
    expect(hmode).toBeGreaterThan(20); // IPB98(y,2) branch
    expect(worstTau).toBeLessThan(1e-12);
    expect(controlled).toBeGreaterThan(20);
    expect(worstC).toBeLessThan(1e-9);
  });
});

describe('smoothed dW/dt with the ELM losses', () => {
  it('ITER15 H-mode: the energy the ELM crashes take out is booked once, the step-wise dW/dt is positive (the plasma recovers between ELMs) and the smoothed dW/dt is near zero', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 120 });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let elms = 0, booked = 0, stale = 0, bad = 0, steps = 0;
    m.postStep = (t, dt, y) => {
      // acceptStep has just run: the energy of the earlier crashes is taken off
      if (dt > 0) { steps++; if (m.ctx.crashE !== 0) stale++; }
      const ev: SimEvent[] = post(t, dt, y);
      const dW = ev.filter((e) => e.kind === 'ELM').reduce((s, e) => s + (e.value ?? 0) * 1e6, 0);
      if (dW > 0) { elms++; booked += dW; if (rel(m.ctx.crashE, dW) > 1e-9) bad++; }
      return ev;
    };
    sim.runAll();
    expect(elms).toBeGreaterThan(200);
    expect(bad).toBe(0); // the crash energy is booked in ctx.crashE, once
    expect(stale).toBe(0); // and every accepted step takes it off again
    expect(steps).toBeGreaterThan(1000);
    expect(booked).toBeGreaterThan(0);
    const flat = sim.history.filter((h) => h.t > 80 && h.d.H_mode === 1);
    expect(flat.length).toBeGreaterThan(50);
    const cont = mean(flat.map((h) => h.d.dWdt)), smooth = mean(flat.map((h) => h.d.dWdt_s));
    expect(cont).toBeGreaterThan(2); // MW: the W that the ELMs take out is what builds up between them
    expect(Math.abs(smooth)).toBeLessThan(0.3 * cont);
    expect(Math.abs(smooth)).toBeLessThan(2);
  }, 120000);

  it('the smoothed dW/dt and the ELM energy not yet booked are part of the checkpoint: a replay from an ELM frame is bitwise identical', () => {
    const cfg = { ...ITER_15D, t_end: 40 };
    const ref = new Simulation(cfg);
    ref.runAll();
    // a frame recorded right after an ELM: its checkpoint holds energy that no step has taken into dW/dt yet
    const idx = ref.history.findIndex((h) => h.internal.crashE > 0);
    expect(idx).toBeGreaterThan(0);
    const sim = new Simulation(cfg);
    sim.runAll();
    sim.rewindTo(idx);
    sim.advance(40);
    expect(sim.history.length).toBe(ref.history.length);
    for (let k = idx + 1; k < ref.history.length; k++) {
      expect(sim.history[k].t).toBe(ref.history[k].t);
      expect(sim.history[k].y).toEqual(ref.history[k].y);
      expect(sim.history[k].d.dWdt_s).toBe(ref.history[k].d.dWdt_s);
      expect(sim.history[k].d.P_loss).toBe(ref.history[k].d.P_loss);
    }
  }, 120000);
});

describe('L–H threshold', () => {
  it('the diagnostic is the Martin threshold with the Ryter low-density branch at the line-averaged density (the one the 0D model uses)', () => {
    const cfg = { ...ITER_15D, t_end: 20 };
    const fs = FUEL_SPECIES[cfg.fuel];
    const M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    let low = 0, high = 0;
    const n = stepChecks(cfg, 20, (ctx, d) => {
      const g = ctx.tg;
      expect(ctx.M).toBeCloseTo(M, 12);
      const nbar = d.nbar * 1e20;
      const want = pLH_threshold(nbar, g.B0, g.surface, M, Math.max(d.Ip, 0.01), g.a, g.R0) / 1e6;
      expect(rel(d.P_LH, want)).toBeLessThan(1e-12);
      if (nbar < nLHmin(d.Ip, g.B0, g.a, g.R0)) low++; else high++;
    });
    expect(n).toBeGreaterThan(100);
    expect(low).toBeGreaterThan(0); // the start-up density is on the low-density branch
    expect(high).toBeGreaterThan(0); // and the flat-top density on the Martin branch
  });

  it('below the density of minimum threshold the threshold rises again: P_LH ≈ P_Martin(n_min) n_min / n̄ (JET15 at a tenth of its density)', () => {
    const cfg: MagneticConfig = { ...JET_15D, n_target: 0.1e20, t_end: 0.3 };
    const sim = new Simulation(cfg);
    sim.runAll();
    const g = (sim.model as ProfileModel).ctx.tg;
    const fs = FUEL_SPECIES[cfg.fuel];
    const M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    const h = sim.history[sim.history.length - 1];
    const nbar = h.d.nbar * 1e20;
    const nmin = nLHmin(h.d.Ip, g.B0, g.a, g.R0);
    expect(nbar).toBeLessThan(0.5 * nmin);
    const martin = pLH_Martin(nbar, g.B0, g.surface, M) / 1e6;
    expect(h.d.P_LH).toBeGreaterThan(1.5 * martin);
    expect(rel(h.d.P_LH, (pLH_Martin(nmin, g.B0, g.surface, M) / 1e6) * (nmin / nbar))).toBeLessThan(1e-9);
  });
});

describe('stored energy: one definition', () => {
  it('the W of every accepted step is ctx.storedEnergy of the accepted state, bit for bit (it was W_e + W_i summed separately)', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 1 });
    const y = m.initialState();
    m.diagnostics(0, y);
    let n = 0, worst = 0;
    const check = m.coupling.check.bind(m.coupling);
    m.coupling.check = (ctx, t, yy, update) => {
      const W = ctx.storedEnergy(ctx.view(yy));
      worst = Math.max(worst, Math.abs(ctx.lastDiag.W - W / 1e6));
      n++;
      return check(ctx, t, yy, update);
    };
    let t = 0;
    while (t < 0.4) { const t0 = t; t = m.step(t, y, 1); m.postStep(t, t - t0, y); }
    expect(n).toBeGreaterThan(20);
    expect(worst).toBe(0);
  });
});
