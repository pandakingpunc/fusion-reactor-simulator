/**
 * TF coil: winding pack, forces and stress of the inboard leg at the midplane (systems-lite, lane ws7b).
 *
 * The stress model follows the PROCESS systems code (UKAEA), superconducting TF coil model `sctfcoil`:
 *  - M. Kovari, F. Fox, C. Harrington, R. Kembleton, P. Knight, H. Lux, J. Morris, "PROCESS": A systems code for
 *    fusion power plants - Part 2: Engineering, Fusion Eng. Des. 104 (2016) 9-20, sect. 2.4, eqs. (31)-(44)
 *    (Part 1, physics: Kovari et al., Fusion Eng. Des. 89 (2014) 3054, is the companion paper), and
 *  - the PROCESS implementation (J. Morris, CCFE, 2014; `plane_stress`, `tf_field_and_force`, `stresscl`), which solves the
 *    same plane-stress problem for two or more layers and the vertical tension of the coil; both routines are reproduced
 *    here to 1e-9 against the reference values of the PROCESS unit tests (see tfCoil.test.ts).
 *
 * Model (all at the inboard-leg midplane, axisymmetric, the coils supported as a vault):
 *  1. Three concentric layers: the steel case nose (inner radius r_c to r_i, no current), the winding pack (r_i to r_o,
 *     smeared homogeneous material carrying the uniform current density J) and the thin plasma-side case (r_o to r_o + 5 % of the
 *     leg thickness, PROCESS `f_dr_tf_plasma_case` = 0.05; Kovari 2016 neglects it, the PROCESS code includes it and the layer
 *     solver reproduces its `plane_stress` reference arrays for that three-layer case). The peak field B_peak = mu0 I_TF / (2 pi r_o)
 *     is at the outer edge of the winding pack; inside it B(r) = mu0 J (r^2 - r_i^2) / (2 r) (Ampere's law, eq. 33) and the
 *     radial Lorentz body force per volume is f = -J B (inward, eq. 31).
 *  2. Plane stress with radial displacement u(r): u'' + u'/r - u/r^2 = alpha r + beta / r (eqs. 36-38), solved in each
 *     layer by u = C1 r + C2 / r + alpha r^3 / 8 + beta r ln(r) / 2 (eq. 39), alpha = mu0 J^2 (1 - nu^2) / (2 E),
 *     beta = -alpha r_i^2 (with the current of the inner layers in general). The two constants of each layer follow from
 *     sigma_r = 0 at the inner and outer surface and continuity of sigma_r and u at the interfaces (four conditions for the two
 *     layers of Kovari 2016), solved by Gaussian elimination.
 *  3. The vertical (axial) stress is the inboard share of the vertical tension divided by the steel area of the case,
 *     conduit and radial plates (eq. 42 and the text below it); the conductor is neglected axially (twisted strands).
 *  4. Tresca (maximum shear) criterion sigma_T = max(|s_r - s_t|, |s_t - s_z|, |s_z - s_r|) (the PROCESS documentation of
 *     the constraint on the case and the winding-pack structure); the von Mises stress is reported as well.
 *     The winding pack is smeared for the solve and unsmeared afterwards: the stress in its steel is the smeared stress
 *     times E_steel / E_effective (PROCESS `stresscl`).
 *
 * Simplifications (APPROXIMATION, all flagged in the result's `notes`): the winding pack is a full annulus (as in PROCESS
 * the side case and the toroidal wedge shape are not resolved); the CS and PF field and the out-of-plane forces are
 * neglected (as in PROCESS); the plasma-side case is counted in the plasma-to-coil gap, i.e. `gap_m` reaches the outer
 * surface of the winding pack, where the peak field is (this is the convention of the earlier thin-ring estimate too), and
 * `coilThickness_m` is the depth from there to the inner surface of the nose.
 *
 * The stress of a single thick ring under body force satisfies the exact equilibrium integral
 * int sigma_theta dr = int r f dr; `tfStressLayers` is exported so that tests can check it and the Lame limits.
 */
import { C } from '../constants';
import { solveDense } from '../numerics/linalg';
import type { MagnetTech } from '../types';

const MU0 = C.mu0;

