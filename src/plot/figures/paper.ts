/**
 * The paper's figure set (Figs. 1–9) as registry specs: data needs, canonical inputs (for the
 * provenance configuration hash), builders and captions. The figures CLI supplies the data: the
 * ITER 1.5D discharge runs on the main thread ({@link runIter15}); preset and scan discharges, the
 * code-verification data and the POPCON grid are worker-pool tasks ({@link runFigTask}, executed by
 * tasks.worker.ts).
 */
import { Simulation } from '../../physics/simulation';
import { flatTopAverages } from '../../physics/analysis/flatTop';
import { DEMO, DEMO_15D, ITER, ITER_15D, JET, JET_15D, NIF, SPARC, SPARC_15D } from '../../physics/presets';
import { ProfileModel } from '../../physics/profiles/model';
import { PopconGrid, computePopcon } from '../../physics/popcon';
import { lineAverageFactor } from '../../physics/limits';
import { MagneticConfig, ReactorConfig, ShotReport } from '../../physics/types';
import { FigureSpec } from '../registry';
import { C, profileFrame } from './common';
import { figEquilibrium } from './equilibrium';
import { figProfiles } from './profiles';
import { figTimeTraces } from './timetrace';
import { figPopcon } from './popcon';
import { ValidationRow, figValidation } from './validation';
import { LawsonMachine, figReactivityLawson } from './reactivity';
import { VerificationData, computeVerification, figVerification, slope } from './verification';
import { CrashRecord, ElmZoom, figMHD } from './mhd';
import { figScan } from './scan';

export type PaperNeed = 'iter15' | 'presets' | 'scan' | 'verification' | 'popcon';
export interface PaperParams {
  /** scan grid size N (N×N discharges) */
  scan: number;
}

/** Flat-top summary of one pooled discharge */
export interface RunSummary { id: string; ok: boolean; error?: string; report?: ShotReport; avg?: Record<string, number>; ms?: number }

export interface MainRun {
  sim: Simulation; model: ProfileModel; report: ShotReport; avg: Record<string, number>;
  saw?: CrashRecord; elm?: CrashRecord; zoom: ElmZoom; ms: number;
}

export interface PaperCtx {
  params: PaperParams;
  iter: MainRun | null;
  runs: ReadonlyMap<string, RunSummary>;
  verification: VerificationData | null;
  popcon: PopconGrid | null;
}

// ---------------------------------------------------------------- inputs

/** High-cadence ELM window of the ITER 1.5D shot: starts at 75 % of the discharge, 1.5 s sampled every 2 ms */
export const ITER15_ZOOM = { startFrac: 0.75, window_s: 1.5, dt_s: 0.002 } as const;
export const PRESET_RUNS: readonly (readonly [string, ReactorConfig])[] = [
  ['ITER', ITER], ['JET', JET], ['SPARC', SPARC], ['DEMO', DEMO], ['NIF', NIF], ['JET15', JET_15D], ['SPARC15', SPARC_15D], ['DEMO15', DEMO_15D],
];
export const POPCON_GRID = { res: 110, Tmax: 30, nMaxFactor: 1.35, uniformT: true } as const;
export const SCAN_T_END = 150;

/**
 * Scan axes: n̄_e/n_G 0.5…1.0 (x) and H98 0.7…1.3 (y). The Greenwald limit is defined for the
 * LINE-averaged density n̄_e (Greenwald et al., Nucl. Fusion 28 (1988) 2199), whereas the 0D
 * `n_target` is a VOLUME average: n̄_e = fLine · n_target with fLine = lineAverageFactor(α_n)
 * (limits.ts), so x = fLine · n_target / n_G. The ITER baseline marker uses the same conversion.
 */
