/**
 * Type-I ELMs. Trigger: H-mode, pedestal α_ped/α_crit > 1 (peeling–ballooning limit, mhd.ts) and
 * the pedestal recovery time τ_E/8 elapsed since the last ELM (experimental f_ELM τ_E ≈ 5–30:
 * ITER ≈ 2 Hz, JET ≈ 30 Hz, DIII-D ≈ 50 Hz). Crash: a fraction fW = elmFraction × U(0.8, 1.2) of
 * the pedestal energy is expelled from the pedestal and an inner neighbour region of ~0.15 in ρ
 * (Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549), with half that fraction of the
 * particles; the He ash and impurity content are flushed by 0.1 fW.
 *
 * Optional models (WS6a, `ProfileSettings.pedestalModel`, `elmLoss`; the defaults are the behaviour described above): with the EPED1-type pedestal
 * the trigger is the pedestal-top pressure exceeding the peeling–ballooning limit (pedestal/PedestalModel.ts) instead of α_ped > α_crit, and the
 * pedestal top sits at 1 − Δ (Δ the KBM width mapped to ρ̂); with `elmLoss: 'loarte'` the crash removes ΔW_ELM = f(ν*_ped) W_ped
 * (Loarte et al. 2003, pedestal/loarte.ts) instead of the fixed fraction, with the same U(0.8, 1.2) scatter; its depth and, for the largest ELMs, the width
 * of its region are those that carry that energy (pedestal/elmSize.ts).
 */
import type { SimEvent } from '../../types';
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { recNum, type CheckpointAux, type CheckpointRecord } from '../checkpoint';
import { elmCrash } from '../mhd';
import { ELM_WIDTH_STD, elmShapeForEnergy, loarteElmLoss } from '../pedestal/elmSize';
import type { EventModel, EventTrigger } from './EventModel';
import { READY_MARGIN, elmMargin } from './triggers';

/**
 * The step proposed after a crash [s]: the error control grows it from there (the profiles change by tens of per cent within tens of
 * milliseconds after a crash; a step of 0.01 τ_E, the rule of the backward-Euler stepper, is rejected several times at every crash)
 */
export const CRASH_RESTART_DT = 5e-4;

export class ElmEvents implements EventModel {
  readonly id = 'ELM';
  private lastElm = -1e9;
  /** times of the last 20 ELMs (ELM frequency of the report) */
  private elmTimes: number[] = [];

  /** Pedestal recovery time before the next ELM can fire: τ_E/8 of the last step (2 ms at least), the same as afterStep's test */
  static recovery(tauE: number | undefined): number { return Math.max((tauE ?? 0.1) / 8, 2e-3); }

  /**
   * The stepper ends a step at the earliest time the next ELM can fire. The recovery time is that of the last step's τ_E, while
   * afterStep tests the τ_E of the step that ends there, which has changed by a fraction of a percent: the aim is 2 % beyond
   * the recovery time, so that the step passes the test (a step that ended just short would leave the ELM to the next step).
   */
  readonly trigger: EventTrigger = {
    readyAt: (ctx) => this.lastElm + 1.02 * ElmEvents.recovery(ctx.lastDiag.tauE) + READY_MARGIN,
    margin: elmMargin,
  };

  afterStep(ctx: ProfileContext, t: number, st: ProfileState, d: Readonly<Record<string, number>>, ev: SimEvent[]): void {
    const c = ctx.cfg, ps = ctx.ps, s = st.s;
    const tRef = ElmEvents.recovery(d.tauE);
    const over = ctx.ped ? d.ped_ratio > 1 : d.alpha_ped > 1;
    if (!(ctx.hmode && c.events.elms && over && t - this.lastElm > tRef)) return;
    const rhoPed = 1 - ctx.pedWidth;
    // Accepted inventory hooks may have changed the composition since the heat equation's work arrays.
    ctx.impurity?.composition(st.Te, st.ne, s);
    const scatter = 0.8 + 0.4 * ctx.rng.next();
    let fW = ps.elmFraction * scatter, wIn = ELM_WIDTH_STD, note = '';
    if (ps.elmLoss === 'loarte') {
      // ΔW_ELM = f(ν*_ped) W_ped of the pedestal before the crash, with the scatter of the fixed size (pedestal/elmSize.ts)
      const loss = loarteElmLoss(ctx, st, rhoPed, d.q95);
      const shape = elmShapeForEnergy(ctx, st, rhoPed, scatter * loss.energy);
      fW = shape.depth; wIn = shape.width;
      note = `, ${(scatter * loss.fraction).toFixed(2)} W_ped at ν*_ped = ${loss.nuStar.toFixed(3)}${shape.capped ? ', capped' : ''}`;
    }
    ctx.ped?.onElm();
    const before = ctx.crashHook ? ctx.crashSnapshot(st) : null;
    const W0 = ctx.impurity ? ctx.storedEnergy(st) : 0;
    let dW = elmCrash(ctx.tg, st.Te, st.Ti, st.ne, ctx.w.ni, ctx.bc.Te, ctx.bc.Ti, ctx.bc.n, rhoPed, fW, 0.5 * fW, wIn);
    if (ctx.impurity) {
      ctx.impurity.elmCrash(st, rhoPed, 0.5 * fW, wIn); // every species uses the electron crash width
      ctx.impurity.composition(st.Te, st.ne, s);
      dW = W0 - ctx.storedEnergy(st);
    }
    else { s.NHe *= 1 - 0.1 * fW; s.cZ *= 1 - 0.1 * fW; }
    if (before) ctx.crashHook!('ELM', t, before, ctx.crashSnapshot(st));
    s.Pelm += dW / 1.0; // energy pulse into the exponential average (τ = 1 s)
    ctx.crashE += dW; // the loss power of the τ_E scaling counts it in dW/dt (acceptStep)
    this.lastElm = t;
    this.elmTimes.push(t); if (this.elmTimes.length > 20) this.elmTimes.shift();
    ctx.dt = Math.min(ctx.dt, CRASH_RESTART_DT);
    ctx.diagStale = true;
    const cause = ctx.ped ? `p_ped/p_lim = ${d.ped_ratio.toFixed(2)}` : `α_ped/α_crit = ${d.alpha_ped.toFixed(2)}`;
    ev.push({ t, kind: 'ELM', msg: `Type-I ELM (${cause}): ΔW = ${(dW / 1e6).toFixed(2)} MJ${note}`, value: dW / 1e6 });
  }

  /** mean ELM frequency over the last ELMs [Hz] (0 with fewer than three) */
  frequency(): number {
    const T = this.elmTimes;
    return T.length > 2 ? +((T.length - 1) / (T[T.length - 1] - T[0])).toFixed(2) : 0;
  }

  save(rec: CheckpointRecord, aux: CheckpointAux): void {
    rec.lastElm = this.lastElm;
    aux.elmTimes = this.elmTimes.slice();
  }
  restore(rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined): void {
    this.lastElm = recNum(rec, 'lastElm', -1e9);
    const times = aux?.elmTimes;
    this.elmTimes = Array.isArray(times) ? (times as number[]).slice() : [];
  }
}
