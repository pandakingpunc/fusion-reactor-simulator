import { describe, expect, it } from 'vitest';
import { IMAS_FORMAT_VERSION, SUMMARY_MAP, imasFromRun, readImasProfiles, readImasSummary, writeImasJson } from './imas';
import { tableFromSource } from './table';
import { jet, nif, sparc15 } from './testdata/fixtures';

type Obj = Record<string, any>;
const parse = (s: string): Obj => JSON.parse(s) as Obj;

/** relative closeness for a value that went through an SI unit conversion and back */
const near = (a: number, b: number): boolean => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-14 * Math.max(Math.abs(a), Math.abs(b), 1e-300);

describe('IMAS-like JSON of a 0D run', () => {
  const { src } = jet();
  const doc = parse(writeImasJson(src));

  it('declares what it is: IMAS-like, COCOS 11, not validated against a Data Dictionary', () => {
    expect(doc.format).toMatchObject({ name: 'imas-like-json', version: IMAS_FORMAT_VERSION, cocos: 11 });
    expect(doc.format.note).toMatch(/not validated/);
  });
  it('has a summary IDS with homogeneous time, the code block and the configuration as JSON text', () => {
    expect(doc.summary.ids_properties.homogeneous_time).toBe(1);
    expect(doc.summary.code).toMatchObject({ name: 'fusion-reactor-simulator', version: '4.0.0-test' });
    expect(JSON.parse(doc.summary.code.parameters).method).toBe('tokamak');
    expect(doc.summary.ids_properties.creation_date).toBeUndefined();
    expect(doc.summary.time).toEqual(src.history.map((f) => f.t));
  });
  it('has no profile IDSs for a 0D run', () => {
    expect(doc.core_profiles).toBeUndefined();
    expect(doc.equilibrium).toBeUndefined();
  });
  it('quantities are in SI: A, W, eV, m^-3, J', () => {
    const last = src.history.length - 1;
    const d = src.history[last].d;
    expect(doc.summary.global_quantities.ip.value[last]).toBe(d.Ip * 1e6);
    expect(doc.summary.fusion.power.value[last]).toBe(d.P_fus * 1e6);
    expect(doc.summary.volume_average.t_i_average.value[last]).toBe(d.Ti * 1e3);
    expect(doc.summary.volume_average.n_e.value[last]).toBe(d.ne * 1e20);
    expect(doc.summary.line_average.n_e.value[last]).toBe(d.nbar * 1e20);
    expect(doc.summary.global_quantities.energy_thermal.value[last]).toBe(d.W * 1e6);
    expect(doc.summary.global_quantities.beta_tor_norm.value[last]).toBe(d.betaN);
    expect(doc.summary.global_quantities.fusion_gain.value[last]).toBe(d.Q);
    expect(doc.summary.global_quantities.q_95.value[last]).toBe(d.q95);
    expect(doc.summary.global_quantities.b0.value).toHaveLength(src.history.length);
    expect(doc.summary.global_quantities.b0.value[0]).toBe(3.7);
    expect(doc.summary.global_quantities.r0.value).toBe(2.96);
  });
  it('COCOS 11: the plasma current and the safety factor are positive', () => {
    const ip = doc.summary.global_quantities.ip.value as number[];
    expect(ip.filter((v) => v !== null).every((v) => v > 0)).toBe(true);
    expect(doc.summary.global_quantities.q_95.value.filter((v: number | null) => v !== null).every((v: number) => v > 0)).toBe(true);
  });
  it('leaves out what the 0D model does not compute rather than inventing it', () => {
    expect(doc.summary.global_quantities.beta_pol).toBeUndefined();
    expect(doc.summary.global_quantities.li_3).toBeUndefined();
    expect(doc.summary.global_quantities.v_loop).toBeUndefined();
    expect(doc.summary.local?.magnetic_axis?.q).toBeUndefined();
  });
  it('write, parse, equal: the summary reads back into the model diagnostics (to rounding of the unit conversion)', () => {
    const back = readImasSummary(doc);
    expect(back.time).toEqual(src.history.map((f) => f.t));
    const tab = tableFromSource(src);
    let checked = 0;
    for (const m of SUMMARY_MAP) {
      const i = tab.columns.findIndex((c) => c.key === m.key);
      if (i < 0 || !tab.values[i].some(Number.isFinite)) { expect(back.series[m.key], m.key).toBeUndefined(); continue; }
      expect(back.series[m.key], m.key).toBeDefined();
      tab.values[i].forEach((v, k) => expect(near(back.series[m.key][k], v), `${m.key}[${k}]`).toBe(true));
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
  it('a missing value is null in the file and NaN when read back', () => {
    const holes = { ...src, history: src.history.map((f, i) => (i === 3 ? { ...f, d: { ...f.d, Ti: NaN } } : f)) };
    const d = parse(writeImasJson(holes));
    expect(d.summary.volume_average.t_i_average.value[3]).toBeNull();
    expect(readImasSummary(d).series.Ti[3]).toBeNaN();
  });
  it('is deterministic; a creation date appears only when given; indentation is optional', () => {
    expect(writeImasJson(src)).toBe(writeImasJson(src));
    expect(writeImasJson(src, { indent: 2 }).startsWith('{\n  "format"')).toBe(true);
    const dated = parse(writeImasJson({ ...src, meta: { ...src.meta, created: '2026-09-29T00:00:00Z' } }));
    expect(dated.summary.ids_properties.creation_date).toBe('2026-09-29T00:00:00Z');
  });
  it('only magnetic-confinement runs can be exported', () => {
    expect(() => imasFromRun(nif().src)).toThrow(/magnetic-confinement runs.*'icf_indirect'/);
    expect(() => imasFromRun({ ...src, method: 'frc' })).toThrow(/not 'frc'/);
    expect(() => imasFromRun({ ...src, method: undefined })).not.toThrow();
  });
  it('an unknown document is rejected by the reader', () => {
    expect(() => readImasSummary({})).toThrow(/no summary IDS/);
    expect(readImasProfiles({})).toEqual([]);
  });
});

describe('IMAS-like JSON of a 1.5D run', () => {
  const { src } = sparc15();
  const doc = parse(writeImasJson(src));
  const nProf = src.history.filter((f) => f.prof).length;
  const nEq = src.history.filter((f) => f.eq).length;

  it('adds core_profiles, one profiles_1d per profile frame', () => {
    expect(doc.core_profiles.profiles_1d).toHaveLength(nProf);
    expect(doc.core_profiles.time).toHaveLength(nProf);
    expect(doc.core_profiles.vacuum_toroidal_field.r0).toBe(1.85);
    expect(doc.core_profiles.vacuum_toroidal_field.b0).toHaveLength(nProf);
    const sl = doc.core_profiles.profiles_1d[100];
    expect(sl.grid.rho_tor_norm).toHaveLength(30);
    expect(sl.time).toBe(doc.core_profiles.time[100]);
  });
  it('profiles are in SI and equal the model profiles', () => {
    const idx = src.history.map((f, i) => (f.prof ? i : -1)).filter((i) => i >= 0);
    const p = src.history[idx[100]].prof!;
    const sl = doc.core_profiles.profiles_1d[100];
    expect(sl.electrons.temperature).toEqual(p.Te.map((v) => v * 1e3));
    expect(sl.electrons.density).toEqual(p.ne.map((v) => v * 1e20));
    expect(sl.t_i_average).toEqual(p.Ti.map((v) => v * 1e3));
    expect(sl.q).toEqual(p.q);
    expect(sl.pressure_thermal).toEqual(p.p.map((v) => v * 1e3));
    expect(sl.j_total).toEqual(p.j.map((v) => v * 1e6));
    expect(sl.j_non_inductive).toEqual(p.jbs.map((v, k) => (v + p.jcd[k]) * 1e6));
    expect(sl.magnetic_shear).toEqual(p.shear);
    expect(sl.zeff).toEqual(p.Zeff);
  });
  it('COCOS 11 signs: q and the total current density are positive on every profile frame', () => {
    for (const sl of doc.core_profiles.profiles_1d as Obj[]) {
      expect((sl.q as number[]).every((v) => v > 0)).toBe(true);
      expect((sl.j_total as number[]).every((v) => v > 0)).toBe(true);
    }
  });
  it('write, parse, equal: the profiles read back into the model profiles', () => {
    const back = readImasProfiles(doc);
    expect(back).toHaveLength(nProf);
    const idx = src.history.map((f, i) => (f.prof ? i : -1)).filter((i) => i >= 0);
    for (const k of [0, 17, nProf - 1]) {
      const p = src.history[idx[k]].prof!;
      expect(back[k].t).toBe(src.history[idx[k]].t);
      expect(back[k].rho).toEqual(p.rho);
      for (const key of ['Te', 'Ti', 'ne', 'q', 'shear', 'Zeff', 'p', 'j', 'jbs', 'johm']) {
        back[k].profiles[key].forEach((v, j) => expect(near(v, p[key][j]), `${key}[${k}][${j}]`).toBe(true));
      }
    }
  });
  it('adds an equilibrium IDS with a boundary outline per updated equilibrium', () => {
    expect(doc.equilibrium.time_slice).toHaveLength(nEq);
    const eqFrames = src.history.filter((f) => f.eq);
    const sl = doc.equilibrium.time_slice[3];
    const eq = eqFrames[3].eq!;
    expect(sl.time).toBe(eqFrames[3].t);
    expect(sl.boundary.outline.r).toEqual(eq.R[eq.R.length - 1]);
    expect(sl.boundary.outline.z).toEqual(eq.Z[eq.Z.length - 1]);
    expect(sl.global_quantities.magnetic_axis).toEqual({ r: eq.Raxis, z: eq.Zaxis });
    expect(sl.global_quantities.q_95).toBe(eq.q95);
    expect(sl.global_quantities.li_3).toBe(eq.li);
    expect(sl.global_quantities.beta_pol).toBe(eq.betaP);
    expect(sl.global_quantities.ip).toBe(eqFrames[3].d.Ip * 1e6);
    // extent of the boundary
    const r = eq.R[eq.R.length - 1], z = eq.Z[eq.Z.length - 1];
    const rmin = Math.min(...r), rmax = Math.max(...r), zmin = Math.min(...z), zmax = Math.max(...z);
    expect(sl.boundary.minor_radius).toBe((rmax - rmin) / 2);
    expect(sl.boundary.elongation).toBe((zmax - zmin) / (rmax - rmin));
    expect(sl.boundary.geometric_axis).toEqual({ r: (rmax + rmin) / 2, z: (zmax + zmin) / 2 });
    // the plasma of SPARC: minor radius 0.57 m, elongation near 2
    expect(sl.boundary.minor_radius).toBeGreaterThan(0.4);
    expect(sl.boundary.minor_radius).toBeLessThan(0.7);
    expect(sl.boundary.elongation).toBeGreaterThan(1.5);
  });
  it('the summary has the 1.5D-only quantities as well', () => {
    expect(doc.summary.global_quantities.beta_pol.value.length).toBe(src.history.length);
    expect(doc.summary.global_quantities.li_3).toBeDefined();
    expect(doc.summary.global_quantities.current_bootstrap.value.length).toBe(src.history.length);
    expect(doc.summary.local.magnetic_axis.q.value.length).toBe(src.history.length);
  });
  it('profiles and equilibrium can be left out or thinned', () => {
    expect(imasFromRun(src, { profiles: false }).core_profiles).toBeUndefined();
    const thin = imasFromRun(src, { every: 50 }) as Obj;
    expect(thin.core_profiles.profiles_1d).toHaveLength(Math.ceil(nProf / 50));
    expect(thin.equilibrium.time_slice).toHaveLength(Math.ceil(nEq / 50));
  });
});
