/**
 * Current diffusion (fvsolver.ts CurrentSolver) and the plasma-current programme (control/plasmaCurrent.ts):
 *
 *  - the skin-time response of a uniform-conductivity cylinder to a step of I_p against the Bessel-function series, TR-BDF2 stepped, and its
 *    second-order convergence in Δt;
 *  - the moving-coordinate term Φ̇_b: with the flux frozen into the plasma (σ → ∞) the poloidal flux of a material surface stays put while the
 *    grid moves;
 *  - the Hinton–Hazeltine form with a non-constant F: a solution satisfies its own right-hand side, and the current the solver reports is the
 *    enclosed current;
 *  - the programme: waveform interpolation and validation, and a shot whose boundary current follows it.
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D, JET_15D } from '../presets';
import { Simulation } from '../simulation';
import type { MagneticConfig } from '../types';
import { currentWaveform, IP_PROGRAMME_FLOOR } from './control/plasmaCurrent';
import { CurrentInputs, CurrentSolver } from './fvsolver';
import { circularGeometry, TransportGeometry } from './geometry1d';
import { ProfileContext } from './context';
import { ProfileModel } from './model';
import { TRBDF2_A, TRBDF2_B, TRBDF2_D } from './solver/trbdf2';

const MU0 = 1.25663706212e-6;

/** Bessel function J_n(x) by the integral (1/π) ∫₀^π cos(nτ − x sin τ) dτ (periodic integrand: the trapezoid rule is spectrally accurate) */
function besselJ(n: number, x: number): number {
  const M = 4000;
  let s = 0;
  for (let k = 0; k < M; k++) { const t = (Math.PI * (k + 0.5)) / M; s += Math.cos(n * t - x * Math.sin(t)); }
  return s / M;
}
/** the first n positive zeros of J1 (Newton from the McMahon estimate; J1' = J0 − J1/x) */
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

describe('current diffusion in a cylinder: the skin-time response to a step of I_p', () => {
  const N = 100, a = 1, R0 = 400, B0 = 3, sigma = 1e7;
  const g = circularGeometry(R0, a, B0, N);
  const tauR = MU0 * sigma * a * a;
  const lam = zerosJ1(60);
  // The poloidal field B_θ of a uniform cylinder obeys ∂B_θ/∂t = (1/(μ0 σ)) ∂r((1/r) ∂r(r B_θ)) with B_θ(a) fixed by I_p (Dirichlet), so the modes are
  // J1(λ_n r/a) with J1(λ_n) = 0 and, for B_θ(r, 0) = 0, I(x, t)/I_p = x B_θ/B_θ(a) = x² − Σ_n a_n x J1(λ_n x) e^{−λ_n² t/τ_R}, a_n = 2/(λ_n J2(λ_n))
  // (Fourier–Bessel coefficients of x: ∫ x² J1(λ x) dx = J2(λ)/λ, ∫ x J1(λ x)² dx = J2(λ)²/2 at a zero of J1). The current decays with the time
  // constant τ_R/λ_1² = μ0 σ a²/14.68, not the τ_R/5.78 of a cylinder whose wall current density is held.
  const analytic = (x: number, t: number) => {
    let s = x * x;
    for (const l of lam) s -= (2 * x * besselJ(1, l * x) * Math.exp((-l * l * t) / tauR)) / (l * (2 * besselJ(1, l) / l - besselJ(0, l)));
    return s;
  };
  const Ip = 2e6;
  const run = (nSteps: number, tEnd: number) => {
    const cs = new CurrentSolver(g);
    let psi = new Float64Array(N); // ψ' = 0 everywhere: no current inside, the boundary current I_p is imposed from t = 0
    const next = new Float64Array(N);
    const base = { sigma: new Float64Array(N).fill(sigma), jniB: new Float64Array(N), Ip };
    for (let k = 0; k < nSteps; k++) { trbdf2Step(cs, psi, tEnd / nSteps, base, next); psi = Float64Array.from(next); }
    const dpsi = cs.dpsiF(psi, Ip, new Float64Array(N + 1));
    return cs.Ienc(dpsi, new Float64Array(N + 1));
  };
  const worst = (I: Float64Array, t: number) => {
    let e = 0;
    for (let f = 5; f <= N; f += 5) e = Math.max(e, Math.abs(I[f] / Ip - analytic(g.rhoF[f], t)));
    return e;
  };

  it('the enclosed current of every surface follows the analytic series to 2e-3 of I_p at 0.02, 0.1 and 0.5 skin times τ_R, and the boundary current is I_p at every time', () => {
    for (const frac of [0.02, 0.1, 0.5]) {
      const I = run(80, frac * tauR);
      expect(I[N] / Ip).toBeCloseTo(1, 12);
      expect(worst(I, frac * tauR)).toBeLessThan(2e-3);
    }
  });

  it('the profile relaxes with the skin time τ_R/λ₁² = μ0 σ a²/14.68 (λ₁ = 3.832, the first zero of J1)', () => {
    // the deviation of I(0.5) from its final value 0.25 I_p decays as e^{−λ₁² t/τ_R} once the higher modes (λ₂ = 7.016) have gone
    const t1 = 0.15 * tauR, t2 = 0.25 * tauR;
    const d1 = Math.abs(run(60, t1)[N / 2] / Ip - 0.25), d2 = Math.abs(run(100, t2)[N / 2] / Ip - 0.25);
    const measured = -(t2 - t1) / Math.log(d2 / d1);
    expect(Math.abs(measured / (tauR / (lam[0] * lam[0])) - 1)).toBeLessThan(0.02);
  });

  it('the error against the series falls at least by 3 when the time step is halved (second order) at t = 0.1 τ_R', () => {
    const t = 0.1 * tauR;
    const e = [3, 6, 12].map((n) => worst(run(n, t), t));
    expect(e[1]).toBeLessThan(e[0] / 3);
    expect(e[2]).toBeLessThan(e[1] / 3);
  });
});

