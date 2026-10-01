import { describe, expect, it } from 'vitest';
import { computePopcon } from '../physics/popcon';
import { greenwaldDensity, lineAverageFactor } from '../physics/limits';
import { MagneticConfig } from '../physics/types';
import { ignitionCells, playMission, popconMetrics, readPopcon, runMetrics, solveMission, goalMet, judge, RunData, METRIC_UNITS } from './missionEval';
import { MISSIONS, buildConfig, findMission, leverStart, leverValues, missionKey, operatingPoint } from './missions';
import { findTerm } from './glossary';
import { eduEn } from './i18n/en';
import { eduTr } from './i18n/tr';

const TEN = ['hmode', 'density', 'beta', 'kink', 'sparcQ', 'ignition', 'elm', 'fuel', 'nif', 'tungsten'];

describe('the mission list', () => {
  it('has the ten missions, each with a distinct id', () => {
    expect(MISSIONS.map((m) => m.id).sort()).toEqual([...TEN].sort());
    expect(findMission('elm')?.id).toBe('elm');
    expect(findMission('nope')).toBeUndefined();
  });

  it.each(MISSIONS)('$id: text, controls and terms are all defined in both languages', (m) => {
    for (const part of ['title', 'brief', 'hint1', 'hint2', 'lesson', 'answer'] as const) {
      const key = missionKey(m.id, part);
      expect(eduEn[key], key).toBeTruthy();
      expect(eduTr[key], key).toBeTruthy();
    }
    for (const l of m.levers) expect(eduEn[`lever.${l.id}`], l.id).toBeTruthy();
    for (const g of m.goals) {
      expect(eduEn[`metric.${g.metric}`], g.metric).toBeTruthy();
      expect(METRIC_UNITS[g.metric]).toBeTypeOf('string');
    }
    for (const term of m.terms) expect(findTerm(term), term).toBeDefined();
    expect(m.levers.length).toBeGreaterThanOrEqual(2);
  });

  it.each(MISSIONS)('$id: the starting values lie inside the lever ranges and every edit names a lever', (m) => {
    for (const l of m.levers) {
      const v = leverStart(m, l);
      if (l.type === 'number') {
        expect(Number(v), l.id).toBeGreaterThanOrEqual(l.min! - 1e-12);
        expect(Number(v), l.id).toBeLessThanOrEqual(l.max! + 1e-12);
      } else expect(l.options).toContain(v);
    }
    const ids = new Set(m.levers.map((l) => l.id as string));
    for (const k of [...Object.keys(m.control), ...Object.keys(solveMission(m))]) expect(ids.has(k), k).toBe(true);
    // the solution is inside the ranges as it stands: clamping must not change it
    const sol = solveMission(m);
    const clamped = leverValues(m, sol);
    for (const [k, v] of Object.entries(sol)) {
      if (typeof v === 'string') expect(clamped[k], k).toBe(v);
      else expect(clamped[k], k).toBeCloseTo(v, 9);
    }
  });
});

