/**
 * The schema language on its own: number checks and messages, objects with required and optional properties,
 * cross-field rules, the JSON Schema of each node kind, and (compile-time) the guarantee that a schema cannot
 * lag behind the interface it describes: the @ts-expect-error lines below fail `tsc` if a wrong schema starts
 * to compile.
 */
import { describe, expect, it } from 'vitest';
import {
  bool, checkNumber, closest, describeRange, describeValue, formatIssue, int, nodeToJsonSchema, num, object, oneOf, opt, partial, pointerOf, series,
  validateNode, type Field, type NumberNode, type Rule, type Shape, type ValidationIssue,
} from './dsl';

const issuesOf = (f: Field<any>, v: unknown, unknownKeys: 'error' | 'ignore' = 'error'): ValidationIssue[] => {
  const out: ValidationIssue[] = [];
  validateNode(f.node, v, '', out, unknownKeys);
  return out;
};
const numNode = (f: Field<number>): NumberNode => f.node as NumberNode;

describe('numbers', () => {
  it('range checks name the bound and the value; an exclusive bound is described as such', () => {
    const n = numNode(num({ min: 1, max: 3 }));
    expect(checkNumber(n, 2)).toBeUndefined();
    expect(checkNumber(n, 1)).toBeUndefined();
    expect(checkNumber(n, 3)).toBeUndefined();
    expect(checkNumber(n, 0.5)).toEqual({ code: 'range', message: 'must be >= 1 and <= 3, got 0.5' });
    expect(checkNumber(n, 3.5)).toEqual({ code: 'range', message: 'must be >= 1 and <= 3, got 3.5' });
    const ex = numNode(num({ exMin: 0, exMax: 1 }));
    expect(checkNumber(ex, 0)).toEqual({ code: 'range', message: 'must be > 0 and < 1, got 0' });
    expect(checkNumber(ex, 1)).toEqual({ code: 'range', message: 'must be > 0 and < 1, got 1' });
    expect(checkNumber(ex, 0.5)).toBeUndefined();
    expect(describeRange(numNode(num()))).toBe('');
  });
  it('type, finiteness and integrality come before range', () => {
    const n = numNode(int({ min: 0 }));
    expect(checkNumber(n, '3')).toEqual({ code: 'type', message: 'must be a number, got the string "3"' });
    expect(checkNumber(n, NaN)).toEqual({ code: 'non_finite', message: 'must be a finite number, got NaN' });
    expect(checkNumber(n, -Infinity)).toEqual({ code: 'non_finite', message: 'must be a finite number, got -Infinity' });
    expect(checkNumber(n, 1.5)).toEqual({ code: 'integer', message: 'must be an integer, got 1.5' });
    expect(checkNumber(n, -2)).toEqual({ code: 'range', message: 'must be >= 0, got -2' });
    expect(checkNumber(n, 7)).toBeUndefined();
  });
  it('describeValue names every JSON type', () => {
    expect(describeValue(null)).toBe('null');
    expect(describeValue([])).toBe('an array');
    expect(describeValue({})).toBe('an object');
    expect(describeValue('x')).toBe('the string "x"');
    expect(describeValue(1.5)).toBe('1.5');
    expect(describeValue(false)).toBe('false');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue(() => 1)).toBe('a function');
    expect(describeValue(Symbol('s'))).toBe('a symbol');
  });
});

