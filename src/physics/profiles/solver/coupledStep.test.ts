/**
 * The TR-BDF2 transport step of the 1.5D model (solver/coupledStep.ts) on whole shots: error control, the discrete energy balance,
 * the Δt limit, the localisation of ELMs and sawtooth crashes at the crossing of their thresholds, and the counters of the step control.
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D, JET_15D } from '../../presets';
import { Simulation } from '../../simulation';
import type { MagneticConfig } from '../../types';
import { ProfileModel } from '../model';
import { ElmEvents } from '../events/elm';

const quiet = (cfg: MagneticConfig, tEnd: number, profiles: Partial<NonNullable<MagneticConfig['profiles']>> = {}): MagneticConfig => ({
  ...cfg, t_end: tEnd, events: { ...cfg.events, elms: false, sawteeth: false, ntm: false }, profiles: { ...cfg.profiles, ...profiles },
});

/** Largest difference of the four profiles of two final states, relative to |b| with a floor of 5 % of the profile's maximum (ψ starts at zero on the axis) */
function profileDiff(a: Float64Array, b: Float64Array, N: number): number {
  let m = 0;
  for (let f = 0; f < 4; f++) {
    let top = 0;
    for (let i = 0; i < N; i++) top = Math.max(top, Math.abs(b[f * N + i]));
    for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(a[f * N + i] - b[f * N + i]) / Math.max(Math.abs(b[f * N + i]), 0.05 * top));
  }
  return m;
}

describe('error control', () => {
  it('the state of the L-mode start-up of a shot approaches a tight-tolerance reference as rtol shrinks, with more steps', () => {
    // JET15 before its L–H transition (0.21 s): smooth dynamics, no event whose timing would shift with the step. (After the transition
    // the pedestal is clamped at α_crit by a lagged coefficient: the profiles at a given time depend on the step at the percent level.)
    const cfg = quiet(JET_15D, 0.15);
    const run = (rtol: number) => {
      const sim = new Simulation({ ...cfg, profiles: { ...cfg.profiles, rtol } } as MagneticConfig);
      sim.runAll();
      return { y: Float64Array.from(sim.y), steps: sim.nSteps, N: (sim.model as ProfileModel).N };
    };
    const ref = run(1e-6);
    const loose = run(3e-2), mid = run(1e-3), tight = run(1e-4);
    const e = [loose, mid, tight].map((r) => profileDiff(r.y, ref.y, ref.N));
    expect(e[2]).toBeLessThan(e[0]);
    expect(e[2]).toBeLessThan(e[1]);
    expect(e[2]).toBeLessThan(2e-3);
    expect(e[0]).toBeLessThan(0.1);
    expect(loose.steps).toBeLessThan(mid.steps);
    expect(mid.steps).toBeLessThan(ref.steps);
  }, 120000);

  it('ProfileSettings.dtMax limits every step; a tighter limit needs more steps, and the setting reaches the model', () => {
    const cfg = { ...JET_15D, t_end: 0.4 } as MagneticConfig;
    const dts: number[] = [];
    const sim = new Simulation({ ...cfg, profiles: { ...cfg.profiles, dtMax: 0.001 } } as MagneticConfig);
    let t = sim.t;
    while (!sim.done) { sim.advance(1e-9); dts.push(sim.t - t); t = sim.t; }
    expect(Math.max(...dts)).toBeLessThanOrEqual(0.001 + 1e-12);
    const free = new Simulation(cfg);
    free.runAll();
    expect(sim.nSteps).toBeGreaterThan(free.nSteps);
  }, 120000);

  it('few attempts are rejected by the error test or fail on the ITER15 ramp-up and its L–H transition, and none is forced', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 12 });
    sim.runAll();
    const m = sim.model as ProfileModel;
    const st = m.stepper.stats;
    expect(st.accepted).toBe(sim.nSteps);
    expect(m.forcedSteps).toBe(0);
    expect((st.rejected + st.failed) / (st.accepted + st.rejected + st.failed)).toBeLessThan(0.1);
    expect(st.picardIters / (st.accepted + st.rejected + st.failed)).toBeLessThan(9);
  }, 120000);

  it('an attempt whose error estimate is above the tolerance is repeated with a smaller Δt; a small one lets the next step grow', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 });
    const y = m.initialState();
    m.diagnostics(0, y);
    m.ctx.dt = 1e-3;
    const real = m.stepper.implicitStep.bind(m.stepper);
    const tried: number[] = [];
    let calls = 0;
    m.stepper.implicitStep = (t, dt, yo, yy) => {
      tried.push(dt);
      const r = real(t, dt, yo, yy);
      // the first two attempts are reported as too inaccurate, the others as very accurate
      return ++calls <= 2 ? { ...r, err: 4 } : { ...r, err: 1e-9 };
    };
    const t1 = m.step(0, y, 0.2);
    expect(tried.length).toBe(3);
    expect(tried[1]).toBeLessThan(tried[0]);
    expect(tried[2]).toBeLessThan(tried[1]);
    expect(t1).toBe(tried[2]);
    expect(m.stepper.stats.rejected).toBe(2);
    // the step that followed two rejections does not grow; without rejections the next step is twice the last (the largest growth)
    expect(m.ctx.dt).toBeLessThanOrEqual(tried[2] + 1e-15);
    tried.length = 0;
    const t2 = m.step(t1, y, 0.2);
    expect(tried.length).toBe(1);
    expect(m.ctx.dt).toBeCloseTo(2 * (t2 - t1), 12);
  }, 60000);
});

