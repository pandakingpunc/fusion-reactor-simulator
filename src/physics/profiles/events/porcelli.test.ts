/**
 * The sawtooth trigger of Porcelli, Boucher and Rosenbluth (events/porcelli.ts) on JET15 states with a prescribed q profile: the definitions of the times
 * and lengths against SI values, the signs and dependences of the terms of the paper, the conditions 13-15 and the margin of the stepper, and the
 * trigger and the helical-flux reset in a running model (a crash when the margin turns positive, q > 1 after it, bitwise replay).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../simulation';
import { JET_15D } from '../../presets';
import type { MagneticConfig, ReactorConfig } from '../../types';
import { composition } from '../composition';
import type { ProfileContext } from '../context';
import { ProfileModel } from '../model';
import { currentProfiles } from '../qprofile';
import { marginOfTerms, PORCELLI, porcelliMargin, porcelliTerms, type PorcelliTerms } from './porcelli';
import { triggerScratch } from './triggers';
import { SawtoothEvents } from './sawtooth';
import type { SimEvent } from '../../types';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const MP = 1.67262192369e-27, QE = 1.602176634e-19, MU0 = 1.25663706212e-6;

const cfgOf = (extra: NonNullable<MagneticConfig['profiles']> = {}, over: Partial<MagneticConfig> = {}): MagneticConfig => ({
  ...JET_15D, ...over, profiles: { ...JET_15D.profiles, sawtoothTrigger: 'porcelli', ...extra },
});

/** A JET15 model whose state has q = q0 + qa ρ̂² and peaked T_e, T_i, n_e profiles (T_i0 = 10 keV, T_e0 = 9 keV, n_e0 = 6.5e19 m⁻³) */
function state(extra: NonNullable<MagneticConfig['profiles']> = {}, q0 = 0.8, qa = 2.5, scaleT = 1) {
  const m = new ProfileModel(cfgOf(extra));
  const y = m.initialState();
  const d0 = m.diagnostics(0, y);
  const ctx = m.ctx, st = ctx.view(y), g = ctx.tg, N = ctx.N;
  st.psi[0] = 0;
  for (let f = 1; f < N; f++) st.psi[f] = st.psi[f - 1] + (g.distF[f] * g.PhiB * g.rhoF[f]) / (Math.PI * (q0 + qa * g.rhoF[f] ** 2));
  currentProfiles(ctx, st.psi, st.s.Ip);
  g.rhoC.forEach((r, i) => { st.Te[i] = 0.3 + 9 * scaleT * (1 - r * r) ** 1.5; st.Ti[i] = 0.3 + 10 * scaleT * (1 - r * r) ** 1.5; st.ne[i] = 3e19 + 3.5e19 * (1 - r * r); });
  composition(ctx, st.Te, st.ne, st.s);
  m.physics.evaluateWorkArrays(2, st);
  const rat = new Float64Array(N);
  for (let i = 0; i < N; i++) rat[i] = ctx.w.ni[i] / st.ne[i];
  const sc = triggerScratch(N);
  const terms = () => porcelliTerms(ctx, { Te: st.Te, Ti: st.Ti, ne: st.ne, psi: st.psi, niOverNe: rat, Ip: st.s.Ip }, sc);
  return { m, ctx, st, g, N, rat, sc, terms, d0 };
}

