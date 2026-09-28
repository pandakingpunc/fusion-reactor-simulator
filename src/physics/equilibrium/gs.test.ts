import { describe, expect, it } from 'vitest';
import { Equilibrium, EquilibriumOptions, GSFailure, GSGrid, GSSolver, TableProfileSpec } from './gs';
import { PhysicalSolovev, SolovevEquilibrium, solovevBoundary } from './solovev';
import { CubicSpline, Pchip } from '../numerics/interp';

const MU0 = 1.25663706212e-6;
const ITER = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };
const SOLOVEV = { epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 };
const Ip = 15e6, B0 = 5.3;

/** observed order of convergence from three grids with h halving */
const order = (f1: number, f2: number, f3: number) => Math.log2(Math.abs(f1 - f2) / Math.abs(f2 - f3));

/** ⟨j_φ/R⟩ = p' + FF'⟨R⁻²⟩/μ0 on the equilibrium's own surfaces — what the transport coupling passes */
function jRof(eq: Equilibrium): Float64Array {
  const P = eq.prof;
  return Float64Array.from(P.psiN, (_, i) => P.pp[i] + (P.FFp[i] * P.avgR2inv[i]) / MU0);
}

/** expect fn() to throw a GSFailure with this reason */
function failure(fn: () => unknown): GSFailure {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(GSFailure);
    expect(e).toBeInstanceOf(Error);
    return e as GSFailure;
  }
  throw new Error('expected a GSFailure');
}

describe("nonlinear solver on an exact Solov'ev equilibrium", () => {
  it('reproduces ψ at second order with constant p′ and diamagnetic FF′ (β0 = 1 − A > 1)', () => {
    const R0 = 6.2;
    const sol = new SolovevEquilibrium(SOLOVEV);
    const boundary = solovevBoundary(sol, R0);
    // analytic magnetic axis: ∂ψ̄/∂x = 0 on y = 0
    let xa = 1.05;
    for (let it = 0; it < 30; it++) xa -= sol.psiBar(xa, 0, 1, 0) / sol.psiBar(xa, 0, 2, 0);
    const psiMin = sol.psiBar(xa, 0);
    const geom = { R: R0, a: SOLOVEV.epsilon * R0, kappa: SOLOVEV.kappa, delta: SOLOVEV.delta };
    const errs: number[] = [];
    for (const NR of [33, 65, 129]) {
      const solver = new GSSolver(geom, { NR, boundary });
      // (1 − ψ_N^αm)^0 = 1: j_φ = λ[β0 R/R0 + (1 − β0) R0/R] — the Cerfon–Freidberg source with A = 1 − β0
      const eq = solver.solve({ Ip, B0, profile: { kind: 'shape', alphaM: 1, alphaN: 0, beta0: 1 - SOLOVEV.A }, tol: 1e-11 });
      expect(eq.converged).toBe(true);
      const g = solver.grid;
      let e = 0;
      for (const k of g.interior) {
        const i = k % g.NR, j = (k - i) / g.NR;
        e = Math.max(e, Math.abs(eq.psi[k] / eq.psiAxis - sol.psiBar(g.R(i) / R0, g.Z(j) / R0) / psiMin));
      }
      errs.push(e);
      expect(Math.abs(eq.Raxis - xa * R0)).toBeLessThan(2e-5);
      expect(Math.abs(eq.Zaxis)).toBeLessThan(1e-9);
      // p′ constant, FF′ < 0 with the Solov'ev ratio FF′/(μ0 R0² p′) = A/(1 − A)
      const P = eq.prof;
      for (const i of [1, 10, 30, 49]) {
        expect(P.pp[i] / P.pp[1]).toBeCloseTo(1, 12);
        expect(P.FFp[i]).toBeLessThan(0);
        expect(P.FFp[i] / (MU0 * R0 * R0 * P.pp[i])).toBeCloseTo(SOLOVEV.A / (1 - SOLOVEV.A), 12);
      }
      expect(P.Ienc[P.Ienc.length - 1] / Ip).toBeCloseTo(1, 2);
      expect(eq.forceBalanceResidual).toBeLessThan(1e-9);
      expect(eq.forceBalanceRatio).toBeCloseTo(1, 9);
    }
    expect(errs[2]).toBeLessThan(2e-6);
    expect(Math.log2(errs[0] / errs[1])).toBeGreaterThan(1.8);
    expect(Math.log2(errs[1] / errs[2])).toBeGreaterThan(1.8);
  });
});

