/**
 * The toroidal Green's functions of a circular current filament against the Biot–Savart law integrated over the ring
 * (the periodic trapezoid rule converges exponentially: 8192 points hold 1e-13 at the distances used), against
 * Ampère's law, div B = 0, and the relations B = (−∂ψ/∂Z, ∂ψ/∂R)/R.
 */
import { describe, expect, it } from 'vitest';
import { filamentField, filamentPsi } from './greens';

const MU0 = 1.25663706212e-6;
const N = 8192;

/** Biot–Savart for the ring (R_c, Z_c), 1 A, at (R, Z): A_φ = (μ0/4π) ∮ R_c cos φ / r dφ, B by the field of dl × r / r³ */
function biotSavart(Rc: number, Zc: number, R: number, Z: number): { psi: number; BR: number; BZ: number } {
  let A = 0, BR = 0, BZ = 0;
  const h = (2 * Math.PI) / N, d = Z - Zc;
  for (let k = 0; k < N; k++) {
    const ph = k * h, c = Math.cos(ph);
    const r2 = R * R + Rc * Rc - 2 * R * Rc * c + d * d, r = Math.sqrt(r2);
    A += (Rc * c) / r;
    BR += (Rc * d * c) / (r2 * r);
    BZ += (Rc * (Rc - R * c)) / (r2 * r);
  }
  const f = (MU0 / (4 * Math.PI)) * h;
  return { psi: R * A * f, BR: BR * f, BZ: BZ * f };
}

/** field points around a ring of radius 1.7 at height 0.4: near the axis, inside, close to the ring (m → 1), outside, far, above, below */
const Rc = 1.7, Zc = 0.4;
const points: [number, number][] = [
  [1e-3, 0.4], [1e-3, 1.1], [0.05, -0.6], [0.3, 0.1], [0.3, 1.5], [0.9, 0.4], [0.9, -1.2], [1.2, 0.9], [1.6, 0.5], [1.6, 0.35],
  [1.75, 0.45], [1.68, 0.36], [1.7, 0.6], [1.7, 0.2], [1.9, 0.4], [2.1, 0.7], [2.6, 0.4], [3.4, -0.3], [6, 2], [12, -5], [0.02, 3], [5e-2, 0.41],
];

