import { describe, expect, it } from 'vitest';
import { circularGeometry } from './geometry1d';
import { CurrentSolver, DensitySolver, HeatInputs, HeatSolver } from './fvsolver';
import { bootstrapJB, sauterCoefficients, sigmaNeo, sigmaSpitzer } from './neoclassical';
import { flattenConserving, kadomtsevMixingRadius, qFromDpsi, rhoOfQ } from './mhd';
import { volumeIntegral } from './sources';
import { Simulation } from '../simulation';
import { ITER, JET } from '../presets';
import { MagneticConfig } from '../types';

const KEV = 1.602176634e-16;

function heatInputs(N: number, over: Partial<HeatInputs> = {}): HeatInputs {
  const z = () => new Float64Array(N), zf = () => new Float64Array(N + 1);
  const n = new Float64Array(N).fill(1e20);
  return {
    dt: 1e6, ne0: n, ne1: n, ni0: n, ni1: n, Te0: z(), Ti0: z(), chiE: zf().fill(1), chiI: zf().fill(1),
    Qe: z(), Qi: z(), Le: z(), Li: z(), TeStar: z(), TiStar: z(), nuEq: z(), GammaF: zf(), convCoef: 0,
    TeB: 0.1, TiB: 0.1, nB: 1e20, ...over,
  };
}

describe('1.5D finite-volume solvers (analytic verification)', () => {
  it('heat equation: steady state in a cylinder with uniform source is parabolic, O(Δρ²) accurate', () => {
    const errs: number[] = [];
    for (const N of [20, 40, 80]) {
      const g = circularGeometry(3, 1, 3, N);
      const Q = 1e20; // keV m⁻³ s⁻¹
      const h = heatInputs(N, { Qe: new Float64Array(N).fill(Q), Qi: new Float64Array(N).fill(Q) });
      const Te = new Float64Array(N), Ti = new Float64Array(N);
      new HeatSolver(g).solve(h, Te, Ti); // Δt → ∞ : doğrudan kararlı durum
      // T = T_b + Q a²(1 − ρ²)/(4 n χ)
      let e = 0;
      for (let i = 0; i < N; i++) {
        const ex = 0.1 + (Q * 1 * (1 - g.rhoC[i] ** 2)) / (4 * 1e20 * 1);
        e = Math.max(e, Math.abs(Te[i] - ex) / ex, Math.abs(Ti[i] - ex) / ex);
      }
      errs.push(e);
    }
    expect(errs[2]).toBeLessThan(2e-3);
    expect(Math.log2(errs[0] / errs[1])).toBeGreaterThan(1.8);
  });

  it('electron–ion equilibration conserves total energy exactly (implicit coupling)', () => {
    const N = 10;
    const g = circularGeometry(3, 1, 3, N);
    const Te0 = new Float64Array(N).fill(10), Ti0 = new Float64Array(N).fill(2);
    const h = heatInputs(N, { dt: 0.05, Te0, Ti0, chiE: new Float64Array(N + 1), chiI: new Float64Array(N + 1), nuEq: new Float64Array(N).fill(20) });
    const Te = new Float64Array(N), Ti = new Float64Array(N);
    new HeatSolver(g).solve(h, Te, Ti);
    for (let i = 0; i < N; i++) {
      expect(Te[i] + Ti[i]).toBeCloseTo(12, 10); // n_e = n_i
      // geri Euler: (T_e − T_i)_1 = (T_e − T_i)_0 / (1 + 2νΔt)
      expect(Te[i] - Ti[i]).toBeCloseTo(8 / (1 + 2 * 20 * 0.05), 10);
    }
  });

  it('density: source-free steady state with the model pinch reproduces n ∝ exp(−Pρ²)', () => {
    const N = 60, P = 0.8;
    const g = circularGeometry(3, 1, 3, N);
    const D = new Float64Array(N + 1).fill(0.5), v = new Float64Array(N + 1);
    for (let f = 1; f <= N; f++) v[f] = -D[f] * 2 * P * g.rhoF[f] * (g.g1F[f] / g.gradRhoF[f]);
    const n = new Float64Array(N);
    new DensitySolver(g).solve({ dt: 1e9, n0: new Float64Array(N).fill(1e19), D, v, S: new Float64Array(N), nB: 1e19 }, n);
    for (let i = 0; i < N; i += 7) expect(n[i] / (1e19 * Math.exp(P * (1 - g.rhoC[i] ** 2)))).toBeCloseTo(1, 2);
  });

  it('current diffusion relaxes to j ∝ σ with the enclosed current fixed by I_p', () => {
    const N = 40, Ip = 2e6;
    const g = circularGeometry(3, 1, 3, N);
    const sigma = Float64Array.from(g.rhoC, (r) => 1e8 * (1 - 0.6 * r * r));
    const cs = new CurrentSolver(g);
    let psi = Float64Array.from(g.rhoC, (r) => 0.5 * r * r);
    const tmp = new Float64Array(N);
    const tauR = 1.25663706212e-6 * 1 * 1e8; // μ0 a² σ
    for (let k = 0; k < 400; k++) { cs.solve({ dt: tauR / 20, psi0: psi, sigma, jniB: new Float64Array(N), Ip }, tmp); psi = Float64Array.from(tmp); }
    const dpsi = cs.dpsiF(psi, Ip, new Float64Array(N + 1));
    const jB = cs.jB(dpsi, new Float64Array(N));
    const I = cs.Ienc(dpsi, new Float64Array(N + 1));
    expect(I[N] / Ip).toBeCloseTo(1, 10);
    for (let i = 2; i < N - 2; i += 5) expect((jB[i] / sigma[i]) / (jB[0] / sigma[0])).toBeCloseTo(1, 2);
    // ∫ j dA = I_p  (⟨j·B⟩/B0 ≈ j_φ; dA = dV/(2πR0))
    const Iint = volumeIntegral(g, jB.map((x) => x / 3)) / (2 * Math.PI * 3);
    expect(Iint / Ip).toBeCloseTo(1, 3);
  });
});

