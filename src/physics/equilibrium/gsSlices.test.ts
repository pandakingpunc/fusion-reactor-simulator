/**
 * The Grad-Shafranov solve as a resumable computation (GSSolver.solveSlices, kernel/slices.ts): it is solve() with yields, so
 * the equilibrium it ends with is the one of solve(), bit for bit, and a solver whose solve() is overridden is called as it is.
 */
import { describe, expect, it, vi } from 'vitest';
import { GSSolver, type Equilibrium, type EquilibriumOptions } from './gs';
import { RAYS_PER_SLICE } from './fluxsurface';

const ITER = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };
const opts: EquilibriumOptions = { Ip: 15e6, B0: 5.3, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, beta0: 0.6 }, tol: 1e-8 };

/** the numbers of an equilibrium that a later step of the model depends on */
const numbers = (eq: Equilibrium) => ({
  psi: Array.from(eq.psi), iterations: eq.iterations, residual: eq.residual, converged: eq.converged, axis: [eq.Raxis, eq.Zaxis, eq.psiAxis],
  q: Array.from(eq.prof.q), FFp: Array.from(eq.prof.FFp), pp: Array.from(eq.prof.pp), rhoTor: Array.from(eq.prof.rhoTor),
});

describe('GSSolver.solveSlices', () => {
  it('yields after every Picard iteration and inside the surface trace, and ends with the equilibrium of solve(), bitwise', () => {
    const plain = new GSSolver(ITER, { NR: 33 }).solve(opts);
    const solver = new GSSolver(ITER, { NR: 33 });
    const g = solver.solveSlices(opts);
    let yields = 0, r = g.next();
    while (!r.done) { yields++; r = g.next(); }
    const traceYields = Math.floor(127 / RAYS_PER_SLICE); // 128 rays, a yield after each RAYS_PER_SLICE-th but the last
    expect(plain.converged).toBe(true);
    expect(yields).toBe(plain.iterations - 1 + traceYields); // the iteration that converges ends the loop before its yield
    expect(numbers(r.value)).toEqual(numbers(plain));
  }, 60000);

  it('a solver dropped in the middle of a solve is as good as a fresh one for the next', () => {
    const solver = new GSSolver(ITER, { NR: 33 });
    const g = solver.solveSlices(opts);
    for (let i = 0; i < 3; i++) g.next();
    g.return(null as unknown as Equilibrium);
    expect(numbers(solver.solve(opts))).toEqual(numbers(new GSSolver(ITER, { NR: 33 }).solve(opts)));
  }, 60000);

  it('honours a solve() that is overridden (a spy, a stub, a subclass): it is called as it is, as one unit', () => {
    const solver = new GSSolver(ITER, { NR: 33 });
    const eq = new GSSolver(ITER, { NR: 33 }).solve(opts);
    const stub = vi.spyOn(solver, 'solve').mockImplementation(() => eq);
    const r = solver.solveSlices(opts).next();
    expect(r).toEqual({ done: true, value: eq });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledWith(opts);
  }, 60000);
});
