/**
 * Neoclassical tearing modes at q = 3/2 and q = 2. The island widths w₃₂, w₂₁ [m] are state
 * scalars.
 *
 *  - Growth: modified Rutherford equation (La Haye, Phys. Plasmas 13 (2006) 055501, Eq. 1; mhd.ts
 *    mreRate) with a_bs = 1, which saturates at w/a ≈ 0.05–0.1 (the experimental range of JET and
 *    DIII-D 3/2 NTMs), integrated with 20 explicit substeps per transport step; islands below
 *    0.2 w_d are dropped, widths capped at 0.4 a.
 *  - Seed: a sawtooth crash seeds w = 2.5 w_d (3/2, if β_N,th > 0.5 β_N,lim) and 2 w_d (2/1, if
 *    β_N,th > 0.75 β_N,lim), w_d = 0.012 a/2. The drive is the bootstrap current of the THERMAL
 *    pressure gradient, so the thermal β_N (fast ions carry no bootstrap current) is compared with
 *    the Troyon limit, which is a limit on the total β_N (as in the 0D model).
 *  - Effects: χ_e and χ_i + 5 m²/s across the island (flattening, transport/coefficients.ts), and
 *    the belt-model confinement degradation ΔW/W ≈ −4 Σ ρ_s² w/a (control/confinement.ts).
 *  - Events: onset above w/a = 0.02 and decay; a 2/1 island above w/a = 0.1 locks
 *    (events/disruption.ts).
 */
import type { SimEvent } from '../../types';
import { MU0, ProfileContext } from '../context';
import type { ProfileState, ScalarView } from '../state';
import type { CheckpointRecord } from '../checkpoint';
import { cellIndex } from '../geometry1d';
import { mreRate, rhoOfQ } from '../mhd';
import type { EventModel } from './EventModel';

/** Island regions for transport: [ρ_s, full width in ρ] of each island wider than 0.002 a */
export function islandRegions(ctx: ProfileContext, s: ScalarView): [number, number][] {
  const w = ctx.w, g = ctx.tg;
  const islands: [number, number][] = [];
  const a = g.a;
  for (const [key, qv] of [['w32', 1.5], ['w21', 2]] as const) {
    const wi = s[key];
    if (wi > 0.002 * a) {
      const rs = rhoOfQ(g, w.qF, qv);
      if (rs > 0) {
        const i = cellIndex(g, rs);
        islands.push([rs, wi * g.gradRhoC[i]]);
      }
    }
  }
  return islands;
}

/** Belt-model confinement factor 1 − 4 Σ ρ_s² w/a, at least 0.5 */
export function ntmConfinementFactor(ctx: ProfileContext, s: ScalarView): number {
  const w = ctx.w, g = ctx.tg;
  let fNTM = 1;
  for (const [key, qv] of [['w32', 1.5], ['w21', 2]] as const) {
    const rs = rhoOfQ(g, w.qF, qv);
    if (rs > 0 && s[key] > 0) fNTM -= 4 * rs * rs * (s[key] / g.a);
  }
  return Math.max(fNTM, 0.5);
}

/** Advances the island widths over an accepted step (o: old state, st: new state) */
export function evolveIslands(ctx: ProfileContext, dt: number, o: ProfileState, st: ProfileState): void {
  const c = ctx.cfg, w = ctx.w, g = ctx.tg, N = ctx.N, s = st.s;
  for (const [key, m, qv] of [['w32', 3, 1.5], ['w21', 2, 2]] as const) {
    let wv = o.s[key];
    if (wv <= 0 || !c.events.ntm) { s[key] = 0; continue; }
    const rs = rhoOfQ(g, w.qF, qv);
    if (rs <= 0) { s[key] = 0; continue; }
    const i = Math.min(N - 2, Math.max(1, cellIndex(g, rs)));
    const rsm = 0.5 * (g.RoutC[i] - g.RinC[i]);
    const eta = 1 / Math.max(w.sigma[i], 1);
    const pS = w.p[i];
    const dp = (w.p[i + 1] - w.p[i - 1]) / g.spanC[i] * g.gradRhoC[i];
    const dq = (w.qF[i + 1] - w.qF[i]) / g.dRhoC[i] * g.gradRhoC[i];
    const Lp = pS / Math.max(-dp, 1e-6), Lq = qv / Math.max(dq, 1e-6);
    const Bth = (g.epsC[i] * g.B0) / qv;
    const bth = (2 * MU0 * pS) / (Bth * Bth);
    const wd = 0.012 * (g.a / 2);
    const par = { eta, m, rs: rsm, eps: g.epsC[i], betaTheta: bth, LqOverLp: Math.min(Lq / Math.max(Lp, 1e-3), 5), wd, aBs: 1.0, aPol: 0.5 };
    const nsub = 20;
    for (let k = 0; k < nsub; k++) wv = Math.max(0, wv + (dt / nsub) * mreRate(wv, par));
    if (wv < 0.2 * wd) wv = 0;
    s[key] = Math.min(wv, 0.4 * g.a);
  }
}

/** Seed islands after a sawtooth crash (q profile of the crashed state) */
export function seedIslands(ctx: ProfileContext, st: ProfileState, d: Readonly<Record<string, number>>): void {
  const c = ctx.cfg, g = ctx.tg, w = ctx.w, s = st.s;
  const wd = 0.012 * (g.a / 2);
  if (rhoOfQ(g, w.qF, 1.5) > 0 && s.w32 < 2.5 * wd && d.betaN_th > 0.5 * c.limits.betaN_limit) s.w32 = 2.5 * wd;
  if (rhoOfQ(g, w.qF, 2) > 0 && s.w21 < 2 * wd && d.betaN_th > 0.75 * c.limits.betaN_limit) s.w21 = 2 * wd;
}

/** Onset and decay events of the islands */
export class NtmEvents implements EventModel {
  readonly id = 'NTM';
  private on32 = false;
  private on21 = false;

  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const g = ctx.tg, s = st.s;
    for (const [key, name] of [['w32', '3/2'], ['w21', '2/1']] as const) {
      const on = s[key] > 0.02 * g.a;
      const flag = key === 'w32' ? this.on32 : this.on21;
      if (on && !flag) ev.push({ t, kind: 'NTM_onset', msg: `NTM ${name} island grew to w/a = ${(s[key] / g.a).toFixed(3)} (thermal β_N = ${d.betaN_th.toFixed(2)}) — local profile flattening, τ_E degrading` });
      if (!on && flag) ev.push({ t, kind: 'NTM_gone', msg: `NTM ${name} island decayed` });
      if (key === 'w32') this.on32 = on; else this.on21 = on;
    }
  }

  save(rec: CheckpointRecord): void { rec.ntmOn32 = +this.on32; rec.ntmOn21 = +this.on21; }
  restore(rec: Readonly<CheckpointRecord>): void { this.on32 = !!rec.ntmOn32; this.on21 = !!rec.ntmOn21; }
}
