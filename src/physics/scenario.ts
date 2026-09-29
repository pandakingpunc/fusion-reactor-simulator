/**
 * DETERMINISTIC SCENARIO ENGINE — waveforms and conditional triggers that drive the control keys of a run.
 *
 * A scenario is plain JSON data (`ScenarioSpec`: it goes into share links and, later, the UI editor) with
 *  - waveforms: per control key (SimModel.getControls(): P_NBI_MW, n_target_1e20, H98, ...) a piecewise
 *    linear ('pwl') or step (zero-order hold) function of time;
 *  - triggers: {diag, op, value} → set. When a diagnostic of a recorded frame satisfies the condition
 *    (optionally for a dwell time, after a start time) the trigger writes control values, once or
 *    repeatedly, with a hysteresis band before it can fire again and an optional patch on re-arming.
 * `Simulation` (options.scenario) applies it at the step boundaries of the kernel; nothing here touches
 * the models, the DOM or Node.
 *
 * Time base. Times are in the model's time unit (SimModel.timeUnit: seconds for the magnetic models, ns
 * or µs for the pulsed ones), like the run itself.
 *
 * Waveforms
 *  - A waveform is defined from its first point on. Before it the key is not touched: it keeps the
 *    model's configured value (or whatever a live applyControl() set). After the last point the last
 *    value holds. A point value of `null` means "the configured value of the control" (the model's
 *    getControls() before the scenario), so `ramp I_p to 0` needs no knowledge of the configuration.
 *  - 'pwl' interpolates linearly between the points; two points at the same time make a jump (the value
 *    at that time is the later one: right-continuous). 'step' holds each value until the next point.
 *  - The value at a step boundary t is the value at t: a control changes only at step boundaries and the
 *    model integrates the whole next step with it. Every corner of every waveform is a breakpoint
 *    (nextBreakpoint(), fed to the kernel's step limit), so the value at a corner is exact and a step never
 *    straddles one. Along a ramp the control is a staircase of the model's own steps (lagging the ideal
 *    ramp by at most half a step); `rampStep` (optional) caps the time between step boundaries on a
 *    ramp when that is too coarse. A time within 1e-12 (the kernel's T_EPS) of a corner counts as the
 *    corner, so an integrator step that lands a rounding error short of it or past it still sees exactly
 *    the corner value.
 *  - rampStep is bounded below, because every grid point is a step of the run: at least MIN_RAMP_STEP
 *    (an absolute floor, in the model's time unit, so that the grid stays representable) and, once the
 *    end time of the model is known (ScenarioContext.tEnd, which Simulation passes), at least
 *    tEnd / MAX_RAMP_GRID (at most that many grid points per waveform segment over the whole run). A
 *    scenario that asks for a finer grid is invalid (ScenarioError, path 'rampStep'): a share link cannot
 *    make a run endless.
 *
 * Triggers
 *  - Evaluated on the diagnostics of the recorded frames, once per frame, at the first step boundary after
 *    the frame was recorded (a frame is recorded at a step end, so that boundary is the frame's own time).
 *    Frames are recorded at every regular output time and at every ELM, sawtooth and disruption, so a
 *    trigger reacts within one output interval. Reading frames and not the live model makes the
 *    evaluation independent of how the caller chunks time and of a rewind: after a rewind the frame that
 *    was the last one is the last one again, and its trigger state comes back with its checkpoint.
 *  - `hold` and `after` are two independent conditions on the firing time. `hold`: the condition must have
 *    held on consecutive frames for this long, counted from the first frame of the current unbroken
 *    stretch of frames that satisfy it (the frame time is the clock; a frame that does not satisfy the
 *    condition restarts the count, also before `after`). `after`: no firing before this time. The trigger
 *    fires at the first frame that meets both: t >= after and t - (start of the stretch) >= hold. So with
 *    hold = 2 and after = 5, a condition that has been true since t = 0 fires at t = 5, one that became
 *    true at t = 4 fires at t = 6.
 *  - 'once' triggers fire once per run branch. 'repeat' triggers re-arm when the
 *    condition is false again (with `hysteresis` > 0: when the diagnostic has crossed back over value −
 *    hysteresis for '>' and '>=', value + hysteresis for '<' and '<='); the optional `release` patch is
 *    applied when they re-arm. Triggers are evaluated in list order; a later one wins a conflict.
 *  - A fired trigger writes an 'info' event: "Scenario trigger '<id>': ...".
 *
 * Who owns a control key
 *  - Waveforms drive their keys at every step boundary until the key is taken over: a fired trigger takes
 *    over the keys of its patch, and a live Simulation.applyControl() takes over the keys of its patch
 *    ("manual override": the operator or an interlock wins for the rest of the run branch, as in a plasma
 *    control system). A taken-over key is no longer written by any waveform. The set of taken-over keys is
 *    part of the run's checkpoint (ScenarioState).
 *
 * Actuator log versus scenario (Simulation)
 *  - The actuator log records live interventions only (applyControl()). Whatever the scenario does is a
 *    function of the scenario, the configuration and the recorded frames, so it is NOT logged: a run is
 *    reproduced by (configuration, seed, scenario, breakpoints, actuator log), and runFingerprint() covers
 *    all five. Replaying a log needs the same scenario (Simulation.replay(cfg, log, { scenario })); the
 *    same log without it is a different run. At one step boundary the logged patches are applied first
 *    (they take over their keys), then the scenario; a live patch applied by the caller at a boundary is
 *    therefore in force exactly as its replay is.
 *
 * Extension. The controls a scenario may name are the keys the model exposes in getControls(); the table
 * SCENARIO_CONTROLS only adds labels, units and sanity limits. When WS6c exposes the plasma current and the
 * shape (I_p, κ, δ, ...) as controls, the keys work in waveforms at once and get an entry here.
 */
