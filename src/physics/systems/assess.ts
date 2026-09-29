/**
 * Systems-lite assessment of a magnetic-confinement device: TF coil, CS flux budget, radial build, TBR and cryoplant in one call
 * (lane ws7b). `buildMagneticReport` (confinement/magneticReport.ts) feeds it with the flat-top means of the simulated history and
 * adds the result to the `engineering` block of the shot report; the old keys of that block keep their names.
 */
import { Geometry } from '../geometry';
import type { MagneticConfig } from '../types';
import { TBROptions, tritiumBreedingRatio } from './breeding';
import { CS_TF_GAP, FluxBudget, FluxMeasurement, fluxBudget } from './csFlux';
import { CryoResult, DEFAULT_PULSE_LENGTH_S, cryoPlant, plantPulseLength_s } from './cryo';
import { MAGNET_TECH } from './magnets';
import { RadialBuild, radialBuild, tfNuclearHeating_W } from './radialBuild';
import { TFCoilResult, tfCoil, TF_TECH } from './tfCoil';

/** structure of the PF coils and of the CS in the cold mass, relative to the TF coils (APPROXIMATION: ITER cold mass about 10 kt for 6.5 kt of TF coils) */
export const PF_MASS_FACTOR = 0.3;

/** largest share of the flux requirement the PF coils are assumed to be able to supply before the CS flux is called short */
export const PF_FLUX_SHARE_MAX = 0.3;

export interface SystemsInput {
  cfg: MagneticConfig;
  g: Geometry;
  /** stellarators have modular coils and no ohmic solenoid: the TF inboard-leg model is then an approximation and there is no CS */
  isStellarator: boolean;
  /** flat-top mean fusion power and neutron power [MW] */
  P_fus_MW: number;
  P_neutron_MW: number;
  /**
   * plasma-present pulse length of the plant [s] for the pulsed-field load of the cryoplant: a design quantity that overrides
   * `cfg.systems.pulseLength_s`; without either, DEFAULT_PULSE_LENGTH_S. It is never the length of the simulated shot: the machine
   * does not change with the t_end of a run, a disruption or an abort (see cryo.ts).
   */
  pulseLength_s?: number;
  /** l_i(3) of the plasma if known (1.5D) */
  li?: number;
  /** burn-phase loop voltage [V], its duration [s] and the flux quantities a current model measured (see csFlux.ts) */
  flux?: { measurement?: FluxMeasurement; Vloop_V: number; duration_s: number };
}

export interface SystemsAssessment {
  tf: TFCoilResult;
  build: RadialBuild;
  /** tritium breeding ratio (0 without a blanket) */
  tbr: number;
  /** breeder fraction of the HCPB fit that was used (undefined for other blanket types) */
  breederFraction?: number;
  /** flux budget; null for a stellarator, without plasma current or if the CS does not fit */
  cs: FluxBudget | null;
  cryo: CryoResult;
  /** plasma pulse length the pulsed-field load of the cryoplant was computed with [s] */
  pulseLength_s: number;
  /** approximations and extrapolations that apply to this assessment */
  notes: string[];
  /** nuclear heating of the TF coil [W] */
  nuclearHeating_W: number;
  /** cold mass of the magnets and structure [kg] */
  coldMass_kg: number;
  warnings: string[];
}

