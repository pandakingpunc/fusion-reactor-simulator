/**
 * Source set of the 1.5D model and the assembly of the heat-equation source terms.
 */
import { KEV, ProfileContext } from '../context';
import { ExchangeSource } from './exchange';
import { FusionSource } from './fusion';
import { NbiSource } from './nbi';
import { RadiationSource } from './radiation';
import { RfSource } from './rf';
import type { SourceModel } from './SourceModel';

export type { SourceModel } from './SourceModel';

/** The standard sources, in evaluation order */
export function defaultSources(): SourceModel[] {
  return [new NbiSource(), new RfSource(), new FusionSource(), new RadiationSource(), new ExchangeSource()];
}

/**
 * Heat-equation source terms [keV m⁻³ s⁻¹] from the power densities of the sources:
 * Q_e = P_NBI,e + P_IC,e + P_EC + P_α,e + P_Ω − P_rad, Q_i = P_NBI,i + P_IC,i + P_α,i, and the
 * implicit radiation linearisation L_e = ∂P_rad/∂T_e (L_i = 0). A new heating or loss channel adds
 * its work array here.
 */
export function assembleHeatSources(ctx: ProfileContext): void {
  const w = ctx.w, N = ctx.N;
  for (let i = 0; i < N; i++) {
    const Pe = w.PnbiE[i] + w.PicE[i] + w.PecE[i] + w.PaE[i] + w.Poh[i] - w.Prad[i];
    const Pi = w.PnbiI[i] + w.PicI[i] + w.PaI[i];
    w.Qe[i] = Pe / KEV;
    w.Qi[i] = Pi / KEV;
    w.Le[i] = w.dPrad[i] / KEV; w.Li[i] = 0;
  }
}
