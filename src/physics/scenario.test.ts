/**
 * The scenario engine on its own: validation and the JSON form, waveform values (exact at the corners),
 * breakpoints, triggers (once, repeat, hysteresis, dwell), checkpoint state and the templates. The
 * engine inside a run (breakpoints, rewind, replay) is in kernel/scenario.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  dropTemplate, gasPuffTemplate, interlockTemplate, isEmptyScenario, MIN_RAMP_STEP, mergeScenarios, parseScenario, rampTemplate, Scenario,
  SCENARIO_SCHEMA, scenarioFromJSON, scenarioToJSON, validateScenario, type ScenarioSpec,
} from './scenario';
import { ScenarioError } from './kernel/errors';
import { sha256Hex } from './kernel/sha256';

const CONTROLS = { P_NBI_MW: 33, P_ICRH_MW: 17, n_target_1e20: 1.0, H98: 1.0, fuelRate_1e20s: 500 };

const FULL: ScenarioSpec = {
  schema: 1, name: 'demo',
  waveforms: {
    P_NBI_MW: { kind: 'pwl', points: [[10, 33], [20, 10], [30, 0]] },
    n_target_1e20: { kind: 'step', points: [[5, 0.8], [15, 1.2]] },
  },
  triggers: [
    { id: 'Q interlock', diag: 'Q', op: '>', value: 5, set: { P_ICRH_MW: 0 } },
    { diag: 'nG_frac', op: '<', value: 0.7, hold: 2, after: 5, set: { fuelRate_1e20s: 800 }, mode: 'repeat', hysteresis: 0.05, release: { fuelRate_1e20s: 500 } },
  ],
};

/** The issue paths of an invalid scenario */
function issuePaths(input: unknown, ctx = {}): string[] {
  const r = validateScenario(input, ctx);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.issues.map((i) => i.path);
}

