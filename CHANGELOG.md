# Changelog

Biçim [Keep a Changelog](https://keepachangelog.com/) esinlidir; sürümler [SemVer](https://semver.org/) izler.

## [Unreleased]

### Added
- **Golden regression harness**: `npm run golden` compares 30 deterministic run snapshots (all
  presets, every method, 0D and 1.5D, plus variants for every fuel in 0D and 1.5D, 1.5D D-D and
  1.5D spherical tokamak) with `test/golden/*.json` at a relative tolerance of 1e-9 (1e-6 across
  Node.js major versions) and prints a preset/key/old/new/rel-diff table on mismatch. A snapshot
  holds the report scalars, flat-top averages, whole-run statistics of every diagnostic with counts
  of missing and non-finite samples, event counts, key time traces, the geometry and, in 1.5D, all
  radial profiles and an equilibrium digest. `npm run golden:update -- --reason "…"` re-records them
  and appends to the append-only `test/golden/CHANGES.md` (format changes are logged as moved,
  added and removed keys). Baseline recorded from unchanged v3.0.0 physics. `npm test` compares a
  fast subset.
- `npm run ci:local`: type check, tests, validation and golden regression in sequence (fail-fast).
- `validate --json`: machine-readable results (preset, metric, value, expected range, pass); capture
  it with `npm run -s validate -- --json`, since plain `npm run` prints a banner to stdout.
- Strict command-line flag parser (`src/cli/args.ts`) with generated `--help` for all CLIs.
- Shared flat-top averaging helper `src/physics/analysis/flatTop.ts` (trapezoidal time weighting by
  default since v4.0; the frame weighting of v3.0.0 is the option `weighting: 'frame'`).
- Tests for the flag parser, worker pool, CLI exit codes, flat-top averaging and the golden
  comparator and snapshot content (95 tests in total).
- 1.5D profile model: the model is split into focused modules (state layout, shared context,
  composition, boundary, sources, transport, control, solver, equilibrium coupling, events,
  diagnostics, checkpoints) with `SourceModel`, `TransportModel` and `EventModel` plug-in
  interfaces; `model.ts` is a thin orchestrator. `ProfileModel` takes optional `{ transport,
  sources, events }` modules; `SourceModel`/`TransportModel` get an optional `accepted()` hook
  (once per accepted step, for state that evolves per step), `SourceModel` an optional
  `particles()` hook (a particle source added into `w.Sn` once per implicit attempt) and
  `TransportModel` a `geometryChanged()` hook; sources and transport models with state take part
  in checkpoints. Developer note: `src/physics/profiles/README.md`. The split is bit-identical.
- 1.5D diagnostic `P_bound` (power conducted and convected across the separatrix; the discrete
  energy balance dW/dt = P_heat - P_rad - P_bound closes to 1.5e-5 of P_heat over an ITER15
  flat-top) and `tauE_scal` (the scaling-law tau_E beside the actual W/P_loss in 'cgm' mode).
- 1.5D tests: energy balance and convection against analytic cases, NBI chord cache and
  beam-target table against their direct integrals, 'cgm' smoke test, unit tests of every event
  model, transport geometry against an analytic Solov'ev equilibrium, plug-in hook tests, replays
  from disruption quench frames, and regression tests for every integrity fix below.
- Kernel tests: the `SimModel` contract, FSAL stage reuse (bitwise on/off for every model family,
  evaluation counts, invalidation by rewinds and controls), the terminal frame of a failed 1.5D
  step and set-points across a rewind; the determinism suites yield to the event loop between
  runs, so they no longer starve the test worker's RPC under coverage; the it.fails pin of the ELM
  frame bug became a regression test.
- `golden:update --reason-file FILE` for reasons that do not fit on a Windows command line (the first
  paragraph is the entry title, further blank-line separated paragraphs follow it); the entries of
  `test/golden/CHANGES.md` list, per changed case, the moved keys (largest relative change first),
  the added keys and the removed keys under their own labels. Before, the first moved keys were
  printed behind "N keys added" and read as the added ones.
- Validation: literature checks for the v4.0 physics. `MASTU.q95` (first MAST-U campaign 5 < q95 <
  10, Berkery et al., PPCF 65 (2023) 045001; a documented known failure until the preset became a
  first-campaign scenario, see below), `DIIID.Palpha` (the charged D-D products are bounded by the record D-D gain Q_DD =
  0.0015, Lazarus et al., Nucl. Fusion 37 (1997) 7), `ITER/JET/SPARC/DEMO.alphaShare` (P_alpha/P_fus
  at most the alpha share of D-T, 0.2025 = 3.561/17.589 MeV plus 5 % slack) and `ITER.nG` (line-averaged
  Greenwald fraction); the model values in the known-failure texts are refreshed.
- Exit-status stress test of the spawned validate and golden CLIs (16 runs, in `npm test`, about 3 s;
  a tripwire for the intermittent Windows exit code 0xC0000005 seen once) and the opt-in soak
  `npm run stress:exit -- 300 8`; tests of the worker pool shutdown on every path and of the golden
  change-log text (`src/regression/changes.ts`).
- 1.5D diagnostics `P_beam_heat`, `P_rad_core`, `W_alpha`, `W_beam`, `betaN_th` (thermal beta_N),
  `ignited` and `dWdt_s` (`Wf`, which was constant 0, is now W_alpha + W_beam), with the same
  meaning as in the 0D model.
- Tests for the 1.5D physics parity and robustness: per-channel fusion and beam-target sources, the
  loss power and the scaling-mode tau_E at it (every accepted step of JET15, L- and H-mode), the
  ignition test, the fast-ion pools (bounded by the injected energy, build-up, decay, bitwise replay),
  the checkpoint contract, the atomic step, failure classification and cell volumes on real
  Grad-Shafranov tables; `SingularMatrixError` of every solver of `numerics/linalg.ts`, and the 0D
  ignition state through a disruption. Long 1.5D tests use `runAllYielding` (`src/testing/yielding.ts`).
- Multi-page PDF: `toPDFDocument(pages)` and `figuresToPDF(figs)` write one PDF page per figure with
  one embedded font subset per face shared by all pages (page-level graphics-state and image
  resources).
- Exact 256-entry viridis, magma, inferno, plasma and cividis colormap tables (matplotlib's
  published data) replace the nine-anchor approximation; cividis and plasma are new. Colour bars
  draw the table.
- Min/max (M4) decimation of long time series (`decimateIndices`, `decimateFrames`) that keeps the
  frames around events and gaps; figure exports thin histories above 6000 frames.
- New figure builders: UQ violin plot (Gaussian KDE, Silverman bandwidth; a non-positive reference
  on a log axis is omitted) and tornado plot, radius-time heat map (`figRhoT`, export kind
  'rhot'), Pareto fronts (NSGA-II non-dominated sorting, attainment staircase), and
  reference-uncertainty bands and interval error bars for the validation figure.
- Every figure builder is exercised on deterministic synthetic data with the SHA-256 of the SVG and
  PDF pinned (`src/plot/figures/testdata/builders.sha256.json`); line coverage of
  `src/plot/figures` rises from 4-15 % to 96.5 %.
- POPCON map computed off the page's thread in its own worker chunk: a 16x16 preview while the
  controls move, the 44x44 map once they rest; jobs a newer one replaces are dropped.
- POPCON shows the run trajectory (fading with age), the operating point and the contour of the
  heating power applied now; hovering reads out P_aux, Q, beta_N, self-heating and the beta_N, L-H
  and Greenwald limits; clicking steers the shot to a point of the map (density set-point and
  heating power).
- Time charts thin long runs per pixel column (min/max level of detail) and keep event frames: ELM
  and sawtooth crashes stay visible at any run length.
- `bench/pause-latency.ts` measures the wait of a pause request on the simulation worker (p50, p99).
- Live values: a collapsible power-balance block shows P_alpha, P_beam_heat, P_rad_core, P_transport,
  P_cond, P_ELM, P_ei, P_loss, dW/dt, P_bound, W, W_fast, W_alpha, W_beam, n_bar, thermal beta_N and
  the ignited flag.
- Chart channels for betaN_th, W_alpha, W_beam and ignited (0D and 1.5D) and P_bound (1.5D).
- Setup wizard: stellarator H_ISS04 (blank keeps the old f_ren x H98), ICF driver and thermal
  efficiency, mirror plug potential (tandem); the ignition-test switch is documented as a ramp-down
  in 0D and 1.5D.
- Setup wizard: a torus needs a < R, and 1.5D needs R > 1.06 a; RUN is blocked with an explanation
  instead of the 1.5D model failing on start.
- A 1.5D shot that ends in 'Numerical failure' or 'Equilibrium failure' is shown in the live panel
  and the report with the failure named in the interface language, the diagnosis and the fix text.
- 3D view on the run screen (magnetic devices): nested flux surfaces of the plasma (from the 1.5D
  Grad-Shafranov equilibrium snapshot, or Miller surfaces in 0D), the vacuum vessel, toroidal field
  coils, and a cut-away wedge showing the poloidal cross-section coloured by temperature; orbit / pan
  / zoom camera with mouse, touch and keyboard (browser shortcuts such as Ctrl+0 and Alt+Left are
  left to the browser); toggles for cut-away, coils and auto-rotation.
- Event effects in the 3D view: ELM flash shell, H-mode pedestal glow, and an animated disruption
  (thermal-quench flash, colour loss, contraction and drop; jumps to the end state under
  prefers-reduced-motion).
- The 3D view is raw WebGL2 with no new dependency, in a separate lazily loaded chunk (about 31 kB,
  gzip about 12 kB) fetched on first use; the main bundle grows by 1.7 kB. Where WebGL2 is
  unavailable or its context is lost, a canvas 2D projection of the same scene takes over.
- Mesh generation for the 3D view is pure and tested in Node: closed 2-manifolds, outward normals,
  and boundary volume within 0.3 % of the equilibrium or Miller volume (limit 2 %) for eight presets
  plus ITER, JET, SPARC and MAST-U equilibria.
- Added uncertainty quantification (`src/analysis`, `uq` CLI): seeded Monte Carlo, Latin hypercube and
  scrambled Sobol' (Joe-Kuo) samplers, priors for H98 (IPB98(y,2) / ITPA20-IL widths), density and
  impurity fractions, ensemble runs on the worker pool, and P(Q>=10), P(disruption), P(n/nG>1),
  quantiles of Q and P_fus, and rank correlations with bootstrap intervals; JSON and CSV output,
  byte-identical for the same seed at any thread count.
- Added Sobol' sensitivity indices (Saltelli 2010 first-order, Jansen total) with bootstrap
  confidence intervals, computed on centred outputs so they do not depend on the output offset,
  verified on the Ishigami function.
- Added the `scan` CLI (grid and sampled parameter scans with JSON/CSV output).
- Added a steady-state evaluator on the POPCON fixed point and design optimisation (`optimize` CLI):
  Nelder-Mead, augmented Lagrangian (verified on Hock-Schittkowski #71, f* = 17.0140), CMA-ES and
  NSGA-II Pareto fronts against systems limits; all results carry an educational caveat.
- npm scripts `uq`, `scan` and `optimize` for the three CLIs.
- Public library API: `src/physics/index.ts` is the documented barrel (`@public` / `@experimental` tags,
  export list locked by a test); ESM and CommonJS bundles, type declarations and a compiled preset-runner
  worker are built by `npm run build:lib` (`scripts/build-lib.mjs`) with no new dependency; the core
  bundles contain no `window`, `document` or `node:` reference; the build does not depend on the
  package.json `main` entry. package.json now declares `bin`, `main`, `module`, `types`, `exports` and
  `files` (the package stays private).
- Runtime configuration validation (`src/physics/config`): every field of every reactor configuration is
  checked with path-specific errors, and `schema/fusion-sim.schema.json` (JSON Schema 2020-12) is
  generated from the same definitions (`npm run schema`; `npm run schema:check`, also a step of
  `ci:local`, fails when the file is out of date); all 21 presets validate and 50+ mutated invalid
  configurations are rejected.
- `fusion-sim` command line: `run`, `scan` (on the worker pool), `presets`, `schema` (print, or `--check`
  a configuration file) and `export-eqdsk` (the G-EQDSK of a 1.5D run), with a
  provenance block in every output; a model failure (for example an initial equilibrium that cannot be
  computed) is a one-line failure with exit 1, and git provenance is reported only for the package's own
  checkout.
- Data formats for runs, in the browser and in Node (`src/io`): CSV, NDJSON, NetCDF-3 (CDF-1/2 with CF
  attributes) and IMAS-like JSON (core_profiles, equilibrium, summary; COCOS 11), with bitwise
  write-parse round trips; `--every N` keeps the first and the last frame in every format.
- `python/fusion_sim`: a standard-library subprocess wrapper of the `fusion-sim` command line.
- Share links: a Share button (top bar) builds a link that carries the configuration and its name. It is
  deflate-raw + base64url, versioned, CRC-32-checked and validated on open. Opening a link loads the
  setup with a notice; a link that also carries an exact run (actuator log, breakpoints, scenario,
  fingerprint) offers to reproduce it. Nothing is uploaded anywhere. The Share dialog does not yet
  produce exact-run links: that needs the simulation worker to report its actuator log.
- Hash routes: `#/wizard`, `#/run`, `#/report`, `#/compare`, `#/validate`, `#/share/<code>`,
  `#/embed/<run|report>/<code>` for iframes. Back and forward move between tabs.
- Saved runs: completed runs are saved in the browser (IndexedDB, up to 40, slimmed frames, can be
  switched off). The Saved runs dialog opens, renames, exports and deletes them. Saving twice stores a
  run once; an unverified import never stands in for a run of the same inputs.
- Run files: the report's JSON button writes a run file (configuration, report, events, fingerprint).
  Importing one re-simulates it in a worker and shows a verified-reproduction badge when the
  fingerprint, the final report and the events all match. The Report shows the numbers the re-run
  produced, never the numbers typed into a file. Files from another simulator version, edited files
  and older exports are flagged.
- Embed views: `#/embed/run` and `#/embed/report` render the shared configuration without the top bar;
  Share offers the iframe HTML.
- Tests of the persistence layer: the share codec (21 presets x 200 random edits), the archive on
  fake-indexeddb, the router, verification (including a real worker replay) and the archive, import,
  share and embed views through the application.
- Deterministic simulation kernel: any `advance()` schedule gives bitwise the same frames, events and
  report as `runAll()` (the wall-clock chunking used to truncate integrator steps: ITER Q_sci_max 15.935
  against 15.854 chunked), `rewindTo()` restores the exact model state in 0D and 1.5D, every
  `applyControl()` is logged and replays bitwise, sampling grids and user breakpoints are honoured, and
  `runFingerprint()` (pure-TypeScript SHA-256 over a canonical serialisation) identifies a run. Integrator:
  the array form of `nonNegative` clamps exactly the listed components, non-finite trial stages are
  rejected, a NaN step size is never accepted at dtMin, `snapshot()`/`restore()` continue bitwise.
- Web UI foundation: an external state store with worker protocol v2 (frame batching, runs that cannot be
  integrated are refused, a NaN state stops the run), a typed i18n scaffold `t(key, params)` with English
  and Turkish dictionaries (the report and comparison screens are translated), the run screen split into
  panels, an error boundary that contains drawing errors, and jsdom component tests with an in-process fake
  worker. The wizard blocks RUN while a required number field is empty, and a blank field unsets the value
  instead of reverting to the preset; rewinding a completed run no longer re-archives it.
- Publication engine: a pure-TypeScript TrueType parser and subsetter, the STIX Two fonts embedded in the PDF
  figures (rho, beta, alpha, tau and Delta no longer vanish), `hmtx` text layout, mathtext and axis fixes
  (tick labels keep every digit, SVG and PDF place every glyph of fractions and accents alike), a figure
  registry with pooled verification and POPCON, a provenance manifest and `npm run figures:check`.
- Reference and property tests of the 0D physics: a seeded property-testing helper with shrinking, reference
  packs typed in from the publications (Bosch-Hale, Nevins-Swain and beam-target reactivity; confinement
  scalings, Martin 2008; bremsstrahlung, Albajar-Fidone synchrotron, Mavrin 2018 line cooling; geometry,
  heating, limits, disruption), conservation invariants of short preset runs (power diagnostics add up, the
  thermal energy ledger closes, fuel and ash inventories), property tests of the numerics, a wizard smoke
  test over every option combination, and `npm run mutation-smoke` (15 seeded mutants of the physics, all
  killed). Known defects were pinned as `it.fails` tests that flip when the bug is fixed; the ones fixed in
  v4.0 (integrator, ELM frames, blank defaults, D-T energies, p-11B quadrature, Miller volume and surface,
  W7-X density collapse) are plain tests now.
- Grad-Shafranov solver: `Equilibrium.warnings` and a public force-balance evaluator (the residual of the
  pressure balance a table-mode state leaves), a Solov'ev flux-contour boundary and faster psi evaluation,
  Anderson-accelerated Picard iteration (`numerics`), a banded LU that skips structural zeros, a grid cache
  capped at 64 MB per worker, and tests against the exact nonlinear Solov'ev solution, force balance,
  convergence and failures.
- `MagneticConfig.scaling` accepts `'ITPA20'` and `'ITPA20-IL'` next to `'IPB98y2'` (default) and
  `'ST_Valovic'`, in the 0D model, POPCON and the 1.5D confinement controller (`tauHmode()` in
  `transport.ts`); see Changed for the variables they take.
- 0D disruption cause `density_collapse` ('Density collapse - fuelling lost'); see Fixed.
- Edge physics (`src/physics/edge`): a two-point model of the outer divertor leg with the Stangeby (PPCF 60 (2018)
  044022) momentum and power loss factors f_mom(T_t), f_cool(T_t), the Eich et al. (NF 53 (2013) 093031, regression
  #14) heat-flux width with the Makowski et al. (PoP 19 (2012) 056122) divertor spreading, Lengyel radiation of a
  seed impurity with the Mavrin cooling rates, and the Kallenbach (PPCF 60 (2018) 045006) detachment qualifier
  q_det; one set of pure functions shared by the 0D model, the 1.5D boundary and POPCON; the power ledger closes
  to 1e-8.
- New diagnostics in every tokamak and spherical-tokamak run (0D and 1.5D), a chart group `Edge`: P_sep/R,
  lambda_q, separatrix T_e (T_u), target T_e, peak target heat flux q_peak, outer-leg power loss f_pwr, detachment
  state (attached / partially detached / detached), c_z required for detachment (Lengyel upper bound), q_det and
  divertor neutral pressure; five new rows in the report's engineering table. The c_z row reads `n/a (> 100 %)`
  where the model finds no attainable seeding (never a clipped 100 %), 0 where a prescribed-radiation run is already
  detached, and a lower bound with the capped share of the flat-top time where only part of it is capped.
  Stellarators have no such channels.
- 1.5D: the opt-in boundary `profiles.edgeModel = 'twoPoint'` takes T_sep from the edge model (default `'legacy'`
  unchanged; the two agree within 2 % on ITER15); n_sep stays fuelling-controlled.
- POPCON: `computePopcon(cfg, { edge: true })` adds P_sep/R, peak target heat flux and target T_e maps at the steady
  state of each cell (opt-in; no view passes it yet).
- Setup wizard, configuration schema and the share-link validator know the edge options: `divertor.edge.radiation`
  (prescribed divertor radiation or the Lengyel seed model), `divertor.edge.lambdaQ_mm` (blank = Eich regression #14)
  and `profiles.edgeModel` in the wizard (English and Turkish); every `divertor.edge.*` option in
  `schema/fusion-sim.schema.json` and the validator of imported and shared configurations.
- Limits of the edge model, stated in `src/physics/edge/README.md`: the Mavrin cooling curves are coronal (>= 100 eV),
  so the Lengyel c_z for detachment is an upper bound (ITER neon several times the ~6 % of the SOLPS-ITER database);
  lambda_q is the Eich H-mode regression (0.6 mm for ITER against 2 mm of the SOLPS-ITER baseline); q_det is an ASDEX
  Upgrade scaling used beyond its P_sep/R range; one flux tube, T_i = T_e, no drifts, ELM-averaged.
- Deterministic scenario engine (`src/physics/scenario.ts`, `SimulationOptions.scenario`): per-control piecewise-linear
  or step waveforms and conditional triggers `{ diag, op, value } -> set` (once or repeating, with a hold time, a start
  time, a hysteresis band and a release patch), as plain JSON (schema 1) with path-level validation (unknown or hostile
  keys rejected, controls and diagnostics checked against the model; `ScenarioError`), one canonical text per scenario
  (`scenarioToJSON` / `scenarioFromJSON`, for share links) and templates (drop, ramp, gas puff, interlock, merge).
  Waveform corners (and an optional `rampStep` grid) are step boundaries, so a control value at a corner is exact;
  triggers are evaluated on the recorded frames at step boundaries, so a scenario run is chunk invariant and rewinds
  exactly. The scenario state is part of every frame checkpoint and the scenario is part of `runFingerprint()` (its free
  name is not); a run without a scenario is bitwise unchanged and keeps its fingerprint. Scenario changes are not in
  the actuator log (they are a function of scenario, configuration and frames); a live `applyControl()` takes its
  keys over from the waveforms. I_p and the shape keys become scenario-drivable when they are exposed as controls
  (`SCENARIO_CONTROLS` lists the labels and limits).
- Scenario `rampStep` is bounded below (at least 1e-6 in the model's time unit and at least `t_end / 10000`): a finer
  grid is a `ScenarioError` at path `rampStep`, so a scenario from a share link cannot make a run endless (1e-20 used to
  hang the step limit, 1e-9 on a 400 s run meant about 4e11 steps). The trigger options `hold` and `after` are
  independent gates: a trigger fires at the first frame with t >= after whose condition has held for `hold`.
- The library barrel exports the scenario engine (`validateScenario`, `parseScenario`, `scenarioFromJSON`,
  `scenarioToJSON`, the drop / ramp / gas-puff / interlock templates, `mergeScenarios`, `MIN_RAMP_STEP`,
  `MAX_RAMP_GRID`, `ScenarioError` and the spec types as `@public`; the `Scenario` class as `@experimental`), and
  `fusion-sim run --scenario FILE` runs a shot under a scenario file: every problem of the file is listed with its path
  (exit 2), the JSON output carries the normalised scenario and `provenance.scenarioSha256`, and the run fingerprint of
  every format covers the scenario.
- Systems-lite engineering package `src/physics/systems/` (v4.0): TF coil, central-solenoid flux budget, cryoplant, radial
  build with neutron attenuation, TBR fit and the PROCESS 1990 cost accounts; `src/physics/engineering.ts` is now a
  facade over it with the v3 API unchanged (`MAGNET_TECH`, `checkMagnet`, `economics`, `neutronWallLoad`,
  `tritiumBreedingRatio`). The shot report of the magnetic models runs it on the flat-top means (`assessSystems`).
  Optional configuration block `MagneticConfig.systems` (`pulseLength_s`, `tf`, `cs`, `blanket`; every field
  optional), in the runtime validation and in `schema/fusion-sim.schema.json`. The library barrel exports the models as
  `@experimental` (`assessSystems`, `systemsReportKeys`, `tfCoil`, `fluxBudget`, `cryoPlant`, `plantPulseLength_s`,
  `radialBuild`, `tritiumBreedingRatio`, `costContext`, `costAccounts`, `costOfElectricity` and their types) and
  `SystemsConfig` as a `@public` type.
- New keys in the engineering table of the magnetic shot report: TF coils, TF winding pack J, TF case and winding-pack
  Tresca stress, TF stress margin, TF vertical tension per coil, TF mass, CS flux swing, Flux required, Flux margin
  (tokamaks), TF nuclear heating, Cryo heat load, Cryoplant power, Cryo pulse length (superconducting coils), Inboard
  blanket and Inboard shield+vessel (with a blanket). The central-solenoid budget is the plasma inductance, the Ejima
  resistive start-up and the burn flux against the flux the solenoid can swing; it takes measured `V_loop` and `psi_used`
  from the history where a model provides them. It is reported for every tokamak but checked (warning) only when a
  design gives `systems.cs`, because the radial build of the presets does not resolve the solenoid (all preset tokamaks
  show a negative flux margin).
- PROCESS 1990 cost accounts (21-26, 9) and the cost of electricity as library functions (`costAccounts`,
  `costOfElectricity`), verified against the PROCESS unit-test values; a first-of-a-kind educational estimate that is not
  part of the shot report (its Capital cost stays the Sheffield-Milora scaling).
- G-EQDSK support (`src/io/geqdsk.ts`, browser-safe): a writer in the standard 5e16.9 format (COCOS 11 by default, any of
  COCOS 1-8 and 11-18), a tolerant reader (fields that touch, D exponents, Windows line ends), COCOS detection and
  conversion (Sauter and Medvedev, Comput. Phys. Commun. 184 (2013) 293), and `importGeqdsk`, which builds an `Equilibrium`
  from a file (q re-traced from psi and F; `boundaryPsi` puts the boundary on a flux surface inside an X-point
  separatrix, which is how a real EFIT file has to be read, at 0.99 or less). The text round trip reproduces psi to 5e-10 of
  its range at the standard 10 significant digits and 1e-14 at `digits: 15`; through `importGeqdsk` the state is resampled
  onto a Shortley-Weller grid of the boundary polygon and agrees to 6e-6 in psi (volume 1e-4). No file of a real code was
  available: the reader is tested on the solver's own files, hand-made text and an analytic single-null Solov'ev file.
- `fusion-sim export-eqdsk --preset ITER15 --out FILE [--time S]` writes the equilibrium of a 1.5D run (the one in force
  at `--time`, the last one by default) as a G-EQDSK; `-` is stdout. It was a stub that said it was not available.
- Boundary shapes for the fixed-boundary solver: polygon, Fourier-series and flux-contour `ShapeBoundary`, and
  `millerShape` (separate upper and lower triangularity, elongation and squareness, vertical shift); the grid follows an
  up-down asymmetric boundary, and `GSSolver.assemble` builds an `Equilibrium` from a state that was not solved here.
- Carlson elliptic integrals (R_F, R_D, K, E) and the toroidal Green's functions of a circular current filament, matching
  Biot-Savart to 2e-11 (groundwork for free-boundary equilibria; the coil sets, the X-point Newton solve and the vertical
  stability are not done).
- Anderson mixing option `restartGrowth` (restart when the residual exceeds a multiple of the smallest so far).
- `geometryFromEquilibrium(eq, N, geom, grid)` builds the transport geometry on a given radial grid (the faces, centres and
  mean cell width of the model; uniform without one).

### Changed
- The Report's JSON button writes `<name>_run.json` (the run file above) instead of
  `<name>_report.json` (configuration, report and events only); the export is loaded on demand.
- POPCON T axis scaled to where the device operates instead of a fixed 0-40 keV: 2.5 times the
  temperature its installed heating alone would hold at its own density, bounded by the beta limit
  there (ITER 15 keV, DEMO 20, SPARC 20, JET 8, MAST-U and W7-X 2.5); p-11B keeps a wide axis.
- Charts: canvases follow their CSS width and the device pixel ratio without reallocating the
  backing store on each redraw; the POPCON map is drawn once per grid into an offscreen layer.
- Simulation worker is time-sliced: a pause, control or rewind request is served within about one
  step (p99 about 50 ms for DEMO15 and ITER15 at 100x, was 290-400 ms); results are bitwise
  unchanged.
- Figure caption and run log: the 'GS updates' number counts accepted Grad-Shafranov updates, and
  the Fig. 1 caption now also reports retried and rejected updates and forced transport steps
  (`eqRetried`, `eqRejected`, `forcedSteps`).
- The validation CLI moved to `src/cli/validate.cli.ts` (no Node-only entry point left in
  `src/physics`). Exit codes: 0 all executed checks passed; 1 a check or run failed, or no check was
  executed (previously reported as passed); 2 usage error (unknown flag or preset id, invalid
  `--threads`), where invalid input used to be silently ignored or turned into NaN.
- `figures`: invalid `--scan`, `--only`, `--formats` or `--threads` values are rejected with exit
  code 2 instead of being clamped or ignored.
- README translated to English and extended with a regression-testing section.
- 1.5D: transport-geometry cell volumes are the integral of V' over each cell, scaled once to the
  volume of the equilibrium, instead of V(rho) splined through the coarse Grad-Shafranov table (the
  innermost cell was 1.3 % too small, the outer cells 1-2.5 %, MAST-U 15 %). Against v3.0.0 the
  flat-top central q(0) of the 1.5D cases moved by -2 to -4 % (DEMO15 +15 %) and ITER15 showed 38
  instead of 25 sawtooth crashes in 400 s with the spline of V(rho^2) that preceded the final
  method; the final method changes q(0) by a further -2 to +2.5 % (MASTU15 2.37 -> 2.75). There is
  one stored-energy definition in the model.
- 1.5D: the loss power for the tau_E scaling and the L-H test is P_L = P_heat - P_rad,core - dW/dt
  (core radiation from rho < 0.6, dW/dt filtered with tau_E and including the ELM losses) with the
  L-H threshold of Martin 2008 plus the Ryter 2014 low-density branch, as in the 0D model: ITER15 Q
  9.74 -> 10.3, tau_E 2.55 -> 2.36 s, and the L-H transitions come later at the start-up density
  (ITER15 6.5 -> 8.5 s, SPARC15 0.8 -> 1.5 s). A fast ramp relaxes with tau_E instead of jumping to
  the scaling value (SPARC15-short Q 6.5 -> 5.2 in its ramp-up window).
- 1.5D: the pressure of the NBI ions and of the fast fusion products enters beta_T and beta_N
  (ITER15 beta_N 1.48 -> 1.72, DEMO15 2.22 -> 2.80); their energy content is a pool that builds up
  with tau_W = tau_se (1 - G)/2 and decays when the source stops (dW/dt = P - W/tau_W, exact step, as
  in 0D), so it cannot exceed the injected energy: JET15 with a 300 or 500 keV beam no longer ends
  in a spurious Troyon-limit disruption at 0.5 s. The NTMs are seeded from the thermal beta_N.
- 1.5D: ignition is P_alpha >= P_rad + W/tau_E without the Q >= 5 guard and is reported as the
  `ignited` diagnostic, which the report's ignition time follows; `heating.autoOff` (the ignition
  test: external heating ramps down at Q >= 5) works in 1.5D. A disruption ends the ignition state.
- Checkpoints: `CheckpointStore.save` throws `CheckpointContractError` on a duplicate record key, a
  non-numeric value or a duplicate aux key, so a plug-in cannot overwrite a core key; ELM, sawtooth
  and context restores tolerate missing keys; the fast-ion pools are part of the record.
- `numerics/linalg.ts` throws the typed `SingularMatrixError` for a singular system (messages
  unchanged); the 1.5D step converts that class to `LinearAlgebraFailure` instead of taking every
  plain `Error` of a solver for a singular system.
- 1.5D: in the predictive 'cgm' transport mode tau_E, P_cond, the triple product and the
  particle, He-ash and impurity times use the actual W/P_loss.
- 1.5D: ion heat convected in through the separatrix when particles flow in scales with n_i/n_e as
  at every other face, so one heat step conserves energy exactly in both flow directions (only
  MASTU15 has boundary inflow).
- Kernel: `SimModel.rhs()` and `integratorOpts` are optional when a model provides its own
  `step()`; `Simulation` builds no Dormand-Prince stepper for such a model (`SimCheckpoint.integ` is
  then absent), a model with neither is refused with the typed `ModelContractError`, and
  `SimulationOptions.modelFactory` lets tests and plug-ins supply the model. The 1.5D model no
  longer carries a dummy `rhs()` and `integratorOpts`.
- Kernel: the Dormand-Prince integrator reuses the last stage of an accepted step as the first
  stage of the next one (FSAL) when nothing changed in between; the state of the model
  (`saveInternal()`, controls) and `y` are checked bitwise, so results are identical (run digests of
  all 21 presets unchanged) with 14 % fewer right-hand side evaluations for pulsed models and
  W7-X, 5 % for ITER and about 1 % for ELM tokamaks. `SimulationOptions.fsal = false` switches it
  off.
- Kernel contract documented and tested: the terminal frame of a shot ended by a failed 1.5D step
  shares the time of the last frame (it carries the termination); rewinding re-applies the controls
  of the frame in 1.5D as in 0D, and the actuator log keeps exactly the entries before the frame.
- 0D: the frame-weighted flat-top averages, maxima and the derived engineering numbers of the ELM
  presets move with the frame fix below (ITER P_fus 538 -> 523 MW, Q 10.4 -> 10.1; DEMO Q 20.7 ->
  20.1; SPARC -0.7 %, JET -0.5 %); the runs themselves are unchanged.
- Worker pool (`src/cli/pool.ts`): `runPool` settles only after every worker thread it started has
  stopped, on every path (success, task error, timeout, abort, SIGINT/SIGTERM), so a caller that ends
  the process with `process.exit()` right after it cannot cut a thread short. This is a sound
  invariant, not a demonstrated fix: one spawned validate run once ended with exit code 0xC0000005 on
  Windows; the crash has not been reproduced (1600+ runs) and its cause is unknown, the pool change
  removes one suspect (the tsx loader thread at process exit is another).
- Coverage: the thresholds of `npm run coverage` are ratcheted to the measured levels, with new globs
  for `src/physics/validation` and `src/regression`; the four type-only modules are excluded by name
  (`TYPE_ONLY_MODULES` in `vite.config.ts`, kept exact by `src/coverageConfig.test.ts`), because V8
  counted them as uncovered lines in a checkout path with a space or a non-ASCII letter and as an
  empty file in a plain one, which put the two environments about 2.6 points apart on
  `src/physics/**`.
- ITPA20 and ITPA20-IL confinement scaling coefficients verified against Verdoolaege et al., Nucl.
  Fusion 61 (2021) 076006 (eq. 5, eq. 7, tables 10 and 16): all agree with the printed values (the
  ITPA20-IL n exponent was rounded to 0.15, it is the printed 0.147 since ws2c) and the published
  ITER predictions (3.07 s / 2.90 s) are reproduced to 0.4 %. The Sauter (2016) q95 constants remain
  checked against secondary sources only.
- Removed the unused `checkLimits`, `LimitCheck` and `LimitInputs` from `src/physics/limits.ts` (no
  model called them: limits are checked in `postStep()`).
- 0D magnetic model (physics consistency pass): the charged fusion products and the NBI ions slow down in
  separate pools, each with its own Stix critical energy, ion heating fraction and energy-content time;
  P_alpha is the heating by the charged products alone and the new `P_beam_heat` shows the beams (ITER no
  longer logs IGNITION with 50 MW of heating on, its spurious ignition time 385.6 s is 0; DIII-D P_alpha is
  0.0023 MW instead of 11.7 MW; JET fast-ion energy 6.2 -> 1.6 MJ). Ignition is P_alpha >= P_rad + W/tau_E with
  hysteresis and no Q >= 5 guard. beta_T and beta_N include the pressure of the fast particles, and NTMs are
  seeded from the thermal beta_N.
- 0D: the loss power for tau_E and the L-H test is P_L = P_heat - P_rad,core - dW/dt (core radiation from
  rho < 0.6, a smoothed dW/dt); the Greenwald fraction, the Martin 2008 L-H threshold (with the Ryter 2014
  low-density branch) and the tau_E scalings use the line-averaged density n = f_line <n_e>; the ELM-averaged
  power and particle exhaust are 0.3 of the transport loss W/tau_E; electron-ion equilibration runs over all
  ions with the computed Coulomb logarithm; blanket energy multiplication applies to the neutron power only
  and only with a blanket (JET no longer gets +18 %); spherical tokamaks use the low-aspect-ratio q95 of
  Sauter (2016) (MAST-U 34 -> 18); stellarator confinement is an explicit `H_ISS04` x tau_ISS04
  (`stellarator.f_ren` stays as a deprecated alias); T_max and the design score ignore the start-up transient.
  Together with the fixes below ITER flat-top Q went 14.0 -> 10.1 and P_fus 715 -> 523 MW, and the ITER-pB11
  shot radiatively collapsed at 28 s instead of surviving on an ELM-power artefact (a marginal power balance:
  with the ITER density re-base below it runs to the scheduled end again).
- 0D diagnostics `P_beam_heat`, `P_transport` (W/tau_E), `P_ELM`, `P_loss`, `dWdt`, `P_rad_core`, `P_ei`,
  `betaN_th`, `W_alpha`, `W_beam`, `ignited`, `nbar`; `P_cond` is now the continuous conduction W/tau_E - P_ELM.
- MagLIF stagnation lasts about 2 ns (the dwell time scales with t_c/CR) instead of 30 ns: Z D-D yield
  3e15 -> 2e14 (the reference is 1.1e13); FRC and mirror thermal energy account for n_i != n_e.
- Confinement scalings as data (`ConfinementScalingParams`: IPB98(y,2), ITPA20, ITPA20-IL); the existing scalings
  are bitwise unchanged.
- Grad-Shafranov table mode meets I_p through FF' alone: p' used to be rescaled with FF', so the reported p,
  beta_p and W_th were 9-25 % out of force balance while `converged` was true. beta0 has a closed form (beta0 > 1
  is allowed), the exterior is filled with bounded values, the axis search is saddle-free, and
  `Equilibrium.warnings` names an unreachable target or a current table that needs a rescaling above 10 %.
  Moves the nine 1.5D golden cases.
- Flat-top averages (the shot report, the golden flat-top, the validation table, the figures) are the
  trapezoidal time average of the last 30 % of the shot, no longer the mean over the frames of that window: the
  extra frames recorded at ELM and sawtooth crashes weighted the crash states. The headline numbers of the ELM
  tokamaks move by 0.1 % or less (ITER Q 10.130 -> 10.134); the largest moves are in the pulsed and marginal cases
  (GF, FRXL P_fus -2 %, ITER-pB11 Q +2 %).
- D + T -> 4He + n: the 4He nucleus has 3.561 MeV and the neutron 14.028 MeV (exact two-body kinematics of
  Q = 17.589 MeV, AME2020 masses), not 3.5 + 14.1 MeV = 17.6 MeV: the alpha heating per reaction was 1.7 % low
  and P_charged + P_neutron was 1.000625 P_fusion. ITER Q 10.13 -> 10.55, DEMO Q +1.2 %; the alpha share of
  the fusion power is 0.2025.
- Plasma volume, surface and cross-section area are the exact integrals of the Miller boundary of the same
  (kappa, delta): closed forms for the volume and the area, quadrature for the surface. The ellipse formulas
  overestimated the volume by 3.6 % (JET) to 14 % (MAST-U) and the surface by 4-18 %, against a documented "about
  3 %". ITER and DEMO carry their LCFS shape (kappa 1.85, delta 0.49 and 0.5) in `profiles.lcfsKappa/lcfsDelta`,
  which now also sets the 0D volume and surface: 842 m3 and 683 m2 for ITER against the design 837 m3 and 678 m2,
  the same shape as ITER15; the presets' kappa, delta stay the 95 % values of q95 and the scalings, and the new
  `profiles.lcfsRef95` (the 95 % shape the LCFS values belong to) makes the 0D volume, surface and area follow an
  edited kappa or delta in that ratio, so no override is hidden in the 1.5D-only fields. The DEMO LCFS shape is
  the PROCESS conversion of kappa95 = 1.65, delta95 = 0.33 (kappa95 = kappa/1.12, delta95 = delta/1.5), an
  approximation: +8.3 % volume, -3 % P_fus and Q against the 95 % shape. ITER Q
  10.55 -> 9.97, SPARC 0D Q 6.6 -> 7.5, JT-60SA and DIII-D +10 %. The 1.5D neutron wall load uses the same
  surface (ITER15 0.50 -> 0.53 MW/m2), and the 0D shot and disruption reports take the boundary shape like the
  1.5D reports.
- ITPA20 and ITPA20-IL take the areal elongation kappa_a = V/(2 pi^2 R a^2) and the average LCFS triangularity of
  Verdoolaege et al. (2021), not the 95 % values of the presets (delta 0.33 instead of 0.48 would lower tau_E by
  3.8 % and 5.8 %); the ITPA20-IL n exponent is the printed 0.147, not 0.15 (0.7 % in tau_E). With H98 = 1 the
  ITER preset does not sustain its burn under either scaling (tau_E about 15 % below IPB98(y,2)).
- Low-density branch of the L-H threshold: below Ryter's density minimum (eq. 3 of Nucl. Fusion 54 (2014) 083003)
  the threshold rises as (n_min/n)^2, the penalty of the SPARC design studies (Hughes et al., J. Plasma Phys. 86
  (2020) 865860504), no longer as n_min/n. Neither Martin (2008) nor Ryter gives the exponent. Only ramp-ups that
  start below n_min move: their first L-H transition comes 0.06 s (JT-60SA) to 0.3 s (DEMO15) later than with
  n_min/n, and 0.13 s (DIII-D) to 0.6 s (DEMO15, JET 0.27 s) later than with Martin's law alone; ITER, ITER15,
  DEMO and MAST-U (heating-ramp limited or above n_min) move by 0.02 s at most.
- ITER (0D) `n_target` 1.0e20 -> 0.914e20 and DEMO (0D) 0.75e20 -> 0.711e20: the target of the 0D model is the
  volume average, the design points are the line-averaged n/n_G = 0.85 (ITER) and 1.2 (EU-DEMO 2018 baseline,
  Siccinio et al. 2022; their table 1 writes it as the angle-bracket <n>/n_GW, which may mean the volume average:
  read that way, the 0D DEMO shot exceeds its Greenwald limit 1.3 and disrupts at 81 s), which the flat tops now
  reach to 2.5 % (0.84 and 1.17; before 0.92 and 1.24). The 1.5D
  presets already regulate the line average and keep their targets. The p-11B shot of the ITER preset, whose power
  balance is marginal (1.0e20 collapses at 28 s, 0.85e20 survives), now runs to the scheduled end; the golden case
  ITER-pB11 keeps the former 1.0e20 (`overrides.n_target`) so that the suite still has a disrupting shot.
- MAST-U preset: the first-campaign scenario (R 0.8 m, a 0.5 m, kappa 2.1, delta 0.47, 0.75 MA, 0.55 T, 2 MW of NBI
  absorbed; Harrison et al. 2024, Imada et al. 2024) instead of the machine's design-maximum shape: q95 18.2 -> 6.4
  (the published band is 5-10, so the `MASTU.q95` known failure is gone) and MASTU15 (1.5D) q95 17.6 -> 6.4.
- Setup wizard: Confinement scaling offers ITPA20 and ITPA20-IL (H98 multiplies the chosen scaling), and the LCFS
  elongation and triangularity are in the Geometry step of every tokamak, in 0D as well (they set the 0D volume,
  surface and cross-section, and the 1.5D boundary); English and Turkish hints. The configuration schema
  (`schema/fusion-sim.schema.json`) knows the two scalings and `profiles.lcfsRef95`, and the profiles section is
  optional in share links and imported files (ITER and DEMO carry one in 0D).
- The `uq` and `scan` commands, the ensemble and scan specs and `runMetrics` default to the time-weighted flat top
  like everything else (`--flat-top frame` gives the mean over the frames of v3.0.0; the input hash of a study that
  did not name a weighting changes); the steady-state evaluator (`optimize`, `analysis/steadyState.ts`) and the
  temperature axis of the POPCON map take the volume and surface of the boundary shape and the ITPA20 scalings, as
  the POPCON map itself does.
- Golden harness: a case may set the target density; the suite keeps one disrupting shot (ITER-pB11 at 1.0e20 m^-3,
  radiative collapse at 27 s), and a test requires it.
- 1.5D: P_SOL is now the ELM-inclusive power across the separatrix, P_heat - P_rad - dW/dt with the smoothed dW/dt
  that includes the ELM crashes (ITER15 110.3 -> 121.8 MW, JET15 30.2 -> 35.7 MW, DEMO15 411.3 -> 431.6 MW; the
  power balance of the flat top is 122.0 MW for ITER15); q_div, the conduction-limited T_sep and the tungsten source
  follow it. In a ramp-up without ELMs the smoothed dW/dt lags by tau_E, so P_SOL and the derived loads of a short
  window are lower than the step-wise value of before (SPARC15-short -14 %). Golden re-recorded.

- Documented, no model change: the 0D ELM particle-exhaust rate (`elmPartRate`) is re-derived after every ELM H-mode
  step, which makes the kernel's FSAL stage reuse refuse in most steps of ELM H-mode presets (JET 1238 of 1501 steps,
  0.9 % of the right-hand-side evaluations saved, ITER 1.6 %, SPARC 2.0 %, DEMO 3.1 %, against 14 % for models without
  such state); making it a state variable or piecewise constant between crashes would fix that but moves every ELM
  preset (see `confinement/magnetic.ts` and the FSAL paragraph of `simulation.ts`).
- TF coil stress: the thin-ring estimate is replaced by the Tresca stress of a PROCESS-style three-layer plane-stress
  analysis of the inboard leg with the vertical tension of the coil (Kovari et al., Fusion Eng. Des. 104 (2016) 9): ITER
  82 -> 489 MPa (limit 660), DEMO 133 -> 745 MPa (over the 660 MPa limit, a new warning), SPARC 197 -> 1024 MPa (over its
  800 MPa limit, a new warning); the preset inboard legs of SPARC (0.5 m) and DEMO (1.0 m) are thin (the same model gives
  571 MPa for the 1.4 m leg of the PROCESS DEMO build), so both presets carry the warning until the presets are
  reviewed. The magnetic energy is the toroidal-cavity integral with the D-shaped coil height of the boundary shape (ITER
  37.69 -> 41.77 GJ against 41 GJ built). The `optimize` coil constraint reads the same stress, so it now limits the size of
  the machine: the ITER Pareto front of major radius against auxiliary power ends at the upper bound of R with the stress at
  its limit and 3.75 MW of heating left (it reached ignition before; `--no-coil` still does).
- Cryogenic plant power: the Slack heat load of PROCESS (static, pulsed-field, current leads, TF nuclear heating) times the
  technology's `cryo_W_per_W` replaces the flat 5 MW of the recirculating power (ITER cryoplant 32.6 MW, ITER net
  electric power 40 -> 13 MW, Q_eng 1.22 -> 1.06, DEMO net 452 -> 427 MW, SPARC net -22 -> -45 MW). The pulsed-field
  part is spread over the design pulse of the plant (`systems.pulseLength_s`, default 1055 s, the PROCESS plasma-pulse
  times), never over the simulated time, so the cryoplant of a machine does not change with `t_end` or with the time of
  an abort. The TF nuclear heating is the PROCESS fit for a DEMO breeding blanket (scaled with the fusion power); for
  a build without a blanket (SPARC: 476 kW) it is an extrapolation and the report says so.
- TBR follows Shimwell et al., Fusion Eng. Des. 104 (2016) 34, as a function of the 6Li enrichment and the blanket depth
  of the new radial build (ITER 1.199 -> 1.125, DEMO 1.199 -> 1.143).
- Golden re-recorded for the engineering block of the 19 magnetic cases (`scalars.engineering.*`, `Q_eng`, and the warning
  count of SPARC and DEMO); no plasma quantity moved. `test/golden/CHANGES.md` lists every headline move.
- Grad-Shafranov: the default flux-surface table has 101 nodes clustered at the edge (psi_N = s + s^2 - s^3, s = (k/100)^2),
  so the outer-face metrics of the transport geometry are within 0.5 % of a 401-surface table (they were up to 14.7 % off)
  and the table's q95 is right (+0.6 % ITER, +1.1 % SPARC, +8.8 % MASTU at a fixed shape); `psiLevels` sets the surfaces.
- 1.5D/GS coupling: the equilibrium update is a self-consistent outer iteration of the pressure and current tables on the
  new equilibrium's own flux surfaces instead of accept/reject with a retry ladder. The equilibrium's q95 agrees with the
  transport's own to 1.6 % (was up to 15 %) and l_i to 3 % (was up to 8 %). JET15 accepts every update of its shot (was 14
  of 17 with one silent skip), MASTU15 all of them (was 4 of 7), and DIII-D 15 accepts its update at t = 0.38 s. Where the
  fixed-boundary problem has a fold, an update follows at least 75 % of the change of the profiles on the default
  surface table and is reported once. The best equilibrium of an iteration that did not reach its tolerance is adopted up to
  a mapping mismatch of half a transport cell (1e-2; JET15 lost an update of the ramp-up at 5.2e-3 against a limit of 5e-3),
  counted as one that needed help above 5e-3, and the new geometry is built on the radial grid of the one it replaces.
- Golden re-recorded for the nine 1.5D cases on the merged base (ITER15 Q_sci_avg -1.0 %, the others within 0.4 %; q95 of
  the last equilibrium +2 to +4 % and its l_i -4 to -7 % for the large machines; all 21 other cases bit-identical);
  `test/golden/CHANGES.md` has the headline moves and their causes.

### Fixed
- `npm run bench:convergence`: the time-step series (dtMax) failed with "this model has no internal time step
  to limit" since the split of `profiles/model.ts` moved the step proposal to `ctx.dt`; the limiter is now
  `bench/limitStep.ts` (with a test), and the study runs again (ITER15 flat-top Q 10.34 / 10.40 / 10.47 at
  dtMax 0.5 / 0.05 / 0.01 s, 8.94 / 10.34 / 10.51 at 25 / 50 / 100 radial cells).
- The worker pool no longer hangs when a worker exits or crashes while running a task, or when a
  task cannot be sent to a worker (not structured-cloneable): it rejects with an error naming the
  task, and an invalid thread count raises a typed error.
- 1.5D: ELMs and sawteeth right after a Grad-Shafranov update no longer run with zero ion
  density; the work arrays are re-evaluated on the new geometry before the MHD events.
- 1.5D: Grad-Shafranov updates that do not converge are retried (relaxation 0.5, then the
  pressure table filtered at the grid scale) instead of being dropped silently, and rejected
  updates are counted, warned about and retried after a back-off; the shot report gives accepted,
  retried and rejected counts (JET15 accepts 15 of 16 attempts, was 3 of 17). An update whose
  current table had to be rescaled by more than 50 % to meet I_p is rejected (MASTU15 no longer
  ends in a beta-limit disruption after mapping the table through a stale geometry). A typed
  solver failure is reported once with its iterations and residual; invalid input is not retried.
- 1.5D: when the implicit step runs out of retries, time no longer advances without a matching
  state and a non-finite state is never committed; linear-algebra errors no longer crash the run.
  An unrecoverable step ends the shot as 'Numerical failure'.
- 1.5D: the initial Grad-Shafranov solve is retried when it fails; an unconverged result is
  reported; if no equilibrium can be computed (including a > R) the model raises the typed
  `EquilibriumInitFailure`, or the shot ends at t = 0 as 'Equilibrium failure' with a diagnosis.
- 1.5D: rewinding restores the full model state (equilibrium and geometry, controller and filter
  states, disruption state, ELM history, last diagnostics); a replay across equilibrium updates
  and from disruption quench frames is bit-identical, including the shot report.
- 1.5D: sawtooth crashes conserve particles and the electron and ion thermal energy exactly (a
  crash used to lose 3-4e-4 of the electron energy).
- 0D: frames recorded at type-I ELM crashes carried the diagnostics of the pre-crash state (T_e,
  P_fus, P_rad ... 2-4.5 % off their own state); they are now consistent with their state. The
  state, internal state, checkpoints and events of the run are unchanged.
- 0D: a frame recorded at an L-H, H-L or NTM flip carried the pre-flip tau_E, P_cond and P_ELM next to the post-flip
  H_mode (DIII-D 3 s, when it was found: tau_E 0.1345 s against 0.1875 s from the frame's own state). The frame now
  describes its own state (`MagneticModel.postStep` refreshes the frame diagnostics at a flip). The run itself is
  bitwise unchanged; golden moves only in history mean and min statistics of four 0D cases on the merged base (JET,
  SPARC, DIII-D, MASTU: up to 6e-4 on means, 2.6 % on the MASTU Lawson and triple-product minima); a flip that ends a
  step inside an output interval has no frame of its own (ITER, JT60SA, DEMO). The 1.5D model needed no change (its
  flip shows one frame later, pinned by a test).
- Test harness: `npm run coverage` no longer exits 1 with all tests green ("[vitest-worker]: Timeout
  calling onTaskUpdate"): the setup file waits a few real milliseconds before every test so that no
  worker RPC call is pending while a long synchronous test runs. Root cause: the runner sends a task
  update when a test starts and the 60 s birpc timer is served before I/O, so a test body that blocks
  the worker for more than 60 s fails the run; documented in `src/vitest.setup.ts`.
- 1.5D: the fusion and NBI sources evaluate every channel like the 0D model: the D-D thermal rate is
  0.5 (n_a + n_b)^2 (it was fA^2, too low for fuelFracA < 1), burn-up and He-ash production are per
  channel (the D-D side channels of D-3He consume two D each), the beam-target rate has the target
  species of its channel (the beam-target neutrons of D-D, booked on the neutron-free D(d,p)T
  branch, are now counted: x4 in DIII-D 1.5D, x53 in MAST-U 1.5D) and the heating by every charged
  product uses its own Stix critical energy. `StepConstants.btR` (the beam-target rate a `SourceModel`
  sees as `K.btR`) is one array per channel of the fuel, `K.btR[j][i]`, instead of one array: a plug-in
  that reads `K.btR[i]` must index the channel first.
- 1.5D: a blank profile setting in the wizard keeps its default (it overwrote it with undefined and
  crashed or misbehaved); the implicit step retries only numerical failures (typed
  `NumericalFailure`, `LinearAlgebraFailure`, `GSFailure`) and lets programming errors of plug-ins
  propagate instead of ending the shot as 'Numerical failure'; a step that throws such an error,
  also from the update after the accepted step (a plug-in `accepted` hook, the equilibrium
  update), puts y and the context scalars back, so a caller that catches it continues as if the
  step had not been tried.
- 0D: a disruption ends the ignition state (`ignited` stayed 1 through the quench and the report's
  ignition time counted the quench frames; ITER at H98 = 1.6, beta-limit disruption while ignited:
  5.38 s -> 5.04 s of ignition, the disruption at 21.4 s). The 1.5D model did this already.
- Rewinding a 1.5D shot to the frame before a failed step now also removes the failure's end event
  (the event list is truncated by the kernel's event count, not by time).
- A saved Turkish interface language is applied before the first render (no English flash).
- 0D: D-D fuel with `fuelFracA` < 1 no longer underestimates the fusion power (up to 4x at 0.5; the D-D thermal
  rate is 0.5 (n_a + n_b)^2, POPCON too); D-3He includes its D(d,p)T and D(d,n)3He side reactions and produces
  neutrons; ICF burns the selected fuel and Q_eng = G x driver efficiency x thermal efficiency (the driver
  coupling was counted twice: NIF Q_eng 0.016 -> 0.060; new optional `driverEff`/`thermalEff`); a tandem mirror is
  always better confined than a simple one (Pastukhov end-plug factor, new optional `plugPotential`);
  `heating.autoOff` (the ignition test) works: the external heating ramps off at Q >= 5 and an event is logged.
- 0D: sawtooth crashes no longer remove energy and particles twice; a trial stage with W < 0 conducts nothing (it
  held the current quench at 2e-5 s steps); rates stay finite for any finite state (a bounded evaluation
  temperature), so a stiff step into a thermal quench is rejected instead of giving a NaN step size; the
  once-only warning flags survive a rewind.
- Bosch-Hale reference corrected to Nucl. Fusion 32 (1992) 611.
- p-11B beam-target reactivity: the quadrature resolves the 148 keV resonance (it was 31 % off with 48 cells; 1500
  cells for this fuel). Neither model calls it for p-11B, so no simulated number moves.
- 0D: a shot whose fuelling is lost ends with 'Density collapse - fuelling lost' when n_e falls below 10 % of the
  commanded target. With "Max. fueling rate" = 0 the heating stayed on with no particle source, tau_E shrank with
  n and the density fell to zero in finite time: W7-X reached T_e = 1.7 MeV at 0.66 s, stalled the integrator at
  dtMin and overflowed to NaN after 30 s of wall time (now it ends at 0.50 s at 8.5 keV in 32 steps). The 1.5D
  model is not changed.
- A two-knot clamped `CubicSpline` honours its end slopes (it was the straight line between the knots).

Physics results are unchanged by the 1.5D changes above: a full-precision dump of all 21 presets
was byte-identical before and after them. The frame fix of the ELM presets is the exception (see
Changed), and so are the 1.5D physics changes (loss power, fusion and NBI sources, fast ions,
ignition, cell volumes): they move the nine 1.5D golden cases (ITER15 flat-top Q 9.74 -> 10.3, P_fus
490 -> 520 MW; DEMO15 Q 22.7 -> 23.3; SPARC15 Q 6.09 -> 6.32; DIIID15 neutron yield x4.1; MASTU15,
a documented poor case, changes by tens of per cent) and no 0D golden case. The 0D physics changes of the
same release (ws2b, ws2c) move every 0D magnetic golden case; `test/golden/CHANGES.md` names the cause of every
moved case.

## [3.0.0] — 2026-09-23

### Eklendi
- **1.5D profil modeli** (`fidelity: '1.5D'`, tokamak ve sferik tokamak): ρ̂ = √(Φ/Φ_b) üzerinde
  T_e, T_i, n_e ve poloidal akı için örtük sonlu-hacim çözücüleri (geri Euler + Picard, T_e/T_i
  2×2 blok üçlü-köşegen, Scharfetter–Gummel yoğunluk akısı, I_p sınır koşullu akım difüzyonu),
  uyarlanır zaman adımı; τ_E-ölçekli taşınım (PI denetleyici) ve kritik-gradyan alternatifi;
  ETB/KBM pedestal, neoklasik iyon tabanı, NTM ada taşınımı.
- **Grad–Shafranov denge çözücüsü** (`src/physics/equilibrium/`): Miller sınırı, Shortley–Weller
  sonlu farklar, bantlı LU, Picard; 'shape' ve 'table' profil modları; akı yüzeyi izleme, tam
  tuzaklı-parçacık oranı, q, ℓ_i(3), β_p, β_N; Cerfon–Freidberg Solov'ev analitik çözümleri
  (simetrik ve tek-null X-noktalı) ile doğrulama.
- Sauter bootstrap akımı/iletkenliği, 3-bileşenli NBI demet zayıflaması + demet-hedef füzyonu
  tablosu, ECRH/ICRH birikimi, NBCD/ECCD; iki-nokta SOL (Eich λ_q) sınır sıcaklığı.
- MHD olayları: Kadomtsev testere dişi (kayma tetikli, korunumlu düzleştirme), tip-I ELM
  (α_crit, bekleme süresi), modifiye Rutherford NTM (testere dişi tohumlu), L–H histerezisi;
  `crashHook` ile çöküş öncesi/sonrası profil anlık görüntüleri.
- 1.5D preset'ler: ITER, JET DTE2, SPARC, EU DEMO.
- **Sayısal kütüphane** (`src/physics/numerics/`): Thomas, 2×2 blok üçlü-köşegen, bantlı LU,
  Gauss–Legendre, kübik spline, PCHIP, bikübik (Hermite), Brent; sabit adımlı RK4/Euler (karşılaştırma).
- **Çizim motoru** (`src/plot/`): SVG ve PDF 1.4 çıktısı, mini-TeX etiketler, kontur, renk
  haritaları, Okabe–Ito paleti; **makale figürleri** (`npm run figures`, 9 figür + altyazılar).
- **Çok çekirdekli yürütme**: `worker_threads` havuzu; `npm run validate` paralel (`--threads`,
  `--only`), 19 literatür ölçütü (8'i 1.5D).
- Arayüz: sihirbazda model seçimi ve 1.5D ayarları, canlı radyal profil grafiği, GS akı yüzeyli
  poloidal kesit, rapordan SVG/PDF figür dışa aktarımı (tembel yüklenir), ITER 1.5D doğrulama testi.
- Testler: 44 birim testi (numerics, equilibrium, profiles, plot/POPCON, report).
- `CHANGELOG.md`; teknik rapor v3.0 (denklemler, sayısal yöntemler, doğrulama, figürler).

### Değişti
- **POPCON** artık 0D modelle aynı fiziği kullanır (yakıt seyrelmesi, öz-tutarlı He külü, çizgi
  ve senkrotron ışınımı, P_loss = P_heat − P_rad); eski basit sürüm ITER'de gerçekçi olmayan
  geniş bir ateşlenmiş bölge gösteriyordu. Arayüz ve figür aynı hesabı paylaşır.
- 0D manyetik modelin rapor üretimi `confinement/magneticReport.ts`'e taşındı (0D/1.5D ortak).
- `Simulation`, kendi zaman adımlayıcısı olan modelleri (`model.step`) destekler; profiller
  yalnız düzenli çıktı karelerine eklenir (bellek sınırı).
- Shafranov kayması, LCFS'nin geometrik merkezine (R_max + R_min)/2 göre tanımlanır.

### Düzeltildi
- Sihirbazdaki desteklenmeyen safsızlık seçenekleri (N, Fe) kaldırıldı — fizik modülü yalnız
  Be, C, Ne, Ar, W (tohum: Ne, Ar) içeriyordu ve bu seçimler çökmeye yol açıyordu.
- Kontur birleştirmede sıfır uzunluklu parçalar; eksen işaretlerinde kayan nokta birikimi.
- Bosch–Hale kaynak künyesi (*Nucl. Fusion* **32** (1992) 611).

## [2.0.0] — 2026-09-05
- İngilizce arayüz ve rapor düzeltmeleri.

## [0.1.0] — 2026-09-02
- İlk yayın: 0D fizik motoru + web arayüzü.
