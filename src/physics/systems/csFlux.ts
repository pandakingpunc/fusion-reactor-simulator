/**
 * Central solenoid flux-swing (volt-second) budget (systems-lite, lane ws7b).
 *
 * Required flux of an inductive pulse = current ramp-up (inductive + resistive) + flat-top burn:
 *  - inductive: Psi_ind = L_p I_p with the plasma self-inductance L_p = mu0 R [ln(8 R / (a sqrt(kappa))) - 2 + l_i / 2]
 *    (Wesson, "Tokamaks", 4th ed., Oxford UP 2011, ch. 3: circular cross-section; the elongation enters through a sqrt(kappa) as
 *    in the ITER physics design guidelines, Uckan et al., ITER Documentation Series No. 10, IAEA 1990);
 *  - resistive start-up: Psi_res = C_E mu0 R I_p (Ejima et al., Nucl. Fusion 22 (1982) 1313), C_E = 0.4 by default (the PROCESS value;
 *    the ITER design value is 0.45 and the experiments are at 0.3-0.4: the sources and the reasons for the default are in
 *    confinement/circuit.ts, where the plasma circuit lives; `FluxInput.ejima` or `systems.cs.ejima` sets it);
 *  - burn: Psi_burn = integral V_loop dt over the flat top, V_loop the loop voltage of the model's history (both models publish it) or,
 *    without it, P_ohmic / I_p.
 *
 * Capability of a solenoid of inner radius r_i and outer radius r_o with uniform current density and peak bore field B_max
 * (an infinitely long solenoid; field B_max at +swing and -B_max at the end of the pulse, f_swing = 1):
 *   Psi_CS = 2 f_swing (pi / 3) (r_o^2 + r_o r_i + r_i^2) B_max
 * (derivation: B(r) = mu0 J (r_o - r) in the winding and B_i = mu0 J (r_o - r_i) in the bore; the flux through the loop is
 * (pi / 3) B_i (r_o^2 + r_o r_i + r_i^2)). For the ITER CS (r_i = 1.3 m, r_o = 2.08 m, 13 T) this gives 237 V s against the
 * 266.6 V s quoted for it (J.H. Schultz et al., "The ITER Central Solenoid", MIT Plasma Science and Fusion Center, 2005; General Atomics
 * ITER CS booklet, 2021: 13 T at 40 kA; the total requirement of 277 V s is met by the CS together with the PF coils).
 *
 * Hook of the current/flux models (WS6c; both the 0D and the 1.5D model publish these keys since v4.0): a model that integrates the loop
 * voltage publishes it in the history frames, `V_loop` [V] (then the burn flux is its time integral instead of P_ohmic / I_p) and
 * `psi_used` [V s], the cumulative flux drawn from the solenoid (then it is the requirement of the whole pulse) with its resistive and
 * inductive parts `psi_res` and `psi_ind`; or pass a `FluxMeasurement` to `fluxBudget`. Every measured quantity overrides the estimate
 * of the same name and the result says so (`source`). How the models account for the flux (loop voltage at the boundary, Poynting
 * decomposition into resistive and inductive flux, external inductance, the ramp-up before t = 0) is in confinement/circuit.ts.
 *
 * Achievable pulse length. The flux that is left after the requirement of the simulated pulse allows the flat top to last longer (or,
 * with a shortfall, shorter): `flatTopLimit_s` = the simulated burn window + (available - required) / (mean loop voltage of that window).
 */
import { C } from '../constants';
import { EJIMA_COEFFICIENT, plasmaInductance } from '../confinement/circuit';
import type { HistoryFrame, MagnetTech } from '../types';

export { EJIMA_COEFFICIENT, plasmaInductance };

