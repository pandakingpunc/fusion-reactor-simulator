/**
 * Regression tests (lane ws2b, consistency pass): stellarator confinement was f_ren × τ_ISS04 × H98 —
 * two multipliers for one thing, one of them the tokamak IPB98 factor. It is now an explicit
 * renormalisation τ_E = H_ISS04 · τ_ISS04 (Yamada et al., Nucl. Fusion 45 (2005) 1684); the old
 * stellarator.f_ren stays as a deprecated alias (H_ISS04 = f_ren · H98 when H_ISS04 is absent).
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { W7X } from '../presets';
import { stellaratorHISS04, tauISS04 } from '../transport';
import { MagneticConfig } from '../types';

function tauAndRef(cfg: MagneticConfig, H: number) {
  const m = new MagneticModel(cfg);
  const d = m.diagnostics(5, m.initialState());
  return { tau: d.tauE, ref: tauISS04(cfg.geometry, cfg.B0, d.ne * 1e20, d.P_loss * 1e6, cfg.stellarator.iota23, 1) * H, m };
}

describe('stellarator H_ISS04', () => {
  it('τ_E = H_ISS04 · τ_ISS04; neither f_ren nor the tokamak H98 multiply it again', () => {
    const cfg: MagneticConfig = { ...W7X, H98: 2, stellarator: { iota23: 0.9, f_ren: 0.3, H_ISS04: 0.8 } };
    const { tau, ref, m } = tauAndRef(cfg, 0.8);
    expect(tau / ref).toBeCloseTo(1, 12);
    expect(m.getControls().H_ISS04).toBe(0.8);
    expect(m.getControls().H98).toBeUndefined();
  });

  it('configs without H_ISS04 keep their old confinement (alias H_ISS04 = f_ren · H98)', () => {
    expect(stellaratorHISS04({ f_ren: 0.7 }, 1.2)).toBeCloseTo(0.84, 15);
    expect(stellaratorHISS04({ f_ren: 0.7, H_ISS04: 1.1 }, 1.2)).toBe(1.1);
    const cfg: MagneticConfig = { ...W7X, H98: 1.25, stellarator: { iota23: 0.9, f_ren: 0.8 } };
    const { tau, ref } = tauAndRef(cfg, 1.0);
    expect(tau / ref).toBeCloseTo(1, 12);
  });
});
