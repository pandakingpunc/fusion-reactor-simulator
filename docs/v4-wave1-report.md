# v4.0 Wave-1 gate report

Gate run on 2026-09-29 in the main checkout, branch `v4/integration`, starting at `6ec915d` (all Wave-1
lanes and follow-ups merged: ws5, ws10, ws4, ws1b, ws9, ws2a, ws2b, ws3, ws5b, ws1c, ws3d). The gate's own
commits are listed in section 8. Nothing was pushed, tagged or released. The baseline for every
"before" number is the v3.0.0 physics as recorded in `test/golden` at commit `3d04e96` (Day-0 gate; its
physics files differ from the v3.0.0 code `eb97a6d` only by the bitwise-neutral flat-top helper).

## 0. Verdict

**The Wave-1 exit criteria are met.** `npm run ci:local` is green (tsc, 944 tests in 94 files, 42
literature checks with 0 unexpected failures, 30/30 golden cases at 1e-9), the build, the coverage
gate, the strict type-check ratchet and the mutation smoke test pass, every defect D1-D7 has passing
regression tests (section 3), coverage is far above the roadmap floors (`magnetic.ts` 99.1 % lines,
`src/physics` 98.8 %), the 0D and 1.5D chunk-invariance and rewind tests are bitwise, and
`test/golden/CHANGES.md` names a cause for every one of the 25 golden cases that differ from the v3
baseline (the 5 others are bit-identical to it).

Not green, both expected and both Wave-3 items: `release:check` fails 1 of 8 checks (a `TODO` in
`CITATION.cff:15`, the author-identity note that only the owner can resolve), and `figures:check` exits 2
because `docs/figures` has no `figures.manifest.json` yet (it is regenerated once in Wave 3).

The gate found and fixed one real defect (the `bench:convergence` time-step series had been broken by the
`model.ts` split) and cleaned three small leftovers (section 8). D4 (grid and time-step convergence) is
not a Wave-1 fix; its measured status is in section 3 and it goes to Wave 2, WS3.

## 1. Verification commands and results

All on Windows 11, Node v24.19.0, 12 cores, run sequentially. The table is the gate's first pass at
`6ec915d`; the second pass, after the gate's own commits, is at the end of section 8.

