/**
 * Regression tests: a zero discount rate (economics.discountRate is in [0, 1)) made the capital recovery factor
 * r (1+r)^N / ((1+r)^N - 1) a 0/0 and the LCOE NaN, and the shot report wrote every non-finite LCOE as 'n/a (net<0)',
 * also for a plant with a positive net electric power.
 */
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config/schema';
import { economics } from '../engineering';
import { DEMO, JET } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';

const base = {
  V_core_m3: 800, magnetCostRel: 1, P_fus_MW: 2000, P_neutron_MW: 1600, P_aux_MW: 50, P_recirc_MW: 150,
  thermalEff: 0.35, wallPlugEff: 0.4, availability: 0.6, discountRate: 0.07, lifetime_yr: 30, neutronMult: 1.18, blanketCoverage: 0.85,
};

describe('LCOE at a zero discount rate', () => {
  it('the capital recovery factor is its r -> 0 limit 1/N: the LCOE is finite and continuous in r', () => {
    const e0 = economics({ ...base, discountRate: 0 });
    expect(e0.CRF).toBe(1 / 30);
    expect(Number.isFinite(e0.LCOE_USD_MWh)).toBe(true);
    const e1 = economics({ ...base, discountRate: 1e-9 });
    expect(Math.abs(e0.LCOE_USD_MWh / e1.LCOE_USD_MWh - 1)).toBeLessThan(1e-6);
    // r > 0 keeps the closed form
    expect(economics(base).CRF).toBe((0.07 * Math.pow(1.07, 30)) / (Math.pow(1.07, 30) - 1));
  });

  it('the shot report gives the LCOE of a plant that sells electricity at r = 0, and names the cause of a missing one', () => {
    const run = (over: Partial<MagneticConfig['economics']>) => {
      const cfg: MagneticConfig = { ...DEMO, t_end: 120, economics: { ...DEMO.economics, ...over } };
      expect(validateConfig(cfg).ok).toBe(true);
      return new Simulation(cfg).runAll().engineering;
    };
    const r0 = run({ discountRate: 0 });
    expect(r0['Net P_electric (MW)']).toBeGreaterThan(0);
    expect(typeof r0['LCOE ($/MWh)']).toBe('number');
    expect(r0['LCOE ($/MWh)']).toBeGreaterThan(0);
    // no electricity sold (availability 0) is not a negative net power
    const a0 = run({ availability: 0 });
    expect(a0['Net P_electric (MW)']).toBeGreaterThan(0);
    expect(a0['LCOE ($/MWh)']).toBe('n/a (no electricity sold)');
    // a plant that draws power from the grid keeps its label
    const jet = new Simulation(JET).runAll().engineering;
    expect(jet['Net P_electric (MW)']).toBeLessThan(0);
    expect(jet['LCOE ($/MWh)']).toBe('n/a (net<0)');
  });
});
