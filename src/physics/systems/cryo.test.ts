/**
 * Cryogenic plant (lane ws7b): the Slack heat-load sum as in PROCESS, the electric power from the technology's W/W, the Carnot
 * fractions of the table, and the heat load of an ITER-like magnet system.
 */
import { describe, expect, it } from 'vitest';
import { CRYO_COEFFS, CRYO_TEMPERATURE, DWELL_S, carnotFraction, cryoPlant } from './cryo';
import { MAGNET_TECH } from './magnets';

const base = {
  tech: 'Nb3Sn' as const, wattsPerWatt: 300, coldMass_kg: 1e7, tfShellArea_m2: 2000, nuclearHeating_W: 15e3, pfEnergy_J: 7e9,
  pulseLength_s: 1200, nCoils: 18, turnCurrent_A: 68e3,
};

describe('heat load (Slack, as in PROCESS power.py)', () => {
  it('sums static, nuclear, AC, lead and 45 % miscellaneous loads', () => {
    const r = cryoPlant(base);
    const Qs = 4.3e-4 * 1e7 + 2.0 * 2000;
    const Qa = (1e3 * 7000) / (1200 + DWELL_S);
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
    // the dwell time keeps a steady shot from dividing by a zero pulse length
    expect(isFinite(cryoPlant({ ...base, pulseLength_s: 0 }).Q_ac_W)).toBe(true);
  });

  it('copper (resistive) coils have no cryogenic plant', () => {
    const r = cryoPlant({ ...base, tech: 'Cu', wattsPerWatt: 0 });
    expect(r.Q_total_W).toBe(0);
    expect(r.P_cryo_MW).toBe(0);
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
