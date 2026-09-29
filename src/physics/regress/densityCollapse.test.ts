/**
 * Density collapse (ws2c; the ws2a finding pinned in reference/wizardSmoke.test.ts): with the maximum fuelling rate at its minimum of 0 the
 * heating stays on while the plasma has no particle source; τ_E ∝ n^0.5 shrinks with n, the density falls to zero in finite time and T_e
 * to 10⁴ keV (W7-X: T_e = 1.7 MeV at 0.66 s), the integrator stalls at dtMin and the state overflows to NaN. The 0D magnetic model ends the
 * shot with 'Density collapse — fuelling lost' when the volume-averaged n_e falls below 10 % of the commanded target.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { JET, PRESETS, W7X } from '../presets';
import type { MagneticConfig } from '../types';

const noFuel = (c: MagneticConfig): MagneticConfig => ({ ...c, fueling: { ...c.fueling, maxRate_1e20s: 0 } });

describe('density collapse', () => {
  it('W7-X without fuelling ends with a density-collapse termination, at temperatures far below 1 MeV, in a few hundred steps', () => {
    const sim = new Simulation(noFuel(W7X));
    const rep = sim.runAll();
    expect(rep.termination.reason).toBe('Density collapse — fuelling lost');
    expect(rep.termination.natural).toBe(false);
    expect(rep.termination.fix).toContain('fuelling rate');
    expect(rep.termination.diagnosis).toContain('below 10 % of the target');
    const ev = sim.events.find((e) => e.kind === 'disruption')!;
    expect(ev.msg).toMatch(/^DENSITY COLLAPSE: Density collapse/);
    expect(ev.t).toBeGreaterThan(0.3);
    expect(ev.t).toBeLessThan(0.7);
    expect(Math.max(...sim.history.map((f) => f.d.Te))).toBeLessThan(100);
    expect(Math.max(...sim.history.map((f) => f.d.Ti))).toBeLessThan(100);
    expect(sim.nSteps).toBeLessThan(3000);
    expect(sim.history[sim.history.length - 1].t).toBeLessThan(1);
  });

  it('a tokamak without fuelling ends the same way, through the disruption quenches, with the disruption report', () => {
    const sim = new Simulation(noFuel(JET));
    const rep = sim.runAll();
    expect(rep.termination.reason).toBe('Density collapse — fuelling lost');
    expect(rep.termination.disruption?.cause).toBe('density_collapse');
    expect(sim.events.find((e) => e.kind === 'disruption')!.msg).toMatch(/^DISRUPTION: Density collapse/);
    expect(sim.events.some((e) => e.kind === 'quench')).toBe(true);
    expect(rep.termination.t).toBeLessThan(JET.t_end);
  });

  it('no working preset comes near it: the 12 magnetic presets, 30 s or their scheduled end, never log a density collapse', () => {
    let n = 0;
    for (const p of PRESETS) {
      const c = p.cfg as MagneticConfig;
      if (!c.geometry || c.fidelity === '1.5D') continue;
      n++;
      const sim = new Simulation({ ...c, t_end: Math.min(c.t_end, 30) });
      const rep = sim.runAll();
      expect(rep.termination.reason, p.id).not.toMatch(/collapse — fuelling/);
      expect(sim.events.filter((e) => e.kind === 'disruption' && /DENSITY COLLAPSE|Density collapse/.test(e.msg)), p.id).toHaveLength(0);
    }
    expect(n).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('lowering the target density in the middle of the shot is a command, not a collapse (the reference follows the target)', () => {
    const sim = new Simulation({ ...JET, t_end: 5 });
    sim.advance(2);
    sim.applyControl({ n_target_1e20: 0.03 }); // from 0.7e20: the density decays to 4 % of its old value
    sim.advance(3);
    expect(sim.done).toBe(true);
    const rep = sim.report();
    expect(rep.termination.reason).not.toMatch(/collapse — fuelling/);
    expect(sim.history[sim.history.length - 1].d.ne * 1e20).toBeLessThan(0.3 * JET.n_target);
  });
});