export function scanAxes(N: number): { nGfr: number; fLine: number; sx: number[]; sy: number[] } {
  const nGfr = ITER.Ip_MA / (Math.PI * ITER.geometry.a ** 2); // 10²⁰ m⁻³
  return {
    nGfr,
    fLine: lineAverageFactor(ITER.transport.alpha_n),
    sx: Array.from({ length: N }, (_, i) => 0.5 + (0.5 * i) / (N - 1)),
    sy: Array.from({ length: N }, (_, j) => 0.7 + (0.6 * j) / (N - 1)),
  };
}
export function scanConfig(N: number, i: number, j: number): MagneticConfig {
  const { nGfr, fLine, sx, sy } = scanAxes(N);
  return { ...ITER, H98: sy[j], n_target: (sx[i] * nGfr * 1e20) / fLine, t_end: SCAN_T_END };
}
/** x position of the ITER baseline on the scan's n̄_e/n_G axis */
export function scanBaselineX(): number {
  const { nGfr, fLine } = scanAxes(2);
  return (ITER.n_target * fLine) / (nGfr * 1e20);
}

const iter15Input = { preset: 'ITER_15D', cfg: ITER_15D, zoom: ITER15_ZOOM };
const presetsInput = () => PRESET_RUNS.map(([id, cfg]) => ({ id, cfg }));
const presetSeeds = () => Object.fromEntries(PRESET_RUNS.map(([id, cfg]) => [id, cfg.seed]));

// ---------------------------------------------------------------- pool tasks

export type FigTask =
  | { id: string; kind: 'run'; cfg: ReactorConfig }
  | { id: string; kind: 'verification' }
  | { id: string; kind: 'popcon'; cfg: MagneticConfig; res: number; Tmax: number; nMaxFactor: number };

export interface FigTaskResult {
  id: string; ok: boolean; error?: string; ms: number;
  run?: { report: ShotReport; avg: Record<string, number> };
  verification?: VerificationData;
  popcon?: PopconGrid;
}

/** Worker-pool tasks for the given needs, longest first (1.5D runs, then verification/POPCON, then the scan). */
export function poolTasks(needs: ReadonlySet<PaperNeed>, params: PaperParams): FigTask[] {
  const tasks: { t: FigTask; w: number }[] = [];
  if (needs.has('presets')) for (const [id, cfg] of PRESET_RUNS) tasks.push({ t: { id, kind: 'run', cfg }, w: ((cfg as MagneticConfig).fidelity === '1.5D' ? 100 : 1) * ((cfg as { t_end?: number }).t_end ?? 1) });
  if (needs.has('verification')) tasks.push({ t: { id: 'verification', kind: 'verification' }, w: 5000 });
  if (needs.has('popcon')) tasks.push({ t: { id: 'popcon', kind: 'popcon', cfg: ITER_15D, res: POPCON_GRID.res, Tmax: POPCON_GRID.Tmax, nMaxFactor: POPCON_GRID.nMaxFactor }, w: 5000 });
  if (needs.has('scan')) {
    const N = params.scan;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) tasks.push({ t: { id: `scan:${i}:${j}`, kind: 'run', cfg: scanConfig(N, i, j) }, w: SCAN_T_END });
  }
  // stable sort: equal weights keep their insertion order (deterministic scheduling order)
  return tasks.map((x, k) => ({ ...x, k })).sort((a, b) => b.w - a.w || a.k - b.k).map((x) => x.t);
}

/** Executes one pool task (in a worker thread; also callable in-process). */
export function runFigTask(task: FigTask): FigTaskResult {
  const t0 = performance.now();
  try {
    switch (task.kind) {
      case 'run': {
        const sim = new Simulation(task.cfg);
        const report = sim.runAll();
        return { id: task.id, ok: true, run: { report, avg: flatTopAverages(sim.history) }, ms: performance.now() - t0 };
      }
      case 'verification':
        return { id: task.id, ok: true, verification: computeVerification(), ms: performance.now() - t0 };
      case 'popcon':
        return { id: task.id, ok: true, popcon: computePopcon(task.cfg, { nx: task.res, ny: task.res, Tmax: task.Tmax, nMaxFactor: task.nMaxFactor, uniformT: true }), ms: performance.now() - t0 };
    }
  } catch (e) {
    return { id: task.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e), ms: performance.now() - t0 };
  }
}

// ---------------------------------------------------------------- ITER 1.5D main run

