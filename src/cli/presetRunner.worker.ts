/// <reference types="node" />
/**
 * İşçi: bir yapılandırmayı sonuna kadar koşturur; rapor + son %30 ortalamaları + zamanlama döner.
 * (Geçmiş karelerinin tamamı gönderilmez — bellek ve IPC dostu.)
 */
import { parentPort } from 'node:worker_threads';
import { Simulation } from '../physics/simulation';
import { flatTopAverages } from '../physics/analysis/flatTop';
import { ReactorConfig, ShotReport } from '../physics/types';

export interface RunTask { id: string; cfg: ReactorConfig; keepSeries?: string[] }
export interface RunResult {
  id: string;
  ok: boolean;
  error?: string;
  report?: ShotReport;
  avg?: Record<string, number>;
  series?: Record<string, number[]>;
  ms?: number;
  steps?: number;
  events?: Record<string, number>;
}

parentPort!.on('message', (task: RunTask) => {
  const t0 = performance.now();
  try {
    const sim = new Simulation(task.cfg);
    const report = sim.runAll();
    const hist = sim.history;
    const avg = flatTopAverages(hist);
    const events: Record<string, number> = {};
    for (const e of sim.events) events[e.kind] = (events[e.kind] ?? 0) + 1;
    let series: Record<string, number[]> | undefined;
    if (task.keepSeries?.length) {
      series = { t: hist.map((h) => h.t) };
      for (const k of task.keepSeries) series[k] = hist.map((h) => h.d[k] ?? NaN);
    }
    const out: RunResult = { id: task.id, ok: true, report, avg, series, ms: performance.now() - t0, steps: sim.nSteps, events };
    parentPort!.postMessage(out);
  } catch (e) {
    parentPort!.postMessage({ id: task.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) } satisfies RunResult);
  }
});
