/**
 * Event plug-in interface of the 1.5D model.
 *
 * After every accepted step in the 'normal' phase, ProfileModel.postStep calls the event models in
 * the order of its list (events/index.ts) with the diagnostics of that step. An event model may
 * change the state (an MHD crash: ELM, sawtooth), the operating mode (L–H) or the phase (a
 * disruption), and pushes SimEvents. A model that changed y outside the transport step sets
 * ctx.diagStale, so that the next frame re-evaluates the diagnostics from y, and may cap the next
 * time step (ctx.dt).
 *
 * Event models keep their own state (timers, flags) and take part in the checkpoint through the
 * Checkpointable hooks (checkpoint.ts): numbers go into the record under the model's own keys,
 * references and strings into the auxiliary store.
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { Checkpointable } from '../checkpoint';

export interface EventModel extends Partial<Checkpointable> {
  /** short identifier (logs, tests) */
  readonly id: string;
  /**
   * After an accepted step ending at t: st is the new state (may be modified), d the diagnostics of
   * that step (not re-evaluated after earlier event models changed st); new events go into ev.
   */
  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void;
}
