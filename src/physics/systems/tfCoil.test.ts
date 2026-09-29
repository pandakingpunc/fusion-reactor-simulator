/**
 * TF coil model (lane ws7b): Lame limits of the plane-stress solver, the exact force-balance integral, scaling laws, the vertical
 * force integral, and the stress of ITER-like and DEMO-like coils against the literature design range.
 */
import { describe, expect, it } from 'vitest';
import { C } from '../constants';
import {
  StressLayer, TF_TECH, dCoilLength, smearedTransverseModulus, tfCoil, tfStressLayers, trescaStress, verticalForceUpperHalf, vonMisesStress,
} from './tfCoil';

const MU0 = C.mu0;

/** Simpson integral of f over [a, b] with n (even) panels */
function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

const ITER = { R: 6.2, a: 2.0, kappa: 1.7, B0: 5.3, tech: 'Nb3Sn' as const, gap_m: 1.3, coilThickness_m: 0.9, limit_MPa: 660 };

describe('plane-stress layer solver (Kovari 2016 eqs. 36-39)', () => {
  it('reduces to the Lame solution of a thick cylinder under internal and external pressure', () => {
    const a = 0.5, b = 1.3, pi = 30e6, po = 80e6;
    const sol = tfStressLayers([{ r0: a, r1: b, E: 200e9, nu: 0.3, J: 0 }], pi, po);
    const B = ((pi - po) * a * a * b * b) / (b * b - a * a);
    const A = (pi * a * a - po * b * b) / (b * b - a * a);
    for (const r of [0.5, 0.7, 0.9, 1.1, 1.3]) {
      const s = sol.at(0, r);
      expect(s.sigR).toBeCloseTo(A - B / (r * r), -2); // Pa, tolerance 0.5e2 Pa on 1e7..1e8
      expect(s.sigT).toBeCloseTo(A + B / (r * r), -2);
    }
    // stress-free surfaces
    const free = tfStressLayers([{ r0: a, r1: b, E: 200e9, nu: 0.3, J: 0 }]);
    expect(free.at(0, a).sigR).toBeCloseTo(0, 3);
    expect(free.at(0, b).sigT).toBeCloseTo(0, 3); // no load: everything zero
  });

  it('satisfies the boundary conditions and the continuity of sigma_r and u at the interface (two layers with current)', () => {
    const rc = 2.0, ri = 2.3, ro = 2.9;
    const layers: StressLayer[] = [
      { r0: rc, r1: ri, E: 205e9, nu: 0.3, J: 0 },
      { r0: ri, r1: ro, E: 87e9, nu: 0.3, J: 17e6 },
    ];
    const sol = tfStressLayers(layers);
    expect(sol.at(0, rc).sigR / 1e6).toBeCloseTo(0, 6);
    expect(sol.at(1, ro).sigR / 1e6).toBeCloseTo(0, 6);
    const l = sol.at(0, ri), r = sol.at(1, ri);
    expect(r.sigR / l.sigR).toBeCloseTo(1, 9);
    expect(r.u / l.u).toBeCloseTo(1, 9);
  });

  it('obeys the exact equilibrium integral: the integral of the hoop stress equals minus the integral of r J B over the winding', () => {
    // radial force balance d(r sigma_r)/dr - sigma_theta + r f = 0, sigma_r = 0 on both surfaces => int sigma_theta dr = int r f dr, f = -J B
    const rc = 2.0, ri = 2.32, ro = 2.9, J = 17e6;
    const layers: StressLayer[] = [
      { r0: rc, r1: ri, E: 205e9, nu: 0.3, J: 0 },
      { r0: ri, r1: ro, E: 87e9, nu: 0.3, J },
    ];
    const sol = tfStressLayers(layers);
    const hoop = simpson((r) => sol.at(0, r).sigT, rc, ri) + simpson((r) => sol.at(1, r).sigT, ri, ro);
    const force = (MU0 * J * J / 2) * ((ro ** 3 - ri ** 3) / 3 - ri * ri * (ro - ri)); // int J B r dr, B = mu0 J (r^2 - ri^2) / (2 r)
    expect(hoop / -force).toBeCloseTo(1, 6);
  });

  it('a single layer of the same material and current as two stacked layers gives the same field (the inner current is carried through)', () => {
    const J = 12e6, E = 100e9;
    const one = tfStressLayers([{ r0: 1.0, r1: 2.0, E, nu: 0.3, J }]);
    const two = tfStressLayers([{ r0: 1.0, r1: 1.5, E, nu: 0.3, J }, { r0: 1.5, r1: 2.0, E, nu: 0.3, J }]);
    for (const r of [1.1, 1.4]) expect(two.at(0, r).sigT / one.at(0, r).sigT).toBeCloseTo(1, 8);
    for (const r of [1.6, 1.9]) expect(two.at(1, r).sigT / one.at(0, r).sigT).toBeCloseTo(1, 8);
  });

  it('a body force pointing inward compresses the hoop and needs at least one layer', () => {
    const sol = tfStressLayers([{ r0: 1, r1: 2, E: 100e9, nu: 0.3, J: 10e6 }]);
    for (let i = 0; i <= 10; i++) expect(sol.at(0, 1 + i / 10).sigT).toBeLessThan(0);
    expect(() => tfStressLayers([])).toThrow(RangeError);
  });
});

