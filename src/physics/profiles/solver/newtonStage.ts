/**
 * Newton–Raphson solve of one stage of the coupled transport step (solver/coupledStep.ts) on the four fields together:
 * the unknowns are T_e, T_i, n_e and ψ of every cell, and the equations those of a backward-Euler-like stage over the interval Δ,
 *
 *   F_Te = ((3/2) n_e T_e − U0e)/Δ − X_e − R_e(z),      F_Ti = ((3/2) n_i T_i − U0i)/Δ − X_i − R_i(z),
 *   F_ne = (n_e − n0)/Δ − X_n − R_n(z),                 F_ψ  = (ψ − ψ0)/Δ − X_ψ − R_ψ(z),
 *
 * with R the right-hand sides of the finite-volume solvers of fvsolver.ts (fluxes, exchange, sources, current diffusion) and U0, n0,
 * ψ0, X the reference state and the explicit rates of the stage (HeatInputs, DensityInputs, CurrentInputs). R is evaluated
 * with every coefficient at the same z: the transport coefficients, the composition, the sources, the q profile, the conductivity and the
 * bootstrap current. A fixed point of the Picard iteration (coupledStep.ts, picard) is a root of F, and the other way round.
 *
 * The Jacobian is 4 × 4 block-tridiagonal, as the stencil of the solvers is three points wide, and is built by coloured finite
 * differences (numerics/blockTridiagN.ts: 12 evaluations of F) and factored by block LU. It is kept while the residual contracts by half per
 * iteration, and the one of the first stage of a step is the first guess of the second (both stages solve over the same interval
 * and their states are close); an attempt starts without one, so that a step is a function of its inputs only (no hidden state: chunk
 * invariance and exact rewind hold). The line search and the bounds are those of numerics/newton.ts.
 *
 * Scaling: the unknowns are divided by the maximum of their field in the old state, and the row of a cell by its energy (density, ψ)
 * content, floored at 2 % of the maximum, times Δ: F is then the relative change that the cell's equation asks for in the interval.
 */
import { composition } from '../composition';
import type { ProfileContext, StepConstants } from '../context';
import { CurrentInputs, DensityInputs, HEAT_CONVECTION, HeatInputs } from '../fvsolver';
import { JacobianStore, jacobianStore, newtonSolve, NewtonResult } from '../../numerics/newton';
import { currentProfiles } from '../qprofile';
import { assembleHeatSources } from '../sources';
import type { ProfileState } from '../state';
import type { PhysicsPipeline } from './pipeline';

/** Unknowns per cell: T_e, T_i, n_e, ψ */
const M = 4;
/** the relative change of a field per iteration that ends the iteration, measured against max(|z|, floor); floors as in the Picard test (T 0.05 keV, n 1e17 m⁻³) */
const FLOOR_T = 0.05, FLOOR_N = 1e17, FLOOR_PSI = 0.02;

export interface NewtonStageOptions {
  tol: number;
  maxIter: number;
  /** a kept Jacobian is renewed when the residual contracts by less than this per iteration */
  slow: number;
}

export class NewtonStage {
  private readonly N: number;
  private readonly store: JacobianStore;
  private readonly z: Float64Array; private readonly lower: Float64Array; private readonly floor: Float64Array;
  private readonly Re: Float64Array; private readonly Ri: Float64Array; private readonly Rn: Float64Array; private readonly Rpsi: Float64Array;
  private readonly rowE: Float64Array; private readonly rowI: Float64Array; private readonly rowN: Float64Array; private readonly rowP: Float64Array;
  private readonly zero: Float64Array;
  private sTe = 1; private sTi = 1; private sNe = 1; private sPsi = 1;
  /** the stage being solved */
  private v!: ProfileState; private K!: StepConstants;
  private heat!: HeatInputs; private dens!: DensityInputs; private cur!: CurrentInputs;
  private hRes!: HeatInputs;

