/**
 * The G-EQDSK of a finished 1.5D run (the writer of `fusion-sim export-eqdsk`): the equilibrium in force at a time of
 * the run, COCOS 11, in the standard 5e16.9 text format of src/io/geqdsk.ts.
 */
import { writeGeqdsk } from '../../io/geqdsk';
import { ProfileModel } from '../../physics/profiles/model';
import type { Simulation } from '../../physics/simulation';

/**
 * G-EQDSK text of the equilibrium of `sim` (a run that has finished) at `opts.time` seconds: the equilibrium of the last
 * recorded frame at or before that time, which is the one the transport geometry was built on then; the last equilibrium of
 * the run if `time` is undefined or later than the run. The run is rewound to that frame (the simulation is not usable for
 * anything else afterwards).
 */
export function writeRunEqdsk(sim: Simulation, opts: { time?: number } = {}): string {
  const model = sim.model;
  if (!(model instanceof ProfileModel)) throw new TypeError('writeRunEqdsk: the run has no Grad–Shafranov equilibrium (it is not a 1.5D run)');
  if (opts.time !== undefined) {
    let k = 0;
    for (let i = 0; i < sim.history.length; i++) if (sim.history[i].t <= opts.time + 1e-12) k = i;
    if (k < sim.history.length - 1) sim.rewindTo(k);
  }
  const t = sim.history.length ? sim.history[sim.history.length - 1].t : sim.t;
  return writeGeqdsk(model.eq, { description: `fusion-sim equilibrium in force at t = ${t.toPrecision(4)} s` });
}
