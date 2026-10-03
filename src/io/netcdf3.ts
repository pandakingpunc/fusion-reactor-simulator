/**
 * NetCDF-3 (classic, `CDF-1`, and 64-bit offset, `CDF-2`) writer and reader, and the CF-annotated layout of a
 * run: no dependency, no Node API (the bytes are a Uint8Array), so a browser can offer the file as a
 * download and xarray, netCDF4-python, ncdump, Panoply and MATLAB read it.
 *
 * The format (Unidata, "NetCDF Classic and 64-bit Offset File Formats"): the magic `CDF` and a version byte
 * (1 or 2), the number of records, then the dimension list, the global attribute list and the variable
 * list (each `absent` or a tag word 10 / 12 / 11 and a count), then the data of each variable. All numbers are
 * big-endian; names and attribute values are padded with zero bytes to a multiple of four; a variable's
 * offset (`begin`) is 4 bytes in CDF-1 and 8 in CDF-2. This writer emits fixed-size dimensions only (no
 * record dimension): every run is complete when it is written. The reader also reads record variables, so
 * files written elsewhere can be read back (CDF-5 and netCDF-4/HDF5 are refused with a clear message).
 *
 * Layout of a run (netcdfFromRun): dimension `time` (one per history frame), variable `time(time)` and one
 * `double` variable per diagnostic `key(time)`; a 1.5D run adds dimensions `profile_time` and `rho`, the
 * variables `time_profiles(profile_time)`, `rho(rho)` and `profile_<key>(profile_time, rho)`. Every variable
 * has `long_name` and `units` (UDUNITS spelling, `1` for dimensionless; left out for a key whose unit is not known,
 * see DIAG_INFO and PROFILE_INFO in table.ts); the file has `Conventions = "CF-1.8"`
 * and global attributes with the method, the preset, the version, the run fingerprint, the seed and the
 * numbers of the shot report (`report_*`). NaN marks a value that is not available. The time axis is model
 * time in the model's unit (no calendar), so it carries `axis = "T"` and no reference date.
 */
import { type RunSource, cfTimeUnit, cfUnit, profilesFromSource, strictTimeSource, tableFromSource, utf8, utf8Decode } from './table';

export type NcType = 'byte' | 'char' | 'short' | 'int' | 'float' | 'double';

const CODE: Readonly<Record<NcType, number>> = { byte: 1, char: 2, short: 3, int: 4, float: 5, double: 6 };
const SIZE: Readonly<Record<NcType, number>> = { byte: 1, char: 1, short: 2, int: 4, float: 4, double: 8 };
const TYPE_OF_CODE: Readonly<Record<number, NcType>> = { 1: 'byte', 2: 'char', 3: 'short', 4: 'int', 5: 'float', 6: 'double' };

const NC_DIMENSION = 10, NC_VARIABLE = 11, NC_ATTRIBUTE = 12;

/** An attribute to write: a string is NC_CHAR, a number or array of numbers NC_DOUBLE, or state the type. */
export type NcAttr = string | number | readonly number[] | { type: Exclude<NcType, 'char'>; value: number | readonly number[] };

export interface NcDimension { name: string; size: number }
export interface NcVariable {
  name: string;
  /** dimension names, slowest-varying first (C order); empty for a scalar */
  dims: readonly string[];
  type: NcType;
  /** values in C order; for `char` a string whose UTF-8 encoding fills the variable exactly */
  data: ArrayLike<number> | string;
  attrs?: Readonly<Record<string, NcAttr>>;
}
export interface NcDataset {
  dims: readonly NcDimension[];
  attrs?: Readonly<Record<string, NcAttr>>;
  vars: readonly NcVariable[];
}

export interface NetcdfOptions {
  /** 'cdf1' (classic), 'cdf2' (64-bit offsets) or 'auto' (default): cdf1 unless an offset would pass 2 GiB - 1 */
  format?: 'cdf1' | 'cdf2' | 'auto';
}

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_@.+-]*$/;
const pad4 = (n: number): number => (4 - (n & 3)) & 3;

/** A name that netCDF accepts: characters outside [A-Za-z0-9_@.+-] become '_', a leading '-', '.', '+' or '@' gets a '_' in front. */
export function ncName(key: string): string {
  const s = key.replace(/[^A-Za-z0-9_@.+-]/g, '_');
  return /^[A-Za-z0-9_]/.test(s) ? s : `_${s}`;
}

