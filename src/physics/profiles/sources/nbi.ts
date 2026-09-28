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
 *    R = n_f n_target ⟨σv⟩_bt (beamtarget.ts).
 *  - Current drive: I_CD = γ P/(n̄₂₀ R0) with γ_NB ≈ γ0 (T_e/10 keV) √(E_b/1 MeV) (the Fisch–Cordey
 *    trend: efficiency grows with T_e and beam speed; ITER 1 MeV, T_e ≈ 12 keV → ≈ 0.25; JET
 *    110 keV, T_e ≈ 7 keV → ≈ 0.05). APPROXIMATION.
 */
import { FUEL_CHANNELS, FUEL_SPECIES } from '../../reactivity';
import { criticalEnergy, ionHeatingFraction, slowingDownTime } from '../../heating';
import { KEV, ProfileContext, StepConstants } from '../context';
import { BeamTargetTable } from '../beamtarget';
import type { ProfileState } from '../state';
import { NbiChord, volumeIntegral } from './deposition';
import { cdDensity20, cdTeFactor } from './current';
import type { SourceModel } from './SourceModel';

export class NbiSource implements SourceModel {
  readonly id = 'nbi';
  /** chord-to-cell map and smoothing kernel of the current geometry (built on first use) */
  private chord: NbiChord | null = null;
  /** beam-target reactivity tables by beam energy (geometry-independent) */
  private btTables = new Map<number, BeamTargetTable>();

  geometryChanged(): void { this.chord = null; }

  prepare(ctx: ProfileContext, _t: number, st: ProfileState, K: StepConstants): void {
    const c = ctx.cfg, w = ctx.w, N = ctx.N, g = ctx.tg;
    const { Te, Ti, ne } = st;
    const fs = FUEL_SPECIES[c.fuel];
    const P_NBI = K.P_NBI;
    const Eb = c.heating.E_NBI_keV;
    const comps: [number, number][] = Eb < 250 ? [[Eb, 0.75], [Eb / 2, 0.15], [Eb / 3, 0.1]] : [[Eb, 1]];
    let shine = 0, sqrtE = 0;
    w.nbiDep.fill(0); w.nfast.fill(0); w.nbiPart.fill(0); w.PnbiE.fill(0); w.PnbiI.fill(0); w.Pbt.fill(0);
    const btR = K.btR; // fresh zeros from the pipeline
    const chans = FUEL_CHANNELS[c.fuel];
    if (!this.chord) this.chord = new NbiChord(g, ctx.ps.nbiRtan * g.R0);
    const svBuf: number[] = [0, 0];
    for (const [Ek, fk] of comps) {
      if (P_NBI <= 0) break;
      const r = this.chord.deposit(ne, Ek, fs.a.A, w.nbiTmp);
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
        // beam-target: n_f = S τ_th (steady slowing-down distribution), R = n_f n_target ⟨σv⟩_bt
        if (tab && w.nbiTmp[i] > 1e-3 * maxPd) {
          const tsd = slowingDownTime(Math.max(Te[i], 0.01), ne[i], fs.a.A, fs.a.Z, Ek, Ec);
          const nf = (pd * tsd) / (Ek * KEV);
          w.nfast[i] += nf;
          const sv = tab.eval(Ec, Math.max(Ti[i], 0.01), svBuf);
          chans.forEach((ch, j) => {
            const nT = ch.sameSpecies ? w.na[i] : w.nb[i];
            const R = nf * nT * sv[j];
            btR[i] += R;
            w.Pbt[i] += R * ch.Etot_MeV * 1.602176634e-13;
          });
        }
      }
    }
    K.shine = shine;
    K.Eb = sqrtE > 0 ? sqrtE * sqrtE : Eb; // effective beam energy for current drive
    K.S_nbi = volumeIntegral(g, w.nbiPart);
  }

  current(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const w = ctx.w, g = ctx.tg, N = ctx.N;
    if (!(ctx.ps.nbcdEff > 0 && K.P_NBI > 0)) return;
    const nbar20 = cdDensity20(ctx, st.ne);
    const s = volumeIntegral(g, w.nbiDep) || 1;
    let Tw = 0; for (let i = 0; i < N; i++) Tw += w.nbiDep[i] * g.dV[i] * cdTeFactor(st.Te, i);
    const gam = Math.min(ctx.ps.nbcdEff * (Tw / s) * Math.sqrt(Math.min(K.Eb / 1000, 1)), 0.5);
    const Icd = (gam * K.P_NBI * s) / (nbar20 * g.R0);
    for (let i = 0; i < N; i++) w.jcdB[i] += ((Icd * w.nbiDep[i]) / s) * 2 * Math.PI * g.RgeoC[i] * g.B0;
  }
}