describe('objects', () => {
  const shape = object<{ a: number; b?: 'x' | 'y'; c: { d: boolean } }>({
    a: num({ min: 0 }), b: opt(oneOf(['x', 'y'])), c: object<{ d: boolean }>({ d: bool() }),
  });
  it('a valid value has no issues; undefined optional properties count as absent', () => {
    expect(issuesOf(shape, { a: 1, c: { d: true } })).toEqual([]);
    expect(issuesOf(shape, { a: 1, b: undefined, c: { d: false } })).toEqual([]);
  });
  it('reports required, type, enum, range and unknown properties with dotted paths and pointers', () => {
    const iss = issuesOf(shape, { b: 'z', c: { d: 1 }, extra: 1 });
    expect(iss.map((i) => `${i.path}|${i.pointer}|${i.code}`)).toEqual(['a|/a|required', 'b|/b|enum', 'c.d|/c/d|type', 'extra|/extra|unknown_key']);
    expect(formatIssue(iss[1])).toBe("b: must be one of 'x', 'y', got 'z' (did you mean 'x'?)");
    expect(issuesOf(shape, { a: 1, b: 5, c: { d: true } })[0].message).toBe('must be a string, got 5');
  });
  it('unknownKeys: ignore skips unknown properties, also in nested objects', () => {
    expect(issuesOf(shape, { a: 1, c: { d: true, z: 1 }, extra: 1 }, 'ignore')).toEqual([]);
    expect(issuesOf(shape, { a: 1, c: { d: true, z: 1 } }).map((i) => i.path)).toEqual(['c.z']);
  });
  it('a suggestion for a misspelt property', () => {
    const iss = issuesOf(shape, { a: 1, c: { d: true }, B: 'x' });
    expect(iss[0]).toMatchObject({ path: 'B', code: 'unknown_key', hint: "did you mean 'b'?" });
    expect(formatIssue(iss[0])).toBe("B: is not a known property (did you mean 'b'?)");
  });
  it('the root is a path of its own', () => {
    expect(issuesOf(shape, 5)).toEqual([{ path: '', pointer: '', code: 'type', message: 'must be an object, got 5' }]);
    expect(pointerOf('a.b~c/d')).toBe('/a/b~0c~1d');
    expect(pointerOf('')).toBe('');
  });
  it('the pointer keeps a property name that contains a "." as one token (the dotted path cannot)', () => {
    const iss = issuesOf(shape, { a: 1, c: { d: true, 'x.y': 1, 'p/q~r': 2 }, 'P.NBI': 5 });
    expect(iss.map((i) => [i.path, i.pointer])).toEqual([['c.x.y', '/c/x.y'], ['c.p/q~r', '/c/p~1q~0r'], ['P.NBI', '/P.NBI']]);
  });
  it('partial makes every property optional', () => {
    const p = partial<{ a: number; b: number }>({ a: num(), b: int() });
    expect(issuesOf(p, {})).toEqual([]);
    expect(issuesOf(p, { b: 1.5 }).map((i) => i.code)).toEqual(['integer']);
    expect(nodeToJsonSchema(p.node)).not.toHaveProperty('required');
  });
  it('a cross-field rule runs when the properties it reads are valid, and is skipped when one is not', () => {
    const rule: Rule = { id: 'lo-below-hi', doc: 'lo < hi', reads: ['lo', 'hi'], check: (o) => ((o.lo as number) >= (o.hi as number) ? [{ path: 'lo', message: 'must be below hi' }] : []) };
    const r = object<{ lo: number; hi: number }>({ lo: num(), hi: num() }, { rules: [rule] });
    expect(issuesOf(r, { lo: 1, hi: 2 })).toEqual([]);
    expect(issuesOf(r, { lo: 3, hi: 2 }).map((i) => [i.path, i.code])).toEqual([['lo', 'cross_field']]);
    expect(issuesOf(r, { lo: 'x', hi: 2 }).map((i) => i.code)).toEqual(['type']);
    expect(issuesOf(r, { hi: 2 }).map((i) => i.code)).toEqual(['required']);
  });
});

describe('closest', () => {
  it('prefers a case-insensitive match', () => {
    expect(closest('Alpha', ['alpha', 'alphb'])).toBe('alpha');
  });
});

describe('JSON Schema of each node', () => {
  it('numbers: bounds, exclusive bounds, integer, unit, default, description', () => {
    expect(nodeToJsonSchema(num({ min: 0, exMax: 1, unit: 'm', doc: 'A length.', def: 0.5 }).node)).toEqual({
      type: 'number', minimum: 0, exclusiveMaximum: 1, description: 'A length. Unit: m.', 'x-unit': 'm', default: 0.5,
    });
    expect(nodeToJsonSchema(int({ exMin: 0, max: 9 }).node)).toEqual({ type: 'integer', exclusiveMinimum: 0, maximum: 9 });
  });
  it('booleans and enumerations', () => {
    expect(nodeToJsonSchema(bool('A flag.', true).node)).toEqual({ type: 'boolean', description: 'A flag.', default: true });
    expect(nodeToJsonSchema(bool().node)).toEqual({ type: 'boolean' });
    expect(nodeToJsonSchema(oneOf(['a', 'b'], 'Pick.', 'a').node)).toEqual({ type: 'string', enum: ['a', 'b'], description: 'Pick.', default: 'a' });
    expect(nodeToJsonSchema(oneOf(['a']).node)).toEqual({ type: 'string', enum: ['a'] });
  });
  it('objects: properties, required only for the required ones, no additional properties, rules as annotations', () => {
    const rule: Rule = { id: 'r1', doc: 'a is below b', reads: ['a', 'b'], check: () => [] };
    const s = nodeToJsonSchema(object<{ a: number; b?: number }>({ a: num(), b: opt(num()) }, { doc: 'Two numbers.', rules: [rule] }).node);
    expect(s).toEqual({
      type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a'], additionalProperties: false,
      description: 'Two numbers. Rule r1: a is below b', 'x-rules': [{ id: 'r1', description: 'a is below b', reads: ['a', 'b'] }],
    });
    expect(nodeToJsonSchema(object<{ a?: number }>({ a: opt(num()) }).node)).toEqual({ type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false });
  });
});