| Command | Exit | Time | Result |
|---|---|---|---|
| `npm run -s ci:local` | 0 | 139 s | type check ok; vitest 94 files / 944 tests passed (76.8 s); validation 35 passed, 7 known failures, 0 unexpected (41 s); golden "all 30 cases match" (14.3 s wall) |
| `npm run -s build` | 0 | 6 s | `tsc --noEmit` + `vite build` ok (90 modules) |
| `npm run -s coverage` | 0 | 198 s | 944/944 tests; **no** `onTaskUpdate` timeout and no unhandled error (the exit-1 seen at `fca4643` is gone); thresholds met; all files 90.06 % lines / 89.63 % branches / 86.69 % functions |
| `npm run -s typecheck:strict` | 0 | 5 s | 42 errors in 30 files = baseline 42 in 30; no file above its baseline |
| `npm run -s validate -- --threads 4 --markdown` | 0 | 42 s | 35 of 42 checks within the accepted range; 7 documented known failures; 0 unexpected (table in section 6) |
| `npm run -s release:check` | **1** | 1 s | 7 of 8 pass (version, unreleased, date-released, citation-doi, readme-presets = 21, engines-node, license); **fails `no-todo`**: `CITATION.cff:15: # TODO: İsim/soyisim ve (varsa) ORCID'ini doğrula` (owner's author metadata, not touched) |
| `npm run -s mutation-smoke` | 0 | 42 s | baseline passes (8 files, 6.1 s); **15/15 mutants killed** (M1-M15, including the NBI-pool feed M10 and the singular-pivot test M15 whose search texts still match after ws2b and ws3d) |
| `npm run -s figures:check` | **2** | 1 s | `--check: no figures.manifest.json in docs/figures`. Expected: `docs/figures` predates ws9's registry and manifest. Not regenerated (Wave 3) |
| `npm run bench:convergence -- --threads 2` (extra, D4 status) | 1, then 0 | 45 s | first run: the dtMax series failed for all three runs ("this model has no internal time step to limit"); fixed in `d245073`; second run complete (section 3, D4) |

**Main chunk size** (from the build output): `dist/assets/index-CaA4uA63.js` **244.92 kB, 82.61 kB gzip**.
Other assets: `sim.worker` 190.48 kB; lazy chunks `exportFigures` 72.01 kB (28.30 kB gzip), `Report` 10.93 kB
(3.24), `tr` (Turkish dictionary) 7.30 kB (3.34), `Validation` 5.99 kB (2.27), `Compare` 2.81 kB (1.08);
CSS 8.64 kB (2.45 gzip); the four STIX Two font files (395, 396, 424 and 1518 kB) are static assets that the
figure export fetches on demand. `index.html` 0.63 kB. Runtime dependencies are still React and React DOM only.

**The intermittent Windows exit code 0xC0000005** of a spawned `validate` (seen at `fca4643` in
`cli.test.ts:157` and once in `exitStress.test.ts`) did not occur in any of the gate's four full parallel runs
(`ci:local` and `coverage`, twice; each includes the 16-run exit stress test and the spawned-CLI tests). Its cause is still unknown (section 9, WS1).

**Coverage** (`npm run coverage`; per-directory line coverage from `coverage-summary.json`; the gated
globs and their thresholds are in `vite.config.ts`):

| Scope | Lines | Functions | Branches | Roadmap floor / gate |
|---|---|---|---|---|
| all files | 90.06 % | 86.69 % | 89.63 % | none |
| `src/physics/**` | 98.8 % | 94.7 % | 92.8 % | roadmap >= 80 %, gate 98/94/92 |
| `src/physics/confinement/magnetic.ts` | **99.05 %** | 96.97 % | 97.12 % | roadmap >= 70 % (v3: 8 %) |
| `src/physics/profiles/**` (1.5D) | 99.4 % | 97.0 % | 93.5 % | |
| `src/physics/equilibrium/**` | 99.4 % | 97.8 % | 91.3 % | |
| `src/physics/kernel/**` | 94.1 % | 95.5 % | 93.5 % | |
| `src/physics/numerics/**` | 98.5 % | 93.2 % | 94.9 % | gate 97/90/91 |
| `src/physics/validation/**`, `src/regression/**` | 99.6 %, 99.1 % | 100 % | 92.6 %, 92.1 % | gated |
| `src/cli/**` | 95.8 % | 90.2 % | 93.7 % | gated (entry points `*.cli.ts` excluded) |
| `src/plot/**` | 71.1 % | 73.2 % | 85.3 % | gate 70/72/85 |
| `src/ui/**`, `src/worker/**`, `src/i18n/**` | 78.9 %, 89.4 %, 100 % | 72.7 %, 90.3 %, 70.0 % | 84.1 %, 83.3 %, 88.2 % | not gated |

Weakest files (lines): `src/ui/report/Compare.tsx` and `Validation.tsx` 0 %, the figure builders
`src/plot/figures/{mhd,profiles,equilibrium,popcon,timetrace,verification,reactivity}.ts` 4-15 % (they run
only in the `figures` CLI, whose end-to-end test is the byte-identical regeneration check that Wave 3
turns on), `ui/charts/ProfileChart.tsx` 24 %. Every gated glob is above its threshold (the run exits 0); the thresholds of `src/physics/numerics/**` (97 lines)
could be raised at the release (measured 98.5 %).

## 2. Wave-1 exit criteria

| # | Roadmap criterion (Wave-1 exit gate) | Status | Evidence |
|---|---|---|---|
| 1 | `ci:local` green | **Met** | 139 s, all four steps. Deviation from the roadmap wording: `ci:local` has four steps (tsc, vitest, validate, golden); the fifth, `figures --check`, waits for the Wave-3 regeneration (`figures:check` exit 2 above). Unlimited vitest and `--threads 4` are hard-coded in `scripts/ci-local.mjs` |
| 2 | D1-D7 each have a passing regression test (tests start as `it.fails`, then flip) | **Met** | section 3. The `BUG(ws2a)` pins for the integrator (array `nonNegative`, NaN step size: 3 tests, plain since this gate, `9297a7d`), the ELM-frame diagnostics and the blank 1.5D defaults flipped to plain tests; 7 `it.fails` pins remain for *other* findings (Appendix A) |
| 3 | Coverage: `magnetic.ts` >= 70 %, physics >= 80 % | **Met** | 99.05 % and 98.8 % (section 1) |
| 4 | Chunk-invariance determinism test bitwise-equal for 0D | **Met, and for 1.5D** | `determinism.test.ts` (ITER 30 s, JET, W7-X, NIF, Z; 20 seeded schedules each) and `determinism15.test.ts` (ITER15 1 s x 20, JET15 0.6 s x 6); equality is SHA-256 over every number of every frame and event |
| 5 | `test/golden/CHANGES.md` explains every number that moved | **Met** | 30 cases: 5 bit-identical to v3 (FRXL, GF, MUON, TAE, ZAP); 25 differ, and each of the 25 is named in a ledger entry with a stated cause. One gap was found (the ws3d reasons omitted the T_ped, f_bs and event-count knock-on moves) and closed by an append-only addendum (`953443d`) |
| 6 | Golden numbers guarded at 1e-9 | **Met** | "all 30 cases match", no re-record during the gate; the gate's commits move no physics number |

## 3. Defects D1-D7: the regression tests

All tests named here passed in both the `ci:local` and the `coverage` run. "v3" numbers are from the
Day-0 golden baseline or the roadmap probes.

**D1 Spurious ignition, alpha/beam split.** v3: ITER logged IGNITION at 14.5 s with 50 MW of external
heating on (`ignitionTime` 385.6 s), DIII-D showed P_alpha 11.66 MW at P_fus 0.004 MW, JET's `W_f`
6.16 MJ came from one pool with the alpha slowing-down time. Now: ITER `ignitionTime` 0 s, no ignition
event; DIII-D P_alpha 0.0023 MW; JET `W_f` 1.62 MJ.
- `src/physics/regress/fastIonPools.test.ts`: "ITER: P_alpha is the charged-fusion-product heating, the
  beams are reported separately"; "ITER with 50 MW of external heating never logs IGNITION, and its
  ignition time is zero"; "whenever a frame counts as ignited, the charged-product heating covers radiation +
  transport"; "DIII-D (D-D, 12 MW NBI): P_alpha ~ 0 while the beam pool carries the NBI power"; "beta_T and
  beta_N include the fast-particle pressure"; "tau_W = W_fast/P_source ... matches a direct integration of
  the Stix slowing-down"; "a sawtooth seeds an NTM only when the THERMAL beta_N exceeds ...".
- `src/physics/regress/autoOff.test.ts` ("ITER at H98 = 1.4 ignites and stays ignited without heating;
  IGNITION only when the charged products alone cover P_rad + W/tau_E"), `ignitionQuench.test.ts` (0D
  ignited state ends at a disruption), `src/physics/profiles/ignition.test.ts` and `fastIons.test.ts` (1.5D
  ignition test and fast-ion pools bounded by the injected energy), `src/physics/reference/invariants.test.ts`
  (84 tests: power diagnostics add up, energy ledger), `validation/v4checks.test.ts` (`*.alphaShare`,
  `DIIID.Palpha` checks). Mutation M10 (pool fed with injected instead of absorbed NBI power) is killed.

**D2 Fuel-mix errors.** D-D with `fuelFracA < 1` (about 4x low in 0D and POPCON), ICF ignoring the fuel and
double-counting the coupling in Q_eng, tandem mirror below the simple mirror, dead `heating.autoOff`.
- `regress/fuel.test.ts` (D-D thermal and beam-target power independent of the slot split, whole D-D shot
  equal for `fuelFracA` 0.5 and 1, POPCON independent of it, D-3He D-D side channels and neutrons),
  `regress/icf.test.ts` ("ICF burn uses the selected fuel", "Q_eng = G eta_driver eta_th, not multiplied
  again by the coupling"), `regress/mirror.test.ts` ("tandem mirror end plugging confines better than a
  simple mirror at every mirror ratio"; Pastukhov factor), `regress/autoOff.test.ts` (the ignition test
  ramps the heating down at Q = 5; "without autoOff nothing is switched off"), `regress/blanket.test.ts`,
  `regress/greenwald.test.ts`, and the 1.5D counterparts `profiles/sources/fusion.test.ts` and `sources.test.ts`.

**D3 1.5D state and coupling bugs.** All four parts have tests in `src/physics/profiles/integrity.test.ts`
(33 tests, 74 s):
- (a) "work arrays after an equilibrium swap": ITER15 and DEMO15 "no postStep sees n_i = 0 and every
  sawtooth flattens T_i", JET15/ITER15 "right after a swap postStep sees the arrays of a fresh
  evaluation";
- (b) "Grad-Shafranov updates during a shot": "JET15: nearly all updates are accepted, the rest is
  reported, and the report counts both" (v3: 3 of 17 accepted, now 14 of 15, 3 of them after a retry),
  rejected and non-converged updates are retried and warned about, a table rescaled by more than 50 % is
  rejected, "MASTU15: current tables mapped through a stale geometry are held back";
- (c) "implicit step failures": exhausted retries do not advance time without a matching state, the
  last-resort forced step never commits a non-finite state, a typed numerical failure ends the shot
  explicitly, a programming error in a plug-in hook propagates and the step is undone atomically (also
  `profiles/failures.test.ts`: `SingularMatrixError` is classified by type);
- (d) rewind: "checkpoints and replays" (replay from a thermal- or current-quench frame reproduces frames
  and report), `profiles/checkpoint.test.ts` (checkpoint contract), and `kernel/determinism15.test.ts`
  "1.5D: exact rewind" (ITER15 at 25/50/75 %, JET15 final frame). The v3 finding that a 1 % tolerance hid a
  5.7 % q0 error is closed by bitwise digests.

**D4 Convergence: status only, not a Wave-1 fix.** `bench:convergence` (ITER15, 400 s, flat-top averages,
fixed after the gate found it broken):

| Metric | nRho 25 | 50 | 100 | Richardson error at 100 (GCI) | v3 (probe) at 25/50/100 |
|---|---|---|---|---|---|
| Q | 8.94 | 10.34 | 10.51 | 0.024 (0.28 %) | 7.90 / 10.64 / 11.16 |
| T_ped [keV] | 5.12 | 3.74 | 3.61 | 0.013 (0.45 %) | (pedestal spans 3 cells) |
| l_i(3) | 0.692 | 0.724 | 0.737 | 0.008 (1.3 %) | |
| f_bs | 0.232 | 0.230 | 0.2303 | oscillatory (2.6 %) | |

| dtMax [s] (nRho 50) | 0.5 | 0.05 | 0.01 | v3 |
|---|---|---|---|---|
| Q | 10.34 | 10.40 | 10.47 | 10.64 -> 11.22 as dt is refined |
| T_ped [keV] | 3.739 | 3.757 | 3.773 | |
| steps | 10408 | 13066 | 41481 | |

The spread of Q over the grid series shrank from 41 % to 18 % (the GS and geometry fixes), but the coarse
grid is still far off (T_ped 5.1 keV at 25 cells against 3.6 at 100: the pedestal still spans about three
cells) and Q keeps drifting with the time step (+1.3 % from 0.5 s to 0.01 s, error estimate 2 % at
0.01 s). The `cgm` mode still takes 12-37 s in the smoke test. All of it is the WS3 solver work of Wave 2
(non-uniform grid, BDF2/TR-BDF2, Newton, event localisation). `bench:perf` was not run (its baseline
`bench/perf-baseline.json` was recorded under load and must be re-recorded on an idle machine).

**D5 GS force balance.** `src/physics/equilibrium/gs.test.ts` (19 tests): "table (transport-coupling) mode
meets I_p through FF' alone: for <j_phi/R> scaled by 0.8 and 1.1 the field balances the given pressure",
"force-balance measures flag a pressure the field does not hold (the pre-v4 table-mode state)",
"warns when the current table needs |currentScale - 1| > 0.1", "transport coupling through a stale
geometry (MAST-U-like)", shape mode "meets a beta_p target and reports it met; beta_p > 1 needs beta0 > 1"
and "flags an unreachable beta_p target instead of failing silently", GSGrid "fills the exterior with
bounded values through one recorded plan (no blow-up at NR = 129)" and "shares factorised grids through a
bounded per-worker LRU cache" (the 16-32 ms per call plan rebuild), Anderson mixing "reaches the same
equilibrium in far fewer iterations", the exact nonlinear Solov'ev solution at second order,
`equilibrium.test.ts` (Cerfon-Freidberg, manufactured solution).

**D6 Validation false-pass, CLI exit codes.** `src/cli/cli.test.ts` (15 tests, spawned processes): "unknown
--only id -> exit 2, listing the valid ids" (v3 printed PASSED), "non-integer --threads -> exit 2" and
"--threads 0" (v3 exited 0), "unknown flag", "a selection without literature checks -> exit 1", "an
undocumented failure fails the run (exit 1) and is counted apart from the known failures", "documented known
failures are reported as KNOWN-FAIL ... unexpected passes as XPASS"; `cli/args.test.ts` (12, strict flag
parser), `cli/pool.test.ts` (19) and `cli/pool.shutdown.test.ts` (11: hung, crashed, aborted, SIGINT),
`cli/exitStress.test.ts` (16 runs, 8 at a time, expected exit code 0 or 1, no signal),
`validation/references.test.ts` (17: "every preset has at least one check", accept ranges follow the stated
policy, every check is cited with a DOI, metric paths exist in the golden keys), `primarySources.test.ts`,
`v4checks.test.ts`, `cli/releaseCheck.test.ts`. The 10 of 21 presets that were "checked only for finiteness"
now all have literature checks (42 checks over 21 presets). Coverage of `magnetic.ts`: 8 % -> 99 %. A CI
workflow exists (`.github/workflows/ci.yml`, Linux and Windows, Node 20/22/24) and has never run: local only.
Still open from D6: the 1.5D tau_E is imposed by the PI controller in 'scaling' mode and NIF still relies
on `ICF_CAL` (Wave 2, WS6 and validation v2).

