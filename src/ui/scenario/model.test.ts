import { describe, expect, it } from 'vitest';
import { Simulation } from '../../physics/simulation';
import { ITER_15D, TAE } from '../../physics/presets';
import type { ActuatorEntry } from '../../physics/types';
import { MAX_RAMP_GRID, Scenario, type ScenarioSpec } from '../../physics/scenario';
import { ScenarioError } from '../../physics/kernel/errors';
import { makeMeta } from '../../worker/host';
import {
  addLane, addTrigger, applyTemplate, buildTemplate, clampValue, defaultTemplate, editorContext, emptyScenario, fromText, insertPoint, isBlank, laneKeys, laneRange,
  mergeInto, minRampStep, movePoint, newTrigger, normalized, problems, removeLane, removePoint, removeTrigger, resolved, scenarioFromActuatorLog, setKind, setName,
  setRampStep, suggestRampStep, summarize, toText, updateTrigger, waveformAt, waveformPolyline, type EditorContext,
} from './model';

const ctx: EditorContext = editorContext(makeMeta(new Simulation(TAE).model));
const T = TAE.t_end;

describe('editor context and lanes', () => {
  it('describes the model: controls, diagnostics, end time and time unit of the probe', () => {
    expect(ctx.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(ctx.tEnd).toBe(T);
    expect(ctx.timeUnit).toBe('s');
    expect(ctx.diagSpecs.length).toBeGreaterThan(5);
  });

  it('lists the controls the well-known ones first, then the rest sorted', () => {
    const c = { ...ctx, controls: { zeta: 1, Ip_MA: 15, H98: 1, P_NBI_MW: 3, alpha: 2 } };
    expect(laneKeys(c)).toEqual(['P_NBI_MW', 'H98', 'Ip_MA', 'alpha', 'zeta']);
  });

  it('adds a lane of two null points and removes it again; an empty scenario is blank', () => {
    let s = emptyScenario();
    expect(isBlank(s)).toBe(true);
    s = addLane(s, 'P_NBI_MW', ctx);
    expect(s.waveforms!.P_NBI_MW).toEqual({ kind: 'pwl', points: [[0, null], [T, null]] });
    expect(addLane(s, 'P_NBI_MW', ctx)).toBe(s); // idempotent
    expect(isBlank(s)).toBe(false);
    expect(problems(s, ctx)).toEqual([]);
    const back = removeLane(s, 'P_NBI_MW');
    expect(back.waveforms).toBeUndefined();
    expect(isBlank(back)).toBe(true);
    expect(removeLane(back, 'P_NBI_MW')).toBe(back);
  });
});

describe('editing points', () => {
  const lane = (points: [number, number | null][], kind: 'pwl' | 'step' = 'pwl'): ScenarioSpec => ({ schema: 1, waveforms: { P_NBI_MW: { kind, points } } });

  it('moves a point without changing its place in the order: the time stays between its neighbours, the value inside the limits', () => {
    const s = lane([[0, 13], [0.01, 5], [0.02, 8], [T, 8]]);
    const a = movePoint(s, 'P_NBI_MW', 1, 0.5, -4, T);
    expect(a.waveforms!.P_NBI_MW.points[1]).toEqual([0.02, 0]); // time held at the next point, value at the lower limit of a power
    const b = movePoint(s, 'P_NBI_MW', 1, -1, 7, T);
    expect(b.waveforms!.P_NBI_MW.points[1]).toEqual([0, 7]);
    const c = movePoint(s, 'P_NBI_MW', 3, 9, 3, T);
    expect(c.waveforms!.P_NBI_MW.points[3]).toEqual([T, 3]); // the last point stays inside the run
    expect(movePoint(s, 'P_NBI_MW', 1, 0.015, null, T).waveforms!.P_NBI_MW.points[1]).toEqual([0.015, null]);
    expect(movePoint(s, 'P_NBI_MW', 9, 0, 0, T)).toBe(s);
    expect(movePoint(s, 'P_NBI_MW', 1, NaN, 0, T)).toBe(s);
    expect(movePoint(s, 'bogus', 1, 0, 0, T)).toBe(s);
    // a non-finite value leaves the value alone
    expect(movePoint(s, 'P_NBI_MW', 1, 0.011, NaN, T).waveforms!.P_NBI_MW.points[1]).toEqual([0.011, 5]);
    // never mutates its input
    expect(s.waveforms!.P_NBI_MW.points[1]).toEqual([0.01, 5]);
  });

  it('keeps the times of a step waveform distinct while a point is dragged onto its neighbour', () => {
    const s = lane([[0.01, 5], [0.02, 8]], 'step');
    const m = movePoint(s, 'P_NBI_MW', 1, 0.001, 8, T);
    const pts = m.waveforms!.P_NBI_MW.points;
    expect(pts[1][0]).toBeGreaterThan(pts[0][0]);
    expect(problems(m, ctx)).toEqual([]);
  });

  it('inserts a point in time order and returns its index; a step waveform is nudged off an existing time', () => {
    const s = lane([[0, 13], [T, 13]]);
    const r = insertPoint(s, 'P_NBI_MW', 0.02, 4, T);
    expect(r.index).toBe(1);
    expect(r.spec.waveforms!.P_NBI_MW.points).toEqual([[0, 13], [0.02, 4], [T, 13]]);
    expect(insertPoint(s, 'P_NBI_MW', 5, 1, T).spec.waveforms!.P_NBI_MW.points[2]).toEqual([T, 1]); // clamped to the end: after the last point at T? goes after
    const st = lane([[0.01, 5]], 'step');
    const q = insertPoint(st, 'P_NBI_MW', 0.01, 2, T);
    expect(q.spec.waveforms!.P_NBI_MW.points).toHaveLength(2);
    expect(q.spec.waveforms!.P_NBI_MW.points[0][0]).not.toBe(q.spec.waveforms!.P_NBI_MW.points[1][0]);
    expect(problems(q.spec, ctx)).toEqual([]);
    expect(insertPoint(s, 'bogus', 0, 0, T).index).toBe(-1);
  });

  it('a step lane with points at tEnd − gap and tEnd: inserting at tEnd terminates and goes earlier (the editor\'s second "Add point")', () => {
    const gap = T * 1e-6;
    const st = lane([[0, null], [T - gap, null], [T, null]], 'step');
    for (const at of [T, T - gap]) {
      const r = insertPoint(st, 'P_NBI_MW', at, 3, T);
      const pts = r.spec.waveforms!.P_NBI_MW.points;
      expect(r.index).toBe(1);
      expect(pts).toHaveLength(4);
      expect(pts[1]).toEqual([T - 2 * gap, 3]);
      expect(new Set(pts.map((p) => p[0])).size).toBe(4);
    }
    // nothing free in [0, tEnd] (a tEnd of two gaps holds three points): no point is added
    const full = lane([[0, null], [1e-12, null], [2e-12, null]], 'step');
    expect(insertPoint(full, 'P_NBI_MW', 1e-12, 3, 2e-12)).toEqual({ spec: full, index: -1 });
  });

  it('removes a point, and the lane with its last point', () => {
    const s = lane([[0, 13], [0.02, 4], [T, 13]]);
    expect(removePoint(s, 'P_NBI_MW', 1).waveforms!.P_NBI_MW.points).toEqual([[0, 13], [T, 13]]);
    const one = lane([[0.01, 0]]);
    expect(removePoint(one, 'P_NBI_MW', 0).waveforms).toBeUndefined();
    expect(removePoint(s, 'P_NBI_MW', 7)).toBe(s);
  });

  it('changes the kind of a lane, nudging the jumps of a pwl lane apart for a step lane', () => {
    const s = lane([[0.01, 13], [0.01, 4], [0.02, 4]]);
    expect(problems(s, ctx)).toEqual([]); // a jump in a pwl waveform is legal
    const st = setKind(s, 'P_NBI_MW', 'step', T);
    expect(st.waveforms!.P_NBI_MW.kind).toBe('step');
    expect(problems(st, ctx)).toEqual([]);
    expect(setKind(st, 'P_NBI_MW', 'step', T)).toBe(st);
    expect(setKind(s, 'bogus', 'step', T)).toBe(s);
  });

  it('limits values to the sanity limits of the control and passes the rest through', () => {
    expect(clampValue('P_NBI_MW', -3)).toBe(0);
    expect(clampValue('P_NBI_MW', 40)).toBe(40);
    expect(clampValue('anything', -3)).toBe(-3);
  });
});

describe('waveform values agree with the engine', () => {
  const spec: ScenarioSpec = {
    schema: 1,
    waveforms: {
      P_NBI_MW: { kind: 'pwl', points: [[0.01, null], [0.02, 3], [0.02, 8], [0.03, 8], [0.04, null]] },
      kappa_conf: { kind: 'step', points: [[0.005, 12], [0.03, null]] },
    },
  };
  it('waveformAt equals the value the Scenario engine writes at any time (before the first point: nothing)', () => {
    const engine = new Scenario(spec, ctx.controls);
    for (const t of [0, 0.004, 0.005, 0.0099, 0.01, 0.015, 0.02, 0.0201, 0.025, 0.03, 0.035, 0.04, 0.045]) {
      const patch = engine.waveformsAt(t);
      for (const key of Object.keys(spec.waveforms!)) {
        expect(waveformAt(spec.waveforms![key], ctx.controls[key], t), `${key} at ${t}`).toBe(patch[key]);
      }
    }
  });

  it('draws the value before the first point as the configured one, a step as a staircase and a jump as a vertical edge', () => {
    const p = waveformPolyline(spec.waveforms!.P_NBI_MW, 13, T);
    expect(p[0]).toEqual([0, 13]);
    expect(p[1]).toEqual([0.01, 13]);
    expect(p.filter((q) => q[0] === 0.02)).toEqual([[0.02, 3], [0.02, 8]]);
    expect(p[p.length - 1]).toEqual([T, 13]);
    const st = waveformPolyline(spec.waveforms!.kappa_conf, 10, T);
    expect(st).toEqual([[0, 10], [0.005, 10], [0.005, 12], [0.03, 12], [0.03, 10], [T, 10]]);
    expect(waveformPolyline({ kind: 'pwl', points: [] }, 1, T)).toEqual([]);
  });

  it('gives a lane a stable, non-empty range that contains the configured value and the points', () => {
    const [lo, hi] = laneRange('P_NBI_MW', spec.waveforms!.P_NBI_MW, 13);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(13);
    const [l2, h2] = laneRange('bogus', null, 5);
    expect(h2).toBeGreaterThan(l2);
    expect(l2).toBeLessThan(5);
    expect(h2).toBeGreaterThan(5);
    const [l3, h3] = laneRange('P_NBI_MW', { kind: 'step', points: [[0, 0]] }, 0);
    expect(h3).toBeGreaterThan(l3);
  });

  it('resolves null points to the configured value', () => {
    expect(resolved([0, null], 7)).toBe(7);
    expect(resolved([0, 2], 7)).toBe(2);
  });
});

describe('templates', () => {
  it('offers parameters that exist in the model, relative to its end time', () => {
    const d = defaultTemplate('drop', ctx);
    expect(d).toMatchObject({ kind: 'drop', key: 'P_NBI_MW', t: 0.5 * T, to: 0 });
    const g = defaultTemplate('gasPuff', ctx);
    expect(g.t + g.t1).toBeLessThan(T);
    const i = defaultTemplate('interlock', ctx);
    expect(ctx.diagSpecs.map((s) => s.key)).toContain(i.diag);
    expect(i.setKey).toBe('P_NBI_MW');
  });

  it('applies each template and the result is a valid scenario for the model', () => {
    let s = emptyScenario();
    s = applyTemplate(s, defaultTemplate('drop', ctx), ctx);
    expect(s.waveforms!.P_NBI_MW.kind).toBe('step');
    s = applyTemplate(s, { ...defaultTemplate('ramp', ctx), key: 'kappa_conf', to: 5 }, ctx);
    expect(s.waveforms!.kappa_conf.kind).toBe('pwl');
    expect(s.rampStep).toBeUndefined(); // only the plasma current gets one
    s = applyTemplate(s, defaultTemplate('interlock', ctx), ctx);
    expect(s.triggers).toHaveLength(1);
    expect(problems(s, ctx)).toEqual([]);
    // a template replaces the lane of its control and keeps the label
    const named = setName(s, 'mine');
    const again = applyTemplate(named, { ...defaultTemplate('drop', ctx), t: 0.2 * T, to: 1 }, ctx);
    expect(again.waveforms!.P_NBI_MW.points).toEqual([[0.2 * T, 1]]);
    expect(again.name).toBe('mine');
    expect(again.triggers).toHaveLength(1);
  });

  it('a gas puff needs the density target; on a model without it the template is refused with the reason', () => {
    const g = applyTemplate(emptyScenario(), { ...defaultTemplate('gasPuff', { ...ctx, controls: { ...ctx.controls, n_target_1e20: 1 } }), }, { ...ctx, controls: { ...ctx.controls, n_target_1e20: 1 } });
    expect(g.waveforms!.n_target_1e20).toBeDefined();
    expect(problems(g, ctx).map((i) => i.path)).toContain('waveforms.n_target_1e20'); // TAE has no density target
  });

  it('a template with invalid parameters throws the engine\'s ScenarioError', () => {
    expect(() => buildTemplate({ ...defaultTemplate('drop', ctx), t: -1 })).toThrow(ScenarioError);
  });

  it('a plasma-current ramp of the 1.5D model gets a rampStep at or above the floor', () => {
    const c15 = editorContext(makeMeta(new Simulation(ITER_15D).model));
    expect('Ip_MA' in c15.controls).toBe(true);
    const s = applyTemplate(emptyScenario(), defaultTemplate('ramp', c15), c15);
    expect(s.waveforms!.Ip_MA.kind).toBe('pwl');
    expect(s.rampStep).toBeGreaterThanOrEqual(minRampStep(c15.tEnd));
    expect(problems(s, c15)).toEqual([]);
    // ... and one that is set already is left alone
    const keep = applyTemplate(setRampStep(emptyScenario(), 5), defaultTemplate('ramp', c15), c15);
    expect(keep.rampStep).toBe(5);
  }, 30000);

  it('merges: waveforms by control, triggers appended, label and rampStep of the target kept', () => {
    const a: ScenarioSpec = { schema: 1, name: 'a', rampStep: 0.001, waveforms: { P_NBI_MW: { kind: 'step', points: [[0.01, 1]] } }, triggers: [{ diag: 'Q', op: '>', value: 1, set: { P_NBI_MW: 0 } }] };
    const b: ScenarioSpec = { schema: 1, name: 'b', rampStep: 0.5, waveforms: { kappa_conf: { kind: 'step', points: [[0.02, 3]] } }, triggers: [{ diag: 'Q', op: '<', value: 0.1, set: { P_NBI_MW: 5 } }] };
    const m = mergeInto(a, b);
    expect(Object.keys(m.waveforms!)).toEqual(['P_NBI_MW', 'kappa_conf']);
    expect(m.triggers).toHaveLength(2);
    expect(m.name).toBe('a');
    expect(m.rampStep).toBe(0.001);
    expect(mergeInto(emptyScenario(), emptyScenario())).toEqual(emptyScenario());
  });
});

describe('triggers', () => {
  it('adds, updates and removes triggers; an undefined field is dropped', () => {
    let s = addTrigger(emptyScenario(), ctx);
    expect(s.triggers).toHaveLength(1);
    expect(problems(s, ctx)).toEqual([]);
    expect(newTrigger(ctx).set).toEqual({ P_NBI_MW: 0 });
    s = updateTrigger(s, 0, { hold: 0.002, mode: 'repeat', hysteresis: 0.1, release: { P_NBI_MW: 13 }, id: 'guard' });
    expect(s.triggers![0]).toMatchObject({ hold: 0.002, mode: 'repeat', id: 'guard' });
    expect(problems(s, ctx)).toEqual([]);
    s = updateTrigger(s, 0, { hold: undefined, id: undefined });
    expect('hold' in s.triggers![0]).toBe(false);
    expect('id' in s.triggers![0]).toBe(false);
    expect(updateTrigger(s, 5, { hold: 1 })).toBe(s);
    const gone = removeTrigger(s, 0);
    expect(gone.triggers).toBeUndefined();
    expect(removeTrigger(gone, 0)).toBe(gone);
  });

  it('names the problems of a trigger on a diagnostic the frames do not have', () => {
    const s = updateTrigger(addTrigger(emptyScenario(), ctx), 0, { diag: 'nope' });
    const issues = problems(s, ctx);
    expect(issues.map((i) => i.path)).toEqual(['triggers[0].diag']);
    expect(issues[0].message).toContain("unknown diagnostic 'nope'");
  });
});

describe('rampStep', () => {
  it('is bounded below by max(1e-6, t_end / 1e4), as the engine demands', () => {
    expect(minRampStep(TAE.t_end)).toBe(TAE.t_end / MAX_RAMP_GRID);
    expect(minRampStep(0.001)).toBe(1e-6); // the absolute floor for a short run
    expect(minRampStep(400)).toBe(400 / MAX_RAMP_GRID);
    expect(minRampStep(NaN)).toBe(1e-6);
    const s = (v: number) => setRampStep({ schema: 1, waveforms: { kappa_conf: { kind: 'pwl', points: [[0.01, 1], [0.02, 2]] } } }, v);
    const c = { ...ctx, tEnd: 400 };
    expect(problems(s(400 / MAX_RAMP_GRID / 2), c)[0]).toMatchObject({ path: 'rampStep' });
    expect(problems(s(minRampStep(400)), c)).toEqual([]);
    expect(setRampStep(s(1), undefined).rampStep).toBeUndefined();
  });

  it('suggests a value that is valid, and readable', () => {
    for (const tEnd of [0.05, 1, 30, 400, 7200, 1e-3]) {
      const v = suggestRampStep(tEnd);
      expect(v).toBeGreaterThanOrEqual(minRampStep(tEnd));
      expect(v).toBeLessThanOrEqual(Math.max(tEnd / 50, minRampStep(tEnd)));
    }
    expect(suggestRampStep(400)).toBe(4);
  });
});

describe('checking, text and summary', () => {
  it('without a context only the structure is checked; with one, the controls, diagnostics and end time too', () => {
    const s: ScenarioSpec = { schema: 1, waveforms: { not_a_control: { kind: 'step', points: [[0.01, 1]] } } };
    expect(problems(s, null)).toEqual([]);
    expect(problems(s, ctx).map((i) => i.path)).toEqual(['waveforms.not_a_control']);
    expect(normalized(s, ctx)).toBeNull();
    expect(normalized(s, null)).toEqual(s);
  });

  it('flags a null point of a control that has no configured value', () => {
    const c = { ...ctx, controls: { ...ctx.controls, weird: NaN } };
    const s: ScenarioSpec = { schema: 1, waveforms: { weird: { kind: 'step', points: [[0.01, null]] } } };
    expect(problems(s, c).map((i) => i.path)).toEqual(['waveforms.weird.points[0][1]']);
  });

  it('round-trips through the canonical JSON text; a bad text raises ScenarioError with the problems', () => {
    const s = applyTemplate(emptyScenario(), defaultTemplate('drop', ctx), ctx);
    const text = toText(s);
    expect(fromText(text, ctx)).toEqual(s);
    expect(() => fromText('{not json', ctx)).toThrow(/not valid JSON/);
    try {
      fromText(JSON.stringify({ schema: 1, waveforms: { bogus: { kind: 'step', points: [[1, 1]] } }, extra: 1 }), ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioError);
      expect((e as ScenarioError).issues.map((i) => i.path).sort()).toEqual(['extra', 'waveforms.bogus']);
    }
  });

  it('counts what a scenario contains', () => {
    expect(summarize(null)).toEqual({ waveforms: 0, triggers: 0 });
    const s = addTrigger(applyTemplate(emptyScenario(), defaultTemplate('drop', ctx), ctx), ctx);
    expect(summarize(s)).toEqual({ waveforms: 1, triggers: 1 });
  });
});

describe('record mode: live interventions become a scenario', () => {
  /** a live run with interventions at step boundaries, and the log it made */
  function liveRun(scenario?: ScenarioSpec) {
    const sim = new Simulation(TAE, scenario ? { scenario } : {});
    sim.advance(T * 0.3);
    sim.applyControl({ P_NBI_MW: 4 });
    sim.advance(T * 0.2);
    sim.applyControl({ P_NBI_MW: 9, kappa_conf: 6 });
    sim.advance(T * 0.1);
    sim.applyControl({ P_NBI_MW: 2 });
    sim.runAll();
    return sim;
  }

  it('turns each control into a step lane at the times of the interventions', () => {
    const sim = liveRun();
    const rec = scenarioFromActuatorLog(sim.actuatorLog, null, ctx);
    expect(rec.waveforms!.P_NBI_MW.kind).toBe('step');
    expect(rec.waveforms!.P_NBI_MW.points.map((p) => p[1])).toEqual([4, 9, 2]);
    expect(rec.waveforms!.kappa_conf.points.map((p) => p[1])).toEqual([6]);
    expect(rec.waveforms!.P_NBI_MW.points[0][0]).toBeGreaterThanOrEqual(T * 0.3);
    expect(problems(rec, ctx)).toEqual([]);
  });

  it('the recorded scenario makes the run do what the operator did: the control values at the frames agree', () => {
    const live = liveRun();
    const rec = scenarioFromActuatorLog(live.actuatorLog, null, ctx);
    const replay = new Simulation(TAE, { scenario: rec });
    replay.runAll();
    const at = (sim: Simulation, t: number) => {
      let f = sim.history[0];
      for (const h of sim.history) if (h.t <= t + 1e-12) f = h; else break;
      return f.sim!.controls;
    };
    for (const e of live.actuatorLog) {
      // the frame at the first output time after the intervention has the operator's value in both runs
      const t = e.t + T / 40;
      for (const k of Object.keys(e.patch)) expect(at(replay, t)[k], `${k} after t = ${e.t}`).toBe(at(live, t)[k]);
    }
    expect(at(replay, T)).toEqual(at(live, T));
  });

  it('keeps a scripted step lane up to the first intervention and follows the operator afterwards', () => {
    const base: ScenarioSpec = { schema: 1, name: 'base', waveforms: { P_NBI_MW: { kind: 'step', points: [[0, 13], [0.2 * T, 8], [0.9 * T, 1]] }, kappa_conf: { kind: 'step', points: [[0.5 * T, 3]] } } };
    const log = [{ t: 0.4 * T, step: 10, patch: { P_NBI_MW: 5 } }, { t: 0.6 * T, step: 20, patch: { P_NBI_MW: 6 } }];
    const rec = scenarioFromActuatorLog(log, base, ctx);
    expect(rec.name).toBe('base');
    expect(rec.waveforms!.kappa_conf).toEqual(base.waveforms!.kappa_conf); // not touched
    expect(rec.waveforms!.P_NBI_MW).toEqual({ kind: 'step', points: [[0, 13], [0.2 * T, 8], [0.4 * T, 5], [0.6 * T, 6]] });
  });

  it('turns an intervention on a ramped (pwl) lane into a corner and jumps that reproduce the values exactly', () => {
    const base: ScenarioSpec = { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, 13], [T, 0]] } } };
    const log = [{ t: 0.25 * T, step: 5, patch: { P_NBI_MW: 20 } }, { t: 0.75 * T, step: 15, patch: { P_NBI_MW: 1 } }];
    const rec = scenarioFromActuatorLog(log, base, ctx);
    const w = rec.waveforms!.P_NBI_MW;
    expect(w.kind).toBe('pwl');
    for (const [t, v] of [[0, 13], [0.1 * T, 13 * 0.9], [0.24 * T, 13 * 0.76], [0.25 * T, 20], [0.5 * T, 20], [0.74 * T, 20], [0.75 * T, 1], [T, 1]] as const) {
      expect(waveformAt(w, 13, t)).toBeCloseTo(v, 9);
    }
    expect(problems(rec, ctx)).toEqual([]);
    // the engine agrees at those times
    const engine = new Scenario(rec, ctx.controls);
    expect(engine.waveformsAt(0.5 * T).P_NBI_MW).toBe(20);
  });

  it('several patches at one boundary: the last wins; unknown controls and non-finite values are left out', () => {
    const log: ActuatorEntry[] = [
      { t: 0.2 * T, step: 3, patch: { P_NBI_MW: 1 } },
      { t: 0.2 * T, step: 3, patch: { P_NBI_MW: 2, bogus: 5, kappa_conf: NaN } },
    ];
    const rec = scenarioFromActuatorLog(log, null, ctx);
    expect(rec.waveforms).toEqual({ P_NBI_MW: { kind: 'step', points: [[0.2 * T, 2]] } });
    expect(isBlank(scenarioFromActuatorLog([], null, ctx))).toBe(true);
  });
});
