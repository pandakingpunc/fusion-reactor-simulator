/**
 * L–H and H–L transitions: H-mode when the loss power P_L = P_heat − P_rad,core − dW/dt (the one of
 * the τ_E scaling, control/confinement.ts) exceeds the L–H threshold (Martin et al., J. Phys.: Conf.
 * Ser. 123 (2008) 012033 with the low-density branch of Ryter et al., Nucl. Fusion 54 (2014) 083003;
 * P_LH in the diagnostics), back to L-mode below 0.7 P_LH (hysteresis). No transition in the first
 * 50 ms. The mode switches the edge transport barrier (transport/pedestal.ts) and the confinement
 * scaling (control/confinement.ts).
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { EventModel } from './EventModel';

export class LHTransition implements EventModel {
  readonly id = 'LH';

  afterStep(ctx: ProfileContext, t: number, _st: unknown, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const P_L = d.P_loss;
    if (!ctx.hmode && P_L > d.P_LH && t > 0.05) {
      ctx.hmode = true; ev.push({ t, kind: 'LH', msg: `L→H transition: P_loss ${P_L.toFixed(1)} MW > P_LH ${d.P_LH.toFixed(1)} MW — edge transport barrier forms` });
    } else if (ctx.hmode && P_L < 0.7 * d.P_LH) {
      ctx.hmode = false; ev.push({ t, kind: 'HL', msg: `H→L back-transition: P_loss ${P_L.toFixed(1)} MW < 0.7·P_LH ${(0.7 * d.P_LH).toFixed(1)} MW — pedestal lost` });
    }
  }
}
