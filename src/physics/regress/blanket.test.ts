/**
 * Regression tests (lane ws2b, consistency pass): the blanket energy multiplication (exothermic
 * ⁶Li(n,α)T and (n,2n) reactions) acts on the neutrons that enter a blanket. The economics layer
 * multiplied the whole fusion power by 1.18 for every D-T device, including JET, which has none.
 */
import { describe, expect, it } from 'vitest';
import { flatTopMean } from '../analysis/flatTop';
import { economics } from '../engineering';
import { ITER, JET } from '../presets';
import { Simulation } from '../simulation';

const base = {
  V_core_m3: 800, magnetCostRel: 1, P_fus_MW: 500, P_neutron_MW: 400, P_aux_MW: 50, P_recirc_MW: 40,
  thermalEff: 0.35, wallPlugEff: 0.4, availability: 0.6, discountRate: 0.07, lifetime_yr: 30,
};

describe('blanket energy multiplication', () => {
  it('multiplies only the neutron power that enters the blanket', () => {
    const e = economics({ ...base, neutronMult: 1.18, blanketCoverage: 0.85 });
    expect(e.P_th_MW).toBeCloseTo(500 + 0.18 * 0.85 * 400 + 50, 9);
    expect(economics({ ...base, neutronMult: 1.18, blanketCoverage: 0 }).P_th_MW).toBeCloseTo(550, 9);
    expect(economics({ ...base, neutronMult: 1.0, blanketCoverage: 1 }).P_th_MW).toBeCloseTo(550, 9);
    // aneutronic: nothing to multiply
    expect(economics({ ...base, P_neutron_MW: 0, neutronMult: 1.18, blanketCoverage: 1 }).P_th_MW).toBeCloseTo(550, 9);
  });

  it('JET (no blanket) converts exactly P_fus + P_aux; ITER multiplies its neutrons only', () => {
    for (const cfg of [JET, { ...ITER, t_end: 60 }]) {
      const sim = new Simulation(cfg);
      const r = sim.runAll();
      const avg = (k: string) => flatTopMean(sim.history, k, { samples: 'all' });
      const hasBlanket = cfg.blanket.type !== 'none' && cfg.blanket.coverage > 0;
      const Pth = avg('P_fus') + (hasBlanket ? 0.18 * cfg.blanket.coverage * avg('P_neutron') : 0) + avg('P_aux') + avg('P_oh');
      expect(r.engineering['P_thermal (MW)']).toBe(+Pth.toFixed(0));
    }
  });
});
