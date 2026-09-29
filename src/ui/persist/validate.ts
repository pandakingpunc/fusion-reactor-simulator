/**
 * Validation of what comes from outside the page: a share link, an imported run file, an archive record.
 *
 * A configuration is checked against what the application itself can produce, not against a hand-written
 * list: the shape (which sections exist, which field is a number, a flag or a name) is read from the stock
 * presets and the wizard's field schema, and the allowed values of a choice field are the wizard's options.
 * So a field the wizard gains later is known here without a second edit.
 *
 * Errors make an input unusable (a wrong type, an unknown method, a missing section, a forbidden key, an
 * input that is too large). Warnings describe what is usable but odd: a field this version does not know
 * (written by a newer one), a value outside the wizard's range, a required number left blank. NaN, ±Infinity
 * and a blank field are numbers of the right type: a half-edited draft configuration shares like any other.
 */
import { ActuatorEntry, EdgeOptions, Method, METHOD_LABELS, ProfileSettings, ReactorConfig, SystemsConfig } from '../../physics/types';
import { DEFAULT_PROFILE_SETTINGS } from '../../physics/profiles/defaults';
import { fieldVisible, getPath, METHOD_DEFAULT, missingRequired, PRESETS, stepsFor } from '../wizard/schema';

/** Limits that keep a hostile or corrupt input from becoming a large object graph. */
export const LIMITS = {
  /** nesting depth of a configuration (the deepest stock one is 2) */
  cfgDepth: 8,
  /** values in a configuration (the largest stock one has about 130) */
  cfgNodes: 2000,
  nameChars: 200,
  stringChars: 200,
  logEntries: 5000,
  patchKeys: 64,
  keyChars: 64,
  breakpoints: 20000,
  /** points of a programme in a configuration (the plasma-current waveform of the 1.5D model) */
  seriesPoints: 10000,
  /** scenario: nesting depth and number of values (it is opaque here; the scenario engine validates its meaning) */
  scenarioDepth: 12,
  scenarioNodes: 20000,
} as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
}

type LeafType = 'number' | 'string' | 'boolean';

interface Template {
  leaves: Map<string, LeafType>;
  /** paths that hold a programme, a list of [x, y] number pairs */
  series: Set<string>;
  /** sections every configuration of the method has (those of the method's default preset) */
  required: string[];
  enums: Map<string, Set<string>>;
  ranges: Map<string, [number, number]>;
}

const templates = new Map<Method, Template>();

/**
 * Sections a configuration may leave out although the method's default preset has them: `profiles` holds the optional 1.5D settings, and
 * since v4.0 the ITER and DEMO presets carry one in 0D too (only the LCFS shape: profiles.lcfsKappa, lcfsDelta, lcfsRef95), so the default
 * tokamak preset has a profiles section that JET, SPARC and every configuration written by an older version do not.
 */
const OPTIONAL_SECTIONS = ['profiles'];

/**
 * The options of the edge model (divertor.edge.*, an optional block that no preset carries and the wizard offers only in part):
 * they are settings of this version, not fields of a newer one. Exhaustive over EdgeOptions, so a new option is a compile error here.
 */
const EDGE_OPTION_TYPES: Record<keyof EdgeOptions, LeafType> = {
  outerShare: 'number', spreadingRatio: 'number', S_mm: 'number', lambdaQ_mm: 'number', divertorLengthFraction: 'number', kappa0e: 'number',
  sheathGamma: 'number', lossFit: 'string', radiation: 'string', seedEnrichment: 'number', detachTt_eV: 'number', targetTilt: 'number',
  strikeRadiusFraction: 'number',
};

/**
 * The options of the systems-lite engineering models (systems.*, an optional block of the magnetic configurations that no preset carries and the
 * wizard does not offer): settings of this version, not fields of a newer one. Exhaustive over SystemsConfig, so a new option is a compile error here.
 */
