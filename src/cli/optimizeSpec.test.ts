import { describe, expect, it } from 'vitest';
import { CliHelpRequested, parseArgs } from './args';
import { OPTIMIZE_CLI, optimizeRun, optimizeSpecFromArgs } from './optimizeSpec';

const parse = (...a: string[]) => parseArgs(OPTIMIZE_CLI, a);
const SMALL = ['--preset', 'ITER', '--objective', 'gain', '--vars', 'fG,T', '--q-min', '0', '--q95-min', '2.5', '--start-temps', '8'];

describe('optimize flags', () => {
  it('--help lists the objectives and the caveat', () => {
    let text = '';
    try { parse('--help'); } catch (e) { if (e instanceof CliHelpRequested) text = e.text; else throw e; }
    expect(text).toMatch(/Usage: npx tsx src\/cli\/optimize\.cli\.ts/);
    expect(text).toMatch(/EDUCATIONAL/);
    expect(text).toMatch(/major-radius, plasma-volume, aux-power, fusion-power, gain/);
  });

  it('parse errors: only 0D tokamak and spherical-tokamak presets, known objectives and variables', () => {
    expect(() => parse()).toThrow(/--preset is required/);
    expect(() => parse('--preset', 'W7X')).toThrow(/--preset: unknown value 'W7X'/); // a stellarator is not offered
    expect(() => parse('--preset', 'ITER15')).toThrow(/--preset: unknown value 'ITER15'/); // neither is a 1.5D preset
    expect(() => parse('--preset', 'ITER', '--objective', 'cost')).toThrow(/--objective: unknown value 'cost'/);
    expect(() => parse('--preset', 'ITER', '--vars', 'R,nope')).toThrow(/--vars: unknown value 'nope'/);
    expect(() => parse('--preset', 'ITER', '--solver', 'bfgs')).toThrow(/--solver: unknown value 'bfgs'/);
    expect(() => parse('--preset', 'ITER', '--aspect-min', '1')).toThrow(/--aspect-min must be >= 1.05/);
  });
});

describe('optimize specification', () => {
  it('defaults: R, a, B0, Ip, fG, T; Q >= 10 unless the objective is the gain; the coil limit on', () => {
    const s = optimizeSpecFromArgs(parse('--preset', 'ITER'));
    expect(s.objective).toBe('major-radius');
    expect(s.method).toBe('nelder-mead');
    expect(s.variables).toEqual(['R', 'a', 'B0', 'Ip', 'fG', 'T']);
    expect(s.bounds).toEqual({});
    expect(s.constraints).toEqual({ qMin: 10, coil: true });
    expect(s.startTemperatures).toEqual([6, 10, 16, 25]);
    expect(s.solver).toEqual({ maxEvals: 200000 });
    expect(optimizeSpecFromArgs(parse('--preset', 'ITER', '--objective', 'gain')).constraints?.qMin).toBeNull();
  });

  it('every constraint flag reaches the specification; 0 disables Q, the H-mode margin and the heating limit', () => {
    const s = optimizeSpecFromArgs(parse('--preset', 'SPARC', '--q-min', '5', '--beta-n-max', '3', '--q95-min', '3.2', '--lh-margin', '1.2', '--paux-max', '30', '--no-coil',
      '--aspect-min', '2', '--aspect-max', '5', '--pfus-min', '200', '--wall-load-max', '4', '--bound', 'R=1.2:2.5,T=5:20', '--vars', 'R,T,H98', '--solver', 'cma-es'));
    expect(s.constraints).toEqual({ qMin: 5, betaNMax: 3, q95Min: 3.2, lhMargin: 1.2, pauxMaxMW: 30, coil: false, aspectMin: 2, aspectMax: 5, pfusMinMW: 200, wallLoadMax: 4 });
    expect(s.bounds).toEqual({ R: [1.2, 2.5], T: [5, 20] });
    expect(s.variables).toEqual(['R', 'T', 'H98']);
    expect(s.method).toBe('cma-es');
    const off = optimizeSpecFromArgs(parse('--preset', 'SPARC', '--q-min', '0', '--lh-margin', '0', '--paux-max', '0'));
    expect(off.constraints).toMatchObject({ qMin: null, lhMargin: null, pauxMaxMW: null });
  });

  it('invalid bounds, start temperatures and Pareto options are RangeErrors (usage errors)', () => {
    for (const [args, re] of [
      [['--bound', 'R'], /expected PATH=VALUE/],
      [['--bound', 'R=7:6'], /HI must exceed LO/],
      [['--bound', 'X=1:2'], /--bound X: unknown variable/],
      [['--start-temps', '0.1'], /--start-temps: each temperature must be between/],
      [['--pareto', 'major-radius'], /--pareto takes exactly two objectives/],
      [['--pareto', 'major-radius,aux-power', '--pop-size', '10'], /--pop-size must be a multiple of 4/],
      [['--vars', 'R,R'], /listed twice/],
    ] as [string[], RegExp][]) {
      expect(() => optimizeRun(parse('--preset', 'ITER', ...args)), args.join(' ')).toThrow(re);
      expect(() => optimizeRun(parse('--preset', 'ITER', ...args))).toThrow(RangeError);
    }
  });
});