const MU0 = C.mu0;
/**
 * Design-typical smeared current density of the CS winding at the peak field [A/m^2]: the radial thickness of the solenoid is
 * d = B_max / (mu0 J), so that a higher J leaves more bore. Nb3Sn: 1.36e7 A/m^2, the CS current density limit of the PROCESS DEMO
 * model at the end of the flat top (0.25 of the critical current density; Kovari et al., Fusion Eng. Des. 104 (2016) 9, table 5;
 * the ITER CS at 13 T and 0.78 m thick has 1.33e7 A/m^2). The other values are design-typical (APPROXIMATION).
 */
export const CS_CURRENT_DENSITY: Record<MagnetTech, number> = { Cu: 5e6, NbTi: 1.0e7, Nb3Sn: 1.36e7, REBCO: 2.5e7 };
/** gap between the CS and the TF nose, plus the CS pre-compression structure [m] (PROCESS DEMO build: 0.05 + 0.065 m) */
export const CS_TF_GAP = 0.115;
/** smeared density of the CS winding (conductor, jacket, insulation) [kg/m^3] */
export const CS_DENSITY = 8000;
/** history keys a flux model can publish */
export const FLUX_HISTORY_KEYS = { loopVoltage: 'V_loop', psiUsed: 'psi_used', psiRes: 'psi_res', psiInd: 'psi_ind' } as const;

/** What a current/flux model has measured; each present field overrides the estimate of the same name. All in V s. */
export interface FluxMeasurement {
  psiInductive_Vs?: number;
  psiResistive_Vs?: number;
  psiBurn_Vs?: number;
  /** flux drawn from the solenoid over the whole pulse; replaces the sum of the three parts */
  psiTotal_Vs?: number;
  /** flux supplied by the PF coils */
  psiPF_Vs?: number;
}

/** Flux swing of a solenoid [V s], see the header. */
export function csFluxSwing(r_i: number, r_o: number, B_max: number, fSwing = 1): number {
  return 2 * fSwing * (Math.PI / 3) * (r_o * r_o + r_o * r_i + r_i * r_i) * B_max;
}

export interface FluxInput {
  R: number;
  a: number;
  kappa: number;
  Ip_MA: number;
  /** internal inductance l_i(3); default 0.85 (ITER flat top) */
  li?: number;
  tech: MagnetTech;
  /** outer radius of the CS [m] (from the TF inner radius minus the CS-TF gap) */
  r_outer_m: number;
  /** height of the solenoid [m] (stored energy and mass only) */
  height_m: number;
  /** smeared current density of the CS winding at the peak field [A/m^2]; default by technology (`CS_CURRENT_DENSITY`) */
  currentDensity_Am2?: number;
  /** peak field of the CS conductor [T] */
  B_max_T: number;
  /** fraction of the full +B to -B swing that is used (default 1) */
  swingFraction?: number;
  /** flux from the PF coils [V s] (default 0: the CS alone) */
  pfFlux_Vs?: number;
  /** burn: mean resistive loop voltage [V] and duration [s] */
  burn?: { Vloop_V: number; duration_s: number };
  /** Ejima coefficient of the resistive flux of the ramp-up (default EJIMA_COEFFICIENT) */
  ejima?: number;
}

export interface FluxBudget {
  L_p_H: number;
  psiInductive_Vs: number;
  psiResistive_Vs: number;
  psiBurn_Vs: number;
  /** total flux required from the CS and PF coils [V s] */
  psiRequired_Vs: number;
  /** flux swing of the CS [V s], of the PF coils, and the sum */
  psiCS_Vs: number;
  psiPF_Vs: number;
  psiAvailable_Vs: number;
  /** (available - required) / required; negative: the pulse cannot be driven */
  margin: number;
  /** burn duration the flux left after everything but the burn window allows at the given loop voltage [s] (Infinity without a loop voltage) */
  burnSupported_s: number;
  /** length of the flat top the flux allows: the burn window of the simulated pulse + (available - required) / its mean loop voltage, at least 0 (Infinity without a burn window or a loop voltage) */
  flatTopLimit_s: number;
  r_i: number;
  r_o: number;
  B_max_T: number;
  /** smeared current density of the CS winding at the peak field [A/m^2] */
  J_cs_Am2: number;
  /** magnetic energy of the CS at the peak field [J] and its mass [kg] */
  W_cs_J: number;
  mass_kg: number;
  /** 'estimate' or 'measured' (which of the parts came from the hook) */
  source: 'estimate' | 'measured';
  notes: string[];
}

