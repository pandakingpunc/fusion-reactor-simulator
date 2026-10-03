import { describe, expect, it } from 'vitest';
import { checkMagnet } from '../physics/engineering';
import { ITER, SPARC, W7X } from '../physics/presets';
import type { MagneticConfig } from '../physics/types';
import { greenwaldDensity, lineAverageFactor } from '../physics/limits';
import {
  DESIGN_OBJECTIVES, DESIGN_VARS, OPTIMIZATION_CAVEAT, constraintValues, designHash, designPoint, designReport, paretoReport, solvePareto, objectiveNatural, objectiveValue, presetDesign, resolveConstraints, solveDesign,
} from './design';
import { unitSample } from './samplers';
import { steadyState } from './steadyState';

describe('design point', () => {
  const v = presetDesign(ITER);

  it('the preset design values: geometry, field, current, H98, and the operating point of a POPCON study (fG 0.85, T 12 keV)', () => {
    expect(v).toEqual({ R: 6.2, a: 2, B0: 5.3, Ip: 15, fG: 0.85, T: 12, H98: 1, kappa: 1.7 });
    expect(presetDesign({ ...ITER, limits: { ...ITER.limits, greenwald_limit: 0.7 } }).fG).toBe(0.7);
  });

  it('builds the machine, the density from the Greenwald fraction, and the steady state of that point', () => {
    const pt = designPoint(ITER, { ...v, R: 5.5, a: 1.9, B0: 5, Ip: 13, fG: 0.8, T: 10, H98: 1.1, kappa: 1.8 });
    expect(pt.cfg.geometry).toEqual({ R: 5.5, a: 1.9, kappa: 1.8, delta: 0.33 });
    expect(pt.cfg.B0).toBe(5);
    expect(pt.cfg.Ip_MA).toBe(13);
    expect(pt.cfg.H98).toBe(1.1);
    expect(pt.cfg.impurity).toBe(ITER.impurity);
    // the line-averaged density is the Greenwald fraction times the Greenwald density
    expect(lineAverageFactor(ITER.transport.alpha_n) * pt.n).toBeCloseTo(0.8 * greenwaldDensity(13, 1.9), 3);
    expect(pt.state).toEqual(steadyState(pt.cfg, pt.n, 10));
    expect(pt.state.nOverNG).toBeCloseTo(0.8, 12);
    expect(pt.aspect).toBeCloseTo(5.5 / 1.9, 14);
    const m = checkMagnet(pt.cfg.geometry, 5, ITER.magnet.tech, ITER.magnet.gap_m, ITER.magnet.coilThickness_m);
    expect(pt.magnet).toEqual(m);
    expect(pt.wallLoad).toBeGreaterThan(0.1);
    expect(pt.wallLoad).toBeLessThan(3);
    expect(ITER.geometry.R).toBe(6.2); // the preset is untouched
  });
});