describe('configuration edits', () => {
  it('builds the configuration from the base without modifying it', () => {
    const m = findMission('hmode')!;
    const before = JSON.stringify(m.base);
    const cfg = buildConfig(m, { pNBI: 6, density: 0.5 }) as MagneticConfig;
    expect(cfg.heating.P_NBI_MW).toBe(6);
    expect(cfg.heating.P_ICRH_MW).toBe((m.base as MagneticConfig).heating.P_ICRH_MW);
    expect(cfg.n_target).toBeCloseTo(0.5e20, 6);
    expect(JSON.stringify(m.base)).toBe(before);
  });

  it('clamps a value outside the lever range and ignores a non-number', () => {
    const m = findMission('hmode')!;
    expect(leverValues(m, { pNBI: 999 }).pNBI).toBe(12);
    expect(leverValues(m, { pNBI: -5 }).pNBI).toBe(0);
    expect(leverValues(m, { pNBI: NaN }).pNBI).toBe(0.5);
    const fuel = findMission('fuel')!;
    expect(leverValues(fuel, { fuel: 'pB11' }).fuel).toBe('DD');
    expect((buildConfig(fuel, { fuel: 'DT' }) as MagneticConfig).fuel).toBe('DT');
  });

  it('reads a nested configuration path and applies a scaled one', () => {
    const m = findMission('elm')!;
    const cfg = buildConfig(m, { elmSize: 0.1, elmMargin: 1.2 }) as MagneticConfig;
    expect(cfg.profiles?.elmFraction).toBe(0.1);
    expect(cfg.profiles?.alphaCritFactor).toBe(1.2);
    expect(cfg.profiles?.lcfsKappa).toBe((m.base as MagneticConfig).profiles?.lcfsKappa);
    const tungsten = findMission('tungsten')!;
    expect((buildConfig(tungsten, { wConc: 2e-5 }) as MagneticConfig).impurity.concentration).toBeCloseTo(2e-5, 12);
    expect((buildConfig(tungsten, {}) as MagneticConfig).impurity.species).toBe('W');
  });

  it('only the POPCON mission has an operating point', () => {
    expect(operatingPoint(findMission('hmode')!, {})).toBeNull();
    const ign = findMission('ignition')!;
    expect(operatingPoint(ign, {})).toEqual({ n: 0.5e20, T: 8 });
    expect(operatingPoint(ign, { pointN: 0.8, pointT: 12 })).toEqual({ n: 0.8e20, T: 12 });
  });
});

describe('judging a run', () => {
  const report = (over: Record<string, unknown> = {}) => ({
    Q_sci_avg: 4, Q_sci_max: 6, E_fusion_MJ: 50, termination: { disruption: undefined, natural: true },
    ...over,
  }) as unknown as RunData['report'];
  const frames = (hm: number[]) => hm.map((h, i) => ({ t: i, d: { H_mode: h, nbar: 0.5 + i * 0.1, P_aux: 10, Ip: 2 } }));

  it('counts the H-mode share of the flat part only (after the first quarter of the shot)', () => {
    const run: RunData = { report: report(), frames: frames([0, 0, 1, 1, 1, 0, 1, 1]), events: [], tEnd: 8 };
    // frames from t = 2: 1,1,1,0,1,1 → 5/6
    expect(runMetrics(run).hModeFrac).toBeCloseTo(5 / 6, 12);
    expect(runMetrics(run).nbarMax).toBeCloseTo(1.2, 12);
    expect(runMetrics({ ...run, frames: [] }).hModeFrac).toBe(0);
  });

  it('a disruption or a shot that did not run to its scheduled end has not survived', () => {
    const ok = runMetrics({ report: report(), frames: [], events: [], tEnd: 1 });
    const disrupted = runMetrics({ report: report({ termination: { disruption: { cause: 'x' }, natural: false } }), frames: [], events: [], tEnd: 1 });
    const failed = runMetrics({ report: report({ termination: { natural: false } }), frames: [], events: [], tEnd: 1 });
    expect([ok.noDisruption, disrupted.noDisruption, failed.noDisruption]).toEqual([1, 0, 0]);
  });

  it('takes the largest ELM crash of the events', () => {
    const run: RunData = { report: report(), frames: [], tEnd: 1, events: [{ kind: 'ELM', value: 0.1 }, { kind: 'sawtooth', value: 9 }, { kind: 'ELM', value: 0.4 }] };
    expect(runMetrics(run).elmMax).toBe(0.4);
    expect(runMetrics({ ...run, events: [] }).elmMax).toBe(0);
  });

  it('a goal is met only by a finite value on the right side of the target', () => {
    expect(goalMet({ metric: 'qAvg', op: '>=', target: 3 }, 3)).toBe(true);
    expect(goalMet({ metric: 'qAvg', op: '>=', target: 3 }, 2.99)).toBe(false);
    expect(goalMet({ metric: 'elmMax', op: '<=', target: 0.3 }, 0.3)).toBe(true);
    expect(goalMet({ metric: 'elmMax', op: '<=', target: 0.3 }, NaN)).toBe(false);
    expect(goalMet({ metric: 'elmMax', op: '<=', target: 0.3 }, undefined)).toBe(false);
    const out = judge(findMission('sparcQ')!, { noDisruption: 1, qAvg: 2 });
    expect(out.passed).toBe(false);
    expect(out.results.map((r) => r.ok)).toEqual([true, false]);
  });
});