/** Flux budget of an inductive pulse. `measured` is the WS6c hook (see the header). */
export function fluxBudget(inp: FluxInput, measured?: FluxMeasurement): FluxBudget {
  const li = inp.li ?? 0.85;
  const Ip = inp.Ip_MA * 1e6;
  const notes: string[] = [];
  const Lp = plasmaInductance(inp.R, inp.a, inp.kappa, li);
  let psiInd = Lp * Ip;
  let psiRes = (inp.ejima ?? EJIMA_COEFFICIENT) * MU0 * inp.R * Ip;
  let psiBurn = inp.burn ? inp.burn.Vloop_V * inp.burn.duration_s : 0;
  let measuredAny = false;
  if (measured) {
    if (measured.psiInductive_Vs !== undefined) { psiInd = measured.psiInductive_Vs; measuredAny = true; }
    if (measured.psiResistive_Vs !== undefined) { psiRes = measured.psiResistive_Vs; measuredAny = true; }
    if (measured.psiBurn_Vs !== undefined) { psiBurn = measured.psiBurn_Vs; measuredAny = true; }
  }
  let required = psiInd + psiRes + psiBurn;
  if (measured?.psiTotal_Vs !== undefined) { required = measured.psiTotal_Vs; measuredAny = true; }
  const r_o = Math.max(inp.r_outer_m, 0.02);
  // radial thickness from the peak field and the current density (B_i = mu0 J d), at most 95 % of the outer radius
  const dReq = inp.B_max_T / (MU0 * (inp.currentDensity_Am2 ?? CS_CURRENT_DENSITY[inp.tech]));
  if (dReq > 0.95 * r_o) notes.push('the solenoid does not fit at this current density: bore reduced to 5 % of the outer radius');
  const r_i = r_o - Math.min(dReq, 0.95 * r_o);
  const psiCS = csFluxSwing(r_i, r_o, inp.B_max_T, inp.swingFraction ?? 1);
  const psiPF = measured?.psiPF_Vs ?? inp.pfFlux_Vs ?? 0;
  if (measured?.psiPF_Vs !== undefined) measuredAny = true;
  const avail = psiCS + psiPF;
  // the flux of everything but the burn window: the parts of the estimate, or what a measured total holds besides the burn flux
  const rampFlux = measured?.psiTotal_Vs !== undefined ? measured.psiTotal_Vs - psiBurn : psiInd + psiRes;
  const Vl = inp.burn && inp.burn.duration_s > 0 ? inp.burn.Vloop_V : 0;
  const burnSupported = Vl > 0 ? Math.max(avail - rampFlux, 0) / Vl : Infinity;
  const flatTopLimit = Vl > 0 && inp.burn ? Math.max(inp.burn.duration_s + (avail - required) / Vl, 0) : Infinity;
  // CS winding at the peak bore field
  const J = inp.B_max_T / (MU0 * Math.max(r_o - r_i, 1e-6));
  const A = Math.PI * (r_o * r_o - r_i * r_i);
  // magnetic energy: bore B_i^2 / 2 mu0 (pi r_i^2 h) + winding integral of B(r)^2 with B = B_i (r_o - r) / (r_o - r_i)
  const d = r_o - r_i;
  const winding = (2 * Math.PI * inp.height_m / (2 * MU0)) * inp.B_max_T * inp.B_max_T / (d * d)
    * ((r_o * r_o * (r_o * r_o - r_i * r_i)) / 2 - (2 * r_o * (r_o ** 3 - r_i ** 3)) / 3 + (r_o ** 4 - r_i ** 4) / 4);
  const W = ((inp.B_max_T * inp.B_max_T) / (2 * MU0)) * Math.PI * r_i * r_i * inp.height_m + winding;
  notes.push('infinitely long solenoid, uniform current density, +B to -B swing; PF flux 0 unless given');
  if (measuredAny) notes.push('flux terms overridden by the loop voltage and flux accounting of the plasma model (WS6c hook)');
  return {
    L_p_H: Lp, psiInductive_Vs: psiInd, psiResistive_Vs: psiRes, psiBurn_Vs: psiBurn, psiRequired_Vs: required,
    psiCS_Vs: psiCS, psiPF_Vs: psiPF, psiAvailable_Vs: avail, margin: required > 0 ? (avail - required) / required : Infinity,
    burnSupported_s: burnSupported, flatTopLimit_s: flatTopLimit, r_i, r_o, B_max_T: inp.B_max_T, J_cs_Am2: J, W_cs_J: W, mass_kg: A * inp.height_m * CS_DENSITY,
    source: measuredAny ? 'measured' : 'estimate', notes,
  };
}

