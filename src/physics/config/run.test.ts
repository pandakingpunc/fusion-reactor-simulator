import { describe, expect, it } from 'vitest';
import { JET, NIF, PRESETS } from '../presets';
import { Simulation } from '../simulation';
import { flatTopAverages } from '../analysis/flatTop';
import { burnAverages } from '../validation/metrics';
import { getPreset, presetIds, requirePreset } from './registry';
import { ConfigValidationError } from './schema';
import { runShot, summarizeRun } from './run';

describe('runShot', () => {
  const cfg = { ...JET, t_end: 1 };
  it('runs a configuration to its end and returns the numbers of the report, flat top and burn averages', () => {
    const r = runShot(cfg);
    const ref = new Simulation(cfg);
    const report = ref.runAll();
    expect(r.report).toEqual(report);
    expect(r.flatTop).toEqual(flatTopAverages(ref.history));
    expect(r.burn).toEqual(burnAverages(ref.history));
    expect(r.steps).toBe(ref.nSteps);
    expect(r.frames).toBe(ref.history.length);
    const counts: Record<string, number> = {};
    for (const e of ref.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    expect(r.events).toEqual(counts);
    expect(r.sim.history).toHaveLength(r.frames);
  });
  it('throws ConfigValidationError, before running, for an invalid configuration', () => {
    expect(() => runShot({ ...cfg, B0: -1 })).toThrow(ConfigValidationError);
    expect(() => runShot({ ...cfg, B0: -1 })).toThrow(/B0: must be > 0/);
  });
  it('validate: false skips the check (the kernel then decides)', () => {
    expect(() => runShot({ ...cfg, method: 'nope' } as never, { validate: false })).toThrow(/unknown confinement method 'nope'/);
  });
  it('passes options to the simulation: a breakpoint schedule shows up in the fingerprint', () => {
    const a = runShot(cfg).sim.fingerprint('x');
    const b = runShot(cfg, { simulation: { breakpoints: [0.5] } }).sim.fingerprint('x');
    expect(a).not.toBe(b);
  });
  it('summarizeRun works on a simulation that was advanced by hand', () => {
    const sim = new Simulation(NIF);
    const rep = sim.runAll();
    const s = summarizeRun(sim);
    expect(s.report.Q_sci_max).toBe(rep.Q_sci_max);
    expect(s.frames).toBe(sim.history.length);
    const s2 = summarizeRun(sim, rep);
    expect(s2.report).toBe(rep);
  });
});

describe('preset registry', () => {
  it('lists ids in catalogue order and finds a preset by exact id', () => {
    expect(presetIds()).toEqual(PRESETS.map((p) => p.id));
    expect(getPreset('ITER')?.cfg.method).toBe('tokamak');
    expect(getPreset('iter')).toBeUndefined();
    expect(requirePreset('NIF').id).toBe('NIF');
  });
  it('an unknown id lists the valid ones and suggests the closest', () => {
    expect(() => requirePreset('ITER51')).toThrow(/unknown preset 'ITER51' \(did you mean 'ITER(15)?'\?\)\. Valid presets: ITER, JET/);
    expect(() => requirePreset('xyzzy-completely-different')).toThrow(/^unknown preset 'xyzzy-completely-different'\. Valid presets:/);
  });
});
