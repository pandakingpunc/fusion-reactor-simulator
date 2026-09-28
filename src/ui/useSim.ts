/**
 * Worker'ı saran React kancası: canlı simülasyon durumu + komutlar.
 * The logic lives in SimController (state/sim.ts); this hook owns its lifetime and subscribes to its store.
 */
import { useEffect, useMemo, useState } from 'react';
import { FrameScheduler, SimController, WorkerFactory, WorkerLike } from './state/sim';
import { useStore } from './state/store';

export function createSimWorker(): WorkerLike {
  return new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike;
}

const whole = <T,>(s: T) => s;

export function useSim(createWorker: WorkerFactory = createSimWorker, schedule?: FrameScheduler) {
  const [ctrl] = useState(() => new SimController(createWorker, schedule));
  useEffect(() => { ctrl.attach(); return () => ctrl.detach(); }, [ctrl]);
  const state = useStore(ctrl.store, whole);
  return useMemo(() => ({
    state, load: ctrl.load, play: ctrl.play, pause: ctrl.pause, setSpeed: ctrl.setSpeed, step: ctrl.step,
    rewind: ctrl.rewind, control: ctrl.control, restart: ctrl.restart, runAll: ctrl.runAll,
  }), [state, ctrl]);
}

export type SimApi = ReturnType<typeof useSim>;
