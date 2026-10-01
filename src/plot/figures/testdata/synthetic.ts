/**
 * Deterministic synthetic inputs for the figure builders (tests only): closed-form profiles, histories
 * and grids that have the shapes the builders expect but do not depend on the physics code, so that the
 * SHA-256 of a rendered figure changes only when a builder or the plot engine changes.
 */
import type { Equilibrium } from '../../../physics/equilibrium/gs';
import type { PopconGrid } from '../../../physics/popcon';
import type { DiagSpec, EqSnapshot, HistoryFrame, MagneticConfig, SimEvent } from '../../../physics/types';
import type { CrashSnapshot } from '../../../physics/profiles/model';
import type { ReactivityRates } from '../reactivity';
import type { VerificationData } from '../verification';
import type { MainRun, PaperCtx, RunSummary } from '../paper';

/** Park-Miller LCG (deterministic uniform numbers in (0, 1)) */
export function lcg(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
}

/** standard normal numbers (Box-Muller) from a uniform generator */
export function normals(rng: () => number, n: number): number[] {
  const out: number[] = [];
  while (out.length < n) {
    const u = Math.max(rng(), 1e-12), v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    out.push(r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v));
  }
  return out.slice(0, n);
}

export const linspace = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// ------------------------------------------------------------------ 1.5D history

export const NRHO = 24;
export const RHO = Array.from({ length: NRHO }, (_, j) => (j + 0.5) / NRHO);

/** profiles of a fictitious ITER-like discharge at time fraction s in [0, 1] */
function profiles(s: number): Record<string, number[]> {
  const ramp = Math.min(1, s / 0.3);
  const par = (c: number, e: number) => RHO.map((r) => c * Math.pow(Math.max(1 - r * r, 0), e));
  const Te = par(22 * ramp, 1.6).map((v, j) => v + 1.2 * ramp * (RHO[j] < 0.95 ? 1 : 0.2));
  return {
    rho: RHO.slice(), Te, Ti: Te.map((v) => 0.9 * v), ne: par(1.0 * ramp, 0.5).map((v) => v + 0.2 * ramp), Zeff: RHO.map((r) => 1.6 + 0.4 * r * r),
    q: RHO.map((r) => 1 + 2.6 * r * r + 0.1 * Math.sin(6 * r)), shear: RHO.map((r) => 0.1 + 3 * r * r - 0.5 * r),
    j: par(1.0 * ramp, 1.2), johm: par(0.6 * ramp, 1.0), jbs: RHO.map((r) => 0.35 * ramp * Math.exp(-(((r - 0.75) / 0.2) ** 2))), jcd: par(0.1 * ramp, 2),
    chie: RHO.map((r) => 0.5 + 3 * r * r), chii: RHO.map((r) => 0.4 + 2.5 * r * r),
    Palpha: par(0.5 * ramp * ramp, 2.5), Paux: par(0.1, 3), Prad: RHO.map((r) => 0.05 + 0.1 * r * r), Pohm: par(0.01, 1),
  };
}

/** n history frames over t = 0…t1 with the diagnostics the trace, profile and MHD figures read */
export function syntheticFrames(n = 60, t1 = 120): HistoryFrame[] {
  return Array.from({ length: n }, (_, i) => {
    const s = i / (n - 1), t = s * t1, ramp = Math.min(1, s / 0.3);
    const d: Record<string, number> = {
      Q: 9.5 * ramp ** 2 * (1 + 0.05 * Math.sin(20 * s)), W: 350 * ramp, P_alpha: 100 * ramp ** 2, P_aux: 50, P_cond: 140 * ramp, P_rad: 30 * ramp, P_oh: 1 + 0.5 * (1 - ramp),
      Te0: 24 * ramp, Ti0: 21 * ramp, Tped: 4.5 * ramp, nbar: 0.85 * ramp, q0: 1 + 0.05 * Math.sin(30 * s), li: 0.85 * ramp + 0.2, f_bs: 0.25 * ramp, betaN: 1.8 * ramp,
      w32: 0.01 * Math.max(0, s - 0.5) * (1 + Math.sin(40 * s)), w21: 0.006 * Math.max(0, s - 0.6),
      Ip: 15 * ramp, Pfus: 500 * ramp * ramp,
    };
    return { t, y: [], internal: {}, d, prof: profiles(s) };
  });
}

