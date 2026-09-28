/**
 * Thermonuclear fusion source: reaction rates of all channels of the fuel (reactivity.ts),
 * charged, neutron and total power densities, fuel burn-up rates, plus the beam-target rate from
 * the NBI source (K.btR, w.Pbt). The charged products heat locally and instantaneously
 * (APPROXIMATION: no fast-particle slowing-down transport), split between ions and electrons by
 * the Stix critical energy (heating.ts); for p-¹¹B the charged energy is shared by the three α.
 */
import { FUEL_CHANNELS } from '../../reactivity';
import { criticalEnergy, ionHeatingFraction } from '../../heating';
import type { ProfileContext, StepConstants } from '../context';
import type { ProfileState } from '../state';
import type { SourceModel } from './SourceModel';

export class FusionSource implements SourceModel {
  readonly id = 'fusion';

  heat(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const w = ctx.w, N = ctx.N, c = ctx.cfg;
    const { Te, Ti } = st;
    const chans = FUEL_CHANNELS[c.fuel];
    const E_ch_keV = (chans[0].Echarged_MeV * 1000) / (c.fuel === 'pB11' ? 3 : 1);
    for (let i = 0; i < N; i++) {
      const Tiv = Math.max(Ti[i], 0.01), Tev = Math.max(Te[i], 0.01);
      let R = 0, P = 0, Pc = 0, Pn = 0, Nn = 0, bA = 0, bB = 0;
      for (const ch of chans) {
        const sv = ch.sigmav(Tiv);
        const r = (ch.sameSpecies ? 0.5 * w.na[i] * w.na[i] : w.na[i] * w.nb[i]) * sv;
        R += r;
        P += r * ch.Etot_MeV * 1.602176634e-13;
        Pc += r * ch.Echarged_MeV * 1.602176634e-13;
        Pn += r * ch.Eneutron_MeV * 1.602176634e-13;
        if (ch.Eneutron_MeV > 0) Nn += r;
        if (ch.sameSpecies) bA += 2 * r; else { bA += r; bB += r; }
      }
      // beam-target contribution
      const rbt = K.btR[i];
      if (rbt > 0) {
        R += rbt; P += w.Pbt[i];
        const fc = chans[0].Echarged_MeV / chans[0].Etot_MeV;
        Pc += w.Pbt[i] * fc; Pn += w.Pbt[i] * (1 - fc);
        if (chans[0].Eneutron_MeV > 0) Nn += rbt;
        bA += rbt; if (!chans[0].sameSpecies) bB += rbt;
      }
      w.Rfus[i] = R; w.Pfus[i] = P; w.Pchg[i] = Pc; w.Pneut[i] = Pn; w.Nfus[i] = Nn; w.burnA[i] = bA; w.burnB[i] = bB;
      // charged-product heating (instantaneous, local), Stix split
      const Ec = criticalEnergy(Tev, 4, w.ionSum[i]);
      const fi = ionHeatingFraction(E_ch_keV, Ec);
      w.PaE[i] = Pc * (1 - fi); w.PaI[i] = Pc * fi;
    }
  }
}
