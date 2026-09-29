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
 *
 * A model whose event is triggered by a threshold on the profiles (ELM, sawtooth) may also provide an
 * `EventTrigger`. The stepper then localises the event: a step whose trigger margin changes sign is
 * shortened to end at the crossing (solver/localise.ts), so that the crash happens when the threshold
 * is reached and not at the end of the step, whatever its length.
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { Checkpointable } from '../checkpoint';

/** A state a trigger margin is evaluated for: the profiles of a state and the composition ratio n_i/n_e of its cells */
export interface TriggerState {
  Te: ArrayLike<number>; Ti: ArrayLike<number>; ne: ArrayLike<number>; psi: ArrayLike<number>;
  niOverNe: ArrayLike<number>;
  /** plasma current [A] */
  Ip: number;
}

/** Work arrays of a margin evaluation (owned by the stepper, N cells, N + 1 faces): pressure, ψ', q on the faces, q at the cells */
export interface TriggerScratch { p: Float64Array; dpsiF: Float64Array; qF: Float64Array; qC: Float64Array }

/** The trigger of an event model as a function of the profiles: what the stepper needs to end a step at the crossing */
export interface EventTrigger {
  /**
   * The earliest time at which the event can fire (the end of its refractory period after the last one, with a small
   * margin so that a step that ends there passes the model's own strict test); −Infinity if it is always ready.
   */
  readyAt(ctx: ProfileContext): number;
  /**
   * Trigger margin of a state: positive when the trigger condition holds (ELM: α_ped/α_crit − 1; sawtooth: s₁ − s_crit).
   * The conditions that a step cannot change (the mode, the option, no q = 1 surface) give −1. Evaluated from the profiles
   * only, on the state of the old and the new end of a step and on the interpolation between them; it must not touch
   * the work arrays of the context (ctx.w) or any state of the model.
   */
  margin(ctx: ProfileContext, st: TriggerState, scratch: TriggerScratch): number;
}

export interface EventModel extends Partial<Checkpointable> {
  /** short identifier (logs, tests) */
  readonly id: string;
  /** the trigger of the event, if it is a threshold on the profiles that a step can cross (see above) */
  readonly trigger?: EventTrigger;
  /**
   * After an accepted step ending at t: st is the new state (may be modified), d the diagnostics of
   * that step (not re-evaluated after earlier event models changed st); new events go into ev.
   */
  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void;
}
