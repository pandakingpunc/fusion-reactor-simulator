/**
 * Plasma boundary of the 1.5D transport equations (the separatrix values T_sep, n_sep) and the
 * power crossing it (P_SOL).
 *
 *  - T_sep, ProfileSettings.edgeModel 'legacy' (default): the conduction-limited two-point model (Stangeby,
 *    "The Plasma Boundary of Magnetic Fusion Devices", IoP 2000, §5): T_u = (7 q∥ L∥ / 2κ0e)^{2/7} with the
 *    parallel heat flux q∥ = 0.6 P_SOL B/(2π R λ_q B_p) and λ_q from the Eich regression #14 (Eich et al.,
 *    Nucl. Fusion 53 (2013) 093031), L∥ = π q95 R0; clamped to 0.03–0.5 keV.
 *    'twoPoint': T_u of the edge model (src/physics/edge; boundary/edge.ts): the outer leg carries 2/3 of P_SOL,
 *    the flux tube widens below the X-point by λ_int/λ_q (Makowski et al., Phys. Plasmas 19 (2012) 056122), the same
 *    functions as the edge diagnostics; only a guard band of 5 eV – 2 keV. Not the default: T_sep is not validated against
 *    measurements and differs from the legacy value by a few percent (see CHANGELOG).
 *  - n_sep = f_sep n̄_target × gain: the gas puff acts on the separatrix density; the gain is set
 *    by the density controller (control/fueling.ts). Capped at 0.6 n̄_target. The two-point model cannot give it
 *    (the upstream density is the free parameter of the model: it needs the recycling and the pumping); the
 *    ratio n_sep/⟨n_e⟩ ≈ 0.3–0.5 is the empirical one (Kallenbach et al., Plasma Phys. Control. Fusion 60 (2018) 045006).
 *  - P_SOL from the global power balance P_heat − P_rad − dW/dt, with dW/dt the smoothed rate of change of the
 *    stored energy that includes the energy the ELM crashes take out of the plasma (ctx.dWdtS): the ELM-averaged
 *    power that crosses the separatrix (not the instantaneous boundary flux: the T_sep ↔ flux feedback would
 *    oscillate step by step), lagged by τ = 20 ms. The step-wise dW/dt of the accepted step misses the crashes: P_SOL
 *    was 110.3 MW instead of the 122.0 MW of the balance on ITER15 (−9.6 %, 411.3 against 431.2 MW on DEMO15), the ELM power was
 *    missing. It is the same dW/dt as in the loss power P_L of the confinement time, with the same lag of τ_E: during a
 *    ramp-up (no ELMs, W rising) P_SOL follows the change of dW/dt with that lag (SPARC15-short, 3 s: −14 %).
 */
import { MU0, ProfileContext } from '../context';
import { nTarget } from '../control/actuators';
import { q95 } from '../qprofile';
import type { ProfileState } from '../state';
import { twoPointSeparatrixT } from './edge';

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
  const q95v = q95(ctx);
  const nT = nTarget(ctx, t);
  const n = Math.min(ctx.ps.nsepFrac * nT * ctx.nsepGain, 0.6 * nT);
  const Tsep = ctx.ps.Tsep_keV === undefined && ctx.ps.edgeModel === 'twoPoint'
    ? twoPointSeparatrixT(ctx, ctx.PSOL, n, q95v, o.s.Ip)
    : separatrixT(ctx, ctx.PSOL, q95v, o.s.Ip);
  ctx.bc = { Te: Tsep, Ti: Tsep, n };
}

/**
 * Advances the lagged P_SOL over an accepted step of length dt [W]. dWdt is the smoothed, ELM-inclusive
 * rate of change of the stored energy of the step (ctx.dWdtS after its update), not the step-wise one.
 */
export function updatePsol(ctx: ProfileContext, dt: number, P_heat: number, P_rad: number, dWdt: number): void {
  const PsolTarget = Math.max(P_heat - P_rad - dWdt, 0.05 * P_heat, 1e5);
  ctx.PSOL += (PsolTarget - ctx.PSOL) * (1 - Math.exp(-dt / 0.02));
}
