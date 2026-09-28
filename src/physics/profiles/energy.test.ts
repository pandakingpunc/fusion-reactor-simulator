/**
 * Energy conservation of the 1.5D model: the convective heat flux of the heat solver against an
 * analytic steady state, the exact discrete energy identity of one heat step with the flux across
 * the separatrix (HeatSolver.boundaryLoss), and the energy balance of the full model over a
 * burning flat-top, closed by that flux (P_bound).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { ITER_15D } from '../presets';
import { RNG } from '../rng';
import { HEAT_CONVECTION, HeatInputs, HeatSolver } from './fvsolver';
import { circularGeometry, TransportGeometry } from './geometry1d';
import { ProfileModel } from './model';

/** Heat-step inputs on geometry g: uniform n = 10²⁰ m⁻³, χ = 1 m²/s, no sources, Δt → ∞ */
function steadyInputs(g: TransportGeometry, over: Partial<HeatInputs> = {}): HeatInputs {
  const N = g.N;
  const z = () => new Float64Array(N), zf = () => new Float64Array(N + 1);
  const n = new Float64Array(N).fill(1e20);
  return {
    dt: 1e30, ne0: n, ne1: n, ni0: n, ni1: n, Te0: z(), Ti0: z(), chiE: zf().fill(1), chiI: zf().fill(1),
    Qe: z(), Qi: z(), Le: z(), Li: z(), TeStar: z(), TiStar: z(), nuEq: z(), GammaF: zf(), convCoef: HEAT_CONVECTION,
    TeB: 0.1, TiB: 0.1, nB: 1e20, ...over,
  };
}

describe('heat solver: convection and the flux across the separatrix', () => {
  it('convective flux (5/2) T Γ: steady state with a uniform particle source matches the analytic profile at first order', () => {
    // Cylinder (V' = Cρ, g1 = 1/a², V = Cρ²/2), uniform heating Q and particle source s_p, so that
    // Γ(ρ) = s_p V(ρ). Steady energy flux: −V' g1 n χ T' + (5/2) Γ T = Q V(ρ), i.e.
    //   T' = k ρ (T − T∞),  k = (5/2) s_p a²/(2 n χ),  T∞ = Q/((5/2) s_p)
    //   ⇒ T(ρ) = T∞ + (T_B − T∞) exp(k (ρ² − 1)/2)
    const a = 1, n = 1e20, chi = 1, Q = 1e21, sp = 1.6e20, TB = 0.1;
    const Tinf = Q / (HEAT_CONVECTION * sp), k = (HEAT_CONVECTION * sp * a * a) / (2 * n * chi);
    expect(Tinf).toBeCloseTo(2.5, 12);
    expect(k).toBeCloseTo(2, 12);
    const exact = (r: number) => Tinf + (TB - Tinf) * Math.exp((k * (r * r - 1)) / 2);
    const errs: number[] = [];
    for (const N of [50, 100, 200, 400]) {
      const g = circularGeometry(3, a, 3, N);
      const GammaF = Float64Array.from(g.VF, (V) => sp * V);
      const h = steadyInputs(g, { Qe: new Float64Array(N).fill(Q), Qi: new Float64Array(N).fill(Q), GammaF, TeB: TB, TiB: TB });
      const solver = new HeatSolver(g);
      const Te = new Float64Array(N), Ti = new Float64Array(N);
      solver.solve(h, Te, Ti);
      let e = 0;
      for (let i = 0; i < N; i++) {
        const ex = exact(g.rhoC[i]);
        e = Math.max(e, Math.abs(Te[i] - ex) / ex, Math.abs(Ti[i] - ex) / ex);
      }
      errs.push(e);
      // steady state: everything the plasma receives leaves through the separatrix
      const b = solver.boundaryLoss(h, Te, Ti);
      expect(b.e / (Q * g.volume)).toBeCloseTo(1, 10);
      expect(b.i / (Q * g.volume)).toBeCloseTo(1, 10);
    }
    // upwind convection: first order in Δρ (observed orders 0.87, 0.93, 0.97)
    const order = errs.slice(1).map((e, j) => Math.log2(errs[j] / e));
    for (const o of order) expect(o).toBeGreaterThan(0.85);
    expect(order[order.length - 1]).toBeGreaterThan(0.95);
    expect(errs[errs.length - 1]).toBeLessThan(2e-3);
    // the convective term matters: without it the profile is the parabola T_B + Q a²(1 − ρ²)/(4nχ)
    const g = circularGeometry(3, a, 3, 200);
    const noConv = Float64Array.from(g.rhoC, (r) => TB + (Q * a * a * (1 - r * r)) / (4 * n * chi));
    expect(Math.abs(noConv[0] - exact(g.rhoC[0])) / exact(g.rhoC[0])).toBeGreaterThan(0.5);
  });

  it.each([
    ['outflow', 4e21],
    ['inflow', -4e21],
  ])('one implicit step conserves energy exactly with the boundary flux (%s through the separatrix, n_i ≠ n_e)', (_name, GammaB) => {
    const N = 30;
    const g = circularGeometry(2, 0.6, 2.5, N);
    const rng = new RNG(11);
    const cell = (f: (r: number) => number, noise = 0) => Float64Array.from(g.rhoC, (r) => f(r) * (1 + noise * (rng.next() - 0.5)));
    const face = (f: (r: number) => number) => Float64Array.from(g.rhoF, f);
    const ne0 = cell((r) => 1e20 * (1 - 0.6 * r * r), 0.1), ne1 = cell((r) => 1.05e20 * (1 - 0.6 * r * r), 0.1);
    const ni0 = ne0.map((x) => 0.82 * x), ni1 = ne1.map((x, i) => (0.78 + 0.004 * i) * x);
    // particle flux changing sign inside the plasma, and in or out through the separatrix
    const GammaF = face((r) => 6e21 * Math.sin(3 * Math.PI * r));
    GammaF[0] = 0; GammaF[N] = GammaB;
    const h: HeatInputs = {
      dt: 0.02, ne0, ne1, ni0, ni1,
      Te0: cell((r) => 6 * (1 - r * r) + 0.2, 0.05), Ti0: cell((r) => 5 * (1 - r * r) + 0.2, 0.05),
      chiE: face((r) => 0.4 + 2 * r * r), chiI: face((r) => 0.6 + 1.5 * r * r),
      Qe: cell((r) => 3e21 * Math.exp(-8 * r * r) - 2e20, 0.2), Qi: cell((r) => 2e21 * Math.exp(-5 * r * r), 0.2),
      Le: cell(() => 4e19, 0.5), Li: cell(() => 1e19, 0.5), TeStar: cell((r) => 6 * (1 - r * r) + 0.3, 0.05), TiStar: cell((r) => 5 * (1 - r * r) + 0.3, 0.05),
      nuEq: cell(() => 30, 0.3), GammaF, convCoef: HEAT_CONVECTION, TeB: 0.1, TiB: 0.12, nB: 3e19,
    };
    const solver = new HeatSolver(g);
    const Te = new Float64Array(N), Ti = new Float64Array(N);
    solver.solve(h, Te, Ti);
    const b = solver.boundaryLoss(h, Te, Ti);
    let E1 = 0, E0 = 0, S = 0, scale = 0;
    for (let i = 0; i < N; i++) {
      const dV = g.dV[i];
      E1 += 1.5 * (ne1[i] * Te[i] + ni1[i] * Ti[i]) * dV;
      E0 += 1.5 * (ne0[i] * h.Te0[i] + ni0[i] * h.Ti0[i]) * dV;
      const se = (h.Qe[i] + h.Le[i] * (h.TeStar[i] - Te[i])) * dV, si = (h.Qi[i] + h.Li[i] * (h.TiStar[i] - Ti[i])) * dV;
      S += se + si;
      scale += Math.abs(se) + Math.abs(si);
    }
    // the convective part of the boundary flux is a sizable term of the balance
    expect(Math.abs(GammaB * HEAT_CONVECTION * h.TiB)).toBeGreaterThan(1e-3 * scale);
    expect(Math.abs((E1 - E0) / h.dt - (S - b.e - b.i)) / scale).toBeLessThan(1e-12);
  });
});

