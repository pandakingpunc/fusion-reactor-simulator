/**
 * Flux accounting of the 1.5D model (current/flux.ts):
 *  - the skin-time response of a uniform-conductivity cylinder to a step of I_p: the boundary flux, the resistive flux and the field energy
 *    of `stepFlux` against the closed forms of the Bessel-series solution, and the Poynting closure  Psi_B = Psi_R + Delta W / I_p;
 *  - the ledger on whole shots: the closure of the energy identity, the flux of the ramp-up at t = 0, the loop voltage against the resistive
 *    voltage of the ohmic power, the response to a current ramp and the checkpoint.
 */
import { describe, expect, it } from 'vitest';
import { circuitFlux, EJIMA_COEFFICIENT, externalInductance } from '../../confinement/circuit';
import { ITER_15D } from '../../presets';
import { Simulation } from '../../simulation';
import type { MagneticConfig } from '../../types';
import { CurrentInputs, CurrentSolver } from '../fvsolver';
import { circularGeometry } from '../geometry1d';
import type { ProfileModel } from '../model';
import { TRBDF2_A, TRBDF2_B, TRBDF2_D } from '../solver/trbdf2';
import { stepFlux, stepFluxScratch } from './flux';

const MU0 = 1.25663706212e-6;

/** Bessel function J_n(x) by the integral (1/π) ∫₀^π cos(nτ − x sin τ) dτ */
function besselJ(n: number, x: number): number {
  const M = 4000;
  let s = 0;
  for (let k = 0; k < M; k++) { const t = (Math.PI * (k + 0.5)) / M; s += Math.cos(n * t - x * Math.sin(t)); }
  return s / M;
}
/** the first n positive zeros of J1 */
function zerosJ1(n: number): number[] {
  return Array.from({ length: n }, (_, k) => {
    let x = (k + 1.25) * Math.PI;
    for (let it = 0; it < 40; it++) x -= besselJ(1, x) / (besselJ(0, x) - besselJ(1, x) / x);
    return x;
  });
}

/** One TR-BDF2 step of the current diffusion (the stage structure of CoupledStepper.implicitStep), constant coefficients */
function trbdf2Step(cs: CurrentSolver, psi: Float64Array, dt: number, base: Omit<CurrentInputs, 'dt' | 'psi0' | 'rate0'>, out: Float64Array): void {
  const N = psi.length;
  const dEff = TRBDF2_D * dt;
  const rate0 = new Float64Array(N), psiG = new Float64Array(N), ref = new Float64Array(N);
  cs.rate(base, psi, rate0);
  cs.solve({ ...base, dt: dEff, psi0: psi, rate0 }, psiG);
  for (let i = 0; i < N; i++) ref[i] = TRBDF2_A * psiG[i] + TRBDF2_B * psi[i];
  cs.solve({ ...base, dt: dEff, psi0: ref }, out);
}

