/**
 * Typed errors of the simulation kernel. Callers (worker, CLIs) can tell a configuration error
 * from a numerical failure with `instanceof` instead of parsing messages.
 */

/** Base class of every error the simulation kernel raises on purpose. */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The configuration names a confinement method no model implements. */
export class UnknownMethodError extends SimulationError {
  readonly method: unknown;
  constructor(method: unknown) {
    super(`unknown confinement method '${String(method)}'`);
    this.method = method;
  }
}

/**
 * The integrator could not produce a finite state: the step was already at dtMin (or the step
 * size controller gave up) and the candidate state or its error norm was NaN/±Infinity.
 * The state passed to the integrator is left unchanged.
 */
export class NonFiniteStateError extends SimulationError {
  /** start of the failed step */
  readonly t: number;
  /** size of the last attempted step */
  readonly h: number;
  /** first non-finite component of the candidate state, or −1 if only the error norm was non-finite */
  readonly index: number;
  /** its value */
  readonly value: number;
  constructor(t: number, h: number, index: number, value: number) {
    super(index >= 0
      ? `integrator produced a non-finite state at t = ${t} (h = ${h}): y[${index}] = ${value}`
      : `integrator error norm is not finite at t = ${t} (h = ${h})`);
    this.t = t; this.h = h; this.index = index; this.value = value;
  }
}

/**
 * A SimModel does not meet the kernel's contract: it provides neither its own step() nor the
 * rhs() and integratorOpts the Dormand–Prince stepper needs.
 */
export class ModelContractError extends SimulationError {
  /** the model's method */
  readonly method: unknown;
  constructor(method: unknown, detail: string) {
    super(`model '${String(method)}' does not meet the SimModel contract: ${detail}`);
    this.method = method;
  }
}
