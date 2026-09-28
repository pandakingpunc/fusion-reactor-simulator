/**
 * Regression tests (lane ws2b, consistency pass): the loss power entering the IPB98(y,2) τ_E and the
 * Martin L–H threshold is P_L = P_heat − P_rad,core − dW/dt (ITER Physics Basis, Nucl. Fusion 39
 * (1999) 2175; Martin et al. 2008), with P_rad,core the radiation from ρ < 0.6. The 0D model ignored
 * dW/dt in both, subtracted all radiation for τ_E and none (P_L = P_heat) for the L–H test.
 */
import { describe, expect, it } from 'vitest';
import { tauIPB98y2 } from '../transport';
import { ITER, JET } from '../presets';
import { Simulation } from '../simulation';

const run = (cfg: typeof ITER) => {
  const sim = new Simulation(cfg);
  sim.runAll();
  return sim;
};

describe('loss power P_L = P_heat − P_rad,core − dW/dt', { timeout: 60_000 }, () => {
  const sim = run({ ...JET });

  it('is reported and consistent with the smoothed dW/dt', () => {
    for (const f of sim.history.filter((h) => h.t > 0.2 && h.t < 5)) {
      expect(f.d.P_rad_core).toBeLessThan(f.d.P_rad);
      expect(f.d.P_rad_core).toBeGreaterThan(0);
      const raw = f.d.P_heat - f.d.P_rad_core - f.d.dWdt;
      const floor = Math.max(0.1 * f.d.P_heat, 0.5 * (sim.model.geometryInfo().V / 100));
      expect(f.d.P_loss).toBeCloseTo(Math.max(raw, floor), 9);
    }
  });

  it('H-mode τ_E is IPB98(y,2) evaluated at P_L and the line-averaged density', () => {
    const cfg = JET, g = cfg.geometry;
    const M = cfg.fuelFracA * 2.014 + (1 - cfg.fuelFracA) * 3.016;
    let n = 0;
    // (the frame recorded at the L→H event carries diagnostics evaluated just before the switch)
    const lhTimes = sim.events.filter((e) => e.kind === 'LH' || e.kind === 'HL').map((e) => e.t);
    for (const f of sim.history.filter((h) => h.d.H_mode === 1 && h.d.NTM === 0 && !lhTimes.includes(h.t))) {
      // IPB98(y,2) is fitted to the LINE-averaged density
      const ref = cfg.H98 * tauIPB98y2(g, cfg.Ip_MA, cfg.B0, f.d.nbar * 1e20, f.d.P_loss * 1e6, M);
      expect(f.d.tauE / ref).toBeCloseTo(1, 9);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  it('dW/dt is positive while the plasma heats up and averages to ~0 in the flat top', () => {
    const rise = sim.history.filter((h) => h.t > 0.3 && h.t < 0.6);
    expect(Math.min(...rise.map((h) => h.d.dWdt))).toBeGreaterThan(0);
    const flat = sim.history.filter((h) => h.t > 4);
    const mean = flat.reduce((s, h) => s + h.d.dWdt, 0) / flat.length;
    expect(Math.abs(mean)).toBeLessThan(0.05 * flat.reduce((s, h) => s + h.d.P_heat, 0) / flat.length);
  });

  it('the L–H transition is triggered by P_L, not by P_heat', () => {
    const lh = sim.events.find((e) => e.kind === 'LH')!;
    expect(lh).toBeDefined();
    const f = sim.history.find((h) => h.t >= lh.t)!;
    expect(f.d.P_loss).toBeGreaterThanOrEqual(0.9 * f.d.P_LH);
    expect(lh.msg).toMatch(/P_L/);
  });
});
