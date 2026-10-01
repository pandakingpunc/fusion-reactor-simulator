/**
 * Flux accounting of the 1.5D model: the loop voltage at the plasma boundary, its split into resistive and inductive voltage, and the flux
 * (volt-seconds) the pulse draws from the solenoid (lane ws6c). The physics and the references (Poynting's theorem for the poloidal field,
 * Romero 2010; the Ejima ramp-up estimate; the external inductance) are in `confinement/circuit.ts`, which the 0D model shares.
 *
 * The poloidal flux ψ (per radian, increasing outwards) is a state of the model, so the flux that crosses the boundary is exact:
 * V_B = 2π ∂ψ_b/∂t, ψ_b = ψ(last cell) + ψ'_b (1 − ρ_last) the flux at ρ̂ = 1 (the last cell centre is half a cell inside, and a change of
 * I_p moves ψ_b against it: ψ'_b = 2π μ0 I_p / (V' g2) is the boundary condition of the current equation). Per accepted step, on the
 * geometry of the step:
 *
 *   ΔΨ_B  = 2π (ψ_b(t + Δt) − ψ_b(t))                                the boundary flux
 *   P_R   = 2π Σ_cells (Δψ/Δt)(I_{i+1} − I_i)                        = ∫ V(ρ) dI(ρ) = ∫ E_φ j_φ dV, with the enclosed current I at the
 *                                                                      faces (mean of the old and the new state) and V(ρ) = 2π ∂ψ/∂t
 *   ΔW    = W(t + Δt) − W(t),  W = (1/2μ0) Σ g2 ψ'² ΔV               the poloidal field energy of the plasma (½ L_i I², l_i(3) of the model)
 *   V_R   = P_R / I_p,   ΔΨ_R = V_R Δt,   ΔΨ_ind = ΔW / I_p          (I_p the mean of the step)
 *
 * The energy identity V_B I_p = dW/dt + P_R holds exactly for the poloidal equation (multiply it by I(ρ) and integrate by parts: dW/dt =
 * ∫ I dV) and for the discrete one up to the cell-average of ψ' (the sum ΔΨ_B − ΔΨ_R − ΔΨ_ind is kept, `closure`, and pinned by a test to
 * a few 1e-3 of ΔΨ_B). P_R is the power that leaves the field: the Joule heating of the inductive current (the ohmic power P_Ω of the
 * heat equation is the dissipation of E_∥ j_∥ with the ⟨B²⟩ of the surface; the two agree within a few percent) plus the work of the
 * loop voltage on the non-inductive current, so at a given current V_R = (1 − f_NI) × the loop voltage of an all-inductive current, and V_R
 * → 0 when the current is fully non-inductive.
 *
 * The flux drawn from the solenoid is Ψ_CS = L_e I_p + Ψ_B (circuit.ts), where the ramp-up before t = 0 is the Ejima estimate
 * (Ψ_res = C_E μ0 R I_p0) and L_i0 I_p0: the presets start at the full current with the equilibrium's profile. The integrals Ψ_B and
 * Ψ_R run over the accepted steps only: what happens between two steps (a sawtooth or ELM crash, an equilibrium update with its
 * conservative remap, coupling/remap.ts) is not a flux through the boundary and is in neither, so Ψ_B is continuous across them; the
 * changes of W they cause (a fraction of a percent of L_i I_p² / 2, and 1 % at an update of the ITER15 equilibrium) are part of
 * `psi_ind = psi_used − psi_res` and not of the closure.
 *
 * Published keys (history frames): `V_loop` [V] the boundary voltage of the last step (a step is up to 0.5 s, and the first steps after
 * a crash or an update are short: the value of a frame is noisy, its integral is exact), `V_res` [V], `psi_used`, `psi_res`,
 * `psi_ind` [V s]. Both `psi_used` and `psi_res` include the ramp-up estimate, so the run of a preset (which starts at the full current) reads
 * about (L_e + L_i0 + C_E μ0 R) I_p at t = 0; the flux the shot itself draws is the difference to that.
 */
