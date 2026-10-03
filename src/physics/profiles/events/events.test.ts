/**
 * Unit tests of the event models of the 1.5D model through the EventModel interface: each model's
 * afterStep is called on the context and state of a JET15 model (Grad–Shafranov geometry, work
 * arrays evaluated on the initial state) with diagnostics set up for the case under test.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import type { MagneticConfig, SimEvent } from '../../types';
import { ProfileModel } from '../model';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { CheckpointAux, CheckpointRecord } from '../checkpoint';
import { composition } from '../composition';
import { heatingPowers } from '../control/actuators';
import { currentProfiles } from '../qprofile';
import { volumeIntegral } from '../sources/deposition';
import type { EventModel } from './EventModel';
import { CRASH_RESTART_DT } from './elm';
import { LHTransition } from './lh';
import { ElmEvents } from './elm';
import { SawtoothEvents } from './sawtooth';
import { NtmEvents, ntmConfinementFactor } from './ntm';
import { BurnEvents } from './burn';
import { OperationalWarnings } from './warnings';
import { DisruptionEvents } from './disruption';

type Diag = Record<string, number>;

/** A JET15 model at t = 0 with its work arrays and diagnostics evaluated on the initial state */
function shot(over: Partial<MagneticConfig> = {}) {
  const m = new ProfileModel({ ...JET_15D, ...over });
  const y = m.initialState();
  const d0 = m.diagnostics(0, y);
  return { m, ctx: m.ctx, y, st: m.ctx.view(y), d0 };
}

/** Runs one afterStep and returns the events it raised */
function after(model: EventModel, ctx: ProfileContext, t: number, st: ProfileState, d: Diag): SimEvent[] {
  const ev: SimEvent[] = [];
  model.afterStep(ctx, t, st, d, ev);
  return ev;
}

/** Sets ψ so that q(ρ) = qf(ρ) on the inner faces, and evaluates the current profiles */
function setQ(ctx: ProfileContext, st: ProfileState, qf: (rho: number) => number): void {
  const g = ctx.tg;
  st.psi[0] = 0;
  for (let f = 1; f < ctx.N; f++) st.psi[f] = st.psi[f - 1] + (g.distF[f] * g.PhiB * g.rhoF[f]) / (Math.PI * qf(g.rhoF[f]));
  currentProfiles(ctx, st.psi, st.s.Ip);
}

const saved = (p: EventModel) => {
  const rec: CheckpointRecord = {}, aux: CheckpointAux = {};
  p.save?.(rec, aux);
  return { rec, aux };
};

describe('L–H transition', () => {
  it('enters H-mode above P_LH after 50 ms and leaves it below 0.7 P_LH (hysteresis)', () => {
    const { ctx, st, d0 } = shot();
    const lh = new LHTransition();
    expect(ctx.hmode).toBe(false);
    expect(after(lh, ctx, 0.04, st, { ...d0, P_loss: 10, P_LH: 5 })).toEqual([]);
    expect(ctx.hmode).toBe(false);
    const on = after(lh, ctx, 0.06, st, { ...d0, P_loss: 10, P_LH: 5 });
    expect(on.map((e) => e.kind)).toEqual(['LH']);
    expect(ctx.hmode).toBe(true);
    // between 0.7 P_LH and P_LH the mode is kept
    expect(after(lh, ctx, 0.1, st, { ...d0, P_loss: 4, P_LH: 5 })).toEqual([]);
    expect(ctx.hmode).toBe(true);
    const off = after(lh, ctx, 0.2, st, { ...d0, P_loss: 3, P_LH: 5 });
    expect(off.map((e) => e.kind)).toEqual(['HL']);
    expect(ctx.hmode).toBe(false);
  });
});

