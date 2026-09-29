/**
 * The stress states that the TF coil reports (tfCoil.ts): the winding pack is solved smeared, and the stress in its steel is the
 * smeared one times E_steel / E_effective; the case and the plasma-side case are steel and are reported as solved. The state of a
 * layer is the point of its largest Tresca stress, and the governing state is the largest of the three.
 */
import { describe, expect, it } from 'vitest';
import { TF_TECH, tfCoil, trescaStress, vonMisesStress } from './tfCoil';

const ITER = { R: 6.2, a: 2.0, kappa: 1.7, B0: 5.3, tech: 'Nb3Sn' as const, gap_m: 1.3, coilThickness_m: 0.9, limit_MPa: 660 };

describe('stress states of the TF coil', () => {
  const r = tfCoil(ITER);
  const fac = TF_TECH.Nb3Sn.E_struct / r.E_wp_Pa;
  /** the profile points (smeared stresses) at the radius of a state; the interface of two layers has one point on either side */
  const at = (rad: number) => r.profile.filter((p) => Math.abs(p.r - rad) <= 1e-12 * rad);

  it('the steel of the winding pack carries the smeared stress times E_steel/E_effective, both the radial and the hoop component', () => {
    expect(fac).toBeGreaterThan(1.5); // the pack is softer than steel, so the steel carries more than the average
    const pts = at(r.wp.r);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.some((p) => Math.abs(p.sigR * fac / 1e6 - r.wp.sigR_MPa) <= 1e-9 * Math.abs(r.wp.sigR_MPa))).toBe(true);
    expect(pts.some((p) => Math.abs(p.sigT * fac / 1e6 - r.wp.sigT_MPa) <= 1e-9 * Math.abs(r.wp.sigT_MPa))).toBe(true);
  });

  it('the nose case and the plasma-side case are reported as solved (no smearing factor)', () => {
    for (const s of [r.case, r.front]) {
      const pts = at(s.r);
      expect(pts.some((p) => Math.abs(p.sigR / 1e6 - s.sigR_MPa) <= 1e-9 * Math.max(1, Math.abs(s.sigR_MPa)))).toBe(true);
      expect(pts.some((p) => Math.abs(p.sigT / 1e6 - s.sigT_MPa) <= 1e-9 * Math.abs(s.sigT_MPa))).toBe(true);
    }
  });

  it('every state carries the Tresca and von Mises stress of its own principal stresses (the vertical tension is the same in all three)', () => {
    for (const s of [r.case, r.wp, r.front]) {
      expect(s.sigZ_MPa).toBeCloseTo(r.wp.sigZ_MPa, 12);
      expect(s.tresca_MPa).toBeCloseTo(trescaStress(s.sigR_MPa, s.sigT_MPa, s.sigZ_MPa), 9);
      expect(s.vonMises_MPa).toBeCloseTo(vonMisesStress(s.sigR_MPa, s.sigT_MPa, s.sigZ_MPa), 9);
    }
  });

  it('the governing stress is the largest of the three, the margin is 1 − Tresca/limit, and a lower limit flips the overstress flag', () => {
    const max = Math.max(r.case.tresca_MPa, r.wp.tresca_MPa, r.front.tresca_MPa);
    expect(r.tresca_MPa).toBe(max);
    expect(r.margin).toBeCloseTo(1 - max / 660, 12);
    expect(r.overstress).toBe(max > 660);
    const strict = tfCoil({ ...ITER, limit_MPa: 0.5 * max });
    expect(strict.overstress).toBe(true);
    expect(strict.margin).toBeCloseTo(-1, 9);
    // the state that governs also names the von Mises stress of the report
    const g = [r.case, r.wp, r.front].find((s) => s.tresca_MPa === max)!;
    expect(r.vonMises_MPa).toBe(g.vonMises_MPa);
  });

  it('the state of the winding pack is its largest Tresca stress along the radius (steel stresses, points strictly inside the layer)', () => {
    const sz = r.wp.sigZ_MPa * 1e6;
    const inside = r.profile.filter((p) => p.r > r.r_i * (1 + 1e-12) && p.r < r.r_o * (1 - 1e-12));
    expect(inside.length).toBeGreaterThan(10);
    for (const p of inside) expect(trescaStress(p.sigR * fac, p.sigT * fac, sz) / 1e6).toBeLessThanOrEqual(r.wp.tresca_MPa * (1 + 1e-9));
  });
});
