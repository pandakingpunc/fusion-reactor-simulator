/**
 * Ana iş parçacığı ↔ simülasyon worker'ı mesaj sözleşmesi (protokol v3).
 * Fizik worker'da koşar; UI yalnızca bu mesajları görür.
 *
 * v2 changes (v4.0):
 *  - `protocolVersion` handshake on `init`/`ready` and `runAll`/`runAllDone`;
 *  - frames cross the thread boundary as `UiFrame` (no raw state vector `y`, no
 *    internal model state, no kernel checkpoint `sim`) — rewinding stays inside the worker,
 *    which keeps the full history;
 *  - every live message carries the run `id` and the timeline `branchId`, so the UI can drop
 *    frames that belong to a previous run or to a branch abandoned by a rewind;
 *  - `progress` messages for background full runs;
 *  - `rewound` carries `nEvents`, the kernel's event count at the frame: the page truncates its event list
 *    by count, not by time (a failed step's terminal frame has the time of the frame before it).
 *
 * v3 changes (v4.0, scenarios in the live app; backward compatible: a v2 page and a v2 worker are still understood,
 * every addition is an optional field or a new message):
 *  - `init` and `runAll` may carry a `scenario` (ScenarioSpec, plain JSON): the worker builds its Simulation with it, and a
 *    ScenarioError (invalid, or not fitting the model) comes back as an `error` message that lists the problems;
 *  - `done` carries `provenance`: the actuator log, breakpoints, scenario and runFingerprint of the finished run, so that a
 *    live run with interventions can be signed, exported and shared as an exact run (`getLog` asks for the same record at any
 *    time, e.g. to turn the interventions of a running shot into a scenario);
 *  - `frames` carries `ctl`, the control values of its frames (one row per frame, over Object.keys(meta.controls)), once the run has
 *    a scenario or a live intervention (the programmed and the actual lanes of the run view);
 *  - `probe` builds the model of a configuration (and the scenario, when given) without running it and answers with its
 *    SimMeta: the controls, diagnostics and end time the scenario editor needs before a run exists.
 */
import { ActuatorEntry, DiagSpec, HistoryFrame, Method, ReactorConfig, ShotReport, SimEvent } from '../physics/types';
import type { ScenarioSpec } from '../physics/scenario';

export const PROTOCOL_VERSION = 3;
/** the oldest protocol version this build still understands (v3 only adds optional fields and messages to v2) */
export const MIN_PROTOCOL_VERSION = 2;

/** Whether a peer that speaks version `v` can be talked to. */
export const isSupportedProtocol = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_PROTOCOL_VERSION && v <= PROTOCOL_VERSION;

export interface SimMeta {
  method: Method;
  kind: 'magnetic' | 'pulsed';
  timeUnit: 's' | 'ns' | 'µs';
  tEnd: number;
  diagSpecs: DiagSpec[];
  geometry: Record<string, number>;
  /** control values at load time (the model defaults for this configuration) */
  controls: Record<string, number>;
}

/** A history frame as the UI sees it: diagnostics and optional profiles/equilibrium only. */
export type UiFrame = Omit<HistoryFrame, 'y' | 'internal' | 'sim'>;

/** Strip the rewind-only payload (state vector, internal model state, kernel checkpoint) from a history frame. */
export function toUiFrame(f: HistoryFrame): UiFrame {
  const u: UiFrame = { t: f.t, d: f.d };
  if (f.prof) u.prof = f.prof;
  if (f.eq) u.eq = f.eq;
  return u;
}

/**
 * Everything that defines a run besides its configuration, as the simulation worker knows it: the live interventions (actuator log),
 * the user breakpoints, the scenario in force (validated, normalised) and the run fingerprint (runFingerprint of all of them, computed
 * with `appVersion`). It has the shape of the page's RunProvenance (ui/persist/types.ts), so the page can attach it to a run as it is.
 */
export interface RunProvenanceMsg {
  /** the number of live interventions: the length of the actuator log */
  interventions: number;
  actuatorLog: ActuatorEntry[];
  /** absent when there are none */
  breakpoints?: number[];
  /** absent for a run without a scenario */
  scenario?: ScenarioSpec;
  fingerprint: string;
  appVersion: string;
}

export type ToWorker =
  /** load a configuration; with autoPlay the worker starts playing right after `ready`; a scenario drives the controls of the run */
  | { type: 'init'; protocolVersion: number; id: number; cfg: ReactorConfig; autoPlay?: boolean; speed?: number; scenario?: ScenarioSpec }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'step'; simDt: number }
  /** rewind to history frame `index` and continue on timeline branch `branchId` */
  | { type: 'rewind'; index: number; branchId: number }
  | { type: 'control'; patch: Record<string, number> }
  /** the provenance of the live run as it stands (answered with `log`) */
  | { type: 'getLog'; token: number }
  /** the model of `cfg` (with the scenario, when given) without a run: answered with `probed` or `error` */
  | { type: 'probe'; protocolVersion: number; id: number; cfg: ReactorConfig; scenario?: ScenarioSpec }
  /** bağımsız tam koşu (doğrulama / hızlı sonuç): ayrı Simulation, canlı akışı bozmaz */
  | { type: 'runAll'; protocolVersion: number; id: number; cfg: ReactorConfig; keepFrames?: boolean; progress?: boolean; scenario?: ScenarioSpec };

export type FromWorker =
  | { type: 'ready'; protocolVersion: number; id: number; meta: SimMeta; frame: UiFrame }
  | { type: 'frames'; id: number; branchId: number; frames: UiFrame[]; events: SimEvent[]; t: number; done: boolean; dt: number; nSteps: number; controls: Record<string, number>; wallMs: number; ctl?: number[][] }
  | { type: 'rewound'; id: number; branchId: number; index: number; t: number; nEvents: number; controls: Record<string, number> }
  | { type: 'done'; id: number; branchId: number; report: ShotReport; provenance?: RunProvenanceMsg }
  /** answer to `getLog` */
  | { type: 'log'; id: number; branchId: number; token: number; provenance: RunProvenanceMsg }
  /** answer to `probe` */
  | { type: 'probed'; protocolVersion: number; id: number; meta: SimMeta }
  /** background full run (`runAll` with progress): simulated time reached so far */
  | { type: 'progress'; id: number; t: number; tEnd: number; frames: number }
  | { type: 'runAllDone'; protocolVersion: number; id: number; report: ShotReport; frames?: UiFrame[]; events?: SimEvent[]; meta: SimMeta }
  | { type: 'error'; msg: string; id?: number; branchId?: number };

/**
 * Oynatma hızı → simülasyon zamanı ölçeği.
 * Manyetik cihazlar (s): 1× = gerçek zaman. Darbeli cihazlar (ns/µs): 1× = tüm atış ~8 s duvar zamanında.
 */
export function simSecondsPerWallSecond(meta: { timeUnit: string; tEnd: number }): number {
  return meta.timeUnit === 's' ? 1 : meta.tEnd / 8;
}
