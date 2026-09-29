/**
 * The self-consistent Grad–Shafranov solve of the coupling (outer.ts) and its table helpers (tables.ts), on the
 * equilibrium solver directly: the transport profiles are given as functions of ρ_tor and the equilibrium has to be
 * the one whose own ρ_tor(ψ_N) maps them to the tables it was solved with.
 */
import { describe, expect, it, vi } from 'vitest';
import { Equilibrium, GSFailure, GSSolver } from '../../equilibrium/gs';
import { SingularMatrixError } from '../../numerics/linalg';
import { Pchip } from '../../numerics/interp';
import { ConsistentOptions, ConsistentSpec, MIN_FRACTION, solveConsistent } from './outer';
import { blend, coreFlat, currentTable, equilibriumTables, mappingMismatch, psiNOfRho, rhoOfPsiN } from './tables';

const SHAPE = { kind: 'shape' as const, alphaM: 2, alphaN: 1.3 };
const OPTS: ConsistentOptions = { tol: 2e-3, accept: 5e-3, maxOuter: 8, solve: { tol: 1e-5, maxIter: 60, relax: 1, restartGrowth: 3 } };

/** the transport radii and the tables of an equilibrium as functions of ρ: what the transport would hand over */
function transportOf(eq: Equilibrium, N = 50) {
  const rho = Float64Array.from({ length: N + 1 }, (_, j) => j / N);
  const pS = new Pchip(eq.prof.rhoTor, eq.prof.p), jS = new Pchip(eq.prof.rhoTor, currentTable(eq));
  return { rho, p: Float64Array.from(rho, (r) => pS.eval(r)), jR: Float64Array.from(rho, (r) => jS.eval(r)) };
}
const specOf = (Ip: number, B0: number, t: ReturnType<typeof transportOf>, rhoMin = 0.1): ConsistentSpec => ({ Ip, B0, ...t, rhoMin, currentScaleLimit: 0.1 });

describe('table helpers', () => {
  const solver = new GSSolver({ R: 3, a: 1, kappa: 1.6, delta: 0.3 }, { NR: 41 });
  const eq = solver.solve({ Ip: 2e6, B0: 2.5, profile: { ...SHAPE, betaP: 0.6 }, tol: 1e-9 });

  it('ψ_N(ρ) and ρ(ψ_N) are inverse maps that fix the axis and the boundary', () => {
    const rho = Float64Array.from({ length: 51 }, (_, j) => j / 50);
    const x = psiNOfRho(eq, rho);
    expect(x[0]).toBe(0);
    expect(x[50]).toBe(1);
    for (let j = 1; j < 51; j++) expect(x[j]).toBeGreaterThan(x[j - 1]);
    const back = rhoOfPsiN(eq, x);
    for (let j = 0; j < 51; j++) expect(Math.abs(back[j] - rho[j])).toBeLessThan(2e-4);
  });

  it("an equilibrium's own tables reproduce it: the solve from its ψ converges at once and the surfaces do not move", () => {
    const rho = Float64Array.from({ length: 51 }, (_, j) => j / 50);
    const x = psiNOfRho(eq, rho), own = equilibriumTables(eq, x);
    expect(Math.abs(own.p[0] / eq.prof.p[0] - 1)).toBeLessThan(1e-12);
    const again = solver.solve({ Ip: 2e6, B0: 2.5, profile: { kind: 'table', psiN: x, p: own.p, jR: own.jR }, psiInit: eq.psi, tol: 1e-7, currentScaleWarn: 0.1 });
    expect(again.converged).toBe(true);
    expect(again.iterations).toBeLessThanOrEqual(8);
    expect(Math.abs(again.currentScale! - 1)).toBeLessThan(5e-3);
    expect(mappingMismatch(again, x, rho, 0.1)).toBeLessThan(1e-3);
    expect(again.q95 / eq.q95).toBeCloseTo(1, 2);
  });

  it('blend, coreFlat and the mapping mismatch', () => {
    expect(Array.from(blend([0, 10], [10, 30], 0.5))).toEqual([5, 20]);
    expect(Array.from(blend([1, 2], [5, 6], 0))).toEqual([1, 2]);
    expect(Array.from(blend([1, 2], [5, 6], 1))).toEqual([5, 6]);
    const rho = [0, 0.1, 0.2, 0.3, 0.4], v = [100, 300, 400, 380, 360];
    // below ρ = 0.15 the profile is its value there (350, midway between 300 and 400): flat, then untouched
    expect(Array.from(coreFlat(v, rho, 0.15))).toEqual([350, 350, 400, 380, 360]);
    expect(Array.from(coreFlat(v, rho, 0))).toEqual(v);
    // the radii the nodes were made for give 0; a uniform shift of every interior ρ gives that shift; the core is excluded
    const x = psiNOfRho(eq, Float64Array.from({ length: 21 }, (_, j) => j / 20));
    const r20 = Float64Array.from({ length: 21 }, (_, j) => j / 20);
    expect(mappingMismatch(eq, x, r20)).toBeLessThan(2e-4);
    const shifted = Float64Array.from(r20, (r, j) => (j === 0 || j === 20 ? r : r + 0.01));
    expect(mappingMismatch(eq, x, shifted)).toBeCloseTo(0.01, 3);
    const coreOnly = Float64Array.from(r20, (r, j) => (j === 1 ? r + 0.05 : r)); // ρ_1 = 0.05 → 0.10, still below 0.15
    expect(mappingMismatch(eq, x, coreOnly, 0.15)).toBeLessThan(2e-4);
    expect(mappingMismatch(eq, x, coreOnly)).toBeGreaterThan(0.01);
  });
});