/** events matching syntheticFrames: L-H transition, NTM onset, a run of ELMs, sawteeth */
export function syntheticEvents(t1 = 120): SimEvent[] {
  const ev: SimEvent[] = [{ t: 0.2 * t1, kind: 'LH', msg: 'L-H transition' }, { t: 0.6 * t1, kind: 'NTM_onset', msg: 'NTM onset' }];
  for (let k = 0; k < 40; k++) ev.push({ t: 0.25 * t1 + k * 0.012 * t1 + 0.001 * k, kind: 'ELM', msg: 'ELM' });
  for (let k = 0; k < 6; k++) ev.push({ t: 0.35 * t1 + k * 0.09 * t1, kind: 'sawtooth', msg: 'sawtooth' });
  return ev.sort((a, b) => a.t - b.t);
}

/** diagnostic specs of a 0D shot (UI diagnostics groups) for figDiagGroups */
export const DIAG_SPECS: DiagSpec[] = [
  { key: 'Q', label: 'Q', unit: '', group: 'Performance' }, { key: 'Pfus', label: 'P_fus', unit: 'MW', group: 'Performance' },
  { key: 'P_alpha', label: 'P_alpha', unit: 'MW', group: 'Power' }, { key: 'P_aux', label: 'P_aux', unit: 'MW', group: 'Power' }, { key: 'P_rad', label: 'P_rad', unit: 'MW', group: 'Power' },
  { key: 'Te0', label: 'T_e0', unit: 'keV', group: 'Temperature' }, { key: 'Ti0', label: 'T_i0', unit: 'keV', group: 'Temperature' },
  { key: 'nbar', label: 'n_e [1e20 m⁻³]', unit: '', group: 'Density', log: true },
];

// ------------------------------------------------------------------ MHD crashes

export function syntheticCrash(kind: 'sawtooth' | 'elm'): { t: number; before: CrashSnapshot; after: CrashSnapshot } {
  const rho = linspace(0.02, 0.98, 32);
  const Te = (flat: boolean) => rho.map((r) => 20 * Math.pow(1 - r * r, 1.5) + 1 - (flat && r < 0.35 ? 3.5 * (1 - r / 0.35) : 0));
  const ped = (after: boolean) => rho.map((r) => (r < 0.9 ? 9 - 4 * r * r : 9 - 4 * 0.81 - (after ? 3 : 1.5) * ((r - 0.9) / 0.1)) + 0.5);
  const q = (after: boolean) => rho.map((r) => (after && r < 0.35 ? 1.02 : 0.85 + 2.5 * r * r));
  const ne = (after: boolean) => rho.map((r) => 0.9 - 0.4 * r * r - (after && r > 0.9 ? 0.12 : 0));
  return kind === 'sawtooth'
    ? { t: 71.5, before: { rho, Te: Te(false), Ti: Te(false), ne: ne(false), q: q(false) }, after: { rho, Te: Te(true), Ti: Te(true), ne: ne(true), q: q(true) } }
    : { t: 91.25, before: { rho, Te: ped(false), Ti: ped(false), ne: ne(false), q: q(false) }, after: { rho, Te: ped(true), Ti: ped(true), ne: ne(true), q: q(true) } };
}

export function syntheticZoom(): { t: number[]; W: number[]; Tped: number[]; elm: number[] } {
  const t = linspace(90, 91.5, 76);
  const elm = [90.3, 90.75, 91.2];
  const saw = (x: number, per: number) => ((x - 90) % per) / per;
  return { t, W: t.map((x) => 330 + 12 * saw(x, 0.45) - 6), Tped: t.map((x) => 4.2 + 0.5 * saw(x, 0.45)), elm };
}

// ------------------------------------------------------------------ equilibrium

/** a shaped, shifted set of nested flux surfaces with the members that figEquilibrium and figEqSnapshot read */
export function syntheticEqSnapshot(): EqSnapshot {
  const rho = linspace(0.1, 1, 10);
  const R: number[][] = [], Z: number[][] = [];
  for (const r of rho) {
    const th = linspace(0, 2 * Math.PI, 73).slice(0, 72);
    R.push(th.map((a) => 6.2 + 0.15 * (1 - r * r) + 2.0 * r * Math.cos(a + 0.33 * Math.sin(a))));
    Z.push(th.map((a) => 2.0 * 1.7 * r * Math.sin(a)));
  }
  return { R, Z, rho, Raxis: 6.35, Zaxis: 0.02, q95: 3.05, li: 0.86, betaP: 0.64 };
}

