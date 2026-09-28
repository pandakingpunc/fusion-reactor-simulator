/**
 * Energy content of the fast ions (NBI ions, fast charged fusion products) for the pressure of β.
 *
 * A fast ion of birth energy E_0 slows down on the electrons and ions (Stix, Plasma Phys. 14 (1972)
 * 367) and gives its energy to the plasma; the distribution of a constant source P has the energy
 * content W_ss = P τ_W with τ_W = τ_se (1 − G(E_0/E_c))/2 (heating.ts fastIonEnergyTime). The
 * content of a source that starts (start-up, a beam that is switched on) builds up with that time
 * constant, dW/dt = P − W/τ_W, and cannot exceed the energy that was injected; after the source
 * stops it decays the same way. The 0D model integrates exactly this (confinement/magnetic.ts,
 * states W_α and W_b). The 1.5D model keeps the two contents as scalar pools (ctx.WfAlpha,
 * ctx.WfBeam) and advances them once per accepted step with the exact solution for constant P and
 * τ_W over the step,
 *
 *   W' = W_ss + (W − W_ss) exp(−Δt/τ_W),  W_ss = P τ_W,
 *
 * which is unconditionally stable and gives W' − W ≤ P Δt. The steady content W_ss and the
 * time constant come from the work arrays of the state at the end of the step (sources/fusion.ts,
 * sources/nbi.ts, per cell); the pool's time constant is the power-weighted mean of the cells,
 * or the volume mean while the source is off.
 *
 * APPROXIMATION: the heating by the fast ions stays instantaneous and local (it is deposited where
 * it is born, the pool feeds the pressure only); no transport or loss of fast ions; the beam
 * ions are isotropic.
 */
import type { ProfileContext } from './context';
import type { PowerTotals } from './diagnostics';

/** Floor of the pool's time constant [s], as in the 0D model */
export const TAU_W_MIN = 1e-3;

/** Exact solution of dW/dt = P − W/τ over dt for a constant steady content W_ss = P τ [J] */
export function relaxPool(W: number, Wss: number, tau: number, dt: number): number {
  return Wss + (W - Wss) * Math.exp(-dt / Math.max(tau, TAU_W_MIN));
}

/**
 * Advances the two pools by one accepted step of length dt with the power totals P of the state at
 * the end of the step: the pool of a source that is on relaxes with τ_W = W_ss/P, the pool of a
 * source that is off with the volume mean of τ_W of the cells (empty pools stay empty).
 */
export function advanceFastIons(ctx: ProfileContext, P: PowerTotals, dt: number): void {
  const w = ctx.w;
  const tauA = P.P_alpha > 0 ? P.Wss_alpha / P.P_alpha : ctx.volAvg(w.tauWa);
  const tauB = P.P_beam > 0 ? P.Wss_beam / P.P_beam : ctx.volAvg(w.tauWb);
  ctx.WfAlpha = Math.max(relaxPool(ctx.WfAlpha, P.Wss_alpha, tauA, dt), 0);
  ctx.WfBeam = Math.max(relaxPool(ctx.WfBeam, P.Wss_beam, tauB, dt), 0);
}