describe('solveConsistent', () => {
  // the shape of the 1.5D MASTU15 case, where the tables mapped through the start-up equilibrium were the stale ones
  const solver = new GSSolver({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, { NR: 33 });
  const Ip = 1e6, B0 = 0.75;
  const start = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.1 }, tol: 1e-7 });
  const hot = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.8 }, tol: 1e-9 });
  const spec = specOf(Ip, B0, transportOf(hot));

  it('finds the equilibrium of transport profiles that were made on another one: the stale mapping is corrected until the tables sit on the surfaces', () => {
    // the transport's profiles of a β_p = 0.8 plasma mapped through the β_p = 0.1 equilibrium: c ≈ 1.2 (the stale table)
    const x0 = psiNOfRho(start, spec.rho);
    const rho0 = rhoOfPsiN(start, x0);
    const staleTables = { p: Float64Array.from(rho0, (r) => new Pchip(spec.rho, spec.p).eval(r)), jR: Float64Array.from(rho0, (r) => new Pchip(spec.rho, spec.jR).eval(r)) };
    const stale = solver.solve({ Ip, B0, profile: { kind: 'table', psiN: x0, p: staleTables.p, jR: staleTables.jR }, psiInit: start.psi, tol: 1e-7, maxIter: 200, currentScaleWarn: 0.1 });
    expect(Math.abs(stale.currentScale! - 1)).toBeGreaterThan(0.05);
    const r = solveConsistent(solver, start, spec, OPTS);
    expect(r.converged).toBe(true);
    expect(r.fraction).toBe(1);
    expect(r.delta).toBeLessThan(OPTS.tol);
    expect(r.outerIterations).toBeLessThanOrEqual(5);
    const eq = r.eq!;
    expect(eq.warnings.map((w) => w.code)).toEqual([]);
    expect(Math.abs(eq.currentScale! - 1)).toBeLessThan(0.02);
    // it is the equilibrium the profiles came from
    expect(Math.abs(eq.Raxis - hot.Raxis)).toBeLessThan(3e-3);
    expect(eq.betaP / hot.betaP).toBeCloseTo(1, 1);
    expect(eq.q95 / hot.q95).toBeCloseTo(1, 1);
    expect(eq.li3 / hot.li3).toBeCloseTo(1, 1);
    expect(Math.abs(eq.forceBalanceRatio - 1)).toBeLessThan(2e-3);
    // one attempt per outer iteration when nothing fails, each converged and logged with its mismatch
    expect(r.attempts.length).toBe(r.outerIterations);
    for (const a of r.attempts) { expect(a.converged).toBe(true); expect(a.fraction).toBe(1); expect(a.delta).toBeGreaterThan(0); }
    expect(r.attempts[r.attempts.length - 1].delta).toBe(r.delta);
    expect(r.hard).toBe(false);
  }, 60000);

  it('leaves an equilibrium that already is consistent where it is: one outer iteration', () => {
    const r = solveConsistent(solver, hot, spec, OPTS);
    expect(r.converged).toBe(true);
    expect(r.outerIterations).toBe(1);
    expect(r.attempts[0].iterations).toBeLessThanOrEqual(8);
    expect(r.eq!.q95 / hot.q95).toBeCloseTo(1, 2);
  }, 60000);

  it('refuses a current table that stays rescaled once it is consistent, with the reason', () => {
    // the transport's ⟨j_φ/R⟩ at 0.6 of the current the equilibrium carries: consistent surfaces, but c = 1/0.6 to meet I_p
    const low = { ...spec, jR: spec.jR.map((v) => 0.6 * v) };
    const r = solveConsistent(solver, hot, low, OPTS);
    expect(r.eq).toBeNull();
    expect(r.converged).toBe(false);
    expect(r.reason).toMatch(/current table rescaled by 1\.[67]\d to meet I_p \(limit ±0\.1\)/);
    expect(r.attempts[r.attempts.length - 1].rejected).toBe(r.reason);
  }, 60000);

  describe('when the whole way cannot be solved', () => {
    // a fold: no equilibrium above a pressure of `pMax` at the axis (the solver refuses those tables with a typed failure)
    const foldAt = (pMax: number) => {
      const real = GSSolver.prototype.solve;
      return vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
        if (o.profile.kind === 'table' && Math.max(...Array.from(o.profile.p)) > pMax) throw new GSFailure('diverged', 'no equilibrium for this pressure (stub)', 9, 0.3);
        return real.call(this, o);
      });
    };
    const pAxis = (eq: Equilibrium) => eq.prof.p[0];
    // the last equilibrium before the transport's (β_p 0.65 → 0.8): the halved parts stay consistent tables
    const near = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.65 }, tol: 1e-9 });

    it('takes the largest part of the change that has an equilibrium, if it is most of it, and says so', () => {
      const p1 = pAxis(hot), p0 = pAxis(near);
      const spy = foldAt(p0 + 0.9 * (p1 - p0)); // the fold at 90 % of the way from the last equilibrium's tables to the transport's
      try {
        const r = solveConsistent(solver, near, spec, { ...OPTS, maxOuter: 4 });
        expect(r.eq).not.toBeNull();
        expect(r.converged).toBe(false);
        expect(r.fraction).toBeGreaterThanOrEqual(MIN_FRACTION);
        expect(r.fraction).toBeLessThan(1);
        expect(r.reason).toMatch(/follows only \d+ % of the change/);
        expect(r.hard).toBe(true);
        // the attempts show the halving: the whole way failed with the typed failure, then part of it converged
        expect(r.attempts[0].fraction).toBe(1);
        expect(r.attempts[0].error).toContain('Grad–Shafranov (diverged)');
        expect(r.attempts[0].iterations).toBe(9);
        expect(r.attempts.some((a) => a.fraction < 1 && a.converged)).toBe(true);
        // the equilibrium is a real one between the two: β_p between theirs
        expect(r.eq!.betaP).toBeGreaterThan(near.betaP);
        expect(r.eq!.betaP).toBeLessThan(hot.betaP * 1.02);
      } finally { spy.mockRestore(); }
    });

    it('takes nothing if less than that has an equilibrium, and returns the reason', () => {
      const p1 = pAxis(hot), p0 = pAxis(near);
      const spy = foldAt(p0 + 0.3 * (p1 - p0));
      try {
        const r = solveConsistent(solver, near, spec, OPTS);
        expect(r.eq).toBeNull();
        expect(r.reason).toContain('Grad–Shafranov (diverged)');
        expect(r.attempts.length).toBeLessThanOrEqual(8);
      } finally { spy.mockRestore(); }
    });
  });

  it('invalid input is not retried at a smaller step; a plain Error is a bug and propagates', () => {
    const real = GSSolver.prototype.solve;
    let calls = 0;
    const spy = vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
      if (o.profile.kind !== 'table') return real.call(this, o);
      calls++;
      throw new GSFailure('bad-input', 'invalid table (stub)');
    });
    try {
      const r = solveConsistent(solver, start, spec, OPTS);
      expect(r.eq).toBeNull();
      expect(calls).toBe(1);
      expect(r.attempts.length).toBe(1);
      expect(r.attempts[0].error).toContain('Grad–Shafranov (bad-input)');
    } finally { spy.mockRestore(); }
    const spy2 = vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
      if (o.profile.kind === 'table') throw new TypeError('bug (stub)');
      return real.call(this, o);
    });
    try { expect(() => solveConsistent(solver, start, spec, OPTS)).toThrow('bug (stub)'); } finally { spy2.mockRestore(); }
    // a singular system of the linear algebra is a typed numerical failure like a GSFailure
    const spy3 = vi.spyOn(GSSolver.prototype, 'solve').mockImplementation(function (this: GSSolver, o) {
      if (o.profile.kind === 'table') throw new SingularMatrixError('singular (stub)');
      return real.call(this, o);
    });
    try {
      const r = solveConsistent(solver, start, spec, OPTS);
      expect(r.eq).toBeNull();
      expect(r.attempts.length).toBe(4); // the whole way, then a half, a quarter and an eighth
      expect(r.attempts[0].error).toContain('singular (stub)');
    } finally { spy3.mockRestore(); }
  }, 60000);
});
