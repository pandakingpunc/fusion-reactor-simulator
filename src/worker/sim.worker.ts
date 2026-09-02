/**
 * Simülasyon worker'ı: fizik burada koşar, UI bloklanmaz.
 * Oynatma döngüsü ~30 Hz; her tikte duvar-saati × hız kadar simülasyon zamanı ilerletilir.
 */
import { Simulation } from '../physics/simulation';
import { ReactorConfig, SimModel } from '../physics/types';
import { FromWorker, SimMeta, ToWorker, simSecondsPerWallSecond } from './protocol';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let sim: Simulation | null = null;
let meta: SimMeta | null = null;
let playing = false;
let speed = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWall = 0;
const TICK_MS = 33;

function makeMeta(model: SimModel): SimMeta {
  return {
    method: model.method, kind: model.kind, timeUnit: model.timeUnit, tEnd: model.tEnd,
    diagSpecs: model.diagSpecs, geometry: model.geometryInfo(), controls: model.getControls(),
  };
}

function stopLoop() {
  playing = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

function tick() {
  timer = null;
  if (!sim || !meta || !playing) return;
  const now = performance.now();
  const wallDt = Math.min((now - lastWall) / 1000, 0.25); // sekme arka plana düşerse sıçrama olmasın
  lastWall = now;
  // simülasyon zamanı: duvar × hız × birim ölçeği; tek tikte en fazla atışın %5'i (UI akıcılığı)
  const simDt = Math.min(wallDt * speed * simSecondsPerWallSecond(meta), meta.tEnd / 20);
  const t0 = performance.now();
  const { frames, events } = sim.advance(simDt);
  const wallMs = performance.now() - t0;
  post({ type: 'frames', frames, events, t: sim.t, done: sim.done, dt: sim.dt, nSteps: sim.nSteps, controls: sim.model.getControls(), wallMs });
  if (sim.done) {
    stopLoop();
    post({ type: 'done', report: sim.report() });
    return;
  }
  // hesap tik süresinden uzun sürdüyse bir sonraki tik hemen
  timer = setTimeout(tick, Math.max(0, TICK_MS - wallMs));
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        stopLoop();
        sim = new Simulation(msg.cfg);
        meta = makeMeta(sim.model);
        post({ type: 'ready', id: msg.id, meta, frame: sim.history[0] });
        // model kurulumda bitmiş olabilir (ör. mıknatıs quench → atış iptal)
        if (sim.done) post({ type: 'done', report: sim.report() });
        break;
      }
      case 'play': {
        if (!sim || sim.done) break;
        speed = msg.speed;
        if (!playing) { playing = true; lastWall = performance.now(); timer = setTimeout(tick, 0); }
        break;
      }
      case 'pause': stopLoop(); break;
      case 'setSpeed': speed = msg.speed; break;
      case 'step': {
        if (!sim || !meta || sim.done) break;
        const { frames, events } = sim.advance(msg.simDt);
        post({ type: 'frames', frames, events, t: sim.t, done: sim.done, dt: sim.dt, nSteps: sim.nSteps, controls: sim.model.getControls(), wallMs: 0 });
        if (sim.done) post({ type: 'done', report: sim.report() });
        break;
      }
      case 'rewind': {
        if (!sim) break;
        stopLoop();
        sim.rewindTo(msg.index);
        post({ type: 'rewound', index: Math.min(msg.index, sim.history.length - 1), t: sim.t, controls: sim.model.getControls() });
        break;
      }
      case 'control': {
        if (sim) sim.applyControl(msg.patch);
        break;
      }
      case 'report': {
        if (sim) post({ type: 'report', report: sim.report() });
        break;
      }
      case 'runAll': {
        const s = new Simulation(msg.cfg as ReactorConfig);
        const report = s.runAll();
        post({ type: 'runAllDone', id: msg.id, report, meta: makeMeta(s.model), frames: msg.keepFrames ? s.history : undefined, events: msg.keepFrames ? s.events : undefined });
        break;
      }
    }
  } catch (err) {
    stopLoop();
    post({ type: 'error', msg: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err), id: (msg as { id?: number }).id });
  }
};