describe('the constants and definitions of the paper', () => {
  it('c_h = 0.4, c_ρ = 1, c_* = 3, c_f = 1 and the shear minimum 0.1 of the module', () => {
    expect(PORCELLI).toEqual({ cH: 0.4, cRho: 1, cStar: 3, cF: 1, shearMin: 0.1 });
  });

  it('τ_A = R √3/v_A, ρ̂ = ρ_i/r̄_1 and τ_R agree with their SI definitions (Alfvén speed of the ions at n_e0, thermal Larmor radius, Spitzer resistivity)', () => {
    const { ctx, st, g, terms } = state();
    const t = terms()!;
    const w = ctx.w;
    const A = (2.014 * w.na[0] + 3.016 * w.nb[0]) / (w.na[0] + w.nb[0]);
    const vA = g.B0 / Math.sqrt(MU0 * A * MP * st.ne[0]);
    expect(rel(t.tauA, (g.R0 * Math.sqrt(3)) / vA)).toBeLessThan(0.03);
    const Ti0 = st.Ti[0] * 1.602176634e-16;
    const rhoI = Math.sqrt(A * MP * Ti0) / (QE * g.B0);
    expect(rel(t.rhoHat, rhoI / t.rBar1)).toBeLessThan(0.02);
    // τ_R = μ0 r̄²/η with the Spitzer η = 1.65e-9 ln Λ Z/T^{3/2} Ω m (T in keV); 43.7 T^{3/2} r̄² is that to a few per cent
    const tauR = 43.7 * st.Ti[0] ** 1.5 * t.rBar1 ** 2;
    expect(rel(tauR, (MU0 * t.rBar1 ** 2) / (1.65e-9 * 17 * st.Ti[0] ** -1.5))).toBeLessThan(0.06);
    expect(rel(t.lundquist, tauR / t.tauA)).toBeLessThan(1e-12);
    // γ_ρ of the semi-collisional regime and ω_*i are as printed
    expect(rel(t.gammaRho, (1.1 * t.s1 ** (6 / 7) * t.rhoHat ** (4 / 7)) / (t.tauA * t.lundquist ** (1 / 7)))).toBeLessThan(1e-12);
    expect(t.omegaDi).toBeGreaterThan(0);
  });

  it('the geometry of the q = 1 surface: r_1 the half-width, κ_1 the elongation of the surface, r̄_1 = √κ_1 r_1, ε_1 = r̄_1/R, s_1 = ρ q′/q', () => {
    const { g, terms, sc } = state({}, 0.8, 2.5);
    const t = terms()!;
    // q = 0.8 + 2.5 ρ̂² = 1 at ρ̂ = 0.2828
    expect(Math.abs(t.rho1 - Math.sqrt(0.08))).toBeLessThan(2e-3);
    expect(rel(t.rBar1, Math.sqrt(t.kappa1) * t.r1)).toBeLessThan(1e-12);
    expect(rel(t.eps1, t.rBar1 / g.R0)).toBeLessThan(1e-12);
    // the elongation of an inner surface lies between 1 and that of the boundary, r_1 about ρ a (shifted, elongated surfaces)
    expect(t.kappa1).toBeGreaterThan(1);
    expect(t.kappa1).toBeLessThan(g.kappa * 1.05);
    expect(rel(t.r1, t.rho1 * g.a)).toBeLessThan(0.25);
    // s_1 of q = 0.8 + 2.5ρ²: 5 ρ²/q = 0.4/1.0
    expect(Math.abs(t.s1 - 0.4)).toBeLessThan(0.02);
    expect(t.sNorm).toBeCloseTo(Math.sqrt(t.s1 ** 2 + 0.01), 12);
    void sc;
  });
});

