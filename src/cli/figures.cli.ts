/// <reference types="node" />
/**
 * Makale figürleri — `npm run figures` (tsx).
 *
 * ITER 1.5D atışı ana iş parçacığında (MHD çöküş anlık görüntüleri + yüksek örnekleme hızlı ELM
 * penceresi ile) koşar; doğrulama presetleri ve 0D parametre taraması aynı anda worker_threads
 * havuzunda paralel koşar. Çıktı: docs/figures/*.svg + *.pdf + captions.md (toplam ~1–2 MB;
 * ham veri diske yazılmaz).
 *   --out DIR       çıktı klasörü (varsayılan docs/figures)
 *   --only a,b      yalnız bu figürler: equilibrium, profiles, timetraces, popcon, validation,
 *                   lawson, verification, mhd, scan
 *   --threads N     işçi sayısı (varsayılan: çekirdek − 1)
 *   --scan N        tarama ızgarası N×N (varsayılan 11)
 *   --formats f     svg,pdf (varsayılan ikisi de)
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Simulation } from '../physics/simulation';
import { flatTopAverages } from '../physics/analysis/flatTop';
import { DEMO, DEMO_15D, ITER, ITER_15D, JET, JET_15D, NIF, SPARC, SPARC_15D } from '../physics/presets';
import { ProfileModel } from '../physics/profiles/model';
import { MagneticConfig, ReactorConfig, ShotReport } from '../physics/types';
import { Figure } from '../plot/figure';
import { C, profileFrame } from '../plot/figures/common';
import { figEquilibrium } from '../plot/figures/equilibrium';
import { figProfiles } from '../plot/figures/profiles';
import { figTimeTraces } from '../plot/figures/timetrace';
import { figPopcon } from '../plot/figures/popcon';
import { ValidationRow, figValidation } from '../plot/figures/validation';
import { LawsonMachine, figReactivityLawson } from '../plot/figures/reactivity';
import { computeVerification, figVerification, slope } from '../plot/figures/verification';
import { CrashRecord, ElmZoom, figMHD } from '../plot/figures/mhd';
import { figScan } from '../plot/figures/scan';
import { defaultThreads, runPool } from './pool';
import { defineCli, parseArgsOrExit } from './args';
import type { RunResult, RunTask } from './presetRunner.worker';

const ALL = ['equilibrium', 'profiles', 'timetraces', 'popcon', 'validation', 'lawson', 'verification', 'mhd', 'scan'] as const;
type FigId = (typeof ALL)[number];

const CLI = defineCli({
  name: 'npm run figures --',
  summary: 'Generates the paper figures (SVG + PDF) and captions.md from the ITER 1.5D shot and pooled validation/scan runs.',
  flags: {
    out: { type: 'string', default: 'docs/figures', metavar: 'DIR', help: 'output folder' },
    only: { type: 'list', choices: ALL, metavar: 'FIG,…', help: 'only these figures' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores − 1)' },
    scan: { type: 'int', default: 11, min: 3, max: 101, help: 'scan grid size N (N×N runs)' },
    formats: { type: 'list', default: ['svg', 'pdf'], choices: ['svg', 'pdf'], help: 'output formats' },
  },
});
const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d, { level: 9 }));
const tick = () => new Promise<void>((r) => setImmediate(r));
/** mathtext etiketi → düz metin (markdown tablosu için) */
const plain = (s: string) => s.replace(/\$/g, '').replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\\beta/g, 'β').replace(/\\ell/g, 'ℓ').replace(/_\{([^}]*)\}/g, '_$1').replace(/[{}]/g, '');
const figNo = (c: string) => parseInt(/Fig\. (\d+)/.exec(c)?.[1] ?? '99', 10);

interface MainRun { sim: Simulation; model: ProfileModel; report: ShotReport; avg: Record<string, number>; saw?: CrashRecord; elm?: CrashRecord; zoom: ElmZoom; ms: number }

