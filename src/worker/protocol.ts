/**
 * Ana iş parçacığı ↔ simülasyon worker'ı mesaj sözleşmesi (protokol v2).
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
 */
import { DiagSpec, HistoryFrame, Method, ReactorConfig, ShotReport, SimEvent } from '../physics/types';

export const PROTOCOL_VERSION = 2;

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

export type ToWorker =
  /** load a configuration; with autoPlay the worker starts playing right after `ready` */
  | { type: 'init'; protocolVersion: number; id: number; cfg: ReactorConfig; autoPlay?: boolean; speed?: number }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'step'; simDt: number }
  /** rewind to history frame `index` and continue on timeline branch `branchId` */
  | { type: 'rewind'; index: number; branchId: number }
  | { type: 'control'; patch: Record<string, number> }
  /** bağımsız tam koşu (doğrulama / hızlı sonuç): ayrı Simulation, canlı akışı bozmaz */
  | { type: 'runAll'; protocolVersion: number; id: number; cfg: ReactorConfig; keepFrames?: boolean; progress?: boolean };

export type FromWorker =
  | { type: 'ready'; protocolVersion: number; id: number; meta: SimMeta; frame: UiFrame }
  | { type: 'frames'; id: number; branchId: number; frames: UiFrame[]; events: SimEvent[]; t: number; done: boolean; dt: number; nSteps: number; controls: Record<string, number>; wallMs: number }
  | { type: 'rewound'; id: number; branchId: number; index: number; t: number; nEvents: number; controls: Record<string, number> }
  | { type: 'done'; id: number; branchId: number; report: ShotReport }
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