describe('discrete energy balance of the TR-BDF2 step', () => {
  it('every accepted step of the JET15 flat-top with ELMs closes ΔW/Δt = w (P_n + P_γ) + d P_{n+1} to 1e-4 of P_heat (P = P_heat − P_rad − P_bound at the three states)', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 1.5 });
    const y = m.initialState();
    m.diagnostics(0, y);
    let t = 0, n = 0, worst = 0;
    while (t < 1.5 && !m.terminated) {
      const t0 = t;
      t = m.step(t, y, 1.5);
      if (t0 > 0.1) { worst = Math.max(worst, Math.abs(m.stepper.energyResidual)); n++; }
      m.postStep(t, t - t0, y);
    }
    expect(n).toBeGreaterThan(200);
    expect(worst).toBeLessThan(1e-4);
  }, 120000);
});

describe('event localisation', () => {
  it('the ELM count of a shot does not depend on the Δt limit: 2 % between limits of 0.5 s and 5 ms (the crash fires when the recovery time has passed, not at the end of the step)', () => {
    const counts = [0.5, 0.05, 0.005].map((dtMax) => {
      const sim = new Simulation({ ...ITER_15D, t_end: 45, profiles: { ...ITER_15D.profiles, dtMax } } as MagneticConfig);
      sim.runAll();
      return sim.events.filter((e) => e.kind === 'ELM').length;
    });
    expect(counts[0]).toBeGreaterThan(50);
    for (const c of counts) expect(Math.abs(c - counts[2]) / counts[2]).toBeLessThan(0.02);
  }, 300000);

  it('successive ELMs of a refractory-limited H-mode are one recovery time τ_E/8 apart (to 5 %), whatever the step: the step ends at that time', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 40 });
    sim.runAll();
    const elms = sim.events.filter((e) => e.kind === 'ELM');
    const frames = sim.history;
    const tauAt = (t: number) => {
      let f = frames[0];
      for (const h of frames) { if (h.t > t) break; f = h; }
      return f.d.tauE;
    };
    expect(elms.length).toBeGreaterThan(30);
    let close = 0, total = 0;
    for (let k = 1; k < elms.length; k++) {
      const dT = elms[k].t - elms[k - 1].t;
      if (elms[k - 1].t < 20) continue;
      const tRef = ElmEvents.recovery(tauAt(elms[k].t));
      total++;
      if (dT >= tRef && dT < 1.05 * tRef) close++;
    }
    // the spread is τ_E changing between the last step and the event; the bulk of the intervals sits at the recovery time
    expect(close / total).toBeGreaterThan(0.85);
  }, 120000);
});

describe('counters of the step control and the checkpoint', () => {
  it('the counters and the step state are saved with a frame and restored by a rewind, and the replayed shot reports them as the uninterrupted one', () => {
    const cfg = { ...JET_15D, t_end: 0.5 } as MagneticConfig;
    const a = new Simulation(cfg);
    a.runAll();
    const stA = { ...(a.model as ProfileModel).stepper.stats };
    const b = new Simulation(cfg);
    b.advance(0.3);
    const mb = b.model as ProfileModel;
    const mid = b.history.length - 1;
    const statsAtFrame = { ...mb.stepper.stats };
    b.advance(0.1);
    expect(mb.stepper.stats.accepted).toBeGreaterThan(statsAtFrame.accepted);
    b.rewindTo(mid);
    // the frame carries the counters of the step that recorded it
    expect(mb.stepper.stats.accepted).toBeLessThanOrEqual(statsAtFrame.accepted);
    expect(mb.stepper.stats.accepted).toBeGreaterThan(0);
    b.runAll();
    expect({ ...mb.stepper.stats }).toEqual(stA);
    expect(b.nSteps).toBe(a.nSteps);
    expect(b.report().engineering['Transport steps (accepted / rejected by the error test)']).toBe(`${stA.accepted} / ${stA.rejected}`);
  }, 120000);
});
