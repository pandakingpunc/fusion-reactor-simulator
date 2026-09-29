/**
 * A small declarative schema language: one description of a configuration drives both the runtime
 * validation (path-specific errors, all problems at once) and the JSON Schema 2020-12 emitter, so the two
 * cannot drift apart.
 *
 * Only what the reactor configurations need: numbers (range, integer), booleans, string enumerations and
 * objects (required and optional properties, unknown properties rejected, cross-field rules). There are no
 * arrays and no unions here; the discriminated union over `method` lives in schema.ts.
 *
 * Types. A {@link Field}<V> carries the TypeScript type V it describes (invariantly), and {@link Shape}<T>
 * asks for one field per property of T, so a schema written for an interface fails to compile when the
 * interface gains, loses or retypes a property: the schema cannot silently lag behind types.ts.
 *
 * Pure TypeScript: no DOM, no Node APIs.
 */

/** Where a value came from a JSON/JS document, e.g. `heating.P_NBI_MW`; the empty string is the document root. */
export type ConfigPath = string;

export type IssueCode =
  /** the value has the wrong JSON type (or is not a plain object) */
  | 'type'
  /** a required property is missing (or undefined) */
  | 'required'
  /** an object has a property the schema does not know */
  | 'unknown_key'
  /** a number is outside its allowed range */
  | 'range'
  /** a number must be finite (NaN and the infinities are not JSON numbers) */
  | 'non_finite'
  /** a number must be an integer */
  | 'integer'
  /** a string is not one of the allowed values */
  | 'enum'
  /** a relation between several properties is violated */
  | 'cross_field';

/** One problem found in a configuration. */
export interface ValidationIssue {
  /** dotted path of the offending value (`geometry.kappa`); '' is the root */
  path: ConfigPath;
  /** the same location as an RFC 6901 JSON Pointer (`/geometry/kappa`); '' is the root */
  pointer: string;
  code: IssueCode;
  /** what is wrong, without the path (`must be >= 1, got 0.5`) */
  message: string;
  /** a suggestion, e.g. the closest known property name */
  hint?: string;
}

/** `path: message (hint)` on one line. */
export function formatIssue(i: ValidationIssue): string {
  return `${i.path === '' ? '(root)' : i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`;
}

export interface NumberNode {
  kind: 'number';
  integer: boolean;
  min?: number;
  max?: number;
  /** exclusive bounds */
  exMin?: number;
  exMax?: number;
  unit?: string;
  doc?: string;
  /** the value the model uses when the property is absent (documentation for optional properties) */
  def?: number;
}
export interface BooleanNode { kind: 'boolean'; doc?: string; def?: boolean }
export interface EnumNode { kind: 'enum'; values: readonly string[]; doc?: string; def?: string }
export interface ObjectNode {
  kind: 'object';
  props: Readonly<Record<string, Field<any>>>;
  rules: readonly Rule[];
  doc?: string;
}
export type Node = NumberNode | BooleanNode | EnumNode | ObjectNode;

/** A relation between properties of one object that no per-property range can express. */
export interface Rule {
  id: string;
  /** what the rule requires, in words (emitted into the JSON Schema as an annotation) */
  doc: string;
  /**
   * Returns the violations found in `obj`, with paths relative to `obj`. It runs only when every property it
   * reads passed its own checks, so it may assume numbers are finite; it must not throw.
   */
  check(obj: Record<string, unknown>): { path: ConfigPath; message: string }[];
  /** the direct properties of the object that the rule reads */
  reads: readonly string[];
}

/** A property description: what it holds, whether it may be absent. V is the TypeScript type it describes. */
export interface Field<V> {
  readonly node: Node;
  readonly optional: boolean;
  /** phantom: makes Field invariant in V, so `opt()` and the exact union of an enumeration are enforced by tsc */
  readonly __t: (x: V) => V;
}

const field = <V>(node: Node, optional = false): Field<V> => ({ node, optional }) as Field<V>;

export interface NumOpts { min?: number; max?: number; exMin?: number; exMax?: number; unit?: string; doc?: string; def?: number }

