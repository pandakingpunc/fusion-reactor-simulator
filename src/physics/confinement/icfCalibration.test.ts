/**
 * The calibration of the ICF model on N210808 (icfCalibration.ts): the stored ICF_CAL is reproduced from the preset and the
 * published yield by a 1-D root solve; the solve is monotone and exact on both sides of the ignition cliff; no model constant but
 * ICF_CAL changed (the v3.0.0 constant and the N221204 preset of v3.0.0 still give the v3.0.0 yield; the one input that changed with
 * it is the fuel mass of the NIF presets, 220 -> 210 µg); and the blind predictions are what they are, a model that runs the same
 * capsule for every shot of the platform.
 */
import { describe, expect, it } from 'vitest';
import { ICF_CAL, icfFuelData, icfStagnation } from './icf';
import { ICF_CALIBRATION_SHOT, calibrateRhoRScale } from './icfCalibration';
import { DIRECT_DRIVE, NIF, NIF_N210808, PRESETS } from '../presets';
import { Simulation } from '../simulation';

const MJ = 1e6;

describe('ICF_CAL is the root of E_fus = 1.37 MJ for the N210808 capsule', () => {
  it('the calibration shot is N210808 with the yield and laser energy of Abu-Shawareb et al. 2022, table I', () => {
    expect(ICF_CALIBRATION_SHOT).toMatchObject({ shot: 'N210808', yield_MJ: 1.37, E_laser_MJ: 1.917, doi: '10.1103/PhysRevLett.129.075001' });
    expect(NIF_N210808.E_laser_MJ).toBe(ICF_CALIBRATION_SHOT.E_laser_MJ);
  });

  it('the root solve reproduces the stored constant (0.03931, four significant digits) from the preset', () => {
    const root = calibrateRhoRScale(NIF_N210808, ICF_CALIBRATION_SHOT.yield_MJ * MJ);
    expect(root).toBeCloseTo(0.0393107, 6);
    expect(Math.abs(ICF_CAL / root - 1)).toBeLessThan(1e-3); // the constant is the root rounded to four digits
    expect(ICF_CAL).toBe(Number(root.toPrecision(4)));
  });

  it('the model with the stored constant gives the calibration yield (to the rounding of the constant) for the N210808 preset, and G = 0.715 against the published 0.72', () => {
    const r = new Simulation(NIF_N210808).runAll();
    expect(Math.abs(r.E_fusion_MJ / ICF_CALIBRATION_SHOT.yield_MJ - 1)).toBeLessThan(1e-3);
    expect(r.Q_sci_max).toBeCloseTo(ICF_CALIBRATION_SHOT.yield_MJ / ICF_CALIBRATION_SHOT.E_laser_MJ, 3);
    expect(Math.abs(r.Q_sci_max / 0.72 - 1)).toBeLessThan(0.01);
    // the published gain of the shot is 0.72, the yield over the laser energy of table I is 0.7147
    expect(ICF_CALIBRATION_SHOT.yield_MJ / ICF_CALIBRATION_SHOT.E_laser_MJ).toBeCloseTo(0.7147, 4);
  });

  it('the solve is exact for any target the model can reach, on the ignited branch and below the cliff', () => {
    for (const scale of [0.005, 0.02, 0.03931, 0.05, 0.0705, 0.07, 0.2, 1.3]) {
      const target = icfStagnation(NIF_N210808, scale).E_fus_total;
      expect(Math.abs(calibrateRhoRScale(NIF_N210808, target) / scale - 1), `scale ${scale}`).toBeLessThan(1e-9);
    }
    // the ignition threshold of this capsule: χ_ig = 1 at ICF_CAL ≈ 0.0413 (above N210808's 0.03931), and the yield is continuous across it
    const edge = 0.03931 / icfStagnation(NIF_N210808).chi_ig;
    expect(icfStagnation(NIF_N210808, edge * (1 - 1e-9)).ignited).toBe(false);
    expect(icfStagnation(NIF_N210808, edge * (1 + 1e-9)).ignited).toBe(true);
    const below = icfStagnation(NIF_N210808, edge * (1 - 1e-9)).E_fus_total, above = icfStagnation(NIF_N210808, edge * (1 + 1e-9)).E_fus_total;
    expect(Math.abs(above / below - 1)).toBeLessThan(1e-6);
  });

  it('the yield is strictly increasing in the constant, so the root is unique', () => {
    let prev = -Infinity;
    for (let k = 0; k <= 400; k++) {
      const e = icfStagnation(NIF_N210808, Math.exp(Math.log(1e-3) + (Math.log(5) * k) / 400)).E_fus_total;
      expect(e).toBeGreaterThan(prev);
      prev = e;
    }
  });

  it('rejects a target that no constant between 1e-4 and 10 reaches, and a target that is not a positive number', () => {
    expect(() => calibrateRhoRScale(NIF_N210808, 1e12)).toThrow(/not reachable/);
    expect(() => calibrateRhoRScale(NIF_N210808, 1e-6)).toThrow(/not reachable/);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => calibrateRhoRScale(NIF_N210808, bad)).toThrow(/positive and finite/);
  });

  it('the constant moves 0.8 % for the 1.33 MJ of the later analysis (Pak et al. 2024, 1.33 ± 0.13 MJ) and 6 % for ±10 µg of fuel mass', () => {
    const at = (cfg: typeof NIF_N210808, y: number) => calibrateRhoRScale(cfg, y * MJ);
    const base = at(NIF_N210808, 1.37);
    expect(at(NIF_N210808, 1.33) / base - 1).toBeCloseTo(-0.0075, 3);
    expect(at(NIF_N210808, 1.35) / base - 1).toBeCloseTo(-0.0037, 3);
    expect(at({ ...NIF_N210808, fuelMass_ug: 200 }, 1.37) / base - 1).toBeCloseTo(0.063, 2);
    expect(at({ ...NIF_N210808, fuelMass_ug: 220 }, 1.37) / base - 1).toBeCloseTo(-0.0565, 3);
  });
});

