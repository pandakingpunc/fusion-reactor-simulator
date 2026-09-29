import { describe, expect, it } from 'vitest';
import { type NcDataset, ncName, netcdfFromRun, planNetcdf3, readNetcdf3, writeNetcdf3, writeRunNetcdf } from './netcdf3';
import { cfUnit, tableFromSource } from './table';
import { jet, nif, sparc15 } from './testdata/fixtures';

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/**
 * The bytes of a one-dimension, one-attribute, one-variable file worked out by hand from the format
 * specification (Unidata, "NetCDF Classic and 64-bit Offset File Formats"), independently of the writer.
 */
const TINY: NcDataset = {
  dims: [{ name: 'x', size: 2 }],
  attrs: { a: 'hi' },
  vars: [{ name: 'v', dims: ['x'], type: 'short', data: [1, 2] }],
};
const TINY_CDF1 = [
  '43 44 46 01', // magic, version 1
  '00 00 00 00', // numrecs
  '00 00 00 0a 00 00 00 01', // NC_DIMENSION, 1 dimension
  '00 00 00 01 78 00 00 00', //   name "x" padded to 4
  '00 00 00 02', //               length 2
  '00 00 00 0c 00 00 00 01', // NC_ATTRIBUTE, 1 global attribute
  '00 00 00 01 61 00 00 00', //   name "a"
  '00 00 00 02', //               NC_CHAR
  '00 00 00 02', //               2 values
  '68 69 00 00', //               "hi" padded
  '00 00 00 0b 00 00 00 01', // NC_VARIABLE, 1 variable
  '00 00 00 01 76 00 00 00', //   name "v"
  '00 00 00 01', //               rank 1
  '00 00 00 00', //               dimension id 0
  '00 00 00 00 00 00 00 00', //   no attributes (ABSENT)
  '00 00 00 03', //               NC_SHORT
  '00 00 00 04', //               vsize: 2 x 2 bytes
  '00 00 00 64', //               begin = 100, the length of the header
  '00 01 00 02', // data, big-endian
].join(' ');

describe('the writer, against bytes derived from the specification', () => {
  it('CDF-1: a one-variable file is byte-exact', () => {
    expect(hex(writeNetcdf3(TINY, { format: 'cdf1' }))).toBe(TINY_CDF1);
  });
  it('CDF-2: the same file with 8-byte offsets (magic 2, begin one word wider)', () => {
    const bytes = writeNetcdf3(TINY, { format: 'cdf2' });
    const cdf2 = TINY_CDF1
      .replace('43 44 46 01', '43 44 46 02')
      .replace('00 00 00 04 00 00 00 64', '00 00 00 04 00 00 00 00 00 00 00 68');
    expect(hex(bytes)).toBe(cdf2);
  });
  it("'auto' picks CDF-1 for a small file", () => {
    expect(hex(writeNetcdf3(TINY))).toBe(TINY_CDF1);
  });
  it('a scalar double and a padded byte variable: offsets and padding', () => {
    const ds: NcDataset = {
      dims: [{ name: 'n', size: 3 }],
      vars: [
        { name: 's', dims: [], type: 'double', data: [1.5] },
        { name: 'b', dims: ['n'], type: 'byte', data: [1, 2, 3] },
        { name: 'f', dims: ['n'], type: 'float', data: [0.5, -2, 3] },
      ],
    };
    const bytes = writeNetcdf3(ds);
    const f = readNetcdf3(bytes);
    expect(f.vars.s.data).toEqual(Float64Array.of(1.5));
    expect(Array.from(f.vars.b.data as Int8Array)).toEqual([1, 2, 3]);
    expect(Array.from(f.vars.f.data as Float32Array)).toEqual([0.5, -2, 3]);
    // total size: header + 8 (double) + 4 (3 bytes padded) + 12 (floats)
    const headerLen = bytes.length - (8 + 4 + 12);
    const dv = new DataView(bytes.buffer);
    // begin of the third variable is the last word before... locate through the reader instead: data of b starts 8 after s
    expect(bytes.slice(headerLen, headerLen + 8)).toEqual(Uint8Array.of(0x3f, 0xf8, 0, 0, 0, 0, 0, 0)); // 1.5 as big-endian IEEE double
    expect(bytes.slice(headerLen + 8, headerLen + 12)).toEqual(Uint8Array.of(1, 2, 3, 0)); // padded with a zero
    expect(dv.getFloat32(headerLen + 12, false)).toBe(0.5);
  });
  it('an empty dataset is a valid file', () => {
    const b = writeNetcdf3({ dims: [], vars: [] });
    expect(hex(b)).toBe(['43 44 46 01', '00 00 00 00', '00 00 00 00 00 00 00 00', '00 00 00 00 00 00 00 00', '00 00 00 00 00 00 00 00'].join(' ')); // magic, numrecs, three absent lists
    expect(readNetcdf3(b)).toMatchObject({ version: 1, numrecs: 0, dims: [], attrs: {}, vars: {} });
  });
});