describe('constraints', () => {
  it('defaults come from the preset: its limits, installed heating power and aspect ratio', () => {
    const c = resolveConstraints(ITER);
    expect(c).toEqual({
      qMin: 10, betaNMax: 3.5, q95Min: 3, lhMargin: 1, pauxMaxMW: 50, coil: true, aspectMin: 0.6 * (6.2 / 2), aspectMax: 1.6 * (6.2 / 2), pfusMinMW: null, wallLoadMax: null,
    });
    expect(resolveConstraints(ITER, { qMin: null, lhMargin: null, pauxMaxMW: null, coil: false, pfusMinMW: 400, wallLoadMax: 1.5, q95Min: 3.5, betaNMax: 3 })).toMatchObject({
      qMin: null, lhMargin: null, pauxMaxMW: null, coil: false, pfusMinMW: 400, wallLoadMax: 1.5, q95Min: 3.5, betaNMax: 3,
    });
    expect(resolveConstraints({ ...ITER, heating: { ...ITER.heating, P_NBI_MW: 0, P_ICRH_MW: 0, P_ECRH_MW: 0 } }).pauxMaxMW).toBeNull();
    expect(resolveConstraints({ ...ITER, limits: { ...ITER.limits, q95_limit: 4 } }).q95Min).toBe(4);
  });

  it('normalised so that g <= 0 is feasible: values and signs at a hand-checked point', () => {
    const pt = designPoint(ITER, presetDesign(ITER));
    const cv = constraintValues(pt, resolveConstraints(ITER, { pfusMinMW: 2000, wallLoadMax: 0.1 }));
    const by = Object.fromEntries(cv.map((c) => [c.id, c]));
    expect(cv.map((c) => c.id)).toEqual(['Q', 'betaN', 'q95', 'PL/PLH', 'Paux', 'Bcoil', 'stress', 'aspect>=', 'aspect<=', 'Pfus', 'wall']);
    const s = pt.state;
    expect(by.Q.g).toBeCloseTo(1 - s.Q / 10, 12);
    expect(by.Q.g).toBeGreaterThan(0); // Q < 10 at this point: violated
    expect(by.betaN.g).toBeCloseTo(s.betaN / 3.5 - 1, 12);
    expect(by.betaN.g).toBeLessThan(0);
    expect(by['PL/PLH'].g).toBeCloseTo(1 - s.PL / s.PLH, 12);
    expect(by.Paux.value).toBeCloseTo(s.Paux / 1e6, 12);
    expect(by.Paux.limit).toBe(50);
    expect(by.Bcoil.value).toBeCloseTo(pt.magnet.B_coil, 12);
    expect(by.Bcoil.limit).toBe(13);
    expect(by['aspect>='].g).toBeLessThan(0);
    expect(by.Pfus.g).toBeGreaterThan(0); // 2000 MW required, the point makes about 1100 MW
    expect(by.wall.g).toBeGreaterThan(0);
  });

  it('the gain is capped at 1000 (ignition has no meaningful Q) and disabled constraints are left out', () => {
    const clean: MagneticConfig = { ...ITER, impurity: { ...ITER.impurity, concentration: 1e-4, seedConcentration: 0, seedSpecies: undefined }, H98: 2 };
    const pt = designPoint(clean, { ...presetDesign(clean), fG: 0.5, T: 6 });
    expect(pt.state.Q).toBe(Infinity);
    const q = constraintValues(pt, resolveConstraints(clean)).find((c) => c.id === 'Q')!;
    expect(q.value).toBe(1000);
    expect(Number.isFinite(q.g)).toBe(true);
    expect(constraintValues(pt, resolveConstraints(clean, { qMin: null, lhMargin: null, pauxMaxMW: null, coil: false })).map((c) => c.id)).toEqual(['betaN', 'q95', 'aspect>=', 'aspect<=']);
  });
});

describe('objectives', () => {
  const ref = designPoint(ITER, presetDesign(ITER));
  it('are scaled to one at the preset, or to a reference power, and reported in natural units', () => {
    expect(objectiveValue('major-radius', ref, ref)).toBe(1);
    expect(objectiveValue('plasma-volume', ref, ref)).toBe(1);
    expect(objectiveValue('aux-power', ref, ref)).toBeCloseTo(ref.state.Paux / 1e6 / 50, 12);
    expect(objectiveValue('fusion-power', ref, ref)).toBeCloseTo(-ref.state.Pfus / 5e8, 12);
    expect(objectiveValue('gain', ref, ref)).toBeCloseTo(-Math.min(ref.state.Q, 1000) / 10, 12);
    expect(objectiveNatural('major-radius', ref)).toEqual({ value: 6.2, unit: 'm', label: 'major radius R' });
    expect(objectiveNatural('plasma-volume', ref).unit).toBe('m^3');
    expect(objectiveNatural('aux-power', ref).value).toBeCloseTo(ref.state.Paux / 1e6, 12);
    expect(objectiveNatural('fusion-power', ref).unit).toBe('MW');
    expect(objectiveNatural('gain', ref).value).toBe(ref.state.Q);
    expect(DESIGN_OBJECTIVES).toHaveLength(5);
    expect(DESIGN_VARS).toContain('kappa');
  });
});

/** one temperature start keeps the solves short; the multi-start is exercised below */
const FAST = { startTemperatures: [10] } as const;

