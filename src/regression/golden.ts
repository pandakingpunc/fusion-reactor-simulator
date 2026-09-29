/// <reference types="node" />
/**
 * Golden regression harness: deterministic snapshots of preset runs and a tolerant comparator.
 *
 * A snapshot captures, per case (a preset, optionally with a shortened t_end):
 *   scalars      every finite number of the ShotReport, nested fields flattened to dotted paths
 *                (array items as path[i]; booleans as 0/1) plus warnings.length
 *   labels       method, time unit and termination reason
 *   flatTop      time-weighted flat-top averages of every diagnostic (src/physics/analysis/flatTop, the
 *                published definition since v4.0; it skips missing and non-finite samples)
 *   history      for every diagnostic key of any frame, over the whole run: min, max and frame mean
 *                of the finite samples, and how many frames lack the key or hold NaN/±Infinity —
 *                so a NaN, a dropped key or a changed value anywhere in the run is caught
 *   events       event counts by kind
 *   frames       number of history frames; steps: accepted time steps
 *   traces       ~20 samples, evenly spaced in time, of 5–8 key time traces
 *   geometry     the model's geometryInfo() after the run (1.5D: final equilibrium, e.g. Shafranov shift)
 *   profiles     1.5D only: every radial profile on the full ρ grid, at mid-run and in the last frame
 *   equilibrium  1.5D only: number of equilibrium updates and a digest of the last one (axis, q95,
 *                ℓ_i, β_p and the extent of each plotted flux surface)
 * Non-finite numbers are stored as the strings "NaN", "Infinity", "-Infinity".
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
import { ProfileModel, supportsProfiles } from '../physics/profiles/model';
import { flatTopAverages } from '../physics/analysis/flatTop';
import type { FuelType } from '../physics/reactivity';
import type { EqSnapshot, Fidelity, HistoryFrame, MagneticConfig, ProfileSettings, ReactorConfig, ShotReport } from '../physics/types';

/** 2: + meta.fuel, history, geometry, profiles, equilibrium (a format change: schema-1 values are unchanged) */
export const GOLDEN_SCHEMA = 2;
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
  /**
   * Settings changed from the preset, for combinations no preset uses (the wizard offers every
   * fuel for every method and 1.5D for both tokamak methods). Plain data: cases go to workers.
   */
  overrides?: { fuel?: FuelType; fidelity?: Fidelity; n_target?: number; profiles?: Partial<ProfileSettings> };
}

/**
 * The golden suite: every preset (all 12 methods; 0D and 1.5D). Long discharges are shortened so
 * that the whole suite runs in well under a minute on 4 threads; DEMO/DEMO15 still reach burn.
 * SPARC15-short is a 3 s variant of SPARC15 (ramp-up, L–H transition, first ELMs) for the fast
 * vitest subset. The variants after MUON cover what no preset does: D-³He and p-¹¹B in 0D and
 * 1.5D, 1.5D D-D, 1.5D spherical tokamak, and the two fuels in an FRC and a mirror.
 *
 * ITER-pB11 keeps the target density of the ITER preset before v4.0 (1.0e20 m^-3): p-11B fuel radiates more than it burns there and the shot
 * ends in a radiative-collapse disruption at about 28 s, the one golden case with a thermal quench, current quench and termination
 * scalars (ws2c lowered the preset to 0.914e20, where the same fuel survives to the end at P_rad/P_heat = 0.93 and no golden case disrupted
 * any more; regress/pb11Collapse.test.ts pins both densities). Any other case that disrupts is a second guard, not a replacement.
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
  { id: 'ITER-DHe3', preset: 'ITER', tEnd: 100, overrides: { fuel: 'DHe3' } },
  { id: 'ITER-pB11', preset: 'ITER', tEnd: 100, overrides: { fuel: 'pB11', n_target: 1.0e20 } },
  { id: 'SPARC15-DHe3', preset: 'SPARC15', tEnd: 3, overrides: { fuel: 'DHe3' } },
  { id: 'SPARC15-pB11', preset: 'SPARC15', tEnd: 3, overrides: { fuel: 'pB11' } },
  { id: 'DIIID15', preset: 'DIIID', tEnd: 3, overrides: { fidelity: '1.5D' } },
  { id: 'MASTU15', preset: 'MASTU', overrides: { fidelity: '1.5D' } },
  { id: 'TAE-pB11', preset: 'TAE', overrides: { fuel: 'pB11' } },
  { id: 'MIRROR-DHe3', preset: 'MIRROR', overrides: { fuel: 'DHe3' } },
  // the opt-in physics of WS6d, one short case each: fast-ion energy fields with the delayed heating and NBCD (Start and Cordey); ECCD (Lin-Liu et al.)
  // with NBCD on a DIII-D plasma; the Porcelli trigger with the helical-flux reset on the MAST-U plasma that sawteeth early
  { id: 'JET15-fast', preset: 'JET15', tEnd: 1.5, overrides: { profiles: { fastIonModel: 'profile', cdModel: 'physics' } } },
  { id: 'DIIID15-eccd', preset: 'DIIID', tEnd: 1.5, overrides: { fidelity: '1.5D', profiles: { cdModel: 'physics', eccd: { rho: 0.35, nPar: 0.35 } } } },
  { id: 'MASTU15-saw', preset: 'MASTU', tEnd: 0.5, overrides: { fidelity: '1.5D', profiles: { sawtoothTrigger: 'porcelli', sawtoothReconnection: 'kadomtsev' } } },
];

/** Quick cases compared by `npm test` (0D magnetic, two pulsed models, short 1.5D). */
export const FAST_CASES: readonly string[] = ['JET', 'NIF', 'Z', 'SPARC15-short'];

