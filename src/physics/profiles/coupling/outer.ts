/**
 * The self-consistent Grad–Shafranov solve of the coupling: an equilibrium for the transport profiles p(ρ) and
 * ⟨j_φ/R⟩(ρ) that are tabulated on its own flux surfaces.
 *
 * The solver takes tables in ψ_N; the transport has them in ρ_tor = √(Φ/Φ_b), and the map between the two is a
 * property of the equilibrium being solved for. Mapping the tables through the previous equilibrium gives a
 * table that the new equilibrium does not reproduce: its flux surfaces, hence its ρ_tor(ψ_N), have moved. The stale
 * table then integrates to something other than I_p over the new surfaces (the solver reports it as
 * `currentScale` ≠ 1), and when the pressure and current have changed a lot since the last update, the
 * fixed-point iteration cannot even find the equilibrium of that inconsistent pair (JET15 t = 0.7 s, MASTU15).
 *
 * Here the equilibrium is found by an outer iteration on the map. The table nodes are the transport radii ρ_j
 * mapped to ψ_N, x_j = ψ_N(ρ_j); the table values are the transport values at ρ_j, which do not change. Solve for
 * the tables on the nodes x_j of the previous equilibrium, read the ρ_tor of the new equilibrium at the same x_j and
 * move the nodes to where the new equilibrium puts the ρ_j; the iteration is done when the equilibrium's ρ_tor(x_j)
 * agrees with ρ_j (`mappingMismatch`, rms over the radius, below `tol`). The node update is under-relaxed
 * (ω halved, down to ¼, when the mismatch does not shrink by 10 %) and the loop ends on stagnation after two such
 * iterations or after `maxOuter`.
 *
 * Each solve of the outer loop is warm-started from the previous equilibrium and reaches the new tables by a
 * continuation: the tables of the previous equilibrium itself (which it solves exactly) are blended to the new ones,
 * the whole way in one solve first. A solve that does not converge (or fails with a typed numerical failure) is
 * retried on half the way, and each converged part is the start of the next; three failures are allowed. If the whole
 * way cannot be solved and at least MIN_FRACTION of it can, that equilibrium is used and the shortfall is reported
 * (the fixed-boundary problem has a fold near the transport's tables, where the pressure and the current table are at what
 * the boundary can hold: JET15 in the ramp-up, MASTU15); with less the update fails. The parts before the last are solved
 * on a coarse surface table (only their ψ is used), so an equilibrium that is used short of the whole way is solved again
 * from its own ψ on the default table: the mapping mismatch and the transport geometry read the surfaces. Anderson
 * mixing that does not restart on every uptick of the residual (EquilibriumOptions.restartGrowth) is what makes the
 * solves near a fold converge.
 */
import { GSFailure } from '../../equilibrium/gs';
import type { Equilibrium, EquilibriumOptions, GSSolver } from '../../equilibrium/gs';
import { SingularMatrixError } from '../../numerics/linalg';
import { GS_ACCEPT_RESIDUAL, GsAttempt, isUsableEquilibrium, solverErrorMessage } from '../eqguard';
import { blend, equilibriumTables, mappingMismatch, psiNOfRho } from './tables';

/** Log of one solve of the outer iteration */
export interface OuterAttempt extends GsAttempt {
  /** outer iteration (1-based) */
  outer: number;
  /** fraction of the way from the previous equilibrium's tables to the new ones this solve went (1 = all the way) */
  fraction: number;
  /** mapping mismatch after the solve (only for a solve that went all the way) */
  delta?: number;
}

export interface ConsistentSpec {
  Ip: number;
  B0: number;
  /** the transport radii ρ_j, j = 0…N (strictly increasing, 0 to 1) */
  rho: Float64Array;
  /** the transport pressure [Pa] and ⟨j_φ/R⟩ [A/m³] at ρ_j */
  p: Float64Array;
  jR: Float64Array;
  /** the mapping mismatch counts the nodes with ρ_j ≥ rhoMin (tables.ts) */
  rhoMin: number;
  /** |c − 1| above which the current table counts as not built on the equilibrium (EquilibriumOptions.currentScaleWarn) */
  currentScaleLimit: number;
}

export interface ConsistentOptions {
  /** mapping mismatch (rms Δρ_tor) below which the tables are consistent with the equilibrium */
  tol: number;
  /**
   * mismatch up to which an iteration that stops contracting is taken as done (more iterations against the same limit only
   * cost). Whether the result is adopted is the caller's decision; its limit (OUTER_LIMIT) is larger.
   */
  accept: number;
  /** outer iterations at most */
  maxOuter: number;
  /** options of every table solve (tolerance, iteration budget, mixing, Newton–Krylov) */
  solve: Partial<EquilibriumOptions>;
}

