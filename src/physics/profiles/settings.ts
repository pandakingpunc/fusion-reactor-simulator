/**
 * Check of the settings of the 1.5D model that the step control cannot run without.
 *
 * A setting comes from the configuration of a run: the wizard, a shared link, a library call or a file of the command line, and
 * only some of those entry points validate it. The three numbers below decide whether a step is accepted and how long it is, so a
 * value outside their domain does not give a wrong answer but no answer: a step limit of zero or below never advances the shot
 * (the kernel steps forever at t = 0), a tolerance that is not a number makes every error estimate infinite, and a zero relative
 * and a zero absolute tolerance together reject every step down to the floor. Such a value is replaced by the default, and the
 * replacement is reported (a warning at t = 0), instead of hanging the run or repeating the failure in every step.
 *
 * The same holds for the three numbers of the EPED1-type pedestal (`pedestalModel: 'eped1'`, pedestal/eped1.ts): the P–B gradient and the KBM
 * coefficient must be positive (the width and the height are products of them: a zero or a NaN has no pedestal, and the solver refuses it) and the
 * density exponent must be a finite number of at least zero.
 */
import type { ProfileSettings } from '../types';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { KBM_COEFFICIENT, PB_DENSITY_EXPONENT, PB_GRADIENT } from './pedestal/eped1';

/** shortest Δt the step control proposes [s]; a step limit below it is raised to it (the controller keeps Δt between the two) */
export const STEP_DT_MIN = 1e-6;

/** a setting that was replaced: its key, the value that was given and what the model uses instead */
export interface SettingNote { key: keyof ProfileSettings; given: unknown; used: number; message: string }

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * `ps` with rtol > 0, atol >= 0 and dtMax >= STEP_DT_MIN (all finite numbers): a value outside that domain is the default, a
 * step limit below the step floor is the floor. Everything else is left as it is. Returns the settings and what was replaced.
 */
export function checkProfileSettings(ps: ProfileSettings): { ps: ProfileSettings; notes: SettingNote[] } {
  const notes: SettingNote[] = [];
  const out: ProfileSettings = { ...ps };
  const replace = (key: 'rtol' | 'atol' | 'dtMax' | 'pedPbGradient' | 'pedKbmCoefficient' | 'pedDensityExponent', used: number, why: string, unit = '') => {
    const given = ps[key];
    out[key] = used;
    notes.push({ key, given, used, message: `ProfileSettings.${key} = ${String(given)} ${why}: ${used}${unit} is used` });
  };
  // an absent setting is the default of the step control (coupledStep.ts), not an error
  if (ps.rtol !== undefined && !(isNumber(ps.rtol) && ps.rtol > 0)) replace('rtol', DEFAULT_PROFILE_SETTINGS.rtol!, 'is not a positive number');
  if (ps.atol !== undefined && !(isNumber(ps.atol) && ps.atol >= 0)) replace('atol', DEFAULT_PROFILE_SETTINGS.atol!, 'is not a non-negative number');
  if (ps.dtMax !== undefined) {
    if (!(isNumber(ps.dtMax) && ps.dtMax > 0)) replace('dtMax', DEFAULT_PROFILE_SETTINGS.dtMax!, 'is not a positive time', ' s');
    else if (ps.dtMax < STEP_DT_MIN) replace('dtMax', STEP_DT_MIN, `is below the shortest step of ${STEP_DT_MIN} s`, ' s');
  }
  if (ps.pedestalModel === 'eped1') {
    const positive = (v: unknown) => v === undefined || (isNumber(v) && v > 0);
    if (!positive(ps.pedPbGradient)) replace('pedPbGradient', PB_GRADIENT, 'is not a positive number');
    if (!positive(ps.pedKbmCoefficient)) replace('pedKbmCoefficient', KBM_COEFFICIENT, 'is not a positive number');
    if (ps.pedDensityExponent !== undefined && !(isNumber(ps.pedDensityExponent) && ps.pedDensityExponent >= 0)) {
      replace('pedDensityExponent', PB_DENSITY_EXPONENT, 'is not a non-negative number');
    }
  }
  return { ps: out, notes };
}