describe('flux of the skin-time response of a uniform cylinder to a step of I_p', () => {
  // With B_θ(r, 0) = 0 and I_p imposed from t = 0 (the setting of currentDiffusion.test.ts) the enclosed current is i(x, t) = I(x, t)/I_p = x² − Σ a_n x J1(λ_n x) e_n,
  // e_n = exp(−λ_n² t/τ), τ = μ0 σ a², a_n = 2/(λ_n J2(λ_n)) = −2/(λ_n J0(λ_n)) at a zero λ_n of J1. The current density is j = (I_p/(2π a²)) [2 + 2 Σ J0(λ_n x)/J0(λ_n) e_n],
  // and with E = j/σ and V = 2π R0 E:
  //   V_B(t) = V∞ [1 + Σ e_n],  V_R(t) = P_R/I_p = V∞ [1 + Σ e_n²]  (∫ x J0(λ_n x) J0(λ_m x) dx = δ J0(λ_n)²/2, ∫ x J0(λ_n x) dx = 0),  V∞ = 2 R0 I_p/(σ a²)
  //   Psi_B(T) = V∞ [T + Σ (τ/λ_n²)(1 − e_n(T))],  Psi_R(T) = V∞ [T + Σ (τ/(2 λ_n²))(1 − e_n(T)²)],  W(T) = μ0 R0 I_p² Σ (1 − e_n(T))²/λ_n²
  // (W∞ = μ0 R0 I_p²/8 by Σ 1/λ_n² = 1/8, i.e. l_i = 1/2 of the uniform current density), so Psi_B − Psi_R = W/I_p holds term by term.
  // The start of the response is singular (V_B ~ t^(-1/2): the current enters through a boundary layer that grows as sqrt(t)), and the cells resolve
  // it with an error of the order of the cell width: the fluxes fall short of the series by a constant that is proportional to 1/N (0.5 % of Psi_B
  // at 0.1 tau for N = 200, twice that for N = 100). N = 200 is used, and the convergence in N is a test of its own.
  const a = 1, R0 = 400, B0 = 3, sigma = 1e7, Ip = 2e6;
  const tau = MU0 * sigma * a * a;
  const lam = zerosJ1(400);
  const Vinf = (2 * R0 * Ip) / (sigma * a * a);
  const e = (l: number, T: number) => Math.exp((-l * l * T) / tau);
  const psiB = (T: number) => Vinf * (T + lam.reduce((s, l) => s + (tau / (l * l)) * (1 - e(l, T)), 0));
  const psiR = (T: number) => Vinf * (T + lam.reduce((s, l) => s + (tau / (2 * l * l)) * (1 - e(l, T) ** 2), 0));
  const energy = (T: number) => MU0 * R0 * Ip * Ip * lam.reduce((s, l) => s + (1 - e(l, T)) ** 2 / (l * l), 0);

  /** steps with a geometric growth (the response starts with a boundary layer); returns the accumulated stepFlux quantities at the end */
  const run = (T: number, nSteps: number, growth: number, N = 200) => {
    const g = circularGeometry(R0, a, B0, N);
    const cs = new CurrentSolver(g), w = stepFluxScratch(N);
    let psi = new Float64Array(N);
    const next = new Float64Array(N);
    const base = { sigma: new Float64Array(N).fill(sigma), jniB: new Float64Array(N), Ip };
    const dt0 = growth === 1 ? T / nSteps : (T * (growth - 1)) / (growth ** nSteps - 1);
    let dt = dt0, B = 0, R = 0, Ind = 0, W0 = 0, W = 0;
    for (let k = 0; k < nSteps; k++) {
      trbdf2Step(cs, psi, dt, base, next);
      const s = stepFlux(g, cs, psi, next, Ip, Ip, dt, w);
      B += s.dB; R += s.dR; Ind += s.dInd; if (k === 0) W0 = s.WO; W = s.WN;
      psi = Float64Array.from(next);
      dt *= growth;
    }
    return { B, R, Ind, dW: W - W0 };
  };

  it('the boundary flux, the resistive flux and the field energy follow the series to 1 % at 0.1 and 0.5 skin times', () => {
    for (const frac of [0.1, 0.5]) {
      const T = frac * tau;
      const r = run(T, 60, 1.15);
      expect(Math.abs(r.B / psiB(T) - 1), `Psi_B at ${frac} tau`).toBeLessThan(0.01);
      expect(Math.abs(r.R / psiR(T) - 1), `Psi_R at ${frac} tau`).toBeLessThan(0.01);
      expect(Math.abs(r.dW / energy(T) - 1), `W at ${frac} tau`).toBeLessThan(0.01);
    }
  });

  it('the identity Psi_B = Psi_R + Delta W / I_p closes to 1 % of the boundary flux, in the series and in the numerical solution', () => {
    for (const frac of [0.02, 0.1, 0.5]) {
      const T = frac * tau;
      expect(Math.abs(psiB(T) - psiR(T) - energy(T) / Ip) / psiB(T)).toBeLessThan(1e-6);
      const r = run(T, 60, 1.15);
      expect(Math.abs(r.B - r.R - r.Ind) / r.B, `numerical closure at ${frac} tau`).toBeLessThan(0.01);
    }
  });

  it('the flux converges with the number of cells (first order: the singular start is resolved to a cell), and does not depend on the step', () => {
    const T = 0.1 * tau;
    const err = [100, 200, 400].map((n) => Math.abs(run(T, 60, 1.15, n).B / psiB(T) - 1));
    expect(err[1]).toBeLessThan(0.65 * err[0]);
    expect(err[2]).toBeLessThan(0.65 * err[1]);
    // 30 or 120 steps of the same run: the flux moves by far less than the error of the cells
    const b30 = run(T, 30, 1.15 ** 2, 200).B, b120 = run(T, 120, 1.15 ** 0.5, 200).B;
    expect(Math.abs(b30 - b120) / psiB(T)).toBeLessThan(0.002);
  });

  it('at late times the loop voltage is the resistive one, V_R = 2 R0 I_p/(sigma a^2), and the field energy has reached mu0 R0 I_p^2/8 (l_i = 1/2)', () => {
    const T = 3 * tau;
    const r = run(T, 40, 1.12);
    expect(Math.abs(r.dW / (MU0 * R0 * Ip * Ip / 8) - 1)).toBeLessThan(0.01);
    // the flux drawn over the last stretch is V_R dt: two more steps from the settled state
    const N = 200, g = circularGeometry(R0, a, B0, N);
    const cs = new CurrentSolver(g), w = stepFluxScratch(N);
    let psi = new Float64Array(N);
    const next = new Float64Array(N);
    const base = { sigma: new Float64Array(N).fill(sigma), jniB: new Float64Array(N), Ip };
    for (let k = 0; k < 40; k++) { trbdf2Step(cs, psi, T / 40, base, next); psi = Float64Array.from(next); }
    trbdf2Step(cs, psi, 0.5 * tau, base, next);
    const s = stepFlux(g, cs, psi, next, Ip, Ip, 0.5 * tau, w);
    expect(Math.abs(s.dB / (0.5 * tau) / Vinf - 1)).toBeLessThan(0.01);
    expect(Math.abs(s.dR / (0.5 * tau) / Vinf - 1)).toBeLessThan(0.01);
  });
});