export interface ConsistentResult {
  /**
   * The equilibrium of the tables on its own surfaces: the last outer iteration if its mismatch is below `tol`,
   * otherwise the one with the smallest mismatch whose current table did not need rescaling. null if there is none.
   */
  eq: Equilibrium | null;
  /** the mismatch of `eq` fell below `tol` */
  converged: boolean;
  /** mapping mismatch of `eq` (Infinity if there is none) */
  delta: number;
  /** why there is no equilibrium, or why it did not converge */
  reason?: string;
  outerIterations: number;
  attempts: OuterAttempt[];
  /** a solve needed a shorter continuation step or failed */
  hard: boolean;
  /**
   * Fraction of the way from the previous equilibrium's tables to the transport's that `eq` is for (1 = all the way).
   * Below 1 the solve of the whole way did not converge from the last part that did (a fold of the fixed-boundary
   * problem: the pressure and current tables are close to what the boundary can hold); see MIN_FRACTION.
   */
  fraction: number;
}

/** typed numerical failures of a solve: the attempt is logged and a smaller step tried */
const isSolveFailure = (e: unknown): boolean => e instanceof GSFailure || e instanceof SingularMatrixError;

/** three levels are enough for the intermediate solves of a continuation (only ψ is used) */
const CHEAP_LEVELS = [0.3, 0.7, 1];

const acceptable = (eq: Equilibrium): boolean => (eq.converged || eq.residual < GS_ACCEPT_RESIDUAL) && isUsableEquilibrium(eq);

/**
 * The smallest fraction of the way to the transport tables that an update may fall short by (see ConsistentResult.fraction):
 * where the whole way cannot be solved, the last part that could is used if it is at least this much. The
 * equilibrium is then that of tables in between the previous and the new ones, a lagging geometry, which for
 * the nearly stationary phases in which it arises differs from the exact one by less than the mapping error; it is
 * reported.
 */
export const MIN_FRACTION = 0.75;

/**
 * One solve of a continuation for `o`, logged in `attempts`. Returns the equilibrium if it is acceptable and null otherwise;
 * `stop` is set for a failure that no smaller step changes (invalid input). Only the typed numerical failures are handled,
 * anything else is a bug and propagates.
 */
function attempt(solver: GSSolver, o: EquilibriumOptions, stage: string, outer: number, fraction: number, attempts: OuterAttempt[]): { eq: Equilibrium | null; stop: boolean } {
  try {
    const eq = solver.solve(o);
    attempts.push({ stage, iterations: eq.iterations, residual: eq.residual, converged: eq.converged, outer, fraction });
    return { eq: acceptable(eq) ? eq : null, stop: false };
  } catch (e) {
    if (!isSolveFailure(e)) throw e;
    const f = e instanceof GSFailure ? e : null;
    attempts.push({
      stage, iterations: f?.iterations ?? 0, residual: f && Number.isFinite(f.residual) ? f.residual : Infinity,
      converged: false, error: solverErrorMessage(e), outer, fraction,
    });
    return { eq: null, stop: f?.reason === 'bad-input' };
  }
}

/**
 * Solve for the tables `to` on the nodes x starting from `startEq`, whose own tables `from` on x it solves:
 * the whole way, halving on failure. Returns the equilibrium at the tables `to` (fraction 1), or if the whole way
 * cannot be solved the one at the largest fraction reached if it is at least MIN_FRACTION, or null.
 *
 * The parts of the way that are not the last are solved on the coarse CHEAP_LEVELS table, of which only ψ is used (the
 * start of the next part). An equilibrium that is returned has the flux-surface table of every other equilibrium: a part
 * that has to be returned, because the rest of the way could not be solved, is solved again at the default table
 * from its own ψ (converged already, so this is a residual evaluation and a post-processing, not a search).
 */
function continuation(solver: GSSolver, startEq: Equilibrium, x: Float64Array, from: { p: Float64Array; jR: Float64Array },
  to: { p: Float64Array; jR: Float64Array }, spec: ConsistentSpec, opts: ConsistentOptions, outer: number, attempts: OuterAttempt[]): { eq: Equilibrium; fraction: number } | null {
  let s = 0, w = 1, psi = startEq.psi, halvings = 0;
  let last: { eq: Equilibrium; o: EquilibriumOptions } | null = null;
  const optionsAt = (s1: number): EquilibriumOptions => ({
    ...opts.solve, Ip: spec.Ip, B0: spec.B0,
    profile: { kind: 'table', psiN: x, p: blend(from.p, to.p, s1), jR: blend(from.jR, to.jR, s1) },
    psiInit: psi, currentScaleWarn: spec.currentScaleLimit,
  });
  while (s < 1) {
    const s1 = w >= 1 ? 1 : s + w * (1 - s);
    const final = s1 === 1;
    const o = optionsAt(s1);
    const label = final ? `outer ${outer}` : `outer ${outer} · ${(100 * s1).toFixed(0)} %`;
    const { eq, stop } = attempt(solver, final ? o : { ...o, psiLevels: CHEAP_LEVELS }, label, outer, s1, attempts);
    if (stop) return null; // no step changes invalid input
    if (eq) {
      s = s1; psi = eq.psi; last = { eq, o };
      w = Math.min(1, 2 * w);
    } else {
      if (++halvings > 3) break;
      w *= 0.5;
    }
  }
  if (s >= 1) return last ? { eq: last.eq, fraction: 1 } : null; // the last part is the whole way: solved at the default table
  if (!last || s < MIN_FRACTION) return null;
  const full = attempt(solver, { ...last.o, psiInit: last.eq.psi }, `outer ${outer} · ${(100 * s).toFixed(0)} % (full table)`, outer, s, attempts);
  return full.eq ? { eq: full.eq, fraction: s } : null;
}

