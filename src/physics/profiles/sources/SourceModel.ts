/**
 * Source plug-in interface of the 1.5D model.
 *
 * A source contributes heat, particle or current source terms to the work arrays. Sources run in
 * the order of the model's source list (sources/index.ts) at three points of a step:
 *
 *  1. prepare  — once per step, on the old state, after the composition and q profile of that
 *                state: quantities held fixed over the Picard iterations (beam deposition,
 *                wave deposition, synchrotron loss) and the fields of the step constants K;
 *  2. heat     — every Picard iteration, on the iterate, after its composition: heat and
 *                particle source densities (fusion, radiation, exchange);
 *  3. current  — every Picard iteration, after the q profile of the iterate and the bootstrap
 *                current: non-inductive current drive, added into w.jcdB (cleared before).
 *
 * The heat equation takes Q_e = Σ(electron heating) − P_rad and Q_i = Σ(ion heating) from the work
 * arrays listed in assembleHeatSources (sources/index.ts); a new source writes its own arrays and
 * adds them there. A source with caches on the transport geometry rebuilds them in geometryChanged.
 */
import type { ProfileContext, StepConstants } from '../context';
import type { TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';

export interface SourceModel {
  /** short identifier (logs, tests) */
  readonly id: string;
  /** once per step on the old state st at time t; writes into the work arrays and K */
  prepare?(ctx: ProfileContext, t: number, st: ProfileState, K: StepConstants): void;
  /** every Picard iteration on the iterate st */
  heat?(ctx: ProfileContext, st: ProfileState, K: StepConstants): void;
  /** every Picard iteration: driven current, added into ctx.w.jcdB [⟨j·B⟩, A T m⁻²] */
  current?(ctx: ProfileContext, st: ProfileState, K: StepConstants): void;
  /** the transport geometry was replaced (an equilibrium was adopted) */
  geometryChanged?(ctx: ProfileContext, tg: TransportGeometry): void;
}
