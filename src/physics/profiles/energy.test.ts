/**
 * Energy conservation of the 1.5D model: the discrete energy balance of the full model over a
 * burning flat-top, closed by the power across the separatrix (P_bound).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D } from '../presets';
import { ProfileModel } from './model';

describe('discrete energy balance of the full model', () => {
  it('ITER15 flat-top: every accepted step has |dW/dt − (P_heat − P_rad − P_bound)| < 1e-4 P_heat', () => {
    // flat-top: after the 10 s heating ramp and the 30 s density ramp
    const tFlat = 40, tEnd = 150;
    const sim = new Simulation({ ...ITER_15D, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    const steps: { t: number; resid: number; bound: number }[] = [];
    m.postStep = (t, dt, y) => {
      // before the event models run: lastDiag holds the diagnostics the accepted step wrote
      if (dt > 0 && t > tFlat && m.ctx.phase === 'normal') {
        const d = m.ctx.lastDiag;
        steps.push({ t, resid: (d.dWdt - (d.P_heat - d.P_rad - d.P_bound)) / d.P_heat, bound: d.P_bound / d.P_heat });
      }
      return post(t, dt, y);
    };
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    expect(steps.length).toBeGreaterThan(1000);
    // the flat-top has ELMs, sawteeth and an NTM: steps after a crash start from the crashed state
    const inFlat = (kind: string) => sim.events.filter((e) => e.kind === kind && e.t > tFlat).length;
    expect(inFlat('ELM')).toBeGreaterThan(100);
    expect(inFlat('sawtooth')).toBeGreaterThanOrEqual(3);
    expect(inFlat('NTM_onset')).toBeGreaterThanOrEqual(1);
    const worst = Math.max(...steps.map((s) => Math.abs(s.resid)));
    expect(worst).toBeLessThan(1e-4);
    // the balance is not trivial: the separatrix carries a large part of the heating power
    expect(Math.min(...steps.map((s) => s.bound))).toBeGreaterThan(0.2);
  }, 120000);
});