describe('type-I ELMs', () => {
  const unstable = (d0: Diag): Diag => ({ ...d0, alpha_ped: 1.3, tauE: 0.2 });

  it('need H-mode, an unstable pedestal and ELMs enabled', () => {
    const { ctx, st, d0 } = shot();
    expect(after(new ElmEvents(), ctx, 1, st, unstable(d0))).toEqual([]); // L-mode
    ctx.hmode = true;
    expect(after(new ElmEvents(), ctx, 1, st, { ...unstable(d0), alpha_ped: 0.9 })).toEqual([]);
    const off = shot({ events: { ...JET_15D.events, elms: false } });
    off.ctx.hmode = true;
    expect(after(new ElmEvents(), off.ctx, 1, off.st, unstable(off.d0))).toEqual([]);
  });

  it('crash: expels the reported energy from the pedestal region only, flushes ash and impurity, and marks the state', () => {
    const { ctx, st, d0 } = shot();
    ctx.hmode = true;
    ctx.dt = 0.05;
    const elm = new ElmEvents();
    const before = { Te: Float64Array.from(st.Te), ne: Float64Array.from(st.ne), W: ctx.storedEnergy(st), NHe: (st.s.NHe = 1e20), cZ: st.s.cZ, Pelm: st.s.Pelm };
    const hook: string[] = [];
    ctx.crashHook = (kind, _t, b, a) => { hook.push(kind); expect(a.Te[ctx.N - 1]).toBeLessThan(b.Te[ctx.N - 1]); };
    const ev = after(elm, ctx, 1, st, unstable(d0));
    expect(ev.map((e) => e.kind)).toEqual(['ELM']);
    expect(hook).toEqual(['ELM']);
    const dW = ev[0].value! * 1e6;
    expect(dW).toBeGreaterThan(0);
    // the stored energy drops by exactly the reported ΔW
    expect(Math.abs(before.W - ctx.storedEnergy(st) - dW)).toBeLessThan(1e-9 * before.W);
    // outside the pedestal and its inner neighbour region (0.15 in ρ) nothing changes; at the edge
    // T − T_sep drops by fW = elmFraction × U(0.8, 1.2) and n − n_sep by fW/2
    const rhoIn = 1 - ctx.ps.pedestalWidth - 0.15;
    const g = ctx.tg, i = ctx.N - 1;
    for (let k = 0; k < ctx.N; k++) if (g.rhoC[k] < rhoIn) { expect(st.Te[k]).toBe(before.Te[k]); expect(st.ne[k]).toBe(before.ne[k]); }
    const fW = 1 - (st.Te[i] - ctx.bc.Te) / (before.Te[i] - ctx.bc.Te);
    expect(fW).toBeGreaterThanOrEqual(0.8 * ctx.ps.elmFraction - 1e-12);
    expect(fW).toBeLessThanOrEqual(1.2 * ctx.ps.elmFraction + 1e-12);
    expect(1 - (st.ne[i] - ctx.bc.n) / (before.ne[i] - ctx.bc.n)).toBeCloseTo(fW / 2, 12);
    expect(st.s.NHe).toBeCloseTo(before.NHe * (1 - 0.1 * fW), 6);
    expect(st.s.cZ).toBeCloseTo(before.cZ * (1 - 0.1 * fW), 14);
    expect(st.s.Pelm - before.Pelm).toBeCloseTo(dW, 6);
    expect(ctx.diagStale).toBe(true);
    expect(ctx.dt).toBe(CRASH_RESTART_DT);
  });

  it('waits τ_E/8 for the pedestal to recover; the checkpoint restores the timer and the ELM record', () => {
    const { ctx, st, d0 } = shot();
    ctx.hmode = true;
    const elm = new ElmEvents();
    const d = unstable(d0); // τ_E/8 = 25 ms
    const early = saved(elm);
    expect(after(elm, ctx, 1, st, d)).toHaveLength(1);
    expect(after(elm, ctx, 1.02, st, d)).toEqual([]);
    expect(after(elm, ctx, 1.03, st, d)).toHaveLength(1);
    const two = saved(elm);
    expect(after(elm, ctx, 1.06, st, d)).toHaveLength(1);
    expect(elm.frequency()).toBeCloseTo(2 / 0.06, 1);
    elm.restore(two.rec, two.aux);
    expect(elm.frequency()).toBe(0); // fewer than three ELMs
    expect(after(elm, ctx, 1.04, st, d)).toEqual([]); // timer from the ELM at 1.03 s
    elm.restore(early.rec, early.aux);
    expect(after(elm, ctx, 1.04, st, d)).toHaveLength(1);
    // a record from elsewhere (no stored references) restores the timer only
    elm.restore(two.rec, undefined);
    expect(elm.frequency()).toBe(0);
  });
});