/** Structure and conductor data of a coil technology: typical design values (APPROXIMATION), overridable per run. */
export interface TFTechSpec {
  /** default number of TF coils (ITER 18, JT-60SA 18, SPARC 18, DEMO 16; copper machines: DIII-D 24, JET 32) */
  nCoils: number;
  /** Young's modulus of the load-bearing structure at operating temperature [Pa] */
  E_struct: number;
  /** Poisson's ratio of the structure */
  nu_struct: number;
  /** density of the structure [kg/m^3] */
  rho_struct: number;
  /** area fraction of the winding pack region that is load-bearing structure (steel jacket, radial plates, side walls; for copper coils the copper) */
  structureFraction: number;
  /** Young's modulus of the compliant part of the winding pack (cable, insulation) transverse to the turn [Pa] */
  E_soft: number;
  /** share of the leg thickness that is solid case nose (the rest is the winding pack) */
  noseFraction: number;
  /** operating current per turn [A] (current-lead heat load); 0 for resistive coils */
  turnCurrent_A: number;
  /** smeared density of the winding pack region [kg/m^3] (conductor, jacket, plates, insulation) */
  rho_wp: number;
  /** where the numbers come from */
  source: string;
}

/**
 * Coil technology data. Structural steel 316LN at 4 K: E = 205 GPa, nu = 0.3, rho = 7930 kg/m^3 (E and nu as the PROCESS
 * defaults `eyoung_steel` = 2.05e11 Pa and `poisson_steel` = 0.3, which Kovari 2016 also states: "Poisson's ratio v is
 * taken as 0.3 in all cases"). Copper: E = 117 GPa, nu = 0.35 (PROCESS `eyoung_copper`, `poisson_copper`), rho = 8960.
 * The compliant winding-pack part (cable in conduit and its glass-epoxy insulation) is taken as 20 GPa, the value the
 * PROCESS documentation quotes for the superconducting TF insulation (ITER DDD 11-2, 2009).
 * The structure area fractions, nose fractions and turn currents are design-typical values: the ITER TF winding pack
 * (7 double pancakes in steel radial plates; 68 kA cable-in-conduit conductor, Mitchell, ITER DDD 11-7 / Fusion Eng. Des.),
 * JT-60SA NbTi (25.7 kA), HTS compact coils with a large steel fraction (SPARC, Creely 2020), copper coils.
 */
export const TF_TECH: Record<MagnetTech, TFTechSpec> = {
  Cu: {
    nCoils: 24, E_struct: 117e9, nu_struct: 0.35, rho_struct: 8960, structureFraction: 0.85, E_soft: 20e9, noseFraction: 0.2,
    turnCurrent_A: 0, rho_wp: 8300, source: 'water-cooled copper coil, glass-epoxy insulation (PROCESS copper data)',
  },
  NbTi: {
    nCoils: 18, E_struct: 205e9, nu_struct: 0.3, rho_struct: 7930, structureFraction: 0.5, E_soft: 20e9, noseFraction: 0.3,
    turnCurrent_A: 25.7e3, rho_wp: 7300, source: 'NbTi cable-in-conduit, 316LN jacket (JT-60SA-like, 25.7 kA)',
  },
  Nb3Sn: {
    nCoils: 18, E_struct: 205e9, nu_struct: 0.3, rho_struct: 7930, structureFraction: 0.55, E_soft: 20e9, noseFraction: 0.35,
    turnCurrent_A: 68e3, rho_wp: 7500, source: 'Nb3Sn cable-in-conduit in steel radial plates (ITER-like, 68 kA)',
  },
  REBCO: {
    nCoils: 18, E_struct: 205e9, nu_struct: 0.3, rho_struct: 7930, structureFraction: 0.8, E_soft: 20e9, noseFraction: 0.4,
    turnCurrent_A: 40e3, rho_wp: 7800, source: 'HTS cable with a large steel fraction (SPARC-like compact coil)',
  },
};

/** thickness of the plasma-side case as a share of the leg thickness (PROCESS `f_dr_tf_plasma_case` default) */
export const PLASMA_CASE_FRACTION = 0.05;

