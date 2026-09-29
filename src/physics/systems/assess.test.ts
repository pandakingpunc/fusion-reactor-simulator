/**
 * Systems-lite assessment (lane ws7b): the API of the facade (`engineering.ts`), `checkMagnet` compatibility with v3, the orchestrator
 * and the report keys, and the shot report of a short ITER run.
 */
import { describe, expect, it } from 'vitest';
import { C } from '../constants';
import { MAGNET_TECH, checkMagnet, economics, neutronWallLoad, tritiumBreedingRatio } from '../engineering';
import * as systems from './index';
import { ITER, JET, SPARC, W7X, DEMO } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';
import { assessSystems, PF_FLUX_SHARE_MAX, systemsReportKeys } from './assess';

const MU0 = C.mu0;

const inputOf = (cfg: MagneticConfig, over: Partial<Parameters<typeof assessSystems>[0]> = {}) => ({
  cfg, g: cfg.geometry, isStellarator: cfg.method === 'stellarator', P_fus_MW: 500, P_neutron_MW: 400, duration_s: 400, ...over,
});

describe('engineering.ts facade and checkMagnet', () => {
  it('keeps the magnet technology table of v3', () => {
    expect(MAGNET_TECH.Nb3Sn).toMatchObject({ Bmax_coil: 13, stress_MPa: 660, cryo_W_per_W: 300, cost_rel: 1 });
    expect(MAGNET_TECH.REBCO).toMatchObject({ Bmax_coil: 23, stress_MPa: 800, cryo_W_per_W: 40, cost_rel: 1.6 });
    expect(MAGNET_TECH.Cu).toMatchObject({ Bmax_coil: 9, stress_MPa: 300, cryo_W_per_W: 0 });
    expect(MAGNET_TECH.NbTi).toMatchObject({ Bmax_coil: 8.5, stress_MPa: 660, cryo_W_per_W: 300 });
    expect(typeof economics).toBe('function');
    expect(typeof neutronWallLoad).toBe('function');
    expect(typeof tritiumBreedingRatio).toBe('function');
  });

  it('the peak field and the quench check are those of v3: B0 R / (R - a - gap) against the technology limit', () => {
    const g = ITER.geometry;
    const m = checkMagnet(g, ITER.B0, 'Nb3Sn', 1.3, 0.9);
    expect(m.B_coil).toBeCloseTo((5.3 * 6.2) / (6.2 - 2 - 1.3), 12);
    expect(m.quench).toBe(false);
    expect(m.B_max).toBe(13);
    expect(m.stress_limit).toBe(660);
    expect(checkMagnet(g, ITER.B0, 'NbTi', 1.3, 0.9).quench).toBe(true); // 11.3 T > 8.5 T
    expect(m.tf.B_peak_T).toBeCloseTo(m.B_coil, 12);
    // the second call with options changes the stress, not the peak field
    const m2 = checkMagnet(g, ITER.B0, 'Nb3Sn', 1.3, 0.9, { nCoils: 16, noseFraction: 0.6 });
    expect(m2.B_coil).toBe(m.B_coil);
    expect(m2.stress_MPa).not.toBe(m.stress_MPa);
  });

  it('the stress of ITER is a Tresca stress of several hundred MPa (the thin-ring estimate of v3 gave 82 MPa)', () => {
    const m = checkMagnet(ITER.geometry, ITER.B0, 'Nb3Sn', 1.3, 0.9);
    const pmag = (m.B_coil * m.B_coil) / (2 * MU0) / 1e6;
    const thinRing = pmag * (2.9 / 0.9) * 0.5;
    expect(thinRing).toBeCloseTo(82, 0);
    expect(m.stress_MPa).toBeGreaterThan(4 * thinRing);
    expect(m.overstress).toBe(false);
    expect(m.storedEnergy_GJ).toBeCloseTo(m.tf.W_J / 1e9, 12);
  });

  it('the systems index re-exports the models', () => {
    expect(typeof systems.tfCoil).toBe('function');
    expect(typeof systems.fluxBudget).toBe('function');
    expect(typeof systems.cryoPlant).toBe('function');
    expect(typeof systems.radialBuild).toBe('function');
    expect(typeof systems.assessSystems).toBe('function');
    expect(systems.MAGNET_TECH).toBe(MAGNET_TECH);
  });
});

