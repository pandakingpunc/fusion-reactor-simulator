/**
 * Actuator programmes of a 1.5D shot: auxiliary heating powers with their start-up ramp, and the
 * density target with its ramp. The set-points themselves are ProfileContext.ctrl (live control).
 */
import type { ProfileContext } from '../context';

/** Linear start-up ramp of the auxiliary heating, 0 → 1 over heating.rampTime */
export function auxRamp(ctx: ProfileContext, t: number): number {
  return Math.min(1, t / Math.max(ctx.cfg.heating.rampTime, 0.01));
}

/**
 * Heating is cut only in the quench phases of a disruption (and after a disruption has ended the
 * shot); after a scheduled end the last frame stays consistent with the heated plasma.
 */
export function heatingOn(ctx: ProfileContext): boolean {
  const ph = ctx.phase;
  return !(ph === 'thermal_quench' || ph === 'current_quench' || (ph === 'ended' && ctx.disruption.cause !== 'none'));
}

/** Absorbed auxiliary powers at time t [W] */
export function heatingPowers(ctx: ProfileContext, t: number): { P_NBI: number; P_IC: number; P_EC: number } {
  const on = heatingOn(ctx) ? 1 : 0;
  const ramp = auxRamp(ctx, t) * on;
  return {
    P_NBI: ctx.ctrl.P_NBI_MW * 1e6 * ramp,
    P_IC: ctx.ctrl.P_ICRH_MW * 1e6 * ramp,
    P_EC: ctx.ctrl.P_ECRH_MW * 1e6 * ramp,
  };
}

/** Line-averaged density target [m⁻³]: ramps from 30 % to the set-point over n_rampTime */
export function nTarget(ctx: ProfileContext, t: number): number {
  const nt = ctx.ctrl.n_target_1e20 * 1e20;
  const f = Math.min(1, t / Math.max(ctx.cfg.n_rampTime, 0.01));
  return 0.3 * nt + (nt - 0.3 * nt) * f;
}
