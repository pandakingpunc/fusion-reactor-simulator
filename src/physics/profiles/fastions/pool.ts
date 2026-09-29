/**
 * The fast-ion energy fields of the 1.5D model (ProfileSettings.fastIonModel = 'profile'): the energy density of the NBI ions (one field
 * per energy component of the beam) and of the fast charged fusion products on the radial grid, in place of the two scalar pools of
 * fastIons.ts.
 *
 * Each field w_i(t) [J m⁻³] follows the 0D pool equation of every cell, with the source smoothed over the orbit width of the ions,
 *
 *   dw_i/dt = S_i − w_i/τ_i,     S_i = Σ_j P_j ΔV_j p_ji / ΔV_i        (orbit.ts: p_ji, the probability that an ion born in j is found in i),
 *
 * where P_j is the birth power density (NBI deposition; the power of the charged fusion products), τ_i = τ_W(T_e, n_e)_i the energy time of
 * the slowing-down distribution of the local plasma (Stix; heating.ts fastIonEnergyTime: steady content w = S τ_W, at least 1 ms), and
 * w_i/τ_i the power the fast ions give to the plasma of cell i: the heating is delayed by the slowing-down time and sits where the ions
 * slow down, not where they are born. The fields are advanced once per accepted step with the exact solution for a constant source and
 * time constant over the step,
 *
 *   w' = w + (S τ − w)(1 − e^{−Δt/τ}),
 *
 * which is unconditionally stable and keeps 0 ≤ w' ≤ max(w, S τ). The heating that the heat equation takes over the same step is the
 * average of the delivery, h̄ = S − (w' − w)/Δt = a S + b w with a = 1 − τ (1 − e^{−Δt/τ})/Δt and b = (1 − e^{−Δt/τ})/Δt,
 * linear in the source of the iterate (the alpha heating stays implicit in the Picard iteration) and exactly the energy that leaves the field:
 *
 *   Σ_i (S_i − h̄_i) ΔV_i Δt = Σ_i (w'_i − w_i) ΔV_i        (every step, to round-off; `FastIonProfile.lastStep`).
 *
 * The pressure of the fast ions, p_f = (2/3) Σ w_i (isotropic: an APPROXIMATION, the beam ions are anisotropic), enters β, the pressure table
 * of the Grad–Shafranov update and the ballooning drive (α_ped, the ELM trigger, the stability profiles), not the bootstrap current
 * (the pressure gradient of the thermal plasma) nor the NTM drive.
 */
import type { TransportGeometry } from '../geometry1d';
import type { CheckpointAux, CheckpointRecord } from '../checkpoint';
import { orbitKernel } from './orbit';
import type { BeamComponent } from './components';

/** floor of the energy time of a field [s], as in the scalar pools and the 0D model */
export const TAU_MIN = 1e-3;

/** a = 1 − τ(1 − e^{−x})/Δt of the heating h̄ = a S + b w with x = Δt/τ; the series below x = 1e-3 avoids the cancellation */
export function heatingWeightA(x: number): number {
  if (!(x > 0)) return 0;
  if (x < 1e-3) return x * (0.5 - x * (1 / 6 - x * (1 / 24 - x / 120)));
  return 1 + Math.expm1(-x) / x;
}

/** Energies [J] of one field over one step */
export interface FieldLedger {
  /** born, delivered to the plasma, and the change of the content */
  birth: number; delivered: number; dContent: number;
}

/** One fast-ion energy field with its orbit kernel, its per-attempt coefficients and its source */
export class PoolField {
  /** energy density [J/m³] (the state) */
  readonly W: Float64Array;
  /** time constant of the attempt [s] */
  readonly tau: Float64Array;
  /** fraction of the delivered heating that goes to the ions */
  readonly G: Float64Array;
  /** 1 − exp(−Δt/τ) and the weights a, b of the heating h̄ = a S + b w of the attempt */
  readonly omE: Float64Array; readonly a: Float64Array; readonly b: Float64Array;
  /** smoothed source (of the last evaluation) [W/m³] and the delivered heating power density [W/m³] */
  readonly S: Float64Array; readonly h: Float64Array;
  /** kernel probabilities, row j = birth cell (N × N) */
  readonly T: Float64Array;
  /** the length of the step the coefficients are for [s] (0: the instantaneous rate b = 1/τ, a = 0) */
  dt = 0;

