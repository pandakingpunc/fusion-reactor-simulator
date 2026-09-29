import { describe, expect, it } from 'vitest';
import { fieldInfo, validateConfig } from '../../physics/config/schema';
import { DEFAULT_EDGE_PARAMS } from '../../physics/edge/params';
import { DEFAULT_PROFILE_SETTINGS } from '../../physics/profiles/defaults';
import { DEFAULT_PULSE_LENGTH_S } from '../../physics/systems/cryo';
import { ITER, ITER_15D, W7X } from '../../physics/presets';
import { Simulation } from '../../physics/simulation';
import type { ReactorConfig } from '../../physics/types';
import { ADVANCED_FIELDS } from './advanced';
import { ADVANCED_PATHS, ADVANCED_STEPS, advancedApplies, advancedOverrides, fieldVisible, getPath, isRequired, missingRequired, setPath } from './schema';

const all = ADVANCED_STEPS.flatMap((s) => ADVANCED_FIELDS[s]);

describe('the Advanced fields', () => {
  it('are the paths the wizard lists without loading them, per step', () => {
    for (const s of ADVANCED_STEPS) expect(ADVANCED_FIELDS[s].map((f) => f.path)).toEqual([...ADVANCED_PATHS[s]]);
  });

  it('are the systems pulse length, the edge options that are not in the steps, and the five solver settings', () => {
    expect(ADVANCED_FIELDS.driver.map((f) => f.path)).toEqual([
      'systems.pulseLength_s', 'divertor.edge.outerShare', 'divertor.edge.spreadingRatio', 'divertor.edge.S_mm', 'divertor.edge.divertorLengthFraction',
      'divertor.edge.kappa0e', 'divertor.edge.sheathGamma', 'divertor.edge.lossFit', 'divertor.edge.seedEnrichment', 'divertor.edge.detachTt_eV',
      'divertor.edge.targetTilt', 'divertor.edge.strikeRadiusFraction',
    ]);
    expect(ADVANCED_FIELDS.heating.map((f) => f.path)).toEqual(['profiles.rtol', 'profiles.atol', 'profiles.dtMax', 'profiles.gridPacking', 'profiles.nonlinearSolver']);
  });

  it('are real configuration properties whose ranges the model accepts (a range the wizard offers is inside the model\'s)', () => {
    for (const f of all) {
      const info = fieldInfo('tokamak', f.path);
      expect(info, f.path).toBeDefined();
      expect(info!.kind, f.path).toBe(f.type === 'select' ? 'enum' : 'number');
      if (f.type === 'select') { expect(f.options!.map((o) => o.value).sort(), f.path).toEqual([...info!.values!].sort()); continue; }
      if (f.min !== undefined) { expect(f.min, f.path).toBeGreaterThanOrEqual(info!.min ?? -Infinity); if (info!.exMin !== undefined) expect(f.min, f.path).toBeGreaterThan(info!.exMin); }
      if (f.max !== undefined) expect(f.max, f.path).toBeLessThanOrEqual(info!.max ?? Infinity);
    }
  });

  it('show the default the model uses, so that an untouched section changes nothing', () => {
    const d = (p: string) => all.find((f) => f.path === p)!.def;
    expect(d('divertor.edge.outerShare')).toBe(DEFAULT_EDGE_PARAMS.outerShare);
    expect(d('divertor.edge.spreadingRatio')).toBe(DEFAULT_EDGE_PARAMS.spreadingRatio);
    expect(d('divertor.edge.divertorLengthFraction')).toBe(DEFAULT_EDGE_PARAMS.divertorLengthFraction);
    expect(d('divertor.edge.kappa0e')).toBe(DEFAULT_EDGE_PARAMS.kappa0e);
    expect(d('divertor.edge.sheathGamma')).toBe(DEFAULT_EDGE_PARAMS.sheathGamma);
    expect(d('divertor.edge.lossFit')).toBe(DEFAULT_EDGE_PARAMS.fit.name);
    expect(d('divertor.edge.seedEnrichment')).toBe(DEFAULT_EDGE_PARAMS.seedEnrichment);
    expect(d('divertor.edge.detachTt_eV')).toBe(DEFAULT_EDGE_PARAMS.detachTt_eV);
    expect(d('divertor.edge.targetTilt')).toBe(DEFAULT_EDGE_PARAMS.targetTilt);
    expect(d('divertor.edge.strikeRadiusFraction')).toBe(DEFAULT_EDGE_PARAMS.strikeRadiusFraction);
    for (const k of ['rtol', 'atol', 'dtMax', 'gridPacking'] as const) expect(d(`profiles.${k}`), k).toBe(DEFAULT_PROFILE_SETTINGS[k]);
    expect(d('profiles.nonlinearSolver')).toBe('auto');
    // the two settings with a blank meaning say so, and name the default the model uses
    const pulse = all.find((f) => f.path === 'systems.pulseLength_s')!;
    expect(pulse.optional).toBe(true);
    expect(pulse.hint).toMatch(/^Blank = 1055 s/);
    expect(DEFAULT_PULSE_LENGTH_S).toBe(1055);
    expect(all.find((f) => f.path === 'divertor.edge.S_mm')!.hint).toMatch(/^Blank/);
  });

  it('never block a run, blank or not (each is optional or has the model\'s default)', () => {
    for (const f of all) expect(isRequired(f), f.path).toBe(false);
    expect(missingRequired(ITER_15D)).toEqual([]);
  });

  it('are accepted by the configuration check with values inside the offered ranges', () => {
    let cfg: ReactorConfig = ITER_15D;
    for (const f of all) {
      const v = f.type === 'select' ? f.options![1].value : ((f.min ?? 0) + (f.max ?? 1)) / 2;
      cfg = setPath(cfg, f.path, v);
    }
    const r = validateConfig(cfg);
    expect(r.ok, JSON.stringify((r as { issues?: unknown }).issues)).toBe(true);
  });

  it('apply to the configurations that have something to show: the solver only with the 1.5D model, the edge options for a tokamak, the pulse length for a stellarator too', () => {
    expect(advancedApplies('driver', 'tokamak', ITER)).toBe(true);
    expect(advancedApplies('heating', 'tokamak', ITER)).toBe(false); // 0D
    expect(advancedApplies('heating', 'tokamak', ITER_15D)).toBe(true);
    expect(advancedApplies('driver', 'stellarator', W7X)).toBe(true); // systems.pulseLength_s only
    expect(fieldVisible('stellarator', 'divertor.edge.outerShare', W7X)).toBe(false);
    expect(fieldVisible('stellarator', 'systems.pulseLength_s', W7X)).toBe(true);
    expect(advancedApplies('driver', 'frc')).toBe(false);
  });

  it('reach the model: a pulse length and an edge option written by the wizard change the report the way they say', () => {
    const run = (cfg: ReactorConfig) => new Simulation({ ...cfg, t_end: 3 } as ReactorConfig).runAll().engineering;
    const base = run(ITER);
    expect(base['Cryo pulse length (s)']).toBe(DEFAULT_PULSE_LENGTH_S);
    const set = run(setPath(setPath(ITER, 'systems.pulseLength_s', 7200), 'divertor.edge.sheathGamma', 8.6));
    expect(set['Cryo pulse length (s)']).toBe(7200);
    // a higher sheath transmission coefficient puts the same power on the target at a lower temperature: the edge rows move
    expect(set['Target T_e, two-point (eV)']).not.toBe(base['Target T_e, two-point (eV)']);
  }, 30_000);

  it('lists the settings a configuration carries, and not the blank ones', () => {
    expect(advancedOverrides(ITER_15D)).toEqual([]);
    let cfg: ReactorConfig = setPath(ITER_15D, 'systems.pulseLength_s', 7200);
    cfg = setPath(cfg, 'profiles.rtol', 5e-3);
    cfg = setPath(cfg, 'divertor.edge.S_mm', undefined);
    expect(advancedOverrides(cfg)).toEqual([{ step: 'driver', path: 'systems.pulseLength_s' }, { step: 'heating', path: 'profiles.rtol' }]);
    expect(getPath(cfg, 'systems.pulseLength_s')).toBe(7200);
    // a stellarator does not carry edge settings it cannot use
    expect(advancedOverrides(setPath(W7X, 'divertor.edge.outerShare', 0.7))).toEqual([]);
  });
});