describe('sawtooth crashes', () => {
  // q = 1 at ρ₁ = 0.32 with shear s₁ = ρ q'/q = 0.5 > sawtoothShear; q = 3/2 and 2 surfaces inside
  const qMono = (r: number) => 0.75 + 2.5 * r * r;
  const peaked = (st: ProfileState, ctx: ProfileContext) => {
    ctx.tg.rhoC.forEach((r, i) => { st.Te[i] = 0.2 + 8 * (1 - r * r) ** 1.5; st.Ti[i] = 0.2 + 6 * (1 - r * r) ** 1.5; st.ne[i] = 3e19 + 4e19 * (1 - r * r); });
  };

  it('crash: flattens inside the mixing radius conserving particles and electron and ion energy exactly, and raises q ≥ 1.01', () => {
    const { ctx, st, d0 } = shot();
    peaked(st, ctx);
    setQ(ctx, st, qMono);
    composition(ctx, st.Te, st.ne, st.s);
    const g = ctx.tg, N = ctx.N;
    const sums = () => ({
      N: volumeIntegral(g, st.ne),
      We: volumeIntegral(g, Array.from(st.ne, (n, i) => n * st.Te[i])),
      Wi: volumeIntegral(g, Array.from(ctx.w.ni, (n, i) => n * st.Ti[i])),
    });
    const s0 = sums(), Te0 = st.Te[0], outer = Array.from(st.Te.slice(N / 2));
    ctx.dt = 0.05;
    const saw = new SawtoothEvents();
    const ev = after(saw, ctx, 2, st, { ...d0, betaN: 0.1 });
    expect(ev.map((e) => e.kind)).toEqual(['sawtooth']);
    expect(ev[0].value).toBeCloseTo((Te0 - st.Te[0]) / Te0, 12);
    expect(st.Te[0]).toBeLessThan(Te0);
    const s1 = sums();
    expect(Math.abs(s1.N / s0.N - 1)).toBeLessThan(1e-13);
    expect(Math.abs(s1.We / s0.We - 1)).toBeLessThan(1e-13);
    expect(Math.abs(s1.Wi / s0.Wi - 1)).toBeLessThan(1e-13);
    // flat inside ρ₁ = 0.32, untouched outside the mixing radius (< 0.5 here)
    for (let i = 1; i < N; i++) if (g.rhoC[i] < 0.3) expect(st.Te[i]).toBeCloseTo(st.Te[0], 12);
    expect(Array.from(st.Te.slice(N / 2))).toEqual(outer);
    // full reconnection: q ≥ 1.01 inside the mixing radius, no q = 1 surface left
    for (let f = 1; f < N / 2; f++) expect(ctx.w.qF[f]).toBeGreaterThan(1.01 - 1e-9);
    expect(ctx.diagStale).toBe(true);
    expect(ctx.dt).toBe(CRASH_RESTART_DT);
    // low β_N: no NTM seed islands
    expect(st.s.w32).toBe(0);
    expect(st.s.w21).toBe(0);
  });

  it('seeds 3/2 and 2/1 NTM islands at high thermal β_N', () => {
    const { ctx, st, d0 } = shot();
    peaked(st, ctx);
    setQ(ctx, st, qMono);
    composition(ctx, st.Te, st.ne, st.s);
    const lim = ctx.cfg.limits.betaN_limit, wd = 0.012 * (ctx.tg.a / 2);
    expect(after(new SawtoothEvents(), ctx, 2, st, { ...d0, betaN: 0.8 * lim, betaN_th: 0.8 * lim })).toHaveLength(1);
    expect(st.s.w32).toBeCloseTo(2.5 * wd, 15);
    expect(st.s.w21).toBeCloseTo(2 * wd, 15);
  });

  it('the seed follows the thermal β_N: fast-ion pressure alone (total β_N high, thermal low) seeds nothing, and the marginal levels are those of the thermal β_N', () => {
    const lim = shot().ctx.cfg.limits.betaN_limit;
    const seeded = (betaN: number, betaN_th: number) => {
      const { ctx, st, d0 } = shot();
      peaked(st, ctx);
      setQ(ctx, st, qMono);
      composition(ctx, st.Te, st.ne, st.s);
      after(new SawtoothEvents(), ctx, 2, st, { ...d0, betaN, betaN_th });
      return [st.s.w32 > 0, st.s.w21 > 0];
    };
    expect(seeded(0.9 * lim, 0.3 * lim)).toEqual([false, false]);
    expect(seeded(0.9 * lim, 0.6 * lim)).toEqual([true, false]); // 3/2 above 0.5 β_lim, 2/1 above 0.75 β_lim
    expect(seeded(0.9 * lim, 0.8 * lim)).toEqual([true, true]);
  });

  it('needs sawteeth enabled, q(0) < 1 with enough shear at q = 1, and 50 ms since the last crash (checkpointed)', () => {
    const off = shot({ events: { ...JET_15D.events, sawteeth: false } });
    setQ(off.ctx, off.st, qMono);
    expect(after(new SawtoothEvents(), off.ctx, 2, off.st, off.d0)).toEqual([]);
    const { ctx, st, d0 } = shot();
    peaked(st, ctx);
    setQ(ctx, st, (r) => 1.05 + r * r); // q > 1
    const saw = new SawtoothEvents();
    expect(after(saw, ctx, 2, st, d0)).toEqual([]);
    setQ(ctx, st, (r) => 0.95 + 0.2 * r * r); // s₁ = 0.1 < 0.2
    expect(after(saw, ctx, 2, st, d0)).toEqual([]);
    const fresh = saved(saw);
    setQ(ctx, st, qMono);
    expect(after(saw, ctx, 2, st, d0)).toHaveLength(1);
    setQ(ctx, st, qMono);
    expect(after(saw, ctx, 2.04, st, d0)).toEqual([]);
    saw.restore(fresh.rec);
    expect(after(saw, ctx, 2.04, st, d0)).toHaveLength(1);
    setQ(ctx, st, qMono);
    expect(after(saw, ctx, 2.1, st, d0)).toHaveLength(1);
  });
});

