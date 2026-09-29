/**
 * The fixed-point iteration of the Grad-Shafranov solver (gs.ts solve) where the other tests of gs.test.ts only look at what it converges
 * to: the current that the iterate carries, the scale of the residual it reports, and the halving of the mixing damping when the
 * residual grows near a fold. Found by the mutation smoke test (scripts/mutation-smoke.mjs, M47, M48 and M50).
 */
import { describe, expect, it } from 'vitest';
import { GSSolver, TableProfileSpec } from './gs';
import type { Equilibrium } from './gs';
import { currentTable } from '../profiles/coupling/tables';

const MU0 = 1.25663706212e-6;
const SHAPE = { kind: 'shape' as const, alphaM: 2, alphaN: 1.3 };
// a compact spherical-tokamak shape on a coarse grid: a second per solve
const solver = new GSSolver({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, { NR: 33 });
const Ip = 1e6, B0 = 0.75;
const ref = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.8 }, tol: 1e-10 });

/** ⟨j_φ/R⟩ = p' + FF'⟨R⁻²⟩/μ0 on the equilibrium's own surfaces, what the transport coupling passes */
const jRof = (eq: Equilibrium) => Float64Array.from(eq.prof.psiN, (_, i) => eq.prof.pp[i] + (eq.prof.FFp[i] * eq.prof.avgR2inv[i]) / MU0);
const table = (pScale: number, jScale = 1): TableProfileSpec => ({
  kind: 'table', psiN: ref.prof.psiN, p: ref.prof.p.map((v) => v * pScale), jR: Array.from(jRof(ref), (v) => v * jScale),
});

/** the current that the returned flux carries: ∫ j_φ dA with j_φ = −Δ*ψ / (μ0 R) over the plasma nodes */
function carriedCurrent(eq: Equilibrium): number {
  const g = eq.grid, lap = g.applyOperator(eq.psi);
  let I = 0;
  for (let u = 0; u < g.nInside; u++) I += (-lap[g.interior[u]] / (MU0 * g.interiorR[u])) * g.dR * g.dZ;
  return I;
}

describe('the current of the iterate', () => {
  it.each([[1, 1], [1, 0.8], [1, 1.2], [2, 1]])('table mode (pressure ×%s, ⟨j_φ/R⟩ ×%s): the converged flux carries I_p to 1e-6, the pressure part and the normalised part together', (pS, jS) => {
    const eq = solver.solve({ Ip, B0, profile: table(pS, jS), tol: 1e-10, maxIter: 100 });
    expect(eq.converged).toBe(true);
    expect(Math.abs(carriedCurrent(eq) / Ip - 1)).toBeLessThan(1e-6);
  });

  it('shape mode: the converged flux carries I_p to 1e-6', () => {
    for (const betaP of [0.3, 0.8, 1.4]) {
      const eq = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP }, tol: 1e-10 });
      expect(Math.abs(carriedCurrent(eq) / Ip - 1), `β_p ${betaP}`).toBeLessThan(1e-6);
    }
  });
});

describe('the residual of the iteration', () => {
  it('is dimensionless (the change of ψ over the axis flux): the same for a tenth of the current, which scales ψ and every change of it by a tenth', () => {
    const first = (I: number) => {
      const seen: number[] = [];
      solver.solve({ Ip: I, B0, profile: { ...SHAPE, betaP: 0.5 }, tol: 1e-6, onIter: (_it, r) => seen.push(r) });
      return seen;
    };
    const a = first(Ip), b = first(0.1 * Ip);
    expect(a.length).toBeGreaterThan(3);
    for (let k = 0; k < 3; k++) expect(b[k] / a[k], `iteration ${k + 1}`).toBeGreaterThan(0.9), expect(b[k] / a[k]).toBeLessThan(1.1);
    // and the reported residual of the result is the last one, below the tolerance
    const eq = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.5 }, tol: 1e-6 });
    expect(eq.residual).toBeLessThan(1e-6);
  });
});

describe('near a fold of the fixed-boundary problem', () => {
  it('a pressure six times that of a consistent table (at the fold) makes the residual grow again and again; the damping is halved at each restart, which is slow (over 50 iterations) but converges', () => {
    // with a milder damping cut (0.9 per restart) the same solve converged in 30 iterations; with the documented halving it needs 77
    const start = solver.solve({ Ip, B0, profile: { ...SHAPE, betaP: 0.1 }, tol: 1e-7 });
    const jT = currentTable(ref);
    const fold: TableProfileSpec = { kind: 'table', psiN: ref.prof.psiN, p: ref.prof.p.map((v) => 6 * v), jR: Array.from(ref.prof.psiN, (_, i) => jT[i]) };
    const seen: number[] = [];
    const eq = solver.solve({ Ip, B0, profile: fold, psiInit: start.psi, tol: 1e-7, maxIter: 100, onIter: (_it, r) => seen.push(r) });
    let growths = 0;
    for (let k = 1; k < seen.length; k++) if (seen[k] > seen[k - 1]) growths++;
    expect(growths).toBeGreaterThan(10);
    expect(eq.converged).toBe(true);
    expect(eq.iterations).toBeGreaterThan(50);
    expect(eq.iterations).toBeLessThanOrEqual(100);
  });
});
