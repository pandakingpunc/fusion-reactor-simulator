/**
 * The profile-resolved He ash and impurities of the 1.5D model (impurity/model.ts): species and state layout, the steady profile of the
 * exponentially fitted solver, the helium exhaust (tau_He*), particle conservation, the composition (quasi-neutrality, Z_eff) and the
 * neoclassical convection, the MHD crashes, the checkpoint, and short shots (chunk invariance, exact rewind, He fraction of ITER).
 * Unit tests drive `ImpurityModel.accepted` on the initial state of a real model with analytic transport coefficients.
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D, JET_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { coolingRate, meanCharge } from '../../radiation';
import { composition } from '../composition';
import { FUEL_SPECIES } from '../../reactivity';
import type { MagneticConfig, SimEvent } from '../../types';
import { runAllYielding } from '../../../testing/yielding';
import { flatTopAverages } from '../../analysis/flatTop';
import { advanceRandomly, expectSameRun, normalizeRng, referenceRun, rewindAt, runChunked, tick } from '../../kernel/testkit';
import { ProfileModel } from '../model';
import { faceValue } from '../geometry1d';
import { rhoOfQ } from '../mhd';
import { DisruptionEvents } from '../events/disruption';
import { ElmEvents } from '../events/elm';
import { SawtoothEvents } from '../events/sawtooth';
import { StateLayout, N_SCALARS } from '../state';
import { DensitySolver } from '../fvsolver';
import { edgeDeposition, volumeIntegral } from '../sources/deposition';
import { impurityMode, impuritySpecies, impurityStateSize } from './config';
import { facitCoefficients } from './facit';
import { EDGE_LAMBDA, ImpurityModel, M_MAX, NEO_REFRESH } from './model';

const withImpurities = (cfg: MagneticConfig, profiles: NonNullable<MagneticConfig['profiles']>, tEnd?: number): MagneticConfig =>
  ({ ...cfg, ...(tEnd ? { t_end: tEnd } : {}), profiles: { ...(cfg.profiles ?? {}), ...profiles } });

/** A model on the initial state (work arrays evaluated) with the module on; the electron D and v of the work arrays replaced by an analytic pair when asked */
function harness(profiles: NonNullable<MagneticConfig['profiles']>, cfg: MagneticConfig = ITER_15D) {
  const m = new ProfileModel(withImpurities(cfg, profiles, 10));
  const y = m.initialState();
  m.diagnostics(0, y);
  const ctx = m.ctx, g = ctx.tg, N = ctx.N;
  const imp = ctx.impurity as ImpurityModel;
  const st = ctx.view(y);
  /** D(rho) = 0.3 + 0.5 rho^2 and v = -a rho D g1/<|grad rho|>: the zero-flux profile of the solver is exp(a (1 - rho^2)/2) n_sep */
  const analytic = (a: number) => {
    for (let f = 0; f <= N; f++) {
      ctx.w.D[f] = 0.3 + 0.5 * g.rhoF[f] ** 2;
      ctx.w.v[f] = f === 0 ? 0 : -a * g.rhoF[f] * ctx.w.D[f] * g.g1F[f] / g.gradRhoF[f];
    }
  };
  return { m, y, ctx, g, N, imp, st, analytic };
}

describe('species and state layout', () => {
  it('legacy mode has no species and leaves the layout of the state as it was', () => {
    expect(impurityMode({})).toBe('legacy');
    expect(impuritySpecies(ITER_15D, {})).toEqual([]);
    expect(impurityStateSize(ITER_15D, {}, 50)).toBe(0);
    expect(new StateLayout(50).size).toBe(4 * 50 + N_SCALARS);
    const m = new ProfileModel(ITER_15D);
    expect(m.ctx.impurity).toBeNull();
    expect(m.nState).toBe(4 * 50 + N_SCALARS);
    expect(m.ctx.view(m.initialState()).s.imp.length).toBe(0);
  });

  it('a profile-resolved mode carries helium, the intrinsic impurity, the seeded one and an optional third species, one block of N cells each', () => {
    const sp = impuritySpecies(ITER_15D, { impurityTransport: 'facit', impurityExtraSpecies: 'Ne' });
    expect(sp.map((s) => `${s.role}:${s.species}:${s.index}`)).toEqual(['he:He:0', 'intrinsic:Be:1', 'seed:Ar:2', 'extra:Ne:3']);
    expect(impurityStateSize(ITER_15D, { impurityTransport: 'anomalous' }, 50)).toBe(3 * 50);
    // JET has no seeded species; a seed species without a concentration is not a species either
    expect(impuritySpecies(JET_15D, { impurityTransport: 'anomalous' }).map((s) => s.species)).toEqual(['He', 'Be']);
    const noConc = { ...ITER_15D, impurity: { ...ITER_15D.impurity, seedConcentration: 0 } };
    expect(impuritySpecies(noConc, { impurityTransport: 'anomalous' }).map((s) => s.species)).toEqual(['He', 'Be']);
    const m = new ProfileModel(withImpurities(ITER_15D, { impurityTransport: 'facit', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 }));
    expect(m.nState).toBe(4 * m.N + N_SCALARS + 4 * m.N);
    const y = m.initialState();
    const s = m.ctx.view(y).s;
    expect(s.imp.length).toBe(4 * m.N);
    expect(s.raw.length).toBe(N_SCALARS);
    const L = new StateLayout(3, 6);
    const v = L.view(new Float64Array(L.size).map((_, i) => i));
    expect(Array.from(v.s.imp)).toEqual([4 * 3 + N_SCALARS, 4 * 3 + N_SCALARS + 1, 4 * 3 + N_SCALARS + 2, 4 * 3 + N_SCALARS + 3, 4 * 3 + N_SCALARS + 4, 4 * 3 + N_SCALARS + 5]);
  });

  it('the initial state has no helium and each impurity at its configured concentration times n_e', () => {
    const { ctx, imp, st } = harness({ impurityTransport: 'anomalous' });
    expect(volumeIntegral(ctx.tg, imp.block(st.s, 0))).toBe(0);
    for (let i = 0; i < ctx.N; i += 7) {
      expect(imp.block(st.s, 1)[i] / st.ne[i]).toBeCloseTo(ITER_15D.impurity.concentration, 12);
      expect(imp.block(st.s, 2)[i] / st.ne[i]).toBeCloseTo(ITER_15D.impurity.seedConcentration!, 12);
    }
  });
});