/** ITER 1.5D: çöküş kancaları + t0 = 0.75·t_son'da 1.5 s'lik 2 ms örneklemeli pencere */
async function runIter15(): Promise<MainRun> {
  const t0 = performance.now();
  const tEnd = ITER_15D.t_end; // = ProfileModel.tEnd
  const tz = 0.75 * tEnd, dz = 1.5, dtz = 0.002;
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
    if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ITER15 ${pct}%\r`); }
    await tick(); // havuz işçilerini beslemek için olay döngüsüne dön
  }
  model.crashHook = null;
  process.stdout.write('\n');
  return { sim, model, report: sim.report(), avg: flatTopAverages(sim.history), saw, elm, zoom, ms: performance.now() - t0 };
}

function save(fig: Figure, name: string, out: string, formats: string[], written: string[]): void {
  if (formats.includes('svg')) { const p = resolve(out, `${name}.svg`); writeFileSync(p, fig.toSVG({ deflate })); written.push(p); }
  if (formats.includes('pdf')) { const p = resolve(out, `${name}.pdf`); writeFileSync(p, fig.toPDF({ deflate })); written.push(p); }
}

async function main() {
  const args = parseArgsOrExit(CLI);
  const out = resolve(args.out);
  const only = (args.only as FigId[] | undefined) ?? [...ALL];
  const want = (f: FigId) => only.includes(f);
  const threads = args.threads ?? defaultThreads();
  const NS = args.scan;
  const formats = args.formats;
  mkdirSync(out, { recursive: true });
  const T0 = performance.now();

  // ---- havuz görevleri (arka planda)
  const tasks: RunTask[] = [];
  if (want('validation') || want('lawson')) {
    const list: [string, ReactorConfig][] = [['ITER', ITER], ['JET', JET], ['SPARC', SPARC], ['DEMO', DEMO], ['NIF', NIF], ['JET15', JET_15D], ['SPARC15', SPARC_15D], ['DEMO15', DEMO_15D]];
    for (const [id, cfg] of list) tasks.push({ id, cfg });
  }
  const nGfr = ITER.Ip_MA / (Math.PI * ITER.geometry.a ** 2); // 10²⁰ m⁻³
  const sx = Array.from({ length: NS }, (_, i) => 0.5 + (0.5 * i) / (NS - 1)); // n/n_G 0.5…1.0
  const sy = Array.from({ length: NS }, (_, j) => 0.7 + (0.6 * j) / (NS - 1)); // H98 0.7…1.3
  if (want('scan')) {
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
      const cfg: MagneticConfig = { ...ITER, H98: sy[j], n_target: sx[i] * nGfr * 1e20, t_end: 150 };
      tasks.push({ id: `scan:${i}:${j}`, cfg });
    }
  }
  // uzun görevler önce
  const weight = (t: RunTask) => ((t.cfg as MagneticConfig).fidelity === '1.5D' ? 100 : 1) * ((t.cfg as { t_end?: number }).t_end ?? 1);
  tasks.sort((a, b) => weight(b) - weight(a));
  let nDone = 0;
  const poolP = tasks.length
    ? runPool<RunTask, RunResult>(tasks, new URL('./presetRunner.worker.ts', import.meta.url), threads, () => { nDone++; })
    : Promise.resolve([] as RunResult[]);
  console.log(`Figures → ${out}\n  ${tasks.length} background runs on ${Math.min(threads, tasks.length)} worker threads`);

  // ---- ana iş parçacığı: ITER 1.5D
  const needIter = (['equilibrium', 'profiles', 'timetraces', 'popcon', 'mhd', 'validation', 'lawson'] as FigId[]).some(want);
  const iter = needIter ? await runIter15() : null;
  if (iter) console.log(`  ITER15 done in ${(iter.ms / 1000).toFixed(1)} s (${iter.sim.nSteps} steps, ${iter.model.eqUpdates} GS updates); background ${nDone}/${tasks.length}`);

  const written: string[] = [];
  const captions: string[] = [];
  const cap = (id: string, text: string) => captions.push(`**${id}.** ${text}`);

  if (iter) {
    const { sim, model, avg } = iter;
    const hist = sim.history, events = sim.events;
    const last = profileFrame(hist)!;
    if (want('equilibrium')) {
      save(figEquilibrium({ eq: model.eq, rho: last.prof!.rho, Te: last.prof!.Te, label: `ITER 1.5D, t = ${last.t.toFixed(0)} s` }), 'fig01_equilibrium', out, formats, written);
      cap('Fig. 1 (fig01_equilibrium)', `Magnetic equilibrium. (a) Fixed-boundary Grad–Shafranov solution of the ITER 1.5D discharge at t = ${last.t.toFixed(0)} s (${model.eq.grid.NR}×${model.eq.grid.NZ} grid, Shortley–Weller boundary treatment) coloured by T_e; white: flux surfaces at ρ_tor = 0.2, 0.4, 0.6, 0.8, black: LCFS, +: magnetic axis (Shafranov shift ${(model.eq.shafranovShift * 100).toFixed(0)} cm). (b) Cerfon–Freidberg analytic single-null Solov'ev equilibrium (ε = 0.32, κ = 1.7, δ = 0.33) with separatrix, X-point and scrape-off layer; used for verification (Fig. 7a). (c) Safety factor, magnetic shear and exact trapped-particle fraction from flux-surface averages; q95 = ${model.eq.q95.toFixed(2)}, ℓ_i(3) = ${model.eq.li3.toFixed(2)}, β_p = ${model.eq.betaP.toFixed(2)}.`);
    }
    if (want('profiles')) {
      save(figProfiles({ frame: last, pedestalWidth: model.ps.pedestalWidth, label: `ITER 1.5D baseline, t = ${last.t.toFixed(0)} s` }), 'fig02_profiles', out, formats, written);
      cap('Fig. 2 (fig02_profiles)', `Radial profiles of the ITER 1.5D discharge at t = ${last.t.toFixed(0)} s (flat top): (a) electron and ion temperatures (grey band: pedestal, width ${model.ps.pedestalWidth} in ρ_tor); (b) electron density and Z_eff; (c) safety factor and magnetic shear with the q = 1, 3/2, 2 rational surfaces; (d) parallel current density and its ohmic, bootstrap (Sauter) and driven components; (e) electron and ion heat diffusivities (τ_E-scaling-constrained, with neoclassical floor and edge transport barrier); (f) alpha, auxiliary, radiated and ohmic power densities.`);
    }
    if (want('timetraces')) {
      save(figTimeTraces(hist, events, 'ITER 1.5D baseline (15 MA / 5.3 T, 50 MW)'), 'fig03_timetraces', out, formats, written);
      const nElm = events.filter((e) => e.kind === 'ELM').length, nSaw = events.filter((e) => e.kind === 'sawtooth').length;
      cap('Fig. 3 (fig03_timetraces)', `Time evolution of the ITER 1.5D discharge: (a) fusion gain Q (P_fus = Q·P_aux with P_aux = 50 MW) and thermal stored energy; (b) power balance — alpha heating, auxiliary power, transport loss W/τ_E, radiation and ohmic power; (c) central and pedestal temperatures and line-averaged density; (d) q(0), internal inductance, bootstrap fraction and β_N. Dotted vertical line: L–H transition; dashed: NTM onset. Ticks: ${nElm} type-I ELMs (b) and ${nSaw} sawtooth crashes (c). Flat-top (last 30%) averages: Q = ${avg.Q.toFixed(1)}, P_fus = ${avg.P_fus.toFixed(0)} MW, f_bs = ${avg.f_bs.toFixed(2)}, ℓ_i = ${avg.li.toFixed(2)}, β_N = ${avg.betaN.toFixed(2)}.`);
    }
    if (want('popcon')) {
      const reg = hist.filter((h) => h.prof);
      save(figPopcon({ cfg: ITER_15D, traj: { n: reg.map((h) => h.d.ne), T: reg.map((h) => 0.5 * (h.d.Te + h.d.Ti)) }, label: 'ITER (IPB98(y,2), $H_{98}$ = 1)' }), 'fig04_popcon', out, formats, written);
      cap('Fig. 4 (fig04_popcon)', 'Plasma operation contour (POPCON) for ITER from a 0D steady-state power balance using the same physics as the 0D model: fuel dilution by Be, Ar seed and self-consistent He ash, bremsstrahlung, Mavrin line and Albajar synchrotron radiation, IPB98(y,2) confinement (H98 = 1) evaluated at P_loss = P_heat − P_rad, parabolic profiles (α_n = 0.3, α_T = 1.5) and T_i = T_e. Colour, fusion gain Q; white lines, required auxiliary power; black dashed, Q = 5 and 10; red dashed, β_N limit; blue dotted, L–H threshold (Martin 2008); dash-dotted, Greenwald density. No ignited region exists for these assumptions. Red: volume-averaged trajectory of the 1.5D discharge (open circle: final state).');
    }
    if (want('mhd')) {
      save(figMHD({ saw: iter.saw, elm: iter.elm, zoom: iter.zoom, hist, events }), 'fig08_mhd', out, formats, written);
      cap('Fig. 8 (fig08_mhd)', `MHD events in the ITER 1.5D discharge. (a) Sawtooth crash at t = ${iter.saw?.t.toFixed(1) ?? '—'} s (trigger: shear at q = 1 above s_crit = ${model.ps.sawtoothShear}): T_e flattened inside the Kadomtsev mixing radius with conservation of the energy content, q raised to ≥ 1. (b) Type-I ELM at t = ${iter.elm?.t.toFixed(2) ?? '—'} s triggered by the pedestal pressure gradient exceeding the ballooning limit α_crit. (c) ELM cycle sampled every 2 ms (${iter.zoom.elm.length} ELMs in 1.5 s). (d) Neoclassical tearing mode island widths from the modified Rutherford equation (seeded by sawteeth, ticks) and β_N.`);
    }
  }

  if (want('verification')) {
    const t1 = performance.now();
    const v = computeVerification();
    save(figVerification(v), 'fig07_verification', out, formats, written);
    console.log(`  verification data in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
    cap('Fig. 7 (fig07_verification)', `Code verification. (a) Grad–Shafranov solver against the exact Solov'ev solution: observed order ${slope(v.gs.h, v.gs.err).toFixed(2)} (expected 2). (b) Finite-volume heat solver, steady diffusion with uniform source in a cylinder: order ${slope(v.space.dr, v.space.err).toFixed(2)}. (c) Backward-Euler time stepping, decay of the J_0(j_01 ρ) eigenmode (self-convergence): order ${slope(v.time.dt, v.time.err).toFixed(2)} (expected 1). (d) Work–precision diagram for a 0D D–T burn-dynamics problem (α heating, power-degraded τ_E, bremsstrahlung, modulated fuelling): the adaptive Dormand–Prince RK5(4) integrator used by the 0D models reaches a given accuracy with far fewer right-hand-side evaluations than fixed-step RK4 or explicit Euler.`);
  }

  // ---- havuz sonuçları
  const res = await poolP;
  const by = new Map(res.map((r) => [r.id, r]));
  const ok = (id: string) => { const r = by.get(id); return r && r.ok && r.report && r.avg ? r : null; };
  for (const r of res) if (!r.ok) console.log(`  WARN run ${r.id} failed: ${r.error?.split('\n')[0]}`);

  if (want('validation') && iter) {
    const A = (id: string, k: string) => ok(id)?.avg?.[k];
    const E = (id: string) => ok(id)?.report?.E_fusion_MJ;
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
      { label: 'NIF  gain $G$', ref: 1.54, refText: '1.54', v0D: ok('NIF')?.report?.Q_sci_max },
    ];
    save(figValidation(rows), 'fig05_validation', out, formats, written);
    const tbl = rows.map((r) => `| ${plain(r.label)} | ${r.refText} | ${r.v0D !== undefined ? (r.v0D / r.ref).toFixed(2) : '—'} | ${r.v15D !== undefined ? (r.v15D / r.ref).toFixed(2) : '—'} |`).join('\n');
    cap('Fig. 5 (fig05_validation)', 'Ratio of simulated to published values for the 0D (open circles) and 1.5D (filled squares) models; shaded bands ±30% and ×2. Flat-top quantities are averages over the last 30% of the discharge. References: ITER Q = 10 baseline (Shimada et al. 2007), JET DTE2 59 MJ (Maslov et al. 2023), SPARC V2 (Creely et al. 2020), EU DEMO (Siccinio et al. 2020), NIF N221204 (Abu-Shawareb et al. 2024). The 1.5D JET yield exceeds the record by ~40%: beam–target reactions from the three-component NBI (~60% of the yield, as in TRANSP analyses) are sensitive to the fast-ion slowing-down model.\n\n| quantity | reference | 0D ratio | 1.5D ratio |\n|---|---|---|---|\n' + tbl);
  }

  if (want('lawson')) {
    const pt = (avg?: Record<string, number>) => (avg && avg.Ti > 0 && avg.triple > 0 ? { T: avg.Ti, ntau: avg.triple / avg.Ti } : undefined);
    const machines: LawsonMachine[] = [
      { label: 'ITER', color: C.blue, p0: pt(ok('ITER')?.avg), p15: pt(iter?.avg), pos: 'above' },
      { label: 'JET', color: C.green, p0: pt(ok('JET')?.avg), p15: pt(ok('JET15')?.avg), pos: 'right' },
      { label: 'SPARC', color: C.purple, p0: pt(ok('SPARC')?.avg), p15: pt(ok('SPARC15')?.avg), pos: 'below' },
      { label: 'DEMO', color: C.vermilion, p0: pt(ok('DEMO')?.avg), p15: pt(ok('DEMO15')?.avg), pos: 'right' },
    ];
    save(figReactivityLawson(machines), 'fig06_reactivity_lawson', out, formats, written);
    cap('Fig. 6 (fig06_reactivity_lawson)', '(a) Maxwell-averaged reactivities: Bosch & Hale (1992) parametrisations plotted only within their stated validity ranges; p–¹¹B from numerical Maxwellian averaging of the Nevins & Swain (2000) cross-section. (b) Lawson diagram for D–T: n τ_E required for Q = 1, Q = 10 and ignition from the 0D power balance with flat profiles, Z_eff = 1 and bremsstrahlung losses; points, flat-top volume-averaged operating points of the simulated devices (open: 0D, filled: 1.5D).');
  }

  if (want('scan')) {
    const Q: number[] = [], Pf: number[] = [];
    let nBad = 0;
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) {
      const r = ok(`scan:${i}:${j}`);
      const aborted = !r || r.report!.termination.natural === false;
      if (aborted) nBad++;
      Q.push(aborted ? NaN : r!.avg!.Q); Pf.push(aborted ? NaN : r!.avg!.P_fus);
    }
    save(figScan({ x: sx, y: sy, Q, Pfus: Pf, ref: { x: ITER.n_target / (nGfr * 1e20), y: ITER.H98, label: 'ITER baseline' }, label: `ITER 0D scan (${NS}×${NS} runs)` }), 'fig09_scan', out, formats, written);
    cap('Fig. 9 (fig09_scan)', `Operating-space scan of the ITER 0D model: flat-top Q as a function of the confinement enhancement H98 and the density target normalised to the Greenwald density (${NS}×${NS} = ${NS * NS} independent 150 s discharges run in parallel on worker threads${nBad ? `; ${nBad} discharges terminated early by a disruption are left blank` : ''}). Contours: Q = 5, 10, 15 (P_aux = 50 MW is fixed, so P_fus = 50 MW × Q); diamond: ITER baseline. Residual structure at high H98 reflects stochastic MHD events (NTM triggering) inside the averaging window.`);
  }

  writeFileSync(resolve(out, 'captions.md'), `# Figure captions\n\nGenerated by \`npm run figures\` (fusion-reactor-simulator). Vector figures: SVG (web) and PDF 1.4 (standard Type 1 fonts Times/Symbol; to embed fonts for journal submission run e.g. \`gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dEmbedAllFonts=true -dSubsetFonts=true -sOutputFile=out.pdf in.pdf\`).\n\n${captions.sort((a, b) => figNo(a) - figNo(b)).join('\n\n')}\n`);
  let bytes = 0;
  for (const p of written) bytes += statSync(p).size;
  console.log(`  wrote ${written.length} files (${(bytes / 1024).toFixed(0)} KiB) + captions.md in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