describe('assessSystems', () => {
  it('ITER: every subsystem is present and in its literature range', () => {
    const s = assessSystems(inputOf(ITER));
    expect(s.tf.tresca_MPa).toBeGreaterThan(300);
    expect(s.tf.overstress).toBe(false);
    expect(s.cs).not.toBeNull();
    expect(s.tbr).toBeGreaterThan(1.0);
    expect(s.tbr).toBeLessThan(1.25);
    expect(s.cryo.P_cryo_MW).toBeGreaterThan(9);
    expect(s.cryo.P_cryo_MW).toBeLessThan(45);
    expect(s.nuclearHeating_W).toBeGreaterThan(1e3);
    expect(s.build.inboardTotal_m).toBeCloseTo(1.3, 12);
    // the plasma-side TF case of the radial build is the third layer of the stress model
    expect(s.build.inboard[s.build.inboard.length - 1].thickness_m).toBeCloseTo(s.tf.plasmaCase_m, 12);
    expect(s.coldMass_kg).toBeGreaterThan(s.tf.totalMass_kg);
    expect(s.warnings).toEqual([]);
  });

  it('the TBR falls with the coverage and with a thinner blanket, and rises with the enrichment', () => {
    const base = assessSystems(inputOf(ITER)).tbr;
    expect(assessSystems(inputOf({ ...ITER, blanket: { ...ITER.blanket, coverage: 0.6 } })).tbr).toBeLessThan(base);
    expect(assessSystems(inputOf({ ...ITER, blanket: { ...ITER.blanket, li6_enrichment: 0.9 } })).tbr).toBeGreaterThan(base);
    expect(assessSystems(inputOf({ ...ITER, systems: { blanket: { inboardDepth_m: 0.2 } } })).tbr).toBeLessThan(base);
    expect(assessSystems(inputOf({ ...ITER, systems: { blanket: { breederFraction: 0.9 } } })).tbr).toBeLessThan(base);
  });

  it('without a blanket: TBR 0, no breeding keys; SPARC has a superconducting plant and a large TF stress', () => {
    const s = assessSystems(inputOf(SPARC, { P_fus_MW: 170 }));
    expect(s.tbr).toBe(0);
    expect(s.cryo.P_cryo_MW).toBeGreaterThan(0);
    expect(s.notes.join(' ')).toContain('extrapolated');
    const keys = systemsReportKeys(s);
    expect(keys['Inboard blanket (m)']).toBeUndefined();
    expect(keys['Cryoplant power (MW)']).toBeGreaterThan(0);
    expect(s.tf.overstress).toBe(s.warnings.some((w) => w.startsWith('TF coil stress')));
  });

  it('copper coils have no cryoplant and no nuclear heating keys', () => {
    const s = assessSystems(inputOf(JET, { P_fus_MW: 12 }));
    expect(s.cryo.Q_total_W).toBe(0);
    expect(s.nuclearHeating_W).toBe(0);
    const keys = systemsReportKeys(s);
    expect(keys['Cryoplant power (MW)']).toBeUndefined();
    expect(keys['TF coils']).toBe(24);
  });

  it('a stellarator has modular coils (50 by default) and no solenoid', () => {
    const s = assessSystems(inputOf(W7X, { P_fus_MW: 0, P_neutron_MW: 0 }));
    expect(s.cs).toBeNull();
    expect(s.tf.nCoils).toBe(50);
    expect(s.notes.join(' ')).toContain('stellarator');
    const keys = systemsReportKeys(s);
    expect(keys['CS flux swing (V s)']).toBeUndefined();
  });

  it('the configuration overrides reach the models', () => {
    const cfg: MagneticConfig = { ...ITER, systems: { tf: { nCoils: 16, noseFraction: 0.5 }, cs: { B_max_T: 12, pfFlux_Vs: 30, li: 1.0 }, blanket: { inboardDepth_m: 0.4 } } };
    const s = assessSystems(inputOf(cfg));
    expect(s.tf.nCoils).toBe(16);
    expect(s.tf.r_i - s.tf.r_c).toBeCloseTo(0.5 * 0.9, 12);
    expect(s.cs!.B_max_T).toBe(12);
    expect(s.cs!.psiPF_Vs).toBe(30);
    expect(s.build.blanketInboard_m).toBe(0.4);
  });

  it('the CS flux is checked (warning) only when the design gives the solenoid', () => {
    const tiny: MagneticConfig = { ...ITER, systems: { cs: { currentDensity_MAm2: 5 } } };
    const s = assessSystems(inputOf(tiny));
    expect(s.cs!.psiCS_Vs).toBeLessThan((1 - PF_FLUX_SHARE_MAX) * s.cs!.psiRequired_Vs);
    expect(s.warnings.some((w) => w.startsWith('CS flux swing'))).toBe(true);
    // the same solenoid without the systems.cs block is reported but not flagged
    const plain = assessSystems(inputOf({ ...ITER, magnet: { ...ITER.magnet, coilThickness_m: 0.9 } }));
    expect(plain.warnings.some((w) => w.startsWith('CS flux swing'))).toBe(false);
  });

  it('report keys are finite numbers and the margin follows the stress', () => {
    const s = assessSystems(inputOf(DEMO, { P_fus_MW: 2000 }));
    const keys = systemsReportKeys(s);
    for (const [k, v] of Object.entries(keys)) expect(isFinite(v), k).toBe(true);
    expect(keys['TF stress margin']).toBeLessThan(0); // the DEMO preset's 1.0 m leg is over the 660 MPa limit in this model
    expect(s.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(true);
  });
});

describe('shot report of a short ITER run', () => {
  const cfg: MagneticConfig = { ...ITER, t_end: 60 };
  const sim = new Simulation(cfg);
  const r = sim.runAll();
  const e = r.engineering;

  it('keeps the v3 keys of the engineering block', () => {
    for (const k of [
      'B_coil (T)', 'Technology B_max (T)', 'TF stress (MPa)', 'Stress limit (MPa)', 'Magnetic energy (GJ)', 'Divertor q_max (MW/m²)',
      'Neutron wall load (MW/m²)', 'dpa/year', 'TBR', 'Tritium burn fraction', 'Avg. P_fusion (MW)', 'P_thermal (MW)', 'Gross P_electric (MW)',
      'P_recirculating (MW)', 'Net P_electric (MW)', 'Capital cost (M$)', 'LCOE ($/MWh)', 'EROI',
    ]) expect(e[k], k).toBeDefined();
    expect(e['Stress limit (MPa)']).toBe(660);
  });

  it('adds the systems-lite keys with values in the literature ranges', () => {
    expect(e['TF stress (MPa)']).toBeGreaterThan(300);
    expect(e['TF stress (MPa)']).toBeLessThan(660);
    expect(e['TF coils']).toBe(18);
    expect(e['TF case Tresca (MPa)']).toBe(e['TF stress (MPa)']);
    expect(e['Magnetic energy (GJ)']).toBeGreaterThan(35);
    expect(e['Magnetic energy (GJ)']).toBeLessThan(47);
    expect(e['Cryoplant power (MW)']).toBeGreaterThan(9);
    expect(e['CS flux swing (V s)']).toBeGreaterThan(100);
    expect(e['Flux required (V s)']).toBeGreaterThan(150);
    expect(e['Inboard blanket (m)']).toBeGreaterThan(0.3);
    expect(e['TBR']).toBeGreaterThan(1.0);
    expect(e['TBR']).toBeLessThan(1.25);
  });

  it('recirculating power contains the cryoplant', () => {
    // 0.05 P_fus + 20 MW house load + cryoplant + heating wall-plug power
    const Pfus = e['Avg. P_fusion (MW)'] as number;
    expect(e['P_recirculating (MW)']).toBeGreaterThan(0.05 * Pfus + 20 + (e['Cryoplant power (MW)'] as number) - 1);
  });
});
