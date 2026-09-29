/**
 * Guarded Grad–Shafranov solves for the 1.5D model.
 *
 * The model needs an equilibrium at start-up and re-solves it periodically from the transport
 * profiles. A solve can fail in three ways: it throws (a typed GSFailure of the solver, or a plain
 * Error from the linear algebra), it returns a result that did not converge, or the result is
 * rejected by the caller's own acceptance test. The initial solve runs through a short ladder of
 * retry stages (solveGuarded) and every attempt is logged, so that the caller can count, report and
 * warn instead of dropping failures silently. The periodic updates are not a ladder any more: they are
 * the self-consistent solve of coupling/outer.ts, which logs its attempts in the same GsAttempt form.
 * solverErrorMessage is the single point that decodes what the solver threw.
 */
import { GSFailure } from '../equilibrium/gs';
import type { Equilibrium, EquilibriumOptions, GSSolver } from '../equilibrium/gs';
import type { TransportGeometry } from './geometry1d';

/** One rung of a retry ladder: options merged over the base options of the solve */
export interface GsStage {
  label: string;
  opts: Partial<EquilibriumOptions>;
}

/** Log of one solve attempt */
export interface GsAttempt {
  stage: string;
  iterations: number;
  residual: number;
  converged: boolean;
  /** what the solver threw, if it threw */
  error?: string;
  /** why a result that came back was refused by the acceptance test, if the test said so */
  rejected?: string;
}

export interface GsOutcome {
  /** accepted equilibrium, or null if no stage produced an acceptable one */
  eq: Equilibrium | null;
  /** index of the accepting stage (0 = nominal), −1 if none */
  stage: number;
  attempts: GsAttempt[];
  /** lowest-residual finite result among the rejected ones (for callers that cannot do without) */
  best: Equilibrium | null;
}

/** Residual below which a non-converged solve is still accepted (the model's historical threshold) */
export const GS_ACCEPT_RESIDUAL = 1e-4;

/** Message of anything the Grad–Shafranov solver may throw (a typed GSFailure, or a plain Error from below). */
export function solverErrorMessage(e: unknown): string {
  if (e instanceof GSFailure) return e.message; // already 'Grad–Shafranov (reason): …'
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

/** Finite, positive-flux equilibrium whose profile tables can feed the transport geometry */
export function isUsableEquilibrium(eq: Equilibrium): boolean {
  if (!(eq.psiAxis > 0) || !Number.isFinite(eq.residual) || !(eq.volume > 0) || !Number.isFinite(eq.q95)) return false;
  const P = eq.prof;
  for (const a of [P.q, P.rhoTor, P.dVdpsiN, P.avgGrad2]) for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k])) return false;
  return true;
}

/** Converged (or below the acceptance residual) and usable */
export function acceptableEquilibrium(eq: Equilibrium): boolean {
  return (eq.converged || eq.residual < GS_ACCEPT_RESIDUAL) && isUsableEquilibrium(eq);
}

/** Transport geometry with finite, positive volume elements and finite metrics */
export function isUsableGeometry(tg: TransportGeometry): boolean {
  if (!(tg.volume > 0) || !Number.isFinite(tg.PhiB)) return false;
  for (const a of [tg.dV, tg.VpF, tg.g1F, tg.g2F, tg.qEqC, tg.B2C]) for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k])) return false;
  for (let k = 0; k < tg.dV.length; k++) if (!(tg.dV[k] > 0)) return false;
  return true;
}

/**
 * Runs the stages in order until one gives an acceptable equilibrium. A stage that throws or does
 * not converge is logged and the next one runs from the same base options (warm start included).
 * `accept` returns true to take the result, false to refuse it, or a string to refuse it with a
 * reason that is logged in the attempt. Invalid input (GSFailure 'bad-input') ends the ladder: no
 * stage changes the input.
 */
export function solveGuarded(solver: GSSolver, base: EquilibriumOptions, stages: readonly GsStage[],
  accept: (eq: Equilibrium) => boolean | string = acceptableEquilibrium): GsOutcome {
  const attempts: GsAttempt[] = [];
  let best: Equilibrium | null = null;
  for (let k = 0; k < stages.length; k++) {
    const st = stages[k];
    try {
      const eq = solver.solve({ ...base, ...st.opts });
      attempts.push({ stage: st.label, iterations: eq.iterations, residual: eq.residual, converged: eq.converged });
      const verdict = accept(eq);
      if (verdict === true) return { eq, stage: k, attempts, best };
      if (typeof verdict === 'string') attempts[attempts.length - 1].rejected = verdict;
      if (isUsableEquilibrium(eq) && (!best || eq.residual < best.residual)) best = eq;
    } catch (e) {
      const f = e instanceof GSFailure ? e : null;
      attempts.push({
        stage: st.label, iterations: f?.iterations ?? 0, residual: f && Number.isFinite(f.residual) ? f.residual : Infinity,
        converged: false, error: solverErrorMessage(e),
      });
      if (f?.reason === 'bad-input') break;
    }
  }
  return { eq: null, stage: -1, attempts, best };
}