describe('table (transport-coupling) mode', () => {
  const solver = new GSSolver(ITER, { NR: 49 });
  const ref = solver.solve({ Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.65 } });
  const jR = jRof(ref);
  const table = (s: number): TableProfileSpec => ({ kind: 'table', psiN: ref.prof.psiN, p: ref.prof.p, jR: jR.map((v) => v * s) });

  it('meets I_p through FF′ alone: for ⟨j_φ/R⟩ scaled by 0.8 and 1.1 the field balances the given pressure', () => {
    const base = solver.solve({ Ip, B0, profile: table(1), tol: 1e-8 });
    expect(base.converged).toBe(true);
    expect(base.currentScale!).toBeCloseTo(1, 2);
    for (const s of [0.8, 1.1]) {
      const eq = solver.solve({ Ip, B0, profile: table(s), tol: 1e-8 });
      expect(eq.converged).toBe(true);
      expect(eq.currentScale! * s).toBeCloseTo(base.currentScale!, 6);
      // ∫(J×B)·∇ψ̂ dV / ∫∇p·∇ψ̂ dV = 1.000 ± 0.002 and a small L1 residual
      expect(eq.forceBalanceRatio).toBeGreaterThan(0.998);
      expect(eq.forceBalanceRatio).toBeLessThan(1.002);
      expect(eq.forceBalanceResidual).toBeLessThan(1e-3);
      // p is never rescaled: W_th and β_p are the given pressure's, the geometry the unscaled table's
      expect(eq.W_th / base.W_th).toBeCloseTo(1, 7);
      expect(eq.betaP / ref.betaP).toBeCloseTo(1, 2);
      expect(eq.q95 / base.q95).toBeCloseTo(1, 6);
      expect(eq.li3 / base.li3).toBeCloseTo(1, 6);
    }
  });

  it('production path (⟨j_φ/R⟩ table, warm start, tol 1e-5, relax 0.9) reproduces the reference equilibrium', () => {
    const opts: EquilibriumOptions = { Ip, B0, profile: table(1), tol: 1e-5, maxIter: 40, relax: 0.9 };
    const warm = solver.solve({ ...opts, psiInit: ref.psi });
    expect(warm.converged).toBe(true);
    expect(warm.iterations).toBeLessThanOrEqual(8);
    for (const k of ['q95', 'li3', 'betaP', 'Raxis', 'W_th'] as const) expect(warm[k] / ref[k]).toBeCloseTo(1, 2);
    expect(warm.forceBalanceResidual).toBeLessThan(1e-3);
    const cold = solver.solve(opts);
    expect(cold.converged).toBe(true);
    expect(cold.iterations).toBeGreaterThan(warm.iterations);
    expect(cold.q95 / warm.q95).toBeCloseTo(1, 4);
  });

  it('force-balance measures flag a pressure the field does not hold (the pre-v4 table-mode state)', () => {
    // ⟨j_φ/R⟩ scaled by 0.8 → c ≈ 1.25. The old table mode scaled p′ together with FF′ by c, so its
    // field held c·p′ while it reported p′: emulated here by reporting p′/c against this field.
    const eq = solver.solve({ Ip, B0, profile: table(0.8), tol: 1e-8 });
    const c = eq.currentScale!;
    expect(c).toBeGreaterThan(1.2);
    const pS = new Pchip(ref.prof.psiN, ref.prof.p), fS = new CubicSpline(eq.prof.psiN, eq.prof.FFp);
    const pp = (x: number) => -pS.deriv(Math.min(Math.max(x, 0), 1)) / eq.psiAxis;
    const ffp = (x: number) => fS.eval(x);
    const held = solver.forceBalanceOf(eq.psi, pp, ffp);
    expect(held.residual).toBeLessThan(1e-4);
    expect(held.ratio).toBeCloseTo(1, 4);
    const old = solver.forceBalanceOf(eq.psi, (x) => pp(x) / c, ffp);
    expect(old.ratio).toBeCloseTo(c * held.ratio, 9); // the ratio is linear in 1/p′
    expect(old.residual).toBeCloseTo(c - 1, 3);
    const low = solver.forceBalanceOf(eq.psi, (x) => 0.8 * pp(x), ffp);
    expect(low.ratio).toBeCloseTo(1.25, 3);
    expect(low.residual).toBeCloseTo(0.25, 3);
  });

  it('forceBalanceResidual of an unconverged state follows its Picard residual', () => {
    const fb = [2, 3].map((maxIter) => solver.solve({ Ip, B0, profile: table(1), maxIter }));
    expect(fb[0].converged).toBe(false);
    expect(fb[0].forceBalanceResidual).toBeGreaterThan(0.05);
    expect(Math.abs(fb[0].forceBalanceRatio - 1)).toBeGreaterThan(0.05);
    expect(fb[1].forceBalanceResidual).toBeLessThan(fb[0].forceBalanceResidual / 4);
    expect(fb[1].forceBalanceResidual).toBeGreaterThan(fb[1].residual / 10);
    expect(solver.solve({ Ip, B0, profile: table(1), tol: 1e-8 }).forceBalanceResidual).toBeLessThan(1e-6);
  });

  it('warns when the current table needs |currentScale − 1| > 0.1 to meet I_p', () => {
    const codes = (eq: Equilibrium) => eq.warnings.map((w) => w.code);
    expect(codes(solver.solve({ Ip, B0, profile: table(1), tol: 1e-8 }))).toEqual([]);
    const off = solver.solve({ Ip, B0, profile: table(0.8), tol: 1e-8 });
    expect(off.converged).toBe(true);
    expect(codes(off)).toEqual(['table-current-rescaled']);
    expect(off.warnings[0].message).toMatch(/80\.\d % of I_p/);
    const near = { Ip, B0, profile: table(1.1), tol: 1e-8 }; // c ≈ 0.91
    expect(codes(solver.solve(near))).toEqual([]);
    expect(codes(solver.solve({ ...near, currentScaleWarn: 0.05 }))).toEqual(['table-current-rescaled']);
    const unconverged = solver.solve({ Ip, B0, profile: table(1), maxIter: 3 });
    expect(codes(unconverged)).toContain('not-converged');
  });

  it('I(ψ_N) and ⟨j_φ/R⟩ tables describe the same equilibrium', () => {
    const I = ref.prof.Ienc.map((v, k) => (k === 0 ? 0 : v));
    const a = solver.solve({ Ip, B0, profile: { kind: 'table', psiN: ref.prof.psiN, p: ref.prof.p, I }, tol: 1e-8 });
    const b = solver.solve({ Ip, B0, profile: table(1), tol: 1e-8 });
    expect(a.converged).toBe(true);
    expect(a.q95 / b.q95).toBeCloseTo(1, 2);
    expect(a.li3 / b.li3).toBeCloseTo(1, 2);
    expect(a.forceBalanceRatio).toBeCloseTo(1, 2);
  });
});