export function goldenCase(id: string): GoldenCase {
  const c = GOLDEN_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown golden case '${id}'`);
  return c;
}

const MAGNETIC_METHODS: readonly string[] = ['tokamak', 'spherical_tokamak', 'stellarator'];

/** True if the configuration runs the 1.5D profile model (the same test as createModel). */
export function runsProfiles(cfg: ReactorConfig): boolean {
  return MAGNETIC_METHODS.includes(cfg.method) && (cfg as MagneticConfig).fidelity === '1.5D' && supportsProfiles(cfg as MagneticConfig);
}

/**
 * Reactor configuration of a case: the preset's, with the overrides and the t_end override applied.
 * Throws for an override the preset cannot take (no fuel setting, 1.5D where it would run as 0D).
 */
export function caseConfig(c: GoldenCase): ReactorConfig {
  const p = PRESETS.find((x) => x.id === c.preset);
  if (!p) throw new Error(`golden case ${c.id}: unknown preset '${c.preset}'`);
  let cfg: ReactorConfig = p.cfg;
  const o = c.overrides ?? {};
  if (o.fuel !== undefined) {
    if (!('fuel' in cfg)) throw new Error(`golden case ${c.id}: preset ${c.preset} (${cfg.method}) has no fuel setting`);
    cfg = { ...cfg, fuel: o.fuel } as ReactorConfig;
  }
  if (o.fidelity !== undefined) {
    if (!MAGNETIC_METHODS.includes(cfg.method)) throw new Error(`golden case ${c.id}: preset ${c.preset} (${cfg.method}) has no fidelity setting`);
    cfg = { ...cfg, fidelity: o.fidelity } as ReactorConfig;
    if (o.fidelity === '1.5D' && !runsProfiles(cfg)) throw new Error(`golden case ${c.id}: ${cfg.method} has no 1.5D model`);
  }
  if (o.n_target !== undefined) {
    if (!('n_target' in cfg)) throw new Error(`golden case ${c.id}: preset ${c.preset} (${cfg.method}) has no n_target setting`);
    cfg = { ...cfg, n_target: o.n_target } as ReactorConfig;
  }
  if (o.profiles !== undefined) {
    if (!runsProfiles(cfg)) throw new Error(`golden case ${c.id}: profile settings need a 1.5D magnetic configuration`);
    cfg = { ...cfg, profiles: { ...(cfg as MagneticConfig).profiles, ...o.profiles } } as ReactorConfig;
  }
  if (c.tEnd === undefined) return cfg;
  if (!('t_end' in cfg)) throw new Error(`golden case ${c.id}: preset ${c.preset} (${cfg.method}) has no t_end to shorten`);
  return { ...cfg, t_end: c.tEnd } as ReactorConfig;
}

type Num = number | string; // non-finite numbers are stored as strings

/** Statistics of one diagnostic over every history frame. */
export interface DiagStats {
  /** smallest, largest and frame-mean value of the finite samples ("NaN" if there are none) */
  min: Num;
  max: Num;
  mean: Num;
  /** frames without the key (another frame has it) */
  missing: number;
  /** frames where it is NaN or ±Infinity */
  nonFinite: number;
}

/** Radial profiles (1.5D) of one history frame; every array is on the model's ρ grid. */
export interface ProfileSample {
  t: Num;
  prof: Record<string, Num[]>;
}

/** Digest of an equilibrium snapshot: scalars and, per plotted flux surface, its ρ_tor, point count and extent. */
export interface EqDigest {
  t: Num;
  Raxis: Num;
  Zaxis: Num;
  q95: Num;
  li: Num;
  betaP: Num;
  surfaces: { rho: Num[]; points: number[]; Rmin: Num[]; Rmax: Num[]; Zmin: Num[]; Zmax: Num[]; RatZmax: Num[] };
}

export interface GoldenSnapshot {
  meta: {
    schema: number;
    case: string;
    preset: string;
    method: string;
    fidelity: '0D' | '1.5D';
    /** fuel of the run (muon-catalyzed fusion is d-t) */
    fuel: string;
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
  history: Record<string, DiagStats>;
  events: Record<string, number>;
  frames: number;
  steps: number;
  traces: Record<string, Num[]>;
  geometry: Record<string, Num>;
  /** 1.5D only */
  profiles?: { frames: number; mid: ProfileSample; last: ProfileSample };
  /** only if the model reports equilibrium snapshots (1.5D) */
  equilibrium?: { frames: number; last: EqDigest };
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

/**
 * Whole-history statistics of every diagnostic key that appears in any frame. Unlike the flat-top
 * averages, which skip them, missing and non-finite samples are counted, over the whole run.
 */
export function historyStats(hist: readonly Pick<HistoryFrame, 'd'>[]): Record<string, DiagStats> {
  const acc = new Map<string, { present: number; nonFinite: number; n: number; sum: number; min: number; max: number }>();
  for (const f of hist) {
    for (const [k, v] of Object.entries(f.d)) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { present: 0, nonFinite: 0, n: 0, sum: 0, min: Infinity, max: -Infinity }));
      if (typeof v !== 'number') continue; // counts as missing
      a.present++;
      if (!Number.isFinite(v)) { a.nonFinite++; continue; }
      a.n++; a.sum += v;
      if (v < a.min) a.min = v;
      if (v > a.max) a.max = v;
    }
  }
  const out: Record<string, DiagStats> = {};
  for (const [k, a] of acc) {
    out[k] = {
      min: enc(a.n ? a.min : NaN), max: enc(a.n ? a.max : NaN), mean: enc(a.n ? a.sum / a.n : NaN),
      missing: hist.length - a.present, nonFinite: a.nonFinite,
    };
  }
  return out;
}

export function profileSample(f: Pick<HistoryFrame, 't' | 'prof'>): ProfileSample {
  const prof: Record<string, Num[]> = {};
  for (const [k, a] of Object.entries(f.prof ?? {})) prof[k] = Array.from(a, enc);
  return { t: enc(f.t), prof };
}

export function eqDigest(t: number, eq: EqSnapshot): EqDigest {
  const S: EqDigest['surfaces'] = { rho: [], points: [], Rmin: [], Rmax: [], Zmin: [], Zmax: [], RatZmax: [] };
  eq.R.forEach((R, s) => {
    const Z = eq.Z[s];
    let jTop = 0;
    for (let j = 1; j < Z.length; j++) if (Z[j] > Z[jTop]) jTop = j;
    S.rho.push(enc(eq.rho[s])); S.points.push(R.length);
    S.Rmin.push(enc(Math.min(...R))); S.Rmax.push(enc(Math.max(...R)));
    S.Zmin.push(enc(Math.min(...Z))); S.Zmax.push(enc(Math.max(...Z))); S.RatZmax.push(enc(R[jTop] ?? NaN));
  });
  return { t: enc(t), Raxis: enc(eq.Raxis), Zaxis: enc(eq.Zaxis), q95: enc(eq.q95), li: enc(eq.li), betaP: enc(eq.betaP), surfaces: S };
}

/** Profiles of a 1.5D run: the last frame with profiles at or before mid-run, and the last such frame. */
function profilesSection(hist: readonly HistoryFrame[]): GoldenSnapshot['profiles'] {
  const withProf = hist.filter((f) => f.prof);
  if (!withProf.length) return undefined;
  const tMid = hist[0].t + 0.5 * (hist[hist.length - 1].t - hist[0].t);
  let mid = withProf[0];
  for (const f of withProf) if (f.t <= tMid) mid = f;
  return { frames: withProf.length, mid: profileSample(mid), last: profileSample(withProf[withProf.length - 1]) };
}

function equilibriumSection(hist: readonly HistoryFrame[]): GoldenSnapshot['equilibrium'] {
  const withEq = hist.filter((f) => f.eq);
  if (!withEq.length) return undefined;
  const last = withEq[withEq.length - 1];
  return { frames: withEq.length, last: eqDigest(last.t, last.eq!) };
}

/** What a snapshot reads from a finished run (a Simulation, or a copy of its history in tests). */
export type RunData = Pick<Simulation, 'history' | 'events' | 'model' | 'nSteps'>;

/** Builds the snapshot of a finished run. */
export function snapshotFromRun(c: GoldenCase, sim: RunData, report: ShotReport, node: string): GoldenSnapshot {
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
  const geometry: Record<string, Num> = {};
  for (const [k, v] of Object.entries(sim.model.geometryInfo())) geometry[k] = enc(v);
  const snap: GoldenSnapshot = {
    meta: {
      schema: GOLDEN_SCHEMA, case: c.id, preset: c.preset, method: report.method, fidelity: is15 ? '1.5D' : '0D',
      fuel: (caseConfig(c) as { fuel?: string }).fuel ?? 'DT',
      tEnd: sim.model.tEnd, tEndShortened: c.tEnd !== undefined && c.tEnd !== nominalTEnd,
      timeUnit: sim.model.timeUnit, node, traceSamples: TRACE_SAMPLES,
    },
    scalars,
    labels: { method: report.method, timeUnit: report.timeUnit, 'termination.reason': report.termination.reason },
    flatTop, history: historyStats(hist), events, frames: hist.length, steps: sim.nSteps, traces, geometry,
  };
  const profiles = profilesSection(hist);
  if (profiles) snap.profiles = profiles;
  const equilibrium = equilibriumSection(hist);
  if (equilibrium) snap.equilibrium = equilibrium;
  return snap;
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

/**
 * Parses a golden file. Throws unless it has the current schema; with `anySchema` (used by
 * golden:update to describe what a re-record changes) any JSON object with a `meta` object is accepted.
 */
export function parseSnapshot(text: string, opts: { anySchema?: boolean } = {}): GoldenSnapshot {
  const s = JSON.parse(text) as GoldenSnapshot;
  if (opts.anySchema) {
    if (typeof s?.meta !== 'object' || s.meta === null) throw new Error('not a golden snapshot (no meta object)');
    return s;
  }
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

/** How a re-recorded snapshot differs from the stored one (for the golden:update log). */
export interface SnapshotChange {
  /** [old, new] meta.schema, when the file format changed */
  schema?: [unknown, unknown];
  /** keys present in both whose value changed by any amount */
  moved: GoldenDiff[];
  /** keys only in the new snapshot */
  added: GoldenDiff[];
  /** keys only in the old snapshot */
  removed: GoldenDiff[];
}

/** Splits the exact (tol = 0) differences into a schema change and moved, added and removed keys. */
export function summarizeChange(oldS: unknown, newS: unknown): SnapshotChange {
  const out: SnapshotChange = { moved: [], added: [], removed: [] };
  for (const d of compareSnapshots(oldS, newS, 0)) {
    if (d.key === 'meta.schema') out.schema = [d.old, d.new];
    else if (d.old === undefined) out.added.push(d);
    else if (d.new === undefined) out.removed.push(d);
    else out.moved.push(d);
  }
  return out;
}

/** Key counts by top-level snapshot section, largest first: "history 310, geometry 12". */
export function countBySection(diffs: readonly GoldenDiff[]): string {
  const n = new Map<string, number>();
  for (const d of diffs) { const s = /^[^.[]*/.exec(d.key)![0]; n.set(s, (n.get(s) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([s, c]) => `${s} ${c}`).join(', ');
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
