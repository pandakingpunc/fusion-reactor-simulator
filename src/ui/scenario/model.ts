/**
 * The scenario editor's model: pure functions over a ScenarioSpec (src/physics/scenario.ts) with no React and no DOM, so that
 * everything the editor does to a scenario is testable on its own. The components (ScenarioEditor, WaveformLane, ...) only
 * turn pointer, keyboard and form events into calls of these functions and draw the result.
 *
 * Every function returns a new spec and never mutates its input; a result is not validated here (a half-edited scenario is a
 * legitimate state of the editor), `problems()` says what is wrong with it: the same check as the run's, against the
 * controls, diagnostics and end time of the model the scenario is for.
 *
 * Semantics the editor relies on (see the header of scenario.ts): a waveform is defined from its first point on, a `null` value
 * is the configured value of the control, 'pwl' interpolates and two points at one time make a jump, 'step' holds; the
 * time base is the model's time unit; `rampStep` is at least max(1e-6, t_end / 1e4).
 */
import type { ActuatorEntry, DiagSpec } from '../../physics/types';
import {
  MAX_RAMP_GRID, MIN_RAMP_STEP, SCENARIO_CONTROLS, SCENARIO_SCHEMA, dropTemplate, gasPuffTemplate, interlockTemplate, rampTemplate,
  scenarioFromJSON, scenarioToJSON, validateScenario,
  type ControlInfo, type ScenarioIssue, type ScenarioSpec, type TriggerOp, type TriggerSpec, type WaveformKind, type WaveformPoint, type WaveformSpec,
} from '../../physics/scenario';
import type { SimMeta } from '../../worker/protocol';

/** What the editor needs to know about the model a scenario is for. */
export interface EditorContext {
  /** the configured value of every control the model exposes (the value of a `null` point, the baseline of a lane) */
  controls: Readonly<Record<string, number>>;
  /** the diagnostics of a frame that a trigger may name, with labels and units */
  diagSpecs: readonly DiagSpec[];
  /** end time of the run [time unit] */
  tEnd: number;
  timeUnit: SimMeta['timeUnit'];
}

/** The editor context of a model's meta (of a run loaded without a scenario or a probe, so that `controls` are the configured values). */
export const editorContext = (meta: SimMeta): EditorContext => ({ controls: meta.controls, diagSpecs: meta.diagSpecs, tEnd: meta.tEnd, timeUnit: meta.timeUnit });

export const emptyScenario = (): ScenarioSpec => ({ schema: SCENARIO_SCHEMA });

/** True when the scenario drives nothing and reacts to nothing. */
export const isBlank = (s: ScenarioSpec | null | undefined): boolean => !s || (!Object.keys(s.waveforms ?? {}).length && !(s.triggers?.length));

/** Smallest rampStep that is valid for a run of length `tEnd`: max(1e-6, tEnd / 1e4). */
export const minRampStep = (tEnd: number): number => (Number.isFinite(tEnd) && tEnd > 0 ? Math.max(MIN_RAMP_STEP, tEnd / MAX_RAMP_GRID) : MIN_RAMP_STEP);

/** A rampStep to offer: a hundredth of the run, never below the floor. The value is rounded to two significant digits so it reads well. */
export function suggestRampStep(tEnd: number): number {
  const v = Math.max(minRampStep(tEnd), tEnd / 100);
  return Number(v.toPrecision(2)) >= minRampStep(tEnd) ? Number(v.toPrecision(2)) : Number(v.toPrecision(3));
}

/** Label, unit and sanity limits of a control (SCENARIO_CONTROLS, else the bare key). */
export const controlInfo = (key: string): ControlInfo => SCENARIO_CONTROLS[key] ?? { label: key, unit: '' };