import { canonicalString } from './kernel/canonical';
import { ScenarioError, type ScenarioIssue } from './kernel/errors';

export type { ScenarioIssue } from './kernel/errors';

/** Slack [time unit] within which a time counts as a corner or breakpoint (the kernel's T_EPS). */
export const T_EPS = 1e-12;

/** Version of the JSON form. */
export const SCENARIO_SCHEMA = 1;

export type WaveformKind = 'pwl' | 'step';
/** [time, value]; a value of null stands for the configured value of the control */
export type WaveformPoint = [number, number | null];

export interface WaveformSpec {
  kind: WaveformKind;
  /** at least one point; times are >= 0 and non-decreasing (validateScenario sorts them; 'step' needs distinct times) */
  points: WaveformPoint[];
}

export type TriggerOp = '>' | '>=' | '<' | '<=';
export type TriggerMode = 'once' | 'repeat';

export interface TriggerSpec {
  /** label for the event log (default: "<diag> <op> <value>") */
  id?: string;
  /** key of the frame diagnostics (HistoryFrame.d), e.g. 'Q', 'H_mode', 'betaN', 'nG_frac' */
  diag: string;
  op: TriggerOp;
  value: number;
  /**
   * dwell time (default 0): the condition must have held on consecutive frames for this long, counted from
   * the first frame of the current unbroken stretch that satisfies it (also from before `after`)
   */
  hold?: number;
  /**
   * earliest firing time (default 0), independent of `hold`: the trigger fires at the first frame with
   * t >= after whose condition has held for `hold` (hold 2, after 5: true since 0 fires at 5, true since 4 at 6)
   */
  after?: number;
  /** control values written when it fires */
  set: Record<string, number>;
  /** 'once' (default) or 'repeat' */
  mode?: TriggerMode;
  /** repeat only: how far the diagnostic must cross back over `value` before the trigger re-arms (default 0: as soon as the condition is false) */
  hysteresis?: number;
  /** repeat only: control values written when it re-arms */
  release?: Record<string, number>;
}

export interface ScenarioSpec {
  schema: typeof SCENARIO_SCHEMA;
  /** free label (not part of the run's fingerprint) */
  name?: string;
  waveforms?: Record<string, WaveformSpec>;
  triggers?: TriggerSpec[];
  /** upper bound of the time between step boundaries on a ramping segment of a 'pwl' waveform (default: none) */
  rampStep?: number;
}

/**
 * What the engine carries between step boundaries; JSON-serialisable. Simulation stores a copy in every
 * frame checkpoint (SimCheckpoint.scenario) and restores it on a rewind.
 */
export interface ScenarioState {
  /** index of the last history frame the triggers have looked at (−1: none yet) */
  frame: number;
  /** control keys taken over from the waveforms, sorted */
  manual: string[];
  /** per trigger: 1 = armed, 0 = fired and (repeat only) waiting to re-arm */
  armed: number[];
  /** per trigger: time of the frame at which its condition began to hold, −1 if it does not hold */
  since: number[];
  /** per trigger: how often it has fired */
  fired: number[];
}

/** Label, unit and sanity limits of a control key (SCENARIO_CONTROLS). */
export interface ControlInfo {
  label: string;
  unit: string;
  min?: number;
  max?: number;
}

/**
 * The control keys of the models that a scenario is most likely to drive, with sanity limits for the
 * validation and labels for an editor. A key that a model exposes but that is not listed here is valid
 * (without limits). Add I_p and the shape keys here when WS6c exposes them.
 */
