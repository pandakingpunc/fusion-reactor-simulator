/**
 * Reference pack: disruption report (src/physics/disruption.ts). The formulas are re-evaluated by hand
 * and checked against the bounds of the ITER disruption database:
 *  [H07]  T.C. Hender et al., "Chapter 3: MHD stability, operational limits and disruptions", Nucl. Fusion
 *         47 (2007) S128 — current-quench lower bound τ_CQ/S ≥ 1.67 ms/m² (S = poloidal cross-section
 *         area), halo fraction I_h/I_p ≤ 0.5 with toroidal peaking TPF ≤ 2 and the design envelope
 *         (I_h/I_p)·TPF ≤ 0.75 for non-VDE events.
 *  [RP97] M.N. Rosenbluth and S.V. Putvinski, Nucl. Fusion 37 (1997) 1355 — avalanche gain ≈ exp(2.5 I_p[MA]).
 *  [L15]  M. Lehnen et al., J. Nucl. Mater. 463 (2015) 39 — tungsten melt threshold ≈ 0.5 MJ/m² at 1 ms.
 * Inductance: L = μ0 R (ln(8R/(a√κ)) − 2 + l_i/2), l_i = 0.8 (Wesson, Tokamaks §3.8, elongation via a√κ).
 */
import { describe, expect, it } from 'vitest';
import { DISRUPTION_FIXES, DISRUPTION_LABELS, DisruptionCause, disruptionReport } from '../disruption';
import { crossSectionArea } from '../geometry';
import { forAll, gen } from '../../testing/prop';

const mu0 = 1.25663706212e-6;
const rel = (a: number, b: number) => Math.abs(a / b - 1);
const causes: DisruptionCause[] = ['density_limit', 'beta_limit', 'q95_limit', 'radiative_collapse', 'tungsten_accumulation', 'vde', 'ntm_locked_mode', 'magnet_quench', 'density_collapse'];

const arb = gen.record({
  cause: gen.oneOf(causes), t: gen.float(0, 1000),
  R: gen.float(0.5, 10), eps: gen.float(0.15, 0.8), kappa: gen.float(1, 2.8), delta: gen.float(0, 0.6),
  I: gen.logFloat(0.05, 25), W: gen.logFloat(1e3, 1e9), B: gen.logFloat(0.2, 13),
});

describe('disruption report', () => {
  it('reproduces the documented formulas', () => {
    forAll(arb, (s) => {
      const g = { R: s.R, a: s.eps * s.R, kappa: s.kappa, delta: s.delta };
      const r = disruptionReport({ cause: s.cause, t: s.t, g, Ip_MA: s.I, W_th_J: s.W, B0: s.B });
      const L = mu0 * g.R * (Math.log((8 * g.R) / (g.a * Math.sqrt(g.kappa))) - 2 + 0.4);
      expect(rel(r.W_mag_MJ, (0.5 * L * (s.I * 1e6) ** 2) / 1e6)).toBeLessThan(1e-12);
      expect(rel(r.tau_TQ_ms, (g.a / 2) * (1 + 0.5 * Math.log(1 + s.I / 5)))).toBeLessThan(1e-12);
      expect(rel(r.tau_CQ_ms, 4 * crossSectionArea(g))).toBeLessThan(1e-12);
      const k = Math.min(1, s.kappa - 1);
      const vdeLike = s.cause === 'vde' || s.cause === 'q95_limit';
      expect(r.halo_fraction).toBeCloseTo(vdeLike ? 0.35 + 0.1 * k : 0.15 + 0.15 * k, 12);
      expect(r.TPF).toBe(s.cause === 'vde' ? 2 : 1.4);
      expect(r.halo_TPF_product).toBeCloseTo(r.halo_fraction * r.TPF, 12);
      expect(r.runaway_avalanche_efolds).toBeCloseTo(2.5 * s.I, 12); // [RP97]
      const wetted = 2 * (2 * Math.PI * g.R * 0.05 * 4);
      expect(rel(r.wall_energy_density_MJm2, (0.5 * s.W) / wetted / 1e6)).toBeLessThan(1e-12);
      expect(r.melt_risk).toBe(r.wall_energy_density_MJm2 > 0.5); // [L15]
      expect(rel(r.vertical_force_MN, (r.halo_fraction * s.I * 1e6 * s.B * 2 * Math.PI * g.R * 0.1) / 1e6)).toBeLessThan(1e-12);
      expect(r.cause).toBe(s.cause);
      expect(r.t_onset).toBe(s.t);
      expect(r.W_th_MJ).toBeCloseTo(s.W / 1e6, 12);
    }, { runs: 300, label: 'disruption formulas' });
  });

  it('[H07] stays inside the disruption-database envelope; runaway current never exceeds 70 % of I_p', () => {
    forAll(arb, (s) => {
      const g = { R: s.R, a: s.eps * s.R, kappa: s.kappa, delta: s.delta };
      const r = disruptionReport({ cause: s.cause, t: s.t, g, Ip_MA: s.I, W_th_J: s.W, B0: s.B });
      expect(r.tau_CQ_ms / crossSectionArea(g)).toBeGreaterThanOrEqual(1.67);
      expect(r.halo_fraction).toBeLessThanOrEqual(0.5);
      expect(r.TPF).toBeLessThanOrEqual(2);
      if (s.cause !== 'vde' && s.cause !== 'q95_limit') expect(r.halo_TPF_product).toBeLessThanOrEqual(0.75);
      expect(r.runaway_current_MA).toBeGreaterThanOrEqual(0);
      expect(r.runaway_current_MA).toBeLessThanOrEqual(0.7 * s.I * (1 + 1e-12));
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') expect(Number.isFinite(v) && v >= 0, k).toBe(true);
    }, { runs: 300 });
  });

  it('every cause has a label and a fix', () => {
    for (const c of [...causes, 'none'] as DisruptionCause[]) {
      expect(typeof DISRUPTION_LABELS[c]).toBe('string');
      expect(typeof DISRUPTION_FIXES[c]).toBe('string');
      if (c !== 'none') expect(DISRUPTION_FIXES[c].length).toBeGreaterThan(10);
    }
  });
});
