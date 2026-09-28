/**
 * Source plug-in interface of the 1.5D model.
 *
 * A source contributes heat, particle or current source terms to the work arrays. Sources run in
 * the order of the model's source list (sources/index.ts) at these points of a step:
 *
 *  1. prepare   — on the old state, after the composition and q profile of that state:
 *                 quantities held fixed over the Picard iterations (beam deposition, wave
 *                 deposition, synchrotron loss) and the fields of the step constants K;
 *  2. particles — on the old state, after the fueling control wrote the particle source w.Sn of
 *                 the step: additional particle source density, added into w.Sn;
 *  3. heat      — every Picard iteration, on the iterate, after its composition: heat source
 *                 densities (fusion, radiation, exchange);
 *  4. current   — every Picard iteration, after the q profile of the iterate and the bootstrap
 *                 current: non-inductive current drive, added into w.jcdB (cleared before);
 *  5. accepted  — once after each accepted step of the normal phase: the place to evolve state.
 *
 * prepare, particles, heat and current are evaluations, not events. prepare runs once per
 * implicit attempt (a step whose Δt was cut runs it again) and also whenever the work arrays of a
 * state that no step produced are evaluated (first frame, after an equilibrium swap, after an
 * MHD crash); heat and current run once per Picard iteration, at least twice per attempt.
 * They must therefore be functions of (state, t) — and of the state the source keeps — that leave
 * that state unchanged, so that calling them again gives the same result. A population that
 * evolves from step to step is integrated in `accepted` (which gets Δt and the old and new state)
 * and takes part in the model's checkpoints through the Checkpointable hooks; it is not called
 * during the quench phases of a disruption, when no transport step is taken.
 *
 * The heat equation takes Q_e = Σ(electron heating) − P_rad and Q_i = Σ(ion heating) from the
 * work arrays listed in assembleHeatSources (sources/index.ts); a new source writes its own arrays
 * and adds them there. A source with caches on the transport geometry rebuilds them in
 * geometryChanged.
 */
import type { Checkpointable } from '../checkpoint';
import type { ProfileContext, StepConstants } from '../context';
import type { TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';

export interface SourceModel extends Partial<Checkpointable> {
  /** short identifier (logs, tests) */
  readonly id: string;
  /** on the old state st at time t (idempotent, see above); writes into the work arrays and K */
  prepare?(ctx: ProfileContext, t: number, st: ProfileState, K: StepConstants): void;
  /**
   * Once per implicit attempt of the step from t over dt, on the old state st, after the fueling
   * control set ctx.w.Sn (gas, pellets and the NBI particle source): add the particle source
   * density of this source [m⁻³ s⁻¹] into ctx.w.Sn. Not called by evaluations of a state without
   * a step. The electron balance is closed by the fueling feedback on n̄; a source that changes
   * the fuel mix or the impurity inventory must account for it itself.
   */
  particles?(ctx: ProfileContext, t: number, dt: number, st: ProfileState, K: StepConstants): void;
  /** every Picard iteration on the iterate st (idempotent, see above) */
  heat?(ctx: ProfileContext, st: ProfileState, K: StepConstants): void;
  /** every Picard iteration: driven current, added into ctx.w.jcdB [⟨j·B⟩, A T m⁻²] (idempotent, see above) */
  current?(ctx: ProfileContext, st: ProfileState, K: StepConstants): void;
  /**
   * After the accepted step from t to t + dt (also a forced one): yOld is the state at t, y the
   * committed state; the work arrays hold the accepted iterate (ctx.w.ni0 the old ion density).
   * Runs before the diagnostics of the step are written and before the equilibrium update check.
   */
  accepted?(ctx: ProfileContext, t: number, dt: number, yOld: ProfileState, y: ProfileState): void;
  /** the transport geometry was replaced (an equilibrium was adopted) */
  geometryChanged?(ctx: ProfileContext, tg: TransportGeometry): void;
}
