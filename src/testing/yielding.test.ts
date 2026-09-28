import { describe, expect, it } from 'vitest';
import { JET_15D } from '../physics/presets';
import { Simulation } from '../physics/simulation';
import { runAllYielding } from './yielding';

describe('runAllYielding', () => {
  const cfg = { ...JET_15D, t_end: 0.3 };

  it('gives exactly what runAll gives', async () => {
    const a = new Simulation(cfg), b = new Simulation(cfg);
    const ra = a.runAll(), rb = await runAllYielding(b);
    expect(JSON.stringify(rb)).toBe(JSON.stringify(ra));
    expect(b.history.length).toBe(a.history.length);
    expect(b.history[b.history.length - 1].y).toEqual(a.history[a.history.length - 1].y);
    expect(b.events).toEqual(a.events);
    // a run that is already done is just reported
    expect(JSON.stringify(await runAllYielding(b))).toBe(JSON.stringify(ra));
  }, 60000);

  it('returns to the event loop while the run is in progress', async () => {
    const sim = new Simulation(cfg);
    let fired = false, seenFiredMidRun = false, calls = 0;
    setTimeout(() => { fired = true; }, 0);
    const advance = sim.advance.bind(sim);
    sim.advance = (dt: number) => { calls++; if (fired && !sim.done) seenFiredMidRun = true; return advance(dt); };
    await runAllYielding(sim);
    expect(calls).toBeGreaterThan(20);
    expect(seenFiredMidRun).toBe(true);
  }, 60000);
});