describe('neoclassical tearing modes', () => {
  it('report onset above w/a = 0.02 and decay below, once each per island (checkpointed)', () => {
    const { ctx, st, d0 } = shot();
    const ntm = new NtmEvents();
    const a = ctx.tg.a;
    const kinds = (t: number) => after(ntm, ctx, t, st, d0).map((e) => `${e.kind} ${e.msg.slice(4, 7)}`);
    expect(kinds(1)).toEqual([]);
    st.s.w32 = 0.03 * a;
    expect(kinds(1.1)).toEqual(['NTM_onset 3/2']);
    expect(kinds(1.2)).toEqual([]);
    const on = saved(ntm);
    st.s.w21 = 0.05 * a;
    expect(kinds(1.3)).toEqual(['NTM_onset 2/1']);
    st.s.w32 = 0.01 * a;
    expect(kinds(1.4)).toEqual(['NTM_gone 3/2']);
    // back to the checkpoint: 3/2 on, 2/1 off
    ntm.restore(on.rec);
    st.s.w32 = 0; st.s.w21 = 0;
    expect(kinds(1.5)).toEqual(['NTM_gone 3/2']);
  });

  it('islands degrade confinement by the belt model, at most by half', () => {
    const { ctx, st } = shot();
    setQ(ctx, st, (r) => 0.9 + 3 * r * r);
    expect(ntmConfinementFactor(ctx, st.s)).toBe(1);
    st.s.w32 = 0.05 * ctx.tg.a;
    const rs = Math.sqrt(0.6 / 3); // q = 3/2
    expect(ntmConfinementFactor(ctx, st.s)).toBeCloseTo(1 - 4 * rs * rs * 0.05, 2);
    st.s.w21 = 0.4 * ctx.tg.a;
    expect(ntmConfinementFactor(ctx, st.s)).toBe(0.5);
  });
});

