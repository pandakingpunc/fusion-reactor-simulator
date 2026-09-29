import { describe, expect, it } from 'vitest';
import { ITER, JET, NIF } from '../presets';
import type { ReactorConfig } from '../types';
import { validateConfig } from './schema';
import {
  ConfigPathError, applyAssignments, getPath, mergeConfig, parseAssignment, parseSettingValue, setPath, splitPath,
} from './paths';

describe('paths', () => {
  it('splits a dotted path, refusing empty segments and prototype names', () => {
    expect(splitPath('heating.P_NBI_MW')).toEqual(['heating', 'P_NBI_MW']);
    expect(() => splitPath('')).toThrow(ConfigPathError);
    expect(() => splitPath('a..b')).toThrow(/empty segment/);
    expect(() => splitPath('.a')).toThrow(/empty segment/);
    expect(() => splitPath('a.__proto__.x')).toThrow(/'__proto__' is not allowed/);
    expect(() => splitPath('constructor.prototype')).toThrow(/not allowed/);
  });
  it('getPath reads nested values, undefined for anything missing or inherited', () => {
    expect(getPath(ITER, 'geometry.R')).toBe(6.2);
    expect(getPath(ITER, 'geometry.nope')).toBeUndefined();
    expect(getPath(ITER, 'B0.x')).toBeUndefined();
    expect(getPath(ITER, 'geometry.toString')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
  it('setPath copies along the path and leaves the original alone', () => {
    const out = setPath(ITER, 'heating.P_NBI_MW', 20);
    expect(out.heating.P_NBI_MW).toBe(20);
    expect(ITER.heating.P_NBI_MW).toBe(33);
    expect(out.heating).not.toBe(ITER.heating);
    expect(out.geometry).toBe(ITER.geometry); // untouched branches are shared
    expect(setPath({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } });
    expect(setPath({ a: 5 }, 'a.b', 1)).toEqual({ a: { b: 1 } });
    expect(setPath(null, 'a', 1)).toEqual({ a: 1 });
  });
  it('mergeConfig lays a patch over a base: objects merge, everything else replaces, undefined is skipped', () => {
    const merged = mergeConfig(ITER, { heating: { P_NBI_MW: 10 }, fuel: 'DD', impurity: { seedSpecies: undefined }, t_end: 5 }) as ReactorConfig & { heating: { P_ECRH_MW: number } };
    expect(merged.heating.P_ECRH_MW).toBe(ITER.heating.P_ECRH_MW);
    expect((merged as typeof ITER).heating.P_NBI_MW).toBe(10);
    expect((merged as typeof ITER).impurity.seedSpecies).toBe('Ar');
    expect((merged as typeof ITER).fuel).toBe('DD');
    expect(ITER.fuel).toBe('DT');
    expect(mergeConfig({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(mergeConfig({ a: 1 }, { a: null })).toEqual({ a: null });
    expect(mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeConfig(undefined, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
    expect(mergeConfig({ a: 1 }, 5)).toBe(5);
    expect(() => mergeConfig({}, JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(/not allowed/);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it('parses a setting value as JSON, else as text', () => {
    expect(parseSettingValue('20')).toBe(20);
    expect(parseSettingValue('1e20')).toBe(1e20);
    expect(parseSettingValue('-0.5')).toBe(-0.5);
    expect(parseSettingValue('true')).toBe(true);
    expect(parseSettingValue('null')).toBeNull();
    expect(parseSettingValue('"DT"')).toBe('DT');
    expect(parseSettingValue('DT')).toBe('DT');
    expect(parseSettingValue('1.5D')).toBe('1.5D');
    expect(parseSettingValue('')).toBe('');
    expect(parseSettingValue('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses path=value at the first =', () => {
    expect(parseAssignment('heating.P_NBI_MW=20')).toEqual({ path: 'heating.P_NBI_MW', value: 20 });
    expect(parseAssignment(' fuel = DD ')).toEqual({ path: 'fuel', value: 'DD' });
    expect(parseAssignment('a=b=c')).toEqual({ path: 'a', value: 'b=c' });
    expect(() => parseAssignment('nothing')).toThrow(/not of the form path=value/);
    expect(() => parseAssignment('=3')).toThrow(/empty segment/);
    expect(() => parseAssignment('__proto__.x=3')).toThrow(/not allowed/);
  });
  it('applies settings in order; the result validates like a config edited by hand', () => {
    const cfg = applyAssignments(JET, ['heating.P_NBI_MW=10', 'fuel=DD', 'fidelity=1.5D', 't_end=2', 'heating.P_NBI_MW=12']) as typeof JET;
    expect(cfg.heating.P_NBI_MW).toBe(12);
    expect(cfg.fuel).toBe('DD');
    expect(cfg.fidelity).toBe('1.5D');
    expect(validateConfig(cfg).ok).toBe(true);
    expect(JET.fuel).toBe('DT');
    const bad = applyAssignments(NIF, ['E_laser_MJ=-1', 'wavelenght_nm=351']);
    expect(validateConfig(bad).issues.map((i) => i.path).sort()).toEqual(['E_laser_MJ', 'wavelenght_nm']);
  });
});