describe('the Φ̇_b term: the grid moves relative to the flux surfaces', () => {
  const N = 100, g = circularGeometry(3, 1, 3, N);
  const cs = new CurrentSolver(g);
  // σ so large that the flux is frozen into the plasma over the run: the poloidal flux of a flux surface (fixed Φ) does not change
  const sigma = new Float64Array(N).fill(1e14), jni = new Float64Array(N);
  const eps = 0.2; // Φ̇_b/Φ_b [1/s]
  const psi0 = Float64Array.from(g.rhoC, (r) => r * r);
  const advance = (rate: number, T: number, n: number) => {
    let psi = Float64Array.from(psi0);
    const out = new Float64Array(N);
    // the boundary current consistent with ψ' = 2 at ρ̂ = 1: I = 2π ρ̂ ψ'/(μ0 R0)
    const Ip = (2 * Math.PI * 2) / (MU0 * 3);
    for (let k = 0; k < n; k++) { trbdf2Step(cs, psi, T / n, { sigma, jniB: jni, Ip, PhiBdotRel: rate }, out); psi = Float64Array.from(out); }
    return psi;
  };

  it('with Φ̇_b/Φ_b = ε the poloidal flux at fixed ρ̂ follows the material surface that has moved there: ψ = ψ0(ρ̂ e^{εt/2}) = ρ̂² e^{εt}', () => {
    const T = 1, psi = advance(eps, T, 20);
    // ψ_t = (ρ̂ ε/2) ψ_ρ̂ carries the data inwards at the speed ε ρ̂/2 ≤ 0.1: the boundary condition (the current is held while the frozen flux would ask
    // for ψ′ to grow by e^{εt}: a test artefact, the geometry does not follow Φ_b) has reached ρ̂ ≈ 0.9 at t = 1, so the cells inside 0.8 are the test
    let worst = 0;
    for (let i = 0; i < N; i++) if (g.rhoC[i] < 0.8) worst = Math.max(worst, Math.abs(psi[i] / (g.rhoC[i] ** 2 * Math.exp(eps * T)) - 1));
    expect(worst).toBeLessThan(2e-3); // 1.2e-3 measured: the truncation of the stencil next to the axis, where ψ has the largest curvature per cell
    // without the term (a fixed boundary flux) nothing moves: the flux is frozen at fixed ρ̂
    const still = advance(0, T, 20);
    for (let i = 0; i < N; i++) expect(Math.abs(still[i] - psi0[i])).toBeLessThan(2e-4); // against a change of e^{εt} − 1 = 22 % of ψ with the term
  });

  it('a solution satisfies (ψ − ψ0)/Δt = rate + rate0 to round-off with the term, and the rate is the sum of the diffusion and of ρ̂ Φ̇_b/(2Φ_b) ∂ψ/∂ρ̂', () => {
    const psi = new Float64Array(N), r = new Float64Array(N), r0 = new Float64Array(N), rate0 = Float64Array.from(g.rhoC, (x) => 0.01 * (1 - x));
    const base = { sigma: new Float64Array(N).fill(3e8), jniB: Float64Array.from(g.rhoC, (x) => 1e5 * Math.exp(-3 * (1 - x))), Ip: 2e6, PhiBdotRel: 0.05 };
    const h: CurrentInputs = { ...base, dt: 0.07, psi0: Float64Array.from(g.rhoC, (x) => 2 * x * x), rate0 };
    cs.solve(h, psi);
    cs.rate(base, psi, r);
    for (let i = 0; i < N; i++) expect(Math.abs((psi[i] - h.psi0[i]) / h.dt - (r[i] + rate0[i]))).toBeLessThan(1e-9 * (Math.abs(r[i]) + Math.abs(rate0[i]) + 1e-3));
    cs.rate({ ...base, PhiBdotRel: 0 }, psi, r0);
    // the difference of the two rates is ρ̂ (Φ̇_b/2Φ_b) ∂ρ̂ψ, with the central difference over the neighbouring centres
    for (let i = 1; i < N - 1; i++) {
      const dpsi = (psi[i + 1] - psi[i - 1]) / (g.rhoC[i + 1] - g.rhoC[i - 1]);
      expect(Math.abs(r[i] - r0[i] - 0.5 * 0.05 * g.rhoC[i] * dpsi)).toBeLessThan(1e-12 * (Math.abs(r[i]) + 1));
    }
  });
});

