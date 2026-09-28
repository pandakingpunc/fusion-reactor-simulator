/**
 * Event models of the 1.5D model, in the order ProfileModel.postStep runs them after each accepted
 * step of the normal phase. The order matters: an ELM or sawtooth crash changes the state that the
 * later models see (the diagnostics d are those of the step), and the disruption check comes last.
 */
import { BurnEvents } from './burn';
import { DisruptionEvents } from './disruption';
import { ElmEvents } from './elm';
import { LHTransition } from './lh';
import { NtmEvents } from './ntm';
import { SawtoothEvents } from './sawtooth';
import { OperationalWarnings } from './warnings';
import type { EventModel } from './EventModel';

export type { EventModel } from './EventModel';

/**
 * The standard event models, with `extra` models inserted before the disruption check (which must
 * see the state after every other event). `elm` (report statistics) and `disruption` (quench
 * phases) are also returned by name.
 */
export function defaultEvents(extra: readonly EventModel[] = []): { list: EventModel[]; elm: ElmEvents; disruption: DisruptionEvents } {
  const elm = new ElmEvents(), disruption = new DisruptionEvents();
  return { list: [new LHTransition(), elm, new SawtoothEvents(), new NtmEvents(), new BurnEvents(), new OperationalWarnings(), ...extra, disruption], elm, disruption };
}