describe('design optimisation of an ITER-class machine: the smallest major radius at Q = 10', { timeout: 60_000 }, () => {
  const res = solveDesign({ base: ITER, objective: 'major-radius', ...FAST });

  it('finds a feasible optimum smaller than the preset, with the constraint set that limits it active', () => {
    expect(res.feasible).toBe(true);
    expect(res.solver.converged).toBe(true);
    expect(res.solver.violation).toBeLessThan(1e-6);
    expect(res.objective.value).toBeLessThan(res.objective.preset);
    expect(res.objective).toMatchObject({ name: 'major-radius', label: 'major radius R', unit: 'm', preset: 6.2 });
    for (const c of res.constraints) expect(c.satisfied, c.id).toBe(true);
    const active = res.constraints.filter((c) => c.active).map((c) => c.id);
    for (const id of ['Q', 'q95', 'Bcoil']) expect(active).toContain(id);
    expect(res.optimum.Q).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(res.optimum.q95).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(res.optimum.Paux_MW).toBeLessThanOrEqual(50 + 1e-5);
    expect(res.optimum.B_coil_T).toBeLessThanOrEqual(13 + 1e-5);
    expect(res.optimum.betaN).toBeLessThan(3.5);
    expect(res.optimum.PLoverPLH).toBeGreaterThan(1);
    expect(res.optimum.nOverNG).toBeLessThanOrEqual(1);
    expect(res.caveat).toBe(OPTIMIZATION_CAVEAT);
    expect(res.caveat).toMatch(/^EDUCATIONAL/);
  });

  it('the variables are within their bounds; the design values reproduce the reported optimum', () => {
    for (const v of res.variables) {
      expect(v.value).toBeGreaterThanOrEqual(v.lo - 1e-12);
      expect(v.value).toBeLessThanOrEqual(v.hi + 1e-12);
    }
    const byName = Object.fromEntries(res.variables.map((v) => [v.name, v]));
    expect(byName.R.value).toBeCloseTo(res.objective.value, 12);
    expect(byName.R.preset).toBe(6.2);
    expect(byName.R.lo).toBeCloseTo(0.6 * 6.2, 12);
    expect(byName.fG.hi).toBe(1);
    const pt = designPoint(ITER, { ...presetDesign(ITER), ...Object.fromEntries(res.variables.map((v) => [v.name, v.value])) });
    expect(pt.state.Q).toBeCloseTo(res.optimum.Q, 9);
    expect(pt.state.Paux / 1e6).toBeCloseTo(res.optimum.Paux_MW, 9);
    expect(res.optimum.T_keV).toBe(byName.T.value);
  });

  it('KKT: the multipliers of the active constraints are positive, the others zero', () => {
    for (const c of res.constraints) {
      expect(c.multiplier, c.id).toBeGreaterThanOrEqual(0);
      if (!c.active) expect(c.multiplier, `${c.id} inactive`).toBeLessThan(1e-3);
    }
    expect(res.constraints.find((c) => c.id === 'Q')!.multiplier).toBeGreaterThan(1e-3);
  });

  it('no random feasible design has a smaller major radius (20000 Sobol points over the same box)', () => {
    const names = res.variables.map((v) => v.name);
    const U = unitSample('sobol', 20000, names.length, { seed: 5 });
    const cons = resolveConstraints(ITER);
    let bestFeasibleR = Infinity, nFeasible = 0;
    for (let i = 0; i < 20000; i++) {
      const vals = { ...presetDesign(ITER) } as Record<string, number>;
      names.forEach((nm, k) => { const b = res.variables[k]; vals[nm] = b.lo + U[i * names.length + k] * (b.hi - b.lo); });
      const pt = designPoint(ITER, vals as never);
      if (constraintValues(pt, cons).every((c) => c.g <= 0)) { nFeasible++; bestFeasibleR = Math.min(bestFeasibleR, vals.R); }
    }
    expect(nFeasible).toBeGreaterThan(0);
    expect(bestFeasibleR).toBeGreaterThanOrEqual(res.objective.value - 1e-6);
  });

  it('is deterministic', () => {
    expect(solveDesign({ base: ITER, objective: 'major-radius', ...FAST })).toEqual(res);
  });
});

