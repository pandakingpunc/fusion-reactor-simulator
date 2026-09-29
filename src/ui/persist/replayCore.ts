/**
 * Re-running a run from its inputs: configuration, actuator log, breakpoints, scenario.
 *
 * This is the whole of the physics an imported file needs, as one function with no DOM and no Node in it: the replay
 * worker (replay.worker.ts) calls it off the main thread, tests call it directly. The kernel is deterministic and
 * independent of how it is chunked in time, so the run that comes out is the run that went in, bit for bit, when the
 * simulator version is the one that wrote the inputs.
 */
import { Simulation, SimulationOptions, SYNC_INTERVALS } from '../../physics/simulation';
import type { ActuatorEntry, ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import { makeMeta } from '../../worker/host';
import { SimMeta, toUiFrame, UiFrame } from '../../worker/protocol';

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

export function replayRun(input: ReplayInput, onProgress?: (p: { t: number; tEnd: number }) => void): ReplayResult {
  // a plain record: SimulationOptions gains a typed `scenario` with the scenario engine; this file stays valid before and after
  const opts: Record<string, unknown> = {};
  if (input.actuatorLog?.length) opts.actuatorLog = input.actuatorLog;
  if (input.breakpoints?.length) opts.breakpoints = input.breakpoints;
  if (input.scenario !== undefined && input.scenario !== null) {
    if (!('scenario' in Simulation.prototype)) throw new ReplayError('unsupported', 'This build of the simulator has no scenario engine, so a run with a scenario cannot be reproduced.');
    opts.scenario = input.scenario;
  }
  let sim: Simulation;
  try {
    sim = new Simulation(input.cfg, opts as SimulationOptions);
  } catch (e) {
    throw new ReplayError('failed', e instanceof Error ? e.message : String(e));
  }
  // the same chunking as Simulation.runAll(), with progress in between and the same end-of-run call
  let guard = 0;
  while (!sim.done && guard++ < 10_000) {
    sim.advance(sim.model.tEnd / SYNC_INTERVALS);
    onProgress?.({ t: sim.t, tEnd: sim.model.tEnd });
  }
  sim.advance(0);
  const result: ReplayResult = { fingerprint: sim.fingerprint(input.appVersion), report: sim.report(), meta: makeMeta(sim.model), events: sim.events };
  if (input.keepFrames) result.frames = sim.history.map(toUiFrame);
  return result;
}

// ── messages between the page and the replay worker ─────────────────────────

export type ReplayToWorker = { type: 'replay'; id: number; input: ReplayInput };
export type ReplayFromWorker =
  | { type: 'progress'; id: number; t: number; tEnd: number }
  | { type: 'done'; id: number; result: ReplayResult }
  | { type: 'error'; id: number; code: 'unsupported' | 'failed'; msg: string };

/** The worker's message handler, apart from `self`, so that tests can run it in-process. */
export function handleReplayMessage(msg: ReplayToWorker, post: (m: ReplayFromWorker) => void, now: () => number = () => Date.now()): void {
  if (msg.type !== 'replay') return;
  let last = -Infinity;
  try {
    const result = replayRun(msg.input, (p) => {
      const t = now();
      if (t - last >= 100) { last = t; post({ type: 'progress', id: msg.id, t: p.t, tEnd: p.tEnd }); }
    });
    post({ type: 'done', id: msg.id, result });
  } catch (e) {
    post({ type: 'error', id: msg.id, code: e instanceof ReplayError ? e.code : 'failed', msg: e instanceof Error ? e.message : String(e) });
  }
}
