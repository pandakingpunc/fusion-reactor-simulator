/// <reference types="node" />
/**
 * The JSON Schema of a scenario agrees with the runtime validator (validateScenario): documents that the validator accepts pass
 * the schema, documents it rejects for a reason that JSON Schema can state fail it, and the checked-in schema/scenario.schema.json
 * is what the emitter writes. No schema-validation dependency exists: a small evaluator of the subset the emitter uses is written here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENARIO_CONTROLS, dropTemplate, gasPuffTemplate, interlockTemplate, mergeScenarios, rampTemplate, validateScenario, type ControlInfo } from '../physics/scenario';
import { SCENARIO_SCHEMA_ID, scenarioJsonSchema } from './scenarioSchema';

type Any = Record<string, any>;

function evaluate(schema: Any, root: Any, value: unknown, at = ''): string[] {
  const out: string[] = [];
  const s = schema;
  if (s.$ref !== undefined) {
    const target = String(s.$ref).replace(/^#\//, '').split('/').reduce<any>((o, k) => o?.[k], root);
    if (!target) return [`${at}: unresolved $ref ${String(s.$ref)}`];
    out.push(...evaluate(target, root, value, at));
  }
  if (s.if) {
    const cond = evaluate(s.if, root, value, at).length === 0;
    if (cond && s.then) out.push(...evaluate(s.then, root, value, at));
    if (!cond && s.else) out.push(...evaluate(s.else, root, value, at));
  }
  if (s.not && evaluate(s.not, root, value, at).length === 0) out.push(`${at}: matches a forbidden schema`);
  const isObj = typeof value === 'object' && value !== null && !Array.isArray(value);
  const typeOk = (t: string): boolean => (t === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : t === 'string' ? typeof value === 'string' : t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? isObj : false);
  if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some(typeOk)) return [...out, `${at}: not of type ${JSON.stringify(s.type)}`];
  if (s.const !== undefined && s.const !== value) out.push(`${at}: not the constant`);
  if (s.enum && !s.enum.includes(value)) out.push(`${at}: not in enum`);
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) out.push(`${at}: below minimum`);
    if (s.maximum !== undefined && value > s.maximum) out.push(`${at}: above maximum`);
  }
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) out.push(`${at}: too short`);
    if (s.maxLength !== undefined && value.length > s.maxLength) out.push(`${at}: too long`);
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(value)) out.push(`${at}: does not match the pattern`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) out.push(`${at}: too few items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) out.push(`${at}: too many items`);
    const prefix: Any[] = s.prefixItems ?? [];
    value.forEach((x, k) => {
      if (k < prefix.length) out.push(...evaluate(prefix[k], root, x, `${at}[${k}]`));
      else if (s.items === false) out.push(`${at}[${k}]: additional item`);
      else if (s.items) out.push(...evaluate(s.items, root, x, `${at}[${k}]`));
    });
  }
  if (isObj) {
    const v = value as Any;
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    for (const k of s.required ?? []) if (v[k] === undefined) out.push(`${at}.${k}: required`);
    if (s.minProperties !== undefined && keys.length < s.minProperties) out.push(`${at}: too few properties`);
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) out.push(`${at}: too many properties`);
    if (s.propertyNames) for (const k of keys) out.push(...evaluate(s.propertyNames, root, k, `${at}{${k}}`));
    for (const k of keys) {
      const sub = (s.properties ?? {})[k];
      if (sub) out.push(...evaluate(sub, root, v[k], `${at}.${k}`));
      else if (s.additionalProperties === false) out.push(`${at}.${k}: additional property`);
      else if (s.additionalProperties) out.push(...evaluate(s.additionalProperties, root, v[k], `${at}.${k}`));
    }
  }
  return out;
}

const schema = scenarioJsonSchema();
const passes = (doc: unknown): boolean => evaluate(schema, schema, JSON.parse(JSON.stringify(doc))).length === 0;
const valid = (doc: unknown): boolean => validateScenario(JSON.parse(JSON.stringify(doc))).ok;

describe('JSON Schema of a scenario', () => {
  it('is a draft 2020-12 document with an id, every $ref resolves, no e-mail address or URL but the meta-schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(SCENARIO_SCHEMA_ID);
    const refs: string[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') { const o = n as Any; if (typeof o.$ref === 'string') refs.push(o.$ref); Object.values(o).forEach(walk); }
    };
    walk(schema);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of refs) expect(r.replace(/^#\//, '').split('/').reduce<any>((o, k) => o?.[k], schema), r).toBeDefined();
    expect(JSON.stringify(schema)).not.toMatch(/@|https?:\/\/(?!json-schema\.org)/);
  });

  it('lists every control of SCENARIO_CONTROLS with its label, unit and limits', () => {
    const w = (schema.properties as Any).waveforms.properties as Any;
    expect(Object.keys(w).sort()).toEqual(Object.keys(SCENARIO_CONTROLS).sort());
    expect(w.P_NBI_MW.title).toBe(SCENARIO_CONTROLS.P_NBI_MW.label);
    expect(w.n_target_1e20['x-unit']).toBe('1e20 m⁻³');
  });

  it('accepts what the validator accepts: the templates, their merge, an empty scenario, unknown controls, null points, a repeating trigger', () => {
    const merged = mergeScenarios(dropTemplate('P_NBI_MW', 0.5, 0), rampTemplate('H98', 1, 2, 1.2), gasPuffTemplate(1, 0.2, 3, 0.1), interlockTemplate('H_mode', '<', 1, { P_ICRH_MW: 0 }, { id: 'back in L-mode', hold: 0.1 }));
    const docs: unknown[] = [
      { schema: 1 },
      { schema: 1, name: 'x', rampStep: 0.01 },
      merged,
      dropTemplate('P_NBI_MW', 0.5, 0),
      { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, null], [1, 5]] }, my_control: { kind: 'step', points: [[0, -3], [1, 5]] } } },
      { schema: 1, triggers: [{ diag: 'Q', op: '>=', value: 5, set: { P_NBI_MW: 0 }, mode: 'repeat', hysteresis: 0.5, release: { P_NBI_MW: 30 }, hold: 1, after: 2 }] },
      { schema: 1, triggers: [{ diag: 'Q', op: '<', value: 5, set: { P_NBI_MW: 0 }, mode: 'once', hysteresis: 0 }] },
    ];
    for (const d of docs) { expect(valid(d)).toBe(true); expect(evaluate(schema, schema, JSON.parse(JSON.stringify(d)))).toEqual([]); }
  });

  it('rejects what the validator rejects and a schema can state (structure, types, ranges, limits of the known controls, unknown properties)', () => {
    const pwl = (key: string, ...pts: unknown[]) => ({ schema: 1, waveforms: { [key]: { kind: 'pwl', points: pts } } });
    const trig = (t: Any) => ({ schema: 1, triggers: [{ diag: 'Q', op: '>', value: 1, set: { P_NBI_MW: 0 }, ...t }] });
    const cases: [string, unknown][] = [
      ['not an object', 5],
      ['no schema', {}],
      ['other schema version', { schema: 2 }],
      ['unknown property', { schema: 1, oops: 1 }],
      ['name too long', { schema: 1, name: 'x'.repeat(121) }],
      ['name not a string', { schema: 1, name: 5 }],
      ['rampStep zero', { schema: 1, rampStep: 0 }],
      ['rampStep below the floor', { schema: 1, rampStep: 1e-9 }],
      ['rampStep not a number', { schema: 1, rampStep: '1' }],
      ['waveforms an array', { schema: 1, waveforms: [] }],
      ['bad control key', pwl('1bad', [0, 1])],
      ['forbidden control key', { schema: 1, waveforms: JSON.parse('{"__proto__": {"kind":"step","points":[[0,1]]}}') }],
      ['waveform without points', { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [] } } }],
      ['waveform kind', { schema: 1, waveforms: { P_NBI_MW: { kind: 'cubic', points: [[0, 1]] } } }],
      ['waveform extra property', { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, 1]], x: 1 } } }],
      ['point of three', pwl('P_NBI_MW', [0, 1, 2])],
      ['point not an array', pwl('P_NBI_MW', 5)],
      ['negative time', pwl('P_NBI_MW', [-1, 1])],
      ['string value', pwl('P_NBI_MW', [0, '1'])],
      ['value below the limit of the control', pwl('P_NBI_MW', [0, -1])],
      ['value below the limit of another control', pwl('H98', [0, -0.1])],
      ['trigger without set', { schema: 1, triggers: [{ diag: 'Q', op: '>', value: 1 }] }],
      ['trigger with an empty set', trig({ set: {} })],
      ['trigger set below the limit', trig({ set: { P_NBI_MW: -2 } })],
      ['trigger set not a number', trig({ set: { P_NBI_MW: null } })],
      ['bad operator', trig({ op: '==' })],
      ['bad diag key', trig({ diag: 'a b' })],
      ['bad value', trig({ value: 'x' })],
      ['negative hold', trig({ hold: -1 })],
      ['negative after', trig({ after: -1 })],
      ['bad mode', trig({ mode: 'always' })],
      ['bad id', trig({ id: '' })],
      ['control character in id', trig({ id: 'a\u0001b' })],
      ['trigger extra property', trig({ oops: 1 })],
      ['hysteresis without repeat', trig({ hysteresis: 0.5 })],
      ['release without repeat', trig({ release: { P_NBI_MW: 1 } })],
      ['release with once', trig({ mode: 'once', release: { P_NBI_MW: 1 } })],
      ['triggers not an array', { schema: 1, triggers: {} }],
    ];
    for (const [name, d] of cases) {
      expect(valid(d), `validator: ${name}`).toBe(false);
      expect(passes(d), `schema: ${name}`).toBe(false);
    }
  });

  it('the limits of size are the validator\'s: 4096 points a waveform, 128 triggers, 32 controls in a patch, 64 waveforms', () => {
    const points = (n: number) => Array.from({ length: n }, (_, i) => [i, 1]);
    expect(passes({ schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: points(4096) } } })).toBe(true);
    expect(passes({ schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: points(4097) } } })).toBe(false);
    expect(valid({ schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: points(4097) } } })).toBe(false);
    const tr = { diag: 'Q', op: '>', value: 1, set: { P_NBI_MW: 0 } };
    expect(passes({ schema: 1, triggers: Array.from({ length: 128 }, () => tr) })).toBe(true);
    expect(passes({ schema: 1, triggers: Array.from({ length: 129 }, () => tr) })).toBe(false);
    expect(valid({ schema: 1, triggers: Array.from({ length: 129 }, () => tr) })).toBe(false);
    const patch = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
    expect(passes({ schema: 1, triggers: [{ ...tr, set: patch(32) }] })).toBe(true);
    expect(passes({ schema: 1, triggers: [{ ...tr, set: patch(33) }] })).toBe(false);
    expect(valid({ schema: 1, triggers: [{ ...tr, set: patch(33) }] })).toBe(false);
    const ws = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { kind: 'step', points: [[0, 1]] }]));
    expect(passes({ schema: 1, waveforms: ws(64) })).toBe(true);
    expect(passes({ schema: 1, waveforms: ws(65) })).toBe(false);
    expect(valid({ schema: 1, waveforms: ws(65) })).toBe(false);
  });

  it('what a schema cannot state is annotated, not silently accepted: x-rules', () => {
    expect((schema['x-rules'] as Any[]).map((r) => r.id)).toEqual(['step-distinct-times', 'known-keys', 'ramp-grid']);
    // a step waveform with a repeated time is invalid for the validator, and valid for the schema (the rule is an annotation)
    const twice = { schema: 1, waveforms: { P_NBI_MW: { kind: 'step', points: [[1, 1], [1, 2]] } } };
    expect(valid(twice)).toBe(false);
    expect(passes(twice)).toBe(true);
  });

  it('a control with a maximum only, with both limits or with none gets the matching range definition, in step with the validator', () => {
    // SCENARIO_CONTROLS says "add the shape keys here when a model exposes them", and every entry has a minimum of 0 today, so the
    // emitter's handling of a missing minimum, of a maximum and of no limit at all is exercised by registering such controls for
    // the length of this test (the object is read by the emitter and by validateScenario alike, so the two stay comparable)
    const controls = SCENARIO_CONTROLS as Record<string, ControlInfo>;
    const added: Record<string, ControlInfo> = {
      zz_cap: { label: 'capped', unit: 'K', max: 10 },
      zz_band: { label: 'banded', unit: '', min: -5, max: 5 },
      zz_free: { label: 'unlimited', unit: '' },
    };
    Object.assign(controls, added);
    try {
      const s = scenarioJsonSchema() as Any;
      const defs = s.$defs as Any;
      const waveforms = s.properties.waveforms.properties as Any;
      const patch = defs.trigger.properties.set.properties as Any;
      const pointValue = (def: string) => defs[def].properties.points.items.prefixItems[1];

      // the maximum alone: no minimum keyword, and the missing side of the range is named 'any'
      expect(pointValue('waveform_range_any_10')).toEqual({ type: ['number', 'null'], maximum: 10 });
      expect(waveforms.zz_cap).toEqual({ $ref: '#/$defs/waveform_range_any_10', title: 'capped', 'x-unit': 'K' });
      expect(patch.zz_cap).toEqual({ type: 'number', maximum: 10 });
      // both limits
      expect(pointValue('waveform_range_-5_5')).toEqual({ type: ['number', 'null'], minimum: -5, maximum: 5 });
      expect(waveforms.zz_band).toEqual({ $ref: '#/$defs/waveform_range_-5_5', title: 'banded' });
      expect(patch.zz_band).toEqual({ type: 'number', minimum: -5, maximum: 5 });
      // no limit at all: the plain waveform definition, no range definition of its own, no keyword on the patch value, no unit
      expect(Object.keys(defs).filter((k) => k.startsWith('waveform_range_')).sort()).toEqual(['waveform_range_-5_5', 'waveform_range_0_any', 'waveform_range_any_10']);
      expect(waveforms.zz_free).toEqual({ $ref: '#/$defs/waveform', title: 'unlimited' });
      expect(patch.zz_free).toEqual({ type: 'number' });

      // the schema and the validator draw the same line for each of them (waveform points and the patch of a trigger)
      const wf = (key: string, v: number) => ({ schema: 1, waveforms: { [key]: { kind: 'step', points: [[0, v]] } } });
      const set = (key: string, v: number) => ({ schema: 1, triggers: [{ diag: 'Q', op: '>', value: 1, set: { [key]: v } }] });
      const cases: [string, unknown, boolean][] = [
        ['cap at its maximum', wf('zz_cap', 10), true], ['cap above its maximum', wf('zz_cap', 10.5), false], ['cap far below zero (no minimum)', wf('zz_cap', -1e6), true],
        ['band at both ends', wf('zz_band', 5), true], ['band at the lower end', wf('zz_band', -5), true],
        ['band above', wf('zz_band', 5.5), false], ['band below', wf('zz_band', -5.5), false],
        ['free, very large', wf('zz_free', 1e9), true], ['free, very negative', wf('zz_free', -1e9), true],
        ['patch of the cap above its maximum', set('zz_cap', 11), false], ['patch of the cap inside', set('zz_cap', 3), true],
        ['patch of the band below', set('zz_band', -6), false], ['patch of the free control', set('zz_free', -7), true],
      ];
      for (const [name, doc, ok] of cases) {
        expect(validateScenario(JSON.parse(JSON.stringify(doc))).ok, `validator: ${name}`).toBe(ok);
        expect(evaluate(s, s, JSON.parse(JSON.stringify(doc))).length === 0, `schema: ${name}`).toBe(ok);
      }
    } finally {
      for (const k of Object.keys(added)) delete controls[k];
    }
    // nothing leaked: the emitter is back at the checked-in set of controls
    expect(Object.keys(SCENARIO_CONTROLS).some((k) => k.startsWith('zz_'))).toBe(false);
    expect(scenarioJsonSchema()).toEqual(schema);
  });

  it('the checked-in file schema/scenario.schema.json is what the emitter writes (npm run schema:scenario)', () => {
    const file = readFileSync(new URL('../../schema/scenario.schema.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(file).toBe(JSON.stringify(scenarioJsonSchema(), null, 2) + '\n');
  });
});
