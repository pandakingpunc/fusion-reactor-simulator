/**
 * Regression tests (lane ws2b, D2): the ICF model used the D-T energy per reaction (17.6 MeV), the
 * D-T burn-up parameter H_B = 7 g/cm² and the D-T ignition threshold whatever fuel was selected —
 * a D-D capsule out-yielded D-T (G 1.86 vs 1.49) — and multiplied the gain by the drive coupling
 * a second time in Q_eng.
 */
import { describe, expect, it } from 'vitest';
import { icfFuelData, icfStagnation } from '../confinement/icf';
import { NIF } from '../presets';
import { Simulation } from '../simulation';
import { FuelType } from '../reactivity';
import { ICFConfig } from '../types';

const MEV = 1.602176634e-13;
const run = (cfg: ICFConfig) => new Simulation(cfg).runAll();

describe('ICF burn uses the selected fuel', () => {
  it('fuel data: D-T keeps the calibrated H_B = 7 g/cm² and 17.6 MeV; the other fuels burn far worse', () => {
    const dt = icfFuelData('DT');
    expect(dt.H_B).toBe(7);
    expect(dt.E_rx_MeV).toBeCloseTo(17.589, 10);
    expect(dt.neutronsPerReaction).toBe(1);
    expect(dt.ignitionScale).toBe(1);
    const dd = icfFuelData('DD');
    expect(dd.E_rx_MeV).toBeGreaterThan(3.5); // D(d,p)T 4.03 and D(d,n)³He 3.27 MeV, ~50/50
    expect(dd.E_rx_MeV).toBeLessThan(3.8);
    expect(dd.neutronsPerReaction).toBeGreaterThan(0.4);
    expect(dd.neutronsPerReaction).toBeLessThan(0.6);
    for (const f of ['DD', 'DHe3', 'pB11'] as FuelType[]) {
      const d = icfFuelData(f);
      expect(d.H_B, f).toBeGreaterThan(5 * dt.H_B);
      expect(d.ignitionScale, f).toBeLessThan(0.1);
    }
    expect(icfFuelData('DHe3').neutronsPerReaction).toBeLessThan(0.2);
    expect(icfFuelData('pB11').neutronsPerReaction).toBe(0);
  });

  it('NIF with D-T: one neutron per 17.6 MeV; G = 0.67 since the ρR scale was calibrated on N210808 (it was 1.49 with the scale tuned to N221204, see icfCalibration.test.ts)', () => {
    const r = run(NIF);
    expect(r.Q_sci_max).toBeGreaterThan(0.66);
    expect(r.Q_sci_max).toBeLessThan(0.68);
    expect((r.E_fusion_MJ * 1e6) / (r.neutronYield * 17.589 * MEV)).toBeCloseTo(1, 6);
  });

  it('the same capsule filled with D-D, D-³He or p-¹¹B does not ignite and yields orders of magnitude less', () => {
    const dt = run(NIF);
    for (const fuel of ['DD', 'DHe3', 'pB11'] as FuelType[]) {
      const r = run({ ...NIF, fuel });
      expect(r.Q_sci_max, fuel).toBeLessThan(0.01 * dt.Q_sci_max);
      expect(r.engineering.Ignited, fuel).toBe(false);
    }
    const dd = run({ ...NIF, fuel: 'DD' });
    // energy per neutron: (3.65 MeV per reaction) / (≈ 0.5 neutron per reaction)
    const ePerN = (dd.E_fusion_MJ * 1e6) / dd.neutronYield / MEV;
    expect(ePerN).toBeGreaterThan(6.5);
    expect(ePerN).toBeLessThan(8);
    const dhe3 = run({ ...NIF, fuel: 'DHe3' });
    expect(dhe3.neutronYield).toBeLessThan(1e-2 * dt.neutronYield);
    expect(run({ ...NIF, fuel: 'pB11' }).neutronYield).toBe(0);
  });
});

describe('ICF engineering gain', () => {
  it('Q_eng = G · η_driver · η_th, not multiplied again by the hohlraum/absorption coupling', () => {
    const a = run(NIF), b = run({ ...NIF, hohlraumEff: 0.2 });
    expect(b.Q_sci_max).toBe(a.Q_sci_max);
    expect(b.Q_eng).toBe(a.Q_eng);
    // G = E_fus/E_laser; Q_sci_max is the recorded cumulative gain (equal to ~1e-4: burn-pulse tail, integration error)
    expect(a.Q_eng / (0.1 * 0.4) / a.Q_sci_max).toBeCloseTo(1, 3); // defaults: 10 % laser wall-plug, 40 % thermal
    const c = run({ ...NIF, driverEff: 0.2, thermalEff: 0.45 });
    expect(c.Q_eng / (0.2 * 0.45) / c.Q_sci_max).toBeCloseTo(1, 3);
  });
});

// Bang-time was pulse_ns and the burn a Gaussian of σ = 0.08 ns around it, integrated from t = 0: for pulse_ns ≲ 0.25 ns
// part of the burn fell before t = 0 and was lost from E_fusion_MJ and the neutron yield (NIF at 0.05 ns: 1.006 instead of
// 1.370 MJ) while the gain G and the score still used the closed-form total.
describe('ICF burn pulse of a short laser pulse', () => {
  it('the whole burn is integrated: E_fusion and the neutron yield equal the closed-form totals for every pulse length', () => {
    const st = icfStagnation(NIF);
    for (const pulse_ns of [8, 0.5, 0.25, 0.05, 0.01]) {
      const r = run({ ...NIF, pulse_ns });
      expect((r.E_fusion_MJ * 1e6) / st.E_fus_total, `pulse_ns ${pulse_ns}`).toBeCloseTo(1, 5);
      expect(r.neutronYield / st.N_n_total, `pulse_ns ${pulse_ns}`).toBeCloseTo(1, 5);
      expect(r.engineering['Gain G'], `pulse_ns ${pulse_ns}`).toBe(+(st.E_fus_total / (NIF.E_laser_MJ * 1e6)).toFixed(2));
    }
  });
});
