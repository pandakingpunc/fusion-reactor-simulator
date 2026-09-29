# v4.0 Wave-2A gate report

Gate run on 2026-09-29 in the main checkout, branch `v4/integration`, starting at `f8d39cc` (all fourteen Wave-2A
lanes merged: ws9b, ws10a, ws10w, ws10d, ws7c, ws8, ws10b, ws2c, ws7a, ws5s, ws7b, ws4i, ws10e, ws3s; none left
out). The baseline for every "before" number is `b059097`, the end of Wave 1 (`docs/v4-wave1-report.md`); the
golden files at that commit are the "before" column of section 5. The gate's own commits are listed in section 8.
Nothing was pushed, tagged or released; `docs/figures` and `.wt/` were not touched.

Between `b059097` and the start of the gate: 245 commits (14 merge commits and 231 others: 165 on the lane
branches, 66 integrator commits of merge fixes, follow-ups, golden re-records and changelog lines), 482 files,
+63,960 / -6,658 lines (`src/physics` +18.9k, `src/ui` +14.5k, `src/analysis` +6.6k, `src/cli` +3.4k, `src/io`
+3.3k, `src/plot` +2.5k, `src/edu` +1.9k, the JSON Schema +1.9k, `test/golden` +7.7k / -5.3k). Tests grew from 944 in 94
files (Wave-1 gate) to 3018 in 221.

## 0. Verdict

**The Wave-2A gate passes, with two targets not met (the pause latency of the simulation worker and the chunk budget of the sum).**
`npm run ci:local` is green (tsc, config schema up to date, 3018 tests in 221
files, 42 literature checks with 0 unexpected failures, 30/30 golden cases at 1e-9), and so are the build, the
coverage gate, the strict type-check ratchet, the mutation smoke test (15/15) and the missions script (10/10).
`release:check` fails the one expected check (the author-identity `TODO` in `CITATION.cff:15`, an owner item).
Every measured Wave-2 verification target is met (section 2) except two (the chunk budget of the sum and the pause latency of the
simulation worker, below): the 1.5D convergence targets (ITER15 Q, f_bs, l_i and
T_ped move by at most 0.57 % between 50 and 100 cells and 0.10 % between the tolerances 1e-3 and 1e-4; the ELM count by
at most 0.45 % across the time-step limits; the `cgm` ITER15 ramp-up runs in 3.5 s), the G-EQDSK round trip and the
outer-face metrics (0.006 % against a 401-surface table, was 5.9 %), scenario determinism (chunking and rewind,
bitwise), the edge, systems and UQ checks, and a plain-Node consumer of the built library (ESM and CJS) that
reproduces the golden values exactly. The gate found no failing check in the merged tree; it fixed one carried-over
inconsistency (the 1.5D boundary did not follow an edited kappa/delta, section 8), re-recorded the performance
baseline on the idle machine and corrected one README line.

Four things to know before Wave 2B, none of them a gate failure:

- **The 1.5D model is 2 to 3 times slower.** The TR-BDF2 solver with error control and event localisation takes 1.1
  to 3.4 times the steps at about 3 times the work per step: ITER15 (400 s) 8.9 s -> 23.8 s, DEMO15 62.7 s -> 139.5 s
  on the idle machine (section 1). `ci:local` went from 139 s to 465 s, the validation step from 41 s to 185 s. It
  buys the convergence of section 6 (T_ped at 25 / 50 / 100 cells: 5.12 / 3.74 / 3.61 keV in Wave 1, 3.56 / 3.49 / 3.47 keV
  now).
- **The main chunk is 262.46 kB, +17.54 kB (+7.2 %) over Wave 1.** Each UI lane kept its own +5 kB budget
  (largest: ws10w +4.93, ws10b +4.86 kB), the sum did not. Lazy chunks carry the rest of the new UI (section 1).
  Later lanes must lazy-load what they add.
- **The pause latency of the simulation worker is over its target again (ws10a x ws4i/ws3s).** ws10a measured p99 47-51 ms at 30x and 100x
  (target < 60 ms); at the gate it is 71 / 84 ms (ITER15 30x / 100x) and 100 / 126 ms (DEMO15), with 100-129 ms as the longest single
  kernel task (a step that carries a Grad-Shafranov update with the ws4i outer iteration and the ws3s step). The worker slices between
  steps, not inside one. Wave 2B (section 9).
- **Docs and figures still carry v3 or Wave-1 numbers** (README validation table, `docs/technical-report.md`,
  `docs/figures`, no `figures.manifest.json`): Wave 3.

## 1. Verification commands and results

All on Windows 11, Node v24.19.0, 12 cores (AMD Ryzen 5 5600), run one after the other on an otherwise idle machine.
The table is the first pass at `f8d39cc`; the checks after the gate's own commits are at the end of section 8.

| Command | Exit | Time | Result |
|---|---|---|---|
| `npm run -s ci:local` | 0 | 465 s | type check ok (8.0 s); config schema up to date (0.6 s); vitest **221 files / 3018 tests passed** (230 s, unlimited workers, no timeout, no red); validation **36 passed, 6 known failures, 0 unexpected** (185 s, `--threads 4`); golden "all 30 cases match" (41 s wall) |
| `npm run -s build` | 0 | 11 s | `tsc --noEmit` + `vite build`, 272 modules; main chunk **262.46 kB (88.08 kB gzip)** (table below) |
| `npm run -s coverage` | 0 | 492 s | 3018/3018 tests; every gated threshold met; all files **97.7 %** lines / 93.7 % functions / 93.2 % branches (Wave 1: 90.1 / 86.7 / 89.6) |
| `npm run -s typecheck:strict` | 0 | 8 s | 39 errors in 27 files = baseline 39 in 27 (lowered from 42 in 30 during the merges); no file above its baseline |
| `npm run -s validate -- --threads 4 --markdown` | 0 | 184 s | 36 of 42 checks within the accepted range, 6 documented known failures, 0 unexpected (section 7) |
| `npm run -s mutation-smoke` | 0 | 45 s | baseline passes (8 files, 6.3 s); **15/15 mutants killed** (M1-M15, unchanged set) |
| `npm run bench:convergence -- --threads 3` | 0 | 145 s | ITER15 at three grids, tolerances and step limits (section 6) |
| `npm run -s release:check` | **1** | 1 s | 7 of 8 pass (version, unreleased, date-released, citation-doi, readme-presets = 21, engines-node, license); **fails `no-todo`**: `CITATION.cff:15` (owner) |
| `npm run -s figures:check` (extra) | 2 | 1 s | `no figures.manifest.json in docs/figures`: as in Wave 1, regenerated once in Wave 3 |
| `bench/pause-latency.ts` `--mode thread` and `--mode tasks` (extra) | 0 | 28 s + 26 s | wait of a pause request p99 71 to 126 ms at 30x and 100x (target < 60 ms: not met, section 2) |
| `npm run -s missions` (extra) | 0 | 13 s | 10/10 missions solvable and not trivial (start fails, negative control fails, solution passes) |
| `npm run bench:perf -- --update` (extra) | 0 | 510 s | baseline re-recorded on the idle machine (below) |
| `build:lib` + plain-Node consumer (extra) | 0 | 6 s + 4 s | ESM and CJS import by package name, golden values reproduced exactly (section 2) |

The intermittent Windows exit code 3221225477 (0xC0000005) of a spawned CLI did not occur in the `ci:local` run, the
coverage run (each includes the spawned-CLI suites, the 16-run exit stress test and the library-build consumer test) or
the extra runs. Its cause is still unknown.

**Run time against the Wave-1 gate.** `ci:local` 139 -> 465 s (vitest 77 -> 230 s, validation 41 -> 185 s, golden 14 ->
41 s), coverage 198 -> 492 s, build 6 -> 11 s, mutation smoke 42 -> 45 s. **Performance baseline** (`bench/perf-baseline.json`,
medians of three runs, idle machine, seconds; the old file was recorded under load): ITER 4.13 -> 2.00, JET 0.47 -> 0.22, ITER15
8.88 -> 23.76 (x2.7), JET15 6.09 -> 4.11, DEMO15 62.7 -> 139.5 (x2.2), NIF 0.01 -> 0.00. The convergence bench measures ITER15
(400 s) at 34 s with three runs in parallel.

**Chunk sizes** (from the build output; Wave-1 values where the chunk existed):