describe('optimize reports', { timeout: 60_000 }, () => {
  it('a small problem: JSON and text reports, deterministic', () => {
    const a = optimizeRun(parse(...SMALL)), b = optimizeRun(parse(...SMALL));
    expect(a).toEqual(b);
    expect(a.mode).toBe('single');
    expect(a.feasible).toBe(true);
    const r = JSON.parse(a.json);
    expect(r).toMatchObject({ schema: 1, tool: 'optimize', problem: { preset: 'ITER', objective: 'gain', variables: ['fG', 'T'] }, result: { feasible: true } });
    expect(r.caveat).toMatch(/^EDUCATIONAL/);
    expect(r.problem.constraints).toMatchObject({ qMin: null, q95Min: 2.5, betaNMax: 3.5, pauxMaxMW: 50, coil: true });
    expect(a.text).toMatch(/Design optimisation of ITER: steady-state Q \(gain\) maximised/);
    expect(a.text).toMatch(/Optimum: steady-state Q = /);
    expect(JSON.parse(optimizeRun(parse(...SMALL, '--paux-max', '30')).json).inputHash).not.toBe(r.inputHash);
  });

  it('CMA-ES solves the same small problem', () => {
    const out = JSON.parse(optimizeRun(parse(...SMALL, '--solver', 'cma-es')).json);
    expect(out.result.solver.method).toBe('augmented Lagrangian + CMA-ES');
    const nm = JSON.parse(optimizeRun(parse(...SMALL)).json);
    expect(Math.abs(out.result.optimum.Q - nm.result.optimum.Q) / nm.result.optimum.Q).toBeLessThan(0.01);
  });

  it('a problem without a feasible design is reported as such', () => {
    const out = optimizeRun(parse('--preset', 'ITER', '--vars', 'fG,T', '--q-min', '10000', '--start-temps', '8', '--max-evals', '2000'));
    expect(out.feasible).toBe(false);
    expect(JSON.parse(out.json).result.feasible).toBe(false);
    expect(out.text).toMatch(/NO FEASIBLE DESIGN FOUND/);
  });

  it('--pareto: the front of two objectives', () => {
    const out = optimizeRun(parse('--preset', 'ITER', '--pareto', 'major-radius,aux-power', '--vars', 'R,B0,fG,T', '--paux-max', '200', '--pop-size', '20', '--generations', '10'));
    expect(out.mode).toBe('pareto');
    expect(out.feasible).toBe(true);
    const j = JSON.parse(out.json);
    expect(j).toMatchObject({ mode: 'pareto', problem: { preset: 'ITER', objectives: ['major-radius', 'aux-power'], popSize: 20, generations: 10, seed: 1 } });
    expect(j.result.points.length).toBeGreaterThan(3);
    expect(out.text).toMatch(/^Pareto front of ITER: major radius R against auxiliary power/);
  });
});
