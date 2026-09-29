/// <reference types="node" />
/**
 * The configuration schema: every preset and golden case is valid, the wizard's ranges lie inside it, 60+
 * deliberately broken configurations are rejected with the path of the broken property, and the emitted
 * JSON Schema agrees with the runtime validator (checked by a small JSON Schema evaluator written for this
 * test: no schema-validation dependency exists).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets';
import { GOLDEN_CASES, caseConfig } from '../../regression/golden';
import { stepsFor } from '../../ui/wizard/schema';
import type { Method, ReactorConfig } from '../types';
import { METHOD_LABELS } from '../types';
import {
  CONFIG_SCHEMA_ID, ConfigValidationError, METHODS, METHOD_FAMILY, assertValidConfig, configJsonSchema, familyNode, fieldInfo, formatIssue, leafPaths,
  validateConfig,
  type IssueCode, type JsonSchema, type ValidationIssue,
} from './schema';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const preset = (id: string): Record<string, any> => clone(PRESETS.find((p) => p.id === id)!.cfg) as Record<string, any>;

describe('every shipped configuration is valid', () => {
  for (const p of PRESETS) {
    it(`preset ${p.id}`, () => {
      const r = validateConfig(p.cfg);
      expect(r.issues.map(formatIssue)).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
  it('there is a preset of every configuration family and every method is covered by the golden suite or a preset', () => {
    const fams = new Set(PRESETS.map((p) => METHOD_FAMILY[p.cfg.method]));
    expect([...fams].sort()).toEqual(['frc', 'icf', 'magnetic', 'mirror', 'mtf', 'muon']);
    const used = new Set(PRESETS.map((p) => p.cfg.method));
    expect(METHODS.filter((m) => !used.has(m))).toEqual([]);
  });
  for (const c of GOLDEN_CASES) {
    it(`golden case ${c.id}`, () => {
      expect(validateConfig(caseConfig(c)).issues.map(formatIssue)).toEqual([]);
    });
  }
  it('a config that went through JSON (undefined dropped) validates the same', () => {
    for (const p of PRESETS) expect(validateConfig(clone(p.cfg)).ok).toBe(true);
  });
  it('an undefined optional property counts as absent (the wizard clears a blank field to undefined)', () => {
    const c = preset('ITER15');
    c.profiles.Tsep_keV = undefined;
    c.impurity.seedSpecies = undefined;
    c.impurity.seedConcentration = undefined;
    expect(validateConfig(c).ok).toBe(true);
  });
});

describe('the wizard only offers values the schema accepts', () => {
  for (const method of METHODS) {
    it(method, () => {
      const problems: string[] = [];
      for (const step of stepsFor(method)) {
        for (const f of step.fields) {
          const info = fieldInfo(method, f.path);
          if (!info) { problems.push(`${f.path}: no such property in the schema`); continue; }
          const type = f.type ?? 'number';
          const kind = type === 'select' ? 'enum' : type === 'bool' ? 'boolean' : 'number';
          if (info.kind !== kind) { problems.push(`${f.path}: wizard type ${type}, schema kind ${info.kind}`); continue; }
          if (type === 'number') {
            const scale = f.scale ?? 1;
            for (const [what, v] of [['min', f.min], ['max', f.max]] as const) {
              if (v === undefined) continue;
              const x = v * scale;
              const lo = info.min !== undefined ? x >= info.min : true, loEx = info.exMin !== undefined ? x > info.exMin : true;
              const hi = info.max !== undefined ? x <= info.max : true, hiEx = info.exMax !== undefined ? x < info.exMax : true;
              if (!(lo && loEx && hi && hiEx)) problems.push(`${f.path}: wizard ${what} ${x} is outside the schema range`);
            }
            if (f.step !== undefined && info.integer && !Number.isInteger(f.step)) problems.push(`${f.path}: integer property with step ${f.step}`);
          } else if (type === 'select') {
            for (const o of f.options ?? []) if (o.value !== '' && !info.values?.includes(o.value)) problems.push(`${f.path}: option '${o.value}' is not in the schema`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

interface Mutant { name: string; base: string; edit: (c: Record<string, any>) => void; path: string; code: IssueCode; hint?: RegExp }
const set = (path: string, value: unknown) => (c: Record<string, any>) => {
  const keys = path.split('.');
  let o = c;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
};
const del = (path: string) => (c: Record<string, any>) => {
  const keys = path.split('.');
  let o = c;
  for (const k of keys.slice(0, -1)) o = o[k];
  delete o[keys[keys.length - 1]];
};
const m = (name: string, base: string, edit: (c: Record<string, any>) => void, path: string, code: IssueCode, hint?: RegExp): Mutant => ({ name, base, edit, path, code, hint });

const MUTANTS: Mutant[] = [
  // magnetic: ranges, types, enums
  m('kappa below 1', 'ITER', set('geometry.kappa', 0.5), 'geometry.kappa', 'range'),
  m('kappa as a string', 'ITER', set('geometry.kappa', 'high'), 'geometry.kappa', 'type'),
  m('negative major radius', 'ITER', set('geometry.R', -6.2), 'geometry.R', 'range'),
  m('zero major radius', 'ITER', set('geometry.R', 0), 'geometry.R', 'range'),
  m('minor radius above major radius', 'ITER', set('geometry.a', 7), 'geometry.a', 'cross_field'),
  m('minor radius equal to major radius', 'JET', set('geometry.a', 2.96), 'geometry.a', 'cross_field'),
  m('triangularity above 1', 'ITER', set('geometry.delta', 1.5), 'geometry.delta', 'range'),
  m('zero toroidal field', 'ITER', set('B0', 0), 'B0', 'range'),
  m('NaN toroidal field', 'ITER', set('B0', NaN), 'B0', 'non_finite'),
  m('infinite toroidal field', 'ITER', set('B0', Infinity), 'B0', 'non_finite'),
  m('toroidal field as a string', 'ITER', set('B0', '5.3'), 'B0', 'type'),
  m('negative plasma current', 'ITER', set('Ip_MA', -1), 'Ip_MA', 'range'),
  m('tokamak without plasma current', 'ITER', set('Ip_MA', 0), 'Ip_MA', 'cross_field'),
  m('spherical tokamak without plasma current', 'MASTU', set('Ip_MA', 0), 'Ip_MA', 'cross_field'),
  m('unknown fuel', 'ITER', set('fuel', 'DT2'), 'fuel', 'enum'),
  m('fuel in lower case', 'ITER', set('fuel', 'dt'), 'fuel', 'enum', /did you mean 'DT'/),
  m('fuel fraction above 1', 'ITER', set('fuelFracA', 1.2), 'fuelFracA', 'range'),
  m('negative fuel fraction', 'ITER', set('fuelFracA', -0.1), 'fuelFracA', 'range'),
  m('zero target density', 'ITER', set('n_target', 0), 'n_target', 'range'),
  m('negative target density', 'ITER', set('n_target', -1e20), 'n_target', 'range'),
  m('negative density ramp', 'ITER', set('n_rampTime', -5), 'n_rampTime', 'range'),
  m('negative NBI power', 'ITER', set('heating.P_NBI_MW', -3), 'heating.P_NBI_MW', 'range'),
  m('zero NBI energy', 'ITER', set('heating.E_NBI_keV', 0), 'heating.E_NBI_keV', 'range'),
  m('ICRH ion fraction above 1', 'ITER', set('heating.f_ICRH_ion', 1.5), 'heating.f_ICRH_ion', 'range'),
  m('autoOff as a string', 'ITER', set('heating.autoOff', 'yes'), 'heating.autoOff', 'type'),
  m('negative heating ramp', 'ITER', set('heating.rampTime', -1), 'heating.rampTime', 'range'),
  m('heating is null', 'ITER', set('heating', null), 'heating', 'type'),
  m('heating is an array', 'ITER', set('heating', []), 'heating', 'type'),
  m('heating missing', 'ITER', del('heating'), 'heating', 'required'),
  m('ECRH power missing', 'ITER', del('heating.P_ECRH_MW'), 'heating.P_ECRH_MW', 'required'),
  m('misspelled property', 'ITER', set('heating.P_NBI_mw', 33), 'heating.P_NBI_mw', 'unknown_key', /did you mean 'P_NBI_MW'/),
  m('unknown top-level property', 'ITER', set('temperature', 5), 'temperature', 'unknown_key'),
  m('unknown fuelling method', 'ITER', set('fueling.method', 'laser'), 'fueling.method', 'enum'),
  m('pellet depth above 1', 'ITER', set('fueling.pelletDepth', 2), 'fueling.pelletDepth', 'range'),
  m('unknown impurity', 'ITER', set('impurity.species', 'Fe'), 'impurity.species', 'enum'),
  m('impurity concentration above 1', 'ITER', set('impurity.concentration', 2), 'impurity.concentration', 'range'),
  m('negative wall reflectivity', 'ITER', set('impurity.wallReflectivity', -0.5), 'impurity.wallReflectivity', 'range'),
  m('empty seeding species', 'ITER', set('impurity.seedSpecies', ''), 'impurity.seedSpecies', 'enum'),
  m('seeding concentration null', 'ITER', set('impurity.seedConcentration', null), 'impurity.seedConcentration', 'type'),
  m('zero H98', 'ITER', set('H98', 0), 'H98', 'range'),
  m('absurd H98', 'ITER', set('H98', 50), 'H98', 'range'),
  m('unknown scaling', 'ITER', set('scaling', 'NOPE'), 'scaling', 'enum'),
  m('zero rotational transform', 'W7X', set('stellarator.iota23', 0), 'stellarator.iota23', 'range'),
  m('negative H_ISS04', 'W7X', set('stellarator.H_ISS04', -1), 'stellarator.H_ISS04', 'range'),
  m('negative beta limit', 'ITER', set('limits.betaN_limit', -1), 'limits.betaN_limit', 'range'),
  m('zero Greenwald limit', 'ITER', set('limits.greenwald_limit', 0), 'limits.greenwald_limit', 'range'),
  m('zero particle confinement time', 'ITER', set('transport.tau_p_over_tau_E', 0), 'transport.tau_p_over_tau_E', 'range'),
  m('ELM flag as a number', 'ITER', set('events.elms', 1), 'events.elms', 'type'),
  m('magnet technology with a space', 'ITER', set('magnet.tech', 'Nb3Sn '), 'magnet.tech', 'enum'),
  m('negative coil gap', 'ITER', set('magnet.gap_m', -0.1), 'magnet.gap_m', 'range'),
  m('unknown blanket', 'ITER', set('blanket.type', 'ceramic'), 'blanket.type', 'enum'),
  m('blanket coverage above 1', 'ITER', set('blanket.coverage', 1.5), 'blanket.coverage', 'range'),
  m('divertor radiation fraction above 1', 'ITER', set('divertor.f_rad_div', 1.01), 'divertor.f_rad_div', 'range'),
  m('zero flux expansion', 'ITER', set('divertor.flux_expansion', 0), 'divertor.flux_expansion', 'range'),
  m('availability above 1', 'ITER', set('economics.availability', 1.2), 'economics.availability', 'range'),
  m('thermal efficiency of 1', 'ITER', set('economics.thermalEff', 1), 'economics.thermalEff', 'range'),
  m('negative discount rate', 'ITER', set('economics.discountRate', -0.01), 'economics.discountRate', 'range'),
  m('zero lifetime', 'ITER', set('economics.lifetime_yr', 0), 'economics.lifetime_yr', 'range'),
  m('zero duration', 'ITER', set('t_end', 0), 't_end', 'range'),
  m('negative duration', 'ITER', set('t_end', -400), 't_end', 'range'),
  m('negative seed', 'ITER', set('seed', -1), 'seed', 'range'),
  m('fractional seed', 'ITER', set('seed', 1.5), 'seed', 'integer'),
  m('seed beyond 32 bits', 'ITER', set('seed', 2 ** 32), 'seed', 'range'),
  m('unknown fidelity', 'ITER', set('fidelity', '2D'), 'fidelity', 'enum'),
  m('too few radial cells', 'ITER15', set('profiles.nRho', 3), 'profiles.nRho', 'range'),
  m('fractional radial cells', 'ITER15', set('profiles.nRho', 50.5), 'profiles.nRho', 'integer'),
  m('unknown transport model', 'ITER15', set('profiles.transportModel', 'bgb'), 'profiles.transportModel', 'enum'),
  m('pedestal wider than half the radius', 'ITER15', set('profiles.pedestalWidth', 0.7), 'profiles.pedestalWidth', 'range'),
  m('LCFS elongation below 1', 'ITER15', set('profiles.lcfsKappa', 0.8), 'profiles.lcfsKappa', 'range'),
  m('profiles is a string', 'ITER15', set('profiles', 'on'), 'profiles', 'type'),
  m('misspelled 1.5D setting', 'ITER15', set('profiles.chiShap', 3), 'profiles.chiShap', 'unknown_key', /did you mean 'chiShape'/),
  m('unknown method', 'ITER', set('method', 'tokamak2'), 'method', 'enum', /did you mean 'tokamak'/),
  m('method missing', 'ITER', del('method'), 'method', 'required'),
  m('method is a number', 'ITER', set('method', 3), 'method', 'type'),
  // inertial confinement
  m('ICF: zero laser energy', 'NIF', set('E_laser_MJ', 0), 'E_laser_MJ', 'range'),
  m('ICF: wavelength in metres', 'NIF', set('wavelength_nm', 3.51e-7), 'wavelength_nm', 'range'),
  m('ICF: unknown ablator', 'NIF', set('ablator', 'Diamond'), 'ablator', 'enum'),
  m('ICF: adiabat below 1', 'NIF', set('adiabat', 0.5), 'adiabat', 'range'),
  m('ICF: zero convergence ratio', 'NIF', set('convergenceRatio', 0), 'convergenceRatio', 'range'),
  m('ICF: hohlraum efficiency above 1', 'NIF', set('hohlraumEff', 1.1), 'hohlraumEff', 'range'),
  m('ICF: unknown fuel', 'DIRECT', set('fuel', 'DT2'), 'fuel', 'enum'),
  m('ICF: seed missing', 'NIF', del('seed'), 'seed', 'required'),
  m('ICF: zero driver efficiency', 'NIF', set('driverEff', 0), 'driverEff', 'range'),
  // magnetised target, Z-pinch, MagLIF
  m('MTF: negative radius', 'Z', set('r0_m', -1e-3), 'r0_m', 'range'),
  m('MTF: compression ratio below 1', 'GF', set('compressionRatio', 0.5), 'compressionRatio', 'range'),
  m('MTF: flow shear above 1', 'ZAP', set('flowShear', 1.5), 'flowShear', 'range'),
  m('MTF: density as a string', 'Z', set('n0', '2.4e26'), 'n0', 'type'),
  m('MTF: negative jitter', 'GF', set('jitter_us', -1), 'jitter_us', 'range'),
  m('MTF: unknown property', 'FRXL', set('lyner', 1), 'lyner', 'unknown_key'),
  // FRC, mirror, muon
  m('FRC: zero separatrix radius', 'TAE', set('rs_m', 0), 'rs_m', 'range'),
  m('FRC: negative external field', 'TAE', set('Be_T', -0.1), 'Be_T', 'range'),
  m('FRC: duration missing', 'TAE', del('t_end'), 't_end', 'required'),
  m('FRC: negative NBI power', 'TAE', set('P_NBI_MW', -13), 'P_NBI_MW', 'range'),
  m('mirror: mirror ratio of 1', 'MIRROR', set('mirrorRatio', 1), 'mirrorRatio', 'range'),
  m('mirror: tandem as a string', 'MIRROR', set('tandem', 'true'), 'tandem', 'type'),
  m('mirror: zero length', 'MIRROR', set('L_m', 0), 'L_m', 'range'),
  m('mirror: negative plug potential', 'MIRROR', set('plugPotential', -1), 'plugPotential', 'range'),
  m('muon: sticking probability above 1', 'MUON', set('stickingProb', 2), 'stickingProb', 'range'),
  m('muon: zero density', 'MUON', set('density_LHD', 0), 'density_LHD', 'range'),
  m('muon: negative temperature', 'MUON', set('T_K', -300), 'T_K', 'range'),
  m('muon: zero production rate', 'MUON', set('muonRate_per_s', 0), 'muonRate_per_s', 'range'),
  // a configuration of one family under the method of another
  m('FRC fields under the mirror method', 'TAE', set('method', 'mirror'), 'rs_m', 'unknown_key'),
];

describe('invalid configurations are rejected with the path of the broken property', () => {
  it('there are at least 50 of them, with distinct names', () => {
    expect(MUTANTS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(MUTANTS.map((x) => x.name)).size).toBe(MUTANTS.length);
  });
  for (const x of MUTANTS) {
    it(x.name, () => {
      const c = preset(x.base);
      x.edit(c);
      const r = validateConfig(c);
      expect(r.ok).toBe(false);
      const hit = r.issues.find((i) => i.path === x.path);
      expect(hit, `issues: ${r.issues.map(formatIssue).join(' | ')}`).toBeDefined();
      expect(hit!.code).toBe(x.code);
      expect(hit!.pointer).toBe('/' + x.path.split('.').join('/'));
      if (x.hint) expect(formatIssue(hit!)).toMatch(x.hint);
      expect(() => assertValidConfig(c)).toThrow(ConfigValidationError);
    });
  }
});

describe('the issues', () => {
  it('lists every problem, not just the first', () => {
    const c = preset('ITER');
    c.geometry.kappa = 0.5;
    c.B0 = -1;
    c.fuel = 'X';
    delete c.heating.rampTime;
    const paths = validateConfig(c).issues.map((i) => i.path).sort();
    expect(paths).toEqual(['B0', 'fuel', 'geometry.kappa', 'heating.rampTime']);
  });
  it('formats as path: message (hint), the root as (root)', () => {
    const i: ValidationIssue = { path: 'a.b', pointer: '/a/b', code: 'range', message: 'must be >= 1, got 0', hint: 'try 1' };
    expect(formatIssue(i)).toBe('a.b: must be >= 1, got 0 (try 1)');
    expect(formatIssue({ path: '', pointer: '', code: 'type', message: 'must be an object, got null' })).toBe('(root): must be an object, got null');
  });
  it('a root that is not an object is a single issue at the root', () => {
    for (const v of [null, [], 'ITER', 5, undefined, true]) {
      const r = validateConfig(v);
      expect(r.ok).toBe(false);
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0].path).toBe('');
      expect(r.issues[0].code).toBe('type');
    }
  });
  it('messages name the value and the bound', () => {
    const c = preset('ITER');
    c.geometry.kappa = 0.5;
    expect(validateConfig(c).issues[0].message).toBe('must be >= 1 and <= 5, got 0.5');
    c.geometry.kappa = 'x';
    expect(validateConfig(c).issues[0].message).toBe('must be a number, got the string "x"');
    c.geometry.kappa = null;
    expect(validateConfig(c).issues[0].message).toBe('must be a number, got null');
    c.geometry.kappa = [1];
    expect(validateConfig(c).issues[0].message).toBe('must be a number, got an array');
    c.geometry.kappa = {};
    expect(validateConfig(c).issues[0].message).toBe('must be a number, got an object');
    c.geometry.kappa = true;
    expect(validateConfig(c).issues[0].message).toBe('must be a number, got true');
    c.geometry.kappa = 'a'.repeat(40);
    expect(validateConfig(c).issues[0].message).toBe(`must be a number, got the string "${'a'.repeat(21)}..."`);
  });
  it('an exclusive bound is described as such', () => {
    const c = preset('ITER');
    c.B0 = 0;
    expect(validateConfig(c).issues[0].message).toBe('must be > 0 and <= 100, got 0');
  });
  it('the error thrown by assertValidConfig lists the problems', () => {
    const c = preset('ITER');
    c.geometry.kappa = 0.5;
    c.geometry.a = 9;
    try {
      assertValidConfig(c);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const err = e as ConfigValidationError;
      expect(err.issues).toHaveLength(2);
      expect(err.message).toMatch(/^invalid configuration \(2 problems\):\n {2}geometry\.kappa: .*\n {2}geometry\.a: /);
    }
    try { assertValidConfig({ method: 'nope' }); expect.unreachable(); } catch (e) { expect((e as Error).message).toMatch(/\(1 problem\):/); }
  });
  it('a rule is skipped when a property it reads is itself invalid (no follow-up noise)', () => {
    const c = preset('ITER');
    c.geometry.R = 'six';
    const r = validateConfig(c);
    expect(r.issues.map((i) => i.path)).toEqual(['geometry.R']);
    const d = preset('ITER');
    d.Ip_MA = 'many';
    expect(validateConfig(d).issues.map((i) => i.path)).toEqual(['Ip_MA']);
  });
  it('unknownKeys: ignore skips unknown properties only', () => {
    const c = preset('ITER');
    c.extra = 1;
    c.heating.extra = 2;
    expect(validateConfig(c).issues.map((i) => i.path).sort()).toEqual(['extra', 'heating.extra']);
    expect(validateConfig(c, { unknownKeys: 'ignore' }).ok).toBe(true);
    c.B0 = -1;
    expect(validateConfig(c, { unknownKeys: 'ignore' }).issues.map((i) => i.path)).toEqual(['B0']);
  });
  it('a valid configuration comes back as is', () => {
    const c = preset('NIF');
    const r = validateConfig(c);
    expect(r.ok && r.config).toBe(c);
    expect(assertValidConfig(c)).toBe(c);
  });
  it('an unknown property whose value is undefined is not an issue', () => {
    const c = preset('NIF');
    c.other = undefined;
    expect(validateConfig(c).ok).toBe(true);
  });
});

describe('field descriptions', () => {
  it('describes numbers, enums, booleans and objects', () => {
    expect(fieldInfo('tokamak', 'geometry.kappa')).toMatchObject({ kind: 'number', min: 1, max: 5, optional: false });
    expect(fieldInfo('tokamak', 'geometry.R')).toMatchObject({ kind: 'number', exMin: 0, max: 100, unit: 'm' });
    expect(fieldInfo('tokamak', 'seed')).toMatchObject({ kind: 'number', integer: true });
    expect(fieldInfo('tokamak', 'fuel')).toMatchObject({ kind: 'enum', values: ['DT', 'DD', 'DHe3', 'pB11'] });
    expect(fieldInfo('tokamak', 'heating.autoOff')).toMatchObject({ kind: 'boolean' });
    expect(fieldInfo('tokamak', 'heating')).toMatchObject({ kind: 'object', doc: 'Auxiliary heating.' });
    expect(fieldInfo('tokamak', 'profiles.Tsep_keV')).toMatchObject({ kind: 'number', optional: true });
    expect(fieldInfo('tokamak', 'profiles.nRho')).toMatchObject({ kind: 'number', integer: true, def: 50 });
    expect(fieldInfo('tokamak', 'profiles.transportModel')).toMatchObject({ kind: 'enum', def: 'scaling' });
    expect(fieldInfo('tokamak', 'fidelity')).toMatchObject({ kind: 'enum', optional: true, def: '0D' });
    expect(fieldInfo('mirror', 'plugPotential')).toMatchObject({ kind: 'number', def: 1 });
    expect(fieldInfo('tokamak', '')).toMatchObject({ kind: 'object' });
  });
  it('is undefined for a path the configuration does not have', () => {
    expect(fieldInfo('tokamak', 'geometry.nope')).toBeUndefined();
    expect(fieldInfo('tokamak', 'B0.x')).toBeUndefined();
    expect(fieldInfo('muon', 'geometry.R')).toBeUndefined();
    expect(fieldInfo('tokamak', 'toString')).toBeUndefined();
  });
  it('lists the leaf paths of a method', () => {
    const p = leafPaths('tokamak');
    expect(p).toContain('geometry.kappa');
    expect(p).toContain('profiles.nRho');
    expect(p).not.toContain('geometry');
    expect(leafPaths('muon')).toEqual(['method', 'muonRate_per_s', 'muonCost_GeV', 'stickingProb', 'density_LHD', 'T_K', 'seed']);
  });
  it('exposes the schema node of a family', () => {
    expect(Object.keys(familyNode('muon').props)).toContain('stickingProb');
  });
  it('the method list matches METHOD_LABELS and every method has a family', () => {
    expect([...METHODS]).toEqual(Object.keys(METHOD_LABELS));
    for (const mm of METHODS) expect(METHOD_FAMILY[mm as Method]).toBeDefined();
  });
});

// ── JSON Schema ─────────────────────────────────────────────────────────────────────────────────────

/** A JSON Schema evaluator for the subset the emitter uses (keywords apply by presence, as in the specification). */
function evaluate(schema: JsonSchema, root: JsonSchema, value: unknown, at = ''): string[] {
  const out: string[] = [];
  const s = schema as Record<string, any>;
  if (s.$ref !== undefined) {
    const target = String(s.$ref).replace(/^#\//, '').split('/').reduce<any>((o, k) => o?.[k], root);
    if (!target) return [`${at}: unresolved $ref ${String(s.$ref)}`];
    out.push(...evaluate(target, root, value, at));
  }
  if (s.allOf) for (const sub of s.allOf) out.push(...evaluate(sub, root, value, at));
  if (s.if) {
    const cond = evaluate(s.if, root, value, at).length === 0;
    if (cond && s.then) out.push(...evaluate(s.then, root, value, at));
    if (!cond && s.else) out.push(...evaluate(s.else, root, value, at));
  }
  const isObj = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (s.type !== undefined) {
    const ok = s.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : s.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
        : s.type === 'boolean' ? typeof value === 'boolean'
          : s.type === 'string' ? typeof value === 'string'
            : s.type === 'object' ? isObj : false;
    if (!ok) return [...out, `${at}: not of type ${String(s.type)}`];
  }
  if (s.enum && !s.enum.includes(value)) out.push(`${at}: not in enum`);
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) out.push(`${at}: below minimum`);
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) out.push(`${at}: not above exclusiveMinimum`);
    if (s.maximum !== undefined && value > s.maximum) out.push(`${at}: above maximum`);
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) out.push(`${at}: not below exclusiveMaximum`);
  }
  if (isObj) {
    const v = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (v[k] === undefined) out.push(`${at}.${k}: required`);
    for (const [k, sub] of Object.entries<any>(s.properties ?? {})) if (v[k] !== undefined) out.push(...evaluate(sub, root, v[k], at === '' ? k : `${at}.${k}`));
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (v[k] !== undefined && !(k in (s.properties ?? {}))) out.push(`${at}.${k}: additional property`);
  }
  return out;
}