describe('the exponentially fitted particle solver on the impurity blocks', () => {
  // v = -a rho D g1/<|grad rho|> makes the source-free steady profile of the solver n_sep exp(a (1 - rho^2)/2): exp of the integral of v/D
  it.each([[0, 'uniform grid', 1e-4], [4, 'edge-packed grid', 1e-4]])('the steady profile is exp(integral of v/D) to 1e-4 (gridPacking %i: %s)', (packing, _name, tol) => {
    const { ctx, g, N, imp, st, analytic } = harness({ impurityTransport: 'anomalous', impuritySetpoint: 'separatrix', gridPacking: packing });
    analytic(1.0);
    for (let it = 0; it < 4; it++) imp.accepted(ctx, it * 1e4, 1e4, st, st);
    const k = imp.species.find((s) => s.role === 'intrinsic')!.index;
    const b = imp.block(st.s, k);
    const nB = imp.edgeConcentration(k) * ctx.bc.n;
    let worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(b[i] / (nB * Math.exp((1.0 * (1 - g.rhoC[i] ** 2)) / 2)) - 1));
    expect(worst).toBeLessThan(tol);
  });

  it('with FACIT the steady profile follows exp(integral of <|grad rho|> v / (g1 D)) of the coefficients the module used', () => {
    const { ctx, g, N, imp, st } = harness({ impurityTransport: 'facit', impuritySetpoint: 'separatrix' });
    for (let it = 0; it < 4; it++) imp.accepted(ctx, it * 1e4, 1e4, st, st);
    for (const k of [1, 2]) {
      const b = imp.block(st.s, k), D = imp.Dface[k], v = imp.vface[k];
      const F = (j: number) => (g.gradRhoF[j] * v[j]) / (g.g1F[j] * D[j]);
      const lnB = Math.log(imp.edgeConcentration(k) * ctx.bc.n);
      // ln n(rho) = ln n_B - integral from rho to 1 of F, the trapezoid rule on the faces (F linear between them)
      let I = 0, worst = 0;
      for (let i = N - 1; i >= 0; i--) {
        const fc = F(i) + ((F(i + 1) - F(i)) * (g.rhoC[i] - g.rhoF[i])) / (g.rhoF[i + 1] - g.rhoF[i]);
        worst = Math.max(worst, Math.abs(Math.exp(lnB - (I + 0.5 * (fc + F(i + 1)) * (g.rhoF[i + 1] - g.rhoC[i]))) / b[i] - 1));
        I += 0.5 * (F(i) + F(i + 1)) * (g.rhoF[i + 1] - g.rhoF[i]);
      }
      expect(worst, `species ${k}`).toBeLessThan(0.02);
    }
  });
});

describe('helium: source, exhaust and particle balance', () => {
  /** the ash of a D-T plasma of 500 MW: one He per 17.59 MeV, 1.77e20 /s, distributed like (1 - rho^2)^2 */
  const GAMMA = 1.77e20;
  function withAsh(h: ReturnType<typeof harness>) {
    const shape = Float64Array.from(h.g.rhoC, (r) => (1 - r * r) ** 2);
    const norm = volumeIntegral(h.g, shape);
    for (let i = 0; i < h.N; i++) h.ctx.w.ash[i] = (GAMMA * shape[i]) / norm;
    h.ctx.lastDiag.tauE = 2.0; // tau_He* = 5 tau_E = 10 s
  }

  it('the content follows dN/dt = Gamma_ash - N / tau_He* of the scalar model (backward Euler, exact recursion) and settles at N = tau_He* Gamma', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); withAsh(h);
    const tau = 10, dt = 0.5;
    let t = 0;
    for (let n = 1; n <= 400; n++) {
      h.imp.accepted(h.ctx, t, dt, h.st, h.st); t += dt;
      const bal = h.imp.heliumBalance(h.st);
      if (n <= 40 || n === 400) expect(bal.N / (tau * GAMMA)).toBeCloseTo(1 - Math.pow(1 + dt / tau, -n), 9);
      expect((bal.N + bal.pumped + bal.inTransit - bal.remap) / bal.ash - 1).toBeCloseTo(0, 11);
    }
    expect(h.imp.heliumBalance(h.st).N / (tau * GAMMA)).toBeCloseTo(1, 4);
    // the diagnostics: fHe and tau_He* (= N/Gamma_ash) with the exhaust time constant of the configuration (5 tau_E)
    const d: Record<string, number> = {};
    h.imp.diagnostics(h.st, d);
    expect(d.tauHeStar).toBeCloseTo(10, 3);
    expect(d.fHe).toBeCloseTo(h.imp.heliumBalance(h.st).N / volumeIntegral(h.g, h.st.ne), 12);
    expect(d.fHe0).toBeGreaterThan(d.fHe); // peaked: the ash is born in the core and the edge is the sink
  });

  it('a plasma that confines helium longer than tau_He* recycles nothing and keeps all of it (the exhaust is a lower bound of the confinement, not a source)', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    for (let f = 0; f <= h.N; f++) { h.ctx.w.D[f] = 1e-5; h.ctx.w.v[f] = 0; }
    withAsh(h);
    for (let n = 0; n < 20; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const bal = h.imp.heliumBalance(h.st);
    expect(bal.N / bal.ash).toBeGreaterThan(0.999); // almost nothing left through the separatrix
    expect((bal.N + bal.pumped + bal.inTransit - bal.remap) / bal.ash - 1).toBeCloseTo(0, 11);
  });

  it('ITER numbers: N_He = tau_He* Gamma_ash, i.e. f_He = 4.3 % for 500 MW (1.77e20 /s), tau_He*/tau_E = 5, tau_E = 3.7 s (IPB98(y,2)) and n-bar = 1e20 m^-3', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); withAsh(h);
    h.ctx.lastDiag.tauE = 3.7;
    const scale = 1.0e20 / h.ctx.lineAvg(h.st.ne); // the flat-top density (the initial state is the 30 % start-up density)
    for (let i = 0; i < h.N; i++) h.st.ne[i] *= scale;
    for (let n = 0; n < 500; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const d: Record<string, number> = {};
    h.imp.diagnostics(h.st, d);
    expect(d.tauHeStar / 3.7).toBeCloseTo(5, 3);
    expect(d.fHe).toBeCloseTo((GAMMA * 5 * 3.7) / volumeIntegral(h.g, h.st.ne), 4);
    expect(d.fHe).toBeGreaterThan(0.04);
    expect(d.fHe).toBeLessThan(0.05);
  });

  it('an ELM expels helium like electrons, and what it expels is booked as outflux of the next step (recycled except the pumped share)', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); withAsh(h);
    for (let n = 0; n < 60; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const b = h.imp.block(h.st.s, 0);
    const before = Float64Array.from(b), N0 = volumeIntegral(h.g, b);
    const rhoPed = 0.94, fN = 0.17;
    h.imp.elmCrash(h.st, rhoPed, fN, 0.15);
    let removed = 0;
    for (let i = 0; i < h.N; i++) {
      const r = h.g.rhoC[i];
      const wgt = r < rhoPed - 0.15 ? 0 : r >= rhoPed ? 1 : (r - (rhoPed - 0.15)) / 0.15;
      expect(b[i]).toBe(before[i] * (1 - fN * wgt)); // the separatrix value of helium is 0: the excess is the whole density
      removed += (before[i] - b[i]) * h.g.dV[i];
    }
    expect(removed).toBeGreaterThan(0.01 * N0);
    expect(h.imp.heliumBalance(h.st).inTransit).toBeCloseTo(removed, 6);
    const bal0 = h.imp.heliumBalance(h.st);
    expect((bal0.N + bal0.pumped + bal0.inTransit - bal0.remap) / bal0.ash - 1).toBeCloseTo(0, 11);
    h.imp.accepted(h.ctx, 30, 0.5, h.st, h.st);
    const bal1 = h.imp.heliumBalance(h.st);
    expect(bal1.inTransit).toBe(0);
    expect((bal1.N + bal1.pumped - bal1.remap) / bal1.ash - 1).toBeCloseTo(0, 11);
  });
});

