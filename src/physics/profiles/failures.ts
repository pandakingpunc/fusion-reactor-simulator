/**
 * Typed failures of the 1.5D profile model. They are raised inside the model and converted into
 * an explicit end of the shot (TerminationInfo + 'end' event) rather than thrown out of
 * Simulation.advance, so that a numerical failure never looks like a physics result.
 *
 * Only numerical failures are handled that way. An implicit attempt that throws a NumericalFailure
 * (or a Grad–Shafranov GSFailure) is retried with a smaller Δt; anything else that is thrown inside
 * a step — a TypeError or ReferenceError of a plug-in, a violated invariant — is a programming
 * error and propagates to the caller of Simulation.advance, with the state of the step restored.
 * A module that detects a numerical problem it cannot repair (a non-finite closure, a singular
 * system of its own) throws a NumericalFailure to have the attempt retried.
 */
import { GSFailure } from '../equilibrium/gs';

/** A failure of the numerics, not of the code: the implicit attempt that raised it may be retried at a smaller Δt. */
export abstract class NumericalFailure extends Error {}

/** A linear system of the transport step is singular (the linear algebra reports a zero pivot or a singular block). */
export class LinearAlgebraFailure extends NumericalFailure {
  override readonly name = 'LinearAlgebraFailure';
  constructor(
    /** which system: 'heat', 'density' or 'current' */
    readonly system: string,
    cause: Error,
  ) {
    super(`singular ${system} system (${cause.message})`, { cause });
  }
}

/**
 * Whether an error thrown inside an implicit attempt is a numerical failure (the attempt is
 * retried) rather than a programming error (it propagates).
 */
export function isNumericalFailure(e: unknown): boolean {
  return e instanceof NumericalFailure || e instanceof GSFailure;
}

/**
 * The error a linear-algebra call threw, as a LinearAlgebraFailure. src/physics/numerics/linalg.ts
 * reports a singular system with a plain Error; anything else it may throw (a TypeError from a
 * wrong argument) is not that and is returned unchanged.
 */
export function asLinearAlgebraFailure(system: string, e: unknown): unknown {
  return e instanceof Error && e.constructor === Error ? new LinearAlgebraFailure(system, e) : e;
}

/** The implicit transport step could not produce an acceptable state, even at the smallest Δt. */
export class StepFailure extends NumericalFailure {
  override readonly name = 'StepFailure';
  constructor(
    /** start time of the failed step [s] */
    readonly t: number,
    /** Δt of the last attempt [s] */
    readonly dt: number,
    /** number of attempts, the forced last one included */
    readonly attempts: number,
    /** why the last attempt failed */
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(`implicit step from t = ${t.toPrecision(6)} s failed after ${attempts} attempts (last Δt = ${dt.toExponential(2)} s): ${detail}`, options);
  }
}

/** The initial Grad–Shafranov equilibrium could not be computed for the requested boundary. */
export class EquilibriumInitFailure extends Error {
  override readonly name = 'EquilibriumInitFailure';
  constructor(readonly detail: string, options?: { cause?: unknown }) {
    super(`initial Grad–Shafranov equilibrium failed: ${detail}`, options);
  }
}