const SYSTEMS_OPTION_TYPES: { [K in keyof SystemsConfig]-?: NonNullable<SystemsConfig[K]> extends number ? LeafType : { [J in keyof NonNullable<SystemsConfig[K]>]-?: LeafType } } = {
  pulseLength_s: 'number',
  tf: { nCoils: 'number', noseFraction: 'number', structureFraction: 'number', turnCurrent_A: 'number', verticalInboardFraction: 'number' },
  cs: { currentDensity_MAm2: 'number', B_max_T: 'number', swingFraction: 'number', pfFlux_Vs: 'number', li: 'number', ejima: 'number' },
  blanket: { inboardDepth_m: 'number', breederFraction: 'number' },
};

/**
 * The settings of the 1.5D model that DEFAULT_PROFILE_SETTINGS does not carry because they have no default value: the choice of the nonlinear
 * solver (absent: 'auto') and the plasma-current programme (absent: constant I_p). Exhaustive over what the settings offer, so a new choice
 * of the solver is a compile error here.
 */
const NONLINEAR_SOLVER_CHOICES: Record<NonNullable<ProfileSettings['nonlinearSolver']>, true> = { auto: true, picard: true, newton: true, pc: true };
const NEOCLASSICAL_MODEL_CHOICES: Record<NonNullable<ProfileSettings['neoclassicalModel']>, true> = { sauter: true, redl: true };
const PROFILE_SERIES = ['profiles.IpWaveform'];

function walk(v: unknown, path: string, leaves: Map<string, LeafType>, sections?: string[]): void {
  if (v === undefined || v === null) return;
  if (typeof v === 'object' && !Array.isArray(v)) {
    if (path) sections?.push(path);
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, leaves, sections);
  } else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    leaves.set(path, typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'boolean');
  }
}

function templateFor(method: Method): Template {
  let t = templates.get(method);
  if (t) return t;
  const leaves = new Map<string, LeafType>();
  const required: string[] = [];
  for (const p of PRESETS) if (p.cfg.method === method) walk(p.cfg, '', leaves);
  walk(METHOD_DEFAULT[method], '', leaves, required);
  if (method === 'tokamak' || method === 'spherical_tokamak') {
    walk(DEFAULT_PROFILE_SETTINGS, 'profiles', leaves);
    for (const [k, type] of Object.entries(EDGE_OPTION_TYPES)) leaves.set(`divertor.edge.${k}`, type);
  }
  if (method === 'tokamak' || method === 'spherical_tokamak' || method === 'stellarator') {
    for (const [k, v] of Object.entries(SYSTEMS_OPTION_TYPES)) {
      if (typeof v === 'string') leaves.set(`systems.${k}`, v);
      else for (const [j, type] of Object.entries(v)) leaves.set(`systems.${k}.${j}`, type);
    }
  }
  const enums = new Map<string, Set<string>>();
  const series = new Set<string>();
  if (method === 'tokamak' || method === 'spherical_tokamak') {
    leaves.set('profiles.nonlinearSolver', 'string');
    enums.set('profiles.nonlinearSolver', new Set(Object.keys(NONLINEAR_SOLVER_CHOICES)));
    leaves.set('profiles.neoclassicalModel', 'string');
    enums.set('profiles.neoclassicalModel', new Set(Object.keys(NEOCLASSICAL_MODEL_CHOICES)));
    for (const s of PROFILE_SERIES) series.add(s);
  }
  const ranges = new Map<string, [number, number]>();
  for (const step of stepsFor(method)) {
    for (const f of step.fields) {
      const type = f.type ?? 'number';
      leaves.set(f.path, type === 'select' ? 'string' : type === 'bool' ? 'boolean' : 'number');
      if (type === 'select' && f.options) enums.set(f.path, new Set(f.options.map((o) => o.value)));
      if (type === 'number' && f.min !== undefined && f.max !== undefined) ranges.set(f.path, [f.min * (f.scale ?? 1), f.max * (f.scale ?? 1)]);
    }
  }
  t = { leaves, series, required: required.filter((s) => !OPTIONAL_SECTIONS.some((o) => s === o || s.startsWith(`${o}.`))), enums, ranges };
  templates.set(method, t);
  return t;
}