| Chunk | Size (gzip) | Wave 1 | Note |
|---|---|---|---|
| `index-*.js` (main) | **262.46 kB (88.08)** | 244.92 (82.61) | +17.54 kB: ws9b + ws10a +1.99, ws10w +4.93, ws10d +1.71, ws10b +4.86, ws2c +1.18, ws7a +1.44, ws10e +1.33, ws3s +0.10, the other lanes 0 |
| `sim.worker` | 267.25 | 190.48 | +76.8 kB: scenario engine, edge model, systems models, TR-BDF2 and Newton solvers, surface-table outer iteration, shapes |
| `replay.worker` | 263.94 | (new, ws10b) | verified import of run files |
| `popcon.worker` | 24.27 | (new, ws10a) | off-thread POPCON |
| `exportFigures` | 85.01 (35.64) | 72.01 (28.30) | ws9b figure builders and multi-page PDF |
| `LearnView` | 40.75 (16.15) | (new, ws10e) | missions, glossary, mission view, progress; loaded with the Learn tab |
| `Viz3D` | 30.63 (11.93) | (new, ws10d) | raw WebGL2 view, first Show |
| `tr` (Learn) / `edu` | 24.86 (9.18) / 23.63 (8.83) | (new, ws10e) | education dictionaries, Turkish and English |
| `Compare` | 14.95 (5.27) | 2.81 | Compare 2.0 (radar, overlay, config diff) |
| `PowerFlow` | 13.62 (5.04) | (new, ws10e) | Sankey of the power balance |
| `tr` (main dictionary) | 12.44 (5.51) | 7.30 | Turkish strings of the new UI |
| `Report` / `LibraryPanel` | 10.90 / 10.64 | 10.93 / (new) | |
| `Validation` (+ `validate`, `pool`) | 7.62 (+7.75, 3.36) | 5.99 | parallel validation on a browser worker pool |
| `PersistHost`, `usePersistT`, `persist.tr`, `codec`, `SharePanel`, `EmbedView`, `runRecord` | 6.75, 5.44, 5.44, 4.83, 3.34, 2.53, 7.80 | (new, ws10b) | share links, archive, embed |
| CSS `index`, `edu`, `deps` | 8.71 (2.47), 7.39 (1.85), 1.77 (0.67) | 8.64 (2.45) | |
| STIX Two fonts (4 files) | 395 / 396 / 424 / 1518 | same | fetched on demand by the figure export |

Runtime dependencies are still React and React DOM only.

**Coverage** (`npm run coverage`; line coverage per directory from `coverage-summary.json`; the gated globs and thresholds are in
`vite.config.ts`, every one met):

| Scope | Lines | Functions | Branches | Gate / Wave 1 |
|---|---|---|---|---|
| all files | 97.7 % | 93.7 % | 93.2 % | Wave 1: 90.1 / 86.7 / 89.6 |
| `src/physics/**` | 99.4 % | 96.9 % | 94.2 % | gate 98 / 94 / 92 (Wave 1: 98.8 / 94.7 / 92.8) |
| `physics/confinement/magnetic.ts` | 100 % | | | Wave 1: 99.1 % |
| `physics/profiles/**`, `equilibrium/**` | 99.8 %, 100 % | 98.9 %, 98.5 % | 94.2 %, 93.2 % | |
| `physics/edge/**`, `systems/**`, `config/**` | 100 %, 100 %, 100 % | 100 %, 100 %, 100 % | 98.4 %, 92.2 %, 97.6 % | new |
| `physics/kernel/**`, `numerics/**` | 94.3 %, 99.0 % | 95.7 %, 96.9 % | 93.3 %, 95.2 % | gate 97 / 90 / 91 for numerics |
| `src/plot/**` | 97.5 % | 96.3 % | 91.6 % | gate 70 / 72 / 85 (Wave 1: 71.1 / 73.2 / 85.3) |
| `src/cli/**` | 98.0 % | 94.3 % | 96.9 % | gate 95 / 89 / 93 |
| `src/analysis/**`, `src/io/**`, `src/edu/**` | 97.2 %, 99.9 %, 99.8 % | 98.9 %, 100 %, 96.3 % | 96.6 %, 93.8 %, 92.9 % | new, not gated |
| `src/ui/**` | 94.2 % | 85.3 % | 91.0 % | not gated (Wave 1: 78.9 %) |
| `src/ui/persist/**`, `ui/viz3d/**` | 96.3 %, 90.7 % | 82.3 %, 92.1 % | 86.9 %, 94.6 % | |
| `src/worker/**`, `src/i18n/**` | 99.4 %, 100 % | 100 %, 70.0 % | 90.3 %, 89.5 % | |

Weakest files with 40 or more lines: `ui/viz3d/Viz3D.tsx` 0 % (111 lines, WebGL component; the mesh, scene, camera and viewer modules under
it are tested with a mock GL context) and `ui/charts/ProfileChart.tsx` 24 %; `ui/report/**` 75 %. The figure builders that were 4-15 % in
Wave 1 are 96 % now (synthetic-data tests with pinned SVG and PDF hashes). Wave-1 gate thresholds could be raised at the release:
`src/plot/**` to about 95/95/90, `src/physics/**` to 99/96/93, `src/cli/**` to 97/93/95, and `src/io/**`, `src/analysis/**`, `src/edu/**` added
(ws4i asked for the `src/io/**` entry).

## 2. Wave-2 verification targets