describe('write then read', () => {
  it('every type, attributes of every kind, a scalar, a 2-D variable, a char variable', () => {
    const ds: NcDataset = {
      dims: [{ name: 't', size: 4 }, { name: 'x', size: 3 }, { name: 'c', size: 5 }],
      attrs: { title: 'héllo µ', pi: Math.PI, list: [1, 2.5, -3], n: { type: 'int', value: -7 }, s: { type: 'short', value: [1, 2, 3] }, f: { type: 'float', value: 0.1 }, b: { type: 'byte', value: [-1, 2] } },
      vars: [
        { name: 'd', dims: ['t'], type: 'double', data: [NaN, Infinity, -Infinity, -0], attrs: { units: 'm', scale: 2 } },
        { name: 'i', dims: ['t'], type: 'int', data: [1, -2, 2147483647, -2147483648] },
        { name: 'sh', dims: ['t'], type: 'short', data: [32767, -32768, 0, 5] },
        { name: 'fl', dims: ['t'], type: 'float', data: [0.1, 1e30, -1e-30, 0] },
        { name: 'by', dims: ['t'], type: 'byte', data: [127, -128, 0, 1] },
        { name: 'm', dims: ['t', 'x'], type: 'double', data: Array.from({ length: 12 }, (_, k) => k * 1.1) },
        { name: 'ch', dims: ['c'], type: 'char', data: 'abcde' },
        { name: 'sc', dims: [], type: 'int', data: [42] },
      ],
    };
    for (const format of ['cdf1', 'cdf2'] as const) {
      const f = readNetcdf3(writeNetcdf3(ds, { format }));
      expect(f.version).toBe(format === 'cdf1' ? 1 : 2);
      expect(f.dims.map((d) => [d.name, d.size, d.unlimited])).toEqual([['t', 4, false], ['x', 3, false], ['c', 5, false]]);
      expect(f.attrs.title).toEqual({ type: 'char', value: 'héllo µ' });
      expect(f.attrs.pi).toEqual({ type: 'double', value: [Math.PI] });
      expect(f.attrs.list).toEqual({ type: 'double', value: [1, 2.5, -3] });
      expect(f.attrs.n).toEqual({ type: 'int', value: [-7] });
      expect(f.attrs.s).toEqual({ type: 'short', value: [1, 2, 3] });
      expect(f.attrs.f).toEqual({ type: 'float', value: [Math.fround(0.1)] });
      expect(f.attrs.b).toEqual({ type: 'byte', value: [-1, 2] });
      const d = f.vars.d.data as Float64Array;
      expect(d[0]).toBeNaN();
      expect(d[1]).toBe(Infinity);
      expect(d[2]).toBe(-Infinity);
      expect(Object.is(d[3], -0)).toBe(true);
      expect(f.vars.d.attrs.units).toEqual({ type: 'char', value: 'm' });
      expect(f.vars.d.attrs.scale).toEqual({ type: 'double', value: [2] });
      expect(Array.from(f.vars.i.data as Int32Array)).toEqual([1, -2, 2147483647, -2147483648]);
      expect(Array.from(f.vars.sh.data as Int16Array)).toEqual([32767, -32768, 0, 5]);
      expect(Array.from(f.vars.fl.data as Float32Array)).toEqual([0.1, 1e30, -1e-30, 0].map(Math.fround));
      expect(Array.from(f.vars.by.data as Int8Array)).toEqual([127, -128, 0, 1]);
      expect(Array.from(f.vars.m.data as Float64Array)).toEqual(Array.from({ length: 12 }, (_, k) => k * 1.1));
      expect(f.vars.m.dims).toEqual(['t', 'x']);
      expect(f.vars.m.shape).toEqual([4, 3]);
      expect(f.vars.ch.data).toBe('abcde');
      expect(f.vars.sc.shape).toEqual([]);
      expect(Array.from(f.vars.sc.data as Int32Array)).toEqual([42]);
    }
  });
  it('a file bigger than a few kB, a long attribute needing padding, names with dots and dashes', () => {
    const data = Array.from({ length: 5000 }, (_, k) => Math.sin(k));
    const ds: NcDataset = {
      dims: [{ name: 'n', size: 5000 }],
      attrs: { 'a.b-c+d@e': 'x'.repeat(13) },
      vars: [{ name: 'v.1', dims: ['n'], type: 'double', data }],
    };
    const f = readNetcdf3(writeNetcdf3(ds));
    expect(f.attrs['a.b-c+d@e'].value).toBe('x'.repeat(13));
    expect(Array.from(f.vars['v.1'].data as Float64Array)).toEqual(data);
  });
});

