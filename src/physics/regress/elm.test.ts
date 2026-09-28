/**
 * Regression test (lane ws2b, consistency pass): the τ_E scaling contains the ELM losses, so the 0D
 * model removes the ELM-averaged power from the continuous transport and expels it in discrete
 * crashes. That average was 0.3·P_heat; in a strongly radiating plasma (ITER with D-³He, P_rad ≈ ¾
 * P_heat) it exceeded the whole transport loss W/τ_E, the continuous conduction was clipped to zero
 * and the ELMs removed more energy than the scaling allows. The ELM power is now a fraction of the
 * transport loss itself (Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549: 20–40 %).
 */
import { describe, expect, it } from 'vitest';
import { ITER } from '../presets';
import { Simulation } from '../simulation';

describe('ELM-averaged power', { timeout: 60_000 }, () => {
  for (const [name, cfg] of [['ITER', { ...ITER, t_end: 120 }], ['ITER D-³He', { ...ITER, fuel: 'DHe3' as const, t_end: 100 }]] as const) {
    it(`${name}: is 30 % of the transport loss W/τ_E (P_transport), never all of it`, () => {
      const sim = new Simulation(cfg);
      sim.runAll();
      const elmy = sim.history.filter((f) => f.d.H_mode === 1 && f.d.P_ELM > 0);
      expect(elmy.length).toBeGreaterThan(20);
      for (const f of elmy) {
        expect(f.d.P_ELM).toBeLessThan(f.d.P_transport);
        expect(f.d.P_ELM / f.d.P_transport).toBeGreaterThan(0.2);
        expect(f.d.P_ELM / f.d.P_transport).toBeLessThan(0.4);
      }
    });
  }
});
