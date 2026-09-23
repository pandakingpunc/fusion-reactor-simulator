/**
 * Şekil: sayısal doğrulama (verification) —
 *  (a) Grad–Shafranov çözücüsü: Cerfon–Freidberg Solov'ev üretilmiş çözümüne karşı maks. bağıl
 *      hata, ızgara aralığı h'ye göre (beklenen 2. derece);
 *  (b) sonlu-hacim ısı çözücüsü: silindirde düzgün kaynaklı kararlı durum (T ∝ 1 − ρ²),
 *      Δρ'ya göre (2. derece);
 *  (c) geri Euler zaman adımı: J₀(j₀₁ρ) kipinin sönümü, Δt'ye göre öz-yakınsama (1. derece);
 *  (d) 0D yanma dinamiği test problemi için iş–hassasiyet diyagramı: uyarlanır Dormand–Prince
 *      RK5(4) — sabit adımlı klasik RK4 ve açık Euler (hata ↔ RHS çağrı sayısı).
 */
import { GSGrid } from '../../physics/equilibrium/gs';
import { PhysicalSolovev } from '../../physics/equilibrium/solovev';
import { circularGeometry } from '../../physics/profiles/geometry1d';
import { HeatInputs, HeatSolver } from '../../physics/profiles/fvsolver';
import { DormandPrince, RHS } from '../../physics/integrator';
import { eulerFixed, rk4Fixed } from '../../physics/numerics/rk4';
import { sigmav } from '../../physics/reactivity';
import { Figure } from '../figure';
import { C, COL2, slopeLine } from './common';

const KEV = 1.602176634e-16;

export interface VerificationData {
  gs: { h: number[]; err: number[] };
  space: { dr: number[]; err: number[] };
  time: { dt: number[]; err: number[]; tau: number };
  wp: { dp5: { nfev: number[]; err: number[] }; rk4: { nfev: number[]; err: number[] }; euler: { nfev: number[]; err: number[] } };
}

function heatInputs(N: number, over: Partial<HeatInputs> = {}): HeatInputs {
  const z = () => new Float64Array(N), zf = () => new Float64Array(N + 1);
  const n = new Float64Array(N).fill(1e20);
  return {
    dt: 1e6, ne0: n, ne1: n, ni0: n, ni1: n, Te0: z(), Ti0: z(), chiE: zf().fill(1), chiI: zf().fill(1),
    Qe: z(), Qi: z(), Le: z(), Li: z(), TeStar: z(), TiStar: z(), nuEq: z(), GammaF: zf(), convCoef: 0,
    TeB: 0.1, TiB: 0.1, nB: 1e20, ...over,
  };
}

