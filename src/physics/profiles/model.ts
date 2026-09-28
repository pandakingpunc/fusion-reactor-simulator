/**
 * 1.5D PROFİL MODELİ — tokamak / sferik tokamak.
 *
 * Radyal taşınım (ρ̂ = √(Φ/Φ_b), hücre-merkezli sonlu hacim) + sabit-sınırlı Grad–Shafranov
 * dengesi (periyodik, yarı-statik bağlaşım). Durum: T_e(ρ), T_i(ρ), n_e(ρ), ψ(ρ) + küresel
 * skalerler (He külü envanteri, safsızlık, yakıt oranı, sayaçlar, taşınım çarpanı, ada genişlikleri).
 *
 * Zaman adımı: örtük geri Euler (L-kararlı) + Picard iterasyonu (doğrusal olmayan katsayılar);
 * uyarlanır Δt (profil değişimi ≤ %8 hedefi), reddedilen adım yarılanır.
 *
 * Taşınım ('scaling' modu): χ(ρ) = C_χ(t)·(1 + c ρ²) [+ ETB + neoklasik taban + NTM adası].
 * C_χ, depolanan enerjiyi W → τ_E,ölçekleme(P_kayıp)·P_kayıp değerine çeken bir PI denetleyiciyle
 * ayarlanır: küresel dinamik doğrulanmış 0D ölçeklemesiyle tutarlı, profil ŞEKLİ ise kaynak
 * birikimi, pedestal, testere dişi, bootstrap ve akım difüzyonundan fiziksel olarak çıkar
 * (METIS/CRONOS 'τ_E-ölçekli' yaklaşımı — Artaud et al., Nucl. Fusion 58 (2018) 105001).
 * 'cgm' modu: kritik-gradyan modeli (Garbet et al., PPCF 46 (2004) 1351) — öngörücü, deneysel.
 *
 * Sınır koşulları: T_sep iki-nokta modeli (Stangeby, "The Plasma Boundary of Magnetic Fusion
 * Devices" §5): T_u = (7 q∥ L∥ / 2κ0e)^{2/7}, q∥ = P_SOL B/(2π R λ_q B_p), λ_q Eich (2013);
 * n_sep = f_sep ⟨n_e⟩; ψ' ← I_p (akım kontrollü).
 */
import { Geometry } from '../geometry';
import { FUEL_CHANNELS, FUEL_SPECIES } from '../reactivity';
import { tauIPB98y2, tauITER89P, tauSTValovic } from '../transport';
import { disruptionReport, DisruptionCause, DISRUPTION_LABELS, DISRUPTION_FIXES } from '../disruption';
import { checkMagnet, MAGNET_TECH, MagnetCheck } from '../engineering';
import { GSSolver, Equilibrium, EquilibriumOptions } from '../equilibrium/gs';
import { buildMagneticReport } from '../confinement/magneticReport';
import { flatTopMean } from '../analysis/flatTop';
import { EqSnapshot, HistoryFrame, MagneticConfig, ProfileSettings, ShotReport, SimEvent, SimModel, TerminationInfo } from '../types';
import { TransportGeometry, geometryFromEquilibrium } from './geometry1d';
import { GsAttempt, GsStage, acceptableEquilibrium, binomialSmooth, gridScalePasses, isUsableEquilibrium, isUsableGeometry, solveGuarded, solverErrorMessage } from './eqguard';
import { EquilibriumInitFailure, StepFailure } from './failures';
import { DEFAULT_PROFILE_SETTINGS } from './defaults';
import { HeatInputs } from './fvsolver';
import { edgeDeposition, gaussianDeposition, volumeIntegral } from './sources/deposition';
import { elmCrash, flattenConserving, kadomtsevMixingRadius, mreRate, rhoOfQ, shearAt } from './mhd';
import { CrashHook, KEV, MU0, PHASES, ProfileContext } from './context';
import { composition } from './composition';
import { currentProfiles, q95 } from './qprofile';
import { separatrixT } from './boundary/sol';
import { nTarget } from './control/actuators';
import { PROFILE_DIAGS, writeDiagnostics } from './diagnostics';
import { assembleHeatSources, defaultSources } from './sources';
import { createTransportModel } from './transport';
import { PhysicsPipeline } from './solver/pipeline';

export { DEFAULT_PROFILE_SETTINGS };
export { PROFILE_DIAGS };
export type { CrashSnapshot } from './context';

// implicit step retry policy (see ProfileModel.step)
const STEP_SHRINK = 0.4;
const STEP_MAX_ATTEMPTS = 12;
const STEP_DT_FLOOR = 1e-7;

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}



/** Profil modelinin kullanılabilir olduğu yapılandırmalar */
export function supportsProfiles(cfg: MagneticConfig): boolean {
  return cfg.method !== 'stellarator';
}

export class ProfileModel implements SimModel {
  readonly kind = 'magnetic' as const;
  readonly method: MagneticConfig['method'];
  readonly timeUnit = 's' as const;
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState: number;
  readonly diagSpecs = PROFILE_DIAGS;
  readonly integratorOpts = { rtol: 1e-4, atol: 1, dtMin: 1e-7, dtMax: 1 };
  readonly dt0 = 1e-3;

  /** shared state of the shot */
  readonly ctx: ProfileContext;
  private gsSolver: GSSolver;
  private magnetInfo: MagnetCheck;

  // dinamik iç durum
  private lastSaw = -1e9;
  private lastElm = -1e9;
  private elmTimes: number[] = [];
  private eqTime = 0;
  private eqBetaP = 0;
  private eqLi = 0;
  private ignited = false;
  private burning = false;
  private ntmOn32 = false;
  private ntmOn21 = false;

  // çalışma dizileri
  private depGas!: Float64Array; private depPel!: Float64Array;
  /** work-array evaluation: transport model and sources */
  readonly physics: PhysicsPipeline;

  get terminated(): TerminationInfo | null { return this.ctx.terminated; }
  get ps(): ProfileSettings { return this.ctx.ps; }
  get cfg(): MagneticConfig { return this.ctx.cfg; }
  /** Grad–Shafranov boundary shape (LCFS) */
  get geomB(): Geometry { return this.ctx.geomB; }
  get N(): number { return this.ctx.N; }
  get eq(): Equilibrium { return this.ctx.eq; }
  get tg(): TransportGeometry { return this.ctx.tg; }
  /** optional profile snapshots just before and after an MHD crash (figures; no effect on the run) */
  get crashHook(): CrashHook | null { return this.ctx.crashHook; }
  set crashHook(f: CrashHook | null) { this.ctx.crashHook = f; }

  constructor(cfg: MagneticConfig) {
    const ctx = (this.ctx = new ProfileContext(cfg));
    this.method = cfg.method;
    this.tEnd = cfg.t_end;
    this.outputDt = Math.max(cfg.t_end / 800, 0.002);
    this.nState = ctx.layout.size;
    this.physics = new PhysicsPipeline(ctx, createTransportModel(ctx.ps.transportModel), defaultSources());
    // fueling deposition profiles on the transport geometry
    ctx.onGeometry((tg) => {
      this.depGas = edgeDeposition(tg, 0.04);
      const depth = Math.min(Math.max(this.cfg.fueling.pelletDepth, 0.05), 1);
      this.depPel = gaussianDeposition(tg, 1 - 0.8 * depth, 0.1);
    });
    this.magnetInfo = checkMagnet(cfg.geometry, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m);
    this.gsSolver = new GSSolver(this.geomB, { NR: this.ps.eqNR });
    const eq0 = this.initialEquilibrium();
    ctx.adoptGeometry({ eq: eq0, tg: geometryFromEquilibrium(eq0, this.N, this.geomB) });
    this.eqBetaP = this.ctx.eq.betaP; this.eqLi = this.ctx.eq.li3;
    if (this.magnetInfo.quench) {
      this.ctx.phase = 'ended';
      this.ctx.terminated = {
        t: 0, natural: false, reason: 'Magnet quench',
        diagnosis: `Peak field in the toroidal field coil B_coil = ${this.magnetInfo.B_coil.toFixed(1)} T, ${MAGNET_TECH[cfg.magnet.tech].label} has a limit of ${this.magnetInfo.B_max} T. The coil quenched; shot aborted.`,
        fix: DISRUPTION_FIXES.magnet_quench,
      };
    } else if (this.eqInitFailure) {
      this.ctx.phase = 'ended';
      const b = this.geomB;
      this.ctx.terminated = {
        t: 0, natural: false, reason: 'Equilibrium failure',
        diagnosis: `No Grad–Shafranov equilibrium could be computed for the requested boundary (R = ${b.R} m, a = ${b.a} m, κ = ${b.kappa}, δ = ${b.delta}): ${this.eqInitFailure.detail}. The 1.5D model needs it for its transport geometry; shot aborted.`,
        fix: 'Bring elongation, triangularity and aspect ratio into the usual range, or run the shot at 0D fidelity.',
      };
    }
  }