describe('the Hinton–Hazeltine current diffusion with a non-constant F', () => {
  const N = 60;
  // a geometry with a varying F: the circular one with F(ρ̂) = F0 (1 + 0.04 ρ̂²)
  const base: TransportGeometry = circularGeometry(3, 1, 3, N);
  const g: TransportGeometry = { ...base, FC: base.FC.map((F, i) => F * (1 + 0.04 * base.rhoC[i] ** 2)), FF: base.FF.map((F, f) => F * (1 + 0.04 * base.rhoF[f] ** 2)) };
  const cs = new CurrentSolver(g);
  const sigma = Float64Array.from(g.rhoC, (r) => 1e8 * (1 - 0.6 * r * r)), jniB = Float64Array.from(g.rhoC, (r) => 2e5 * Math.exp(-5 * (1 - r)));
  const Ip = 2e6;

  it('a solution satisfies its right-hand side to round-off; the enclosed current at the boundary is I_p; the current diffuses to j ∝ σ with the F of the geometry', () => {
    const psi0 = Float64Array.from(g.rhoC, (r) => 0.5 * r * r), psi = new Float64Array(N), rate = new Float64Array(N);
    const h: CurrentInputs = { dt: 0.05, psi0, sigma, jniB, Ip };
    cs.solve(h, psi);
    cs.rate(h, psi, rate);
    for (let i = 0; i < N; i++) expect(Math.abs((psi[i] - psi0[i]) / h.dt - rate[i])).toBeLessThan(1e-11 * (Math.abs(rate[i]) + 1e-3));
    const dpsi = cs.dpsiF(psi, Ip, new Float64Array(N + 1));
    expect(cs.Ienc(dpsi, new Float64Array(N + 1))[N] / Ip).toBeCloseTo(1, 12);
    // a long time: ψ̇ becomes uniform in ρ̂ (a steady loop voltage), and (F²/(μ0 V')) ∂(V' g2 ψ'/F) = σ F ⟨R⁻²⟩ ψ̇ + ⟨j_ni·B⟩ holds cell by cell
    let p = Float64Array.from(psi0);
    const tmp = new Float64Array(N);
    for (let k = 0; k < 300; k++) { cs.solve({ dt: 30, psi0: p, sigma, jniB, Ip }, tmp); p = Float64Array.from(tmp); }
    cs.solve({ dt: 30, psi0: p, sigma, jniB, Ip }, tmp);
    const jB = cs.jB(cs.dpsiF(tmp, Ip, new Float64Array(N + 1)), new Float64Array(N));
    const psiDot = Float64Array.from(tmp, (v, i) => (v - p[i]) / 30);
    for (let i = 2; i < N - 2; i += 6) {
      const lhs = jB[i] - jniB[i], rhs = sigma[i] * g.FC[i] * g.R2invC[i] * psiDot[i];
      expect(Math.abs(lhs / rhs - 1)).toBeLessThan(2e-3);
    }
  });

  it('a constant F gives the same solution as the form with F inside the derivative that v3 used', () => {
    const c = circularGeometry(3, 1, 3, N), csC = new CurrentSolver(c);
    const psi0 = Float64Array.from(c.rhoC, (r) => 0.5 * r * r), psi = new Float64Array(N);
    const h: CurrentInputs = { dt: 0.05, psi0, sigma, jniB, Ip };
    csC.solve(h, psi);
    // the v3 system: σ F ⟨R⁻²⟩ ΔV (ψ − ψ0)/Δt = flux differences of V' F g2 ψ'/μ0 − ⟨j_ni·B⟩ ΔV, boundary flux 2π F I_p
    const a = new Float64Array(N), b = new Float64Array(N), cc = new Float64Array(N), d = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const m = (sigma[i] * c.FC[i] * c.R2invC[i] * c.dV[i]) / h.dt;
      const G = (f: number) => (c.VpF[f] * c.FF[f] * c.g2F[f]) / (MU0 * c.distF[f]);
      const GL = i > 0 ? G(i) : 0, GR = i < N - 1 ? G(i + 1) : 0;
      a[i] = -GL; cc[i] = -GR; b[i] = m + GL + GR;
      d[i] = m * psi0[i] - jniB[i] * c.dV[i] + (i === N - 1 ? 2 * Math.PI * c.FF[N] * Ip : 0);
    }
    // Thomas
    const cp = new Float64Array(N), dp = new Float64Array(N), x = new Float64Array(N);
    cp[0] = cc[0] / b[0]; dp[0] = d[0] / b[0];
    for (let i = 1; i < N; i++) { const bb = b[i] - a[i] * cp[i - 1]; cp[i] = cc[i] / bb; dp[i] = (d[i] - a[i] * dp[i - 1]) / bb; }
    x[N - 1] = dp[N - 1];
    for (let i = N - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
    for (let i = 0; i < N; i++) expect(Math.abs(psi[i] - x[i])).toBeLessThan(1e-10 * (Math.abs(x[i]) + 1e-3));
  });
});