**D7 Determinism.** `src/physics/kernel/determinism.test.ts` (33 tests, 58 s): "chunk invariance: any
advance() schedule equals runAll() bitwise" (v3: Q_sci_max 15.935 vs 15.854 chunked), "exact rewind" (JET,
DIII-D, NIF, Z, TAE, MIRROR at 25/50/75 %; ITER and W7-X including the event list; a disrupted shot before,
at and after the disruption; final-frame rewind), "actuator log" (random interventions replayed bitwise),
"user breakpoints", `determinism15.test.ts` (9 tests, 51 s), `kernel/integrator.test.ts` (13: order 5,
`nonNegative` array form clamps exactly the listed components, "raises NonFiniteStateError at dtMin and
leaves y unchanged", snapshot/restore continues bitwise, FSAL bitwise), `kernel/signature.test.ts`,
`fingerprint.test.ts`, `sha256.test.ts`. Both integrator latent bugs from the roadmap (no-op
`nonNegative` array, NaN accepted at dtMin) are regression tests.

**D8 (publication, WS9; not a D1-D7 criterion).** `plot/pdf.test.ts`, `ttf.test.ts`, `registry.test.ts`,
`cli/provenance.test.ts`, `plot/exportFigures.test.ts`: embedded STIX Two subsets, registry, provenance
manifest, `figures --check` (which cannot pass until the manifest exists, see section 1).

## 4. What each lane changed

Merged into `v4/integration` in this order (merge commit): ws5 (`d7be5ed`), ws10 (`887c952`), ws4
(`af38dbe`), ws1b (`7433bff`), ws9 (`652d5e8`), ws2a (`a39bf0f`), ws2b (`4c50fca`), ws3 (`b5b8cf1`), ws5b
(`4c0fdb7`), ws1c (`7dedb89`), ws3d (`0451434`); at the start of the gate 220 commits and 291 files
(+32.9k/-8.0k lines, of which 87 test files +11.6k) separated `v4/integration` from the v3 baseline `3d04e96`; tests grew from 95 (Day 0) to 944 (v3.0.0: 44).

- **ws5, deterministic kernel (6 commits).** Chunk-invariant runs (the wall-clock chunking no longer
  truncates integrator steps), exact rewind with model checkpoints, actuator log, breakpoints, run
  fingerprint with a pure-TS SHA-256 and canonical serialisation; integrator fixes (array-form
  `nonNegative` clamps, non-finite trial stages are rejected, NaN never accepted at dtMin,
  snapshot/restore). Moves no golden number.
- **ws10, web UI foundation (17).** External state store, worker protocol v2 with frame batching, `useSim`
  fixes, i18n scaffold (typed `t(key, params)`, EN and TR dictionaries, report and comparison screens), run
  screen split into panels, wizard fixes (blank numeric field, RUN blocked while a required field is empty),
  worker refuses non-integrable runs and stops on NaN, error boundary, jsdom tests with an in-process
  FakeWorker. Moves no golden number.
- **ws4, Grad-Shafranov (13).** Table mode meets I_p through FF' only (p' was rescaled with FF': reported
  p, beta_p and W_th were 9-25 % out of force balance while `converged=true`), closed-form beta0 (beta0 > 1
  allowed), bounded 8-layer exterior fill, interior-only LU, Anderson-accelerated Picard, saddle-free axis
  search, `Equilibrium.warnings` and a public force-balance evaluator, banded-LU speed-up, grid cache capped
  at 64 MB. Moves the nine 1.5D goldens.
- **ws1b, tooling (15).** Pool with per-task timeouts, AbortSignal/SIGINT cancellation, crash recovery;
  the typed literature reference table (`validation/references.ts`, value, uncertainty, DOI, accept range,
  kind, known-failure notes) and the rewritten `validate` (`KNOWN-FAIL`, `--markdown`, `--list`, `--kind`,
  `--timeout`, `--checks FILE`); `release:check`; strict type-check ratchet (`typecheck:strict`); v8 coverage
  with per-directory thresholds; GitHub Actions workflow and Dependabot config (local only); ITER15
  convergence bench with Richardson estimates and the preset perf bench; `RELEASING.md`.
- **ws9, publication engine (8).** Pure-TS TrueType parser and subsetter, embedded STIX Two fonts in PDF
  (rho, beta, alpha, tau, Delta no longer vanish), `hmtx` text layout, mathtext and axis fixes, figure
  registry, pooled figure verification, provenance manifest, `figures --check`. Moves no golden number.
- **ws2a, 0D reference and property tests (19).** Seeded property-testing helper with shrinking; reference
  packs for Bosch-Hale/Nevins-Swain/beam-target reactivity, confinement scalings, radiation, geometry,
  heating, limits, disruption; conservation invariants of short preset runs (84 tests); numerics property
  tests; wizard property smoke test over every option combination; `mutation-smoke`; the `BUG(ws2a)` pins
  (7 remain; the integrator, ELM-frame and blank-default pins have flipped).
- **ws2b, 0D physics correctness (34).** D1 (separate alpha and beam pools with their own Stix E_c, G(x) and
  tau_s; P_alpha = charged-product heating only; ignition = P_alpha >= P_rad + W/tau_E without the Q guard;
  fast pressure in beta_T, beta_N; NTMs seeded from the thermal beta_N) and D2 (D-D slot split and D-3He side
  reactions, ICF with the selected fuel and Q_eng without double coupling, tandem mirror plugging,
  `heating.autoOff`), plus the consistency pass: loss power P_L = P_heat - P_rad,core - dW/dt for tau_E and
  the L-H test, Martin threshold with the Ryter 2014 low-density branch at the line-averaged density,
  tau_E scalings at the line-averaged density, sawtooth crashes without double-counted losses, ELM-averaged
  power as a fraction (0.3) of W/tau_E, blanket multiplication on the neutron share only, e-i equilibration
  over all ions, low-aspect-ratio q95 (Sauter 2016), explicit H_ISS04, T_max and score without the start-up
  transient, ITPA20 and ITPA20-IL scalings, MagLIF stagnation width, FRC and mirror thermal energy with
  n_i != n_e, finite rates for any finite state. Moves every 0D magnetic golden and the 1.5D report keys.
- **ws3, 1.5D integrity and decomposition (29).** D3 (a)-(d) fixes, typed GS failures, GS retry ladder,
  atomic full-state checkpoints, `cgm` tau_E = W/P_loss, guarded initial equilibrium; `model.ts` split into
  focused modules with `SourceModel`/`TransportModel`/`EventModel` plug-in interfaces (bit-identical),
  `P_bound` diagnostic, cell volumes from a spline of V(rho^2), energy-conserving sawtooth crash, developer
  README. Moves the nine 1.5D goldens.
- **ws5b, kernel follow-ups (7).** Frames recorded at a type-I ELM crash carry the diagnostics of their own
  post-crash state (the run itself is bitwise unchanged); `rhs()`/`integratorOpts` optional for models with
  their own `step()` (typed `ModelContractError`, `modelFactory`); FSAL stage reuse (bitwise neutral, 14 %
  fewer rhs evaluations for pulsed models and W7-X, 5 % ITER, about 1 % for ELM tokamaks); the terminal-frame
  and set-point contract; determinism tests that yield to the event loop. Moves the nine 0D ELM goldens
  (frame-weighted flat-top means and maxima only).