// Every mission is played three ways: untouched (it must fail: the mission is not trivial), with its negative
// control (a plausible attempt that must still fail) and with the headless solution (it must pass).
describe.each(MISSIONS)('mission $id', (m) => {
  it('fails as it starts, fails with the negative control and is solved by the solution script', () => {
    const start = playMission(m, {});
    const control = playMission(m, m.control);
    const solved = playMission(m, solveMission(m));
    expect(start.outcome.passed, 'the untouched mission must fail').toBe(false);
    expect(control.outcome.passed, 'the negative control must fail').toBe(false);
    expect(solved.outcome.passed, JSON.stringify(solved.outcome.results)).toBe(true);
  }, 120_000);
});

describe('the NIF mission does not promise ignition', () => {
  // The ICF model is calibrated on N210808 (G = 0.72), which it puts just below its own ignition threshold: with perfect symmetry the NIF capsule
  // reaches G = 0.78 at the nominal adiabat and ignites only with a lower one. The mission asks for the gain of N210808, not for ignition, so its title and goal must not say otherwise.
  const m = findMission('nif')!;

  it('is titled for the symmetry, in both languages, and asks for the gain of N210808 (0.7), not for breakeven or ignition', () => {
    for (const dict of [eduEn, eduTr]) expect(dict[missionKey('nif', 'title')], missionKey('nif', 'title')).not.toMatch(/ignit|ateşle/i);
    expect(eduEn[missionKey('nif', 'title')]).toBe('Squeeze the capsule evenly');
    expect(m.goals.find((g) => g.metric === 'gain')).toMatchObject({ op: '>=', target: 0.7 });
    expect(m.goals.some((g) => g.metric === 'ignited')).toBe(false);
  });

  it('the solution reaches that gain without an ignition event, and the answer says the model does not call it ignition', () => {
    const solved = playMission(m, solveMission(m));
    expect(solved.outcome.passed).toBe(true);
    expect(runMetrics(solved.run!).gain).toBeGreaterThan(0.7);
    expect(runMetrics(solved.run!).gain).toBeLessThan(1); // below scientific breakeven
    expect(solved.run!.events.some((e) => e.kind === 'ignition')).toBe(false);
    expect(eduEn[missionKey('nif', 'answer')]).toMatch(/Nor does it call this ignition/);
    expect(eduTr[missionKey('nif', 'answer')]).toMatch(/ateşleme de saymaz/);
  }, 60_000);
});

