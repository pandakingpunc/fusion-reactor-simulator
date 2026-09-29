/**
 * Newline-delimited JSON (one JSON value per line) for streaming a run to another program or a log.
 *
 * `ndjsonRecords` lays a run out as typed records, each a JSON object with a `type`:
 *   { "type": "meta",   ... }   one, first: method, time unit, the diagnostics table (key, label, unit, group),
 *                                configuration and provenance
 *   { "type": "frame",  "t": <time>, "d": { key: value, ... }, "prof": { key: [..] }? }   one per history frame
 *   { "type": "event",  "t", "kind", "msg", "value"? }                                   one per event
 *   { "type": "report", ... }   one, last: the ShotReport
 * so that `jq 'select(.type == "frame") | .d.Q'` works and a consumer can start reading before the run ends.
 *
 * Numbers are JSON numbers. JSON has no NaN or infinity: by default they are written as `null`
 * (`nonFinite: 'null'`, what JSON.stringify does); with `nonFinite: 'string'` they are written as the strings
 * "NaN", "Infinity" and "-Infinity" and `parseNdjson(text, { revive: true })` turns exactly those strings back
 * into numbers (lossless, but do not use it on text that legitimately holds those strings). -0 is written as 0.
 *
 * Pure TypeScript, browser-safe.
 */
import type { RunSource } from './table';
import { columnsFor } from './table';

export type NonFinite = 'null' | 'string';

export interface NdjsonOptions {
  /** how NaN and the infinities are written (default 'null') */
  nonFinite?: NonFinite;
  /** the diagnostics to write per frame (default: all of them) */
  keys?: readonly string[];
  /** include the radial profiles of the frames that have them (default false: they are large) */
  profiles?: boolean;
  /** write every n-th frame (default 1: all); the first and the last frame are always written */
  every?: number;
  /** write the event records (default true) */
  events?: boolean;
  /** write the meta and report records (default true) */
  meta?: boolean;
}

/** JSON text of one value with the chosen treatment of non-finite numbers, no line breaks. */
export function jsonLine(value: unknown, nonFinite: NonFinite = 'null'): string {
  return nonFinite === 'string'
    ? JSON.stringify(value, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))
    : JSON.stringify(value);
}

/** One line per record, each terminated with '\n'. */
export function writeNdjson(records: Iterable<unknown>, opts: { nonFinite?: NonFinite } = {}): string {
  let out = '';
  for (const r of records) out += jsonLine(r, opts.nonFinite) + '\n';
  return out;
}

/** The typed records of a run (see the file header), as plain objects. */
export function ndjsonRecords(src: RunSource, opts: NdjsonOptions = {}): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const cols = columnsFor(src.history, src.diagSpecs, opts.keys);
  const every = Math.max(1, Math.floor(opts.every ?? 1));
  if (opts.meta ?? true) {
    out.push({
      type: 'meta', format: 'fusion-sim-ndjson', schema: 1, method: src.method, timeUnit: src.timeUnit,
      diagnostics: cols.map((c) => ({ key: c.key, label: c.label, unit: c.unit, group: c.group })),
      ...(src.cfg ? { config: src.cfg } : {}), ...(src.meta ? { provenance: src.meta } : {}),
    });
  }
  const n = src.history.length;
  src.history.forEach((f, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const d: Record<string, number> = {};
    for (const c of cols) if (typeof f.d[c.key] === 'number') d[c.key] = f.d[c.key];
    const rec: Record<string, unknown> = { type: 'frame', t: f.t, d };
    if (opts.profiles && f.prof) rec.prof = f.prof;
    out.push(rec);
  });
  if (opts.events ?? true) for (const e of src.events) out.push({ type: 'event', t: e.t, kind: e.kind, msg: e.msg, ...(e.value !== undefined ? { value: e.value } : {}) });
  if ((opts.meta ?? true) && src.report) out.push({ type: 'report', ...src.report });
  return out;
}

/** A run as NDJSON text. */
export function writeRunNdjson(src: RunSource, opts: NdjsonOptions = {}): string {
  return writeNdjson(ndjsonRecords(src, opts), { nonFinite: opts.nonFinite });
}

/** Parses NDJSON text (blank lines are skipped); `revive` turns the strings "NaN", "Infinity", "-Infinity" back into numbers. */
export function parseNdjson(text: string, opts: { revive?: boolean } = {}): unknown[] {
  const reviver = opts.revive
    ? (_k: string, v: unknown) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v)
    : undefined;
  const out: unknown[] = [];
  text.split('\n').forEach((line, i) => {
    const s = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (s.trim() === '') return;
    try { out.push(JSON.parse(s, reviver)); } catch (e) { throw new Error(`NDJSON line ${i + 1}: ${(e as Error).message}`); }
  });
  return out;
}
