/**
 * Fuelling command of the 0D density controller (lane ws2d).
 *
 * The plasma inventory is a first-order lag with the particle-loss rate L = 1/tau_p and the burn B,
 *
 *     dn/dt = S_in - n L - B ,
 *
 * fed through an actuator that is itself a first-order lag: the valve, ionisation and delivery of the fuelling method (gas 0.25 s,
 * pellets 30 ms, beams 50 ms), with its own state S_in (`Sfuel` of the model). A proportional command on n - n_set drives that chain
 * with a loop gain of k_p tau_act = 6 tau_act / tau_p, which is 4 to 5 for gas: the characteristic polynomial
 * tau_act s^2 + (1 + tau_act L) s + k_p has the damping ratio zeta = (1 + tau_act L) / (2 sqrt(tau_act k_p)) = 0.4, so every step in the
 * demand or in the loss rate (an NTM that starts and stops, an L-H transition) rings with about 25 % overshoot, and the density passed a
 * set-point of 0.96 n_G on to the Greenwald limit (DIII-D at 0.98e20 m^-3: an NTM dips the density by 14 %, the recovery overshoots by
 * 4.5 % and disrupts at 1.9 s, while 0.97e20 survives and 1.05e20 by luck). The command below is the standard two-degrees-of-freedom
 * design for this structure:
 *
 *  - feed-forward of the losses the plasma has NOW: the flow that holds the density constant is the delivered flow minus the present
 *    rate of change (`losses = flowIn - dn/dt`, the loss and burn terms of the balance above together with the mean ELM exhaust and
 *    the composition of the plasma, without a model of any of them), and the beams (`flowKnown`) are subtracted from what the
 *    actuator must supply;
 *  - feed-forward of the set-point ramp (`dn_set/dt`, K. J. Astrom and R. M. Murray, "Feedback Systems", Princeton University Press,
 *    2008, section 11.5: two-degrees-of-freedom design), with a lead of half the actuator lag (`RAMP_LEAD`), so that the density
 *    follows the ramp of `n_rampTime` as closely as the proportional command did and stops at the target instead of running past it;
 *  - feedback on the density predicted one actuator time constant ahead, n + tau_act dn/dt, with dn/dt of the balance and the measured
 *    actuator state: the internal-model predictor of O. J. M. Smith, Chem. Eng. Progress 53(5) (1957) 217 (here for a lag instead of a
 *    dead time), which is a derivative term on the measurement (K. J. Astrom and T. Hagglund, "Advanced PID Control", ISA, 2006,
 *    section 3.4). The polynomial becomes tau_act s^2 + (1 + tau_act (L + k_p)) s + k_p, zeta = (1 + tau_act (L + k_p)) /
 *    (2 sqrt(tau_act k_p)) = 1.5 for the same gain: the loop no longer rings;
 *  - the command is limited to [0, S_max]. There is no integrator, so nothing can wind up (K. J. Astrom and L. Rundqwist, "Integrator
 *    windup and how to avoid it", Proc. American Control Conference, Pittsburgh, 1989, 1693); the only memory is the actuator state,
 *    which the predictor sees, and the feed-forward of the present losses takes the place of the integral action (no droop).
 *
 * The overshoot that is left is that of the lag itself: after a drop of the loss rate the actuator still delivers the old flow for
 * about tau_act, which no command can undo (a valve closed at once still leaves the flow decaying as exp(-t/tau_act)), together with the
 * discrete ELM and sawtooth exhaust. A stochastic near-limit band therefore remains: a set-point whose line average is within about 2 % of
 * n_G can still touch the limit, seed- and schedule-dependent (regress/densityControl.test.ts pins the documented outcomes). The
 * controller removes the systematic overshoot, not the band: a set-point near n_G is not guaranteed safe.
 */
export interface FuelCommandInput {
  /** commanded density [m^-3] and its rate of change (the ramp of the set-point) [m^-3 s^-1] */
  nSet: number;
  dnSet: number;
  /** electron density of the plasma [m^-3] and its rate of change now, including the mean exhaust of the ELMs [m^-3 s^-1] */
  ne: number;
  dn: number;
  /** electrons per second and volume that the actuator delivers now (its state times the efficiency of the method) [m^-3 s^-1] */
  flowIn: number;
  /** electrons per second and volume that the controller does not command (beam fuelling) [m^-3 s^-1] */
  flowKnown: number;
  /** proportional gain [1/s] and lag of the actuator [s] */
  kp: number;
  tauAct: number;
  /** electrons in the plasma per unit of commanded flow (efficiency of the method, charge of the fuel ions), and the largest command [m^-3 s^-1] */
  gain: number;
  Smax: number;
}

/**
 * Lead of the set-point ramp in units of the actuator lag. A full lead (1) follows a 1 s ramp to within 3 % of the final density but
 * overshoots the end of a 0.3 s ramp (MAST-U) by 3 %, because the flow that carried the ramp is still on its way when the set-point
 * stops; half a lead trails by 11 % (the proportional command by 10 %) and does not overshoot at any ramp time (linear loop of the
 * tests, DIII-D numbers).
 */
export const RAMP_LEAD = 0.5;

/** Fuelling command S_cmd [m^-3 s^-1] (before the efficiency of the method), limited to [0, S_max]. */
export function fuelCommand(p: FuelCommandInput): number {
  // the losses of the plasma now: what the delivered flow does not add to the density
  const losses = p.flowIn + p.flowKnown - p.dn;
  // the density one actuator time constant ahead, against the set-point ahead by the same lead: on a ramp the predicted error is
  // zero and the flow is that of the ramp (dn_set/dt)
  const nPred = p.ne + p.tauAct * p.dn;
  const demand = p.kp * (p.nSet + RAMP_LEAD * p.tauAct * p.dnSet - nPred) + losses + p.dnSet - p.flowKnown;
  return Math.max(0, Math.min(p.Smax, demand / p.gain));
}