describe('burn milestones', () => {
  const dOf = (d0: Diag, Q: number, P_alpha: number): Diag => ({ ...d0, Q, P_alpha, P_fus: 5 * P_alpha, P_rad: 10, P_cond: 30 });

  it('breakeven (Q ≥ 1) is raised and cleared once, and checkpointed', () => {
    const { ctx, st, d0 } = shot();
    const burn = new BurnEvents();
    const kinds = (t: number, x: Diag) => after(burn, ctx, t, st, x).map((e) => e.kind);
    expect(kinds(1, dOf(d0, 0.5, 5))).toEqual([]);
    expect(kinds(2, dOf(d0, 1.2, 10))).toEqual(['burn_start']);
    expect(kinds(3, dOf(d0, 1.5, 12))).toEqual([]);
    const burning = saved(burn);
    expect(kinds(4, dOf(d0, 0.8, 5))).toEqual(['burn_end']);
    burn.restore(burning.rec);
    expect(kinds(5, dOf(d0, 0.8, 5))).toEqual(['burn_end']);
  });

  it('ignition (P_α ≥ P_rad + P_cond) does not need Q ≥ 5: raised and cleared once with hysteresis, shown in the diagnostics, checkpointed with the context', () => {
    const { m, ctx, st, d0 } = shot();
    const burn = new BurnEvents();
    const kinds = (t: number, x: Diag) => after(burn, ctx, t, st, x).map((e) => e.kind);
    expect(ctx.ignited).toBe(false);
    expect(d0.ignited).toBe(0);
    expect(kinds(1, dOf(d0, 0.5, 30))).toEqual([]); // 30 MW < P_rad + P_cond = 40 MW
    expect(ctx.lastDiag.ignited).toBe(0);
    expect(kinds(2, dOf(d0, 2, 45))).toEqual(['ignition', 'burn_start']); // Q = 2 only
    expect(ctx.ignited).toBe(true);
    expect(ctx.lastDiag.ignited).toBe(1);
    const rec = m.saveInternal();
    expect(rec.ignited).toBe(1);
    expect(kinds(3, dOf(d0, 2, 38))).toEqual([]); // above 0.9 P_loss: still ignited
    expect(kinds(4, dOf(d0, 2, 30))).toEqual(['info']); // lost
    expect(ctx.lastDiag.ignited).toBe(0);
    expect(kinds(5, dOf(d0, 2, 30))).toEqual([]);
    m.restoreInternal(rec);
    expect(ctx.ignited).toBe(true);
    // no ignition without fusion power to speak of
    const q = shot();
    expect(after(new BurnEvents(), q.ctx, 1, q.st, { ...q.d0, Q: 0, P_alpha: 1e-3, P_fus: 0.5, P_rad: 0, P_cond: 0 }).map((e) => e.kind)).toEqual([]);
  });

  it('ignition test (heating.autoOff): at Q ≥ 5 the external heating ramps down once over heating.rampTime; without the option it stays on', () => {
    const on = shot({ heating: { ...JET_15D.heating, autoOff: true } });
    const burn = new BurnEvents();
    const ramp = on.ctx.cfg.heating.rampTime;
    const P0 = 1e6 * (JET_15D.heating.P_NBI_MW);
    expect(heatingPowers(on.ctx, 100).P_NBI).toBeCloseTo(P0, 3);
    expect(after(burn, on.ctx, 10, on.st, dOf(on.d0, 4.9, 1)).map((e) => e.kind)).toEqual(['burn_start']);
    expect(on.ctx.tAuxOff).toBe(Infinity);
    const ev = after(burn, on.ctx, 12, on.st, dOf(on.d0, 5.2, 1));
    expect(ev.filter((e) => e.kind === 'info' && e.msg.startsWith('Ignition test: Q = 5.2'))).toHaveLength(1);
    expect(on.ctx.tAuxOff).toBe(12);
    expect(after(burn, on.ctx, 13, on.st, dOf(on.d0, 8, 1)).filter((e) => e.kind === 'info')).toEqual([]); // once
    expect(on.ctx.tAuxOff).toBe(12);
    expect(heatingPowers(on.ctx, 12).P_NBI).toBeCloseTo(P0, 3);
    expect(heatingPowers(on.ctx, 12 + 0.5 * ramp).P_NBI).toBeCloseTo(0.5 * P0, 3);
    expect(heatingPowers(on.ctx, 12 + ramp).P_NBI).toBe(0);
    expect(heatingPowers(on.ctx, 12 + 3 * ramp).P_NBI).toBe(0);
    expect(heatingPowers(on.ctx, 12 + 0.5 * ramp).P_IC).toBeCloseTo(0.5e6 * JET_15D.heating.P_ICRH_MW, 3);
    // the start of the test is part of the checkpoint
    const rec = on.m.saveInternal();
    on.ctx.tAuxOff = Infinity;
    on.m.restoreInternal(rec);
    expect(on.ctx.tAuxOff).toBe(12);
    // a record without the key (from elsewhere) leaves the heating on
    on.m.restoreInternal({ ...rec, tAuxOff: undefined as unknown as number });
    expect(on.ctx.tAuxOff).toBe(Infinity);
    const off = shot();
    after(new BurnEvents(), off.ctx, 12, off.st, dOf(off.d0, 8, 1));
    expect(off.ctx.tAuxOff).toBe(Infinity);
    expect(heatingPowers(off.ctx, 100).P_NBI).toBeCloseTo(P0, 3);
  });
});

