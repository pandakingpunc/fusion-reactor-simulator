/**
 * The 0D L-H transition near its threshold (lane ws2d): a plasma that is marginal is not monotonic in the density, and that is what the
 * ohmic power does (see the comment at the transition in confinement/magnetic.ts); away from the margin the outcome is monotonic.
 * DIII-D (2 MA, 2.2 T), beams only, 3 s.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { DIIID } from '../presets';
import type { MagneticConfig } from '../types';

/** flat part of a 3 s shot: H-mode fraction, mean and largest P_L/P_LH, and the ohmic power [MW] */
function shot(n1e20: number, P_NBI_MW: number) {
  const cfg: MagneticConfig = { ...DIIID, n_target: n1e20 * 1e20, t_end: 3, heating: { ...DIIID.heating, P_NBI_MW, P_ECRH_MW: 0, P_ICRH_MW: 0 } };
  const sim = new Simulation(cfg);
  sim.runAll();
  const flat = sim.history.filter((f) => f.t > 1.5).map((f) => f.d as Record<string, number>);
  const mean = (k: (d: Record<string, number>) => number) => flat.reduce((s, d) => s + k(d), 0) / flat.length;
  return {
    H: mean((d) => d.H_mode), ratio: mean((d) => d.P_loss / d.P_LH), maxRatio: Math.max(...flat.map((d) => d.P_loss / d.P_LH)), Poh: mean((d) => d.P_oh),
  };
}

describe('L-H threshold versus density, DIII-D 2 MA', { timeout: 90_000 }, () => {
  it('with no heating the plasma stays in L-mode and P_L/P_LH rises with the density: the ohmic power grows as the plasma cools', () => {
    const r = [0.3, 0.7, 1.0].map((n) => shot(n, 0));
    for (const x of r) expect(x.H).toBe(0);
    expect(r[1].ratio).toBeGreaterThan(r[0].ratio);
    expect(r[2].ratio).toBeGreaterThan(r[1].ratio);
    expect(r[2].Poh).toBeGreaterThan(r[0].Poh);
  });

  it('with 8 MW of beam the plasma is in H-mode at every density and P_L/P_LH falls with the density (P_LH ~ n^0.717 against a fixed heating)', () => {
    const r = [0.3, 0.7, 1.0].map((n) => shot(n, 8));
    for (const x of r) expect(x.H).toBe(1);
    expect(r[1].ratio).toBeLessThan(r[0].ratio);
    expect(r[2].ratio).toBeLessThan(r[1].ratio);
    expect(r[0].ratio).toBeGreaterThan(2);
  });

  it('with 1 MW the two trends meet: the plasma comes within 2 % of the threshold at every density from 0.5e20 to 0.8e20, whichever way it decides', () => {
    for (const n of [0.5, 0.65, 0.8]) {
      const x = shot(n, 1);
      expect(x.maxRatio, `n_target ${n}e20`).toBeGreaterThan(0.98);
      // ... and the ohmic power carries most of P_L there (the beam is 1 MW of about 3.5)
      if (x.H === 0) expect(x.Poh, `n_target ${n}e20`).toBeGreaterThan(1.5);
    }
  });
});
