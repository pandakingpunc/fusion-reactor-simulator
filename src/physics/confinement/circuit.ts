/**
 * Plasma circuit of a tokamak (v4.0, lane ws6c): inductances, loop voltage, the non-inductive (bootstrap) current fraction of the 0D model
 * and the flux (volt-second) accounting that the 0D and the 1.5D models share.
 *
 * Circuit equation. The plasma is a one-turn secondary of the transformer of the solenoid. Its energy balance (Poynting's theorem for the
 * poloidal field of the plasma; Romero and JET-EFDA Contributors, Nucl. Fusion 50 (2010) 115002, eqs. (13), (20)-(27)) is
 *
 *     V_B I = dW/dt + V_R I,    W = (1/2) L_i I^2,    V_R I = integral of E.j dV  (the power that leaves the field as heat and as work on
 *                                                                                    the non-inductive current),
 *
 * with V_B the loop voltage at the plasma boundary, V_R the resistive voltage and L_i the internal inductance (l_i(3) = 2 L_i / (mu0 R)).
 * With a non-inductive current I_ni the resistive voltage is V_R = R_p (I - I_ni) (Ohm's law E = eta (j - j_ni)): for the same current a
 * non-inductive fraction f_NI = I_ni / I_p lowers the loop voltage by 1 - f_NI. Integrating over the pulse the flux drawn through the
 * plasma boundary splits into the resistive and the inductive flux,
 *
 *     Psi_B = Int V_B dt = Psi_res + Psi_ind,   Psi_res = Int V_R dt,   Psi_ind = Int (1/I) d(L_i I^2 / 2)/dt dt = L_i I - (1/2) Int I dL_i,
 *
 * and the flux the solenoid and the PF coils must supply is, with the external inductance L_e of the plasma ring (the flux of the
 * plasma's own current outside the last surface, which the coils also have to overcome),
 *
 *     Psi_CS = L_e I + Psi_B                      (Romero 2010 eqs. (25)-(32): (L_e + L_i) I + M I_PF = Psi_res + (1/2) Int I dL_i).
 *
 * The current ramp-up before t = 0 of a run that starts at the full current is not simulated: its flux is estimated with the Ejima
 * relation for the resistive part (Ejima et al., Nucl. Fusion 22 (1982) 1313; Psi_res = C_E mu0 R I_p) and L_i I for the inductive
 * part (the inductance of the current that exists at t = 0; APPROXIMATION: l_i constant over the ramp).
 *
 * Ejima coefficient. C_E is the resistive flux consumed in the current ramp in units of mu0 R I_p. What the literature gives: the
 * experiments are at 0.3 to 0.4 (Ejima et al. 1982 for Doublet III, who introduced the relation; 0.35 on NSTX with heating in the ramp;
 * heating lowers C_E by lowering the resistivity), the ITER design value is 0.45 ("for design purposes ... 0.45 mu0 R I_p": ITER Physics
 * Basis, chapter 8 "Plasma operation and control", Nucl. Fusion 39 (1999) 2577, a conservative design number) and the PROCESS systems
 * code uses 0.4 (`ejima_coeff`; Kovari et al., Fusion Eng. Des. 89 (2014) 3054 for the code). The default here is 0.4: the upper end of
 * what is measured and the value of the reference systems code, which is the comparison the systems models are checked against; a design
 * that follows the ITER design practice passes 0.45 (`systems.cs.ejima`; the ramp flux of a 15 MA ITER changes by 2 %).
 * (The reference given in the task text for the ITER range, Gribov et al., Nucl. Fusion 55 (2015) 073021, is "Plasma vertical
 * stabilisation in ITER" and contains no flux accounting: it is not a source of any number here.)
 *
 * The 0D model has no radial current profile: its loop voltage is the one of a steady current, V = (1 - f_NI) P_oh / I_p with the
 * Joule power of the full current (`heating.ohmicPower`; the 0D ohmic heating itself is left as it was: it does not carry the factor
 * (1 - f_NI)^2 that a non-inductive current puts on the Joule power of the inductive part), the bootstrap fraction from the Wilson fit (below),
 * and no inductive voltage (I_p and l_i are constant except in a disruption). Its flux is the integral of that voltage over the frames plus
 * the ramp-up estimate above (systems/csFlux.ts).
 */
import { C } from '../constants';

const MU0 = C.mu0;

/** Ejima coefficient of the resistive flux of the current ramp-up in units of mu0 R I_p (see the header for the values in the literature) */
export const EJIMA_COEFFICIENT = 0.4;

/** l_i(3) of the 0D circuit without a value from the profile model: the ITER inductive flat-top value (Hawryluk et al., Nucl. Fusion 49 (2009) 065012; Jackson et al., Nucl. Fusion 48 (2008) 125002) */
export const LI_DEFAULT = 0.85;

