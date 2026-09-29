/**
 * L–H and H–L transitions: H-mode when the loss power P_L = P_heat − P_rad,core − dW/dt (the one of
 * the τ_E scaling, control/confinement.ts) exceeds the L–H threshold (Martin et al., J. Phys.: Conf.
 * Ser. 123 (2008) 012033 with the low-density branch of Ryter et al., Nucl. Fusion 54 (2014) 083003;
 * P_LH in the diagnostics), back to L-mode below 0.7 P_LH (hysteresis). No transition in the first
 * 50 ms. The mode switches the edge transport barrier (transport/pedestal.ts) and the confinement
 * scaling (control/confinement.ts).
 *
 * Frames at a flip. A 1.5D frame carries ctx.lastDiag, which the step wrote together with its own
 * H_mode, so the frame of the flip step shows the mode the step was taken in and its τ_E, and the next
 * frame shows the new mode: a flip changes no state, takes effect with the next step, and needs no
 * refresh here (the 0D model reads its live flags in diagnostics(), and refreshes its cache at a flip:
 * MagneticModel.postStep). A refresh through ctx.diagStale would not do: it is consumed only when a
 * frame is recorded, and the kernel records no frame at a flip, so the flag would stay set until a
 * later step and make that frame carry a re-evaluation instead of the diagnostics of its own step.
 * tests: kernel/modeFlipFrames.test.ts.
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
