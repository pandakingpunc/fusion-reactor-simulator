/**
 * Regression tests (lane ws2b, "should" items):
 *  - MagLIF on Z stagnates for ~1–2 ns (Gomez et al., PRL 113 (2014) 155003; PRL 125 (2020) 155002);
 *    the model's compression pulse had a width of 0.3·t_c = 30 ns.
 */
import { describe, expect, it } from 'vitest';
import { GF_PISTON, ZMACHINE } from '../presets';
import { Simulation } from '../simulation';

/** full width at half maximum of the fusion power pulse [µs] */
function burnFWHM(cfg: typeof ZMACHINE): number {
  const sim = new Simulation(cfg);
  sim.runAll();
  const h = sim.history;
  const pk = Math.max(...h.map((f) => f.d.P_fus));
  const above = h.filter((f) => f.d.P_fus >= pk / 2);
  return above[above.length - 1].t - above[0].t;
}

describe('MagLIF stagnation', () => {
  it('burns for ~2 ns, not tens of ns', () => {
    const w = burnFWHM(ZMACHINE) * 1e3; // ns
    expect(w).toBeGreaterThan(1);
    expect(w).toBeLessThan(3);
  });

  it('slow liner/piston compressions keep their 0.3·t_c stagnation', () => {
    expect(burnFWHM(GF_PISTON) / GF_PISTON.compressionTime_us).toBeGreaterThan(0.2);
  });
});
