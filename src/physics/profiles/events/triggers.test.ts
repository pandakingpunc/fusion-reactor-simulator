/**
 * The trigger margins of the ELM and the sawtooth crash (events/triggers.ts) that the stepper localises: they take the tests of the
 * event models' afterStep from the profiles of a state alone.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import type { MagneticConfig, SimEvent } from '../../types';
import { composition } from '../composition';
import { ProfileModel } from '../model';
import { currentProfiles } from '../qprofile';
import { shearAt, rhoOfQ } from '../mhd';
import { ElmEvents } from './elm';
import type { TriggerState } from './EventModel';
import { SawtoothEvents } from './sawtooth';
import { READY_MARGIN, elmMargin, sawtoothMargin, triggerScratch } from './triggers';

/** The trigger state of the current y of a model, as the stepper builds it for the new end of a step */
function stateOf(m: ProfileModel, y: Float64Array): TriggerState {
  const ctx = m.ctx, v = ctx.view(y);
  return { Te: v.Te, Ti: v.Ti, ne: v.ne, psi: v.psi, niOverNe: Float64Array.from(ctx.w.ni, (ni, i) => ni / Math.max(v.ne[i], 1)), Ip: v.s.Ip };
}

/** Steps a model of cfg to tEnd; fn after every accepted step (before postStep: the diagnostics are those of the step) */
function run(cfg: MagneticConfig, tEnd: number, fn: (m: ProfileModel, y: Float64Array, t: number) => void): ProfileModel {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  let t = 0;
  while (t < tEnd && !m.terminated) {
    const t0 = t;
    t = m.step(t, y, cfg.t_end);
    fn(m, y, t);
    m.postStep(t, t - t0, y);
  }
  return m;
}

describe('ELM trigger', () => {
  it('the margin is α_ped/α_crit − 1 of the diagnostics in H-mode (both from the pressure and the q profile of the new state), and −1 in L-mode or with ELMs off', () => {
    const cfg = { ...JET_15D, t_end: 0.5 } as MagneticConfig;
    let nH = 0, nL = 0, worst = 0, geo: unknown = null;
    run(cfg, 0.5, (m, y) => {
      const s = triggerScratch(m.N);
      const margin = elmMargin(m.ctx, stateOf(m, y), s);
      // a step that ends with an equilibrium update has its diagnostics on the previous geometry (the margin is evaluated on the new one)
      const same = geo === m.ctx.geo;
      geo = m.ctx.geo;
      if (!same) return;
      if (m.ctx.hmode) { nH++; worst = Math.max(worst, Math.abs(margin + 1 - m.ctx.lastDiag.alpha_ped) / m.ctx.lastDiag.alpha_ped); } else { nL++; expect(margin).toBe(-1); }
    });
    expect(nH).toBeGreaterThan(15); // the number of H-mode steps of 0.5 s follows the step control (over 30 on the lane's own base, 23 on the merged one): enough to test the identity
    expect(nL).toBeGreaterThan(5);
    expect(worst).toBeLessThan(1e-9);
    // the same state with the ELMs switched off in the configuration
    const off = new ProfileModel({ ...cfg, events: { ...cfg.events, elms: false } });
    const y = off.initialState();
    off.diagnostics(0, y);
    off.ctx.hmode = true;
    expect(elmMargin(off.ctx, stateOf(off, y), triggerScratch(off.N))).toBe(-1);
  }, 60000);

  it('is ready at the recovery time τ_E/8 after the last ELM (2 % beyond it and a microsecond), always ready before the first', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 1 } as MagneticConfig);
    const elm = m.events.find((e) => e.id === 'ELM') as ElmEvents;
    m.diagnostics(0, m.initialState());
    expect(elm.trigger.readyAt(m.ctx)).toBeLessThan(-1e8);
    // after an ELM the refractory period starts at its time
    const y = m.initialState();
    m.diagnostics(0, y);
    let t = 0, tElm = -1;
    while (t < 0.6 && tElm < 0) {
      const t0 = t;
      t = m.step(t, y, 1);
      const ev = m.postStep(t, t - t0, y);
      if (ev.some((e) => e.kind === 'ELM')) tElm = t;
    }
    expect(tElm).toBeGreaterThan(0);
    const tau = m.ctx.lastDiag.tauE;
    expect(elm.trigger.readyAt(m.ctx)).toBeCloseTo(tElm + 1.02 * ElmEvents.recovery(tau) + READY_MARGIN, 9);
    expect(ElmEvents.recovery(undefined)).toBeCloseTo(0.1 / 8, 12);
    expect(ElmEvents.recovery(1e-3)).toBe(2e-3);
  }, 60000);
});

