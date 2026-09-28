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
- Shared flat-top averaging helper `src/physics/analysis/flatTop.ts` (frame weighting by default,
  optional time weighting).
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

### Changed
- The validation CLI moved to `src/cli/validate.cli.ts` (no Node-only entry point left in
  `src/physics`). Exit codes: 0 all executed checks passed; 1 a check or run failed, or no check was
  executed (previously reported as passed); 2 usage error (unknown flag or preset id, invalid
  `--threads`), where invalid input used to be silently ignored or turned into NaN.
- `figures`: invalid `--scan`, `--only`, `--formats` or `--threads` values are rejected with exit
  code 2 instead of being clamped or ignored.
- README translated to English and extended with a regression-testing section.
- 1.5D: transport-geometry cell volumes are splined from V(rho^2) with the V' end slopes (the
  innermost cell was 1.3 % too small); the flat-top central q(0) of the 1.5D cases moves by -2 to
  -4 % (DEMO15 +15 %) and ITER15 shows 38 instead of 25 sawtooth crashes in 400 s.
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

### Fixed
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

Physics results are unchanged by the 1.5D changes above: a full-precision dump of all 21 presets
was byte-identical before and after them. The frame fix of the ELM presets is the exception (see
Changed).

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
