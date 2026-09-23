/**
 * Genel simülasyon çalıştırıcı: SimModel + DormandPrince → zaman serisi (HistoryFrame) + olaylar.
 * Kendi zaman adımlayıcısı olan modeller (1.5D örtük PDE çözücüsü) model.step() ile ilerler.
 * Worker ve CLI aynı sınıfı kullanır.
 */
import { DormandPrince } from './integrator';
import { HistoryFrame, MagneticConfig, ReactorConfig, ShotReport, SimEvent, SimModel } from './types';
import { MagneticModel } from './confinement/magnetic';
import { ICFModel } from './confinement/icf';
import { MTFModel } from './confinement/mtf';
import { FRCModel } from './confinement/frc';
import { MirrorModel } from './confinement/mirror';
import { MuonModel } from './confinement/muon';
import { ProfileModel, supportsProfiles } from './profiles/model';

export function createModel(cfg: ReactorConfig): SimModel {
  switch (cfg.method) {
    case 'tokamak': case 'spherical_tokamak': case 'stellarator':
      return (cfg as MagneticConfig).fidelity === '1.5D' && supportsProfiles(cfg) ? new ProfileModel(cfg) : new MagneticModel(cfg);
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
  private steps = 0;

  constructor(cfg: ReactorConfig) {
    this.model = createModel(cfg);
    this.y = this.model.initialState();
    this.integ = new DormandPrince(this.model.nState, (t, y, d) => this.model.rhs(t, y, d), this.model.integratorOpts, this.model.dt0);
    this.record(true);
  }

  get done(): boolean {
    return this.model.terminated !== null || this.t >= this.model.tEnd - 1e-12;
  }
  get dt(): number { return this.model.currentDt ?? this.integ.dt; }
  get nSteps(): number { return this.model.step ? this.steps : this.integ.nSteps; }

  /** regular: düzenli çıktı karesi (profiller yalnız bunlara eklenir — bellek sınırı) */
  private record(regular: boolean): void {
    const f: HistoryFrame = { t: this.t, y: Array.from(this.y), d: this.model.diagnostics(this.t, this.y), internal: this.model.saveInternal() };
    if (regular && this.model.profiles) f.prof = this.model.profiles(this.y);
    const eq = this.model.takeEqSnapshot?.();
    if (eq) f.eq = eq;
    this.history.push(f);
    if (regular) this.nextOut = this.t + this.model.outputDt;
  }

  /** Simülasyon zamanında `simDt` kadar ilerlet (birden çok adım). Yeni frame/olaylar döner. */
  advance(simDt: number): { frames: HistoryFrame[]; events: SimEvent[] } {
    const startFrames = this.history.length, startEv = this.events.length;
    const tTarget = Math.min(this.t + simDt, this.model.tEnd);
    let guard = 0;
    while (this.t < tTarget - 1e-12 && !this.model.terminated && guard++ < 200000) {
      const t0 = this.t;
      const tMax = Math.min(tTarget, this.nextOut);
      this.t = this.model.step ? this.model.step(this.t, this.y, tMax) : this.integ.step(this.t, this.y, tMax);
      this.steps++;
      const ev = this.model.postStep(this.t, this.t - t0, this.y);
      if (ev.length) this.events.push(...ev);
      const regular = this.t >= this.nextOut - 1e-12;
      if (regular || this.model.terminated || ev.some((e) => e.kind === 'ELM' || e.kind === 'sawtooth' || e.kind === 'disruption')) this.record(regular || !!this.model.terminated);
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
