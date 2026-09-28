/**
 * Thermonuclear fusion source: reaction rates of all channels of the fuel (reactivity.ts), the
 * beam-target rates of the NBI source (K.btR, per channel), charged, neutron and total power
 * densities, fuel burn-up and ash production, and the heating by the charged products.
 *
 *  - Thermal rate of a channel: pairDensity × ⟨σv⟩(T_i) — ½ n_D² in an a + a channel (n_D = n_a + n_b
 *    in D-D fuel, whatever the split between the two slots), n_a n_b in an a + b channel.
 *  - Burn-up: burnPerReaction per channel (an a + b channel consumes one a and one b, an a + a
 *    channel two ions of species a — the D-D side channels of D-³He among them); the ash of a
 *    reaction is FuelChannel.ash (⁴He: D-T and D-³He 1, p-¹¹B 3, D-D branches ½).
 *  - Charged-product heating: every charged product of every channel (FUEL_CHANNELS[fuel][j].products:
 *    α, p, T, ³He with their birth energies) slows down on its own Stix critical energy
 *    E_c = 14.8 T_e A_f (Σ n_j Z_j²/(n_e A_j))^{2/3} and gives the fraction G(E_0/E_c) of its energy
 *    to the ions (heating.ts), the rest to the electrons. APPROXIMATION: instantaneous and local
 *    (no fast-particle transport, no loss of fast ions).
 *  - Fast-product energy content of the steady slowing-down distributions, W_α,ss = Σ P_k τ_W,k
 *    (w.Walpha) and the birth-power-weighted mean τ_W (w.tauWa), τ_W = τ_se (1 − G)/2 (Stix). The
 *    energy content that enters β is the pool that relaxes towards W_α,ss with τ_W (fastIons.ts),
 *    as in the 0D model: the steady value is reached only after a few τ_W.
 */
import { FUEL_CHANNELS, burnPerReaction, pairDensity } from '../../reactivity';
import { criticalEnergy, ionHeatingFraction, spitzerSlowingDownTime } from '../../heating';
import { KEV, ProfileContext, StepConstants } from '../context';
import type { ProfileState } from '../state';
import type { SourceModel } from './SourceModel';

/** J per MeV */
const MEV = 1e3 * KEV;

export class FusionSource implements SourceModel {
  readonly id = 'fusion';

  heat(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const w = ctx.w, N = ctx.N, fuel = ctx.cfg.fuel;
    const { Te, Ti, ne } = st;
    const chans = FUEL_CHANNELS[fuel];
    for (let i = 0; i < N; i++) {
      const Tiv = Math.max(Ti[i], 0.01), Tev = Math.max(Te[i], 0.01);
      const na = w.na[i], nb = w.nb[i];
      let R = 0, P = 0, Pc = 0, Pn = 0, Nn = 0, bA = 0, bB = 0, ash = 0, PaE = 0, PaI = 0, Wa = 0, Pp = 0, tauSum = 0, nProd = 0;
      for (let j = 0; j < chans.length; j++) {
        const ch = chans[j];
        // thermal + beam-target rate of the channel [m⁻³ s⁻¹]
        const r = pairDensity(fuel, ch, na, nb) * ch.sigmav(Tiv) + K.btR[j][i];
        R += r;
        P += r * ch.Etot_MeV * MEV;
        Pc += r * ch.Echarged_MeV * MEV;
        Pn += r * ch.Eneutron_MeV * MEV;
        if (ch.Eneutron_MeV > 0) Nn += r;
        const [ba, bb] = burnPerReaction(fuel, ch, na, nb);
        bA += r * ba; bB += r * bb;
        ash += r * ch.ash;
        // charged products: Stix split and energy content, per product; τ_W of every product also without
        // reactions (the fast-ion pool relaxes with it when the burn stops, fastIons.ts)
        for (const pr of ch.products) {
          const pk = r * pr.E_MeV * MEV;
          const G = ionHeatingFraction(pr.E_MeV * 1e3, criticalEnergy(Tev, pr.A, w.ionSum[i]));
          const tauW = Math.max(0.5 * spitzerSlowingDownTime(Tev, ne[i], pr.A, pr.Z) * (1 - G), 1e-3);
          tauSum += tauW; nProd++;
          if (!(pk > 0)) continue;
          PaI += pk * G; PaE += pk * (1 - G);
          Wa += pk * tauW; Pp += pk;
        }
      }
      w.Rfus[i] = R; w.Pfus[i] = P; w.Pchg[i] = Pc; w.Pneut[i] = Pn; w.Nfus[i] = Nn; w.burnA[i] = bA; w.burnB[i] = bB; w.ash[i] = ash;
      w.PaE[i] = PaE; w.PaI[i] = PaI; w.Walpha[i] = Wa;
      // birth-power-weighted mean τ_W of the products (equal weights without reactions: heating.fastPoolMix)
      w.tauWa[i] = Pp > 0 ? Wa / Pp : tauSum / Math.max(nProd, 1);
    }
  }
}