  constructor(readonly N: number) {
    const arr = () => new Float64Array(N);
    this.W = arr(); this.tau = arr().fill(TAU_MIN); this.G = arr(); this.omE = arr(); this.a = arr(); this.b = arr(); this.S = arr(); this.h = arr();
    this.T = new Float64Array(N * N);
    for (let j = 0; j < N; j++) this.T[j * N + j] = 1;
  }

  /** Kernel from the rms displacement σ_j [ρ̂] of each birth cell */
  setKernel(g: Pick<TransportGeometry, 'rhoC' | 'dRhoC' | 'dV'>, sigma: ArrayLike<number>): void { orbitKernel(this.T, g.rhoC, g.dRhoC, g.dV, sigma); }

  /**
   * The weights of the delivery for a step of length dt (0: the rate of the state, h = w/τ): 1 − e^{−Δt/τ}, a and b. `tau` and `G` must be set.
   */
  coefficients(dt: number): void {
    this.dt = dt;
    for (let i = 0; i < this.N; i++) {
      const tau = Math.max(this.tau[i], TAU_MIN);
      if (dt > 0) {
        const x = dt / tau;
        this.omE[i] = -Math.expm1(-x);
        this.a[i] = heatingWeightA(x);
        this.b[i] = this.omE[i] / dt;
      } else {
        this.omE[i] = 0; this.a[i] = 0; this.b[i] = 1 / tau;
      }
    }
  }

  /** S_i = Σ_j P_j ΔV_j p_ji / ΔV_i from the unsmoothed birth power density P [W/m³] */
  smooth(dV: ArrayLike<number>, P: ArrayLike<number>): void {
    const N = this.N, S = this.S, T = this.T;
    S.fill(0);
    for (let j = 0; j < N; j++) {
      const pj = P[j] * dV[j];
      if (!(pj > 0)) continue;
      const row = j * N;
      for (let i = 0; i < N; i++) S[i] += pj * T[row + i];
    }
    for (let i = 0; i < N; i++) S[i] /= dV[i];
  }

  /** The delivered heating h̄ = a S + b w [W/m³] of the attempt */
  deliver(): void {
    for (let i = 0; i < this.N; i++) this.h[i] = this.a[i] * this.S[i] + this.b[i] * this.W[i];
  }

  /**
   * The exact update over the step of length dt with the source S and the time constant of the attempt; the energy ledger of the step. The
   * delivery of the same step is computed from the same coefficients (deliver), so the ledger closes to round-off.
   */
  advance(dV: ArrayLike<number>, dt: number): FieldLedger {
    if (this.dt !== dt) this.coefficients(dt);
    this.deliver();
    let birth = 0, delivered = 0, dContent = 0;
    for (let i = 0; i < this.N; i++) {
      const dW = (this.S[i] * Math.max(this.tau[i], TAU_MIN) - this.W[i]) * this.omE[i];
      this.W[i] += dW;
      birth += this.S[i] * dV[i]; delivered += this.h[i] * dV[i]; dContent += dW * dV[i];
    }
    return { birth: birth * dt, delivered: delivered * dt, dContent };
  }
}

/** The energies of one accepted step: the beam (all components) and the alpha field [J] */
export interface StepLedger { beam: FieldLedger; alpha: FieldLedger }

/** Snapshot of the state of the fields (restore after a failed step) */
export interface FastIonSnapshot { beam: Float64Array[]; alpha: Float64Array; lastStep: StepLedger }

const zeroLedger = (): FieldLedger => ({ birth: 0, delivered: 0, dContent: 0 });

/**
 * The fast-ion state of a 1.5D shot: one field per beam component, one field for the charged fusion products, the birth profile of the
 * beam components (written by sources/nbi.ts), and the pressure. See the header.
 */
export class FastIonProfile {
  /** the energy components of the beam and the field of each */
  readonly comps: readonly BeamComponent[];
  readonly beam: PoolField[];
  readonly alpha: PoolField;
  /** birth power density of each beam component on the cells [W/m³] (unsmoothed; the NBI deposition) */
  readonly beamBirth: Float64Array[];
  /** fast-ion pressure (2/3) Σ w [Pa] of the last update, and the scratch of totalPressure */
  readonly pFast: Float64Array;
  private readonly ptot: Float64Array;
  /** the energy ledger of the last accepted step */
  lastStep: StepLedger = { beam: zeroLedger(), alpha: zeroLedger() };

  constructor(readonly N: number, comps: readonly BeamComponent[]) {
    this.comps = comps;
    this.beam = comps.map(() => new PoolField(N));
    this.alpha = new PoolField(N);
    this.beamBirth = comps.map(() => new Float64Array(N));
    this.pFast = new Float64Array(N);
    this.ptot = new Float64Array(N);
  }

