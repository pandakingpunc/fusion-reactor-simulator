/**
 * The EPED1-type pedestal of a 1.5D shot (`ProfileSettings.pedestalModel = 'eped1'`; default 'fixed': the pedestal width, the barrier
 * depth and the ballooning limit of profiles/defaults.ts, untouched).
 *
 * The two constraints of eped1.ts, the KBM width Δ = 0.076 β_p,ped^{1/2} and the peeling–ballooning height β_p,ped(Δ, n_ped), meet at one
 * pedestal (Δ, β_p,ped) at the pedestal density of the state (`solveEped1`, iterated at every evaluation: the density of the pedestal top, over the
 * Greenwald density, lifts the height as n_ped^0.64). Per evaluation (every accepted step) the model turns it into what the transport
 * and the ELM need:
 *
 *  - the pedestal-top pressure limit p_lim = β_p,ped B̄_p²/(2 μ0), B̄_p = μ0 I_p/L (I_p of the state, L the perimeter of the LCFS of the
 *    current equilibrium: the limit follows a current ramp and an equilibrium update);
 *  - the barrier width, the full width Δ (ψ_N) of the pedestal mapped to ρ̂ = √(Φ/Φ_b) on the flux-surface table of the equilibrium
 *    (1 − ρ̂(1 − Δ)), which is also the position of the pedestal top, ρ_top = 1 − Δ_ρ (T_ped of the diagnostics and the inner edge of
 *    the region an ELM empties);
 *  - the ratio r = p_top/p_lim of the pressure at ρ_top (interpolated between the two cell centres around it, total thermal pressure
 *    n_e T_e + n_i T_i) to the limit.
 *
 * Imposition (adaptive barrier). The edge transport barrier of transport/pedestal.ts suppresses χ inside ρ_top by the factor
 * etbFactor · A · k(r): k = min(r⁶, 30) above the limit (the kinetic-ballooning clamp of the fixed model, with r in the place of α_ped/α_crit) and 1
 * below it, and A ≤ 1 an integrator that deepens the barrier while the pedestal is below its limit and relaxes it above: d ln A/dt = (r − 1)/τ_A, τ_A = τ_E/4
 * (at least 20 ms), at most 0.3 per step, A between 1/4 and 1 (etbFactor is the depth at A = 1; a barrier that is much deeper makes the rebuild after an ELM as quick as the recovery time and the ELM frequency a
 * property of that time rather than of the transport). Between ELMs the barrier therefore deepens until the pedestal
 * reaches the limit, and a pedestal that cannot (the core, the density or the power do not supply it) stays below it with A at its floor and no ELMs.
 * This is an adaptive transport barrier rather than a heat sink in the pedestal cells: a sink would have to be booked as a loss channel
 * (P_bound, the energy identity of the TR-BDF2 step), while a change of χ carries its own energy accounting. The ELM fires when r > 1 (the
 * peeling–ballooning limit; margin r − 1 for the localisation of the crossing) and the α_ped/α_crit test of the fixed model is not applied.
 *
 * State between steps (width, limit, ratio, A) is part of the checkpoint under the keys ped_*; a shot with the fixed pedestal has none of them.
 */
import type { ProfileSettings } from '../../types';
import type { Checkpointable, CheckpointRecord } from '../checkpoint';
import type { ProfileContext } from '../context';
import { centerInterval, interpCells, type RadialGrid } from '../geometry1d';
import type { ProfileState } from '../state';
import type { TriggerScratch, TriggerState } from '../events/EventModel';
import { greenwaldDensity } from '../../limits';
import { PB_DENSITY_REF, poloidalField, pressureOfBeta, solveEped1, widthInRho, type Eped1Options } from './eped1';
import { pedestalCollisionality } from './loarte';

const KEV = 1.602176634e-16;

