/**
 * Plasma boundary of the 1.5D transport equations (the separatrix values T_sep, n_sep) and the
 * power crossing it (P_SOL).
 *
 *  - T_sep from the two-point model (Stangeby, "The Plasma Boundary of Magnetic Fusion Devices",
 *    IoP 2000, §5): T_u = (7 q∥ L∥ / 2κ0e)^{2/7} with the conductive parallel heat flux
 *    q∥ = P_SOL B/(2π R λ_q B_p) and λ_q from the Eich regression #14 (Eich et al., Nucl. Fusion
 *    53 (2013) 093031), L∥ = π q95 R0.
 *  - n_sep = f_sep n̄_target × gain: the gas puff acts on the separatrix density; the gain is set
 *    by the density controller (control/fueling.ts). Capped at 0.6 n̄_target.
 *  - P_SOL from the global power balance P_heat − P_rad − dW/dt (not from the instantaneous
 *    boundary flux: the T_sep ↔ flux feedback would oscillate step by step), lagged by τ = 20 ms.
 */
import { MU0, ProfileContext } from '../context';
import { nTarget } from '../control/actuators';
import { q95 } from '../qprofile';
import type { ProfileState } from '../state';

/** Separatrix electron temperature [keV] (two-point model, or the fixed Tsep_keV setting) */
export function separatrixT(ctx: ProfileContext, P_SOL: number, q95v: number, Ip: number): number {
  if (ctx.ps.Tsep_keV !== undefined) return ctx.ps.Tsep_keV;
  const g = ctx.tg;
  const Rout = g.RoutF[g.N];
  const Bp = (MU0 * Ip) / g.perimeter;
  const lamq = 0.63e-3 * Math.pow(Math.max(Bp, 0.05), -1.19); // Eich #14 [m]
  const Bt = (g.B0 * g.R0) / Rout;
  const qpar = (Math.max(P_SOL, 1e5) * 0.6 * Math.hypot(Bt, Bp)) / (2 * Math.PI * Rout * lamq * Bp);
  const L = Math.PI * Math.max(q95v, 1.5) * g.R0;
  const TeV = Math.pow((3.5 * qpar * L) / 2000, 2 / 7);
  return Math.min(Math.max(TeV / 1000, 0.03), 0.5);
}

/**
 * Boundary values for the step starting at t from state o (P_SOL of the previous step, q of o:
 * currentProfiles must have been evaluated on o). T_i,sep = T_e,sep.
 */
export function updateBoundary(ctx: ProfileContext, t: number, o: ProfileState): void {
  const Tsep = separatrixT(ctx, ctx.PSOL, q95(ctx), o.s.Ip);
  const nT = nTarget(ctx, t);
  ctx.bc = { Te: Tsep, Ti: Tsep, n: Math.min(ctx.ps.nsepFrac * nT * ctx.nsepGain, 0.6 * nT) };
}

/** Advances the lagged P_SOL over an accepted step of length dt [W] */
export function updatePsol(ctx: ProfileContext, dt: number, P_heat: number, P_rad: number, dWdt: number): void {
  const PsolTarget = Math.max(P_heat - P_rad - dWdt, 0.05 * P_heat, 1e5);
  ctx.PSOL += (PsolTarget - ctx.PSOL) * (1 - Math.exp(-dt / 0.02));
}