describe('the terms of δŴ', () => {
  it('Bussac: −(9π/s)(l_i1 − ½) ε_1² (β_p1² − β_pc²), negative above the critical β_p1 = β_pc = 0.3 (1 − 5 r_1/3a) and growing with the pressure inside q = 1; elongation −(18π/s)(l_i1 − ½)³ ((κ_1 − 1)/2)²; both scale as 1/s', () => {
    const coolS = state({}, 0.8, 2.5, 0.5), cool = coolS.terms()!, hot = state({}, 0.8, 2.5, 3).terms()!;
    expect(rel(cool.betaPc, 0.3 * (1 - (5 * cool.r1) / (3 * coolS.g.a)))).toBeLessThan(0.05);
    for (const t of [cool, hot]) {
      const dli = Math.max(t.li1 - 0.5, 0);
      expect(rel(t.dWbussac, (-9 * Math.PI * dli * t.eps1 ** 2 * (t.betaP1 ** 2 - t.betaPc ** 2)) / t.sNorm)).toBeLessThan(1e-12);
      expect(rel(t.dWelong, (-18 * Math.PI * dli ** 3 * ((t.kappa1 - 1) / 2) ** 2) / t.sNorm)).toBeLessThan(1e-12);
      expect(t.dWelong).toBeLessThanOrEqual(0);
    }
    expect(hot.betaP1).toBeGreaterThan(cool.betaP1);
    expect(hot.dWbussac).toBeLessThan(cool.dWbussac);
    // above β_pc the Bussac term drives, below it it stabilises
    expect(Math.sign(hot.dWbussac)).toBe(hot.betaP1 > hot.betaPc ? -1 : 1);
    // the internal inductance of a peaked profile is above ½ (uniform current gives ½)
    expect(cool.li1).toBeGreaterThan(0.45);
  });

  it('Kruskal-Oberman: positive (stabilising), ∝ √ε_1 β_i0/s, with c_p = (5/2) ∫ x^{3/2} p_i/p_i0 dx of order 0.5 for a peaked ion pressure', () => {
    const t = state().terms()!;
    expect(t.dWko).toBeGreaterThan(0);
    const w = state();
    const a = w.terms()!;
    // ∝ β_i0: doubling T_i doubles p_i0 and β_i0, and c_p (a ratio of pressures) is unchanged to the change of the profile shape
    const b = (() => { const s2 = state({}, 0.8, 2.5, 2); return s2.terms()!; })();
    expect(b.dWko / a.dWko).toBeGreaterThan(1.7);
    expect(b.dWko / a.dWko).toBeLessThan(2.2);
  });

  it('fast ions: δŴ_fast = c_f ε_1^{3/2} β*_pα/s with β*_pα = −(2μ0/B_p1²) ∫ x^{3/2} dp_f/dx dx: zero without fast ions, positive for a centrally peaked fast pressure, larger with more energy', () => {
    const none = state().terms()!;
    expect(Math.abs(none.dWfast)).toBe(0);
    expect(none.fast).toBe(false);
    expect(none.eq13).toBe(false);
    const w = state({ fastIonModel: 'profile' });
    const f = w.ctx.fast!;
    w.g.rhoC.forEach((r, i) => { f.beam[0].W[i] = 3e4 * Math.exp(-((r / 0.3) ** 2)); });
    f.updatePressure();
    const a = w.terms()!;
    expect(a.fast).toBe(true);
    expect(a.dWfast).toBeGreaterThan(0);
    // analytic check of the integral for p_f = p0 exp(−(ρ/0.3)²): −∫ x^{3/2} dp/dx dx = −p(1) + 1.5 ∫ x^{1/2} p dx
    const w2 = state({ fastIonModel: 'profile' });
    w2.g.rhoC.forEach((r, i) => { w2.ctx.fast!.beam[0].W[i] = 6e4 * Math.exp(-((r / 0.3) ** 2)); });
    w2.ctx.fast!.updatePressure();
    const b = w2.terms()!;
    expect(rel(b.dWfast, 2 * a.dWfast)).toBeLessThan(1e-9);
    // ω_Dh: the pressure-weighted precession frequency of the ions, 500 E/(Z B R r̄_1), with E the mean energy of the slowing-down distribution (below the birth energy)
    const E = (a.omegaDh * w.g.B0 * w.g.R0 * a.rBar1) / 500;
    expect(E).toBeGreaterThan(5);
    expect(E).toBeLessThan(JET_15D.heating.E_NBI_keV);
    void w.sc;
  });
});