/** Optional per-run TF coil inputs; every field defaults to the technology value in `TF_TECH`. */
export interface TFCoilOptions {
  /** number of TF coils */
  nCoils?: number;
  /** share of the inboard-leg thickness that is solid case nose (0 to 0.9) */
  noseFraction?: number;
  /** load-bearing area fraction of the winding pack region (0.05 to 1) */
  structureFraction?: number;
  /** operating current per turn [A] */
  turnCurrent_A?: number;
  /** share of the vertical tension carried by the inboard leg: 0.5 for a Princeton-D coil, about 0.65 for a picture frame (PROCESS `f_vforce_inboard`) */
  verticalInboardFraction?: number;
}

export interface TFCoilInput extends TFCoilOptions {
  /** major radius [m] */
  R: number;
  /** minor radius [m] */
  a: number;
  /** elongation */
  kappa: number;
  /** toroidal field on axis [T] */
  B0: number;
  tech: MagnetTech;
  /** distance from the plasma boundary to the outer surface of the inboard winding pack [m] */
  gap_m: number;
  /** radial thickness of the inboard leg (nose case plus winding pack) [m] */
  coilThickness_m: number;
  /** stress allowable [Pa] to compare with (the technology limit of `MAGNET_TECH`) */
  limit_MPa: number;
}

export interface StressPoint {
  /** radius [m] */
  r: number;
  /** stresses [Pa] (compression negative) */
  sigR: number;
  sigT: number;
}

export interface TFStressState {
  sigR_MPa: number;
  sigT_MPa: number;
  sigZ_MPa: number;
  tresca_MPa: number;
  vonMises_MPa: number;
  /** radius of the point [m] */
  r: number;
}

