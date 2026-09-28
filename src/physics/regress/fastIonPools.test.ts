/**
 * Regression tests for fix D1 (lane ws2b): the 0D model kept one fast-ion pool fed by the charged
 * fusion products AND the neutral beams, slowed down with the alpha slowing-down time, and reported
 * its output as "P_alpha". ITER then logged IGNITION with 33 MW of NBI on, and D-D DIII-D showed
 * P_alpha ≈ 12 MW with P_fus ≈ 0.004 MW.
 */
import { describe, expect, it } from 'vitest';
import { flatTopMean } from '../analysis/flatTop';
import { MagneticModel } from '../confinement/magnetic';
import { fastIonEnergyTime, ionHeatingFraction, spitzerSlowingDownTime } from '../heating';
import { DIIID, ITER } from '../presets';
import { Simulation } from '../simulation';
import { SimEvent } from '../types';

const MU0 = 1.25663706212e-6;

const runs = new Map<string, Simulation>();
function run(id: 'ITER' | 'DIIID'): Simulation {
  let s = runs.get(id);
  if (!s) {
    s = new Simulation(id === 'ITER' ? ITER : DIIID);
    s.runAll();
    runs.set(id, s);
  }
  return s;
}

describe('fast-ion energy content of a steady slowing-down distribution', () => {
  it('τ_W = W_fast/P_source = (τ_s/2)(1 − G(E0/E_c)) matches a direct integration of the Stix slowing-down', () => {
    // dE/dt = −(2E/τ_s)(1 + (E_c/E)^{3/2});  W/P = (1/E0) ∫_0^{E0} E dE/|dE/dt|
    const Te = 10, ne = 1e20, A = 4, Z = 2;
    const tau_s = spitzerSlowingDownTime(Te, ne, A, Z);
    for (const [E0, Ec] of [[3500, 600], [1000, 280], [80, 60], [50, 400]]) {
      const N = 200000;
      let s = 0;
      for (let i = 0; i < N; i++) {
        const E = ((i + 0.5) / N) * E0;
        s += (E / ((2 * E / tau_s) * (1 + Math.pow(Ec / E, 1.5)))) * (E0 / N);
      }
      const numeric = s / E0;
      expect(fastIonEnergyTime(Te, ne, A, Z, E0, Ec) / numeric).toBeCloseTo(1, 5);
      expect(numeric / tau_s).toBeCloseTo(0.5 * (1 - ionHeatingFraction(E0, Ec)), 5);
    }
  });
});