/** Assess the systems-lite models of a magnetic configuration. */
export function assessSystems(inp: SystemsInput): SystemsAssessment {
  const c = inp.cfg;
  const tech = c.magnet.tech;
  const spec = MAGNET_TECH[tech];
  const sys = c.systems;
  const warnings: string[] = [];
  const opts = { ...(sys?.tf ?? {}) };
  if (inp.isStellarator && opts.nCoils === undefined) opts.nCoils = 50; // W7-X has 50 non-planar modular coils
  const tf = tfCoil({ R: inp.g.R, a: inp.g.a, kappa: inp.g.kappa, B0: c.B0, tech, gap_m: c.magnet.gap_m, coilThickness_m: c.magnet.coilThickness_m, limit_MPa: spec.stress_MPa, ...opts });
  if (inp.isStellarator) tf.notes.push('stellarator: the inboard-leg model is used as an estimate for the modular coils');
  const build = radialBuild({ a: inp.g.a, gap_m: c.magnet.gap_m, blanketType: c.blanket.type, blanketInboard_m: sys?.blanket?.inboardDepth_m, tfPlasmaCase_m: tf.plasmaCase_m });

  const hasBlanket = c.blanket.type !== 'none';
  const tbrOpts: TBROptions = { meanDepth_m: hasBlanket ? build.blanketMean_m : undefined, breederFraction: sys?.blanket?.breederFraction };
  const tbr = hasBlanket ? tritiumBreedingRatio(c.blanket.type, c.blanket.li6_enrichment, c.blanket.coverage, tbrOpts) : 0;

  // nuclear heating of the coil: superconducting coils only (a copper coil is not cooled cryogenically)
  const superconducting = tech !== 'Cu';
  const notes: string[] = [];
  if (build.compressed) notes.push('the fixed layers of the radial build were compressed into the plasma-to-coil gap');
  if (superconducting && !hasBlanket) notes.push('TF nuclear heating: the PROCESS fit is for a DEMO breeding blanket and is extrapolated to a build without one');
  const Qnuc = superconducting ? tfNuclearHeating_W(build.xBlanket, build.xShield, tf.totalMass_kg, inp.P_fus_MW) : 0;

  // central solenoid flux budget
  let cs: FluxBudget | null = null;
  const r_cs = tf.r_c - CS_TF_GAP;
  if (!inp.isStellarator && c.Ip_MA > 0 && r_cs > 0.05) {
    cs = fluxBudget({
      R: inp.g.R, a: inp.g.a, kappa: inp.g.kappa, Ip_MA: c.Ip_MA, li: sys?.cs?.li ?? inp.li, tech, r_outer_m: r_cs, height_m: tf.legHeight_m,
      currentDensity_Am2: sys?.cs?.currentDensity_MAm2 !== undefined ? sys.cs.currentDensity_MAm2 * 1e6 : undefined, B_max_T: sys?.cs?.B_max_T ?? spec.Bmax_coil, swingFraction: sys?.cs?.swingFraction,
      pfFlux_Vs: sys?.cs?.pfFlux_Vs, burn: inp.flux ? { Vloop_V: inp.flux.Vloop_V, duration_s: inp.flux.duration_s } : undefined,
    }, inp.flux?.measurement);
  }

  // cryogenic plant
  const coldMass = tf.totalMass_kg * (1 + PF_MASS_FACTOR) + (cs?.mass_kg ?? 0);
  const designPulse = inp.pulseLength_s ?? sys?.pulseLength_s;
  const pulseLength_s = plantPulseLength_s(designPulse);
  if (designPulse === undefined) notes.push(`cryoplant pulsed-field load: the plant pulse is ${DEFAULT_PULSE_LENGTH_S} s (default, PROCESS times); give systems.pulseLength_s for the pulse of the machine`);
  else if (pulseLength_s !== designPulse) notes.push(`systems.pulseLength_s = ${designPulse} is not a positive number: the default ${DEFAULT_PULSE_LENGTH_S} s was used`);
  const cryo = cryoPlant({
    tech, wattsPerWatt: spec.cryo_W_per_W, coldMass_kg: coldMass, tfShellArea_m2: tf.coldSurface_m2, nuclearHeating_W: Qnuc,
    pfEnergy_J: cs?.W_cs_J ?? 0, pulseLength_s, nCoils: tf.nCoils, turnCurrent_A: opts.turnCurrent_A ?? TF_TECH[tech].turnCurrent_A,
  });

  if (tf.overstress) warnings.push(`TF coil stress ${tf.tresca_MPa.toFixed(0)} MPa > ${spec.stress_MPa} MPa limit.`);
  // The flux budget is reported for every tokamak, but only checked (warning) when the design gives the solenoid (`systems.cs`): the
  // radial build of the presets does not resolve the solenoid (ITER: TF inner radius 2.0 m against a CS outer radius of 2.08 m).
  if (cs && sys?.cs !== undefined && isFinite(cs.margin) && cs.psiCS_Vs < (1 - PF_FLUX_SHARE_MAX) * cs.psiRequired_Vs) {
    warnings.push(`CS flux swing ${cs.psiAvailable_Vs.toFixed(0)} V s is ${(100 * cs.psiAvailable_Vs / cs.psiRequired_Vs).toFixed(0)} % of the ${cs.psiRequired_Vs.toFixed(0)} V s the pulse needs — the PF coils would have to supply more than ${(100 * PF_FLUX_SHARE_MAX).toFixed(0)} % of it; enlarge the solenoid, raise its field or give the PF flux (systems.cs.pfFlux_Vs).`);
  }
  return { tf, build, tbr, breederFraction: sys?.blanket?.breederFraction, cs, cryo, pulseLength_s, notes: [...notes, ...tf.notes], nuclearHeating_W: Qnuc, coldMass_kg: coldMass, warnings };
}

/**
 * The new `engineering` keys of the shot report (the old ones are written by buildMagneticReport). Numbers are rounded like the old
 * ones. Keys of a subsystem that does not apply (no CS in a stellarator, no cryoplant for copper coils, no blanket) are left out.
 */
export function systemsReportKeys(s: SystemsAssessment): Record<string, number> {
  const r = (x: number, d: number) => +x.toFixed(d);
  const k: Record<string, number> = {
    'TF coils': s.tf.nCoils,
    'TF winding pack J (MA/m²)': r(s.tf.J_wp_Am2 / 1e6, 1),
    'TF case Tresca (MPa)': r(s.tf.case.tresca_MPa, 0),
    'TF winding pack Tresca (MPa)': r(s.tf.wp.tresca_MPa, 0),
    'TF stress margin': r(s.tf.margin, 3),
    'TF vertical tension per coil (MN)': r(s.tf.T_inboard_N / 1e6, 1),
    'TF mass (t)': r(s.tf.totalMass_kg / 1e3, 0),
  };
  if (s.cs) {
    k['CS flux swing (V s)'] = r(s.cs.psiCS_Vs, 1);
    k['Flux required (V s)'] = r(s.cs.psiRequired_Vs, 1);
    if (isFinite(s.cs.margin)) k['Flux margin'] = r(s.cs.margin, 3);
  }
  if (s.cryo.Q_total_W > 0) {
    k['TF nuclear heating (kW)'] = r(s.nuclearHeating_W / 1e3, 2);
    k['Cryo heat load (kW)'] = r(s.cryo.Q_total_W / 1e3, 1);
    k['Cryoplant power (MW)'] = r(s.cryo.P_cryo_MW, 1);
    k['Cryo pulse length (s)'] = r(s.pulseLength_s, 0);
  }
  if (s.tbr > 0) {
    k['Inboard blanket (m)'] = r(s.build.blanketInboard_m, 2);
    k['Inboard shield+vessel (m)'] = r(s.build.shieldInboard_m, 2);
  }
  return k;
}