/** A finite number within the given bounds. */
export function num(o: NumOpts = {}): Field<number> {
  return field<number>({ kind: 'number', integer: false, ...o });
}
/** A finite integer within the given bounds. */
export function int(o: NumOpts = {}): Field<number> {
  return field<number>({ kind: 'number', integer: true, ...o });
}
export function bool(doc?: string, def?: boolean): Field<boolean> {
  return field<boolean>({ kind: 'boolean', ...(doc !== undefined ? { doc } : {}), ...(def !== undefined ? { def } : {}) });
}
/** One of a fixed list of strings; V is inferred as the union of the listed literals. */
export function oneOf<const V extends string>(values: readonly V[], doc?: string, def?: V): Field<V> {
  return field<V>({ kind: 'enum', values, ...(doc !== undefined ? { doc } : {}), ...(def !== undefined ? { def } : {}) });
}
/** Marks a property as optional (it may be absent or undefined; null is not accepted). */
export function opt<V>(f: Field<V>): Field<V | undefined> {
  return field<V | undefined>(f.node, true);
}

/** One field per property of T, optional properties as `opt(...)`. */
export type Shape<T> = { [K in keyof T]-?: Field<T[K]> };

export interface ObjOpts { doc?: string; rules?: readonly Rule[] }

/** An object with exactly the properties of `shape`. */
export function object<T>(shape: Shape<T>, o: ObjOpts = {}): Field<T> {
  return field<T>({ kind: 'object', props: shape as Readonly<Record<string, Field<any>>>, rules: o.rules ?? [], ...(o.doc !== undefined ? { doc: o.doc } : {}) });
}
/** Like {@link object}, but every property may be absent (a settings block that overrides defaults). */
export function partial<T>(shape: Shape<T>, o: ObjOpts = {}): Field<Partial<T>> {
  const props: Record<string, Field<any>> = {};
  for (const [k, f] of Object.entries(shape as Record<string, Field<any>>)) props[k] = field<any>(f.node, true);
  return field<Partial<T>>({ kind: 'object', props, rules: o.rules ?? [], ...(o.doc !== undefined ? { doc: o.doc } : {}) });
}

// ── validation ─────────────────────────────────────────────────────────────────────────────────────