const cfgOf = (tEnd: number, extra: Partial<MagneticConfig> = {}): MagneticConfig => ({ ...ITER_15D, t_end: tEnd, ...extra });

describe('the ledger on ITER15', () => {
  const cfg = cfgOf(12);
  const sim = new Simulation(cfg);
  sim.runAll();
  const m = sim.model as ProfileModel;
  const H = sim.history;
  const b = m.geomB;

  it('the first frame carries the whole ramp-up: (L_e + L_i) I_p + C_E mu0 R I_p, resistive part C_E mu0 R I_p', () => {
    const d = H[0].d;
    const f = circuitFlux({ R: b.R, a: b.a, kappa: b.kappa, Ip: 15e6, Ip0: 15e6, li0: d.li, ejima: EJIMA_COEFFICIENT, psiB: 0, psiR: 0 });
    expect(d.psi_used).toBeCloseTo(f.psiUsed, 6);
    expect(d.psi_res).toBeCloseTo(EJIMA_COEFFICIENT * MU0 * b.R * 15e6, 6);
    expect(d.psi_used).toBeCloseTo(d.psi_res + d.psi_ind, 9);
    // 160-230 V s for 15 MA (the ITER design has 277 V s including the burn, the breakdown and the margins)
    expect(d.psi_used).toBeGreaterThan(160);
    expect(d.psi_used).toBeLessThan(240);
  });

  it('the energy identity closes: the flux the run drew through the boundary is the resistive flux plus the change of the field energy, to 1 %', () => {
    const led = m.ctx.flux;
    expect(led.psiB).toBeGreaterThan(1);
    expect(Math.abs(led.closure) / led.psiB).toBeLessThan(0.01);
    // and every frame's psi_used follows the boundary flux: it never falls (the ramp-up estimate plus a positive flux), at constant I_p
    for (let i = 1; i < H.length; i++) expect(H[i].d.psi_used).toBeGreaterThan(H[i - 1].d.psi_used - 0.05);
  });

  it('the loop voltage is large in the cold start-up and small in the burn, and the resistive voltage is that of the ohmic power over the current, with the non-inductive work added', () => {
    expect(H[5].d.V_res).toBeGreaterThan(0); // the first frames are the steps of the start-up
    const last = H[H.length - 1].d;
    expect(last.V_res).toBeGreaterThan(0.005);
    expect(last.V_res).toBeLessThan(0.2);
    // V_R I_p = P_Omega + the work of the loop voltage on the non-inductive current: V_R I_p / P_Omega = 1/(1 - f_NI) in a steady state (at 12 s the
    // current profile is still relaxing from the start-up: it is 0.97 of it after 60 s, see the ITER15 numbers of the README of profiles/)
    const fni = last.f_bs + last.f_cd;
    const ratio = (last.V_res * last.Ip) / last.P_oh;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio / (1 / (1 - fni))).toBeGreaterThan(0.6);
    expect(ratio / (1 / (1 - fni))).toBeLessThan(1.4);
  });

  it('the run is reproducible from a checkpoint: the ledger continues bit for bit', { timeout: 120000 }, () => {
    const a = new Simulation(cfgOf(8));
    a.advance(4);
    const rec = (a.model as ProfileModel).saveInternal();
    expect(rec.fluxPsiB).toBeGreaterThan(0);
    a.runAll();
    const b2 = new Simulation(cfgOf(8));
    b2.runAll();
    expect(a.history[a.history.length - 1].d.psi_used).toBe(b2.history[b2.history.length - 1].d.psi_used);
    a.rewindTo(a.history.findIndex((h) => h.t >= 4));
    a.runAll();
    expect(a.history[a.history.length - 1].d.psi_used).toBe(b2.history[b2.history.length - 1].d.psi_used);
  });
});