describe('neoclassical (Sauter 1999/2002)', () => {
  it('Spitzer conductivity matches the NRL/Wesson value', () => {
    // η = 1.65e-9 lnΛ / T^{3/2}[keV]  (Z = 1)  → σ = 1/η
    const s = sigmaSpitzer(1e20, 1e4, 1);
    expect(s * 1.65e-9 * 17.3 / 10 ** 1.5).toBeGreaterThan(0.85);
    expect(s * 1.65e-9 * 17.3 / 10 ** 1.5).toBeLessThan(1.15);
  });
  it('trapped particles reduce conductivity and drive co-current bootstrap', () => {
    const c0 = sauterCoefficients(0, 0.01, 0.01, 1);
    expect(c0.L31).toBe(0);
    const c = sauterCoefficients(0.5, 0.05, 0.05, 1.5);
    expect(c.L31).toBeGreaterThan(0.3); expect(c.L31).toBeLessThan(0.8);
    expect(c.alpha).toBeLessThan(0); expect(c.alpha).toBeGreaterThan(-1.3);
    expect(sigmaNeo(0.5, 0.05, 1e20, 1e4, 1.5)).toBeLessThan(sigmaSpitzer(1e20, 1e4, 1.5));
    // p azalan (dlnp < 0) → pozitif (akımla aynı yönlü) bootstrap
    expect(bootstrapJB(15, 3e5, 0.5, c, -3, -2, -2, 5)).toBeGreaterThan(0);
  });
});