describe('the writer refuses what the format cannot hold', () => {
  const one = (over: Partial<NcDataset>): NcDataset => ({ dims: [{ name: 'n', size: 2 }], vars: [{ name: 'v', dims: ['n'], type: 'double', data: [1, 2] }], ...over });
  it('bad names', () => {
    expect(() => writeNetcdf3(one({ dims: [{ name: 'a b', size: 2 }] }))).toThrow(/invalid dimension name/);
    expect(() => writeNetcdf3(one({ vars: [{ name: '-x', dims: ['n'], type: 'double', data: [1, 2] }] }))).toThrow(/invalid variable name/);
    expect(() => writeNetcdf3(one({ attrs: { 'a/b': 1 } }))).toThrow(/invalid attribute name/);
  });
  it('duplicates', () => {
    expect(() => writeNetcdf3(one({ dims: [{ name: 'n', size: 2 }, { name: 'n', size: 3 }] }))).toThrow(/duplicate dimension/);
    expect(() => writeNetcdf3(one({ vars: [{ name: 'v', dims: ['n'], type: 'double', data: [1, 2] }, { name: 'v', dims: ['n'], type: 'double', data: [1, 2] }] }))).toThrow(/duplicate variable/);
  });
  it('dimension sizes and data lengths that do not fit', () => {
    expect(() => writeNetcdf3(one({ dims: [{ name: 'n', size: 0 }] }))).toThrow(/at least 1/);
    expect(() => writeNetcdf3(one({ dims: [{ name: 'n', size: 1.5 }] }))).toThrow(/at least 1/);
    expect(() => writeNetcdf3(one({ vars: [{ name: 'v', dims: ['n'], type: 'double', data: [1] }] }))).toThrow(/holds 1 values, its dimensions need 2/);
    expect(() => writeNetcdf3(one({ vars: [{ name: 'v', dims: ['nope'], type: 'double', data: [1] }] }))).toThrow(/undefined dimension 'nope'/);
    expect(() => writeNetcdf3(one({ vars: [{ name: 'v', dims: ['n'], type: 'char', data: 'abc' }] }))).toThrow(/holds 3 bytes, its dimensions need 2/);
    expect(() => writeNetcdf3(one({ vars: [{ name: 'v', dims: ['n'], type: 'double', data: 'ab' }] }))).toThrow(/string data but type double/);
  });
  it('a numeric attribute cannot be char', () => {
    expect(() => writeNetcdf3(one({ attrs: { a: { type: 'char' as never, value: 1 } } }))).toThrow(/char attributes are strings/);
  });
  it('a file past 2 GiB needs 64-bit offsets: cdf1 is refused, auto and cdf2 plan CDF-2 (laid out without allocating the data)', () => {
    const n = 2 ** 28 + 16; // 2 GiB + 128 B of doubles
    const ds: NcDataset = { dims: [{ name: 'n', size: n }], vars: [{ name: 'v', dims: ['n'], type: 'double', data: { length: n } as ArrayLike<number> }] };
    expect(() => writeNetcdf3(ds, { format: 'cdf1' })).toThrow(/64-bit offsets/);
    const auto = planNetcdf3(ds);
    expect(auto.version).toBe(2);
    expect(auto.begins[0]).toBe(auto.headerLength);
    expect(auto.size).toBe(auto.headerLength + n * 8);
    expect(planNetcdf3(ds, { format: 'cdf2' }).version).toBe(2);
    const small = planNetcdf3({ dims: [{ name: 'n', size: 3 }], vars: [{ name: 'v', dims: ['n'], type: 'double', data: [1, 2, 3] }] });
    expect(small.version).toBe(1);
    expect(small.size).toBe(small.headerLength + 24);
  });
});