describe('JSON Schema 2020-12', () => {
  const schema = configJsonSchema();
  const s = schema as Record<string, any>;

  it('is a draft 2020-12 document with an id and one definition per family', () => {
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.$id).toBe(CONFIG_SCHEMA_ID);
    expect(Object.keys(s.$defs).sort()).toEqual(['frcConfig', 'geometry', 'icfConfig', 'magneticConfig', 'mirrorConfig', 'mtfConfig', 'muonConfig', 'profileSettings']);
    expect(s.properties.method.enum).toEqual([...METHODS]);
    expect(s.required).toEqual(['method']);
  });
  it('names no person: no e-mail address, no user name, no URL', () => {
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/@|https?:\/\/(?!json-schema\.org)/);
  });
  it('every $ref resolves and every required property is declared', () => {
    const seen: string[] = [];
    const walk = (n: any) => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n && typeof n === 'object') {
        if (typeof n.$ref === 'string') seen.push(n.$ref);
        if (n.required && n.properties) for (const k of n.required) expect(Object.keys(n.properties)).toContain(k);
        Object.values(n).forEach(walk);
      }
    };
    walk(schema);
    expect(seen.length).toBeGreaterThan(6);
    for (const ref of seen) expect(ref.replace(/^#\//, '').split('/').reduce<any>((o, k) => o?.[k], s), ref).toBeDefined();
  });
  it('accepts every preset', () => {
    for (const p of PRESETS) expect(evaluate(schema, schema, clone(p.cfg)), p.id).toEqual([]);
  });
  it('rejects every mutant that is not a cross-field violation (the schema and the validator agree)', () => {
    let n = 0;
    for (const x of MUTANTS) {
      if (x.code === 'cross_field') continue;
      const c = preset(x.base);
      x.edit(c);
      expect(evaluate(schema, schema, c), x.name).not.toEqual([]);
      n++;
    }
    expect(n).toBeGreaterThan(45);
  });
  it('lists the cross-field rules as annotations (JSON Schema cannot express them)', () => {
    const rules = [s.$defs.geometry['x-rules'], s.$defs.magneticConfig['x-rules']].flat().map((r: any) => r.id).sort();
    expect(rules).toEqual(['minor-radius-below-major-radius', 'tokamak-needs-plasma-current']);
    expect(s.$defs.geometry.description).toMatch(/geometry\.a must be smaller than geometry\.R/);
  });
  it('carries units and defaults as annotations', () => {
    expect(s.$defs.geometry.properties.R['x-unit']).toBe('m');
    expect(s.$defs.profileSettings.properties.nRho.default).toBe(50);
    expect(s.$defs.magneticConfig.properties.heating.properties.autoOff.type).toBe('boolean');
  });
  it('the checked-in file schema/fusion-sim.schema.json is what the emitter writes (npm run schema)', () => {
    const file = readFileSync(new URL('../../../schema/fusion-sim.schema.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(file).toBe(JSON.stringify(configJsonSchema(), null, 2) + '\n');
  });
});

it('the schema is typed against types.ts: ReactorConfig is the union of the six families', () => {
  // compile-time only: a config of each family is assignable to ReactorConfig
  const cfgs: ReactorConfig[] = PRESETS.map((p) => p.cfg);
  expect(cfgs.length).toBe(PRESETS.length);
});
