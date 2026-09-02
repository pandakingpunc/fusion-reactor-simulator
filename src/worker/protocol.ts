/**
 * Ana iş parçacığı ↔ simülasyon worker'ı mesaj sözleşmesi.
 * Fizik worker'da koşar; UI yalnızca bu mesajları görür.
 */
import { DiagSpec, HistoryFrame, Method, ReactorConfig, ShotReport, SimEvent } from '../physics/types';

export interface SimMeta {
  method: Method;
  kind: 'magnetic' | 'pulsed';
  timeUnit: 's' | 'ns' | 'µs';
  tEnd: number;
  diagSpecs: DiagSpec[];
  geometry: Record<string, number>;
  controls: Record<string, number>;
}

export type ToWorker =
  | { type: 'init'; id: number; cfg: ReactorConfig }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'step'; simDt: number }
  | { type: 'rewind'; index: number }
  | { type: 'control'; patch: Record<string, number> }
  | { type: 'report' }
  /** bağımsız tam koşu (doğrulama / hızlı sonuç): ayrı Simulation, canlı akışı bozmaz */
  | { type: 'runAll'; id: number; cfg: ReactorConfig; keepFrames?: boolean };

export type FromWorker =
  | { type: 'ready'; id: number; meta: SimMeta; frame: HistoryFrame }
  | { type: 'frames'; frames: HistoryFrame[]; events: SimEvent[]; t: number; done: boolean; dt: number; nSteps: number; controls: Record<string, number>; wallMs: number }
  | { type: 'rewound'; index: number; t: number; controls: Record<string, number> }
  | { type: 'done'; report: ShotReport }
  | { type: 'report'; report: ShotReport }
  | { type: 'runAllDone'; id: number; report: ShotReport; frames?: HistoryFrame[]; events?: SimEvent[]; meta: SimMeta }
  | { type: 'error'; msg: string; id?: number };

/**
 * Oynatma hızı → simülasyon zamanı ölçeği.
 * Manyetik cihazlar (s): 1× = gerçek zaman. Darbeli cihazlar (ns/µs): 1× = tüm atış ~8 s duvar zamanında.
 */
export function simSecondsPerWallSecond(meta: { timeUnit: string; tEnd: number }): number {
  return meta.timeUnit === 's' ? 1 : meta.tEnd / 8;
}
