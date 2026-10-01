/**
 * Systems-lite assessment (lane ws7b): the API of the facade (`engineering.ts`), `checkMagnet` compatibility with v3, the orchestrator
 * and the report keys, and the shot report of a short ITER run.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { C } from '../constants';
import { MAGNET_TECH, checkMagnet, economics, neutronWallLoad, tritiumBreedingRatio } from '../engineering';
import * as systems from './index';
import { ITER, JET, SPARC, W7X, DEMO } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';
import { assessSystems, PF_FLUX_SHARE_MAX, systemsReportKeys } from './assess';
import { DEFAULT_PULSE_LENGTH_S } from './cryo';

const MU0 = C.mu0;

/** ITER without the design data of the preset (pulse, solenoid): what a configuration that gives none of them gets */
const ITER_PLAIN: MagneticConfig = { ...ITER, systems: undefined };

const inputOf = (cfg: MagneticConfig, over: Partial<Parameters<typeof assessSystems>[0]> = {}) => ({
  cfg, g: cfg.geometry, isStellarator: cfg.method === 'stellarator', P_fus_MW: 500, P_neutron_MW: 400, ...over,
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
    // whatever the verdict on a preset's own leg thickness is (the presets are reviewed on their own, not pinned here), the report
    // keys are finite and the sign of the margin and the warning follow the stress against the technology limit
    for (const cfg of [DEMO, SPARC, ITER]) {
      const s = assessSystems(inputOf(cfg, { P_fus_MW: 2000 }));
      const keys = systemsReportKeys(s);
      for (const [k, v] of Object.entries(keys)) expect(isFinite(v), `${k} of ${cfg.geometry.R} m`).toBe(true);
      expect(Math.sign(keys['TF stress margin'])).toBe(Math.sign(MAGNET_TECH[cfg.magnet.tech].stress_MPa - s.tf.tresca_MPa));
      expect(s.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(s.tf.overstress);
    }
  });

  it('a thin inboard leg is over the stress limit (negative margin, warning); the ITER leg is not', () => {
    const thin: MagneticConfig = { ...ITER, magnet: { ...ITER.magnet, coilThickness_m: 0.3 } };
    const s = assessSystems(inputOf(thin));
    expect(s.tf.tresca_MPa).toBeGreaterThan(MAGNET_TECH[thin.magnet.tech].stress_MPa);
    expect(systemsReportKeys(s)['TF stress margin']).toBeLessThan(0);
    expect(s.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(true);
    const iter = assessSystems(inputOf(ITER));
    expect(systemsReportKeys(iter)['TF stress margin']).toBeGreaterThan(0);
    expect(iter.warnings.some((w) => w.startsWith('TF coil stress'))).toBe(false);
  });
});