describe('validateScenario and the JSON form', () => {
  it('accepts a scenario and returns it normalised: points sorted, defaults dropped, empty parts removed', () => {
    const r = validateScenario({
      schema: 1,
      waveforms: { H98: { kind: 'pwl', points: [[3, 1.2], [1, 1.0], [2, null]] } },
      triggers: [{ diag: 'Q', op: '>=', value: 5, set: { H98: 1.1 }, hold: 0, after: 0, mode: 'once', hysteresis: 0 }],
      rampStep: undefined,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec).toEqual({
        schema: 1,
        waveforms: { H98: { kind: 'pwl', points: [[1, 1.0], [2, null], [3, 1.2]] } },
        triggers: [{ diag: 'Q', op: '>=', value: 5, set: { H98: 1.1 } }],
      });
    }
    expect(parseScenario({ schema: 1, waveforms: {}, triggers: [] })).toEqual({ schema: 1 });
    expect(isEmptyScenario(parseScenario({ schema: 1 }))).toBe(true);
    expect(isEmptyScenario(FULL)).toBe(false);
  });

  it('round-trips through JSON: one scenario, one text (keys sorted), whatever the input order', () => {
    const text = scenarioToJSON(FULL);
    expect(scenarioFromJSON(text)).toEqual(parseScenario(FULL));
    expect(scenarioToJSON(scenarioFromJSON(text))).toBe(text);
    const reordered = JSON.parse(JSON.stringify(FULL), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(scenarioToJSON(reordered)).toBe(text);
    expect(text).toBe(JSON.stringify(JSON.parse(text))); // plain JSON, no special tokens
    expect(sha256Hex(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists every problem with its path', () => {
    const r = validateScenario({
      schema: 2, colour: 'red',
      waveforms: { P_NBI_MW: { kind: 'spline', points: [] }, H98: { kind: 'step', points: [[1, 1], [1, 2]] }, n_target_1e20: { kind: 'pwl', points: [[-1, 1], [2, 'x'], [3]] } },
      triggers: [{ diag: 'Q', op: '=>', value: NaN, set: {} }, { diag: 'Q', op: '>', value: 1, set: { H98: 1 }, hysteresis: 0.1, release: { H98: 2 } }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    for (const p of ['schema', 'colour', 'waveforms.P_NBI_MW.kind', 'waveforms.P_NBI_MW.points', 'waveforms.H98.points',
      'waveforms.n_target_1e20.points[0][0]', 'waveforms.n_target_1e20.points[1][1]', 'waveforms.n_target_1e20.points[2]',
      'triggers[0].op', 'triggers[0].value', 'triggers[0].set', 'triggers[1].hysteresis', 'triggers[1].release']) expect(paths).toContain(p);
    expect(() => parseScenario({ schema: 2 })).toThrow(ScenarioError);
    expect(() => parseScenario({ schema: 2 })).toThrow(/invalid scenario: schema: must be 1/);
  });

  it('rejects what is not a scenario, and values outside the sanity limits of a control', () => {
    for (const bad of [null, 3, 'x', [], undefined]) expect(issuePaths(bad)).toEqual(['']);
    expect(issuePaths({ schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[5, -1]] } } })).toEqual(['waveforms.P_NBI_MW.points[0][1]']);
    expect(issuePaths({ schema: 1, triggers: [{ diag: 'Q', op: '>', value: 1, set: { n_target_1e20: -2 } }] })).toEqual(['triggers[0].set.n_target_1e20']);
    expect(issuePaths({ schema: 1, rampStep: 0 })).toEqual(['rampStep']);
    expect(issuePaths({ schema: 1, name: 'x'.repeat(121) })).toEqual(['name']);
    expect(issuePaths({ schema: 1, waveforms: { H98: { kind: 'step', points: [[Infinity, 1]] } } })).toEqual(['waveforms.H98.points[0][0]']);
    // a control that is not in the table has no limits
    expect(validateScenario({ schema: 1, waveforms: { Ip_MA: { kind: 'step', points: [[5, -1]] } } }).ok).toBe(true);
    // custom limits replace the table
    expect(issuePaths({ schema: 1, waveforms: { Ip_MA: { kind: 'step', points: [[5, -1]] } } }, { controlInfo: { Ip_MA: { label: 'I_p', unit: 'MA', min: 0 } } })).toEqual(['waveforms.Ip_MA.points[0][1]']);
  });

  it('bounds rampStep from below: an absolute floor, and with the end time of the model a grid of at most 1e4 points (a share link cannot make a run endless)', () => {
    const w = { P_NBI_MW: { kind: 'pwl' as const, points: [[0, 10], [1, 20]] as [number, number][] } };
    // absolute floor (the model is not known): 1e-20 and 1e-16 hung nextBreakpoint() before the floor
    for (const rampStep of [1e-20, 1e-16, 1e-9, 9.9e-7]) {
      expect(issuePaths({ schema: 1, rampStep, waveforms: w }), `rampStep ${rampStep}`).toEqual(['rampStep']);
    }
    expect(() => scenarioFromJSON('{"schema":1,"rampStep":1e-20,"waveforms":{"P_NBI_MW":{"kind":"pwl","points":[[0,10],[1,20]]}}}')).toThrow(/rampStep: must be >= 0\.000001/);
    expect(validateScenario({ schema: 1, rampStep: MIN_RAMP_STEP, waveforms: w }).ok).toBe(true);
    // relative floor with the end time of the run
    expect(validateScenario({ schema: 1, rampStep: 0.04, waveforms: w }, { tEnd: 400 }).ok).toBe(true);
    expect(issuePaths({ schema: 1, rampStep: 0.0399, waveforms: w }, { tEnd: 400 })).toEqual(['rampStep']);
    const r = validateScenario({ schema: 1, rampStep: 1e-3, waveforms: w }, { tEnd: 400 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toBe('must be >= 0.04 = t_end / 10000 (at most 10000 grid points over the run)');
    // a very short run (t_end / 1e4 below the absolute floor) is bound by the absolute floor only
    expect(validateScenario({ schema: 1, rampStep: 1e-6, waveforms: w }, { tEnd: 1e-3 }).ok).toBe(true);
    expect(issuePaths({ schema: 1, rampStep: 9e-7, waveforms: w }, { tEnd: 1e-3 })).toEqual(['rampStep']);
    // no end time, or a meaningless one: the absolute floor
    for (const tEnd of [undefined, 0, -5, NaN, Infinity]) expect(validateScenario({ schema: 1, rampStep: 1e-6, waveforms: w }, { tEnd }).ok, `tEnd ${tEnd}`).toBe(true);
    expect(() => new Scenario({ schema: 1, rampStep: 1e-9, waveforms: w }, CONTROLS)).toThrow(ScenarioError);
    expect(() => new Scenario({ schema: 1, rampStep: 0.01, waveforms: w }, CONTROLS, { tEnd: 400 })).toThrow(/rampStep: must be >= 0\.04/);
    expect(() => new Scenario({ schema: 1, rampStep: 0.04, waveforms: w }, CONTROLS, { tEnd: 400 })).not.toThrow();
    // scenarioToJSON and mergeScenarios validate too
    expect(() => scenarioToJSON({ schema: 1, rampStep: 1e-20, waveforms: w } as ScenarioSpec)).toThrow(ScenarioError);
    expect(() => mergeScenarios({ schema: 1, rampStep: 1e-20 } as ScenarioSpec, rampTemplate('P_NBI_MW', 1, 2, 0))).toThrow(ScenarioError);
  });

  it('checks the keys against the model: unknown controls (I_p before WS6c exposes it) and unknown diagnostics', () => {
    const spec = { schema: 1, waveforms: { Ip_MA: { kind: 'pwl', points: [[10, null], [20, 0]] } }, triggers: [{ diag: 'nope', op: '>', value: 1, set: { P_NBI_MW: 0 } }] };
    expect(validateScenario(spec).ok).toBe(true);
    const r = validateScenario(spec, { controls: Object.keys(CONTROLS), diagnostics: ['Q', 'betaN'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path)).toEqual(['waveforms.Ip_MA', 'triggers[0].diag']);
    expect(r.issues[0].message).toMatch(/unknown control 'Ip_MA' \(this model exposes: H98, P_ICRH_MW/);
    expect(() => new Scenario(spec, CONTROLS)).toThrow(/unknown control 'Ip_MA'/);
    expect(() => new Scenario(spec, { ...CONTROLS, Ip_MA: 15 }, {}).checkDiagnostics(['Q'])).toThrow(/unknown diagnostic 'nope'/);
    expect(() => new Scenario(spec, { ...CONTROLS, Ip_MA: 15 }).checkDiagnostics(['nope', 'Q'])).not.toThrow();
  });

  it('is safe against hostile keys and sizes', () => {
    expect(issuePaths(JSON.parse('{"schema":1,"waveforms":{"__proto__":{"kind":"step","points":[[1,1]]}}}'))).toEqual(['waveforms.__proto__']);
    expect(issuePaths({ schema: 1, waveforms: { 'a b': { kind: 'step', points: [[1, 1]] } } })).toEqual(['waveforms.a b']);
    expect(issuePaths({ schema: 1, triggers: [{ diag: 'constructor', op: '>', value: 1, set: { H98: 1 } }] })).toEqual(['triggers[0].diag']);
    expect(issuePaths({ schema: 1, waveforms: { H98: { kind: 'pwl', points: Array.from({ length: 4097 }, (_, i) => [i, 1]) } } })).toEqual(['waveforms.H98.points']);
    expect(issuePaths({ schema: 1, triggers: Array.from({ length: 129 }, () => ({ diag: 'Q', op: '>', value: 1, set: { H98: 1 } })) })).toEqual(['triggers']);
    expect(() => scenarioFromJSON('x'.repeat(1_000_001))).toThrow(/longer than/);
    expect(() => scenarioFromJSON('{"schema": 1,')).toThrow(/not valid JSON/);
    expect(() => scenarioFromJSON('{"schema": 1, "waveforms": {"H98": {"kind": "step", "points": [[1, 1e999]]}}}')).toThrow(ScenarioError);
    const polluted = scenarioFromJSON('{"schema":1,"triggers":[{"diag":"Q","op":">","value":1,"set":{"H98":1}}]}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(polluted.triggers).toHaveLength(1);
  });
});

describe('waveforms: exact values at the corners', () => {
  const spec: ScenarioSpec = {
    schema: 1,
    waveforms: {
      P_NBI_MW: { kind: 'pwl', points: [[10, 33], [20, 10], [20, 12], [30, 0]] },
      n_target_1e20: { kind: 'step', points: [[5, 0.8], [15, null]] },
      H98: { kind: 'pwl', points: [[1, null], [3, 2]] },
    },
  };
  const sc = new Scenario(spec, CONTROLS);
  const at = (t: number) => sc.waveformsAt(t);

  it('leaves a control alone before its first point and holds the last value after its last', () => {
    expect(at(0)).toEqual({});
    expect(at(9.999)).toEqual({ n_target_1e20: 0.8, H98: 2 });
    expect('P_NBI_MW' in at(9.999)).toBe(false);
    expect(at(1000)).toEqual({ P_NBI_MW: 0, n_target_1e20: 1.0, H98: 2 });
  });

  it('pwl: the corner values are exact, in between it is linear, a repeated time is a jump (the later value holds)', () => {
    expect(at(10).P_NBI_MW).toBe(33);
    expect(at(15).P_NBI_MW).toBe(21.5);
    expect(at(19.999).P_NBI_MW).toBeCloseTo(10.0023, 3);
    expect(at(20).P_NBI_MW).toBe(12);
    expect(at(25).P_NBI_MW).toBe(6);
    expect(at(30).P_NBI_MW).toBe(0);
    // null = the configured value of the control (getControls() before the scenario)
    expect(at(1).H98).toBe(CONTROLS.H98);
    expect(at(2).H98).toBe(1.5);
    expect(at(3).H98).toBe(2);
  });

  it('step: each value holds until the next point', () => {
    expect(at(5).n_target_1e20).toBe(0.8);
    expect(at(14.9999).n_target_1e20).toBe(0.8);
    expect(at(15).n_target_1e20).toBe(CONTROLS.n_target_1e20);
  });

  it('a time within 1e-12 of a corner is that corner (an integrator step that lands a rounding error short of it or past it)', () => {
    expect(at(20 - 5e-13).P_NBI_MW).toBe(12);
    expect(at(20 + 5e-13).P_NBI_MW).toBe(12);
    expect(at(10 + 5e-13).P_NBI_MW).toBe(33);
    expect(at(3 + 1e-15).H98).toBe(2);
    expect(at(1 + 4e-16).H98).toBe(CONTROLS.H98);
    expect(at(20 + 5e-12).P_NBI_MW).not.toBe(12);
    expect(at(10 - 5e-13).P_NBI_MW).toBe(33);
    expect(at(15 - 5e-13).n_target_1e20).toBe(CONTROLS.n_target_1e20);
    expect(at(20 - 5e-12).P_NBI_MW).not.toBe(12);
  });

  it('nextBreakpoint is the next corner strictly after t (within 1e-12 counts as reached), Infinity after the last', () => {
    const seen: number[] = [];
    for (let t = 0; t < 100; t = sc.nextBreakpoint(t)) { seen.push(t); if (seen.length > 50) break; }
    expect(seen).toEqual([0, 1, 3, 5, 10, 15, 20, 30]);
    expect(sc.nextBreakpoint(20 - 5e-13)).toBe(30);
    expect(sc.nextBreakpoint(20 - 2e-12)).toBe(20);
    expect(sc.nextBreakpoint(30)).toBe(Infinity);
    expect(new Scenario({ schema: 1 }, CONTROLS).nextBreakpoint(0)).toBe(Infinity);
  });

  it('rampStep grids the ramps only (not the steps, not flat pwl segments)', () => {
    const g = new Scenario({ schema: 1, rampStep: 2.5, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[10, 33], [20, 33], [30, 0]] }, H98: { kind: 'step', points: [[1, 1], [50, 2]] } } }, CONTROLS);
    const seen: number[] = [];
    for (let t = 0; t < 100 && seen.length < 50; t = g.nextBreakpoint(t)) seen.push(t);
    expect(seen).toEqual([0, 1, 10, 20, 22.5, 25, 27.5, 30, 50]);
    // one rounding error short of a grid point does not return that grid point again
    expect(g.nextBreakpoint(25 - 1e-13)).toBe(27.5);
  });

  it('nextBreakpoint always advances, also where the spacing of the doubles is coarser than rampStep (it used to loop forever there)', () => {
    // at t ~ 1e11 the doubles are 1.5e-5 apart: adding rampStep = 1e-6 to a grid point changes nothing
    const g = new Scenario({ schema: 1, rampStep: MIN_RAMP_STEP, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, 0], [1e12, 1]] } } }, CONTROLS);
    for (const t of [1e11, 1e11 + 3.14, 2 ** 36, 5e11 / 7]) {
      const n = g.nextBreakpoint(t);
      expect(n, `after ${t}`).toBeGreaterThan(t + 1e-12);
      expect(n - t, `after ${t}`).toBeLessThan(1e-3);
    }
    // a walk along the grid terminates and moves forward at every call
    let t = 0.5;
    for (let i = 0; i < 100; i++) { const n = g.nextBreakpoint(t); expect(n).toBeGreaterThan(t); t = n; }
    expect(t).toBeCloseTo(0.5 + 100e-6, 9);
  });

  it('a taken-over key is no longer driven and stops nowhere new; the other keys keep going', () => {
    const s2 = new Scenario(spec, CONTROLS);
    s2.override(['P_NBI_MW', 'unrelated']);
    expect(s2.waveformsAt(25)).toEqual({ n_target_1e20: 1.0, H98: 2 });
    expect(s2.save().manual).toEqual(['P_NBI_MW']);
  });
});

describe('triggers', () => {
  const frame = (index: number, t: number, d: Record<string, number>) => ({ index, t, d });
  const run = (sc: Scenario, samples: [number, number][], diag = 'x') => samples.map(([t, x], i) => sc.step(t, frame(i, t, { [diag]: x })));

  it("'once' fires at the first frame that satisfies the condition and never again", () => {
    const sc = new Scenario(interlockTemplate('x', '>', 5, { P_NBI_MW: 0 }, { id: 'stop' }), CONTROLS);
    const r = run(sc, [[0, 1], [1, 4.99], [2, 5], [3, 6], [4, 1], [5, 9]]);
    expect(r.map((s) => Object.keys(s.notes).length)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(r[3].notes[0].msg).toBe("Scenario trigger 'stop': x = 6 > 5 → P_NBI_MW = 0");
    expect(r[3].notes[0].value).toBe(6);
    expect(r.map((s) => s.patch.P_NBI_MW)).toEqual([undefined, undefined, undefined, 0, undefined, undefined]);
    // the patch is offered at the boundary of the firing only; the key is taken over from then on
    expect(sc.save()).toMatchObject({ manual: ['P_NBI_MW'], armed: [0], fired: [1] });
  });

  it('looks at each frame once: the same frame at later boundaries changes nothing, and a fired patch is not repeated', () => {
    const sc = new Scenario(interlockTemplate('x', '>=', 1, { H98: 1.3 }), CONTROLS);
    expect(sc.step(0, frame(0, 0, { x: 2 })).patch).toEqual({ H98: 1.3 });
    expect(sc.step(0.1, frame(0, 0, { x: 2 })).patch).toEqual({});
  });

  it('a dwell time (hold) counts on consecutive frames and restarts when the condition fails; after delays the firing', () => {
    const sc = new Scenario(interlockTemplate('x', '<', 1, { H98: 0.9 }, { hold: 2, after: 5 }), CONTROLS);
    const fired = run(sc, [[0, 0.5], [1, 0.5], [2, 0.5], [3, 3], [4, 0.5], [5, 0.5], [6, 0.5], [7, 0.5], [8, 0.5]]).map((s) => s.notes.length);
    // holds from t = 0..2, fails at 3, holds again from 4; `after` = 5: the dwell counts from 5, so it fires at 7
    expect(fired).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it("'repeat' with hysteresis re-arms only after the diagnostic has crossed back over the band, and applies the release patch", () => {
    const sc = new Scenario(parseScenario({ schema: 1, triggers: [{ id: 'puff', diag: 'x', op: '<', value: 0.7, mode: 'repeat', hysteresis: 0.1, set: { fuelRate_1e20s: 800 }, release: { fuelRate_1e20s: 500 } }] }), CONTROLS);
    const xs = [0.8, 0.65, 0.6, 0.75, 0.79, 0.81, 0.6, 0.85];
    const r = run(sc, xs.map((x, i) => [i, x]));
    // fires at 0.65 (i=1); 0.75 and 0.79 are above 0.7 but inside the band (< 0.8): no re-arm; 0.81 re-arms and releases; fires again at 0.6; re-arms at 0.85
    expect(r.map((s) => s.patch.fuelRate_1e20s)).toEqual([undefined, 800, undefined, undefined, undefined, 500, 800, 500]);
    expect(r[5].notes[0].msg).toBe("Scenario trigger 'puff' re-armed: x = 0.81 → fuelRate_1e20s = 500");
    expect(sc.save().fired).toEqual([2]);
  });

  it('a repeat trigger without hysteresis re-arms as soon as the condition is false', () => {
    const sc = new Scenario(parseScenario({ schema: 1, triggers: [{ diag: 'x', op: '>', value: 1, mode: 'repeat', set: { H98: 2 } }] }), CONTROLS);
    const r = run(sc, [[0, 2], [1, 3], [2, 1], [3, 1.5]]);
    expect(r.map((s) => s.notes.length)).toEqual([1, 0, 0, 1]);
  });

  it('triggers run in list order and a later one wins a conflict; a trigger wins over the waveform of its key', () => {
    const sc = new Scenario(parseScenario({
      schema: 1, waveforms: { H98: { kind: 'pwl', points: [[0, 1], [10, 2]] } },
      triggers: [{ diag: 'x', op: '>', value: 0, set: { H98: 1.1, cZ: 0.01 } }, { diag: 'x', op: '>', value: 0, set: { H98: 1.2 } }],
    }), { ...CONTROLS, cZ: 0.02 });
    const s = sc.step(5, frame(0, 0, { x: 1 }));
    expect(s.patch).toEqual({ H98: 1.2, cZ: 0.01 });
    expect(sc.step(6, frame(1, 1, { x: 1 })).patch).toEqual({});
    expect(sc.waveformsAt(9)).toEqual({});
  });

  it('a missing or non-finite diagnostic never satisfies a condition', () => {
    const sc = new Scenario(interlockTemplate('x', '<', 5, { H98: 1 }), CONTROLS);
    expect(sc.step(0, frame(0, 0, {})).notes).toEqual([]);
    expect(sc.step(1, frame(1, 1, { x: NaN })).notes).toEqual([]);
    expect(sc.step(2, frame(2, 2, { x: -Infinity })).notes).toEqual([]);
    expect(sc.step(3, frame(3, 3, { x: 4 })).notes).toHaveLength(1);
  });

  it('saves and restores its state (frame index, taken-over keys, armed flags, dwell starts); a state of another scenario resets it', () => {
    const spec = parseScenario({ schema: 1, waveforms: { H98: { kind: 'step', points: [[1, 2]] } }, triggers: [{ diag: 'x', op: '>', value: 1, hold: 3, set: { cZ: 0.01 } }] });
    const a = new Scenario(spec, { ...CONTROLS, cZ: 0.02 }), b = new Scenario(spec, { ...CONTROLS, cZ: 0.02 });
    a.step(0, frame(0, 0, { x: 2 }));
    a.step(1, frame(1, 1, { x: 2 }));
    const saved = a.save();
    expect(saved).toEqual({ frame: 1, manual: [], armed: [1], since: [0], fired: [0] });
    const before = JSON.stringify(a.save());
    a.step(3, frame(2, 3, { x: 2 })); // fires
    expect(JSON.stringify(a.save())).not.toBe(before);
    b.restore(structuredClone(saved));
    a.restore(saved);
    // both continue identically: the trigger fires at the same frame
    for (const sc of [a, b]) expect(sc.step(3, frame(2, 3, { x: 2 })).notes).toHaveLength(1);
    expect(a.save()).toEqual(b.save());
    b.restore({ frame: 7, manual: ['H98'], armed: [], since: [], fired: [] });
    expect(b.save()).toEqual({ frame: -1, manual: [], armed: [1], since: [-1], fired: [0] });
  });
});

describe('templates', () => {
  it("'drop P_NBI at t' is a step to 0 that leaves the control alone before t", () => {
    const s = dropTemplate('P_NBI_MW', 100);
    expect(s).toEqual({ schema: SCENARIO_SCHEMA, name: 'drop P_NBI_MW at 100', waveforms: { P_NBI_MW: { kind: 'step', points: [[100, 0]] } } });
    expect(dropTemplate('P_NBI_MW', 100, 5).waveforms!.P_NBI_MW.points).toEqual([[100, 5]]);
    const sc = new Scenario(s, CONTROLS);
    expect(sc.waveformsAt(99.999)).toEqual({});
    expect(sc.waveformsAt(100)).toEqual({ P_NBI_MW: 0 });
  });

  it("'ramp' starts from the configured value unless told otherwise", () => {
    const s = rampTemplate('P_NBI_MW', 10, 20, 0);
    expect(s.waveforms!.P_NBI_MW).toEqual({ kind: 'pwl', points: [[10, null], [20, 0]] });
    const sc = new Scenario(s, CONTROLS);
    expect(sc.waveformsAt(10)).toEqual({ P_NBI_MW: 33 });
    expect(sc.waveformsAt(15)).toEqual({ P_NBI_MW: 16.5 });
    expect(new Scenario(rampTemplate('P_NBI_MW', 10, 20, 0, 40), CONTROLS).waveformsAt(10)).toEqual({ P_NBI_MW: 40 });
  });

  it("'gas puff' raises the density target and returns it to the configured value", () => {
    const sc = new Scenario(gasPuffTemplate(5, 2, 1.5), CONTROLS);
    expect([4, 5, 6.9, 7, 8].map((t) => sc.waveformsAt(t).n_target_1e20)).toEqual([undefined, 1.5, 1.5, 1.0, 1.0]);
    const ramped = new Scenario(gasPuffTemplate(5, 2, 2.0, 0.5), CONTROLS);
    expect([5, 5.25, 5.5, 6, 7, 7.25, 7.5, 9].map((t) => ramped.waveformsAt(t).n_target_1e20)).toEqual([1.0, 1.5, 2.0, 2.0, 2.0, 1.5, 1.0, 1.0]);
    expect(gasPuffTemplate(5, 2, 1.5).waveforms!.n_target_1e20.kind).toBe('step');
  });

  it('mergeScenarios combines controls side by side and refuses two waveforms for one control', () => {
    const m = mergeScenarios(dropTemplate('P_NBI_MW', 30), dropTemplate('P_ICRH_MW', 30), interlockTemplate('Q', '>', 5, { H98: 1 }));
    expect(Object.keys(m.waveforms!)).toEqual(['P_ICRH_MW', 'P_NBI_MW']);
    expect(m.triggers).toHaveLength(1);
    expect(m.name).toBe('drop P_NBI_MW at 30 + drop P_ICRH_MW at 30');
    expect(() => mergeScenarios(dropTemplate('P_NBI_MW', 30), rampTemplate('P_NBI_MW', 10, 20, 0))).toThrow(/two scenarios drive the same control/);
    expect(scenarioFromJSON(scenarioToJSON(m))).toEqual(m);
  });
});