/**
 * External inductance of the plasma ring [H]: L_e = mu0 R (ln(8 R / (a sqrt(kappa))) - 2) (Wesson, "Tokamaks", 4th ed., Oxford UP
 * 2011, ch. 3, for a circular cross-section; the elongation enters through a sqrt(kappa), as in the ITER physics design guidelines,
 * Uckan et al., ITER Documentation Series No. 10, IAEA 1990). The exact value depends weakly on the flux gradient at the boundary
 * (Hirshman and Neilson, Phys. Fluids 29 (1986) 790).
 */
export function externalInductance(R: number, a: number, kappa: number): number {
  return MU0 * R * (Math.log((8 * R) / (a * Math.sqrt(kappa))) - 2);
}

/** Internal inductance [H] of a plasma with the normalised internal inductance l_i(3) (l_i = 2 L_i / (mu0 R)): L_i = mu0 R l_i / 2 */
export function internalInductance(R: number, li: number): number {
  return 0.5 * MU0 * R * li;
}

/** Plasma inductance L_p = L_e + L_i [H] */
export function plasmaInductance(R: number, a: number, kappa: number, li: number): number {
  return externalInductance(R, a, kappa) + internalInductance(R, li);
}

/** Resistive flux of the current ramp-up [V s]: C_E mu0 R I_p (Ejima et al. 1982) */
export function ejimaFlux(R: number, Ip_A: number, ejima = EJIMA_COEFFICIENT): number {
  return ejima * MU0 * R * Ip_A;
}

/**
 * Non-inductive current fraction of the bootstrap current from the fit of H. R. Wilson, "Bootstrap current scaling in tokamaks",
 * Nucl. Fusion 32 (1992) 257 (a least-squares fit to 3000 numerical equilibria, mean error 3.6 %, largest 20 %):
 *
 *     I_bs / I_p = beta_p sqrt(eps) sum_i a_i(alpha_J) b_i(alpha_p, alpha_T, eps),  Z_eff = 1,
 *
 * with the pressure, temperature and current-density profile exponents (alpha_p, alpha_T, alpha_J of (1 - rho^2)^alpha) turned into the exponents
 * of the fit through the q profile (q_0, q_95), beta_p = 2 mu0 <p> / <B_p>^2 the thermal poloidal beta and eps = a / R. The coefficients
 * are transcribed from the implementation of the PROCESS systems code (`bootstrap_fraction_wilson`, UKAEA; the code cites Wilson 1992
 * and the AEA FUS 172 European reactor study); they are reproduced here without change. Returns 0 for a profile the fit is not defined for
 * (q_0 >= q_95 or an exponent that is not positive), not a NaN.
 */
export function bootstrapFractionWilson(alphaJ: number, alphaP: number, alphaT: number, betaPth: number, q0: number, q95: number, R: number, a: number): number {
  if (!(alphaJ > 0 && alphaP > 0 && alphaT > 0 && q0 > 0 && q95 > q0 && betaPth >= 0 && R > a && a > 0)) return 0;
  const term1 = Math.log(0.5);
  const term2 = Math.log(q0 / q95);
  const termp = 1 - Math.pow(0.5, 1 / alphaP), termt = 1 - Math.pow(0.5, 1 / alphaT), termj = 1 - Math.pow(0.5, 1 / alphaJ);
  const alfp = term1 / Math.log(Math.log((q0 + (q95 - q0) * termp) / q95) / term2);
  const alft = term1 / Math.log(Math.log((q0 + (q95 - q0) * termt) / q95) / term2);
  const aj = term1 / Math.log(Math.log((q0 + (q95 - q0) * termj) / q95) / term2);
  if (!(Number.isFinite(aj) && Number.isFinite(alfp) && Number.isFinite(alft)) || aj < 0) return 0;
  const z = 1;
  const r2 = R + a, r1 = R - a;
  const eps = (r2 - r1) / (r2 + r1);
  const saj = Math.sqrt(aj);
  const A = [
    1.41 * (1 - 0.28 * saj) * (1 + 0.12 / z),
    0.36 * (1 - 0.59 * saj) * (1 + 0.8 / z),
    -0.27 * (1 - 0.47 * saj) * (1 + 3 / z),
    0.0053 * (1 + 5 / z),
    -0.93 * (1 - 0.34 * saj) * (1 + 0.15 / z),
    -0.26 * (1 - 0.57 * saj) * (1 - 0.27 * z),
    0.064 * (1 - 0.6 * aj + 0.15 * aj * aj) * (1 + 7.6 / z),
    -0.0011 * (1 + 9 / z),
    -0.33 * (1 - aj + 0.33 * aj * aj),
    -0.26 * (1 - 0.87 / saj - 0.16 * aj),
    -0.14 * (1 - 1.14 / saj - 0.45 * saj),
    -0.0069,
  ];
  const se = Math.sqrt(eps);
  const B = [1, alfp, alft, alfp * alft, se, alfp * se, alft * se, alfp * alft * se, eps, alfp * eps, alft * eps, alfp * alft * eps];
  let s = 0;
  for (let i = 0; i < 12; i++) s += A[i] * B[i];
  const f = se * betaPth * s;
  return Number.isFinite(f) ? Math.max(f, 0) : 0;
}