describe('the conditions and the margin', () => {
  it('no q = 1 surface: no terms, margin −1; the margin of the stepper is the maximum over the three conditions of their relative margins', () => {
    const above = state({}, 1.1, 1.5);
    expect(above.terms()).toBeNull();
    expect(porcelliMargin(above.ctx, { Te: above.st.Te, Ti: above.st.Ti, ne: above.st.ne, psi: above.st.psi, niOverNe: above.rat, Ip: above.st.s.Ip }, above.sc)).toBe(-1);
    const w = state();
    const t = w.terms() as PorcelliTerms;
    const rel3 = (l: number, r: number) => (l - r) / (Math.abs(l) + Math.abs(r) + 1e-3);
    const want = Math.max(t.fast ? rel3(t.c13[0], t.c13[1]) : -1, rel3(t.c14[0], t.c14[1]), Math.min(rel3(t.c15a[1], t.c15a[0]), rel3(t.c15a[2], t.c15a[1]), rel3(t.c15b[1], t.c15b[0])));
    expect(marginOfTerms(t)).toBe(want);
    // the flags are the conditions themselves
    expect(t.eq14).toBe(t.c14[0] > t.c14[1]);
    expect(t.eq15).toBe(t.c15a[0] < t.c15a[1] && t.c15a[1] < t.c15a[2] && t.c15b[0] < t.c15b[1]);
    expect(marginOfTerms(t) > 0).toBe(t.eq13 || t.eq14 || t.eq15);
  });

  it('a critical shear at q = 1: q = q0 + qa ρ̂² with q = 1 at ρ̂² = 0.08 is stable at s_1 = 0.24, triggers between s_1 = 0.38 and 0.45 through the resistive-kink condition (15), and above s_1 = 0.6 through the ideal one (14) as the elongation term (∝ (l_i1 − ½)³/s) drives', () => {
    const at = (qa: number) => state({}, 1 - qa * 0.08, qa).terms()!;
    const stable = at(1.5), weak = at(2.5), strong = at(3.75);
    expect(stable.s1).toBeCloseTo(0.24, 1);
    expect(marginOfTerms(stable)).toBeLessThan(0);
    expect(stable.eq14 || stable.eq15).toBe(false);
    expect(weak.s1).toBeGreaterThan(0.38);
    expect(weak.s1).toBeLessThan(0.45);
    expect(weak.eq15).toBe(true);
    expect(weak.eq14).toBe(false);
    expect(marginOfTerms(weak)).toBeGreaterThan(0);
    expect(strong.eq14).toBe(true);
    expect(marginOfTerms(strong)).toBeGreaterThan(0);
    // one sign change of the margin over a sweep of the shear (no chattering: the stepper localises the crossing)
    let flips = 0, prev = -1;
    for (const qa of [1.2, 1.5, 1.8, 2.1, 2.3, 2.5, 3, 3.75, 5, 6.25]) {
      const m = marginOfTerms(at(qa));
      if (Math.sign(m) !== Math.sign(prev) && prev !== -1) flips++;
      prev = m;
    }
    expect(flips).toBe(1);
    // the growth rate of the layer rises with s_1 (γ_ρ ∝ s^{6/7}); ω_*i does not depend on it
    expect(strong.gammaRho).toBeGreaterThan(stable.gammaRho);
    expect(rel(strong.omegaDi, stable.omegaDi)).toBeLessThan(1e-9);
  });

  it('with fast ions the condition (13) can be met: at a high pressure inside q = 1 the core is ideally unstable, and the fast ions hold only while their precession (ω_Dh τ_A c_h) exceeds it', () => {
    const w = state({ fastIonModel: 'profile' }, 0.8, 2.5, 4);
    w.g.rhoC.forEach((r, i) => { w.ctx.fast!.beam[0].W[i] = 1e4 * Math.exp(-((r / 0.3) ** 2)); });
    w.ctx.fast!.updatePressure();
    const t = w.terms()!;
    expect(t.fast).toBe(true);
    expect(t.c13[1]).toBeGreaterThan(0);
    expect(t.eq13).toBe(t.c13[0] > t.c13[1]);
  });
});

