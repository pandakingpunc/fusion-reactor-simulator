/**
 * The JSON Schema (draft 2020-12) of a scenario (schema/scenario.schema.json), written from the constants of the scenario
 * engine (src/physics/scenario.ts): the controls it knows with their sanity limits, the version of the JSON form.
 *
 * What a scenario file may contain is defined by validateScenario(); this schema states the same rules for editors and other
 * tools, so a JSON-aware editor can complete and check a scenario file. What a schema cannot say is listed as `x-rules` (the
 * points of a step waveform have distinct times; the names of controls and diagnostics must exist in the model the scenario is
 * attached to; a rampStep is not finer than t_end / 10^4; the waveforms have at most 20000 points together). Lengths of strings
 * are counted in characters (code points) by both. The runtime check of every consumer (worker, the study tools, share and
 * load in the app) is validateScenario, with the model of the run as its context.
 *
 * Generated, not written by hand: `npm run schema:scenario` rewrites the file, `npm run schema:scenario -- --check` compares it.
 */
import { MAX_RAMP_GRID, MIN_RAMP_STEP, SCENARIO_CONTROLS, SCENARIO_SCHEMA, type ControlInfo } from '../physics/scenario';

export const SCENARIO_SCHEMA_ID = 'urn:fusion-reactor-simulator:schema:scenario';

type Json = Record<string, unknown>;

// limits of validateScenario (the same numbers: src/physics/scenario.ts, "validation and the JSON form")
const KEY_PATTERN = '^[A-Za-z_][A-Za-z0-9_]{0,63}$';
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const MAX_KEYS = 64;
const MAX_POINTS = 4096;
const MAX_TOTAL_POINTS = 20000;
const MAX_TRIGGERS = 128;
const MAX_SET_KEYS = 32;

const keyNames = (): Json => ({ pattern: KEY_PATTERN, not: { enum: FORBIDDEN_KEYS } });

/** The numeric sanity limits of a control as schema keywords. */
function limits(c: ControlInfo | undefined): Json {
  return { ...(c?.min !== undefined ? { minimum: c.min } : {}), ...(c?.max !== undefined ? { maximum: c.max } : {}) };
}
const limitKey = (c: ControlInfo): string => `${c.min ?? ''}:${c.max ?? ''}`;