describe('transport coupling through a stale geometry (MAST-U-like, the 1.5D MASTU15 case)', () => {
  // The 1.5D model maps its ρ_tor profiles to ψ_N through the previous accepted equilibrium. Here
  // the plasma is at β_p = 0.8 while that equilibrium is still the β_p = 0.1 start-up one.
  const solver = new GSSolver({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, { NR: 33 });
  const Ist = 1e6, Bst = 0.75;
  const start = solver.solve({ Ip: Ist, B0: Bst, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.1 }, tol: 1e-7 });
  const hot = solver.solve({ Ip: Ist, B0: Bst, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.8 }, tol: 1e-7 });
  const pOfRho = new Pchip(hot.prof.rhoTor, hot.prof.p), jOfRho = new Pchip(hot.prof.rhoTor, jRof(hot));
  const tableVia = (eq: Equilibrium): TableProfileSpec =>
    ({ kind: 'table', psiN: eq.prof.psiN, p: Array.from(eq.prof.rhoTor, (r) => pOfRho.eval(r)), jR: Array.from(eq.prof.rhoTor, (r) => jOfRho.eval(r)) });

  it('flags tables mapped through the stale equilibrium; the same profiles on their own ψ_N are consistent', () => {
    const stale = solver.solve({ Ip: Ist, B0: Bst, profile: tableVia(start), psiInit: start.psi, tol: 1e-7, maxIter: 200 });
    expect(stale.converged).toBe(true);
    // the ⟨j_φ/R⟩ table carries ~80 % of I_p on the returned surfaces and β_p is ~25 % low
    expect(stale.currentScale!).toBeGreaterThan(1.15);
    expect(stale.warnings.map((w) => w.code)).toEqual(['table-current-rescaled']);
    expect(stale.betaP / hot.betaP).toBeLessThan(0.8);
    // still a force-balanced equilibrium of the tables as given, with a large axis step from `start`
    expect(stale.forceBalanceResidual).toBeLessThan(1e-4);
    expect((stale.Raxis - start.Raxis) / 0.65).toBeGreaterThan(0.08);
    const own = solver.solve({ Ip: Ist, B0: Bst, profile: tableVia(hot), psiInit: start.psi, tol: 1e-7, maxIter: 200 });
    expect(own.converged).toBe(true);
    expect(Math.abs(own.currentScale! - 1)).toBeLessThan(0.01);
    expect(own.warnings).toEqual([]);
    expect(own.betaP / hot.betaP).toBeCloseTo(1, 2);
    expect(Math.abs(own.Raxis - hot.Raxis)).toBeLessThan(2e-3);
  });
});