describe('stress invariants', () => {
  it('Tresca and von Mises of principal stresses', () => {
    expect(trescaStress(0, -300, 200)).toBe(500);
    expect(trescaStress(-10, -20, -15)).toBe(10);
    expect(vonMisesStress(1, 1, 1)).toBe(0);
    expect(vonMisesStress(100, 0, 0)).toBeCloseTo(100, 12);
    expect(vonMisesStress(0, -300, 200)).toBeCloseTo(Math.sqrt(0.5 * (300 ** 2 + 500 ** 2 + 200 ** 2)), 9);
  });

  it('smeared modulus: all structure gives E_struct, no structure gives the compliant modulus, monotone between', () => {
    expect(smearedTransverseModulus(205e9, 20e9, 1)).toBeCloseTo(205e9, -3);
    expect(smearedTransverseModulus(205e9, 20e9, 0)).toBeCloseTo(20e9, -3);
    let prev = 0;
    for (let f = 0; f <= 1.0001; f += 0.05) { const E = smearedTransverseModulus(205e9, 20e9, f); expect(E).toBeGreaterThanOrEqual(prev); prev = E; }
    // Voigt bound: never above the arithmetic mixture of the two moduli by area
    for (const f of [0.2, 0.5, 0.8]) expect(smearedTransverseModulus(205e9, 20e9, f)).toBeLessThanOrEqual(f * 205e9 + (1 - f) * 20e9);
  });

  it('every stress is proportional to B0^2 (Lorentz force and vertical tension both scale as B^2)', () => {
    const a = tfCoil(ITER), b = tfCoil({ ...ITER, B0: 2 * ITER.B0 });
    expect(b.tresca_MPa / a.tresca_MPa).toBeCloseTo(4, 9);
    expect(b.case.sigZ_MPa / a.case.sigZ_MPa).toBeCloseTo(4, 9);
    expect(b.case.sigT_MPa / a.case.sigT_MPa).toBeCloseTo(4, 9);
    expect(b.F_vertical_N / a.F_vertical_N).toBeCloseTo(4, 9);
  });

  it('the number of coils does not change the stress (loads and areas both scale with 1/N) but changes the current density per turn', () => {
    const a = tfCoil({ ...ITER, nCoils: 16 }), b = tfCoil({ ...ITER, nCoils: 20 });
    expect(a.tresca_MPa).toBeCloseTo(b.tresca_MPa, 6);
    expect(a.turnsPerCoil / b.turnsPerCoil).toBeCloseTo(20 / 16, 9);
  });

  it('a thicker leg lowers the Tresca stress', () => {
    let prev = Infinity;
    for (const t of [0.7, 0.8, 0.9, 1.0, 1.2]) {
      const s = tfCoil({ ...ITER, coilThickness_m: t }).tresca_MPa;
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });

  it('more structure in the winding pack lowers the vertical stress and the steel stress', () => {
    const lo = tfCoil({ ...ITER, structureFraction: 0.4 }), hi = tfCoil({ ...ITER, structureFraction: 0.7 });
    expect(hi.case.sigZ_MPa).toBeLessThan(lo.case.sigZ_MPa);
    expect(hi.wp.tresca_MPa).toBeLessThan(lo.wp.tresca_MPa);
  });
});

describe('forces', () => {
  it('the vertical force of a thin winding pack tends to the line-current result mu0 I^2 ln(R_out/R_in) / (4 pi N)', () => {
    const N = 18, I = (2 * Math.PI * 6.2 * 5.3) / MU0;
    const rin = 2.9, rout = 11;
    const thin = verticalForceUpperHalf(5.3, 6.2, I, N, rin - 1e-3, rin, rout);
    const line = ((MU0 * I * I) / (4 * Math.PI * N)) * Math.log(rout / rin);
    expect(thin / line).toBeGreaterThan(0.99);
    expect(thin / line).toBeLessThan(1.01);
    // the very-thin branch of the routine is continuous with the exact expression
    const t1 = verticalForceUpperHalf(5.3, 6.2, I, N, rin - 1e-9, rin, rout);
    const t2 = verticalForceUpperHalf(5.3, 6.2, I, N, rin - 1e-4, rin, rout);
    expect(t1 / t2).toBeCloseTo(1, 3);
  });

  it('the vertical force grows with the outboard leg radius and with the current squared', () => {
    const I = (2 * Math.PI * 6.2 * 5.3) / MU0;
    expect(verticalForceUpperHalf(5.3, 6.2, I, 18, 2.3, 2.9, 12)).toBeGreaterThan(verticalForceUpperHalf(5.3, 6.2, I, 18, 2.3, 2.9, 9));
    const f1 = verticalForceUpperHalf(5.3, 6.2, I, 18, 2.3, 2.9, 10), f2 = verticalForceUpperHalf(10.6, 6.2, 2 * I, 18, 2.3, 2.9, 10);
    expect(f2 / f1).toBeCloseTo(4, 9);
  });

  it('D-shaped coil length: a taller or wider coil is longer and it exceeds the straight leg', () => {
    const L = dCoilLength(9.4, 12.6, 9.6);
    expect(L).toBeGreaterThan(9.4);
    expect(dCoilLength(9.4, 14, 9.6)).toBeGreaterThan(L);
    expect(dCoilLength(9.4, 12.6, 11)).toBeGreaterThan(L);
  });
});

describe('ITER-like TF coil against the literature', () => {
  const r = tfCoil(ITER);

  it('the ampere-turns and the peak field are those of the machine', () => {
    // ITER: 18 coils, 164 MA-turns in total (9.1 MA per coil), B0 = 5.3 T at 6.2 m
    expect(r.nCoils).toBe(18);
    expect(r.I_total_A / 1e6).toBeGreaterThan(163);
    expect(r.I_total_A / 1e6).toBeLessThan(165);
    expect(r.B_peak_T).toBeCloseTo((5.3 * 6.2) / 2.9, 9);
    // the ITER TF conductor carries 68 kA: about 134 turns per coil
    expect(r.turnsPerCoil).toBeGreaterThan(125);
    expect(r.turnsPerCoil).toBeLessThan(140);
    expect(r.pMag_MPa).toBeCloseTo(r.B_peak_T ** 2 / (2 * MU0) / 1e6, 9);
  });

  it('the Tresca stress is in the several-hundred-MPa design range, not the 82 MPa of the thin-ring estimate', () => {
    // ITER designs the TF case to an allowable of about 660 MPa (316LN, primary plus secondary stress intensity)
    expect(r.tresca_MPa).toBeGreaterThan(300);
    expect(r.tresca_MPa).toBeLessThan(660);
    expect(r.overstress).toBe(false);
    expect(r.margin).toBeGreaterThan(0);
    // hoop compression plus vertical tension: the (sigma_t - sigma_z) difference governs
    expect(r.case.sigT_MPa).toBeLessThan(0);
    expect(r.case.sigZ_MPa).toBeGreaterThan(0);
    expect(r.case.tresca_MPa).toBeCloseTo(-r.case.sigT_MPa + r.case.sigZ_MPa, 6);
    expect(r.case.r).toBeCloseTo(r.r_c, 9); // highest stress at the innermost radius of the case
  });

  it('the stored energy of the TF set is within 15 % of the 41 GJ of ITER', () => {
    expect(r.W_J / 1e9).toBeGreaterThan(0.85 * 41);
    expect(r.W_J / 1e9).toBeLessThan(1.15 * 41);
  });

  it('the vertical tension of an inboard leg is about 100 MN and the coil is a few tens of metres long', () => {
    expect(r.T_inboard_N / 1e6).toBeGreaterThan(60);
    expect(r.T_inboard_N / 1e6).toBeLessThan(160);
    expect(r.coilLength_m).toBeGreaterThan(28);
    expect(r.coilLength_m).toBeLessThan(45);
    expect(r.profile.length).toBeGreaterThan(40);
  });
});

describe('DEMO-like coil: the PROCESS stress constraint', () => {
  // PROCESS designs the DEMO TF coil against a Tresca/von Mises limit of 660 MPa (Kovari 2016, table 5) with an inboard leg of about
  // 1.2-1.4 m (docs: 1.4 m); the same limit binds at that thickness in this model
  const demo = { R: 9.07, a: 2.93, kappa: 1.65, B0: 5.86, tech: 'Nb3Sn' as const, gap_m: 1.9, limit_MPa: 660 };
  it('at 1.4 m the Tresca stress is near the 660 MPa limit; a 1.0 m leg is over it', () => {
    const thick = tfCoil({ ...demo, coilThickness_m: 1.4 });
    expect(thick.tresca_MPa).toBeGreaterThan(500);
    expect(thick.tresca_MPa).toBeLessThan(700);
    expect(tfCoil({ ...demo, coilThickness_m: 1.0 }).overstress).toBe(true);
  });
});

describe('technologies and degenerate inputs', () => {
  it('every technology yields a finite result with a positive mass and energy', () => {
    for (const tech of ['Cu', 'NbTi', 'Nb3Sn', 'REBCO'] as const) {
      const r = tfCoil({ R: 3, a: 1, kappa: 1.7, B0: 3, tech, gap_m: 0.5, coilThickness_m: 0.5, limit_MPa: 400 });
      for (const v of [r.tresca_MPa, r.vonMises_MPa, r.W_J, r.totalMass_kg, r.J_wp_Am2]) expect(isFinite(v) && v > 0).toBe(true);
      expect(r.nCoils).toBe(TF_TECH[tech].nCoils);
    }
  });

  it('a leg thicker than the outer radius is limited, and the case may be absent', () => {
    const r = tfCoil({ R: 1, a: 0.6, kappa: 1.5, B0: 1, tech: 'Cu', gap_m: 0.1, coilThickness_m: 5, limit_MPa: 300 });
    expect(r.r_c).toBeGreaterThan(0);
    expect(r.notes.join(' ')).toContain('limited');
    const noNose = tfCoil({ ...ITER, noseFraction: 0 });
    expect(isFinite(noNose.tresca_MPa)).toBe(true);
    expect(noNose.case.tresca_MPa).toBeCloseTo(noNose.wp.tresca_MPa, 9); // one layer: both are the same point set
  });

  it('options override the technology defaults', () => {
    const r = tfCoil({ ...ITER, nCoils: 16, noseFraction: 0.5, structureFraction: 0.6, turnCurrent_A: 50e3, verticalInboardFraction: 0.65 });
    expect(r.nCoils).toBe(16);
    expect(r.r_i).toBeCloseTo(r.r_c + 0.5 * 0.9, 9);
    expect(r.T_inboard_N / r.F_vertical_N).toBeCloseTo(0.65, 12);
    expect(r.turnsPerCoil).toBeCloseTo(r.I_total_A / (16 * 50e3), 6);
  });
});
