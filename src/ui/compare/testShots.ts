/**
 * Test helper: an archived shot from a real run of the kernel (report, frames as the UI keeps them, events).
 * Not imported by the application bundle.
 */
import { Simulation } from '../../physics/simulation';
import { ReactorConfig } from '../../physics/types';
import { makeMeta } from '../../worker/host';
import { toUiFrame } from '../../worker/protocol';
import { SavedShot } from '../state/types';

export function makeShot(id: number, name: string, cfg: ReactorConfig): SavedShot {
  const sim = new Simulation(cfg);
  sim.runAll();
  return { id, name, cfg, meta: makeMeta(sim.model), report: sim.report(), frames: sim.history.map(toUiFrame), events: sim.events };
}