/** stand-in for the Grad-Shafranov result: the members the figure reads, from closed-form fields */
export function syntheticEquilibrium(): Equilibrium {
  const R0 = 6.2, a = 2.0, kappa = 1.7, shift = 0.16;
  const inside = (R: number, Z: number) => ((R - R0) / a) ** 2 + (Z / (kappa * a)) ** 2 <= 1;
  const psiAxis = 1.0;
  const psiN = linspace(0, 1, 11);
  const nS = 10;
  const snap = syntheticEqSnapshot();
  const rhoTor = [0, ...snap.rho];
  const field = (R: number, Z: number) => psiAxis * (1 - (((R - R0 - shift * 0.5) / a) ** 2 + (Z / (kappa * a)) ** 2));
  const eq = {
    grid: { NR: 49, NZ: 65, boundary: { R0, a, kappa, inside }, bicubic: () => ({ eval: field }) },
    psi: new Float64Array(4), psiAxis, Raxis: R0 + shift, Zaxis: 0,
    prof: {
      psiN, rhoTor, q: rhoTor.map((r) => 1 + 2.6 * r * r), ft: rhoTor.map((r) => 1.46 * Math.sqrt((r * a) / R0)),
    },
    surfaces: { R: snap.R.slice(0, nS), Z: snap.Z.slice(0, nS) },
    shafranovShift: shift, q95: 3.05, li3: 0.86, betaP: 0.64,
  };
  return eq as unknown as Equilibrium;
}

// ------------------------------------------------------------------ POPCON, verification, scan, validation, Lawson

export function syntheticPopcon(nx = 24, ny = 24): PopconGrid {
  const n = linspace(0.02e20, 1.95e20, nx), T = linspace(0.6, 29.4, ny);
  const N = nx * ny;
  const Paux = new Float64Array(N), Pfus = new Float64Array(N), Q = new Float64Array(N), betaN = new Float64Array(N), fHe = new Float64Array(N);
  const PLH_ok = new Uint8Array(N);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const k = i * ny + j, x = n[i] / 1e20, tt = T[j];
    const fus = 600e6 * x * x * (tt / 12) ** 2.4 / (1 + (tt / 22) ** 3.5);
    const loss = 40e6 + 260e6 * x * (tt / 10) ** 1.5 / (1 + 0.1 * x);
    Pfus[k] = fus; Paux[k] = Math.max(-20e6, loss - 0.2 * fus); Q[k] = Paux[k] > 1e5 ? fus / Paux[k] : Infinity;
    betaN[k] = 0.06 * x * tt * 1.3; PLH_ok[k] = x * tt > 3.4 ? 1 : 0; fHe[k] = 0.02 + 0.03 * x;
  }
  return { n, T, nx, ny, Paux, Pfus, Q, betaN, PLH_ok, fHe, nG: 1.15e20 };
}

/** the only field of a MagneticConfig that figPopcon reads when it is given a grid */
export const POPCON_CFG = { limits: { betaN_limit: 2.5, greenwald_limit: 1, q95_limit: 2, W_conc_limit: 1e-3 } } as unknown as MagneticConfig;

export function syntheticVerification(): VerificationData {
  const geo = (n: number, h0: number) => Array.from({ length: n }, (_, k) => h0 / 2 ** k);
  const h = geo(7, 0.2), dr = geo(6, 0.1), dt = geo(8, 0.3);
  const wp = (order: number, c: number, nf0: number, n: number) => {
    const nfev = Array.from({ length: n }, (_, k) => nf0 * 2 ** k);
    return { nfev, err: nfev.map((f) => c * f ** -order) };
  };
  return {
    gs: { h, err: h.map((x) => 3 * x * x * (1 + 0.05 * Math.sin(x * 100))) },
    space: { dr, err: dr.map((x) => 0.5 * x * x) },
    time: { dt, err: dt.map((x) => 0.8 * x), tau: 0.14 },
    wp: { dp5: wp(5, 1e2, 200, 9), rk4: wp(4, 5e3, 100, 8), euler: wp(1, 5, 100, 12) },
  };
}

