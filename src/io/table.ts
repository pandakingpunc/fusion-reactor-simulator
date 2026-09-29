/**
 * What every writer of src/io starts from: the history of a run as named columns (one number per diagnostic
 * per frame) and, for a 1.5D run, as radial profiles. Pure TypeScript, no DOM and no Node APIs: the
 * writers run in a browser, in a worker and in Node alike.
 *
 * Conventions shared by all formats:
 *  - time is in the model's time unit (`s`, `ns` or `us`), as in the history; IMAS output converts to seconds;
 *  - a diagnostic that a frame does not have is NaN in that frame (the golden harness counts these too);
 *  - the order of the columns is the model's diagSpecs order, then any other key sorted by name;
 *  - nothing time-dependent or machine-dependent is written unless the caller passes it in `meta`
 *    (a creation date, for instance), so the same run always gives the same bytes.
 */
import type { DiagSpec, HistoryFrame, ReactorConfig, ShotReport, SimEvent } from '../physics/types';

/** A named diagnostic with its label, unit and group (from the model's DiagSpec when it has one). */
export interface ColumnInfo {
  key: string;
  label: string;
  /** the unit as the model states it (`keV`, `1e20 m⁻³`, `MW/m²`, '' for dimensionless) */
  unit: string;
  group: string;
}

/** Scalar time traces: `values[c][i]` is column c at frame i. */
export interface RunTable {
  timeUnit: string;
  t: number[];
  columns: ColumnInfo[];
  values: number[][];
}

/** Radial profiles of the frames that carry them (regular output frames of a 1.5D run). */
export interface ProfileTable {
  /** frame times of the profile frames */
  t: number[];
  /** indices of those frames in the history (to line up with a RunTable) */
  frameIndex: number[];
  /** ρ_tor of the cell centres (the `rho` profile of the first profile frame) */
  rho: number[];
  columns: ColumnInfo[];
  /** `values[c][k][j]`: profile c at profile frame k, cell j */
  values: number[][][];
}

/** Provenance a caller may attach to an export; everything is optional and nothing is invented. */
export interface RunMeta {
  /** software version, e.g. '4.0.0' */
  version?: string;
  /** git commit of the software, if known */
  commit?: string;
  /** preset id the configuration came from */
  preset?: string;
  /** Simulation.fingerprint(version) */
  fingerprint?: string;
  /** SHA-256 of the canonical configuration */
  configSha256?: string;
  /** ISO 8601 creation time; left out of the output unless given, so that files are reproducible */
  created?: string;
  /** free text stored in the file */
  comment?: string;
}

/** Everything a writer needs about a finished (or partial) run. */
export interface RunSource {
  cfg?: ReactorConfig;
  method?: string;
  timeUnit: string;
  history: readonly HistoryFrame[];
  events: readonly SimEvent[];
  diagSpecs: readonly DiagSpec[];
  report?: ShotReport;
  meta?: RunMeta;
}

/** The parts of a Simulation the writers read (structural: the io modules do not import the kernel). */
export interface SimulationLike {
  cfg: ReactorConfig;
  history: HistoryFrame[];
  events: SimEvent[];
  model: { method: string; timeUnit: string; diagSpecs: DiagSpec[] };
  report(): ShotReport;
}

/** Builds the source of an export from a Simulation (its history, events, report and the model's diagnostics table). */
export function sourceFromSimulation(sim: SimulationLike, meta?: RunMeta, opts: { report?: boolean } = {}): RunSource {
  return {
    cfg: sim.cfg, method: sim.model.method, timeUnit: sim.model.timeUnit, history: sim.history, events: sim.events,
    diagSpecs: sim.model.diagSpecs, ...(opts.report === false ? {} : { report: sim.report() }), ...(meta ? { meta } : {}),
  };
}

/** Units of the radial profiles of the 1.5D model (profiles/diagnostics.ts writeDiagnostics). */
export const PROFILE_INFO: Readonly<Record<string, { label: string; unit: string }>> = {
  rho: { label: 'normalised toroidal flux radius rho_tor (cell centres)', unit: '' },
  Te: { label: 'electron temperature', unit: 'keV' },
  Ti: { label: 'ion temperature', unit: 'keV' },
  ne: { label: 'electron density', unit: '1e20 m⁻³' },
  q: { label: 'safety factor', unit: '' },
  j: { label: 'parallel current density <j.B>/B0', unit: 'MA/m²' },
  jbs: { label: 'bootstrap current density', unit: 'MA/m²' },
  jcd: { label: 'driven (non-inductive, non-bootstrap) current density', unit: 'MA/m²' },
  johm: { label: 'ohmic current density', unit: 'MA/m²' },
  chie: { label: 'electron heat diffusivity', unit: 'm²/s' },
  chii: { label: 'ion heat diffusivity', unit: 'm²/s' },
  Palpha: { label: 'alpha (charged fusion product) heating density', unit: 'MW/m³' },
  Paux: { label: 'auxiliary heating density', unit: 'MW/m³' },
  Prad: { label: 'radiated power density', unit: 'MW/m³' },
  Pohm: { label: 'ohmic heating density', unit: 'MW/m³' },
  p: { label: 'thermal pressure', unit: 'kPa' },
  Zeff: { label: 'effective charge', unit: '' },
  shear: { label: 'magnetic shear', unit: '' },
  alpha: { label: 'normalised pressure gradient alpha_MHD', unit: '' },
};