/** The resistive, inductive and total flux of a pulse [V s] and the loop voltage that belongs to a state of the circuit */
export interface CircuitFlux {
  /** external and internal inductance of the plasma ring [H] */
  L_e: number;
  L_i: number;
  /** flux drawn from the solenoid and the PF coils since the start of the ramp-up, including the ramp-up [V s] */
  psiUsed: number;
  /** its resistive and inductive parts [V s] (psiUsed = psiRes + psiInd) */
  psiRes: number;
  psiInd: number;
}

/**
 * The flux accounting of a circuit that has integrated the boundary loop voltage `psiB` [V s] and its resistive part `psiR` from a start
 * at the plasma current `Ip0` with the internal inductance `li0` (the ramp-up before that start is the Ejima estimate), at the
 * current `Ip` and geometry (R, a, kappa) of now. The identity Psi_CS = L_e I + Psi_B (header) with the resistive flux Psi_res = C_E mu0 R I_p0
 * + Int V_R dt gives Psi_ind = Psi_CS - Psi_res.
 */
export function circuitFlux(p: { R: number; a: number; kappa: number; Ip: number; Ip0: number; li0: number; ejima: number; psiB: number; psiR: number }): CircuitFlux {
  const L_e = externalInductance(p.R, p.a, p.kappa);
  const L_i0 = internalInductance(p.R, p.li0);
  const psiUsed = L_e * p.Ip + L_i0 * p.Ip0 + ejimaFlux(p.R, p.Ip0, p.ejima) + p.psiB;
  const psiRes = ejimaFlux(p.R, p.Ip0, p.ejima) + p.psiR;
  return { L_e, L_i: L_i0, psiUsed, psiRes, psiInd: psiUsed - psiRes };
}

/** Parameters of the 0D circuit (fixed for the run) */
export interface CircuitParams {
  R: number; a: number; kappa: number;
  /** profile exponents of the 0D model: n ~ (1 - rho^2)^alpha_n, T ~ (1 - rho^2)^alpha_T */
  alphaN: number; alphaT: number;
}

/** The state of the 0D plasma the circuit is evaluated at */
export interface CircuitState {
  /** plasma current [A] */
  Ip: number;
  /** thermal poloidal beta (limits.betaPoloidal of the thermal pressure) and q95 */
  betaPth: number;
  q95: number;
  /** Joule power of the full current [W] (heating.ohmicPower) */
  P_oh: number;
}

/**
 * The 0D circuit: the bootstrap fraction (Wilson) and the loop voltage of a steady current with a non-inductive fraction. No state: the flux of
 * a run is the integral of the loop voltage over its frames plus the ramp-up (`fluxFromHistory`, `fluxBudget` of systems/csFlux.ts; a cumulative
 * flux in the model would be one more component of the state vector of the integrator, whose error norm would change with it, and a
 * record that changes at every step, which the FSAL reuse of the kernel takes for a changed model).
 */
export class PlasmaCircuit {
  constructor(readonly p: CircuitParams) {}

  /** bootstrap fraction of the pressure state: thermal poloidal beta `betaPth` (limits.betaPoloidal), q_0 = 1, Wilson 1992 */
  fBootstrap(betaPth: number, q95: number): number {
    const p = this.p;
    const q0 = 1;
    return bootstrapFractionWilson(Math.max(q95 / q0 - 1, 1e-3), p.alphaN + p.alphaT, p.alphaT, betaPth, q0, q95, p.R, p.a);
  }

  /** loop voltage [V] of the Joule power P_oh [W] of the full current I [A] with the non-inductive fraction f_NI (clamped to 0..1) */
  loopVoltage(P_oh: number, Ip: number, fNI: number): number {
    return Ip > 0 ? ((1 - Math.min(Math.max(fNI, 0), 1)) * P_oh) / Ip : 0;
  }

  /**
   * The keys the 0D model publishes: `f_bs` (Wilson), `f_cd` (0: the 0D model has no current drive), `f_NI` and `V_loop` [V]. `normal` is false
   * in the quench phases of a disruption, when the current is not a steady one and the loop voltage is the inductive voltage of the quench, which
   * the circuit does not model: it is then 0.
   */
  diagnostics(s: CircuitState, normal = true): Record<string, number> {
    const fbs = this.fBootstrap(s.betaPth, s.q95);
    return { f_bs: fbs, f_cd: 0, f_NI: fbs, V_loop: normal ? this.loopVoltage(s.P_oh, s.Ip, fbs) : 0 };
  }
}
