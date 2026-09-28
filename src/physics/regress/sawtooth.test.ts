/**
 * Regression test (lane ws2b, consistency pass): the τ_E, τ_p and τ_He scalings are sawtooth-averaged,
 * yet every 0D sawtooth crash also removed ~2 % of W and 3 % of the ash and impurities — the
 * sawtooth losses were counted twice. In 0D the crash only redistributes inside the plasma.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { ITER, JET } from '../presets';
import { Simulation } from '../simulation';

describe('sawtooth crash in the 0D model', () => {
  it('conserves the plasma energy and particle inventories (the scalings already contain it)', () => {
    const cfg = { ...ITER, events: { elms: false, sawteeth: true, ntm: false } };
    const m = new MagneticModel(cfg);
    const y = m.initialState();
    y[4] = 1e17; // some ash
    const before = Array.from(y);
    m.rhs(0.4, y, new Float64Array(y.length));
    const ev = m.postStep(0.4, 1e-3, y); // first crash is due at t = 0.3 s
    expect(ev.some((e) => e.kind === 'sawtooth')).toBe(true);
    for (const i of [0, 1, 2, 3, 4, 5]) expect(y[i], `state ${i}`).toBe(before[i]); // W_e, W_i, n_a, n_b, n_He, n_Z
  });

  it('sawteeth no longer lower the flat-top stored energy', () => {
    const run = (saw: boolean) => {
      const sim = new Simulation({ ...JET, events: { elms: false, sawteeth: saw, ntm: false } });
      sim.runAll();
      const h = sim.history.filter((f) => f.t > 3.5);
      return h.reduce((s, f) => s + f.d.W, 0) / h.length;
    };
    const withSaw = run(true), without = run(false);
    expect(Math.abs(withSaw / without - 1)).toBeLessThan(0.005);
  });
});
