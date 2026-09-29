/**
 * Event localisation inside a transport step.
 *
 * A threshold event (an ELM when α_ped reaches α_crit, a sawtooth crash when the shear at q = 1 reaches its critical value)
 * used to fire after the first step whose end lay beyond the threshold, so its time was late by up to a step and its rate
 * depended on the step length. The stepper now finds the crossing inside the step and ends the step there
 * (CoupledStepper.advance), so that the crash acts on the profiles at the crossing.
 *
 * The margin of the trigger (EventTrigger.margin, positive beyond the threshold) is a function of the profiles, so it can be
 * evaluated along the step without a new implicit solve: the three states TR-BDF2 computes, at t_n, t_n + γh and t_{n+1}, give
 * the dense output U(θ) = Σ L_j(θ) U_j, the quadratic through them (θ in units of the step), and Brent's method
 * (R. P. Brent, "Algorithms for Minimization without Derivatives", Prentice-Hall 1973, ch. 4; numerics/roots.ts) finds the root
 * of margin(θ) − δ on it. The step is then repeated with the shorter length; if the interpolation missed the crossing the margin
 * at the end of the repeated step is still negative, no event fires, and the next step localises again from there, so an
 * error of the interpolation delays an event by a fraction of a step but never loses it.
 *
 * The event is aimed slightly beyond the crossing (δ), so that the model's own test on the diagnostics of the shortened step,
 * which differ from the interpolated margin by the Picard tolerance, passes.
 */
import { brent } from '../../numerics/roots';
import { TRBDF2_GAMMA } from './trbdf2';

/** Margin beyond the threshold that the event is aimed at (α_ped/α_crit = 1.001; s₁ − s_crit = 0.001) */
export const EVENT_OVERSHOOT = 1e-3;
/** A crossing within this fraction of the end of the step does not shorten it: the step ends beyond the threshold anyway */
export const EVENT_MIN_GAIN = 0.02;
/** The shortest step that an event localisation asks for [s] */
export const EVENT_DT_MIN = 1e-6;

/** Weights of the quadratic through the states at θ = 0, γ and 1 (Lagrange polynomials; they sum to 1) */
export function stageWeights(theta: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const g = TRBDF2_GAMMA;
  out[0] = ((theta - g) * (theta - 1)) / g;
  out[1] = (theta * (theta - 1)) / (g * (g - 1));
  out[2] = (theta * (theta - g)) / (1 - g);
  return out;
}

/**
 * Where in a step (fraction θ of its length) should an event that is triggered when `margin` becomes positive end it?
 *
 * margin(θ) is the trigger margin along the step, m0 = margin(0) and m1 = margin(1) its values at the two ends, thetaReady the
 * earliest fraction at which the event may fire (the end of its refractory period: 0 if it is ready at the start, ≥ 1 if it is
 * not ready within the step). Returns 1 when the step need not be shortened: no crossing, or the end of the step already lies
 * beyond the threshold and the crossing is within EVENT_MIN_GAIN of it. Otherwise the fraction at which the margin reaches
 * `overshoot`, or thetaReady if the margin is beyond it by then (the event fires as soon as it is ready).
 */
export function locateEvent(margin: (theta: number) => number, m0: number, m1: number, thetaReady: number, overshoot = EVENT_OVERSHOOT): number {
  if (!(thetaReady < 1)) return 1;
  const f = (th: number) => margin(th) - overshoot;
  const a = Math.max(thetaReady, 0);
  const fa = a > 0 ? f(a) : m0 - overshoot;
  let theta: number;
  if (fa >= 0) {
    // beyond the target when it becomes ready: it fires as soon as it can, which is at the start of the step if it is ready then
    // (an event overdue at the start fires at the end of the step: nothing to localise)
    if (!(a > 0)) return 1;
    theta = a;
  } else {
    const fb = m1 - overshoot;
    if (!(fb >= 0)) return 1;
    theta = brent((th) => (th === 1 ? fb : f(th)), a, 1, 1e-9, 80);
  }
  return theta > 1 - EVENT_MIN_GAIN ? 1 : theta;
}