describe('shape mode', () => {
  const solver = new GSSolver(ITER, { NR: 33 });

  it('q0, q95, ℓi(3), β_p and R_axis converge with the grid at second order', () => {
    const rows = [33, 65, 129].map((NR) => new GSSolver(ITER, { NR }).solve({ Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, beta0: 0.6 }, tol: 1e-10 }));
    for (const k of ['q95', 'li3', 'betaP', 'Raxis'] as const) expect(order(rows[0][k], rows[1][k], rows[2][k])).toBeGreaterThan(1.6);
    // q0 is converged to ~1e-5 already at NR = 65
    expect(Math.abs(rows[1].q0 - rows[2].q0)).toBeLessThan(3e-5);
    expect(order(rows[0].q0, rows[1].q0, rows[2].q0)).toBeGreaterThan(1);
  });

  it('meets a β_p target and reports it met; β_p > 1 needs β0 > 1 (FF′ < 0, diamagnetic)', () => {
    const lo = solver.solve({ Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.65 } });
    expect(lo.betaPTargetMet).toBe(true);
    expect(lo.beta0!).toBeLessThan(1);
    expect(lo.betaP).toBeCloseTo(0.65, 2);
    const hi = solver.solve({ Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 1.3 } });
    expect(hi.converged).toBe(true);
    expect(hi.betaPTargetMet).toBe(true);
    expect(lo.warnings).toEqual([]);
    expect(hi.warnings).toEqual([]);
    expect(hi.beta0!).toBeGreaterThan(1);
    expect(hi.betaP).toBeCloseTo(1.3, 1);
    expect(hi.prof.FFp[0]).toBeLessThan(0);
    for (const v of hi.prof.FFp) expect(v).toBeLessThanOrEqual(0);
    // diamagnetic: F rises from the axis to the edge
    expect(hi.prof.F[0]).toBeLessThan(hi.prof.F[hi.prof.F.length - 1]);
  });

  it('flags an unreachable β_p target (β0 held at the current-positivity limit) instead of failing silently', () => {
    const eq = solver.solve({ Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 5 } });
    expect(eq.converged).toBe(true);
    expect(eq.betaPTargetMet).toBe(false);
    expect(eq.warnings.map((w) => w.code)).toEqual(['betaP-target-unreachable']);
    expect(eq.beta0).toBeCloseTo(solver.beta0Max, 12);
    expect(eq.betaP).toBeLessThan(5);
    // j_φ ≥ 0 at the limit
    const lap = solver.grid.applyOperator(eq.psi);
    for (const k of solver.grid.interior) expect(lap[k]).toBeLessThanOrEqual(1e-12 * eq.psiAxis);
  });

  it('Anderson mixing reaches the same equilibrium in far fewer iterations than damped Picard', () => {
    const o: EquilibriumOptions = { Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.65 }, tol: 1e-9 };
    const aa = solver.solve(o);
    const picard = solver.solve({ ...o, acceleration: 'none', relax: 0.6 });
    expect(aa.converged && picard.converged).toBe(true);
    expect(aa.iterations).toBeLessThan(picard.iterations / 2);
    for (const k of ['q95', 'li3', 'betaP', 'q0'] as const) expect(aa[k]).toBeCloseTo(picard[k], 6);
  });
});