export interface Check { errors: string[]; warnings: string[] }

const MAX_MESSAGES = 12;
const push = (list: string[], msg: string) => { if (list.length < MAX_MESSAGES) list.push(msg); };
const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v}`);

/** Check a configuration: structure and types are errors; unknown fields, out-of-range values and blanks are warnings. */
export function checkConfig(cfg: unknown): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isPlainObject(cfg)) return { errors: ['the configuration is not an object'], warnings };
  const method = cfg.method;
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(METHOD_LABELS, method)) {
    return { errors: [`unknown method ${typeof method === 'string' ? `'${method.slice(0, 40)}'` : kindOf(method)}`], warnings };
  }
  const tpl = templateFor(method as Method);
  let nodes = 0;

  const visit = (v: unknown, path: string, depth: number): void => {
    if (v === undefined || errors.length >= MAX_MESSAGES) return; // undefined is a blank field: it is not written anywhere
    if (++nodes > LIMITS.cfgNodes) { push(errors, 'the configuration has too many values'); return; }
    if (tpl.series.has(path)) {
      if (Array.isArray(v)) visitSeries(v, path);
      else push(errors, `${path}: expected a list of [time, value] pairs, found ${kindOf(v)}`);
      return;
    }
    const known = tpl.leaves.get(path);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (known) { push(errors, `${path}: expected a ${known}, found an object`); return; }
      if (depth > LIMITS.cfgDepth) { push(errors, `${path}: nested too deeply`); return; }
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k)) { push(errors, `${path ? `${path}.` : ''}${k}: forbidden key`); continue; }
        visit(x, path ? `${path}.${k}` : k, depth + 1);
      }
      return;
    }
    if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') {
      push(errors, `${path}: ${kindOf(v)} is not a value a configuration can hold`);
      return;
    }
    if (!known) { push(warnings, `${path}: unknown field (from a newer version?), kept as it is`); return; }
    if (typeof v !== known) { push(errors, `${path}: expected a ${known}, found ${kindOf(v)}`); return; }
    if (typeof v === 'string') {
      if (v.length > LIMITS.stringChars) { push(errors, `${path}: text too long`); return; }
      const opts = tpl.enums.get(path);
      if (opts && !opts.has(v)) push(errors, `${path}: '${v}' is not one of ${[...opts].map((o) => `'${o}'`).join(', ')}`);
    }
  };
  /** A programme: at most LIMITS.seriesPoints points, each a pair of numbers (a number that is not finite, or times that do not increase, is odd, not unusable) */
  const visitSeries = (v: unknown[], path: string): void => {
    if (v.length > LIMITS.seriesPoints) { push(errors, `${path}: more than ${LIMITS.seriesPoints} points`); return; }
    nodes += v.length;
    let prev = -Infinity;
    for (let k = 0; k < v.length; k++) {
      const pt = v[k];
      if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
        push(errors, `${path}[${k}]: expected a [time, value] pair of numbers, found ${kindOf(pt)}`);
        return;
      }
      if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) push(warnings, `${path}[${k}] is not finite (the run will be refused until it is set)`);
      else if (!(pt[0] > prev)) push(warnings, `${path}[${k}]: the times of the points should increase`);
      if (Number.isFinite(pt[0])) prev = pt[0];
    }
  };
  visit(cfg, '', 0);
  if (errors.length) return { errors, warnings };

  for (const s of tpl.required) {
    if (!isPlainObject(getPath(cfg, s))) push(errors, `missing section '${s}'`);
  }
  if (errors.length) return { errors, warnings };

  const c = cfg as unknown as ReactorConfig;
  for (const [path, [lo, hi]] of tpl.ranges) {
    const v = getPath(c, path);
    if (typeof v !== 'number' || !Number.isFinite(v) || !fieldVisible(c.method, path, c)) continue;
    const slack = 1e-9 * Math.max(Math.abs(lo), Math.abs(hi));
    if (v < lo - slack || v > hi + slack) push(warnings, `${path} = ${v} is outside the wizard's range [${lo}, ${hi}]`);
  }
  for (const m of missingRequired(c)) push(warnings, `${m.field.path} is blank or not finite (the run will be refused until it is set)`);
  return { errors, warnings };
}

