/**
 * Reference pack: plasma geometry (src/physics/geometry.ts) against numerical integration of the
 * Miller boundary R(τ) = R0 + a cos(τ + x_δ sin τ), Z(τ) = κ a sin τ, x_δ = arcsin δ
 * (R.L. Miller et al., Phys. Plasmas 5 (1998) 973), the shape the 1.5D/Grad–Shafranov model uses.
 *
 * Closed forms derived here from the Bessel integral J_n(z) = (1/2π) ∫ cos(nτ − z sin τ) dτ
 * (Abramowitz & Stegun 9.1.21) and Green's theorem, A = ∮ R dZ, V = π ∮ R² dZ:
 *   A = π a² κ · 2J1(x)/x
 *   V = 2π² R0 a² κ · [2J1(x)/x − (a/R0) J2(2x)/(2x)]
 * They reduce to the ellipse (π a² κ, 2π² R0 a² κ) for δ = 0.
 */
import { describe, expect, it } from 'vitest';
import { Geometry, arealElongation, boundaryShape, crossSectionArea, plasmaSurface, plasmaVolume, poloidalField, poloidalPerimeter, profileIntegral, peakFromAverage } from '../geometry';
import { millerBoundary, shapeIntegrals } from '../equilibrium/miller';
import { PRESETS } from '../presets';
import type { MagneticConfig } from '../types';
import { forAll, gen } from '../../testing/prop';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

/** Miller boundary integrals by the periodic trapezoid rule (spectrally accurate), analytic derivatives */
function millerIntegrals(g: Geometry, n = 2048) {
  const x = Math.asin(g.delta);
  let A = 0, V = 0, S = 0, L = 0;
  const h = (2 * Math.PI) / n;
  for (let j = 0; j < n; j++) {
    const t = j * h, ph = t + x * Math.sin(t);
    const R = g.R + g.a * Math.cos(ph);
    const dR = -g.a * Math.sin(ph) * (1 + x * Math.cos(t)), dZ = g.kappa * g.a * Math.cos(t);
    const dl = Math.hypot(dR, dZ) * h;
    A += R * dZ * h; V += Math.PI * R * R * dZ * h; L += dl; S += 2 * Math.PI * R * dl;
  }
  return { area: A, volume: V, surface: S, perimeter: L };
}

/** Bessel J_n(z), integer n ≥ 0, power series (|z| ≤ 3 here) */
function besselJ(n: number, z: number): number {
  let term = 1;
  for (let k = 1; k <= n; k++) term *= z / 2 / k;
  let s = 0;
  for (let m = 0; m < 40; m++) { s += term; term *= -(z * z) / 4 / ((m + 1) * (m + 1 + n)); }
  return s;
}
const areaFactor = (x: number) => (x === 0 ? 1 : (2 * besselJ(1, x)) / x);
const volumeFactor = (x: number, eps: number) => (x === 0 ? 1 : areaFactor(x) - (eps * besselJ(2, 2 * x)) / (2 * x));

const shape = gen.record({ R: gen.float(0.5, 10), eps: gen.float(0.1, 0.8), kappa: gen.float(1, 3), delta: gen.float(-0.6, 0.8) });
const toGeo = (s: { R: number; eps: number; kappa: number; delta: number }): Geometry => ({ R: s.R, a: s.eps * s.R, kappa: s.kappa, delta: s.delta });

describe('Miller shape: closed forms vs numerical integration', () => {
  it('area and volume Bessel closed forms equal the boundary integrals; so does equilibrium/miller shapeIntegrals', () => {
    forAll(shape, (s) => {
      const g = toGeo(s), m = millerIntegrals(g), x = Math.asin(g.delta);
      expect(rel(m.area, Math.PI * g.a ** 2 * g.kappa * areaFactor(x))).toBeLessThan(1e-12);
      expect(rel(m.volume, 2 * Math.PI ** 2 * g.R * g.a ** 2 * g.kappa * volumeFactor(x, g.a / g.R))).toBeLessThan(1e-12);
      const si = shapeIntegrals(millerBoundary(g));
      expect(rel(si.area, m.area)).toBeLessThan(1e-8);
      expect(rel(si.volume, m.volume)).toBeLessThan(1e-8);
      expect(rel(si.perimeter, m.perimeter)).toBeLessThan(1e-8);
    }, { runs: 60, label: 'Miller integrals' });
  });
});

