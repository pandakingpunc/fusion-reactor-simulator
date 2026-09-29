/**
 * TR-BDF2 (the composite trapezoidal rule / second-order backward-difference formula) with its embedded
 * error estimate, and the step-size controller of the 1.5D transport step.
 *
 * Method (R. E. Bank, W. M. Coughran, W. Fichtner, E. H. Grosse, D. J. Rose and R. K. Smith, "Transient simulation of
 * silicon devices and circuits", IEEE Trans. Computer-Aided Design 4 (1985) 436; analysis and error estimate:
 * M. E. Hosea and L. F. Shampine, "Analysis and implementation of TR-BDF2", Appl. Numer. Math. 20 (1996) 21). For
 * dU/dt = R(U), one step of length h from U_n takes the trapezoidal rule to t_n + γh and the BDF2 from there:
 *
 *   U_γ     = U_n + (γh/2) [R(U_n) + R(U_γ)]
 *   U_{n+1} = a U_γ + b U_n + d h R(U_{n+1}),   a = 1/(γ(2 − γ)),  b = −(1 − γ)²/(γ(2 − γ)),  d = (1 − γ)/(2 − γ)
 *
 * With γ = 2 − √2 both stages have the implicit interval d h = γh/2 (d = γ/2 = 1 − √2/2), so each stage is one backward-Euler
 * solve with the interval d h, a reference state (U_n, or the combination a U_γ + b U_n) and, in the first stage, the rate of
 * the old state as an explicit source. That is how the finite-volume solvers of fvsolver.ts take it (HeatInputs.U0e, Xe, …).
 * The method is second order, L-stable (the trapezoidal stage alone is not: its result may ring in a very stiff step, which
 * the error estimate then reports) and one-step, so it needs no history and restarts after an MHD crash at no cost.
 *
 * Error estimate. The local truncation error is −C h³ U‴ + O(h⁴) with C = (−3γ² + 4γ − 2)/(12 (2 − γ)) = −0.0404; U‴ is estimated
 * from the divided difference of the rates at t_n, t_n + γh and t_{n+1} (Hosea and Shampine, eq. (3.16)):
 *
 *   EST = 2 C h [ R_n/γ − R_γ/(γ(1 − γ)) + R_{n+1}/(1 − γ) ].
 *
 * The rates at the two later points follow from the stage relations, R_γ = (U_γ − U_n)/(d h) − R_n and
 * R_{n+1} = (U_{n+1} − a U_γ − b U_n)/(d h), so EST is a fixed linear combination of R_n h, U_n, U_γ and U_{n+1} and costs no further
 * evaluation of the physics (the coefficients below). It is exact for the third-order term: for U‴ = const the estimate equals the error.
 */

/** γ = 2 − √2 */
export const TRBDF2_GAMMA = 2 - Math.SQRT2;
/** Implicit interval of both stages in units of the step, d = γ/2 */
export const TRBDF2_D = TRBDF2_GAMMA / 2;
/** Weights of the BDF2 reference state a U_γ + b U_n (a + b = 1) */
export const TRBDF2_A = 1 / (TRBDF2_GAMMA * (2 - TRBDF2_GAMMA));
export const TRBDF2_B = -((1 - TRBDF2_GAMMA) ** 2) / (TRBDF2_GAMMA * (2 - TRBDF2_GAMMA));
/** Error constant C of the local truncation error −C h³ U‴ */
export const TRBDF2_C = (-3 * TRBDF2_GAMMA ** 2 + 4 * TRBDF2_GAMMA - 2) / (12 * (2 - TRBDF2_GAMMA));

const g = TRBDF2_GAMMA, d = TRBDF2_D;
/**
 * EST = cR h R_n + cN U_n + cG U_γ + cE U_{n+1}. The three U coefficients add up to zero (a constant state has no
 * error) and cR h + cG γh + cE h vanishes (so does a state linear in time).
 */
export const TRBDF2_EST = {
  cR: (2 * TRBDF2_C * (2 - g)) / (g * (1 - g)),
  cN: 2 * TRBDF2_C * (1 / (d * g * (1 - g)) - TRBDF2_B / (d * (1 - g))),
  cG: 2 * TRBDF2_C * (-1 / (d * g * (1 - g)) - TRBDF2_A / (d * (1 - g))),
  cE: (2 * TRBDF2_C) / (d * (1 - g)),
} as const;

/** The embedded error estimate of one step of length h for a scalar U (see the header) */
export function trbdf2Estimate(h: number, Rn: number, Un: number, Ug: number, U1: number): number {
  const c = TRBDF2_EST;
  return c.cR * h * Rn + c.cN * Un + c.cG * Ug + c.cE * U1;
}

/**
 * Step-size controller: an integral controller on the scaled error norm `err` (1 = the tolerance). After an accepted step the
 * next one is h · safety · err^(−1/2), within [facMin, facMax], and no larger than h after a step that had to be repeated;
 * a rejected step (err > 1) is repeated with the step at which the error would be `safety` (rejectedFactor). The exponent 1/2 is a compromise between the
 * 1/3 of the asymptotic h³ error of the method and the 1/1 to 1/2 that the estimate shows in practice, where the components that are nearly
 * stiff over the step (the cells of the edge barrier, the kinks of a crash) dominate it; with 1/3 the controller overshoots and a quarter of
 * the steps were rejected. The controller has no memory besides h itself, which is what the checkpoint of the model records. (A PI
 * controller, Gustafsson 1991, was tried: the error jumps between a step that ends at an output time and the next one, and the
 * proportional term then makes h alternate.)
 */
export interface StepControl {
  safety: number; facMin: number; facMax: number;
}
export const STEP_CONTROL: StepControl = { safety: 0.9, facMin: 0.2, facMax: 2 };
const ERR_FLOOR = 1e-10;

/** Factor for the step after an accepted step (err ≤ 1); afterReject: this step was repeated after a rejection or a failure */
export function acceptedFactor(err: number, afterReject: boolean, c: StepControl = STEP_CONTROL): number {
  const fac = Math.min(c.facMax, Math.max(c.facMin, c.safety * Math.pow(Math.max(err, ERR_FLOOR), -0.5)));
  return afterReject ? Math.min(fac, 1) : fac;
}

/**
 * Factor for the retry after a rejected step (err > 1; not finite: the smallest factor): the step at which the error would be `safety`
 * if it followed err ∝ h^order. The first retry has no measurement and takes order 1, which reaches the tolerance from a moderate excess
 * in one repetition where the error depends weakly on h; a second retry uses the exponent that the two attempts show (errorExponent).
 */
export function rejectedFactor(err: number, order = 1, c: StepControl = STEP_CONTROL): number {
  if (!Number.isFinite(err)) return c.facMin;
  return Math.min(0.9, Math.max(c.facMin, Math.pow(c.safety / err, 1 / order)));
}

/**
 * The local exponent p of err ∝ h^p from two attempts at the same step (h₁ > h₂, err₁ > err₂), limited to [0.3, 3]: the error estimate of
 * the transport step follows h³ only for smooth solutions; the cells of the edge barrier and the kinks of a crash make it much flatter.
 * 1 if the two attempts do not show a decrease.
 */
export function errorExponent(h1: number, err1: number, h2: number, err2: number): number {
  if (!(h1 > h2 && err1 > err2 && err2 > 0)) return 1;
  return Math.min(3, Math.max(0.3, Math.log(err1 / err2) / Math.log(h1 / h2)));
}