import { C } from '../../constants';
import { circuitFlux, EJIMA_COEFFICIENT } from '../../confinement/circuit';
import type { Checkpointable, CheckpointRecord } from '../checkpoint';
import type { ProfileContext } from '../context';
import type { CurrentSolver } from '../fvsolver';
import type { TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';

const MU0 = C.mu0;

/** the finite number of a checkpoint record, or the default */
const recNum = (rec: Readonly<CheckpointRecord>, k: string, dflt: number): number => (Number.isFinite(rec[k]) ? rec[k] : dflt);

/** Work arrays of `stepFlux` (N + 1 values each): ψ' and the enclosed current at the faces of the old and the new state */
export interface StepFluxScratch { dpO: Float64Array; dpN: Float64Array; IO: Float64Array; IN: Float64Array }
export function stepFluxScratch(N: number): StepFluxScratch {
  return { dpO: new Float64Array(N + 1), dpN: new Float64Array(N + 1), IO: new Float64Array(N + 1), IN: new Float64Array(N + 1) };
}

/** Poloidal field energy W = (1/2μ0) Σ g2 ψ'² ΔV [J] from the gradients dp on the faces (the cell value is the mean of its two faces) */
export function fieldEnergy(g: TransportGeometry, dp: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < g.N; i++) { const d = 0.5 * (dp[i] + dp[i + 1]); s += g.g2C[i] * d * d * g.dV[i]; }
  return s / (2 * MU0);
}

/** ψ_b = ψ(last cell) + ψ'_b (1 − ρ_last) [Wb/rad], with the boundary gradient ψ'_b from the current */
export function boundaryFlux(g: TransportGeometry, psi: ArrayLike<number>, dp: ArrayLike<number>): number {
  return psi[g.N - 1] + dp[g.N] * g.distF[g.N];
}

/** What `stepFlux` returns: the boundary, resistive and inductive flux of the step [V s] and the field energy at its ends [J] */
export interface StepFlux { dB: number; dR: number; dInd: number; WO: number; WN: number }

/**
 * The flux of one step of the current diffusion from ψ_O to ψ_N over dt at the boundary currents IpO and IpN, on the geometry g (see the
 * header for the definitions). A pure function of its arguments: the ledger and the tests use it.
 */
export function stepFlux(g: TransportGeometry, cur: CurrentSolver, psiO: ArrayLike<number>, psiN: ArrayLike<number>, IpO: number, IpN: number, dt: number, w: StepFluxScratch, out: StepFlux = { dB: 0, dR: 0, dInd: 0, WO: 0, WN: 0 }): StepFlux {
  const N = g.N;
  cur.dpsiF(psiO as Float64Array, IpO, w.dpO); cur.Ienc(w.dpO, w.IO);
  cur.dpsiF(psiN as Float64Array, IpN, w.dpN); cur.Ienc(w.dpN, w.IN);
  out.WO = fieldEnergy(g, w.dpO); out.WN = fieldEnergy(g, w.dpN);
  let PR = 0;
  for (let i = 0; i < N; i++) PR += ((psiN[i] - psiO[i]) / dt) * (0.5 * (w.IN[i + 1] + w.IO[i + 1]) - 0.5 * (w.IN[i] + w.IO[i]));
  PR *= 2 * Math.PI;
  const Ip = 0.5 * (IpO + IpN);
  out.dB = 2 * Math.PI * (boundaryFlux(g, psiN, w.dpN) - boundaryFlux(g, psiO, w.dpO));
  out.dR = (PR / Ip) * dt;
  out.dInd = (out.WN - out.WO) / Ip;
  return out;
}

export class FluxLedger implements Checkpointable {
  /** ∫V_B dt and ∫V_R dt over the accepted steps [V s] */
  psiB = 0;
  psiR = 0;
  /** Σ (ΔΨ_B − ΔΨ_R − ΔΨ_ind) over the accepted steps [V s]: what the energy identity leaves over */
  closure = 0;
  /** boundary and resistive voltage of the last step [V] */
  vB = 0;
  vR = 0;
  /** plasma current [A] and internal inductance l_i(3) at the start of the first step: the ramp-up estimate refers to them */
  private on = false;
  private Ip0 = 0;
  private li0 = 0;
  private readonly w: StepFluxScratch;
  private readonly step: StepFlux = { dB: 0, dR: 0, dInd: 0, WO: 0, WN: 0 };

