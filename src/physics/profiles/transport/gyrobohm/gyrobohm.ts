/**
 * Mixed Bohm/gyro-Bohm transport ('bgb'): the predictive JETTO closure of Erba et al. (Plasma Phys. Control. Fusion 39 (1997) 261;
 * Nucl. Fusion 38 (1998) 1013) with its published coefficients (formula.ts); nothing is fitted here.
 *
 * Adaptations to the 1.5D model:
 *  - the Bohm term is non-local: Λ = [T_e(0.8) − T_e(edge)]/T_e(edge) multiplies the transport at every radius. A dependence on two
 *    cells far apart is not what the block-tridiagonal Jacobian of the Newton solve (solver/newtonStage.ts) can represent, so Λ is
 *    evaluated on the OLD state of the step (`prepare`) and held over it, a lag of first order in the step like C_χ and P_SOL;
 *  - the edge of the model is the separatrix (x = 1: the boundary value T_sep) in L-mode, where the model was validated, and the top of
 *    the pedestal (ρ = 1 − ctx.pedWidth: pedestalWidth, or the width of the EPED1-type pedestal) in H-mode: the edge transport barrier
 *    is imposed on the anomalous χ by transport/pedestal.ts, and the model is the core transport that ends at it, as in the H-mode
 *    simulations that set the boundary of the model at the pedestal top. With the separatrix as the reference the ratio of the
 *    temperature at r/a = 0.8 to the 0.1 keV at the separatrix would put Λ at 40 in an ITER H-mode and the Bohm χ at 30 m²/s. (An
 *    ASSUMPTION, stated in the report: the paper's H-mode treatment is not in the open text; the gyro-Bohm term and the L-mode are
 *    unaffected.);
 *  - x = r/a is the grid label ρ̂, ∂/∂r = ⟨|∇ρ̂|⟩ ∂/∂ρ̂, T_e/(eB) and ρ* at the field on the axis, Z_i = 1, m_i the mean fuel mass;
 *  - the particle diffusivity of the original is not used (the 1.5D model has D/χ_e).
 */
import { AMU, KEV, type ProfileContext } from '../../context';
import { faceValue, interpCells } from '../../geometry1d';
import type { ProfileState } from '../../state';
import type { TransportModel } from '../TransportModel';
import { BGB, bgbChi, nonLocalFactor, rhoStar } from './formula';

export class BohmGyroBohmTransport implements TransportModel {
  readonly id = 'bgb';
  readonly predictive = true;
  /** Newton does not pay here (ITER15 400 s: 23 s against 13 s; JET15 22 s against 6.5 s; the same flat-top numbers to 3·10⁻³): 'auto' takes 'pc' */
  readonly preferredSolver = 'pc' as const;
  /** the non-local factor Λ of the old state of the step */
  private lambda = 0;
  private prepared = false;

  prepare(ctx: ProfileContext, _t: number, st: ProfileState): void {
    const g = ctx.tg;
    const inner = interpCells(g, st.Te, BGB.xInner);
    const edge = ctx.hmode ? interpCells(g, st.Te, 1 - ctx.pedWidth) : ctx.bc.Te;
    this.lambda = nonLocalFactor(inner, edge);
    this.prepared = true;
  }

  /** Λ of the last `prepare` (diagnostics, tests) */
  get nonLocal(): number { return this.lambda; }

  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void {
    const g = ctx.tg, w = ctx.w, N = ctx.N, bc = ctx.bc;
    const { Te, ne } = st;
    if (!this.prepared) this.prepare(ctx, 0, st);
    const B = g.B0, a = g.a, mi = ctx.M * AMU;
    for (let f = 1; f <= N; f++) {
      let Tef: number, dlnT: number, dlnP: number;
      if (f < N) {
        Tef = faceValue(g, Te, f);
        dlnT = Math.log(Math.max(Te[f], 1e-3) / Math.max(Te[f - 1], 1e-3)) / g.distF[f];
        dlnP = (Math.log(Math.max(ne[f] * Te[f], 1e-3)) - Math.log(Math.max(ne[f - 1] * Te[f - 1], 1e-3))) / g.distF[f];
      } else {
        // the separatrix face: the last cell and the boundary value, half a cell apart
        Tef = 0.5 * (Te[N - 1] + bc.Te);
        dlnT = Math.log(Math.max(bc.Te, 1e-3) / Math.max(Te[N - 1], 1e-3)) / g.distF[N];
        dlnP = (Math.log(Math.max(bc.n * bc.Te, 1e-3)) - Math.log(Math.max(ne[N - 1] * Te[N - 1], 1e-3))) / g.distF[N];
      }
      Tef = Math.max(Tef, 0.01);
      // a |∇X|/X = a ⟨|∇ρ̂|⟩ |∂ ln X/∂ρ̂|
      const scale = a * g.gradRhoF[f];
      const r = bgbChi({
        TeKeV: Tef, B, a, invLp: scale * dlnP, invLT: scale * dlnT, q: w.qF[f], lambda: this.lambda, rhoStar: rhoStar(Tef * KEV, mi, B, a),
      });
      chiE[f] = r.chiE;
      chiI[f] = r.chiI;
    }
    chiE[0] = chiE[1];
    chiI[0] = chiI[1];
  }
}
