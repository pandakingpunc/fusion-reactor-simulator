/// <reference types="node" />
/**
 * Golden regression harness: deterministic snapshots of preset runs and a tolerant comparator.
 *
 * A snapshot captures, per case (a preset, optionally with a shortened t_end):
 *   scalars  every finite number of the ShotReport, nested fields flattened to dotted paths
 *            (array items as path[i]; booleans as 0/1) plus warnings.length
 *   labels   method, time unit and termination reason
 *   flatTop  frame-weighted flat-top averages of every diagnostic (src/physics/analysis/flatTop)
 *   events   event counts by kind
 *   frames   number of history frames; steps: accepted time steps
 *   traces   ~20 samples, evenly spaced in time, of 5–8 key time traces
 * Non-finite numbers inside flatTop/traces are stored as the strings "NaN", "Infinity", "-Infinity".
 *
 * Files are canonical JSON (sorted keys, shortest round-trip number representation, i.e. full
 * double precision). Comparison is by key path, so key order never matters. Numbers match when
 * |a − b| / max(|a|, |b|, 1e-300) ≤ tol, with tol = 1e-9 if the file was written by the same Node
 * major version and 1e-6 otherwise (different V8 builds may differ in the last bits of Math.*).
 *
 * Node-only (worker CLI and vitest); not part of the browser bundle.
 */
import { PRESETS } from '../physics/presets';
import { Simulation } from '../physics/simulation';
import { ProfileModel } from '../physics/profiles/model';
import { flatTopAverages } from '../physics/analysis/flatTop';
import type { HistoryFrame, ReactorConfig, ShotReport } from '../physics/types';

export const GOLDEN_SCHEMA = 1;
/** samples per trace */
export const TRACE_SAMPLES = 20;
export const REL_TOL_SAME_NODE = 1e-9;
export const REL_TOL_OTHER_NODE = 1e-6;
export const ABS_FLOOR = 1e-300;

export interface GoldenCase {
  /** case id = golden file name (test/golden/<id>.json); equals the preset id unless a variant */
  id: string;
  /** preset id in src/physics/presets.ts */
  preset: string;
  /** shortened t_end [s] (magnetic, FRC, mirror presets only) */
  tEnd?: number;
}

/**
 * The golden suite: every preset (all 12 methods; 0D and 1.5D). Long discharges are shortened so
 * that the whole suite runs in well under a minute on 4 threads; DEMO/DEMO15 still reach burn.
 * SPARC15-short is a 3 s variant of SPARC15 (ramp-up, L–H transition, first ELMs) for the fast
 * vitest subset.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  { id: 'ITER', preset: 'ITER' },
  { id: 'JET', preset: 'JET' },
  { id: 'SPARC', preset: 'SPARC' },
  { id: 'DIIID', preset: 'DIIID' },
  { id: 'JT60SA', preset: 'JT60SA' },
  { id: 'MASTU', preset: 'MASTU' },
  { id: 'W7X', preset: 'W7X' },
  { id: 'DEMO', preset: 'DEMO', tEnd: 600 },
  { id: 'ITER15', preset: 'ITER15' },
  { id: 'JET15', preset: 'JET15' },
  { id: 'SPARC15', preset: 'SPARC15' },
  { id: 'SPARC15-short', preset: 'SPARC15', tEnd: 3 },
  { id: 'DEMO15', preset: 'DEMO15', tEnd: 500 },
  { id: 'NIF', preset: 'NIF' },
  { id: 'DIRECT', preset: 'DIRECT' },
  { id: 'Z', preset: 'Z' },
  { id: 'GF', preset: 'GF' },
  { id: 'FRXL', preset: 'FRXL' },
  { id: 'ZAP', preset: 'ZAP' },
  { id: 'TAE', preset: 'TAE' },
  { id: 'MIRROR', preset: 'MIRROR' },
  { id: 'MUON', preset: 'MUON' },
];

/** Quick cases compared by `npm test` (0D magnetic, two pulsed models, short 1.5D). */
export const FAST_CASES: readonly string[] = ['JET', 'NIF', 'Z', 'SPARC15-short'];

