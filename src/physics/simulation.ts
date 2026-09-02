/**
 * Genel simülasyon çalıştırıcı: SimModel + DormandPrince → zaman serisi (HistoryFrame) + olaylar.
 * Worker ve CLI aynı sınıfı kullanır.
 */
import { DormandPrince } from './integrator';
import { HistoryFrame, ReactorConfig, ShotReport, SimEvent, SimModel } from './types';
import { MagneticModel } from './confinement/magnetic';
import { ICFModel } from './confinement/icf';
import { MTFModel } from './confinement/mtf';
import { FRCModel } from './confinement/frc';
import { MirrorModel } from './confinement/mirror';
import { MuonModel } from './confinement/muon';

export function createModel(cfg: ReactorConfig): SimModel {
  switch (cfg.method) {
    case 'tokamak': case 'spherical_tokamak': case 'stellarator': return new MagneticModel(cfg);
    case 'icf_direct': case 'icf_indirect': return new ICFModel(cfg);
    case 'mtf_liner': case 'mtf_piston': case 'maglif': case 'zpinch_sfs': return new MTFModel(cfg);
    case 'frc': return new FRCModel(cfg);
    case 'mirror': return new MirrorModel(cfg);
    case 'muon': return new MuonModel(cfg);
  }
}

export class Simulation {
  model: SimModel;
  t = 0;
  y: Float64Array;
  history: HistoryFrame[] = [];
  events: SimEvent[] = [];
  private integ: DormandPrince;
  private nextOut = 0;

  constructor(cfg: ReactorConfig) {
    this.model = createModel(cfg);
    this.y = this.model.initialState();
    this.integ = new DormandPrince(this.model.nState, (t, y, d) => this.model.rhs(t, y, d), this.model.integratorOpts, this.model.dt0);
    this.record();
  }

  get done(): boolean {
    return this.model.terminated !== null || this.t >= this.model.tEnd - 1e-12;
  }
  get dt(): number { return this.integ.dt; }
  get nSteps(): number { return this.integ.nSteps; }

  private record(): void {
    this.history.push({ t: this.t, y: Array.from(this.y), d: this.model.diagnostics(this.t, this.y), internal: this.model.saveInternal() });
    this.nextOut = this.t + this.model.outputDt;
  }

  /** Simülasyon zamanında `simDt` kadar ilerlet (birden çok adım). Yeni frame/olaylar döner. */
  advance(simDt: number): { frames: HistoryFrame[]; events: SimEvent[] } {
    const startFrames = this.history.length, startEv = this.events.length;
    const tTarget = Math.min(this.t + simDt, this.model.tEnd);
    let guard = 0;
    while (this.t < tTarget - 1e-12 && !this.model.terminated && guard++ < 200000) {
      const t0 = this.t;
      const tMax = Math.min(tTarget, this.nextOut);
      this.t = this.integ.step(this.t, this.y, tMax);
      const ev = this.model.postStep(this.t, this.t - t0, this.y);
      if (ev.length) this.events.push(...ev);
      if (this.t >= this.nextOut - 1e-12 || this.model.terminated || ev.some((e) => e.kind === 'ELM' || e.kind === 'sawtooth' || e.kind === 'disruption')) this.record();
    }
    if (this.t >= this.model.tEnd - 1e-12 && !this.model.terminated) {
      // model kendi terminated'ını postStep'te üretir; güvenlik
      this.model.postStep(this.t, 0, this.y);
    }
    return { frames: this.history.slice(startFrames), events: this.events.slice(startEv) };
  }

  /** Tamamına kadar koştur (CLI/doğrulama) */
  runAll(): ShotReport {
    let guard = 0;
    while (!this.done && guard++ < 10000) this.advance(this.model.tEnd / 100);
    return this.report();
  }

  report(): ShotReport {
    return this.model.report(this.history, this.events);
  }

  /** Geri sarma: frame indeksine dön; sonraki geçmiş silinir (dallanma) */
  rewindTo(frameIndex: number): void {
    const f = this.history[Math.max(0, Math.min(frameIndex, this.history.length - 1))];
    this.t = f.t;
    this.y = Float64Array.from(f.y);
    this.model.restoreInternal(f.internal);
    this.history = this.history.slice(0, frameIndex + 1);
    this.events = this.events.filter((e) => e.t <= f.t);
    this.integ = new DormandPrince(this.model.nState, (t, y, d) => this.model.rhs(t, y, d), this.model.integratorOpts, this.model.dt0);
    this.nextOut = this.t + this.model.outputDt;
  }

  applyControl(patch: Record<string, number>): void {
    this.model.applyControl(patch);
  }
}
