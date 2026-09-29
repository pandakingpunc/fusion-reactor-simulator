/**
 * The radial builds and design data the presets carry (lane ws2d): SPARC and DEMO inboard TF legs and gaps, the plant pulses, the solenoids. The
 * numbers are those of the sources cited in presets.ts; the tests pin them and the reading of the model on them, not the physics of a run.
 */
import { describe, expect, it } from 'vitest';
import { C } from '../constants';
import { DEMO, DEMO_15D, ITER, ITER_15D, JET, SPARC, SPARC_15D } from '../presets';
import type { MagneticConfig } from '../types';
import { assessSystems, systemsReportKeys } from './assess';
import { csFluxSwing } from './csFlux';

const inputOf = (cfg: MagneticConfig, Pfus: number) => ({
  cfg, g: cfg.geometry, isStellarator: false, P_fus_MW: Pfus, P_neutron_MW: 0.8 * Pfus,
});

describe('SPARC: the build of Figure 2 of Creely et al. (2020)', () => {
  const s = assessSystems(inputOf(SPARC, 200));

  it('the TF leg is the band R = 0.735 to 1.060 m of the V2 cross-section, 0.22 m from the plasma', () => {
    expect(SPARC.magnet.coilThickness_m).toBe(0.325);
    expect(SPARC.magnet.gap_m).toBe(0.22);
    expect(s.tf.r_o).toBeCloseTo(1.06, 12);
    expect(s.tf.r_c).toBeCloseTo(0.735, 12);
    expect(s.tf.r_o).toBeCloseTo(SPARC.geometry.R - SPARC.geometry.a - SPARC.magnet.gap_m, 12);
  });

  it('the field on the conductor is the 21 to 22 T that Hartwig et al. (2024) quote for 12.2 T on axis, and below the 23 T of the technology', () => {
    expect(s.tf.B_peak_T).toBeCloseTo((12.2 * 1.85) / 1.06, 12);
    expect(s.tf.B_peak_T).toBeGreaterThan(21);
    expect(s.tf.B_peak_T).toBeLessThan(22);
  });

  it('the published build is over the stress limit of this model, and the note says why (a free cylinder, a 316LN-class allowable)', () => {
    expect(s.tf.overstress).toBe(true);
    expect(s.tf.tresca_MPa).toBeGreaterThan(1000);
    expect(s.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(true);
    expect(s.tf.notes.join(' ')).toContain('bucking');
    // a thicker leg at the same gap does lower the stress: the model is not blind to the build
    const thick = assessSystems(inputOf({ ...SPARC, magnet: { ...SPARC.magnet, coilThickness_m: 0.6 } }, 200));
    expect(thick.tf.tresca_MPa).toBeLessThan(s.tf.tresca_MPa);
  });

  it('18 coils, a plant pulse of 31 s (ramp-up 8.5 s, flat top 10 s, ramp-down 12 s in Figure 3) and the solenoid of Figure 2', () => {
    expect(s.tf.nCoils).toBe(18);
    expect(s.pulseLength_s).toBe(31);
    expect(SPARC.systems).toEqual({ pulseLength_s: 31, tf: { nCoils: 18 }, cs: { outerRadius_m: 0.681, thickness_m: 0.276, height_m: 3.8 } });
    expect(s.cs!.r_o).toBe(0.681);
    expect(s.cs!.r_i).toBeCloseTo(0.405, 12);
    // the swing is that of the geometry and the 23 T of the technology; the CS and PF set of Creely et al. quotes 42 Wb
    expect(s.cs!.psiCS_Vs).toBeCloseTo(csFluxSwing(0.405, 0.681, 23), 9);
    expect(s.cs!.psiCS_Vs).toBeGreaterThan(38);
    expect(s.cs!.psiCS_Vs).toBeLessThan(48);
    expect(s.csGiven).toBe(true);
  });

  it('the 1.5D preset carries the same build', () => {
    expect(SPARC_15D.magnet).toEqual(SPARC.magnet);
    expect(SPARC_15D.systems).toEqual(SPARC.systems);
  });
});

describe('DEMO: the 2018 baseline of Federici et al. (2019)', () => {
  const s = assessSystems(inputOf(DEMO, 2000));

  it('the gap gives the 12.1 T on the conductor of table 3, the leg is the 1.3 m of its text, 16 coils', () => {
    expect(DEMO.magnet).toMatchObject({ tech: 'Nb3Sn', gap_m: 1.75, coilThickness_m: 1.3 });
    expect(s.tf.B_peak_T).toBeGreaterThan(12.0);
    expect(s.tf.B_peak_T).toBeLessThan(12.2);
    expect(s.tf.nCoils).toBe(16);
    expect(s.tf.limit_MPa).toBe(660); // the 660 MPa Tresca criterion of table 3
  });

  it('the published leg is inside the stress limit of the model: no permanent TF coil warning any more', () => {
    expect(s.tf.overstress).toBe(false);
    expect(s.tf.tresca_MPa).toBeGreaterThan(450);
    expect(s.tf.tresca_MPa).toBeLessThan(660);
    expect(s.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(false);
  });

  it('the radial build reproduces the published inboard blanket (0.755 m) and shield with the vessel (0.600 m) within 3 % and 5 %', () => {
    expect(s.build.blanketInboard_m).toBeGreaterThan(0.755 * 0.97);
    expect(s.build.blanketInboard_m).toBeLessThan(0.755 * 1.03);
    expect(s.build.shieldInboard_m).toBeGreaterThan(0.6 * 0.95);
    expect(s.build.shieldInboard_m).toBeLessThan(0.6 * 1.05);
    expect(s.build.compressed).toBe(false);
  });

  it('a plant pulse of 2 h, and the solenoid of table 3: 13 T on the conductor, 320 Wb of the flux from the PF system', () => {
    expect(s.pulseLength_s).toBe(7200);
    expect(DEMO.systems!.cs).toEqual({ B_max_T: 13, pfFlux_Vs: 320 });
    expect(s.cs!.B_max_T).toBe(13);
    expect(s.cs!.psiPF_Vs).toBe(320);
    expect(s.csGiven).toBe(true);
  });

  it('the TF nuclear heating is tens of kW, the 44.5 kW of the PROCESS unit test for the 2018 baseline within a factor 2', () => {
    expect(s.nuclearHeating_W).toBeGreaterThan(2e4);
    expect(s.nuclearHeating_W).toBeLessThan(9e4);
  });

  it('the 1.5D preset carries the same build', () => {
    expect(DEMO_15D.magnet).toEqual(DEMO.magnet);
    expect(DEMO_15D.systems).toEqual(DEMO.systems);
  });
});

describe('ITER and JET: the design data of the report', () => {
  it('ITER: a plant pulse of 500 s (Casper 2014: 300 to 500 s of burn) and the solenoid of 1.3 to 2.08 m at 13 T: 237 V s', () => {
    const s = assessSystems(inputOf(ITER, 500));
    expect(s.pulseLength_s).toBe(500);
    expect(s.cs!.r_i).toBeCloseTo(1.3, 12);
    expect(s.cs!.r_o).toBe(2.08);
    expect(s.cs!.J_cs_Am2 / 1e6).toBeCloseTo(13.26, 1); // the 1.33e7 A/m2 of the ITER CS
    expect(s.cs!.psiCS_Vs).toBeCloseTo(237.4, 0);
    // the solenoid alone comes within 12 % of the 266.6 V s quoted for it; the pulse needs about 245 V s in this model
    expect(s.cs!.psiCS_Vs / 266.6).toBeGreaterThan(0.88);
    expect(s.cs!.margin).toBeGreaterThan(-0.15);
    expect(s.warnings.some((w) => w.startsWith('CS flux swing'))).toBe(false);
    expect(ITER_15D.systems).toEqual(ITER.systems);
  });

  it('JET has an iron-core transformer: no solenoid block, so no swing and no margin are published, only the flux the pulse needs', () => {
    expect(JET.systems).toBeUndefined();
    const s = assessSystems(inputOf(JET, 12));
    expect(s.csGiven).toBe(false);
    const k = systemsReportKeys(s);
    expect(k['CS flux swing (V s)']).toBeUndefined();
    expect(k['Flux margin']).toBeUndefined();
    expect(k['Flux required (V s)']).toBeGreaterThan(10);
  });
});

describe('systems.cs: outer radius, thickness and height of the solenoid', () => {
  const base: MagneticConfig = { ...ITER, systems: undefined };
  it('are used instead of the solenoid that fits the TF nose, and a thickness fixes the current density', () => {
    const plain = assessSystems(inputOf(base, 500));
    expect(plain.csGiven).toBe(false);
    expect(plain.cs!.r_o).toBeCloseTo(plain.tf.r_c - 0.115, 12);
    const s = assessSystems(inputOf({ ...base, systems: { cs: { outerRadius_m: 2.0, thickness_m: 0.5, height_m: 10, B_max_T: 12 } } }, 500));
    expect(s.cs!.r_o).toBe(2.0);
    expect(s.cs!.r_i).toBeCloseTo(1.5, 12);
    expect(s.cs!.J_cs_Am2 / (12 / (C.mu0 * 0.5))).toBeCloseTo(1, 9);
    expect(s.cs!.psiCS_Vs).toBeCloseTo(csFluxSwing(1.5, 2.0, 12), 9);
    const tall = assessSystems(inputOf({ ...base, systems: { cs: { outerRadius_m: 2.0, thickness_m: 0.5, height_m: 20, B_max_T: 12 } } }, 500));
    expect(tall.cs!.mass_kg / s.cs!.mass_kg).toBeCloseTo(2, 12);
    // the thickness takes precedence over a given current density
    const both = assessSystems(inputOf({ ...base, systems: { cs: { outerRadius_m: 2.0, thickness_m: 0.5, currentDensity_MAm2: 50, B_max_T: 12 } } }, 500));
    expect(both.cs!.r_i).toBeCloseTo(1.5, 12);
  });
});
