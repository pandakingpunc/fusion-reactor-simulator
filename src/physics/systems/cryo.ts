/**
 * Cryogenic plant (systems-lite, lane ws7b): the heat load on the cold magnets and the electric power of the refrigerator.
 *
 * The heat load follows the model of D. Slack (memo SCMDG 88-5-1-059, LLNL ITER-88-054, Aug. 1988) as implemented in the PROCESS
 * systems code (UKAEA, `power.py` `cryo`; PROCESS also documents "13 % of Carnot" for the ITER plant):
 *   Q_static  = 4.3e-4 W/kg x cold mass + 2.0 W/m^2 x area of the shells covering the TF coils   (conduction and radiation)
 *   Q_nuclear = nuclear heating of the TF coils                                                  (radial build, `radialBuild`)
 *   Q_AC      = 1e3 x E_PF[MJ] / t_pulse  [W]    (pulsed-field losses: 1 kJ per MJ of the stored energy of the PF system and CS, spread over the plasma pulse)
 *   Q_leads   = 13.6e-3 W/A x N_TF x I_turn                                                      (current leads)
 *   Q_misc    = 0.45 x (Q_static + Q_nuclear + Q_AC + Q_leads)                                   (piping, reserves)
 *   Q = Q_static + Q_nuclear + Q_AC + Q_leads + Q_misc
 * and the electric power is P = Q x cryo_W_per_W of the magnet technology (the table `MAGNET_TECH`: 300 W/W at 4.5 K, 40 W/W
 * at 20 K, the wall-plug power per watt removed at the operating temperature). `carnotFraction` reports the fraction of the
 * Carnot efficiency these values imply for a warm end of 293 K (PROCESS: 13 %): 300 W/W at 4.5 K is 20 %, 40 W/W at 20 K is 34 %.
 * Resistive (copper) coils have no cryogenic plant. The heat-load part reproduces the reference values of the PROCESS unit test
 * `test_cryo` (tests/unit/models/test_power.py) exactly; see cryo.test.ts.
 */
import type { MagnetTech } from '../types';

/** heat-load coefficients of the Slack model */
export const CRYO_COEFFS = { staticPerKg: 4.3e-4, staticPerM2: 2.0, acPerMJ: 1e3, leadPerAmp: 13.6e-3, misc: 0.45 } as const;
/** operating temperature of the cold magnets [K] and warm end [K] */
export const CRYO_TEMPERATURE: Record<MagnetTech, number> = { Cu: 293, NbTi: 4.5, Nb3Sn: 4.5, REBCO: 20 };
export const T_WARM = 293;

/**
 * Design length of the plasma pulse of the plant [s] used for the pulsed-field (AC) heat load when the design gives none
 * (`SystemsConfig.pulseLength_s`). The AC load is the energy dissipated per pulse divided by the pulse (PROCESS `power.py` `cryo`:
 * `qac = 1e3 ensxpfm / t_plant_pulse_plasma_present`), so it belongs to the machine and must not follow the length of a simulated
 * shot. APPROXIMATION: the plasma-present pulse of the PROCESS default times (`times_variables`: current ramp-up 30 s, fusion ramp
 * 10 s, flat top 1000 s, ramp-down 15 s), 1055 s. The order of the ITER pulse (400 s burn plus ramps) and well below the 2 h of the EU DEMO
 * (10364 s in the PROCESS unit test); give the pulse of the machine to change it.
 */
export const DEFAULT_PULSE_LENGTH_S = 30 + 10 + 1000 + 15;

/** The pulse length to use: the design value if it is a positive finite number, else the default (never the length of a simulated shot). */
export function plantPulseLength_s(design?: number): number {
  return design !== undefined && Number.isFinite(design) && design > 0 ? design : DEFAULT_PULSE_LENGTH_S;
}

export interface CryoInput {
  tech: MagnetTech;
  /** electric watts per watt removed at the operating temperature */
  wattsPerWatt: number;
  /** cold mass: TF coils, CS and PF coils and their structure [kg] */
  coldMass_kg: number;
  /** area of the shells covering the TF coils [m^2] */
  tfShellArea_m2: number;
  /** nuclear heating of the TF coils [W] */
  nuclearHeating_W: number;
  /** stored energy of the CS and PF system [J] */
  pfEnergy_J: number;
  /** plasma-present pulse length of the plant [s]: a design quantity (DEFAULT_PULSE_LENGTH_S), not the length of a simulated shot */
  pulseLength_s: number;
  nCoils: number;
  turnCurrent_A: number;
}

export interface CryoResult {
  /** heat loads at the operating temperature [W] */
  Q_static_W: number;
  Q_nuclear_W: number;
  Q_ac_W: number;
  Q_leads_W: number;
  Q_misc_W: number;
  Q_total_W: number;
  /** electric power of the cryoplant [MW] */
  P_cryo_MW: number;
  temperature_K: number;
  /** COP in electric W per W at the cold end and the corresponding fraction of the Carnot efficiency */
  wattsPerWatt: number;
  carnotFraction: number;
}

export function cryoPlant(inp: CryoInput): CryoResult {
  if (inp.tech === 'Cu' || inp.wattsPerWatt <= 0) {
    return { Q_static_W: 0, Q_nuclear_W: 0, Q_ac_W: 0, Q_leads_W: 0, Q_misc_W: 0, Q_total_W: 0, P_cryo_MW: 0, temperature_K: CRYO_TEMPERATURE.Cu, wattsPerWatt: 0, carnotFraction: 0 };
  }
  const T = CRYO_TEMPERATURE[inp.tech];
  const Qs = CRYO_COEFFS.staticPerKg * inp.coldMass_kg + CRYO_COEFFS.staticPerM2 * inp.tfShellArea_m2;
  const Qn = Math.max(inp.nuclearHeating_W, 0);
  const Qa = (CRYO_COEFFS.acPerMJ * (inp.pfEnergy_J / 1e6)) / Math.max(inp.pulseLength_s, 1);
  const Ql = CRYO_COEFFS.leadPerAmp * inp.nCoils * inp.turnCurrent_A;
  const Qm = CRYO_COEFFS.misc * (Qs + Qn + Qa + Ql);
  const Q = Qs + Qn + Qa + Ql + Qm;
  return {
    Q_static_W: Qs, Q_nuclear_W: Qn, Q_ac_W: Qa, Q_leads_W: Ql, Q_misc_W: Qm, Q_total_W: Q, P_cryo_MW: (Q * inp.wattsPerWatt) / 1e6,
    temperature_K: T, wattsPerWatt: inp.wattsPerWatt, carnotFraction: carnotFraction(T, inp.wattsPerWatt),
  };
}

/** fraction of the Carnot efficiency of a refrigerator that needs `wattsPerWatt` electric watts per cold watt at T [K] */
export function carnotFraction(T: number, wattsPerWatt: number, Twarm = T_WARM): number {
  return wattsPerWatt > 0 ? (Twarm - T) / (T * wattsPerWatt) : 0;
}
