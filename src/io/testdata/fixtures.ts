/**
 * Short runs shared by the io tests: a 0D magnetic run, a 1.5D run with profiles and equilibrium snapshots,
 * and a pulsed run. Built on first use and cached per test file.
 */
import { Simulation } from '../../physics/simulation';
import { JET, NIF, SPARC_15D } from '../../physics/presets';
import { type RunSource, sourceFromSimulation } from '../table';

const cache = new Map<string, { sim: Simulation; src: RunSource }>();

function run(name: string, make: () => Simulation): { sim: Simulation; src: RunSource } {
  let r = cache.get(name);
  if (!r) {
    const sim = make();
    sim.runAll();
    r = { sim, src: sourceFromSimulation(sim, { version: '4.0.0-test', preset: name, fingerprint: 'f'.repeat(64) }) };
    cache.set(name, r);
  }
  return r;
}

/** JET, 1 s, 0D: 501 frames, events, a report */
export const jet = () => run('JET', () => new Simulation({ ...JET, t_end: 1 }));
/** SPARC 1.5D, 1.5 s, 30 radial cells: profiles on every frame, a dozen equilibrium snapshots */
export const sparc15 = () => run('SPARC15', () => new Simulation({ ...SPARC_15D, t_end: 1.5, profiles: { nRho: 30, eqNR: 33 } }));
/** NIF (nanosecond time unit) */
export const nif = () => run('NIF', () => new Simulation(NIF));
