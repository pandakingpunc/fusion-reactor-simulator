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
 * A model with state beyond y implements the Checkpointable hooks and takes part in the model's
 * checkpoints.
 */
import type { Checkpointable } from '../checkpoint';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';

export interface TransportModel extends Partial<Checkpointable> {
  /** short identifier (ProfileSettings.transportModel) */
  readonly id: string;
  /** true: τ_E is predicted (W/P_loss); false: W is held to the τ_E scaling by the C_χ controller */
  readonly predictive: boolean;
  /**
   * Anomalous χ_e, χ_i [m²/s] on the faces f = 0 … N for the iterate st (ctx.w.qF holds its q
   * profile, ctx.bc the separatrix values), before barrier, islands and floors.
   */
  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void;
}
