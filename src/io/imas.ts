/**
 * IMAS-like JSON export of a magnetic-confinement run: the IDSs `summary`, `core_profiles` and `equilibrium`
 * as one JSON document, in SI units and with the sign conventions of COCOS 11 (the IMAS default).
 *
 * "IMAS-like" is deliberate. The field names follow the IMAS Data Dictionary (3.x spelling) and the units are
 * the dictionary's (eV, m^-3, A, W, J, s), but the document is not produced by, or validated against, an IMAS
 * installation: no Data Dictionary release was available to check it against. It is meant to be
 * loadable into IMAS tooling by a short adapter, and to be readable on its own. What it contains is limited to
 * what the model computes; a quantity the model does not have is left out, never filled with a placeholder.
 *
 * Structure
 *   { format: { name, version, cocos: 11, ... }, summary, core_profiles?, equilibrium? }
 *   summary        one time base `time` [s]; every quantity is `{ value: [...] }` as in the IDS
 *                  (global_quantities.ip, .beta_tor_norm, .q_95, .tau_energy, .fusion_gain, ...;
 *                   fusion.power; volume_average.t_e, .t_i_average, .n_e; line_average.n_e; local.magnetic_axis.*)
 *   core_profiles  (1.5D runs) `profiles_1d[k]` per output frame with grid.rho_tor_norm, electrons.temperature
 *                  and .density, t_i_average, q, magnetic_shear, zeff, pressure_thermal, j_total, j_bootstrap,
 *                  j_non_inductive, j_ohmic; vacuum_toroidal_field; time
 *   equilibrium    (1.5D runs) `time_slice[k]` per frame where the equilibrium was updated: the outermost traced
 *                  flux surface as boundary.outline, its extent (minor radius, elongation, geometric axis) and
 *                  global_quantities (magnetic axis, ip, q_95, li_3, beta_pol); vacuum_toroidal_field; time
 * Missing values (NaN) are `null`. Time is seconds. `code.parameters` holds the configuration as JSON text.
 *
 * COCOS 11 (Sauter and Medvedev, Comput. Phys. Commun. 184 (2013) 293): the model's plasma current and
 * toroidal field are positive and parallel, so q, the current densities and the shear are positive and
 * poloidal flux is not exported (the model does not compute a flux map that could carry its sign).
 *
 * Pure TypeScript, browser-safe.
 */
import { type RunSource, profilesFromSource, secondsPer, tableFromSource } from './table';

export const IMAS_FORMAT_VERSION = 1;

const MAGNETIC = new Set(['tokamak', 'spherical_tokamak', 'stellarator']);

/** How a diagnostic maps to a summary quantity: `key` [model unit] × `scale` = IDS value [SI]. */
interface SummaryMap { key: string; path: string; scale: number }

