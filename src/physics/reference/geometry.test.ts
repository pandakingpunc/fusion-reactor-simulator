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
import { Geometry, crossSectionArea, plasmaSurface, plasmaVolume, poloidalField, poloidalPerimeter, profileIntegral, peakFromAverage } from '../geometry';
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

describe('0D geometry formulas', () => {
  it('δ = 0: volume and cross-section area are exact; the Ramanujan perimeter is accurate to 1e-6', () => {
    forAll(shape, (s) => {
      const g = { ...toGeo(s), delta: 0 }, m = millerIntegrals(g);
      expect(rel(plasmaVolume(g), m.volume)).toBeLessThan(1e-12);
      expect(rel(crossSectionArea(g), m.area)).toBeLessThan(1e-12);
      expect(rel(poloidalPerimeter(g), m.perimeter)).toBeLessThan(1e-6);
    }, { runs: 60 });
  });

  it('δ = 0: the surface uses the quadratic-mean perimeter 2πa√((1+κ²)/2), ≤ 6 % above the exact ellipse for κ ≤ 3', () => {
    forAll(shape, (s) => {
      const g = { ...toGeo(s), delta: 0 }, m = millerIntegrals(g);
      const ratio = plasmaSurface(g) / m.surface;
      expect(ratio).toBeGreaterThanOrEqual(1 - 1e-12); // RMS ≥ exact perimeter
      expect(ratio).toBeLessThan(1.06); // 1.6 % at κ = 1.7, 5.0 % at κ = 3
    }, { runs: 60 });
  });

  it('δ ≠ 0: the volume omits exactly the Miller triangularity factor (and overestimates it for δ ≥ 0)', () => {
    forAll(shape, (s) => {
      const g = toGeo(s), m = millerIntegrals(g);
      expect(rel(plasmaVolume(g) * volumeFactor(Math.asin(g.delta), g.a / g.R), m.volume)).toBeLessThan(1e-12);
      if (g.delta >= 0) expect(plasmaVolume(g)).toBeGreaterThanOrEqual(m.volume * (1 - 1e-12));
    }, { runs: 60 });
  });

  // BUG(ws2a): geometry.ts documents the volume approximation as "~3 %", but measured against the
  // Miller boundary of the same (κ, δ) it overestimates the volume by 3.6 % (JET), 4.2 % (ITER, DEMO),
  // 8.6 % (SPARC), 8.9 % (DIII-D), 9.7 % (JT-60SA) and 14.3 % (MAST-U), and the surface by 4–18 %.
  // Volume enters W = 3/2 nTV and P_fus; the surface enters P_LH. Either the comment or the formula
  // (the closed form above is exact) needs fixing; for ITER, κ95 = 1.7 in the ellipse formula happens
  // to reproduce the real ITER volume (≈ 830 m³), which may be intended.
  it.fails('volume and surface agree with the Miller shape to the documented ~3 % for every magnetic preset (BUG(ws2a))', () => {
    for (const p of PRESETS) {
      const c = p.cfg as MagneticConfig;
      if (!c.geometry) continue;
      const m = millerIntegrals(c.geometry);
      expect(rel(plasmaVolume(c.geometry), m.volume), `${p.id} volume`).toBeLessThan(0.03);
      expect(rel(plasmaSurface(c.geometry), m.surface), `${p.id} surface`).toBeLessThan(0.03);
    }
  });

  it('mean poloidal field is μ0 I_p / L_pol (Ampère)', () => {
    forAll(gen.tuple(shape, gen.logFloat(1e4, 3e7)), ([s, I]) => {
      const g = toGeo(s);
      expect(rel(poloidalField(g, I) * poloidalPerimeter(g), 4e-7 * Math.PI * I)).toBeLessThan(1e-9);
    }, { runs: 50 });
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