  constructor(N: number) { this.w = stepFluxScratch(N); }

  /**
   * One accepted step from the state o to v over dt, on the geometry of the step (ctx.tg; an equilibrium update follows the step).
   * Sets ctx.lastVloop and integrates the fluxes.
   */
  advance(ctx: ProfileContext, o: ProfileState, v: ProfileState, dt: number): void {
    const g = ctx.tg;
    const IpO = o.s.Ip, IpN = v.s.Ip;
    const s = stepFlux(g, ctx.cur, o.psi, v.psi, IpO, IpN, dt, this.w, this.step);
    if (!this.on) {
      this.on = true; this.Ip0 = IpO;
      this.li0 = (4 * s.WO) / (MU0 * IpO * IpO * g.R0); // l_i(3) = 2 ∫B_p² dV / (μ0² I_p² R0), ∫B_p² dV = 2 μ0 W
    }
    this.psiB += s.dB; this.psiR += s.dR; this.closure += s.dB - s.dR - s.dInd;
    this.vB = s.dB / dt; this.vR = s.dR / dt;
    ctx.lastVloop = this.vB;
  }

  /**
   * The flux keys of a frame at the plasma current Ip [A]: V_loop, V_res [V], psi_used, psi_res and psi_ind [V s]. A frame before the first
   * step (t = 0) has the ramp-up estimate of the state it is written from.
   */
  diagnostics(ctx: ProfileContext, Ip: number, li: number): Record<string, number> {
    const b = ctx.geomB;
    const f = circuitFlux({
      R: b.R, a: b.a, kappa: b.kappa, Ip, Ip0: this.on ? this.Ip0 : Ip, li0: this.on ? this.li0 : li,
      ejima: ctx.cfg.systems?.cs?.ejima ?? EJIMA_COEFFICIENT, psiB: this.psiB, psiR: this.psiR,
    });
    return { V_loop: this.vB, V_res: this.vR, psi_used: f.psiUsed, psi_res: f.psiRes, psi_ind: f.psiInd };
  }

  /** the numbers of the ledger, for the step snapshot of the stepper (a step that fails after its accepted update is undone) */
  snapshot(): { psiB: number; psiR: number; closure: number; vB: number; vR: number; on: boolean; Ip0: number; li0: number } {
    return { psiB: this.psiB, psiR: this.psiR, closure: this.closure, vB: this.vB, vR: this.vR, on: this.on, Ip0: this.Ip0, li0: this.li0 };
  }
  rollback(s: ReturnType<FluxLedger['snapshot']>): void {
    this.psiB = s.psiB; this.psiR = s.psiR; this.closure = s.closure; this.vB = s.vB; this.vR = s.vR; this.on = s.on; this.Ip0 = s.Ip0; this.li0 = s.li0;
  }

  save(rec: CheckpointRecord): void {
    Object.assign(rec, { fluxPsiB: this.psiB, fluxPsiR: this.psiR, fluxClosure: this.closure, fluxVB: this.vB, fluxVR: this.vR, fluxOn: +this.on, fluxIp0: this.Ip0, fluxLi0: this.li0 });
  }
  restore(rec: Readonly<CheckpointRecord>): void {
    this.psiB = recNum(rec, 'fluxPsiB', 0); this.psiR = recNum(rec, 'fluxPsiR', 0); this.closure = recNum(rec, 'fluxClosure', 0);
    this.vB = recNum(rec, 'fluxVB', 0); this.vR = recNum(rec, 'fluxVR', 0);
    this.on = recNum(rec, 'fluxOn', 0) > 0; this.Ip0 = recNum(rec, 'fluxIp0', 0); this.li0 = recNum(rec, 'fluxLi0', 0);
  }
}
