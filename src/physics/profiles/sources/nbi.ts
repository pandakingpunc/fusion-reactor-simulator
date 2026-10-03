/**
 * Neutral beam injection: deposition along a tangential chord, electron/ion heating split,
 * particle source, beam-target fusion and beam-driven current.
 *
 *  - Energy components: positive-ion sources (E_b < 250 keV; JET/DIII-D PINIs) inject the full,
 *    half and third energy with power fractions ≈ 0.75/0.15/0.10 (D⁺, D₂⁺, D₃⁺ ion mix);
 *    negative-ion sources (ITER/DEMO, ≥ 250 keV) a single component. APPROXIMATION: fixed species
 *    mix.
 *  - Deposition: NbiChord (deposition.ts), attenuation along the chord at R_tan = nbiRtan·R0.
 *  - Heating split: Stix critical energy E_c and the ion fraction of the slowing-down power
 *    (heating.ts).
 *  - Beam-target fusion: steady-state slowing-down distribution n_f = S τ_th, rate
 *    R = n_f n_target ⟨σv⟩_bt (beamtarget.ts) per channel of the fuel; the target of a channel is
 *    species b, or species a in the a + a channels (beamTargetDensity, reactivity.ts).
 *  - Fast-ion energy content of the steady slowing-down distribution, W_b,ss = P τ_W (Stix, heating.ts
 *    fastIonEnergyTime; w.Wbeam) and its time constant τ_W per cell (w.tauWb). The content that
 *    enters β is the pool that relaxes towards W_b,ss with τ_W (fastIons.ts), as in the 0D model.
 *  - Current drive: I_CD = γ P/(n̄₂₀ R0) with γ_NB ≈ γ0 (T_e/10 keV) √(E_b/1 MeV) (the Fisch–Cordey
 *    trend: efficiency grows with T_e and beam speed; ITER 1 MeV, T_e ≈ 12 keV → ≈ 0.25; JET
 *    110 keV, T_e ≈ 7 keV → ≈ 0.05). APPROXIMATION.
 */
import { FUEL_CHANNELS, FUEL_SPECIES, beamTargetDensity } from '../../reactivity';
import { criticalEnergy, fastIonEnergyTime, ionHeatingFraction, slowingDownTime } from '../../heating';
import { KEV, ProfileContext, StepConstants } from '../context';
import { BeamTargetTable } from '../beamtarget';
import type { CheckpointAux, CheckpointRecord } from '../checkpoint';
import type { ProfileState } from '../state';
import { NbiChord, volumeIntegral } from './deposition';
import { cdDensity20, cdTeFactor } from './current';
import type { SourceModel } from './SourceModel';
import { beamComponents } from '../fastions/components';
import { poolBeamTarget } from '../fastions/beamTarget';

/** J per MeV */
const MEV = 1e3 * KEV;

export class NbiSource implements SourceModel {
  readonly id = 'nbi';
  /** chord-to-cell map and smoothing kernel of the current geometry (built on first use) */
  private chord: NbiChord | null = null;
  /** beam-target reactivity tables by beam energy (geometry-independent) */
  private btTables = new Map<number, BeamTargetTable>();
  /**
   * cdModel 'physics': the beam-driven current is the one of cd/nbcd.ts (this source then adds none), which reads the birth power density
   * [W m⁻³] and the pitch cosine of every energy component of the beam, kept here (empty without it)
   */
  private readonly physicsCd: boolean;
  readonly birthPower: Float64Array[];
  readonly birthPitch: Float64Array[];
  /** finite-beam-width smoothing of the deposition: the legacy 0.08 also stands for the orbit width, which the 'profile' fast-ion model applies itself */
  private readonly smooth: number;

  constructor(ctx?: ProfileContext) {
    this.physicsCd = ctx?.ps.cdModel === 'physics';
    const n = this.physicsCd && ctx ? beamComponents(ctx.cfg.heating.E_NBI_keV).length : 0;
    this.birthPower = Array.from({ length: n }, () => new Float64Array(ctx!.N));
    this.birthPitch = Array.from({ length: n }, () => new Float64Array(ctx!.N));
    this.smooth = ctx?.fast ? 0.05 : 0.08;
  }

  geometryChanged(): void { this.chord = null; }