describe('sawtooth trigger', () => {
  // as in events.test.ts: q from ψ on the inner faces, then the current profiles
  const setQ = (m: ProfileModel, y: Float64Array, qf: (rho: number) => number) => {
    const ctx = m.ctx, g = ctx.tg, st = ctx.view(y);
    st.psi[0] = 0;
    for (let f = 1; f < ctx.N; f++) st.psi[f] = st.psi[f - 1] + (g.distF[f] * g.PhiB * g.rhoF[f]) / (Math.PI * qf(g.rhoF[f]));
    currentProfiles(ctx, st.psi, st.s.Ip);
    return st;
  };
  const model = (over: Partial<MagneticConfig> = {}) => {
    const m = new ProfileModel({ ...JET_15D, ...over } as MagneticConfig);
    const y = m.initialState();
    const d0 = m.diagnostics(0, y);
    return { m, y, d0, ctx: m.ctx };
  };
  // q = 1 at ρ₁ = 0.32 with the shear s₁ = ρ q'/q = 0.5 above sawtoothShear (0.2)
  const qMono = (r: number) => 0.75 + 2.5 * r * r;

  it('the margin is s₁ − s_crit where ρ(q = 1) is inside (0.05, 0.8) and the mixing radius outside it, −1 otherwise', () => {
    const { m, y, ctx } = model();
    setQ(m, y, qMono);
    const sc = triggerScratch(m.N);
    const margin = sawtoothMargin(ctx, stateOf(m, y), sc);
    const r1 = rhoOfQ(ctx.tg, ctx.w.qF, 1);
    expect(r1).toBeGreaterThan(0.05);
    expect(r1).toBeLessThan(0.8);
    expect(margin).toBeCloseTo(shearAt(ctx.tg, ctx.w.qF, r1) - ctx.ps.sawtoothShear, 9);
    expect(margin).toBeGreaterThan(0.2);
    // q above 1 everywhere: no surface
    setQ(m, y, (r) => 1.3 + 2 * r * r);
    expect(sawtoothMargin(ctx, stateOf(m, y), sc)).toBe(-1);
    // the surface too far out (ρ₁ = 0.95)
    setQ(m, y, (r) => 0.5 + 0.55 * r * r);
    expect(sawtoothMargin(ctx, stateOf(m, y), sc)).toBe(-1);
    // switched off in the configuration
    const off = model({ events: { ...JET_15D.events, sawteeth: false } });
    setQ(off.m, off.y, qMono);
    expect(sawtoothMargin(off.ctx, stateOf(off.m, off.y), triggerScratch(off.m.N))).toBe(-1);
  });

  it('is ready 50 ms plus a microsecond after the last crash, always ready before the first', () => {
    const { m, y, d0, ctx } = model();
    const st = setQ(m, y, qMono);
    ctx.tg.rhoC.forEach((r, i) => { st.Te[i] = 0.2 + 8 * (1 - r * r) ** 1.5; st.Ti[i] = 0.2 + 6 * (1 - r * r) ** 1.5; st.ne[i] = 3e19 + 4e19 * (1 - r * r); });
    composition(ctx, st.Te, st.ne, st.s);
    const saw = new SawtoothEvents();
    expect(saw.trigger.readyAt(ctx)).toBeLessThan(-1e8);
    const ev: SimEvent[] = [];
    saw.afterStep(ctx, 2, st, { ...d0, betaN: 0.1 }, ev);
    expect(ev.map((e) => e.kind)).toEqual(['sawtooth']);
    expect(saw.trigger.readyAt(ctx)).toBeCloseTo(2 + 0.05 + READY_MARGIN, 12);
  });
});