  /**
   * Initial equilibrium: shape profile (j ∝ (1 − ψ_N²)^1.3, β_p = 0.1), cold start. Retry ladder:
   * nominal (relaxation 0.6, 200 iterations), then relaxation 0.3 with 600 iterations. A result
   * that did not converge but is usable is kept, reported in the shot report and raised as a
   * warning event at t = 0. If no attempt gives a usable equilibrium the shot cannot run: the
   * model is built on a stand-in equilibrium with a circular boundary of the same R and a (so that
   * the diagnostics of the aborted shot can be evaluated) and ends at t = 0 with eqInitFailure;
   * if even that fails, construction throws EquilibriumInitFailure.
   */
  private initialEquilibrium(): Equilibrium {
    const c = this.cfg;
    const base: EquilibriumOptions = { Ip: Math.max(c.Ip_MA, 0.05) * 1e6, B0: c.B0, profile: { kind: 'shape', alphaM: 2, alphaN: 1.3, betaP: 0.1 }, tol: 1e-7 };
    const stages: GsStage[] = [{ label: 'nominal', opts: {} }, { label: 'relaxation 0.3', opts: { relax: 0.3, maxIter: 600 } }];
    const out = solveGuarded(this.gsSolver, base, stages);
    if (out.eq) return out.eq;
    if (out.best) {
      const best = out.best;
      this.eqInitResidual = best.residual;
      this.ctx.pending.push({ t: 0, kind: 'warning', msg: `Initial Grad–Shafranov equilibrium did not converge (residual ${best.residual.toExponential(1)} after ${best.iterations} iterations) — used until the first accepted update` });
      return best;
    }
    const detail = out.attempts.map((a) => `${a.stage}: ${a.error ?? `residual ${a.residual.toExponential(1)}`}`).join('; ');
    try {
      const b = this.geomB;
      const standIn = new GSSolver({ R: b.R, a: b.a, kappa: 1, delta: 0 }, { NR: this.ps.eqNR }).solve({ ...base, relax: 0.3, maxIter: 600 });
      if (!isUsableEquilibrium(standIn)) throw new Error(`stand-in equilibrium unusable (residual ${standIn.residual.toExponential(1)})`);
      this.eqInitFailure = new EquilibriumInitFailure(detail);
      return standIn;
    } catch (e) {
      throw new EquilibriumInitFailure(`${detail}; circular stand-in: ${solverErrorMessage(e)}`, { cause: e });
    }
  }
  /** residual of an initial equilibrium kept without convergence (null: it converged) */
  eqInitResidual: number | null = null;
  /** set when no initial equilibrium existed for the requested boundary (the shot ends at t = 0) */
  eqInitFailure: EquilibriumInitFailure | null = null;

  get currentDt(): number { return this.ctx.dt; }



  private fuelingEfficiency(): number {
    switch (this.cfg.fueling.method) { case 'gas': return 0.3; case 'pellet': return 0.5 + 0.45 * Math.min(1, this.cfg.fueling.pelletDepth); case 'nbi': return 1.0; default: return 0.6; }
  }
  private fuelingDelay(): number {
    switch (this.cfg.fueling.method) { case 'gas': return 0.25; case 'pellet': return 0.03; case 'nbi': return 0.05; default: return 0.12; }
  }




  // ------------------------------------------------------------------ kaynaklar ve katsayılar