export const SCENARIO_CONTROLS: Readonly<Record<string, ControlInfo>> = {
  P_NBI_MW: { label: 'NBI power', unit: 'MW', min: 0 },
  P_ICRH_MW: { label: 'ICRH power', unit: 'MW', min: 0 },
  P_ECRH_MW: { label: 'ECRH power', unit: 'MW', min: 0 },
  P_aux_MW: { label: 'auxiliary power', unit: 'MW', min: 0 },
  n_target_1e20: { label: 'density target (volume average)', unit: '1e20 m⁻³', min: 0 },
  H98: { label: 'confinement multiplier H98', unit: '', min: 0 },
  H_ISS04: { label: 'confinement multiplier H_ISS04', unit: '', min: 0 },
  cZ: { label: 'impurity concentration', unit: '', min: 0 },
  fuelRate_1e20s: { label: 'fuelling rate limit', unit: '1e20 s⁻¹', min: 0 },
  kappa_conf: { label: 'confinement factor', unit: '', min: 0 },
  muonRate_per_s: { label: 'muon rate', unit: 's⁻¹', min: 0 },
};

/** What a scenario asks for at one step boundary. */
export interface ScenarioStep {
  /** control values to write (every waveform key that is not taken over, then the patches of fired triggers) */
  patch: Record<string, number>;
  /** what the triggers did, for the event log */
  notes: { msg: string; value?: number }[];
}

// ------------------------------------------------------------------------------------------------
// validation and the JSON form
// ------------------------------------------------------------------------------------------------

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPS: readonly string[] = ['>', '>=', '<', '<='];
const MAX_JSON_CHARS = 1_000_000;
const MAX_KEYS = 64;
const MAX_POINTS = 4096;
const MAX_TOTAL_POINTS = 20000;
const MAX_TRIGGERS = 128;
const MAX_SET_KEYS = 32;

/**
 * Smallest rampStep [time unit] of any scenario. Every grid point is a step of the run, and a grid finer than
 * the floating-point spacing of the times it runs over would not advance at all.
 */
export const MIN_RAMP_STEP = 1e-6;
/** With the end time of the model known: at most this many rampStep grid points per waveform segment over the run (rampStep >= tEnd / MAX_RAMP_GRID). */
export const MAX_RAMP_GRID = 1e4;

/** Where a scenario is checked: the control and diagnostic keys of the model it is attached to (all optional). */
export interface ScenarioContext {
  /** control keys of the model (getControls()); when given, a waveform or trigger naming another key is an issue */
  controls?: readonly string[];
  /** diagnostic keys of a frame (HistoryFrame.d); when given, a trigger on another key is an issue */
  diagnostics?: readonly string[];
  /** replaces SCENARIO_CONTROLS (labels, sanity limits) */
  controlInfo?: Readonly<Record<string, ControlInfo>>;
  /** end time of the model's run [time unit]; when given, a rampStep below tEnd / MAX_RAMP_GRID is an issue */
  tEnd?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Checks a scenario (any parsed JSON) and returns its normalised form: points sorted by time, default
 * values dropped, empty parts removed. The normalised form is what is stored, fingerprinted and
 * serialised. All problems are listed (with paths), not just the first.
 */
export function validateScenario(input: unknown, ctx: ScenarioContext = {}): { ok: true; spec: ScenarioSpec } | { ok: false; issues: ScenarioIssue[] } {
  const issues: ScenarioIssue[] = [];
  const bad = (path: string, message: string): void => { if (issues.length < 50) issues.push({ path, message }); };
  const info = ctx.controlInfo ?? SCENARIO_CONTROLS;
  const listOf = (keys: readonly string[]): string => { const s = [...keys].sort(); return s.length > 12 ? `${s.slice(0, 12).join(', ')}, ...` : s.join(', '); };

  const checkKey = (key: string, path: string, what: 'control' | 'diagnostic'): boolean => {
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) { bad(path, `'${key}' is not a valid ${what} key`); return false; }
    if (what === 'control' && ctx.controls && !ctx.controls.includes(key)) { bad(path, `unknown control '${key}' (this model exposes: ${listOf(ctx.controls) || 'none'})`); return false; }
    if (what === 'diagnostic' && ctx.diagnostics && !ctx.diagnostics.includes(key)) { bad(path, `unknown diagnostic '${key}' (frames carry: ${listOf(ctx.diagnostics)})`); return false; }
    return true;
  };
  const checkValue = (key: string, v: unknown, path: string, allowNull: boolean): boolean => {
    if (v === null && allowNull) return true;
    if (!isFiniteNumber(v)) { bad(path, `must be a finite number${allowNull ? ' or null' : ''}`); return false; }
    const lim = info[key];
    if (lim?.min !== undefined && v < lim.min) { bad(path, `${key} must be >= ${lim.min}${lim.unit ? ` ${lim.unit}` : ''}`); return false; }
    if (lim?.max !== undefined && v > lim.max) { bad(path, `${key} must be <= ${lim.max}${lim.unit ? ` ${lim.unit}` : ''}`); return false; }
    return true;
  };
  const noUnknown = (o: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(path ? `${path}.${k}` : k, 'unknown property');
  };
  const optNumber = (o: Record<string, unknown>, k: string, path: string, min: number, strict = false): number | undefined => {
    const v = o[k];
    if (v === undefined) return undefined;
    if (!isFiniteNumber(v) || (strict ? v <= min : v < min)) { bad(path ? `${path}.${k}` : k, `must be a finite number ${strict ? '>' : '>='} ${min}`); return undefined; }
    return v;
  };
  const patchOf = (v: unknown, path: string): Record<string, number> | undefined => {
    if (!isRecord(v)) { bad(path, 'must be an object {control: value}'); return undefined; }
    const keys = Object.keys(v);
    if (keys.length === 0) { bad(path, 'must set at least one control'); return undefined; }
    if (keys.length > MAX_SET_KEYS) { bad(path, `at most ${MAX_SET_KEYS} controls`); return undefined; }
    const out: Record<string, number> = {};
    let ok = true;
    for (const k of [...keys].sort()) {
      if (!checkKey(k, `${path}.${k}`, 'control') || !checkValue(k, v[k], `${path}.${k}`, false)) { ok = false; continue; }
      out[k] = v[k] as number;
    }
    return ok ? out : undefined;
  };