describe('impurities: boundary, set-point, wall source and particle balance', () => {
  const balance = (imp: ImpurityModel, h: ReturnType<typeof harness>, k: number) =>
    (volumeIntegral(h.ctx.tg, imp.block(h.st.s, k)) - imp.N0[k] - imp.Nsrc[k] + imp.Nout[k] - imp.Nremap[k]) / Math.max(volumeIntegral(h.ctx.tg, imp.block(h.st.s, k)), 1);

  it('N_z = N_z(0) + injected - lost holds to round-off for every species, with a tungsten wall source', () => {
    const cfg = { ...ITER_15D, impurity: { ...ITER_15D.impurity, species: 'W' as const, concentration: 2e-5, W_source_frac: 0.4 } };
    const h = harness({ impurityTransport: 'facit', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 }, cfg);
    h.ctx.PSOL = 100e6;
    for (let n = 0; n < 80; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    for (let k = 0; k < h.imp.nSp; k++) expect(Math.abs(balance(h.imp, h, k)), `species ${k}`).toBeLessThan(1e-11);
    const kW = h.imp.species.find((s) => s.role === 'intrinsic')!.index;
    const SW = (0.4 * 100e6) / (5000 * 1.602176634e-16);
    expect(h.imp.Nsrc[kW] / (80 * 0.5) / SW).toBeCloseTo(1, 12); // the wall source S_W = W_source_frac P_SOL / 5 MeV of the scalar model, per second
    const d: Record<string, number> = {};
    h.imp.diagnostics(h.st, d);
    expect((d.S_W * 1e20) / SW).toBeCloseTo(1, 12);
  });

  it('the concentration set-point is the volume average: a screening transport raises the separatrix value until N_z/N_e is the set-point, within the bound', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(-2.0); // outward convection: the plasma screens the impurities from the boundary value
    h.ctx.lastDiag.tauE = 2.0;
    const kZ = 1, cSet = ITER_15D.impurity.concentration;
    const d: Record<string, number> = {};
    for (let n = 0; n < 500; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    h.imp.diagnostics(h.st, d);
    expect(d.cZ / cSet).toBeCloseTo(1, 2);
    expect(h.imp.edgeConcentration(kZ) / cSet).toBeGreaterThan(1.5);
    expect(d.mZ).toBeGreaterThan(1.5);
    expect(d.cZ0).toBeLessThan(d.cZ); // hollow: screened
    // an impossible request (a convection that keeps everything out) saturates the multiplier at M_MAX
    const h2 = harness({ impurityTransport: 'anomalous' });
    h2.analytic(-40);
    h2.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 600; n++) h2.imp.accepted(h2.ctx, n * 0.5, 0.5, h2.st, h2.st);
    expect(h2.imp.edgeConcentration(kZ) / cSet).toBeCloseTo(M_MAX, 6);
  });

  it("with the 'separatrix' set-point the configured value is the boundary value and nothing is regulated", () => {
    const h = harness({ impurityTransport: 'anomalous', impuritySetpoint: 'separatrix' });
    h.analytic(-2.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 100; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    expect(h.imp.edgeConcentration(1)).toBe(ITER_15D.impurity.concentration);
    expect(h.imp.edgeConcentration(2)).toBe(ITER_15D.impurity.seedConcentration);
    const d: Record<string, number> = {};
    h.imp.diagnostics(h.st, d);
    expect(d.cZ / ITER_15D.impurity.concentration).toBeLessThan(0.6);
  });

  it('the live control cZ moves the set-point (the radiative-collapse slider of the interface)', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 1.0;
    h.m.applyControl({ cZ: 0.04 });
    for (let n = 0; n < 400; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const d: Record<string, number> = {};
    h.imp.diagnostics(h.st, d);
    expect(d.cZ).toBeGreaterThan(0.035);
    expect(d.cZ).toBeLessThan(0.045);
  });

  it('a sawtooth crash mixes every species inside rho_mix conserving its particles and leaves the outside alone', () => {
    const h = harness({ impurityTransport: 'anomalous', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 40; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const rho1 = 0.3, rhoMix = 0.5;
    for (let k = 0; k < h.imp.nSp; k++) {
      const b = h.imp.block(h.st.s, k), before = Float64Array.from(b), N0 = volumeIntegral(h.g, b);
      h.imp.sawtoothCrash(h.st, rho1, rhoMix);
      expect(volumeIntegral(h.g, b) / N0).toBeCloseTo(1, 12);
      for (let i = 0; i < h.N; i++) if (h.g.rhoC[i] > rhoMix + 0.05) expect(b[i]).toBe(before[i]);
      // flat inside rho_1
      const inside = Array.from(b).filter((_, i) => h.g.rhoC[i] < rho1);
      expect(Math.max(...inside) / Math.min(...inside)).toBeCloseTo(1, 12);
    }
  });

  it('an ELM crash expels an impurity by the fraction of its excess over the separatrix value that it takes from n_e, and books it as lost', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 40; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const k = 1, b = h.imp.block(h.st.s, k), before = Float64Array.from(b), nB = h.imp.edgeConcentration(k) * h.ctx.bc.n;
    const out0 = h.imp.Nout[k];
    h.imp.elmCrash(h.st, 0.94, 0.2, 0.15);
    for (let i = 0; i < h.N; i++) {
      const r = h.g.rhoC[i];
      const wgt = r < 0.79 ? 0 : r >= 0.94 ? 1 : (r - 0.79) / 0.15;
      const want = before[i] > nB ? nB + (before[i] - nB) * (1 - 0.2 * wgt) : before[i];
      expect(b[i] / want).toBeCloseTo(1, 12);
    }
    expect((h.imp.Nout[k] - out0) / (volumeIntegral(h.g, before) - volumeIntegral(h.g, b))).toBeCloseTo(1, 12);
    expect(Math.abs(balance(h.imp, h, k))).toBeLessThan(1e-11);
  });

  it('a new equilibrium changes the content with the cell volumes; the module books the change at its next step and the balance still closes', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 10; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const tg = h.ctx.tg;
    const dV = Float64Array.from(tg.dV, (x, i) => x * (1 + 0.01 * Math.sin(i))); // a few per cent per cell, the total volume nearly fixed
    h.ctx.adoptGeometry({ eq: h.ctx.eq, tg: { ...tg, dV } });
    expect(h.imp.Nremap[1]).toBe(0);
    const b1 = h.imp.block(h.st.s, 1);
    let want = 0;
    for (let i = 0; i < h.N; i++) want += b1[i] * (dV[i] - tg.dV[i]);
    h.imp.accepted(h.ctx, 5, 0.5, h.st, h.st);
    expect(h.imp.Nremap[1] / want).toBeCloseTo(1, 12); // booked with the densities the adoption met (before the advance)
    expect(Math.abs(want) / h.imp.N0[1]).toBeGreaterThan(1e-6);
    for (let k = 0; k < 3; k++) expect(Math.abs(balance(h.imp, h, k))).toBeLessThan(1e-11);
    const bal = h.imp.heliumBalance(h.st);
    expect((bal.N + bal.pumped + bal.inTransit - bal.remap) / bal.ash - 1).toBeCloseTo(0, 11);
  });

  it('an ELM right after an equilibrium adoption books the volume change first: the balance closes with the crash on the new volumes', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 40; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const tg = h.ctx.tg;
    const dV = Float64Array.from(tg.dV, (x, i) => x * (1 + 0.02 * Math.cos(0.7 * i)));
    h.ctx.adoptGeometry({ eq: h.ctx.eq, tg: { ...tg, dV } });
    h.imp.elmCrash(h.st, 0.94, 0.3, 0.15);
    for (let k = 0; k < 3; k++) expect(Math.abs(balance(h.imp, h, k)), `after the crash, species ${k}`).toBeLessThan(1e-11);
    expect(Math.abs(h.imp.Nremap[1])).toBeGreaterThan(0);
    h.imp.accepted(h.ctx, 20, 0.5, h.st, h.st);
    for (let k = 0; k < 3; k++) expect(Math.abs(balance(h.imp, h, k)), `after the next step, species ${k}`).toBeLessThan(1e-11);
  });

  it('the wall source adds its steady inventory (S_W times the confinement time of the transport) to the set-point, with no x 4 without ELMs and sawteeth', () => {
    const wCfg = (ev: { elms: boolean; sawteeth: boolean }) => ({
      ...ITER_15D, events: { ...ITER_15D.events, ...ev },
      impurity: { ...ITER_15D.impurity, species: 'W' as const, concentration: 2e-5, W_source_frac: 1, seedSpecies: undefined, seedConcentration: undefined },
    });
    const run = (cfg: MagneticConfig) => {
      const h = harness({ impurityTransport: 'anomalous' }, cfg);
      h.analytic(6.0); h.ctx.lastDiag.tauE = 2.0; h.ctx.PSOL = 150e6; // an inward pinch: the heavy impurity keeps what the wall gives
      for (let n = 0; n < 400; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
      const d: Record<string, number> = {};
      h.imp.diagnostics(h.st, d);
      return { h, d };
    };
    const on = run(wCfg({ elms: true, sawteeth: true }));
    // the steady content of the source with the coefficients the module used: an independent solve of the same operator
    const { h } = on, kW = 1, SW = (1 * 150e6) / (5000 * 1.602176634e-16);
    const S = edgeDeposition(h.ctx.tg, EDGE_LAMBDA).map((x) => SW * x); // per volume: integrates to S_W
    expect(volumeIntegral(h.ctx.tg, S) / SW).toBeCloseTo(1, 12);
    const u = new Float64Array(h.N);
    new DensitySolver(h.ctx.tg).solve({ dt: 1e9, n0: new Float64Array(h.N), D: h.imp.Dface[kW], v: h.imp.vface[kW], S, nB: 0 }, u);
    const cWall = volumeIntegral(h.ctx.tg, u) / volumeIntegral(h.ctx.tg, h.st.ne);
    expect(cWall).toBeGreaterThan(10 * 2e-5); // the wall source dominates the design concentration in this case
    expect(on.d.cZ / (2e-5 + cWall)).toBeGreaterThan(0.97);
    expect(on.d.cZ / (2e-5 + cWall)).toBeLessThan(1.03);
    // the crashes are in the profiles, not in a factor: the set-point does not read the switches of the events
    const off = run(wCfg({ elms: false, sawteeth: false }));
    expect(off.d.cZ).toBe(on.d.cZ);
    expect(off.d.mZ).toBe(on.d.mZ);
  });

  it('a disruption quench takes every species out with the electrons and books the loss', () => {
    const h = harness({ impurityTransport: 'anomalous' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 20; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const c0 = Array.from({ length: 3 }, (_, k) => volumeIntegral(h.g, h.imp.block(h.st.s, k)));
    h.imp.quench(h.st, 0.5);
    for (let k = 0; k < 3; k++) {
      expect(volumeIntegral(h.g, h.imp.block(h.st.s, k)) / c0[k]).toBeCloseTo(0.5, 12);
      expect(Math.abs(balance(h.imp, h, k))).toBeLessThan(1e-11);
    }
  });
});

describe('composition: quasi-neutrality, Z_eff and what it feeds', () => {
  it('the fuel ions follow from n_e minus the charge of helium and of the impurities at their coronal mean charge; Z_eff and the ion sum are the sums of the species', () => {
    const h = harness({ impurityTransport: 'anomalous', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 });
    // a state with helium, and each impurity at its own profile
    for (let i = 0; i < h.N; i++) {
      h.imp.block(h.st.s, 0)[i] = 0.03 * h.st.ne[i] * (1 - 0.5 * h.g.rhoC[i] ** 2);
      h.imp.block(h.st.s, 3)[i] = 2e-3 * h.st.ne[i];
    }
    composition(h.ctx, h.st.Te, h.st.ne, h.st.s);
    const w = h.ctx.w, fs = FUEL_SPECIES[ITER_15D.fuel];
    for (let i = 0; i < h.N; i += 3) {
      const T = Math.max(h.st.Te[i], 0.1), n = h.st.ne[i];
      const ZBe = meanCharge('Be', T), ZAr = meanCharge('Ar', T), ZNe = meanCharge('Ne', T);
      const nHe = h.imp.block(h.st.s, 0)[i], nBe = h.imp.block(h.st.s, 1)[i], nAr = h.imp.block(h.st.s, 2)[i], nNe = h.imp.block(h.st.s, 3)[i];
      // quasi-neutrality: sum Z_j n_j = n_e
      const charge = fs.a.Z * w.na[i] + fs.b.Z * w.nb[i] + 2 * nHe + ZBe * nBe + ZAr * nAr + ZNe * nNe;
      expect(charge / n).toBeCloseTo(1, 12);
      const Zeff = (fs.a.Z ** 2 * w.na[i] + fs.b.Z ** 2 * w.nb[i] + 4 * nHe + ZBe ** 2 * nBe + ZAr ** 2 * nAr + ZNe ** 2 * nNe) / n;
      expect(w.Zeff[i]).toBeCloseTo(Zeff, 12);
      expect(w.ni[i] / (w.na[i] + w.nb[i] + nHe + nBe + nAr + nNe)).toBeCloseTo(1, 12);
      expect(w.nHe[i]).toBe(nHe); expect(w.nZ[i]).toBe(nBe); expect(w.ns[i]).toBe(nAr);
    }
  });

  it('helium raises Z_eff(rho) where it sits and the conductivity and bootstrap coefficients see it (they read w.Zeff)', () => {
    const a = harness({ impurityTransport: 'anomalous' }), b = harness({ impurityTransport: 'anomalous' });
    for (let i = 0; i < b.N; i++) b.imp.block(b.st.s, 0)[i] = 0.05 * b.st.ne[i] * (1 - b.g.rhoC[i]);
    a.m.physics.evaluateWorkArrays(0, a.st);
    b.m.physics.evaluateWorkArrays(0, b.st);
    for (let i = 0; i < a.N - 2; i += 4) {
      expect(b.ctx.w.Zeff[i]).toBeGreaterThan(a.ctx.w.Zeff[i]);
      expect(b.ctx.w.sigma[i]).toBeLessThan(a.ctx.w.sigma[i]); // Spitzer/Sauter: sigma falls with Z_eff
      expect(b.ctx.sauter[i].L31).not.toBe(a.ctx.sauter[i].L31);
    }
  });

  it('the line radiation of the third species is n_e n_Z L_Z(T_e) (Mavrin) in every cell, added to the radiation of the other two', () => {
    const a = harness({ impurityTransport: 'anomalous' });
    const b = harness({ impurityTransport: 'anomalous', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 2e-3 });
    a.m.physics.evaluateWorkArrays(0, a.st); b.m.physics.evaluateWorkArrays(0, b.st);
    for (let i = 0; i < a.N; i += 3) {
      const extra = b.st.ne[i] * b.imp.block(b.st.s, 3)[i] * coolingRate('Ne', Math.max(b.st.Te[i], 0.01));
      expect((b.ctx.w.Pline[i] - a.ctx.w.Pline[i]) / extra).toBeCloseTo(1, 9);
      // the total is the sum of its parts (bremsstrahlung with the main-ion Z_eff of the diluted fuel, synchrotron)
      expect(b.ctx.w.Prad[i] / (b.ctx.w.Pbr[i] + b.ctx.w.Pline[i] + b.ctx.w.Psync[i])).toBeCloseTo(1, 12);
    }
  });
});

describe('the neoclassical convection is what FACIT says about the state (wiring guard, no anomalous transport)', () => {
  // With no anomalous transport (D_z = 1e-6 D_e: the solver has no flux at D <= 0, so not 0; v_z = 0) the zero-flux exponent of a face is
  //   Pe = <|grad rho|> v dist / (g1 D) = (K dln n_i + H dln T_i) / D = (Z/Z_i) dln n_i + (H/D) dln T_i     (K = (Z/Z_i) D in every part),
  // between the two cell centres of the face: the mapping (g1/<|grad rho|>) d/drho of the derivative cancels, a wrong one does not. The expected value
  // is built here from facitCoefficients and the state (T_e, T_i, n_a + n_b, Z_eff, q, the radii of the surface), not from transport.ts.
  const RATIO_D = 1e-6;
  const nSp = (h: ReturnType<typeof harness>) => h.imp.species.length;

  function setup() {
    const h = harness({ impurityTransport: 'facit', impuritySetpoint: 'separatrix', impurityDoverDe: RATIO_D, impurityPinchOverPe: 0, impurityExtraSpecies: 'W', impurityExtraConcentration: 1e-6 });
    h.ctx.lastDiag.tauE = 2.0;
    const before = Array.from({ length: nSp(h) }, (_, k) => Float64Array.from(h.imp.block(h.st.s, k)));
    h.imp.accepted(h.ctx, 0, 0.01, h.st, h.st); // the first step builds the table from the densities of the state it met (`before`)
    return { ...h, before };
  }

  /** FACIT at the inner face f for species k, with the impurity density of the state the table was built from */
  function facitAt(h: ReturnType<typeof setup>, k: number, f: number) {
    const { ctx, g, st } = h, w = ctx.w, fs = FUEL_SPECIES[ctx.cfg.fuel], sp = h.imp.species[k];
    const a = st.s.fA, b = 1 - a;
    const Te = faceValue(g, st.Te, f), Ti = faceValue(g, st.Ti, f);
    return facitCoefficients({
      Zimp: Math.max(meanCharge(sp.species, Math.max(Te, 0.1)), 1), Aimp: sp.A,
      Zi: (a * fs.a.Z ** 2 + b * fs.b.Z ** 2) / (a * fs.a.Z + b * fs.b.Z), Ai: a * fs.a.A + b * fs.b.A,
      Ti_eV: Ti * 1e3, Ni: faceValue(g, w.na, f) + faceValue(g, w.nb, f), Nimp: faceValue(g, h.before[k], f), Zeff: faceValue(g, w.Zeff, f),
      TeOverTi: Te / Ti, eps: (g.RoutF[f] - g.RinF[f]) / (g.RoutF[f] + g.RinF[f]), q: w.qF[f], R0: g.R0, B0: g.B0,
    });
  }

  it('the face coefficients of every species reproduce Pe = (K dln n_i + H dln T_i)/D of FACIT evaluated on the state, He, Be, Ar and W', () => {
    const h = setup(), { ctx, g, st, imp } = h, w = ctx.w;
    for (let k = 0; k < nSp(h); k++) {
      let worst = 0;
      for (let f = 1; f < h.N; f++) {
        const r = facitAt(h, k, f);
        const dlnN = Math.log((w.na[f] + w.nb[f]) / (w.na[f - 1] + w.nb[f - 1])), dlnT = Math.log(st.Ti[f] / st.Ti[f - 1]);
        const want = (r.K * dlnN + r.H * dlnT) / (r.D + RATIO_D * w.D[f]);
        const got = (g.gradRhoF[f] * imp.vface[k][f] * g.distF[f]) / (g.g1F[f] * imp.Dface[k][f]);
        worst = Math.max(worst, Math.abs(got - want) / (1 + Math.abs(want)));
        // the diffusivity is the neoclassical one plus the (tiny) anomalous part
        expect(imp.Dface[k][f] / (r.D + RATIO_D * w.D[f]), `D, species ${k}, face ${f}`).toBeCloseTo(1, 12);
      }
      expect(worst, `species ${imp.species[k].species}`).toBeLessThan(1e-9);
    }
  });

  it('the peaked main-ion density drives every species inward with Z/Z_i times its diffusion, and the ion temperature gradient screens them out: outward, so the net peaking is weaker (He, Be, Ar, W)', () => {
    const h = setup(), { g, st, imp, ctx } = h, w = ctx.w;
    for (let k = 0; k < nSp(h); k++) {
      const sp = imp.species[k].species;
      let peakDensity = 0, total = 0, screening = 0;
      for (let f = 1; f < h.N; f++) {
        const r = facitAt(h, k, f);
        const dlnN = Math.log((w.na[f] + w.nb[f]) / (w.na[f - 1] + w.nb[f - 1])), dlnT = Math.log(st.Ti[f] / st.Ti[f - 1]);
        const Zbar = Math.max(meanCharge(sp, Math.max(faceValue(g, st.Te, f), 0.1)), 1);
        expect(r.K / r.D, `K = Z D / Z_i (Z_i = 1 for D-T), ${sp}, face ${f}`).toBeCloseTo(Zbar, 8);
        // a heavy impurity in the collisional core: H/K -> -1/2 (Hirshman and Sigmar 1981; Wenzel and Sigmar 1990)
        if (sp === 'W' && f >= 5 && f <= 30) { expect(r.H / r.K, `W, face ${f}`).toBeGreaterThan(-0.6); expect(r.H / r.K, `W, face ${f}`).toBeLessThan(-0.4); }
        peakDensity += (r.K * dlnN) / (r.D + RATIO_D * w.D[f]);
        screening += (r.H * dlnT) / (r.D + RATIO_D * w.D[f]);
        total += (g.gradRhoF[f] * imp.vface[k][f] * g.distF[f]) / (g.g1F[f] * imp.Dface[k][f]);
      }
      // sums of the zero-flux exponents Pe over the faces: ln n_z(edge) - ln n_z(axis) of the profile that the coefficients alone would make. n_i falls outward,
      // so the density-driven part is negative (n_z rises to the axis); T_i falls outward and H < 0 almost everywhere, so the screening part is positive
      expect(peakDensity, `${sp}: density-driven exponent`).toBeLessThan(0);
      expect(screening, `${sp}: screening exponent`).toBeGreaterThan(0);
      expect(total / (peakDensity + screening), `${sp}: the coefficients of the module give their sum`).toBeCloseTo(1, 6);
      expect(total, `${sp}: weaker than the density-driven one`).toBeGreaterThan(peakDensity);
      if (sp === 'He' || sp === 'Be') expect(total, `${sp}: the light species stay inward`).toBeLessThan(0);
      // the heavy species are screened out of the steep T_i gradient of this start-up state altogether (Ar +4.9, W +13.3)
      if (sp === 'Ar' || sp === 'W') expect(total, `${sp}: screened out`).toBeGreaterThan(0);
    }
  });
});

describe('the MHD event models reach every species (call sites of elm.ts, sawtooth.ts and disruption.ts)', () => {
  /** A state with peaked profiles of helium, Be, Ar and Ne, from a few steps of the analytic pinch; the events are the real ones */
  function crashHarness() {
    const cfg = { ...ITER_15D, events: { ...ITER_15D.events, ntm: false } };
    const h = harness({ impurityTransport: 'anomalous', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 }, cfg);
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    const shape = Float64Array.from(h.g.rhoC, (r) => (1 - r * r) ** 2), norm = volumeIntegral(h.g, shape);
    for (let i = 0; i < h.N; i++) h.ctx.w.ash[i] = (1.77e20 * shape[i]) / norm;
    for (let n = 0; n < 40; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    return h;
  }
  const blocks = (h: ReturnType<typeof crashHarness>) => Array.from({ length: h.imp.nSp }, (_, k) => Float64Array.from(h.imp.block(h.st.s, k)));

  it('an ELM (ElmEvents.afterStep) takes from every species the fraction of its excess over its own separatrix value that it takes from n_e, and the mirrors of the scalars follow', () => {
    const h = crashHarness(), { ctx, g, st, imp } = h;
    ctx.hmode = true;
    const ne0 = Float64Array.from(st.ne), b0 = blocks(h), ev: SimEvent[] = [];
    new ElmEvents().afterStep(ctx, 5, st, { alpha_ped: 2, tauE: 2 }, ev);
    expect(ev.map((e) => e.kind)).toEqual(['ELM']);
    const rhoPed = 1 - ctx.ps.pedestalWidth;
    let hit = 0;
    for (let i = 0; i < h.N; i++) {
      const fn = 1 - (st.ne[i] - ctx.bc.n) / (ne0[i] - ctx.bc.n); // the fraction of the electron excess the crash took at this cell
      if (g.rhoC[i] < rhoPed - 0.15) { // outside the crash region nothing moves
        expect(st.ne[i]).toBe(ne0[i]);
        for (let k = 0; k < imp.nSp; k++) expect(imp.block(st.s, k)[i]).toBe(b0[k][i]);
        continue;
      }
      if (fn > 1e-3) hit++;
      for (let k = 0; k < imp.nSp; k++) {
        const nB = imp.edgeConcentration(k) * ctx.bc.n, was = b0[k][i], now = imp.block(st.s, k)[i];
        expect(was, `species ${k}, cell ${i}: above its separatrix value`).toBeGreaterThan(nB);
        expect((was - now) / (was - nB), `species ${k}, cell ${i}`).toBeCloseTo(fn, 10);
      }
    }
    expect(hit).toBeGreaterThan(3);
    expect(hit).toBeLessThan(h.N / 2);
    // the scalars are the inventories of the profiles (not the legacy `x (1 - 0.1 f_W)` of the scalar model)
    expect(st.s.NHe).toBe(volumeIntegral(g, imp.block(st.s, 0)));
    expect(st.s.cZ / (volumeIntegral(g, imp.block(st.s, 1)) / volumeIntegral(g, st.ne))).toBeCloseTo(1, 12);
    expect(imp.heliumBalance(st).inTransit).toBeGreaterThan(0); // the helium the ELM expelled waits to be exhausted by the next advance
  });

  it('a sawtooth crash (SawtoothEvents.afterStep) flattens every species inside rho_1 like n_e, over the same region, conserving the particles', () => {
    const h = crashHarness(), { ctx, g, st, imp, N } = h;
    for (let f = 0; f <= N; f++) ctx.w.qF[f] = 0.8 + 2.0 * g.rhoF[f] ** 2; // q = 1 at rho = 0.32, q0 = 0.8: a sheared core
    const r1 = rhoOfQ(g, ctx.w.qF, 1);
    expect(r1).toBeGreaterThan(0.25);
    const ne0 = Float64Array.from(st.ne), b0 = blocks(h), ev: SimEvent[] = [];
    new SawtoothEvents().afterStep(ctx, 5, st, {}, ev);
    expect(ev.map((e) => e.kind)).toEqual(['sawtooth']);
    const moved = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a, (x, i) => Math.abs(x - b[i]) > 1e-12 * Math.abs(x));
    const region = moved(ne0, st.ne);
    expect(region.filter(Boolean).length).toBeGreaterThan(3);
    for (let k = 0; k < imp.nSp; k++) {
      const b = imp.block(st.s, k), inside = Array.from(b).filter((_, i) => g.rhoC[i] < r1), was = b0[k].filter((_, i) => g.rhoC[i] < r1);
      expect(Math.max(...was) / Math.min(...was), `species ${k} was peaked`).toBeGreaterThan(1.02);
      expect(Math.max(...inside) / Math.min(...inside), `species ${k} is flat inside rho_1`).toBeCloseTo(1, 12);
      expect(volumeIntegral(g, b) / volumeIntegral(g, b0[k]), `species ${k}: particles`).toBeCloseTo(1, 12);
      expect(moved(b0[k], b), `species ${k}: the mixing region of n_e`).toEqual(region);
    }
  });

  it('a quench step (DisruptionEvents.quenchStep) takes every species out with the electrons, by the same factor in every cell, and books the loss', () => {
    const h = crashHarness(), { ctx, g, st, imp } = h;
    ctx.phase = 'thermal_quench';
    ctx.disruption = { cause: 'density_limit', t: 4, W: 3e8, Ip: 15e6, text: 'test' };
    const ne0 = Float64Array.from(st.ne), b0 = blocks(h), out0 = Float64Array.from(imp.Nout);
    const t1 = new DisruptionEvents().quenchStep(ctx, 5, h.y, 6);
    const f = Math.exp(-(t1 - 5) / 0.05);
    expect(f).toBeLessThan(0.995); // one step of the quench: a fraction of a per cent of the electrons
    for (let i = 0; i < h.N; i++) {
      expect(st.ne[i] / ne0[i]).toBeCloseTo(f, 12);
      for (let k = 0; k < imp.nSp; k++) expect(imp.block(st.s, k)[i] / b0[k][i], `species ${k}, cell ${i}`).toBeCloseTo(f, 12);
    }
    for (let k = 0; k < imp.nSp; k++) expect((imp.Nout[k] - out0[k]) / (volumeIntegral(g, b0[k]) * (1 - f)), `species ${k}: loss booked`).toBeCloseTo(1, 9); // (the running total Nout is about 1e2 times the step's loss)
    expect(st.s.NHe).toBe(volumeIntegral(g, imp.block(st.s, 0)));
  });
});

describe('FACIT table, checkpoint', () => {
  it('a checkpoint between geometry adoption and the next impurity call keeps the pending particle-balance booking', () => {
    const h = harness({ impurityTransport: 'facit' });
    h.analytic(1.0); h.ctx.lastDiag.tauE = 2.0;
    for (let n = 0; n < 10; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const old = h.ctx.tg;
    const dV = Float64Array.from(old.dV, (x, i) => x * (1 + 0.02 * Math.sin(i)));
    h.ctx.adoptGeometry({ eq: h.ctx.eq, tg: { ...old, dV } });
    const before = Float64Array.from(h.y);
    const rec: Record<string, number> = {}, aux: Record<string, unknown> = {};
    h.imp.save(rec, aux);
    expect(Object.keys(rec).every((key) => key.startsWith('impurity_'))).toBe(true);
    expect(Object.keys(aux).every((key) => key.startsWith('impurity_'))).toBe(true);
    h.imp.accepted(h.ctx, 5, 0.5, h.st, h.st);
    h.y.set(before);
    h.imp.restore(rec, aux);
    expect(h.imp.Nremap[1]).toBe(0);
    const b = h.imp.block(h.st.s, 1);
    let pending = 0;
    for (let i = 0; i < h.N; i++) pending += b[i] * (dV[i] - old.dV[i]);
    expect(Math.abs(pending) / h.imp.N0[1]).toBeGreaterThan(1e-6);
    h.imp.accepted(h.ctx, 5, 0.5, h.st, h.st);
    expect(h.imp.Nremap[1] / pending).toBeCloseTo(1, 12);
  });

  it('the FACIT table is refreshed every NEO_REFRESH seconds of plasma time, not every step, and is what the convection is formed from', () => {
    const h = harness({ impurityTransport: 'facit' });
    h.ctx.lastDiag.tauE = 2.0;
    expect(h.imp.lastNeoRefresh).toBeLessThan(-1e8);
    h.imp.accepted(h.ctx, 0, 0.05, h.st, h.st);
    expect(h.imp.lastNeoRefresh).toBe(0.05);
    const D1 = Float64Array.from(h.imp.Dface[1]);
    // steps that end before the next refresh keep the table: the coefficients change only through the electron D and v (unchanged here)
    for (let n = 1; n < 4; n++) h.imp.accepted(h.ctx, n * 0.05, 0.05, h.st, h.st);
    expect(h.imp.lastNeoRefresh).toBe(0.05);
    expect(Array.from(h.imp.Dface[1])).toEqual(Array.from(D1));
    h.imp.accepted(h.ctx, 0.2, 0.06, h.st, h.st); // ends at 0.26: only 0.21 s after the last refresh
    expect(h.imp.lastNeoRefresh).toBe(0.05);
    h.imp.accepted(h.ctx, 0.26, 0.05, h.st, h.st); // ends at 0.31: 0.26 s >= NEO_REFRESH
    expect(h.imp.lastNeoRefresh).toBeCloseTo(0.31, 12);
    expect(0.31 - 0.05).toBeGreaterThanOrEqual(NEO_REFRESH);
    // the neoclassical part is on top of the anomalous one: D_z = D_e + D_neo, and the 'anomalous' mode has D_z = D_e
    const an = harness({ impurityTransport: 'anomalous' });
    an.ctx.lastDiag.tauE = 2.0;
    an.imp.accepted(an.ctx, 0, 0.05, an.st, an.st);
    for (let f = 1; f <= an.N; f++) expect(an.imp.Dface[1][f]).toBe(an.ctx.w.D[f]);
    for (let f = 1; f <= h.N; f++) expect(h.imp.Dface[1][f]).toBeGreaterThan(h.ctx.w.D[f]);
    // heavier species have larger neoclassical convection K = Z D: the He one is the weakest, Ar the strongest inward
    const gN = h.imp.vface[2].reduce((s, x) => s + Math.abs(x), 0), gHe = h.imp.vface[0].reduce((s, x) => s + Math.abs(x), 0);
    expect(gN).toBeGreaterThan(0);
    expect(gHe).toBeGreaterThan(0);
  });

  it('save and restore give back the counters, the set-point multipliers and the FACIT table; a record without them forces a refresh', () => {
    const h = harness({ impurityTransport: 'facit', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3 });
    h.analytic(-1.0); h.ctx.lastDiag.tauE = 2.0; h.ctx.PSOL = 5e7;
    for (let n = 0; n < 30; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    const rec: Record<string, number> = {}, aux: Record<string, unknown> = {};
    h.imp.save(rec, aux);
    const snap = { Nsrc: Array.from(h.imp.Nsrc), Nout: Array.from(h.imp.Nout), t: h.imp.lastNeoRefresh, m: [1, 2, 3].map((k) => h.imp.edgeConcentration(k)), bal: h.imp.heliumBalance(h.st) };
    const yKept = Float64Array.from(h.y);
    for (let n = 30; n < 60; n++) h.imp.accepted(h.ctx, n * 0.5, 0.5, h.st, h.st);
    expect(h.imp.Nsrc[0]).not.toBe(snap.Nsrc[0]);
    h.y.set(yKept); // the kernel restores y itself
    h.imp.restore(rec, aux);
    expect(Array.from(h.imp.Nsrc)).toEqual(snap.Nsrc);
    expect(Array.from(h.imp.Nout)).toEqual(snap.Nout);
    expect(h.imp.lastNeoRefresh).toBe(snap.t);
    expect([1, 2, 3].map((k) => h.imp.edgeConcentration(k))).toEqual(snap.m);
    expect(h.imp.heliumBalance(h.st)).toEqual(snap.bal);
    // the stored table is a copy: mutating the live one after the save leaves the checkpoint alone
    for (const k of Object.keys(rec)) expect(typeof rec[k]).toBe('number');
    h.imp.restore({}, undefined);
    expect(h.imp.lastNeoRefresh).toBeLessThan(-1e8);
    expect(h.imp.Nsrc[0]).toBe(0);
  });
});

describe('short shots', () => {
  const jet = (tEnd: number, extra: NonNullable<MagneticConfig['profiles']> = {}): MagneticConfig => withImpurities(
    { ...JET_15D, impurity: { ...JET_15D.impurity, seedSpecies: 'Ar', seedConcentration: 1e-3 } },
    { impurityTransport: 'facit', impurityExtraSpecies: 'Ne', impurityExtraConcentration: 1e-3, ...extra }, tEnd);

  it('the particle balance of every species and the closure of the helium balance hold after every step of a JET shot with the L-H transition and ELMs', () => {
    const cfg = jet(1.0);
    const m = new ProfileModel(cfg);
    const y = m.initialState();
    m.diagnostics(0, y);
    const imp = m.ctx.impurity as ImpurityModel;
    let t = 0, worst = 0, elms = 0, steps = 0, checked = 0, adoptions = 0, mirrorMisses = 0, tgPrev = m.ctx.tg;
    while (t < cfg.t_end - 1e-9 && !m.terminated) {
      const t0 = t; t = m.step(t, y, cfg.t_end);
      elms += m.postStep(t, t - t0, y).filter((e) => e.kind === 'ELM').length;
      const st = m.ctx.view(y);
      const tg = m.ctx.tg;
      // the volumes change at an equilibrium adoption, and the content with them: the module books it at its next step (Nremap); until then the
      // content is measured with the volumes it was advanced with
      if (tg === tgPrev) {
        for (let k = 0; k < imp.nSp; k++) {
          const N = volumeIntegral(tg, imp.block(st.s, k));
          worst = Math.max(worst, Math.abs(N - imp.N0[k] - imp.Nsrc[k] + imp.Nout[k] - imp.Nremap[k]) / Math.max(N, 1));
        }
        const he = imp.heliumBalance(st);
        worst = Math.max(worst, Math.abs((he.N + he.pumped + he.inTransit - he.remap) / Math.max(he.ash, 1) - 1) * (he.ash > 1e15 ? 1 : 0));
        // the mirrors of the state: NHe is the helium inventory of the profile (after the advance and after every crash)
        if (st.s.NHe !== volumeIntegral(tg, imp.block(st.s, 0))) mirrorMisses++;
        checked++;
      } else adoptions++;
      tgPrev = tg;
      steps++;
    }
    expect(elms).toBeGreaterThan(0);
    expect(steps).toBeGreaterThan(100);
    expect(adoptions).toBeGreaterThan(0); // an equilibrium update happened
    expect(checked).toBeGreaterThan(steps - 5 * adoptions - 2);
    expect(worst).toBeLessThan(1e-9);
    expect(imp.lastNeoRefresh).toBeGreaterThan(0.7); // refreshed through the shot
    expect(mirrorMisses).toBe(0);
    // the diagnostics carry the keys of the module and the report says so
    const d = m.ctx.lastDiag;
    for (const key of ['fHe', 'fHe0', 'cZ', 'cZ0', 'cZpeak', 'cSeed', 'cSeed0', 'cExtra', 'tauHeStar', 'GammaHe', 'GammaZ', 'GammaSeed', 'GammaExtra', 'S_W', 'mZ']) expect(Number.isFinite(d[key]), key).toBe(true);
    for (const key of ['nHe', 'nZ', 'nSeed', 'nExtra']) expect(m.ctx.lastProf[key]).toHaveLength(m.N);
  }, 120000);

  it("'legacy' spelled out is the default, bit for bit, and the scalar inventories are all there is", () => {
    const a = referenceRun({ ...JET_15D, t_end: 0.3 });
    const b = referenceRun({ ...JET_15D, t_end: 0.3, profiles: { impurityTransport: 'legacy' } });
    expectSameRun(b, a, 'legacy spelled out');
    expect(a.history[a.history.length - 1].d.fHe0).toBeUndefined();
  }, 120000);

  it('the run is a function of its configuration: 2 random chunk schedules equal runAll() bitwise, and a rewind at 50 % replays it', async () => {
    const cfg = jet(1.0);
    const ref = referenceRun(cfg);
    expect(ref.events.some((e) => e.kind === 'ELM')).toBe(true);
    for (let s = 1; s <= 2; s++) { expectSameRun(runChunked(cfg, 9100 + s), ref, `chunk schedule ${s}`); await tick(); }
    const sim = rewindAt(cfg, 0.5, 9200);
    await tick();
    advanceRandomly(sim, 9300);
    expectSameRun(normalizeRng(sim), normalizeRng(ref), 'rewound at 50 %');
  }, 240000);

  it('ITER 1.5D (80 s, tau_He*/tau_E = 5): helium fraction 2 to 4 %, Z_eff near the design value (about 1.65) and the configured Be and Ar concentrations', async () => {
    const sim = new Simulation(withImpurities(ITER_15D, { impurityTransport: 'facit' }, 80));
    await runAllYielding(sim);
    expect(sim.model.terminated?.reason).toBe('Scheduled end');
    // flat-top means (the last 30 %): the concentrations swing by a few per cent through an ELM cycle
    const F = flatTopAverages(sim.history);
    expect(F.fHe).toBeGreaterThan(0.02);
    expect(F.fHe).toBeLessThan(0.04);
    expect(F.tauHeStar / F.tauE).toBeGreaterThan(4.5);
    expect(F.tauHeStar / F.tauE).toBeLessThan(5.5);
    expect(F.Zeff).toBeGreaterThan(1.55);
    expect(F.Zeff).toBeLessThan(1.8);
    expect(F.cZ / 0.02).toBeGreaterThan(0.95); expect(F.cZ / 0.02).toBeLessThan(1.05);
    expect(F.cSeed / 0.0012).toBeGreaterThan(0.93); expect(F.cSeed / 0.0012).toBeLessThan(1.07);
    const P = sim.history[sim.history.length - 1].prof!;
    expect(P.nHe[0]).toBeGreaterThan(P.nHe[P.nHe.length - 1]); // the ash is born in the core
  }, 300000);
});
