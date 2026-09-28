/**
 * Regression tests (lane ws2b, consistency pass): the Greenwald limit is defined for the
 * LINE-averaged density (Greenwald et al., Nucl. Fusion 28 (1988) 2199), but the 0D model divided
 * the VOLUME average by n_G — 10–15 % too low for peaked profiles.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { greenwaldDensity, lineAverageFactor } from '../limits';
import { computePopcon } from '../popcon';
import { DEMO, ITER } from '../presets';

describe('line-averaged / volume-averaged density of n = n0 (1 − ρ²)^α_n', () => {
  it('matches the closed forms: flat 1, parabolic 4/3, α = 2 → 8/5', () => {
    expect(lineAverageFactor(0)).toBeCloseTo(1, 12);
    expect(lineAverageFactor(1)).toBeCloseTo(4 / 3, 12);
    expect(lineAverageFactor(2)).toBeCloseTo(8 / 5, 12);
  });

  it('matches a direct chord integral for non-integer α_n', () => {
    for (const a of [0.1, 0.3, 0.5, 1.7]) {
      const N = 400000;
      let chord = 0;
      for (let i = 0; i < N; i++) chord += Math.pow(1 - ((i + 0.5) / N) ** 2, a) / N;
      const vol = 1 / (1 + a); // ∫ (1 − ρ²)^α 2ρ dρ
      expect(lineAverageFactor(a) / (chord / vol)).toBeCloseTo(1, 5);
    }
  });
});

describe('Greenwald fraction of the 0D model', () => {
  it('is n̄/n_G with n̄ = f_line(α_n) ⟨n_e⟩', () => {
    for (const cfg of [ITER, DEMO]) {
      const m = new MagneticModel(cfg);
      const d = m.diagnostics(0, m.initialState());
      const nG = greenwaldDensity(cfg.Ip_MA, cfg.geometry.a);
      expect(d.nG_frac / ((lineAverageFactor(cfg.transport.alpha_n) * d.ne * 1e20) / nG)).toBeCloseTo(1, 12);
      expect(d.nbar / d.ne).toBeCloseTo(lineAverageFactor(cfg.transport.alpha_n), 12);
    }
  });

  it('POPCON reports the Greenwald limit on its volume-averaged density axis', () => {
    const g = computePopcon(ITER, { nx: 4, ny: 4 });
    expect(g.nG * lineAverageFactor(ITER.transport.alpha_n)).toBeCloseTo(greenwaldDensity(ITER.Ip_MA, ITER.geometry.a), -10);
  });
});
