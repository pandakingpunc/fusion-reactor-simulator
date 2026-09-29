/**
 * The control flow of the outer iteration (outer.ts solveConsistent) with a scripted mapping mismatch: when the mismatch does not
 * contract, how the node update is relaxed, when the loop ends on stagnation or on a solve that fell short, and how much of the way a
 * fold must leave to be used. The equilibrium solves are the real ones (a coarse grid); only `mappingMismatch` (tables.ts) and, in some
 * tests, the outcome of a solve are scripted. Found by the mutation smoke test (scripts/mutation-smoke.mjs, M52 to M56).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Equilibrium, GSFailure, GSSolver } from '../../equilibrium/gs';
import { Pchip } from '../../numerics/interp';
import { ConsistentOptions, ConsistentSpec, MIN_FRACTION, solveConsistent } from './outer';
import { currentTable, psiNOfRho } from './tables';

const script = vi.hoisted(() => ({ deltas: [] as number[] }));
vi.mock('./tables', async (original) => {
  const m = await original<typeof import('./tables')>();
  // the scripted mismatches first, then the real one
  return { ...m, mappingMismatch: (...a: Parameters<typeof m.mappingMismatch>) => (script.deltas.length > 0 ? script.deltas.shift()! : m.mappingMismatch(...a)) };
});

const SHAPE = { kind: 'shape' as const, alphaM: 2, alphaN: 1.3 };
const OPTS: ConsistentOptions = { tol: 2e-3, accept: 5e-3, maxOuter: 8, solve: { tol: 1e-5, maxIter: 60, relax: 1, restartGrowth: 3 } };

const solver = new GSSolver({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, { NR: 33 });
const Ip = 1e6, B0 = 0.75;
const start = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.1 }, tol: 1e-7 });
const hot = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.8 }, tol: 1e-9 });
const near = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.65 }, tol: 1e-9 });
const rho = Float64Array.from({ length: 51 }, (_, j) => j / 50);
const pS = new Pchip(hot.prof.rhoTor, hot.prof.p), jS = new Pchip(hot.prof.rhoTor, currentTable(hot));
const spec: ConsistentSpec = { Ip, B0, rho, p: Float64Array.from(rho, (r) => pS.eval(r)), jR: Float64Array.from(rho, (r) => jS.eval(r)), rhoMin: 0.1, currentScaleLimit: 0.1 };

afterEach(() => { script.deltas.length = 0; vi.restoreAllMocks(); });

/** the solves of tables (the outer iteration's) with what they were given and what they returned */
function spyOnTableSolves(outcome?: (call: number) => 'fail' | 'ok') {
  const real = GSSolver.prototype.solve;
  const log: { psiN: Float64Array; eq?: Equilibrium; coarse: boolean }[] = [];
  vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
    if (o.profile.kind !== 'table') return real.call(this, o);
    const call = log.length + 1;
    const entry: (typeof log)[number] = { psiN: Float64Array.from(o.profile.psiN), coarse: o.psiLevels !== undefined };
    log.push(entry);
    if (outcome?.(call) === 'fail') throw new GSFailure('diverged', 'no equilibrium (stub)', 5, 0.2);
    entry.eq = real.call(this, o);
    return entry.eq;
  });
  return log;
}