describe('the ledger through a current ramp', () => {
  // ITER15 at 12 MA ramped to 15 MA over 8 s: the external inductance flux L_e dI is in psi_used, the boundary flux follows the ramp, and the
  // energy identity closes through the ramp
  const cfg = cfgOf(12, { Ip_MA: 12, profiles: { ...ITER_15D.profiles, IpWaveform: [[0, 12], [1, 12], [9, 15]] } });
  const sim = new Simulation(cfg);
  sim.runAll();
  const m = sim.model as ProfileModel;
  const H = sim.history;

  it('the ramp draws the inductive flux: psi_used rises by more than L_e dI over the ramp and the identity closes to 1 %', () => {
    const b = m.geomB;
    const iLo = H.findIndex((h) => h.t >= 1), iHi = H.findIndex((h) => h.t >= 9);
    const dPsi = H[iHi].d.psi_used - H[iLo].d.psi_used;
    const Le = externalInductance(b.R, b.a, b.kappa);
    expect(dPsi).toBeGreaterThan(Le * 3e6);
    // the boundary flux of the ramp is the internal inductive flux L_i dI plus the resistive flux: several tens of V s at 3 MA / 8 s
    expect(dPsi - Le * 3e6).toBeGreaterThan(5);
    expect(dPsi - Le * 3e6).toBeLessThan(80);
    expect(Math.abs(m.ctx.flux.closure) / m.ctx.flux.psiB).toBeLessThan(0.01);
  });

  it('the loop voltage is positive through the ramp (it drives the current up) and larger than at the end of the run, when the current is flat', () => {
    const inRamp = H.filter((h) => h.t > 2 && h.t < 8).map((h) => h.d.V_loop);
    expect(inRamp.reduce((s, v) => s + v, 0) / inRamp.length).toBeGreaterThan(0);
    expect(H[H.length - 1].d.Ip).toBeCloseTo(15, 6);
  });
});