describe('the plasma-current programme', () => {
  it('a waveform is piecewise linear, constant beyond its ends, floored at 0.05 MA, and refuses bad points', () => {
    const p = currentWaveform([[1, 2], [3, 6], [5, 6], [6, 0]]);
    expect(p(-1)).toBe(2e6);
    expect(p(1)).toBe(2e6);
    expect(p(2)).toBeCloseTo(4e6, 6);
    expect(p(4)).toBe(6e6);
    expect(p(5.5)).toBeCloseTo(3.025e6, 6); // between 6 MA at t = 5 s and the 0.05 MA floor at 6 s
    expect(p(6)).toBe(IP_PROGRAMME_FLOOR);
    expect(p(100)).toBe(IP_PROGRAMME_FLOOR);
    expect(currentWaveform([[0, 15]])(3)).toBe(15e6);
    expect(() => currentWaveform([])).toThrow(/no points/);
    expect(() => currentWaveform([[0, 1], [0, 2]])).toThrow(/must increase/);
    expect(() => currentWaveform([[0, 1], [Number.NaN, 2]])).toThrow(/not finite/);
    expect(() => currentWaveform([[0, Infinity]])).toThrow(/not finite/);
  });

  it('a context without a programme has none (I_p is the state constant); with a waveform it evaluates it with the floor', () => {
    expect(new ProfileContext(ITER_15D as MagneticConfig).ipAt(3)).toBeNull();
    const ctx = new ProfileContext({ ...ITER_15D, profiles: { ...ITER_15D.profiles, IpWaveform: [[0, 5], [10, 15]] } } as MagneticConfig);
    expect(ctx.ipAt(5)).toBeCloseTo(10e6, 6);
    ctx.ipProgramme = () => 0;
    expect(ctx.ipAt(1)).toBe(IP_PROGRAMME_FLOOR);
  });

  it('a shot whose I_p ramps: the state and the boundary condition follow the waveform at every accepted step, the loop voltage responds, and the shot runs on', () => {
    const cfg = { ...JET_15D, Ip_MA: 2, t_end: 1.2, profiles: { ...JET_15D.profiles, IpWaveform: [[0, 2], [1, 2.6]] } } as MagneticConfig;
    const sim = new Simulation(cfg);
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    let checked = 0, worstBc = 0, worstState = 0;
    m.postStep = (t, dt, y) => {
      if (dt > 0 && m.ctx.phase === 'normal' && t > 0) {
        const Ip = m.ctx.view(y).s.Ip;
        worstState = Math.max(worstState, Math.abs(Ip / (Math.min(2 + 0.6 * t, 2.6) * 1e6) - 1));
        // the enclosed current at the boundary is the programme's value at the end of the step
        worstBc = Math.max(worstBc, Math.abs(m.ctx.w.IencF[m.ctx.N] / Ip - 1));
        checked++;
      }
      return post(t, dt, y);
    };
    sim.runAll();
    expect(checked).toBeGreaterThan(100);
    expect(worstState).toBeLessThan(1e-12);
    expect(worstBc).toBeLessThan(1e-9);
    expect(sim.model.terminated?.reason).toBe('Scheduled end');
    const last = sim.history[sim.history.length - 1].d;
    expect(last.Ip).toBeCloseTo(2.6, 9);
    // the ramp is an inductive drive: the loop voltage during the ramp is above the one of the constant-I_p run
    const flat = new Simulation({ ...cfg, profiles: { ...cfg.profiles, IpWaveform: undefined } } as MagneticConfig);
    flat.runAll();
    const mean = (s: Simulation) => { const f = s.history.filter((h) => h.t > 0.5 && h.t < 1); return f.reduce((x, h) => x + h.d.V_loop, 0) / f.length; };
    expect(mean(sim)).toBeGreaterThan(mean(flat));
  }, 120000);

  it('the programme given to the model as a function replaces the one of the settings, and no programme leaves the shot unchanged', () => {
    const cfg = { ...JET_15D, Ip_MA: 2, t_end: 0.3, profiles: { ...JET_15D.profiles, IpWaveform: [[0, 5]] } } as MagneticConfig;
    const m = new ProfileModel(cfg, { plasmaCurrent: () => 2.2e6 });
    expect(m.ctx.view(m.initialState()).s.Ip).toBe(2.2e6);
    const plain = new Simulation({ ...JET_15D, t_end: 0.3 } as MagneticConfig);
    plain.runAll();
    const zeroWaveform = new Simulation({ ...JET_15D, t_end: 0.3, profiles: { ...JET_15D.profiles, IpWaveform: [[0, JET_15D.Ip_MA]] } } as MagneticConfig);
    zeroWaveform.runAll();
    // a constant programme at the configured current is the constant-I_p shot
    expect(zeroWaveform.history[zeroWaveform.history.length - 1].y).toEqual(plain.history[plain.history.length - 1].y);
  }, 120000);
});