describe('pulsed-field load of the cryoplant follows the design pulse of the plant', () => {
  it('defaults to the PROCESS-time plant pulse, reports it and says so in the notes', () => {
    const s = assessSystems(inputOf(ITER_PLAIN));
    expect(s.pulseLength_s).toBe(DEFAULT_PULSE_LENGTH_S);
    expect(DEFAULT_PULSE_LENGTH_S).toBe(1055);
    expect(s.cryo.Q_ac_W).toBeGreaterThan(0);
    expect(s.notes.join(' ')).toContain('systems.pulseLength_s');
    expect(systemsReportKeys(s)['Cryo pulse length (s)']).toBe(1055);
  });

  it('the AC load is inversely proportional to systems.pulseLength_s, every other heat load is unchanged', () => {
    const a = assessSystems(inputOf({ ...ITER, systems: { pulseLength_s: 1000 } }));
    const b = assessSystems(inputOf({ ...ITER, systems: { pulseLength_s: 4000 } }));
    expect(a.pulseLength_s).toBe(1000);
    expect(a.cryo.Q_ac_W / b.cryo.Q_ac_W).toBeCloseTo(4, 12);
    expect(a.cryo.Q_static_W).toBe(b.cryo.Q_static_W);
    expect(a.cryo.Q_leads_W).toBe(b.cryo.Q_leads_W);
    expect(a.cryo.Q_nuclear_W).toBe(b.cryo.Q_nuclear_W);
    expect(a.cryo.P_cryo_MW).toBeGreaterThan(b.cryo.P_cryo_MW);
    // a given pulse is not a default: no note that asks for one
    expect(a.notes.join(' ')).not.toContain('give systems.pulseLength_s');
  });

  it('the pulse of the call overrides the pulse of the configuration', () => {
    const s = assessSystems(inputOf({ ...ITER, systems: { pulseLength_s: 1000 } }, { pulseLength_s: 2000 }));
    expect(s.pulseLength_s).toBe(2000);
  });

  it('a non-positive or non-finite pulse falls back to the default with a note, no division by a shot length', () => {
    const ref = assessSystems(inputOf(ITER_PLAIN));
    for (const bad of [0, -5, NaN, Infinity]) {
      const s = assessSystems(inputOf({ ...ITER, systems: { pulseLength_s: bad } }));
      expect(s.pulseLength_s, String(bad)).toBe(DEFAULT_PULSE_LENGTH_S);
      expect(s.cryo.Q_ac_W, String(bad)).toBe(ref.cryo.Q_ac_W);
      expect(s.notes.join(' '), String(bad)).toContain('not a positive number');
    }
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

describe('the engineering report of a machine does not depend on the simulated length of the shot', () => {
  // Regression (review of ws7b): the pulsed-field load of the cryoplant used to be divided by the simulated time, so the same ITER
  // reported a 108 MW cryoplant for t_end = 20 s, 60 MW for 60 s and 35 MW for 400 s, and net electric power from -117 to +13 MW.
  // What may still differ with the run is what is measured from the shot: the flat-top mean fusion power (a 20 s run has not reached
  // the burn) and through it the nuclear heating of the coils and the fusion-proportional house load.
  const reports: Record<string, Record<string, number | string | boolean>> = {};
  const runs: Record<string, Partial<MagneticConfig>> = {
    't20': { t_end: 20 },
    't60': { t_end: 60 },
    't400': { t_end: 400 },
    // a shot that is aborted after 0.35 s: the density-limit disruption ends it long before t_end
    'aborted': { t_end: 400, limits: { ...ITER.limits, greenwald_limit: 0.3 } },
  };
  beforeAll(() => {
    for (const [k, over] of Object.entries(runs)) reports[k] = new Simulation({ ...ITER, ...over }).runAll().engineering;
  }, 240_000);

  /** the part of the heat load that belongs to the machine: static + AC + leads = Q / 1.45 - Q_nuclear [kW] */
  const machineLoad = (e: Record<string, number | string | boolean>) => (e['Cryo heat load (kW)'] as number) / 1.45 - (e['TF nuclear heating (kW)'] as number);

  it('the plant pulse of the cryoplant is the design pulse of the preset (500 s) for every t_end and for an aborted shot', () => {
    for (const k of Object.keys(runs)) expect(reports[k]['Cryo pulse length (s)'], k).toBe(ITER.systems!.pulseLength_s);
    expect(ITER.systems!.pulseLength_s).toBe(500);
  });

  it('static, pulsed-field and lead loads are those of the machine: equal for every t_end and for an aborted shot (to the rounding of the keys)', () => {
    const ref = machineLoad(reports['t400']);
    for (const k of Object.keys(runs)) expect(Math.abs(machineLoad(reports[k]) - ref), k).toBeLessThan(0.1);
  });

  it('ITER: recirculating power and cryoplant power at t_end = 60 s and 400 s agree (2.5 % and 6 %; the rest is the flat-top mean fusion power)', () => {
    const a = reports['t60'], b = reports['t400'];
    expect(Math.abs((a['P_recirculating (MW)'] as number) / (b['P_recirculating (MW)'] as number) - 1)).toBeLessThan(0.025);
    expect(Math.abs((a['Cryoplant power (MW)'] as number) / (b['Cryoplant power (MW)'] as number) - 1)).toBeLessThan(0.06);
  });

  it('an aborted shot has the cryoplant of the machine, not a 1 s pulse (a few GW)', () => {
    const e = reports['aborted'];
    expect(e['Cryoplant power (MW)'] as number).toBeGreaterThan(5);
    expect(e['Cryoplant power (MW)'] as number).toBeLessThan(40);
  });
});