describe('other objectives and options', { timeout: 60_000 }, () => {
  it('maximum gain at fixed geometry beats every feasible point of a density-temperature grid', () => {
    const res = solveDesign({ base: ITER, objective: 'gain', variables: ['fG', 'T'], constraints: { qMin: null, q95Min: 2.5 }, startTemperatures: [6, 12] });
    expect(res.feasible).toBe(true);
    let bestGrid = 0;
    const cons = resolveConstraints(ITER, { qMin: null, q95Min: 2.5 });
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 30; j++) {
        const pt = designPoint(ITER, { ...presetDesign(ITER), fG: 0.1 + (0.9 * i) / 24, T: 2 + (38 * j) / 29 });
        if (constraintValues(pt, cons).every((c) => c.g <= 0)) bestGrid = Math.max(bestGrid, Math.min(pt.state.Q, 1000));
      }
    }
    expect(bestGrid).toBeGreaterThan(5);
    expect(Math.min(res.optimum.Q, 1000)).toBeGreaterThanOrEqual(bestGrid - 1e-9);
    // only the two chosen variables move
    expect(res.variables.map((v) => v.name)).toEqual(['fG', 'T']);
    expect(res.constraints.map((c) => c.id)).not.toContain('Q');
  });

  it('minimum auxiliary power at Q >= 10 in the preset machine (H98 free): a well-formed result with the objective in MW', () => {
    const res = solveDesign({ base: SPARC, objective: 'aux-power', variables: ['fG', 'T', 'H98'], constraints: { qMin: 10, pauxMaxMW: null }, ...FAST });
    expect(res.objective.unit).toBe('MW');
    expect(res.objective.name).toBe('aux-power');
    expect(res.variables.map((v) => v.name)).toEqual(['fG', 'T', 'H98']);
    expect(res.variables[2].lo).toBe(0.8);
    expect(res.variables[2].hi).toBe(1.5);
    if (res.feasible) expect(res.optimum.Q).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it('a requirement that cannot be met is reported as infeasible, with the least violated design', () => {
    const res = solveDesign({ base: ITER, objective: 'major-radius', constraints: { qMin: 1e4 }, solver: { maxOuter: 3, maxEvals: 6000 }, ...FAST });
    expect(res.feasible).toBe(false);
    expect(res.solver.violation).toBeGreaterThan(0.5);
    expect(res.constraints.find((c) => c.id === 'Q')!.satisfied).toBe(false);
  });

  it('feasible and the satisfied flags share one tolerance: a solve stopped just above it is not an optimum with violated constraints', () => {
    // five outer iterations stop at a violation of about 5e-6: above the tolerance (1e-6), below the ten times looser `feasible` of augLag
    const cut = solveDesign({ base: ITER, objective: 'major-radius', solver: { maxOuter: 5 }, ...FAST });
    expect(cut.solver.violation).toBeGreaterThan(1e-6);
    expect(cut.solver.violation).toBeLessThan(1e-5);
    expect(cut.constraints.some((c) => !c.satisfied)).toBe(true);
    expect(cut.feasible).toBe(false);
    // the tolerance is the solver's feasTol: with 1e-5 the same budget gives a feasible design, and then every constraint is satisfied
    const loose = solveDesign({ base: ITER, objective: 'major-radius', solver: { maxOuter: 5, feasTol: 1e-5 }, ...FAST });
    expect(loose.solver.violation).toBeLessThanOrEqual(1e-5);
    expect(loose.feasible).toBe(true);
    for (const c of loose.constraints) expect(c.satisfied, c.id).toBe(true);
  });

  it('a variable can be given its own bounds; a tight box pins the optimum on its bound', () => {
    const res = solveDesign({ base: ITER, objective: 'major-radius', bounds: { R: [5.9, 6.5] }, ...FAST });
    expect(res.variables[0]).toMatchObject({ name: 'R', lo: 5.9, hi: 6.5 });
    expect(res.variables[0].value).toBeGreaterThanOrEqual(5.9 - 1e-9);
    expect(res.variables[0].atBound === 'lower' || res.variables[0].value > 5.9).toBe(true);
  });

  it('rejects invalid problems', () => {
    expect(() => solveDesign({ base: W7X, objective: 'major-radius' })).toThrow(/tokamaks and spherical tokamaks/);
    expect(() => solveDesign({ base: ITER, objective: 'cost' as never })).toThrow(/unknown objective 'cost'/);
    expect(() => solveDesign({ base: ITER, objective: 'gain', variables: [] })).toThrow(/at least one variable/);
    expect(() => solveDesign({ base: ITER, objective: 'gain', variables: ['R', 'R'] })).toThrow(/listed twice/);
    expect(() => solveDesign({ base: ITER, objective: 'gain', variables: ['nope' as never] })).toThrow(/unknown design variable 'nope'/);
    expect(() => solveDesign({ base: ITER, objective: 'gain', bounds: { R: [7, 6] } })).toThrow(/bounds of R/);
  });
});