/** ITER 1.5D with crash hooks (sawtooth/ELM snapshots) and the high-cadence ELM window. */
export async function runIter15(o: { onProgress?: (pct: number) => void; yieldToLoop?: () => Promise<void> } = {}): Promise<MainRun> {
  const t0 = performance.now();
  const tEnd = ITER_15D.t_end; // = ProfileModel.tEnd
  const tz = ITER15_ZOOM.startFrac * tEnd, dz = ITER15_ZOOM.window_s, dtz = ITER15_ZOOM.dt_s;
  // The v4 kernel is chunk invariant: advance() ends on integrator step boundaries only. The 2 ms
  // zoom grid (tz included) is therefore passed as breakpoints, so steps end on it and each
  // advance(dtz) from one grid point stops at the next (see SimulationOptions.breakpoints).
  const zoomGrid = Array.from({ length: Math.round(dz / dtz) + 1 }, (_, k) => tz + k * dtz);
  const sim = new Simulation(ITER_15D, { breakpoints: zoomGrid });
  const model = sim.model as ProfileModel;
  let saw: CrashRecord | undefined, elm: CrashRecord | undefined;
  model.crashHook = (kind, t, before, after) => {
    if (kind === 'sawtooth' && !saw && t > 0.5 * tEnd) saw = { t, before, after };
    if (kind === 'ELM' && !elm && t > tz) elm = { t, before, after };
  };
  const zoom: ElmZoom = { t: [], W: [], Tped: [], elm: [] };
  let zoomDone = false, lastPct = -1;
  while (!sim.done) {
    if (!zoomDone && sim.t >= tz - 1e-9) {
      while (sim.t < tz + dz - 1e-9 && !sim.done) {
        sim.advance(dtz);
        const d = sim.model.diagnostics(sim.t, sim.y);
        zoom.t.push(sim.t); zoom.W.push(d.W); zoom.Tped.push(d.Tped);
      }
      zoom.elm = sim.events.filter((e) => e.kind === 'ELM' && e.t >= tz && e.t <= tz + dz).map((e) => e.t);
      zoomDone = true;
    }
    const chunk = zoomDone ? tEnd / 200 : Math.min(tEnd / 200, tz - sim.t);
    sim.advance(Math.max(chunk, 1e-6));
    const pct = Math.floor((100 * sim.t) / tEnd);
    if (pct >= lastPct + 10) { lastPct = pct; o.onProgress?.(pct); }
    if (o.yieldToLoop) await o.yieldToLoop(); // let the pool's message handlers run
  }
  model.crashHook = null;
  return { sim, model, report: sim.report(), avg: flatTopAverages(sim.history), saw, elm, zoom, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------- figures

/** mathtext label → plain text (markdown table) */
export const plainLabel = (s: string) => s.replace(/\$/g, '').replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\\beta/g, 'β').replace(/\\ell/g, 'ℓ').replace(/_\{([^}]*)\}/g, '_$1').replace(/[{}]/g, '');

const need = (x: MainRun | null): MainRun => { if (!x) throw new Error('the ITER 1.5D run is required'); return x; };
const okRun = (ctx: PaperCtx, id: string) => { const r = ctx.runs.get(id); return r && r.ok && r.report && r.avg ? r : null; };

type Spec = FigureSpec<PaperCtx, PaperNeed, PaperParams>;

