/**
 * Preset hygiene (ws2c): the densities of the ITER and DEMO presets are set on the line-averaged Greenwald fraction of their design
 * points, and MAST-U is a scenario of its first campaign with q95 in the published band. Literature values only; the model's
 * outputs are checked against them, never the other way round.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { greenwaldDensity, lineAverageFactor } from '../limits';
import { q95Sauter } from '../geometry';
import { DEMO, DEMO_15D, ITER, ITER_15D, MASTU, PRESETS } from '../presets';
import type { MagneticConfig } from '../types';

/** n̄/n_G of a preset's density target if the target were reached exactly (0D: the target is the volume average) */
const nbarOverGreenwald = (c: MagneticConfig, lineTarget: boolean) =>
  (lineTarget ? c.n_target : lineAverageFactor(c.transport.alpha_n) * c.n_target) / greenwaldDensity(c.Ip_MA, c.geometry.a);

describe('density targets of the ITER and DEMO presets', () => {
  it('ITER: n̄/n_G = 0.85 of the inductive scenario (Casper et al. 2014, Shimada et al. 2007) with the line average of the 0D volume-average target', () => {
    expect(Math.abs(nbarOverGreenwald(ITER, false) / 0.85 - 1)).toBeLessThan(0.005);
    expect(greenwaldDensity(15, 2)).toBeCloseTo(1.194e20, -17);
  });

  it('DEMO: n̄/n_G = 1.2 of the 2018 baseline (Siccinio et al. 2022, table 1), the 0D volume-average target on the line', () => {
    expect(Math.abs(nbarOverGreenwald(DEMO, false) / 1.2 - 1)).toBeLessThan(0.005);
    expect(greenwaldDensity(17.75, 2.93)).toBeCloseTo(0.658e20, -17);
  });

  it('the 1.5D presets regulate the LINE average (control/fueling.ts) and keep their targets: 0.84 n_G (design 0.85) and 1.14 n_G (DEMO studies 1.1–1.2)', () => {
    expect(ITER_15D.n_target).toBe(1.0e20);
    expect(DEMO_15D.n_target).toBe(0.75e20);
    expect(nbarOverGreenwald(ITER_15D, true)).toBeCloseTo(0.84, 2);
    expect(nbarOverGreenwald(DEMO_15D, true)).toBeCloseTo(1.14, 2);
  });

  it('0D ITER and DEMO flat tops reach their line-averaged Greenwald fraction to 3 % (the electron count includes the impurities and the ash)', () => {
    for (const [cfg, want] of [[ITER, 0.85], [DEMO, 1.2]] as const) {
      const sim = new Simulation({ ...cfg, t_end: cfg === ITER ? 120 : 300 });
      sim.runAll();
      const f = sim.history[sim.history.length - 1].d;
      expect(Math.abs(f.nG_frac / want - 1), `${cfg === ITER ? 'ITER' : 'DEMO'} n̄/n_G = ${f.nG_frac}`).toBeLessThan(0.03);
    }
  }, 90_000);
});

describe('MAST-U preset: a scenario of the first campaign (Harrison et al. 2024; Imada et al. 2024; Berkery et al. 2023)', () => {
  it('R 0.8 m, a 0.5 m (R/a 1.6), κ 2.1, δ 0.47, I_p 0.75 MA, B_T 0.55 T, inside the campaign ranges (450–1000 kA, 0.42–0.64 T, κ 2.0–2.2)', () => {
    const g = MASTU.geometry;
    expect(g.R / g.a).toBeCloseTo(1.6, 6);
    expect(g.kappa).toBeGreaterThanOrEqual(2.0);
    expect(g.kappa).toBeLessThanOrEqual(2.2);
    expect(MASTU.Ip_MA).toBeGreaterThanOrEqual(0.45);
    expect(MASTU.Ip_MA).toBeLessThanOrEqual(1.0);
    expect(MASTU.B0).toBeGreaterThanOrEqual(0.42);
    expect(MASTU.B0).toBeLessThanOrEqual(0.64);
    // triangularity 0.45–0.49 in the discharges of Imada et al. 2024, table 1
    expect(g.delta).toBeGreaterThanOrEqual(0.45);
    expect(g.delta).toBeLessThanOrEqual(0.49);
  });

  it('q95 = 4.1 a² B/(R I_p) × the Sauter shape factors = 6.4, inside the published band 5–10 (v3.0.0: 18.2)', () => {
    const q = q95Sauter(MASTU.geometry, MASTU.B0, MASTU.Ip_MA);
    expect(q).toBeGreaterThan(5);
    expect(q).toBeLessThan(10);
    expect(q).toBeCloseTo(6.4, 1);
  });

  it('the 0D shot runs to its scheduled end without a disruption; β_N stays under the limit; the Greenwald fraction is in the campaign\'s 0.4–0.6', () => {
    const sim = new Simulation(MASTU);
    const rep = sim.runAll();
    expect(rep.termination.reason).toBe('Scheduled end');
    const h = sim.history;
    expect(Math.max(...h.map((f) => f.d.betaN))).toBeLessThan(MASTU.limits.betaN_limit);
    const last = h[h.length - 1].d;
    expect(last.nG_frac).toBeGreaterThan(0.4);
    expect(last.nG_frac).toBeLessThan(0.6);
    expect(last.q95).toBeCloseTo(6.4, 1);
    expect(last.H_mode).toBe(1);
  });

  it('the MAST-U entry of the preset list describes it', () => {
    const p = PRESETS.find((x) => x.id === 'MASTU')!;
    expect(p.desc).toContain('A=1.6');
    expect(p.desc).toContain('0.55 T');
  });
});