  prepare(ctx: ProfileContext, _t: number, st: ProfileState, K: StepConstants): void {
    const c = ctx.cfg, w = ctx.w, N = ctx.N, g = ctx.tg;
    const { Te, Ti, ne } = st;
    const fs = FUEL_SPECIES[c.fuel];
    const P_NBI = K.P_NBI;
    const Eb = c.heating.E_NBI_keV;
    const comps: [number, number][] = beamComponents(Eb).map((b) => [b.E_keV, b.f]);
    // fastIonModel 'profile': the birth power of each component goes to the fast-ion fields (fastions/), which deliver the heating and give the beam density
    const fast = ctx.fast;
    if (fast) for (const b of fast.beamBirth) b.fill(0);
    let shine = 0, sqrtE = 0;
    for (const b of this.birthPower) b.fill(0);
    w.nbiDep.fill(0); w.nfast.fill(0); w.nbiPart.fill(0); w.PnbiE.fill(0); w.PnbiI.fill(0); w.Pbt.fill(0); w.Wbeam.fill(0); w.tauWb.fill(0);
    const btR = K.btR; // per channel, fresh zeros from the pipeline
    const chans = FUEL_CHANNELS[c.fuel];
    if (!this.chord) this.chord = new NbiChord(g, ctx.ps.nbiRtan * g.R0, 400, this.smooth);
    const svBuf: number[] = chans.map(() => 0);
    // τ_W of the beam ions per cell, independent of the beam power: the fast-ion pool (fastIons.ts) relaxes with it
    // also after the beam is switched off (it is only needed while the beam is on or its pool is not yet empty)
    if (P_NBI > 0 || ctx.WfBeam > 0) {
      for (let i = 0; i < N; i++) {
        const Tev = Math.max(Te[i], 0.01), Ec = criticalEnergy(Tev, fs.a.A, w.ionSum[i]);
        let tau = 0;
        for (const [Ek, fk] of comps) tau += fk * Math.max(fastIonEnergyTime(Tev, ne[i], fs.a.A, fs.a.Z, Ek, Ec), 1e-3);
        w.tauWb[i] = tau;
      }
    }
    for (const [kc, [Ek, fk]] of comps.entries()) {
      if (P_NBI <= 0) break;
      const r = this.chord.deposit(ne, Ek, fs.a.A, w.nbiTmp, this.physicsCd ? this.birthPitch[kc] : undefined);
      let tab = this.btTables.get(Ek);
      if (!tab && c.fuel !== 'pB11') { tab = new BeamTargetTable(c.fuel, Ek); this.btTables.set(Ek, tab); }
      shine += fk * r.shine;
      sqrtE += fk * Math.sqrt(Ek);
      let maxPd = 0;
      for (let i = 0; i < N; i++) maxPd = Math.max(maxPd, w.nbiTmp[i]);
      for (let i = 0; i < N; i++) {
        const dep = fk * w.nbiTmp[i];
        if (dep <= 0) continue;
        const Ec = criticalEnergy(Math.max(Te[i], 0.01), fs.a.A, w.ionSum[i]);
        const fi = ionHeatingFraction(Ek, Ec);
        const pd = P_NBI * dep;
        w.nbiDep[i] += dep;
        w.PnbiE[i] += pd * (1 - fi); w.PnbiI[i] += pd * fi;
        w.nbiPart[i] += pd / (Ek * KEV);
        if (fast) fast.beamBirth[kc][i] += pd;
        if (this.physicsCd) this.birthPower[kc][i] += pd;
        // energy content of the slowing-down distribution, W_b = P τ_W (the 0D pool floors τ_W at 1 ms)
        w.Wbeam[i] += pd * Math.max(fastIonEnergyTime(Math.max(Te[i], 0.01), ne[i], fs.a.A, fs.a.Z, Ek, Ec), 1e-3);
        // beam-target: n_f = S τ_th (steady slowing-down distribution), R_j = n_f n_target,j ⟨σv⟩_bt,j per channel
        if (!fast && tab && w.nbiTmp[i] > 1e-3 * maxPd) {
          const tsd = slowingDownTime(Math.max(Te[i], 0.01), ne[i], fs.a.A, fs.a.Z, Ek, Ec);
          const nf = (pd * tsd) / (Ek * KEV);
          w.nfast[i] += nf;
          const sv = tab.eval(Ec, Math.max(Ti[i], 0.01), svBuf);
          for (let j = 0; j < chans.length; j++) {
            const R = nf * beamTargetDensity(c.fuel, chans[j], w.na[i], w.nb[i]) * sv[j];
            btR[j][i] += R;
            w.Pbt[i] += R * chans[j].Etot_MeV * MEV;
          }
        }
      }
    }
    // profile model: the beam density follows the energy fields (also after the beam is off), not the steady state of the source
    if (fast) poolBeamTarget(ctx, st, K, comps, this.btTables);
    K.shine = shine;
    K.Eb = sqrtE > 0 ? sqrtE * sqrtE : Eb; // effective beam energy for current drive
    K.S_nbi = volumeIntegral(g, w.nbiPart);
  }

  current(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const w = ctx.w, g = ctx.tg, N = ctx.N;
    if (this.physicsCd || !(ctx.ps.nbcdEff > 0 && K.P_NBI > 0)) return;
    const nbar20 = cdDensity20(ctx, st.ne);
    const s = volumeIntegral(g, w.nbiDep) || 1;
    let Tw = 0; for (let i = 0; i < N; i++) Tw += w.nbiDep[i] * g.dV[i] * cdTeFactor(st.Te, i);
    const gam = Math.min(ctx.ps.nbcdEff * (Tw / s) * Math.sqrt(Math.min(K.Eb / 1000, 1)), 0.5);
    const Icd = (gam * K.P_NBI * s) / (nbar20 * g.R0);
    for (let i = 0; i < N; i++) w.jcdB[i] += ((Icd * w.nbiDep[i]) / s) * 2 * Math.PI * g.RgeoC[i] * g.B0;
  }

  /**
   * Checkpoint: the birth pitch is state the source keeps from step to step. The deposit refills it only while the beam is on, and with the
   * 'profile' fast-ion model cd/nbcd.ts drives the current of the decaying fields with it after the beam is off, so a rewind into such a window
   * needs the pitch of the deposit before it, not that of a later one. It goes into aux by copy (the birth power is refilled by every prepare).
   */
  save(_rec: CheckpointRecord, aux: CheckpointAux): void {
    if (this.birthPitch.length) aux.nbi_birthPitch = this.birthPitch.map((p) => Float64Array.from(p));
  }

  /** Restore: the pitch of the checkpoint; a record without it (from elsewhere) keeps the pitch of the last deposit */
  restore(_rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined): void {
    const saved = aux?.nbi_birthPitch as Float64Array[] | undefined;
    if (saved && saved.length === this.birthPitch.length) saved.forEach((p, k) => this.birthPitch[k].set(p));
  }
}