  if (!isRecord(input)) { bad('', 'a scenario is an object {schema, waveforms, triggers}'); return { ok: false, issues }; }
  noUnknown(input, ['schema', 'name', 'waveforms', 'triggers', 'rampStep'], '');
  if (input.schema !== SCENARIO_SCHEMA) bad('schema', `must be ${SCENARIO_SCHEMA}`);
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 120)) bad('name', 'must be a string of at most 120 characters');
  const rampStep = optNumber(input, 'rampStep', '', 0, true);
  if (rampStep !== undefined) {
    const floor = isFiniteNumber(ctx.tEnd) && ctx.tEnd > 0 ? Math.max(MIN_RAMP_STEP, ctx.tEnd / MAX_RAMP_GRID) : MIN_RAMP_STEP;
    if (rampStep < floor) {
      bad('rampStep', floor === MIN_RAMP_STEP
        ? `must be >= ${MIN_RAMP_STEP} (every grid point is a step of the run)`
        : `must be >= ${fmt(floor)} = t_end / ${MAX_RAMP_GRID} (at most ${MAX_RAMP_GRID} grid points over the run)`);
    }
  }

  // waveforms
  const waveforms: Record<string, WaveformSpec> = {};
  if (input.waveforms !== undefined) {
    if (!isRecord(input.waveforms)) bad('waveforms', 'must be an object {control: waveform}');
    else {
      const keys = Object.keys(input.waveforms);
      if (keys.length > MAX_KEYS) bad('waveforms', `at most ${MAX_KEYS} controls`);
      let total = 0;
      for (const key of [...keys].sort()) {
        const path = `waveforms.${key}`;
        const w = input.waveforms[key];
        const keyOk = checkKey(key, path, 'control');
        if (!isRecord(w)) { bad(path, 'must be {kind, points}'); continue; }
        noUnknown(w, ['kind', 'points'], path);
        if (w.kind !== 'pwl' && w.kind !== 'step') bad(`${path}.kind`, "must be 'pwl' or 'step'");
        if (!Array.isArray(w.points) || w.points.length === 0) { bad(`${path}.points`, 'must be a non-empty array of [time, value]'); continue; }
        if (w.points.length > MAX_POINTS) { bad(`${path}.points`, `at most ${MAX_POINTS} points`); continue; }
        total += w.points.length;
        if (total > MAX_TOTAL_POINTS) { bad('waveforms', `at most ${MAX_TOTAL_POINTS} points in all`); break; }
        const pts: WaveformPoint[] = [];
        let pointsOk = true;
        w.points.forEach((p: unknown, i: number) => {
          const pp = `${path}.points[${i}]`;
          if (!Array.isArray(p) || p.length !== 2) { bad(pp, 'must be [time, value]'); pointsOk = false; return; }
          if (!isFiniteNumber(p[0]) || p[0] < 0) { bad(`${pp}[0]`, 'the time must be a finite number >= 0'); pointsOk = false; return; }
          if (!checkValue(key, p[1], `${pp}[1]`, true)) { pointsOk = false; return; }
          pts.push([p[0], p[1] as number | null]);
        });
        if (!keyOk || !pointsOk || (w.kind !== 'pwl' && w.kind !== 'step')) continue;
        const sorted = pts.map((p, i) => ({ p, i })).sort((a, b) => a.p[0] - b.p[0] || a.i - b.i).map((x) => x.p);
        if (w.kind === 'step') for (let i = 1; i < sorted.length; i++) if (sorted[i][0] === sorted[i - 1][0]) { bad(`${path}.points`, `a step waveform needs distinct times (${sorted[i][0]} twice)`); break; }
        waveforms[key] = { kind: w.kind, points: sorted };
      }
    }
  }

  // triggers
  const triggers: TriggerSpec[] = [];
  if (input.triggers !== undefined) {
    if (!Array.isArray(input.triggers)) bad('triggers', 'must be an array');
    else if (input.triggers.length > MAX_TRIGGERS) bad('triggers', `at most ${MAX_TRIGGERS} triggers`);
    else input.triggers.forEach((tr: unknown, i: number) => {
      const path = `triggers[${i}]`;
      if (!isRecord(tr)) { bad(path, 'must be an object'); return; }
      noUnknown(tr, ['id', 'diag', 'op', 'value', 'hold', 'after', 'set', 'mode', 'hysteresis', 'release'], path);
      const before = issues.length;
      if (tr.id !== undefined && (typeof tr.id !== 'string' || tr.id.length < 1 || tr.id.length > 64 || /[\u0000-\u001f]/.test(tr.id))) bad(`${path}.id`, 'must be a string of 1 to 64 printable characters');
      if (typeof tr.diag !== 'string') bad(`${path}.diag`, 'must be a diagnostic key');
      else checkKey(tr.diag, `${path}.diag`, 'diagnostic');
      if (typeof tr.op !== 'string' || !OPS.includes(tr.op)) bad(`${path}.op`, `must be one of ${OPS.join(' ')}`);
      if (!isFiniteNumber(tr.value)) bad(`${path}.value`, 'must be a finite number');
      const hold = optNumber(tr, 'hold', path, 0);
      const after = optNumber(tr, 'after', path, 0);
      const hysteresis = optNumber(tr, 'hysteresis', path, 0);
      if (tr.mode !== undefined && tr.mode !== 'once' && tr.mode !== 'repeat') bad(`${path}.mode`, "must be 'once' or 'repeat'");
      const repeat = tr.mode === 'repeat';
      if (!repeat && hysteresis !== undefined && hysteresis > 0) bad(`${path}.hysteresis`, "needs mode 'repeat'");
      if (!repeat && tr.release !== undefined) bad(`${path}.release`, "needs mode 'repeat'");
      const set = patchOf(tr.set, `${path}.set`);
      const release = tr.release === undefined ? undefined : patchOf(tr.release, `${path}.release`);
      if (issues.length > before || !set) return;
      const out: TriggerSpec = { diag: tr.diag as string, op: tr.op as TriggerOp, value: tr.value as number, set };
      if (tr.id !== undefined) out.id = tr.id as string;
      if (hold) out.hold = hold;
      if (after) out.after = after;
      if (repeat) out.mode = 'repeat';
      if (hysteresis) out.hysteresis = hysteresis;
      if (release) out.release = release;
      triggers.push(out);
    });
  }

  if (issues.length) return { ok: false, issues };
  const spec: ScenarioSpec = { schema: SCENARIO_SCHEMA };
  if (typeof input.name === 'string' && input.name) spec.name = input.name;
  if (rampStep !== undefined) spec.rampStep = rampStep;
  if (Object.keys(waveforms).length) spec.waveforms = waveforms;
  if (triggers.length) spec.triggers = triggers;
  return { ok: true, spec };
}