/**
 * The flux terms a history can provide: `psi_used` (last frame) as the total, and the burn flux as the flux the model accumulated from
 * the first frame at t >= tStart to the last (`psi_used` differences), or, without it, as the integral of `V_loop` (or of P_ohmic / I_p from
 * the standard keys) over the intervals that start at t >= tStart. Returns undefined when the history is shorter than two frames.
 */
export function fluxFromHistory(hist: readonly HistoryFrame[], tStart = 0): { measurement: FluxMeasurement; Vloop_V: number; duration_s: number } | undefined {
  if (hist.length < 2) return undefined;
  const last = hist[hist.length - 1];
  const measurement: FluxMeasurement = {};
  const used = last.d[FLUX_HISTORY_KEYS.psiUsed];
  if (used !== undefined && isFinite(used)) {
    measurement.psiTotal_Vs = used;
    // its resistive and inductive parts, when the model splits it (psi_used = psi_res + psi_ind)
    const res = last.d[FLUX_HISTORY_KEYS.psiRes], ind = last.d[FLUX_HISTORY_KEYS.psiInd];
    if (res !== undefined && isFinite(res)) measurement.psiResistive_Vs = res;
    if (ind !== undefined && isFinite(ind)) measurement.psiInductive_Vs = ind;
  }
  // the burn window from the cumulative flux the model integrates (exact, and free of the step-to-step noise of the loop voltage of a frame)
  if (measurement.psiTotal_Vs !== undefined) {
    const i0 = hist.findIndex((h) => h.t >= tStart);
    const u0 = i0 >= 0 ? hist[i0].d[FLUX_HISTORY_KEYS.psiUsed] : undefined;
    if (i0 >= 0 && i0 < hist.length - 1 && u0 !== undefined && isFinite(u0)) {
      const dur = last.t - hist[i0].t, psi = measurement.psiTotal_Vs - u0;
      measurement.psiBurn_Vs = psi;
      return { measurement, Vloop_V: dur > 0 ? psi / dur : 0, duration_s: dur };
    }
  }
  const hasLoop = hist.some((h) => h.d[FLUX_HISTORY_KEYS.loopVoltage] !== undefined);
  let psi = 0, dur = 0;
  for (let i = 1; i < hist.length; i++) {
    if (hist[i - 1].t < tStart) continue; // whole intervals from tStart on
    const dt = hist[i].t - hist[i - 1].t;
    let V = 0;
    if (hasLoop) V = hist[i].d[FLUX_HISTORY_KEYS.loopVoltage] ?? 0;
    else if ((hist[i].d.Ip ?? 0) > 0.05) V = (hist[i].d.P_oh ?? 0) / hist[i].d.Ip;
    if (isFinite(V)) { psi += V * dt; dur += dt; }
  }
  if (hasLoop) measurement.psiBurn_Vs = psi;
  return { measurement, Vloop_V: dur > 0 ? psi / dur : 0, duration_s: dur };
}
