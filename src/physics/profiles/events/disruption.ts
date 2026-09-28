/**
 * Disruptions. In the 'normal' phase an operational limit ends the discharge (first match wins):
 * Greenwald density, Troyon β_N, q95, a locked 2/1 NTM (w/a > 0.1), tungsten accumulation, or a
 * radiative collapse (P_rad > P_heat with ⟨T_e⟩ < 2 keV after 0.5 s). The plasma then goes through
 * the thermal quench (heating off, T → 5 eV with τ_TQ, n_e decays with 50 ms) and the current
 * quench (I_p decays with the L/R time τ_CQ) until I_p < 3 % of its value at the onset; the shot
 * ends with the consequences estimated by disruptionReport (disruption.ts: quench times, halo
 * current, runaway avalanche, wall load).
 *
 * The disruption state (ctx.disruption) is part of the context checkpoint.
 *
 * APPROXIMATION: τ_TQ = 1 ms (a/2 m)(1 + ½ ln(1 + I_p/5 MA)), τ_CQ = 4 ms π a² κ per m² (ITER
 * Physics Basis order of magnitude, Nucl. Fusion 39 (1999) 2251, ch. 3); the profiles are scaled,
 * not transported, during the quenches.
 */
import { disruptionReport, DisruptionCause, DISRUPTION_LABELS, DISRUPTION_FIXES } from '../../disruption';
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { composition } from '../composition';
import { quenchDiagnostics } from '../diagnostics';
import type { EventModel } from './EventModel';

export class DisruptionEvents implements EventModel {
  readonly id = 'disruption';

  /** Operational limits (normal phase): starts the thermal quench */
  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const c = ctx.cfg, g = ctx.tg, s = st.s;
    let cause: DisruptionCause = 'none', diag = '';
    if (d.nG_frac > c.limits.greenwald_limit) { cause = 'density_limit'; diag = `n̄/n_G reached ${d.nG_frac.toFixed(2)}`; }
    else if (d.betaN > c.limits.betaN_limit) { cause = 'beta_limit'; diag = `β_N ${d.betaN.toFixed(2)} > ${c.limits.betaN_limit}`; }
    else if (d.q95 < c.limits.q95_limit) { cause = 'q95_limit'; diag = `q95 = ${d.q95.toFixed(2)} < ${c.limits.q95_limit}`; }
    else if (s.w21 > 0.1 * g.a) { cause = 'ntm_locked_mode'; diag = `2/1 island w/a = ${(s.w21 / g.a).toFixed(3)} > 0.10 — mode locked to the wall`; }
    else if (d.cZ > c.limits.W_conc_limit && c.impurity.species === 'W') { cause = 'tungsten_accumulation'; diag = `c_W = ${d.cZ.toExponential(1)} > ${c.limits.W_conc_limit.toExponential(1)}`; }
    else if (d.P_rad > d.P_heat && t > 0.5 && d.Te < 2) { cause = 'radiative_collapse'; diag = `P_rad ${d.P_rad.toFixed(1)} MW > P_heat ${d.P_heat.toFixed(1)} MW, ⟨T_e⟩ fell to ${d.Te.toFixed(2)} keV`; }
    if (cause !== 'none') {
      ctx.disruption = { cause, t, W: d.W * 1e6, Ip: s.Ip, text: diag };
      ctx.phase = 'thermal_quench';
      ev.push({ t, kind: 'disruption', msg: `DISRUPTION: ${DISRUPTION_LABELS[cause]} — ${diag}` });
    }
  }

  /** Progress through the quench phases (called instead of the event models outside the normal phase) */
  quenchProgress(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const D = ctx.disruption;
    if (ctx.phase === 'thermal_quench') {
      if (d.W * 1e6 < 0.02 * D.W || t - D.t > 0.05) {
        ctx.phase = 'current_quench';
        ev.push({ t, kind: 'quench', msg: `Thermal quench complete (${((t - D.t) * 1e3).toFixed(1)} ms) → current quench starting` });
      }
    } else if (ctx.phase === 'current_quench') {
      if (st.s.Ip < 0.03 * D.Ip) {
        ctx.phase = 'ended';
        const rep = disruptionReport({ cause: D.cause, t: D.t, g: ctx.geomB, Ip_MA: D.Ip / 1e6, W_th_J: D.W, B0: ctx.cfg.B0 });
        ctx.terminated = {
          t, natural: false, reason: DISRUPTION_LABELS[D.cause],
          diagnosis: `${DISRUPTION_LABELS[D.cause]} — ${D.text}, t = ${D.t.toFixed(2)} s. Thermal quench ${rep.tau_TQ_ms.toFixed(1)} ms, current quench ${rep.tau_CQ_ms.toFixed(0)} ms; halo current I_h/I_p·TPF = ${rep.halo_TPF_product.toFixed(2)}; runaway electron avalanche e^${rep.runaway_avalanche_efolds.toFixed(0)} → ~${rep.runaway_current_MA.toFixed(1)} MA; wall deposition ${rep.wall_energy_density_MJm2.toFixed(1)} MJ/m².`,
          fix: DISRUPTION_FIXES[D.cause], disruption: rep,
        };
        ev.push({ t, kind: 'end', msg: 'Plasma extinguished' });
      }
    }
  }

  /** Time step of the quench phases: the profiles decay, the transport equations are not solved */
  quenchStep(ctx: ProfileContext, t: number, y: Float64Array, tMax: number): number {
    const v = ctx.view(y), s = v.s, N = ctx.N, g = ctx.tg;
    const tauTQ = 1e-3 * (g.a / 2.0) * (1 + 0.5 * Math.log(1 + ctx.disruption.Ip / 5e6));
    const tauCQ = 4.0e-3 * Math.PI * g.a * g.a * ctx.geomB.kappa;
    const tau = ctx.phase === 'thermal_quench' ? tauTQ : tauCQ;
    const dt = Math.min(tau / 5, tMax - t);
    const fT = Math.exp(-dt / tauTQ), fN = Math.exp(-dt / 0.05);
    for (let i = 0; i < N; i++) {
      v.Te[i] = 0.005 + (v.Te[i] - 0.005) * fT;
      v.Ti[i] = 0.005 + (v.Ti[i] - 0.005) * fT;
      v.ne[i] *= fN;
    }
    if (ctx.phase === 'current_quench') s.Ip *= Math.exp(-dt / tauCQ);
    composition(ctx, v.Te, v.ne, s);
    quenchDiagnostics(ctx, v);
    ctx.dt = dt;
    return t + dt;
  }

}