describe('MHD events', () => {
  it('Kadomtsev mixing radius satisfies helical-flux conservation', () => {
    const N = 200;
    const g = circularGeometry(3, 1, 3, N);
    const qF = Float64Array.from(g.rhoF, (r) => 0.7 + 2.5 * r * r);
    const rmix = kadomtsevMixingRadius(g, qF);
    const r1 = rhoOfQ(g, qF, 1);
    // ∫₀^{ρ_mix} (1/q − 1) 2ρ dρ = 0  (sayısal)
    let s = 0;
    const M = 20000;
    for (let k = 0; k < M; k++) { const r = ((k + 0.5) / M) * rmix; s += (1 / (0.7 + 2.5 * r * r) - 1) * 2 * r * (rmix / M); }
    expect(Math.abs(s)).toBeLessThan(1e-3);
    expect(rmix).toBeGreaterThan(r1);
    expect(rmix / r1).toBeGreaterThan(1.2); expect(rmix / r1).toBeLessThan(1.6);
  });
  it('sawtooth flattening conserves the weighted integral', () => {
    const N = 50;
    const g = circularGeometry(3, 1, 3, N);
    const T = Float64Array.from(g.rhoC, (r) => 10 * (1 - r * r) + 0.5);
    const n = Float64Array.from(g.rhoC, (r) => 1 + 0.3 * (1 - r * r));
    const before = volumeIntegral(g, T.map((x, i) => x * n[i]));
    flattenConserving(g, T, n, 0.3, 0.45);
    expect(volumeIntegral(g, T.map((x, i) => x * n[i])) / before).toBeCloseTo(1, 10);
    expect(T[0]).toBeCloseTo(T[3], 10); // ρ < ρ₁ düz
  });
  it('q profile from ψ′ inverts ψ′ = Φ_b ρ/(π q)', () => {
    const N = 30;
    const g = circularGeometry(3, 1, 3, N);
    const dpsi = Float64Array.from(g.rhoF, (r) => (g.PhiB * r) / (Math.PI * (1 + r * r)));
    const qF = new Float64Array(N + 1), qC = new Float64Array(N);
    qFromDpsi(g, dpsi, qF, qC);
    for (let f = 1; f <= N; f++) expect(qF[f]).toBeCloseTo(1 + g.rhoF[f] ** 2, 10);
  });
});

describe('1.5D profile model (integration)', () => {
  const short = (c: MagneticConfig, t_end: number): MagneticConfig => ({ ...c, t_end, fidelity: '1.5D' });

  it('JET-like shot runs, keeps I_p and produces finite physical profiles', () => {
    const sim = new Simulation(short(JET, 1.5));
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    const last = sim.history[sim.history.length - 1];
    for (const k of ['Te0', 'Ti0', 'ne', 'P_fus', 'Q', 'q95', 'li', 'f_bs', 'W']) expect(Number.isFinite(last.d[k])).toBe(true);
    expect(last.d.Ip).toBeCloseTo(3.5, 6);
    expect(last.d.Te0).toBeGreaterThan(2); expect(last.d.Te0).toBeLessThan(40);
    expect(last.d.q95).toBeGreaterThan(2.5); expect(last.d.q95).toBeLessThan(5);
    expect(last.d.f_bs).toBeGreaterThan(0.05); expect(last.d.f_bs).toBeLessThan(0.6);
    const withProf = sim.history.filter((h) => h.prof);
    expect(withProf.length).toBeGreaterThan(10);
    expect(withProf[withProf.length - 1].prof!.Te.length).toBe(50);
    expect(sim.history[0].eq?.R.length).toBeGreaterThan(5);
    expect(sim.events.some((e) => e.kind === 'LH')).toBe(true);
  }, 60000);

  it('rewind restores the state and continues deterministically', () => {
    const sim = new Simulation(short(JET, 1.0));
    sim.advance(0.4);
    const idx = Math.floor(sim.history.length / 2);
    const tRef = sim.history[idx].t;
    sim.advance(0.3);
    const ref = sim.history.find((h) => h.t > tRef + 0.1)!;
    sim.rewindTo(idx);
    sim.advance(0.3);
    const again = sim.history.find((h) => Math.abs(h.t - ref.t) < 1e-9);
    expect(again).toBeDefined();
    expect(again!.d.W / ref.d.W).toBeCloseTo(1, 2);
  }, 60000);

  it('ITER-like plasma reaches H-mode, burns (Q > 3) within 30 s', () => {
    const sim = new Simulation({ ...short(ITER, 30), profiles: { lcfsKappa: 1.85, lcfsDelta: 0.49 } });
    const r = sim.runAll();
    expect(r.Q_sci_max).toBeGreaterThan(3);
    expect(sim.events.some((e) => e.kind === 'LH')).toBe(true);
    const d = sim.history[sim.history.length - 1].d;
    expect(d.nG_frac).toBeLessThan(1);
    expect(d.Tped).toBeGreaterThan(1);
  }, 120000);
});
