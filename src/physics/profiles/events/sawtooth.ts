/**
 * Sawtooth crashes. Trigger: magnetic shear at q = 1 above sawtoothShear (the simplified shear form
 * of the trigger of Porcelli, Boucher & Rosenbluth, Plasma Phys. Control. Fusion 38 (1996) 2163),
 * with ρ(q=1) in (0.05, 0.8) and at least 50 ms since the last crash. Crash: Kadomtsev full
 * reconnection (Kadomtsev, Sov. J. Plasma Phys. 1 (1975) 389): T_e, T_i and n_e are flattened
 * inside the mixing radius conserving energy and particles, and q is raised to ≥ 1.01 by rebuilding
 * ψ inward from ρ_mix. A crash may seed NTM islands (events/ntm.ts).
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import type { CheckpointRecord } from '../checkpoint';
import { flattenConserving, kadomtsevMixingRadius, rhoOfQ, shearAt } from '../mhd';
import { currentProfiles } from '../qprofile';
import { seedIslands } from './ntm';
import type { EventModel } from './EventModel';

export class SawtoothEvents implements EventModel {
  readonly id = 'sawtooth';
  private lastSaw = -1e9;

  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const c = ctx.cfg, g = ctx.tg, w = ctx.w, N = ctx.N, v = st;
    if (!(c.events.sawteeth && t - this.lastSaw > 0.05)) return;
    const r1 = rhoOfQ(g, w.qF, 1);
    if (!(r1 > 0.05 && r1 < 0.8)) return;
    const s1 = shearAt(g, w.qF, r1);
    if (!(s1 > ctx.ps.sawtoothShear)) return;
    const rmix = Math.min(kadomtsevMixingRadius(g, w.qF), 0.95);
    if (!(rmix > r1)) return;
    const Te0 = v.Te[0];
    const before = ctx.crashHook ? ctx.crashSnapshot(v) : null;
    flattenConserving(g, v.Te, v.ne, r1, rmix);
    flattenConserving(g, v.Ti, w.ni, r1, rmix);
    flattenConserving(g, v.ne, null, r1, rmix);
    // q → max(q, 1.01) in the mixing region; rebuild ψ inward from ρ_mix
    const iMix = Math.min(N - 1, Math.floor(rmix / g.dRho));
    for (let f = 1; f <= iMix; f++) {
      if (w.qF[f] < 1.01) w.dpsiF[f] = (g.PhiB * g.rhoF[f]) / (Math.PI * 1.01);
    }
    for (let i = iMix - 1; i >= 0; i--) v.psi[i] = v.psi[i + 1] - w.dpsiF[i + 1] * g.dRho;
    currentProfiles(ctx, v.psi, v.s.Ip);
    if (before) ctx.crashHook!('sawtooth', t, before, ctx.crashSnapshot(v));
    this.lastSaw = t;
    ctx.dt = Math.min(ctx.dt, 5e-3);
    ctx.diagStale = true;
    ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash (s₁ = ${s1.toFixed(2)}): ρ(q=1) = ${r1.toFixed(2)}, ρ_mix = ${rmix.toFixed(2)}, T_e0 ${Te0.toFixed(1)} → ${v.Te[0].toFixed(1)} keV`, value: (Te0 - v.Te[0]) / Te0 });
    if (c.events.ntm) seedIslands(ctx, v, d);
  }

  save(rec: CheckpointRecord): void { rec.lastSaw = this.lastSaw; }
  restore(rec: Readonly<CheckpointRecord>): void { this.lastSaw = rec.lastSaw; }
}