/** Summary quantities in the order they are written (the IDS paths are dotted; every leaf is `{ value: [...] }`). */
export const SUMMARY_MAP: readonly SummaryMap[] = [
  { key: 'Ip', path: 'global_quantities.ip', scale: 1e6 },
  { key: 'betaN', path: 'global_quantities.beta_tor_norm', scale: 1 },
  { key: 'betaP', path: 'global_quantities.beta_pol', scale: 1 },
  { key: 'li', path: 'global_quantities.li_3', scale: 1 },
  { key: 'q95', path: 'global_quantities.q_95', scale: 1 },
  { key: 'tauE', path: 'global_quantities.tau_energy', scale: 1 },
  { key: 'Q', path: 'global_quantities.fusion_gain', scale: 1 },
  { key: 'H_mode', path: 'global_quantities.h_mode', scale: 1 },
  { key: 'P_loss', path: 'global_quantities.power_loss', scale: 1e6 },
  { key: 'P_rad', path: 'global_quantities.power_radiated', scale: 1e6 },
  { key: 'nG_frac', path: 'global_quantities.greenwald_fraction', scale: 1 },
  { key: 'V_loop', path: 'global_quantities.v_loop', scale: 1 },
  { key: 'W', path: 'global_quantities.energy_thermal', scale: 1e6 },
  { key: 'P_fus', path: 'fusion.power', scale: 1e6 },
  { key: 'P_neutron', path: 'fusion.neutron_power_total', scale: 1e6 },
  { key: 'Te', path: 'volume_average.t_e', scale: 1e3 },
  { key: 'Ti', path: 'volume_average.t_i_average', scale: 1e3 },
  { key: 'ne', path: 'volume_average.n_e', scale: 1e20 },
  { key: 'Zeff', path: 'volume_average.zeff', scale: 1 },
  { key: 'nbar', path: 'line_average.n_e', scale: 1e20 },
  { key: 'Te0', path: 'local.magnetic_axis.t_e', scale: 1e3 },
  { key: 'Ti0', path: 'local.magnetic_axis.t_i_average', scale: 1e3 },
  { key: 'ne0', path: 'local.magnetic_axis.n_e', scale: 1e20 },
  { key: 'q0', path: 'local.magnetic_axis.q', scale: 1 },
  { key: 'P_aux', path: 'heating_current_drive.power_additional', scale: 1e6 },
];

type Json = null | number | string | boolean | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const num = (x: number): number | null => (Number.isFinite(x) ? x : null);
const nums = (a: readonly number[]): (number | null)[] => a.map(num);

function put(root: Obj, path: string, leaf: Json): void {
  const keys = path.split('.');
  let cur = root;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Obj;
  cur[keys[keys.length - 1]] = leaf;
}

export interface ImasOptions {
  /** keep every n-th profile frame and equilibrium slice (default 1) */
  every?: number;
  /** write core_profiles and equilibrium when the run has profiles (default true) */
  profiles?: boolean;
  /** spaces of JSON indentation for writeImasJson (default 0: compact) */
  indent?: number;
}

const finiteSome = (a: readonly number[]): boolean => a.some(Number.isFinite);