  constructor(private readonly ctx: ProfileContext, private readonly physics: PhysicsPipeline) {
    const N = this.N = ctx.N;
    const arr = () => new Float64Array(N);
    this.store = jacobianStore(N, M);
    this.z = new Float64Array(M * N); this.lower = new Float64Array(M * N); this.floor = new Float64Array(M * N);
    this.Re = arr(); this.Ri = arr(); this.Rn = arr(); this.Rpsi = arr();
    this.rowE = arr(); this.rowI = arr(); this.rowN = arr(); this.rowP = arr();
    this.zero = arr();
  }

  /**
   * Once per attempt, on the old state o and for the interval dt of both stages: the scales of the unknowns and rows, and no Jacobian
   * (the first stage builds one, the second may use it).
   */
  begin(o: ProfileState, dt: number, ni0: ArrayLike<number>): void {
    const N = this.N;
    const maxOf = (f: (i: number) => number) => { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(f(i))); return m; };
    this.sTe = Math.max(maxOf((i) => o.Te[i]), 1e-3);
    this.sTi = Math.max(maxOf((i) => o.Ti[i]), 1e-3);
    this.sNe = Math.max(maxOf((i) => o.ne[i]), 1e15);
    this.sPsi = Math.max(maxOf((i) => o.psi[i]), 1e-12);
    const UeMax = maxOf((i) => 1.5 * o.ne[i] * o.Te[i]), UiMax = maxOf((i) => 1.5 * ni0[i] * o.Ti[i]);
    for (let i = 0; i < N; i++) {
      this.rowE[i] = dt / Math.max(1.5 * o.ne[i] * o.Te[i], 0.02 * UeMax, 1e-30);
      this.rowI[i] = dt / Math.max(1.5 * ni0[i] * o.Ti[i], 0.02 * UiMax, 1e-30);
      this.rowN[i] = dt / Math.max(o.ne[i], 0.02 * this.sNe);
      this.rowP[i] = dt / Math.max(Math.abs(o.psi[i]), 0.02 * this.sPsi);
      this.lower[M * i] = 0.005 / this.sTe; this.lower[M * i + 1] = 0.005 / this.sTi; this.lower[M * i + 2] = 1e15 / this.sNe; this.lower[M * i + 3] = -Infinity;
      this.floor[M * i] = FLOOR_T / this.sTe; this.floor[M * i + 1] = FLOOR_T / this.sTi; this.floor[M * i + 2] = FLOOR_N / this.sNe; this.floor[M * i + 3] = FLOOR_PSI;
    }
    this.store.valid = false;
  }

  /**
   * Solves the stage (its inputs are those of the Picard iteration: heat.U0e/U0i/Xe/Xi, dens.n0/X, cur.psi0/rate0, all over the
   * interval dt) from the iterate in v. On convergence v holds the solution and the work arrays are evaluated at it (transport
   * coefficients, composition, sources, q profile, fluxes); otherwise v and the work arrays are in some intermediate state.
   */
  solve(v: ProfileState, K: StepConstants, heat: HeatInputs, dens: DensityInputs, cur: CurrentInputs, o: NewtonStageOptions): NewtonResult {
    const N = this.N, z = this.z;
    this.bind(v, K, heat, dens, cur);
    this.unknowns(v, z);
    const res = newtonSolve(
      { n: N, m: M, residual: (x, out) => this.residual(x, out) }, z,
      { tol: o.tol, maxIter: o.maxIter, floor: this.floor, lower: this.lower, jacobian: 'adaptive', slow: o.slow, maxRelStep: 0.5, delta: (_i, _k, x) => 1e-7 * Math.max(Math.abs(x), 0.05) },
      this.store,
    );
    return res;
  }

  /** Points the residual at a stage: the state v that it fills and the inputs of the stage (begin() has set the scales) */
  bind(v: ProfileState, K: StepConstants, heat: HeatInputs, dens: DensityInputs, cur: CurrentInputs): void {
    const ctx = this.ctx, w = ctx.w;
    this.v = v; this.K = K; this.heat = heat; this.dens = dens; this.cur = cur;
    // the heat residual is evaluated at T* = T (the linearised sink terms cancel), with the composition and fluxes of the same z
    this.hRes = {
      dt: 1, ne0: v.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: v.Te, Ti0: v.Ti, chiE: w.chiE, chiI: w.chiI, Qe: w.Qe, Qi: w.Qi,
      Le: this.zero, Li: this.zero, TeStar: this.zero, TiStar: this.zero, nuEq: w.nuEq, GammaF: ctx.dens.GammaF,
      convCoef: HEAT_CONVECTION, TeB: ctx.bc.Te, TiB: ctx.bc.Ti, nB: ctx.bc.n,
    };
  }

  /** The scaled unknowns (cell-major: T_e, T_i, n_e, ψ of cell 0, of cell 1, …) of the state st */
  unknowns(st: ProfileState, z: Float64Array): void {
    for (let i = 0; i < this.N; i++) {
      z[M * i] = st.Te[i] / this.sTe; z[M * i + 1] = st.Ti[i] / this.sTi; z[M * i + 2] = st.ne[i] / this.sNe; z[M * i + 3] = st.psi[i] / this.sPsi;
    }
  }

  /**
   * F(z) for the scaled unknowns z: fills the bound state with the unscaled one, evaluates the work arrays on it (in the order of the
   * dependencies, so that F is a function of z alone) and writes the scaled residual to out
   */
  residual(z: Float64Array, out: Float64Array): void {
    const ctx = this.ctx, physics = this.physics, w = ctx.w, N = this.N;
    const { v, K, heat, dens, cur, Re, Ri, Rn, Rpsi } = this;
    for (let i = 0; i < N; i++) {
      v.Te[i] = z[M * i] * this.sTe; v.Ti[i] = z[M * i + 1] * this.sTi; v.ne[i] = z[M * i + 2] * this.sNe; v.psi[i] = z[M * i + 3] * this.sPsi;
    }
    // in the order of the dependencies, so that F is a function of z alone: the transport model reads the q profile (w.qF) of the iterate, the
    // Picard iteration reads that of the iterate before (a lag that vanishes at the fixed point), and a stale read makes F depend on the
    // evaluations that came before it
    composition(ctx, v.Te, v.ne, v.s);
    currentProfiles(ctx, v.psi, v.s.Ip);
    physics.transportCoefficients(v);
    // particle equation: the fluxes go to ctx.dens.GammaF (the convective heat flux of the same z)
    ctx.dens.residual({ D: w.D, v: w.v, S: w.Sn, nB: ctx.bc.n }, v.ne, ctx.dens.GammaF, Rn);
    physics.heatSources(v, K);
    physics.currentSources(v, K);
    assembleHeatSources(ctx);
    ctx.heat.residual(this.hRes, v.Te, v.Ti, Re, Ri);
    ctx.cur.rate({ sigma: w.sigma, jniB: w.jniB, Ip: cur.Ip }, v.psi, Rpsi);
    const dt = heat.dt, U0e = heat.U0e!, U0i = heat.U0i!, Xe = heat.Xe, Xi = heat.Xi, Xn = dens.X, Xp = cur.rate0;
    for (let i = 0; i < N; i++) {
      const k = M * i;
      out[k] = ((1.5 * v.ne[i] * v.Te[i] - U0e[i]) / dt - (Xe ? Xe[i] : 0) - Re[i]) * this.rowE[i];
      out[k + 1] = ((1.5 * w.ni[i] * v.Ti[i] - U0i[i]) / dt - (Xi ? Xi[i] : 0) - Ri[i]) * this.rowI[i];
      out[k + 2] = ((v.ne[i] - dens.n0[i]) / dt - (Xn ? Xn[i] : 0) - Rn[i]) * this.rowN[i];
      out[k + 3] = ((v.psi[i] - cur.psi0[i]) / dt - (Xp ? Xp[i] : 0) - Rpsi[i]) * this.rowP[i];
    }
  }
}
