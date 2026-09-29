/**
 * Types and the error of the replay (replayCore.ts): what goes into a re-run, what comes out, and the messages between
 * the page and the replay worker. This file imports no physics, so the page's code can use it without bundling the simulator.
 */
import type { ActuatorEntry, ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import type { SimMeta, UiFrame } from '../../worker/protocol';

export interface ReplayInput {
  cfg: ReactorConfig;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  /** ScenarioSpec; a build whose kernel has no scenario engine refuses a run that has one instead of running it without */
  scenario?: unknown;
  /** simulator version the fingerprint is computed with (the file's, so that an edited file is recognised) */
  appVersion: string;
  keepFrames?: boolean;
}

export interface ReplayResult {
  /** runFingerprint of the run as it was replayed */
  fingerprint: string;
  report: ShotReport;
  meta: SimMeta;
  events: SimEvent[];
  frames?: UiFrame[];
}

/** A replay that cannot be done (as opposed to one that gives a different result). */
export class ReplayError extends Error {
  constructor(readonly code: 'unsupported' | 'failed', message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

// ── messages between the page and the replay worker ─────────────────────────

export type ReplayToWorker = { type: 'replay'; id: number; input: ReplayInput };
export type ReplayFromWorker =
  | { type: 'progress'; id: number; t: number; tEnd: number }
  | { type: 'done'; id: number; result: ReplayResult }
  | { type: 'error'; id: number; code: 'unsupported' | 'failed'; msg: string };