/** validateScenario() that throws a ScenarioError listing the issues. */
export function parseScenario(input: unknown, ctx: ScenarioContext = {}): ScenarioSpec {
  const r = validateScenario(input, ctx);
  if (!r.ok) throw new ScenarioError(r.issues);
  return r.spec;
}

/** The JSON text of a scenario: normalised, keys sorted (one scenario, one text: stable for share links and hashes). */
export function scenarioToJSON(spec: ScenarioSpec): string {
  return canonicalString(parseScenario(spec));
}

/** Parses and validates the JSON text of a scenario (ScenarioError on malformed text or an invalid scenario). */
export function scenarioFromJSON(text: string, ctx: ScenarioContext = {}): ScenarioSpec {
  if (text.length > MAX_JSON_CHARS) throw new ScenarioError([{ path: '', message: `the scenario text is longer than ${MAX_JSON_CHARS} characters` }]);
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) { throw new ScenarioError([{ path: '', message: `not valid JSON: ${(e as Error).message}` }]); }
  return parseScenario(data, ctx);
}

/** True if the scenario neither drives a control nor reacts to anything (attaching it changes nothing). */
export function isEmptyScenario(spec: ScenarioSpec): boolean {
  return !spec.waveforms && !(spec.triggers && spec.triggers.length);
}