describe('GSGrid', () => {
  it('fills the exterior with bounded values through one recorded plan (no blow-up at NR = 129)', () => {
    const sol = new PhysicalSolovev(6.2, 5.3, 15e6, SOLOVEV);
    const grid = new GSGrid(ITER, { NR: 129 });
    const psi = grid.solveLinear((R) => sol.source(R));
    let inMax = 0;
    for (const k of grid.interior) inMax = Math.max(inMax, Math.abs(psi[k]));
    const general = grid.extend(Float64Array.from(psi), () => 0);
    grid.extend(psi);
    let outMax = 0;
    for (let k = 0; k < psi.length; k++) {
      outMax = Math.max(outMax, Math.abs(psi[k]));
      expect(Math.abs(psi[k] - general[k])).toBeLessThan(1e-12 * inMax);
    }
    expect(outMax).toBeLessThan(1.5 * inMax);
  });

  it("gives |∇ψ| on an exact Solov'ev flux contour to 0.3 % (NR = 65) through the extended spline", () => {
    const R0 = 6.2, Psi0 = 10;
    const sol = new SolovevEquilibrium(SOLOVEV);
    const boundary = solovevBoundary(sol, R0);
    const grid = new GSGrid({ R: R0, a: SOLOVEV.epsilon * R0, kappa: SOLOVEV.kappa, delta: SOLOVEV.delta }, { NR: 65, boundary });
    const psi = grid.extend(grid.solveLinear((R) => -(Psi0 / (R0 * R0)) * sol.sourceBar(R / R0)));
    const bi = grid.bicubic(psi), g3 = new Float64Array(3);
    let err = 0, gmax = 0;
    for (let t = 0; t < 360; t++) {
      const [R, Z] = boundary.point((2 * Math.PI * t) / 360);
      const gx = (Psi0 / R0) * sol.psiBar(R / R0, Z / R0, 1, 0), gz = (Psi0 / R0) * sol.psiBar(R / R0, Z / R0, 0, 1);
      bi.evalGrad(R, Z, g3);
      err = Math.max(err, Math.abs(Math.hypot(g3[1], g3[2]) - Math.hypot(gx, gz)));
      gmax = Math.max(gmax, Math.hypot(gx, gz));
    }
    expect(err / gmax).toBeLessThan(3e-3);
  });

  it('applyOperator is the discrete Δ* that solveLinear inverts', () => {
    const grid = new GSGrid(ITER, { NR: 33 });
    const S = (R: number, Z: number) => Math.cos(0.7 * R) * (1 + Z * Z);
    const psi = grid.solveLinear(S);
    const lap = grid.applyOperator(psi);
    for (const k of grid.interior) {
      const i = k % grid.NR, j = (k - i) / grid.NR;
      expect(lap[k]).toBeCloseTo(S(grid.R(i), grid.Z(j)), 9);
    }
  });

  it('shares factorised grids through a bounded per-worker LRU cache with identical results', () => {
    GSGrid.clearCache();
    const a = GSGrid.shared(ITER, { NR: 33 });
    expect(GSGrid.shared({ ...ITER }, { NR: 33 })).toBe(a);
    expect(GSGrid.shared(ITER, { NR: 33, cache: false })).not.toBe(a);
    expect(new GSSolver(ITER, { NR: 33 }).grid).toBe(a);
    const o: EquilibriumOptions = { Ip, B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.5 } };
    const cached = new GSSolver(ITER, { NR: 33 }).solve(o), fresh = new GSSolver(ITER, { NR: 33, cache: false }).solve(o);
    expect(Array.from(cached.psi)).toEqual(Array.from(fresh.psi));
    expect(cached.q95).toBe(fresh.q95);
    for (let i = 0; i < 12; i++) GSGrid.shared({ ...ITER, R: 6.2 + 0.01 * i }, { NR: 17 });
    expect(GSGrid.cacheSize).toBeLessThanOrEqual(8);
    GSGrid.clearCache();
    expect(GSGrid.cacheSize).toBe(0);
  });
});

