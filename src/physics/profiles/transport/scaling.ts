/**
 * τ_E-scaled transport ('scaling'): χ(ρ) = C_χ(t)·(1 + c ρ²) with critical-gradient stiffness in
 * the core, χ_i = (χ_i/χ_e)·χ_e. The amplitude C_χ is not a prediction: a PI controller
 * (control/confinement.ts) sets it so that the stored energy follows τ_E,scaling(P_loss)·P_loss.
 * The global dynamics is that of the validated 0D scaling, while the profile SHAPE comes from the
 * physics — source deposition, pedestal, sawteeth, bootstrap current and current diffusion (the
 * 'τ_E-scaled' approach of METIS/CRONOS: Artaud et al., Nucl. Fusion 58 (2018) 105001).
 *
 * Stiffness (structure of Garbet et al., Plasma Phys. Control. Fusion 46 (2004) 1351):
 * χ ×= 1 + stiffness·min(max((R/L_T)/critGrad − 1, 0), 5) for ρ < 0.85 (core turbulence region;
 * the edge and pedestal follow different physics).
 */
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { TransportModel } from './TransportModel';

export class ScalingTransport implements TransportModel {
  readonly id = 'scaling';
  readonly predictive = false;

  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void {
    const g = ctx.tg, N = ctx.N, ps = ctx.ps;
    const { Te, Ti } = st;
    const Cchi = Math.max(st.s.Cchi, 1e-4);
    // R/L_T = −R ∂T/∂r / T at face f (T_e and T_i; boundary value at the outer face)
    const RLT = (T: Float64Array, TB: number, f: number) => {
      if (f === 0) return 0;
      const TL = T[f - 1], TR = f < N ? T[f] : TB;
      const dist = f < N ? g.dRho : 0.5 * g.dRho;
      const Tf = Math.max(0.5 * (TL + TR), 0.01);
      return (-g.R0 * ((TR - TL) / dist) * g.gradRhoF[f]) / Tf;
    };
    const stiffF = (x: number) => 1 + ps.stiffness * Math.min(Math.max(x / ps.critGrad - 1, 0), 5);
    for (let f = 0; f <= N; f++) {
      const rho = g.rhoF[f];
      const base = Cchi * (1 + ps.chiShape * rho * rho);
      const core = rho < 0.85;
      chiE[f] = base * (core ? stiffF(RLT(Te, ctx.bc.Te, f)) : 1);
      chiI[f] = ps.chiRatio * base * (core ? stiffF(RLT(Ti, ctx.bc.Ti, f)) : 1);
    }
  }
}