export function syntheticScan(n = 7): { x: number[]; y: number[]; Q: number[]; Pfus: number[] } {
  const x = linspace(0.5, 1, n), y = linspace(0.7, 1.3, n);
  const Q: number[] = [], Pfus: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = i === 2 && j === 3 ? NaN : 25 * (y[j] - 0.55) * (x[i] ** 1.5) * (1 - 0.3 * (x[i] - 0.9) ** 2 * 4);
    Q.push(q); Pfus.push(50 * q);
  }
  return { x, y, Q, Pfus };
}

export const VALIDATION_LABELS: [string, number, string][] = [
  ['ITER  $Q$', 10, '10'], ['ITER  $P_{\\mathrm{fus}}$', 500, '500 MW'], ['ITER  $q_{95}$', 3, '3.0'], ['JET  $E_{\\mathrm{fus}}$', 59, '59 MJ'],
  ['SPARC  $Q$', 11, '11'], ['DEMO  $P_{\\mathrm{fus}}$', 2000, '2 GW'], ['NIF  gain $G$', 1.54, '1.54'],
];

/** analytic stand-ins of the fusion reactivities <sigma v>(T) (m^3/s, T in keV): positive, rising, then falling */
export const SYNTHETIC_RATES: ReactivityRates = {
  DT: (T) => 1.1e-22 * (T / 12) ** 2.2 / (1 + (T / 30) ** 3.2),
  DD_total: (T) => 2.6e-24 * (T / 12) ** 2.6 / (1 + (T / 70) ** 3),
  DHe3: (T) => 4e-25 * (T / 20) ** 3 / (1 + (T / 100) ** 3.3),
  pB11: (T) => 3e-26 * (T / 150) ** 3.2 / (1 + (T / 400) ** 3),
};

// ------------------------------------------------------------------ the paper registry's context

/** flat-top averages of a fictitious discharge (the keys the paper figures read) */
const avg = (k: number): Record<string, number> => ({
  Q: 9 + k, P_fus: 480 + 10 * k, f_bs: 0.24, li: 0.86, betaN: 1.7, Tped: 4.4, q95: 3.05, nG_frac: 0.83, Ti: 8.5 + k, triple: 2.4e21 + 1e20 * k, Ti0: 9 + k,
});

/** a stand-in for the ITER 1.5D main run: the members the paper figures and captions read */
export function syntheticMainRun(counters = { eqUpdates: 25, eqRetried: 3, eqRejected: 1, forcedSteps: 0 }): MainRun {
  const frames = syntheticFrames(60, 120);
  const model = { eq: syntheticEquilibrium(), ps: { pedestalWidth: 0.05, sawtoothShear: 1, nRho: 50, gridPacking: 4, rtol: 1e-2 }, ...counters };
  return {
    sim: { history: frames, events: syntheticEvents(120) } as unknown as MainRun['sim'],
    model: model as unknown as MainRun['model'],
    report: {} as MainRun['report'], avg: avg(0),
    saw: syntheticCrash('sawtooth'), elm: syntheticCrash('elm'), zoom: syntheticZoom(), ms: 1,
  };
}

/** a complete PaperCtx (all runs succeeded) around syntheticMainRun, for a scan of size n */
export function syntheticPaperCtx(n = 3): PaperCtx {
  const runs = new Map<string, RunSummary>();
  const ok = (id: string, k: number, extra: object = {}) => runs.set(id, { id, ok: true, avg: avg(k), report: { E_fusion_MJ: 60 + k, Q_sci_max: 1.5, termination: { natural: true }, ...extra } as unknown as RunSummary['report'] });
  ['ITER', 'JET', 'SPARC', 'DEMO', 'NIF', 'JET15', 'SPARC15', 'DEMO15'].forEach((id, k) => ok(id, k));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ok(`scan:${i}:${j}`, i + j, i === 1 && j === 1 ? { termination: { natural: false } } : {});
  return { params: { scan: n }, iter: syntheticMainRun(), runs, verification: syntheticVerification(), popcon: syntheticPopcon() };
}