  /** ∫ w dV of the beam fields and of the alpha field [J] */
  contents(dV: ArrayLike<number>): { beam: number; alpha: number } {
    let b = 0, a = 0;
    for (let i = 0; i < this.N; i++) {
      let wb = 0;
      for (const f of this.beam) wb += f.W[i];
      b += wb * dV[i]; a += this.alpha.W[i] * dV[i];
    }
    return { beam: b, alpha: a };
  }

  /** pFast = (2/3) (Σ beam + alpha) w */
  updatePressure(): void {
    for (let i = 0; i < this.N; i++) {
      let w = this.alpha.W[i];
      for (const f of this.beam) w += f.W[i];
      this.pFast[i] = (2 / 3) * w;
    }
  }

  /** p + p_fast on the cells, in a scratch array of the module (valid until the next call) */
  totalPressure(p: ArrayLike<number>): Float64Array {
    for (let i = 0; i < this.N; i++) this.ptot[i] = p[i] + this.pFast[i];
    return this.ptot;
  }

  /**
   * The pressure table the equilibrium solver is given: p + the fast-ion pressure smoothed with the kernel of orbit.ts at the constant rms width
   * `sigma` (ρ̂), conserving ∫ p_f dV. A structure of the pressure narrower than the grid of the fixed-boundary solver is not resolved by it: the
   * fast-ion pressure of a beam that deposits on the axis has a width of 0.1–0.2 of the radius, with steep flanks, and an update with it as it is
   * does not converge (JET15, 0.1–2 s: the iteration of the solver stalls at residuals of 1e-2 to 1); smoothed over 1.5 grid spacings (about 0.08) it does.
   */
  equilibriumPressure(p: ArrayLike<number>, g: Pick<TransportGeometry, 'rhoC' | 'dRhoC' | 'dV'>, sigma: number): Float64Array {
    const N = this.N, T = new Float64Array(N * N);
    orbitKernel(T, g.rhoC, g.dRhoC, g.dV, new Float64Array(N).fill(sigma));
    const out = Float64Array.from(p);
    for (let j = 0; j < N; j++) {
      const pj = this.pFast[j] * g.dV[j];
      if (!(pj > 0)) continue;
      for (let i = 0; i < N; i++) out[i] += (pj * T[j * N + i]) / g.dV[i];
    }
    return out;
  }

  /** Empties the fields (a disruption ends the fast-ion energy) */
  clear(): void {
    for (const f of this.beam) f.W.fill(0);
    this.alpha.W.fill(0);
    this.pFast.fill(0);
  }

  snapshot(): FastIonSnapshot {
    return {
      beam: this.beam.map((f) => Float64Array.from(f.W)), alpha: Float64Array.from(this.alpha.W),
      lastStep: { beam: { ...this.lastStep.beam }, alpha: { ...this.lastStep.alpha } },
    };
  }

  restoreSnapshot(s: FastIonSnapshot): void {
    this.beam.forEach((f, k) => f.W.set(s.beam[k]));
    this.alpha.W.set(s.alpha);
    this.lastStep = { beam: { ...s.lastStep.beam }, alpha: { ...s.lastStep.alpha } };
    this.updatePressure();
  }

  /** Checkpoint: the fields are arrays and go into aux, by copy (the contents are in the record of the shared context: WfBeam, WfAlpha) */
  save(_rec: CheckpointRecord, aux: CheckpointAux): void {
    aux.fastions = this.snapshot();
  }

  /**
   * Restore: the fields of the checkpoint; a record without them (from elsewhere) gets uniform fields that carry the contents `WfBeam`, `WfAlpha`
   * of the shared context over the volume V (each beam component in proportion to its power fraction).
   */
  restore(aux: Readonly<CheckpointAux> | undefined, WfBeam: number, WfAlpha: number, volume: number): void {
    const s = aux?.fastions as FastIonSnapshot | undefined;
    if (s && s.beam.length === this.beam.length && s.alpha.length === this.N) { this.restoreSnapshot(s); return; }
    const v = Math.max(volume, 1e-30);
    this.beam.forEach((f, k) => f.W.fill((this.comps[k].f * WfBeam) / v));
    this.alpha.W.fill(WfAlpha / v);
    this.lastStep = { beam: zeroLedger(), alpha: zeroLedger() };
    this.updatePressure();
  }
}