/** J₀ (Abramowitz & Stegun 9.4.1/9.4.3 polinom yaklaşımları, |ε| < 5·10⁻⁸) */
function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const y = (x / 3) ** 2;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.00021)))));
  }
  const y = 3 / ax;
  const f0 = 0.79788456 + y * (-0.00000077 + y * (-0.0055274 + y * (-0.00009512 + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  const t0 = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return (f0 * Math.cos(t0)) / Math.sqrt(ax);
}
const J01 = 2.404825557695773;

/** 0D yanma dinamiği (D–T, n ve T): α ısıtma + P_aux, güç bozunumlu τ_E ∝ P^−0.69, bremsstrahlung, modüle yakıt kaynağı */
export const burnRhs: RHS = (t, y, d) => {
  const n = y[0] * 1e20, T = Math.max(y[1], 0.05);
  const Pa = 0.25 * n * n * sigmav.DT(T) * 3.5e3 * KEV;
  const Pb = 5.35e-37 * n * n * Math.sqrt(T);
  const Ph = Pa + 0.1e6;
  const tauE = 2.5 * Math.pow(Ph / 0.25e6, -0.69);
  const W = 3 * n * T * KEV;
  const S = (1e20 / 5) * (1 + 0.2 * Math.sin((2 * Math.PI * t) / 20));
  const dn = S - n / 5;
  d[0] = dn / 1e20;
  d[1] = (Ph - Pb - W / tauE - 3 * T * KEV * dn) / (3 * n * KEV);
};

function runDP5(rhs: RHS, y0: number[], t1: number, rtol: number, atol: number): { y: Float64Array; nfev: number } {
  let nfev = 0;
  const f: RHS = (t, y, d) => { nfev++; rhs(t, y, d); };
  const y = Float64Array.from(y0);
  const dp = new DormandPrince(y.length, f, { rtol, atol, dtMin: 1e-12, dtMax: t1 }, 1e-3);
  let t = 0, guard = 0;
  while (t < t1 - 1e-12 && guard++ < 1e7) t = dp.step(t, y, t1);
  return { y, nfev };
}

export function computeVerification(): VerificationData {
  // (a) GS
  const shape = { epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 };
  const geom = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };
  const sol = new PhysicalSolovev(6.2, 5.3, 15e6, shape);
  const gs = { h: [] as number[], err: [] as number[] };
  for (const NR of [17, 25, 33, 49, 65, 97, 129]) {
    const grid = new GSGrid(geom, { NR });
    const psi = grid.solveLinear((R) => sol.source(R), (R, Z) => sol.psi(R, Z));
    let emax = 0, pmax = 0;
    for (let k = 0; k < psi.length; k++) {
      if (grid.kind[k] !== 1) continue;
      const R = grid.R(k % grid.NR), Z = grid.Z(Math.floor(k / grid.NR));
      emax = Math.max(emax, Math.abs(psi[k] - sol.psi(R, Z)));
      pmax = Math.max(pmax, Math.abs(sol.psi(R, Z)));
    }
    gs.h.push(grid.dR); gs.err.push(emax / pmax);
  }
  // (b) ısı çözücüsü — uzay
  const space = { dr: [] as number[], err: [] as number[] };
  for (const N of [10, 20, 40, 80, 160, 320]) {
    const g = circularGeometry(3, 1, 3, N);
    const Q = 1e20;
    const h = heatInputs(N, { Qe: new Float64Array(N).fill(Q), Qi: new Float64Array(N).fill(Q) });
    const Te = new Float64Array(N), Ti = new Float64Array(N);
    new HeatSolver(g).solve(h, Te, Ti);
    let e = 0;
    for (let i = 0; i < N; i++) { const ex = 0.1 + (Q * (1 - g.rhoC[i] ** 2)) / (4e20); e = Math.max(e, Math.abs(Te[i] - ex) / ex); }
    space.dr.push(g.dRho); space.err.push(e);
  }
  // (c) geri Euler — zaman (öz-yakınsama, N = 200)
  const N = 200, g = circularGeometry(3, 1, 3, N);
  const lam = ((2 / 3) * J01 * J01) / 1; // χ = 1 m²/s, a = 1 m
  const tau = 1 / lam;
  const evolve = (M: number): Float64Array => {
    const Te = Float64Array.from(g.rhoC, (r) => 0.1 + besselJ0(J01 * r)), Ti = Float64Array.from(Te);
    const hs = new HeatSolver(g);
    for (let s = 0; s < M; s++) {
      const h = heatInputs(N, { dt: tau / M, Te0: Float64Array.from(Te), Ti0: Float64Array.from(Ti) });
      hs.solve(h, Te, Ti);
    }
    return Te;
  };
  const ref = evolve(8192);
  const time = { dt: [] as number[], err: [] as number[], tau };
  for (const M of [4, 8, 16, 32, 64, 128, 256, 512]) {
    const Te = evolve(M);
    let e = 0, s = 0;
    for (let i = 0; i < N; i++) { e = Math.max(e, Math.abs(Te[i] - ref[i])); s = Math.max(s, Math.abs(ref[i] - 0.1)); }
    time.dt.push(tau / M); time.err.push(e / s);
  }
  // (d) iş–hassasiyet (0D yanma testi, t = 0…40 s)
  const y0 = [0.5, 1.0], t1 = 40;
  const yr = runDP5(burnRhs, y0, t1, 1e-13, 1e-15).y;
  const relErr = (y: Float64Array) => Math.max(...Array.from(y, (v, i) => Math.abs(v - yr[i]) / Math.abs(yr[i])));
  const wp: VerificationData['wp'] = { dp5: { nfev: [], err: [] }, rk4: { nfev: [], err: [] }, euler: { nfev: [], err: [] } };
  for (let k = 3; k <= 11; k++) {
    const r = runDP5(burnRhs, y0, t1, 10 ** -k, 10 ** -(k + 2));
    wp.dp5.nfev.push(r.nfev); wp.dp5.err.push(relErr(r.y));
  }
  for (let n = 25; n <= 25 * 2 ** 10; n *= 2) {
    const y = Float64Array.from(y0);
    const nf = rk4Fixed(burnRhs, y, 0, t1, n);
    const e = relErr(y);
    if (Number.isFinite(e) && e < 1) { wp.rk4.nfev.push(nf); wp.rk4.err.push(e); }
  }
  for (let n = 100; n <= 100 * 2 ** 13; n *= 2) {
    const y = Float64Array.from(y0);
    const nf = eulerFixed(burnRhs, y, 0, t1, n);
    const e = relErr(y);
    if (Number.isFinite(e) && e < 1) { wp.euler.nfev.push(nf); wp.euler.err.push(e); }
  }
  return { gs, space, time, wp };
}

/** log-log en küçük kareler eğimi */
export function slope(x: number[], y: number[]): number {
  const lx = x.map(Math.log), ly = y.map(Math.log);
  const n = lx.length, mx = lx.reduce((a, b) => a + b, 0) / n, my = ly.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (lx[i] - mx) * (ly[i] - my); sxx += (lx[i] - mx) ** 2; }
  return sxy / sxx;
}