// ------------------------------------------------------------------------------------------------
// templates
// ------------------------------------------------------------------------------------------------

/** 'Drop <key> to `to` (default 0) at time t': a step waveform. Before t the control keeps its configured value. */
export function dropTemplate(key: string, t: number, to = 0): ScenarioSpec {
  return parseScenario({ schema: SCENARIO_SCHEMA, name: `drop ${key} at ${t}`, waveforms: { [key]: { kind: 'step', points: [[t, to]] } } });
}

/**
 * 'Ramp <key> from t0 to t1 to the value `to`', e.g. rampTemplate('Ip_MA', 100, 130, 0) once a model exposes I_p.
 * It starts at `from` (default: the configured value of the control) and holds `to` afterwards.
 */
export function rampTemplate(key: string, t0: number, t1: number, to: number, from: number | null = null): ScenarioSpec {
  return parseScenario({ schema: SCENARIO_SCHEMA, name: `ramp ${key} ${t0}..${t1}`, waveforms: { [key]: { kind: 'pwl', points: [[t0, from], [t1, to]] } } });
}

/**
 * 'Gas puff': raises the density target n_target_1e20 to `peak` [1e20 m⁻³] at time t, holds it for `duration`
 * and returns it to the configured value; `rise` is the ramp time of each edge (default 0: steps).
 */
export function gasPuffTemplate(t: number, duration: number, peak: number, rise = 0): ScenarioSpec {
  const points: WaveformPoint[] = rise > 0
    ? [[t, null], [t + rise, peak], [t + duration, peak], [t + duration + rise, null]]
    : [[t, peak], [t + duration, null]];
  return parseScenario({ schema: SCENARIO_SCHEMA, name: `gas puff at ${t}`, waveforms: { n_target_1e20: { kind: rise > 0 ? 'pwl' : 'step', points } } });
}

/** 'Interlock': when the diagnostic satisfies the condition, write the controls (once). */
export function interlockTemplate(diag: string, op: TriggerOp, value: number, set: Record<string, number>, opts: { id?: string; hold?: number; after?: number } = {}): ScenarioSpec {
  return parseScenario({ schema: SCENARIO_SCHEMA, triggers: [{ ...opts, diag, op, value, set }] });
}

/** Combines scenarios: waveforms of different controls side by side, triggers in order (a control in two scenarios is an issue). */
export function mergeScenarios(...parts: ScenarioSpec[]): ScenarioSpec {
  const waveforms: Record<string, WaveformSpec> = {};
  const triggers: TriggerSpec[] = [];
  const issues: ScenarioIssue[] = [];
  for (const p of parts) {
    for (const [k, w] of Object.entries(p.waveforms ?? {})) {
      if (k in waveforms) issues.push({ path: `waveforms.${k}`, message: 'two scenarios drive the same control' });
      else waveforms[k] = w;
    }
    triggers.push(...(p.triggers ?? []));
  }
  if (issues.length) throw new ScenarioError(issues);
  const steps = parts.map((p) => p.rampStep).filter((x): x is number => x !== undefined);
  return parseScenario({
    schema: SCENARIO_SCHEMA, name: parts.map((p) => p.name).filter(Boolean).join(' + ') || undefined,
    rampStep: steps.length ? Math.min(...steps) : undefined, waveforms, triggers,
  });
}

// ------------------------------------------------------------------------------------------------
// the engine
// ------------------------------------------------------------------------------------------------

/** A waveform with its null values resolved. */
interface BoundWaveform { key: string; step: boolean; t: Float64Array; v: Float64Array }

/** Largest index i with a[i] <= x, or −1. */
function lastAtMost(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length - 1, r = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= x) { r = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return r;
}

/** A double greater than x, at most a few units in the last place above it (x finite and >= 0 here: times): x·2^-52 is at least one ulp of x. */
function nextDoubleUp(x: number): number {
  return x + Math.max(x * Number.EPSILON, Number.MIN_VALUE);
}

/** The value of a waveform at time t, or undefined before its first point. */
function waveformValue(w: BoundWaveform, t: number): number | undefined {
  const i = lastAtMost(w.t, t + T_EPS);
  if (i < 0) return undefined;
  if (w.step || i === w.t.length - 1) return w.v[i];
  const t0 = w.t[i], t1 = w.t[i + 1];
  if (!(t - t0 > T_EPS)) return w.v[i]; // at (within T_EPS before or after) the corner: exactly its value
  return w.v[i] + (w.v[i + 1] - w.v[i]) * ((t - t0) / (t1 - t0));
}

