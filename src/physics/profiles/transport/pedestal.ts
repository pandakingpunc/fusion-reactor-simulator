/**
 * H-mode edge transport barrier (ETB). Inside the pedestal (ρ > 1 − pedestalWidth, tanh step of
 * width 0.01) turbulence is suppressed, χ → etbFactor·χ. If the pedestal pressure gradient
 * exceeds the kinetic-ballooning limit (α_ped/α_crit > 1) the inter-ELM transport rises steeply
 * (×(α/α_crit)⁶, at most ×30): the EPED picture, where the gradient is clamped by the KBM and the
 * height is reset by ELMs at the peeling–ballooning limit (Snyder et al., Phys. Plasmas 16
 * (2009) 056118).
 *
 * With `ProfileSettings.pedestalModel = 'eped1'` the barrier is that of the EPED1-type pedestal (pedestal/PedestalModel.ts): its width is
 * the KBM width mapped to ρ̂, its depth adapts to hold the pedestal-top pressure at the peeling–ballooning limit.
 */
import type { ProfileContext } from '../context';

/** Factor multiplying the anomalous χ at ρ in H-mode (the caller applies it only in H-mode) */
export function barrierFactor(ctx: ProfileContext, rho: number): number {
  if (ctx.ped) return ctx.ped.barrierFactor(rho);
  const ps = ctx.ps;
  const rhoPed = 1 - ps.pedestalWidth;
  const wgt = 0.5 * (1 + Math.tanh((rho - rhoPed) / 0.01));
  const kbm = ctx.alphaRatio > 1 ? Math.min(Math.pow(ctx.alphaRatio, 6), 30) : 1;
  return 1 - wgt * (1 - ps.etbFactor * kbm);
}
