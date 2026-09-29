/**
 * Transport plug-in interface of the 1.5D model.
 *
 * A transport model supplies the anomalous (turbulent) heat diffusivities χ_e, χ_i on the cell
 * faces. The common parts are added afterwards in transport/coefficients.ts, in this order:
 * suppression by the H-mode edge transport barrier (transport/pedestal.ts), the particle
 * diffusivity D = (D/χ) χ_e and the pinch v (from χ_e after the barrier), the flattening inside
 * NTM islands (events/ntm.ts), the neoclassical ion floor (transport/neoclassical.ts), and the
 * 0.01 m²/s numerical floor.
 *
 * `predictive` decides how confinement is closed (control/confinement.ts): a non-predictive model
 * has its amplitude C_χ set by a controller so that W follows the τ_E scaling law, and τ_E is
 * reported as the scaling value; a predictive model is left alone (C_χ = 1) and τ_E = W/P_loss.
 *
 * `diffusivities` is an evaluation, not an event: it runs once per Picard iteration (several
 * times per implicit attempt) and whenever the work arrays of a state that no step produced are
 * evaluated. It must be a function of the state and of the state the model keeps, and leave that
 * state unchanged. A model with state that evolves from step to step (a fast-particle or
 * turbulence-intensity population, a memory of the profile history) integrates it in `accepted`
 * and takes part in the model's checkpoints through the Checkpointable hooks.
 */
import type { Checkpointable } from '../checkpoint';
import type { ProfileContext } from '../context';
import type { TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';

export interface TransportModel extends Partial<Checkpointable> {
  /** short identifier (ProfileSettings.transportModel) */
  readonly id: string;
  /** true: τ_E is predicted (W/P_loss); false: W is held to the τ_E scaling by the C_χ controller */
  readonly predictive: boolean;
  /**
   * Once per attempt, on the OLD state st of the step (its composition and q profile evaluated, ctx.w.qF is its q profile), and for every
   * state that no step produced (PhysicsPipeline.stepConstants runs it before the step constants). The place for what the closure holds
   * fixed over the step: a quantity that depends on the profile as a whole (a non-local temperature difference) or on second derivatives
   * of ψ (the magnetic shear), which the block-tridiagonal Jacobian of the Newton solve (solver/newtonStage.ts, a cell couples to its two
   * neighbours) cannot represent. It must be a function of (t, st) and of the model's settings only, so that a step stays a function of
   * its inputs (chunk invariance, exact rewind); what it keeps is recomputed at every call and needs no checkpoint. The lag is first order
   * in the step, like C_χ or P_SOL, and invisible to the error estimate.
   */
  prepare?(ctx: ProfileContext, t: number, st: ProfileState): void;
  /**
   * Anomalous χ_e, χ_i [m²/s] on the faces f = 0 … N for the iterate st (ctx.w.qF holds its q
   * profile, ctx.bc the separatrix values), before barrier, islands and floors.
   */
  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void;
  /**
   * After the accepted step from t to t + dt (also a forced one; not during the quench phases):
   * yOld is the state at t, y the committed state. Called before the sources' `accepted` hooks.
   */
  accepted?(ctx: ProfileContext, t: number, dt: number, yOld: ProfileState, y: ProfileState): void;
  /** the transport geometry was replaced (an equilibrium was adopted); also called for the first geometry, at construction */
  geometryChanged?(ctx: ProfileContext, tg: TransportGeometry): void;
}
