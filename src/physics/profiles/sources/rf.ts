/**
 * Radio-frequency heating: ion cyclotron (ICRH, on axis, split between ions and electrons by
 * heating.f_ICRH_ion) and electron cyclotron (ECRH at ρ = ecrhRho) with electron cyclotron current
 * drive. Gaussian deposition profiles normalised to Σ p ΔV = 1 (APPROXIMATION: no ray or full-wave
 * tracing). ECCD: I_CD = γ P/(n̄₂₀ R0) with γ = eccdEff × the deposition-weighted T_e/10 keV,
 * capped at 0.5 (APPROXIMATION).
 */
import type { ProfileContext, StepConstants } from '../context';
import type { TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';
import { gaussianDeposition } from './deposition';
import { cdDensity20, cdTeFactor } from './current';
import type { SourceModel } from './SourceModel';

export class RfSource implements SourceModel {
  readonly id = 'rf';
  /** normalised deposition profiles of ECRH and ICRH on the current geometry [1/m³] */
  private depEC!: Float64Array;
  private depIC!: Float64Array;

  geometryChanged(ctx: ProfileContext, tg: TransportGeometry): void {
    this.depEC = gaussianDeposition(tg, ctx.ps.ecrhRho, ctx.ps.ecrhWidth);
    this.depIC = gaussianDeposition(tg, 0, ctx.ps.icrhWidth);
  }

  prepare(ctx: ProfileContext, _t: number, _st: ProfileState, K: StepConstants): void {
    const w = ctx.w, N = ctx.N, c = ctx.cfg;
    const { P_IC, P_EC } = K;
    for (let i = 0; i < N; i++) {
      w.PicE[i] = P_IC * this.depIC[i] * (1 - c.heating.f_ICRH_ion);
      w.PicI[i] = P_IC * this.depIC[i] * c.heating.f_ICRH_ion;
      w.PecE[i] = P_EC * this.depEC[i];
    }
  }

  current(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const w = ctx.w, g = ctx.tg, N = ctx.N;
    if (!(ctx.ps.eccdEff > 0 && K.P_EC > 0)) return;
    const nbar20 = cdDensity20(ctx, st.ne);
    let Tw = 0; for (let i = 0; i < N; i++) Tw += this.depEC[i] * g.dV[i] * cdTeFactor(st.Te, i);
    const Icd = (Math.min(ctx.ps.eccdEff * Tw, 0.5) * K.P_EC) / (nbar20 * g.R0);
    for (let i = 0; i < N; i++) w.jcdB[i] += Icd * this.depEC[i] * 2 * Math.PI * g.RgeoC[i] * g.B0;
  }
}