describe('design report', () => {
  const spec = { base: ITER, objective: 'gain' as const, variables: ['fG', 'T'] as const, constraints: { qMin: null, q95Min: 2.5 }, startTemperatures: [8] };

  it('wraps the result with the problem definition, the caveat and a hash that identifies the problem', () => {
    const r = designReport(spec, 'ITER');
    expect(r).toMatchObject({ schema: 1, tool: 'optimize', caveat: OPTIMIZATION_CAVEAT, problem: { preset: 'ITER', objective: 'gain', variables: ['fG', 'T'], startTemperatures: [8] } });
    expect(r.problem.bounds).toEqual({ fG: [0.1, 1], T: [2, 40] });
    expect(r.problem.constraints).toMatchObject({ qMin: null, q95Min: 2.5, betaNMax: 3.5, pauxMaxMW: 50 });
    expect(r.result.feasible).toBe(true);
    expect(r.inputHash).toBe(designHash(spec));
    expect(designHash({ ...spec })).toBe(r.inputHash);
    for (const other of [{ ...spec, objective: 'fusion-power' as const }, { ...spec, constraints: { qMin: null, q95Min: 2.6 } }, { ...spec, startTemperatures: [9] }, { ...spec, bounds: { T: [3, 40] as [number, number] } }, { ...spec, base: SPARC }]) {
      expect(designHash(other)).not.toBe(r.inputHash);
    }
    expect(designReport({ ...spec, variables: ['fG', 'T'] }).problem.preset).toBeUndefined();
  });
});

