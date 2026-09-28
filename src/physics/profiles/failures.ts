/**
 * Typed failures of the 1.5D profile model. They are raised inside the model and converted into
 * an explicit end of the shot (TerminationInfo + 'end' event) rather than thrown out of
 * Simulation.advance, so that a numerical failure never looks like a physics result.
 */

/** The implicit transport step could not produce an acceptable state, even at the smallest Δt. */
export class StepFailure extends Error {
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
