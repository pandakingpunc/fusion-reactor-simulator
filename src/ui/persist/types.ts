/**
 * Types shared by the persistence modules and the UI state (types only: importing this file adds nothing to a bundle).
 */
import type { ActuatorEntry } from '../../physics/types';

/**
 * Outcome of re-simulating an imported run file.
 *  - verified      the file's inputs hash to its fingerprint, this version wrote it, and the re-run report is the file's
 *  - mismatch      inputs and version agree but the re-run report differs (the file's report was edited, or the build is not the one that wrote it)
 *  - other-version the file was written by another simulator version, so a different result is expected (`reportMatch` says whether it happened)
 *  - tampered      the file's inputs do not hash to its own fingerprint (edited after export)
 *  - unsigned      the file has no fingerprint (an older export, or a run whose live interventions were not recorded)
 */
export const VERIFY_STATUSES = ['verified', 'mismatch', 'other-version', 'tampered', 'unsigned'] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

/** Whether a value read from storage is a verification status (an archive record from a newer build may carry another). */
export const isVerifyStatus = (x: unknown): x is VerifyStatus => (VERIFY_STATUSES as readonly unknown[]).includes(x);

/**
 * What a run carries beyond its results so that it can be exported and reproduced: the live interventions it
 * received. The simulation worker owns the actuator log; the page counts the interventions it sent. A run with
 * `interventions` > 0 and no `actuatorLog` cannot be given a fingerprint (its inputs are not fully known).
 */
export interface RunProvenance {
  interventions: number;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  /** ScenarioSpec of the run, when it had one (plain JSON) */
  scenario?: unknown;
  /** runFingerprint as the simulation worker computed it, when it reports one (it is used as it is) */
  fingerprint?: string;
}
