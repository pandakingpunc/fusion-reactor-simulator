/**
 * Detachment state and qualifier (edge/detachment.ts).
 *  [K18]  A. Kallenbach et al., Plasma Phys. Control. Fusion 60 (2018) 045006: n_e,sep = 2.65e19 m⁻³ (p_div/Pa)^0.31.
 *  [B25]  T. Body, A. Kallenbach and T. Eich, arXiv:2504.05486, eqs. 5–7: q_det = 1.3/(1 + Σ f_z c_z) (P_sep/MW)/(R/m)
 *         (Pa/p_div)(5 mm/λ_int), f_N = 18, f_Ne = 45, f_Ar = 90.
 */
import { describe, expect, it } from 'vitest';
import { forAll, gen } from '../../testing/prop';
import {
  ATTACHED, DETACHED, DETACHMENT_LABELS, NSEP_AT_1PA, NSEP_PDIV_EXPONENT, PARTIALLY_DETACHED, QDET_FZ, TT_ATTACHED_EV, TT_DETACHED_EV,
  detachmentConcentration, detachmentQualifier, detachmentState, divertorPressure,
} from './detachment';

describe('detachment state from the target temperature', () => {
  it('attached above 10 eV (Stangeby 2018), detached below 2 eV (ion-flux rollover, Moulton 2021), partial in between', () => {
    expect(TT_ATTACHED_EV).toBe(10);
    expect(TT_DETACHED_EV).toBe(2);
    expect(detachmentState(150)).toBe(ATTACHED);
    expect(detachmentState(10)).toBe(ATTACHED);
    expect(detachmentState(9.99)).toBe(PARTIALLY_DETACHED);
    expect(detachmentState(5)).toBe(PARTIALLY_DETACHED);
    expect(detachmentState(2)).toBe(PARTIALLY_DETACHED);
    expect(detachmentState(1.99)).toBe(DETACHED);
    expect(detachmentState(0.5)).toBe(DETACHED);
    expect([ATTACHED, PARTIALLY_DETACHED, DETACHED]).toEqual([0, 1, 2]);
    expect(DETACHMENT_LABELS).toEqual(['attached', 'partially detached', 'detached']);
  });
});

describe('divertor neutral pressure from the separatrix density', () => {
  it('inverts n_sep = 2.65e19 (p_div/Pa)^0.31: 1 Pa at 2.65e19, and the exponent 1/0.31 in between', () => {
    expect(NSEP_AT_1PA).toBe(2.65e19);
    expect(NSEP_PDIV_EXPONENT).toBe(0.31);
    expect(divertorPressure(2.65e19)).toBeCloseTo(1, 12);
    forAll(gen.logFloat(2e18, 2e20), (n) => {
      const p = divertorPressure(n);
      expect(NSEP_AT_1PA * Math.pow(p, NSEP_PDIV_EXPONENT) / n).toBeCloseTo(1, 12);
    });
    expect(divertorPressure(4e19)).toBeGreaterThan(3);
    expect(divertorPressure(4e19)).toBeLessThan(4.5);
    // a vanishing density does not give a vanishing pressure
    expect(divertorPressure(0)).toBe(divertorPressure(1e17));
    expect(Number.isFinite(divertorPressure(-5))).toBe(true);
  });
});

describe('Kallenbach qualifier q_det', () => {
  it('is 1.3 (P_sep/R)(Pa/p_div)(5 mm/λ_int) without seeding', () => {
    // 8 MW at R = 1.65 m, n_sep 3e19 (p_div 1.49 Pa), λ_int 5 mm
    const p = divertorPressure(3e19);
    expect(detachmentQualifier(8e6, 1.65, 3e19, 5)).toBeCloseTo((1.3 * (8 / 1.65)) / p, 12);
    expect(detachmentQualifier(8e6, 1.65, 3e19, 10)).toBeCloseTo(detachmentQualifier(8e6, 1.65, 3e19, 5) / 2, 12);
    expect(detachmentQualifier(16e6, 1.65, 3e19, 5)).toBeCloseTo(2 * detachmentQualifier(8e6, 1.65, 3e19, 5), 12);
    expect(detachmentQualifier(8e6, 3.3, 3e19, 5)).toBeCloseTo(0.5 * detachmentQualifier(8e6, 1.65, 3e19, 5), 12);
    // an attached AUG-like H-mode: q_det > 1
    expect(detachmentQualifier(8e6, 1.65, 3e19, 5)).toBeGreaterThan(1);
  });

  it('the seed divides by 1 + f_z c_z with f_N = 18, f_Ne = 45, f_Ar = 90; species without f_z and zero concentrations do nothing', () => {
    expect(QDET_FZ).toEqual({ N: 18, Ne: 45, Ar: 90 });
    const q0 = detachmentQualifier(8e6, 1.65, 3e19, 5);
    for (const [sp, fz] of [['N', 18], ['Ne', 45], ['Ar', 90]] as const) {
      expect(detachmentQualifier(8e6, 1.65, 3e19, 5, { species: sp, c: 0.01 })).toBeCloseTo(q0 / (1 + fz * 0.01), 12);
    }
    expect(detachmentQualifier(8e6, 1.65, 3e19, 5, { species: 'W', c: 0.01 })).toBe(q0);
    expect(detachmentQualifier(8e6, 1.65, 3e19, 5, { species: 'Ne', c: 0 })).toBe(q0);
    expect(detachmentQualifier(8e6, 1.65, 3e19, 5, { species: 'Ne', c: -1 })).toBe(q0);
  });

  it('the concentration at q_det = 1 is (q_det(0) − 1)/f_z: 0 if detached without seeding, NaN for an unknown species', () => {
    forAll(gen.record({ P: gen.logFloat(1e6, 2e8), R: gen.float(1.5, 9), n: gen.logFloat(1e19, 1e20), l: gen.float(1, 10) }), ({ P, R, n, l }) => {
      for (const sp of ['N', 'Ne', 'Ar']) {
        const c = detachmentConcentration(P, R, n, l, sp);
        expect(c).toBeGreaterThanOrEqual(0);
        if (c > 0) expect(detachmentQualifier(P, R, n, l, { species: sp, c })).toBeCloseTo(1, 10);
        else expect(detachmentQualifier(P, R, n, l)).toBeLessThanOrEqual(1);
      }
    });
    expect(detachmentConcentration(8e6, 1.65, 3e19, 5, 'W')).toBeNaN();
    // the 1/f_z ordering: the heavier the seed, the less of it
    expect(detachmentConcentration(8e6, 1.65, 3e19, 5, 'Ar')).toBeLessThan(detachmentConcentration(8e6, 1.65, 3e19, 5, 'Ne'));
    expect(detachmentConcentration(8e6, 1.65, 3e19, 5, 'Ne')).toBeLessThan(detachmentConcentration(8e6, 1.65, 3e19, 5, 'N'));
    // and the qualifier scales with P_sep/R: at a fixed q_det the concentration grows with it
    expect(detachmentConcentration(4e6, 1.65, 3e19, 5, 'Ne')).toBeLessThan(detachmentConcentration(16e6, 1.65, 3e19, 5, 'Ne'));
  });
});
