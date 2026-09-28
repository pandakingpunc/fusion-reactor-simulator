/**
 * Regression tests (lane ws2b, consistency pass): L–H power threshold.
 *  - Martin et al. (2008) is fitted to the LINE-averaged density; the 0D model passed the volume
 *    average.
 *  - Below the density of minimum threshold (Ryter et al., Nucl. Fusion 54 (2014) 083003) the
 *    threshold rises again; the model had no low-density branch.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { plasmaSurface } from '../geometry';
import { lineAverageFactor } from '../limits';
import { ITER, JET } from '../presets';
import { nLHmin, pLH_Martin, pLH_threshold } from '../transport';

describe('L–H threshold with the Ryter (2014) low-density branch', () => {
  const S = plasmaSurface(ITER.geometry), g = ITER.geometry;
  const nmin = nLHmin(ITER.Ip_MA, ITER.B0, g.a, g.R);

  it('n̄_min [1e19] = 0.7 I_p^0.34 B^0.62 a^−0.95 (R/a)^0.4', () => {
    const ref = 0.7 * 15 ** 0.34 * 5.3 ** 0.62 * 2.0 ** -0.95 * (6.2 / 2.0) ** 0.4 * 1e19;
    expect(nmin / ref).toBeCloseTo(1, 12);
    expect(nmin).toBeGreaterThan(0.3e20);
    expect(nmin).toBeLessThan(0.5e20);
  });

  it('is Martin above n̄_min (bit for bit) and rises ∝ 1/n̄ below, continuously', () => {
    for (const n of [nmin, 1.2 * nmin, 1e20]) expect(pLH_threshold(n, ITER.B0, S, 2.5, ITER.Ip_MA, g.a, g.R)).toBe(pLH_Martin(n, ITER.B0, S, 2.5));
    const atMin = pLH_Martin(nmin, ITER.B0, S, 2.5);
    expect(pLH_threshold(nmin * (1 - 1e-9), ITER.B0, S, 2.5, ITER.Ip_MA, g.a, g.R) / atMin).toBeCloseTo(1, 7);
    expect(pLH_threshold(0.5 * nmin, ITER.B0, S, 2.5, ITER.Ip_MA, g.a, g.R) / atMin).toBeCloseTo(2, 12);
    expect(pLH_threshold(0.5 * nmin, ITER.B0, S, 2.5, ITER.Ip_MA, g.a, g.R)).toBeGreaterThan(pLH_Martin(0.5 * nmin, ITER.B0, S, 2.5));
  });

  it('the 0D model evaluates it at the line-averaged density', () => {
    for (const cfg of [ITER, JET]) {
      const m = new MagneticModel(cfg);
      const d = m.diagnostics(0, m.initialState());
      const nbar = lineAverageFactor(cfg.transport.alpha_n) * d.ne * 1e20;
      const M = cfg.fuelFracA * 2.014 + (1 - cfg.fuelFracA) * 3.016;
      const ref = pLH_threshold(nbar, cfg.B0, plasmaSurface(cfg.geometry), M, cfg.Ip_MA, cfg.geometry.a, cfg.geometry.R) / 1e6;
      expect(d.P_LH / ref).toBeCloseTo(1, 12);
    }
  });
});