/** The controls a scenario can drive in this model, the well-known ones first (in the order of SCENARIO_CONTROLS), then the rest sorted. */
export function laneKeys(ctx: EditorContext): string[] {
  const known = Object.keys(SCENARIO_CONTROLS);
  return Object.keys(ctx.controls).sort((a, b) => {
    const ia = known.indexOf(a), ib = known.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

// ---- waveform values ----------------------------------------------------------------------------------------------

/** A point's value with `null` resolved to the configured value of the control. */
export const resolved = (p: WaveformPoint, base: number): number => (p[1] === null ? base : p[1]);

/**
 * The value of a waveform at time t as the engine has it (right-continuous, corners exact), or undefined before its first
 * point. `base` is the configured value of the control (what `null` means).
 */
export function waveformAt(w: WaveformSpec, base: number, t: number): number | undefined {
  const pts = w.points;
  let i = -1;
  for (let k = 0; k < pts.length; k++) { if (pts[k][0] <= t) i = k; else break; }
  if (i < 0) return undefined;
  if (w.kind === 'step' || i === pts.length - 1) return resolved(pts[i], base);
  const [t0, v0] = [pts[i][0], resolved(pts[i], base)];
  const [t1, v1] = [pts[i + 1][0], resolved(pts[i + 1], base)];
  return t1 > t0 ? v0 + (v1 - v0) * ((t - t0) / (t1 - t0)) : v1;
}

/**
 * The polyline a lane draws for a waveform over [0, tEnd]: the configured value before the first point, the points, the last value
 * held to the end. A step waveform is drawn as a staircase, a jump of a 'pwl' waveform (two points at one time) as a vertical edge.
 */
export function waveformPolyline(w: WaveformSpec, base: number, tEnd: number): [number, number][] {
  const out: [number, number][] = [];
  const pts = w.points;
  if (!pts.length) return out;
  if (pts[0][0] > 0) out.push([0, base], [pts[0][0], base]);
  pts.forEach((p, i) => {
    const v = resolved(p, base);
    if (w.kind === 'step' && i > 0) out.push([p[0], resolved(pts[i - 1], base)]);
    out.push([p[0], v]);
  });
  const last = pts[pts.length - 1];
  if (last[0] < tEnd) out.push([tEnd, resolved(last, base)]);
  return out;
}

/**
 * The vertical range a lane shows for a waveform: from the lower sanity limit of the control (0 for the powers and densities) or
 * the lowest value, to 15 % above the highest value; the configured value is always inside. Never empty.
 */
export function laneRange(key: string, w: WaveformSpec | null, base: number): [number, number] {
  const info = controlInfo(key);
  const vals = [base, ...(w?.points ?? []).map((p) => resolved(p, base))].filter(Number.isFinite);
  let hi = Math.max(...vals), lo = Math.min(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  hi += 0.15 * span;
  lo = info.min !== undefined && info.min >= 0 && lo >= 0 ? Math.min(info.min, lo) : lo - 0.15 * span;
  if (info.max !== undefined) hi = Math.min(hi, info.max);
  if (info.min !== undefined) lo = Math.max(lo, info.min);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

// ---- editing waveforms ---------------------------------------------------------------------------------------------

const withWaveforms = (s: ScenarioSpec, waveforms: Record<string, WaveformSpec>): ScenarioSpec => {
  const { waveforms: _old, ...rest } = s;
  return Object.keys(waveforms).length ? { ...rest, waveforms } : rest;
};

/** A new lane: two points at the configured value ('pwl', from 0 to the end of the run), ready to be dragged. */
export function addLane(s: ScenarioSpec, key: string, ctx: EditorContext): ScenarioSpec {
  if (s.waveforms?.[key]) return s;
  return withWaveforms(s, { ...s.waveforms, [key]: { kind: 'pwl', points: [[0, null], [ctx.tEnd, null]] } });
}

export function removeLane(s: ScenarioSpec, key: string): ScenarioSpec {
  if (!s.waveforms?.[key]) return s;
  const { [key]: _gone, ...rest } = s.waveforms;
  return withWaveforms(s, rest);
}

export function setKind(s: ScenarioSpec, key: string, kind: WaveformKind, tEnd: number): ScenarioSpec {
  const w = s.waveforms?.[key];
  if (!w || w.kind === kind) return s;
  // a step waveform needs distinct times: a jump of a 'pwl' one (two points at one time) is nudged apart
  const gap = Math.max(tEnd * 1e-6, 1e-12);
  const points = w.points.map((p): WaveformPoint => [p[0], p[1]]);
  if (kind === 'step') for (let i = 1; i < points.length; i++) if (points[i][0] <= points[i - 1][0]) points[i][0] = points[i - 1][0] + gap;
  return withWaveforms(s, { ...s.waveforms, [key]: { kind, points } });
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

/** The value of a control limited to its sanity limits (SCENARIO_CONTROLS). */
export function clampValue(key: string, v: number): number {
  const info = controlInfo(key);
  return clamp(v, info.min ?? -Infinity, info.max ?? Infinity);
}

/**
 * Moves point `i` of a lane to (t, v). The point keeps its place in the order: its time is held between its neighbours
 * (strictly, for a step waveform), inside [0, tEnd]; the value is limited to the control's sanity limits. `v` = null puts the point
 * back on the configured value.
 */
export function movePoint(s: ScenarioSpec, key: string, i: number, t: number, v: number | null, tEnd: number): ScenarioSpec {
  const w = s.waveforms?.[key];
  if (!w || i < 0 || i >= w.points.length || !Number.isFinite(t)) return s;
  const gap = w.kind === 'step' ? Math.max(tEnd * 1e-6, 1e-12) : 0;
  const lo = i > 0 ? w.points[i - 1][0] + gap : 0;
  const hi = i < w.points.length - 1 ? w.points[i + 1][0] - gap : tEnd;
  const nt = hi >= lo ? clamp(t, lo, hi) : lo;
  const nv = v === null ? null : Number.isFinite(v) ? clampValue(key, v) : w.points[i][1];
  const points = w.points.map((p, k): WaveformPoint => (k === i ? [nt, nv] : [p[0], p[1]]));
  return withWaveforms(s, { ...s.waveforms, [key]: { kind: w.kind, points } });
}

/**
 * Adds a point at (t, v), in time order. A step waveform's point is nudged off an existing time: later first, then, when the
 * times up to tEnd are taken, earlier (index -1 when no time in [0, tEnd] is free). Returns the spec and the index of the new point.
 */
export function insertPoint(s: ScenarioSpec, key: string, t: number, v: number | null, tEnd: number): { spec: ScenarioSpec; index: number } {
  const w = s.waveforms?.[key];
  if (!w || !Number.isFinite(t)) return { spec: s, index: -1 };
  let nt = clamp(t, 0, tEnd);
  if (w.kind === 'step') {
    // one direction at a time: alternating up and down never ended with points at tEnd − gap and tEnd ((tEnd − gap) + gap = tEnd)
    const gap = Math.max(tEnd * 1e-6, 1e-12);
    const taken = (x: number) => w.points.some((p) => p[0] === x);
    const start = nt;
    while (taken(nt) && nt + gap <= tEnd) nt += gap;
    if (taken(nt)) for (nt = start; taken(nt) && nt - gap >= 0;) nt -= gap;
    if (taken(nt)) return { spec: s, index: -1 };
  }
  const nv = v === null ? null : clampValue(key, v);
  let index = w.points.findIndex((p) => p[0] > nt);
  if (index < 0) index = w.points.length;
  const points: WaveformPoint[] = [...w.points.slice(0, index).map((p): WaveformPoint => [p[0], p[1]]), [nt, nv], ...w.points.slice(index).map((p): WaveformPoint => [p[0], p[1]])];
  return { spec: withWaveforms(s, { ...s.waveforms, [key]: { kind: w.kind, points } }), index };
}

/** Removes point `i`; a lane left without points is removed altogether. */
export function removePoint(s: ScenarioSpec, key: string, i: number): ScenarioSpec {
  const w = s.waveforms?.[key];
  if (!w || i < 0 || i >= w.points.length) return s;
  if (w.points.length === 1) return removeLane(s, key);
  return withWaveforms(s, { ...s.waveforms, [key]: { kind: w.kind, points: w.points.filter((_, k) => k !== i).map((p): WaveformPoint => [p[0], p[1]]) } });
}

// ---- templates -----------------------------------------------------------------------------------------------------

export type TemplateKind = 'drop' | 'ramp' | 'gasPuff' | 'interlock';
export const TEMPLATE_KINDS: readonly TemplateKind[] = ['drop', 'ramp', 'gasPuff', 'interlock'];

/** The parameters of a template, as the form edits them (every number in the model's time unit or the control's unit). */
export interface TemplateParams {
  kind: TemplateKind;
  /** drop, ramp: the control */
  key: string;
  /** drop: time; ramp: start; gasPuff: start */
  t: number;
  /** ramp: end; gasPuff: duration */
  t1: number;
  /** drop, ramp: the value reached; gasPuff: the peak of the density target */
  to: number;
  /** gasPuff: ramp time of each edge (0: steps) */
  rise: number;
  /** interlock: the condition and what it sets */
  diag: string;
  op: TriggerOp;
  value: number;
  /** interlock: the control it sets and the value */
  setKey: string;
  setValue: number;
}

const PREFERRED_DIAGNOSTICS = ['nG_frac', 'betaN', 'Q', 'Ti', 'P_fus', 'q95'];
const PREFERRED_CONTROLS = ['P_NBI_MW', 'P_aux_MW', 'P_ICRH_MW', 'P_ECRH_MW', 'n_target_1e20', 'H98'];

/** Sensible starting parameters of a template for this model (the control and diagnostic exist in it; times relative to the run). */
export function defaultTemplate(kind: TemplateKind, ctx: EditorContext): TemplateParams {
  const keys = laneKeys(ctx);
  const powerKey = PREFERRED_CONTROLS.find((k) => k in ctx.controls) ?? keys[0] ?? '';
  const rampKey = 'Ip_MA' in ctx.controls ? 'Ip_MA' : powerKey;
  const nKey = 'n_target_1e20' in ctx.controls ? 'n_target_1e20' : powerKey;
  const key = kind === 'gasPuff' ? nKey : kind === 'ramp' ? rampKey : powerKey;
  const base = ctx.controls[key] ?? 0;
  const diag = PREFERRED_DIAGNOSTICS.find((d) => ctx.diagSpecs.some((s) => s.key === d)) ?? ctx.diagSpecs[0]?.key ?? '';
  const setKey = powerKey;
  const tEnd = ctx.tEnd;
  return {
    kind, key,
    t: kind === 'ramp' ? 0.3 * tEnd : kind === 'gasPuff' ? 0.4 * tEnd : 0.5 * tEnd,
    t1: kind === 'ramp' ? 0.6 * tEnd : 0.1 * tEnd,
    to: kind === 'gasPuff' ? base * 1.3 : kind === 'ramp' ? base * 0.5 : 0,
    rise: kind === 'gasPuff' ? 0.02 * tEnd : 0,
    diag, op: '>', value: diag === 'nG_frac' ? 0.9 : diag === 'betaN' ? 2.5 : 1,
    setKey, setValue: 0,
  };
}

/** The scenario a template makes (ScenarioError when the parameters are not valid, as the engine's own templates throw). */
export function buildTemplate(p: TemplateParams): ScenarioSpec {
  switch (p.kind) {
    case 'drop': return dropTemplate(p.key, p.t, p.to);
    case 'ramp': return rampTemplate(p.key, p.t, p.t1, p.to);
    case 'gasPuff': return gasPuffTemplate(p.t, p.t1, p.to, p.rise);
    case 'interlock': return interlockTemplate(p.diag, p.op, p.value, { [p.setKey]: p.setValue });
  }
}

/**
 * Adds a template to a scenario. A ramp of the plasma current (the 1.5D model's Ip_MA, a staircase of the model's own steps) also gets
 * a rampStep when the scenario has none, as the engine's documentation asks.
 */
export function applyTemplate(s: ScenarioSpec, p: TemplateParams, ctx: EditorContext): ScenarioSpec {
  const merged = mergeInto(s, buildTemplate(p));
  return p.kind === 'ramp' && p.key === 'Ip_MA' && merged.rampStep === undefined ? setRampStep(merged, suggestRampStep(ctx.tEnd)) : merged;
}

/** Puts a scenario into another: its waveforms replace the lanes of the same controls, its triggers are appended; the free label and the rampStep of `into` stay. */
export function mergeInto(into: ScenarioSpec, part: ScenarioSpec): ScenarioSpec {
  const waveforms = { ...into.waveforms, ...part.waveforms };
  const triggers = [...(into.triggers ?? []), ...(part.triggers ?? [])];
  const out: ScenarioSpec = { ...into };
  delete out.waveforms; delete out.triggers;
  if (Object.keys(waveforms).length) out.waveforms = waveforms;
  if (triggers.length) out.triggers = triggers;
  return out;
}

// ---- triggers ------------------------------------------------------------------------------------------------------

/** A new trigger for this model: a preferred diagnostic above a value, setting a power control to zero (once). */
export function newTrigger(ctx: EditorContext): TriggerSpec {
  const t = defaultTemplate('interlock', ctx);
  return { diag: t.diag, op: t.op, value: t.value, set: { [t.setKey]: t.setValue } };
}

export function addTrigger(s: ScenarioSpec, ctx: EditorContext): ScenarioSpec {
  return { ...s, triggers: [...(s.triggers ?? []), newTrigger(ctx)] };
}

export function updateTrigger(s: ScenarioSpec, i: number, patch: Partial<TriggerSpec>): ScenarioSpec {
  const list = s.triggers ?? [];
  if (i < 0 || i >= list.length) return s;
  const next: TriggerSpec = { ...list[i], ...patch };
  for (const k of Object.keys(next) as (keyof TriggerSpec)[]) if (next[k] === undefined) delete next[k];
  return { ...s, triggers: list.map((t, k) => (k === i ? next : t)) };
}

export function removeTrigger(s: ScenarioSpec, i: number): ScenarioSpec {
  const list = s.triggers ?? [];
  if (i < 0 || i >= list.length) return s;
  const rest = list.filter((_, k) => k !== i);
  const out: ScenarioSpec = { ...s };
  delete out.triggers;
  return rest.length ? { ...out, triggers: rest } : out;
}

/** Sets the rampStep (undefined removes it). */
export function setRampStep(s: ScenarioSpec, v: number | undefined): ScenarioSpec {
  const out: ScenarioSpec = { ...s };
  delete out.rampStep;
  return v === undefined ? out : { ...out, rampStep: v };
}

export function setName(s: ScenarioSpec, name: string): ScenarioSpec {
  const out: ScenarioSpec = { ...s };
  delete out.name;
  return name ? { ...out, name } : out;
}

// ---- checking and text ---------------------------------------------------------------------------------------------

/** What is wrong with a scenario for this model: the engine's own check against its controls, diagnostics and end time (empty: fine). */
export function problems(s: ScenarioSpec, ctx: EditorContext | null): ScenarioIssue[] {
  const r = validateScenario(s, ctx ? { controls: Object.keys(ctx.controls), diagnostics: ctx.diagSpecs.map((d) => d.key), tEnd: ctx.tEnd } : {});
  if (!r.ok) return r.issues;
  // a null point needs a configured value of the control (the engine's own check when it builds)
  const issues: ScenarioIssue[] = [];
  if (ctx) {
    for (const [key, w] of Object.entries(r.spec.waveforms ?? {})) {
      w.points.forEach((p, i) => { if (p[1] === null && !Number.isFinite(ctx.controls[key])) issues.push({ path: `waveforms.${key}.points[${i}][1]`, message: `null needs a configured value of '${key}'` }); });
    }
  }
  return issues;
}

/** Issues of a path (waveform key or trigger index) for the field markers of the editor. */
export const issuesAt = (issues: readonly ScenarioIssue[], prefix: string): ScenarioIssue[] => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`));

/** The normalised form of a scenario (the one that is stored and shared), or null when it is invalid. */
export function normalized(s: ScenarioSpec, ctx: EditorContext | null): ScenarioSpec | null {
  const r = validateScenario(s, ctx ? { controls: Object.keys(ctx.controls), diagnostics: ctx.diagSpecs.map((d) => d.key), tEnd: ctx.tEnd } : {});
  return r.ok ? r.spec : null;
}

/** The JSON text of a valid scenario (canonical: one scenario, one text). Throws ScenarioError for an invalid one. */
export const toText = (s: ScenarioSpec): string => scenarioToJSON(s);

/** Parses JSON text against the model (ScenarioError, with every problem, when it is not valid). */
export function fromText(text: string, ctx: EditorContext | null): ScenarioSpec {
  return scenarioFromJSON(text, ctx ? { controls: Object.keys(ctx.controls), diagnostics: ctx.diagSpecs.map((d) => d.key), tEnd: ctx.tEnd } : {});
}

/** A few words on what a scenario contains, for the wizard summary and the run view: "2 waveforms, 1 trigger". */
export function summarize(s: ScenarioSpec | null | undefined): { waveforms: number; triggers: number } {
  return { waveforms: Object.keys(s?.waveforms ?? {}).length, triggers: s?.triggers?.length ?? 0 };
}

// ---- record mode ---------------------------------------------------------------------------------------------------

/**
 * Turns the live interventions of a run (its actuator log) into a scenario: what the operator did becomes waveforms.
 * A control that was set live (at a step boundary, by a patch that takes over the control for the rest of the run) becomes a
 * step at that time, holding the value until the next intervention on it. A control that `base` (the scenario the run
 * was started with) also drives keeps `base` up to the first intervention and follows the operator afterwards, exactly: for a
 * 'pwl' lane the value at the first intervention is written as a corner and the operator's steps as jumps (two points at one
 * time). Everything else of `base` (other lanes, triggers, rampStep, name) is kept.
 *
 * The result reproduces the interventions at their times; the run it makes is not bit for bit the recorded one, because the
 * corners of the waveforms are breakpoints of the step sequence (the recorded run's own steps ended there anyway, but the ones
 * before them may differ). Export the recorded run (fingerprint and actuator log) for an exact copy.
 */
export function scenarioFromActuatorLog(log: readonly ActuatorEntry[], base: ScenarioSpec | null, ctx: EditorContext): ScenarioSpec {
  const events = new Map<string, [number, number][]>();
  for (const e of [...log].sort((a, b) => a.step - b.step)) {
    for (const k of Object.keys(e.patch)) {
      if (!Number.isFinite(e.patch[k]) || !(k in ctx.controls)) continue;
      const list = events.get(k) ?? [];
      const last = list[list.length - 1];
      if (last && last[0] === e.t) last[1] = e.patch[k]; // several patches at one boundary: the last one wins
      else list.push([e.t, e.patch[k]]);
      events.set(k, list);
    }
  }
  let out: ScenarioSpec = base ? { ...base } : emptyScenario();
  for (const [key, list] of events) {
    const old = base?.waveforms?.[key];
    const cfgValue = ctx.controls[key];
    let wf: WaveformSpec;
    if (!old) {
      wf = { kind: 'step', points: list.map(([t, v]): WaveformPoint => [t, v]) };
    } else if (old.kind === 'step') {
      const t0 = list[0][0];
      wf = { kind: 'step', points: [...old.points.filter((p) => p[0] < t0).map((p): WaveformPoint => [p[0], p[1]]), ...list.map(([t, v]): WaveformPoint => [t, v])] };
    } else {
      const t0 = list[0][0];
      const points: WaveformPoint[] = old.points.filter((p) => p[0] < t0).map((p): WaveformPoint => [p[0], p[1]]);
      points.push([t0, waveformAt(old, cfgValue, t0) ?? cfgValue]);
      let prev: number | null = null;
      for (const [t, v] of list) {
        if (prev !== null) points.push([t, prev]);
        points.push([t, v]);
        prev = v;
      }
      wf = { kind: 'pwl', points };
    }
    out = withWaveforms(out, { ...out.waveforms, [key]: wf });
  }
  return out;
}
