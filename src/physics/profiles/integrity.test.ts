/**
 * 1.5D model integrity regressions: state that events, checkpoints and reports read must always
 * describe the current plasma and the current equilibrium.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { DEMO_15D, ITER_15D } from '../presets';
import { MagneticConfig } from '../types';
import { ProfileModel } from './model';

/** Work arrays are private; the tests read them through this view only. */
type Internals = { w: Record<string, Float64Array> };
const internals = (m: ProfileModel) => m as unknown as Internals;

describe('work arrays after an equilibrium swap', () => {
  it.each([
    ['ITER15', ITER_15D, 400],
    ['DEMO15', DEMO_15D, 500],
  ] as [string, MagneticConfig, number][])('%s: no postStep sees n_i = 0 and every sawtooth flattens T_i', (_id, cfg, tEnd) => {
    const sim = new Simulation({ ...cfg, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let calls = 0, zero = 0;
    m.postStep = (t, dt, y) => {
      calls++;
      if (internals(m).w.ni.some((v) => !(v > 0))) zero++;
      return post(t, dt, y);
    };
    const tiFlattened: boolean[] = [];
    m.crashHook = (kind, _t, before, after) => { if (kind === 'sawtooth') tiFlattened.push(after.Ti[0] < before.Ti[0]); };
    sim.runAll();
    expect(m.eqUpdates).toBeGreaterThan(10); // the shot crosses many equilibrium swaps
    expect(calls).toBeGreaterThan(1000);
    expect(zero).toBe(0);
    expect(tiFlattened.every(Boolean)).toBe(true);
  }, 180000);
});
