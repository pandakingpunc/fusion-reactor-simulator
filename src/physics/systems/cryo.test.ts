/**
 * Cryogenic plant (lane ws7b): the Slack heat-load sum as in PROCESS, the electric power from the technology's W/W, the Carnot
 * fractions of the table, and the heat load of an ITER-like magnet system.
 */
import { describe, expect, it } from 'vitest';
import { CRYO_COEFFS, CRYO_TEMPERATURE, DEFAULT_PULSE_LENGTH_S, carnotFraction, cryoPlant, plantPulseLength_s } from './cryo';
import { MAGNET_TECH } from './magnets';

const base = {
  tech: 'Nb3Sn' as const, wattsPerWatt: 300, coldMass_kg: 1e7, tfShellArea_m2: 2000, nuclearHeating_W: 15e3, pfEnergy_J: 7e9,
  pulseLength_s: 1200, nCoils: 18, turnCurrent_A: 68e3,
};

describe('heat load (Slack, as in PROCESS power.py)', () => {
  it('reproduces the reference values of the PROCESS unit test test_cryo (EU DEMO 2018 baseline data, both parametrised cases)', () => {
    // tests/unit/models/test_power.py: qnuc is an input of 12920 W there, tfcryoarea = 0, the pulse length is t_plant_pulse_plasma_present
    const a = cryoPlant({
      tech: 'Nb3Sn', wattsPerWatt: 1, coldMass_kg: 47352637.039762333, tfShellArea_m2: 0, nuclearHeating_W: 12920, pfEnergy_J: 37429.525515086898e6,
      pulseLength_s: 10364.426139387357, nCoils: 16, turnCurrent_A: 74026.751437500003,
    });
    expect(a.Q_static_W / 20361.633927097802).toBeCloseTo(1, 9);
    expect(a.Q_ac_W / 3611.3456752656607).toBeCloseTo(1, 9);
    expect(a.Q_leads_W / 16108.2211128).toBeCloseTo(1, 9);
    expect(a.Q_misc_W / 23850.540321823562).toBeCloseTo(1, 9);
    expect(a.Q_total_W / 76851.741036987034).toBeCloseTo(1, 9);
    const b = cryoPlant({
      tech: 'Nb3Sn', wattsPerWatt: 1, coldMass_kg: 47308985.527808741, tfShellArea_m2: 0, nuclearHeating_W: 12920, pfEnergy_J: 37427.228965055205e6,
      pulseLength_s: 364.42613938735633, nCoils: 16, turnCurrent_A: 74026.751437500003,
    });
    expect(b.Q_static_W / 20342.863776957758).toBeCloseTo(1, 9);
    expect(b.Q_ac_W / 102701.82327748176).toBeCloseTo(1, 9);
    expect(b.Q_misc_W / 68432.80867525778).toBeCloseTo(1, 9);
    expect(b.Q_total_W / 220505.71684249729).toBeCloseTo(1, 9);
  });

  it('sums static, nuclear, AC, lead and 45 % miscellaneous loads', () => {
    const r = cryoPlant(base);
    const Qs = 4.3e-4 * 1e7 + 2.0 * 2000;
    const Qa = (1e3 * 7000) / 1200;
    const Ql = 13.6e-3 * 18 * 68e3;
    expect(r.Q_static_W).toBeCloseTo(Qs, 6);
    expect(r.Q_nuclear_W).toBe(15e3);
    expect(r.Q_ac_W).toBeCloseTo(Qa, 6);
    expect(r.Q_leads_W).toBeCloseTo(Ql, 6);
    expect(r.Q_misc_W).toBeCloseTo(0.45 * (Qs + 15e3 + Qa + Ql), 6);
    expect(r.Q_total_W).toBeCloseTo(1.45 * (Qs + 15e3 + Qa + Ql), 6);
    expect(CRYO_COEFFS.misc).toBe(0.45);
  });

  it('an ITER-like system loads the 4.5 K plant with several tens of kW and needs a few tens of MW', () => {
    const r = cryoPlant(base);
    // ITER cryoplant: about 75 kW equivalent at 4.5 K, about 30 MW electric
    expect(r.Q_total_W / 1e3).toBeGreaterThan(30);
    expect(r.Q_total_W / 1e3).toBeLessThan(120);
    expect(r.P_cryo_MW).toBeGreaterThan(9);
    expect(r.P_cryo_MW).toBeLessThan(40);
  });

  it('the electric power is the heat load times the W/W of the technology', () => {
    const r = cryoPlant(base);
    expect(r.P_cryo_MW).toBeCloseTo((r.Q_total_W * 300) / 1e6, 9);
    expect(cryoPlant({ ...base, wattsPerWatt: 600 }).P_cryo_MW / r.P_cryo_MW).toBeCloseTo(2, 12);
    expect(r.temperature_K).toBe(CRYO_TEMPERATURE.Nb3Sn);
  });

  it('every part responds in the right direction', () => {
    const r = cryoPlant(base);
    expect(cryoPlant({ ...base, coldMass_kg: 2e7 }).Q_static_W).toBeGreaterThan(r.Q_static_W);
    expect(cryoPlant({ ...base, nuclearHeating_W: 30e3 }).Q_total_W).toBeGreaterThan(r.Q_total_W);
    expect(cryoPlant({ ...base, pulseLength_s: 6000 }).Q_ac_W).toBeLessThan(r.Q_ac_W);
    expect(cryoPlant({ ...base, turnCurrent_A: 30e3 }).Q_leads_W).toBeLessThan(r.Q_leads_W);
    expect(cryoPlant({ ...base, nuclearHeating_W: -5 }).Q_nuclear_W).toBe(0);
    // a zero pulse length must not divide by zero
    expect(isFinite(cryoPlant({ ...base, pulseLength_s: 0 }).Q_ac_W)).toBe(true);
  });

  it('copper (resistive) coils have no cryogenic plant', () => {
    const r = cryoPlant({ ...base, tech: 'Cu', wattsPerWatt: 0 });
    expect(r.Q_total_W).toBe(0);
    expect(r.P_cryo_MW).toBe(0);
  });
});

