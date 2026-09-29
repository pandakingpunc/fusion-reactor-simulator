/**
 * One-off jobs for the simulation worker that do not touch the live run, each in a worker of its own that ends with the job:
 * a full run (`runAll`, the embed view and the tests) and a probe of the model of a configuration (the scenario editor, the share
 * dialog). They live apart from the controller (state/sim.ts) so that the first-load bundle does not carry them: the pages that need them
 * are lazily loaded, and the controller's `runAll` loads this module on first use.
 */
import type { ReactorConfig } from '../../physics/types';
import type { ScenarioSpec } from '../../physics/scenario';
import { PROTOCOL_VERSION, type SimMeta } from '../../worker/protocol';
import type { WorkerFactory } from './sim';
import type { RunAllProgress, RunAllResult } from './types';

let lastId = 0;

/** Independent full run of a configuration (driven by a scenario when there is one), with progress messages when asked for. */
export function runAllInWorker(createWorker: WorkerFactory, cfg: ReactorConfig, keepFrames = false, onProgress?: (p: RunAllProgress) => void, scenario: ScenarioSpec | null = null): Promise<RunAllResult> {
  return new Promise((resolve, reject) => {
    const w = createWorker();
    const id = ++lastId;
    const fail = (msg: string) => { w.terminate(); reject(new Error(msg)); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress' && m.id === id) onProgress?.({ t: m.t, tEnd: m.tEnd, frames: m.frames });
      else if (m.type === 'runAllDone' && m.id === id) {
        if (m.protocolVersion !== PROTOCOL_VERSION) return fail(`Worker protocol mismatch: worker v${m.protocolVersion}, page v${PROTOCOL_VERSION}`);
        w.terminate();
        resolve({ report: m.report, meta: m.meta, frames: m.frames, events: m.events });
      } else if (m.type === 'error') fail(m.msg);
    };
    w.onerror = (ev) => fail(ev.message || 'Simulation worker failed');
    w.postMessage({ type: 'runAll', protocolVersion: PROTOCOL_VERSION, id, cfg, keepFrames, progress: !!onProgress, ...(scenario ? { scenario } : {}) });
  });
}

/** The model of a configuration without a run: its controls (configured values), diagnostics and end time. Rejects with the worker's message when it cannot be built. */
export function probeInWorker(createWorker: WorkerFactory, cfg: ReactorConfig, scenario: ScenarioSpec | null = null): Promise<SimMeta> {
  return new Promise((resolve, reject) => {
    const w = createWorker();
    const id = ++lastId;
    const fail = (msg: string) => { w.terminate(); reject(new Error(msg)); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'probed' && m.id === id) { w.terminate(); resolve(m.meta); } else if (m.type === 'error' && m.id === id) fail(m.msg);
    };
    w.onerror = (ev) => fail(ev.message || 'Simulation worker failed');
    w.postMessage({ type: 'probe', protocolVersion: PROTOCOL_VERSION, id, cfg, ...(scenario ? { scenario } : {}) });
  });
}