describe('0D geometry: volume, surface and cross-section are the Miller boundary integrals (v4.0)', () => {
  it('δ = 0: volume and cross-section area are the ellipse formulas, exactly; the Ramanujan perimeter is accurate to 1e-6', () => {
    forAll(shape, (s) => {
      const g = { ...toGeo(s), delta: 0 }, m = millerIntegrals(g);
      expect(rel(plasmaVolume(g), 2 * Math.PI ** 2 * g.R * g.a ** 2 * g.kappa)).toBeLessThan(1e-15);
      expect(rel(plasmaVolume(g), m.volume)).toBeLessThan(1e-12);
      expect(rel(crossSectionArea(g), m.area)).toBeLessThan(1e-12);
      expect(rel(poloidalPerimeter(g), m.perimeter)).toBeLessThan(1e-6);
    }, { runs: 60 });
  });

  it('every shape (κ ≤ 3, −0.6 ≤ δ ≤ 0.8): volume, surface and cross-section area equal the boundary integrals to 1e-9', () => {
    forAll(shape, (s) => {
      const g = toGeo(s), m = millerIntegrals(g);
      expect(rel(plasmaVolume(g), m.volume)).toBeLessThan(1e-9);
      expect(rel(plasmaSurface(g), m.surface)).toBeLessThan(1e-9);
      expect(rel(crossSectionArea(g), m.area)).toBeLessThan(1e-9);
    }, { runs: 80, label: 'Miller integrals' });
  });

  it('positive triangularity lowers the volume against the ellipse of the same κ (Miller factor 1 − x²/8 − (a/R) x/4 + … < 1 for x = arcsin δ > 0)', () => {
    forAll(shape, (s) => {
      const g = toGeo(s), ell = 2 * Math.PI ** 2 * g.R * g.a ** 2 * g.kappa;
      if (g.delta > 1e-3) expect(plasmaVolume(g)).toBeLessThan(ell);
    }, { runs: 60 });
  });

  it('the surface of the W7-X preset (a circle) and its volume are those of the torus: 4π² R a and 2π² R a²', () => {
    const w = (PRESETS.find((p) => p.id === 'W7X')!.cfg as MagneticConfig).geometry;
    expect(plasmaVolume(w)).toBe(2 * Math.PI * Math.PI * w.R * w.a * w.a);
    expect(rel(plasmaSurface(w), 4 * Math.PI ** 2 * w.R * w.a)).toBeLessThan(1e-14);
  });

  // ws2a pinned this as a bug: geometry.ts documented the ellipse volume as "~3 %" from the Miller shape, but it overestimated it by 3.6 %
  // (JET), 4.2 % (ITER, DEMO), 8.6 % (SPARC), 8.9 % (DIII-D), 9.7 % (JT-60SA) and 14.3 % (MAST-U), the surface by 4–18 % (fixed in v4.0, ws2c).
  it('volume and surface agree with the Miller shape of the same (κ, δ) for every magnetic preset (v3.0.0: up to 14 % and 18 % off)', () => {
    let n = 0;
    for (const p of PRESETS) {
      const c = p.cfg as MagneticConfig;
      if (!c.geometry) continue;
      n++;
      const m = millerIntegrals(c.geometry);
      expect(rel(plasmaVolume(c.geometry), m.volume), `${p.id} volume`).toBeLessThan(1e-9);
      expect(rel(plasmaSurface(c.geometry), m.surface), `${p.id} surface`).toBeLessThan(1e-9);
    }
    expect(n).toBe(12);
  });

  it('the surface of a call is memoised on its shape: another shape in between does not corrupt it', () => {
    const a: Geometry = { R: 6.2, a: 2, kappa: 1.85, delta: 0.49 }, b: Geometry = { R: 1.85, a: 0.57, kappa: 1.97, delta: 0.54 };
    const sa = plasmaSurface(a), sb = plasmaSurface(b);
    expect(plasmaSurface(a)).toBe(sa);
    expect(plasmaSurface(b)).toBe(sb);
    expect(sa).not.toBe(sb);
  });

  it('mean poloidal field is μ0 I_p / L_pol (Ampère)', () => {
    forAll(gen.tuple(shape, gen.logFloat(1e4, 3e7)), ([s, I]) => {
      const g = toGeo(s);
      expect(rel(poloidalField(g, I) * poloidalPerimeter(g), 4e-7 * Math.PI * I)).toBeLessThan(1e-9);
    }, { runs: 50 });
  });
});

