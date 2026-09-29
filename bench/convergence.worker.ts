/// <reference types="node" />
/**
 * Worker for bench/convergence.ts: runs one configuration to the end and returns its flat-top
 * averages, the steps taken and, for the 1.5D model, the ELM count and the counters of its step control.
 * The time-step limit and the tolerance of the 1.5D model are settings of the configuration
 * (ProfileSettings.dtMax, rtol).
 */
import { parentPort } from 'node:worker_threads';
import { flatTopAverages } from '../src/physics/analysis/flatTop';
import { Simulation } from '../src/physics/simulation';
import type { ReactorConfig } from '../src/physics/types';

export interface ConvTask { id: string; cfg: ReactorConfig }
/** stats: accepted / rejected (error test) / failed (Picard, non-finite) attempts and localised events of the 1.5D stepper */
export interface ConvResult { id: string; ok: boolean; error?: string; avg?: Record<string, number>; ms?: number; steps?: number; nElm?: number; stats?: { accepted: number; rejected: number; failed: number; localised: number; picardIters: number } }

parentPort!.on('message', (task: ConvTask) => {
  const t0 = performance.now();
  try {
    const sim = new Simulation(task.cfg);
    sim.runAll();
    const stepper = (sim.model as { stepper?: { stats: NonNullable<ConvResult['stats']> } }).stepper;
    parentPort!.postMessage({
      id: task.id, ok: true, avg: flatTopAverages(sim.history), ms: performance.now() - t0, steps: sim.nSteps,
      nElm: sim.events.filter((e) => e.kind === 'ELM').length, ...(stepper ? { stats: { ...stepper.stats } } : {}),
    } satisfies ConvResult);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies ConvResult);
  }
});
