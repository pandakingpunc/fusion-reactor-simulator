/**
 * Dotted-path access to configurations and the settings syntax of the command line (`heating.P_NBI_MW=20`).
 *
 * Pure TypeScript; nothing here validates a value (validateConfig does that after the edits are made).
 * A path segment that would reach into the prototype chain (`__proto__`, `constructor`, `prototype`) is
 * refused, so a setting taken from an untrusted file cannot pollute anything.
 */
import type { ReactorConfig } from '../types';

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** A dotted path or a setting was malformed (an empty segment, a forbidden name, no `=`). */
export class ConfigPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigPathError';
  }
}

/** The segments of a dotted path; throws {@link ConfigPathError} for an empty path, an empty segment or a forbidden name. */
export function splitPath(path: string): string[] {
  const keys = path.split('.');
  for (const k of keys) {
    if (k === '') throw new ConfigPathError(`'${path}' is not a valid setting path (empty segment)`);
    if (FORBIDDEN.has(k)) throw new ConfigPathError(`'${path}' is not a valid setting path ('${k}' is not allowed)`);
  }
  return keys;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at a dotted path, or undefined if any step is missing. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of splitPath(path)) {
    if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * A copy of `obj` with the value at `path` replaced; objects along the path are copied, the rest is shared.
 * A missing or non-object step is replaced by a new object.
 */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = splitPath(path);
  const root: Record<string, unknown> = { ...(isObj(obj) ? obj : {}) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    cur[keys[i]] = { ...(isObj(next) ? next : {}) };
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}

/**
 * `base` with `patch` laid over it: objects are merged property by property (recursively), everything else
 * in the patch (numbers, strings, booleans, arrays, null) replaces the value; a property that is undefined
 * in the patch is skipped. Neither argument is modified.
 */
export function mergeConfig<T>(base: T, patch: unknown): T {
  if (!isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN.has(k)) throw new ConfigPathError(`'${k}' is not allowed as a property name`);
    if (v === undefined) continue;
    out[k] = isObj(v) ? mergeConfig(out[k], v) : v;
  }
  return out as T;
}

/**
 * The value of a setting given as text: JSON when it parses (`20`, `1e20`, `true`, `"DT"`, `null`), otherwise
 * the text itself, so `fuel=DT` and `fuel="DT"` mean the same.
 */
export function parseSettingValue(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/** Splits `path=value` at the first `=`; the value goes through {@link parseSettingValue}. */
export function parseAssignment(text: string): { path: string; value: unknown } {
  const eq = text.indexOf('=');
  if (eq < 0) throw new ConfigPathError(`setting '${text}' is not of the form path=value`);
  const path = text.slice(0, eq).trim();
  splitPath(path);
  return { path, value: parseSettingValue(text.slice(eq + 1).trim()) };
}

/** Applies `path=value` settings in order to a copy of `cfg`. */
export function applyAssignments(cfg: ReactorConfig, assignments: readonly string[]): ReactorConfig {
  let out = cfg;
  for (const a of assignments) {
    const { path, value } = parseAssignment(a);
    out = setPath(out, path, value);
  }
  return out;
}
