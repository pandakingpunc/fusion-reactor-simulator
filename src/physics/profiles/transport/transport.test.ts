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
  // The run took ~30 s of wall time with the backward-Euler step (Picard alone oscillates on the steep χ(R/L_T): a third of the attempts
  // failed) and takes ~5 s with the TR-BDF2 step and Anderson-accelerated Picard. It still advances in chunks and yields to the event loop
  // in between (runAllYielding), or the Vitest worker cannot answer the runner and coverage runs fail on "Timeout calling onTaskUpdate".
  it('ITER15 ramp-up to 10 s: completes, stays finite and reports the actual τ_E = W/P_loss', async () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 10, profiles: { ...ITER_15D.profiles, transportModel: 'cgm' } });
    const m = sim.model as ProfileModel;
    expect(m.physics.transport.id).toBe('cgm');
    const post = m.postStep.bind(m);
    let worstBalance = 0;
    m.postStep = (t, dt, y) => {
      // the discrete energy balance of the TR-BDF2 step (CoupledStepper.energyResidual); the start-up ramp is left out (P_heat ≈ 0), and so is a
      // step cut short (by the output grid or an event) to below 0.5 ms: the separatrix power P_SOL takes the dW/dt of the previous step (the
      // edge model of v4.0, first order in the step), so after a step of 12 ms a step of 0.14 ms is off by up to 1.3e-3 of P_heat; the steps of
      // the run close within 3e-4
      if (dt > 5e-4 && m.ctx.phase === 'normal' && t > 0.2) worstBalance = Math.max(worstBalance, Math.abs(m.stepper.energyResidual));
      return post(t, dt, y);
    };
    const r = await runAllYielding(sim);
    // completes on schedule without numerical trouble
    expect(r.termination.natural).toBe(true);
    expect(r.termination.reason).toBe('Scheduled end');
    expect(m.forcedSteps).toBe(0);
    expect(m.stepFailure).toBeNull();
    expect(r.warnings.some((w) => w.includes('forced'))).toBe(false);
    // the steep χ(R/L_T) no longer stalls the Picard iteration: few attempts are repeated (a third of them failed before the Anderson mixing)
    const st = m.stepper.stats;
    expect((st.rejected + st.failed) / (st.accepted + st.rejected + st.failed)).toBeLessThan(0.03);
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
    expect(worstBalance).toBeLessThan(1e-3);
  }, 180000);
});
