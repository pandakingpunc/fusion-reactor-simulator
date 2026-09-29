/**
 * Page ↔ POPCON worker message contract (protocol v1). Types and the default stage plan only: no physics is imported
 * at run time, so the page can share this file without pulling the POPCON model into its own chunk.
 *
 * A `compute` message is a job: a configuration and a list of stages (grid sizes, coarse to fine). The worker
 * computes the stages in order and posts a `grid` after each. A newer `compute` replaces the job in progress: its
 * remaining stages never run. That is what makes the map follow a slider drag: every change starts a job whose first
 * stage is a small grid that is ready in a few milliseconds, and the fine grid is only computed once nothing newer has
 * arrived for `delayMs`.
 */
import type { PopconGrid } from '../physics/popcon';
import type { MagneticConfig } from '../physics/types';

export const POPCON_PROTOCOL_VERSION = 1;

export interface PopconStage {
  nx: number;
  ny: number;
  /** wait this long [ms], with no newer job arriving, before this stage is computed (default 0: at once) */
  delayMs?: number;
}

/** grid sizes of the interactive map: a preview while the controls are moving, the full map once they rest */
export const POPCON_PREVIEW_SIZE = 16;
export const POPCON_FINE_SIZE = 44;
/** the controls count as resting after this long without a change [ms] */
export const POPCON_IDLE_MS = 150;
export const DEFAULT_POPCON_STAGES: readonly PopconStage[] = [
  { nx: POPCON_PREVIEW_SIZE, ny: POPCON_PREVIEW_SIZE },
  { nx: POPCON_FINE_SIZE, ny: POPCON_FINE_SIZE, delayMs: POPCON_IDLE_MS },
];

export type ToPopcon =
  /** start a job; it replaces the one in progress */
  | { type: 'compute'; job: number; cfg: MagneticConfig; stages: readonly PopconStage[] }
  /** drop the job in progress (nothing is posted for it any more) */
  | { type: 'cancel' };

/** extent of the map's axes: n from 0 to nMax [m⁻³], T from 0 to Tmax [keV] */
export interface PopconAxes { nMax: number; Tmax: number }

export type FromPopcon =
  /** stage `stage` (0-based) of `stages` of job `job` */
  | { type: 'grid'; job: number; stage: number; stages: number; grid: PopconGrid; axes: PopconAxes; ms: number }
  | { type: 'error'; job: number; msg: string };