  // ------------------------------------------------------------------ SimModel
  initialState(): Float64Array {
    const N = this.N, c = this.cfg, g = this.ctx.tg;
    const y = new Float64Array(this.nState);
    const { Te, Ti, ne, psi, s } = this.ctx.view(y);
    const n0 = 0.3 * c.n_target;
    const fsep = this.ps.nsepFrac, an = c.transport.alpha_n;
    for (let i = 0; i < N; i++) {
      const r = g.rhoC[i];
      Te[i] = 0.05 + 1.9 * (1 - r * r);
      Ti[i] = 0.8 * Te[i];
      ne[i] = n0 * (fsep + (1 - fsep) * (1 + an) * Math.pow(1 - r * r, an));
    }
    // ψ: dengenin q profilinden ψ' = Φ_b ρ/(π q)
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const r0 = i === 0 ? 0 : g.rhoC[i - 1], r1 = g.rhoC[i];
      const qm = i === 0 ? g.qEqC[0] : 0.5 * (g.qEqC[i - 1] + g.qEqC[i]);
      const rm = 0.5 * (r0 + r1);
      acc += ((g.PhiB * rm) / (Math.PI * Math.max(qm, 0.3))) * (r1 - r0);
      psi[i] = acc;
    }
    s.NHe = 0;
    s.cZ = c.impurity.concentration;
    s.fA = c.fuelFracA;
    s.Cchi = 0.5; s.CI = 0.5;
    s.Ip = Math.max(c.Ip_MA, 0.05) * 1e6;
    s.Sfuel = 0;
    this.ctx.bc = { Te: 0.05, Ti: 0.05, n: fsep * n0 };
    composition(this.ctx, Te, ne, s);
    currentProfiles(this.ctx, psi, s.Ip);
    return y;
  }

  rhs(_t: number, _y: Float64Array, d: Float64Array): void { d.fill(0); }

  /**
   * One implicit transport step with Δt control. A failed attempt (Picard not converged, change
   * above 35 %, non-finite state, or an exception such as a zero pivot in the linear algebra) is
   * retried with Δt × 0.4. After STEP_MAX_ATTEMPTS attempts, or once Δt would fall below
   * STEP_DT_FLOOR, one forced attempt at that last Δt is accepted even without Picard convergence,
   * but only if its whole state is finite; otherwise the shot ends with a StepFailure at the last
   * accepted state. Time advances only by the Δt of the attempt whose state is committed.
   */
  step(t: number, y: Float64Array, tMax: number): number {
    if (this.ctx.phase === 'ended') return tMax;
    if (this.ctx.phase !== 'normal') return this.disruptionStep(t, y, tMax);
    const dtWant = this.ctx.dt;
    let dt = Math.min(dtWant, tMax - t);
    if (dt <= 0) return t;
    const truncated = dt < dtWant;
    const yOld = Float64Array.from(y);
    let r = this.tryImplicitStep(t, dt, yOld, y);
    let attempts = 1, retried = false, forced = false;
    while (!r.ok) {
      y.set(yOld);
      dt *= STEP_SHRINK; retried = true;
      forced = dt < STEP_DT_FLOOR || attempts >= STEP_MAX_ATTEMPTS;
      r = this.tryImplicitStep(t, dt, yOld, y);
      attempts++;
      if (forced) break;
    }
    if (forced && (r.error !== undefined || !allFinite(y))) {
      y.set(yOld);
      const detail = r.error !== undefined ? solverErrorMessage(r.error) : 'the forced attempt produced a non-finite state';
      this.failStep(new StepFailure(t, dt, attempts, detail, { cause: r.error }));
      return t;
    }
    if (forced) {
      this.forcedSteps++;
      if (!this.ctx.warned.has('forced')) {
        this.ctx.warned.add('forced');
        this.ctx.pending.push({ t: t + dt, kind: 'warning', msg: `Transport step at t = ${t.toFixed(4)} s did not converge in ${attempts - 1} attempts; forced at Δt = ${dt.toExponential(1)} s (Picard not converged) — accuracy is reduced here` });
      }
    }
    this.afterStep(t, dt, yOld, y);
    // uyarlanır Δt: hedef en büyük göreli değişim %8. Çıktı zamanına kesilmiş adım, önerilen
    // Δt'yi küçültmez (aksi halde her çıktı karesinden sonra Δt sıfırdan büyümek zorunda kalır).
    const change = r.change;
    const fac = change > 0 ? Math.min(1.5, Math.max(0.3, 0.08 / change)) : 1.5;
    const next = truncated && !retried ? Math.max(dtWant, dt * fac) : dt * fac;
    this.ctx.dt = Math.min(Math.max(next, 1e-6), 0.5);
    return t + dt;
  }

  /** implicitStep with anything it throws (linear algebra, non-finite coefficients) turned into a failed attempt */
  private tryImplicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): { ok: boolean; change: number; error?: unknown } {
    try {
      return this.implicitStep(t, dt, yOld, y);
    } catch (e) {
      return { ok: false, change: Infinity, error: e };
    }
  }

  /** Ends the shot on a numerical failure: explicit termination and 'end' event, state kept at the last accepted step */
  private failStep(e: StepFailure): void {
    this.stepFailure = e;
    this.ctx.phase = 'ended';
    this.ctx.terminated = {
      t: e.t, natural: false, reason: 'Numerical failure',
      diagnosis: `The implicit transport solver could not advance the plasma: ${e.message}. The shot was stopped at the last accepted state rather than continued with a non-converged or non-finite one.`,
      fix: 'This is a solver failure, not a plasma limit: try a coarser radial grid (nRho) or slower heating/density ramps, or run the shot at 0D fidelity.',
    };
    this.ctx.pending.push({ t: e.t, kind: 'end', msg: `Numerical failure — ${e.message}` });
  }
  /** set when the shot was ended by a numerical failure */
  stepFailure: StepFailure | null = null;
  /** steps accepted by the forced last resort (Picard not converged at the smallest Δt) */
  forcedSteps = 0;

  /** Örtük adım + Picard; dönüş: kabul ve en büyük göreli değişim */
  private implicitStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): { ok: boolean; change: number } {
    const N = this.N, w = this.ctx.w, g = this.ctx.tg, c = this.cfg;
    const o = this.ctx.view(yOld);
    const v = this.ctx.view(y);
    const s = v.s;
    // eski bileşim + akım profilleri
    composition(this.ctx, o.Te, o.ne, o.s);
    w.ni0.set(w.ni);
    currentProfiles(this.ctx, o.psi, o.s.Ip);
    // sınır koşulları (gecikmeli P_SOL). n_sep: kenar/SOL tarafından belirlenir — gaz beslemesinin
    // asıl etkisi ayırıcı yoğunluğudur; hedef n̄'ye bağlanır (çekirdek yoğunluğu çöküşüne karşı sağlam)
    const q95v = q95(this.ctx);
    const Tsep = separatrixT(this.ctx, this.ctx.PSOL, q95v, o.s.Ip);
    // gaz beslemesi ayırıcı yoğunluğunu yükseltir: n_sep = f_sep n̄_hedef × kazanç (kazanç afterStep'te
    // integral denetleyiciyle güncellenir)
    const nT = nTarget(this.ctx, t);
    this.ctx.bc = { Te: Tsep, Ti: Tsep, n: Math.min(this.ps.nsepFrac * nT * this.ctx.nsepGain, 0.6 * nT) };
    const K = this.physics.stepConstants(t, o);
    // besleme denetimi (açık): S_cmd = Γ_b − S_nbi + k_p V (n_T − ⟨n⟩)
    // (füzyon yanması elektron sayısını değiştirmez: D+T → He²⁺ + n; seyrelme bileşimde)
    const tauE = Math.max(this.ctx.lastDiag.tauE ?? 1, 0.01);
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauE, 0.05);
    const eff = this.fuelingEfficiency();
    const Smax = this.ctx.ctrl.fuelRate_1e20s * 1e20;
    // NBI parçacık kaynağı fiziksel olarak her zaman vardır (1.5D; enerji bileşenleri dahil)
    const S_nbi = K.S_nbi;
    let S_cmd = 0;
    if (this.ctx.phase === 'normal') {
      // hedef: çizgi-ortalamalı yoğunluk n̄ (deneysel/tasarım kuralı; Greenwald oranı da n̄ ile)
      const kp = 3 / tau_p;
      const nbar = this.ctx.lineAvg(o.ne);
      S_cmd = Math.max(0, Math.min(Smax, (Math.max(this.ctx.GammaB, 0) - S_nbi + kp * g.volume * (nTarget(this.ctx, t) - nbar)) / eff));
    }
    const lag = 1 - Math.exp(-dt / this.fuelingDelay());
    s.Sfuel = o.s.Sfuel + (S_cmd - o.s.Sfuel) * lag;
    const Sfuel = s.Sfuel * eff; // plazmaya giren [1/s]
    const absorbed = Math.max(volumeIntegral(g, w.nbiDep), 1e-6);
    for (let i = 0; i < N; i++) {
      let sh: number;
      switch (c.fueling.method) {
        case 'gas': sh = this.depGas[i]; break;
        case 'pellet': sh = this.depPel[i]; break;
        case 'nbi': sh = w.nbiDep[i] > 0 ? w.nbiDep[i] / absorbed : this.depGas[i]; break;
        default: sh = 0.5 * (this.depGas[i] + this.depPel[i]);
      }
      w.Sn[i] = Sfuel * sh + w.nbiPart[i];
    }
    // Picard
    const heatIn: HeatInputs = {
      dt, ne0: o.ne, ne1: v.ne, ni0: w.ni0, ni1: w.ni, Te0: o.Te, Ti0: o.Ti, chiE: w.chiE, chiI: w.chiI,
      Qe: w.Qe, Qi: w.Qi, Le: w.Le, Li: w.Li, TeStar: w.TeIt, TiStar: w.TiIt, nuEq: w.nuEq, GammaF: this.ctx.dens.GammaF,
      convCoef: 2.5, TeB: this.ctx.bc.Te, TiB: this.ctx.bc.Ti, nB: this.ctx.bc.n,
    };
    let conv = false;
    for (let it = 0; it < 8; it++) {
      w.TeIt.set(v.Te); w.TiIt.set(v.Ti); w.neIt.set(v.ne);
      this.physics.transportCoefficients(v);
      // sert (gradyana bağlı) taşınımda Picard salınımını önlemek için χ gevşetmesi
      if (it > 0) for (let f = 0; f <= N; f++) { w.chiE[f] = 0.5 * (w.chiE[f] + w.chiEp[f]); w.chiI[f] = 0.5 * (w.chiI[f] + w.chiIp[f]); }
      w.chiEp.set(w.chiE); w.chiIp.set(w.chiI);
      // 1) yoğunluk
      this.ctx.dens.solve({ dt, n0: o.ne, D: w.D, v: w.v, S: w.Sn, nB: this.ctx.bc.n }, v.ne);
      for (let i = 0; i < N; i++) if (!(v.ne[i] > 1e15)) v.ne[i] = 1e15;
      composition(this.ctx, v.Te, v.ne, s);
      // 2) kaynaklar
      this.physics.heatSources(v, K);
      currentProfiles(this.ctx, v.psi, s.Ip);
      this.physics.currentSources(v, K);
      assembleHeatSources(this.ctx);
      // 3) ısı (T_e, T_i birlikte)
      this.ctx.heat.solve(heatIn, v.Te, v.Ti);
      for (let i = 0; i < N; i++) { if (!(v.Te[i] > 0.005)) v.Te[i] = 0.005; if (!(v.Ti[i] > 0.005)) v.Ti[i] = 0.005; }
      // 4) akım
      this.ctx.cur.solve({ dt, psi0: o.psi, sigma: w.sigma, jniB: w.jniB, Ip: s.Ip }, v.psi);
      // yakınsama
      let dmax = 0;
      for (let i = 0; i < N; i++) {
        dmax = Math.max(dmax, Math.abs(v.Te[i] - w.TeIt[i]) / Math.max(w.TeIt[i], 0.05),
          Math.abs(v.Ti[i] - w.TiIt[i]) / Math.max(w.TiIt[i], 0.05), Math.abs(v.ne[i] - w.neIt[i]) / Math.max(w.neIt[i], 1e17));
      }
      if (dmax < 2e-3 && it > 0) { conv = true; break; }
    }
    // son tutarlılık
    composition(this.ctx, v.Te, v.ne, s);
    currentProfiles(this.ctx, v.psi, s.Ip);
    let change = 0, finite = true;
    for (let i = 0; i < N; i++) {
      if (!isFinite(v.Te[i]) || !isFinite(v.Ti[i]) || !isFinite(v.ne[i]) || !isFinite(v.psi[i])) finite = false;
      change = Math.max(change, Math.abs(v.Te[i] - o.Te[i]) / Math.max(o.Te[i], 0.1), Math.abs(v.Ti[i] - o.Ti[i]) / Math.max(o.Ti[i], 0.1),
        Math.abs(v.ne[i] - o.ne[i]) / Math.max(o.ne[i], 1e18));
    }
    this.ctx.lastK = K;
    return { ok: finite && (conv || dt < 1e-4) && change < 0.35, change };
  }


  /** Kabul edilen adım sonrası: skalerler, denetleyiciler, adalar, teşhis */
  private afterStep(t: number, dt: number, yOld: Float64Array, y: Float64Array): void {
    const N = this.N, w = this.ctx.w, g = this.ctx.tg, c = this.cfg, ps = this.ps;
    const v = this.ctx.view(y), o = this.ctx.view(yOld), s = v.s;
    const K = this.ctx.lastK!;
    // integraller [W]
    const I = (a: Float64Array) => volumeIntegral(g, a);
    const P_fus = I(w.Pfus), P_chg = I(w.Pchg), P_neut = I(w.Pneut), P_bt = I(w.Pbt);
    const P_aux_abs = I(w.PnbiE) + I(w.PnbiI) + I(w.PicE) + I(w.PicI) + I(w.PecE);
    const P_oh = I(w.Poh), P_alpha = P_chg;
    const P_brems = I(w.Pbr), P_line = I(w.Pline), P_sync = K.Psync, P_rad = P_brems + P_line + P_sync;
    const P_heat = P_aux_abs + P_oh + P_alpha;
    const Rfus = I(w.Rfus), Nn = I(w.Nfus);
    let We = 0, Wi = 0;
    for (let i = 0; i < N; i++) { We += 1.5 * v.ne[i] * v.Te[i] * KEV * g.dV[i]; Wi += 1.5 * w.ni[i] * v.Ti[i] * KEV * g.dV[i]; }
    const W = We + Wi;
    let W0 = 0;
    for (let i = 0; i < N; i++) W0 += 1.5 * (o.ne[i] * o.Te[i] + w.ni0[i] * o.Ti[i]) * KEV * g.dV[i];
    const dWdt = (W - W0) / dt;
    this.ctx.GammaB = this.ctx.dens.GammaF[N];
    this.ctx.lastVloop = (2 * Math.PI * (v.psi[N - 1] - o.psi[N - 1])) / dt;
    // ELM ortalama gücü (üstel hafıza τ = 1 s)
    s.Pelm = o.s.Pelm * Math.exp(-dt / 1.0);
    // P_SOL: küresel güç dengesinden (anlık sınır akısından değil — T_sep ↔ akı geri beslemesi
    // adım-adım salınım üretir), τ ≈ 20 ms gecikmeli
    const PsolTarget = Math.max(P_heat - P_rad - dWdt, 0.05 * P_heat, 1e5);
    this.ctx.PSOL += (PsolTarget - this.ctx.PSOL) * (1 - Math.exp(-dt / 0.02));
    // τ_E ölçeklemesi
    const Ip_MA = s.Ip / 1e6;
    const nbar = this.ctx.lineAvg(v.ne);
    const P_loss = this.lossPower(P_heat, P_rad);
    const gS: Geometry = { R: g.R0, a: g.a, kappa: this.ctx.kappaA, delta: this.geomB.delta };
    let tauS: number;
    if (this.ctx.hmode) tauS = this.ctx.ctrl.H98 * (c.scaling === 'ST_Valovic' ? tauSTValovic(gS, Ip_MA, g.B0, nbar, P_loss, this.ctx.M) : tauIPB98y2(gS, Ip_MA, g.B0, nbar, P_loss, this.ctx.M));
    else tauS = c.H89 * tauITER89P(gS, Math.max(Ip_MA, 0.05), g.B0, nbar, P_loss, this.ctx.M);
    // NTM kuşak modeli: ΔW/W ≈ −4 Σ ρ_s² w/a
    let fNTM = 1;
    for (const [key, qv] of [['w32', 1.5], ['w21', 2]] as const) {
      const rs = rhoOfQ(g, w.qF, qv);
      if (rs > 0 && s[key] > 0) fNTM -= 4 * rs * rs * (s[key] / g.a);
    }
    fNTM = Math.max(fNTM, 0.5);
    // scaling-law confinement time with the NTM degradation: the target of the C_χ controller
    const tauScal = Math.max(tauS * fNTM, 1e-3);
    // Plasma confinement time. 'scaling': the controller holds W ≈ τ_scal·P_loss, so τ_E is the
    // scaling value. 'cgm': transport is predictive and nothing ties W to the scaling law, so τ_E is
    // what the profiles give, W/P_loss, with the same P_loss the scaling law is evaluated at.
    // tauT (floored) sets the particle, He-ash and impurity times, which are ratios to τ_E.
    const cgm = ps.transportModel === 'cgm';
    const tauE = cgm ? W / P_loss : tauScal;
    const tauT = cgm ? Math.max(tauE, 1e-3) : tauScal;
    // C_χ PI denetleyici (scaling modu): W → τ_scal · P_loss
    if (!cgm) {
      const Wt = tauScal * P_loss;
      const err = Math.log(Math.max(W, 1) / Math.max(Wt, 1));
      const tauI = 0.3 * tauScal;
      // anti-windup: integral terimi difüzyon tahmini C_est = a²κ_a/(6τ(1+c/2)) çevresinde sınırlı
      const Cest = (g.a * g.a * this.ctx.kappaA) / (6 * tauScal * (1 + 0.5 * ps.chiShape));
      const CI = o.s.CI * Math.exp(Math.max(-0.5, Math.min(0.5, (dt / tauI) * err)));
      s.CI = Math.min(Math.max(CI, 0.1 * Cest), 10 * Cest);
      s.Cchi = Math.min(Math.max(s.CI * Math.exp(Math.max(-1.5, Math.min(1.5, 1.5 * err))), 1e-4), 1e4);
    } else { s.CI = o.s.CI; s.Cchi = 1; }
    // ayırıcı yoğunluk kazancı (yalnız gaz beslemesi — pellet/NBI çekirdeği doğrudan besler):
    // n̄ hedefin altındaysa n_sep yükselir (τ ≈ τ_p), [0.5, 2.5]
    if (this.ctx.phase === 'normal' && (c.fueling.method === 'gas' || c.fueling.method === 'mixed')) {
      const tauN = Math.max(c.transport.tau_p_over_tau_E * tauT, 0.1);
      const e = Math.log(nTarget(this.ctx, t + dt) / Math.max(nbar, 1e15));
      this.ctx.nsepGain = Math.min(Math.max(this.ctx.nsepGain * Math.exp(Math.max(-0.2, Math.min(0.2, (dt / tauN) * e))), 0.5), 2.5);
    }
    // He külü, safsızlık, yakıt oranı
    const Ne = volumeIntegral(g, v.ne);
    const tauHe = Math.max(c.transport.tau_He_over_tau_E * tauT, 1e-2);
    const ashPerRx = c.fuel === 'pB11' ? 3 : c.fuel === 'DD' ? 0.5 : 1;
    s.NHe = Math.max(0, o.s.NHe + dt * (Rfus * ashPerRx - o.s.NHe / tauHe));
    const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauT, 1e-2);
    const tauW_accum = c.impurity.species === 'W' && (!c.events.elms || !c.events.sawteeth) ? 4 : 1;
    const S_W = c.impurity.species === 'W' ? (c.impurity.W_source_frac * this.ctx.PSOL) / (5000 * KEV) : 0;
    const tauZ = tau_p * tauW_accum;
    s.cZ = Math.max(0, o.s.cZ + dt * ((this.ctx.ctrl.cZ - o.s.cZ) / tauZ + S_W / Math.max(Ne, 1)));
    const fs = FUEL_SPECIES[c.fuel];
    let burnA = 0, burnAll = 0;
    for (let i = 0; i < N; i++) { burnA += w.burnA[i] * g.dV[i]; burnAll += (w.burnA[i] + w.burnB[i]) * g.dV[i]; }
    const eff = this.fuelingEfficiency();
    const Sf = s.Sfuel * eff;
    const S_nbi = K.S_nbi;
    const wA = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
    // demet izotop karışımı: 'nbi' beslemede saf tür a (D); aksi halde yakıt karışımını izler
    // (JET DTE2'de D ve T demetleri birlikte — Mailloux et al., Nucl. Fusion 62 (2022) 042026)
    const wBeam = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
    const Nfuel = volumeIntegral(g, w.na) + volumeIntegral(g, w.nb);
    if (!FUEL_CHANNELS[c.fuel][0].sameSpecies && Nfuel > 0) {
      const Sa = Sf * wA + S_nbi * wBeam, Stot = Sf + S_nbi;
      const dfA = (Sa - burnA - o.s.fA * (Stot - burnAll)) / Nfuel;
      s.fA = Math.min(Math.max(o.s.fA + dt * dfA, 0.01), 0.99);
    } else s.fA = o.s.fA;
    // sayaçlar
    s.Efus = o.s.Efus + P_fus * dt;
    s.Ein = o.s.Ein + (K.P_NBI + K.P_IC + K.P_EC + P_oh) * dt;
    s.Nn = o.s.Nn + Nn * dt;
    if (c.fuel === 'DT') { s.NTburn = o.s.NTburn + Rfus * dt; s.NTfuel = o.s.NTfuel + Sf * (1 - wA) * dt; }
    // NTM adaları (MRE, açık Euler alt adımlarla)
    for (const [key, m, qv] of [['w32', 3, 1.5], ['w21', 2, 2]] as const) {
      let wv = o.s[key];
      if (wv <= 0 || !c.events.ntm) { s[key] = 0; continue; }
      const rs = rhoOfQ(g, w.qF, qv);
      if (rs <= 0) { s[key] = 0; continue; }
      const i = Math.min(N - 2, Math.max(1, Math.floor(rs / g.dRho)));
      const rsm = 0.5 * (g.RoutC[i] - g.RinC[i]);
      const eta = 1 / Math.max(w.sigma[i], 1);
      const pS = w.p[i];
      const dp = (w.p[i + 1] - w.p[i - 1]) / (2 * g.dRho) * g.gradRhoC[i];
      const dq = (w.qF[i + 1] - w.qF[i]) / g.dRho * g.gradRhoC[i];
      const Lp = pS / Math.max(-dp, 1e-6), Lq = qv / Math.max(dq, 1e-6);
      const Bth = (g.epsC[i] * g.B0) / qv;
      const bth = (2 * MU0 * pS) / (Bth * Bth);
      const wd = 0.012 * (g.a / 2);
      // a_bs ≈ 1: doymuş ada w/a ≈ 0.05–0.1 (JET/DIII-D 3/2 NTM deneysel aralığı; La Haye 2006)
      const par = { eta, m, rs: rsm, eps: g.epsC[i], betaTheta: bth, LqOverLp: Math.min(Lq / Math.max(Lp, 1e-3), 5), wd, aBs: 1.0, aPol: 0.5 };
      const nsub = 20;
      for (let k = 0; k < nsub; k++) wv = Math.max(0, wv + (dt / nsub) * mreRate(wv, par));
      if (wv < 0.2 * wd) wv = 0;
      s[key] = Math.min(wv, 0.4 * g.a);
    }
    // teşhis
    writeDiagnostics(this.ctx, t + dt, v, { P_fus, P_chg, P_neut, P_bt, P_aux_abs, P_oh, P_alpha, P_brems, P_line, P_sync, P_rad, P_heat, W, dWdt, tauE, tauScal, P_loss, nbar });
    this.eqCheck(t + dt, y);
  }


  // ------------------------------------------------------------------ denge güncellemesi
  /**
   * Denge güncelleme politikası: en geç eqUpdateInterval'da bir; β_p veya ℓ_i belirgin
   * değişirse (%10 / %5) daha erken — ama iki güncelleme arası en az ¼ aralık (yarı-statik
   * bağlaşım: denge, taşınım zaman ölçeğine göre yavaş evrilir).
   */
  private eqCheck(t: number, y: Float64Array): void {
    const d = this.ctx.lastDiag;
    const dBp = Math.abs((d.betaP ?? 0) - this.eqBetaP) / Math.max(this.eqBetaP, 0.05);
    const dLi = Math.abs((d.li ?? 0) - this.eqLi) / Math.max(this.eqLi, 0.1);
    const since = t - this.eqTime;
    const due = since >= this.ps.eqUpdateInterval || ((dBp > 0.1 || dLi > 0.05) && since > 0.25 * this.ps.eqUpdateInterval);
    if (!due || this.ctx.phase !== 'normal' || t < this.eqRetryAt) return;
    if (this.updateEquilibrium(t, y)) {
      this.eqTime = t;
      this.eqBetaP = d.betaP ?? this.eqBetaP; this.eqLi = d.li ?? this.eqLi;
      this.eqUpdates++;
      this.eqFailStreak = 0;
      return;
    }
    // eqTime advances only on success, so the update stays due. It is retried after a quarter
    // interval, doubling for consecutive rejections up to a full interval (a persistently failing
    // equilibrium must not cost a full retry ladder every quarter interval).
    this.eqRejected++;
    this.eqFailStreak++;
    this.eqRetryAt = t + 0.25 * this.ps.eqUpdateInterval * Math.min(2 ** (this.eqFailStreak - 1), 4);
    if (!this.ctx.warned.has('gs')) {
      this.ctx.warned.add('gs');
      const last = this.eqAttempts[this.eqAttempts.length - 1];
      const why = last?.error ?? `residual ${last ? last.residual.toExponential(1) : '?'} after ${last?.iterations ?? 0} iterations`;
      this.ctx.pending.push({ t, kind: 'warning', msg: `Grad–Shafranov update rejected (${why}; ${this.eqAttempts.length} attempts) — geometry held at the equilibrium of t = ${this.eqTime.toFixed(2)} s, retried from t = ${this.eqRetryAt.toFixed(2)} s` });
    }
  }
  /** accepted Grad–Shafranov updates after the initial solve */
  eqUpdates = 0;
  /** accepted updates that needed a retry stage; updates for which every stage failed */
  eqRetried = 0;
  eqRejected = 0;
  /** no update attempt before this time (back-off after a rejected update); consecutive rejections */
  private eqRetryAt = 0;
  private eqFailStreak = 0;
  /** last GS solve statistics and the attempt log of the last update (diagnostics) */
  eqStats = { it: 0, res: 0 };
  eqAttempts: GsAttempt[] = [];

  /**
   * Grad–Shafranov update from the transport profiles (table mode: p, ⟨j_φ/R⟩ on the current ψ_N
   * nodes); on success the transport geometry is replaced. t is the time of y. Returns whether the
   * new equilibrium was accepted.
   *
   * Retry ladder (each stage warm-starts from the last accepted equilibrium):
   *  1. nominal: relaxation 0.9, 40 Picard iterations (quasi-static change converges in ~8–12);
   *  2. relaxation 0.5, 80 iterations;
   *  3. pressure table low-pass filtered at the GS grid scale (binomialSmooth, Gaussian σ = grid
   *     spacing), relaxation 0.3, 120 iterations. The Dirichlet edge condition puts the drop to
   *     p_sep within half a transport cell (Δρ = 1/(2N)), well below the GS grid spacing (≈ 0.044
   *     in ρ for 49 nodes); the 5-point operator cannot represent that p', and Picard then cycles
   *     as nodes move in and out of the drop (JET15: 14 of 17 updates stalled at residuals
   *     1e-3–3e-2 with the nominal settings, and relaxation alone rescues few of them).
   */
  updateEquilibrium(t: number, y: Float64Array): boolean {
    const g = this.ctx.tg, w = this.ctx.w, N = this.N, v = this.ctx.view(y);
    const P = this.ctx.eq.prof;
    const niB = this.ctx.bc.n * (w.ni[N - 1] / Math.max(v.ne[N - 1], 1));
    const pB = (this.ctx.bc.n * this.ctx.bc.Te + niB * this.ctx.bc.Ti) * KEV;
    const pAt = (r: number) => {
      if (r <= g.rhoC[0]) return w.p[0];
      if (r >= g.rhoC[N - 1]) { const t = (r - g.rhoC[N - 1]) / (1 - g.rhoC[N - 1]); return w.p[N - 1] + t * (pB - w.p[N - 1]); }
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return w.p[i] + t * (w.p[i + 1] - w.p[i]);
    };
    // akı-yüzeyi ortalamalı ⟨j_φ/R⟩ = 2π dI/dV (taşınım geometrisinde; hücre merkezlerinde)
    const jRc = new Float64Array(N);
    for (let i = 0; i < N; i++) jRc[i] = Math.max((2 * Math.PI * (w.IencF[i + 1] - w.IencF[i])) / g.dV[i], 0);
    const jRAt = (r: number) => {
      if (r <= g.rhoC[0]) return jRc[0];
      if (r >= g.rhoC[N - 1]) return jRc[N - 1];
      const i = Math.min(N - 2, Math.floor((r - g.rhoC[0]) / g.dRho));
      const t = (r - g.rhoC[i]) / g.dRho;
      return jRc[i] + t * (jRc[i + 1] - jRc[i]);
    };
    const pT = Array.from(P.rhoTor, pAt);
    const jT = Array.from(P.rhoTor, jRAt);
    const Ip = v.s.Ip;
    const base: EquilibriumOptions = { Ip, B0: this.cfg.B0, profile: { kind: 'table', psiN: P.psiN, p: pT, jR: jT }, psiInit: this.ctx.eq.psi, tol: 1e-5, maxIter: 40, relax: 0.9 };
    const passes = gridScalePasses(this.gsSolver.grid.dR / this.geomB.a, 1 / (P.psiN.length - 1));
    const stages: GsStage[] = [
      { label: 'nominal', opts: {} },
      { label: 'relaxation 0.5', opts: { relax: 0.5, maxIter: 80 } },
      { label: 'grid-scale pressure', opts: { relax: 0.3, maxIter: 120, profile: { kind: 'table', psiN: P.psiN, p: binomialSmooth(pT, passes), jR: jT } } },
    ];
    // the transport geometry built from it must be usable as well (finite metrics, positive cell volumes)
    const built: { tg?: TransportGeometry } = {};
    const accept = (eq: Equilibrium) => {
      built.tg = undefined;
      if (!acceptableEquilibrium(eq)) return false;
      try { built.tg = geometryFromEquilibrium(eq, N, this.geomB); } catch { return false; }
      return isUsableGeometry(built.tg);
    };
    const out = solveGuarded(this.gsSolver, base, stages, accept);
    this.eqAttempts = out.attempts;
    const last = out.attempts[out.attempts.length - 1];
    this.eqStats = { it: last.iterations, res: last.residual };
    if (!out.eq || !built.tg) return false;
    if (out.stage > 0) this.eqRetried++;
    this.ctx.adoptGeometry({ eq: out.eq, tg: built.tg });
    // postStep (ELM, sawtooth) runs next and reads n_i, q, p: evaluate them on the new geometry
    this.physics.evaluateWorkArrays(t, v);
    return true;
  }

  takeEqSnapshot(): EqSnapshot | null {
    if (!this.ctx.eqDirty) return null;
    this.ctx.eqDirty = false;
    return this.eqSnapshot();
  }

  /** Kesit çizimi için akı yüzeyleri (ρ_tor = 0.1 … 1.0) */
  eqSnapshot(nSurf = 10, nPts = 72): EqSnapshot {
    const eq = this.ctx.eq, tr = eq.surfaces, P = eq.prof;
    const R: number[][] = [], Z: number[][] = [], rho: number[] = [];
    const nS = tr.R.length;
    for (let s = 1; s <= nSurf; s++) {
      const target = s / nSurf;
      // en yakın ρ_tor yüzeyi (P indeksleri: k+1 ↔ tr k)
      let best = 0, bd = Infinity;
      for (let k = 0; k < nS; k++) { const d = Math.abs(P.rhoTor[k + 1] - target); if (d < bd) { bd = d; best = k; } }
      const rr: number[] = [], zz: number[] = [];
      const n = tr.R[best].length, stride = Math.max(1, Math.floor(n / nPts));
      for (let j = 0; j < n; j += stride) { rr.push(tr.R[best][j]); zz.push(tr.Z[best][j]); }
      R.push(rr); Z.push(zz); rho.push(P.rhoTor[best + 1]);
    }
    return { R, Z, rho, Raxis: eq.Raxis, Zaxis: eq.Zaxis, q95: eq.q95, li: eq.li3, betaP: eq.betaP };
  }

  // ------------------------------------------------------------------ olaylar
  postStep(t: number, _dt: number, y: Float64Array): SimEvent[] {
    const ev: SimEvent[] = this.ctx.pending.splice(0);
    if (this.ctx.terminated) return ev;
    const c = this.cfg, g = this.ctx.tg, w = this.ctx.w, N = this.N, ps = this.ps;
    const v = this.ctx.view(y), s = v.s;
    const d = this.ctx.lastDiag;
    if (!d.Te) return ev;
    if (this.ctx.phase === 'normal') {
      // L-H geçişi (Martin eşiği, histerezis 0.7)
      const P_L = d.P_loss;
      if (!this.ctx.hmode && P_L > d.P_LH && t > 0.05) {
        this.ctx.hmode = true; ev.push({ t, kind: 'LH', msg: `L→H transition: P_loss ${P_L.toFixed(1)} MW > P_LH ${d.P_LH.toFixed(1)} MW — edge transport barrier forms` });
      } else if (this.ctx.hmode && P_L < 0.7 * d.P_LH) {
        this.ctx.hmode = false; ev.push({ t, kind: 'HL', msg: `H→L back-transition: P_loss ${P_L.toFixed(1)} MW < 0.7·P_LH ${(0.7 * d.P_LH).toFixed(1)} MW — pedestal lost` });
      }
      // ELM: α_ped > α_crit ve pedestal toparlanma (bekleme) süresi τ_E/8 geçti
      // (deneysel f_ELM τ_E ≈ 5–30: ITER ≈ 2 Hz, JET ≈ 30 Hz, DIII-D ≈ 50 Hz)
      const tRef = Math.max((d.tauE ?? 0.1) / 8, 2e-3);
      if (this.ctx.hmode && c.events.elms && d.alpha_ped > 1 && t - this.lastElm > tRef) {
        const rhoPed = 1 - ps.pedestalWidth;
        const fW = ps.elmFraction * (0.8 + 0.4 * this.ctx.rng.next());
        const before = this.ctx.crashHook ? this.ctx.crashSnapshot(v) : null;
        // tip-I ELM: pedestal + iç komşu bölge (~0.15 ρ) etkilenir (Loarte et al., PPCF 45 (2003) 1549)
        const dW = elmCrash(g, v.Te, v.Ti, v.ne, w.ni, this.ctx.bc.Te, this.ctx.bc.Ti, this.ctx.bc.n, rhoPed, fW, 0.5 * fW, 0.15);
        if (before) this.ctx.crashHook!('ELM', t, before, this.ctx.crashSnapshot(v));
        s.NHe *= 1 - 0.1 * fW; s.cZ *= 1 - 0.1 * fW;
        s.Pelm += dW / 1.0; // üstel ortalama (τ = 1 s) içine enerji darbesi
        this.lastElm = t;
        this.elmTimes.push(t); if (this.elmTimes.length > 20) this.elmTimes.shift();
        this.ctx.dt = Math.min(this.ctx.dt, Math.max(0.01 * (d.tauE ?? 0.1), 5e-4));
        this.ctx.diagStale = true;
        ev.push({ t, kind: 'ELM', msg: `Type-I ELM (α_ped/α_crit = ${d.alpha_ped.toFixed(2)}): ΔW = ${(dW / 1e6).toFixed(2)} MJ`, value: dW / 1e6 });
      }
      // testere dişi: q=1 yüzeyinde kayma s₁ > s_kritik
      if (c.events.sawteeth && t - this.lastSaw > 0.05) {
        const r1 = rhoOfQ(g, w.qF, 1);
        if (r1 > 0.05 && r1 < 0.8) {
          const s1 = shearAt(g, w.qF, r1);
          if (s1 > ps.sawtoothShear) {
            const rmix = Math.min(kadomtsevMixingRadius(g, w.qF), 0.95);
            if (rmix > r1) {
              const Te0 = v.Te[0];
              const before = this.ctx.crashHook ? this.ctx.crashSnapshot(v) : null;
              flattenConserving(g, v.Te, v.ne, r1, rmix);
              flattenConserving(g, v.Ti, w.ni, r1, rmix);
              flattenConserving(g, v.ne, null, r1, rmix);
              // q → max(q, 1.01) karışım bölgesinde; ψ'yi ρ_mix'ten içe yeniden kur
              const iMix = Math.min(N - 1, Math.floor(rmix / g.dRho));
              for (let f = 1; f <= iMix; f++) {
                if (w.qF[f] < 1.01) w.dpsiF[f] = (g.PhiB * g.rhoF[f]) / (Math.PI * 1.01);
              }
              for (let i = iMix - 1; i >= 0; i--) v.psi[i] = v.psi[i + 1] - w.dpsiF[i + 1] * g.dRho;
              currentProfiles(this.ctx, v.psi, s.Ip);
              if (before) this.ctx.crashHook!('sawtooth', t, before, this.ctx.crashSnapshot(v));
              this.lastSaw = t;
              this.ctx.dt = Math.min(this.ctx.dt, 5e-3);
              this.ctx.diagStale = true;
              ev.push({ t, kind: 'sawtooth', msg: `Sawtooth crash (s₁ = ${s1.toFixed(2)}): ρ(q=1) = ${r1.toFixed(2)}, ρ_mix = ${rmix.toFixed(2)}, T_e0 ${Te0.toFixed(1)} → ${v.Te[0].toFixed(1)} keV`, value: (Te0 - v.Te[0]) / Te0 });
              // NTM tohumu
              if (c.events.ntm) {
                const wd = 0.012 * (g.a / 2);
                if (rhoOfQ(g, w.qF, 1.5) > 0 && s.w32 < 2.5 * wd && d.betaN > 0.5 * c.limits.betaN_limit) s.w32 = 2.5 * wd;
                if (rhoOfQ(g, w.qF, 2) > 0 && s.w21 < 2 * wd && d.betaN > 0.75 * c.limits.betaN_limit) s.w21 = 2 * wd;
              }
            }
          }
        }
      }
      // NTM başlangıç / sönüm olayları
      for (const [key, name] of [['w32', '3/2'], ['w21', '2/1']] as const) {
        const on = s[key] > 0.02 * g.a;
        const flag = key === 'w32' ? this.ntmOn32 : this.ntmOn21;
        if (on && !flag) ev.push({ t, kind: 'NTM_onset', msg: `NTM ${name} island grew to w/a = ${(s[key] / g.a).toFixed(3)} (β_N = ${d.betaN.toFixed(2)}) — local profile flattening, τ_E degrading` });
        if (!on && flag) ev.push({ t, kind: 'NTM_gone', msg: `NTM ${name} island decayed` });
        if (key === 'w32') this.ntmOn32 = on; else this.ntmOn21 = on;
      }
      // ateşleme / yanma
      const P_loss_total = d.P_rad + d.P_cond;
      const ignOn = d.P_alpha >= P_loss_total && d.P_fus > 1 && d.Q >= 5;
      const ignOff = d.P_alpha < 0.9 * P_loss_total || d.Q < 4;
      if (ignOn && !this.ignited) { this.ignited = true; ev.push({ t, kind: 'ignition', msg: `IGNITION: P_alpha ${d.P_alpha.toFixed(0)} MW ≥ P_loss ${P_loss_total.toFixed(0)} MW` }); }
      if (ignOff && this.ignited) { this.ignited = false; ev.push({ t, kind: 'info', msg: 'Ignition condition lost' }); }
      if (d.Q >= 1 && !this.burning) { this.burning = true; ev.push({ t, kind: 'burn_start', msg: 'Q ≥ 1 (scientific breakeven)' }); }
      if (d.Q < 1 && this.burning) { this.burning = false; ev.push({ t, kind: 'burn_end', msg: 'Q < 1' }); }
      // uyarılar
      if (d.q_div > 10 && !this.ctx.warned.has('div')) { this.ctx.warned.add('div'); ev.push({ t, kind: 'warning', msg: `Divertor heat flux ${d.q_div.toFixed(0)} MW/m² > 10 MW/m² — material lifetime at risk` }); }
      if (d.nG_frac > 0.85 && !this.ctx.warned.has('nG')) { this.ctx.warned.add('nG'); ev.push({ t, kind: 'warning', msg: `n̄/n_G = ${d.nG_frac.toFixed(2)} — approaching the density limit` }); }
      if (d.betaN > 0.85 * c.limits.betaN_limit && !this.ctx.warned.has('bN')) { this.ctx.warned.add('bN'); ev.push({ t, kind: 'warning', msg: `β_N = ${d.betaN.toFixed(2)} — approaching the Troyon limit` }); }
      // limitler → disruption
      let cause: DisruptionCause = 'none', diag = '';
      if (d.nG_frac > c.limits.greenwald_limit) { cause = 'density_limit'; diag = `n̄/n_G reached ${d.nG_frac.toFixed(2)}`; }
      else if (d.betaN > c.limits.betaN_limit) { cause = 'beta_limit'; diag = `β_N ${d.betaN.toFixed(2)} > ${c.limits.betaN_limit}`; }
      else if (d.q95 < c.limits.q95_limit) { cause = 'q95_limit'; diag = `q95 = ${d.q95.toFixed(2)} < ${c.limits.q95_limit}`; }
      else if (s.w21 > 0.1 * g.a) { cause = 'ntm_locked_mode'; diag = `2/1 island w/a = ${(s.w21 / g.a).toFixed(3)} > 0.10 — mode locked to the wall`; }
      else if (d.cZ > c.limits.W_conc_limit && c.impurity.species === 'W') { cause = 'tungsten_accumulation'; diag = `c_W = ${d.cZ.toExponential(1)} > ${c.limits.W_conc_limit.toExponential(1)}`; }
      else if (d.P_rad > d.P_heat && t > 0.5 && d.Te < 2) { cause = 'radiative_collapse'; diag = `P_rad ${d.P_rad.toFixed(1)} MW > P_heat ${d.P_heat.toFixed(1)} MW, ⟨T_e⟩ fell to ${d.Te.toFixed(2)} keV`; }
      if (cause !== 'none') {
        this.ctx.disruption.cause = cause; this.ctx.disruption.t = t; this.ctx.disruption.W = d.W * 1e6; this.ctx.disruption.Ip = s.Ip;
        this.ctx.phase = 'thermal_quench'; this.ctx.disruption.text = diag;
        ev.push({ t, kind: 'disruption', msg: `DISRUPTION: ${DISRUPTION_LABELS[cause]} — ${diag}` });
      }
    } else if (this.ctx.phase === 'thermal_quench') {
      if (d.W * 1e6 < 0.02 * this.ctx.disruption.W || t - this.ctx.disruption.t > 0.05) {
        this.ctx.phase = 'current_quench';
        ev.push({ t, kind: 'quench', msg: `Thermal quench complete (${((t - this.ctx.disruption.t) * 1e3).toFixed(1)} ms) → current quench starting` });
      }
    } else if (this.ctx.phase === 'current_quench') {
      if (s.Ip < 0.03 * this.ctx.disruption.Ip) {
        this.ctx.phase = 'ended';
        const rep = disruptionReport({ cause: this.ctx.disruption.cause, t: this.ctx.disruption.t, g: this.geomB, Ip_MA: this.ctx.disruption.Ip / 1e6, W_th_J: this.ctx.disruption.W, B0: c.B0 });
        this.ctx.terminated = {
          t, natural: false, reason: DISRUPTION_LABELS[this.ctx.disruption.cause],
          diagnosis: `${DISRUPTION_LABELS[this.ctx.disruption.cause]} — ${this.ctx.disruption.text}, t = ${this.ctx.disruption.t.toFixed(2)} s. Thermal quench ${rep.tau_TQ_ms.toFixed(1)} ms, current quench ${rep.tau_CQ_ms.toFixed(0)} ms; halo current I_h/I_p·TPF = ${rep.halo_TPF_product.toFixed(2)}; runaway electron avalanche e^${rep.runaway_avalanche_efolds.toFixed(0)} → ~${rep.runaway_current_MA.toFixed(1)} MA; wall deposition ${rep.wall_energy_density_MJm2.toFixed(1)} MJ/m².`,
          fix: DISRUPTION_FIXES[this.ctx.disruption.cause], disruption: rep,
        };
        ev.push({ t, kind: 'end', msg: 'Plasma extinguished' });
      }
    }
    if (!this.ctx.terminated && t >= this.tEnd - 1e-9) {
      this.ctx.phase = 'ended';
      this.ctx.terminated = { t, natural: true, reason: 'Scheduled end', diagnosis: `The shot completed the scheduled duration of ${this.tEnd} s without disruption.`, fix: '' };
      ev.push({ t, kind: 'end', msg: 'Scheduled end of shot' });
    }
    return ev;
  }

  /** Disruption fazları: termal söndürme (τ_TQ), akım söndürme (τ_CQ) — profiller ölçeklenir */
  private disruptionStep(t: number, y: Float64Array, tMax: number): number {
    const v = this.ctx.view(y), s = v.s, N = this.N, g = this.ctx.tg;
    const tauTQ = 1e-3 * (g.a / 2.0) * (1 + 0.5 * Math.log(1 + this.ctx.disruption.Ip / 5e6));
    const tauCQ = 4.0e-3 * Math.PI * g.a * g.a * this.geomB.kappa;
    const tau = this.ctx.phase === 'thermal_quench' ? tauTQ : tauCQ;
    const dt = Math.min(tau / 5, tMax - t);
    const fT = Math.exp(-dt / tauTQ), fN = Math.exp(-dt / 0.05);
    for (let i = 0; i < N; i++) {
      v.Te[i] = 0.005 + (v.Te[i] - 0.005) * fT;
      v.Ti[i] = 0.005 + (v.Ti[i] - 0.005) * fT;
      v.ne[i] *= fN;
    }
    if (this.ctx.phase === 'current_quench') s.Ip *= Math.exp(-dt / tauCQ);
    composition(this.ctx, v.Te, v.ne, s);
    let W = 0;
    for (let i = 0; i < N; i++) W += 1.5 * (v.ne[i] * v.Te[i] + this.ctx.w.ni[i] * v.Ti[i]) * KEV * g.dV[i];
    Object.assign(this.ctx.lastDiag, {
      W: W / 1e6, Te: this.ctx.volAvg(v.Te), Ti: this.ctx.volAvg(v.Ti), Te0: v.Te[0], Ti0: v.Ti[0], Ip: s.Ip / 1e6,
      P_fus: 0, P_alpha: 0, P_aux: 0, P_heat: 0, Q: 0, P_bt: 0, P_neutron: 0, P_charged: 0,
    });
    this.ctx.dt = dt;
    return t + dt;
  }

  // ------------------------------------------------------------------ SimModel arayüzü
  diagnostics(t: number, y: Float64Array): Record<string, number> {
    if (!this.ctx.lastDiag.Te || this.ctx.diagStale) {
      // ilk kare veya ELM/testere dişi çöküşünden sonra: teşhisi y'den yeniden üret (adım atmadan)
      this.ctx.diagStale = false;
      const tauPrev = this.ctx.lastDiag.tauE ?? 0.1;
      const tauScal = this.ctx.lastDiag.tauE_scal ?? tauPrev;
      const v = this.ctx.view(y);
      const K = this.physics.evaluateWorkArrays(t, v);
      const g = this.ctx.tg, I = (a: Float64Array) => volumeIntegral(g, a);
      let W = 0;
      for (let i = 0; i < this.N; i++) W += 1.5 * (v.ne[i] * v.Te[i] + this.ctx.w.ni[i] * v.Ti[i]) * KEV * g.dV[i];
      const P_aux_abs = I(this.ctx.w.PnbiE) + I(this.ctx.w.PnbiI) + I(this.ctx.w.PicE) + I(this.ctx.w.PicI) + I(this.ctx.w.PecE);
      const P_rad = I(this.ctx.w.Pbr) + I(this.ctx.w.Pline) + K.Psync;
      const P_heat = P_aux_abs + I(this.ctx.w.Poh) + I(this.ctx.w.Pchg);
      const P_loss = this.lossPower(P_heat, P_rad);
      const tauE = this.ps.transportModel === 'cgm' ? W / P_loss : tauPrev;
      writeDiagnostics(this.ctx, t, v, {
        P_fus: I(this.ctx.w.Pfus), P_chg: I(this.ctx.w.Pchg), P_neut: I(this.ctx.w.Pneut), P_bt: I(this.ctx.w.Pbt), P_aux_abs, P_oh: I(this.ctx.w.Poh), P_alpha: I(this.ctx.w.Pchg),
        P_brems: I(this.ctx.w.Pbr), P_line: I(this.ctx.w.Pline), P_sync: K.Psync, P_rad, P_heat, W, dWdt: 0, tauE, tauScal, P_loss, nbar: this.ctx.lineAvg(v.ne),
      });
    }
    return { ...this.ctx.lastDiag };
  }


  /** Loss power for τ_E [W]: heating minus radiation, floored against radiation-dominated states */
  private lossPower(P_heat: number, P_rad: number): number {
    return Math.max(P_heat - P_rad, 0.1 * P_heat, 0.5e6 * (this.ctx.tg.volume / 100));
  }


  profiles(_y: Float64Array): Record<string, number[]> { return this.ctx.lastProf; }

  applyControl(patch: Record<string, number>): void {
    const ctrl = this.ctx.ctrl as unknown as Record<string, number>;
    for (const k of Object.keys(patch)) if (k in ctrl) ctrl[k] = patch[k];
  }
  getControls(): Record<string, number> { return { ...this.ctx.ctrl }; }
  /**
   * Checkpoint of everything that the continuation of the shot depends on besides y: the
   * equilibrium and transport geometry (with the GS warm start, eq.psi), the update bookkeeping,
   * the controller and filter states (n_sep gain, P_SOL filter, Γ_b, τ_E used by the fueling
   * loop; the C_χ integrator and the fueling lag live in y), MHD and disruption state, counters and
   * the RNG. Numbers go into the returned record; references and strings stay in a model-side
   * store under the record's `ck` key, which restoreInternal prunes of checkpoints after the one
   * restored (their frames are discarded by the rewind). Actuator set-points (applyControl) are
   * deliberately not part of it: after a rewind the latest controls stay in force.
   */
  saveInternal(): Record<string, number> {
    const ck = this.nextCheckpoint++;
    this.checkpoints.set(ck, { geo: this.ctx.geo, diagText: this.ctx.disruption.text, disruptCause: this.ctx.disruption.cause, elmTimes: this.elmTimes.slice(), warned: [...this.ctx.warned] });
    return {
      ck, rng: this.ctx.rng.getState(), phase: PHASES.indexOf(this.ctx.phase),
      hmode: +this.ctx.hmode, lastSaw: this.lastSaw, lastElm: this.lastElm, ignited: +this.ignited, burning: +this.burning,
      dt: this.ctx.dt, eqTime: this.eqTime, PSOL: this.ctx.PSOL, GammaB: this.ctx.GammaB, TeB: this.ctx.bc.Te, TiB: this.ctx.bc.Ti, nB: this.ctx.bc.n, nsepGain: this.ctx.nsepGain,
      eqBetaP: this.eqBetaP, eqLi: this.eqLi, eqRetryAt: this.eqRetryAt, eqFailStreak: this.eqFailStreak,
      eqUpdates: this.eqUpdates, eqRetried: this.eqRetried, eqRejected: this.eqRejected, forcedSteps: this.forcedSteps,
      tauE: this.ctx.lastDiag.tauE ?? NaN, alphaRatio: this.ctx.alphaRatio, lastVloop: this.ctx.lastVloop,
      ntmOn32: +this.ntmOn32, ntmOn21: +this.ntmOn21, tDisrupt: this.ctx.disruption.t, Wd: this.ctx.disruption.W, IpD: this.ctx.disruption.Ip,
    };
  }
  restoreInternal(st: Record<string, number>): void {
    const num = (k: string, dflt: number) => (Number.isFinite(st[k]) ? st[k] : dflt);
    this.ctx.rng.setState(st.rng);
    this.ctx.phase = PHASES[st.phase] ?? 'normal';
    this.ctx.hmode = !!st.hmode; this.lastSaw = st.lastSaw; this.lastElm = st.lastElm; this.ignited = !!st.ignited; this.burning = !!st.burning;
    this.ctx.dt = num('dt', 1e-3); this.eqTime = num('eqTime', 0); this.ctx.PSOL = num('PSOL', 0); this.ctx.GammaB = num('GammaB', 0);
    this.ctx.bc = { Te: num('TeB', 0.1), Ti: num('TiB', num('TeB', 0.1)), n: num('nB', 1e19) };
    this.ctx.nsepGain = num('nsepGain', 1);
    this.eqBetaP = num('eqBetaP', this.eqBetaP); this.eqLi = num('eqLi', this.eqLi);
    this.eqRetryAt = num('eqRetryAt', 0); this.eqFailStreak = num('eqFailStreak', 0);
    this.eqUpdates = num('eqUpdates', this.eqUpdates); this.eqRetried = num('eqRetried', this.eqRetried);
    this.eqRejected = num('eqRejected', this.eqRejected); this.forcedSteps = num('forcedSteps', this.forcedSteps);
    this.ctx.alphaRatio = num('alphaRatio', 0); this.ctx.lastVloop = num('lastVloop', 0);
    this.ntmOn32 = !!st.ntmOn32; this.ntmOn21 = !!st.ntmOn21;
    this.ctx.disruption.t = num('tDisrupt', 0); this.ctx.disruption.W = num('Wd', 0); this.ctx.disruption.Ip = num('IpD', 0);
    this.ctx.terminated = null; this.stepFailure = null; this.ctx.pending = []; this.ctx.diagStale = false;
    // τ_E of the last diagnostics feeds the fueling loop of the next step; the rest is rebuilt from y
    this.ctx.lastDiag = Number.isFinite(st.tauE) ? { tauE: st.tauE } : {};
    const aux = this.checkpoints.get(st.ck);
    if (aux) {
      if (aux.geo !== this.ctx.geo) this.ctx.adoptGeometry(aux.geo);
      this.ctx.disruption.text = aux.diagText; this.ctx.disruption.cause = aux.disruptCause;
      this.elmTimes = aux.elmTimes.slice(); this.ctx.warned = new Set(aux.warned);
      for (const k of this.checkpoints.keys()) if (k > st.ck) this.checkpoints.delete(k);
    } else {
      // a record from elsewhere (no stored references): keep the current equilibrium
      this.ctx.warned.clear(); this.elmTimes = [];
    }
  }
  /** references and strings of each checkpoint, by the record's `ck` */
  private checkpoints = new Map<number, { geo: ProfileContext['geo']; diagText: string; disruptCause: DisruptionCause; elmTimes: number[]; warned: string[] }>();
  private nextCheckpoint = 0;
  geometryInfo(): Record<string, number> {
    const c = this.cfg, eq = this.ctx.eq;
    return {
      R: this.geomB.R, a: this.geomB.a, kappa: this.geomB.kappa, delta: this.geomB.delta, B0: c.B0, Ip_MA: c.Ip_MA,
      V: this.ctx.tg.volume, S: this.ctx.tg.surface, stellarator: 0, gap: c.magnet.gap_m, coilThickness: c.magnet.coilThickness_m, B_coil: this.magnetInfo.B_coil,
      profiles: 1, nRho: this.N, Raxis: eq.Raxis, shafranov: eq.shafranovShift, rhoTorB: eq.rhoTorB,
    };
  }

  report(hist: HistoryFrame[], events: SimEvent[]): ShotReport {
    const last = hist[hist.length - 1];
    const d = last.d;
    const avg = (k: string) => flatTopMean(hist, k, { samples: 'all' });
    const warnings: string[] = [];
    if (this.eqInitResidual !== null) warnings.push(`Initial Grad–Shafranov equilibrium did not converge (residual ${this.eqInitResidual.toExponential(1)}) — it was used until the first accepted update${this.eqUpdates ? '' : ' (there was none)'}; geometry coefficients may be inaccurate.`);
    else if (this.ctx.eq && !this.ctx.eq.converged) warnings.push('Grad–Shafranov equilibrium did not fully converge — geometry coefficients may be inaccurate.');
    const nEq = this.eqUpdates + this.eqRejected;
    if (this.eqRejected > 0) warnings.push(`Grad–Shafranov: ${this.eqRejected} of ${nEq} equilibrium updates were rejected (no convergence in any retry stage) — the transport geometry was held at the last accepted equilibrium in between.`);
    if (this.forcedSteps > 0) warnings.push(`${this.forcedSteps} transport step(s) exhausted the Δt retries and were forced at the smallest Δt without Picard convergence — accuracy is reduced around those times.`);
    const nElm = events.filter((e) => e.kind === 'ELM').length;
    const nSaw = events.filter((e) => e.kind === 'sawtooth').length;
    return buildMagneticReport({
      cfg: this.cfg, method: this.method, g: this.geomB, V: this.ctx.tg.volume, magnetInfo: this.magnetInfo,
      terminated: this.ctx.terminated, tDisrupt: this.ctx.disruption.t, isStell: false,
      extraWarnings: warnings,
      extraEngineering: {
        'Model': '1.5D profiles + Grad–Shafranov',
        'Bootstrap fraction (avg.)': +avg('f_bs').toFixed(3), 'Driven-current fraction (avg.)': +avg('f_cd').toFixed(3),
        'Loop voltage (avg., V)': +avg('V_loop').toFixed(3), 'ℓ_i(3) (avg.)': +avg('li').toFixed(3), 'β_p (avg.)': +avg('betaP').toFixed(3),
        'q(0) / q95 (final)': `${(d.q0 ?? 0).toFixed(2)} / ${(d.q95 ?? 0).toFixed(2)}`,
        'Shafranov shift (m)': +this.ctx.eq.shafranovShift.toFixed(3),
        'GS updates accepted': this.eqUpdates, 'GS updates needing a retry': this.eqRetried, 'GS updates rejected': this.eqRejected,
        'Forced transport steps': this.forcedSteps,
      },
      extraExtras: {
        'T_e axis (final, keV)': +(d.Te0 ?? 0).toFixed(2), 'T_ped (final, keV)': +(d.Tped ?? 0).toFixed(2), 'T_sep (final, keV)': +(d.Tsep ?? 0).toFixed(3),
        'ELM frequency (Hz)': this.elmTimes.length > 2 ? +((this.elmTimes.length - 1) / (this.elmTimes[this.elmTimes.length - 1] - this.elmTimes[0])).toFixed(2) : 0,
        'Sawtooth period (s)': nSaw > 1 ? +(last.t / nSaw).toFixed(2) : 0,
        'ELM count (1.5D)': nElm,
      },
    }, hist, events);
  }
}