/** Columns for the given keys (or every key present in the history): DiagSpec order first, then the rest sorted. */
export function columnsFor(history: readonly HistoryFrame[], diagSpecs: readonly DiagSpec[], keys?: readonly string[]): ColumnInfo[] {
  const present = new Set<string>();
  for (const f of history) for (const k of Object.keys(f.d)) present.add(k);
  const spec = new Map(diagSpecs.map((s) => [s.key, s]));
  const info = (k: string): ColumnInfo => {
    const s = spec.get(k);
    return { key: k, label: s?.label ?? k, unit: s?.unit ?? '', group: s?.group ?? '' };
  };
  if (keys) return keys.map(info);
  const ordered = diagSpecs.map((s) => s.key).filter((k) => present.has(k));
  const rest = [...present].filter((k) => !spec.has(k)).sort();
  return [...ordered, ...rest].map(info);
}

/**
 * The source without the frames whose time does not increase. The kernel records one such frame: the terminal
 * frame of a shot that ended in a step that made no progress in time (a 1.5D 'Numerical failure'), which repeats
 * the time and the state of the frame before it and only carries the termination (see HistoryFrame). Coordinate
 * formats (NetCDF, IMAS) need a strictly increasing time axis, so they drop it; CSV and NDJSON keep every frame.
 * `dropped` is how many frames were left out.
 */
export function strictTimeSource(src: RunSource): { src: RunSource; dropped: number } {
  const keep: HistoryFrame[] = [];
  for (const f of src.history) if (!keep.length || f.t > keep[keep.length - 1].t) keep.push(f);
  const dropped = src.history.length - keep.length;
  return dropped ? { src: { ...src, history: keep }, dropped } : { src, dropped: 0 };
}

/** Every history frame as one row of named numbers. `keys` selects and orders the columns; unknown keys read as NaN. */
export function tableFromSource(src: RunSource, keys?: readonly string[]): RunTable {
  const columns = columnsFor(src.history, src.diagSpecs, keys);
  const t = src.history.map((f) => f.t);
  const values = columns.map((c) => src.history.map((f) => {
    const v = f.d[c.key];
    return typeof v === 'number' ? v : NaN;
  }));
  return { timeUnit: src.timeUnit, t, columns, values };
}

/** The radial profiles of a 1.5D run; undefined for a run without any (0D models, pulsed models). */
export function profilesFromSource(src: RunSource, opts: { every?: number; keys?: readonly string[] } = {}): ProfileTable | undefined {
  const every = Math.max(1, Math.floor(opts.every ?? 1));
  const idx: number[] = [];
  let k = 0;
  src.history.forEach((f, i) => { if (f.prof && f.prof.rho) { if (k++ % every === 0) idx.push(i); } });
  if (!idx.length) return undefined;
  const first = src.history[idx[0]].prof!;
  const keys = (opts.keys ?? Object.keys(first)).filter((key) => key !== 'rho' && key in first);
  const info = (key: string): ColumnInfo => ({ key, label: PROFILE_INFO[key]?.label ?? key, unit: PROFILE_INFO[key]?.unit ?? '', group: 'profile' });
  return {
    t: idx.map((i) => src.history[i].t),
    frameIndex: idx,
    rho: [...first.rho],
    columns: keys.map(info),
    values: keys.map((key) => idx.map((i) => {
      const a = src.history[i].prof![key];
      return a ? [...a] : new Array<number>(first.rho.length).fill(NaN);
    })),
  };
}

/** Number formatting for text formats: the shortest string that reads back as the same double (-0 kept). */
export function formatNumber(x: number): string {
  if (Object.is(x, -0)) return '-0';
  return String(x);
}

const SUPERSCRIPT: Readonly<Record<string, string>> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

/**
 * A UDUNITS-style unit string (what CF metadata wants) for a model unit: superscripts become exponents
 * (`m⁻³` -> `m-3`), a slash becomes negative exponents (`MW/m²` -> `MW m-2`), the empty unit is `1`, `%` is `percent`.
 * The prefactor of a scaled unit is kept (`1e20 m⁻³` -> `1e20 m-3`).
 */
export function cfUnit(unit: string): string {
  if (unit === '') return '1';
  let u = unit.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => [...m].map((ch) => SUPERSCRIPT[ch]).join('')).replace(/µ/g, 'u').replace(/%/g, 'percent');
  const slash = u.indexOf('/');
  if (slash >= 0) {
    const num = u.slice(0, slash).trim();
    const den = u.slice(slash + 1).trim().split(/\s+/).filter(Boolean).map((tok) => {
      const m = /^([A-Za-z]+)(-?\d+)?$/.exec(tok);
      if (!m) return tok;
      const e = m[2] === undefined ? 1 : Number(m[2]);
      return `${m[1]}${-e}`;
    });
    u = [num, ...den].filter(Boolean).join(' ');
  }
  return u.replace(/\s+/g, ' ').trim() || '1';
}

/** The time unit of a model (`µs`) in the plain ASCII of UDUNITS (`us`). */
export function cfTimeUnit(timeUnit: string): string {
  return timeUnit.replace(/µ/g, 'u');
}

/** Seconds per model time unit (for the IMAS output, which is in SI). */
export function secondsPer(timeUnit: string): number {
  switch (timeUnit) {
    case 'ns': return 1e-9;
    case 'µs': case 'us': return 1e-6;
    default: return 1;
  }
}

/** UTF-8 encoding without TextEncoder (which the environment-free build does not have). */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate has no UTF-8 form
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** UTF-8 decoding without TextDecoder; malformed sequences become U+FFFD. */
export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp = 0xfffd, n = 1;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0 && i + 1 < b.length && (b[i + 1] & 0xc0) === 0x80) { cp = ((c & 31) << 6) | (b[i + 1] & 63); n = 2; }
    else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) { cp = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); n = 3; }
    else if (c >= 0xf0 && c < 0xf5 && i + 3 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) { cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63); n = 4; }
    s += cp >= 0x10000 ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    i += n;
  }
  return s;
}