/** The clamp above the limit, min(r^KBM_EXPONENT, KBM_CAP) (the kinetic-ballooning clamp of the fixed model), and the range of the integrator A: ln A in [LN_A_MIN, 0] */
export const KBM_EXPONENT = 6;
export const KBM_CAP = 30;
export const LN_A_MIN = -Math.log(4);
/** Integrator: time constant in units of τ_E, its lower limit [s] and the largest change of ln A in one step */
export const A_TAU_OVER_TAUE = 0.25;
export const A_TAU_MIN = 0.02;
export const A_STEP_MAX = 0.3;

/** The clamp above the limit: 1 up to r = 1, then r⁶ up to 30 (1 before the first evaluation, when r is not positive) */
export function kbmClamp(r: number): number {
  return r > 1 ? Math.min(Math.pow(r, KBM_EXPONENT), KBM_CAP) : 1;
}

/** Total thermal pressure (n_e T_e + n_i T_i)·e [Pa] at the cell i of arrays of T [keV] and n_e [m⁻³], n_i = n_e·niOverNe */
function cellPressure(Te: ArrayLike<number>, Ti: ArrayLike<number>, ne: ArrayLike<number>, niOverNe: ArrayLike<number>, i: number): number {
  return (ne[i] * Math.max(Te[i], 0.01) + ne[i] * niOverNe[i] * Math.max(Ti[i], 0.01)) * KEV;
}

/** The pressure of a state at ρ, linear between the two cell centres around it (the end values outside them) */
export function pressureAt(g: RadialGrid, Te: ArrayLike<number>, Ti: ArrayLike<number>, ne: ArrayLike<number>, niOverNe: ArrayLike<number>, rho: number): number {
  const N = g.N;
  if (rho <= g.rhoC[0]) return cellPressure(Te, Ti, ne, niOverNe, 0);
  if (rho >= g.rhoC[N - 1]) return cellPressure(Te, Ti, ne, niOverNe, N - 1);
  const i = centerInterval(g, rho);
  const t = (rho - g.rhoC[i]) / g.distF[i + 1];
  const p0 = cellPressure(Te, Ti, ne, niOverNe, i), p1 = cellPressure(Te, Ti, ne, niOverNe, i + 1);
  return p0 + t * (p1 - p0);
}

export class PedestalModel implements Partial<Checkpointable> {
  readonly id = 'ped';
  readonly options: Eped1Options;
  /** pedestal poloidal beta and full width in ψ_N of the intersection of the constraints, at the density of the last evaluation */
  betaP: number;
  widthPsi: number;
  /** full width in ρ̂ (barrier width, position of the pedestal top 1 − width); the nominal `pedestalWidth` until the first update */
  width: number;
  /** pressure limit [Pa], pressure at the top [Pa] and their ratio of the last evaluation (0: none yet) */
  pLim = 0;
  pTop = 0;
  ratio = 0;
  /** ln A, the integrator that deepens the barrier below the limit (0: the nominal depth) */
  lnA = 0;

  constructor(private readonly ps: ProfileSettings) {
    this.options = { pbGradient: ps.pedPbGradient, kbmCoefficient: ps.pedKbmCoefficient, densityExponent: ps.pedDensityExponent };
    const s0 = solveEped1(this.options);
    this.betaP = s0.betaP;
    this.widthPsi = s0.width;
    this.width = ps.pedestalWidth;
  }

  /**
   * Evaluates the constraints on the equilibrium and the plasma current of the state and the pressure of the cells (w.p, the work array
   * the ballooning α is built from): width, limit, top pressure, ratio. Called before the diagnostics of a state are written.
   */
  update(ctx: ProfileContext, st: ProfileState, p: ArrayLike<number>): void {
    const g = ctx.tg;
    const Ip = Math.max(st.s.Ip, 1e5);
    // the density of the pedestal top (at the width of the last evaluation) over the Greenwald density, relative to the reference of the fit
    const nHat = interpCells(g, st.ne, 1 - this.width) / greenwaldDensity(Ip / 1e6, ctx.geomB.a);
    const sol = solveEped1(this.options, nHat / PB_DENSITY_REF);
    this.betaP = sol.betaP;
    this.widthPsi = sol.width;
    this.width = widthInRho(ctx.eq.prof.psiN, ctx.eq.prof.rhoTor, this.widthPsi);
    this.pLim = pressureOfBeta(this.betaP, poloidalField(Ip, g.perimeter));
    this.pTop = interpCells(g, p, 1 - this.width);
    this.ratio = this.pTop / this.pLim;
  }