describe('the model constants other than ICF_CAL are unchanged', () => {
  it('the D-T burn data are those of v3.0.0: H_B = 7 g/cm², 17.589 MeV, one neutron per reaction, ignition scale 1', () => {
    expect(icfFuelData('DT')).toMatchObject({ H_B: 7, E_rx_MeV: expect.closeTo(17.589, 10), neutronsPerReaction: 1, ignitionScale: 1 });
  });

  it('the v3.0.0 constant (0.07) with the v3.0.0 N221204 preset (220 µg) still gives the v3.0.0 yield, 3.0516 MJ, G = 1.489', () => {
    const v3 = icfStagnation({ ...NIF, fuelMass_ug: 220 }, 0.07);
    // the maximum of E_fus_MJ in the golden NIF file of v3.0.0 and of the integration branch (3.0515684775243748 MJ, integrated in time)
    expect(Math.abs(v3.E_fus_total / 3.0515684775243748e6 - 1)).toBeLessThan(1e-12);
    expect(v3.E_fus_total / (2.05 * MJ)).toBeCloseTo(1.4889, 3);
    expect(v3.chi_ig).toBeCloseTo(1.7745, 4);
    expect(v3.ignited).toBe(true);
  });

  it('the one input that did change is the NIF fuel mass, 220 -> 210 µg (v3.0.0 -> v4.0), set from the post-shot analysis of N221204 itself: it moves the constant by 5.7 %', () => {
    expect(NIF.fuelMass_ug).toBe(210);
    expect(NIF_N210808.fuelMass_ug).toBe(210);
    const base = calibrateRhoRScale(NIF_N210808, 1.37 * MJ);
    expect(calibrateRhoRScale({ ...NIF_N210808, fuelMass_ug: 220 }, 1.37 * MJ) / base - 1).toBeCloseTo(-0.0565, 3);
    // so the v3.0.0 mass (220 µg) does not give the calibration yield with the calibrated constant
    expect(icfStagnation({ ...NIF, fuelMass_ug: 220 }, ICF_CAL).E_fus_total).not.toBe(icfStagnation(NIF).E_fus_total);
  });

  it('what the calibrated constant does to the other shots and presets: every shot of the platform runs the same capsule, χ_ig = 0.951 is 5 % below the model threshold', () => {
    const s = icfStagnation(NIF_N210808);
    expect(s).toMatchObject({ ignited: false });
    expect(s.chi_ig).toBeCloseTo(0.9512, 4);
    expect(s.rhoR_eff).toBeCloseTo(0.1609, 4);
    expect(s.Phi).toBeCloseTo(0.02247, 5);
    expect(s.T_hs).toBeCloseTo(1.32, 2); // below the threshold the hot spot is the kinematic one
    // the three shots differ in laser energy and ablator mass only, which the yield does not depend on
    expect(icfStagnation(NIF).E_fus_total).toBe(s.E_fus_total);
    expect(icfStagnation({ ...NIF, E_laser_MJ: 3, ablatorMass_ug: 9000 }).E_fus_total).toBe(s.E_fus_total);
  });
});

describe('blind predictions of the calibrated model', () => {
  const run = (cfg: typeof NIF) => new Simulation(cfg).runAll();

  it('N221204 (3.15 MJ from 2.05 MJ, G = 1.5) is predicted as G = 0.668, a yield of 1.37 MJ: 0.43 of the published yield', () => {
    const r = run(NIF);
    expect(r.Q_sci_max).toBeCloseTo(0.668, 3);
    expect(r.E_fusion_MJ).toBeCloseTo(1.37, 3);
    expect(r.E_fusion_MJ / 3.15).toBeCloseTo(0.435, 3);
    expect(r.Q_sci_max / 1.5).toBeCloseTo(0.4456, 3);
    expect(r.Q_sci_max).toBeLessThan(1); // below scientific breakeven, which N221204 exceeded
  });

  it('N230729 (3.88 MJ from 2.05 MJ, G = 1.89) gets the same prediction: 0.35 of the published yield', () => {
    const r = run(NIF);
    expect(r.E_fusion_MJ / 3.88).toBeCloseTo(0.353, 3);
    expect(r.Q_sci_max / (3.88 / 2.05)).toBeCloseTo(0.353, 3);
  });

  it('the wizard card of the NIF preset states the miss with the model value it has, not a bare "published G = 1.5"', () => {
    const nif = PRESETS.find((p) => p.id === 'NIF')!;
    expect(nif.validation).toContain(`model ${run(NIF).Q_sci_max.toFixed(2)}`);
    expect(nif.validation).toMatch(/documented miss/);
  });

  it('the direct-drive preset, never calibrated, drops from G = 3.10 to 0.39 as a side effect of the shared constant (its capsule falls below the threshold, χ_ig = 0.61)', () => {
    expect(icfStagnation(DIRECT_DRIVE, 0.07).E_fus_total / (DIRECT_DRIVE.E_laser_MJ * MJ)).toBeCloseTo(3.096, 3);
    const s = icfStagnation(DIRECT_DRIVE);
    expect(s.ignited).toBe(false);
    expect(s.chi_ig).toBeCloseTo(0.605, 2);
    expect(run(DIRECT_DRIVE).Q_sci_max).toBeCloseTo(0.391, 3);
  });
});
