/**
 * The conservative remap at the adoption of a new equilibrium (coupling/remap.ts) and the update on a change of the plasma current
 * (coupling/equilibrium.ts, EQ_IP_TRIGGER).
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { circularGeometry } from '../geometry1d';
import { CurrentSolver } from '../fvsolver';
import type { ProfileModel } from '../model';
import { EQ_IP_TRIGGER } from './equilibrium';
import { remapContents } from './remap';

const MU0 = 1.25663706212e-6;

describe('remapContents', () => {
  // two geometries of the same radial grid whose metric differs by a few percent and not by a common factor (a cylinder of another radius
  // has the same V' g2 at every surface: the enclosed current is the same function of rho), like two successive equilibria: V' and g2 of the
  // second one have a Shafranov-shift-like change that grows towards the edge
  const N = 50, R0 = 6, B0 = 5, Ip = 1.5e7;
  const o = circularGeometry(R0, 2, B0, N);
  const skew = (r: number) => 1 + 0.04 * r * r;
  const n: typeof o = {
    ...o,
    VpF: Float64Array.from(o.VpF, (v, f) => v * skew(o.rhoF[f])), g2F: Float64Array.from(o.g2F, (v, f) => v / skew(o.rhoF[f]) ** 0.5),
    VpC: Float64Array.from(o.VpC, (v, i) => v * skew(o.rhoC[i])), g2C: Float64Array.from(o.g2C, (v, i) => v / skew(o.rhoC[i]) ** 0.5),
    dV: Float64Array.from(o.dV, (v, i) => v * skew(o.rhoC[i])),
  };
  const profile = () => {
    const ne = Float64Array.from(o.rhoC, (r) => 1e20 * (1 - 0.8 * r * r)), Te = Float64Array.from(o.rhoC, (r) => 20 * (1 - r * r) + 0.1);
    // a monotone ψ with the boundary gradient of I_p
    const psi = new Float64Array(N);
    const cs = new CurrentSolver(o);
    const gb = (2 * Math.PI * MU0 * Ip) / (o.VpF[N] * o.g2F[N]);
    psi[N - 1] = 3;
    for (let i = N - 1; i >= 1; i--) psi[i - 1] = psi[i] - o.distF[i] * gb * (o.rhoF[i] ** 2) * (1 + 0.3 * Math.sin(3 * o.rhoF[i]));
    void cs;
    return { ne, Te, psi };
  };
  const enclosed = (g: typeof o, psi: Float64Array) => {
    const cs = new CurrentSolver(g);
    return cs.Ienc(cs.dpsiF(psi, Ip, new Float64Array(N + 1)), new Float64Array(N + 1));
  };

  it('keeps the particles and the energy of every cell, and leaves the temperatures alone', () => {
    const { ne, Te, psi } = profile();
    const Te0 = Float64Array.from(Te), N0 = Float64Array.from(ne, (x, i) => x * o.dV[i]), ne1 = Float64Array.from(ne);
    remapContents(o, n, ne, psi, Ip);
    for (let i = 0; i < N; i++) {
      expect(Math.abs((ne[i] * n.dV[i]) / N0[i] - 1), `particles of cell ${i}`).toBeLessThan(1e-13);
      expect(Te[i]).toBe(Te0[i]);
    }
    const before = N0.reduce((s, x) => s + x, 0), after = ne.reduce((s, x, i) => s + x * n.dV[i], 0);
    expect(Math.abs(after / before - 1)).toBeLessThan(1e-13);
    // the density changed: the outermost cell is 4 % larger, so its density is 4 % lower
    expect(ne[N - 1] / ne1[N - 1]).toBeCloseTo(o.dV[N - 1] / n.dV[N - 1], 12);
    expect(ne[N - 1] / ne1[N - 1]).toBeLessThan(0.97);
  });

  it('keeps the enclosed current at every face and makes the flux at the boundary continuous', () => {
    const { ne, psi } = profile();
    const I0 = enclosed(o, psi);
    const gb = (g: typeof o) => (2 * Math.PI * MU0 * Ip) / (g.VpF[N] * g.g2F[N]);
    const psiB0 = psi[N - 1] + gb(o) * o.distF[N];
    remapContents(o, n, ne, psi, Ip);
    const I1 = enclosed(n, psi);
    for (let f = 0; f <= N; f++) expect(Math.abs(I1[f] - I0[f]) / Ip, `enclosed current at face ${f}`).toBeLessThan(1e-12);
    expect(I1[N] / Ip).toBeCloseTo(1, 12);
    expect(Math.abs(psi[N - 1] + gb(n) * n.distF[N] - psiB0)).toBeLessThan(1e-12);
    // without the remap the enclosed current at the faces would differ by the change of V' g2
    const raw = profile().psi;
    const Iraw = enclosed(n, raw);
    let worst = 0;
    for (let f = 1; f < N; f++) worst = Math.max(worst, Math.abs(Iraw[f] - I0[f]) / Ip);
    expect(worst).toBeGreaterThan(1e-3);
  });

  it('is the identity for an unchanged geometry', () => {
    const { ne, psi } = profile();
    const ne0 = Float64Array.from(ne), psi0 = Float64Array.from(psi);
    remapContents(o, o, ne, psi, Ip);
    for (let i = 0; i < N; i++) {
      expect(ne[i]).toBe(ne0[i]);
      expect(Math.abs(psi[i] - psi0[i])).toBeLessThan(1e-12);
    }
  });
});

describe('the first update of an ITER15 shot', () => {
  // t = 5.0 s: the first update. The contents and the enclosed current do not jump across it, and the loop voltage of the step after it is that
  // of the steps before it (0.4 V; without the remap the state took 14 V for one step to make up the disagreement at the boundary)
  const m = new Simulation({ ...ITER_15D, t_end: 6 }).model as ProfileModel;
  const y = m.initialState();
  m.diagnostics(0, y);
  const N = m.ctx.N;
  let t = 0;
  const geo0 = m.ctx.tg;
  while (t < 6 && !m.terminated && m.ctx.tg === geo0) { const t0 = t; t = m.step(t, y, 6); m.postStep(t, t - t0, y); }

  it('the update happened', () => {
    expect(m.eqUpdates).toBe(1);
    expect(m.ctx.tg).not.toBe(geo0);
  });

  it('the particles and the stored energy of the state are those of the step that ended the update (no jump)', () => {
    const v = m.ctx.view(y), g = m.ctx.tg;
    const Ne = v.ne.reduce((s, x, i) => s + x * g.dV[i], 0);
    // the diagnostics of the step (written before the update, on the old geometry) carry the density and the energy of the step
    const ne = m.ctx.lastDiag.ne * 1e20 * geo0.volume, W = m.ctx.lastDiag.W * 1e6;
    expect(Math.abs(Ne / ne - 1)).toBeLessThan(1e-9);
    // W is (3/2) sum (n_e T_e + n_i T_i) dV: n_i = the work array of the composition of the step, evaluated on the new geometry by the update
    expect(Math.abs(m.ctx.storedEnergy(v) / W - 1)).toBeLessThan(3e-3); // the ion density of the composition (a function of n_e) follows n_e
  });

  it('the loop voltage of the next step is that of the steps before the update', () => {
    const before = m.ctx.lastVloop;
    const t0 = t; t = m.step(t, y, 6); m.postStep(t, t - t0, y);
    const after = m.ctx.lastVloop;
    expect(Math.abs(after / before - 1)).toBeLessThan(0.2);
    expect(N).toBeGreaterThan(0);
  });
});

describe('an update on a change of the plasma current', () => {
  // ITER15 at 8 MA ramped to 12 MA within 2 s, with an update interval so long that only the change of I_p can ask for an update
  const cfg = { ...ITER_15D, Ip_MA: 8, t_end: 4, profiles: { ...ITER_15D.profiles, eqUpdateInterval: 100, IpWaveform: [[0, 8], [0.5, 8], [2.5, 12]] as [number, number][] } };
  const m = new Simulation(cfg).model as ProfileModel;
  const y = m.initialState();
  m.diagnostics(0, y);
  const q95First = m.ctx.eq.q95;
  const seen: number[] = [];
  let t = 0;
  while (t < 4 && !m.terminated) {
    const t0 = t; t = m.step(t, y, 4); m.postStep(t, t - t0, y);
    seen.push(Math.abs(m.ctx.view(y).s.Ip - m.coupling.eqIp) / m.coupling.eqIp);
  }

  it('asks for an update at every 10 % of the current, and never runs on a geometry more than that behind', () => {
    expect(EQ_IP_TRIGGER).toBe(0.1);
    expect(m.eqUpdates).toBeGreaterThanOrEqual(3); // 8 -> 12 MA: at 8.8, 9.7, 10.7, 11.7
    expect(m.eqUpdates).toBeLessThanOrEqual(6);
    expect(m.eqRejected).toBe(0);
    // the deviation is checked after the step and before the next one runs: it may exceed the trigger by the change of one step
    expect(Math.max(...seen)).toBeLessThan(EQ_IP_TRIGGER + 0.03);
  });

  it('the geometry follows the ramp: q95 of the equilibrium falls in proportion to the current', () => {
    const ratio = (m.ctx.eq.q95 / q95First) * (m.ctx.view(y).s.Ip / 8e6);
    expect(Math.abs(ratio - 1)).toBeLessThan(0.12);
  });
});