/** Growable big-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.length, v, false); this.length += 4; }
  u64(v: number): void { this.ensure(8); this.view.setUint32(this.length, Math.floor(v / 4294967296), false); this.view.setUint32(this.length + 4, v >>> 0, false); this.length += 8; }
  raw(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  zeros(n: number): void { this.ensure(n); this.length += n; }
  name(s: string): void { const b = utf8(s); this.u32(b.length); this.raw(b); this.zeros(pad4(b.length)); }
  result(): Uint8Array { return this.buf.slice(0, this.length); }
}

interface EncodedAttr { type: NcType; bytes: Uint8Array; n: number }

function encodeAttr(name: string, a: NcAttr): EncodedAttr {
  if (typeof a === 'string') { const b = utf8(a); return { type: 'char', bytes: b, n: b.length }; }
  const type: NcType = typeof a === 'number' || Array.isArray(a) ? 'double' : (a as { type: NcType }).type;
  const vals: readonly number[] = typeof a === 'number' ? [a] : Array.isArray(a) ? (a as readonly number[]) : typeof (a as { value: unknown }).value === 'number' ? [(a as { value: number }).value] : (a as { value: readonly number[] }).value;
  if (type === 'char') throw new Error(`netCDF attribute '${name}': char attributes are strings`);
  const bytes = new Uint8Array(vals.length * SIZE[type]);
  writeValues(new DataView(bytes.buffer), 0, type, vals);
  return { type, bytes, n: vals.length };
}

function writeValues(view: DataView, at: number, type: NcType, vals: ArrayLike<number>): void {
  const sz = SIZE[type];
  for (let i = 0; i < vals.length; i++) {
    const o = at + i * sz, v = vals[i];
    switch (type) {
      case 'double': view.setFloat64(o, v, false); break;
      case 'float': view.setFloat32(o, v, false); break;
      case 'int': view.setInt32(o, v, false); break;
      case 'short': view.setInt16(o, v, false); break;
      case 'byte': view.setInt8(o, v); break;
      case 'char': view.setUint8(o, v); break;
    }
  }
}

function writeAttrList(w: Bytes, attrs: Readonly<Record<string, NcAttr>> | undefined): void {
  const names = Object.keys(attrs ?? {});
  if (!names.length) { w.u32(0); w.u32(0); return; }
  w.u32(NC_ATTRIBUTE); w.u32(names.length);
  for (const n of names) {
    if (!NAME_RE.test(n)) throw new Error(`netCDF: invalid attribute name '${n}'`);
    const e = encodeAttr(n, attrs![n]);
    w.name(n); w.u32(CODE[e.type]); w.u32(e.n); w.raw(e.bytes); w.zeros(pad4(e.bytes.length));
  }
}

/** Where everything goes in the file; computed before any data is touched. */
export interface NetcdfLayout {
  /** 1 (CDF-1) or 2 (CDF-2) */
  version: 1 | 2;
  headerLength: number;
  /** byte offset of each variable's data, in variable order */
  begins: number[];
  /** total file size */
  size: number;
}

/**
 * Plans the file of a dataset: validates it, chooses the format ('auto': CDF-1 unless an offset would pass
 * 2 GiB - 1, then CDF-2; 'cdf1' throws in that case) and computes every offset. Nothing is allocated for the data.
 */
