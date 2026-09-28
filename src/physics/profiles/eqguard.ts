/**
 * Guarded Grad–Shafranov solves for the 1.5D model.
 *
 * The model needs an equilibrium at start-up and re-solves it periodically from the transport
 * profiles. A solve can fail in two ways: it throws (today a plain Error from the solver or the
 * linear algebra; a typed solver failure later) or it returns a result that did not converge.
 * Both are handled here in one place: a solve runs through a ladder of retry stages and every
 * attempt is logged, so that the caller can count, report and warn instead of dropping failures
 * silently. solverErrorMessage is the single point that decodes what the solver threw.
 */
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

/** Message of anything the Grad–Shafranov solver may throw (plain Error now, a typed failure later). */
export function solverErrorMessage(e: unknown): string {
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
 */
export function solveGuarded(solver: GSSolver, base: EquilibriumOptions, stages: readonly GsStage[],
  accept: (eq: Equilibrium) => boolean = acceptableEquilibrium): GsOutcome {
  const attempts: GsAttempt[] = [];
  let best: Equilibrium | null = null;
  for (let k = 0; k < stages.length; k++) {
    const st = stages[k];
    try {
      const eq = solver.solve({ ...base, ...st.opts });
      attempts.push({ stage: st.label, iterations: eq.iterations, residual: eq.residual, converged: eq.converged });
      if (accept(eq)) return { eq, stage: k, attempts, best };
      if (isUsableEquilibrium(eq) && (!best || eq.residual < best.residual)) best = eq;
    } catch (e) {
      attempts.push({ stage: st.label, iterations: 0, residual: Infinity, converged: false, error: solverErrorMessage(e) });
    }
  }
  return { eq: null, stage: -1, attempts, best };
}

/**
 * Low-pass filter of a table sampled on nodes about uniform in ρ: `passes` binomial (¼, ½, ¼)
 * passes with both end values held. n passes approximate a Gaussian kernel of variance n/2 node
 * spacings² (the binomial distribution; e.g. Marchand & Marmet, Rev. Sci. Instrum. 54 (1983) 1034).
 */
export function binomialSmooth(a: ArrayLike<number>, passes: number): number[] {
  let b = Array.from(a);
  const n = b.length;
  for (let k = 0; k < passes; k++) {
    const c = b.slice();
    for (let i = 1; i < n - 1; i++) c[i] = 0.25 * b[i - 1] + 0.5 * b[i] + 0.25 * b[i + 1];
    b = c;
  }
  return b;
}

/**
 * Number of binomial passes that filter a table with node spacing Δρ down to the scale the GS grid
 * resolves: Gaussian σ = Δ_GS (grid spacing in ρ units), n = 2 (σ/Δρ)², at least one pass.
 */
export function gridScalePasses(gridSpacingRho: number, tableSpacingRho: number): number {
  return Math.max(1, Math.round(2 * (gridSpacingRho / Math.max(tableSpacingRho, 1e-6)) ** 2));
}