export const PAPER_FIGURES: readonly Spec[] = [
  {
    id: 'equilibrium', title: 'Magnetic equilibrium', number: 1, file: 'fig01_equilibrium', needs: ['iter15'],
    inputs: () => ({ config: { iter15: iter15Input, solovev: { R0: 6.2, B0: 5.3, Ip: 15e6, epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 } }, seeds: { ITER_15D: ITER_15D.seed } }),
    build: (ctx) => {
      const { sim, model } = need(ctx.iter);
      const last = profileFrame(sim.history)!;
      return {
        fig: figEquilibrium({ eq: model.eq, rho: last.prof!.rho, Te: last.prof!.Te, label: `ITER 1.5D, t = ${last.t.toFixed(0)} s` }),
        caption: `Magnetic equilibrium. (a) Fixed-boundary Grad–Shafranov solution of the ITER 1.5D discharge at t = ${last.t.toFixed(0)} s (${model.eq.grid.NR}×${model.eq.grid.NZ} grid, Shortley–Weller boundary treatment) coloured by T_e; white: flux surfaces at ρ_tor = 0.2, 0.4, 0.6, 0.8, black: LCFS, +: magnetic axis (Shafranov shift ${(model.eq.shafranovShift * 100).toFixed(0)} cm). (b) Cerfon–Freidberg analytic single-null Solov'ev equilibrium (ε = 0.32, κ = 1.7, δ = 0.33) with separatrix, X-point and scrape-off layer; used for verification (Fig. 7a). (c) Safety factor, magnetic shear and exact trapped-particle fraction from flux-surface averages; q95 = ${model.eq.q95.toFixed(2)}, ℓ_i(3) = ${model.eq.li3.toFixed(2)}, β_p = ${model.eq.betaP.toFixed(2)}.`,
      };
    },
  },
  {
    id: 'profiles', title: 'Flat-top profiles', number: 2, file: 'fig02_profiles', needs: ['iter15'],
    inputs: () => ({ config: { iter15: iter15Input }, seeds: { ITER_15D: ITER_15D.seed } }),
    build: (ctx) => {
      const { sim, model } = need(ctx.iter);
      const last = profileFrame(sim.history)!;
      return {
        fig: figProfiles({ frame: last, pedestalWidth: model.ps.pedestalWidth, label: `ITER 1.5D baseline, t = ${last.t.toFixed(0)} s` }),
        caption: `Radial profiles of the ITER 1.5D discharge at t = ${last.t.toFixed(0)} s (flat top): (a) electron and ion temperatures (grey band: pedestal, width ${model.ps.pedestalWidth} in ρ_tor); (b) electron density and Z_eff; (c) safety factor and magnetic shear with the q = 1, 3/2, 2 rational surfaces; (d) parallel current density and its ohmic, bootstrap (Sauter) and driven components; (e) electron and ion heat diffusivities (τ_E-scaling-constrained, with neoclassical floor and edge transport barrier); (f) alpha, auxiliary, radiated and ohmic power densities.`,
      };
    },
  },
  {
    id: 'timetraces', title: 'Discharge time traces', number: 3, file: 'fig03_timetraces', needs: ['iter15'],
    inputs: () => ({ config: { iter15: iter15Input }, seeds: { ITER_15D: ITER_15D.seed } }),
    build: (ctx) => {
      const { sim, avg } = need(ctx.iter);
      const events = sim.events;
      const nElm = events.filter((e) => e.kind === 'ELM').length, nSaw = events.filter((e) => e.kind === 'sawtooth').length;
      return {
        fig: figTimeTraces(sim.history, events, 'ITER 1.5D baseline (15 MA / 5.3 T, 50 MW)'),
        caption: `Time evolution of the ITER 1.5D discharge: (a) fusion gain Q (P_fus = Q·P_aux with P_aux = 50 MW) and thermal stored energy; (b) power balance — alpha heating, auxiliary power, transport loss W/τ_E, radiation and ohmic power; (c) central and pedestal temperatures and line-averaged density; (d) q(0), internal inductance, bootstrap fraction and β_N. Dotted vertical line: L–H transition; dashed: NTM onset. Ticks: ${nElm} type-I ELMs (b; closely spaced ELMs merge into a band) and ${nSaw} sawtooth crashes (c). Flat-top (last 30%) averages: Q = ${avg.Q.toFixed(1)}, P_fus = ${avg.P_fus.toFixed(0)} MW, f_bs = ${avg.f_bs.toFixed(2)}, ℓ_i = ${avg.li.toFixed(2)}, β_N = ${avg.betaN.toFixed(2)}.`,
      };
    },
  },
  {
    id: 'popcon', title: 'POPCON', number: 4, file: 'fig04_popcon', needs: ['iter15', 'popcon'],
    inputs: () => ({ config: { iter15: iter15Input, popcon: { cfg: ITER_15D, ...POPCON_GRID } }, seeds: { ITER_15D: ITER_15D.seed } }),
    build: (ctx) => {
      const hist = need(ctx.iter).sim.history;
      const reg = hist.filter((h) => h.prof);
      return {
        fig: figPopcon({ cfg: ITER_15D, grid: ctx.popcon ?? undefined, res: POPCON_GRID.res, traj: { n: reg.map((h) => h.d.ne), T: reg.map((h) => 0.5 * (h.d.Te + h.d.Ti)) }, label: 'ITER (IPB98(y,2), $H_{98}$ = 1)' }),
        caption: 'Plasma operation contour (POPCON) for ITER from a 0D steady-state power balance using the same physics as the 0D model: fuel dilution by Be, Ar seed and self-consistent He ash, bremsstrahlung, Mavrin line and Albajar synchrotron radiation, IPB98(y,2) confinement (H98 = 1) evaluated at the loss power P_L = P_heat − P_rad,core (radiation from ρ < 0.6), parabolic profiles (α_n = 0.3, α_T = 1.5) and T_i = T_e. Colour, fusion gain Q; white lines, required auxiliary power; black dashed, Q = 5 and 10; red dashed, β_N limit; blue dotted, L–H threshold (Martin 2008 with the Ryter 2014 low-density branch, at the line-averaged density); dash-dotted, Greenwald density (line-averaged). No ignited region exists for these assumptions. Red: volume-averaged trajectory of the 1.5D discharge (open circle: final state).',
      };
    },
  },
  {
    id: 'validation', title: 'Validation against published values', number: 5, file: 'fig05_validation', needs: ['iter15', 'presets'],
    inputs: () => ({ config: { iter15: iter15Input, presets: presetsInput() }, seeds: { ITER_15D: ITER_15D.seed, ...presetSeeds() } }),
    build: (ctx) => {
      const iter = need(ctx.iter);
      const A = (id: string, k: string) => okRun(ctx, id)?.avg?.[k];
      const E = (id: string) => okRun(ctx, id)?.report?.E_fusion_MJ;
      const rows: ValidationRow[] = [
        { label: 'ITER  $Q$', ref: 10, refText: '10', v0D: A('ITER', 'Q'), v15D: iter.avg.Q },
        { label: 'ITER  $P_{\\mathrm{fus}}$', ref: 500, refText: '500 MW', v0D: A('ITER', 'P_fus'), v15D: iter.avg.P_fus },
        { label: 'ITER  $n_{e,\\mathrm{line}}/n_{\\mathrm{G}}$', ref: 0.85, refText: '0.85', v0D: A('ITER', 'nG_frac'), v15D: iter.avg.nG_frac },
        { label: 'ITER  $q_{95}$', ref: 3.0, refText: '3.0', v0D: A('ITER', 'q95'), v15D: iter.avg.q95 },
        { label: 'ITER  $\\beta_N$', ref: 1.8, refText: '1.8', v0D: A('ITER', 'betaN'), v15D: iter.avg.betaN },
        { label: 'ITER  $f_{\\mathrm{bs}}$', ref: 0.2, refText: '≈0.2', v15D: iter.avg.f_bs },
        { label: 'ITER  $\\ell_i(3)$', ref: 0.85, refText: '0.85', v15D: iter.avg.li },
        { label: 'ITER  $T_{e,\\mathrm{ped}}$', ref: 4.5, refText: '≈4.5 keV', v15D: iter.avg.Tped },
        { label: 'JET  $E_{\\mathrm{fus}}$', ref: 59, refText: '59 MJ', v0D: E('JET'), v15D: E('JET15') },
        { label: 'JET  $T_i(0)$', ref: 10, refText: '≈10 keV', v0D: A('JET', 'Ti0'), v15D: A('JET15', 'Ti0') },
        { label: 'SPARC  $Q$', ref: 11, refText: '11', v0D: A('SPARC', 'Q'), v15D: A('SPARC15', 'Q') },
        { label: 'SPARC  $P_{\\mathrm{fus}}$', ref: 140, refText: '140 MW', v0D: A('SPARC', 'P_fus'), v15D: A('SPARC15', 'P_fus') },
        { label: 'DEMO  $P_{\\mathrm{fus}}$', ref: 2000, refText: '2 GW', v0D: A('DEMO', 'P_fus'), v15D: A('DEMO15', 'P_fus') },
        { label: 'DEMO  $f_{\\mathrm{bs}}$', ref: 0.35, refText: '0.35', v15D: A('DEMO15', 'f_bs') },
        { label: 'NIF  gain $G$', ref: 1.54, refText: '1.54', v0D: okRun(ctx, 'NIF')?.report?.Q_sci_max },
      ];
      const tbl = rows.map((r) => `| ${plainLabel(r.label)} | ${r.refText} | ${r.v0D !== undefined ? (r.v0D / r.ref).toFixed(2) : '—'} | ${r.v15D !== undefined ? (r.v15D / r.ref).toFixed(2) : '—'} |`).join('\n');
      return {
        fig: figValidation(rows),
        caption: 'Ratio of simulated to published values for the 0D (open circles) and 1.5D (filled squares) models; shaded bands ±30% and ×2. Flat-top quantities are averages over the last 30% of the discharge. References: ITER Q = 10 baseline (Shimada et al. 2007), JET DTE2 59 MJ (Maslov et al. 2023), SPARC V2 (Creely et al. 2020), EU DEMO (Siccinio et al. 2020), NIF N221204 (Abu-Shawareb et al. 2024). The 1.5D JET yield exceeds the record by ~40%: beam–target reactions from the three-component NBI (~60% of the yield, as in TRANSP analyses) are sensitive to the fast-ion slowing-down model.\n\n| quantity | reference | 0D ratio | 1.5D ratio |\n|---|---|---|---|\n' + tbl,
      };
    },
  },
  {
    id: 'lawson', title: 'Fusion reactivity and Lawson diagram', number: 6, file: 'fig06_reactivity_lawson', needs: ['iter15', 'presets'],
    inputs: () => ({ config: { iter15: iter15Input, presets: presetsInput() }, seeds: { ITER_15D: ITER_15D.seed, ...presetSeeds() } }),
    build: (ctx) => {
      const pt = (avg?: Record<string, number>) => (avg && avg.Ti > 0 && avg.triple > 0 ? { T: avg.Ti, ntau: avg.triple / avg.Ti } : undefined);
      const machines: LawsonMachine[] = [
        { label: 'ITER', color: C.blue, p0: pt(okRun(ctx, 'ITER')?.avg), p15: pt(ctx.iter?.avg), pos: 'above' },
        { label: 'JET', color: C.green, p0: pt(okRun(ctx, 'JET')?.avg), p15: pt(okRun(ctx, 'JET15')?.avg), pos: 'right' },
        { label: 'SPARC', color: C.purple, p0: pt(okRun(ctx, 'SPARC')?.avg), p15: pt(okRun(ctx, 'SPARC15')?.avg), pos: 'below' },
        { label: 'DEMO', color: C.vermilion, p0: pt(okRun(ctx, 'DEMO')?.avg), p15: pt(okRun(ctx, 'DEMO15')?.avg), pos: 'right' },
      ];
      return {
        fig: figReactivityLawson(machines),
        caption: '(a) Maxwell-averaged reactivities: Bosch & Hale (1992) parametrisations plotted only within their stated validity ranges; p–¹¹B from numerical Maxwellian averaging of the Nevins & Swain (2000) cross-section. (b) Lawson diagram for D–T: n τ_E required for Q = 1, Q = 10 and ignition from the 0D power balance with flat profiles, Z_eff = 1 and bremsstrahlung losses; points, flat-top volume-averaged operating points of the simulated devices (open: 0D, filled: 1.5D).',
      };
    },
  },
  {
    id: 'verification', title: 'Numerical verification', number: 7, file: 'fig07_verification', needs: ['verification'],
    inputs: () => ({ config: { verification: 'computeVerification (GS vs Solovev, FV heat solver, backward Euler, DP5 work-precision)' }, seeds: {} }),
    build: (ctx) => {
      const v = ctx.verification ?? computeVerification();
      return {
        fig: figVerification(v),
        caption: `Code verification. (a) Grad–Shafranov solver against the exact Solov'ev solution: observed order ${slope(v.gs.h, v.gs.err).toFixed(2)} (expected 2). (b) Finite-volume heat solver, steady diffusion with uniform source in a cylinder: order ${slope(v.space.dr, v.space.err).toFixed(2)}. (c) Backward-Euler time stepping, decay of the J_0(j_01 ρ) eigenmode (self-convergence): order ${slope(v.time.dt, v.time.err).toFixed(2)} (expected 1). (d) Work–precision diagram for a 0D D–T burn-dynamics problem (α heating, power-degraded τ_E, bremsstrahlung, modulated fuelling): the adaptive Dormand–Prince RK5(4) integrator used by the 0D models reaches a given accuracy with far fewer right-hand-side evaluations than fixed-step RK4 or explicit Euler.`,
      };
    },
  },
  {
    id: 'mhd', title: 'MHD events', number: 8, file: 'fig08_mhd', needs: ['iter15'],
    inputs: () => ({ config: { iter15: iter15Input }, seeds: { ITER_15D: ITER_15D.seed } }),
    build: (ctx) => {
      const iter = need(ctx.iter);
      return {
        fig: figMHD({ saw: iter.saw, elm: iter.elm, zoom: iter.zoom, hist: iter.sim.history, events: iter.sim.events }),
        caption: `MHD events in the ITER 1.5D discharge. (a) Sawtooth crash at t = ${iter.saw?.t.toFixed(1) ?? '—'} s (trigger: shear at q = 1 above s_crit = ${iter.model.ps.sawtoothShear}): T_e flattened inside the Kadomtsev mixing radius with conservation of the energy content, q raised to ≥ 1. (b) Type-I ELM at t = ${iter.elm?.t.toFixed(2) ?? '—'} s triggered by the pedestal pressure gradient exceeding the ballooning limit α_crit. (c) ELM cycle sampled every 2 ms (${iter.zoom.elm.length} ELMs in 1.5 s). (d) Neoclassical tearing mode island widths from the modified Rutherford equation (seeded by sawteeth, ticks) and β_N.`,
      };
    },
  },
  {
    id: 'scan', title: 'Operating-space scan', number: 9, file: 'fig09_scan', needs: ['scan'],
    inputs: (p) => ({ config: { scan: { base: ITER, N: p.scan, nOverNG: [0.5, 1.0], nBasis: 'line-averaged', H98: [0.7, 1.3], t_end: SCAN_T_END } }, seeds: { ITER: ITER.seed } }),
    build: (ctx) => {
      const NS = ctx.params.scan;
      const { sx, sy } = scanAxes(NS);
      const Q: number[] = [], Pf: number[] = [];
      let nBad = 0;
      for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
        const r = okRun(ctx, `scan:${i}:${j}`);
        const aborted = !r || r.report!.termination.natural === false;
        if (aborted) nBad++;
        Q.push(aborted ? NaN : r!.avg!.Q); Pf.push(aborted ? NaN : r!.avg!.P_fus);
      }
      return {
        fig: figScan({ x: sx, y: sy, Q, Pfus: Pf, ref: { x: scanBaselineX(), y: ITER.H98, label: 'ITER baseline' }, label: `ITER 0D scan (${NS}×${NS} runs)` }),
        caption: `Operating-space scan of the ITER 0D model: flat-top Q as a function of the confinement enhancement H98 and the line-averaged density n̄_e normalised to the Greenwald density n_G (${NS}×${NS} = ${NS * NS} independent ${SCAN_T_END} s discharges run in parallel on worker threads${nBad ? `; ${nBad} discharges that ended early (disruption, density limit or radiative collapse) are left blank` : ''}). Contours: Q = 5, 10, 15 (P_aux = 50 MW is fixed, so P_fus = 50 MW × Q); diamond: ITER baseline. Residual structure at high H98 reflects stochastic MHD events (NTM triggering) inside the averaging window.`,
      };
    },
  },
];

export const PAPER_FIGURE_IDS = PAPER_FIGURES.map((s) => s.id);