export function planNetcdf3(ds: NcDataset, opts: NetcdfOptions = {}): NetcdfLayout & { vsize: number[]; counts: number[]; dimId: Map<string, number> } {
  const dimId = new Map<string, number>();
  ds.dims.forEach((d, i) => {
    if (!NAME_RE.test(d.name)) throw new Error(`netCDF: invalid dimension name '${d.name}'`);
    if (dimId.has(d.name)) throw new Error(`netCDF: duplicate dimension '${d.name}'`);
    if (!Number.isInteger(d.size) || d.size < 1 || d.size > 0xffffffff) throw new Error(`netCDF: dimension '${d.name}' needs a size of at least 1, got ${d.size}`);
    dimId.set(d.name, i);
  });
  const seen = new Set<string>();
  const counts: number[] = [], vsize: number[] = [];
  for (const v of ds.vars) {
    if (!NAME_RE.test(v.name)) throw new Error(`netCDF: invalid variable name '${v.name}'`);
    if (seen.has(v.name)) throw new Error(`netCDF: duplicate variable '${v.name}'`);
    seen.add(v.name);
    let n = 1;
    for (const dn of v.dims) {
      const id = dimId.get(dn);
      if (id === undefined) throw new Error(`netCDF: variable '${v.name}' uses the undefined dimension '${dn}'`);
      n *= ds.dims[id].size;
    }
    if (typeof v.data === 'string') {
      if (v.type !== 'char') throw new Error(`netCDF: variable '${v.name}' has string data but type ${v.type}`);
      const len = utf8(v.data).length;
      if (len !== n) throw new Error(`netCDF: variable '${v.name}' holds ${len} bytes, its dimensions need ${n}`);
    } else if (v.data.length !== n) throw new Error(`netCDF: variable '${v.name}' holds ${v.data.length} values, its dimensions need ${n}`);
    counts.push(n);
    const bytes = n * SIZE[v.type];
    vsize.push(bytes + pad4(bytes));
  }
  const layout = (version: 1 | 2): NetcdfLayout => {
    const headerLength = headerBytes(ds, dimId, vsize, new Array<number>(ds.vars.length).fill(0), version).length;
    const begins: number[] = [];
    let off = headerLength;
    for (const s of vsize) { begins.push(off); off += s; }
    return { version, headerLength, begins, size: off };
  };
  const want = opts.format ?? 'auto';
  let plan = layout(want === 'cdf2' ? 2 : 1);
  if (want === 'auto' && plan.size > 0x7fffffff) plan = layout(2);
  if (want === 'cdf1' && plan.size > 0x7fffffff) throw new Error('netCDF: the file needs 64-bit offsets (format: cdf2)');
  return { ...plan, vsize, counts, dimId };
}

function headerBytes(ds: NcDataset, dimId: Map<string, number>, vsize: number[], begins: number[], version: 1 | 2): Uint8Array {
  const w = new Bytes();
  w.raw(Uint8Array.of(0x43, 0x44, 0x46, version));
  w.u32(0); // numrecs: no record variable
  if (!ds.dims.length) { w.u32(0); w.u32(0); } else { w.u32(NC_DIMENSION); w.u32(ds.dims.length); for (const d of ds.dims) { w.name(d.name); w.u32(d.size); } }
  writeAttrList(w, ds.attrs);
  if (!ds.vars.length) { w.u32(0); w.u32(0); } else {
    w.u32(NC_VARIABLE); w.u32(ds.vars.length);
    ds.vars.forEach((v, i) => {
      w.name(v.name); w.u32(v.dims.length);
      for (const dn of v.dims) w.u32(dimId.get(dn)!);
      writeAttrList(w, v.attrs);
      w.u32(CODE[v.type]);
      w.u32(vsize[i] > 0xfffffffb ? 0xffffffff : vsize[i]);
      if (version === 2) w.u64(begins[i]); else w.u32(begins[i]);
    });
  }
  return w.result();
}

/** Encodes a dataset as netCDF-3 bytes. */
export function writeNetcdf3(ds: NcDataset, opts: NetcdfOptions = {}): Uint8Array {
  const plan = planNetcdf3(ds, opts);
  const out = new Uint8Array(plan.size);
  out.set(headerBytes(ds, plan.dimId, plan.vsize, plan.begins, plan.version));
  const view = new DataView(out.buffer);
  ds.vars.forEach((v, i) => {
    if (typeof v.data === 'string') out.set(utf8(v.data), plan.begins[i]);
    else writeValues(view, plan.begins[i], v.type, v.data);
  });
  return out;
}

// ── reader ──────────────────────────────────────────────────────────────────────────────────────────

export interface NcReadAttr { type: NcType; value: string | number[] }
export interface NcReadDimension { name: string; size: number; unlimited: boolean }
export interface NcReadVariable {
  name: string;
  dims: string[];
  type: NcType;
  attrs: Record<string, NcReadAttr>;
  /** length of each dimension (the record dimension: the number of records) */
  shape: number[];
  data: Float64Array | Float32Array | Int32Array | Int16Array | Int8Array | string;
}
export interface NcFile {
  version: 1 | 2;
  numrecs: number;
  dims: NcReadDimension[];
  attrs: Record<string, NcReadAttr>;
  vars: Record<string, NcReadVariable>;
}

