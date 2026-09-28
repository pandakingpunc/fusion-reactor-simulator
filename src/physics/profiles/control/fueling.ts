/**
 * Density control of the 1.5D model.
 *
 *  - Fueling feedback (explicit, once per step): S_cmd = (Γ_b − S_NBI + k_p V (n̄_target − n̄))/η
 *    with k_p = 3/τ_p, limited to [0, S_max], followed by the actuator lag of the fueling method
 *    (1 − e^{−Δt/τ_delay}). Fusion burn does not change the electron count (D + T → He²⁺ + n); the
 *    dilution is in the composition. The target is the line average n̄ (the design and
 *    experimental rule; the Greenwald fraction uses n̄ too).
 *  - Deposition of the fueling by method: gas at the edge (e-folding 0.04 in ρ), pellets as a
 *    Gaussian at ρ = 1 − 0.8·depth, NBI with the beam deposition, 'mixed' half gas, half pellet;
 *    plus the NBI particle source, which is always present in 1.5D.
 *  - Separatrix density gain (gas and mixed fueling only; pellets and beams fuel the core
 *    directly): the gas puff raises n_sep; the gain follows log(n̄_target/n̄) with τ ≈ τ_p, within
 *    [0.5, 2.5] (boundary/sol.ts applies it).
 *
 * APPROXIMATION: fixed fueling efficiencies η (gas 0.3, pellet 0.5–0.95 with depth, NBI 1, mixed
 * 0.6) and delays (gas 0.25 s, pellet 30 ms, NBI 50 ms, mixed 0.12 s).
 */
import type { ProfileContext, StepConstants } from '../context';
import { edgeDeposition, gaussianDeposition, volumeIntegral } from '../sources/deposition';
import type { ProfileState } from '../state';
import { nTarget } from './actuators';

export class FuelingControl {
  /** normalised deposition profiles of gas puff and pellets on the current geometry [1/m³] */
  private depGas!: Float64Array;
  private depPel!: Float64Array;

  constructor(ctx: ProfileContext) {
    ctx.onGeometry((tg) => {
      this.depGas = edgeDeposition(tg, 0.04);
      const depth = Math.min(Math.max(ctx.cfg.fueling.pelletDepth, 0.05), 1);
      this.depPel = gaussianDeposition(tg, 1 - 0.8 * depth, 0.1);
    });
  }

  /** Fraction of the injected particles that reach the confined plasma */
  static efficiency(ctx: ProfileContext): number {
    switch (ctx.cfg.fueling.method) { case 'gas': return 0.3; case 'pellet': return 0.5 + 0.45 * Math.min(1, ctx.cfg.fueling.pelletDepth); case 'nbi': return 1.0; default: return 0.6; }
  }
  /** Actuator delay of the fueling method [s] */
  static delay(ctx: ProfileContext): number {
    switch (ctx.cfg.fueling.method) { case 'gas': return 0.25; case 'pellet': return 0.03; case 'nbi': return 0.05; default: return 0.12; }
  }

  /**
   * Fueling command and particle source of the step from t to t + dt: sets the lagged fueling
   * scalar of the new state st from the old state o and writes w.Sn (the NBI deposition of K
   * must be current).
   */
  particleSource(ctx: ProfileContext, t: number, dt: number, o: ProfileState, st: ProfileState, K: StepConstants): void {
    const c = ctx.cfg, w = ctx.w, g = ctx.tg, N = ctx.N, s = st.s;
    const tauE = Math.max(ctx.lastDiag.tauE ?? 1, 0.01);
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauE, 0.05);
    const eff = FuelingControl.efficiency(ctx);
    const Smax = ctx.ctrl.fuelRate_1e20s * 1e20;
    const S_nbi = K.S_nbi;
    let S_cmd = 0;
    if (ctx.phase === 'normal') {
      const kp = 3 / tau_p;
      const nbar = ctx.lineAvg(o.ne);
      S_cmd = Math.max(0, Math.min(Smax, (Math.max(ctx.GammaB, 0) - S_nbi + kp * g.volume * (nTarget(ctx, t) - nbar)) / eff));
    }
    const lag = 1 - Math.exp(-dt / FuelingControl.delay(ctx));
    s.Sfuel = o.s.Sfuel + (S_cmd - o.s.Sfuel) * lag;
    const Sfuel = s.Sfuel * eff; // entering the plasma [1/s]
    const absorbed = Math.max(volumeIntegral(g, w.nbiDep), 1e-6);
    for (let i = 0; i < N; i++) {
      let sh: number;
      switch (c.fueling.method) {
        case 'gas': sh = this.depGas[i]; break;
        case 'pellet': sh = this.depPel[i]; break;
        case 'nbi': sh = w.nbiDep[i] > 0 ? w.nbiDep[i] / absorbed : this.depGas[i]; break;
        default: sh = 0.5 * (this.depGas[i] + this.depPel[i]);
      }
      w.Sn[i] = Sfuel * sh + w.nbiPart[i];
    }
  }

  /** Separatrix density gain after an accepted step to t + dt (nbar: line average of the new state) */
  updateSeparatrixGain(ctx: ProfileContext, t: number, dt: number, nbar: number, tauT: number): void {
    const c = ctx.cfg;
    if (!(ctx.phase === 'normal' && (c.fueling.method === 'gas' || c.fueling.method === 'mixed'))) return;
    const tauN = Math.max(c.transport.tau_p_over_tau_E * tauT, 0.1);
    const e = Math.log(nTarget(ctx, t + dt) / Math.max(nbar, 1e15));
    ctx.nsepGain = Math.min(Math.max(ctx.nsepGain * Math.exp(Math.max(-0.2, Math.min(0.2, (dt / tauN) * e))), 0.5), 2.5);
  }
}
