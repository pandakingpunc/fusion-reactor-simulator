import { describe, expect, it } from 'vitest';
import { ITER, ITER_15D } from '../src/physics/presets';
import { Simulation } from '../src/physics/simulation';
import { limitStep } from './limitStep';

describe('limitStep (the time-step series of bench:convergence)', () => {
  it('caps every internal step of the 1.5D model', () => {
    const cfg = { ...ITER_15D, t_end: 3 };
    const free = new Simulation(cfg);
    free.runAll();
    const capped = new Simulation(cfg);
    limitStep(capped, 0.002);
    capped.runAll();
    // the free run averages about 4 ms per step in the start-up (808 steps for 3 s); with a cap of 2 ms the shot
    // needs at least 1500 of them
    expect(capped.nSteps).toBeGreaterThanOrEqual(3 / 0.002);
    expect(capped.nSteps).toBeGreaterThan(free.nSteps);
  });

  it('refuses a model that has no internal time step (the 0D model integrates with Dormand-Prince)', () => {
    expect(() => limitStep(new Simulation(ITER), 0.1)).toThrow('no internal time step');
  });
});
