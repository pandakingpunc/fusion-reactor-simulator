/**
 * Evaluation pipeline of the 1.5D work arrays: which modules run, in which order, on which state.
 * The coupled step (solver/coupledStep.ts) calls the parts inside its Picard iteration; the
 * diagnostics of a state no step produced call evaluateWorkArrays.
 *
 *   once per step (old state):  composition → q profile → step constants: heating powers,
 *                               sources' prepare (NBI, RF, synchrotron, …), neoclassical closure
 *   per Picard iteration:       transport coefficients → density → composition → sources' heat
 *                               (fusion, radiation, exchange, …) → q profile → current sources
 *                               (conductivity and bootstrap, sources' current drive, ohmic)
 */
import type { ProfileContext, StepConstants } from '../context';
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
    ctx.onGeometry((tg) => { for (const s of sources) s.geometryChanged?.(ctx, tg); });
  }

  /** Quantities held fixed over one step, from the old state st (its composition and q evaluated) */
  stepConstants(t: number, st: ProfileState): StepConstants {
    const ctx = this.ctx;
    const K: StepConstants = { ...heatingPowers(ctx, t), shine: 0, btR: new Float64Array(ctx.N), Eb: ctx.cfg.heating.E_NBI_keV, Psync: 0, S_nbi: 0 };
    for (const s of this.sources) s.prepare?.(ctx, t, st, K);
    neoclassicalCoefficients(ctx, st);
    return K;
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
