/**
 * Smoke test of the predictive critical-gradient transport ('cgm', transport/cgm.ts) on a full
 * machine: the ITER15 ramp-up through the L–H transition and the first sawtooth crash.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../simulation';
import { ITER_15D } from '../../presets';
import { ProfileModel } from '../model';
import { runAllYielding } from '../../../testing/yielding';

describe("'cgm' transport smoke test", () => {
  // The run takes ~30 s of wall time (≈ 2 s per simulated second, uncalibrated model): it advances in chunks and yields to the event loop
  // in between (runAllYielding), or the Vitest worker cannot answer the runner and coverage runs fail on "Timeout calling onTaskUpdate".
  it('ITER15 ramp-up to 10 s: completes, stays finite and reports the actual τ_E = W/P_loss', async () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 10, profiles: { ...ITER_15D.profiles, transportModel: 'cgm' } });
    const m = sim.model as ProfileModel;
    expect(m.physics.transport.id).toBe('cgm');
    const post = m.postStep.bind(m);
    let worstBalance = 0;
    m.postStep = (t, dt, y) => {
      if (dt > 0 && m.ctx.phase === 'normal') {
        const d = m.ctx.lastDiag;
        worstBalance = Math.max(worstBalance, Math.abs(d.dWdt - (d.P_heat - d.P_rad - d.P_bound)) / d.P_heat);
      }
      return post(t, dt, y);
    };
    const r = await runAllYielding(sim);
    // completes on schedule without numerical trouble
    expect(r.termination.natural).toBe(true);
    expect(r.termination.reason).toBe('Scheduled end');
    expect(m.forcedSteps).toBe(0);
    expect(m.stepFailure).toBeNull();
    expect(r.warnings.some((w) => w.includes('forced'))).toBe(false);
    // the ramp-up crosses an L–H transition and a sawtooth crash (a frame of a state no step produced)
    const kinds = sim.events.map((e) => e.kind);
    expect(kinds).toContain('LH');
    expect(kinds).toContain('sawtooth');
    // every diagnostic and profile of every frame is finite
    expect(sim.history.length).toBeGreaterThan(500);
    for (const h of sim.history) {
      for (const [k, v] of Object.entries(h.d)) if (!Number.isFinite(v)) throw new Error(`t = ${h.t}: ${k} = ${v}`);
      if (h.prof) for (const [k, a] of Object.entries(h.prof)) if (!a.every(Number.isFinite)) throw new Error(`t = ${h.t}: profile ${k} not finite`);
    }
    // predictive closure: τ_E is the actual W/P_loss in every frame (crash frames included), and
    // P_cond = W/τ_E is the loss power; the scaling law is only reported beside it
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
    for (const h of sim.history.slice(1)) {
      expect(rel(h.d.tauE, h.d.W / h.d.P_loss)).toBeLessThan(1e-12);
      expect(rel(h.d.P_cond, h.d.P_loss)).toBeLessThan(1e-12);
      expect(h.d.chi_mult).toBe(1);
    }
    const last = sim.history[sim.history.length - 1].d;
    expect(last.H_mode).toBe(1);
    expect(last.tauE).toBeGreaterThan(0.3);
    expect(rel(last.tauE, last.tauE_scal)).toBeGreaterThan(0.1);
    expect(last.Te0).toBeGreaterThan(5);
    expect(last.Te0).toBeLessThan(40);
    // stiff transport: the energy balance of each step still closes within the Picard tolerance
    expect(worstBalance).toBeLessThan(2e-3);
  }, 180000);
});
