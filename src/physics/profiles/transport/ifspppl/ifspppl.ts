/**
 * IFS-PPPL ITG transport ('ifspppl'): the predictive closure whose critical gradient and stiffness are the published fit of
 * Kotschenreuther, Dorland, Beer and Hammett (Phys. Plasmas 2 (1995) 2381; formula.ts) in place of the constants of 'cgm'
 * (κ_c = 4.5, a q^3/2 gyro-Bohm amplitude, a 0.05 m²/s floor). χ_i and χ_e follow from the local T_i, T_e, n_e, q, ŝ, ε, ν and Z_eff
 * on every face; nothing is tuned to a machine.
 *
 *   χ_i = C0 max(χ_i^(1), χ_i^(2)) ρ_i² v_ti / R0,  χ_e = C0 max(χ_e^(1), χ_e^(2)) ρ_i² v_ti / R0   (formula.ts)
 *
 * with ρ_i² v_ti = m_i^1/2 T_i^3/2 / (e B)² (T_i in J) at the toroidal field on the axis and the major radius R0. Below the critical
 * gradient the ITG χ is zero: the transport is the neoclassical ion floor and the numerical floor of coefficients.ts (and the barrier
 * of the H-mode edge multiplies this χ like that of any model), so the core profiles settle just above R/L_Tcrit.
 *
 * Adaptations to the 1.5D model, and what is not modelled:
 *  - the magnetic shear ŝ = ρ d ln q/dρ needs a second derivative of ψ; it is taken from the q profile of the OLD state of the step
 *    (`prepare`) and held over it, so that the row of a cell of the Newton residual keeps depending on that cell and its two
 *    neighbours only (the block-tridiagonal Jacobian of solver/newtonStage.ts). The lag is the shear's own, a current-diffusion time;
 *  - the grid label ρ̂ = √(Φ/Φ_b) stands for r/a, ∂/∂r = ⟨|∇ρ̂|⟩ ∂/∂ρ̂, ε = (R_out − R_in)/(R_out + R_in) of the flux surface;
 *  - the fit is clamped to its domain of validity (formula.ts: q, ŝ, R/L_n, T_i/T_e, Z_eff, ν), the beam charge fraction σ_b is neglected
 *    and the fit is used across the whole minor radius, although the paper predicts r/a < 0.8 and finds the formula below the
 *    measured χ in the outer 10-20 %: L-mode edge temperatures come out too high, in H-mode the pedestal is the barrier's.
 * The fit was made for D-T-like hydrogenic plasmas with carbon or beam dilution; a seeded or heavy impurity enters only through Z_eff.
 */
import { AMU, KEV, type ProfileContext } from '../../context';
import { faceValue } from '../../geometry1d';
import type { ProfileState } from '../../state';
import type { TransportModel } from '../TransportModel';
import { ifsChi } from './formula';

const E_CHARGE = 1.602176634e-19;

export class IfsPpplTransport implements TransportModel {
  readonly id = 'ifspppl';
  readonly predictive = true;
  /**
   * Newton does not pay here: the fit is clamped to its domain and has a threshold and a kink in G, and a marginal L-mode profile sits on them
   * (ITER15 400 s: 200 s against 71 s, with 48 % of the Newton solves falling back to the stabilised Picard iteration; JET15 51 s against 39 s;
   * the flat-top numbers agree to 3·10⁻³): 'auto' takes 'pc'
   */
  readonly preferredSolver = 'pc' as const;
  /** |ŝ| on the faces from the q profile of the old state of the step (faces 0 … N) */
  private shear = new Float64Array(0);

  /** |ŝ| on the faces of the last `prepare` (tests, diagnostics) */
  get shearOfStep(): Float64Array { return this.shear; }

  prepare(ctx: ProfileContext, _t: number, _st: ProfileState): void {
    const g = ctx.tg, N = ctx.N, q = ctx.w.qF;
    if (this.shear.length !== N + 1) this.shear = new Float64Array(N + 1);
    for (let f = 0; f <= N; f++) {
      const lo = f > 0 ? f - 1 : 0, hi = f < N ? f + 1 : N;
      const dr = g.rhoF[hi] - g.rhoF[lo];
      this.shear[f] = dr > 0 ? Math.abs((g.rhoF[f] * (q[hi] - q[lo])) / dr / Math.max(q[f], 1e-3)) : 0;
    }
  }

  diffusivities(ctx: ProfileContext, st: ProfileState, chiE: Float64Array, chiI: Float64Array): void {
    const g = ctx.tg, w = ctx.w, N = ctx.N, bc = ctx.bc;
    const { Te, Ti, ne } = st;
    if (this.shear.length !== N + 1) this.prepare(ctx, 0, st);
    const R = g.R0, B = g.B0;
    // ρ_i² v_ti / R = m_i^1/2 T_i^3/2 / (e² B² R) with T_i in J
    const pref0 = Math.sqrt(ctx.M * AMU) / (E_CHARGE * E_CHARGE * B * B * R);
    for (let f = 1; f <= N; f++) {
      let Tef: number, Tif: number, nef: number, dTi: number, dn: number, Zeff: number;
      if (f < N) {
        Tef = faceValue(g, Te, f); Tif = faceValue(g, Ti, f); nef = faceValue(g, ne, f);
        dTi = (Ti[f] - Ti[f - 1]) / g.distF[f]; dn = (ne[f] - ne[f - 1]) / g.distF[f];
        Zeff = faceValue(g, w.Zeff, f);
      } else {
        // the separatrix face: the last cell and the boundary value, half a cell apart
        Tef = 0.5 * (Te[N - 1] + bc.Te); Tif = 0.5 * (Ti[N - 1] + bc.Ti); nef = 0.5 * (ne[N - 1] + bc.n);
        dTi = (bc.Ti - Ti[N - 1]) / g.distF[N]; dn = (bc.n - ne[N - 1]) / g.distF[N];
        Zeff = w.Zeff[N - 1];
      }
      Tef = Math.max(Tef, 0.01); Tif = Math.max(Tif, 0.01); nef = Math.max(nef, 1e17);
      const grad = g.gradRhoF[f];
      const r = ifsChi({
        RLT: (-R * dTi * grad) / Tif, RLn: (-R * dn * grad) / nef, q: w.qF[f], shear: this.shear[f], tau: Tif / Tef,
        eps: (g.RoutF[f] - g.RinF[f]) / (g.RoutF[f] + g.RinF[f]), nu: (2.1 * R * (nef / 1e19)) / (Math.pow(Tef, 1.5) * Math.sqrt(Tif)), Zeff,
      });
      const pref = pref0 * Math.pow(Tif * KEV, 1.5);
      chiI[f] = r.chiI * pref;
      chiE[f] = r.chiE * pref;
    }
    // the axis face carries no flux; it takes the value of the first face
    chiI[0] = chiI[1];
    chiE[0] = chiE[1];
  }
}