export function scenarioJsonSchema(): Json {
  // one definition per distinct pair of limits of the known controls (all have a minimum of 0 today)
  const ranges = new Map<string, ControlInfo>();
  for (const c of Object.values(SCENARIO_CONTROLS)) if (c.min !== undefined || c.max !== undefined) ranges.set(limitKey(c), c);
  const rangeName = (c: ControlInfo): string => `range_${c.min ?? 'any'}_${c.max ?? 'any'}`;
  const $defs: Record<string, Json> = {
    key: { type: 'string', ...keyNames() },
    time: { type: 'number', minimum: 0, description: 'time from the start of the shot, in the time unit of the model (s for the magnetic-confinement models)' },
  };
  // a waveform and a patch of the controls, once without limits and once per range of the known controls
  const waveformOf = (range: Json): Json => ({
    type: 'object', required: ['kind', 'points'], additionalProperties: false,
    properties: {
      kind: { enum: ['pwl', 'step'], description: "'pwl': piecewise linear between the points, constant after the last; 'step': holds each value from its time on" },
      points: {
        type: 'array', minItems: 1, maxItems: MAX_POINTS,
        items: { type: 'array', minItems: 2, maxItems: 2, prefixItems: [{ $ref: '#/$defs/time' }, { type: ['number', 'null'], ...range }], items: false },
      },
    },
  });
  $defs.waveform = waveformOf({});
  for (const c of ranges.values()) $defs[`waveform_${rangeName(c)}`] = waveformOf(limits(c));
  const known = Object.entries(SCENARIO_CONTROLS);
  const perControl = (make: (c: ControlInfo | undefined, key: string) => Json): Record<string, Json> =>
    Object.fromEntries(known.map(([k, c]) => [k, make(c, k)]));
  const patchOf = (description: string): Json => ({
    type: 'object', description, minProperties: 1, maxProperties: MAX_SET_KEYS, propertyNames: keyNames(),
    properties: perControl((c) => ({ type: 'number', ...limits(c) })), additionalProperties: { type: 'number' },
  });
  $defs.trigger = {
    type: 'object', required: ['diag', 'op', 'value', 'set'], additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\u0000-\\u001f]+$', description: 'label for the event log (default: "<diag> <op> <value>")' },
      diag: { $ref: '#/$defs/key', description: 'key of the frame diagnostics (Q, H_mode, betaN, nG_frac, ...)' },
      op: { enum: ['>', '>=', '<', '<='] },
      value: { type: 'number' },
      hold: { type: 'number', minimum: 0, description: 'dwell time (default 0): the condition must have held on consecutive frames for this long' },
      after: { type: 'number', minimum: 0, description: 'earliest firing time (default 0), independent of hold' },
      set: patchOf('control values written when the trigger fires'),
      mode: { enum: ['once', 'repeat'], description: "'once' (default) or 'repeat'" },
      hysteresis: { type: 'number', minimum: 0, description: "repeat only: how far the diagnostic must cross back over value before the trigger re-arms (default 0)" },
      release: patchOf("repeat only: control values written when the trigger re-arms"),
    },
    if: { not: { required: ['mode'], properties: { mode: { const: 'repeat' } } } },
    then: { not: { required: ['release'] }, properties: { hysteresis: { maximum: 0 } } },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCENARIO_SCHEMA_ID,
    title: 'Fusion Reactor Simulator: scenario',
    description: 'Waveforms of the actuator controls and triggers on the frame diagnostics that drive one shot (`new Simulation(cfg, { scenario })`, `--scenario FILE` of the command line tools, the scenario editor of the app). Generated from src/cli/scenarioSchema.ts (npm run schema:scenario); do not edit.',
    type: 'object',
    required: ['schema'],
    additionalProperties: false,
    properties: {
      schema: { const: SCENARIO_SCHEMA, description: 'version of the JSON form' },
      name: { type: 'string', maxLength: 120, description: 'free label (not part of the fingerprint of a run)' },
      rampStep: { type: 'number', minimum: MIN_RAMP_STEP, description: `upper bound of the time between step boundaries on a ramping segment of a pwl waveform (default: none); at least ${MIN_RAMP_STEP}, and at least t_end / ${MAX_RAMP_GRID} for the shot it is used with` },
      waveforms: {
        type: 'object', maxProperties: MAX_KEYS, propertyNames: keyNames(),
        description: 'waveform of a control, by the key of the control (the keys the model exposes; the known ones are listed here with their limits)',
        properties: perControl((c) => ({ $ref: `#/$defs/${c && (c.min !== undefined || c.max !== undefined) ? `waveform_${rangeName(c)}` : 'waveform'}`, title: c?.label, ...(c?.unit ? { 'x-unit': c.unit } : {}) })),
        additionalProperties: { $ref: '#/$defs/waveform' },
      },
      triggers: { type: 'array', maxItems: MAX_TRIGGERS, items: { $ref: '#/$defs/trigger' } },
    },
    'x-rules': [
      { id: 'step-distinct-times', description: 'the points of a step waveform have distinct times (points are sorted by time by the loader)' },
      { id: 'known-keys', description: 'a waveform, a patch and a trigger name only controls and diagnostics that the model of the run exposes' },
      { id: 'ramp-grid', description: `rampStep is at least t_end / ${MAX_RAMP_GRID} of the shot it is used with` },
      { id: 'total-points', description: `the waveforms have at most ${MAX_TOTAL_POINTS} points together (each at most ${MAX_POINTS})` },
    ],
    $defs,
  };
}
