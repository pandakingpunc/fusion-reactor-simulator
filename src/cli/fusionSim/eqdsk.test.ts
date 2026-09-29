/**
 * The G-EQDSK writer of `fusion-sim export-eqdsk` (eqdsk.ts) on a short 1.5D run: which equilibrium it writes, and that the
 * file is the equilibrium of the run (COCOS 11, readable, its boundary and current those of the run).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { requirePreset } from '../../physics/config/registry';
import { applyAssignments } from '../../physics/config/paths';
import { runShot } from '../../physics/config/run';
import type { Simulation } from '../../physics/simulation';
import type { MagneticConfig } from '../../physics/types';
import { ProfileModel } from '../../physics/profiles/model';
import { detectCocos, importGeqdsk, readGeqdsk } from '../../io/geqdsk';
import { writeRunEqdsk } from './eqdsk';

const short = () => runShot(applyAssignments(requirePreset('SPARC15').cfg as MagneticConfig, ['t_end=0.3', 'profiles.nRho=20', 'profiles.eqNR=25']), { validate: false }).sim;

describe('writeRunEqdsk', () => {
  let sim: Simulation;
  let swaps: number[];
  let last: ProfileModel['eq'];
  beforeAll(() => {
    sim = short();
    swaps = sim.history.filter((h) => h.eq).map((h) => h.t);
    last = (sim.model as ProfileModel).eq;
  }, 60000);

  it('the run has several equilibria to choose from (the initial one and its updates)', () => {
    expect(swaps.length).toBeGreaterThanOrEqual(3);
    expect(swaps[0]).toBe(0);
  });

  // The writer rewinds the run to the frame it writes, so the times are asked in descending order from one run.
  it('by default and for a time beyond the run: the last equilibrium of the run, in COCOS 11, with the current and axis of the run', () => {
    const text = writeRunEqdsk(sim);
    const { data, warnings } = readGeqdsk(text);
    expect(warnings).toEqual([]);
    expect(detectCocos(data).cocos).toBe(11);
    expect(data.nw).toBe(last.grid.NR);
    expect(data.nh).toBe(last.grid.NZ);
    expect(data.current).toBeCloseTo(8.7e6, -3); // SPARC15: 8.7 MA
    expect(data.rmaxis).toBeCloseTo(last.Raxis, 8);
    expect(data.description.trim()).toMatch(/^fusion-sim equilibrium in force at t = 0\.3000 s/);
    expect(writeRunEqdsk(sim, { time: 5 })).toBe(text);
    // and it is the equilibrium the run ended on: the file reads back to its boundary
    const back = importGeqdsk(text, { NR: 49 });
    expect(back.eq.Raxis).toBeCloseTo(last.Raxis, 2);
    expect(Math.abs(back.eq.volume / last.volume - 1)).toBeLessThan(5e-3);
  });

  it('with a time: the equilibrium in force then (the last update at or before it), the initial one before the first update', () => {
    const at = (time: number) => readGeqdsk(writeRunEqdsk(sim, { time })).data;
    const tEnd = swaps[swaps.length - 1];
    const late = at(0.3);
    const mid = at(swaps[1] + 0.02); // after the first update, before the second
    const early = at(swaps[1] - 0.02); // before the first update: the initial equilibrium
    expect(early.rmaxis).not.toBe(mid.rmaxis);
    expect(mid.rmaxis).not.toBe(late.rmaxis);
    expect(tEnd).toBeGreaterThan(swaps[1]);
    expect(early.description.trim()).toMatch(/at t = 0\.\d+ s$/);
    // the times of the frames written are those of the request, not of the update
    expect(Number(early.description.trim().split(' ').slice(-2)[0])).toBeLessThanOrEqual(swaps[1] - 0.02 + 1e-9);
    // the initial equilibrium is what the same request at t = 0 gives
    expect(at(0).rmaxis).toBe(early.rmaxis);
  });

  it('a run that is not 1.5D has no equilibrium to write', () => {
    const zeroD = runShot(applyAssignments(requirePreset('JET').cfg as MagneticConfig, ['t_end=0.2']), { validate: false }).sim;
    expect(() => writeRunEqdsk(zeroD)).toThrow(TypeError);
  });
});
