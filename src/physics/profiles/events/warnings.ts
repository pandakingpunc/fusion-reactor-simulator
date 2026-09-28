/**
 * One-time operational warnings: divertor heat flux above 10 MW/m² (material lifetime), and the
 * approach to the density (n̄/n_G > 0.85) and Troyon β (β_N > 0.85 β_N,lim) limits.
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { EventModel } from './EventModel';

export class OperationalWarnings implements EventModel {
  readonly id = 'warnings';

  afterStep(ctx: ProfileContext, t: number, _st: unknown, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const c = ctx.cfg;
    if (d.q_div > 10) ctx.warnOnce('div', t, `Divertor heat flux ${d.q_div.toFixed(0)} MW/m² > 10 MW/m² — material lifetime at risk`, ev);
    if (d.nG_frac > 0.85) ctx.warnOnce('nG', t, `n̄/n_G = ${d.nG_frac.toFixed(2)} — approaching the density limit`, ev);
    if (d.betaN > 0.85 * c.limits.betaN_limit) ctx.warnOnce('bN', t, `β_N = ${d.betaN.toFixed(2)} — approaching the Troyon limit`, ev);
  }
}