/** Decodes netCDF-3 bytes (CDF-1 or CDF-2, fixed and record variables). Throws a descriptive Error for anything else. */
export function readNetcdf3(bytes: Uint8Array): NcFile {
  if (bytes.length < 8) throw new Error('netCDF: file too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && bytes[1] === 0x48 && bytes[2] === 0x44 && bytes[3] === 0x46) throw new Error('netCDF: this is a netCDF-4/HDF5 file; only netCDF-3 (CDF-1, CDF-2) is supported');
  if (bytes[0] !== 0x43 || bytes[1] !== 0x44 || bytes[2] !== 0x46) throw new Error('netCDF: not a netCDF classic file (bad magic number)');
  const version = bytes[3];
  if (version === 5) throw new Error('netCDF: CDF-5 (64-bit data) is not supported');
  if (version !== 1 && version !== 2) throw new Error(`netCDF: unsupported version byte ${version}`);
  let pos = 4;
  const u32 = (): number => { if (pos + 4 > bytes.length) throw new Error('netCDF: truncated header'); const v = view.getUint32(pos, false); pos += 4; return v; };
  const u64 = (): number => { const hi = u32(), lo = u32(); return hi * 4294967296 + lo; };
  const str = (): string => {
    const n = u32();
    if (pos + n > bytes.length) throw new Error('netCDF: truncated header');
    const s = utf8Decode(bytes.subarray(pos, pos + n));
    pos += n + pad4(n);
    return s;
  };
  let numrecs = u32();
  const streaming = numrecs === 0xffffffff;

  const listHeader = (tag: number, what: string): number => {
    const t = u32(), n = u32();
    if (t === 0 && n === 0) return 0;
    if (t !== tag) throw new Error(`netCDF: malformed ${what} list`);
    return n;
  };
  const dims: NcReadDimension[] = [];
  for (let i = listHeader(NC_DIMENSION, 'dimension'), k = 0; k < i; k++) { const name = str(), size = u32(); dims.push({ name, size, unlimited: size === 0 }); }

  const readAttrs = (): Record<string, NcReadAttr> => {
    const out: Record<string, NcReadAttr> = {};
    const n = listHeader(NC_ATTRIBUTE, 'attribute');
    for (let k = 0; k < n; k++) {
      const name = str();
      const type = TYPE_OF_CODE[u32()];
      if (!type) throw new Error(`netCDF: attribute '${name}' has an unknown type`);
      const cnt = u32();
      const nbytes = cnt * SIZE[type];
      if (pos + nbytes > bytes.length) throw new Error('netCDF: truncated header');
      out[name] = { type, value: type === 'char' ? utf8Decode(bytes.subarray(pos, pos + cnt)) : readValues(view, pos, type, cnt) };
      pos += nbytes + pad4(nbytes);
    }
    return out;
  };
  const attrs = readAttrs();

  interface RawVar { name: string; dimIds: number[]; attrs: Record<string, NcReadAttr>; type: NcType; vsize: number; begin: number }
  const raw: RawVar[] = [];
  const nv = listHeader(NC_VARIABLE, 'variable');
  for (let k = 0; k < nv; k++) {
    const name = str();
    const rank = u32();
    const dimIds: number[] = [];
    for (let j = 0; j < rank; j++) { const id = u32(); if (id >= dims.length) throw new Error(`netCDF: variable '${name}' refers to dimension ${id}, which does not exist`); dimIds.push(id); }
    const va = readAttrs();
    const type = TYPE_OF_CODE[u32()];
    if (!type) throw new Error(`netCDF: variable '${name}' has an unknown type`);
    const vsize = u32();
    const begin = version === 2 ? u64() : u32();
    raw.push({ name, dimIds, attrs: va, type, vsize, begin });
  }
  const isRec = (r: RawVar): boolean => r.dimIds.length > 0 && dims[r.dimIds[0]].unlimited;
  const recVars = raw.filter(isRec);
  // one record variable: its records are not padded (Unidata: "special case")
  const recStride = recVars.length === 1
    ? recVars[0].dimIds.slice(1).reduce((n, id) => n * dims[id].size, 1) * SIZE[recVars[0].type]
    : recVars.reduce((n, r) => n + r.vsize, 0);
  if (streaming) numrecs = recStride > 0 && recVars.length ? Math.floor((bytes.length - Math.min(...recVars.map((r) => r.begin))) / recStride) : 0;

  const vars: Record<string, NcReadVariable> = {};
  for (const r of raw) {
    const shape = r.dimIds.map((id, i) => (i === 0 && dims[id].unlimited ? numrecs : dims[id].size));
    const per = r.dimIds.slice(isRec(r) ? 1 : 0).reduce((n, id) => n * dims[id].size, 1);
    const total = shape.reduce((a, b) => a * b, 1);
    let data: NcReadVariable['data'];
    const chunks: { at: number; n: number }[] = isRec(r)
      ? Array.from({ length: numrecs }, (_, k) => ({ at: r.begin + k * recStride, n: per }))
      : [{ at: r.begin, n: total }];
    for (const c of chunks) if (c.at + c.n * SIZE[r.type] > bytes.length) throw new Error(`netCDF: the data of variable '${r.name}' runs past the end of the file`);
    if (r.type === 'char') {
      const parts = chunks.map((c) => utf8Decode(bytes.subarray(c.at, c.at + c.n)));
      data = parts.join('');
    } else {
      const arr = r.type === 'double' ? new Float64Array(total) : r.type === 'float' ? new Float32Array(total) : r.type === 'int' ? new Int32Array(total) : r.type === 'short' ? new Int16Array(total) : new Int8Array(total);
      let o = 0;
      for (const c of chunks) { arr.set(readValues(view, c.at, r.type, c.n), o); o += c.n; }
      data = arr;
    }
    vars[r.name] = { name: r.name, dims: r.dimIds.map((id) => dims[id].name), type: r.type, attrs: r.attrs, shape, data };
  }
  return { version: version as 1 | 2, numrecs, dims, attrs, vars };
}

function readValues(view: DataView, at: number, type: NcType, n: number): number[] {
  const out = new Array<number>(n);
  const sz = SIZE[type];
  for (let i = 0; i < n; i++) {
    const o = at + i * sz;
    out[i] = type === 'double' ? view.getFloat64(o, false) : type === 'float' ? view.getFloat32(o, false) : type === 'int' ? view.getInt32(o, false) : type === 'short' ? view.getInt16(o, false) : type === 'byte' ? view.getInt8(o) : view.getUint8(o);
  }
  return out;
}

// ── a run as a CF-annotated dataset ─────────────────────────────────────────────────────────────────

export interface RunNetcdfOptions extends NetcdfOptions {
  /** the diagnostics to write (default: all of them) */
  keys?: readonly string[];
  /** write the radial profiles of a 1.5D run (default true) */
  profiles?: boolean;
  /** keep every n-th profile frame (default 1) */
  profileEvery?: number;
}

const finiteReport = (o: unknown, prefix: string, out: Record<string, NcAttr>): void => {
  if (typeof o !== 'object' || o === null) return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[ncName(`${prefix}${k}`)] = v;
    else if (typeof v === 'boolean') out[ncName(`${prefix}${k}`)] = { type: 'int', value: v ? 1 : 0 };
  }
};