/** The IMAS-like document of a magnetic-confinement run. Throws for a method outside magnetic confinement. */
export function imasFromRun(src: RunSource, opts: ImasOptions = {}): Obj {
  if (src.method !== undefined && !MAGNETIC.has(src.method)) {
    throw new Error(`the IMAS-like export covers magnetic-confinement runs (tokamak, spherical_tokamak, stellarator), not '${src.method}'`);
  }
  const s = secondsPer(src.timeUnit);
  const tab = tableFromSource(src);
  const col = (key: string): number[] | undefined => {
    const i = tab.columns.findIndex((c) => c.key === key);
    return i >= 0 ? tab.values[i] : undefined;
  };
  const time = tab.t.map((t) => t * s);
  const cfg = src.cfg as { geometry?: { R?: number }; B0?: number } | undefined;
  const R0 = cfg?.geometry?.R, B0 = cfg?.B0;

  const summary: Obj = {
    ids_properties: { comment: 'time traces of a Fusion Reactor Simulator run', homogeneous_time: 1, ...(src.meta?.created ? { creation_date: src.meta.created } : {}) },
    code: code(src),
    time: nums(time),
  };
  for (const m of SUMMARY_MAP) {
    const c = col(m.key);
    if (!c || !finiteSome(c)) continue;
    put(summary, m.path, { value: nums(c.map((v) => v * m.scale)) });
  }
  const fbs = col('f_bs'), ip = col('Ip');
  if (fbs && ip && finiteSome(fbs)) put(summary, 'global_quantities.current_bootstrap', { value: nums(fbs.map((f, i) => f * ip[i] * 1e6)) });
  if (B0 !== undefined) put(summary, 'global_quantities.b0', { value: time.map(() => B0) });
  if (R0 !== undefined) put(summary, 'global_quantities.r0', { value: R0 });

  const doc: Obj = {
    format: {
      name: 'imas-like-json', version: IMAS_FORMAT_VERSION, cocos: 11,
      note: 'IDS names and units follow the IMAS Data Dictionary (3.x spelling); not validated against a Data Dictionary release. Missing values are null. Time in seconds.',
    },
    summary,
  };

  const prof = opts.profiles === false ? undefined : profilesFromSource(src, { every: opts.every });
  if (prof) {
    const at = (key: string): number[][] | undefined => {
      const i = prof.columns.findIndex((c) => c.key === key);
      return i >= 0 ? prof.values[i] : undefined;
    };
    const Te = at('Te'), Ti = at('Ti'), ne = at('ne'), q = at('q'), shear = at('shear'), zeff = at('Zeff'), p = at('p');
    const j = at('j'), jbs = at('jbs'), jcd = at('jcd'), johm = at('johm');
    const scaled = (a: number[][] | undefined, k: number, f: number): (number | null)[] | undefined => a && nums(a[k].map((v) => v * f));
    const slices: Obj[] = prof.t.map((t, k) => {
      const sl: Obj = { time: t * s, grid: { rho_tor_norm: nums(prof.rho) } };
      const electrons: Obj = {};
      const tE = scaled(Te, k, 1e3), nE = scaled(ne, k, 1e20);
      if (tE) electrons.temperature = tE;
      if (nE) electrons.density = nE;
      if (Object.keys(electrons).length) sl.electrons = electrons;
      const put1 = (name: string, v: Json | undefined) => { if (v !== undefined) sl[name] = v; };
      put1('t_i_average', scaled(Ti, k, 1e3));
      put1('q', scaled(q, k, 1));
      put1('magnetic_shear', scaled(shear, k, 1));
      put1('zeff', scaled(zeff, k, 1));
      put1('pressure_thermal', scaled(p, k, 1e3));
      put1('j_total', scaled(j, k, 1e6));
      put1('j_bootstrap', scaled(jbs, k, 1e6));
      if (jbs && jcd) sl.j_non_inductive = nums(jbs[k].map((v, jx) => (v + jcd[k][jx]) * 1e6));
      put1('j_ohmic', scaled(johm, k, 1e6));
      return sl;
    });
    const vtf = (n: number): Obj => ({ ...(R0 !== undefined ? { r0: R0 } : {}), ...(B0 !== undefined ? { b0: new Array<number>(n).fill(B0 ?? 0) } : {}) });
    doc.core_profiles = {
      ids_properties: { comment: 'radial profiles of a Fusion Reactor Simulator 1.5D run', homogeneous_time: 1 },
      code: code(src),
      time: nums(prof.t.map((t) => t * s)),
      vacuum_toroidal_field: vtf(prof.t.length),
      profiles_1d: slices,
    };
    const eqTimes: number[] = [];
    const eqSlices: Obj[] = [];
    let k = 0;
    for (const f of src.history) {
      const eq = f.eq;
      if (!eq) continue;
      if (k++ % Math.max(1, Math.floor(opts.every ?? 1)) !== 0) continue;
      const last = eq.R.length - 1;
      const r = eq.R[last] ?? [], z = eq.Z[last] ?? [];
      const rmin = Math.min(...r), rmax = Math.max(...r), zmin = Math.min(...z), zmax = Math.max(...z);
      const bd: Obj = { outline: { r: nums(r), z: nums(z) } };
      if (r.length) Object.assign(bd, { minor_radius: (rmax - rmin) / 2, elongation: (zmax - zmin) / (rmax - rmin), geometric_axis: { r: (rmax + rmin) / 2, z: (zmax + zmin) / 2 } });
      const gq: Obj = { magnetic_axis: { r: num(eq.Raxis), z: num(eq.Zaxis) }, q_95: num(eq.q95), li_3: num(eq.li), beta_pol: num(eq.betaP) };
      if (typeof f.d.Ip === 'number') gq.ip = num(f.d.Ip * 1e6);
      eqTimes.push(f.t * s);
      eqSlices.push({ time: f.t * s, boundary: bd, global_quantities: gq });
    }
    if (eqSlices.length) {
      doc.equilibrium = {
        ids_properties: { comment: 'flux-surface geometry of a Fusion Reactor Simulator 1.5D run (outermost traced surface as boundary)', homogeneous_time: 1 },
        code: code(src),
        time: nums(eqTimes),
        vacuum_toroidal_field: vtf(eqTimes.length),
        time_slice: eqSlices,
      };
    }
  }
  return doc;
}