export interface TFCoilResult {
  tech: MagnetTech;
  nCoils: number;
  /** inner radius of the nose case, of the winding pack, and outer radius of the winding pack [m] */
  r_c: number;
  r_i: number;
  r_o: number;
  /** radius of the plasma-facing surface of the outboard leg [m] and height of the straight inboard leg [m] */
  R_outLeg: number;
  legHeight_m: number;
  /** maximum height of the coil [m] */
  coilHeight_m: number;
  /** total current of the TF set [A] (mu0 I / 2 pi R = B0) and peak field at the winding pack [T] */
  I_total_A: number;
  B_peak_T: number;
  /** magnetic pressure B_peak^2 / 2 mu0 [MPa] */
  pMag_MPa: number;
  /** smeared current density of the winding pack region [A/m^2] */
  J_wp_Am2: number;
  /** number of turns of one coil: I_total / (N I_turn) */
  turnsPerCoil: number;
  /** centering force per coil per metre of height, 0.5 B_peak I_total / N [N/m] */
  F_centering_Npm: number;
  /** vertical force on the upper half of one coil [N] and the tension in the inboard leg [N] */
  F_vertical_N: number;
  T_inboard_N: number;
  /** steel area of one inboard leg (case, conduit, plates) [m^2] */
  A_steel_m2: number;
  /** stresses at the point of maximum Tresca stress of the nose case, of the winding-pack steel and of the plasma-side case */
  case: TFStressState;
  wp: TFStressState;
  front: TFStressState;
  /** thickness of the plasma-side case [m] (inside the plasma-to-coil gap) */
  plasmaCase_m: number;
  /** Tresca stress governing the design: the largest of the three [MPa], with the von Mises stress of the same point */
  tresca_MPa: number;
  vonMises_MPa: number;
  limit_MPa: number;
  /** 1 - tresca / limit (negative: over the limit) */
  margin: number;
  overstress: boolean;
  /** effective transverse Young's modulus of the winding pack [Pa] (smearing) */
  E_wp_Pa: number;
  /** magnetic energy of the ideal toroidal cavity between the legs [J] */
  W_J: number;
  /** length of one coil (D shape) [m], mass of one coil and of the set [kg] */
  coilLength_m: number;
  coilMass_kg: number;
  totalMass_kg: number;
  /** smeared cross-section of the winding-pack region of one coil at the inboard leg [m^2] */
  A_wp_m2: number;
  /** area of the cold surface of the coil set (both faces of the D shell) [m^2], for the static heat load */
  coldSurface_m2: number;
  /** radial profile of the smeared stresses for plots */
  profile: StressPoint[];
  /** approximations that apply to this result */
  notes: string[];
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* multi-layer plane-stress solver                                                                                     */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface StressLayer {
  /** inner radius [m] */
  r0: number;
  /** outer radius [m] */
  r1: number;
  /** transverse Young's modulus [Pa] */
  E: number;
  /** Poisson's ratio */
  nu: number;
  /** current density carrying the Lorentz body force [A/m^2] (0 for a passive layer) */
  J: number;
}

export interface StressSolution {
  /** integration constants per layer */
  c1: number[];
  c2: number[];
  layers: StressLayer[];
  /** radial displacement, radial and hoop stress at a radius inside layer k */
  at(k: number, r: number): { u: number; sigR: number; sigT: number };
}

/**
 * Plane-stress solution of concentric layers under the Lorentz body force f = -J B (inward), B from Ampere's law with the
 * current of all inner layers; PROCESS `plane_stress` (Kovari 2016 eqs. 36-39). Boundary conditions: the radial stress
 * is -pIn at the inner and -pOut at the outer surface (compressive pressures, default 0), sigma_r and u continuous at the
 * interfaces. Compression is negative.
 */
export function tfStressLayers(layers: StressLayer[], pIn = 0, pOut = 0): StressSolution {
  const n = layers.length;
  if (n < 1) throw new RangeError('tfStressLayers: at least one layer');
  const K = layers.map((l) => l.E / (1 - l.nu * l.nu));
  const alpha: number[] = [], beta: number[] = [];
  let Iin = 0;
  for (let i = 0; i < n; i++) {
    const l = layers[i];
    alpha.push((0.5 * MU0 * l.J * l.J) / K[i]);
    beta.push((0.5 * MU0 * l.J * (Iin - Math.PI * l.J * l.r0 * l.r0)) / (Math.PI * K[i]));
    Iin += Math.PI * (l.r1 * l.r1 - l.r0 * l.r0) * l.J;
  }
  // particular parts of sigma_r and u at r (per layer i)
  const sigRp = (i: number, r: number) => K[i] * (0.125 * (3 + layers[i].nu) * alpha[i] * r * r + 0.5 * beta[i] * (1 + (1 + layers[i].nu) * Math.log(r)));
  const sigTp = (i: number, r: number) => K[i] * (0.125 * (1 + 3 * layers[i].nu) * alpha[i] * r * r + 0.5 * beta[i] * (layers[i].nu + (1 + layers[i].nu) * Math.log(r)));
  const up = (i: number, r: number) => 0.125 * alpha[i] * r * r * r + 0.5 * beta[i] * r * Math.log(r);
  // homogeneous sigma_r coefficients
  const hr1 = (i: number) => K[i] * (1 + layers[i].nu);
  const hr2 = (i: number, r: number) => -K[i] * (1 - layers[i].nu) / (r * r);
  const A = new Float64Array(4 * n * n);
  const b = new Float64Array(2 * n);
  const set = (row: number, col: number, v: number) => { A[row * 2 * n + col] = v; };
  // inner surface: sigma_r(r0 of layer 0) = -pIn
  set(0, 0, hr1(0)); set(0, 1, hr2(0, layers[0].r0));
  b[0] = -pIn - sigRp(0, layers[0].r0);
  for (let i = 0; i < n - 1; i++) {
    const r = layers[i].r1;
    // continuity of sigma_r
    set(2 * i + 1, 2 * i, hr1(i)); set(2 * i + 1, 2 * i + 1, hr2(i, r));
    set(2 * i + 1, 2 * i + 2, -hr1(i + 1)); set(2 * i + 1, 2 * i + 3, -hr2(i + 1, r));
    b[2 * i + 1] = -sigRp(i, r) + sigRp(i + 1, r);
    // continuity of the displacement
    set(2 * i + 2, 2 * i, r); set(2 * i + 2, 2 * i + 1, 1 / r);
    set(2 * i + 2, 2 * i + 2, -r); set(2 * i + 2, 2 * i + 3, -1 / r);
    b[2 * i + 2] = -up(i, r) + up(i + 1, r);
  }
  // outer surface: sigma_r(r1 of the last layer) = -pOut
  const L = layers[n - 1];
  set(2 * n - 1, 2 * n - 2, hr1(n - 1)); set(2 * n - 1, 2 * n - 1, hr2(n - 1, L.r1));
  b[2 * n - 1] = -pOut - sigRp(n - 1, L.r1);
  // row scaling (PROCESS does the same): the rows differ by many orders of magnitude
  for (let row = 0; row < 2 * n; row++) {
    let m = 0;
    for (let col = 0; col < 2 * n; col++) m = Math.max(m, Math.abs(A[row * 2 * n + col]));
    if (m > 0) { for (let col = 0; col < 2 * n; col++) A[row * 2 * n + col] /= m; b[row] /= m; }
  }
  const c = solveDense(A, b, 2 * n);
  const c1: number[] = [], c2: number[] = [];
  for (let i = 0; i < n; i++) { c1.push(c[2 * i]); c2.push(c[2 * i + 1]); }
  return {
    c1, c2, layers,
    at(k, r) {
      const nu = layers[k].nu;
      return {
        u: c1[k] * r + c2[k] / r + up(k, r),
        sigR: K[k] * ((1 + nu) * c1[k] - ((1 - nu) * c2[k]) / (r * r)) + sigRp(k, r),
        sigT: K[k] * ((1 + nu) * c1[k] + ((1 - nu) * c2[k]) / (r * r)) + sigTp(k, r),
      };
    },
  };
}

/** Tresca maximum shear stress (the larger of the three principal-stress differences) */
export function trescaStress(sR: number, sT: number, sZ: number): number {
  return Math.max(Math.abs(sR - sT), Math.abs(sT - sZ), Math.abs(sZ - sR));
}

/** von Mises stress for principal stresses (no shear) */
export function vonMisesStress(sR: number, sT: number, sZ: number): number {
  return Math.sqrt(0.5 * ((sR - sT) ** 2 + (sT - sZ) ** 2 + (sZ - sR) ** 2));
}

/**
 * Effective transverse Young's modulus of the winding pack region: a square grid of structure (linear soft fraction v,
 * areal soft fraction v^2 = 1 - f_struct) around a compliant cell; the loaded wall columns are in parallel with the soft
 * columns, in which the compliant cell is in series with the wall segments (Voigt-Reuss smearing as in Swanson,
 * arXiv:2206.04712 eqs. 1-2, and the series/parallel split of Kovari 2016 fig. 7).
 */
export function smearedTransverseModulus(E_struct: number, E_soft: number, structureFraction: number): number {
  const f = Math.min(1, Math.max(0, structureFraction));
  const v = Math.sqrt(1 - f);
  const E_col = 1 / ((1 - v) / E_struct + v / E_soft);
  return (1 - v) * E_struct + v * E_col;
}

/**
 * Vertical force on the upper half of one TF coil [N]. Port of the PROCESS `tf_field_and_force` expression, the exact
 * integral of the Lorentz force per unit length over a coil whose winding pack has the radial thickness dr = r_io - r_ii
 * (inboard inner, inboard outer and outboard inner radius of the winding pack); with dr -> 0 it tends to the line-current
 * result F_z = mu0 I^2 ln(R_out / R_in) / (4 pi N) of Kovari 2016 eq. (42).
 */
export function verticalForceUpperHalf(B0: number, R: number, I_total: number, N: number, r_ii: number, r_io: number, r_oi: number): number {
  const dr = r_io - r_ii;
  if (dr < 1e-5 * r_io) return ((MU0 * I_total * I_total) / (4 * Math.PI * N)) * Math.log((r_oi + 0.5 * dr) / (r_io - 0.5 * dr));
  const ln = Math.log;
  const bracket = r_io * r_io * ln(r_io / r_ii) + r_oi * r_oi * ln((r_oi + dr) / r_oi) + dr * dr * ln((r_oi + dr) / r_ii)
    - dr * (r_io + r_oi) + 2 * dr * (r_io * ln(r_ii / r_io) + r_oi * ln((r_oi + dr) / r_oi));
  return (0.5 * (B0 * R * I_total)) / (N * dr * dr) * bracket;
}

/** distance of the outboard leg (and of the top of the coil) from the plasma boundary in units of the inboard plasma-to-coil gap */
export const OUTER_GAP_FACTOR = 2.2;

/** length of a D-shaped coil: the straight inboard leg of height H_leg plus a half ellipse (Ramanujan) of semi-axes H_max/2 and W */
export function dCoilLength(H_leg: number, H_max: number, W: number): number {
  const A = 0.5 * H_max, B = W;
  const half = 0.5 * Math.PI * (3 * (A + B) - Math.sqrt((3 * A + B) * (A + 3 * B)));
  return H_leg + half;
}

/** Winding pack, forces and stress of the TF coil. */
export function tfCoil(inp: TFCoilInput): TFCoilResult {
  const spec = TF_TECH[inp.tech];
  const notes: string[] = [];
  const N = Math.max(2, Math.round(inp.nCoils ?? spec.nCoils));
  const fNose = Math.min(0.9, Math.max(0, inp.noseFraction ?? spec.noseFraction));
  const fStruct = Math.min(1, Math.max(0.05, inp.structureFraction ?? spec.structureFraction));
  const Iturn = inp.turnCurrent_A ?? spec.turnCurrent_A;
  const fVert = Math.min(1, Math.max(0.1, inp.verticalInboardFraction ?? 0.5));

  const r_o = Math.max(inp.R - inp.a - inp.gap_m, 0.05);
  let t = Math.max(inp.coilThickness_m, 0.05);
  if (t > 0.98 * r_o) { t = 0.98 * r_o; notes.push('leg thickness limited to 98 % of the outer radius of the winding pack'); }
  const r_c = r_o - t;
  const r_i = r_c + fNose * t;
  const dr_wp = r_o - r_i;

  const I_total = (2 * Math.PI * inp.R * inp.B0) / MU0;
  const B_peak = (MU0 * I_total) / (2 * Math.PI * r_o);
  const pMag = (B_peak * B_peak) / (2 * MU0);
  const A_wp_all = Math.PI * (r_o * r_o - r_i * r_i);
  const J = I_total / A_wp_all;

  // Geometry of the D-shaped coil (APPROXIMATION): straight inboard leg of height 2 (kappa a + gap); the outboard leg and the top of
  // the coil sit 2.2 gaps outside the plasma boundary (outboard: ITER about 2.9 m outside a plasma-to-coil gap of 1.3 m; PROCESS
  // DEMO radial build 4.3 m against 1.7 m; the ports and the PF coil clearance need the room).
  const H_leg = 2 * (inp.kappa * inp.a + inp.gap_m);
  const H_max = 2 * (inp.kappa * inp.a + OUTER_GAP_FACTOR * inp.gap_m);
  const R_outLeg = inp.R + inp.a + OUTER_GAP_FACTOR * inp.gap_m;
  const W_D = Math.max(R_outLeg + dr_wp - r_c, 0.1);
  const L = dCoilLength(H_leg, H_max, W_D);

  // stress: nose case (if any), winding pack, plasma-side case
  const E_wp = smearedTransverseModulus(spec.E_struct, spec.E_soft, fStruct);
  const pc = PLASMA_CASE_FRACTION * t;
  const layers: StressLayer[] = [];
  const kinds: ('case' | 'wp' | 'front')[] = [];
  if (fNose > 1e-9) { layers.push({ r0: r_c, r1: r_i, E: spec.E_struct, nu: spec.nu_struct, J: 0 }); kinds.push('case'); }
  layers.push({ r0: fNose > 1e-9 ? r_i : r_c, r1: r_o, E: E_wp, nu: spec.nu_struct, J }); kinds.push('wp');
  layers.push({ r0: r_o, r1: r_o + pc, E: spec.E_struct, nu: spec.nu_struct, J: 0 }); kinds.push('front');
  const sol = tfStressLayers(layers);

  // vertical tension
  const Fz = verticalForceUpperHalf(inp.B0, inp.R, I_total, N, r_i, r_o, R_outLeg);
  const Tz = fVert * Fz;
  const A_steel = (Math.PI * (r_i * r_i - r_c * r_c) + fStruct * A_wp_all + Math.PI * ((r_o + pc) ** 2 - r_o * r_o)) / N;
  const sigZ = Tz / A_steel;
  const fac = spec.E_struct / E_wp;

  const nPts = 24;
  const profile: StressPoint[] = [];
  const best: Partial<Record<'case' | 'wp' | 'front', TFStressState>> = {};
  layers.forEach((l, k) => {
    const kind = kinds[k];
    for (let j = 0; j <= nPts; j++) {
      const r = l.r0 + ((l.r1 - l.r0) * j) / nPts;
      const st0 = sol.at(k, r);
      profile.push({ r, sigR: st0.sigR, sigT: st0.sigT });
      // the winding pack is smeared: the stress in its steel is the smeared stress times E_steel / E_effective
      const sr = kind === 'wp' ? st0.sigR * fac : st0.sigR, st = kind === 'wp' ? st0.sigT * fac : st0.sigT;
      const tr = trescaStress(sr, st, sigZ);
      const cur = best[kind];
      if (!cur || tr > cur.tresca_MPa * 1e6) {
        best[kind] = { r, sigR_MPa: sr / 1e6, sigT_MPa: st / 1e6, sigZ_MPa: sigZ / 1e6, tresca_MPa: tr / 1e6, vonMises_MPa: vonMisesStress(sr, st, sigZ) / 1e6 };
      }
    }
  });
  const wpState = best.wp as TFStressState;
  const frontState = best.front as TFStressState;
  const caseState = best.case ?? wpState;
  const governing = [caseState, wpState, frontState].reduce((m, x) => (x.tresca_MPa > m.tresca_MPa ? x : m));

  // stored energy of the ideal toroidal cavity between the legs, W = (pi h R^2 B0^2 / mu0) ln(R_out / R_in) for the mean cavity
  // height h of the D shape (between the straight-leg height and the maximum height of the coil)
  const W = ((Math.PI * 0.5 * (H_leg + H_max) * inp.R * inp.R * inp.B0 * inp.B0) / MU0) * Math.log(Math.max(R_outLeg / r_o, 1.0001));

  // mass: winding pack region and a thin case (0.1 m) around it along the whole coil, plus the solid nose on the inboard leg
  const dx_wp = ((2 * Math.PI * 0.5 * (r_i + r_o)) / N); // toroidal pitch at the mean winding-pack radius
  const A_wp_coil = dr_wp * dx_wp * 0.9;
  const tCase = 0.1;
  const A_thinCase = 2 * (dr_wp + dx_wp * 0.9) * tCase;
  const A_nose = (Math.PI * (r_i * r_i - r_c * r_c)) / N;
  const coilMass = spec.rho_wp * A_wp_coil * L + spec.rho_struct * (A_thinCase * L + A_nose * H_leg);

  notes.push('winding pack smeared as a full annulus (side case and wedge shape not resolved)');
  notes.push('CS/PF field and out-of-plane forces neglected (as PROCESS); the design values of the structure fraction, nose fraction and turn current are technology-typical');
  if (inp.tech === 'Cu') notes.push('resistive coil: the copper carries the load (E = 117 GPa)');

  return {
    tech: inp.tech, nCoils: N, r_c, r_i, r_o, R_outLeg, legHeight_m: H_leg, coilHeight_m: H_max, I_total_A: I_total, B_peak_T: B_peak, pMag_MPa: pMag / 1e6,
    J_wp_Am2: J, turnsPerCoil: Iturn > 0 ? I_total / (N * Iturn) : 0,
    F_centering_Npm: (0.5 * B_peak * I_total) / N, F_vertical_N: Fz, T_inboard_N: Tz, A_steel_m2: A_steel,
    case: caseState, wp: wpState, front: frontState, plasmaCase_m: pc, tresca_MPa: governing.tresca_MPa, vonMises_MPa: governing.vonMises_MPa,
    limit_MPa: inp.limit_MPa, margin: 1 - governing.tresca_MPa / inp.limit_MPa, overstress: governing.tresca_MPa > inp.limit_MPa,
    E_wp_Pa: E_wp, W_J: W, coilLength_m: L, coilMass_kg: coilMass, totalMass_kg: coilMass * N, A_wp_m2: A_wp_coil,
    coldSurface_m2: 2 * (dr_wp + dx_wp) * L * N, profile, notes,
  };
}