/**
 * `units` in UDUNITS spelling and, when it differs, the model's own spelling in `units_original`. A column whose unit is
 * not known gets neither: `1` would claim it is dimensionless.
 */
const unitsOf = (unit: string | undefined): { units?: string; units_original?: string } => {
  if (unit === undefined) return {};
  const units = cfUnit(unit);
  return units !== (unit === '' ? '1' : unit) ? { units, units_original: unit } : { units };
};

/** The netCDF dataset of a run (see the file header for the layout). */
export function netcdfFromRun(source: RunSource, opts: RunNetcdfOptions = {}): NcDataset {
  const { src, dropped } = strictTimeSource(source);
  const tab = tableFromSource(src, opts.keys);
  const prof = opts.profiles === false ? undefined : profilesFromSource(src, { every: opts.profileEvery });
  const dims: NcDimension[] = [{ name: 'time', size: tab.t.length }];
  const vars: NcVariable[] = [{
    name: 'time', dims: ['time'], type: 'double', data: tab.t,
    attrs: { long_name: 'simulation time', units: cfTimeUnit(tab.timeUnit), axis: 'T' },
  }];
  const used = new Set<string>(['time']);
  const unique = (n: string): string => { let s = ncName(n), k = 2; while (used.has(s)) s = `${ncName(n)}_${k++}`; used.add(s); return s; };
  tab.columns.forEach((c, i) => {
    const attrs: Record<string, NcAttr> = { long_name: c.label, ...unitsOf(c.unit) };
    if (c.group) attrs.group = c.group;
    attrs.diagnostic_key = c.key;
    vars.push({ name: unique(c.key), dims: ['time'], type: 'double', data: tab.values[i], attrs });
  });
  if (prof) {
    dims.push({ name: 'profile_time', size: prof.t.length }, { name: 'rho', size: prof.rho.length });
    used.add('time_profiles'); used.add('rho');
    vars.push({ name: 'time_profiles', dims: ['profile_time'], type: 'double', data: prof.t, attrs: { long_name: 'time of the radial profiles', units: cfTimeUnit(tab.timeUnit), axis: 'T' } });
    vars.push({ name: 'rho', dims: ['rho'], type: 'double', data: prof.rho, attrs: { long_name: 'normalised toroidal flux radius rho_tor (cell centres)', units: '1' } });
    prof.columns.forEach((c, i) => {
      const flat: number[] = [];
      for (const frame of prof.values[i]) flat.push(...frame);
      const { units, units_original } = unitsOf(c.unit);
      const attrs: Record<string, NcAttr> = { long_name: c.label, ...(units === undefined ? {} : { units }), profile_key: c.key };
      if (units_original !== undefined) attrs.units_original = units_original;
      vars.push({ name: unique(`profile_${c.key}`), dims: ['profile_time', 'rho'], type: 'double', data: flat, attrs });
    });
  }
  const g: Record<string, NcAttr> = {
    Conventions: 'CF-1.8',
    title: `Fusion Reactor Simulator run${src.meta?.preset ? `: ${src.meta.preset}` : ''}`,
    source: `fusion-reactor-simulator${src.meta?.version ? ` ${src.meta.version}` : ''}`,
    ...(src.meta?.created ? { history: `${src.meta.created} created by fusion-sim` } : {}),
    comment: src.meta?.comment ?? 'Diagnostics are model time traces; NaN marks a value that is not available. The time axis is simulation time, not a calendar.',
    ...(src.method ? { simulation_method: src.method } : {}),
    ...(src.meta?.preset ? { simulation_preset: src.meta.preset } : {}),
    ...(src.meta?.version ? { simulation_version: src.meta.version } : {}),
    ...(src.meta?.commit ? { simulation_commit: src.meta.commit } : {}),
    ...(src.meta?.fingerprint ? { simulation_fingerprint: src.meta.fingerprint } : {}),
    ...(src.meta?.configSha256 ? { simulation_config_sha256: src.meta.configSha256 } : {}),
    ...(src.meta?.scenarioSha256 ? { simulation_scenario_sha256: src.meta.scenarioSha256 } : {}),
    ...(src.cfg && typeof (src.cfg as { seed?: unknown }).seed === 'number' ? { simulation_seed: (src.cfg as { seed: number }).seed } : {}),
    simulation_time_unit: src.timeUnit,
    simulation_events: { type: 'int', value: src.events.length },
    ...(dropped ? { simulation_dropped_frames: { type: 'int' as const, value: dropped } } : {}),
  };
  if (src.report) {
    g.simulation_end_reason = src.report.termination.reason;
    g.simulation_natural_end = { type: 'int', value: src.report.termination.natural ? 1 : 0 };
    finiteReport(src.report, 'report_', g);
    finiteReport(src.report.extras, 'report_extras_', g);
    finiteReport(src.report.engineering, 'report_engineering_', g);
  }
  return { dims, attrs: g, vars };
}

/** A run as netCDF-3 bytes. */
export function writeRunNetcdf(src: RunSource, opts: RunNetcdfOptions = {}): Uint8Array {
  return writeNetcdf3(netcdfFromRun(src, opts), opts);
}