function code(src: RunSource): Obj {
  const m = src.meta;
  return {
    name: 'fusion-reactor-simulator',
    ...(m?.version ? { version: m.version } : {}),
    ...(m?.commit ? { commit: m.commit } : {}),
    ...(src.cfg ? { parameters: JSON.stringify(src.cfg) } : {}),
    ...(m?.fingerprint ? { fingerprint: m.fingerprint } : {}),
  };
}

/** The document as JSON text. */
export function writeImasJson(src: RunSource, opts: ImasOptions = {}): string {
  return JSON.stringify(imasFromRun(src, opts), null, opts.indent ?? 0);
}

/** What readImasSummary returns: the summary IDS mapped back to the model's diagnostics and units. */
export interface ImasSummaryData {
  /** seconds */
  time: number[];
  /** model keys (`Ti`, `P_fus`, ...) in model units (keV, MW, ...); null entries read as NaN */
  series: Record<string, number[]>;
}

/** Reads the summary IDS of a document written by imasFromRun back into diagnostics (the inverse of SUMMARY_MAP). */
export function readImasSummary(doc: unknown): ImasSummaryData {
  const summary = (doc as { summary?: Obj }).summary;
  if (!summary || !Array.isArray(summary.time)) throw new Error('IMAS-like JSON: no summary IDS with a time base');
  const back = (a: Json): number[] => (a as (number | null)[]).map((v) => (v === null ? NaN : v));
  const series: Record<string, number[]> = {};
  for (const m of SUMMARY_MAP) {
    let cur: Json | undefined = summary;
    for (const k of m.path.split('.')) cur = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Obj)[k] : undefined;
    const value = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Obj).value : undefined;
    if (Array.isArray(value)) series[m.key] = back(value).map((v) => v / m.scale);
  }
  return { time: back(summary.time as Json), series };
}

/** One radial-profile slice of core_profiles mapped back to the model's profiles and units. */
export interface ImasProfileSlice { t: number; rho: number[]; profiles: Record<string, number[]> }

/** Reads core_profiles back into model profiles (Te, Ti in keV, ne in 1e20 m^-3, j in MA/m^2, p in kPa, ...). */
export function readImasProfiles(doc: unknown): ImasProfileSlice[] {
  const cp = (doc as { core_profiles?: { profiles_1d?: Obj[] } }).core_profiles;
  if (!cp?.profiles_1d) return [];
  const back = (a: Json | undefined, f: number): number[] | undefined => (Array.isArray(a) ? (a as (number | null)[]).map((v) => (v === null ? NaN : v / f)) : undefined);
  return cp.profiles_1d.map((sl) => {
    const e = (sl.electrons ?? {}) as Obj;
    const out: Record<string, number[]> = {};
    const add = (key: string, a: number[] | undefined) => { if (a) out[key] = a; };
    add('Te', back(e.temperature, 1e3)); add('ne', back(e.density, 1e20)); add('Ti', back(sl.t_i_average, 1e3));
    add('q', back(sl.q, 1)); add('shear', back(sl.magnetic_shear, 1)); add('Zeff', back(sl.zeff, 1)); add('p', back(sl.pressure_thermal, 1e3));
    add('j', back(sl.j_total, 1e6)); add('jbs', back(sl.j_bootstrap, 1e6)); add('johm', back(sl.j_ohmic, 1e6));
    return { t: sl.time as number, rho: back((sl.grid as Obj).rho_tor_norm, 1) ?? [], profiles: out };
  });
}