function compare(op: TriggerOp, a: number, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    default: return a <= b;
  }
}

const fmt = (x: number): string => String(+x.toPrecision(4));
const fmtPatch = (p: Record<string, number>): string => Object.keys(p).map((k) => `${k} = ${fmt(p[k])}`).join(', ');

export class Scenario {
  /** the validated, normalised scenario */
  readonly spec: ScenarioSpec;
  private readonly wf: BoundWaveform[] = [];
  /** the corner times of all waveforms, sorted and distinct (breakpoints) */
  private readonly corners: number[];
  private readonly rampStep: number;
  private readonly triggers: readonly TriggerSpec[];
  /** the control keys a waveform or trigger writes (only these can be taken over) */
  private readonly driven: ReadonlySet<string>;
  private readonly manual = new Set<string>();
  private frame = -1;
  private armed: number[];
  private since: number[];
  private fired: number[];

  /**
   * @param input   the scenario (validated again; ScenarioError when it is invalid)
   * @param initial the configured control values of the model (getControls() before the run): the control keys
   *                a scenario may name, and the value of a `null` point
   * @param ctx     more to check against: the diagnostic keys of a frame and the end time of the model's run
   *                (`tEnd`: a rampStep finer than tEnd / MAX_RAMP_GRID is refused, see the file header)
   */
  constructor(input: unknown, initial: Readonly<Record<string, number>>, ctx: Omit<ScenarioContext, 'controls'> = {}) {
    this.spec = parseScenario(input, { ...ctx, controls: Object.keys(initial) });
    const issues: ScenarioIssue[] = [];
    const cornerSet = new Set<number>();
    for (const [key, w] of Object.entries(this.spec.waveforms ?? {})) {
      const t = new Float64Array(w.points.length), v = new Float64Array(w.points.length);
      w.points.forEach(([pt, pv], i) => {
        t[i] = pt;
        if (pv === null && !Number.isFinite(initial[key])) issues.push({ path: `waveforms.${key}.points[${i}][1]`, message: `null needs a configured value of '${key}'` });
        v[i] = pv ?? initial[key];
        if (pt > 0) cornerSet.add(pt);
      });
      this.wf.push({ key, step: w.kind === 'step', t, v });
    }
    if (issues.length) throw new ScenarioError(issues);
    this.corners = [...cornerSet].sort((a, b) => a - b);
    this.rampStep = this.spec.rampStep ?? 0;
    this.triggers = this.spec.triggers ?? [];
    const driven = new Set<string>(this.wf.map((w) => w.key));
    for (const tr of this.triggers) for (const k of [...Object.keys(tr.set), ...Object.keys(tr.release ?? {})]) driven.add(k);
    this.driven = driven;
    this.armed = this.triggers.map(() => 1);
    this.since = this.triggers.map(() => -1);
    this.fired = this.triggers.map(() => 0);
  }

  /** The scenario as it enters runFingerprint(): the normalised form without the free label; null if it does nothing. */
  fingerprintForm(): ScenarioSpec | null {
    if (isEmptyScenario(this.spec)) return null;
    const { name: _name, ...rest } = this.spec;
    return rest as ScenarioSpec;
  }

  /** Diagnostic keys that triggers name, for checking them against the frames of the model. */
  triggerDiagnostics(): string[] { return [...new Set(this.triggers.map((tr) => tr.diag))]; }

  /** Checks the trigger diagnostics against the keys of a frame (ScenarioError for an unknown one). */
  checkDiagnostics(frameKeys: readonly string[]): void {
    const issues: ScenarioIssue[] = [];
    this.triggers.forEach((tr, i) => {
      if (!frameKeys.includes(tr.diag)) issues.push({ path: `triggers[${i}].diag`, message: `unknown diagnostic '${tr.diag}' (frames carry: ${[...frameKeys].sort().slice(0, 12).join(', ')}, ...)` });
    });
    if (issues.length) throw new ScenarioError(issues);
  }

  /** The waveform values at time t for the keys that have not been taken over (the state of a run at t = 0 before its first frame). */
  waveformsAt(t: number): Record<string, number> {
    const patch: Record<string, number> = {};
    for (const w of this.wf) {
      if (this.manual.has(w.key)) continue;
      const v = waveformValue(w, t);
      if (v !== undefined) patch[w.key] = v;
    }
    return patch;
  }