describe('operational warnings', () => {
  it('warn once each for the divertor heat flux, the density limit and the Troyon limit', () => {
    const { ctx, st, d0 } = shot();
    const warn = new OperationalWarnings();
    const lim = ctx.cfg.limits.betaN_limit;
    const safe: Diag = { ...d0, q_div: 5, nG_frac: 0.5, betaN: 0.5 * lim };
    expect(after(warn, ctx, 1, st, safe)).toEqual([]);
    const all = { ...safe, q_div: 12, nG_frac: 0.9, betaN: 0.9 * lim };
    const ev = after(warn, ctx, 2, st, all);
    expect(ev.map((e) => e.kind)).toEqual(['warning', 'warning', 'warning']);
    expect(ev.map((e) => e.msg.split(' ')[0])).toEqual(['Divertor', 'n̄/n_G', 'β_N']);
    expect(after(warn, ctx, 3, st, all)).toEqual([]);
    expect([...ctx.warned]).toEqual(expect.arrayContaining(['div', 'nG', 'bN']));
  });
});

describe('disruptions', () => {
  const safe = (d0: Diag): Diag => ({ ...d0, nG_frac: 0.5, betaN: 1, q95: 4, cZ: 1e-5, P_rad: 1, P_heat: 20, Te: 5, W: 8 });

  it.each([
    ['density_limit', (d: Diag) => ({ ...d, nG_frac: 1.1 })],
    ['beta_limit', (d: Diag) => ({ ...d, betaN: 4 })],
    ['q95_limit', (d: Diag) => ({ ...d, q95: 1.8 })],
    ['ntm_locked_mode', (d: Diag) => d],
    ['radiative_collapse', (d: Diag) => ({ ...d, P_rad: 25, Te: 1.5 })],
  ] as [string, (d: Diag) => Diag][])('%s starts the thermal quench', (cause, trip) => {
    const { ctx, st, d0 } = shot();
    const dis = new DisruptionEvents();
    expect(after(dis, ctx, 1, st, safe(d0))).toEqual([]);
    if (cause === 'ntm_locked_mode') st.s.w21 = 0.11 * ctx.tg.a;
    const ev = after(dis, ctx, 1, st, trip(safe(d0)));
    expect(ev.map((e) => e.kind)).toEqual(['disruption']);
    expect(ctx.phase).toBe('thermal_quench');
    expect(ctx.disruption.cause).toBe(cause);
    expect(ctx.disruption.t).toBe(1);
    expect(ctx.disruption.W).toBe(8e6);
    expect(ctx.disruption.Ip).toBe(st.s.Ip);
  });

  it('the thermal quench ends the ignition state: the quench frames are not ignited', () => {
    const { ctx, st, d0 } = shot();
    ctx.ignited = true;
    ctx.lastDiag.ignited = 1;
    after(new DisruptionEvents(), ctx, 1, st, safe(d0));
    expect(ctx.ignited).toBe(true); // no limit crossed
    expect(ctx.lastDiag.ignited).toBe(1);
    after(new DisruptionEvents(), ctx, 1, st, { ...safe(d0), nG_frac: 1.1 });
    expect(ctx.phase).toBe('thermal_quench');
    expect(ctx.ignited).toBe(false);
    expect(ctx.lastDiag.ignited).toBe(0);
  });

  it('checks the limits in order (first match wins); tungsten only with a W impurity; no radiative collapse in the first 0.5 s', () => {
    const a = shot();
    after(new DisruptionEvents(), a.ctx, 1, a.st, { ...safe(a.d0), nG_frac: 1.1, betaN: 4, q95: 1.5 });
    expect(a.ctx.disruption.cause).toBe('density_limit');
    const b = shot();
    const highW = { ...safe(b.d0), cZ: 1e-3 };
    expect(after(new DisruptionEvents(), b.ctx, 1, b.st, highW)).toEqual([]);
    const w = shot({ impurity: { ...JET_15D.impurity, species: 'W', concentration: 1e-5 } });
    after(new DisruptionEvents(), w.ctx, 1, w.st, { ...safe(w.d0), cZ: 1e-3 });
    expect(w.ctx.disruption.cause).toBe('tungsten_accumulation');
    const c = shot();
    expect(after(new DisruptionEvents(), c.ctx, 0.4, c.st, { ...safe(c.d0), P_rad: 25, Te: 1.5 })).toEqual([]);
  });

  it('quench phases: the thermal quench cools the plasma, the current quench ends the shot with a disruption report', () => {
    const { ctx, y, st, d0 } = shot();
    const dis = new DisruptionEvents();
    after(dis, ctx, 1, st, { ...safe(d0), nG_frac: 1.2 });
    const g = ctx.tg;
    const tauTQ = 1e-3 * (g.a / 2) * (1 + 0.5 * Math.log(1 + ctx.disruption.Ip / 5e6));
    const tauCQ = 4e-3 * Math.PI * g.a * g.a * ctx.geomB.kappa;
    // one thermal-quench step: Δt = τ_TQ/5, T → 5 eV with τ_TQ, n_e with 50 ms, I_p held
    const Te0 = st.Te[0], ne0 = st.ne[0], Ip0 = st.s.Ip;
    let t = dis.quenchStep(ctx, 1, y, 2);
    expect(t - 1).toBeCloseTo(tauTQ / 5, 15);
    expect(st.Te[0]).toBeCloseTo(0.005 + (Te0 - 0.005) * Math.exp(-0.2), 12);
    expect(st.ne[0] / (ne0 * Math.exp(-(t - 1) / 0.05))).toBeCloseTo(1, 12);
    expect(st.s.Ip).toBe(Ip0);
    const kinds: string[] = [];
    let steps = 0;
    while (!ctx.terminated && steps++ < 10000) {
      const ev: SimEvent[] = [];
      dis.quenchProgress(ctx, t, st, ctx.lastDiag, ev);
      kinds.push(...ev.map((e) => e.kind));
      if (!ctx.terminated) t = dis.quenchStep(ctx, t, y, t + 1);
    }
    expect(kinds).toEqual(['quench', 'end']);
    expect(ctx.phase).toBe('ended');
    expect(st.s.Ip).toBeLessThan(0.03 * Ip0);
    // the current decays with τ_CQ: about ln(1/0.03) τ_CQ after the thermal quench
    expect(t - ctx.disruption.t).toBeGreaterThan(3 * tauCQ);
    expect(t - ctx.disruption.t).toBeLessThan(4 * tauCQ + 0.06);
    const term = ctx.terminated!;
    expect(term.natural).toBe(false);
    expect(term.reason).toBe('Density-limit disruption (Greenwald)');
    expect(term.disruption?.tau_CQ_ms).toBeGreaterThan(0);
  });

  it('quench frames describe the decaying state: density, β and P_cond follow it, and so do the kinetic profiles of the snapshot', () => {
    const { ctx, y, st, d0 } = shot();
    const dis = new DisruptionEvents();
    after(dis, ctx, 1, st, { ...safe(d0), nG_frac: 1.2 });
    const g = ctx.tg, tauE = ctx.lastDiag.tauE, betaN0 = ctx.lastDiag.betaN, ne00 = ctx.lastDiag.ne0;
    // the snapshot of the last normal step: the frames hold it by reference, so the quench must not mutate it
    const onset = ctx.lastProf, onsetTe = [...onset.Te], onsetNe = [...onset.ne];
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
    let t = 1, steps = 0;
    // through the thermal quench and half of the current quench (I_p, and with it n_G and β_N, decays there)
    while ((ctx.phase !== 'current_quench' || st.s.Ip > 0.5 * ctx.disruption.Ip) && steps++ < 1000) {
      dis.quenchProgress(ctx, t, st, ctx.lastDiag, []);
      t = dis.quenchStep(ctx, t, y, t + 1);
      const d = ctx.lastDiag, prof = ctx.lastProf, Ip_MA = st.s.Ip / 1e6, at = `t = ${t}`;
      expect(rel(d.ne0, st.ne[0] / 1e20), at).toBeLessThan(1e-12);
      expect(rel(d.ne, volumeIntegral(g, st.ne) / g.volume / 1e20), at).toBeLessThan(1e-12);
      expect(rel(d.nbar, ctx.lineAvg(st.ne) / 1e20), at).toBeLessThan(1e-12);
      expect(rel(d.nG_frac, ctx.lineAvg(st.ne) / ((Ip_MA / (Math.PI * g.a * g.a)) * 1e20)), at).toBeLessThan(1e-12);
      // β from the reported W, thermal only (the fast ions are lost at the onset); P_cond = W/τ_E with the τ_E of the onset
      const pAvg = (2 / 3) * (d.W * 1e6) / g.volume, mu0 = 4e-7 * Math.PI;
      expect(rel(d.betaN, ((2 * mu0 * pAvg) / g.B0 ** 2) * 100 * g.a * g.B0 / Ip_MA), at).toBeLessThan(1e-9);
      expect(d.betaN_th, at).toBe(d.betaN);
      expect(rel(d.betaP, (2 * mu0 * pAvg) / ((mu0 * st.s.Ip) / g.perimeter) ** 2), at).toBeLessThan(1e-9);
      expect(rel(d.P_cond, d.W / tauE), at).toBeLessThan(1e-12);
      // the profile snapshot: the kinetic profiles of the state, a pressure that integrates to W; the rest is the last normal step's
      expect(prof, at).not.toBe(onset);
      expect(prof.Te, at).toEqual(Array.from(st.Te));
      expect(prof.Ti, at).toEqual(Array.from(st.Ti));
      expect(prof.ne, at).toEqual(Array.from(st.ne, (x) => x * 1e-20));
      expect(rel(1.5 * volumeIntegral(g, prof.p) * 1e3, d.W * 1e6), at).toBeLessThan(1e-12);
      expect(prof.q, at).toBe(onset.q);
    }
    expect(ctx.phase).toBe('current_quench');
    expect(ctx.lastDiag.ne0).toBeLessThan(0.9 * ne00);
    expect(ctx.lastDiag.betaN).toBeLessThan(0.01 * betaN0);
    expect(ctx.lastProf.Te[0]).toBeLessThan(0.01);
    expect(onset.Te).toEqual(onsetTe);
    expect(onset.ne).toEqual(onsetNe);
  });
});