describe('failure paths', () => {
  const solver = new GSSolver(ITER, { NR: 33 });
  const shape = { kind: 'shape' as const, alphaM: 2, alphaN: 1.3, betaP: 0.5 };
  const psiN = [0, 0.25, 0.5, 0.75, 1], p = [5e5, 4e5, 2.5e5, 1e5, 1e3], jR = [8e5, 7e5, 5e5, 3e5, 1e5];

  it('rejects invalid input with a typed GSFailure before iterating', () => {
    const bad: [string, () => unknown][] = [
      ['NaN current', () => solver.solve({ Ip: NaN, B0, profile: shape })],
      ['negative current', () => solver.solve({ Ip: -1e6, B0, profile: shape })],
      ['zero field', () => solver.solve({ Ip, B0: 0, profile: shape })],
      ['negative β_p target', () => solver.solve({ Ip, B0, profile: { ...shape, betaP: -0.1 } })],
      ['alphaM ≤ 0', () => solver.solve({ Ip, B0, profile: { ...shape, alphaM: 0 } })],
      ['relax > 1', () => solver.solve({ Ip, B0, profile: shape, relax: 1.5 })],
      ['nSurf < 4', () => solver.solve({ Ip, B0, profile: shape, nSurf: 2 })],
      ['maxIter 0', () => solver.solve({ Ip, B0, profile: shape, maxIter: 0 })],
      ['psiInit size', () => solver.solve({ Ip, B0, profile: shape, psiInit: new Float64Array(10) })],
      ['decreasing ψ_N', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN: [0, 0.5, 0.4, 1], p: [1, 1, 1, 1], jR: [1, 1, 1, 1] } })],
      ['ψ_N not spanning [0, 1]', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN: [0, 0.5, 0.9], p: [1, 1, 1], jR: [1, 1, 1] } })],
      ['length mismatch', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p: p.slice(1), jR } })],
      ['NaN in table', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p, jR: [1, NaN, 1, 1, 1] } })],
      ['neither I nor jR', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p } })],
      ['currentScaleWarn < 0', () => solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p, jR }, currentScaleWarn: -0.1 })],
      ['grid NR < 9', () => new GSGrid(ITER, { NR: 5 })],
      ['R ≤ a(1 + margin)', () => new GSGrid({ R: 1, a: 1, kappa: 1, delta: 0 })],
      ['forceBalanceOf ψ size', () => solver.forceBalanceOf(new Float64Array(10), () => 0, () => 0)],
      ['forceBalanceOf ψ ≤ 0 on the axis', () => solver.forceBalanceOf(new Float64Array(solver.grid.NR * solver.grid.NZ), () => 0, () => 0)],
    ];
    for (const [name, fn] of bad) {
      const e = failure(fn);
      expect(e.reason, name).toBe('bad-input');
      expect(e.iterations, name).toBe(0);
      expect(e.name).toBe('GSFailure');
    }
  });

  it('reports a table current that cannot be normalised to I_p', () => {
    const e = failure(() => solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p, jR: [0, 0, 0, 0, 0] } }));
    expect(e.reason).toBe('current-unreachable');
    expect(e.iterations).toBe(0);
    expect(e.message).toMatch(/I_p/);
  });

  it('a consistent table converges and keeps converged/residual/iterations', () => {
    const eq = solver.solve({ Ip, B0, profile: { kind: 'table', psiN, p, jR }, tol: 1e-8 });
    expect(eq.converged).toBe(true);
    expect(eq.residual).toBeLessThan(1e-8);
    expect(eq.iterations).toBeGreaterThan(1);
    expect(eq.forceBalanceRatio).toBeCloseTo(1, 3);
    // this ad-hoc table is not normalised to I_p: only that is reported
    expect(Math.abs(eq.currentScale! - 1)).toBeGreaterThan(0.1);
    expect(eq.warnings.map((w) => w.code)).toEqual(['table-current-rescaled']);
  });
});