describe('the reader', () => {
  it('reads a file with a record dimension: fixed and record variables, several record variables interleaved', () => {
    // dims: t (unlimited), x = 2.  vars: fixed(x) double; a(t) int; b(t, x) short.  2 records.
    const w = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const name = (str: string) => [...w(str.length), ...Array.from(str, (c) => c.charCodeAt(0)), ...new Array<number>((4 - (str.length % 4)) % 4).fill(0)];
    const header = (begins: number[]) => [
      0x43, 0x44, 0x46, 1, ...w(2), // magic, numrecs = 2
      ...w(10), ...w(2), ...name('t'), ...w(0), ...name('x'), ...w(2),
      ...w(0), ...w(0), // no global attributes
      ...w(11), ...w(3),
      ...name('fixed'), ...w(1), ...w(1), ...w(0), ...w(0), ...w(6), ...w(16), ...w(begins[0]),
      ...name('a'), ...w(1), ...w(0), ...w(0), ...w(0), ...w(4), ...w(4), ...w(begins[1]),
      ...name('b'), ...w(2), ...w(0), ...w(1), ...w(0), ...w(0), ...w(3), ...w(4), ...w(begins[2]),
    ];
    const len = header([0, 0, 0]).length;
    const fixedBegin = len, recBegin = len + 16;
    const f64 = new Uint8Array(16);
    new DataView(f64.buffer).setFloat64(0, 0.25, false);
    new DataView(f64.buffer).setFloat64(8, -8, false);
    const rec = [...w(10), 0, 1, 0, 2, ...w(20), 0, 3, 0, 4]; // record k: a (int), b (2 shorts)
    const file = Uint8Array.from([...header([fixedBegin, recBegin, recBegin + 4]), ...f64, ...rec]);
    const r = readNetcdf3(file);
    expect(r.numrecs).toBe(2);
    expect(r.dims).toEqual([{ name: 't', size: 0, unlimited: true }, { name: 'x', size: 2, unlimited: false }]);
    expect(Array.from(r.vars.fixed.data as Float64Array)).toEqual([0.25, -8]);
    expect(Array.from(r.vars.a.data as Int32Array)).toEqual([10, 20]);
    expect(r.vars.a.shape).toEqual([2]);
    expect(Array.from(r.vars.b.data as Int16Array)).toEqual([1, 2, 3, 4]);
    expect(r.vars.b.shape).toEqual([2, 2]);
    // a streaming file (numrecs = 0xFFFFFFFF) is read by the length of the data
    const streamed = Uint8Array.from(file);
    streamed.set([0xff, 0xff, 0xff, 0xff], 4);
    expect(readNetcdf3(streamed).numrecs).toBe(2);
  });
  it('refuses files that are not netCDF-3, with a message that says what they are', () => {
    expect(() => readNetcdf3(Uint8Array.of(1, 2, 3))).toThrow(/too short/);
    expect(() => readNetcdf3(new Uint8Array(16))).toThrow(/not a netCDF classic file/);
    expect(() => readNetcdf3(Uint8Array.of(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a))).toThrow(/netCDF-4\/HDF5/);
    expect(() => readNetcdf3(Uint8Array.of(0x43, 0x44, 0x46, 5, 0, 0, 0, 0))).toThrow(/CDF-5/);
    expect(() => readNetcdf3(Uint8Array.of(0x43, 0x44, 0x46, 9, 0, 0, 0, 0))).toThrow(/version byte 9/);
  });
  it('detects a truncated file and data that runs past the end', () => {
    const good = writeNetcdf3(TINY);
    expect(() => readNetcdf3(good.slice(0, 30))).toThrow(/truncated/);
    expect(() => readNetcdf3(good.slice(0, good.length - 2))).toThrow(/runs past the end/);
  });
});