  /**
   * The first time after t at which a step must end: the next waveform corner and, with rampStep, the next
   * grid point inside a ramping segment. Infinity if there is none. A pure function of t and the scenario.
   */
  nextBreakpoint(t: number): number {
    const lim = t + T_EPS;
    let lo = 0, hi = this.corners.length; // first corner > lim
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.corners[mid] > lim) hi = mid; else lo = mid + 1; }
    let next = lo < this.corners.length ? this.corners[lo] : Infinity;
    if (this.rampStep > 0) {
      for (const w of this.wf) {
        if (w.step) continue;
        const i = lastAtMost(w.t, lim);
        if (i < 0 || i >= w.t.length - 1 || w.v[i] === w.v[i + 1]) continue;
        let c = w.t[i] + (Math.floor((lim - w.t[i]) / this.rampStep) + 1) * this.rampStep;
        // rounding can leave the computed grid point at or before lim: take the next one. No loop: a step
        // below the spacing of the doubles at c would never move it (the scenario validation keeps rampStep
        // far above that, this is the last line of defence), so past one addition take the next double up.
        if (!(c > lim)) c += this.rampStep;
        if (!(c > lim)) c = nextDoubleUp(lim);
        if (c < next) next = c;
      }
    }
    return next;
  }

  /**
   * What the scenario asks for at the step boundary at time t. `frame` is the last recorded history frame
   * (its index in the history, its time and diagnostics); the triggers look at each frame once.
   */
  step(t: number, frame: { index: number; t: number; d: Readonly<Record<string, number>> }): ScenarioStep {
    const notes: ScenarioStep['notes'] = [];
    const written: Record<string, number> = {};
    if (frame.index !== this.frame) {
      this.frame = frame.index;
      this.triggers.forEach((tr, i) => this.evaluateTrigger(tr, i, frame, written, notes));
    }
    const patch = this.waveformsAt(t);
    for (const k of Object.keys(written)) patch[k] = written[k];
    return { patch, notes };
  }

  private evaluateTrigger(tr: TriggerSpec, i: number, frame: { t: number; d: Readonly<Record<string, number>> }, written: Record<string, number>, notes: ScenarioStep['notes']): void {
    const x = frame.d[tr.diag];
    const finite = Number.isFinite(x);
    const holds = finite && compare(tr.op, x, tr.value);
    const label = tr.id ?? `${tr.diag} ${tr.op} ${fmt(tr.value)}`;
    if (this.armed[i]) {
      if (!holds) { this.since[i] = -1; return; }
      if (this.since[i] < 0) this.since[i] = frame.t;
      // two independent gates (see the header): the dwell counts from the start of the stretch, `after` is a plain time
      if (frame.t < (tr.after ?? 0) - T_EPS || frame.t - this.since[i] < (tr.hold ?? 0) - T_EPS) return;
      this.armed[i] = 0;
      this.fired[i]++;
      this.write(tr.set, written);
      notes.push({ msg: `Scenario trigger '${label}': ${tr.diag} = ${fmt(x)} ${tr.op} ${fmt(tr.value)} → ${fmtPatch(tr.set)}`, value: x });
    } else if (tr.mode === 'repeat') {
      const h = tr.hysteresis ?? 0;
      const rearm = h > 0 ? finite && (tr.op === '>' || tr.op === '>=' ? x < tr.value - h : x > tr.value + h) : !holds;
      if (!rearm) return;
      this.armed[i] = 1;
      this.since[i] = -1;
      if (tr.release) {
        this.write(tr.release, written);
        notes.push({ msg: `Scenario trigger '${label}' re-armed: ${tr.diag} = ${fmt(x)} → ${fmtPatch(tr.release)}`, value: x });
      }
    }
  }

  private write(patch: Record<string, number>, into: Record<string, number>): void {
    for (const k of Object.keys(patch)) { into[k] = patch[k]; this.manual.add(k); }
  }

  /** A live intervention (Simulation.applyControl) takes over these keys from the waveforms. */
  override(keys: readonly string[]): void {
    for (const k of keys) if (this.driven.has(k)) this.manual.add(k);
  }

  /** The engine state (a copy), for the checkpoint of a frame. */
  save(): ScenarioState {
    return { frame: this.frame, manual: [...this.manual].sort(), armed: [...this.armed], since: [...this.since], fired: [...this.fired] };
  }

  /** Puts back a state taken with save(). */
  restore(s: ScenarioState): void {
    const n = this.triggers.length;
    if (s.armed.length !== n || s.since.length !== n || s.fired.length !== n) { this.reset(); return; }
    this.frame = s.frame;
    this.manual.clear();
    for (const k of s.manual) this.manual.add(k);
    this.armed = [...s.armed]; this.since = [...s.since]; this.fired = [...s.fired];
  }

  /** The state of a run that has not started (a frame without a checkpoint: best effort). */
  reset(): void {
    this.frame = -1;
    this.manual.clear();
    this.armed = this.triggers.map(() => 1);
    this.since = this.triggers.map(() => -1);
    this.fired = this.triggers.map(() => 0);
  }
}
