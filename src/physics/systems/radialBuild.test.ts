/**
 * Radial build and TF nuclear heating (lane ws7b).
 */
import { describe, expect, it } from 'vitest';
import {
  DT_NEUTRON_FRACTION, NUC_HEATING, attenuationProfile, nuclearHeatingFitNote, radialBuild, tfHeatingAttenuation, tfNuclearHeatingFromNeutrons_W,
  tfNuclearHeating_W,
} from './radialBuild';

describe('radial build', () => {
  it('the inboard layers fill exactly the plasma-to-coil gap', () => {
    for (const [a, gap] of [[2.0, 1.3], [2.93, 1.9], [0.93, 0.55], [1.18, 0.5]] as [number, number][]) {
      for (const type of ['HCPB', 'WCLL', 'none'] as const) {
        const b = radialBuild({ a, gap_m: gap, blanketType: type });
        expect(b.inboardTotal_m).toBeCloseTo(gap, 12);
        expect(b.inboard.reduce((s, l) => s + l.thickness_m, 0)).toBeCloseTo(gap, 12);
        for (const l of b.inboard) expect(l.thickness_m).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the blanket takes 56 % of the space behind the fixed layers, the shield the rest; the outboard build is thicker', () => {
    const b = radialBuild({ a: 2.93, gap_m: 1.9, blanketType: 'HCPB' });
    expect(b.blanketInboard_m / (b.blanketInboard_m + b.shieldInboard_m)).toBeCloseTo(0.56, 12);
    expect(b.blanketOutboard_m).toBeCloseTo(1.73 * b.blanketInboard_m, 12);
    expect(b.shieldOutboard_m).toBeCloseTo(1.83 * b.shieldInboard_m, 12);
    expect(b.outboardTotal_m).toBeGreaterThan(b.inboardTotal_m);
    expect(b.blanketMean_m).toBeCloseTo(0.5 * (b.blanketInboard_m + b.blanketOutboard_m), 12);
    expect(b.compressed).toBe(false);
    // the DEMO-like gap gives a blanket and a shield of the depth of the PROCESS DEMO build (0.755 m and 0.6 m inboard)
    expect(b.blanketInboard_m).toBeGreaterThan(0.6);
    expect(b.blanketInboard_m).toBeLessThan(1.0);
    expect(b.shieldInboard_m).toBeGreaterThan(0.5);
    expect(b.shieldInboard_m).toBeLessThan(0.8);
  });

  it('without a blanket the whole remainder is shield; the inboard blanket depth can be set', () => {
    const none = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'none' });
    expect(none.blanketInboard_m).toBe(0);
    expect(none.xBlanket).toBeLessThan(radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB' }).xBlanket);
    const set = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB', blanketInboard_m: 0.4 });
    expect(set.blanketInboard_m).toBe(0.4);
    expect(set.blanketOverridden).toBe(true);
    expect(set.inboardTotal_m).toBeCloseTo(1.3, 12);
    // a request larger than the space is limited (the shield then has no depth)
    const big = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB', blanketInboard_m: 5 });
    expect(big.shieldInboard_m).toBeCloseTo(0, 12);
    expect(big.inboardTotal_m).toBeCloseTo(1.3, 12);
  });

  it('compact devices compress the fixed layers to fit the gap', () => {
    const b = radialBuild({ a: 0.57, gap_m: 0.1, blanketType: 'none' });
    expect(b.compressed).toBe(true);
    expect(b.inboardTotal_m).toBeCloseTo(0.1, 12);
  });

  it('the line densities are the thickness times density of the layers (tonne/m^2), averaged over the inboard and outboard build', () => {
    const b = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB' });
    const line = (L: typeof b.inboard, roles: string[]) => L.filter((l) => roles.includes(l.role)).reduce((s, l) => s + (l.thickness_m * l.density) / 1000, 0);
    expect(b.xBlanket).toBeCloseTo(0.5 * (line(b.inboard, ['armour', 'wall', 'blanket']) + line(b.outboard, ['armour', 'wall', 'blanket'])), 12);
    expect(b.xShield).toBeCloseTo(0.5 * (line(b.inboard, ['shield']) + line(b.outboard, ['shield'])), 12);
    expect(b.xBlanket).toBeGreaterThan(0.5);
    expect(b.xShield).toBeGreaterThan(1);
  });
});

describe('nuclear heating of the TF coil (PROCESS fit of Kovari 2016)', () => {
  it('has the coefficients of the fit and is linear in the fusion power and the coil mass', () => {
    expect(NUC_HEATING).toEqual({ e: 9.062, a: 2.83, b: 0.583 });
    const q = tfNuclearHeating_W(1.5, 3, 4e6, 500);
    expect(tfNuclearHeating_W(1.5, 3, 4e6, 1000) / q).toBeCloseTo(2, 12);
    expect(tfNuclearHeating_W(1.5, 3, 8e6, 500) / q).toBeCloseTo(2, 12);
    expect(q).toBeCloseTo(9.062 * Math.exp(-2.83 * 1.5 - 0.583 * 3) * 4e6 * 0.5, 6);
  });

  it('reproduces the reference of the PROCESS unit test test_nuclear_heating_magnets (EU DEMO 2018 baseline: x_b 2.337, x_s 4.056 tonne/m^2)', () => {
    // tests/unit/models/blankets/test_ccfe_hcpb.py: total heating of the TF coils 0.044541749 MW for 1986.06 MW of fusion power and 19.65 kt of coils
    const q = tfNuclearHeating_W(2.3374537748527975, 4.056, 19649856.627845347, 1986.0623241661431);
    expect(q / 1e6 / 0.044541749095475737).toBeCloseTo(1, 3);
    // the unit heating per GW of the same test
    expect(tfNuclearHeating_W(2.3374537748527975, 4.056, 19649856.627845347, 1000) / 22427.165831352642).toBeCloseTo(1, 3);
  });

  it('falls with every tonne per square metre of blanket and shield, the blanket about five times faster', () => {
    expect(tfHeatingAttenuation(0, 0)).toBe(1);
    expect(tfHeatingAttenuation(2, 3)).toBeLessThan(tfHeatingAttenuation(1, 3));
    expect(tfHeatingAttenuation(1, 4)).toBeLessThan(tfHeatingAttenuation(1, 3));
    expect(tfHeatingAttenuation(1, 0) / tfHeatingAttenuation(2, 0)).toBeCloseTo(Math.exp(2.83), 12);
    expect(2.83 / 0.583).toBeGreaterThan(4.8);
  });

  it('a thicker blanket lowers the heating of the coil, which is tens of kW for an ITER-like machine (design limit 14 kW for a steel-water blanket)', () => {
    const thin = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB', blanketInboard_m: 0.3 });
    const thick = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB', blanketInboard_m: 0.7 });
    const q = (b: typeof thin) => tfNuclearHeating_W(b.xBlanket, b.xShield, 4e6, 500);
    // the thick blanket leaves less shield but attenuates 5 times faster per tonne/m^2
    expect(q(thick)).toBeLessThan(q(thin));
    expect(q(thick)).toBeGreaterThan(1e3);
    expect(q(thin)).toBeLessThan(2e5);
  });

  it('is a function of the neutron power: the fit for D-T (0.80 of the fusion power), a fraction of it for D-D and D-He3, nothing for p-B11', () => {
    expect(DT_NEUTRON_FRACTION).toBeCloseTo(0.8, 1); // 14.0 / 17.6 MeV, the D-T channel of the plasma model
    const b = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB' });
    // a D-T plasma of 500 MW: 400 MW of neutrons give the published fit
    const dt = tfNuclearHeatingFromNeutrons_W(b.xBlanket, b.xShield, 4e6, 500 * DT_NEUTRON_FRACTION);
    expect(dt / tfNuclearHeating_W(b.xBlanket, b.xShield, 4e6, 500)).toBeCloseTo(1, 12);
    // linear in the neutron power, zero without neutrons (p-11B, and D-3He apart from the D-D side reactions)
    expect(tfNuclearHeatingFromNeutrons_W(b.xBlanket, b.xShield, 4e6, 200) / tfNuclearHeatingFromNeutrons_W(b.xBlanket, b.xShield, 4e6, 100)).toBeCloseTo(2, 12);
    expect(tfNuclearHeatingFromNeutrons_W(b.xBlanket, b.xShield, 4e6, 0)).toBe(0);
    // the same 500 MW of fusion power in D-D (the n + He3 branch gives 2.45 of its 3.27 MeV, the p + T branch none: 0.34 of the
    // 3.65 MeV per reaction in neutrons) heats the coil 0.34 / 0.80 = 0.42 times as much as in D-T
    const dd = tfNuclearHeatingFromNeutrons_W(b.xBlanket, b.xShield, 4e6, 500 * (0.5 * 2.45) / 3.65);
    expect(dd / (dt / DT_NEUTRON_FRACTION * (500 * (0.5 * 2.45) / 3.65) / 500)).toBeCloseTo(1, 12);
    expect(dd / dt).toBeGreaterThan(0.35);
    expect(dd / dt).toBeLessThan(0.5);
  });

  it('a build without a breeding blanket attenuates with the shield coefficient only: armour and first wall count as shield', () => {
    const none = radialBuild({ a: 0.57, gap_m: 0.22, blanketType: 'none' });
    expect(none.xBlanket).toBe(0);
    const line = (L: typeof none.inboard, roles: string[]) => L.filter((l) => roles.includes(l.role)).reduce((s, l) => s + (l.thickness_m * l.density) / 1000, 0);
    expect(none.xShield).toBeCloseTo(0.5 * (line(none.inboard, ['armour', 'wall', 'shield']) + line(none.outboard, ['armour', 'wall', 'shield'])), 12);
    expect(none.xShield).toBeGreaterThan(line(none.inboard, ['shield']));
    // the heating is then that of a plain shield: without the 0.156 tonne/m^2 of tungsten and steel counted with the blanket coefficient
    // (exp(-2.83 x) = 0.64) the coil sees more neutrons than in the earlier estimate
    const q = tfNuclearHeatingFromNeutrons_W(none.xBlanket, none.xShield, 3e5, 160);
    expect(q).toBeGreaterThan(0);
    expect(tfHeatingAttenuation(none.xBlanket, none.xShield)).toBeCloseTo(Math.exp(-NUC_HEATING.b * none.xShield), 12);
    // the profile of the layers ends at the same value
    const p = attenuationProfile(none.inboard);
    const xsIn = line(none.inboard, ['armour', 'wall', 'shield']);
    expect(p[p.length - 1].attenuation).toBeCloseTo(Math.exp(-NUC_HEATING.b * xsIn), 12);
  });

  it('flags an extrapolation of the fit: no blanket, another blanket type, a blanket depth outside the DEMO HCPB study', () => {
    expect(nuclearHeatingFitNote('HCPB', 0.85)).toBeUndefined();
    expect(nuclearHeatingFitNote('none', 0)).toContain('no breeding blanket');
    expect(nuclearHeatingFitNote('WCLL', 0.85)).toContain('WCLL');
    expect(nuclearHeatingFitNote('HCPB', 0.5)).toContain('outside');
    expect(nuclearHeatingFitNote('HCPB', 1.3)).toContain('outside');
  });

  it('the attenuation profile falls monotonically layer by layer and ends at the fit value', () => {
    const b = radialBuild({ a: 2, gap_m: 1.3, blanketType: 'HCPB' });
    const p = attenuationProfile(b.inboard);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].attenuation).toBeLessThanOrEqual(p[i - 1].attenuation + 1e-15);
      expect(p[i].x_m).toBeGreaterThan(p[i - 1].x_m);
    }
    expect(p[p.length - 1].x_m).toBeCloseTo(b.inboardTotal_m, 12);
    const xb = b.inboard.filter((l) => ['armour', 'wall', 'blanket'].includes(l.role)).reduce((s, l) => s + (l.thickness_m * l.density) / 1000, 0);
    const xs = b.inboard.filter((l) => l.role === 'shield').reduce((s, l) => s + (l.thickness_m * l.density) / 1000, 0);
    expect(p[p.length - 1].attenuation).toBeCloseTo(tfHeatingAttenuation(xb, xs), 12);
  });
});