- **ws1c, tooling follow-ups (6).** The worker pool settles only after every worker thread has stopped;
  `golden:update --reason-file` and labelled moved/added/removed key lists in the ledger; coverage harness
  (a setup file that waits a few real milliseconds before each test, ending the "Timeout calling
  onTaskUpdate" exit-1; type-only modules excluded by name; thresholds ratcheted); the ITPA20/ITPA20-IL
  coefficients checked against Verdoolaege et al. 2021; new literature checks (`MASTU.q95`, `DIIID.Palpha`,
  `*.alphaShare`, `ITER.nG`); exit-status stress test and `stress:exit` soak; `checkLimits` removal (`d1d0784`).
  Moves no golden number.
- **ws3d, 1.5D parity with the ws2b physics (17).** Fusion and NBI sources per channel as in 0D, loss
  power P_L = P_heat - P_rad,core - dW/dt and the Ryter L-H threshold in 1.5D, ignition without the Q guard
  and the `ignited` diagnostic, `heating.autoOff` in 1.5D, fast-ion pressure in beta and thermal beta_N, the
  fast-ion energy as a pool that builds up with tau_W, cell volumes from the integral of V', blank profile
  settings keep their default, only typed numerical failures are retried, enforced checkpoint contract,
  atomic implicit step (an error puts y and the context scalars back). Moves the nine 1.5D goldens.
- **Integrator commits (38 non-merge commits on `v4/integration`).** Merge fix-ups and: the 0D ignition state ends at
  the disruption onset (`d95d734`), typed `SingularMatrixError` for the linear algebra (`63f4939`),
  the `BLANK_DEFAULTS_FIXED` switch removed (`2cddfd1`), the loss-power docs (`0803844`), the changelog
  lines of ws3 and ws3d, the strict baseline, the export-figures cleanup-timer race (`6ec915d`).

## 5. Before and after: headline numbers

"v3" = `test/golden` at `3d04e96` (the v3.0.0 physics), "now" = `test/golden` at the gate. Flat-top values
are frame-weighted means over the last 20 % of the run (the golden definition). Cause codes: **b**
`ws2b` (D1 pools/ignition, D2 fuels, the 0D consistency pass), **e** `ws5b` (ELM frame diagnostics),
**g** `ws4` (GS), **s** `ws3` (1.5D integrity and cell volumes), **d** `ws3d` (1.5D parity), **i**
integrator commit; the ledger entries with the full bisected numbers are in `test/golden/CHANGES.md`.

### 5.1 0D presets

| Case, quantity | v3 | now | Change | Cause |
|---|---|---|---|---|
| **ITER** Q_sci_max | 15.94 | 13.40 | -15.9 % | b (13.69), e (13.40) |
| ITER flat-top Q | 13.98 | 10.13 | -27.5 % | b: loss power with core radiation and dW/dt (bisected: -38 % E_fus), ELM power 0.3 W/tau_E (-4 %), tau_E and L-H at the line-averaged density (+30 %); e: ELM-frame flat-top bias (10.42 -> 10.13) |
| ITER flat-top P_fus | 715.5 MW | 523.4 MW | -26.8 % | b, e (538.3 -> 523.4) |
| ITER E_fus (report) | 270.2 GJ | 207.1 GJ | -23.4 % | b (the report scalar is bitwise unchanged by e) |
| ITER ignition time | 385.6 s | **0 s** | | b (D1): v3 counted about 32 MW of NBI slowing-down power as alpha power; the spurious IGNITION event at 14.5 s, 2 burn_end and 2 burn_start events and the H-L transition are gone |
| ITER flat-top P_alpha | 172.9 MW | 107.0 MW | -38.1 % | b (beams now `P_beam_heat`) |
| ITER W_f (fast ions) | 81.8 MJ | 20.9 MJ | -74.5 % | b: separate alpha and beam pools with their own tau_s |
| ITER beta_N | 1.87 | 1.68 | -10.3 % | b: fast pressure added (thermal 1.59), lower thermal energy |
| ITER n/n_G | 0.82 | 0.92 | | b: line average of the same 1.0e20 volume-average target |
| ITER Q_eng | 1.66 | 1.24 | -25.3 % | b (blanket on the neutron share only), e |
| **JET** E_fus | 58.3 MJ | 64.2 MJ | +10.0 % | b (validation reference 59 +/- 6 MJ: PASS) |
| JET beam-target share of P_fus (P_bt/P_fus) | 0.759 | 0.730 | -3.8 % | b: the share itself is a property of JET's NBI-dominated heating; D1 fixed the pool (W_f 6.16 -> 1.62 MJ, -74 %) and P_alpha (31.0 -> 2.45 MW; beams 28.8 MW booked separately) |
| JET flat-top Q / P_fus | 0.354 / 11.8 MW | 0.369 / 12.3 MW | +4.2 % | b, e |
| **SPARC** flat-top Q / P_fus | 6.92 / 181.8 MW | 6.59 / 173.5 MW | -4.8 % / -4.5 % | b, e |
| SPARC P_alpha | 35.95 MW | 34.69 MW | -3.5 % | b |
| **DEMO** flat-top Q / P_fus | 21.8 / 2193 MW | 20.1 / 2025 MW | -7.7 % / -7.6 % | b, e; ignition time 575.9 -> 0 s, spurious ignition and burn_end events gone |
| DEMO P_alpha | 479 MW | 411.7 MW | -14.0 % | b |
| **DIII-D** P_alpha | 11.66 MW | **0.0023 MW** | -100 % | b (D1): D-D charged products only, beams 11.67 MW separate |
| DIII-D P_fus / neutron yield | 3.82e-3 MW / 1.90e16 | 3.46e-3 MW / 1.77e16 | -9.4 % / -6.9 % | b, e |
| **JT-60SA** flat-top Q / P_fus | 3.00e-3 / 0.123 MW | 2.92e-3 / 0.120 MW | -2.6 % | b, e; P_alpha 33.3 -> 0.080 MW; score 35 -> 34 |
| **MAST-U** q95 (0D preset) | 34.3 | 18.2 | -47 % | b: Sauter (2016) low-aspect-ratio fit. Still a **known failure** (accepted 5-10): the preset geometry, not the fit (ws1c) |
| MAST-U beta_N | 3.39 | 4.06 | +20 % | b: fast pressure |
| **W7-X** P_fus / T_max | 4.94e-5 MW / 2.26 keV | 4.72e-5 MW / 2.00 keV | -4.5 % | b: core-radiation loss power, n-bar in ISS04, start-up window excluded from T_max |
| **NIF** gain G | 1.489 | 1.489 | 0 | unchanged (indirect drive keeps its `ICF_CAL`) |
| NIF Q_eng | 0.0164 | **0.0595** | x3.6 | b (D2): the driver coupling was counted twice |
| DIRECT Q_eng | 0.186 | 0.124 | -33 % | b (same fix; gain G 3.1 vs 0.3-1.76: known failure) |
| **Z (MagLIF)** D-D yield | 3.00e15 | **2.00e14** | -93 % | b: physical stagnation width (2 ns instead of about 30 ns); reference 1.1e13 (Gomez 2020), still 18x above: **known failure** (v3 273x) |
| **MIRROR** Q_sci_max / tau_E / T_max | 2.4e-4 / 8.25 ms / 5.0 keV | 1.8e-3 / 16.4 ms / 9.5 keV | x7.4 | b (D2): Pastukhov plug factor 2.81 (v3 tandem was below the simple mirror); T_e 9.5 keV vs 0.66 keV: **known failure** (single-temperature model) |
| MIRROR-DHe3 E_fus / neutrons | 9.1e-8 MJ / 0 | 1.4e-5 MJ / 5.7e12 | x157 | b: plug factor and D-D side channels |
| TAE-pB11 P_fus | 2.2e-26 MW | 2.2e-25 MW | x10 | b: FRC energy W = 3/2 (n_e + n_i) T V |
| ITER-DHe3 P_fus / neutrons | 0.90 MW / 0 | 0.14 MW / 1.3e18 | -85 % | b: D-D side channels of D-3He, v3 P_cond clipping artefact |
| ITER-pB11 | runs 100 s | **radiative collapse at 28.2 s** | | b: removal of a v3 artefact (ELM power 0.3 P_heat was 5.5x the whole transport loss); the collapse follows from the density ramp, not from the ELM model (`regress/pb11Collapse.test.ts`); a marginal power balance (0.85e20 target survives) |
| FRXL, GF, MUON, TAE, ZAP | | | bit-identical | |

ITER 0D events: ELM 1816 -> 1310, sawtooth 259 -> 240, LH 2 -> 1. ELM counts of the other ELM presets
moved by -28 % to +21 % (JET 188 -> 169, SPARC 191 -> 141, DEMO 2280 -> 1819, DIII-D 233 -> 281), all from
the b loss-power change. Validation of the changed 0D values: ITER Q 10.1 and P_fus 523 MW are inside the
accepted ranges 5-20 and 300-800 MW (reference 10 and 500 MW); v3's 14.0 and 715 MW were accepted only by
the wide v3 range.

### 5.2 1.5D presets (flat-top means, ITER15 is the 400 s baseline)

| Case, quantity | v3 | now | Change | Cause |
|---|---|---|---|---|
| **ITER15** Q | 9.755 | 10.34 | +6.0 % | g 9.766; s 9.744; d: P_L = P_heat - P_rad,core - dW/dt (P_L 117 -> 130 MW, tau_E 2.55 -> 2.36 s) |
| ITER15 P_fus | 490.6 MW | 519.8 MW | +5.9 % | d |
| ITER15 f_bs / l_i(3) | 0.2234 / 0.7255 | 0.2300 / 0.7243 | +2.9 % / -0.2 % | d (validation refs 0.2 +/- 0.05 and 0.85 +/- 0.15: PASS) |
| ITER15 T_ped | 3.700 keV | 3.739 keV | +1.1 % | d; still below the 4.5 +/- 0.5 keV reference (accepted 2-7) and grid-dependent (section 3, D4) |
| ITER15 q95 / q(0) | 3.475 / 1.061 | 3.479 / 1.031 | +0.1 % / -2.8 % | s: cell volumes (q(0) -2.4 %) |
| ITER15 beta_N | 1.481 | 1.716 | +15.8 % | d: fast-ion pressure (thermal 1.52, W_f 38.4 MJ) |
| ITER15 GS updates accepted / rejected | (all accepted) | 25 / 0 | | s |
| ITER15 ELMs / sawtooth crashes | 1022 / 25 | 1101 / 38 | +7.7 % / +52 % | s: cell volumes lower q(0), the q = 1 shear threshold is reached earlier (period 16 -> 10.5 s; count stable to +/- 1 over seeds); d: ELM phase. L-H transition 6.5 -> 8.5 s (d, Ryter branch) |
| ITER15 Q_sci_max | 16.02 | 16.23 | +1.3 % | |
| **JET15** Q / P_fus | 0.4355 / 14.44 MW | 0.4413 / 14.64 MW | +1.3 % | s, d |
| JET15 f_bs / l_i / T_ped / q95 | 0.2403 / 0.7636 / 1.679 keV / 3.699 | 0.2477 / 0.7617 / 1.679 keV / 3.690 | +3.1 % / -0.2 % / 0 / -0.2 % | s |
| JET15 q(0) | 0.983 | 1.400 | +42 % | s: the geometry now follows the plasma (equilibrium frames 4 -> 15) |
| JET15 GS updates accepted / rejected | 3 of 17 (14 dropped silently) | 14 of 15 (3 after a retry), 1 rejected | | s (D3b) |
| JET15 ELMs | 148 | 146 | -1.4 % | |
| JET15 E_fusion / Q_sci_max | 84.6 MJ / 1.231 | 82.3 MJ / 0.981 | -2.6 % / -20 % | d: dW/dt in P_L makes the ramp follow tau_E; validation `JET15.Efus` (40-80 MJ) stays a **known failure** at 82.3 |
| **SPARC15** Q / P_fus | 6.088 / 156.3 MW | 6.319 / 162.1 MW | +3.8 % | d |
| SPARC15 f_bs / l_i / T_ped / q95 | 0.1908 / 0.7337 / 4.751 / 4.163 | 0.1939 / 0.7389 / 4.845 / 4.166 | +1.6 % / +0.7 % / +2.0 % / +0.1 % | d |
| SPARC15 q(0) | 0.942 | 0.899 | -4.6 % | s (cell volumes) |
| SPARC15 GS updates accepted / rejected | (all) | 30 / 0 | | |
| SPARC15 ELMs | 6 | 0 | | d: L-H transition 0.81 -> 1.50 s (Ryter branch), shorter H-mode window |
| **DEMO15** Q / P_fus | 22.72 / 2268 MW | 23.26 / 2322 MW | +2.4 % | d |
| DEMO15 f_bs / l_i / T_ped / q95 | 0.4217 / 0.7453 / 4.185 / 4.920 | 0.4283 / 0.7445 / 4.198 / 4.927 | +1.6 % / -0.1 % / +0.3 % / +0.1 % | d |
| DEMO15 q(0) | 1.478 | 1.645 | +11 % | s (hollow current profile), ELM-cycle phase |
| DEMO15 GS updates accepted / rejected | 25 of 30 (5 dropped) | 31 / 0 | | s (D3b) |
| DEMO15 ELMs / beta_N | 1076 / 2.22 | 1095 / 2.80 | +1.8 % / +26 % | d |
| **DIII-D15** Q / P_fus | 2.94e-4 / 4.42e-3 MW | 2.95e-4 / 4.44e-3 MW | +0.4 % | |
| DIII-D15 P_alpha | 4.08e-3 MW | 2.93e-3 MW | -28 % | d: beam-target reactions split between D(d,p)T and D(d,n)3He; neutron yield x4.1 (2.7e15 -> 1.1e16; the v3 model booked them all on the neutron-free branch) |
| DIII-D15 f_bs / l_i / T_ped / q95 / q(0) | 0.3094 / 0.8054 / 0.630 / 5.931 / 1.112 | 0.3116 / 0.8057 / 0.630 / 5.913 / 1.398 | +0.7 % / 0 / 0 / -0.3 % / +26 % | s |
| DIII-D15 GS updates accepted | 4 of 9 | 9 of 9 | | s (D3b) |
| DIII-D15 ELMs / beta_N | 250 / 1.68 | 251 / 2.13 | +0.4 % / +27 % | d |
| **MAST-U15** (documented poor case) Q | 1.87e-4 | 1.95e-4 | +4.3 % | not validated, do not quote |
| MAST-U15 f_bs / l_i / T_ped | 0.541 / 0.726 / 0.129 keV | 0.435 / 0.774 / 0.119 keV | -20 % / +6.6 % / -7.7 % | s: the geometry follows the plasma (v3 kept the beta_p = 0.1 start-up equilibrium all shot); d: GS ladder branch |
| MAST-U15 q95 / q(0) | 19.7 / 2.38 | 17.6 / 2.76 | -11 % / +16 % | s, g, d |
| MAST-U15 GS updates accepted / rejected | 0 of 7 (all dropped) | 4 of 7 (1 after a retry), 3 rejected | | s: an update whose current table needed rescaling by > 50 % is rejected (the ws4 solver converges stale-geometry tables with c = 2 that end the shot in a beta-limit disruption at 1.06 s) |
| MAST-U15 ELMs / neutron yield / beta_N | 203 / 7.4e13 / 2.79 | 200 / 1.5e15 / 4.18 | -1.5 % / x21 / +50 % | d: D-D beam-target correction and fast pressure |
| SPARC15-short (3 s) Q | 6.536 | 5.174 | -20.8 % | d: dW/dt in P_L (its flat-top window is still the ramp-up); T_ped -11.5 %, f_bs -12.3 %, E_fus 272 -> 189 MJ |
| SPARC15-DHe3 Q / T_ped | 0.0138 / 2.05 keV | 0.0034 / 1.12 keV | -75 % / -45 % | d: no H-mode any more (P_L 23.1 < P_LH 26.0 MW) |
| SPARC15-pB11 Q | 5.18e-5 | 5.39e-5 | +4.0 % | d |
| 1.5D T_max and score | ITER15 64.7 keV | 28.7 keV | | b: start-up transient excluded (report-only) |

No golden case has an ignited frame (`ignited` = 0 in every frame of every case, 0D and 1.5D): the golden
files do not guard the ignition path, which the tests in section 3 (D1) do.

## 6. Validation table (`npm run validate -- --markdown`)

35 of 42 checks are within the accepted range, 7 are documented known failures, 0 are unexpected. (v3.0.0:
19 checks, 8 of them 1.5D; 10 of 21 presets were checked only for finiteness.)

| Check | Metric | Reference | Accepted | Model | Status | Source |
|---|---|---|---|---|---|---|
| `ITER.Q` | Q (flat-top avg.) | 10 | 5-20 | 10.1 | PASS | Shimada 2007 |
| `ITER.Pfus` | P_fusion (flat-top) | 500 MW | 300-800 MW | 523 MW | PASS | Shimada 2007 |
| `ITER.H98` | H98(y,2) (flat-top) | 1 | 0.748-1.34 | 1.1 | PASS | ITER Physics Basis 1999 |
| `ITER.nG` | n/n_G (flat-top) | 0.85 | 0.6-1 | 0.915 | PASS | Shimada 2007 |
| `ITER.alphaShare` | P_alpha / P_fusion | 0.2 | 0-0.21 | 0.204 | PASS | ITER Physics Basis ch. 1, 1999 |
| `JET.Efus` | E_fusion | 59 +/- 6 MJ | 40-80 MJ | 64.2 MJ | PASS | Maslov 2023 |
| `JET.alphaShare` | P_alpha / P_fusion | 0.2 | 0-0.21 | 0.199 | PASS | ITER Physics Basis ch. 1, 1999 |
| `SPARC.Q` | Q (flat-top avg.) | 11 | 2-20 | 6.59 | PASS | Creely 2020 |
| `SPARC.alphaShare` | P_alpha / P_fusion | 0.2 | 0-0.21 | 0.2 | PASS | ITER Physics Basis ch. 1, 1999 |
| `DIIID.H98` | H98(y,2) (flat-top) | 1 | 0.748-1.34 | 0.883 | PASS | ITER Physics Basis 1999 |
| `DIIID.Palpha` | P_alpha, D-D charged products | 0.0225 MW | 0-0.0225 MW | 0.0023 MW | PASS | Lazarus 1997 |
| `JT60SA.W` | W_th (flat-top) | 22 (21.2-23.3) MJ | 15.8-31.2 MJ | 20.2 MJ | PASS | Garzotti 2018 |
| `JT60SA.tauE` | tau_E (flat-top) | 0.64 (0.52-0.64) s | 0.389-0.856 s | 0.472 s | PASS | Garzotti 2018 |
| `MASTU.H98` | H98(y,2) (flat-top) | 1.15 +/- 0.15 | 0.748-1.74 | 1.21 | PASS | Harrison 2024 |
| `MASTU.q95` | q95 (flat-top) | 7.5 (5-10) | 5-10 | 18.2 | **KNOWN-FAIL** | Berkery 2023 |
| `W7X.Ti0` | T_i(0) (flat-top) | 1.5 +/- 0.2 keV | 0.91-2.21 keV | 1.99 keV | PASS | Beurskens 2021 |
| `DEMO.Pfus` | P_fusion (flat-top) | 2000 MW | 1000-3000 MW | 2020 MW | PASS | Federici 2019 |
| `DEMO.alphaShare` | P_alpha / P_fusion | 0.2 | 0-0.21 | 0.205 | PASS | ITER Physics Basis ch. 1, 1999 |
| `ITER15.Q` | Q (flat-top avg.) | 10 | 5-20 | 10.3 | PASS | Shimada 2007 |
| `ITER15.Pfus` | P_fusion (flat-top) | 500 MW | 300-800 MW | 520 MW | PASS | Shimada 2007 |
| `ITER15.fbs` | Bootstrap fraction | 0.2 +/- 0.05 | 0.1-0.4 | 0.23 | PASS | Sips 2005 |
| `ITER15.li` | l_i(3) | 0.85 +/- 0.15 | 0.6-1.1 | 0.724 | PASS | Shimada 2007 |
| `ITER15.q95` | q95 | 3 | 2.7-4 | 3.48 | PASS | Shimada 2007 |
| `ITER15.Tped` | T_e pedestal | 4.5 +/- 0.5 keV | 2-7 keV | 3.74 keV | PASS | Snyder 2011 |
| `ITER15.nG` | n/n_G | 0.85 | 0.6-1 | 0.805 | PASS | Shimada 2007 |
| `JET15.Efus` | E_fusion | 59 +/- 6 MJ | 40-80 MJ | 82.3 MJ | **KNOWN-FAIL** | Maslov 2023 |
| `JET15.Ti0` | T_i axis | 10 keV | 6-15 keV | 10.2 keV | PASS | Maslov 2023 |
| `SPARC15.Q` | Q (flat-top avg.) | 11 | 2-20 | 6.32 | PASS | Creely 2020 |
| `DEMO15.Pfus` | P_fusion (flat-top) | 2000 MW | 1000-3000 MW | 2010 MW | PASS | Federici 2019 |
| `DEMO15.fbs` | Bootstrap fraction | 0.35 | 0.2-0.6 | 0.375 | PASS | Siccinio 2020 |
| `NIF.G` | Gain G | 1.5 | 1-3 | 1.49 | PASS | Abu-Shawareb 2024 |
| `DIRECT.G` | Gain G | 0.74 +/- 0.14 | 0.3-1.76 | 3.1 | **KNOWN-FAIL** | Gopalaswamy 2024 |
| `Z.yield` | D-D neutron yield | 1.10e13 | 3.66e12-3.30e13 | 2.00e14 | **KNOWN-FAIL** | Gomez 2020 |
| `Z.Ti` | T_i (burn-averaged) | 3.1 keV | 2.17-4.03 keV | 3.17 keV | PASS | Gomez 2020 |
| `GF.Tmax` | T_max (compressed) | 6.46 keV | 0.3-6.46 keV | 1.41 keV | PASS | Lindemuth 1983 |
| `FRXL.Tmax` | T_max (compressed) | 6.46 keV | 0.3-6.46 keV | 1.43 keV | PASS | Lindemuth 1983 |
| `ZAP.Te` | T_e (flat-top) | 2 +/- 1 keV | 0.7-3.9 keV | 1 keV | PASS | Levitt 2024 |
| `TAE.Te` | T_e (flat-top) | 0.5 keV | 0.25-1 keV | 0.606 keV | PASS | Gota 2021 |
| `TAE.Ttot` | T_e + T_i (flat-top) | 3 keV | 1.5-6 keV | 1.21 keV | **KNOWN-FAIL** | Gota 2021 |
| `MIRROR.Te` | T_e (flat-top) | 0.66 +/- 0.05 keV | 0.33-1.8 keV | 9.53 keV | **KNOWN-FAIL** | Bagryansky 2015 |
| `MUON.Yf` | Fusions per muon | 150 +/- 20.4 | 109-191 | 106 | **KNOWN-FAIL** | Jones 1986 |
| `MUON.Q` | Q_scientific | 0.528 | 0-0.99 | 0.375 | PASS | Jones 1986 |

Known failures and their documented reasons (all in `src/physics/validation/references.ts`; each turns into an
XPASS error if a change fixes it, so the note must then be reworded): `MASTU.q95` (the preset geometry, R 0.85
m, a 0.65 m, kappa 2.5, gives 18.2 by the Sauter fit, 6.6 for the typical campaign shape); `JET15.Efus` (the 1.5D
model over-predicts the record pulse by about 40 %, beam-target fusion with T_i(0) near 10 keV; 82.3 MJ is
only 3 % above the range, so a small change can flip it to XPASS); `DIRECT.G` (laser-plasma instabilities,
preheat and imprint are not modelled); `Z.yield` (ideal compression, no liner-fuel mixing, 18x too high);
`TAE.Ttot` (single-temperature FRC); `MIRROR.Te` (single-temperature mirror, real ones are limited to about 1
keV by axial electron cooling); `MUON.Yf` (effective sticking or cycling rate).

## 7. Test inventory

944 tests in 94 files at the gate run (946 in 95 after the gate's own bench test), by directory (files / tests):
`src/physics/reference` 10 / 210 (ws2a: reference packs, invariants, numerics properties, wizard smoke), `regress` 21 / 77
(0D regression tests), `profiles` 14 / 164 (1.5D), `kernel` 7 / 102, `equilibrium` 4 / 38, `validation` 4 / 37,
`numerics` 1 / 20, `analysis` 1 / 6, `src/cli` 7 / 73, `src/plot` 7 / 77, `src/regression` 2 / 27 (golden harness and
ledger), `src/ui` 9 / 76 and `src/worker` 1 / 12 (jsdom, FakeWorker), `src/i18n` 1 / 4, `src/testing` 2 / 13, and three
single-file suites (coverage config 2, vitest setup 4, `bench/richardson` 2). Long tests: `integrity.test.ts` 74 s,
`determinism.test.ts` 58 s, `determinism15.test.ts` 51 s, `transport.test.ts` 38 s, `cli.test.ts` 38 s (with coverage
the whole suite takes 196 s wall on 12 cores).

Appendix A lists the 7 `it.fails` pins that remain.

## 8. What the gate changed

Only the following commits were made on `v4/integration` (the last row is this report) (no physics number moved: golden matches without a
re-record):

| Commit | Change |
|---|---|
| `d245073` fix(bench) | `bench:convergence`: the time-step series failed for all three dtMax values ("this model has no internal time step to limit") because the limiter patched a private numeric `dt` of the 1.5D model, which the `model.ts` split moved to `ctx.dt`. New `bench/limitStep.ts` (uses `ctx.dt`) with `bench/limitStep.test.ts` (a capped 3 s ITER15 shot takes at least 1500 steps; a 0D model is refused). The study runs again (section 3, D4) |
| `9297a7d` test | dropped the `INTEGRATOR_FIXED` switch (constant true since ws5's `dafd2bf`), `src/testing/pinUntil.ts` and `knownBugs.ts`; the two integrator pins and the NaN-step-size wizard cases are plain regression tests |
| `953443d` docs | profiles README and CHANGELOG: `StepConstants.btR` is one array per channel (`K.btR[j][i]`), a plug-in written for the v3 single array reads `undefined`; `test/golden/CHANGES.md` addendum (append-only, no golden file changed) with the T_ped, f_bs, ELM/sawtooth/GS-update moves of the nine 1.5D cases that the 22:27 and 23:45 reasons did not list, each with its cause, and the note that no golden frame is ignited; CHANGELOG line for the bench fix |
| `e4a98ed` docs(golden) | the MASTU15 neutron factor of that addendum is x59 (measured on the final goldens), not the lane's earlier x53 |
| (this report) | `docs/v4-wave1-report.md` |

Not changed on purpose: `kernel/testkit.ts` `tick()` and `testing/yielding.ts` `tick()` look like duplicates
but differ (testkit's captures `setImmediate` at load and survives fake timers), so they stay; README and
technical-report numbers, figures and the CHANGELOG backfill are Wave 3.

**After the gate's own fixes** (final `HEAD` before this report; commands as in section 1):

| Command (second pass) | Exit | Time | Result |
|---|---|---|---|
| `npm run -s ci:local` | 0 | 139 s | tsc ok; 95 files / 946 tests; validation 35 passed + 7 known failures, 0 unexpected; golden "all 30 cases match" (no re-record) |
| `npm run -s build` | 0 | 7 s | main chunk `index-CaA4uA63.js` 244.92 kB / 82.61 kB gzip (identical hash: no production code changed) |
| `npm run -s coverage` | 0 | 196 s | 946/946; no timeout, no unhandled error; all files 90.05 % lines / 89.66 % branches / 86.68 % functions; `src/physics/**` 98.8 %, `magnetic.ts` 99.05 % |
| `npm run -s typecheck:strict` | 0 | 5 s | 42 errors in 30 files = baseline |
| `npm run -s mutation-smoke` | 0 | 40 s | 15/15 killed |
| `npm run -s release:check` | 1 | 1 s | 7 of 8; `no-todo` (CITATION.cff:15), unchanged |

The working tree was clean at the start of both passes; the golden files are untouched by every gate commit.

## 9. Open issues and cross-lane requests carried to Wave 2 and 3

Grouped by roadmap workstream. "Golden" means the item changes physics numbers and needs a re-record with a
ledger reason. Items marked (R) come from a lane's request list, (F) from a review finding, (G) from the gate.

### WS3, 1.5D solver and integrity (critical path of Wave 2)

- **Convergence (D4, G):** non-uniform grid (pedestal spans about 3 cells: T_ped 5.12 / 3.74 / 3.61 keV at
  25 / 50 / 100 cells), BDF2/TR-BDF2 with a Newton solve, event localisation (Q drifts +1.3 % from dtMax 0.5 to
  0.01 s); `cgm` transport is slow (12-37 s in its smoke test) and uncalibrated. Golden.
- **GS coupling (R, ws3/ws4):** an outer iteration of the current table against the new geometry (remap the
  table through the new equilibrium and re-solve) instead of accept/reject; the JET15 update at t = 0.676 s
  stalls in every ladder stage (1 rejected), MASTU15 accepts 4 of 7; the retry ladder is tuned for the old
  damped Picard and stage 2 rarely helps with Anderson; stagnation detection for hollow current at high beta_p.
  `coupling/equilibrium.ts` keeps a catch-all around `geometryFromEquilibrium`. Golden.
- **P_SOL (F, ws3d):** still uses the raw step-wise dW/dt (mean +P_ELM between crashes): 110.3 MW against the
  ELM-inclusive balance 122.0 MW on ITER15 (-9.6 %), 411.3 against 431.2 MW on DEMO15 (-4.6 %); q_div
  (26 MW/m2 on ITER15), the two-point T_sep and the tungsten source follow it. Pass `ctx.dWdtS` to `updatePsol`
  (0D uses P_heat - P_rad). Golden, together with the WS7 edge work.
- **Loss-power loop (R):** the smoothed dW/dt feeds tau_E back through P_L; the loop gain was analysed in 0D
  only (0.69), in 1.5D the nine golden cases and the tests are stable but a very fast heating switch-off was
  only tested through `autoOff` on ITER15.
- **Mode-flip frames (F, ws5b):** a frame recorded at an L-H, H-L or NTM flip that changes no state carries the
  step's pre-flip diagnostics next to a live post-flip `H_mode`: DIII-D 3 s at t = 0.11 s tau_E 0.1345 against
  0.1875 from its own state (-28 %), JET with n_target 3e20 -50 %. The fix is a refresh at the flip in `postStep`
  before `phase` can become 'ended' and an invariants test on an L-H frame. Golden (single frames).
- **Plug-in limits (R):** an `accepted` hook that fails half-way cannot restore a plug-in's own fields;
  `EquilibriumCoupling` counters other than `eqUpdates` are not restored; the aux-copy part of the checkpoint
  contract is documented but not enforceable; a 'forced' warning of a failed step is dropped and re-issued.
- **Stored-energy definition / 1.5D `ProfileModules.events` cannot replace ELM/sawtooth; `SourceModel.particles` feeds
  the electron balance only (R, ws3 carried).**
- **Frames right after an ELM or sawtooth crash (R):** diagnostics re-evaluated on the crashed profiles but the
  ignition flag of the step (tests exclude them); the frame of a disruption onset shows the fast-ion energy of
  the last normal step.

### WS4, equilibrium: correctness now, then interoperability

- **Surface table (R, G):** the default 51-surface table under-resolves the outer nodes: rho_tor of the
  outer nodes is too small (ITER15 5e-4, MASTU15 1.2e-2 at psi_N = 0.96 against a 401-surface table) and,
  beyond the volumes that ws3d fixed, the flux-surface metrics and q of the outer cells (MASTU15 g1/g2 and q
  up to 14.7 %, ITER15 g1/g2 1.2 %, q 1.05 %; g2 is the transport metric where the pedestal barrier sits).
  Default `nSurf` 101 or more (it brings ITER15 cell volumes to 0.02 % and MASTU15 to 0.5 %) or a quadrature that
  treats the X-point singularity, then re-check g1/g2/q at the outer faces. Golden.
- EQDSK (COCOS 11), shape files and the free-boundary stretch goal are Wave-2 deliverables with no Wave-1 debt.

### WS5, kernel and scenario engine

- FSAL saves little exactly where it matters (R): in ELM H-mode `MagneticModel.postStep()` re-derives
  `elmPartRate` every step (JET: 1407 of 1501 steps), so the reuse is refused; making it a state variable or
  piecewise constant changes numbers (model decision). Contract: `rhs` may depend only on (t, y, controls,
  `saveInternal()` state), and `saveInternal` must be cheap and side-effect free.
- `SimulationOptions.modelFactory` is not part of `runFingerprint()` (documented); `SimModel` cannot be made a
  compile-time union, the contract is a runtime `ModelContractError`.
- Duplicate event-loop yield helpers in tests (nit): `kernel/testkit.ts`, `testing/yielding.ts` and the setup
  file `vitest.setup.ts`; compatible, keep.
- Flat-top weighting decision (R, ws5b; also WS1): the frame-weighted flat-top mean is biased by the extra ELM
  frames (ws5b flipped the sign of the bias: ITER Q -2.8 %); `weighting: 'time'` (implemented, documented as
  unbiased) for the report, the golden flat-top and the validation table would remove it and move every
  published flat-top number once more. Decision for the integrator before the Wave-3 number reconciliation.

### WS6, physics (a pedestal, b transport closures, c current/flux/scenario, d fast ions and current drive, e impurities and He ash)

- **6d fast ions (R, ws3d):** the 1.5D pools are scalar (source-weighted tau_W), the heating by the fast ions is
  instantaneous and local (0D delays it with the same pools), there is no fast-ion transport or loss, beams are
  isotropic. 1.5D relaxes with the deposition-weighted local T_e, 0D with the volume averages (tau_W about
  1.8x longer in 1.5D; ITER15 fast share 12.6 % of W against about 7 % in 0D); consequence: DIII-D15 at
  E_NBI = 500 keV disrupts at the Troyon limit at 0.78 s in 1.5D (beta_N 3.50 = thermal 1.28 + 1.70 MJ of fast
  ions) while 0D runs to the end (2.70). Physics-owner decision; JET15 start-up beta_N peaks at 2.32 (0D 1.73).
- **6a pedestal:** ITER15 T_ped 3.74 keV against the 4.5 +/- 0.5 keV EPED-type reference (accepted 2-7) and
  grid dependent; the pedestal width and the ELM size are still the fixed 0.06 / 0.08 factors.
- **6b transport:** the 1.5D tau_E is set by the PI controller in 'scaling' mode (circular against the
  scaling laws); wire `'ITPA20'` and `'ITPA20-IL'` into `MagneticConfig.scaling` (types owner): the paper's
  delta is the average LCFS triangularity (ITER 0.48) but the presets carry the 95 % value (0.33), which lowers
  tau_E by 3.8 % (ITPA20) and 5.8 % (ITPA20-IL); the ITPA20-IL n exponent is 0.15 in the code and 0.147 in the
  accepted manuscript (0.7 % in tau_E); the header comment of `transport.ts` quotes 2.79 s for ITPA20-IL where the
  paper has 2.90 s (IL) and 3.07 s (ITPA20).
- **Ryter branch (R):** the low-density branch of P_LH (proportional to 1/n below n_min) is ws2b's assumption and
  delays the L-H transition in the ramp-ups of SPARC15 (0.8 -> 1.5 s), ITER15 (6.5 -> 8.5 s) and DEMO15 (11.9 -> 15.0 s).
- **Presets:** MASTU preset geometry gives q95 18.2 (first campaign 5-10; R 0.8, a 0.5, kappa 2.0-2.2 gives 6.6):
  turns the known failure into an XPASS; ITER and DEMO `n_target` on the line-averaged density (ITER n/n_G 0.915,
  DEMO 1.24 against a limit of 1.3, logged as a density-limit warning); ITER-pB11 is a marginal power balance
  (1.0e20 collapses at 28 s, 0.85e20 survives) and can flip with any later radiation, density-controller or
  P_L change; D-3He 0D cost per step about doubled.
- **Concept models (validation known failures):** MagLIF yield 18x above Gomez 2020 (no liner-fuel mixing),
  single-temperature FRC and mirror, muon sticking, direct-drive instabilities.
- **MASTU15** stays a documented poor case (hollow current at beta_p 1-2; its q profile and heating depend on
  which GS updates the retry ladder accepts; neutrons x21, beta_N 4.18): never quote it as validated.
- **Reference pins (Appendix A):** volume/surface of the Miller shape about 3 %, two-knot spline end slopes,
  the p-11B resonance quadrature, the D-T two-body energy split (3.5 + 14.1 MeV), W7-X density collapse without
  fuelling. Fixing each flips a pin (the fixer flips `it.fails` to `it`).

### WS7, edge/detachment, systems-lite, UQ and optimisation

- P_SOL, q_div and T_sep depend on the P_SOL item above; the derived engineering numbers of every ELM
  preset moved with the ws5b frame fix (ITER net P_electric -10 %, LCOE +11 %, EROI -7.7 %, wall load -3.6 %) and
  with ws2b (blanket multiplication on the neutron share; ICF Q_eng): re-derive systems tables from the new means.
- Two-point SOL, tungsten source and the density limit warning use volume-averaged density; check after the
  n_target re-base.

### WS8, library API, CLI, formats, Python

- The kernel contract above (fingerprint without `modelFactory`, terminal frame at the time of the last frame
  after a 1.5D numerical failure, `SimModel` with optional `rhs`) is what an API must expose.
- **Windows access violation 0xC0000005** of a spawned CLI at exit (seen twice under full parallel load; not
  reproduced in 1600+ soak runs by ws1c, nor in the gate). Next steps: `npm run stress:exit -- 300 8` under CPU
  load, the same fixture without `--import tsx` (compiled JS) to separate the tsx loader thread from the pool, a
  crash dump, or a Node upgrade test. A single red `ci:local` with exit code 3221225477 should be re-run
  before blaming a change.
- `golden:update --reason-file` and the ledger format are the pattern for long reasons on Windows (npm caps the
  command line); `CHANGES_HEADER` in `golden.cli.ts` still says only `--reason`.

### WS9, publication engine

- `docs/figures` predates the registry: no `figures.manifest.json`, so `figures:check` exits 2 (section 1).
  All nine figures depend on numbers that moved (fig02 profiles, fig03 time traces, fig04 POPCON and the 1.5D
  trajectory, fig05 validation, fig09 scan with its line-averaged axis). Regenerate once with `npm run figures`
  (never into `docs/figures` before Wave 3; a scratch `--out` first) and add `figures --check` to `ci:local`.
- Figure builders are the least covered code (4-15 % lines): the byte-identical regeneration check is their test.
- The `figures` caption "GS updates" number counts accepted updates now (`eqUpdates`); new counters
  `eqRetried`, `eqRejected`, `forcedSteps` exist.

### WS10, web product and education (UI wiring of the new diagnostics and config fields)

- **New diagnostics not yet in the charts/KPIs (R):** 0D `P_beam_heat`, `W_alpha`, `W_beam`, `ignited`, `nbar`,
  `betaN_th`, `P_loss`, `dWdt`, `P_rad_core`, `P_ei`, `P_ELM`, `P_transport` (note `P_cond` now means the
  continuous conduction only, `P_cond + P_ELM = P_transport`); 1.5D `P_beam_heat`, `P_rad_core`, `P_loss`,
  `dWdt_s`, `Wf`, `tauE_scal` are in `PROFILE_DIAGS`, while `P_bound`, `W_alpha`, `W_beam`, `betaN_th`, `ignited`
  are history keys only.
- **New config fields not in the wizard (R):** `stellarator.H_ISS04` (its live control key is `H_ISS04` instead of
  `H98`; slider added), ICF `driverEff`/`thermalEff`, mirror `plugPotential`, the ITPA20 scalings; the
  wizard has no cross-field check for a > R (the model raises the typed `EquilibriumInitFailure`; pin in
  Appendix A). `heating.autoOff` is already in the wizard schema and now works in 1.5D.
- **1.5D end reasons:** a shot can end as 'Numerical failure' or 'Equilibrium failure' (non-natural, with diagnosis
  and fix text like 'Magnet quench'); `model.diagnostics()` right after `rewindTo` returns the frame's own values.
- **Rewind events (F, ws5b):** `sim.ts` truncates the event list on 'rewound' by time (`ev.t <= m.t + 1e-12`),
  but the terminal frame of a failed 1.5D step has the time of the previous frame, so after rewinding to the
  frame before it the 'Numerical failure' end event stays; have the worker's 'rewound' message carry the kernel's
  event count and truncate by count. The UI was not audited for other uses of strictly increasing frame time.
- **Carried from the handoff:** after the i18n scaffold a saved Turkish locale flashes English on first paint;
  the 256-entry colormap LUTs are not done; lower-case Greek in math mode is now italic (deliberate);
  `bench/perf-baseline.json` was recorded under load and must be re-recorded on an idle machine.

### WS1, tooling and CI

- The CI workflow has never run (local only until "yap"); `ci:local` hard-codes unlimited vitest and `--threads 4`
  (agents on shared machines run its four steps by hand with `--maxWorkers=2` / `--threads 2`).
- Coverage thresholds were ratcheted by ws1c before ws3d and ws5b landed; measured now (section 1) they still pass
  and `src/physics/numerics/**` could be raised; re-measure at the release (`npm run coverage -- --maxWorkers=4`).
- 7 `it.fails` pins remain (Appendix A); the wizard property tests were sized by the ws2a budget.
- `release:check` `no-todo`: the author-identity `TODO` in `CITATION.cff:15` (owner).

### Wave 3 (docs, figures, release preparation; local only)

- **Numbers in the docs are stale:** `README.md` validation table (0D ITER Q 14.0 -> 10.1 and P_fus 715 -> 523 MW;
  1.5D 9.8 / 491 -> 10.3 / 520; JET E_fus 58 / 85 -> 64 / 82 MJ, and the "about 60 %" beam-target footnote; SPARC
  P_fus 182 / 157 -> 174 / 162 MW; DEMO 2.2 / 1.95 -> 2.03 / 2.01 GW) and the fig03 image under it;
  `docs/technical-report.md` lines 25 (1.5D Q = 9.8, P_fus = 491 MW), 278 (the Q about 14 -> 9.8 discussion) and 347
  (Figure 3 caption "L-H at about 6.5 s", now 8.5 s), section 7's validation table, the POPCON text (loss power is
  now P_heat - P_rad,core - dW/dt), and any statement that the 1.5D end state lands in the POPCON Q about 9
  region. A full pass of the report against the v4 physics is a release task.
- **CHANGELOG backfill:** `[Unreleased]` has lines for ws3, ws5b, ws1c, ws3d and the integrator fixes but not for
  ws2b (0D physics: pools, ignition, fuels, P_L and Ryter, ICF, mirror, stellarator, ITPA20, the diagnostics; the
  20-line draft is in the ws2b lane report), ws4 (GS), ws9 (fonts, registry, provenance), ws10 (store, protocol v2,
  i18n), ws2a (tests, mutation smoke) and ws5 (kernel). Section 4 of this report is a starting point.
- **Version 3.0.0 -> 4.0.0** in `package.json`, `package-lock.json`, `CITATION.cff` (also the `TODO`),
  `.zenodo.json`, `CHANGELOG.md` (then `release:check --no-allow-unreleased`).
- **Validation v2:** the Sauter (2016) q95 constants (only PROCESS and arXiv:2407.06439 App. A confirm them; primary
  paper unread), the MASTU campaign ranges (Harrison 2024 or Berkery 2023 text), the alpha-share tolerance, and the
  `JET15.Efus` range (literature; if it flips to XPASS reword the note, never retune the range to model output).
- Fast-forward local `main` from `v4/integration` only after the above; then stop and wait for "yap".

## 10. Notes for the owner

- **One disclosure (ws1c, self-reported):** while looking for open-access copies of Sauter (2016) the lane put
  the owner's e-mail address (from the session context) in the contact parameter of one `api.unpaywall.org`
  request. It was a slip, one request, not repeated. Lanes should use no contact parameter (or a placeholder) for
  such APIs.
- **History:** the ws3 stage commits carry the trailer `Co-Authored-By: Claude Opus 5.5`, the integrator commits
  Sonnet 5.5; nothing was rewritten. The lane branches `v4/ws*` and their worktrees `.wt/*` are still in place;
  no temporary worktree of the gate remains.
- Nothing was pushed, tagged, released or archived (Zenodo). `docs/figures` was not touched.

## Appendix A: pins that remain (`it.fails`)

All in `src/physics/reference/`; each passes while its bug is present and turns red when the bug is fixed:
`geometry.test.ts` (volume and surface agree with the Miller shape to about 3 % for every magnetic preset),
`numericsProps.test.ts` (a two-knot clamped spline honours its end slopes), `reactivity.test.ts` (p-11B within
the quadrature tolerance: unresolved 148 keV resonance; D-T neutron and alpha energies follow two-body
kinematics; E_charged + E_neutron = E_tot for every channel), `wizardSmoke.test.ts` (W7-X without fuelling keeps
T_e, T_i below 1 MeV: density collapse without a termination; 1.5D with a > R gives no internal solver error).