describe('the ring Green\'s functions against Biot–Savart', () => {
  it.each(points)('at (R, Z) = (%s, %s): ψ, B_R and B_Z to 1e-10 relative to the local field scale', (R, Z) => {
    const bs = biotSavart(Rc, Zc, R, Z);
    const psi = filamentPsi(Rc, Zc, R, Z), B = filamentField(Rc, Zc, R, Z);
    expect(Math.abs(psi - bs.psi)).toBeLessThan(1e-10 * Math.abs(bs.psi));
    const scale = Math.hypot(bs.BR, bs.BZ);
    expect(Math.abs(B.BR - bs.BR)).toBeLessThan(1e-10 * scale);
    expect(Math.abs(B.BZ - bs.BZ)).toBeLessThan(1e-10 * scale);
  });

  it('a wide sweep of ring radius, height and field point (m from 1e-6 to 0.999): worst relative error of ψ and of |B| below 1e-10', () => {
    let worstPsi = 0, worstB = 0;
    for (const rc of [0.3, 1, 4.5]) for (const zc of [0, -1.1]) {
      for (let i = 0; i < 9; i++) for (let j = 0; j < 7; j++) {
        const R = (0.02 + 0.5 * i * i / 10) * rc + 1e-3, Z = zc + (j - 3) * 0.4 * rc;
        // away from the ring: the trapezoid rule needs a distance of about a tenth of the radius
        if (Math.hypot(R - rc, Z - zc) < 0.08 * rc) continue;
        const bs = biotSavart(rc, zc, R, Z), psi = filamentPsi(rc, zc, R, Z), B = filamentField(rc, zc, R, Z);
        worstPsi = Math.max(worstPsi, Math.abs(psi / bs.psi - 1));
        worstB = Math.max(worstB, Math.hypot(B.BR - bs.BR, B.BZ - bs.BZ) / Math.hypot(bs.BR, bs.BZ));
      }
    }
    expect(worstPsi).toBeLessThan(1e-10);
    expect(worstB).toBeLessThan(1e-10);
  });

  it('on the axis: ψ = 0, B_R = 0 and B_Z = μ0 R_c²/(2 (R_c² + ΔZ²)^(3/2)); the off-axis field approaches it', () => {
    for (const z of [-2, 0.4, 3]) {
      expect(filamentPsi(Rc, Zc, 0, z)).toBe(0);
      const B = filamentField(Rc, Zc, 0, z);
      expect(B.BR).toBe(0);
      expect(B.BZ / ((MU0 * Rc * Rc) / (2 * Math.pow(Rc * Rc + (z - Zc) ** 2, 1.5)))).toBeCloseTo(1, 14);
      const near = filamentField(Rc, Zc, 1e-9, z);
      expect(Math.abs(near.BZ / B.BZ - 1)).toBeLessThan(1e-12);
      expect(Math.abs(near.BR)).toBeLessThan(1e-8 * Math.abs(B.BZ));
    }
  });

  it('are consistent with each other: B_Z = ∂ψ/∂R / R, B_R = −∂ψ/∂Z / R (central differences), ∇·B = 0, reciprocity ψ(a from b) = ψ(b from a)', () => {
    for (const [R, Z] of [[0.6, 0.9], [1.4, -0.2], [2.3, 0.6], [3.5, 1.5]] as [number, number][]) {
      const e = 1e-5, B = filamentField(Rc, Zc, R, Z);
      const dR = (filamentPsi(Rc, Zc, R + e, Z) - filamentPsi(Rc, Zc, R - e, Z)) / (2 * e);
      const dZ = (filamentPsi(Rc, Zc, R, Z + e) - filamentPsi(Rc, Zc, R, Z - e)) / (2 * e);
      expect(Math.abs(B.BZ - dR / R)).toBeLessThan(1e-8 * Math.hypot(B.BR, B.BZ));
      expect(Math.abs(B.BR + dZ / R)).toBeLessThan(1e-8 * Math.hypot(B.BR, B.BZ));
      // (1/R) ∂(R B_R)/∂R + ∂B_Z/∂Z = 0
      const h = 1e-4;
      const RBR = (r: number) => r * filamentField(Rc, Zc, r, Z).BR;
      const div = (RBR(R + h) - RBR(R - h)) / (2 * h) / R + (filamentField(Rc, Zc, R, Z + h).BZ - filamentField(Rc, Zc, R, Z - h).BZ) / (2 * h);
      expect(Math.abs(div)).toBeLessThan(1e-6 * Math.hypot(B.BR, B.BZ) / R);
      // reciprocity: the flux at a from a unit current at b equals the flux at b from a unit current at a, divided by the radii ratio: ψ_a←b / √(R_a R_b) is symmetric
      const ab = filamentPsi(R, Z, Rc, Zc), ba = filamentPsi(Rc, Zc, R, Z);
      expect(Math.abs(ab - ba)).toBeLessThan(1e-13 * Math.abs(ba));
    }
  });

  it("obeys Ampère's law: ∮ B · dl around a circle in the poloidal plane, taken in the right-hand sense about the current (e_φ: from +Z towards +R, clockwise in the (R, Z) plane), is μ0 I when the ring crosses it and 0 when it does not", () => {
    const loop = (R0: number, Z0: number, a: number) => {
      const n = 2000;
      let s = 0;
      for (let k = 0; k < n; k++) {
        const t = (2 * Math.PI * k) / n, R = R0 + a * Math.cos(t), Z = Z0 + a * Math.sin(t);
        const B = filamentField(Rc, Zc, R, Z);
        s += (B.BR * Math.sin(t) - B.BZ * Math.cos(t)) * a * ((2 * Math.PI) / n);
      }
      return s;
    };
    expect(loop(Rc, Zc, 0.3) / MU0).toBeCloseTo(1, 10);
    expect(loop(Rc + 0.1, Zc - 0.05, 0.25) / MU0).toBeCloseTo(1, 10);
    expect(loop(0.9, 0.2, 0.5) / MU0).toBeCloseTo(0, 10);
    expect(loop(3.2, Zc, 0.6) / MU0).toBeCloseTo(0, 10);
  });

  it('adds linearly (a two-filament coil) and scales with the current', () => {
    const psi = (R: number, Z: number) => 3e3 * filamentPsi(1.2, -0.5, R, Z) - 1.5e3 * filamentPsi(2.4, 0.8, R, Z);
    const bs = 3e3 * biotSavart(1.2, -0.5, 1.7, 0.3).psi - 1.5e3 * biotSavart(2.4, 0.8, 1.7, 0.3).psi;
    expect(Math.abs(psi(1.7, 0.3) / bs - 1)).toBeLessThan(1e-10);
  });

  it('refuses a point on the filament and a non-positive ring radius', () => {
    expect(() => filamentPsi(Rc, Zc, Rc, Zc)).toThrow(/on the filament/);
    expect(() => filamentField(Rc, Zc, Rc, Zc)).toThrow(RangeError);
    expect(() => filamentPsi(0, 0, 1, 1)).toThrow(/radius/);
    expect(() => filamentPsi(1, 0, -1, 1)).toThrow(RangeError);
    expect(() => filamentField(1, 0, NaN, 1)).toThrow(RangeError);
  });
});
