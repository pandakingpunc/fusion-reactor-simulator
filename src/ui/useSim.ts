/**
 * Worker'ı saran React kancası: canlı simülasyon durumu + komutlar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HistoryFrame, ReactorConfig, ShotReport, SimEvent } from '../physics/types';
import { FromWorker, SimMeta, ToWorker } from '../worker/protocol';

export type SimStatus = 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'done' | 'error';

export interface SimState {
  status: SimStatus;
  cfg: ReactorConfig | null;
  meta: SimMeta | null;
  frames: HistoryFrame[];
  events: SimEvent[];
  t: number;
  dt: number;
  nSteps: number;
  controls: Record<string, number>;
  report: ShotReport | null;
  error: string | null;
  speed: number;
  wallMs: number;
  /** yeniden başlatma sayacı (grafik zoom sıfırlama vb.) */
  runId: number;
}

export interface RunAllResult { report: ShotReport; meta: SimMeta; frames?: HistoryFrame[]; events?: SimEvent[] }

const initial: SimState = {
  status: 'idle', cfg: null, meta: null, frames: [], events: [], t: 0, dt: 0, nSteps: 0, controls: {},
  report: null, error: null, speed: 1, wallMs: 0, runId: 0,
};

export function createSimWorker(): Worker {
  return new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
}

export function useSim() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<SimState>(initial);
  const idRef = useRef(0);
  const pendingRunAll = useRef(new Map<number, { resolve: (r: RunAllResult) => void; reject: (e: Error) => void }>());
  const autoPlayRef = useRef(false);

  useEffect(() => {
    const w = createSimWorker();
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      switch (m.type) {
        case 'ready':
          if (m.id !== idRef.current) return;
          setState((s) => {
            const auto = autoPlayRef.current;
            autoPlayRef.current = false;
            if (auto) w.postMessage({ type: 'play', speed: s.speed } satisfies ToWorker);
            return { ...s, status: auto ? 'running' : 'ready', meta: m.meta, frames: [m.frame], events: [], t: m.frame.t, dt: 0, nSteps: 0, controls: m.meta.controls, report: null, error: null };
          });
          break;
        case 'frames':
          setState((s) => ({
            ...s, frames: m.frames.length ? s.frames.concat(m.frames) : s.frames, events: m.events.length ? s.events.concat(m.events) : s.events,
            t: m.t, dt: m.dt, nSteps: m.nSteps, controls: m.controls, wallMs: m.wallMs,
            status: m.done ? 'done' : s.status === 'ready' || s.status === 'paused' ? s.status : 'running',
          }));
          break;
        case 'rewound':
          setState((s) => ({ ...s, status: 'paused', t: m.t, controls: m.controls, report: null, frames: s.frames.slice(0, m.index + 1), events: s.events.filter((ev) => ev.t <= m.t + 1e-12) }));
          break;
        case 'done':
          setState((s) => ({ ...s, status: 'done', report: m.report }));
          break;
        case 'report':
          setState((s) => ({ ...s, report: m.report }));
          break;
        case 'runAllDone': {
          const p = pendingRunAll.current.get(m.id);
          if (p) { pendingRunAll.current.delete(m.id); p.resolve({ report: m.report, meta: m.meta, frames: m.frames, events: m.events }); }
          break;
        }
        case 'error': {
          if (m.id !== undefined && pendingRunAll.current.has(m.id)) {
            pendingRunAll.current.get(m.id)!.reject(new Error(m.msg));
            pendingRunAll.current.delete(m.id);
          } else setState((s) => ({ ...s, status: 'error', error: m.msg }));
          break;
        }
      }
    };
    w.onerror = (ev) => setState((s) => ({ ...s, status: 'error', error: ev.message }));
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  const send = useCallback((m: ToWorker) => workerRef.current?.postMessage(m), []);

  /** Yeni atış yükle; autoPlay=true ise worker hazır olur olmaz oynatmaya başla. */
  const load = useCallback((cfg: ReactorConfig, autoPlay = false) => {
    const id = ++idRef.current;
    autoPlayRef.current = autoPlay;
    setState((s) => ({ ...initial, speed: s.speed, cfg, status: 'loading', runId: s.runId + 1 }));
    send({ type: 'init', id, cfg });
  }, [send]);

  const play = useCallback(() => {
    setState((s) => { if (s.status === 'ready' || s.status === 'paused') { send({ type: 'play', speed: s.speed }); return { ...s, status: 'running' }; } return s; });
  }, [send]);
  const pause = useCallback(() => { send({ type: 'pause' }); setState((s) => (s.status === 'running' ? { ...s, status: 'paused' } : s)); }, [send]);
  const setSpeed = useCallback((speed: number) => { send({ type: 'setSpeed', speed }); setState((s) => ({ ...s, speed })); }, [send]);
  const step = useCallback((simDt: number) => send({ type: 'step', simDt }), [send]);
  const rewind = useCallback((index: number) => send({ type: 'rewind', index }), [send]);
  const control = useCallback((patch: Record<string, number>) => {
    send({ type: 'control', patch });
    setState((s) => ({ ...s, controls: { ...s.controls, ...patch } }));
  }, [send]);
  const requestReport = useCallback(() => send({ type: 'report' }), [send]);
  const restart = useCallback(() => { setState((s) => { if (s.cfg) load(s.cfg); return s; }); }, [load]);

  /** Arka planda bağımsız tam koşu (canlı akışı etkilemez; ayrı worker kullanır). */
  const runAll = useCallback((cfg: ReactorConfig, keepFrames = false): Promise<RunAllResult> => {
    return new Promise((resolve, reject) => {
      const w = createSimWorker();
      const id = ++idRef.current + 1000000;
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'runAllDone') { resolve({ report: m.report, meta: m.meta, frames: m.frames, events: m.events }); w.terminate(); }
        else if (m.type === 'error') { reject(new Error(m.msg)); w.terminate(); }
      };
      w.onerror = (ev) => { reject(new Error(ev.message)); w.terminate(); };
      w.postMessage({ type: 'runAll', id, cfg, keepFrames } as ToWorker);
    });
  }, []);

  return useMemo(() => ({ state, load, play, pause, setSpeed, step, rewind, control, requestReport, restart, runAll }),
    [state, load, play, pause, setSpeed, step, rewind, control, requestReport, restart, runAll]);
}

export type SimApi = ReturnType<typeof useSim>;
