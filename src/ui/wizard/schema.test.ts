import { describe, expect, it } from 'vitest';
import { ReactorConfig } from '../../physics/types';
import { DIRECT_DRIVE, ITER, ITER_15D, JET_15D, MASTU, MIRROR, NIF, TAE, W7X } from '../../physics/presets';
import { loadLocale, translator } from '../../i18n';
import { Simulation } from '../../physics/simulation';
import { METHOD_DEFAULT, PRESETS, crossFieldIssues, fieldHint, fieldLabel, fieldVisible, getPath, isRequired, missingRequired, setPath, stepsFor } from './schema';

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
    expect([...blankInPresets].sort()).toEqual(['impurity.seedConcentration', 'profiles.Tsep_keV', 'profiles.lcfsDelta', 'profiles.lcfsKappa', 'stellarator.H_ISS04']);
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

const allFields = (m: ReactorConfig['method']) => stepsFor(m).flatMap((s) => s.fields);
const field = (m: ReactorConfig['method'], path: string) => allFields(m).find((f) => f.path === path)!;

describe('fields of the v4 configuration options', () => {
  it('stellarator H_ISS04 is a blank-able field that replaces f_ren and H98 once it is set', () => {
    const f = field('stellarator', 'stellarator.H_ISS04');
    expect(f).toMatchObject({ optional: true, min: 0.3, max: 2 });
    expect(f.hint).toMatch(/^Blank/);
    const visible = (cfg: ReactorConfig, path: string) => fieldVisible(cfg.method, path, cfg);
    expect(visible(W7X, 'stellarator.H_ISS04')).toBe(true);
    expect(visible(ITER, 'stellarator.H_ISS04')).toBe(false);
    // legacy convention while blank: f_ren · H98
    expect(visible(W7X, 'stellarator.f_ren')).toBe(true);
    expect(visible(W7X, 'H98')).toBe(true);
    const set = setPath(W7X, 'stellarator.H_ISS04', 1.1);
    expect(visible(set, 'stellarator.f_ren')).toBe(false);
    expect(visible(set, 'H98')).toBe(false);
    expect(visible(setPath(ITER, 'H98', 1), 'H98')).toBe(true); // tokamaks keep H98
    // the wizard value reaches the live control of the model
    const sim = new Simulation({ ...set, t_end: 1 } as ReactorConfig);
    expect(sim.model.getControls().H_ISS04).toBe(1.1);
  });

  it('ICF driver and thermal efficiencies carry the model defaults and are shown for both ICF methods', () => {
    for (const m of ['icf_indirect', 'icf_direct'] as const) {
      expect(field(m, 'driverEff')).toMatchObject({ def: 0.1, min: 0.01, max: 0.5 });
      expect(field(m, 'thermalEff')).toMatchObject({ def: 0.4 });
    }
    expect(paths(NIF)).toEqual([]);
    expect(paths(setPath(DIRECT_DRIVE, 'driverEff', undefined))).toEqual([]); // blank runs as the default
  });

  it('the mirror plug potential is shown for a tandem mirror only', () => {
    expect(field('mirror', 'plugPotential')).toMatchObject({ def: 1, min: 0 });
    expect(fieldVisible('mirror', 'plugPotential', MIRROR)).toBe(true);
    expect(fieldVisible('mirror', 'plugPotential', setPath(MIRROR, 'tandem', false))).toBe(false);
  });

  it('every new field has an English and a Turkish label and hint', async () => {
    await loadLocale('tr'); // translator() takes the dictionaries loaded at the time it is made
    const en = translator('en');
    const tr = translator('tr');
    const news = [
      field('stellarator', 'stellarator.H_ISS04'), field('icf_indirect', 'driverEff'), field('icf_direct', 'thermalEff'),
      field('mirror', 'plugPotential'), field('tokamak', 'heating.autoOff'),
    ];
    for (const f of news) {
      expect(f.labelKey, f.path).toBeDefined();
      expect(fieldLabel(f, en), f.path).toBe(f.label);
      expect(fieldLabel(f, tr), f.path).not.toBe(f.label);
      expect(fieldHint(f, tr), f.path).not.toBe(fieldHint(f, en));
    }
  });

  it('the ignition-test switch says it also works in 1.5D and how (a ramp over the heating ramp time)', () => {
    const f = field('tokamak', 'heating.autoOff');
    expect(f.label).toBe('Ignition test: Q ≥ 5 → turn off heating');
    expect(f.hint).toMatch(/ramps down.*0D and 1\.5D/);
    expect(fieldVisible('tokamak', 'heating.autoOff', ITER_15D)).toBe(true);
  });
});

describe('cross-field checks', () => {
  const geom = (cfg: ReactorConfig, R: number, a: number) => setPath(setPath(cfg, 'geometry.R', R), 'geometry.a', a);

  it('every stock preset and method default is consistent', () => {
    for (const p of PRESETS) expect(crossFieldIssues(p.cfg), p.id).toEqual([]);
    for (const [m, cfg] of Object.entries(METHOD_DEFAULT)) expect(crossFieldIssues(cfg), m).toEqual([]);
  });

  it('a ≥ R is rejected for every magnetic torus, in 0D and 1.5D, and names both values', () => {
    for (const cfg of [ITER, MASTU, W7X, ITER_15D]) {
      const bad = geom(cfg, 1, 1.5);
      expect(crossFieldIssues(bad), cfg.method).toEqual([{ step: 'geometry', paths: ['geometry.R', 'geometry.a'], key: 'wiz.cross.aR', params: { a: 1.5, R: 1 } }]);
    }
    expect(crossFieldIssues(geom(ITER, 2, 2)).map((i) => i.key)).toEqual(['wiz.cross.aR']); // a = R is not a torus either
    const t = translator('en');
    expect(t('wiz.cross.aR', { a: 1.5, R: 1 })).toContain('1.5 m');
  });

  it('1.5D also needs room for the Grad–Shafranov box, R > 1.06 a; 0D does not', () => {
    const tight = geom(ITER_15D, 1.03, 1);
    expect(crossFieldIssues(tight).map((i) => i.key)).toEqual(['wiz.cross.aR15']);
    expect(crossFieldIssues(tight)[0].params).toMatchObject({ ratio: 1.03 });
    expect(crossFieldIssues(setPath(tight, 'fidelity', '0D'))).toEqual([]);
    expect(crossFieldIssues(geom(ITER_15D, 1.07, 1))).toEqual([]);
  });

  it('what the wizard accepts, the 1.5D model can start; what it rejects, the model refuses (MAST-U)', () => {
    const ok = geom(setPath(MASTU, 'fidelity', '1.5D'), 0.85, 0.6);
    expect(crossFieldIssues(ok)).toEqual([]);
    expect(() => new Simulation({ ...ok, t_end: 0.05 } as ReactorConfig)).not.toThrow();
    const bad = geom(ok, 0.85, 2);
    expect(crossFieldIssues(bad)).not.toEqual([]);
  }, 60_000);

  it('does not judge empty or non-finite values (missingRequired reports those) or non-magnetic methods', () => {
    expect(crossFieldIssues(setPath(ITER, 'geometry.a', undefined))).toEqual([]);
    expect(crossFieldIssues(setPath(ITER, 'geometry.R', NaN))).toEqual([]);
    expect(crossFieldIssues(TAE)).toEqual([]);
  });
});