describe('solver choice and the Pareto front', { timeout: 120_000 }, () => {
  it('CMA-ES as the inner solver finds the same optimum as the simplex search', () => {
    const nm = solveDesign({ base: ITER, objective: 'major-radius', ...FAST });
    const cma = solveDesign({ base: ITER, objective: 'major-radius', method: 'cma-es', ...FAST });
    expect(cma.solver.method).toBe('augmented Lagrangian + CMA-ES');
    expect(nm.solver.method).toBe('augmented Lagrangian + Nelder-Mead');
    expect(cma.feasible).toBe(true);
    expect(Math.abs(cma.objective.value - nm.objective.value) / nm.objective.value).toBeLessThan(1e-3);
    expect(designHash({ base: ITER, objective: 'major-radius', method: 'cma-es' })).not.toBe(designHash({ base: ITER, objective: 'major-radius' }));
  });

  const spec = { base: ITER, objective: 'major-radius' as const, objectives: ['major-radius', 'aux-power'] as ['major-radius', 'aux-power'], constraints: { pauxMaxMW: 200 }, popSize: 60, generations: 40 };
  const pareto = solvePareto(spec);

  it('R against P_aux: a feasible, non-dominated front that runs from the smallest machine to the one that needs no heating', () => {
    expect(pareto.feasibleFound).toBe(true);
    expect(pareto.points.length).toBeGreaterThan(20);
    expect(pareto.objectives.map((o) => o.name)).toEqual(['major-radius', 'aux-power']);
    expect(pareto.objectives[0]).toMatchObject({ unit: 'm', preset: 6.2 });
    expect(pareto.caveat).toBe(OPTIMIZATION_CAVEAT);
    // sorted by R with P_aux strictly falling: a bigger machine buys lower heating power (no point dominates another)
    for (let i = 1; i < pareto.points.length; i++) {
      expect(pareto.points[i].objectives[0]).toBeGreaterThanOrEqual(pareto.points[i - 1].objectives[0]);
      expect(pareto.points[i].objectives[1]).toBeLessThan(pareto.points[i - 1].objectives[1] + 1e-12);
    }
    // the ends are the single-objective optima (they seed the population) ...
    const single = solveDesign({ base: ITER, objective: 'major-radius', constraints: { pauxMaxMW: 200 }, startTemperatures: [10] });
    expect(pareto.points[0].objectives[0]).toBeLessThan(single.objective.value * 1.005);
    // ... and the other end is the machine that needs the least heating: a tenth of the smallest machine's or less. Since the TF stress
    // is the Tresca stress of the PROCESS-style leg model (systems/tfCoil.ts, v4.0; the thin-ring estimate of v3 was never binding),
    // the coil at its preset thickness limits the size: the front stops at the upper bound of R with the stress at its limit and a few
    // MW of heating left (ITER: 3.75 MW at R = 9.3 m); the test below has it reach ignition without the coil constraint
    const end = pareto.points[pareto.points.length - 1];
    expect(end.objectives[1]).toBeGreaterThan(0);
    expect(end.objectives[1]).toBeLessThan(0.1 * pareto.points[0].objectives[1]);
    const endPt = designPoint(ITER, { ...presetDesign(ITER), ...end.variables } as never);
    expect(endPt.magnet.stress_MPa).toBeGreaterThan(0.999 * endPt.magnet.stress_limit);
    expect(pareto.hypervolume).toBeGreaterThan(0);
    expect(pareto.evals).toBe(60 + 40 * 60);
  });

  it('without the coil constraint the front runs on to a machine that needs no auxiliary power at all (ignition in this model)', () => {
    const free = solvePareto({ ...spec, constraints: { pauxMaxMW: 200, coil: false }, popSize: 32, generations: 15 });
    expect(free.feasibleFound).toBe(true);
    expect(free.points[free.points.length - 1].objectives[1]).toBe(0);
    // that machine is far beyond its coil (the reason the constraint exists)
    const pt = designPoint(ITER, { ...presetDesign(ITER), ...free.points[free.points.length - 1].variables } as never);
    expect(pt.magnet.stress_MPa).toBeGreaterThan(pt.magnet.stress_limit);
  });

  it('every point of the front satisfies the constraints and reproduces its reported quantities', () => {
    const cons = resolveConstraints(ITER, { pauxMaxMW: 200 });
    for (const p of pareto.points) {
      const pt = designPoint(ITER, { ...presetDesign(ITER), ...p.variables } as never);
      for (const c of constraintValues(pt, cons)) expect(c.g, c.id).toBeLessThanOrEqual(1e-6 + 1e-9);
      expect(pt.cfg.geometry.R).toBeCloseTo(p.objectives[0], 12);
      expect(Math.max(pt.state.Paux, 0) / 1e6).toBeCloseTo(p.objectives[1], 9);
      expect(pt.state.Q).toBeCloseTo(p.Q, 6);
      expect(p.Pfus_MW).toBeCloseTo(pt.state.Pfus / 1e6, 9);
    }
  });

  it('is deterministic; without the seeds the front is still produced; a report carries the problem and a hash', () => {
    expect(solvePareto(spec)).toEqual(pareto);
    // without the optima as seeds a random population has to find a feasible design by itself: a population of 20 over 8 generations did so for
    // only some seeds (2 of 5 after the v4.0 number changes, 1 of 5 before), so the size leaves a margin (a seed that finds none is a property of
    // the seed, not of the solver)
    const small = { ...spec, popSize: 40, generations: 12, seedWithOptima: false };
    const noSeeds = solvePareto(small);
    expect(noSeeds.evals).toBe(40 + 12 * 40);
    expect(noSeeds.feasibleFound).toBe(true);
    const rep = paretoReport(small, 'ITER');
    expect(rep).toMatchObject({ schema: 1, tool: 'optimize', mode: 'pareto', problem: { preset: 'ITER', objectives: ['major-radius', 'aux-power'], popSize: 40, generations: 12, seed: 1 } });
    expect(rep.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(paretoReport({ ...small, seed: 2 }).inputHash).not.toBe(rep.inputHash);
    expect(paretoReport({ ...small, seedWithOptima: true }).inputHash).not.toBe(rep.inputHash);
  });

  it('reports infeasibility, and rejects invalid problems', () => {
    const none = solvePareto({ ...spec, constraints: { qMin: 1e4 }, popSize: 8, generations: 3, seedWithOptima: false });
    expect(none.feasibleFound).toBe(false);
    expect(none.points).toEqual([]);
    expect(none.hypervolume).toBe(0);
    expect(() => solvePareto({ ...spec, objectives: ['gain', 'gain'] })).toThrow(/must differ/);
    expect(() => solvePareto({ ...spec, objectives: ['gain', 'cost' as never] })).toThrow(/unknown objective 'cost'/);
    expect(() => solvePareto({ ...spec, base: W7X })).toThrow(/tokamaks and spherical tokamaks/);
    expect(() => solvePareto({ ...spec, variables: [] })).toThrow(/at least one variable/);
    expect(() => solvePareto({ ...spec, variables: ['R', 'R'] })).toThrow(/listed twice/);
    expect(() => solvePareto({ ...spec, variables: ['zz' as never] })).toThrow(/unknown design variable/);
    expect(() => solvePareto({ ...spec, bounds: { R: [7, 6] } })).toThrow(/bounds of R/);
  });
});