describe('boundary shape of the 0D model (boundaryShape)', () => {
  const iter = PRESETS.find((p) => p.id === 'ITER')!.cfg as MagneticConfig;

  it('is the geometry itself unless the configuration carries an LCFS shape (profiles.lcfsKappa / lcfsDelta), field by field', () => {
    const g: Geometry = { R: 3, a: 1, kappa: 1.7, delta: 0.3 };
    expect(boundaryShape({ geometry: g })).toBe(g);
    expect(boundaryShape({ geometry: g, profiles: {} })).toBe(g);
    expect(boundaryShape({ geometry: g, profiles: { lcfsKappa: 1.9 } })).toEqual({ R: 3, a: 1, kappa: 1.9, delta: 0.3 });
    expect(boundaryShape({ geometry: g, profiles: { lcfsDelta: 0.5 } })).toEqual({ R: 3, a: 1, kappa: 1.7, delta: 0.5 });
  });

  // ITER design values: plasma volume 837 m³, plasma surface 678 m² (ITER Physics Basis, Nucl. Fusion 39 (1999) 2137, ch. 1, design parameters).
  // The Miller boundary of the LCFS shape (κ = 1.85, δ = 0.49) is within 1 % of both; the 95 % shape (1.70, 0.33) is 4–5 % low
  // and the v3.0.0 ellipse formula with κ95 hit the volume only by the cancellation of two errors (κ95 < κ_LCFS, no triangularity factor).
  it('the ITER LCFS shape reproduces the design plasma volume (837 m³) and surface (678 m²) to 1 %; the 95 % shape does not', () => {
    const gB = boundaryShape(iter);
    expect(gB).toEqual({ R: 6.2, a: 2, kappa: 1.85, delta: 0.49 });
    expect(Math.abs(plasmaVolume(gB) / 837 - 1)).toBeLessThan(0.01);
    expect(Math.abs(plasmaSurface(gB) / 678 - 1)).toBeLessThan(0.01);
    expect(Math.abs(plasmaVolume(iter.geometry) / 837 - 1)).toBeGreaterThan(0.04);
    expect(Math.abs(plasmaSurface(iter.geometry) / 678 - 1)).toBeGreaterThan(0.03);
  });

  it('the areal elongation V/(2π² R a²) of the ITER LCFS shape is the 1.70 of the ITPA scaling databases within 2 %', () => {
    // κ_a = 1.7 in the ITER point of Verdoolaege et al. 2021 and in the IPB98(y,2) database definition
    expect(Math.abs(arealElongation(boundaryShape(iter)) / 1.7 - 1)).toBeLessThan(0.02);
    expect(arealElongation({ R: 5, a: 1, kappa: 1.6, delta: 0 })).toBeCloseTo(1.6, 14);
  });
});

describe('profile helpers', () => {
  it('peakFromAverage inverts <f> = f0/(1+α) for f = f0(1−ρ²)^α', () => {
    forAll(gen.tuple(gen.float(0, 4), gen.logFloat(1e-3, 1e3)), ([alpha, avg]) => {
      expect(rel(peakFromAverage(avg, alpha), avg * (1 + alpha))).toBeLessThan(1e-15);
    });
  });

  // 40-point midpoint rule on ∫ f 2ρ dρ: the (1−ρ²)^α endpoint behaviour limits it to O(N^−(1+α));
  // measured error ≤ 1.5e-3 (α ≈ 0.3). This is the accuracy of every 0D profile-averaged rate.
  it('profileIntegral volume-averages (1−ρ²)^α to 1/(1+α) within 0.3 %', () => {
    forAll(gen.float(0, 3), (alpha) => {
      expect(rel(profileIntegral((r) => (1 - r * r) ** alpha), 1 / (1 + alpha))).toBeLessThan(3e-3);
    }, { runs: 100 });
    expect(profileIntegral(() => 1)).toBeCloseTo(1, 14);
  });
});
