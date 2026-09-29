/**
 * Details of one TR-BDF2 attempt (solver/coupledStep.ts implicitStep) that whole-shot tests do not pin down: the time at which each
 * stage takes its plasma-current boundary condition, and the filtering of the error estimate with the inverse iteration matrix.
 * Found by the mutation smoke test (scripts/mutation-smoke.mjs, M21, M22, M24 and M33).
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import type { MagneticConfig } from '../../types';
import { ProfileModel } from '../model';
import { TRBDF2_GAMMA } from './trbdf2';

const quiet = (extra: Partial<NonNullable<MagneticConfig['profiles']>> = {}): MagneticConfig => ({
  ...JET_15D, t_end: 0.3, events: { ...JET_15D.events, elms: false, sawteeth: false, ntm: false }, profiles: { ...JET_15D.profiles, ...extra },
} as MagneticConfig);

/** a model advanced to t = 0.05 s of its start-up, and that time */
function started(cfg: MagneticConfig) {
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  m.ctx.dt = 1e-3;
  let t = 0;
  while (t < 0.05) t = m.step(t, y, 0.05);
  return { m, y, t };
}

describe('the plasma-current boundary of the two stages', () => {
  it('the trapezoidal stage takes I_p(t + γ Δt), the BDF2 stage I_p(t + Δt), from a programme that is not linear', () => {
    // a kinked programme: the value at t + Δt/2 differs from the one at t + γ Δt
    const prog: [number, number][] = [[0, 3], [0.06, 3], [0.09, 3.9], [0.4, 3.9]];
    const { m, y, t } = started(quiet({ IpWaveform: prog }));
    const dt = 0.04;
    const yo = Float64Array.from(y), yy = Float64Array.from(y);
    const r = m.stepper.implicitStep(t, dt, yo, yy);
    expect(r.ok).toBe(true);
    const at = (x: number) => 1e6 * (x <= 0.06 ? 3 : x >= 0.09 ? 3.9 : 3 + (0.9 * (x - 0.06)) / 0.03);
    const stage1 = m.ctx.view(m.stepper['yG']).s.Ip;
    expect(stage1).toBeCloseTo(at(t + TRBDF2_GAMMA * dt), 3);
    expect(stage1).not.toBeCloseTo(at(t + 0.5 * dt), 0);
    expect(m.ctx.view(yy).s.Ip).toBeCloseTo(at(t + dt), 3);
  });
});

describe('the error estimate of a step', () => {
  it('is filtered with the inverse iteration matrix: the ringing of the trapezoidal stage in the outermost cells does not fail a smooth step', () => {
    // JET15 at 0.05 s of its start-up, one attempt of 5 ms: the raw estimate of the density in the outermost cell is about five times the
    // tolerance (a stiff cell responds to its neighbours within the step and the stage overshoots), the filtered one is about half of it
    const { m, y, t } = started(quiet());
    const r = m.stepper.implicitStep(t, 5e-3, Float64Array.from(y), Float64Array.from(y));
    expect(r.ok).toBe(true);
    expect(r.err).toBeLessThan(1);
    expect(r.err).toBeGreaterThan(0.05);
    // a longer step is still measured as a modest multiple of the tolerance, not as a hundred
    const r2 = m.stepper.implicitStep(t, 2e-2, Float64Array.from(y), Float64Array.from(y));
    expect(r2.err).toBeLessThan(2);
    expect(r2.err!).toBeGreaterThan(r.err!);
  });
});

describe('the Picard iteration of a stage', () => {
  it('converges to 0.1 rtol (at most 2e-3): a tighter tolerance of the error test costs iterations, a looser one than 2e-3 does not save any', () => {
    const { m, y, t } = started(quiet());
    /** Picard iterations of one attempt at the tolerance rtol, from the same state */
    const iters = (rtol: number, dt: number) => {
      (m.ctx.ps as { rtol?: number }).rtol = rtol;
      const before = m.stepper.stats.picardIters;
      m.stepper.implicitStep(t, dt, Float64Array.from(y), Float64Array.from(y));
      return m.stepper.stats.picardIters - before;
    };
    // rtol = 1e-4 asks the stage for 1e-5, rtol = 1e-2 for 1e-3, rtol >= 2e-2 for the cap of 2e-3 (JET15 at 0.05 s, 10 ms and 30 ms attempts: 12, 4, 4 and 9, 8, 8 iterations)
    expect(iters(1e-4, 1e-2)).toBeGreaterThan(iters(1e-2, 1e-2) + 3);
    expect(iters(1e-2, 3e-2)).toBeGreaterThan(iters(1, 3e-2));
    expect(iters(2e-2, 3e-2)).toBe(iters(1, 3e-2));
  });
});