  /** The factor of the anomalous χ at ρ inside an H-mode barrier: 1 − w(ρ) (1 − etbFactor a(r)), w a tanh step of width 0.01 at the pedestal top */
  barrierFactor(rho: number): number {
    const wgt = 0.5 * (1 + Math.tanh((rho - (1 - this.width)) / 0.01));
    return 1 - wgt * (1 - this.ps.etbFactor * this.depth());
  }

  /** The multiplier of etbFactor, A · k(r) */
  depth(): number { return Math.exp(this.lnA) * kbmClamp(this.ratio); }

  /** The integrator over the accepted step of length dt [s], with the ratio of its end (called by acceptStep after the diagnostics of the step) */
  advance(ctx: ProfileContext, dt: number): void {
    if (!(this.ratio > 0) || !(dt > 0)) return;
    const tau = Math.max(A_TAU_OVER_TAUE * (ctx.lastDiag.tauE ?? 0.1), A_TAU_MIN);
    const dl = Math.max(-A_STEP_MAX, Math.min(A_STEP_MAX, ((this.ratio - 1) * dt) / tau));
    this.lnA = Math.min(0, Math.max(LN_A_MIN, this.lnA + dl));
  }

  /** ELM trigger margin r − 1 of a state (events/triggers.ts); −1 outside H-mode with ELMs, and before the first evaluation */
  margin(ctx: ProfileContext, st: TriggerState, _sc: TriggerScratch): number {
    if (!(ctx.hmode && ctx.cfg.events.elms) || !(this.pLim > 0)) return -1;
    return pressureAt(ctx.tg, st.Te, st.Ti, st.ne, st.niOverNe, 1 - this.width) / this.pLim - 1;
  }

  /** Diagnostics keys of a state (only a shot with this model has them): the pedestal of the last update and ν*_ped at the top for q95 */
  diagnostics(ctx: ProfileContext, st: ProfileState, q95: number): Record<string, number> {
    const g = ctx.tg, rho = 1 - this.width;
    const ne = interpCells(g, st.ne, rho), Te = interpCells(g, st.Te, rho), Ti = interpCells(g, st.Ti, rho);
    return {
      ped_width: this.width, ped_width_psi: this.widthPsi, ped_beta_p: this.betaP,
      ped_p: this.pTop / 1e3, ped_p_lim: this.pLim / 1e3, ped_ratio: this.ratio, ped_depth: this.depth(),
      ped_nu: pedestalCollisionality(ne, Te, ctx.geomB.R, ctx.geomB.a, q95),
      // the pedestal top of the state: n_e [10²⁰ m⁻³], T_i [keV], and T_p = p/(2 n_e e), the temperature of EPED (T_i = T_e) that carries the same pressure
      ped_ne: ne / 1e20, ped_Ti: Ti, ped_Tp: this.pTop / (2 * Math.max(ne, 1) * KEV),
    };
  }

  save(rec: CheckpointRecord): void {
    rec.ped_width = this.width; rec.ped_widthPsi = this.widthPsi; rec.ped_betaP = this.betaP;
    rec.ped_pLim = this.pLim; rec.ped_pTop = this.pTop; rec.ped_ratio = this.ratio; rec.ped_lnA = this.lnA;
  }

  restore(rec: Readonly<CheckpointRecord>): void {
    const num = (k: string, dflt: number) => (typeof rec[k] === 'number' && Number.isFinite(rec[k]) ? rec[k] : dflt);
    this.width = num('ped_width', this.ps.pedestalWidth);
    this.widthPsi = num('ped_widthPsi', this.widthPsi); this.betaP = num('ped_betaP', this.betaP);
    this.pLim = num('ped_pLim', 0); this.pTop = num('ped_pTop', 0); this.ratio = num('ped_ratio', 0); this.lnA = num('ped_lnA', 0);
  }
}
