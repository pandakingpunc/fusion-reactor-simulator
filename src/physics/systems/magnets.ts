/**
 * Magnet technologies and the TF coil check used by the models at start-up (systems-lite, lane ws7b).
 * The stress numbers come from the PROCESS-style analysis of `tfCoil.ts`.
 */
import { Geometry } from '../geometry';
import { MagnetTech } from '../types';
import { TFCoilOptions, TFCoilResult, tfCoil } from './tfCoil';

/**
 * Magnet technologies: maximum field on the conductor and allowable stress of the TF coil structure, cryogenic
 * electric power per watt of heat removed at the operating temperature, relative cost.
 * Sources: ITER TF (Nb3Sn) 11.8 T peak field; SPARC (REBCO) about 20 T (Creely 2020); JET copper TF, a pulsed coil of about 8 T
 * (3.45 T on axis); NbTi 8-9 T at 4.2 K (JT-60SA 5.65 T). Stress: structural steel (316LN) about 660 MPa allowable (ITER design).
 * `cryo_W_per_W`: 300 W/W at 4.5 K and 40 W/W at 20 K, 20 % and 34 % of the Carnot efficiency (see cryo.ts).
 */
export const MAGNET_TECH: Record<MagnetTech, { Bmax_coil: number; stress_MPa: number; label: string; cryo_W_per_W: number; cost_rel: number }> = {
  Cu: { Bmax_coil: 9.0, stress_MPa: 300, label: 'Copper (water-cooled, pulsed)', cryo_W_per_W: 0, cost_rel: 0.4 },
  NbTi: { Bmax_coil: 8.5, stress_MPa: 660, label: 'NbTi superconductor (4.5 K)', cryo_W_per_W: 300, cost_rel: 0.8 },
  Nb3Sn: { Bmax_coil: 13.0, stress_MPa: 660, label: 'Nb3Sn superconductor (4.5 K, ITER)', cryo_W_per_W: 300, cost_rel: 1.0 },
  REBCO: { Bmax_coil: 23.0, stress_MPa: 800, label: 'REBCO HTS (20 K, SPARC/ARC)', cryo_W_per_W: 40, cost_rel: 1.6 },
};

export interface MagnetCheck {
  /** peak field at the outer surface of the inboard TF leg [T] */
  B_coil: number;
  B_max: number;
  /** Tresca stress of the TF coil structure at the inboard midplane [MPa] (was a thin-ring estimate before v4.0) */
  stress_MPa: number;
  stress_limit: number;
  quench: boolean;
  overstress: boolean;
  /** magnetic energy of the TF set [GJ] */
  storedEnergy_GJ: number;
  /** the analysis behind the stress and the energy (winding pack, forces, case and winding-pack stress, masses) */
  tf: TFCoilResult;
}

/**
 * Peak field, stress and stored energy of the TF coil.
 *   B_coil = B0 R / R_coil,  R_coil = R - a - gap  (outer surface of the inboard leg: the 1/R fall of the field)
 * The stress is the Tresca stress of the PROCESS-style two-layer analysis (tfCoil.ts) of the inboard leg of thickness
 * `coilThickness`, which replaced the thin-ring estimate sigma = B^2 / (2 mu0) (R_coil / t) 0.5 (82 MPa for ITER, far below the
 * several hundred MPa of the real coils, because it neglected the vertical tension and the load sharing of case and winding
 * pack). The quench check depends on B_coil only, as before.
 */
export function checkMagnet(g: Geometry, B0: number, tech: MagnetTech, gap: number, coilThickness: number, opts: TFCoilOptions = {}): MagnetCheck {
  const spec = MAGNET_TECH[tech];
  const Rcoil = Math.max(g.R - g.a - gap, 0.05);
  const Bc = (B0 * g.R) / Rcoil;
  const tf = tfCoil({ R: g.R, a: g.a, kappa: g.kappa, B0, tech, gap_m: gap, coilThickness_m: coilThickness, limit_MPa: spec.stress_MPa, ...opts });
  return {
    B_coil: Bc, B_max: spec.Bmax_coil, stress_MPa: tf.tresca_MPa, stress_limit: spec.stress_MPa,
    quench: Bc > spec.Bmax_coil, overstress: tf.overstress, storedEnergy_GJ: tf.W_J / 1e9, tf,
  };
}
