import { describe, expect, it } from 'vitest';
import { ReactorConfig } from '../../physics/types';
import { ITER, ITER_15D, JET_15D, TAE } from '../../physics/presets';
import { METHOD_DEFAULT, PRESETS, fieldVisible, getPath, isRequired, missingRequired, setPath, stepsFor } from './schema';

const paths = (cfg: ReactorConfig) => missingRequired(cfg).map((m) => `${m.step.id}:${m.field.path}`);

describe('required wizard fields', () => {
  it('no stock device is blocked: every preset and method default has all required values', () => {
    for (const p of PRESETS) expect(paths(p.cfg), p.id).toEqual([]);
    for (const [m, cfg] of Object.entries(METHOD_DEFAULT)) expect(paths(cfg), m).toEqual([]);
  });

  it('a numeric field a stock preset leaves blank is optional and explains what blank means', () => {
    const blankInPresets = new Set<string>();
    for (const p of PRESETS) {
      for (const s of stepsFor(p.cfg.method)) {
        for (const f of s.fields) {
          if ((f.type ?? 'number') === 'number' && fieldVisible(p.cfg.method, f.path, p.cfg) && (getPath(p.cfg, f.path) ?? f.def) === undefined) {
            expect(isRequired(f), `${p.id} ${f.path}`).toBe(false);
            expect(f.hint, f.path).toMatch(/^Blank/);
            blankInPresets.add(f.path);
          }
        }
      }
    }
    expect([...blankInPresets].sort()).toEqual(['impurity.seedConcentration', 'profiles.Tsep_keV', 'profiles.lcfsDelta', 'profiles.lcfsKappa']);
  });

  it('lists a cleared required field with its step, and ignores hidden and documented-default fields', () => {
    expect(paths(setPath(ITER, 'geometry.R', undefined))).toEqual(['geometry:geometry.R']);
    expect(paths(setPath(setPath(TAE, 'rs_m', undefined), 't_end', undefined))).toEqual(['geometry:rs_m', 'geometry:t_end']);
    // documented blank settings and model defaults (`def`) never block a run
    expect(paths(setPath(ITER_15D, 'profiles.Tsep_keV', undefined))).toEqual([]);
    expect(paths(setPath(JET_15D, 'profiles.nRho', undefined))).toEqual([]);
    // fields hidden for a method are not required: the stellarator ι is not shown for a tokamak
    expect(getPath(ITER, 'stellarator.iota23')).toBeDefined();
    expect(paths(setPath(ITER, 'stellarator.iota23', undefined))).toEqual([]);
    // a non-finite value is as good as blank
    expect(paths(setPath(ITER, 'B0', NaN))).toEqual(['geometry:B0']);
  });
});
