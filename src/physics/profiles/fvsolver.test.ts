/**
 * The finite-volume solvers as the TR-BDF2 stages use them (fvsolver.ts): the right-hand sides (`residual`, `rate`) are the
 * ones the solves satisfy, the reference state and the explicit rates of a stage (U0e, Xe, X, rate0), and the linear filter of the
 * error estimate.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../rng';
import { CurrentSolver, DensitySolver, HEAT_CONVECTION, HeatInputs, HeatSolver } from './fvsolver';
import { circularGeometry, gridSpec, TransportGeometry } from './geometry1d';

const rel = (a: number, b: number, scale: number) => Math.abs(a - b) / scale;

function fixtures(N: number, packed: boolean) {
  const g = circularGeometry(2.5, 0.7, 2.2, N, undefined, packed ? gridSpec({ gridPacking: 4, pedestalWidth: 0.06 }) : undefined);
  const rng = new RNG(5);
  const cell = (f: (r: number) => number, noise = 0) => Float64Array.from(g.rhoC, (r) => f(r) * (1 + noise * (rng.next() - 0.5)));
  const face = (f: (r: number) => number) => Float64Array.from(g.rhoF, f);
  return { g, cell, face };
}

function heatInputs(g: TransportGeometry, cell: ReturnType<typeof fixtures>['cell'], face: ReturnType<typeof fixtures>['face']): HeatInputs {
  const N = g.N;
  const ne0 = cell((r) => 1e20 * (1 - 0.6 * r * r), 0.05), ne1 = cell((r) => 1.03e20 * (1 - 0.6 * r * r), 0.05);
  const GammaF = face((r) => 5e21 * Math.sin(3 * Math.PI * r));
  GammaF[0] = 0; GammaF[N] = 3e21;
  return {
    dt: 0.03, ne0, ne1, ni0: ne0.map((x) => 0.85 * x), ni1: ne1.map((x, i) => (0.8 + 0.003 * i) * x),
    Te0: cell((r) => 6 * (1 - r * r) + 0.2, 0.05), Ti0: cell((r) => 5 * (1 - r * r) + 0.2, 0.05),
    chiE: face((r) => 0.4 + 2 * r * r), chiI: face((r) => 0.6 + 1.5 * r * r),
    Qe: cell((r) => 3e21 * Math.exp(-8 * r * r) - 2e20, 0.2), Qi: cell((r) => 2e21 * Math.exp(-5 * r * r), 0.2),
    Le: cell(() => 4e19, 0.5), Li: cell(() => 1e19, 0.5), TeStar: cell((r) => 6 * (1 - r * r) + 0.3, 0.05), TiStar: cell((r) => 5 * (1 - r * r) + 0.3, 0.05),
    nuEq: cell(() => 30, 0.3), GammaF, convCoef: HEAT_CONVECTION, TeB: 0.1, TiB: 0.12, nB: 3e19,
  };
}

describe.each([['uniform grid', false], ['edge-packed grid', true]] as const)('heat solver on the %s', (_name, packed) => {
  const N = 40;
  const { g, cell, face } = fixtures(N, packed);

  it('a solution satisfies (3/2 n T − U0)/Δt = residual to round-off, with the default reference and with a given one plus an explicit rate', () => {
    const h = heatInputs(g, cell, face);
    const solver = new HeatSolver(g);
    const Te = new Float64Array(N), Ti = new Float64Array(N), rE = new Float64Array(N), rI = new Float64Array(N);
    solver.solve(h, Te, Ti);
    solver.residual(h, Te, Ti, rE, rI);
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const sE = Math.abs(rE[i]) + 1.5 * h.ne1[i] * Te[i] / h.dt, sI = Math.abs(rI[i]) + 1.5 * h.ni1[i] * Ti[i] / h.dt;
      worst = Math.max(worst,
        rel(1.5 * h.ne1[i] * Te[i] - 1.5 * h.ne0[i] * h.Te0[i], rE[i] * h.dt, sE * h.dt),
        rel(1.5 * h.ni1[i] * Ti[i] - 1.5 * h.ni0[i] * h.Ti0[i], rI[i] * h.dt, sI * h.dt));
    }
    expect(worst).toBeLessThan(1e-12);

    // a reference state of the stage and an explicit rate: (U − U0)/Δt = residual(with the rate)
    const U0e = cell((r) => 1.5 * 9e19 * (5 * (1 - r * r) + 0.4)), U0i = cell((r) => 1.5 * 7e19 * (4 * (1 - r * r) + 0.4));
    const Xe = cell((r) => 4e20 * Math.exp(-3 * r)), Xi = cell((r) => -2e20 * r);
    const h2: HeatInputs = { ...h, dt: 0.011, U0e, U0i, Xe, Xi };
    solver.solve(h2, Te, Ti);
    solver.residual(h2, Te, Ti, rE, rI);
    worst = 0;
    for (let i = 0; i < N; i++) {
      worst = Math.max(worst,
        rel(1.5 * h.ne1[i] * Te[i] - U0e[i], rE[i] * h2.dt, Math.abs(U0e[i]) + Math.abs(rE[i]) * h2.dt),
        rel(1.5 * h.ni1[i] * Ti[i] - U0i[i], rI[i] * h2.dt, Math.abs(U0i[i]) + Math.abs(rI[i]) * h2.dt));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('the rate of the old state (sink terms cancel at T* = T): the residual of a state at rest is minus the divergence of its fluxes plus the sources', () => {
    // uniform T, n and no convection or exchange: conduction vanishes, the rate is Q (the sinks L (T* − T) cancel)
    const n = cell(() => 1e20);
    const zero = () => new Float64Array(N);
    const T = cell(() => 3);
    const h: HeatInputs = {
      dt: 1, ne0: n, ne1: n, ni0: n, ni1: n, Te0: T, Ti0: T, chiE: face(() => 1), chiI: face(() => 1), Qe: cell(() => 1e21), Qi: cell(() => 5e20),
      Le: cell(() => 3e19), Li: zero(), TeStar: T, TiStar: T, nuEq: zero(), GammaF: zero(), convCoef: 0, TeB: 3, TiB: 3, nB: 1e20,
    };
    const rE = zero(), rI = zero();
    new HeatSolver(g).residual(h, T, T, rE, rI);
    for (let i = 0; i < N; i++) {
      expect(Math.abs(rE[i] / 1e21 - 1)).toBeLessThan(1e-11);
      expect(Math.abs(rI[i] / 5e20 - 1)).toBeLessThan(1e-11);
    }
  });
});

describe.each([['uniform grid', false], ['edge-packed grid', true]] as const)('density solver on the %s', (_name, packed) => {
  const N = 40;
  const { g, cell, face } = fixtures(N, packed);
  const D = face((r) => 0.3 + r * r), v = face((r) => -0.6 * r);
  const S = cell((r) => 2e19 * Math.exp(-20 * (1 - r)));
  const n0 = cell((r) => 4e19 * (1 - 0.7 * r * r));

  it('a solution satisfies (n − n0)/Δt = residual (+ the explicit rate X of the stage) to round-off, and the residual fills the fluxes it was asked for', () => {
    const solver = new DensitySolver(g);
    const n = new Float64Array(N), rate = new Float64Array(N), flux = new Float64Array(N + 1);
    const h = { dt: 0.02, n0, D, v, S, nB: 1.2e19 };
    solver.solve(h, n);
    solver.residual(h, n, flux, rate);
    let worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, rel(n[i] - n0[i], rate[i] * h.dt, Math.abs(n0[i]) + Math.abs(rate[i]) * h.dt));
    expect(worst).toBeLessThan(1e-12);
    for (let f = 0; f <= N; f++) expect(flux[f]).toBe(solver.GammaF[f]);
    // with an explicit rate X and another reference
    const X = cell((r) => 5e19 * (1 - r));
    const ref = cell((r) => 3e19 * (1 - 0.5 * r * r));
    const h2 = { ...h, dt: 0.006, n0: ref, X };
    solver.solve(h2, n);
    solver.residual(h2, n, flux, rate);
    worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, rel(n[i] - ref[i], (rate[i] + X[i]) * h2.dt, Math.abs(ref[i]) + Math.abs(rate[i] + X[i]) * h2.dt));
    expect(worst).toBeLessThan(1e-12);
  });

  it('the filter damps a component that is stiff over the interval, keeps a smooth one, is linear, and leaves the fluxes of the last solve alone', () => {
    const solver = new DensitySolver(g);
    const n = new Float64Array(N);
    solver.solve({ dt: 0.02, n0, D, v, S, nB: 1.2e19 }, n);
    const fluxes = Float64Array.from(solver.GammaF);
    const alt = Float64Array.from({ length: N }, (_, i) => (i % 2 ? 1 : -1) * 1e17);
    const flat = new Float64Array(N).fill(1e17);
    const out = new Float64Array(N);
    // stiff: a large interval times the diffusion over a cell: the cell-to-cell oscillation is damped by two orders of magnitude
    solver.filter({ dt: 1, D, v }, alt, out);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(0.02 * 1e17);
    // smooth and quick: a very short interval leaves the profile alone
    solver.filter({ dt: 1e-12, D, v }, flat, out);
    for (let i = 0; i < N; i++) expect(Math.abs(out[i] / 1e17 - 1)).toBeLessThan(1e-6);
    // linearity
    const a = new Float64Array(N), b = new Float64Array(N), ab = new Float64Array(N);
    solver.filter({ dt: 0.01, D, v }, alt, a);
    solver.filter({ dt: 0.01, D, v }, flat, b);
    solver.filter({ dt: 0.01, D, v }, alt.map((x, i) => 2 * x + 3 * flat[i]), ab);
    for (let i = 0; i < N; i++) expect(Math.abs(ab[i] - (2 * a[i] + 3 * b[i]))).toBeLessThan(1e-9 * 1e17);
    expect(Array.from(solver.GammaF)).toEqual(Array.from(fluxes));
  });
});

describe('current solver as a TR-BDF2 stage', () => {
  const N = 40;
  const { g, cell } = fixtures(N, true);
  const sigma = cell((r) => 3e8 * (1 - 0.5 * r * r)), jniB = cell((r) => 1e5 * Math.exp(-4 * (1 - r)));
  const psi0 = cell((r) => 2 * r * r);
  const Ip = 3e6;

  it('a solution satisfies (ψ − ψ0)/Δt = rate (+ the explicit rate rate0) to round-off', () => {
    const solver = new CurrentSolver(g);
    const psi = new Float64Array(N), rate = new Float64Array(N);
    const h = { dt: 0.1, psi0, sigma, jniB, Ip };
    solver.solve(h, psi);
    solver.rate(h, psi, rate);
    let worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, rel(psi[i] - psi0[i], rate[i] * h.dt, Math.abs(psi0[i]) + Math.abs(rate[i]) * h.dt + 1e-30));
    expect(worst).toBeLessThan(1e-11);
    const rate0 = cell((r) => 0.02 * (1 - r));
    const h2 = { ...h, dt: 0.03, rate0 };
    solver.solve(h2, psi);
    solver.rate(h2, psi, rate);
    worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, rel(psi[i] - psi0[i], (rate[i] + rate0[i]) * h2.dt, Math.abs(psi0[i]) + Math.abs(rate[i] + rate0[i]) * h2.dt + 1e-30));
    expect(worst).toBeLessThan(1e-11);
  });
});

describe('Pereverzev–Corrigan stabilisation of the heat solve (HeatInputs.pcFactor)', () => {
  const N = 50;
  const g = circularGeometry(3, 1, 3, N);
  const cell = (f: (r: number) => number) => Float64Array.from(g.rhoC, f);
  const zero = new Float64Array(N), zeroF = new Float64Array(N + 1);
  const ne = cell(() => 1e20);
  const TB = 0.1;
  /** critical-gradient conductivity: χ = 0.2 + κ (max(−∇T/g_c − 1, 0))² at the faces (steep above the threshold) */
  const chiOf = (T: Float64Array, kappa: number, gc: number) => {
    const chi = new Float64Array(N + 1);
    for (let f = 1; f <= N; f++) {
      const grad = -((f < N ? T[f] : TB) - T[f - 1]) / g.distF[f];
      const x = Math.max(grad / gc - 1, 0);
      chi[f] = 0.2 + kappa * x * x;
    }
    chi[0] = chi[1];
    return chi;
  };
  const inputs = (chi: Float64Array, Tstar: Float64Array, pcFactor?: number): HeatInputs => ({
    dt: 1, ne0: ne, ne1: ne, ni0: ne, ni1: ne, Te0: cell(() => 1), Ti0: cell(() => 1), chiE: chi, chiI: chi,
    Qe: cell((r) => 6e21 * Math.exp(-10 * r * r)), Qi: zero, Le: zero, Li: zero, TeStar: Tstar, TiStar: Tstar,
    nuEq: zero, GammaF: zeroF, convCoef: 0, TeB: TB, TiB: TB, nB: 1e20, pcFactor,
  });

  it('a fixed point of the iteration is a fixed point with the stabilisation: solving at T* = T returns T for any factor, on a solution that has no sink terms to linearise', () => {
    const solver = new HeatSolver(g);
    // the solution of the equations for a fixed χ (a plain solve, no sink terms: T* does not enter)
    const chi = Float64Array.from({ length: N + 1 }, (_, f) => 0.4 + 2 * (f / N) ** 2);
    const T = new Float64Array(N), Ti = new Float64Array(N);
    solver.solve(inputs(chi, cell(() => 1)), T, Ti);
    for (const c of [1, 10, 50]) {
      const T2 = new Float64Array(N), Ti2 = new Float64Array(N);
      solver.solve(inputs(chi, T, c), T2, Ti2);
      for (let i = 0; i < N; i++) expect(Math.abs(T2[i] - T[i])).toBeLessThan(1e-10 * Math.abs(T[i]));
    }
    // and a different T* is pulled towards the solution: the implicit part is (1 + c) χ, the explicit part c χ ∇T*
    const off = T.map((x) => 1.3 * x);
    const T3 = new Float64Array(N);
    solver.solve(inputs(chi, off, 10), T3, Ti);
    let dOff = 0, dPc = 0;
    for (let i = 0; i < N; i++) { dOff = Math.max(dOff, Math.abs(off[i] - T[i])); dPc = Math.max(dPc, Math.abs(T3[i] - T[i])); }
    expect(dPc).toBeLessThan(dOff);
  });

  it('the frozen-χ iteration on a steep critical-gradient χ cycles between two states; with the stabilisation it converges to the fixed point', () => {
    const solver = new HeatSolver(g);
    const run = (pc: number | undefined, iters: number) => {
      const T = cell(() => 1);
      let last = 0;
      for (let k = 0; k < iters; k++) {
        const Tn = new Float64Array(N), Ti = new Float64Array(N);
        solver.solve(inputs(chiOf(T, 20, 4), T, pc), Tn, Ti);
        last = 0;
        for (let i = 0; i < N; i++) last = Math.max(last, Math.abs(Tn[i] - T[i]) / Math.max(T[i], 0.05));
        T.set(Tn);
      }
      return { T, last };
    };
    const plain = run(undefined, 80);
    expect(plain.last).toBeGreaterThan(0.5); // a two-cycle: the change of the last iteration is of the order of the profile
    const pc = run(10, 250);
    expect(pc.last).toBeLessThan(1e-7);
    // the fixed point solves the original equations (no stabilisation term in them): (3/2) n (T − T0)/Δt = the unstabilised right-hand side
    const rE = new Float64Array(N), rI = new Float64Array(N);
    solver.residual(inputs(chiOf(pc.T, 20, 4), pc.T), pc.T, pc.T, rE, rI);
    for (let i = 0; i < N; i++) expect(Math.abs(1.5 * 1e20 * (pc.T[i] - 1) - rE[i]) / (1.5 * 1e20 * pc.T[i])).toBeLessThan(1e-5);
  });
});
