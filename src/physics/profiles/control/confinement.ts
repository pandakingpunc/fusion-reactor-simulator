/**
 * Energy confinement of the 1.5D model: the loss power, the scaling-law τ_E and the controller that
 * ties the transport amplitude to it.
 *
 *  - Scaling law: IPB98(y,2) (ITER Physics Basis, Nucl. Fusion 39 (1999) 2175) or the spherical-
 *    tokamak scaling after Valovič et al. (Nucl. Fusion 51 (2011) 073045) in H-mode, times H98;
 *    ITER89-P (Yushmanov et al., Nucl. Fusion 30 (1990) 1999) times H89 in L-mode (transport.ts).
 *    NTM islands degrade it by the belt-model factor (events/ntm.ts).
 *  - Non-predictive transport (transport/scaling.ts): a PI controller on log(W/W_target),
 *    W_target = τ_scal P_loss, sets the amplitude C_χ; its integral term (the state scalar CI) is
 *    bounded around the diffusive estimate C_est = a²κ_a/(6 τ (1 + c/2)) against wind-up. τ_E is
 *    reported as the scaling value, which the controller holds.
 *  - Predictive transport: nothing ties W to the scaling law; τ_E = W/P_loss (with the same P_loss
 *    at which the scaling is evaluated) and C_χ = 1.
 */
import type { Geometry } from '../../geometry';
import { tauIPB98y2, tauITER89P, tauSTValovic } from '../../transport';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { ntmConfinementFactor } from '../events/ntm';

/** Loss power for τ_E [W]: heating minus radiation, floored against radiation-dominated states */
export function lossPower(ctx: ProfileContext, P_heat: number, P_rad: number): number {
  return Math.max(P_heat - P_rad, 0.1 * P_heat, 0.5e6 * (ctx.tg.volume / 100));
}

/** Scaling-law τ_E of the current mode, with the H factor [s] */
export function scalingTauE(ctx: ProfileContext, Ip_MA: number, nbar: number, P_loss: number): number {
  const c = ctx.cfg, g = ctx.tg;
  const gS: Geometry = { R: g.R0, a: g.a, kappa: ctx.kappaA, delta: ctx.geomB.delta };
  if (ctx.hmode) return ctx.ctrl.H98 * (c.scaling === 'ST_Valovic' ? tauSTValovic(gS, Ip_MA, g.B0, nbar, P_loss, ctx.M) : tauIPB98y2(gS, Ip_MA, g.B0, nbar, P_loss, ctx.M));
  return c.H89 * tauITER89P(gS, Math.max(Ip_MA, 0.05), g.B0, nbar, P_loss, ctx.M);
}

export interface ConfinementTimes {
  /** scaling-law τ_E with the NTM degradation: the target of the C_χ controller [s] */
  tauScal: number;
  /** reported τ_E [s] */
  tauE: number;
  /** τ_E that sets the particle, He-ash and impurity times (floored) [s] */
  tauT: number;
}

/** Confinement times of the new state st with stored energy W and loss power P_loss */
export function confinementTimes(ctx: ProfileContext, predictive: boolean, st: ProfileState, W: number, P_loss: number, nbar: number): ConfinementTimes {
  const Ip_MA = st.s.Ip / 1e6;
  const tauS = scalingTauE(ctx, Ip_MA, nbar, P_loss);
  const tauScal = Math.max(tauS * ntmConfinementFactor(ctx, st.s), 1e-3);
  const tauE = predictive ? W / P_loss : tauScal;
  const tauT = predictive ? Math.max(tauE, 1e-3) : tauScal;
  return { tauScal, tauE, tauT };
}

/**
 * Transport amplitude after an accepted step of length dt (o: old state, st: new state): the PI
 * controller for non-predictive transport, C_χ = 1 (integral term held) for predictive transport.
 */
export function updateTransportMultiplier(ctx: ProfileContext, predictive: boolean, dt: number, o: ProfileState, st: ProfileState, W: number, P_loss: number, tauScal: number): void {
  const g = ctx.tg, s = st.s;
  if (predictive) { s.CI = o.s.CI; s.Cchi = 1; return; }
  const Wt = tauScal * P_loss;
  const err = Math.log(Math.max(W, 1) / Math.max(Wt, 1));
  const tauI = 0.3 * tauScal;
  // anti-windup: the integral term is bounded around the diffusive estimate C_est = a²κ_a/(6τ(1 + c/2))
  const Cest = (g.a * g.a * ctx.kappaA) / (6 * tauScal * (1 + 0.5 * ctx.ps.chiShape));
  const CI = o.s.CI * Math.exp(Math.max(-0.5, Math.min(0.5, (dt / tauI) * err)));
  s.CI = Math.min(Math.max(CI, 0.1 * Cest), 10 * Cest);
  s.Cchi = Math.min(Math.max(s.CI * Math.exp(Math.max(-1.5, Math.min(1.5, 1.5 * err))), 1e-4), 1e4);
}
