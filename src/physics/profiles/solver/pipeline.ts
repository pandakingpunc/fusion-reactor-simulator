/**
 * Evaluation pipeline of the 1.5D work arrays: which modules run, in which order, on which state.
 * The coupled step (solver/coupledStep.ts) calls the parts inside its Picard iterations; the
 * diagnostics of a state no step produced call evaluateWorkArrays.
 *
 *   once per attempt (old state): composition → q profile → step constants: heating powers,
 *                                 sources' prepare (NBI, RF, synchrotron, …), neoclassical closure
 *                                 → fueling control (w.Sn) → sources' particles
 *   rates of the old state:       transport coefficients → sources' heat → current sources (the same
 *                                 evaluations as one Picard iteration, on the old state, for the rate that
 *                                 the trapezoidal stage takes explicitly and the error estimate needs)
 *   per Picard iteration          transport coefficients → density → composition → sources' heat
 *   (of each of the two stages):  (fusion, radiation, exchange, …) → q profile → current sources
 *                                 (conductivity and bootstrap, sources' current drive, ohmic)
 *   once per accepted step:       transport model's and sources' accepted hooks (acceptStep)
 *
 * An attempt is one TR-BDF2 step at one Δt: a step that is retried at a smaller Δt (a rejected one, one
 * that is shortened to end at an event) runs the per-attempt parts again, so the evaluations must be
 * idempotent (see SourceModel).
 */
import type { ProfileContext, StepConstants } from '../context';
import { FUEL_CHANNELS } from '../../reactivity';
import { composition } from '../composition';
import { heatingPowers } from '../control/actuators';
import { currentProfiles } from '../qprofile';
import { neoclassicalCurrent, ohmicHeating } from '../sources/current';
import type { SourceModel } from '../sources/SourceModel';
import type { ProfileState } from '../state';
import { transportCoefficients } from '../transport/coefficients';
import { neoclassicalCoefficients } from '../transport/neoclassical';
import type { TransportModel } from '../transport/TransportModel';

export class PhysicsPipeline {
  constructor(readonly ctx: ProfileContext, readonly transport: TransportModel, readonly sources: readonly SourceModel[]) {
    ctx.onGeometry((tg) => {
      transport.geometryChanged?.(ctx, tg);
      for (const s of sources) s.geometryChanged?.(ctx, tg);
    });
  }

  /** Quantities held fixed over one step, from the old state st (its composition and q evaluated) */
  stepConstants(t: number, st: ProfileState): StepConstants {
    const ctx = this.ctx;
    const btR = FUEL_CHANNELS[ctx.cfg.fuel].map(() => new Float64Array(ctx.N));
    const K: StepConstants = { ...heatingPowers(ctx, t), shine: 0, btR, Eb: ctx.cfg.heating.E_NBI_keV, Psync: 0, S_nbi: 0 };
    for (const s of this.sources) s.prepare?.(ctx, t, st, K);
    neoclassicalCoefficients(ctx, st);
    return K;
  }

  /** Additional particle sources of the sources, added into w.Sn after the fueling control wrote it (old state o) */
  particleSources(t: number, dt: number, o: ProfileState, K: StepConstants): void {
    for (const s of this.sources) s.particles?.(this.ctx, t, dt, o, K);
  }

  /** Accepted step from t to t + dt: the transport model's, then the sources' state updates */
  accepted(t: number, dt: number, o: ProfileState, v: ProfileState): void {
    this.transport.accepted?.(this.ctx, t, dt, o, v);
    for (const s of this.sources) s.accepted?.(this.ctx, t, dt, o, v);
  }

  /** χ, D, v on the faces for the iterate st */
  transportCoefficients(st: ProfileState): void {
    transportCoefficients(this.ctx, this.transport, st);
  }

  /** Heat and particle sources of the iterate (its composition evaluated) */
  heatSources(st: ProfileState, K: StepConstants): void {
    for (const s of this.sources) s.heat?.(this.ctx, st, K);
  }

  /** Conductivity, bootstrap and driven current, ohmic heating of the iterate (its q profile evaluated) */
  currentSources(st: ProfileState, K: StepConstants): void {
    const ctx = this.ctx;
    neoclassicalCurrent(ctx, st);
    ctx.w.jcdB.fill(0);
    for (const s of this.sources) s.current?.(ctx, st, K);
    ohmicHeating(ctx);
  }

  /**
   * Evaluates every work array (composition, q and current profiles, sources, transport
   * coefficients, pressure) from the state st without taking a step. Used for diagnostics of a
   * state no step produced (first frame, after an MHD crash) and after an equilibrium swap, so
   * that postStep and the MHD events never read arrays of the old geometry.
   */
  evaluateWorkArrays(t: number, st: ProfileState): StepConstants {
    const ctx = this.ctx;
    composition(ctx, st.Te, st.ne, st.s);
    currentProfiles(ctx, st.psi, st.s.Ip);
    const K = this.stepConstants(t, st);
    ctx.lastK = K;
    this.transportCoefficients(st);
    this.heatSources(st, K);
    this.currentSources(st, K);
    return K;
  }
}