describe('design pulse of the plant', () => {
  it('the default is the plasma-present pulse of the PROCESS default times: 30 + 10 + 1000 + 15 s', () => {
    expect(DEFAULT_PULSE_LENGTH_S).toBe(1055);
  });

  it('a positive finite design pulse is used as given, anything else gives the default', () => {
    expect(plantPulseLength_s(7200)).toBe(7200);
    expect(plantPulseLength_s(0.5)).toBe(0.5);
    for (const bad of [undefined, 0, -1, NaN, Infinity, -Infinity]) expect(plantPulseLength_s(bad), String(bad)).toBe(DEFAULT_PULSE_LENGTH_S);
  });

  it('the AC load is E/t_pulse: a 1 s pulse would give a GW-class plant, the design pulse of the ITER-like case a few tens of MW', () => {
    const wrong = cryoPlant({ ...base, pulseLength_s: 1 });
    const right = cryoPlant({ ...base, pulseLength_s: DEFAULT_PULSE_LENGTH_S });
    expect(right.Q_ac_W).toBeCloseTo((1e3 * 7000) / 1055, 6);
    expect(wrong.P_cryo_MW).toBeGreaterThan(1000);
    expect(right.P_cryo_MW).toBeLessThan(40);
  });
});

describe('efficiency of the plant', () => {
  it('the W/W of the technology table are 20 % (4.5 K) and 34 % (20 K) of the Carnot efficiency for a 293 K warm end', () => {
    expect(carnotFraction(4.5, MAGNET_TECH.Nb3Sn.cryo_W_per_W)).toBeCloseTo(0.2137, 3);
    expect(carnotFraction(20, MAGNET_TECH.REBCO.cryo_W_per_W)).toBeCloseTo(0.341, 3);
    expect(carnotFraction(4.5, 0)).toBe(0);
    // PROCESS uses 13 % of Carnot for the ITER plant: 493 W/W at 4.5 K
    expect((293 - 4.5) / (0.13 * 4.5)).toBeGreaterThan(MAGNET_TECH.Nb3Sn.cryo_W_per_W);
    const r = cryoPlant(base);
    expect(r.carnotFraction).toBeCloseTo(carnotFraction(4.5, 300), 12);
    expect(r.wattsPerWatt).toBe(300);
  });

  it('a REBCO coil at 20 K needs less electric power per cold watt than one at 4.5 K', () => {
    const lts = cryoPlant(base), hts = cryoPlant({ ...base, tech: 'REBCO', wattsPerWatt: MAGNET_TECH.REBCO.cryo_W_per_W });
    expect(hts.P_cryo_MW).toBeLessThan(lts.P_cryo_MW);
    expect(hts.temperature_K).toBe(20);
  });
});