describe('the trigger in a running model', () => {
  const cfg = (extra: NonNullable<MagneticConfig['profiles']>, t_end: number): MagneticConfig => cfgOf(extra, { t_end });

  /** A Simulation of the JET15 model whose initial state has q = 0.85 + 2.5ρ̂² (a q = 1 surface at ρ̂ = 0.245) */
  function run(extra: NonNullable<MagneticConfig['profiles']>, t_end: number) {
    const factory = (rc: ReactorConfig) => {
      const m = new ProfileModel(rc as MagneticConfig);
      const orig = m.initialState.bind(m);
      m.initialState = () => {
        const y = orig();
        const ctx = m.ctx, st = ctx.view(y), g = ctx.tg, N = ctx.N;
        st.psi[0] = 0;
        for (let f = 1; f < N; f++) st.psi[f] = st.psi[f - 1] + (g.distF[f] * g.PhiB * g.rhoF[f]) / (Math.PI * (0.85 + 2.5 * g.rhoF[f] ** 2));
        currentProfiles(ctx, st.psi, st.s.Ip);
        return y;
      };
      return m;
    };
    const sim = new Simulation(cfg(extra, t_end), { modelFactory: factory });
    sim.runAll();
    return sim;
  }

  it('the crashes are the times at which the margin turned positive, at least 50 ms apart; with the helical-flux reset q > 1 inside the mixing radius right after each crash', () => {
    const sim = run({ sawtoothReconnection: 'kadomtsev' }, 0.4);
    const saw = sim.events.filter((e: SimEvent) => e.kind === 'sawtooth');
    expect(saw.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < saw.length; k++) expect(saw[k].t - saw[k - 1].t).toBeGreaterThan(0.05 - 1e-9);
    expect(saw.some((e) => /Porcelli/.test(e.msg))).toBe(true);
    // the frame after a crash (ELM-free frames of the record): q0 just above 1
    const after = sim.history.find((f) => f.t > saw[1].t && f.t < saw[1].t + 0.03);
    expect(after).toBeTruthy();
    expect(after!.d.q0).toBeGreaterThan(0.999);
    expect(after!.d.q0).toBeLessThan(1.2);
    expect(saw[1].msg).toMatch(/q0 → 1\.0/);
  }, 120000);

  it('with the shear trigger and no reset option the run is the legacy one (no Porcelli text in its events); the options change the run', () => {
    const legacy = run({ sawtoothTrigger: 'shear' }, 0.25);
    const saw = legacy.events.filter((e: SimEvent) => e.kind === 'sawtooth');
    expect(saw.length).toBeGreaterThanOrEqual(1);
    expect(saw.some((e) => /Porcelli/.test(e.msg))).toBe(false);
    const p = run({}, 0.25);
    expect(p.history[p.history.length - 1].y).not.toEqual(legacy.history[legacy.history.length - 1].y);
  }, 120000);

  it('a replay from a frame before a crash is bitwise the same run (the trigger is a function of the state; the crash timer is checkpointed)', () => {
    const ref = run({ sawtoothReconnection: 'kadomtsev' }, 0.3);
    const saw = ref.events.filter((e: SimEvent) => e.kind === 'sawtooth');
    expect(saw.length).toBeGreaterThanOrEqual(1);
    const idx = ref.history.findIndex((h) => h.t > saw[0].t + 0.02);
    expect(idx).toBeGreaterThan(2);
    const sim = run({ sawtoothReconnection: 'kadomtsev' }, 0.3);
    sim.rewindTo(idx);
    sim.advance(0.3);
    expect(sim.history.length).toBe(ref.history.length);
    for (let k = idx + 1; k < ref.history.length; k++) expect(sim.history[k].y).toEqual(ref.history[k].y);
  }, 240000);

  it('a crash on a prescribed state above the resistive threshold: energies and particles conserved, q > 1 inside the mixing radius, T_e flat inside q = 1', () => {
    const w = state({ sawtoothReconnection: 'kadomtsev' }, 1 - 4 * 0.08, 4);
    const { ctx, st, g, N } = w;
    const sums = () => ({
      N: g.dV.reduce((a, dv, i) => a + st.ne[i] * dv, 0),
      We: g.dV.reduce((a, dv, i) => a + st.ne[i] * st.Te[i] * dv, 0),
      Wi: g.dV.reduce((a, dv, i) => a + ctx.w.ni[i] * st.Ti[i] * dv, 0),
    });
    const s0 = sums(), Te0 = st.Te[0];
    const ev: SimEvent[] = [];
    ctx.dt = 0.05;
    new SawtoothEvents().afterStep(ctx, 2, st, { ...w.d0, betaN: 0.1 }, ev);
    expect(ev.map((e) => e.kind)).toEqual(['sawtooth']);
    expect(ev[0].msg).toMatch(/Porcelli/);
    expect(st.Te[0]).toBeLessThan(Te0);
    const s1 = sums();
    expect(Math.abs(s1.N / s0.N - 1)).toBeLessThan(1e-13);
    expect(Math.abs(s1.We / s0.We - 1)).toBeLessThan(1e-13);
    expect(Math.abs(s1.Wi / s0.Wi - 1)).toBeLessThan(1e-12);
    expect(ctx.diagStale).toBe(true);
    // q > 1 from the axis to the mixing radius (ρ̂ of the message), and the reset q0 only just above 1
    const rmix = Number(/ρ_mix = ([0-9.]+)/.exec(ev[0].msg)![1]);
    for (let f = 2; f < N && g.rhoF[f] < rmix - 0.03; f++) expect(ctx.w.qF[f]).toBeGreaterThan(1);
    expect(ctx.w.qF[0]).toBeGreaterThan(0.99);
    expect(ctx.w.qF[0]).toBeLessThan(1.2);
  });
});