const join = (path: ConfigPath, key: string): ConfigPath => (path === '' ? key : `${path}.${key}`);
/** The RFC 6901 JSON Pointer of a dotted path. */
export const pointerOf = (path: ConfigPath): string => (path === '' ? '' : '/' + path.split('.').map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/'));

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Names the JSON type of a value for messages: `string "5"`, `null`, `array`, `object`. */
export function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  switch (typeof v) {
    case 'string': return `the string ${JSON.stringify(v.length > 24 ? v.slice(0, 21) + '...' : v)}`;
    case 'number': return String(v);
    case 'boolean': return String(v);
    case 'object': return 'an object';
    case 'undefined': return 'undefined';
    default: return `a ${typeof v}`;
  }
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** The candidate closest to `name` (case-insensitively equal, or an edit distance of at most 2), if any. */
export function closest(name: string, candidates: readonly string[]): string | undefined {
  const lower = name.toLowerCase();
  const ci = candidates.find((c) => c.toLowerCase() === lower);
  if (ci !== undefined) return ci;
  let best: string | undefined, bestD = Math.min(3, Math.max(2, Math.floor(name.length / 3)) + 1);
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

const fmtNum = (x: number): string => String(x);

/** Describes the range of a number node for messages: `>= 1 and <= 3`, `> 0`. */
export function describeRange(n: NumberNode): string {
  const parts: string[] = [];
  if (n.min !== undefined) parts.push(`>= ${fmtNum(n.min)}`);
  if (n.exMin !== undefined) parts.push(`> ${fmtNum(n.exMin)}`);
  if (n.max !== undefined) parts.push(`<= ${fmtNum(n.max)}`);
  if (n.exMax !== undefined) parts.push(`< ${fmtNum(n.exMax)}`);
  return parts.join(' and ');
}

/** Checks one number against its node; returns a violation message or undefined. */
export function checkNumber(n: NumberNode, v: unknown): { code: IssueCode; message: string } | undefined {
  if (typeof v !== 'number') return { code: 'type', message: `must be a number, got ${describeValue(v)}` };
  if (!Number.isFinite(v)) return { code: 'non_finite', message: `must be a finite number, got ${String(v)}` };
  if (n.integer && !Number.isInteger(v)) return { code: 'integer', message: `must be an integer, got ${fmtNum(v)}` };
  const bad = (n.min !== undefined && v < n.min) || (n.exMin !== undefined && v <= n.exMin)
    || (n.max !== undefined && v > n.max) || (n.exMax !== undefined && v >= n.exMax);
  if (bad) return { code: 'range', message: `must be ${describeRange(n)}, got ${fmtNum(v)}` };
  return undefined;
}

/**
 * Validates `value` against `node`, appending every problem to `issues`. Unknown properties are reported
 * unless `unknownKeys` is 'ignore'.
 */
export function validateNode(node: Node, value: unknown, path: ConfigPath, issues: ValidationIssue[], unknownKeys: 'error' | 'ignore' = 'error'): void {
  const add = (p: ConfigPath, code: IssueCode, message: string, hint?: string) =>
    issues.push({ path: p, pointer: pointerOf(p), code, message, ...(hint !== undefined ? { hint } : {}) });
  switch (node.kind) {
    case 'number': {
      const r = checkNumber(node, value);
      if (r) add(path, r.code, r.message);
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') add(path, 'type', `must be true or false, got ${describeValue(value)}`);
      return;
    case 'enum':
      if (typeof value !== 'string') add(path, 'type', `must be a string, got ${describeValue(value)}`);
      else if (!node.values.includes(value)) {
        const c = closest(value, node.values);
        add(path, 'enum', `must be one of ${node.values.map((s) => `'${s}'`).join(', ')}, got '${value}'`, c !== undefined ? `did you mean '${c}'?` : undefined);
      }
      return;
    case 'object': {
      if (!isPlainObject(value)) { add(path, 'type', `must be an object, got ${describeValue(value)}`); return; }
      const known = Object.keys(node.props);
      const bad = new Set<string>();
      for (const key of known) {
        const f = node.props[key];
        const v = value[key];
        if (v === undefined) {
          if (!f.optional) { add(join(path, key), 'required', 'is required'); bad.add(key); }
          continue;
        }
        const n = issues.length;
        validateNode(f.node, v, join(path, key), issues, unknownKeys);
        if (issues.length > n) bad.add(key);
      }
      if (unknownKeys === 'error') {
        for (const key of Object.keys(value)) {
          if (Object.prototype.hasOwnProperty.call(node.props, key) || value[key] === undefined) continue;
          const c = closest(key, known);
          add(join(path, key), 'unknown_key', 'is not a known property', c !== undefined ? `did you mean '${c}'?` : undefined);
        }
      }
      // a cross-field rule runs only when every property it reads is itself valid
      for (const rule of node.rules) {
        if (rule.reads.some((r) => bad.has(r))) continue;
        for (const r of rule.check(value)) add(join(path, r.path), 'cross_field', r.message);
      }
      return;
    }
  }
}

// ── JSON Schema 2020-12 ────────────────────────────────────────────────────────────────────────────

export type JsonSchema = { [k: string]: unknown };

/** Emits the JSON Schema of a node; nested objects are inlined (the caller hoists what it wants into $defs). */
export function nodeToJsonSchema(node: Node): JsonSchema {
  switch (node.kind) {
    case 'number': {
      const s: JsonSchema = { type: node.integer ? 'integer' : 'number' };
      if (node.min !== undefined) s.minimum = node.min;
      if (node.exMin !== undefined) s.exclusiveMinimum = node.exMin;
      if (node.max !== undefined) s.maximum = node.max;
      if (node.exMax !== undefined) s.exclusiveMaximum = node.exMax;
      const d = describeNumber(node);
      if (d) s.description = d;
      if (node.unit !== undefined && node.unit !== '') s['x-unit'] = node.unit;
      if (node.def !== undefined) s.default = node.def;
      return s;
    }
    case 'boolean': {
      const s: JsonSchema = { type: 'boolean' };
      if (node.doc) s.description = node.doc;
      if (node.def !== undefined) s.default = node.def;
      return s;
    }
    case 'enum': {
      const s: JsonSchema = { type: 'string', enum: [...node.values] };
      if (node.doc) s.description = node.doc;
      if (node.def !== undefined) s.default = node.def;
      return s;
    }
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, f] of Object.entries(node.props)) {
        properties[k] = nodeToJsonSchema(f.node);
        if (!f.optional) required.push(k);
      }
      const s: JsonSchema = { type: 'object', properties };
      if (required.length) s.required = required;
      s.additionalProperties = false;
      const doc = [node.doc, ...node.rules.map((r) => `Rule ${r.id}: ${r.doc}`)].filter(Boolean).join(' ');
      if (doc) s.description = doc;
      if (node.rules.length) s['x-rules'] = node.rules.map((r) => ({ id: r.id, description: r.doc, reads: [...r.reads] }));
      return s;
    }
  }
}

function describeNumber(n: NumberNode): string {
  return [n.doc, n.unit ? `Unit: ${n.unit}.` : ''].filter(Boolean).join(' ');
}