describe('separate alpha and beam pools (0D magnetic model)', { timeout: 60_000 }, () => {
  it('ITER: P_alpha is the charged-fusion-product heating, the beams are reported separately', () => {
    const h = run('ITER').history;
    const Pa = flatTopMean(h, 'P_alpha'), Pch = flatTopMean(h, 'P_charged'), Pfus = flatTopMean(h, 'P_fus');
    // in the flat top the alpha pool is in steady state: deposited = born
    expect(Pa / Pch).toBeGreaterThan(0.97);
    expect(Pa / Pch).toBeLessThan(1.03);
    expect(Pa).toBeLessThan(0.21 * Pfus);
    // the 33 MW, 1 MeV negative-ion beams heat through their own pool
    const Pb = flatTopMean(h, 'P_beam_heat');
    expect(Pb).toBeGreaterThan(25);
    expect(Pb).toBeLessThan(33.001);
  });

  it('ITER with 50 MW of external heating never logs IGNITION, and its ignition time is zero', () => {
    const sim = run('ITER');
    const ign = sim.events.filter((e: SimEvent) => e.kind === 'ignition');
    expect(ign.map((e) => `${e.t.toFixed(1)} s: ${e.msg}`)).toEqual([]);
    expect(sim.report().ignitionTime_s).toBe(0);
  });

  it('whenever a frame counts as ignited, the charged-product heating covers radiation + transport', () => {
    // a burn that does ignite: ITER at H98 = 1.4 with the ignition test (heating off at Q ≥ 5), no NTMs
    const sim = new Simulation({ ...ITER, H98: 1.4, t_end: 150, heating: { ...ITER.heating, autoOff: true }, events: { ...ITER.events, ntm: false } });
    sim.runAll();
    const ignited = sim.history.filter((f) => f.d.ignited === 1);
    expect(ignited.length).toBeGreaterThan(500);
    // hysteresis: on at P_α ≥ P_rad + W/τ_E, off below 0.9 of it; P_α holds no beam power
    for (const f of ignited) {
      expect(f.d.P_alpha).toBeGreaterThanOrEqual(0.9 * (f.d.P_rad + f.d.P_transport));
      expect(f.d.P_alpha).toBeLessThan(1.2 * f.d.P_charged);
    }
    // and the flag is the model's own ignition state: the report counts exactly these frames
    const dtIgn = sim.history.reduce((s, f, i) => (i && f.d.ignited === 1 ? s + f.t - sim.history[i - 1].t : s), 0);
    expect(sim.report().ignitionTime_s).toBeCloseTo(dtIgn, 9);
  });

  it('DIII-D (D-D, 12 MW NBI): P_alpha ≈ 0 while the beam pool carries the NBI power', () => {
    const h = run('DIIID').history;
    const Pfus = flatTopMean(h, 'P_fus');
    expect(Pfus).toBeLessThan(0.01);
    expect(flatTopMean(h, 'P_alpha')).toBeLessThan(0.01);
    expect(flatTopMean(h, 'P_alpha')).toBeLessThanOrEqual(flatTopMean(h, 'P_charged') * 1.05);
    expect(flatTopMean(h, 'P_beam_heat')).toBeGreaterThan(8);
  });

  it('β_T and β_N include the fast-particle pressure (2/3)(W_α + W_beam)/V', () => {
    const sim = run('ITER');
    const V = sim.model.geometryInfo().V, B = ITER.B0;
    // diagnostics of the final state itself: a frame recorded right after an ELM crash carries the
    // rhs diagnostics of the pre-crash state (kernel behaviour, see the ws2b report)
    const last = sim.history[sim.history.length - 1];
    const probe = new MagneticModel(ITER);
    probe.restoreInternal(last.internal);
    const f = probe.diagnostics(last.t, Float64Array.from(last.y));
    expect(f.Wf).toBeGreaterThan(0);
    const p = (2 / 3) * (f.W + f.Wf) * 1e6 / V;
    expect(f.betaT / ((2 * MU0 * p) / (B * B) * 100)).toBeCloseTo(1, 9);
    expect(f.betaN / ((f.betaT * ITER.geometry.a * B) / f.Ip)).toBeCloseTo(1, 9);
  });
});

describe('fast-particle pressure: Troyon limit yes, NTM drive no', { timeout: 60_000 }, () => {
  // an ITER flat-top state
  const sim = new Simulation({ ...ITER, t_end: 120 });
  sim.runAll();
  const y0 = Float64Array.from(sim.history[sim.history.length - 1].y);
  const probe = new MagneticModel(ITER);
  const d0 = probe.diagnostics(120, y0);

  it('β_N,th is the thermal part of β_N', () => {
    expect(d0.betaN_th).toBeGreaterThan(0);
    expect(d0.betaN_th / d0.betaN).toBeCloseTo(d0.W / (d0.W + d0.Wf), 9);
  });

  it('a sawtooth seeds an NTM only when the THERMAL β_N exceeds 0.7 β_N,limit (bootstrap drive)', () => {
    const seeds = (limit: number) => {
      const m = new MagneticModel({ ...ITER, limits: { ...ITER.limits, betaN_limit: limit } });
      const y = Float64Array.from(y0);
      m.rhs(120, y, new Float64Array(y.length));
      return m.postStep(120, 1e-3, y).some((e) => e.kind === 'NTM_onset'); // first sawtooth is due at t = 0.3 s
    };
    // 0.7·limit between the thermal and the total β_N: fast ions alone do not seed the NTM
    expect(seeds((d0.betaN_th + d0.betaN) / 2 / 0.7)).toBe(false);
    expect(seeds((0.9 * d0.betaN_th) / 0.7)).toBe(true);
  });
});