Each row was measured by the gate on the merged tree (probe scripts and the benchmark, not only the lanes' own claims), and is
also a test in the suite. Probe outputs are quoted, the scripts are not committed.

| WS | Target | Measured at `f8d39cc` | Status |
|---|---|---|---|
| WS3 | ITER15 Q, f_bs, l_i, T_ped change by < 1 % between N = 50 and 100 | Q -0.20 %, f_bs +0.07 %, l_i +0.43 %, T_ped -0.57 % (N = 25 -> 50: +2.5, -1.2, +2.3, -1.9 %) | **Met** |
| WS3 | the same between rtol 1e-3 and 1e-4 | Q +0.10 %, f_bs +0.08 %, l_i +0.03 %, T_ped -0.08 % (1e-2 -> 1e-4: +0.40, +0.26, -0.02, -0.05 %) | **Met** |
| WS3 | ELM count changes by < 2 % across the step limits | 1332 / 1332 / 1338 for dtMax 0.5 / 0.05 / 0.01 s (0.45 %); 1332 / 1334 / 1335 across the tolerances; 1317 / 1332 / 1338 across 25 / 50 / 100 cells (1.6 % at worst) | **Met** |
| WS3 | `cgm` ITER15 ramp-up (10 s) in < 10 s | 3.5 s wall (4.5 s CPU) with the default solver for a predictive model (Newton), 2.4 s with Picard; 30 % of the attempts failed before, 2 % now; Wave 1: 12-37 s | **Met** |
| WS4 | EQDSK round trip | ITER-shaped 15 MA equilibrium (NR 65) written COCOS 11, read without warning, imported without notes: R_axis equal to 6 digits, q95 +0.002 %, q(0) -0.0001 %, l_i(3) +0.0001 %, beta_p +0.003 %, volume -0.008 %, W_th 0 %; asymmetric shifted Miller shape (dZ = 0.1 m): axis moves 3.3e-9 m, q95 +0.002 %, volume -0.011 %; `fusion-sim export-eqdsk --preset ITER15 --t-end 20` from the built CLI writes an 84.9 kB file (COCOS 11) | **Met** |
| WS4 | outer-face metrics (g1, g2, V', q, rho_tor) of the default 101-node table against a 401-surface table | worst of faces N-3..N: ITER15 0.000 %, SPARC15 0.001 %, MASTU15 0.006 % (beta_p 0.1) and 0.003 % (0.8); the old 51-node table on the same MASTU15 case: 5.9 % (g1, g2, q) | **Met** (test bound 0.5 %) |
| WS4 | GS coupling: last equilibrium consistent with the transport | q95(GS) / q95(flat-top transport): ITER15 1.006, JET15 1.008, SPARC15 0.997, DEMO15 1.005, DIIID15 0.995, MASTU15 0.997 (Wave 1: 0.85 to 0.99); every GS update accepted in all nine cases (JET15 15/0/0, was 14/3/1; MASTU15 6/0/0, was 4/1/3) | **Met** |
| WS5 | scenario determinism | a gas puff + NBI drop + interlock scenario on ITER 0D (60 s), JET 0D (8 s) and SPARC15 (4 s): six random chunk schedules and three rewinds (25/50/75 %) each are bitwise equal to `runAll()` (SHA-256 digest of every frame and event, RNG accumulator taken modulo 2^32 as in the kernel test kit); the scenario changes the run; JSON round trip of the scenario gives the same run. 99 tests in the four kernel/scenario files pass | **Met** |
| WS7 | edge: two-point scaling | T_u ratio for doubling P_sep 1.21912, for doubling the connection length 1.21901; analytic 2^(2/7) = 1.21901 | **Met** |
| WS7 | edge: ITER q_peak | ITER 0D flat-top 26.4 MW/m2, ITER15 26.2 MW/m2 (attached, Eich #14 lambda_q 0.57 / 0.61 mm, T_t 283 / 249 eV, prescribed divertor radiation); the bare solver at P_sep = 100 MW without seeding gives 74 MW/m2 (2 mm broadened SOL: 21 MW/m2); Ar with the coronal Mavrin curve needs c_z = 1.94 %, above 1.1 times it the target is detached and q_peak is 0 | **Met**; caveat: the Ne test uses a synthetic cooling curve, the coronal fits do not reach below 100 eV |
| WS7 | systems: ITER TF Tresca | 489 MPa (limit 660; v3 thin-ring 82 MPa; the lane reproduces the PROCESS unit-test arrays to 1e-10 and the vertical force to 2e-9); DEMO 745 MPa (limit 660, thin 1.0 m leg: the same model gives 571 MPa for the 1.4 m PROCESS leg), SPARC 1024 MPa (limit 800) | **Met**; SPARC and DEMO carry a permanent warning (preset radial builds, open) |
| WS7 | UQ: Ishigami (N = 2^14, scrambled Sobol', 300 bootstraps) | S1 0.3139 (analytic 0.3139), S2 0.4424 (0.4424), S3 0.0000 (0); ST 0.5575 / 0.4424 / 0.2438 (0.5576 / 0.4424 / 0.2437); every analytic value inside its 95 % interval; variance 13.845 (13.845) | **Met** |
| WS7 | optimisation: Hock-Schittkowski #71 | f = 17.0140173 (f* 17.0140173), x = (1, 4.7429996, 3.8211500, 1.3794083) (x* 1, 4.7429994, 3.8211503, 1.3794082), violation 1.6e-8, 2616 evaluations | **Met** |
| WS8 | plain-Node consumer, ESM and CJS | `build:lib` writes `index.js/.cjs` (583 / 585 kB), `io.js/.cjs` (36 kB), the compiled worker and `fusion-sim.js`; the core bundles reference no window, document, node: or process. Installed as `node_modules/fusion-reactor-simulator`, `import` (ESM) and `require` (CJS) by package name and `/io`: 21 presets, `Q_sci_max` and `E_fusion` of JET, ITER, SPARC15 (3 s) and NIF (ESM) and of JET, NIF, W7X (CJS) equal the golden values exactly (`Q_sci_max` 0.4804970265926674, 12.154145139360375, 5.495872491491942, 1.4889417397896825); a scenario run writes a CSV; the compiled CLI runs `run`, `export-eqdsk`; 115 + 29 exports | **Met** |
| WS10 | chunk budget | main chunk 262.46 kB, +17.54 kB over Wave 1; each UI lane within its own +5 kB, the sum is not; the Learn tab, Compare, PowerFlow, Validation, 3D, persistence and figure export are lazy (section 1) | **Partly met** (budget of the sum not met; no enforced size check exists) |
| WS10 | missions | 10/10 solvable and not trivial (hmode, density, beta, kink, sparcQ, ignition, elm, fuel, nif, tungsten); the density mission needed a retune on the merged base (section 3, ws10e) | **Met** |
| WS10 | pause latency of the simulation worker, p99 < 60 ms (`bench/pause-latency.ts --mode thread`, 4 s per row) | wait of a request, p50 / p95 / p99 / max in ms: DEMO15 1x 0.3 / 5.8 / 5.9 / 5.9, 30x 3.5 / 84.8 / 100.4 / 100.4, 100x 8.5 / 96.4 / 125.8 / 125.8; ITER15 1x 1.8 / 5.7 / 5.9 / 5.9, 30x 5.4 / 57.7 / 71.0 / 71.0, 100x 5.5 / 60.9 / 84.2 / 84.2 (28 to 32 requests per row; ws10a at its merge: DEMO15 100x 48, ITER15 100x 50 ms at p99, before the lane 288 and 404 ms); task lengths of the loop (`--mode tasks`): p50 5.6 ms, p99 40 to 67 ms, longest 100 to 129 ms; no message after a pause | **Not met** at 30x and 100x (met at 1x): the longest task is a step with a Grad-Shafranov update, which the ws4i outer iteration made about twice as long as the 50-60 ms of the ws10a merge |

## 3. What each lane changed

Merged into `v4/integration` in this order (merge commit). The lane branches (`v4/ws*`) and `.wt/*` are untouched.

- **ws9b, plot engine (`9522321`, 10 commits).** Multi-page PDF with one embedded font subset per face
  (`toPDFDocument`, `figuresToPDF`), exact 256-entry viridis, magma, inferno, plasma and cividis tables, M4 min/max
  decimation of long histories, new figure builders (UQ violin and tornado, Pareto fronts, radius-time heat map
  `rhot`), builder tests with pinned SVG/PDF hashes (`src/plot/figures` coverage 4-15 % -> 96.5 %), the GS-update
  counters in the figure caption. Moves no golden number. Not done: `figures:check` in `ci:local` and any registry entry
  for the UQ/Pareto builders (Wave 3); the colormap tables were not re-compared with upstream matplotlib.
- **ws10a, POPCON performance (`161eb8e`, 7).** POPCON off the page thread in its own worker (16x16 preview, 44x44 at
  rest), temperature axis scaled to the device, trajectory, hover readout and click-to-steer, per-pixel min/max level of
  detail for time charts, time-sliced simulation worker (`bench/pause-latency.ts`: p99 wait of a pause request 288 ->
  48 ms for DEMO15 at 100x at the merge; 126 ms at the gate after ws4i and ws3s). No physics. Not done: POPCON is magnetic-only and read-only after the shot; the edge maps have no
  worker path.
- **ws10w, UI wiring (`9de1e6b`, 4).** KPI selection and a power-balance block, chart channels for the new 0D/1.5D
  diagnostics, wizard fields (stellarator H_ISS04, ICF driver/thermal efficiency, mirror plug potential), the a < R and
  R > 1.06 a cross-field checks (flipped the `a > R` pin), 'Numerical failure' and 'Equilibrium failure' end reasons in the
  interface language, rewind event count, locale before first paint. Not done: Explain popovers and PowerFlow are ready
  but not wired into Report and KPI labels; pre-existing wizard labels are still English only.
- **ws10d, 3D view (`66bc0fc`, 6).** Raw WebGL2 view of the flux surfaces, vessel, coils and a temperature-coloured
  cut-away, ELM flash and disruption animation, canvas-2D fallback, lazy chunk `Viz3D` 30.6 kB; boundary volume within 0.3 %
  of the equilibrium volume. Coils are schematic (a per-method default count); a stellarator is drawn axisymmetric.
- **ws7c, UQ and optimisation (`7f0f836`, 10).** `src/analysis`: scrambled Sobol' (Joe-Kuo, 256 dimensions), Monte Carlo and
  Latin hypercube samplers, distributions and priors (H98 lognormal from the IPB98(y,2) RMSE or the ITPA20-IL prediction
  uncertainty; density, impurity, He-ash and limit priors are tagged ASSUMPTION), Saltelli/Jansen Sobol' indices with
  bootstrap intervals, ensemble runner on the worker pool (byte-identical for a seed at any thread count), Nelder-Mead,
  augmented Lagrangian, CMA-ES and NSGA-II, the steady-state evaluator on the POPCON fixed point, `uq`, `scan`, `optimize`
  CLIs and npm scripts. Not done: not exported from the library entry (an API decision), no UI, the ITPA20 regression
  covariance is not in the open text (priors use the published prediction uncertainty), the CLIs cover the magnetic presets.
- **ws8, library, CLI, formats (`2cbe6e5`, 15).** Public barrel with `@public`/`@experimental` tags and a locked export
  list, runtime configuration validation with path-specific errors and a generated JSON Schema 2020-12
  (`schema/fusion-sim.schema.json`, `schema:check` in `ci:local`), `scripts/build-lib.mjs` (ESM + CJS, declarations, compiled
  preset-runner worker, no new dependency), the `fusion-sim` CLI (`run`, `scan`, `export-eqdsk`, `presets`, `schema`),
  CSV, NDJSON, NetCDF-3 and IMAS-like JSON writers with bitwise round trips, a Python subprocess wrapper, `package.json`
  `exports`, `bin`, `files`. Not done: the IMAS JSON is not validated against the official data dictionary; the analysis
  package and the G-EQDSK reader are not in the library entry.
- **ws10b, persistence and sharing (`3c7302a`, 12).** Hash router (`#/wizard`, `#/run`, `#/report`, `#/compare`,
  `#/validate`, `#/share/<code>`, `#/embed/...`), share links (deflate-raw + base64url, CRC-32, versioned, validated),
  IndexedDB archive of runs, run files with a verified import through a replay worker (bitwise fingerprint), embed views.
  Real-browser smoke of the production build at the merge. Not done: the sim worker does not report its actuator log,
  breakpoints and fingerprint, so a live run with interventions cannot be signed; exact-run links with a scenario.
- **ws2c, numbers hygiene (`cad8a2a`, 17).** Time-weighted flat-top means by default (frame weighting is an option),
  exact D-T energies (alpha 3.561, neutron 14.028 MeV), exact Miller volume, surface and cross-section (the ellipse
  formulas overestimated the volume by 3.6 to 14.3 %), ITER 0D `n_target` 0.914e20 (n/n_G 0.915 -> 0.837) and DEMO 0.711e20,
  MAST-U as the first-campaign scenario (R 0.8 m, a 0.5 m, kappa 2.1, 0.75 MA, 0.55 T: q95 18.2 -> 6.4, the known failure
  `MASTU.q95` passes), ITPA20 and ITPA20-IL selectable (0D, POPCON, 1.5D), the low-density L-H branch exponent 2, the
  LCFS shape of ITER and DEMO with `lcfsRef95`, four reference pins flipped, the CHANGELOG backfill of Wave 1. Moves 23 of
  30 golden cases (0D magnetic, through D-T energies and volumes) and 1.5D through flat-top weighting and the L-H branch.
- **ws7a, edge physics (`30fdd13`, 7).** `src/physics/edge`: Eich #14 lambda_q with Makowski spreading, Stangeby loss
  factors, two-point model, Lengyel c_z solve with the Mavrin curves, Kallenbach detachment states; ten channels in every
  tokamak frame (P_sep/R, lambda_q, T_u, T_t, q_peak, f_pwr, detach, cz_det, q_det, p_div) and five report rows; the 1.5D
  P_SOL is the ELM-inclusive balance (ITER15 110 -> 122 MW on the lane base, +10 %); opt-in `edgeModel: 'twoPoint'`
  (unvalidated, default `legacy`); POPCON edge maps opt-in; wizard fields. Adds 64 keys to each of 18 golden cases; the
  1.5D P_SOL moves.
- **ws5s, scenario engine (`0f61af3`, 7).** Scenarios as plain JSON: piecewise-linear and step waveforms exact at the
  corners, triggers on recorded frames (hold, after, once or repeat, hysteresis), templates (drop, ramp, gas puff,
  interlock), validation with paths, kernel integration (chunk-invariant, rewindable, replayable, in every checkpoint and
  in the fingerprint), `fusion-sim run --scenario`, and the fix that frames recorded at an L-H flip carry the diagnostics of
  their own state (moves history statistics of four 0D cases by at most 2.6e-2). Not done: the live app cannot run a
  scenario (the worker init message does not carry it, no editor); scan, uq and optimize have no `--scenario`.
- **ws7b, systems-lite (`b709e41`, 16).** `src/physics/systems`: PROCESS-style three-layer plane-stress analysis of the
  inboard TF leg (Tresca and von Mises; ITER 82 -> 489 MPa), CS flux swing, Slack cryoplant heat load and power, radial
  build, TBR from Shimwell (ITER 1.199 -> 1.125), recirculating power, the coil constraint of the optimiser. Moves only
  `scalars.engineering.*`, `Q_eng` and the warning count of 19 magnetic golden cases. Not done: preset pulse lengths and CS
  blocks (the CS flux margin is negative for every tokamak preset), the report keys are not translated.
- **ws4i, equilibrium (`9cba765`, 12).** 101-node edge-clustered flux-surface table (outer-face metrics 5.9 % -> 0.006 %),
  self-consistent Grad-Shafranov updates (outer iteration of the transport tables on the new equilibrium's own
  surfaces, replacing accept/reject and the retry ladder), G-EQDSK writer and tolerant reader (COCOS 1-8, 11-18, detection,
  conversion, `importGeqdsk`, `boundaryPsi`), polygon, Fourier and asymmetric Miller boundaries, Carlson elliptic
  integrals and the toroidal Green's functions of a filament (free-boundary groundwork), `fusion-sim export-eqdsk` wired,
  the two-knot spline pin flipped. Not done: no real EFIT g-file was available offline; free boundary is only started.
- **ws10e, education, Compare 2.0, worker pool (`b79dc0b`, 14).** Ten missions with headless solutions and negative
  controls, a 45-term glossary, the Explain popover, PowerFlow, Compare 2.0 (radar, overlay, config diff), a browser worker
  pool with parallel Validation, the Learn tab in the hash router (`#/learn/...`). The merge needed a retune of the
  density mission (the ws2c volume moved the knife edge: the old negative control became an isolated survivor). Turkish
  strings of the education dictionary are not reviewed by a native speaker.
- **ws3s, 1.5D solver (`bdb4471`, 28).** Edge-packed radial grid (`gridPacking` 4: 10 cells across the pedestal at 50 cells
  instead of 3), TR-BDF2 with embedded error control (`rtol` 1e-2, `atol` 1e-4, `dtMax` 0.5 s) and event localisation for
  ELMs and sawtooth crashes, Anderson-accelerated Picard (the default for the `scaling` transport), Newton (the default for the predictive `cgm` transport) and Pereverzev-Corrigan solvers (`nonlinearSolver: 'auto'`), the
  Hinton-Hazeltine form of the current diffusion (the F' term had the wrong sign; analytic Solov'ev <j.B> reproduced to 5e-5,
  was 1.2 % off), plasma current as a boundary condition with an `IpWaveform` programme, initial current normalised to
  I_p with edge matching to the equilibrium's table, a `cgm` transport that no longer oscillates (30 s -> about 4 s). Moves
  the nine 1.5D golden cases. Costs 2 to 3 times the run time (section 1).

Integrator fixes worth naming (each in its own commit, listed in the merge reports): ws7b x ws10b (share validator warned on
every `systems.*` value), ws7c x ws7b (the optimiser's coil constraint reads the Tresca stress: the ITER Pareto front now ends at
R = 9.3 m with 3.75 MW of heating left instead of ignition; test updated, no-coil test added), ws2c x ws7b (boundary shape
into the systems models: ITER magnetic energy 41.77 GJ instead of the lane's 39.6), ws4i x ws2c and ws4i x ws8 (two test
adaptations), ws4i outer iteration (best equilibrium adopted up to `OUTER_LIMIT` 1e-2: JET15 lost one update at t = 0.557 s),
ws3s x ws4i (`matchEdgeCurrent`: the 101-node table left a factor 2.4 to 9.9 in the outermost cell of the initial current),
ws3s x ws8 (six new profile settings and the `series` node in the config schema), ws5s x ws8 (`structuredClone` in ES2022
library build), ws10e x ws10b (router knew five tabs), ws10e x ws2c (density mission), ws3s x ws7a (two tests follow the new
trajectories), each golden file re-recorded once per physics-moving merge with a ledger reason.

## 4. Pins

No `it.fails` pin is left (Wave 1: 7). Four flipped with ws2c (D-T two-body energies, E_charged + E_neutron = E_tot, the
p-11B quadrature, the Miller volume and surface), one with ws10w (1.5D with a > R rejected by the wizard, typed error in the
model), one with ws4i (two-knot clamped spline end slopes); the W7-X density collapse is a plain test with a termination.

## 5. Before and after: headline numbers

"Before" is `test/golden` at `b059097`, "now" is `test/golden` at the gate; flat-top values are time-weighted means over the
last 30 % of the run (the golden definition since ws2c; the Wave-1 report used the frame-weighted 20 % window, which moves
flat-top means by 0.1 % or less for ELM tokamaks, and by 2 % for GF, FRXL and ITER-pB11). Cause codes: **c** ws2c, **a** ws7a,
**5** ws5s, **b** ws7b, **i** ws4i, **s** ws3s. All 30 golden files differ from `b059097` at least in a number or a key; the
eleven non-magnetic cases only through flat-top weighting (and MIRROR through the D-T alpha energy), and the 19 magnetic 0D and 1.5D
cases through everything below. `test/golden/CHANGES.md` has the bisected numbers of every move (17 new entries since `b059097`).

### 5.1 0D presets

Moved by ws2c only, except the engineering keys (ws7b) and 64 added edge keys per magnetic case (ws7a, no value moved); ws5s
moves history statistics of JET, SPARC, DIIID and MASTU by less than 3e-2 and no flat-top number.

| Case, quantity | before | now | Change | Cause |
|---|---|---|---|---|
| **ITER** flat-top Q | 10.13 | 10.04 | -0.9 % | c: exact D-T energies +4.1 %, Miller LCFS volume and surface -5.5 %, density target +0.7 % |
| ITER flat-top P_fus | 523.4 MW | 513.7 MW | -1.9 % | c |
| ITER Q_sci_max / E_fus | 13.40 / 207.1 GJ | 12.15 / 202.1 GJ | -9.3 % / -2.4 % | c |
| ITER n/n_G (line average) | 0.915 | 0.837 | -8.6 % | c: n_target 1.0e20 -> 0.914e20 (design 0.85) |
| ITER flat-top T_e | 8.51 keV | 9.27 keV | +9.0 % | c |
| ITER Q_eng / net P_electric | 1.237 / 43 MW | 1.061 / 13 MW | -14.2 % / -70 % | b: cryoplant 32.6 MW replaces the flat 5 MW; c 1.237 -> 1.224 |
| ITER TF stress / TBR | 82 MPa / 1.199 | 489 MPa / 1.125 | | b (limit 660 MPa) |
| ITER edge (new keys) | | q_peak 26.4 MW/m2, P_sep/R 19.1 MW/m, lambda_q 0.57 mm | | a (attached, prescribed divertor radiation) |
| ITER ELMs | 1310 | 1359 | +3.7 % | c |
| **JET** flat-top Q / P_fus | 0.3685 / 12.30 MW | 0.3863 / 12.88 MW | +4.8 % / +4.7 % | c: Miller volume (-3.5 %), D-T energies |
| JET E_fus (`JET.Efus` reference 59 +/- 6 MJ) | 64.15 MJ | 67.10 MJ | +4.6 % | c (still PASS, accepted 40-80) |
| **SPARC** flat-top Q / P_fus | 6.59 / 173.5 MW | 7.56 / 197.3 MW | +14.7 % / +13.7 % | c: the ellipse volume was 8.6 % too big |
| SPARC Q_eng / TF stress | 0.703 / 197 MPa | 0.634 / 1024 MPa | -9.8 % | b (over the 800 MPa limit: permanent warning, 3 -> 4) |
| **DEMO** flat-top Q / P_fus | 20.13 / 2025 MW | 18.27 / 1836 MW | -9.2 % / -9.4 % | c: density target, LCFS shape, D-T energies |
| DEMO n/n_G / Q_eng / net P_el | 1.238 / 2.385 / 524 MW | 1.171 / 2.083 / 427 MW | | c; b |
| **DIII-D** flat-top Q / P_alpha | 2.29e-4 / 2.30e-3 MW | 2.55e-4 / 2.55e-3 MW | +11 % | c |
| **JT-60SA** flat-top Q / P_fus | 2.92e-3 / 0.120 MW | 3.27e-3 / 0.134 MW | +12 % | c |
| **MAST-U** q95 / P_fus / ELMs | 18.18 / 5.6e-4 MW / 29 | 6.39 / 1.4e-4 MW / 11 | -65 % / -75 % | c: first-campaign scenario (`MASTU.q95` XPASS -> PASS, published 5 to 10) |
| **W7-X** Q_eng | 0.0600 | 0.0553 | -7.9 % | b (the plasma numbers are bit-identical) |
| ITER-DHe3 flat-top P_fus | 0.139 MW | 0.238 MW | +72 % | c: n/n_G 0.95 -> 0.87, exact volume |
| ITER-pB11 (golden pinned at 1.0e20) | collapse at 28.2 s | collapse at 27.2 s | Q +10 % | c: the preset itself (0.914e20) now survives to the end |
| GF, FRXL flat-top P_fus | | | -2.0 % | c: time weighting only |
| NIF G / Q_eng; MUON, TAE, TAE-pB11, ZAP, Z | 1.489 / 0.0595 | 1.489 / 0.0595 | 0 | (flat-top means of the pulsed cases move by 0.3 % or less) |

### 5.2 1.5D presets (flat-top means; ITER15 is the 400 s case)

| Case, quantity | before | now | Change | Cause |
|---|---|---|---|---|
| **ITER15** Q | 10.34 | 10.70 | +3.4 % | c, a, i together +0.6 % (10.401 before ws3s); **s +2.8 %** (packed grid +2.2 %) |
| ITER15 P_fus / Q_sci_avg (whole run) | 519.8 MW / 10.86 | 537.9 MW / 10.96 | +3.5 % / +0.9 % | s |
| ITER15 T_ped | 3.739 keV | 3.491 keV | -6.6 % | s: the whole move is the packed grid (10 cells across the pedestal); reference 4.5 +/- 0.5 keV (accepted 2-7) |
| ITER15 f_bs / l_i(3) / q95 / q(0) | 0.2300 / 0.7243 / 3.479 / 1.031 | 0.2313 / 0.7291 / 3.504 / 1.029 | +0.6 % / +0.7 % / +0.7 % / -0.2 % | s, i |
| ITER15 V_loop | 0.0637 V | 0.0582 V | -8.6 % | s: Hinton-Hazeltine current diffusion |
| ITER15 flat-top P_SOL / q_peak (new) | 110.3 MW / | 127.0 MW / 26.2 MW/m2 | +15 % | a: ELM-inclusive P_SOL (+10 %); s |
| ITER15 ELMs / sawtooth crashes | 1101 / 38 | 1332 / 40 | +21 % / +5 % | s: events are localised, not read off the step; 1317 to 1338 in the convergence runs |
| ITER15 steps | 10408 | 21562 | x2.1 | s |
| ITER15 Q_eng | 1.251 | 1.106 | -11.5 % | b |
| **JET15** Q / P_fus | 0.4413 / 14.64 MW | 0.4428 / 14.69 MW | +0.3 % | s, c |
| JET15 T_ped / q(0) / V_loop | 1.679 keV / 1.400 / 0.0745 V | 1.629 keV / 1.298 / 0.0871 V | -3.0 % / -7.3 % / +17 % | s |
| JET15 GS updates accepted / retried / rejected | 14 / 3 / 1 | 15 / 0 / 0 | | i |
| JET15 E_fus (`JET15.Efus`) | 82.35 MJ | 82.0 MJ | -0.4 % | still a KNOWN-FAIL (accepted 40-80) |
| **SPARC15** Q / T_ped / q(0) | 6.319 / 4.845 keV / 0.899 | 6.290 / 4.906 keV / 0.860 | -0.5 % / +1.2 % / -4.3 % | s, i |
| SPARC15 alpha_ped / alpha_crit | 0.827 | 0.922 | +11 % | s: ELM-trigger review is a Wave-2B item |
| SPARC15-short (3 s) Q | 5.174 | 5.233 | +1.1 % | s |
| **DEMO15** Q / P_fus | 23.26 / 2322 MW | 23.50 / 2346 MW | +1.0 % | s, c |
| DEMO15 T_ped / q(0) / V_loop | 4.198 keV / 1.645 / 0.0142 V | 3.875 keV / 1.471 / 0.0098 V | -7.7 % / -10.5 % / -31 % | s |
| DEMO15 ELMs / steps | 1095 / 13396 | 1318 / 32708 | +20 % / x2.4 | s |
| **DIII-D15** Q / T_ped / l_i | 2.95e-4 / 0.630 keV / 0.8057 | 2.97e-4 / 0.593 keV / 0.8136 | +0.6 % / -5.9 % / +1.0 % | s |
| DIII-D15 q(0) / steps | 1.398 / 3132 | 1.199 / 7305 | -14 % / x2.3 | s |
| SPARC15-DHe3 Q / T_ped | 3.44e-3 / 1.12 keV | 3.36e-3 / 1.00 keV | -2.5 % / -10.3 % | s |
| SPARC15-pB11 Q | 5.39e-5 | 4.62e-5 | -14 % | c (shorter H-mode window), s; one HL and two LH events instead of one LH (start-up loss power lags the heating step) |
| **MASTU15** (documented poor case, do not quote) q95 / P_fus | 17.56 / 9.3e-4 MW | 6.38 / 2.3e-4 MW | -64 % / -75 % | c: preset; sawtooth crashes 0 -> 34, GS updates 4/1/3 -> 6/0/0, steps 1643 -> 19061 |

Consistency of the last equilibrium with the transport: q95(GS)/q95(transport) is 0.992 to 1.010 in all nine cases and l_i(GS) is
0.7218 / 0.7524 / 0.7394 / 0.7247 for ITER15, JET15, SPARC15, DEMO15 (transport l_i 0.729 / 0.764 / 0.736 / 0.741).

No golden case has an ignited frame (`ignited` = 0 in every frame): the golden files do not guard the ignition path, which
the tests of the Wave-1 report (D1) do.

## 6. Convergence of the 1.5D solver (`npm run bench:convergence -- --threads 3`)

ITER15, 400 s, flat-top averages, `gridPacking` 4, radial cells `nRho`, `rtol` 1e-2 unless varied, `dtMax` 0.5 s. "Error" is the
Richardson estimate of the finest run, the GCI uses a safety factor of 1.25 (3 outside the asymptotic range). Runs on the merged
tree at `f8d39cc`.

| Series | Metric | coarse | mid | fine | mid -> fine | Order / GCI |
|---|---|---|---|---|---|---|
| nRho 25 / 50 / 100 | Q | 10.44 | 10.70 | 10.68 | -0.20 % | oscillatory, 7.3 % |
| | f_bs | 0.2340 | 0.2313 | 0.2314 | +0.07 % | oscillatory, 3.5 % |
| | l_i(3) | 0.7125 | 0.7291 | 0.7322 | +0.43 % | p = 2.41, 0.12 % |
| | T_ped [keV] | 3.559 | 3.491 | 3.471 | -0.57 % | p = 1.77, 0.30 % |
| | cells across the pedestal; wall time; steps; ELMs | 5; 17 s; 20665; 1317 | 10; 34 s; 21562; 1332 | 20; 77 s; 23193; 1338 | | |
| rtol 1e-2 / 1e-3 / 1e-4 | Q | 10.70 | 10.73 | 10.74 | +0.10 % | p = 0.47, 0.065 % |
| | f_bs | 0.2313 | 0.2317 | 0.2319 | +0.08 % | p = 0.38, 0.069 % |
| | l_i(3) | 0.7291 | 0.7287 | 0.7290 | +0.03 % | oscillatory, 0.15 % |
| | T_ped [keV] | 3.491 | 3.492 | 3.489 | -0.08 % | oscillatory, 0.23 % |
| | wall time; steps; ELMs | 34 s; 21562; 1332 | 53 s; 29148; 1334 | 75 s; 37860; 1335 | | |
| dtMax 0.5 / 0.05 / 0.01 s | Q | 10.70 | 10.70 | 10.74 | +0.41 % (0.5 -> 0.01) | no fit, 1.1 % |
| | f_bs / l_i / T_ped | 0.2313 / 0.7291 / 3.491 | 0.2311 / 0.7291 / 3.483 | 0.2317 / 0.7289 / 3.476 | +0.17 / -0.02 / -0.43 % | |
| | wall time; steps; ELMs | 28 s; 21562; 1332 | 29 s; 22465; 1332 | 38 s; 45764; 1338 | | |

Wave 1 (uniform grid, backward Euler) for comparison: T_ped 5.12 / 3.74 / 3.61 keV at 25 / 50 / 100 cells, Q 8.94 / 10.34 / 10.51, Q drifting
+1.3 % from dtMax 0.5 to 0.01 s. The Q series in the radial-cells table is not monotone (25 -> 50 moves it by 2.5 %, 50 -> 100 by
-0.2 %), which is why the Richardson order is undefined; the differences of the two finest runs are all below 0.6 %. q(0) and the sawtooth
crash count are not part of this table and are the least converged numbers of the 1.5D record (a 0.1 % change of the initial
current moved the lane's ITER15 flat-top q(0) by -14 %): never quote them as converged physics.

## 7. Validation table (`npm run validate -- --markdown`)

36 of 42 checks are within the accepted range, 6 are documented known failures, 0 are unexpected (Wave 1: 35 / 7 / 0).
Changes since Wave 1: `MASTU.q95` is a PASS (6.39, accepted 5-10; the preset is the first-campaign scenario). The values that
moved because the physics moved: `ITER.Q` 10.0, `ITER.Pfus` 514 MW, `ITER.nG` 0.837 (reference 0.85), `ITER.alphaShare` 0.207
(accepted up to 0.213), `JET.Efus` 67.1 MJ, `SPARC.Q` 7.56, `DEMO.Pfus` 1830 MW, `DEMO.alphaShare` 0.209, `ITER15.Q` 10.7,
`ITER15.Pfus` 538 MW, `ITER15.fbs` 0.231, `ITER15.li` 0.729, `ITER15.q95` 3.50, `ITER15.Tped` 3.49 keV (reference 4.5 +/- 0.5,
accepted 2-7), `ITER15.nG` 0.80 (0.85, accepted 0.6-1), `SPARC15.Q` 6.29, `DEMO15.Pfus` 2020 MW, `DEMO15.fbs` 0.376.

The six known failures (each with its cause in `validation/references.ts`): `JET15.Efus` (82 MJ against 59 +/- 6: beam-target
fusion of the 1.5D model), `DIRECT.G` (3.1 against 0.74: no laser-plasma instabilities), `Z.yield` (2.0e14 against 1.1e13: no
liner-fuel mix), `TAE.Ttot` (1.21 against 3 keV: single-temperature FRC), `MIRROR.Te` (9.5 against 0.66 keV: single-temperature
mirror), `MUON.Yf` (106 against 150: sticking). The Wave-1 note "flips to XPASS: reword, never retune the range" still holds for
each of them.

## 8. What the gate changed

Five commits on top of `f8d39cc` (three of code, tests and data, two of this report), none of which moves a golden number (golden 30/30 after the one that touches code, no re-record):

- `0d61ac5` fix(profiles): `ProfileContext.geomB` is `boundaryShape` of the configuration. The ws2c and ws4i merge reports
  carried this over: an edited `geometry.kappa` or `geometry.delta` of ITER15 or DEMO15 moved q95 and the scalings but not the
  1.5D boundary, while the 0D volume followed. Bitwise unchanged at the presets (the ratio to `lcfsRef95` is exactly 1). Two
  tests (nominal shape and initial equilibrium volume; absolute LCFS values without a reference), CHANGELOG line. The 1081
  tests of the profiles, edge, reference, regress, regression, analysis and fusion-sim directories were re-run after it.
- `7d6a40c` docs(readme): the quick start says Node.js 20+ (`engines.node` is `>=20`; ws8 carried it over).
- `0a7d525` bench: `bench/perf-baseline.json` re-recorded on the idle machine (section 1; ws3s and ws10w asked for it).
- `c0a1ab5`, then a wording commit: this report.

Second pass after these commits: `tsc --noEmit` exit 0, `npm run golden -- --threads 4` "all 30 cases match", targeted vitest
(1081 tests) green; `ci:local` was not repeated in full because only `context.ts` and one test file changed (the full 3018-test run
is the first pass).

## 9. Open issues and cross-lane requests carried to Wave 2B and Wave 3

"Golden" means the item changes physics numbers and needs a re-record with a ledger reason. (R) is a lane request, (F) a review
finding, (G) a gate observation. **Merge convention that worked in Wave 2A:** never merge `test/golden/*.json` textually (take
ours, re-record once after the last physics-moving merge with `golden:update --reason-file`); keep every `test/golden/CHANGES.md` entry
whole and in time order; write edited files with a tool that keeps CRLF (GNU `sed -i` in Git Bash rewrites them as LF; some files
are LF in the working tree).

### Wave 2B: WS6 physics modules

- **6a pedestal.** ITER15 T_ped 3.49 keV against the EPED-type reference 4.5 +/- 0.5 keV (accepted 2-7): now grid-converged
  (0.57 % between 50 and 100 cells), so the gap is physics; pedestal width (0.06), ETB factor (0.08) and ELM size (0.35) are still
  fixed inputs of `profiles/defaults.ts`. The ELM trigger uses the ballooning limit alpha_crit: SPARC15 alpha_ped/alpha_crit
  0.92 and SPARC15-pB11 +77 % in the flat top, a review of the trigger and of the separatrix face is a physics-owner item. The
  opt-in `edgeModel: 'twoPoint'` T_sep (`profiles.edgeModel`) is unvalidated; n_sep stays fuelling-controlled.
- **6b transport closures.** `'scaling'` mode is circular against the confinement scalings (a PI controller sets tau_E); `cgm` is now
  fast and stable (3.5 s for 10 s of ITER15) but uncalibrated. Newton costs 1.3 to 1.5 times the Picard (the Jacobian is not
  reused, to keep chunk invariance and exact rewind). Couplings updated once per accepted step (C_chi, P_SOL, sources,
  inventories) are invisible to the error estimate. (R, ws3s to ws7a) pass the smoothed `ctx.dWdtS` to `updatePsol`: steps cut
  short below 0.5 ms carry the first-order lag of P_SOL (energy residual up to 1.3e-3 of P_heat in the `cgm` smoke test), ITER15
  H-mode steps could grow to 20-80 ms; moves P_SOL by about 10 %, golden. The 0D L-H transition is a knife edge near threshold
  and non-monotonic (DIII-D 1 MW NBI: H fraction 0 at 0.6e20, 0.63 at 0.9e20, 0.68 at 0.3e20). ITPA20 and ITPA20-IL are wired
  everywhere; the ITPA20 regression covariance is not in the open text.
- **6c current, flux, scenario.** `Ip_MA` is a scenario control and `IpWaveform` a programme; add the shape keys to
  `SCENARIO_CONTROLS` when they become controls. Open (R, ws3s): the Grad-Shafranov update policy does not trigger on a large
  |dI_p|/I_p (a fast ramp runs on a geometry up to an update interval old); Phi_b-dot is passed as 0 and the V'-dot terms of the heat
  and particle equations are not implemented (V' jumps by up to 1.7 % of a face at an adoption); the CS flux keys of ws7b have the
  hooks `V_loop`, `psi_used` and `FluxMeasurement`. MASTU15 keeps a slightly negative outermost cell of the t = 0 current on the
  packed grid (-5e-5 I_p; a clamp was deliberately not added). Free boundary is only started (Green's functions and elliptic
  integrals exist; no coil model).
- **6d fast ions and current drive.** The 1.5D fast-ion pools are scalar (source-weighted tau_W, instantaneous local heating, no
  transport or loss, isotropic beams): DIII-D15 at E_NBI = 500 keV disrupts at the Troyon limit at 0.78 s in 1.5D while 0D runs to
  the end; JET with fuel DT and `fuelFracA = 0` gives 108 MJ against 64 MJ for 50/50 (beam-target). `f_cd` exists as a diagnostic
  only; no ECCD or NBCD sources with their own deposition.
- **6e impurities and He ash.** The Lengyel c_z for detachment is an upper bound (coronal Mavrin curves from 100 eV; ADAS data
  are not in the repository, hook `EdgeParams.lengyel`); the Ne test uses a synthetic cooling curve. ITER15 reports q_peak 26 MW/m2
  unseeded (prescribed divertor radiation), a detached seeded ITER divertor needs `divertor.edge.radiation 'lengyel'` plus
  `impurity.seedSpecies/seedConcentration`, a preset decision. The tungsten source and the density-limit warning use the
  volume-average basis (check after the ITER/DEMO `n_target` re-base). The 0D line-average density overshoots `n_target` during the
  ramp (+14 %), so a set-point below n_G can still disrupt; on the merged base the density limit is a knife edge in `n_target`
  (0.97e20 survives, 0.98e20 disrupts at 1.9 s, 1.05e20 is an isolated survivor): missions and the density controller depend on it.
  ITER-pB11 at the preset density is a marginal power balance (the golden case is pinned at 1.0e20, where it collapses).

### Wave 2B: WS10c scenario editor UI and UI wiring of the new outputs

- **Scenario in the live app (R, ws5s, ws10b).** `SimulationOptions.scenario` is not passed through the worker init message (host
  builds `new Simulation(msg.cfg)`); no editor (list `SCENARIO_CONTROLS`, offer `rampStep >= max(1e-6, t_end/1e4)`); a
  `ScenarioError` from the constructor must reach the UI as an error message; share and load should validate up front with
  `scenarioFromJSON(text, { controls, diagnostics, tEnd })`; the share dialog makes no exact-run links with a scenario; the sim
  worker should send its actuator log, breakpoints and fingerprint at completion so live runs with interventions can be signed
  (touches `src/worker/protocol.ts`). CLI: `--scenario` exists for `run` only (scan, uq and optimize have none); csv, ndjson, netcdf
  and imas do not embed the scenario or its hash; no JSON Schema of the scenario.
- **Report and keys (R, ws7a, ws7b, ws10w).** The Report page prints the engineering keys raw and in English, including the edge
  keys and all systems keys ('Cryo pulse length (s)', 'TF stress margin', 'Flux margin', ...); a key translation table is a UI
  change of its own. Explain popovers (`termOfDiag` maps channels to terms) and PowerFlow are ready and not wired into Report, Run
  live values and KPI labels. Compare could show `VerifyBadge` for shots that carry verification.
- **Wizard.** Fields for `systems.pulseLength_s` (blank = 1055 s), the remaining `divertor.edge.*` options (outerShare,
  spreadingRatio, S_mm, kappa0e, sheathGamma, lossFit, seedEnrichment, detachTt_eV, targetTilt, strikeRadiusFraction,
  divertorLengthFraction) and the 1.5D solver settings (`rtol`, `atol`, `dtMax`, `gridPacking`, `nonlinearSolver`; safe at defaults) have
  no wizard entry; pre-existing labels are English only; the 1.06 box margin duplicates `GSGridOptions.margin` (export the constant).
- **Smaller UI items.** POPCON edge maps (`computePopcon(cfg, { edge: true })`) have no worker path; the POPCON T axis is a per-job
  heuristic (W-7X weakest); `MagneticModel.geometryInfo()` reports the nominal 95 % kappa/delta while V and S belong to the LCFS
  (add `kappaB/deltaB` if the cross-section panel should draw the LCFS); the 3D coils are schematic and its Show/Hide choice is
  not persisted; the step-control settings warning is English only and not re-issued after a rewind to before the first step; the
  'Opened X from a shared link' banner stays after a different preset runs; the embedded report view shows the full toolbar; Learn
  progress (localStorage) is not part of shared state; Turkish strings of the education dictionary need a native reviewer.
- **Chunk budget.** Main chunk 262.46 kB. Later UI lanes lazy-load what they add and re-measure; the English keys `wf.*`,
  `wiz.cross*` and `end.*` in `src/i18n/en.ts` are the candidates to shorten. Consider an enforced size check in `ci:local`.
- **Pause latency (G).** Over its < 60 ms target at 30x and 100x (section 2): make the Grad-Shafranov update sliceable (the outer iteration of `coupling/outer.ts` is a loop of solves and could yield between iterations through the kernel, or the update could be scheduled at an idle step boundary), or cheaper (fewer surfaces in the intermediate solves). Re-run `bench/pause-latency.ts` at 1x, 30x, 100x afterwards. The kernel contract that a step is atomic and a checkpoint is exact constrains the options.
- **Re-check.** The Learn missions
  (`src/edu/missions.test.ts` are canaries: retune a control in `missions.ts`, not the physics, when a physics merge flips one),
  and `npm run missions` (not in `ci:local`; the same three plays run inside vitest).

### Presets and systems (ws2c and ws7b owners)

- SPARC (1024 MPa against 800) and DEMO (745 against 660) carry a permanent 'TF coil stress' warning: review the inboard-leg
  thickness and gap (SPARC `coilThickness_m` 0.5, DEMO 1.0; the same model gives 571 MPa for the 1.4 m PROCESS DEMO leg) against a
  published radial build. Golden (warnings.length +1 in 7 cases).
- Give ITER, DEMO and SPARC their design pulse (`systems.pulseLength_s`: ITER about 500 s, DEMO 7200 s or 10364 s, SPARC 10 s) and
  ITER, DEMO, JET and SPARC a `systems.cs` block: today every preset uses the 1055 s default and the CS flux margin is negative for
  ITER (-0.23), ITER15 (-0.14), JET (-0.53), DIII-D (-0.75), JT-60SA (-0.81) and SPARC (-0.77); only DEMO and DEMO15 are positive (+0.62, +0.77). The CS flux keys are published
  unconditionally with values known to be wrong for the presets: emit them only with `systems.cs`, or with a note. Golden.
- ws7b doubts (R, F): TF nuclear heating uses the PROCESS DEMO-HCPB fit outside its range and is scaled with P_fus, not P_neutron
  (SPARC 476 kW and a 28 MW cryoplant with no blanket; ITER 44.5 kW against the 14 kW design limit); the Ejima coefficient is 0.45
  against 0.4 in PROCESS (moves 'Flux required' by 2 %); `breeding.ts` comment claims current PROCESS still uses the Shimwell TBR
  fits (it removed the model) and the TBR test only covers y = 1; short or aborted runs report a lower cryoplant and net power
  because the flat-top mean P_fus follows the simulated flat top (a burn-window criterion is an owner decision); stellarators use the
  tokamak inboard-leg model for modular coils (W7-X 120 MPa) and have no CS budget. Engineering keys are a function of flat-top means,
  so any lane that moves P_fus, P_neutron, l_i or the boundary shape moves them (ITER cryoplant 32.6 MW, net 13 MW, Q_eng 1.061).
- ws7c: the optimiser's coil constraint is now binding for large or high-field designs at the preset coil thickness; coil thickness
  is not a design variable (owner decision). The src/analysis barrel is not exported from the library entry (`solveEdge`, `EdgePlasma`,
  `EdgeResult`, `resolveEdgeParams` and `edgeReportEntriesOf` are not either; only `EdgeOptions` is); the geqdsk reader and writer are
  not in the `io` entry because `importGeqdsk` pulls the Grad-Shafranov solver in. All three are owner API decisions.
- ws2c: the DEMO LCFS shape (1.85 / 0.5) is a PROCESS conversion of the published 95 % shape (Siccinio 2022 table 1 gives 1.65 /
  0.33 only); the DEMO density basis (line against volume average) is an ASSUMPTION; the low-density L-H exponent 2 is the SPARC-study
  penalty, an approximation.

### Equilibrium and interoperability (WS4 leftovers)

- No real EFIT g-file was available offline: the reader is tested on the solver's own files, hand-made text and an analytic
  single-null Solov'ev file. A real X-point separatrix must be imported with `boundaryPsi` below about 0.99. Written files carry the
  solver's smooth continuation of psi outside the plasma, not a coil-consistent vacuum field; a boundary polygon is a chord curve
  (volume -1e-4 at 256 points). Free boundary: only Green's functions and elliptic integrals.
- The outer iteration's `OUTER_ACCEPT` (5e-3) and `OUTER_LIMIT` (1e-2) are measurements (worst adopted mismatch in a +/-15-20 % scan
  over six presets: 5.7e-3, JET15; every other case below 2.0e-3); the JET15 update at t = 0.557 s still spends 11 solve attempts.
  The initial current profile of the 1.5D model has a slightly non-monotone outer tail on some grids (the equilibrium's own table
  has one); `imas.test.ts` allows the dip on frame 0 only.
- `src/plot/figures/equilibrium.ts` `temperatureMap` assumes a boundary symmetric about Z = 0 (use `b.zRange` and `b.inside` for
  imported and asymmetric shapes); the solver-counter caption in `paper.ts` still says 'only after a retry stage' (the retry ladder is
  gone): rewording changes hashed figure text, Wave 3.

### Tooling, tests, kernel

- Add mutants for the new numerics (TR-BDF2 error control, Anderson Picard, the edge two-point chain, the Tresca layers, the
  outer iteration) to `mutation-smoke`; add `src/io/**`, `src/analysis/**`, `src/edu/**` and raise the gated thresholds (section 1).
- `mutation-smoke`, `figures:check` and `bench:*` are outside `ci:local`; `ci:local` takes 465 s and hard-codes unlimited vitest and
  `--threads 4` (agents on a shared machine run its steps by hand with `--maxWorkers=3` / `--threads 3`). The lane reports saw
  load-dependent timeouts of a few heavy tests under a shared CPU (`kernel/simulation.test.ts` FSAL, `coverageConfig.test.ts`,
  `lossPower.test.ts`, the child-process suites `lib.test.ts` and `spawn.test.ts`; most got explicit timeouts at the merges); a global
  `testTimeout` of 30 s in the vitest config was proposed and is worth doing.
- `RNG.getState()` returns mulberry32's unreduced accumulator while `setState()` reduces it modulo 2^32: a rewound run stores smaller
  numbers in `frame.internal.rng` (both give the same sequence). The kernel test kit compares modulo 2^32; keeping the state
  reduced in `rng.ts` would make the run digest itself rewind-invariant.
- FSAL saves only 0.9 to 3.1 % of the rhs evaluations in ELM H-mode 0D presets (`elmPartRate` is re-derived every step); making it
  piecewise constant between crashes moves every ELM preset (owner decision). Trigger `hold` and `after` are two independent gates
  (as documented; a one-line change in `evaluateTrigger` if `after` should blank the input).
- `src/cli/provenance.ts` must keep the exact text `new URL('../../', import.meta.url)`: `scripts/build-lib.plugins.mjs` rewrites it
  and the build fails loudly if it is missing.
- The Windows access violation 0xC0000005 of a spawned CLI is still unexplained (see section 1); a single red `ci:local` with exit
  code 3221225477 should be re-run before blaming a change.

### Wave 3 (docs, figures, release preparation; local only)

- **Numbers in the docs are stale:** the `README.md` validation table and its fig03 image (0D ITER Q 10.0 and P_fus 514 MW, 1.5D 10.7 /
  538 MW, JET E_fus 67 / 82 MJ, SPARC Q 7.56 / 6.29, DEMO P_fus 1836 / 2346 MW), `docs/technical-report.md` (line 25 and the 'Q about 14'
  discussion, the L-H time in the Figure 3 caption, section 7's validation table, the POPCON text; the solver-description rows
  220-223 were updated by ws3s, the timing rows are v3 numbers: ITER15 400 s is 23.8 s and about 2.2e4 steps now, DEMO15 500 s is 139.5
  s), `docs/v4-wave1-report.md` section 5 (superseded by section 5 here and the ledger), and every figure. Regenerate all with
  `npm run figures` into a scratch `--out` first, never into `docs/figures` from an integrator run (about 4 min at 2 threads),
  then add `figures --check` to `ci:local`. The `equilibrium` hashes in `src/plot/figures/testdata/builders.sha256.json` depend on
  `physics/equilibrium/solovev` and `numerics/interp` (`UPDATE_FIGURE_GOLDEN=1 npx vitest run src/plot/figures/builders.test.ts` after
  viewing the figure). The UQ, Pareto and rho-t builders need registry entries with study data; `fig05` needs reference bands and 5-95 %
  intervals from `uq`.
- **Version 3.0.0 -> 4.0.0** in `package.json` (`APP_VERSION` is read from it and is written into run files and fingerprints: every
  previously exported file then reads 'other-version', as intended), `package-lock.json`, `CITATION.cff` (also the `TODO`), `.zenodo.json`
  and `CHANGELOG.md`, then `release:check --no-allow-unreleased`.
- **Validation v2:** the Sauter (2016) q95 constants, the MAST-U campaign ranges, the alpha-share tolerance, the `JET15.Efus` range
  (if it flips to XPASS reword the note, never retune the range to model output), and the ITER15 density (0.80 of the Greenwald limit
  against 0.85 in the reference) and T_ped (3.49 against 4.5 keV) numbers.
- **Docs of new modules:** `src/physics/edge`, `systems`, `equilibrium` and `profiles` have READMEs; the technical report has none of
  edge, systems, scenario, UQ, G-EQDSK or the TR-BDF2 scheme yet; the JOSS paper needs the section 5 and 6 tables.
- Python: `python/fusion_sim` is a subprocess wrapper only; its unittest suite runs inside vitest (25 s).
- Fast-forward local `main` from `v4/integration` only after the above; then stop and wait for "yap".

## 10. Notes for the owner

- Nothing was pushed, tagged, released or archived (Zenodo, PyPI, Pages). The lane branches `v4/ws*` and their worktrees `.wt/*` are
  in place; the temporary worktrees under `%TEMP%` (`ws10a-base`) belong to earlier agents and were left alone. The gate created no
  worktree; its scratch files (probes, logs, a built consumer package) are in the session scratchpad, not in the repository.
- The Wave-2A run was cut by usage limits twice (ws3s stage C, ws7b's integrator); both were resumed from committed state and the
  merge reports say what was found. The 30 golden files were re-recorded once per physics-moving merge; `test/golden/CHANGES.md`
  now has 17 more entries (about 725 lines), each with the bisected causes.
- Owner decisions collected above: the library entry (analysis barrel, edge solver, G-EQDSK), `coilThickness_m` as a design
  variable, the burn-window criterion for short runs, FSAL and `elmPartRate`, an enforced main-chunk budget, and whether the
  `twoPoint` edge model should become the default once validated.
