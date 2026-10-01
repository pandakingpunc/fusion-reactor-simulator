/**
 * Sawtooth crashes. Trigger: magnetic shear at q = 1 above sawtoothShear (the simplified shear form
 * of the trigger of Porcelli, Boucher & Rosenbluth, Plasma Phys. Control. Fusion 38 (1996) 2163),
 * with ρ(q=1) in (0.05, 0.8) and at least 50 ms since the last crash; or, with ProfileSettings.sawtoothTrigger
 * 'porcelli', the three conditions of that paper (events/porcelli.ts). Crash: Kadomtsev full
 * reconnection (Kadomtsev, Sov. J. Plasma Phys. 1 (1975) 389): n_e, T_e and T_i are flattened
 * inside the mixing radius conserving the particles and the electron and ion thermal energy
 * exactly (Σ n_e ΔV, Σ n_e T_e ΔV and Σ n_i T_i ΔV, with n_i of the composition before and after the
 * crash), and q is raised to ≥ 1.01 by rebuilding ψ inward from ρ_mix; with sawtoothReconnection
 * 'kadomtsev' the poloidal flux is reset by the reconnection of the surfaces of equal helical flux
 * ψ* = ψ − Φ/2π, volume conserved (events/kadomtsev.ts), which leaves q > 1 in the mixed region with
 * q → 1 on the axis. A crash may seed NTM islands (events/ntm.ts).
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { recNum, type CheckpointRecord } from '../checkpoint';
import { composition } from '../composition';
import { cellIndex } from '../geometry1d';
import { flattenConserving, kadomtsevMixingRadius, rhoOfQ, shearAt } from '../mhd';
import { currentProfiles } from '../qprofile';
import { seedIslands } from './ntm';
import type { EventModel, EventTrigger } from './EventModel';
import { CRASH_RESTART_DT } from './elm';
import { kadomtsevReset } from './kadomtsev';
import { marginOfTerms, porcelliMargin, porcelliTerms } from './porcelli';
import { READY_MARGIN, sawtoothMargin, triggerScratch } from './triggers';
import type { TriggerScratch } from './EventModel';

/** Minimum time between two crashes [s] */
const SAWTOOTH_REFRACTORY = 0.05;

export class SawtoothEvents implements EventModel {
  readonly id = 'sawtooth';
  private lastSaw = -1e9;

  readonly trigger: EventTrigger = {
    readyAt: () => this.lastSaw + SAWTOOTH_REFRACTORY + READY_MARGIN,
    margin: (ctx, st, sc) => (ctx.ps.sawtoothTrigger === 'porcelli' ? porcelliMargin(ctx, st, sc) : sawtoothMargin(ctx, st, sc)),
  };
  /** the scratch and the composition ratio of the Porcelli trigger's evaluation on the state of a step (allocated on first use) */
  private scratch: TriggerScratch | null = null;
  private rat: Float64Array | null = null;

  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const c = ctx.cfg, g = ctx.tg, w = ctx.w, v = st;
    if (!(c.events.sawteeth && t - this.lastSaw > SAWTOOTH_REFRACTORY)) return;
    let qF: Float64Array = w.qF;
    let r1: number, s1: number, why = '';
    if (ctx.ps.sawtoothTrigger === 'porcelli') {
      // the three conditions of Porcelli et al. on the state of the step, with the q profile of its flux (the margin the stepper localised)
      const N = ctx.N;
      const sc = (this.scratch ??= triggerScratch(N));
      const rat = (this.rat ??= new Float64Array(N));
      for (let i = 0; i < N; i++) rat[i] = w.ni[i] / Math.max(v.ne[i], 1);
      const terms = porcelliTerms(ctx, { Te: v.Te, Ti: v.Ti, ne: v.ne, psi: v.psi, niOverNe: rat, Ip: v.s.Ip }, sc);
      if (!terms || !(marginOfTerms(terms) > 0)) return;
      r1 = terms.rho1; s1 = terms.s1; qF = sc.qF;
      why = `Porcelli ${terms.eq13 ? '13' : ''}${terms.eq14 ? '14' : ''}${terms.eq15 ? '15' : ''}`;
    } else {
      r1 = rhoOfQ(g, w.qF, 1);
      if (!(r1 > 0.05 && r1 < 0.8)) return;
      s1 = shearAt(g, w.qF, r1);
      if (!(s1 > ctx.ps.sawtoothShear)) return;
    }
    let rmix = Math.min(kadomtsevMixingRadius(g, qF), 0.95);
    if (!(rmix > r1)) return;
    const Te0 = v.Te[0];
    const before = ctx.crashHook ? ctx.crashSnapshot(v) : null;
    // the flux reset of Kadomtsev's reconnection (helical flux conserved), if asked for: it also fixes the mixing radius
    let reset: ReturnType<typeof kadomtsevReset> = null;
    if (ctx.ps.sawtoothReconnection === 'kadomtsev') {
      reset = kadomtsevReset(g, qF, v.psi);
      if (reset) { rmix = reset.rhoMix; r1 = reset.rho1; }
    }
    // n_i of the state at the crash (w.ni predates the inventory update of the accepted step); then
    // particles first, and each temperature with the densities after the crash as weights and the
    // energy before it as the target
    composition(ctx, v.Te, v.ne, v.s);
    const neBefore = Float64Array.from(v.ne), niBefore = Float64Array.from(w.ni);
    flattenConserving(g, v.ne, null, r1, rmix);
    ctx.impurity?.sawtoothCrash(v, r1, rmix); // profile-resolved species: mixed like n_e (impurity/)
    flattenConserving(g, v.Te, v.ne, r1, rmix, neBefore);
    composition(ctx, v.Te, v.ne, v.s);
    flattenConserving(g, v.Ti, w.ni, r1, rmix, niBefore);
    if (!reset) {
      // q → max(q, 1.01) in the mixing region; rebuild ψ inward from ρ_mix (ψ' of the state of the step: the work arrays' own, or, for the Porcelli trigger, the scratch's)
      const dpsi = qF === w.qF ? w.dpsiF : this.scratch!.dpsiF;
      const iMix = cellIndex(g, rmix);
      for (let f = 1; f <= iMix; f++) {
        if (qF[f] < 1.01) dpsi[f] = (g.PhiB * g.rhoF[f]) / (Math.PI * 1.01);
      }
      for (let i = iMix - 1; i >= 0; i--) v.psi[i] = v.psi[i + 1] - dpsi[i + 1] * g.distF[i + 1];
    }
    currentProfiles(ctx, v.psi, v.s.Ip);
    if (before) ctx.crashHook!('sawtooth', t, before, ctx.crashSnapshot(v));
    this.lastSaw = t;
    ctx.dt = Math.min(ctx.dt, CRASH_RESTART_DT);
    ctx.diagStale = true;
    ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash (s₁ = ${s1.toFixed(2)}${why ? `, ${why}` : ''}): ρ(q=1) = ${r1.toFixed(2)}, ρ_mix = ${rmix.toFixed(2)}, T_e0 ${Te0.toFixed(1)} → ${v.Te[0].toFixed(1)} keV${reset ? `, q0 → ${ctx.w.qF[0].toFixed(2)}` : ''}`, value: (Te0 - v.Te[0]) / Te0 });
    if (c.events.ntm) seedIslands(ctx, v, d);
  }

  save(rec: CheckpointRecord): void { rec.lastSaw = this.lastSaw; }
  restore(rec: Readonly<CheckpointRecord>): void { this.lastSaw = recNum(rec, 'lastSaw', -1e9); }
}