describe('series of [x, y] points', () => {
  const ramp = series({ x: { min: 0, unit: 's' }, y: { exMin: 0, max: 100, unit: 'MA' }, minItems: 1, maxItems: 4, doc: 'A current programme.' });
  it('accepts points with x increasing and both numbers in their bounds', () => {
    expect(issuesOf(ramp, [[0, 1]])).toEqual([]);
    expect(issuesOf(ramp, [[0, 1], [2.5, 15], [40, 15.5], [41, 0.1]])).toEqual([]);
  });
  it('names the point and the number that is wrong (paths are dotted with the indices, which are JSON Pointer tokens too)', () => {
    const at = (v: unknown) => issuesOf(ramp, v).map((i) => [i.path, i.pointer, i.code]);
    expect(at('ramp')).toEqual([['', '', 'type']]);
    expect(at([[0, 1], [1]])).toEqual([['1', '/1', 'type']]);
    expect(at([[0, 1, 2]])).toEqual([['0', '/0', 'type']]);
    expect(at([[0, '1']])).toEqual([['0.1', '/0/1', 'type']]);
    expect(at([[-1, 1]])).toEqual([['0.0', '/0/0', 'range']]);
    expect(at([[0, 0]])).toEqual([['0.1', '/0/1', 'range']]);
    expect(at([[0, 1], [NaN, 2]])).toEqual([['1.0', '/1/0', 'non_finite']]);
    expect(at([[0, 1], [0, 2]])).toEqual([['1.0', '/1/0', 'cross_field']]);
    expect(at([[5, 1], [4, 2], [6, 3]])).toEqual([['1.0', '/1/0', 'cross_field']]);
    expect(at([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]])).toEqual([['', '', 'range']]);
    expect(at([])).toEqual([['', '', 'range']]);
    expect(at([[0, 1], [1, 200], [2, 1]])).toEqual([['1.1', '/1/1', 'range']]);
  });
  it('reports every wrong point, not just the first, and the message says what is expected', () => {
    const r = issuesOf(ramp, [[0, 1], [-1, -1], [3]]);
    expect(r.map((i) => i.path)).toEqual(['1.0', '1.1', '2']);
    expect(r[0].message).toBe('must be >= 0, got -1');
    expect(r[1].message).toBe('must be > 0 and <= 100, got -1');
    expect(r[2].message).toBe('must be a [s, MA] pair, got an array');
    expect(issuesOf(ramp, 4)[0].message).toBe('must be an array of [s, MA] points, got 4');
    expect(issuesOf(ramp, [])[0].message).toBe('must have between 1 and 4 points, got 0');
  });
  it('is an optional property of an object like any other, with the path of the point in the issue', () => {
    const obj = partial<{ prog: ReadonlyArray<readonly [number, number]> }>({ prog: ramp });
    const out: ValidationIssue[] = [];
    validateNode(obj.node, { prog: [[0, 1], [0, 1]] }, 'profiles', out);
    expect(out.map((i) => `${i.path}:${i.code}`)).toEqual(['profiles.prog.1.0:cross_field']);
    expect(issuesOf(obj, {})).toEqual([]);
  });
  it('emits a JSON Schema array of number pairs; the increase of x is stated in the description (a schema cannot express it)', () => {
    const s = nodeToJsonSchema(ramp.node) as Record<string, any>;
    expect(s.type).toBe('array');
    expect(s.minItems).toBe(1);
    expect(s.maxItems).toBe(4);
    expect(s.items).toMatchObject({ type: 'array', minItems: 2, maxItems: 2, items: false });
    expect(s.items.prefixItems).toEqual([
      { type: 'number', minimum: 0, description: 'Unit: s.', 'x-unit': 's' },
      { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Unit: MA.', 'x-unit': 'MA' },
    ]);
    expect(s.description).toMatch(/A current programme\. Points \[s, MA\], the first number strictly increasing\./);
  });
  it('the type of a series is the array of pairs of ProfileSettings.IpWaveform (compile-time: it fits no other type)', () => {
    const f: Field<ReadonlyArray<readonly [number, number]>> = ramp;
    // @ts-expect-error a series does not describe a plain number
    const wrong: Field<number> = ramp;
    void [f, wrong];
    expect(true).toBe(true);
  });
});

describe('a schema cannot lag behind the interface it describes (compile-time)', () => {
  it('rejects a missing property, a wrong optionality and an incomplete enumeration', () => {
    interface T { x: number; y?: 'p' | 'q'; f: 'a' | 'b' }
    // the correct schema compiles
    const ok: Shape<T> = { x: num(), y: opt(oneOf(['p', 'q'])), f: oneOf(['a', 'b']) };
    void ok;
    // @ts-expect-error a schema without the property `f` does not compile
    const missing: Shape<T> = { x: num(), y: opt(oneOf(['p', 'q'])) };
    // @ts-expect-error an optional property must be wrapped in opt()
    const notOptional: Shape<{ x?: number }> = { x: num() };
    // @ts-expect-error a required property must not be wrapped in opt()
    const wronglyOptional: Shape<{ x: number }> = { x: opt(num()) };
    // @ts-expect-error the enumeration must list exactly the members of the union
    const shortEnum: Shape<{ f: 'a' | 'b' }> = { f: oneOf(['a']) };
    // @ts-expect-error a number field cannot describe a string property
    const wrongKind: Shape<{ s: string }> = { s: num() };
    // @ts-expect-error a property that the interface does not have does not compile either
    const extra: Shape<{ x: number }> = { x: num(), z: num() };
    void [missing, notOptional, wronglyOptional, shortEnum, wrongKind, extra];
    expect(true).toBe(true);
  });
});
