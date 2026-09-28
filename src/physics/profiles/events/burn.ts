/**
 * Burn milestones: ignition (P_α ≥ P_loss = P_rad + P_cond with Q ≥ 5, lost below 0.9 P_loss or
 * Q < 4) and scientific breakeven (Q ≥ 1, ended below 1).
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { CheckpointRecord } from '../checkpoint';
import type { EventModel } from './EventModel';

export class BurnEvents implements EventModel {
  readonly id = 'burn';
  private ignited = false;
  private burning = false;

  afterStep(_ctx: ProfileContext, t: number, _st: unknown, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const P_loss_total = d.P_rad + d.P_cond;
    const ignOn = d.P_alpha >= P_loss_total && d.P_fus > 1 && d.Q >= 5;
    const ignOff = d.P_alpha < 0.9 * P_loss_total || d.Q < 4;
    if (ignOn && !this.ignited) { this.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${d.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
    if (ignOff && this.ignited) { this.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
    if (d.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: 'Q ≥ 1 (scientific breakeven)' }); }
    if (d.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }
  }

  save(rec: CheckpointRecord): void { rec.ignited = +this.ignited; rec.burning = +this.burning; }
  restore(rec: Readonly<CheckpointRecord>): void { this.ignited = !!rec.ignited; this.burning = !!rec.burning; }
}