describe('a run as a CF dataset', () => {
  it('0D run: time and one double variable per diagnostic, CF attributes, provenance', () => {
    const { src } = jet();
    const f = readNetcdf3(writeRunNetcdf(src));
    expect(f.attrs.Conventions).toEqual({ type: 'char', value: 'CF-1.8' });
    expect(f.attrs.source.value).toBe('fusion-reactor-simulator 4.0.0-test');
    expect(f.attrs.simulation_method.value).toBe('tokamak');
    expect(f.attrs.simulation_preset.value).toBe('JET');
    expect(f.attrs.simulation_fingerprint.value).toBe('f'.repeat(64));
    expect(f.attrs.simulation_seed.value).toEqual([7]);
    expect(f.attrs.simulation_end_reason.value).toBe(src.report!.termination.reason);
    expect(f.attrs.simulation_natural_end.value).toEqual([1]);
    expect(f.attrs.report_Q_sci_max.value).toEqual([src.report!.Q_sci_max]);
    expect(f.attrs.history).toBeUndefined();
    expect(f.dims).toEqual([{ name: 'time', size: src.history.length, unlimited: false }]);
    expect(f.vars.time.attrs).toEqual({ long_name: { type: 'char', value: 'simulation time' }, units: { type: 'char', value: 's' }, axis: { type: 'char', value: 'T' } });
    expect(Array.from(f.vars.time.data as Float64Array)).toEqual(src.history.map((h) => h.t));
    const tab = tableFromSource(src);
    tab.columns.forEach((c, i) => {
      const v = f.vars[c.key];
      expect(v, c.key).toBeDefined();
      expect(v.dims).toEqual(['time']);
      expect(v.attrs.long_name.value).toBe(c.label);
      expect(v.attrs.units.value).toBe(cfUnit(c.unit));
      expect(v.attrs.diagnostic_key.value).toBe(c.key);
      const got = v.data as Float64Array;
      for (let k = 0; k < got.length; k++) expect(Object.is(got[k], tab.values[i][k]) || (Number.isNaN(got[k]) && Number.isNaN(tab.values[i][k])), `${c.key}[${k}]`).toBe(true);
    });
    expect(f.vars.nG_frac.attrs.units.value).toBe('1');
    expect(f.vars.n_wall.attrs.units.value).toBe('MW m-2');
    expect(f.vars.n_wall.attrs.units_original.value).toBe('MW/m²');
    expect(f.vars.ne.attrs.units.value).toBe('1e20 m-3');
    expect(f.vars.ne.attrs.units_original.value).toBe('1e20 m⁻³');
  });
  it('1.5D run: profile variables on (profile_time, rho)', () => {
    const { src } = sparc15();
    const f = readNetcdf3(writeRunNetcdf(src));
    const nProf = src.history.filter((h) => h.prof).length;
    expect(f.dims.map((d) => [d.name, d.size])).toEqual([['time', src.history.length], ['profile_time', nProf], ['rho', 30]]);
    expect(f.vars.profile_Te.dims).toEqual(['profile_time', 'rho']);
    expect(f.vars.profile_Te.shape).toEqual([nProf, 30]);
    const idx = src.history.map((h, i) => (h.prof ? i : -1)).filter((i) => i >= 0);
    const te = f.vars.profile_Te.data as Float64Array;
    expect(Array.from(te.subarray(7 * 30, 8 * 30))).toEqual(src.history[idx[7]].prof!.Te);
    expect(Array.from(f.vars.rho.data as Float64Array)).toEqual(src.history[0].prof!.rho);
    expect(f.vars.profile_ne.attrs.units.value).toBe('1e20 m-3');
    expect(f.vars.profile_j.attrs.units.value).toBe('MA m-2');
    expect(f.vars.time_profiles.attrs.units.value).toBe('s');
    // the scalar Te (volume average) and the Te profile are different variables
    expect(f.vars.Te.dims).toEqual(['time']);
  });
  it('profiles can be left out or thinned', () => {
    const { src } = sparc15();
    expect(Object.keys(readNetcdf3(writeRunNetcdf(src, { profiles: false })).vars).some((k) => k.startsWith('profile_'))).toBe(false);
    const f = readNetcdf3(writeRunNetcdf(src, { profileEvery: 25 }));
    expect(f.dims.find((d) => d.name === 'profile_time')!.size).toBe(Math.ceil(src.history.filter((h) => h.prof).length / 25));
  });
  it('a pulsed run writes its own time unit', () => {
    const f = readNetcdf3(writeRunNetcdf(nif().src));
    expect(f.vars.time.attrs.units.value).toBe(nif().sim.model.timeUnit.replace('µ', 'u'));
  });
  it('the same run gives the same bytes; a creation time appears only when given', () => {
    const { src } = jet();
    expect(hex(writeRunNetcdf(src).slice(0, 4000))).toBe(hex(writeRunNetcdf(src).slice(0, 4000)));
    const withDate = readNetcdf3(writeRunNetcdf({ ...src, meta: { ...src.meta, created: '2026-09-29T00:00:00Z' } }));
    expect(withDate.attrs.history.value).toBe('2026-09-29T00:00:00Z created by fusion-sim');
  });
  it('key selection, and the dataset object for other writers', () => {
    const { src } = jet();
    const ds = netcdfFromRun(src, { keys: ['Q', 'P_fus'] });
    expect(ds.vars.map((v) => v.name)).toEqual(['time', 'Q', 'P_fus']);
  });
  it('ncName makes valid names', () => {
    expect(ncName('P_fus')).toBe('P_fus');
    expect(ncName('a b/c')).toBe('a_b_c');
    expect(ncName('-x')).toBe('_-x');
    expect(ncName('ρ')).toBe('_');
  });
  it('a duplicate diagnostic name gets a numeric suffix', () => {
    const { src } = jet();
    const ds = netcdfFromRun({ ...src, diagSpecs: [] }, { keys: ['Q', 'Q'] });
    expect(ds.vars.map((v) => v.name)).toEqual(['time', 'Q', 'Q_2']);
  });
});

describe('a shot that ended in a step that made no progress (repeated last time)', () => {
  it('NetCDF has a strictly increasing time axis and says a frame was left out; CSV keeps every frame', () => {
    const { src } = sparc15();
    const last = src.history[src.history.length - 1];
    const failed = { ...src, history: [...src.history, { ...last }] };
    const f = readNetcdf3(writeRunNetcdf(failed));
    expect(f.dims[0].size).toBe(src.history.length);
    const t = f.vars.time.data as Float64Array;
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(f.attrs.simulation_dropped_frames).toEqual({ type: 'int', value: [1] });
    expect(f.dims.find((d) => d.name === 'profile_time')!.size).toBe(src.history.filter((h) => h.prof).length);
    expect(readNetcdf3(writeRunNetcdf(src)).attrs.simulation_dropped_frames).toBeUndefined();
  });
});