describe('the density mission text', () => {
  const m = findMission('density')!;
  const cfg = buildConfig(m, {}) as MagneticConfig;
  const nG = greenwaldDensity(cfg.Ip_MA, cfg.geometry.a);

  it('starts with a volume-average setpoint whose line average is beyond the Greenwald density, as the brief says, and disrupts on it', () => {
    expect(nG).toBeGreaterThan(1.05e20);
    expect(nG).toBeLessThan(1.2e20);
    // the setpoint of the 0D model is the volume average; the limit is on the line average (11 % higher at alpha_n = 0.3)
    const fLine = lineAverageFactor(cfg.transport.alpha_n);
    expect(cfg.n_target * fLine / nG).toBeGreaterThan(1.1);
    const r = playMission(m, {});
    expect(r.run).toBeDefined();
    expect(runMetrics(r.run!).nbarMax! * 1e20).toBeGreaterThanOrEqual(nG * 0.98);
    expect(r.run!.report.termination.disruption?.cause).toBe('density_limit');
  });

  it('has a negative control below n_G as a number but above n_G / f_line, the setpoint at which the line average reaches the limit', () => {
    const control = buildConfig(m, m.control) as MagneticConfig;
    const fLine = lineAverageFactor(control.transport.alpha_n);
    expect(control.n_target).toBeLessThan(nG);
    expect(control.n_target).toBeGreaterThan(nG / fLine);
    expect(playMission(m, m.control).outcome.passed).toBe(false);
  });

  it('says so in English and Turkish: the setpoint is a volume average and the limit is on the line average, n_G is about 1.1e20', () => {
    expect(eduEn['mis.density.brief']).toContain('1.25e20');
    expect(eduEn['mis.density.brief']).toContain('volume-average');
    expect(eduEn['mis.density.brief']).toContain('line-averaged');
    // the current the brief quotes is the 1.6 MA of the preset (n_G = 1.1345e20; 2.0 MA would give 1.42e20)
    expect(eduEn['mis.density.brief']).toContain('1.6 MA');
    expect(eduEn['mis.density.brief']).not.toContain('2.0 MA');
    expect(eduTr['mis.density.brief']).toContain('1,6 MA');
    expect(eduTr['mis.density.brief']).not.toContain('2,0 MA');
    expect(eduTr['mis.density.brief']).toContain('1,25e20');
    expect(eduTr['mis.density.brief']).toContain('hacim ortalamalı');
    expect(eduTr['mis.density.brief']).toContain('çizgi ortalamalı');
    expect(cfg.n_target).toBeCloseTo(1.25e20, 6); // the number the brief quotes
    for (const txt of [eduEn['mis.density.brief'], eduEn['mis.density.answer']]) expect(txt).toMatch(/1\.1e20/);
    for (const txt of [eduTr['mis.density.brief'], eduTr['mis.density.answer']]) expect(txt).toMatch(/1,1e20/);
    // the solution's own numbers: a 0.7e20 setpoint gives a line average near 0.8e20, which is n̄/n_G ≈ 0.7
    const sol = playMission(m, solveMission(m));
    const peak = runMetrics(sol.run!).nbarMax! * 1e20; // the metric is in 1e20 m⁻³
    expect(peak).toBeGreaterThan(0.75e20);
    expect(peak).toBeLessThan(0.85e20);
    expect(peak / nG).toBeGreaterThan(0.65);
    expect(peak / nG).toBeLessThan(0.75);
  });
});

describe('the POPCON mission', () => {
  const m = findMission('ignition')!;
  const base = m.base as MagneticConfig;

  it('has no ignited region inside the limits at the starting H98 or at the control H98, and one at the solution', () => {
    for (const H98 of [1.0, 1.2]) {
      const cfg = { ...base, H98 };
      expect(ignitionCells(cfg, computePopcon(cfg)), `H98 ${H98}`).toEqual([]);
    }
    const sol = solveMission(m);
    const cfg = { ...base, H98: Number(sol.H98) };
    const cells = ignitionCells(cfg, computePopcon(cfg));
    expect(cells.length).toBeGreaterThan(5);
    expect(Number(sol.H98)).toBeLessThanOrEqual(1.3);
    // the solution point is the cell of highest fusion power
    expect(Math.abs(Number(sol.pointN) * 1e20 - cells[0].n) / cells[0].n).toBeLessThan(1e-3);
  });

  it('reads the map at the nearest cell and reports the power needed', () => {
    const grid = computePopcon(base);
    const r = readPopcon(grid, { n: 0.5e20, T: 8 });
    expect(Math.abs(r.n - 0.5e20)).toBeLessThan(grid.n[1] - grid.n[0]);
    expect(r.Paux_MW).toBeGreaterThan(0);
    expect(popconMetrics(base, r)).toEqual({ ignited: 0, inLimits: 1 });
    // far above the Greenwald limit: outside the limits
    const rich = readPopcon(grid, { n: grid.n[grid.n.length - 1], T: 8 });
    expect(popconMetrics(base, rich).inLimits).toBe(0);
  });
});
