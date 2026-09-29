/**
 * Trigger margins of the threshold events (ELM, sawtooth) as functions of the profiles, for the event localisation of the
 * stepper (solver/localise.ts): they take the same tests as the event models' afterStep, evaluated from a state's
 * T_e, T_i, n_e, ψ and its ion-to-electron density ratio, on scratch arrays, without the work arrays of the context.
 */
import { KEV, ProfileContext } from '../context';
import { alphaCritical, alphaMHD, kadomtsevMixingRadius, qFromDpsi, rhoOfQ, shearAt } from '../mhd';
import type { EventTrigger, TriggerScratch, TriggerState } from './EventModel';

/** Time margin added to the end of a refractory period [s]: a step that ends there passes the model's strict `>` test */
export const READY_MARGIN = 1e-6;

/** Allocates the scratch arrays of a margin evaluation for N cells */
export function triggerScratch(N: number): TriggerScratch {
  return { p: new Float64Array(N), dpsiF: new Float64Array(N + 1), qF: new Float64Array(N + 1), qC: new Float64Array(N) };
}

/** Pressure of the cells and the q profile of the faces of a state (as neoclassicalCurrent and currentProfiles write them) */
export function triggerProfiles(ctx: ProfileContext, st: TriggerState, sc: TriggerScratch): void {
  const N = ctx.N;
  for (let i = 0; i < N; i++) sc.p[i] = (st.ne[i] * Math.max(st.Te[i], 0.01) + st.ne[i] * st.niOverNe[i] * Math.max(st.Ti[i], 0.01)) * KEV;
  ctx.cur.dpsiF(st.psi as Float64Array, st.Ip, sc.dpsiF);
  qFromDpsi(ctx.tg, sc.dpsiF, sc.qF, sc.qC);
}

/** ELM: α_ped/α_crit − 1 of the state in H-mode with ELMs enabled (events/elm.ts; diagnostics.ts writes the same ratio as α_ped) */
export function elmMargin(ctx: ProfileContext, st: TriggerState, sc: TriggerScratch): number {
  if (!(ctx.hmode && ctx.cfg.events.elms)) return -1;
  triggerProfiles(ctx, st, sc);
  const N = ctx.N, bc = ctx.bc;
  const rhoPed = 1 - ctx.ps.pedestalWidth;
  const pSep = (bc.n * bc.Te + bc.n * st.niOverNe[N - 1] * bc.Ti) * KEV;
  const aMax = alphaMHD(ctx.tg, sc.p, sc.qF, rhoPed - 0.02, undefined, pSep);
  return aMax / alphaCritical(ctx.geomB.kappa, ctx.geomB.delta, ctx.ps.alphaCritFactor) - 1;
}

/** Sawtooth: s₁ − s_crit with ρ(q = 1) in (0.05, 0.8) and a mixing radius outside it (events/sawtooth.ts); −1 without such a surface */
export function sawtoothMargin(ctx: ProfileContext, st: TriggerState, sc: TriggerScratch): number {
  if (!ctx.cfg.events.sawteeth) return -1;
  triggerProfiles(ctx, st, sc);
  const g = ctx.tg;
  const r1 = rhoOfQ(g, sc.qF, 1);
  if (!(r1 > 0.05 && r1 < 0.8)) return -1;
  const rmix = Math.min(kadomtsevMixingRadius(g, sc.qF), 0.95);
  if (!(rmix > r1)) return -1;
  return shearAt(g, sc.qF, r1) - ctx.ps.sawtoothShear;
}

export type { EventTrigger };