describe('discrete energy balance of the full model', () => {
  it('ITER15 flat-top: every accepted step has |dW/dt − (P_heat − P_rad − P_bound)| < 1e-4 P_heat', () => {
    // flat-top: after the 10 s heating ramp and the 30 s density ramp
    const tFlat = 40, tEnd = 150;
    const sim = new Simulation({ ...ITER_15D, t_end: tEnd });
    const m = sim.model as ProfileModel;
    const post = m.postStep.bind(m);
    const steps: { t: number; resid: number; bound: number }[] = [];
    m.postStep = (t, dt, y) => {
      // before the event models run: lastDiag holds the diagnostics the accepted step wrote
      if (dt > 0 && t > tFlat && m.ctx.phase === 'normal') {
        const d = m.ctx.lastDiag;
        steps.push({ t, resid: (d.dWdt - (d.P_heat - d.P_rad - d.P_bound)) / d.P_heat, bound: d.P_bound / d.P_heat });
      }
      return post(t, dt, y);
    };
    const r = sim.runAll();
    expect(r.termination.natural).toBe(true);
    expect(steps.length).toBeGreaterThan(1000);
    // the flat-top has ELMs, sawteeth and an NTM: steps after a crash start from the crashed state
    const inFlat = (kind: string) => sim.events.filter((e) => e.kind === kind && e.t > tFlat).length;
    expect(inFlat('ELM')).toBeGreaterThan(100);
    expect(inFlat('sawtooth')).toBeGreaterThanOrEqual(3);
    expect(inFlat('NTM_onset')).toBeGreaterThanOrEqual(1);
    const worst = Math.max(...steps.map((s) => Math.abs(s.resid)));
    expect(worst).toBeLessThan(1e-4);
    // the balance is not trivial: the separatrix carries a large part of the heating power
    expect(Math.min(...steps.map((s) => s.bound))).toBeGreaterThan(0.2);
  }, 120000);
});
