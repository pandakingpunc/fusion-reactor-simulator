/**
 * Preset hygiene (ws2c): the densities of the ITER and DEMO presets are set on the line-averaged Greenwald fraction of their design
 * points, and MAST-U is a scenario of its first campaign with q95 in the published band. Literature values only; the model's
 * outputs are checked against them, never the other way round.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { MagneticModel } from '../confinement/magnetic';
import { greenwaldDensity, lineAverageFactor } from '../limits';
import { boundaryShape, plasmaVolume, q95Sauter } from '../geometry';
import { DEMO, DEMO_15D, ITER, ITER_15D, JET, MASTU, PRESETS } from '../presets';
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

describe('the 0D volume, surface and area follow an edited κ or δ (no override hidden in the 1.5D-only LCFS fields)', () => {
  const zeroD = PRESETS.map((p) => p.cfg).filter((c): c is MagneticConfig => 'geometry' in c && (c as MagneticConfig).fidelity !== '1.5D');
  const geo = (cfg: MagneticConfig, kappa: number, delta: number) => new MagneticModel({ ...cfg, geometry: { ...cfg.geometry, kappa, delta } }).geometryInfo();

  it('every 0D magnetic preset: V and S grow with κ and change with δ (the wizard hides profiles.lcfs*; ITER and DEMO once did not respond)', () => {
    expect(zeroD.length).toBeGreaterThanOrEqual(8);
    for (const cfg of zeroD) {
      const { kappa, delta } = cfg.geometry;
      const base = geo(cfg, kappa, delta);
      const taller = geo(cfg, kappa + 0.3, delta);
      const shaped = geo(cfg, kappa, delta + 0.15);
      expect(taller.V, `${cfg.method} R=${cfg.geometry.R}: V(κ+0.3)`).toBeGreaterThan(base.V * 1.05);
      expect(taller.S, `${cfg.method} R=${cfg.geometry.R}: S(κ+0.3)`).toBeGreaterThan(base.S * 1.02);
      expect(shaped.V, `${cfg.method} R=${cfg.geometry.R}: V(δ+0.15)`).not.toBe(base.V);
      expect(shaped.S, `${cfg.method} R=${cfg.geometry.R}: S(δ+0.15)`).not.toBe(base.S);
      // the same edit through the shape function of the model and POPCON
      const gB = boundaryShape({ ...cfg, geometry: { ...cfg.geometry, kappa: kappa + 0.3, delta } });
      expect(plasmaVolume(gB)).toBe(taller.V);
    }
  });

  it('ITER and DEMO: at the preset shape V and S are those of the LCFS shape (842 m3, 683 m2; 2637 m3, 1462 m2); V is proportional to κ at fixed δ', () => {
    for (const [cfg, V, S] of [[ITER, 842.0, 682.6], [DEMO, 2637.5, 1461.6]] as const) {
      const g = geo(cfg, cfg.geometry.kappa, cfg.geometry.delta);
      expect(g.V).toBeCloseTo(V, 1);
      expect(g.S).toBeCloseTo(S, 1);
      const k = geo(cfg, cfg.geometry.kappa * 1.1, cfg.geometry.delta);
      expect(k.V / g.V).toBeCloseTo(1.1, 12);
      // δ = 0 has the ellipse's larger volume (the Miller volume factor falls with δ)
      expect(geo(cfg, cfg.geometry.kappa, 0).V).toBeGreaterThan(g.V);
    }
  });
});

describe('geometryInfo reports the nominal (95 %) shape and the boundary (LCFS) shape side by side', () => {
  const info = (cfg: MagneticConfig) => new MagneticModel(cfg).geometryInfo();

  it('ITER and DEMO: kappa, delta are the 95 % values of q95 and the scalings, kappaB, deltaB the LCFS values of V and S (Shimada 2007: 1.85 and 0.49)', () => {
    const it = info(ITER), de = info(DEMO);
    expect([it.kappa, it.delta, it.kappaB, it.deltaB]).toEqual([1.7, 0.33, 1.85, 0.49]);
    expect([de.kappa, de.delta, de.kappaB, de.deltaB]).toEqual([1.65, 0.33, 1.85, 0.5]);
    // the volume belongs to the boundary shape
    expect(it.V).toBe(plasmaVolume(boundaryShape(ITER)));
  });

  it('a preset without an LCFS shape (JET) has equal nominal and boundary values, and an edited kappa moves the boundary in the ratio of the reference shape', () => {
    const j = info(JET);
    expect(j.kappaB).toBe(j.kappa);
    expect(j.deltaB).toBe(j.delta);
    const g = ITER.geometry, e = info({ ...ITER, geometry: { ...g, kappa: g.kappa * 1.1 } });
    expect(e.kappa).toBeCloseTo(1.7 * 1.1, 12);
    expect(e.kappaB).toBeCloseTo(1.85 * 1.1, 12);
  });
});

describe('the boundary shape reaches the report', () => {
  it('the 0D shot report takes its neutron wall load from the same (LCFS) surface as the diagnostic and the 1.5D report: ITER 0.53 MW/m2 (design 0.5 at 500 MW)', () => {
    const sim = new Simulation({ ...ITER, t_end: 120 });
    const rep = sim.runAll();
    const wl = rep.engineering['Neutron wall load (MW/m²)'] as number;
    const tail = sim.history.slice(Math.floor(0.7 * sim.history.length));
    const diag = tail.reduce((s, f) => s + f.d.n_wall, 0) / tail.length;
    expect(Math.abs(wl - diag)).toBeLessThan(0.02); // the report is rounded to 0.01 and averages by time
    expect(wl).toBeGreaterThan(0.45);
    expect(wl).toBeLessThan(0.6);
  }, 60_000);
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
