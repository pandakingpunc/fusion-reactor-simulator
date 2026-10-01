/**
 * Source set of the 1.5D model and the assembly of the heat-equation source terms.
 */
import { KEV, ProfileContext } from '../context';
import { EccdSource } from '../cd/eccdSource';
import { NbcdSource } from '../cd/nbcd';
import { FastIonSource } from '../fastions/source';
import { ExchangeSource } from './exchange';
import { FusionSource } from './fusion';
import { NbiSource } from './nbi';
import { RadiationSource } from './radiation';
import { RfSource } from './rf';
import type { SourceModel } from './SourceModel';

export type { SourceModel } from './SourceModel';

/**
 * The standard sources, in evaluation order. With the context of a shot whose ProfileSettings.fastIonModel is 'profile' the fast-ion source
 * (fastions/source.ts) follows the fusion source; with cdModel 'physics' the beam-driven current (cd/nbcd.ts) follows the NBI source and the
 * ECCD source (cd/eccdSource.ts) the RF source.
 */
export function defaultSources(ctx?: ProfileContext): SourceModel[] {
  const nbi = new NbiSource(ctx);
  const list: SourceModel[] = [nbi];
  // cdModel 'physics': the beam-driven current of cd/nbcd.ts after the NBI source, the ECRH deposition and current of cd/eccd.ts after the RF source
  if (ctx?.cdParts) list.push(new NbcdSource(nbi, ctx.cdParts));
  list.push(new RfSource(ctx));
  if (ctx?.cdParts) list.push(new EccdSource(ctx.cdParts));
  list.push(new FusionSource());
  if (ctx?.fast) list.push(new FastIonSource(ctx));
  list.push(new RadiationSource(), new ExchangeSource());
  return list;
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
