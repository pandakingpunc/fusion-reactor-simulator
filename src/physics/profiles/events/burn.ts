/**
 * Burn milestones: ignition, scientific breakeven (Q ≥ 1, ended below 1) and the ignition test.
 *
 *  - Ignition (Lawson): the heating by the charged fusion products alone covers radiation and
 *    transport, P_α ≥ P_rad + W/τ_E (W/τ_E = P_cond of the diagnostics: the transport loss including
 *    the ELMs), with hysteresis (lost below 0.9 of it) so that ELM ripple does not flood the event
 *    log. It does not depend on Q: NBI heating is not part of P_α, and with external heating on the
 *    balance P_heat = P_rad + W/τ_E keeps P_α below the losses by P_aux + P_Ω. τ_E is evaluated at
 *    the loss power including the external heating (power degradation), so the test is
 *    conservative. The state (ctx.ignited) is the 'ignited' diagnostic, which the report's ignition
 *    time follows, the same definition as the 0D model.
 *  - Ignition test (heating.autoOff): at Q ≥ 5 the external heating ramps down linearly within
 *    heating.rampTime (control/actuators.ts); the plasma ignites if P_α sustains it, else it dies out.
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { CheckpointRecord } from '../checkpoint';
import type { EventModel } from './EventModel';

export class BurnEvents implements EventModel {
  readonly id = 'burn';
  private burning = false;

  afterStep(ctx: ProfileContext, t: number, _st: unknown, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const P_loss_total = d.P_rad + d.P_cond;
    const ignOn = d.P_alpha >= P_loss_total && d.P_fus > 1;
    const ignOff = d.P_alpha < 0.9 * P_loss_total;
    if (ignOn && !ctx.ignited) { ctx.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${d.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
    if (ignOff && ctx.ignited) { ctx.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
    // the frame of this step shows the state after the event, as in the 0D model
    ctx.lastDiag.ignited = ctx.ignited ? 1 : 0;
    if (d.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: 'Q ≥ 1 (scientific breakeven)' }); }
    if (ctx.cfg.heating.autoOff && ctx.tAuxOff === Infinity && d.Q >= 5) {
      ctx.tAuxOff = t;
      ev.push({ t, kind: 'info', msg: `Ignition test: Q = ${d.Q.toFixed(1)} ≥ 5 — external heating ramping off over ${ctx.cfg.heating.rampTime} s` });
    }
    if (d.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }
  }

  /** The ignition state and the ignition-test time live in the context (contextCheckpoint) */
  save(rec: CheckpointRecord): void { rec.burning = +this.burning; }
  restore(rec: Readonly<CheckpointRecord>): void { this.burning = !!rec.burning; }
}
