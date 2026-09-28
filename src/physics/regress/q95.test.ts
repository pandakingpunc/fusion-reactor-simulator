/**
 * Regression tests (lane ws2b, consistency pass): the ITER (Uckan) q95 formula carries a factor
 * (1 − ε²)⁻², fitted for conventional aspect ratios; at MAST-U's ε = 0.76 it gave q95 = 34.
 * Spherical tokamaks use the low-aspect-ratio fit of O. Sauter, Fusion Eng. Des. 112 (2016) 633.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { q95, q95ForMethod, q95Sauter } from '../geometry';
import { ITER, MASTU } from '../presets';

describe('q95 at low aspect ratio', () => {
  it('Sauter (2016): q95 = 4.1 a²B/(R I_p) f_κ f_δ (1 + 0.45 δε)/(1 − 0.74 ε)', () => {
    const g = MASTU.geometry, e = g.a / g.R;
    const ref = ((4.1 * g.a * g.a * MASTU.B0) / (g.R * MASTU.Ip_MA)) * (1 + 1.2 * (g.kappa - 1) + 0.56 * (g.kappa - 1) ** 2) *
      (1 + 0.09 * g.delta + 0.16 * g.delta ** 2) * (1 + 0.45 * g.delta * e) / (1 - 0.74 * e);
    expect(q95Sauter(g, MASTU.B0, MASTU.Ip_MA) / ref).toBeCloseTo(1, 12);
    expect(q95Sauter(g, MASTU.B0, 2 * MASTU.Ip_MA) / q95Sauter(g, MASTU.B0, MASTU.Ip_MA)).toBeCloseTo(0.5, 12);
  });

  it('agrees with the ITER formula within 10 % at conventional aspect ratio', () => {
    const u = q95(ITER.geometry, ITER.B0, ITER.Ip_MA), s = q95Sauter(ITER.geometry, ITER.B0, ITER.Ip_MA);
    expect(Math.abs(s / u - 1)).toBeLessThan(0.1);
  });

  it('spherical tokamaks use it, conventional tokamaks keep the ITER formula', () => {
    expect(q95ForMethod('tokamak', ITER.geometry, ITER.B0, ITER.Ip_MA)).toBe(q95(ITER.geometry, ITER.B0, ITER.Ip_MA));
    expect(q95ForMethod('spherical_tokamak', MASTU.geometry, MASTU.B0, 1)).toBe(q95Sauter(MASTU.geometry, MASTU.B0, 1));
    const m = new MagneticModel(MASTU);
    const d = m.diagnostics(0, m.initialState());
    expect(d.q95).toBeCloseTo(q95Sauter(MASTU.geometry, MASTU.B0, MASTU.Ip_MA), 12);
    expect(d.q95).toBeGreaterThan(5);
    expect(d.q95).toBeLessThan(20); // the ITER formula gave 34
  });
});
