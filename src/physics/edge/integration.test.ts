/**
 * The edge model in the 0D shot model (diagnostics, report, stellarators), its configuration, and the POPCON maps.
 * The 1.5D model is in integration15.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runAllYielding } from '../../testing/yielding';
import { flatTopMean } from '../analysis/flatTop';
import { computePopcon } from '../popcon';
import { ITER, JET, W7X } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';
import { FUEL_SPECIES } from '../reactivity';
import { EDGE_DIAGS, edgeDiagnostics, edgePlasma0D, edgeReportEntries, edgeSetup, separatrixDensity, solveEdge } from './index';

const EDGE_KEYS = EDGE_DIAGS.map((d) => d.key);

describe('edge diagnostics of the 0D model', { timeout: 120_000 }, () => {
  let sim: Simulation;
  beforeAll(async () => { sim = new Simulation(ITER); await runAllYielding(sim); });

  it('every frame carries the edge channels, finite, with the state and P_sep/R of the frame', () => {
    expect(EDGE_KEYS).toEqual(['P_sep_R', 'lambda_q', 'T_u', 'T_t', 'q_peak', 'f_pwr', 'detach', 'cz_det', 'q_det', 'p_div']);
    expect(sim.model.diagSpecs.map((s) => s.key)).toEqual(expect.arrayContaining(EDGE_KEYS));
    for (const f of sim.history) {
      for (const k of EDGE_KEYS) expect(Number.isFinite(f.d[k]), `t=${f.t} ${k}`).toBe(true);
      expect([0, 1, 2]).toContain(f.d.detach);
      expect(f.d.cz_det).toBeLessThanOrEqual(1);
    }
    // the channels are the edge model of the frame's own P_SOL = P_heat − P_rad, ⟨n_e⟩ and I_p
    const f = sim.history[Math.floor(sim.history.length * 0.8)];
    const cfg = ITER as MagneticConfig;
    const fs = FUEL_SPECIES[cfg.fuel], M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
    const r = solveEdge(edgePlasma0D(cfg, cfg.geometry, (f.d.P_heat - f.d.P_rad) * 1e6, f.d.Ip * 1e6, f.d.ne * 1e20, M), edgeSetup(cfg).par);
    expect(f.d.P_sep_R / r.P_sep_R).toBeCloseTo(1, 6);
    expect(f.d.T_t / r.T_t).toBeCloseTo(1, 6);
    expect(f.d.q_peak / r.q_peak).toBeCloseTo(1, 6);
  });

  it('ITER flat top: P_sep/R about 17 MW/m, sub-mm λ_q (Eich #14), an attached divertor of about 20–30 MW/m² at f_rad,div = 0.7', () => {
    const m = (k: string) => flatTopMean(sim.history, k);
    expect(m('P_sep_R')).toBeGreaterThan(15);
    expect(m('P_sep_R')).toBeLessThan(21);
    expect(m('lambda_q')).toBeGreaterThan(0.5);
    expect(m('lambda_q')).toBeLessThan(0.65);
    expect(m('f_pwr')).toBeCloseTo(0.7, 3);
    expect(m('q_peak')).toBeGreaterThan(15);
    expect(m('q_peak')).toBeLessThan(35);
    // the same order as the engineering heat flux that uses the fixed radiated fraction (S = λ_q there)
    expect(m('q_peak') / m('q_div')).toBeGreaterThan(0.7);
    expect(m('q_peak') / m('q_div')).toBeLessThan(1.05);
    expect(m('detach')).toBe(0);
    // the two-point separatrix temperature of a 100 MW SOL: a few hundred eV
    expect(m('T_u')).toBeGreaterThan(250);
    expect(m('T_u')).toBeLessThan(500);
  });

  it('the shot report lists the edge quantities with the flat-top means', () => {
    const rep = sim.runAll();
    const e = rep.engineering as Record<string, number | string>;
    expect(e['P_sep/R (MW/m)']).toBeCloseTo(flatTopMean(sim.history, 'P_sep_R'), 0);
    expect(e['Target T_e, two-point (eV)']).toBeCloseTo(flatTopMean(sim.history, 'T_t'), 0);
    expect(e['Target q_peak, two-point (MW/m²)']).toBeCloseTo(flatTopMean(sim.history, 'q_peak'), 0);
    expect(e['Detachment state']).toBe('attached');
    expect(typeof e['c_z for detachment, Lengyel upper bound (%)']).toBe('number');
  });

  it('a stellarator has no two-point SOL: no edge channels in its frames or its list of channels, no report entries', () => {
    const w = new Simulation({ ...W7X, t_end: 1 } as MagneticConfig);
    w.runAll();
    expect(w.model.diagSpecs.some((s) => s.group === 'Edge')).toBe(false);
    for (const f of w.history) for (const k of EDGE_KEYS) expect(f.d[k]).toBeUndefined();
    expect(Object.keys(w.runAll().engineering as object).some((k) => /two-point/.test(k))).toBe(false);
  });

  it('report entries are empty without the channels and show n/a for an infinite requirement', () => {
    expect(edgeReportEntries(() => 1, false)).toEqual({});
    const e = edgeReportEntries((k) => (k === 'cz_det' ? Infinity : 30), true);
    expect(e['c_z for detachment, Lengyel upper bound (%)']).toBe('n/a');
    expect(e['Detachment state']).toBe('attached');
    expect(edgeReportEntries((k) => (k === 'T_t' ? 5 : 1), true)['Detachment state']).toBe('partially detached');
    expect(edgeReportEntries((k) => (k === 'T_t' ? 0.6 : 1), true)['Detachment state']).toBe('detached');
  });

  it('is finite in the start-up transient and after a disruption too (JET: disrupted and short shots)', () => {
    const j = new Simulation({ ...JET, t_end: 1 } as MagneticConfig);
    j.runAll();
    for (const f of j.history) for (const k of EDGE_KEYS) expect(Number.isFinite(f.d[k])).toBe(true);
    const d = edgeDiagnostics(JET as MagneticConfig, JET.geometry, 0, 0, 0, 2.5);
    for (const k of EDGE_KEYS) expect(Number.isFinite(d[k])).toBe(true);
  });

  it('the separatrix density of the 0D model is nsepFrac ⟨n_e⟩ (profiles setting, default 0.35)', () => {
    expect(separatrixDensity(ITER as MagneticConfig, 1e20) / 0.35e20).toBeCloseTo(1, 12);
    expect(separatrixDensity({ ...ITER, profiles: { nsepFrac: 0.5 } } as MagneticConfig, 1e20) / 0.5e20).toBeCloseTo(1, 12);
    expect(separatrixDensity({ ...ITER, profiles: { nsepFrac: -1 } } as MagneticConfig, 1e20) / 0.35e20).toBeCloseTo(1, 12);
  });

  it('edgeSetup takes the options and the seed of the configuration (memoised), the SOL seed being the core seed times the enrichment', () => {
    const cfg = { ...ITER, divertor: { ...ITER.divertor, edge: { seedEnrichment: 5, radiation: 'lengyel' as const } } } as MagneticConfig;
    const s = edgeSetup(cfg);
    expect(s).toBe(edgeSetup(cfg));
    expect(s.par.radiation).toBe('lengyel');
    expect(s.seed).toEqual({ species: 'Ar', c: 5 * 0.0012 });
    expect(edgeSetup({ ...ITER, impurity: { ...ITER.impurity, seedSpecies: undefined } } as MagneticConfig).seed).toBeUndefined();
    expect(edgeSetup({ ...ITER, impurity: { ...ITER.impurity, seedConcentration: 0 } } as MagneticConfig).seed).toBeUndefined();
    expect(edgeSetup(ITER as MagneticConfig).f_rad_div).toBe(0.7);
    expect(edgeSetup(ITER as MagneticConfig).f_x).toBe(5);
  });
});

describe('POPCON edge maps', () => {
  it('are opt-in: without the option the grid is unchanged and has no edge arrays', () => {
    const a = computePopcon(ITER as MagneticConfig, { nx: 12, ny: 12 });
    expect(a.PsepR).toBeUndefined();
    expect(a.qPeak).toBeUndefined();
    expect(Object.keys(a)).not.toContain('Tt');
    const b = computePopcon(ITER as MagneticConfig, { nx: 12, ny: 12, edge: true });
    for (const k of ['n', 'T', 'Paux', 'Pfus', 'Q', 'betaN', 'PLH_ok', 'fHe'] as const) expect(b[k]).toEqual(a[k]);
  });

  it('give P_sep/R, the target temperature and the peak load at the steady state of each cell: P_sep = W/τ_E', () => {
    const g = computePopcon(ITER as MagneticConfig, { nx: 12, ny: 12, edge: true });
    expect(g.PsepR!.length).toBe(144);
    for (let k = 0; k < 144; k++) {
      expect(Number.isFinite(g.PsepR![k]) && Number.isFinite(g.qPeak![k]) && Number.isFinite(g.Tt![k])).toBe(true);
      expect(g.PsepR![k]).toBeGreaterThan(0);
    }
    // a hotter, denser plasma at fixed size loses more: P_sep/R rises along T at fixed n (W/τ_E ∝ P^0.31 T^…)
    const at = (i: number, j: number) => g.PsepR![i * 12 + j];
    expect(at(6, 11)).toBeGreaterThan(at(6, 2));
    expect(g.qPeak![6 * 12 + 11]).toBeGreaterThan(g.qPeak![6 * 12 + 2]);
    // a stellarator has no edge maps
    expect(computePopcon(W7X as MagneticConfig, { nx: 6, ny: 6, edge: true }).PsepR).toBeUndefined();
  });
});
