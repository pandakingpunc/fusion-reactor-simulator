/**
 * Calibration of the 0D ICF model on one NIF shot, and the blind split of the others.
 *
 * What is calibrated. The model (icf.ts) has exactly one constant that was tuned to an experiment, ICF_CAL: the factor
 * that turns the geometric areal density of the fuel at stagnation, m / (4/3 π R_stag²), into the effective (burn-weighted)
 * areal density ρR_eff = ICF_CAL · ρR_geo · √(2.8/α). ρR_eff sets the burn-up fraction Φ = ρR_eff/(ρR_eff + H_B) and the
 * ignition parameter χ_ig. Every other constant keeps the value it had: the D-T burn parameter H_B = 7 g/cm² (the literature
 * minimum of Atzeni & Meyer-ter-Vehn, scaled to the other fuels), the energy per reaction and the constants of the ignition
 * cliff (0.2 g/cm², 360 km/s, the asymmetry and roughness scales). One input of the NIF presets did change with it, the DT fuel
 * mass (220 -> 210 µg, see "What blind means here"). Until v4.0 ICF_CAL = 0.07 was tuned to the N221204 preset (G = 1.49),
 * which made the N221204 check of validate a fit, not a prediction.
 *
 * To what. The one calibration shot is N210808 (8 August 2021, the first shot above the Lawson criterion): a yield of 1.37 MJ
 * (Abu-Shawareb et al., Phys. Rev. Lett. 129 (2022) 075001, doi:10.1103/PhysRevLett.129.075001, table I, from 1.917 MJ of
 * laser light) with the capsule of the NIF_N210808 preset. The target is the yield only: the model's yield does not depend on
 * the laser energy (G = E_fus / E_laser is formed afterwards), so E_laser is not a calibration input.
 *
 * How. The yield of the model is a continuous, strictly increasing function of ICF_CAL (Φ grows with ρR_eff, and so does the
 * cliff multiplier χ_ig³ below the threshold), so ICF_CAL is the root of E_fus(ICF_CAL) = 1.37 MJ and is found by bisection on
 * ln ICF_CAL ({@link calibrateRhoRScale}); the stored constant is that root rounded to four significant digits, and
 * icfCalibration.test.ts reproduces it from the preset on every run (relative 1e-3), so it cannot drift from the preset or
 * the target. With the preset capsule the root is 0.03931 (ρR_eff = 0.161 g/cm², Φ = 2.25 %), and χ_ig = 0.951: the model
 * puts N210808 5 % BELOW its own ignition threshold although the shot ignited by every Lawson-type criterion; the cliff
 * constants are not part of the calibration and are not touched (see the entry of the NIF split in test/golden/CHANGES.md).
 *
 * What is predicted blind. N221204 (3.15 MJ from 2.05 MJ) and N230729 (3.88 MJ from 2.05 MJ) are compared with the model
 * in references.ts without any further adjustment. The model has no input for what separates the three shots (the 6 µm
 * thicker ablator, +7 % laser energy, hot-spot symmetry, capsule quality: they act through the yield amplification above the
 * ignition cliff), so it predicts the calibration yield for all of them; the misses are reported there as known failures.
 *
 * What blind means here. ICF_CAL is not re-fitted for those shots, nothing more: the cliff constants and the platform inputs
 * (v_imp 390 km/s, CR 30, α 2.8, asymmetry 1.5 %, roughness 20 nm) are shared by the three shots, date from v3.0.0 and
 * were set when ICF_CAL was tuned to N221204 itself, so they were not chosen without knowledge of that shot. The fuel mass is the one
 * input that is newer: v4.0 took it from 220 to 210 µg on the post-shot analysis of N221204 itself (the hot-spot mass of 84 µg is
 * 40 % of the initial ice, Pak et al. 2024), a value the three shots share, so it too was set with that shot in view; it moves the
 * calibrated constant by 5.7 % (icfCalibration.test.ts). As the yield depends on none
 * of what differs between the shots, the two blind rows are the published yield ratios 3.15/1.37 and 3.88/1.37 of those shots to the
 * calibration shot, seen through the gain, not independent tests. The hot spot of the calibration shot is below the model's ignition threshold
 * (T_hs = 1.32 keV, the experiments show about 9–10 keV): references.ts carries that miss as NIF210808.Ti.
 */
import type { ICFConfig } from '../types';
import { icfStagnation } from './icf';

/** The calibration shot: what the stored ICF_CAL was fitted to. */
export const ICF_CALIBRATION_SHOT = {
  shot: 'N210808',
  /** total fusion yield [MJ] (Abu-Shawareb et al. 2022, table I) */
  yield_MJ: 1.37,
  /** laser energy on target [MJ] (table I; not a calibration input) */
  E_laser_MJ: 1.917,
  source: 'H. Abu-Shawareb et al. (Indirect Drive ICF Collaboration), "Lawson criterion for ignition exceeded in an inertial fusion experiment", Phys. Rev. Lett. 129 (2022) 075001',
  doi: '10.1103/PhysRevLett.129.075001',
} as const;

/**
 * The ρR scale ICF_CAL for which the model yield of `cfg` equals `targetYield_J` [J]: the root of the increasing
 * function E_fus(scale), by bisection on ln(scale) between 1e-4 and 10. Throws if the target lies outside what that
 * range can give.
 */
export function calibrateRhoRScale(cfg: ICFConfig, targetYield_J: number): number {
  if (!(targetYield_J > 0) || !Number.isFinite(targetYield_J)) throw new Error('the calibration yield must be positive and finite');
  const f = (scale: number) => icfStagnation(cfg, scale).E_fus_total - targetYield_J;
  let lo = Math.log(1e-4), hi = Math.log(10);
  if (f(Math.exp(lo)) > 0 || f(Math.exp(hi)) < 0) throw new Error('the calibration yield is not reachable with a ρR scale between 1e-4 and 10');
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(Math.exp(mid)) < 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return Math.exp(0.5 * (lo + hi));
}
