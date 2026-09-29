/**
 * The fast-ion energy fields (pool.ts, source.ts): the exact update of a field, the energy ledger of every accepted step (to 1e-10), the
 * delay of the heating, the fast pressure in beta and in the equilibrium table, a bitwise rewind, and the default of the scalar pools.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../simulation';
import { JET_15D } from '../../presets';
import type { MagneticConfig } from '../../types';
import { FastIonProfile, heatingWeightA, PoolField, TAU_MIN } from './pool';
import { beamComponents } from './components';
import type { ProfileModel } from '../model';
import { volumeIntegral } from '../sources/deposition';
import { ProfileModel as PM } from '../model';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

const profileCfg = (t_end: number, extra: Partial<NonNullable<MagneticConfig['profiles']>> = {}): MagneticConfig => ({
  ...JET_15D, t_end, profiles: { ...JET_15D.profiles, fastIonModel: 'profile', ...extra },
});

describe('the weight of the delivery, a = 1 - (1 - e^-x)/x', () => {
  it('the series below x = 1e-3 continues the closed form to round-off; a -> 1/2 x for small x and -> 1 for a step much longer than tau', () => {
    const closed = (x: number) => 1 + Math.expm1(-x) / x;
    for (const x of [1.001e-3, 0.5, 3, 30]) expect(rel(heatingWeightA(x), closed(x))).toBeLessThan(1e-13);
    // continuity at the switch, and the series where the closed form cancels
    expect(rel(heatingWeightA(1e-3 - 1e-12), closed(1e-3 + 1e-12))).toBeLessThan(1e-8);
    expect(rel(heatingWeightA(1e-6), 0.5e-6)).toBeLessThan(1e-6);
    expect(heatingWeightA(1e6)).toBeGreaterThan(1 - 1e-5);
    expect(heatingWeightA(0)).toBe(0);
  });
});

describe('PoolField: dw/dt = S - w/tau per cell', () => {
  const N = 6;
  const dV = Float64Array.from({ length: N }, (_, i) => 1 + 0.3 * i);

  it('the update is the exact solution for a constant source: split steps compose, w stays between w and S tau, and the first step gains at most S dt', () => {
    const f = new PoolField(N);
    for (let i = 0; i < N; i++) { f.tau[i] = 0.02 * (i + 1); f.S[i] = 1e6 * (1 + i); f.W[i] = 0; }
    const g = new PoolField(N);
    g.tau.set(f.tau); g.S.set(f.S);
    f.advance(dV, 0.03);
    // two halves of the same step, from the same source
    g.advance(dV, 0.015); g.advance(dV, 0.015);
    for (let i = 0; i < N; i++) {
      expect(rel(f.W[i], g.W[i])).toBeLessThan(1e-13);
      expect(rel(f.W[i], f.S[i] * f.tau[i] * (1 - Math.exp(-0.03 / f.tau[i])))).toBeLessThan(1e-13);
      expect(f.W[i]).toBeLessThanOrEqual(f.S[i] * f.tau[i]);
      expect(f.W[i]).toBeLessThanOrEqual(f.S[i] * 0.03 * (1 + 1e-13));
    }
    // a long step reaches the steady content and the source is delivered whole
    const led = f.advance(dV, 1e3);
    for (let i = 0; i < N; i++) expect(rel(f.W[i], f.S[i] * f.tau[i])).toBeLessThan(1e-12);
    expect(led.delivered).toBeGreaterThan(0.999 * led.birth);
  });

  it('every step closes the energy ledger: birth - delivered = change of the content, to 1e-12 of the birth, for any step and time constant', () => {
    const f = new PoolField(N);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 200; k++) {
      for (let i = 0; i < N; i++) { f.tau[i] = TAU_MIN + 0.5 * rnd() ** 3; f.S[i] = 1e6 * rnd(); f.W[i] = f.W[i] * (0.5 + rnd()); }
      const dt = 10 ** (-6 + 6 * rnd());
      const before = f.W.reduce((s, w, i) => s + w * dV[i], 0);
      const led = f.advance(dV, dt);
      const after = f.W.reduce((s, w, i) => s + w * dV[i], 0);
      expect(Math.abs(led.birth - led.delivered - led.dContent)).toBeLessThan(1e-12 * Math.max(led.birth, led.delivered, 1e-30) + 1e-12 * Math.abs(before));
      expect(rel(after - before, led.dContent)).toBeLessThan(1e-9);
      for (let i = 0; i < N; i++) { expect(f.W[i]).toBeGreaterThanOrEqual(0); expect(Number.isFinite(f.W[i])).toBe(true); }
    }
  });

  it('the instantaneous rate (dt = 0) is h = w / tau; the heating of a step that starts from an empty field lags the source: a S with a < 1', () => {
    const f = new PoolField(N);
    for (let i = 0; i < N; i++) { f.tau[i] = 0.1; f.S[i] = 1e6; f.W[i] = 2e4 * (i + 1); }
    f.coefficients(0); f.deliver();
    for (let i = 0; i < N; i++) expect(rel(f.h[i], f.W[i] / 0.1)).toBeLessThan(1e-14);
    f.W.fill(0); f.coefficients(0.02); f.deliver();
    for (let i = 0; i < N; i++) { expect(f.h[i]).toBeGreaterThan(0); expect(f.h[i]).toBeLessThan(0.11 * f.S[i]); }
  });
});

describe('FastIonProfile: pressure, the equilibrium table and the remap at a geometry change', () => {
  const N = 30;
  const dV = Float64Array.from({ length: N }, (_, i) => 5 * (2 * i + 1) / (N * N) * 40);
  const rhoC = Float64Array.from({ length: N }, (_, i) => (i + 0.5) / N);
  const dRhoC = new Float64Array(N).fill(1 / N);
  const make = () => {
    const f = new FastIonProfile(N, beamComponents(110));
    for (let i = 0; i < N; i++) { f.beam[0].W[i] = 3e4 * Math.exp(-((rhoC[i] / 0.3) ** 2)); f.beam[1].W[i] = 4e3 * (1 - rhoC[i]); f.alpha.W[i] = 1e3 * Math.exp(-((rhoC[i] / 0.2) ** 2)); }
    f.updatePressure();
    return f;
  };

  it('p_f = 2/3 of the energy density of all fields; the total pressure adds it to the thermal one', () => {
    const f = make();
    const p = Float64Array.from({ length: N }, (_, i) => 1e5 * (1 - rhoC[i] * rhoC[i]));
    const tot = f.totalPressure(p);
    for (let i = 0; i < N; i++) {
      expect(rel(f.pFast[i], (2 / 3) * (f.beam[0].W[i] + f.beam[1].W[i] + f.beam[2].W[i] + f.alpha.W[i]))).toBeLessThan(1e-14);
      expect(rel(tot[i], p[i] + f.pFast[i])).toBeLessThan(1e-14);
    }
  });

  it('the pressure table of the equilibrium is the thermal pressure plus the fast pressure smoothed over the grid of the solver, with the integral of the fast part conserved', () => {
    const f = make();
    const p = new Float64Array(N).fill(2e5);
    const table = f.equilibriumPressure(p, { rhoC, dRhoC, dV }, 0.08);
    let fast = 0, smooth = 0;
    for (let i = 0; i < N; i++) { fast += f.pFast[i] * dV[i]; smooth += (table[i] - p[i]) * dV[i]; expect(table[i]).toBeGreaterThanOrEqual(p[i]); }
    expect(rel(smooth, fast)).toBeLessThan(1e-13);
    // smoothing lowers the peak and raises the flank
    expect(table[0] - p[0]).toBeLessThan(f.pFast[0]);
    expect(table[12] - p[12]).toBeGreaterThan(f.pFast[12]);
  });

  it('a change of the cell volumes keeps the energy of every cell: w_i dV_i is unchanged, the first call only records the volumes, a snapshot restores them', () => {
    const f = make();
    const e0 = f.beam.map((b) => Float64Array.from(b.W, (w, i) => w * dV[i]));
    f.remap(dV);
    expect(f.beam[0].W[3]).toBe(make().beam[0].W[3]);
    const dV2 = Float64Array.from(dV, (v, i) => v * (1 + 0.02 * Math.sin(i)));
    const snap = f.snapshot();
    f.remap(dV2);
    f.beam.forEach((b, k) => { for (let i = 0; i < N; i++) expect(rel(b.W[i] * dV2[i], e0[k][i])).toBeLessThan(1e-14); });
    expect(rel(f.pFast[5], (2 / 3) * (f.beam[0].W[5] + f.beam[1].W[5] + f.beam[2].W[5] + f.alpha.W[5]))).toBeLessThan(1e-14);
    // restoring the snapshot brings back both the energy densities and the volumes they are expressed on
    f.restoreSnapshot(snap);
    expect(rel(f.beam[0].W[3], make().beam[0].W[3])).toBe(0);
    f.remap(dV);
    expect(rel(f.beam[0].W[3], make().beam[0].W[3])).toBeLessThan(1e-15);
  });

  it('a record without fields (from elsewhere) gets uniform fields that carry the contents over the volume', () => {
    const f = new FastIonProfile(N, beamComponents(110));
    f.restore(undefined, 2e6, 5e5, dV);
    const c = f.contents(dV);
    expect(rel(c.beam, 2e6)).toBeLessThan(1e-13);
    expect(rel(c.alpha, 5e5)).toBeLessThan(1e-13);
    expect(rel(f.beam[0].W[0] / f.beam[1].W[0], 0.75 / 0.15)).toBeLessThan(1e-13);
  });
});

describe('the fast-ion fields in a JET15 shot (fastIonModel "profile")', () => {
  it('every accepted step closes the energy ledger to 1e-10 and delivers what the heat equation received; the content is the energy born minus the energy delivered', () => {
    const m = new PM(profileCfg(0.8));
    const y = m.initialState();
    m.diagnostics(0, y);
    const ctx = m.ctx, fast = ctx.fast!;
    expect(fast).toBeTruthy();
    let bornB = 0, delB = 0, bornA = 0, delA = 0, steps = 0, worst = 0, worstHeat = 0, tPrev = 0;
    const check = m.coupling.check.bind(m.coupling);
    m.coupling.check = (c, t, yy, update) => {
      const dt = t - tPrev; tPrev = t;
      const { beam, alpha } = fast.lastStep;
      worst = Math.max(worst, Math.abs(beam.birth - beam.delivered - beam.dContent) / Math.max(beam.birth, 1), Math.abs(alpha.birth - alpha.delivered - alpha.dContent) / Math.max(alpha.birth, 1));
      // the heat equation received the delivered heating of the ledger
      const w = c.w, g = c.tg;
      const hb = (volumeIntegral(g, w.PnbiE) + volumeIntegral(g, w.PnbiI)) * dt;
      const ha = (volumeIntegral(g, w.PaE) + volumeIntegral(g, w.PaI)) * dt;
      worstHeat = Math.max(worstHeat, rel(hb, beam.delivered), Math.abs(ha - alpha.delivered) / Math.max(alpha.birth, 1));
      bornB += beam.birth; delB += beam.delivered; bornA += alpha.birth; delA += alpha.delivered; steps++;
      // the contents of the shared context are the integrals of the fields; the pressure is 2/3 of the energy density
      const ct = fast.contents(g.dV);
      expect(rel(c.WfBeam, ct.beam)).toBeLessThan(1e-13);
      expect(rel(c.WfAlpha, ct.alpha)).toBeLessThan(1e-13);
      // the birth energy of a step is at most the power born, delivered never exceeds what was born and was in the field
      expect(delB).toBeLessThanOrEqual(bornB * (1 + 1e-12));
      return check(c, t, yy, update);
    };
    let t = 0;
    while (t < 0.8 - 1e-9 && !m.terminated) { const t0 = t; t = m.step(t, y, 0.8); m.postStep(t, t - t0, y); }
    expect(steps).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-10);
    expect(worstHeat).toBeLessThan(1e-9);
    // the content is what was born and not delivered (cumulative), to 1e-10 of the birth
    const c = fast.contents(ctx.tg.dV);
    expect(Math.abs(bornB - delB - c.beam)).toBeLessThan(1e-10 * bornB);
    expect(Math.abs(bornA - delA - c.alpha)).toBeLessThan(1e-10 * Math.max(bornA, 1));
    expect(c.beam).toBeGreaterThan(1e5);
  }, 120000);

  it('the heating is delayed: the first steps deliver a small part of what is born (the field fills), the flat top nearly all of it', () => {
    const m = new PM(profileCfg(1.0));
    const y = m.initialState();
    m.diagnostics(0, y);
    const fast = m.ctx.fast!;
    const ratio: number[] = [], times: number[] = [];
    const check = m.coupling.check.bind(m.coupling);
    m.coupling.check = (c, t, yy, update) => {
      const l = fast.lastStep.beam;
      if (l.birth > 0) { ratio.push(l.delivered / l.birth); times.push(t); }
      return check(c, t, yy, update);
    };
    let t = 0;
    while (t < 1.0 - 1e-9 && !m.terminated) { const t0 = t; t = m.step(t, y, 1.0); m.postStep(t, t - t0, y); }
    expect(ratio.length).toBeGreaterThan(50);
    expect(ratio[0]).toBeLessThan(0.3);
    expect(ratio[ratio.length - 1]).toBeGreaterThan(0.75);
    expect(ratio[ratio.length - 1]).toBeLessThan(1.2);
  }, 120000);

  it('the fast pressure is in beta: beta_N = beta_N,th (1 + W_f/W) as in the scalar model, and pfast (2/3 of the fast energy density) is a profile the report carries', () => {
    const sim = new Simulation(profileCfg(0.6));
    sim.runAll();
    const m = sim.model as ProfileModel;
    const d = sim.history[sim.history.length - 1].d;
    expect(rel(d.betaN, d.betaN_th * (1 + d.Wf / d.W))).toBeLessThan(1e-12);
    const fast = m.ctx.fast!;
    const pf = Array.from(fast.pFast);
    expect(Math.max(...pf)).toBeGreaterThan(1e3);
    // 3/2 of the pressure integrates to the content
    let e = 0;
    for (let i = 0; i < m.ctx.N; i++) e += 1.5 * pf[i] * m.ctx.tg.dV[i];
    expect(rel(e, m.ctx.WfBeam + m.ctx.WfAlpha)).toBeLessThan(1e-12);
  }, 120000);

  it('a rewind to a frame with a filled field and a replay from it is bitwise identical (the fields are in the checkpoint)', () => {
    const cfg = profileCfg(0.6);
    const ref = new Simulation(cfg);
    ref.runAll();
    const idx = ref.history.findIndex((h) => h.t > 0.2);
    expect(idx).toBeGreaterThan(3);
    expect(ref.history[idx].d.W_beam).toBeGreaterThan(0.1);
    const sim = new Simulation(cfg);
    sim.runAll();
    sim.rewindTo(idx);
    sim.advance(cfg.t_end);
    expect(sim.history.length).toBe(ref.history.length);
    for (let k = idx + 1; k < ref.history.length; k++) {
      expect(sim.history[k].y).toEqual(ref.history[k].y);
      for (const key of ['W_beam', 'W_alpha', 'Wf', 'betaN', 'P_beam_heat', 'P_alpha']) expect(sim.history[k].d[key], `${key} at frame ${k}`).toBe(ref.history[k].d[key]);
    }
  }, 120000);

  it('the scalar pools stay the default: no fields, the default source list without the fast-ion source', () => {
    const m = new PM({ ...JET_15D, t_end: 0.2 });
    expect(m.ctx.fast).toBeNull();
    expect(m.physics.sources.map((s) => s.id)).not.toContain('fastions');
    const p = new PM(profileCfg(0.2));
    expect(p.ctx.fast).toBeInstanceOf(FastIonProfile);
    expect(p.physics.sources.map((s) => s.id)).toContain('fastions');
    expect(p.ctx.fast!.comps).toEqual(beamComponents(JET_15D.heating.E_NBI_keV));
  });
});