describe('a mismatch that stops contracting', () => {
  it('ends after the second iteration that is not 10 % smaller (and above the acceptance tolerance): 3 iterations, no more, no fewer', () => {
    // 0.02 (first: nothing to compare with), 0.019 (over 0.9 × 0.02), 0.0185 (over 0.9 × 0.019): the second stall ends it
    script.deltas.push(0.02, 0.019, 0.0185, 0.0181, 0.0175, 0.017, 0.016, 0.015);
    const r = solveConsistent(solver, start, spec, OPTS);
    expect(r.outerIterations).toBe(3);
    expect(r.attempts).toHaveLength(3);
    expect(r.converged).toBe(false);
    expect(r.reason).toMatch(/did not converge/);
    // the best of the three is the smallest mismatch
    expect(r.delta).toBe(0.0185);
  });

  it('a mismatch that contracts by more than 10 % each time is never a stall, and one within the acceptance tolerance ends the loop at once', () => {
    script.deltas.push(0.05, 0.04, 0.03, 0.02, 0.01, 0.008, 0.006, 0.0045);
    const r = solveConsistent(solver, start, spec, OPTS);
    expect(r.outerIterations).toBe(8); // maxOuter, the mismatch never got below the tolerance 2e-3 but never stalled
    script.deltas.length = 0;
    // 0.01 then 0.0095 (not contracting) which is within accept = 5e-3? no: 0.0095 > 5e-3, a stall; 0.004 then 0.0039 is within accept: the loop ends there
    script.deltas.push(0.004, 0.0039);
    const r2 = solveConsistent(solver, start, spec, OPTS);
    expect(r2.outerIterations).toBe(2);
    expect(r2.attempts).toHaveLength(2);
    expect(r2.delta).toBe(0.0039);
  });

  it('the node update is under-relaxed with the halved ω after a stall (1, then 1/2), from the nodes of the equilibrium just solved', () => {
    const log = spyOnTableSolves();
    script.deltas.push(0.02, 0.019, 0.0185);
    const r = solveConsistent(solver, start, spec, OPTS);
    expect(r.outerIterations).toBe(3);
    const finals = log.filter((c) => !c.coarse);
    expect(finals).toHaveLength(3);
    // x2 = x1 + 1 (ψ_N(step 1) − x1) = ψ_N(step 1); x3 = x2 + 1/2 (ψ_N(step 2) − x2)
    const xNew1 = psiNOfRho(finals[0].eq!, rho);
    for (let j = 0; j < rho.length; j++) expect(finals[1].psiN[j]).toBeCloseTo(xNew1[j], 12);
    const xNew2 = psiNOfRho(finals[1].eq!, rho);
    let moved = 0;
    for (let j = 0; j < rho.length; j++) {
      expect(finals[2].psiN[j]).toBeCloseTo(finals[1].psiN[j] + 0.5 * (xNew2[j] - finals[1].psiN[j]), 12);
      moved = Math.max(moved, Math.abs(xNew2[j] - finals[1].psiN[j]));
    }
    // the second step changes the nodes, or the relaxation could not be told from none
    expect(moved).toBeGreaterThan(1e-7);
  });
});

describe('a fold', () => {
  // no equilibrium above a pressure of `pMax` at the axis
  const foldAt = (pMax: number) => {
    const real = GSSolver.prototype.solve;
    return vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
      if (o.profile.kind === 'table' && Math.max(...Array.from(o.profile.p)) > pMax) throw new GSFailure('diverged', 'no equilibrium for this pressure (stub)', 9, 0.3);
      return real.call(this, o);
    });
  };

  it('a part of the way short of MIN_FRACTION (a fold at 60 %: 50 % reached) is not used, one at or above it is', () => {
    expect(MIN_FRACTION).toBe(0.75);
    const p0 = near.prof.p[0], p1 = hot.prof.p[0];
    foldAt(p0 + 0.6 * (p1 - p0));
    const r = solveConsistent(solver, near, spec, OPTS);
    expect(r.eq).toBeNull();
    expect(r.attempts.some((a) => a.fraction === 0.5 && a.converged)).toBe(true);
    vi.restoreAllMocks();
    foldAt(p0 + 0.8 * (p1 - p0));
    const r2 = solveConsistent(solver, near, spec, { ...OPTS, maxOuter: 3 });
    expect(r2.eq).not.toBeNull();
    expect(r2.fraction).toBe(0.75);
  });

  it('a solve that falls short of the whole way after the tables were remapped once ends the loop, whatever it costs to go on', () => {
    // call 1: the whole way at once; then the second iteration: the whole way fails (calls 2, 4, 6) and 0.5, 0.75 solve, 0.875 fails (call 7): the part 0.75
    const fails = new Set([2, 4, 6, 7]);
    const log = spyOnTableSolves((call) => (fails.has(call) ? 'fail' : 'ok'));
    script.deltas.push(0.01, 0.009);
    const r = solveConsistent(solver, start, spec, OPTS);
    expect(log.length).toBeGreaterThanOrEqual(8);
    expect(r.outerIterations).toBe(2);
    expect(r.attempts.every((a) => a.outer <= 2)).toBe(true);
    // the first iteration went the whole way but on a current table that had to be rescaled (the stale mapping): it is not eligible, so the
    // part of the way of the second is the result
    expect(r.attempts[0].fraction).toBe(1);
    expect(r.fraction).toBe(0.75);
    expect(r.delta).toBe(0.009);
    expect(r.converged).toBe(false);
    expect(r.reason).toMatch(/follows only 75 % of the change/);
  });
});
