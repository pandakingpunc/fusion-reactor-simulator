/**
 * The plasma-current programme I_p(t): the boundary condition of the current diffusion equation as a function of time.
 *
 * The enclosed current at the boundary is fixed by I_p (X/F = 2π μ0 I_p/F at ρ̂ = 1, fvsolver.ts CurrentSolver), and a transport
 * stage of the TR-BDF2 step takes it at the end of its interval: I_p(t + γΔt) for the first stage, I_p(t + Δt) for the second, and
 * I_p(t) of the old state for the explicit rate of the trapezoidal stage. Without a programme I_p is the constant of the configuration
 * (`MagneticConfig.Ip_MA`), which the state carries as a scalar, and the model is bit for bit what it was.
 *
 * A programme is a function of t alone (so that a chunked run, a rewind and a replay see the same values). It is given
 *
 *  - as data, `ProfileSettings.IpWaveform`: points [t (s), I_p (MA)] in increasing time, linearly interpolated, held constant before the
 *    first and after the last point (`currentWaveform`); this is part of the configuration and so of the run fingerprint; or
 *  - as a function, `ProfileModules.plasmaCurrent(t) → A`, for a scenario or controller that computes it (not part of the fingerprint:
 *    the caller owns its determinism), which takes precedence.
 *
 * `MagneticConfig.Ip_MA` is what the initial equilibrium is solved for, so it should equal the programme at t = 0; the Grad–Shafranov
 * updates use the current I_p of the state. The disruption's current quench overrides the programme (the state's I_p decays).
 */

/** I_p(t) [A] */
export type CurrentProgramme = (t: number) => number;

/** Lowest plasma current of a programme [A]: the equilibrium and the safety factor need a positive current (as the initial state's 0.05 MA) */
export const IP_PROGRAMME_FLOOR = 0.05e6;

/**
 * The programme through the points [t (s), I_p (MA)], increasing in t: piecewise linear, constant beyond the ends, floored at 0.05 MA.
 * Throws on an empty list, a non-finite number or times that do not increase.
 */
export function currentWaveform(points: ReadonlyArray<readonly [number, number]>): CurrentProgramme {
  if (points.length === 0) throw new Error('current waveform: no points');
  const t = points.map((p) => p[0]), I = points.map((p) => Math.max(p[1] * 1e6, IP_PROGRAMME_FLOOR));
  for (let k = 0; k < points.length; k++) {
    if (!Number.isFinite(points[k][0]) || !Number.isFinite(points[k][1])) throw new Error(`current waveform: point ${k} is not finite`);
    if (k > 0 && !(t[k] > t[k - 1])) throw new Error(`current waveform: the times must increase (point ${k}: ${t[k]} after ${t[k - 1]})`);
  }
  const n = t.length;
  return (x: number): number => {
    if (!(x > t[0])) return I[0];
    if (x >= t[n - 1]) return I[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
    return I[lo] + ((I[hi] - I[lo]) * (x - t[lo])) / (t[hi] - t[lo]);
  };
}
