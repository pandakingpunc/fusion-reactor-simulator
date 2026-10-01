/**
 * Share links, run files and the archive check the scenario they carry up front: the structure with the scenario engine's own check
 * (what scenarioFromJSON does without a model), on top of the size and key limits that were already there.
 */
import { describe, expect, it } from 'vitest';
import { TAE } from '../../physics/presets';
import { dropTemplate, gasPuffTemplate, interlockTemplate, rampTemplate } from '../../physics/scenario';
import { decodeShare, encodeShare, ShareError } from '../persist/codec';
import { buildRunRecord, parseRunRecord, RunRecordError, serializeRunRecord } from '../persist/runRecord';
import { checkRunInputs, checkScenarioShape } from '../persist/validate';
import { Simulation } from '../../physics/simulation';
import { APP_VERSION } from '../persist/version';

describe('checkScenarioShape', () => {
  it('accepts every scenario the engine\'s templates make, and the minimal one', () => {
    for (const s of [dropTemplate('P_NBI_MW', 0.01), rampTemplate('Ip_MA', 1, 2, 3), gasPuffTemplate(1, 2, 3, 0.1), interlockTemplate('Q', '>', 1, { P_NBI_MW: 0 }), { schema: 1 }]) {
      expect(checkScenarioShape(s)).toEqual([]);
    }
  });

  it('names the problems of a scenario with their paths, at most three and a count of the rest', () => {
    const bad = { schema: 1, oops: true, waveforms: { P_NBI_MW: { kind: 'wobble', points: [] }, kappa_conf: { kind: 'step', points: [[1, 1], [1, 2]] } }, rampStep: 1e-9, name: 5 };
    const errors = checkScenarioShape(bad);
    expect(errors.length).toBeLessThanOrEqual(4);
    expect(errors[0]).toMatch(/^scenario\./);
    expect(errors.join(' ')).toMatch(/more problems/);
    expect(checkScenarioShape({ schema: 2 })).toEqual(['scenario.schema: must be 1']);
    expect(checkScenarioShape('not an object')).toEqual(['scenario: a scenario is an object {schema, waveforms, triggers}']);
  });

  it('keeps the bounds it had: depth, key names, non-finite numbers come first', () => {
    expect(checkScenarioShape({ schema: 1, waveforms: { a: { kind: 'step', points: [[Infinity, 1]] } } })[0]).toMatch(/not finite/);
    expect(checkScenarioShape(JSON.parse('{"__proto__": {"x": 1}}'))[0]).toMatch(/forbidden key/);
  });

  it('is part of checkRunInputs: a payload with an invalid scenario is not usable', () => {
    const ok = checkRunInputs({ cfg: TAE, scenario: dropTemplate('P_NBI_MW', 0.02) });
    expect(ok.errors).toEqual([]);
    const bad = checkRunInputs({ cfg: TAE, scenario: { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[0.02, -1]] } } } });
    expect(bad.errors[0]).toMatch(/scenario\.waveforms\.P_NBI_MW\.points\[0\]\[1\]: P_NBI_MW must be >= 0 MW/);
  });
});

describe('share links and run files with a scenario', () => {
  const scenario = { ...dropTemplate('P_NBI_MW', 0.02, 2), name: 'trip' };

  it('a link round-trips a scenario and an invalid one cannot be made or read', async () => {
    const code = await encodeShare({ cfg: TAE, name: 'x', appVersion: APP_VERSION, scenario });
    expect((await decodeShare(code)).payload.scenario).toEqual(scenario);
    await expect(encodeShare({ cfg: TAE, scenario: { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [] } } } })).rejects.toThrow(ShareError);
    await expect(encodeShare({ cfg: TAE, scenario: { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [] } } } })).rejects.toThrow(/scenario\.waveforms\.P_NBI_MW\.points/);
  });

  it('a run file with a scenario is written with the fingerprint of the worker and read back; an invalid scenario in a file is refused', () => {
    const sim = new Simulation(TAE, { scenario });
    const report = sim.runAll();
    const fingerprint = sim.fingerprint(APP_VERSION);
    const rec = buildRunRecord({ name: 'trip run', cfg: TAE, report, events: sim.events, prov: { interventions: 0, scenario, fingerprint } });
    expect(rec.scenario).toEqual(scenario);
    expect(rec.fingerprint).toBe(fingerprint);
    const text = serializeRunRecord(rec);
    expect(parseRunRecord(text).scenario).toEqual(scenario);
    const tampered = JSON.parse(text);
    tampered.scenario = { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[0.02, -9]] } } };
    expect(() => parseRunRecord(JSON.stringify(tampered))).toThrow(RunRecordError);
    expect(() => parseRunRecord(JSON.stringify(tampered))).toThrow(/scenario\./);
  });
});