/**
 * The equilibrium of the transport profiles p(ρ), ⟨j_φ/R⟩(ρ) of `spec` on its own flux surfaces (see the header);
 * `start` is the last accepted equilibrium, the state the iteration starts from.
 */
export function solveConsistent(solver: GSSolver, start: Equilibrium, spec: ConsistentSpec, opts: ConsistentOptions): ConsistentResult {
  const attempts: OuterAttempt[] = [];
  const rescaled = (eq: Equilibrium) => eq.warnings.some((w) => w.code === 'table-current-rescaled');
  let eq = start;
  let x = psiNOfRho(eq, spec.rho);
  let omega = 1, prev = Infinity, stalled = 0, outer = 0;
  // the best equilibrium so far: one that went all the way beats one that fell short; then the smaller mismatch
  let best: { eq: Equilibrium; delta: number; fraction: number } | null = null;
  const better = (fraction: number, delta: number) => {
    if (!best) return true;
    if ((fraction === 1) !== (best.fraction === 1)) return fraction === 1;
    return delta < best.delta;
  };
  const target = { p: spec.p, jR: spec.jR };
  const done = (converged: boolean, reason?: string): ConsistentResult => ({
    eq: best?.eq ?? null, converged, delta: best?.delta ?? Infinity, fraction: best?.fraction ?? 0, reason,
    outerIterations: Math.min(outer, opts.maxOuter), attempts, hard: hardOf(attempts),
  });
  for (outer = 1; outer <= opts.maxOuter; outer++) {
    const part = continuation(solver, eq, x, equilibriumTables(eq, x), target, spec, opts, outer, attempts);
    const own = attempts[attempts.length - 1];
    if (!part) {
      if (!best) return done(false, own.error ?? `no convergence (residual ${own.residual.toExponential(1)} after ${own.iterations} iterations)`);
      break; // an earlier iteration has an equilibrium: the loop ends with it (below)
    }
    const step = part.eq, fraction = part.fraction;
    // the last attempt is the one that produced `step` unless the solve fell short of the whole way
    const mine = fraction === 1 ? own : attempts.slice().reverse().find((a) => a.outer === outer && a.fraction === fraction) ?? own;
    const delta = mappingMismatch(step, x, spec.rho, spec.rhoMin);
    mine.delta = delta;
    const scaleOk = !rescaled(step);
    if (!scaleOk) mine.rejected = `current table rescaled by ${(step.currentScale ?? NaN).toFixed(2)} to meet I_p (limit ±${spec.currentScaleLimit})`;
    if (scaleOk && better(fraction, delta)) best = { eq: step, delta, fraction };
    if (fraction === 1 && delta < opts.tol) {
      // consistent with the equilibrium: a table that still needs rescaling is not the transport's
      if (!scaleOk) return done(false, mine.rejected);
      return done(true);
    }
    // short of the whole way after the tables were remapped once: the fold is not the stale mapping's, more iterations against it only cost
    if (fraction < 1 && outer >= 2) break;
    if (delta > 0.9 * prev) {
      // not contracting: a mismatch already within the acceptance tolerance is what this map can do, more iterations only cost
      if (delta <= opts.accept) break;
      omega = Math.max(0.5 * omega, 0.25);
      if (++stalled >= 2) break;
    } else stalled = 0;
    const xNew = psiNOfRho(step, spec.rho);
    x = Float64Array.from(x, (v, j) => v + omega * (xNew[j] - v));
    eq = step; prev = delta;
  }
  if (!best) return done(false, attempts[attempts.length - 1].rejected ?? 'no equilibrium with a consistent current table');
  const why = best.fraction < 1
    ? `the equilibrium follows only ${(100 * best.fraction).toFixed(0)} % of the change of the transport profiles: no convergence for the whole (the pressure and current tables are at the limit of what the boundary can hold)`
    : `the tables did not converge to the equilibrium's surfaces (rms Δρ_tor = ${best.delta.toExponential(1)} after ${Math.min(outer, opts.maxOuter)} iterations)`;
  return done(false, why);
}

function hardOf(attempts: readonly OuterAttempt[]): boolean {
  return attempts.some((a) => !a.converged || a.error !== undefined || a.fraction < 1);
}
