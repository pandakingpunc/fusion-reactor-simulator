/**
 * The step-control settings of the 1.5D model that it cannot run without (settings.ts): rtol > 0, atol >= 0, dtMax >= the shortest step.
 *
 * A value outside the domain used to stall the shot without an error: dtMax <= 0 (or NaN) never advances the kernel, a tolerance that
 * is NaN makes every error estimate infinite, and zero relative and absolute tolerances together reject every step down to the floor.
 * The shots below are stepped by hand with a bound on the number of steps, so that a regression fails the test instead of hanging it.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../presets';
import type { MagneticConfig, ProfileSettings, SimEvent } from '../types';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { ProfileModel } from './model';
import { STEP_DT_MIN as STEP_DT_MIN_STEPPER } from './solver/coupledStep';
import { checkProfileSettings, STEP_DT_MIN } from './settings';
import { profileSettings } from './context';

const T_END = 0.05;

function shot(profiles: Record<string, unknown>, maxSteps = 1000): { t: number; steps: number; y: Float64Array; events: SimEvent[]; ps: ProfileSettings } {
  const cfg = { ...JET_15D, t_end: T_END, profiles: { ...JET_15D.profiles, ...profiles } } as MagneticConfig;
  const m = new ProfileModel(cfg);
  const y = m.initialState();
  m.diagnostics(0, y);
  const events: SimEvent[] = [];
  let t = 0, steps = 0;
  while (t < T_END && !m.terminated && steps < maxSteps) {
    const t1 = m.step(t, y, T_END);
    events.push(...m.postStep(t1, t1 - t, y));
    t = t1; steps++;
  }
  return { t, steps, y, events, ps: m.ps };
}

const warnings = (events: SimEvent[], key: string) => events.filter((e) => e.kind === 'warning' && e.msg.includes(`ProfileSettings.${key}`));

describe('checkProfileSettings', () => {
  const base = { ...DEFAULT_PROFILE_SETTINGS };

  it('leaves the defaults and any valid setting as they are, and says nothing', () => {
    expect(checkProfileSettings(base)).toEqual({ ps: base, notes: [] });
    const own = { ...base, rtol: 1e-6, atol: 0, dtMax: 1e-3 };
    expect(checkProfileSettings(own)).toEqual({ ps: own, notes: [] });
    // dtMax = the shortest step is allowed; an absent setting is the default of the step control, not an error
    expect(checkProfileSettings({ ...base, dtMax: STEP_DT_MIN }).notes).toEqual([]);
    const { rtol, atol, dtMax, ...bare } = base;
    void rtol; void atol; void dtMax;
    expect(checkProfileSettings(bare)).toEqual({ ps: bare, notes: [] });
  });

  it.each([[NaN], [0], [-1e-3], [Infinity], [-Infinity], ['0.01' as unknown as number]])('rtol = %s is replaced by the default', (bad) => {
    const r = checkProfileSettings({ ...base, rtol: bad });
    expect(r.ps.rtol).toBe(DEFAULT_PROFILE_SETTINGS.rtol);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ key: 'rtol', used: DEFAULT_PROFILE_SETTINGS.rtol });
    expect(r.notes[0].message).toContain('ProfileSettings.rtol');
  });

  it.each([[NaN], [-1e-4], [Infinity]])('atol = %s is replaced by the default; zero is a valid absolute tolerance', (bad) => {
    const r = checkProfileSettings({ ...base, atol: bad });
    expect(r.ps.atol).toBe(DEFAULT_PROFILE_SETTINGS.atol);
    expect(r.notes.map((n) => n.key)).toEqual(['atol']);
    expect(checkProfileSettings({ ...base, atol: 0 })).toEqual({ ps: { ...base, atol: 0 }, notes: [] });
  });

  it.each([[0], [-1], [NaN], [Infinity]])('dtMax = %s is replaced by the default', (bad) => {
    const r = checkProfileSettings({ ...base, dtMax: bad });
    expect(r.ps.dtMax).toBe(DEFAULT_PROFILE_SETTINGS.dtMax);
    expect(r.notes.map((n) => n.key)).toEqual(['dtMax']);
  });

  it('a step limit below the shortest step is raised to it (the controller keeps the step between the two), and the stepper uses the same floor', () => {
    const r = checkProfileSettings({ ...base, dtMax: 1e-9 });
    expect(r.ps.dtMax).toBe(STEP_DT_MIN);
    expect(r.notes).toHaveLength(1);
    expect(STEP_DT_MIN_STEPPER).toBe(STEP_DT_MIN);
  });

  it('reports every setting that was replaced, and only those; the input is not changed', () => {
    const given = { ...base, rtol: NaN, atol: 5e-4, dtMax: -3 };
    const r = checkProfileSettings(given);
    expect(r.notes.map((n) => n.key)).toEqual(['rtol', 'dtMax']);
    expect(r.ps).toEqual({ ...base, atol: 5e-4 });
    expect(given.rtol).toBeNaN();
  });

  it('profileSettings applies it to the configuration of a run (a blank input keeps the default and is no error)', () => {
    const cfg = (p: Record<string, unknown>) => ({ ...JET_15D, profiles: p }) as MagneticConfig;
    expect(profileSettings(cfg({ dtMax: 0, rtol: 3e-3 }))).toMatchObject({ dtMax: DEFAULT_PROFILE_SETTINGS.dtMax, rtol: 3e-3 });
    expect(profileSettings(cfg({ dtMax: undefined, rtol: null }))).toMatchObject({ dtMax: DEFAULT_PROFILE_SETTINGS.dtMax, rtol: DEFAULT_PROFILE_SETTINGS.rtol });
  });
});

describe('a shot with a setting outside its domain', () => {
  const ref = shot({});

  it('the reference shot reaches its end in a few dozen steps and issues no warning of the settings', () => {
    expect(ref.t).toBeGreaterThanOrEqual(T_END);
    expect(ref.steps).toBeLessThan(200);
    expect(ref.events.filter((e) => e.kind === 'warning' && e.msg.includes('ProfileSettings.'))).toEqual([]);
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ['dtMax = 0', { dtMax: 0 }, 'dtMax'],
    ['dtMax = -1', { dtMax: -1 }, 'dtMax'],
    ['dtMax = NaN', { dtMax: NaN }, 'dtMax'],
    ['rtol = NaN', { rtol: NaN }, 'rtol'],
    ['rtol = 0', { rtol: 0 }, 'rtol'],
    ['rtol = -1', { rtol: -1 }, 'rtol'],
    ['atol = NaN', { atol: NaN }, 'atol'],
    ['atol = -1', { atol: -1 }, 'atol'],
    ['rtol = 0 and atol = NaN', { rtol: 0, atol: NaN }, 'rtol'],
  ];
  it.each(cases)('%s: the shot is the one with the default, and the replacement is a warning at t = 0', (_label, p, key) => {
    const s = shot(p);
    expect(s.t).toBeGreaterThanOrEqual(T_END);
    expect(s.steps).toBe(ref.steps);
    expect(Array.from(s.y)).toEqual(Array.from(ref.y));
    const w = warnings(s.events, key);
    expect(w).toHaveLength(1);
    expect(w[0].t).toBe(0);
    expect(w[0].msg).toContain('is used');
  });

  it('zero relative and absolute tolerances together are one replacement (rtol) and a valid atol = 0, and the shot ends', () => {
    const s = shot({ rtol: 0, atol: 0 });
    expect(s.t).toBeGreaterThanOrEqual(T_END);
    expect(s.steps).toBeLessThan(3 * ref.steps);
    expect(warnings(s.events, 'rtol')).toHaveLength(1);
    expect(warnings(s.events, 'atol')).toHaveLength(0);
  });

  it('a step limit below the shortest step is the shortest step: the shot advances (1e-6 s per step at most)', () => {
    const s = shot({ dtMax: 1e-9 }, 300);
    expect(s.ps.dtMax).toBe(STEP_DT_MIN);
    expect(s.t).toBeGreaterThan(0);
    expect(s.t).toBeLessThanOrEqual(300 * STEP_DT_MIN * (1 + 1e-9));
    expect(warnings(s.events, 'dtMax')).toHaveLength(1);
  });

  it('valid settings are no warning, and explicit defaults are the shot without them, bit for bit', () => {
    const s = shot({ rtol: DEFAULT_PROFILE_SETTINGS.rtol, atol: DEFAULT_PROFILE_SETTINGS.atol, dtMax: DEFAULT_PROFILE_SETTINGS.dtMax });
    expect(s.steps).toBe(ref.steps);
    expect(Array.from(s.y)).toEqual(Array.from(ref.y));
    expect(s.events.filter((e) => e.kind === 'warning' && e.msg.includes('ProfileSettings.'))).toEqual([]);
    const tight = shot({ rtol: 1e-4, dtMax: 0.01 });
    expect(tight.steps).toBeGreaterThan(ref.steps);
    expect(tight.events.filter((e) => e.kind === 'warning' && e.msg.includes('ProfileSettings.'))).toEqual([]);
  });
});