export function figVerification(v: VerificationData): Figure {
  const fig = new Figure(COL2, 5.2, { fontSize: 8, title: 'Numerical verification' });
  const [a, b, c, d] = fig.subplots(2, 2, { left: 0.6, right: 0.15, top: 0.22, bottom: 0.45, wspace: 0.75, hspace: 0.62 });

  a.plot(v.gs.h, v.gs.err, { color: C.blue, marker: 'o', ms: 3.5, label: `GS solver (fit slope ${slope(v.gs.h, v.gs.err).toFixed(2)})` });
  slopeLine(a, v.gs.h[v.gs.h.length - 1], v.gs.h[0], v.gs.err[v.gs.err.length - 1] * 0.45, 2, '$\\propto h^2$');
  a.set({ xscale: 'log', yscale: 'log', xlabel: 'grid spacing $h$ (m)', ylabel: '$\\mathrm{max}|\\psi - \\psi_{\\mathrm{exact}}|\\,/\\,\\mathrm{max}|\\psi|$', title: "Grad–Shafranov vs Solov'ev" })
    .legend({ loc: 'best' }).panelLabel('(a)');

  b.plot(v.space.dr, v.space.err, { color: C.vermilion, marker: 's', ms: 3.2, label: `FV heat solver (fit slope ${slope(v.space.dr, v.space.err).toFixed(2)})` });
  slopeLine(b, v.space.dr[v.space.dr.length - 1], v.space.dr[0], v.space.err[v.space.err.length - 1] * 0.45, 2, '$\\propto \\Delta\\rho^2$');
  b.set({ xscale: 'log', yscale: 'log', xlabel: '$\\Delta\\rho$', ylabel: 'max. relative error', title: 'Steady diffusion, uniform source' })
    .legend({ loc: 'best' }).panelLabel('(b)');

  const dtn = v.time.dt.map((x) => x / v.time.tau);
  c.plot(dtn, v.time.err, { color: C.green, marker: '^', ms: 3.5, label: `backward Euler (fit slope ${slope(dtn, v.time.err).toFixed(2)})` });
  slopeLine(c, dtn[dtn.length - 1], dtn[0], v.time.err[v.time.err.length - 1] * 0.45, 1, '$\\propto \\Delta t$');
  c.set({ xscale: 'log', yscale: 'log', xlabel: '$\\Delta t/\\tau_{01}$', ylabel: 'max. relative error at $t = \\tau_{01}$', title: '$J_0$ mode decay (self-convergence)' })
    .legend({ loc: 'best' }).panelLabel('(c)');

  d.plot(v.wp.euler.nfev, v.wp.euler.err, { color: C.grey, marker: 'v', ms: 3.2, dash: 'dotted', label: 'explicit Euler (fixed $h$)' });
  d.plot(v.wp.rk4.nfev, v.wp.rk4.err, { color: C.blue, marker: 'o', ms: 3.2, dash: 'dashed', label: 'classical RK4 (fixed $h$)' });
  d.plot(v.wp.dp5.nfev, v.wp.dp5.err, { color: C.vermilion, marker: 's', ms: 3.2, label: 'Dormand–Prince RK5(4), adaptive' });
  d.set({ xscale: 'log', yscale: 'log', xlabel: 'RHS evaluations', ylabel: 'relative error at $t$ = 40 s', title: '0D burn dynamics: work–precision', ylim: [1e-13, 1] })
    .legend({ loc: 'upper right', size: 6.5 }).panelLabel('(d)');
  return fig;
}
