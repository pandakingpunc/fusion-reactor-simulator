/**
 * Radial build and TF nuclear heating (lane ws7b).
 */
import { describe, expect, it } from 'vitest';
import { NUC_HEATING, attenuationProfile, radialBuild, tfHeatingAttenuation, tfNuclearHeating_W } from './radialBuild';

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