export function goldenCase(id: string): GoldenCase {
  const c = GOLDEN_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown golden case '${id}'`);
  return c;
}

/** Reactor configuration of a case (preset config with the t_end override applied). */
export function caseConfig(c: GoldenCase): ReactorConfig {
  const p = PRESETS.find((x) => x.id === c.preset);
  if (!p) throw new Error(`golden case ${c.id}: unknown preset '${c.preset}'`);
  if (c.tEnd === undefined) return p.cfg;
  if (!('t_end' in p.cfg)) throw new Error(`golden case ${c.id}: preset ${c.preset} (${p.cfg.method}) has no t_end to shorten`);
  return { ...p.cfg, t_end: c.tEnd } as ReactorConfig;
}

type Num = number | string; // non-finite numbers are stored as strings

export interface GoldenSnapshot {
  meta: {
    schema: number;
    case: string;
    preset: string;
    method: string;
    fidelity: '0D' | '1.5D';
    /** simulated duration actually used, in timeUnit */
    tEnd: number;
    /** true if tEnd was shortened from the preset's nominal value */
    tEndShortened: boolean;
    timeUnit: string;
    /** Node version that produced the file (selects the comparison tolerance) */
    node: string;
    traceSamples: number;
  };
  scalars: Record<string, number>;
  labels: Record<string, string>;
  flatTop: Record<string, Num>;
  events: Record<string, number>;
  frames: number;
  steps: number;
  traces: Record<string, Num[]>;
}

const TRACE_KEYS_15D = ['Q', 'P_fus', 'Ti0', 'Te0', 'ne', 'W', 'f_bs', 'li'];
const TRACE_KEYS_0D = ['Q', 'P_fus', 'Ti0', 'Te', 'ne', 'W', 'betaN', 'Zeff'];
const TRACE_KEYS_PULSED = ['Ti', 'Te', 'ne', 'rhoR', 'B', 'Yf', 'P_in', 'P_fus', 'Q', 'Efus_MJ', 'W', 'triple'];

const enc = (v: number): Num => (Number.isFinite(v) ? v : String(v));

/** Flattens every finite number (and boolean, as 0/1) of a nested value into dotted paths. */
export function flattenScalars(value: unknown, prefix = '', out: Record<string, number> = {}): Record<string, number> {
  if (typeof value === 'number') { if (Number.isFinite(value)) out[prefix] = value; }
  else if (typeof value === 'boolean') out[prefix] = value ? 1 : 0;
  else if (Array.isArray(value)) value.forEach((v, i) => flattenScalars(v, `${prefix}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenScalars(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Indices of `m` frames evenly spaced in time: the last frame with t ≤ t_k. */
export function sampleIndices(hist: readonly Pick<HistoryFrame, 't'>[], m = TRACE_SAMPLES): number[] {
  const n = hist.length;
  if (n === 0) return [];
  const tA = hist[0].t, tB = hist[n - 1].t;
  const idx: number[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    if (k === m - 1) { idx.push(n - 1); break; }
    const tk = tA + ((tB - tA) * k) / (m - 1);
    while (j + 1 < n && hist[j + 1].t <= tk) j++;
    idx.push(j);
  }
  return idx;
}

/** Builds the snapshot of a finished run. */
export function snapshotFromRun(c: GoldenCase, sim: Simulation, report: ShotReport, node: string): GoldenSnapshot {
  const hist = sim.history;
  const last = hist[hist.length - 1].d;
  const is15 = sim.model instanceof ProfileModel;
  const pref = is15 ? TRACE_KEYS_15D : sim.model.kind === 'magnetic' ? TRACE_KEYS_0D : TRACE_KEYS_PULSED;
  const keys = pref.filter((k) => k in last).slice(0, 8);
  const idx = sampleIndices(hist);
  const traces: Record<string, Num[]> = { t: idx.map((i) => enc(hist[i].t)) };
  for (const k of keys) traces[k] = idx.map((i) => enc(hist[i].d[k] ?? NaN));
  const flatTop: Record<string, Num> = {};
  for (const [k, v] of Object.entries(flatTopAverages(hist))) flatTop[k] = enc(v);
  const events: Record<string, number> = {};
  for (const e of sim.events) events[e.kind] = (events[e.kind] ?? 0) + 1;
  const scalars = flattenScalars(report);
  scalars['warnings.length'] = report.warnings.length;
  const nominalTEnd = (caseConfig({ id: c.id, preset: c.preset }) as { t_end?: number }).t_end;
  return {
    meta: {
      schema: GOLDEN_SCHEMA, case: c.id, preset: c.preset, method: report.method, fidelity: is15 ? '1.5D' : '0D',
      tEnd: sim.model.tEnd, tEndShortened: c.tEnd !== undefined && c.tEnd !== nominalTEnd,
      timeUnit: sim.model.timeUnit, node, traceSamples: TRACE_SAMPLES,
    },
    scalars,
    labels: { method: report.method, timeUnit: report.timeUnit, 'termination.reason': report.termination.reason },
    flatTop, events, frames: hist.length, steps: sim.nSteps, traces,
  };
}

/** Runs one case in-process. */
export function runGoldenCase(c: GoldenCase, node: string = process.version): GoldenSnapshot {
  const sim = new Simulation(caseConfig(c));
  const report = sim.runAll();
  return snapshotFromRun(c, sim, report, node);
}

// ---------------------------------------------------------------- serialization

function canonical(v: unknown, indent: string): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in golden snapshot (encode it as a string)');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return `[${v.map((x) => canonical(x, indent)).join(', ')}]`;
    const inner = indent + '  ';
    return `[\n${v.map((x) => inner + canonical(x, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(v).sort();
  if (!keys.length) return '{}';
  const inner = indent + '  ';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${canonical((v as Record<string, unknown>)[k], inner)}`).join(',\n')}\n${indent}}`;
}

/** Canonical JSON text: sorted keys at every level, full-precision numbers, trailing newline. */
export function serializeSnapshot(s: GoldenSnapshot): string {
  return canonical(s, '') + '\n';
}

export function parseSnapshot(text: string): GoldenSnapshot {
  const s = JSON.parse(text) as GoldenSnapshot;
  if (s?.meta?.schema !== GOLDEN_SCHEMA) throw new Error(`unsupported golden schema ${String(s?.meta?.schema)} (expected ${GOLDEN_SCHEMA})`);
  return s;
}

// ---------------------------------------------------------------- comparison

export interface GoldenDiff {
  key: string;
  old: unknown;
  new: unknown;
  /** relative difference; Infinity for type changes and missing keys */
  rel: number;
}

const nodeMajor = (v: string): number => parseInt(/^v?(\d+)/.exec(v)?.[1] ?? 'NaN', 10);

/** 1e-9 if both versions share the Node major version, else 1e-6. */
export function toleranceFor(storedNode: string, currentNode: string = process.version): number {
  const a = nodeMajor(storedNode), b = nodeMajor(currentNode);
  return Number.isFinite(a) && a === b ? REL_TOL_SAME_NODE : REL_TOL_OTHER_NODE;
}

export function relDiff(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), ABS_FLOOR);
}

/** Leaf values by path; meta.node is informational and excluded. */
export function flattenSnapshot(s: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    else if (path !== 'meta.node') out.set(path, v);
  };
  walk(s, '');
  return out;
}

/**
 * Differences between two snapshots beyond `tol` (relative); missing/extra keys and non-numeric
 * changes are always reported. Sorted by key.
 */
export function compareSnapshots(oldS: unknown, newS: unknown, tol: number): GoldenDiff[] {
  const a = flattenSnapshot(oldS), b = flattenSnapshot(newS);
  const diffs: GoldenDiff[] = [];
  for (const [k, va] of a) {
    if (!b.has(k)) { diffs.push({ key: k, old: va, new: undefined, rel: Infinity }); continue; }
    const vb = b.get(k);
    if (typeof va === 'number' && typeof vb === 'number') {
      const r = relDiff(va, vb);
      if (!(r <= tol)) diffs.push({ key: k, old: va, new: vb, rel: r });
    } else if (va !== vb) diffs.push({ key: k, old: va, new: vb, rel: Infinity });
  }
  for (const [k, vb] of b) if (!a.has(k)) diffs.push({ key: k, old: undefined, new: vb, rel: Infinity });
  return diffs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

const show = (v: unknown): string => (v === undefined ? '(missing)' : typeof v === 'string' ? JSON.stringify(v) : String(v));

/** Plain-text table: case, key, old, new, rel. diff (at most `maxRows` rows per case). */
export function formatDiffTable(rows: { case: string; diffs: GoldenDiff[] }[], maxRows = 25): string {
  const table: string[][] = [['preset', 'key', 'old', 'new', 'rel diff']];
  const notes: string[] = [];
  for (const r of rows) {
    for (const d of r.diffs.slice(0, maxRows)) {
      table.push([r.case, d.key, show(d.old), show(d.new), Number.isFinite(d.rel) ? d.rel.toExponential(2) : '—']);
    }
    if (r.diffs.length > maxRows) notes.push(`${r.case}: ${r.diffs.length - maxRows} more differing keys not shown`);
  }
  const w = table[0].map((_, j) => Math.max(...table.map((row) => row[j].length)));
  const line = (row: string[]) => '  ' + row.map((c, j) => c.padEnd(w[j])).join('  ').trimEnd();
  return [line(table[0]), line(w.map((n) => '-'.repeat(n))), ...table.slice(1).map(line), ...notes.map((n) => `  (${n})`)].join('\n');
}