/** Errors of an actuator log (Simulation.actuatorLog): each entry {t, step, patch} with finite numbers. */
export function checkActuatorLog(log: unknown): string[] {
  if (!Array.isArray(log)) return ['the actuator log is not an array'];
  const errors: string[] = [];
  if (log.length > LIMITS.logEntries) return [`the actuator log has more than ${LIMITS.logEntries} entries`];
  log.forEach((e, i) => {
    if (errors.length >= MAX_MESSAGES) return;
    if (!isPlainObject(e)) { push(errors, `actuatorLog[${i}]: not an object`); return; }
    if (typeof e.t !== 'number' || !Number.isFinite(e.t)) push(errors, `actuatorLog[${i}].t: not a finite number`);
    if (typeof e.step !== 'number' || !Number.isInteger(e.step) || e.step < 0) push(errors, `actuatorLog[${i}].step: not a non-negative integer`);
    if (!isPlainObject(e.patch)) { push(errors, `actuatorLog[${i}].patch: not an object`); return; }
    const keys = Object.keys(e.patch);
    if (keys.length > LIMITS.patchKeys) push(errors, `actuatorLog[${i}].patch: too many keys`);
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k) || k.length > LIMITS.keyChars) push(errors, `actuatorLog[${i}].patch: bad key '${k.slice(0, 20)}'`);
      else if (typeof e.patch[k] !== 'number') push(errors, `actuatorLog[${i}].patch.${k}: not a number`);
    }
  });
  return errors;
}

/** Errors of a breakpoint schedule (SimulationOptions.breakpoints). */
export function checkBreakpoints(b: unknown): string[] {
  if (!Array.isArray(b)) return ['the breakpoints are not an array'];
  if (b.length > LIMITS.breakpoints) return [`more than ${LIMITS.breakpoints} breakpoints`];
  return b.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [] : ['a breakpoint is not a finite number'];
}

/** Errors of a scenario as far as this module can know: plain JSON of bounded size (its meaning is the scenario engine's to check). */
export function checkScenarioShape(s: unknown): string[] {
  let nodes = 0;
  let error: string | null = null;
  const visit = (v: unknown, depth: number): void => {
    if (error) return;
    if (++nodes > LIMITS.scenarioNodes) { error = 'the scenario is too large'; return; }
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) error = 'the scenario holds a number that is not finite'; return; }
    if (typeof v !== 'object') { error = 'the scenario holds a value JSON cannot express'; return; }
    if (depth > LIMITS.scenarioDepth) { error = 'the scenario is nested too deeply'; return; }
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k)) { error = `the scenario has a forbidden key '${k}'`; return; }
      visit(x, depth + 1);
    }
  };
  visit(s, 0);
  return error ? [error] : [];
}

export interface RunInputs {
  cfg: ReactorConfig;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  scenario?: unknown;
}

/**
 * Check the run-defining fields of an object that carries them (a share payload, a run file): the configuration
 * and the optional actuator log, breakpoints and scenario. `holder` may hold other fields; they are not checked.
 */
export function checkRunInputs(holder: Record<string, unknown>): Check {
  const c = checkConfig(holder.cfg);
  const errors = [...c.errors];
  if (holder.actuatorLog !== undefined) errors.push(...checkActuatorLog(holder.actuatorLog));
  if (holder.breakpoints !== undefined) errors.push(...checkBreakpoints(holder.breakpoints));
  if (holder.scenario !== undefined && holder.scenario !== null) errors.push(...checkScenarioShape(holder.scenario));
  return { errors, warnings: c.warnings };
}

export const isFingerprint = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
