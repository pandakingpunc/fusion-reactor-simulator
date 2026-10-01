# v4.0 Wave-2B gate report

Gate run on 2026-10-01 in the main checkout, branch `v4/integration`. The first run started at `a430821` and was red on three
steps (section 5.1); the gate's own fixes are `ba56db9` and `a229d7c`, and the second run at `a229d7c` is green (section 5.2).
**Gate HEAD is `a229d7c`**: every software result in this report belongs to that tree, except the rows that say `a430821`
(no production source differs between the two, section 5.3); the commit of this report sits on top of it. All ten Wave-2B lanes are
merged (ws10r during the first Wave-2B run, ws1d at the first restart, the other eight at the last restart); none was left out. The baseline for every "before" number is `947f38b`, the end
of Wave 2A (`docs/v4-wave2a-report.md`); the golden files at that commit are the "before" column of section 6. Nothing was pushed,
tagged or released; `docs/figures` and `.wt/` were not touched. The evidence behind every number is in the git-ignored `scratch/`
(`claude-gate-*` and `claude-gate2-*` records and logs, `claude-results/*.json`, `claude-reportwrite-*` probes) and in
`test/golden/CHANGES.md`; none of it is in the repository.

Between `947f38b` and the gate HEAD: 143 commits (11 merge commits and 132 others: 111 on the lane branches and 21 integrator
commits of merge fixes, tooling follow-ups, golden re-records and test additions), 287 files, +35,905 / -5,758 lines
(`test` +14,742 / -5,111 including the golden JSON, `src/physics` +12,547, `src/ui` +4,745, `src/cli` +1,194, `schema` +684,
`src/i18n` +608, `src/worker` +600, `scripts` +401). Tests grew from 3018 in 221 files (Wave-2A gate) to 3656 in 278.

## 1. Summary and gate verdict

**Software gate: PASS at `a229d7c`, on the second run, after one red run whose causes were in tests and not in physics. Model
validation: NOT claimed.** The software result and the science result are separate in this report; sections 5 and 8 keep them
apart, and a green gate does not close any of the unmet targets in section 8.

What passed at the gate HEAD (section 5): `npm run ci:local` 7/7 steps (tsc, config schema up to date, **278 files / 3656 tests all
passed**, validation **36 passed + 6 known failures + 0 unexpected**, golden **39/39** at 1e-9, production build, main chunk
**219.23 kB** against the 250 kB budget); `npm run coverage` (no threshold error, all files 97.91 % lines, 93.88 % functions,
93.63 % branches) and `npm run coverage:levels -- --check` with every floor unchanged; `npm run typecheck:strict` 37 errors in 25
files against a baseline of 37 in 25 (lowered from 39 in 27 at the end of Wave 2A, never raised). Passed at `a430821` (same
production source): `release:check` 8/8, `missions` 10/10, `build:lib`, `mutation-smoke` **58/58** killed (M21 by timeout only),
`bench:convergence` (ran to completion, exit 0; the script has no verdict and its Q series misses a Wave-2A target, section 8.1), the pause-latency benches (**p99 7.4 to 14.7 ms** at 30x and 100x against the < 60 ms target, one run, shared machine; the 1x rows are 6.3 to 6.4 ms; Wave 2A: 71 to 126 ms).
`figures:check` exits 2 (no `figures.manifest.json`), as expected until Wave 3.

What failed first and how it was closed (section 5.1): at `a430821` `ci:local` and `coverage` stopped on **four wizard tests**
(ws2d gave the ITER preset a 500 s design pulse; ws10r's wizard tests assumed ITER has none; each lane passed alone), and a
supplementary coverage run showed **`src/cli/**` branches at 95.85 % against the 96 % floor** (code that arrived with the ws10c
merge after the floor was set). `ba56db9` fixed the tests; `a229d7c` added 17 tests for the uncovered error paths (98.9 % branches).
The floor was not lowered; no production source changed; the first run's other results stand.

Five things to know before Wave 3, none of them a gate failure:

- **28 of the 39 golden cases moved in the re-record (19 of the 30 cases of Wave 2A, and the nine opt-in cases against their lane
  fixtures); 11 are bit-identical** (section 6). The causes are default-on changes of two lanes (the ws2d 0D
  density controller and published preset builds; the ws6c conservative remap at equilibrium adoption), the merge-level seam fix
  `d3a38aa`, and the Kadomtsev mixing-radius fix `37e3c90`. Flat-top Q of the ELM tokamaks moved by less than 5 %, except
  ITER-DHe3 (+10.6 %), ITER-pB11 (-47.3 %, a collapse case) and SPARC15-pB11 (+11.7 %, section 7).
- **ITER15 sawtooth crashes and the NTM they seed now rest on a hollow-core Kadomtsev model** (section 7.3, 8.1). All 51 ITER15
  crashes happen with q(0) > 1; the crash model was written for one q = 1 surface from the axis; nothing here validates it.
- **ITER15 flat-top Q is no longer converged to the Wave-2A target between 50 and 100 cells**: -1.74 % against a target of 1 %
  (Wave 2A: -0.20 %); cause not isolated (section 8.1). Every other convergence number still meets its target.
- **The unmet science targets are the same as at the end of the lanes**: EPED onset +21 % / +15 % against a 15 % target (25 % band),
  emergent H98 of the Bohm/gyro-Bohm and IFS-PPPL closures outside 0.8 to 1.2 on some machines, the JET DTE2 #99971
  thermal/beam-target split OPEN, a stochastic non-monotone density band within about 2 % of the Greenwald limit, six known
  validation failures. Nothing was tuned to close any of them (section 8).
- **Docs and figures still carry v3 or Wave-1 numbers** (README validation table, `docs/technical-report.md`, `docs/figures`, no
  manifest) and the version is still 3.0.0: Wave 3. Three Wave-3 lane branches (`v4/w3val`, `v4/w3ui`, `v4/w3com`) exist, are not
  merged and are not part of this gate (section 10.5).

## 2. Lanes

Merged into `v4/integration` in this order (merge commit). ws10r came first (the first Wave-2B run, 2026-09-29), then ws1d (the
first restart, the same evening), then the eight lanes of the last restart (2026-10-01) in the order the merge reports give. "Builders" are credited by the commit trailers and the lane
reports (section 9 has the history). The lane branches `v4/ws*` and `.wt/*` are untouched.

| Lane | Topic | Merge | Lane tip (commits) | Merged by |
|---|---|---|---|---|
| ws10r | report keys, Explain/PowerFlow, wizard Advanced section, POPCON edge maps, lazy run screen, bundle budget | `6cee5fb` | `7993259` (8) | Claude |
| ws1d | tooling: timeouts, 58 mutants, coverage globs, `ci:local` knobs | `686dc91` | `1396433` (7) | Codex |
| ws10c | scenario editor and live scenarios | `9ac3b68` (+ `1e35cc5`) | `6aa6ba4` (11) | Codex |
| ws5p | resumable 1.5D steps (pause latency), RNG state | `b33a1f5` | `d271b9f` (8) | Codex |
| ws2d | presets and systems, 0D density controller | `5f0eab2` | `2210fc9` (16) | Codex |
| ws6b | Bohm/gyro-Bohm and IFS-PPPL closures | `0938d2f` | `06fd9f6` (6) | Codex |
| ws6c | current, flux, remap, 0D circuit, Redl | `7452499` | `dd14ed5` (12) | Codex |
| ws6e | He ash and impurities (FACIT) | `09c2380` | `876b47c` (19) | Codex |
| ws6a | EPED1-type pedestal, Loarte ELM loss | `414b452` | `819e979` (10) | Codex |
| ws6d | fast ions, NBCD/ECCD, Porcelli sawtooth | `07b7769` | `3a1ade9` (14) | Codex |

No lane re-recorded a golden file on the merge (the golden JSON of each side was kept, never merged textually; the
`test/golden/CHANGES.md` entries of every lane were kept whole and in time order). The "lane-tip checks" below are what each lane
report states for its own branch; **they are not merged-tree results**, which are in section 5.

- **ws10r, UI wiring (`6cee5fb`).** Builders: Claude (Sonnet 5.5 workflow). A table of English and Turkish labels and units for every
  engineering, edge and systems report key (`src/ui/report/keys.ts`, checked against every key of the golden reports); Explain
  popovers and PowerFlow in Report, the KPI labels and the live values, VerifyBadge in Compare; the wizard Advanced section as a lazy
  chunk (`systems.pulseLength_s`, the 11 remaining `divertor.edge.*` options and, for 1.5D, `rtol`, `atol`, `dtMax`, `gridPacking`,
  `nonlinearSolver`, with the defaults read from the model's own constants) and Turkish text for the pre-existing English-only wizard
  labels; POPCON edge maps through the POPCON worker; the run screen as a chunk of its own (main chunk 262.46 -> 217.81 kB) and
  `scripts/check-bundle.mjs` (budget 250 kB, 85 kB gzip); 3D Show/Hide persisted, the step-control note derived from the
  configuration, the shared-link banner cleared on a new preset, the embedded report without toolbar. Lane-tip checks: tsc clean,
  golden 30/30, validate 36/6/0, strict 38 against a baseline of 39, main chunk 217.81 kB. Review (Claude): 1 major (merge: the
  Scenario step of ws10c has no Turkish title), 2 minor, 3 nit. Integrator follow-ups on the merge: `f25bfa0` (`check:bundle` in
  `ci:local` and CI), `69e7b1d` and `27973a5` (global `testTimeout` 30 s, `hookTimeout`), `86a2ccf` (CHANGELOG), `6d01cd8` (strict
  baseline 38).
- **ws1d, tooling (`686dc91`).** Builders: Claude (Sonnet 5.5). `testTimeout` 30 s and `hookTimeout` 120 s globally, explicit ceilings
  for the heavy tests, Testing Library `asyncUtilTimeout` 15 s in DOM tests; `mutation-smoke` from 15 to **58 mutants** (M16 to M58
  cover TR-BDF2 error control, Anderson Picard, the edge two-point chain, the Tresca layers and the Grad-Shafranov iterations; a
  timeout counts as killed); coverage gates for `src/io/**`, `src/analysis/**`, `src/edu/**` and every threshold ratcheted to the
  measured level (`npm run coverage:levels`); `ci:local` honours `CI_LOCAL_WORKERS`, `CI_LOCAL_THREADS`, `CI_LOCAL_BUNDLE` and has
  `--dry-run`; `usePersistT` no longer sets state after unmount. Lane-tip checks: 228 files / 3061 tests, validate 36/6/0, golden
  30/30, mutation 58/58, `coverage:levels --check` passes (the coverage gate itself was not re-run on the lane after the ratchet).
  Review (Claude): 2 minor (merge: duplicate timeout keys in `vite.config.ts` and two textual conflicts; the thresholds were ratcheted on Wave-2A code only), 1 nit (M21 killed only by timeout).
  The merge (Codex) resolved the overlap and ran `ci:local` on that tree: 7/7, 238 files / 3126 tests, 989.1 s.
- **ws10c, scenario editor (`9ac3b68`).** Builders: Claude (Sonnet 5.5). Scenarios through the worker protocol v3 (init scenario,
  `ScenarioError` as an error message with every path, actuator log, breakpoints and fingerprint at completion, `getLog`, `probe`; v2
  pages and workers are still understood); a lazy editor (one waveform lane per control of `SCENARIO_CONTROLS`, points that drag by
  pointer or keyboard, drop/ramp/gas-puff/interlock templates, a trigger editor, a JSON form, a `rampStep` never finer than
  max(1e-6, t_end/1e4)), a wizard Scenario step, programmed-against-actual lanes and a record mode in the run view, exact-run share
  links that are checked against the model before anything is applied; `--scenario` for `scan`, `uq` and `optimize`; the scenario
  hash in the csv, ndjson, netcdf and imas exports; `schema/scenario.schema.json` and `schema:scenario:check`; en/tr key parity.
  Lane-tip checks: tsc clean, golden 30/30, validate 36/6/0, main chunk 255.55 kB, vitest 226 of 230 files (4 load or lazy-chunk
  timeouts that pass alone). Review (Claude): 1 major (the run-view programmed lane drew null points at the t = 0 value; fixed in
  `6aa6ba4`), 4 minor, 2 nit. Merge conflicts: `src/ui/persist/EmbedView.tsx`, `src/ui/wizard/Wizard.tsx`. First `ci:local` after
  the merge: 3246/3247 (no Turkish key for the Scenario wizard step), fixed by `1e35cc5`.
- **ws5p, pause latency and RNG state (`b33a1f5`).** Builders: Claude (Sonnet 5.5). The 1.5D step that carries a Grad-Shafranov update
  is a resumable computation (`kernel/slices.ts`; `GSSolver.solveSlices` yields after every Picard iteration, `traceSurfacesSlices`
  after 16 rays, `CoupledStepper.stepSlices` after every implicit attempt); `Simulation.advance(dt, { yieldWhen })` can stop inside a
  step, `applyControl` settles a suspended step, `rewindTo` drops it, the worker loop in `host.ts` uses it; the RNG accumulator is
  reduced modulo 2^32 at every draw (sequence unchanged, the run digest of a rewound run equals the uninterrupted one); the
  pause-latency bench gained `--mode stretch` and `--priority`. Lane-tip checks: tsc, golden 30/30, validate 36/6/0, build 262.46 kB;
  the review reproduced a pause wait p99 of 6.7 to 15.8 ms at 30x and 100x (was 185 to 240 ms) and 225/225 files green. Merge
  conflict: `src/worker/host.ts` (the settle-and-post line of the control case was kept). Review (MiMo): 1 major (merge: ws6c and ws6d
  rewrite the bodies that ws5p turned into generators; handled by `d3a38aa`, section 3), 1 minor, 1 nit.
- **ws2d, presets, systems, density controller (`5f0eab2`).** Builders: Claude (Sonnet 5.5; lane tip of the build `7e9bcdb`) and
  MiMo-V2.6-Pro (the fix stage `7edc15c`..`2210fc9`); the WIP probe commit `7022ba1` was kept by the Codex restart. Published builds:
  SPARC inboard TF leg 0.325 m and gap 0.22 m (Creely 2020, figure 2), DEMO 1.3 m leg and 16 coils (Federici 2019, table 3); design
  pulses `systems.pulseLength_s` ITER 500 s, DEMO 7200 s, SPARC 31 s (the full discharge; the 10 s flat top is `t_end`); solenoids
  `systems.cs` for ITER, DEMO and SPARC, the CS swing and margin keys only for a given solenoid; TF nuclear heating from
  P_neutron / 0.80 with the PROCESS fit; `geometryInfo` `kappaB`/`deltaB`; the 0D density controller (`confinement/densityControl.ts`,
  actuator-lag predictor and feed-forward of the present losses: the systematic ramp overshoot 4.5 % -> about 1 %, flat-top
  n_e/n_target 0.999 to 1.003); the near-threshold 0D L-H non-monotonicity documented and tested as physics. Lane-tip checks
  (`2210fc9`): tsc, 225 files / 3058 tests, validate 36/6/0, golden 30/30 (after its own re-record of 18 cases at `7e9bcdb`), main
  chunk 262.43 kB, strict at baseline. Review (MiMo, after a Codex preliminary probe): 1 major (the density-limit contract was
  overstated: seed 2 at 1.01e20 disrupts at 0.988 n_G), closed by honest wording and seed-pinned regression tests and not by tuning
  (section 8.1), 2 minor, 3 nit. No merge conflict.
- **ws6b, transport closures (`0938d2f`).** Builders: Claude (Sonnet 5.5). `'bgb'` (mixed Bohm/gyro-Bohm, Erba et al. 1998 through the
  NTCC JETTO description; coefficients 8e-5, 1.6e-4, 3.5e-2, 1.75e-2) and `'ifspppl'` (Kotschenreuther et al. 1995, a circular-geometry
  fit) as opt-in predictive closures; the `TransportModel.prepare` hook (Lambda and the shear are held on the old state so the Newton
  Jacobian stays block-tridiagonal) and `preferredSolver` (`'auto'` takes the stabilised Picard iteration for both); the emergent
  H98(y,2) and H(ITPA20) as diagnostics of every predictive model; the golden cases ITER15-bgb and JET15-ifspppl; the two closures were
  added to the wizard select at the merge. Lane-tip checks: tsc, golden 32/32, validate 36/6/0, vitest 3036 passed and 11 skipped with
  3 failures in four load-sensitive files (40 + 74 tests pass on rerun with `--testTimeout=180000`). Review (MiMo): 3 minor, none
  blocking. Merge conflict: `test/golden/CHANGES.md`.
- **ws6c, current, flux, remap, circuit, Redl (`7452499`).** Builders: Claude (Sonnet 5.5). The flux ledger of the 1.5D model (`V_loop`
  at the boundary, `V_res`, `psi_used`, `psi_res`, `psi_ind`; V_B I = dW/dt + V_R I closes to 0.06 % of the boundary flux over the
  first 60 s of ITER15, to 1 % in the skin-time test and through an I_p ramp); the 0D plasma circuit (`confinement/circuit.ts`: L_e,
  L_i, the Ejima ramp-up flux with C_E = 0.4 as default (PROCESS), 0.45 as the ITER design value through `systems.cs.ejima`), and
  f_bs (Wilson 1992), f_NI, f_cd and V_loop in the 0D report; the **conservative remap of n_e, psi and the enclosed current at the
  adoption of a Grad-Shafranov equilibrium**; a Grad-Shafranov update on a change of I_p; the opt-in Redl et al. bootstrap and
  conductivity coefficients (`profiles.neoclassicalModel: 'redl'`); CS flux keys only for a designed solenoid and the new key
  'Flux-limited flat top (s)'; the golden case SPARC15-redl and a re-record of the 0D and 1.5D magnetic cases. Lane-tip checks: tsc,
  3071 of 3075 tests (4 load flakes), golden 31/31, validate 36/6/0, strict at baseline, ITER15 flat-top Q +0.17 % at the lane (target
  < 2 %). Review (MiMo): 2 major at merge time (five lanes add parallel override mechanisms to `golden.ts`; the remap does not cover
  the state other lanes add), 3 minor, 2 nit. Merge conflicts in 10 files: `schema/fusion-sim.schema.json`, `config/schema.ts`,
  `confinement/magnetic.ts`, `profiles/model.ts`, `systems/assess.ts`, `types.ts`, `golden.test.ts`, `golden.ts`, `persist/validate.ts`,
  `CHANGES.md`.
- **ws6e, He ash and impurities (`09c2380`).** Builders: Claude (Sonnet 5.5; the fix stage was started by the Claude workflow
  `f61fcc5`..`f8063f6`, continued by Codex `c2dc8f7`, `4b5bb84` and finished by MiMo-V2.6-Pro `fd2bf53`, `876b47c`). Opt-in
  `impurityTransport: 'legacy' | 'anomalous' | 'facit'` with `impuritySetpoint`, `impurityDoverDe`, `impurityPinchOverPe` and extra
  species: n_He(rho), the intrinsic (Be, C, W) and seeded (Ar) species and an optional third on the Scharfetter-Gummel solver; the
  neoclassical coefficients of FACIT (Fajardo et al. 2022, k_i of 2023, refreshed every 0.25 s); local L_z radiation (Mavrin 2018);
  Z_eff(rho) into resistivity and bootstrap; the wall source's steady inventory; the ELM, sawtooth and quench hooks; the golden cases
  ITER15-impurity and ITER15-impurity-neo. Lane-tip checks (`876b47c`): tsc, 223 files / 3067 tests, golden 32/32, validate 36/6/0,
  strict at baseline, and three review mutations (convection sign, the three crash call sites, the g1/gradRho mapping) now killed.
  Review (Claude): 1 major (FACIT wiring and the crash call sites unguarded, closed by tests that also exposed a real defect, the
  main-ion density on a FACIT face was the plain mean of the flanking cells: `f61fcc5`), 3 minor (two of them merge-time: the
  impurity blocks against the ws6c remap, the hard-coded ELM width against ws6a), 5 nit. Merge conflicts: `config/schema.ts`,
  `profiles/model.ts`, `golden.ts`, `persist/validate.ts`, `CHANGES.md`.
- **ws6a, pedestal (`414b452`).** Builders: Claude (Sonnet 5.5, `543d7f2`..`11813b9`), Codex (`192e4f3`), MiMo-V2.6-Pro (`e6e7404`,
  `819e979`). Opt-in `pedestalModel: 'eped1'` (KBM width Delta_psiN = 0.076 sqrt(beta_p,ped), Snyder 2009; a peeling-ballooning height
  closure anchored to the published DIII-D maximum-gradient fit (grad p)_max = 103 (I_p B_T)^0.94 kPa per psiN with the Delta^(3/4)
  dependence, density exponent 0.34 from the published EPED ITER H-mode curve; an adaptive transport barrier) and `elmLoss: 'loarte'`
  (Delta W_ELM / W_ped = 0.0642 nu*_ped^-0.388 fitted to the 84 markers of figure 11 of Loarte et al. 2003; the crash shape is sized
  to carry exactly that energy); the ELM trigger of the fixed pedestal was reviewed (no defect found); 45 pedestal tests; the golden
  case ITER15-EPED. Lane-tip checks (`819e979`): tsc, 222 files / 3066 tests, golden 31/31, validate 36/6/0, strict at baseline.
  Review (MiMo): 3 minor (two on the acceptance window, closed by a window that fails the fixed pedestal and by comparing the onset
  values), 2 nit. Merge conflicts in 8 files: `profiles/context.ts`, `diagnostics.ts`, `model.ts`, `solver/acceptStep.ts`,
  `solver/coupledStep.ts`, `golden.test.ts`, `golden.ts`, `CHANGES.md`.
- **ws6d, fast ions, current drive, sawtooth (`07b7769`).** Builders: Claude (Sonnet 5.5, `cf9ea46`..`c74ae2c`), Codex (`4d884ff`), Codex
  GPT-6.1 Sol (`3a1ade9`). Opt-in `fastIonModel: 'profile'` (alpha and beam energy fields per cell with a slowing-down delay and an
  orbit-width kernel; the Gaffey/Stix steady moments agree with brute-force quadrature to 1e-8; the energy ledger closes to 1e-10 per
  accepted step; fast pressure enters beta, the Grad-Shafranov table and the ballooning drive, not the bootstrap), `cdModel: 'physics'`
  (NBCD of Start and Cordey 1980 with the Mikkelsen-Singer shielding; ECCD of Lin-Liu, Chan and Prater 2003 with a launcher
  configuration), `sawtoothTrigger: 'porcelli'` (Porcelli, Boucher and Rosenbluth 1996) with `sawtoothReconnection: 'kadomtsev'` (a
  helical-flux-conserving psi reset); the golden cases JET15-fast, DIIID15-eccd and MASTU15-saw. Lane-tip checks (`3a1ade9`): tsc, 230
  files / 3123 tests, golden 33/33, validate 36/6/0, strict at baseline. Review (MiMo): 1 minor (JET #99971 split, open, section 8), 2
  nit (header formulas of `porcelli.ts` and `eccd.ts`: the code was verified correct, the formulas did not change; no chunk-invariance
  coverage of the opt-in modes: `3a1ade9` adds six seeded JET15-fast schedules). Merge conflicts in 9 files: `config/schema.ts`,
  `profiles/README.md`, `context.ts`, `diagnostics.ts`, `events/triggers.ts`, `model.ts`, `solver/coupledStep.ts`, `golden.ts`,
  `CHANGES.md`.

## 3. Post-merge integration work

The eight merges were done one after the other with every registry, schema and ledger entry kept; what no lane could see alone was
found afterwards, by the merge reviewers' notes, by the gate and by independent audits. Each row names who did the work as the
commit trailers and the reports say (section 9 has the history).

| Commit | What | Who | How it was checked |
|---|---|---|---|
| `1e35cc5` | Turkish text for the Scenario wizard step (the one failing test of the first ws10c `ci:local`, 3246/3247) | Codex | 32/32 targeted tests |
| `3a1ade9` | (ws6d lane fix, merged with it) six seeded JET15-fast chunk schedules (profile fast ions and physics CD); formulas unchanged | Codex GPT-6.1 Sol | lane tip: 3123/3123, golden 33/33 |
| `d3a38aa` | **seam fix of the merged modules**: every impurity species is remapped with the cell volumes at an equilibrium adoption (no double booking, the fast-ion source keeps its own remap); a throwing or closed (`generator.return`) sliced step restores impurity, coupling, flux, pedestal, fast-ion state, counters and RNG; the Loarte ELM trial evaluates on copies and the actual loss is measured before and after the species flush, with the crash hook after it | Codex GPT-6.1 Sol | 69 targeted tests by the author; independent review (Sol): 5 seam tests and a trial-purity probe, no implementation defect found |
| `89c3f55`, `10bc3dc`, `b03a704` | the import validator knows every optional profile setting: enums, nested ECCD, exact domain bounds | GPT-6 Luna (commits `89c3f55`, `10bc3dc`), merged by Codex GPT-6 Luna (`b03a704`) | `codec.test.ts`: all merged optional modules round-trip without warnings |
| `de96640` | strict baseline lowered 38 -> 37 errors (26 -> 25 files), not raised | Codex (no trailer; credited from the Codex handoff) | `typecheck:strict` exit 0 |
| `c99ebcd` | the ws6e and ws6b merges each added an `o.profiles` override block to `caseConfig` in `src/regression/golden.ts`; the first copy threw before the second could throw the pinned message, so three `golden.test.ts` cases failed; the duplicate (idempotent) block is removed, no golden configuration changes | Claude (root) | `golden.test.ts` green |
| `9016bc7` | the author-verification TODO of `CITATION.cff` removed (the owner confirmed the author record; there is no ORCID); clears the `release:check` `no-todo` failure | Claude (root) | `release:check` 8/8 at `a430821` |
| `cbccf84` | `integrationSeams.events.test.ts`: a real Loarte ELM shot (JET15, 1.0 s, 10 ELMs from 0.6851 s, one rejected and one accepted Grad-Shafranov update) and a real Porcelli plus Kadomtsev sawtooth shot (two crashes with an actual q0 reset) through random chunks, slices that suspend steps and rewinds, compared bitwise with the direct run; every module opt-in on | Claude (Sonnet 5.5 subagent) + independent review | 12 tests; 8 one-line sabotages all caught (the old 0.04 s fixture passed those 8); the reviewer's 16 sabotages: 15 caught, the survivor is an equivalent mutant |
| `862f52a` | a fourth ELM rewind case at the frame of an accepted equilibrium update between ELMs; the header states that the sawtooth shot's `before` and `first` rewinds are adjacent frames (0 and 1) | Claude (Sonnet 5.5 subagent) | 18 seam tests green twice |
| `3fcf528` | **re-record of all 39 golden cases once**, on the merged tree, with one ledger entry (28 updated: 19 of the 30 earlier cases and the nine opt-in cases against their lane fixtures; 11 unchanged; 0 added); every move attributed key by key (section 6, 7) | Claude (Sonnet 5.5 subagent) + two independent reviews | candidate generated twice, bit-identical; 39/39 files byte-identical to the recording; golden 39/39; 57 quoted numbers re-computed from the committed JSON |
| `37e3c90` | `kadomtsevMixingRadius` follows its documented definition for a hollow q core (section 7.3) | Claude (Sonnet 5.5 subagent) + independent review | 15 unit tests (9 fail on the old function); 30000 random monotone profiles bitwise equal to a verbatim copy of the old function (reviewer: 300000 + 300000) |
| `7a8c81d` | re-record of the five cases that `37e3c90` moves (ITER15, ITER15-bgb, ITER15-impurity, MASTU15, MASTU15-saw; 34 byte-identical), with its own ledger entry that also clarifies the earlier entry | Claude (Sonnet 5.5 subagent) + independent review | golden 39/39; the reviewer's 39-case instrumented run equals the committed files at tolerance 0 |
| `897ad8a` | six report keys of ws2d, ws6b and ws6e had no English/Turkish label (`keys.test.ts` failed on the merged tree, also before the re-record) | Claude (root) | `keys.test.ts` green |
| `a430821` | docstring of `kadomtsevMixingRadius`: the hollow-core validity limit; CHANGELOG `[Unreleased]` entries for the three fixes | Claude (root) | review finding of `37e3c90` |
| `ba56db9` | wizard tests that assumed ITER has no pulse length: the blank-field cases use JET or ITER with the field blanked, new assertions pin 500 s for ITER | Claude (root) | 16/16 in the two files; gate run 2 |
| `a229d7c` | 17 tests for the error paths and edge inputs of `src/cli/**` (`scenarioSchema`, `scenarioFlag`, `optimizeSpec`, `provenance`, `pool`; two fixture actions) | Claude (Sonnet 5.5 subagent) | `src/cli/**` branches 855/892 -> 914/924 (98.9 %); gate run 2 |

The real-event tests matter because the first combined fixture (`integrationSeams.test.ts`, 0.04 s) ended before the 0.05 s L-H guard
with q0 = 1.519: it ran FACIT, fast ions, current drive, Redl and equilibrium adoption, but no ELM and no sawtooth, so it could not
show chunk or rewind invariance of the crash paths (found by the Codex seam review, closed by `cbccf84`). Coverage is empirical: two
shots, fixed seeds, four checkpoint types, not exhaustive (section 10.3).

## 4. Opt-in module flags and the nine golden cases

Every Wave-2B physics module is behind a flag of `ProfileSettings` and is off by default: with the flag at its default, the existing
golden cases matched at 1e-9 on the lanes ws6a, ws6b, ws6d and ws6e (no re-record). ws6c's flag `neoclassicalModel` is off by default
too, but the default-on changes of that lane did move the existing cases. (The default-on changes of Wave 2B are: the ws6c remap at equilibrium adoption, the flux ledger, the Ejima default
0.4, the Grad-Shafranov update on a change of I_p, the ws2d density controller and published preset builds, the RNG state reduced
modulo 2^32, and the `37e3c90` mixing radius.)

| Flag (`profiles.*`) | Values (default first) | Lane | Golden case |
|---|---|---|---|
| `transportModel` | `'scaling'`, `'cgm'`, `'bgb'`, `'ifspppl'` | ws6b | ITER15-bgb, JET15-ifspppl |
| `neoclassicalModel` | `'sauter'`, `'redl'` | ws6c | SPARC15-redl |
| `impurityTransport` (+ `impuritySetpoint` `'average'`/`'separatrix'`, `impurityDoverDe`, `impurityPinchOverPe`, `impurityExtraSpecies`, `impurityExtraConcentration`) | `'legacy'`, `'anomalous'`, `'facit'` | ws6e | ITER15-impurity, ITER15-impurity-neo |
| `pedestalModel` | `'fixed'`, `'eped1'` | ws6a | ITER15-EPED |
| `elmLoss` | `'fixed'`, `'loarte'` | ws6a | ITER15-EPED |
| `fastIonModel` | `'scalar'`, `'profile'` | ws6d | JET15-fast |
| `cdModel` (+ `eccd` launcher) | `'legacy'`, `'physics'` | ws6d | JET15-fast, DIIID15-eccd |
| `sawtoothTrigger` | `'shear'`, `'porcelli'` | ws6d | MASTU15-saw |
| `sawtoothReconnection` | `'legacy'`, `'kadomtsev'` | ws6d | MASTU15-saw |

The nine cases (definitions in `src/regression/golden.ts`; values from the committed JSON at the gate HEAD; Q and P_fus are flat-top
means, P_fus in MW):

| Case | Base, length, switches | Q | P_fus | Events | Steps |
|---|---|---|---|---|---|
| ITER15-bgb | ITER15, 16 s, `transportModel: 'bgb'` | 2.514 | 123.7 | 3 sawtooth, burn_start 2, burn_end 1 | 1009 |
| JET15-ifspppl | JET15, 1.5 s, `transportModel: 'ifspppl'` | 0.1760 | 5.917 | 4 sawtooth | 1445 |
| SPARC15-redl | SPARC15, 10 s, `neoclassicalModel: 'redl'` | 6.299 | 161.6 | no ELM, no sawtooth | 1049 |
| ITER15-impurity | ITER15, 60 s, `impurityTransport: 'facit'` | 11.277 | 565.6 | 152 ELM, 2 sawtooth, 1 NTM onset | 3024 |
| ITER15-impurity-neo | ITER15, 30 s, FACIT, `impuritySetpoint: 'separatrix'`, `impurityDoverDe` and `impurityPinchOverPe` 0.05 | 9.616 | 477.9 | 55 ELM | 1513 |
| ITER15-EPED | ITER15, 30 s, `pedestalModel: 'eped1'`, `elmLoss: 'loarte'` | 10.414 | 516.5 | 35 ELM | 1399 |
| JET15-fast | JET15, 1.5 s, `fastIonModel: 'profile'`, `cdModel: 'physics'` | 0.5696 | 18.78 | 33 ELM | 1244 |
| DIIID15-eccd | DIIID as 1.5D, 1.5 s, `cdModel: 'physics'`, ECCD `rho` 0.35, `nPar` 0.35 | 2.838e-4 | 4.255e-3 | 129 ELM | 3742 |
| MASTU15-saw | MASTU as 1.5D, 0.5 s, `sawtoothTrigger: 'porcelli'`, `sawtoothReconnection: 'kadomtsev'` | 1.227e-4 | 2.382e-4 | 76 ELM, 4 sawtooth | 3828 |

They are nine representative combinations. They do not prove every combination or every activation path: a flag in a configuration
is not an activation. Real activation is shown by the targeted tests (a real Kadomtsev reset and a real Loarte ELM in
`integrationSeams.events.test.ts`; MASTU15-saw for the Porcelli trigger; the JET15 5.5 s golden has no q = 1 surface (flat-top q0 1.229, q_min >= 1.04 over the shot),
so it has no sawtooth with or without the Porcelli trigger). The golden `ITER15-EPED` T_ped (flat-top mean 6.09 keV) is a regression
guard of a 30 s shot, not an acceptance number (section 8.1).

## 5. Gate: commands, results

All on Windows 11, Node v24.19.0, 6 cores / 12 threads (AMD Ryzen 5 5600), run by the gate runner one after the other (`claude-gate-run.mjs`:
the runner refuses to start if HEAD differs from the expected one and records HEAD before and after, start and end UTC, exit code
and duration). **Every row of both tables has the same HEAD before and after (`a430821` in 5.1, `a229d7c` in 5.2) and, according to the gate summaries, a clean tree (observed at the start of each phase; the per-row records hold no `git status`).**
`ci:local` ran with `CI_LOCAL_WORKERS=3 CI_LOCAL_THREADS=2`; the other commands used `--maxWorkers=3` or `--threads 2` to `4` as
shown. The machine was shared: the Wave-3 lane builders (RESUME phase E1) were running during both gate windows (their result files
are timestamped inside them), so wall-clock durations are load-dependent and no timing here is a performance baseline; the gate
record's remark that the pause benchmark ran on an "otherwise idle machine" is not established (section 8.1).

### 5.1 First run at `a430821` (red on `ci:local`, `coverage`, `covlevels`)

| Command | Exit | Time | Result |
|---|---|---|---|
| `npm run ci:local` | **1** | 525.2 s | tsc ok (10.6 s); schema ok (0.6 s); vitest 278 files / 3639 tests: **3635 passed, 4 failed** (`src/ui/wizard/advanced.test.ts` x2, `wizardAdvanced.test.tsx` x2); stopped at step 3 of 7 after 513.6 s, so validation, golden, build and bundle were not run by it |
| `npx vitest run src/ui/wizard/advanced.test.ts src/ui/wizard/wizardAdvanced.test.tsx --maxWorkers=2` | 1 | 4.2 s | 12 passed, the same 4 fail: deterministic, not flaky |
| `npm run coverage -- --maxWorkers=3` | **1** | 1147.5 s | the same 4 failures; vitest writes no `coverage-summary.json` |
| `npm run coverage:levels -- --check` | **2** | 0.5 s | no summary because the coverage run failed |
| `npm run coverage -- --maxWorkers=3 --coverage.reportOnFailure=true` (supplementary, not the gate) | 1 | 1126.7 s | the 4 failures and **`src/cli/**` branches 95.85 % (855/892) against the 96 % floor** |
| `npm run coverage:levels -- --check` (on that report) | 1 | 0.6 s | every other glob and metric at or above its floor |
| `npm run typecheck:strict` | 0 | 11.1 s | 37 errors in 25 files, baseline 37 in 25, no file above its baseline |
| `npm run schema:scenario:check` | 0 | 0.6 s | `schema/scenario.schema.json` up to date |
| `npm run validate -- --threads 4 --markdown` | 0 | 240.7 s | 36 of 42 within the accepted range, 6 known failures, **0 unexpected** (section 8.3); a second run with `--json` exit 0, 248.4 s |
| `npm run golden -- --threads 2` (as ci step 5) | 0 | 127.4 s | all 39 cases match at tolerance 1e-9 (126.4 s wall) |
| `npm run build` and `node scripts/check-bundle.mjs` (as ci steps 6 and 7) | 0 / 0 | 16.9 s / 0.1 s | main chunk `index-*.js` **219.23 kB** (budget 250), gzip **72.58 kB** (budget 85) |
| `npm run missions` | 0 | 15.9 s | 10/10 missions solvable and not trivial (start fails, negative control fails, solution passes) |
| `npm run release:check` | 0 | 0.5 s | all 8 checks (version 3.0.0, `[Unreleased]` above `[3.0.0]`, date-released, concept DOI listed, no-todo, 21 presets, engines, license) |
| `npm run figures:check` | 2 | 1.0 s | `no figures.manifest.json in docs/figures`, as before (Wave 3) |
| `npm run build:lib` | 0 | 7.9 s | `index.js` 717.2 kB, `index.cjs` 719.5 kB, `io.js` 36.0 kB, `presetRunner.worker.js` 587.7 kB, `fusion-sim.js` 731.1 kB; the four core bundles contain no `window`, `document`, `node:` or `process` |
| `npm run mutation-smoke -- --threads 2` | 0 | 382.7 s | baseline passes (21 test files, 35.4 s); **58/58 killed**; M21 (the 3/2 factor of the stage-state error estimate) is killed **by the 177 s timeout, not by an assertion** (176.8 s) |
| `npm run bench:convergence -- --threads 3` | 0 | 221.6 s | ITER15, 9 runs of 400 s; tables in section 8.1 (the script has no verdict; the Q series misses a Wave-2A target) |
| `bench/pause-latency.ts --mode both --presets DEMO15,ITER15 --speeds 1,30,100 --priority high` | 0 | 54.4 s | thread wait p99 7.4 to 14.7 ms, loop tasks p99 11.0 to 30.0 ms, 0 messages after a pause (table in section 8.1) |
| `bench/pause-latency.ts --mode stretch ... --priority high` | 0 | 10.6 s | longest kernel yield-to-yield stretch 10.8 ms (DEMO15), 9.9 ms (ITER15); task max 12.8 / 11.6 ms |

Causes: the four wizard tests are a **cross-lane interaction**. ws2d (`d700c00`) added `systems.pulseLength_s: 500` to the ITER
preset; ws10r (`e87f0d7`) wrote wizard tests that assume ITER carries no pulse length (blank field, model default 1055 s). Each lane
passed alone; on the merged tree ITER reports 500 s, `advancedOverrides(ITER_15D)` lists `systems.pulseLength_s`, the field is
pre-filled and the run summary shows an Advanced panel. The assertions were `expected 500 to be 1055`, `expected [ { step: 'driver',
... } ] to deeply equal []`, `expected '500' to be ''` and an advanced-summary panel that was not null: nothing about physics.
`coverage` exits 1 because vitest fails and then writes no summary; the independent `src/cli/**` miss was measured only by the
supplementary run: 857 of 892 branches were needed, 855 covered; the uncovered branches sat in `scenarioSchema.ts` (14/21),
`pool.ts` (122/134), `scenarioFlag.ts` (12/14), `optimizeSpec.ts` (69/73), `provenance.ts` (61/64); `scenarioSchema.ts` and
`scenarioFlag.ts` came with the ws10c merge after ws1d set the floor.

### 5.2 Second run at `a229d7c` (green)

| Command | Exit | Time | Result |
|---|---|---|---|
| `npm run ci:local` | 0 | 968.2 s | 7/7 steps: tsc ok (11.7 s); schema ok (0.6 s); vitest **278 files / 3656 tests all passed** (512.7 s); validation **36 passed, 6 known failures, no unexpected** (280.1 s); golden **39/39** (143.0 s wall); build ok (18.3 s), main chunk `index-BcNHJBIe.js` 219.23 kB (budget 250), gzip 72.58 kB (budget 85) |
| `npm run coverage -- --maxWorkers=3` | 0 | 1151.8 s | 278 files / 3656 tests passed, no threshold error; statements 97.91 % (34030/34753), branches 93.63 % (17007/18164), functions 93.88 % (3102/3304), lines 97.91 % |
| `npm run coverage:levels -- --check` | 0 | 0.6 s | every glob at or above its floor (table below), floors unchanged |
| `npm run typecheck:strict` | 0 | 11.0 s | 37 errors in 25 files, baseline 37 in 25 (not raised); no file above its baseline |

Per-glob coverage (lines / statements / functions / branches, measured against the floor of `vite.config.ts`): `src/physics/numerics/**`
99.0 / 99.0 / 98.4 / 95.8 against 98 / 98 / 98 / 95; `src/physics/validation/**` 99.6 / 99.6 / 100.0 / 92.6 against 99 / 99 / 99 / 92;
`src/physics/**` 99.5 / 99.5 / 97.6 / 94.8 against 99 / 99 / 96 / 93; `src/regression/**` 99.1 / 99.1 / 100.0 / 92.4 against 98 / 98 / 99 /
92; `src/plot/**` 97.5 / 97.5 / 96.3 / 91.6 against 97 / 97 / 96 / 91; `src/cli/**` 98.4 / 98.4 / 94.9 / 98.9 against 97 / 97 / 94 / 96
(branches were 95.85 % before the new tests); `src/io/**` 99.9 / 99.9 / 100.0 / 93.8 against 99 / 99 / 99 / 93; `src/analysis/**` 97.2 /
97.2 / 98.9 / 96.6 against 96 / 96 / 98 / 96; `src/edu/**` 99.8 / 99.8 / 96.3 / 92.9 against 99 / 99 / 96 / 92. `git diff 1396433 HEAD --
vite.config.ts` is empty: no floor was changed after ws1d set them. `scripts/strict-baseline.json` only went down (39 -> 37).

### 5.3 Why the second run is enough for the steps it did not repeat

`git diff --name-only a430821 a229d7c` lists eight files: `src/cli/optimizeSpec.test.ts`, `pool.test.ts`, `provenance.test.ts`,
`scenarioFlag.test.ts`, `scenarioSchema.test.ts`, `src/cli/testdata/pool-fixture.worker.mjs` (test data only, excluded from coverage and
referenced by `pool.test.ts`, `pool.shutdown.test.ts` and the three testdata files `pool-deferred.mts`, `pool-exit.mts` and `pool-sigint.mts`), `src/ui/wizard/advanced.test.ts`, `wizardAdvanced.test.tsx` (+330 / -15
lines). No production source changed, so the first run's `validate`, `golden`, `build`, `missions`, `release:check`, `build:lib`,
`mutation-smoke`, `bench:convergence` and the pause benches stand for `a229d7c`. The second `ci:local` repeated validation, golden,
build and bundle on `a229d7c` anyway (7/7). No Windows exit 3221225477 (0xC0000005) and no `onTaskUpdate` timeout occurred in either
run, and no failing step was repeated unchanged to obtain a pass (the second run followed the two test fixes and nothing else).

## 6. Headline numbers, `947f38b` -> `a229d7c`

"Before" is `test/golden` at `947f38b`, "now" is `test/golden` at the gate HEAD (computed for this report from the committed JSON,
`claude-reportwrite-golden.py`); flat-top values are the time-weighted means over the last 30 % of the run, Q is dimensionless and
P_fus is in MW. Cause codes: **d** ws2d (0D density controller, published builds, design pulses, TF heating), **r** the ws6c
conservative remap and flux ledger, **s** the seam fix `d3a38aa` (only two opt-in cases), **m** the mixing-radius fix `37e3c90`. All
nine cases of section 4 are new at this baseline, so 19 of the 30 earlier cases moved and 11 are bit-identical (every key): NIF, DIRECT, Z, GF, FRXL, ZAP, TAE,
TAE-pB11, MIRROR, MIRROR-DHe3, MUON (the methods that neither ws2d nor ws6c touch). The ledger entries of 2026-10-01 04:53 UTC and
05:50 UTC hold the key-by-key attribution of every other move.

### 6.1 0D presets (cause d; ws6c adds 24 circuit keys to each magnetic case and moves no existing 0D number)

| Case | Q before -> now | P_fus before -> now | Change (Q / P_fus) | What it is |
|---|---|---|---|---|
| ITER | 10.0362 -> 10.084 | 513.71 -> 516.638 | +0.48 % / +0.57 % | n/n_G 0.837 -> 0.848 (design 0.85); Q_sci_max 12.15 -> 12.74; E_fusion 202.1 -> 203.6 GJ; Q_eng 1.061 -> 1.050 |
| JET | 0.386253 -> 0.381444 | 12.882 -> 12.7384 | -1.24 % / -1.11 % | JET.Efus 66.6 MJ (still PASS, accepted 40 to 80) |
| SPARC | 7.55821 -> 7.84251 | 197.33 -> 204.966 | +3.76 % / +3.87 % | n/n_G 0.378 -> 0.392; Q_sci_max 9.31 -> 10.15; the `burn_end` event is gone (burn_start 2 -> 1) |
| DIIID | 2.55354e-4 -> 2.55753e-4 | 3.84092e-3 -> 3.84535e-3 | +0.16 % / +0.12 % | |
| JT60SA | 3.27368e-3 -> 3.26675e-3 | 0.134229 -> 0.134202 | -0.21 % / -0.02 % | |
| MASTU | 6.87112e-5 -> 6.98989e-5 | 1.41059e-4 -> 1.42033e-4 | +1.73 % / +0.69 % | |
| W7X | 6.29073e-6 -> 6.29625e-6 | 4.71804e-5 -> 4.72219e-5 | +0.09 % / +0.09 % | equals the ws2d lane fixture in every key |
| DEMO | 18.2742 -> 19.0278 | 1835.73 -> 1912.19 | +4.12 % / +4.17 % | ELMs 1788 -> 1812; the permanent TF-stress warning is gone (`scalars` warnings count 2 -> 1; the `events.warning` count is 2 in both files) |
| ITER-DHe3 | 3.04031e-3 -> 3.36209e-3 | 0.237791 -> 0.255293 | +10.58 % / +7.36 % | a near-threshold plasma that dithers when the density follows the ramp: L-H 1 -> 8, H-L 0 -> 7 |
| ITER-pB11 | 1.64503e-7 -> 8.6632e-8 | 9.46192e-6 -> 5.06437e-6 | -47.34 % / -46.48 % | the collapse case pinned at n_target 1.0e20: the flat-top window is the shorter run up to the collapse (steps 1318 -> 1386) |

The mechanism of the 0D moves is the one the ws2d lane entry gives (the density follows the ramp of n_target about 6 % more closely
and sits on it in the flat top); it is taken from that entry and not re-derived: the evidence of the re-record is that the new numbers
equal the ws2d lane numbers key by key (W7X in all keys; the nine other cases except the keys that ws6c adds or changes).

### 6.2 1.5D presets (cause r, plus d for the engineering keys; ITER15 and MASTU15 also m)

| Case | Q before -> now | P_fus before -> now | Change (Q / P_fus) | Other keys that matter |
|---|---|---|---|---|
| **ITER15** (400 s) | 10.6967 -> 10.6912 | 537.92 -> 537.655 | -0.05 % / -0.05 % | T_ped 3.491 -> 3.493 keV; f_bs 0.2313 -> 0.2314; l_i(3) 0.7291 -> 0.7281; q95 3.504 -> 3.503; q_min 0.9938 -> 0.9967; V_loop 0.0582 -> 0.0593 V (+1.8 %, boundary-flux definition); ELMs 1332 -> 1327; **sawtooth crashes 40 -> 42 (r) -> 51 (m)**; steps 21562 -> 21207; Q_eng 1.106 -> 1.091; whole-shot E_fusion -2.3 % |
| JET15 | 0.442761 -> 0.443716 | 14.6894 -> 14.7206 | +0.22 % / +0.21 % | q0 1.298 -> 1.229 (-5.3 %), q_min 1.114 -> 1.076; V_loop +1.1 %; Q_sci_max 0.932 -> 0.906; E_fus 82.0 -> 81.8 MJ (JET15.Efus still a known failure); thermal fraction of the fusion power 36.7 % |
| SPARC15 | 6.29029 -> 6.28916 | 161.55 -> 161.499 | -0.02 % / -0.03 % | a sawtooth crash appears (events 0 -> 1); q0 0.860 -> 0.851; V_loop +1.7 %; Q_eng 0.567 -> 0.541 (d) |
| SPARC15-short (3 s) | 5.23285 -> 5.21934 | 134.281 -> 133.884 | -0.26 % / -0.30 % | V_loop 0.0315 -> 0.0487 V (a 3 s shot: the ramp-up dominates the mean) |
| DEMO15 | 23.4987 -> 23.4665 | 2345.79 -> 2342.55 | -0.14 % / -0.14 % | q0 1.471 -> 1.354 (-8.0 %), q_min -5.8 %; V_loop +13.3 %; Q_eng 2.474 -> 2.427 |
| DIIID15 | 2.97154e-4 -> 2.98387e-4 | 4.46869e-3 -> 4.48717e-3 | +0.41 % / +0.41 % | sawtooth crashes 0 -> 2; q0 1.199 -> 1.128 (-6.0 %) |
| MASTU15 | 1.19612e-4 -> 1.19564e-4 | 2.33203e-4 -> 2.33067e-4 | -0.04 % / -0.06 % | sawtooth crashes 34 -> 36 (m); steps 19061 -> 18805 |
| SPARC15-DHe3 | 3.35847e-3 -> 3.39939e-3 | 0.0954915 -> 0.096567 | +1.22 % / +1.13 % | |
| SPARC15-pB11 | 4.62449e-5 -> 5.16526e-5 | 1.27614e-3 -> 1.42441e-3 | +11.69 % / +11.62 % | events LH 2 and HL 1 -> LH 1; central T_i 27.59 -> 28.37 keV (+2.83 %); section 7.2 |

ITER15 Q was 10.7145 in the re-record `3fcf528` and moved to 10.6912 with `37e3c90` (section 7.3); the headline against Wave 2A is
therefore -0.05 %, inside the < 2 % flat-top Q gate that the roadmap sets for the current/flux lane (+0.17 % at ws6c's own tip). The
moves of keys that are phase quantities of short shots (q0, q_min, rho_q1, dWdt, S_fuel, V_loop) are read in the ledger as
sawtooth-phase and start-up effects; that reading is a hypothesis that nothing isolates, what is established is that the remap moves
them.

### 6.3 Engineering numbers of the published builds (cause d; `scalars.engineering.*`)

| Quantity | ITER before -> now | SPARC before -> now | DEMO before -> now |
|---|---|---|---|
| design pulse (`Cryo pulse length`, s) | 1055 -> 500 | 1055 -> 31 | 1055 -> 7200 |
| TF stress (MPa), limit | 489 -> 489, 660 | 1024 -> 1299, 800 (warning kept) | 745 -> 570, 660 (warning gone) |
| TF coils, TF mass (t) | 18, 6201 -> 18, 6201 | 18, 506 -> 18, 385 | 18, 13521 -> 16, 15915 |
| CS flux swing (V s), margin | 188.9, -0.231 -> 237.4, +0.017 | 8.7, -0.765 -> 43.5, +0.210 | 619.3, +0.624 -> 553.8, +1.394 |
| TF nuclear heating (kW) | 44.5 -> 44.8 | 476 -> 589 | 12.2 -> 42.4 |
| cryoplant (MW), net P_el (MW) | 32.6, 13 -> 35.6, 11 | 28.2, -45 -> 36.0, -51 | 30.6, 427 -> 35.7, 450 |

The SPARC 1299 MPa is the free-cylinder model of the inboard leg (the real coil is bucked against the solenoid) against a
316LN-class allowable; the warning stays and is explained at the preset. The CS flux margins follow the ws6c flux budget evaluated on
the ws2d solenoids.

## 7. Explained moves

### 7.1 The ITER15-impurity chain (Q 12.8198 -> 11.2770, -12.03 %)

The case was recorded on lane ws6e (`876b47c`; the golden harness reproduces the stored file there, exit 0). Four steps move it; the
first one decides it. All ablations are diagnostic runs in throwaway worktrees, not candidates; the time-resolved numbers are probe
results and not golden keys.

| Run (60 s) | Flat-top Q | First crash | NTM onset |
|---|---|---|---|
| lane fixture (`876b47c`) | 12.8198 | none in 60 s (about 66.5 s in a longer run) | none |
| merged tree, no psi and density remap (diagnostic) | 12.8226 | none | none |
| merged tree, density remap only | 12.8266 | none | none |
| merged tree, psi remap only | 11.3127 | 49.693 s | 49.920 s |
| ws6c remap complete (`09c2380`, `414b452`, `07b7769`; also the lane plus the remap, bit for bit) | 11.29317 | about 49.3 s | about 49.55 s |
| + the seam fix `d3a38aa` (`3fcf528`) | 11.2995 | 49.355 s | 49.592 s |
| the same with `events.ntm` off (diagnostic) | 12.7958 | 49.355 s (before the crash the NTM has no effect) | none |
| + the mixing-radius fix `37e3c90` (final) | **11.2770** | 49.355 s and 56.100 s | 49.592 s |

**Mechanism (measured; the mechanism numbers below, including the -1.5203 and the 98.4 %, and the perturbation runs were measured on the tree `3fcf528`, before the mixing-radius fix `37e3c90`; on the final tree the flat-top Q moves by -1.5428 (12.8198 -> 11.2770) and a second crash at 56.100 s adds about -0.022 (11.2995 -> 11.2770); the 98.4 % share was not re-derived on the final tree).** At each of the 30 equilibrium adoptions the old scheme kept psi, and with it q, and let the enclosed
current I = V' g2 psi' / (2 pi mu0) follow the change of the metric; summed over the 30 adoptions the enclosed current fell by 0.29 %
of I_p inside rho = 0.18 (about 4 % of the current enclosed there), by 0.65 % inside 0.29 and by 1.11 % inside 0.50, with no source in
the balance. The remap keeps I at every face (largest change 1.6e-14 of I_p) and lets q follow the metric; the changes of q_min at
the adoptions sum to -0.0658 instead of -0.0096. The core is hollow in both trees (q(0) = 1.035 at the crash, q_min = 0.947 at rho =
0.08 to 0.10), q_min falls by about 0.002 per second in both and is 0.038 (20 s) to 0.045 (40 s) lower with the remap, so the q = 1
surface appears at 26.1 s instead of 45.3 s. The sawtooth trigger (outermost q = 1 radius, shear s1 > 0.2 on the nearest face of the
packed grid) fires when rho(q = 1) passes the face midpoint 0.35185, where s1 jumps from 0.155 to 0.24: at 49.355 s with the remap,
at 66.43 to 66.78 s without it (12 perturbed runs of 90 s; 17.0 s later), that is after the 60 s of this shot. The crash seeds a 3/2
island (thermal beta_N 1.838 against the seeding threshold 0.5 x 3.5 = 1.75, a 5.05 % margin) which is seeded at w/a 0.015, passes
0.020 (the NTM_onset event) at 49.592 s and reaches 0.0699 at 60 s; the confinement factor falls to 0.891, the stored energy from
369 MJ before the crash to 305 MJ at 58 s, and the mean Q over 49.6 to 60 s from 12.78 to 10.17. Of the -1.5203 change of the
flat-top Q (window 42 to 60 s), **98.4 % (-1.4964) is the NTM that the earlier crash seeds**; the crash itself costs 0.015 %.
Not the cause: the density part of the remap, the species remap, the lanes ws6a and ws6d (bit for bit unchanged by their merges), and
the seam fix (+0.056 %). The result is systematic, not chaotic: 12 perturbed runs per tree (1e-12 and 1e-9 relative changes of
n_target, B0, I_p, P_NBI, R and five ELM seeds) give one crash at 49.28 to 49.40 s and Q 11.282 to 11.308 on the new tree, no crash
and Q 12.816 to 12.830 on the old one.

**Limits stated with the move.** (i) The move belongs to the default shear trigger (`sawtoothShear` 0.2) acting on a hollow q profile:
with `sawtoothShear` >= 0.3 the new tree has no crash within 60 s either (Q 12.7978), with 0.1 it crashes at 44.45 s, and with the
Porcelli trigger neither tree crashes before 60 s; the first-crash shift is 15 to 19 s for 0.1 to 0.3. This case is a regression
guard of the model, not a prediction of the crash time of ITER. (ii) The remaining -0.19 % (new tree without the NTM against the
fixture) is a systematic effect of the remap with no event in the window, outside the seed scatter, mechanism not decomposed. (iii)
Whether the q profile of the remapped tree is closer to a real ITER flat top is not tested (there is no external q-profile
reference; the argument for the remap is internal consistency: the enclosed current is conserved); the origin of the hollow core is
not analysed. (iv) The default ITER15 (400 s) shows the same shift (first crash 65.229 -> 46.777 s). ITER15-impurity-neo (30 s) has
no crash in either tree.

### 7.2 SPARC15-pB11 (+11.69 %)

The historical lane entry of ws6c said "mechanism not analysed". Independent ablations (Codex GPT-6.1 Sol, the entry of
`3fcf528` uses them) isolate it to the conservative psi and current remap at equilibrium adoptions: psi remap alone +12.1347 %,
density remap alone -0.4673 %, full +11.6937 %; suppressing only the early 17-microsecond L-H/H-L pair of the old run changes Q by
+0.01181 %. At the flat top the ohmic heating at rho < 0.2 rises 8.07 %, the central T_i 2.83 % and P_fus 11.62 % while the mean
T_i changes 0.50 %. The mechanism that links these (a resistive outer-cell artifact of holding psi, a changed radial heating
history, the steep temperature dependence of the low-temperature p-11B reactivity) is inference: the measurements are the ablations,
and the word "proven" in the first ledger entry was too strong (corrected in the entry of 05:50 UTC).

### 7.3 The Kadomtsev mixing radius (`37e3c90`; five cases move)

`kadomtsevMixingRadius` is documented as the radius behind the outermost q = 1 surface where the helical flux
psi*(rho) = integral of (1/q - 1) Phi_b 2 rho drho returns to zero. The loop set "peaked" as soon as one face increment of psi* was
positive and returned at the first face with psi* <= 0; for a hollow core (q0 > 1 with q < 1 in an annulus) psi* is already negative
when the first q < 1 face comes, and the division by a 1e-30 floor returned a sentinel between -1.9e24 and -2.4e25. The crash gate
(`rmix > rho(q = 1)`) therefore closed or opened on a grid artifact (found by the audit of ITER15-impurity: the "intermittently open
gate" of the first ledger entry was that artifact). The fix: psi* counts as peaked only if it is positive after the last q < 1 face
interval; rho_mix is the first return to zero behind it; -1 when there is no positive lobe or q >= 1 everywhere; 1 when it never
returns; never below -1, never NaN. No threshold or other model was touched, nothing was tuned. For monotone profiles with q0 < 1 the
result is bit for bit the old one (30000 random profiles against a verbatim copy; the reviewer ran 300000 and 300000 more).

| Case | Crashes old -> new | Flat-top Q old -> new | Note |
|---|---|---|---|
| ITER15 (400 s) | 42 -> 51 (period 9.52 -> 7.84 s); first crash 46.777 s and its NTM onset 47.007 s unchanged | 10.7145 -> 10.6912 (-0.218 %) | the sentinel blocked 3498 of 3540 trigger firings of the old run from 54.348 s |
| ITER15-bgb (16 s) | 2 -> 3 (new: 12.814 s) | 2.5407 -> 2.5145 (-1.03 %) | 96 of 98 firings blocked in the old run |
| ITER15-impurity (60 s) | 1 -> 2 (new: 56.100 s) | 11.2995 -> 11.2770 (-0.198 %) | first crash and NTM unchanged; -12.03 % against the lane fixture instead of -11.86 % |
| MASTU15 (2 s) | 35 -> 36 (first at 0.227 s instead of 0.291 s) | 1.19675e-4 -> 1.19564e-4 (-0.09 %) | the preset barely burns |
| MASTU15-saw (0.5 s) | 4 -> 4 (all earlier) | 1.2104e-4 -> 1.2273e-4 (+1.40 %) | |

The first divergence of every case is the first blocked crash of the old run. The other 34 cases are byte-identical (the reviewer's
instrumented run of all 39 reproduced the committed files at tolerance 0). `validate` unchanged (36 / 6 / 0; the one check value that
moves is ITER15 P_fusion 539 -> 538 MW, accepted 300 to 800).

**What this does not validate.** All 51 ITER15 crashes (and 2 of 2 of ITER15-impurity, 2 of 3 of ITER15-bgb) occur with q(0) > 1,
where the psi*(0) = 0 reference is an integration constant and not the helical flux of the O-point; `kadomtsevReset` returns null for
q0 > 1, so 2 of the 4 crashes of MASTU15-saw take the q -> 1.01 rebuild and bypass the helical-flux reset (the case no longer guards
the reset path alone); the crash amplitude does not depend on the size of the helical-flux lobe (the first new MASTU15 crash opens at
a psi* margin of 2e-4 of the core deficit); about 31 of 35239 gate evaluations of ITER15 return a radius that is not beyond the
interpolated rho(q = 1) (grid effect, the gate stays closed). The ITER15 crash rate, the trigger thresholds and the hollow-core use
of the model are not validated (docstring of `mhd.ts` and the ledger say so).

### 7.4 The opt-in cases and the merge residues

- The six opt-in cases recorded on their own lanes (ITER15-bgb, JET15-ifspppl, ITER15-EPED, JET15-fast, DIIID15-eccd, MASTU15-saw)
  move through the ws6c remap acting on their own physics: with the remap switched off at `c99ebcd` each reproduces its lane fixture
  in every key except the engineering keys that ws2d changed. The size and sign of these moves (ITER15-bgb Q +1.58 % with a new
  `burn_end` event at the remap, JET15-fast flat-top V_loop +57 %) follow the event phase of short shots (hypothesis, no run isolates
  it); none is a validated prediction. SPARC15-redl moves only through the ws2d design numbers (Q 6.2987, every plasma key
  unchanged).
- ITER15-impurity-neo moves in two steps: the remap on the ws6e module (Q 9.6349 -> 9.5921, -0.44 %), then the seam fix (9.5921 ->
  9.6156, +0.24 %; the two parts of `d3a38aa` are not additive).
- Residues of the merge itself, found by the key comparison: the new key 'Flux-limited flat top (s)' in 16 cases (the `assess.ts`
  resolution at `7452499`); `scalars.engineering.Flux required (V s)` is still published for JET, DIIID, JT60SA, JET15, DIIID15,
  JET15-ifspppl, JET15-fast and DIIID15-eccd (ws2d's rule is kept, the ws6c entry lists the key as removed: an owner decision, no
  physics number changes); a DEMO15 cryo-heat rounding boundary (132.7 against 132.8 kW, hypothesis).

## 8. Scientific validation status (kept separate from the software gates)

Passing code and tests does not establish empirical accuracy. The reference table is unchanged since `947f38b`
(`src/physics/validation/references.ts` has no diff) and no coefficient, threshold or literature range was changed to make a number
pass. Two measurements below were made again for this report on the gate HEAD (probes `claude-reportwrite-eped.mts`, 17 s, and
`claude-reportwrite-h98.mts`, 52 s, both exit 0 with HEAD unchanged); the others are test results of the gate runs or the lane
reports, named as such.

### 8.1 Targets and what was measured

The rows are of three kinds, and only the first kind is validation against external data: **validation** (EPED, emergent H98, JET #99971, density controller near n_G, ITER15 flat-top Q, He ash, sawtooth period, FACIT, published TF builds); **verification** against analytic limits or conservation ledgers (flux closure and Ejima, fast ions); **software or performance budget** (pause latency, main chunk, ITER15 convergence of the numerical solution). A "met" in the last two kinds does not say the model agrees with experiment.

| Target | Measured | Status |
|---|---|---|
| **EPED**: ITER15 pedestal within 15 % of the published EPED prediction (roadmap 6a); converged between 50 and 100 cells | like-for-like at the ELM onset, ITER15 50 s, window 34 to 50 s, model on, `a229d7c`: pressure **87.39 kPa against 72.18 kPa** of the published H-mode branch at the density of the shot (**+21.1 %**), T_p 5.80 against 5.03 keV (**+15.4 %**) (lane tip `819e979`: +20.9 % and +15.1 %); onset p / limit 1.038; pedestal width 0.0342 in psi_N, 14.5 % below 0.04 (the guard is 15 %, margin 0.45 points); cycle-mean T_ped 4.96 keV (-1.4 % of 5.03) against 4.48 keV (-10.9 %) of the fixed pedestal; 54 ELMs; 50 against 100 cells: T_ped +0.50 %, onset p +0.23 %, limit -0.02 %, width -0.01 % | **15 % NOT met** (the onset band the test enforces is the honest 25 % of a reduced closure); grid convergence met |
| **Emergent H98 of the predictive closures** in 0.8 to 1.2 (roadmap 6b) | bgb: ITER15 (60 s) H98(y,2) **0.701**, H(ITPA20) 0.817, Q 6.07, T_ped 1.54 keV, alpha_ped/alpha_crit 0.29; JET15 (5.5 s) **1.024** / 1.102; SPARC15 (3 s) **0.644** / 0.619; ifspppl: ITER15 **0.287** (L-mode: P_loss 38.8 MW against P_LH 68.8 MW), JET15 **0.442**, SPARC15 **0.304**; golden ITER15-bgb (16 s) 0.641 and JET15-ifspppl (1.5 s) 0.433; the lane measured DIII-D 1.5D 1.09 and MAST-U 1.5D 0.93 for bgb | **met** only for bgb on JET15 (and DIII-D, MAST-U at the lane tip); **not met** for bgb on ITER15 and SPARC15 and for ifspppl everywhere. These are outputs; no coefficient was tuned. |
| **JET DTE2 #99971** thermal/beam-target split within 15 % of Stancar et al. 2023 (roadmap 6d) | the paper gives no split for #99971 and a baseline-scheme trend of about 50 % thermal; the model's JET15 flat top at the gate HEAD has P_bt 9.32 of P_fus 14.72 MW, a thermal fraction **36.7 %** (JET15-fast: 38.1 %), 27 % below the trend; beam-beam fusion and fast-ion losses are not modelled; the T-rich #99972 comparison (a different pulse) is only within a factor of two | **OPEN**; no coefficient was fitted |
| **Density controller** near the Greenwald limit (ws2d) | the systematic ramp overshoot fell from about 4.5 % to about 1 % (flat-top n_e/n_target 0.999 to 1.003; about 6 % after a step drop of the loss rate to two thirds); a stochastic band within about 2 % of n_G remains: with t_end 4 s, seed 2 disrupts at 1.01e20 (0.988 n_G, t = 1.79 s) and survives 1.02e20 (peak 0.999), seed 11 disrupts at 1.02e20 (t = 1.95 s) and survives 1.04e20 (peak 0.997); outcomes also change with t_end at a fixed seed (`dtMax = min(0.05, t_end/400)` re-schedules the RNG event draws) | the band is **stochastic and non-monotone**; the tests pin it per seed and fail without the feed-forward; **no unconditional "no overshoot" or "safe below n_G" claim is made**, a set-point within about 1.5 % of the limit can still touch it |
| **Pause latency of the simulation worker**, p99 < 60 ms | thread wait p50 / p95 / p99 / max (ms), 4 s per row, 30 to 34 requests: DEMO15 1x 0.8 / 6.2 / 6.3 / 6.3, 30x 3.0 / 9.6 / 10.6 / 10.6, 100x 4.7 / 10.0 / 14.7 / 14.7; ITER15 1x 0.4 / 6.0 / 6.4 / 6.4, 30x 4.5 / 8.1 / 11.7 / 11.7, 100x 3.5 / 7.0 / 7.4 / 7.4; loop task p99 11.0 to 30.0 ms and longest task 13.7 to 34.0 ms; 0 messages after a pause; the longest kernel yield-to-yield stretch 10.8 ms (DEMO15) and 9.9 ms (ITER15). Wave 2A, same benches: wait p99 71 to 126 ms at 30x and 100x, task p99 40 to 67 ms, longest task 100 to 129 ms | **met on this run** (7.4 to 14.7 ms at 30x and 100x); one 4 s run per row with `--priority high`, p99 equals the maximum of about 30 requests, and the machine was shared with the Wave-3 builders; not a controlled idle measurement; the unsliced stretches that remain are one implicit attempt (up to about 18 ms on ITER15 and DEMO15 ramp-up) and the tail after the last Picard iteration plus adoption (8 to 13 ms) |
| **ITER15 convergence** (WS3 of Wave 2A: Q, f_bs, l_i, T_ped change < 1 % between 50 and 100 cells and between rtol 1e-3 and 1e-4; ELM count < 2 % across the step limits) | 25 / 50 / 100 cells: Q 10.44 / 10.69 / 10.51 (50 -> 100: **-1.74 %**; oscillatory, GCI 7.1 %), f_bs -0.47 % (p 1.51), l_i(3) 0.7116 / 0.7281 / 0.7233 (-0.66 %, oscillatory), T_ped 3.562 / 3.493 / 3.493 keV (-0.02 %); rtol 1e-2 / 1e-3 / 1e-4: Q 10.69 / 10.72 / 10.73 (+0.09 % for 1e-3 -> 1e-4), f_bs +0.09 %, l_i -0.03 %, T_ped -0.04 %; dtMax 0.5 / 0.05 / 0.01 s: Q 10.69 / 10.69 / 10.73 (+0.39 %), T_ped 3.493 / 3.500 / 3.484; ELMs 1311 / 1327 / 1324, 1327 / 1330 / 1330, 1327 / 1327 / 1333 (0.45 % at most across the limits). Wave 2A, same comparisons: Q -0.20 %, f_bs +0.07 %, l_i +0.43 %, T_ped -0.57 % | **one number misses**: Q between 50 and 100 cells (-1.74 % against 1 %), the series is oscillatory (25 -> 50: +2.36 %); **cause not isolated**: ITER15 now has 51 sawtooth crashes and an NTM (Wave 2A: 40 crashes), so event-phase noise is a candidate, untested. All other numbers meet their target. |
| ITER15 flat-top Q moves < 2 % with the current/flux lane (roadmap 6c) | -0.05 % against `947f38b` at the gate HEAD (+0.17 % at the lane tip) | met |
| **Flux closure and Ejima** (6c) | V_B I = dW/dt + V_R I closes to 0.06 % of the boundary flux over the first 60 s of ITER15 and to 1 % in the skin-time test and through an I_p ramp (lane report); C_E = 0.4 default (PROCESS), 0.45 as the ITER design value through `systems.cs.ejima` | met (lane tests, green in both gate runs); the roadmap's Gribov 2015 citation for the ITER C_E range is the vertical-stabilisation paper and was replaced by ITER Physics Basis ch. 8 |
| **Fast ions** (6d): Gaffey moments 1e-4, energy conservation 1e-10 | moments agree with brute-force quadrature to 1e-8; the energy ledger closes to 1e-10 per accepted step | met (lane tests, green in the gate runs) |
| **Sawtooth period** (6d): JET15 shows a finite period | the golden JET15 (5.5 s) has flat-top q0 1.229, q_min >= 1.04 over the shot and no q = 1 surface, hence no crash (the roadmap's "q0 = 0.92 with no crash for 5.5 s" no longer holds); a 14 s JET run with the Porcelli trigger gave a period of about 2.4 s (crashes at 11.0 and 13.4 s; lane report at `4d884ff`, not re-measured on the merged tree); MASTU15-saw has 4 crashes in 0.5 s (2 of them on the hollow-core fallback, section 7.3) | met at the lane tip only (14 s run; not re-measured on the merged tree, where the JET15 q0 moved from 1.298 to 1.229); not in the golden window |
| **He ash** (6e): ITER f_He 2 to 4 % at tau_He*/tau_E = 5 | ITER15-impurity (gate HEAD): n_He/n_e 3.68 %, tau_He* 12.53 s, tau_E 2.42 s (ratio 5.17) | met |
| **FACIT** reduced form (6e) | a reviewer compared every formula term by term with the Aurora FACIT source; there is no numerical benchmark against NEO or Aurora output (limits of the theory and regression pins only); one mean charge per species, no neutral dynamics, first-order splitting outside the TR-BDF2 error estimate | **not an external benchmark** |
| **Published TF builds** (ws2d) | DEMO leg and table values verified against Federici 2019 table 3 by the reviewer; the SPARC leg (0.735 to 1.060 m), the CS radii and the pulse times were read from Creely 2020 figures 2 and 3 (vector data) and not all re-verified (publisher sites returned 403 or reset the connection); only Hartwig 2024's "approximately 22 T peak field on coil" was re-checked against the model's 21.3 T | provenance partly unverified; SPARC TF stress 1299 MPa against 800 keeps its warning |
| **Main chunk** <= 250 kB | 219.23 kB (gzip 72.58 kB); Wave 2A 262.46 kB | met, and enforced by `check:bundle` inside `ci:local` |

### 8.2 Scientific claims corrected during this phase (so that nobody relies on the earlier wording)

- ws2d's density-limit contract ("clean threshold about 1.02e20", "no overshoot onto the limit") was overstated; the text, the
  mission comments and the regression titles now say what section 8.1 says.
- The README and CHANGELOG of ws6e attributed the hollow light-impurity profile of ITER15 to FACIT temperature screening; it is the
  anomalous closure with the volume-average controller and is present without FACIT (Be edge/axis ratio 1.93 -> 2.26, Ar 1.93 -> 5.10
  from `'anomalous'` to `'facit'`: FACIT shapes the heavy species).
- ws6a's first ITER15 acceptance window did not discriminate (the fixed pedestal at `947f38b` also passed); it now fails the fixed
  pedestal, and the primary quantity is the pedestal at the ELM onset.
- The Wave-2A assumption that the largest TR-BDF2 energy residuals come from the P_SOL lag is not supported: they belong to the steps
  right after a discontinuity (start-up, the L-H transition, a sawtooth crash) (ws6b).
- The first ledger entry of 2026-10-01 (04:53 UTC) says "proven" for the SPARC15-pB11 mechanism (inference beyond the ablations),
  describes the Kadomtsev gate as "intermittently open" (a grid artifact) and quotes time-resolved ITER15-impurity numbers that are
  probe results and not golden keys; the entry of 05:50 UTC states each correction (the first entry is append-only and was not
  edited).
- The Codex handoff reported the lane tip of ITER15-impurity at Q 12.9705 against the stored 12.8198 as an unexplained discrepancy;
  it was an artifact of the probe (section 9).

### 8.3 The six known validation failures (unchanged; the ranges were not touched)

`npm run validate`: 36 of 42 within the accepted range, 6 documented known failures, 0 unexpected. Each failure is explained in
`references.ts` and not closed by changing an interval: `JET15.Efus` 81.8 MJ against 59 +/- 6 (accepted 40 to 80; beam-target fusion
of the 1.5D model), `DIRECT.G` 3.1 against 0.74 +/- 0.14 (0.3 to 1.76; no laser-plasma instabilities), `Z.yield` 2.0e14 against 1.1e13
(3.66e12 to 3.30e13; no liner-fuel mix), `TAE.Ttot` 1.21 against 3 keV (1.5 to 6; single-temperature FRC), `MIRROR.Te` 9.53 against
0.66 +/- 0.05 keV (0.33 to 1.8; single-temperature mirror), `MUON.Yf` 106 against 150 +/- 20.4 (109 to 191; sticking). The rule of the
Wave-1 report still holds: if one flips to XPASS, reword the note, never retune the range. The Wave-2A rows that Wave 3 reviews
(Sauter q95 constants, MAST-U campaign ranges, alpha-share tolerance, ITER15 n_G 0.80 against 0.85 and T_ped 3.49 against 4.5 keV)
are unchanged here.

### 8.4 What the green software gate does not prove

A passing `ci:local` shows that the code does what the tests say, that the 39 golden cases did not change since the recording, and
that the rewind, chunking and slicing contracts hold on the shots the tests run. It does not show that any closure predicts a real
plasma: the predictive transport formulas are implemented as published and tested against their own limits, the pedestal and ELM
closures are reduced fits (an extrapolation of a DIII-D anchor, an empirical ordering with rms scatter 0.40 in ln(Delta W / W_ped)),
the hollow-core sawtooth is outside the premise of its model, and the near-limit density behaviour is stochastic.

## 9. Restart and audit facts

The work was done by five parties in this order: **Claude, Codex, MiMo-V2.6-Pro, Codex, Claude**. Times are local (UTC+3) and the
roles are those the commit trailers, the saved reports and the archive prompts show.

1. **Claude (Wave 1, Wave 2A, first Wave-2B run).** Subagents ran as Sonnet 5.5; the root session's own commits of the first Wave-2B run (`f25bfa0`, `69e7b1d`, `27973a5`, `86a2ccf`, `6d01cd8`, and the ws10r merge `6cee5fb`) carry Sonnet 5.5 trailers, and only the five commits of the current closing session (`c99ebcd`, `9016bc7`, `897ad8a`, `a430821`, `ba56db9`) carry Opus 5.5.
   Wave 1 and Wave 2A were completed by 2026-09-29, Wave 2A at `947f38b` (two usage-limit interruptions in 2A, each resumed from committed state). The
   first Wave-2B run started the same afternoon (10 lanes forked from `947f38b` in `.wt/<lane>`); the usage limit cut it after about
   50 minutes with no builder finished, it was resumed, and it was **stopped by the user for an account switch** in the evening (the
   last Claude commit of the run is `6d01cd8` at 20:41) with integration at `6d01cd8`: ws10r merged, ws10c and ws1d ready to merge, ws6a and ws6d builds in progress, ws6b, ws6c, ws5p, ws2d
   in review, ws6e in its fix stage. Orphaned test processes were killed; nothing was pushed.
2. **Codex (GPT-6 Sol), 2026-09-29 evening.** Restarted from a saved workflow, merged ws1d (`686dc91`, with `ci:local` 7/7, 238 files /
   3126 tests, 989.1 s on that tree), kept the ws2d density probe as a WIP commit (`7022ba1`, no trailer), continued ws6a, ws6d and
   ws6e (`4d884ff`, `192e4f3`, `4b5bb84`, `c2dc8f7`), and wrote the first independent probe of the density band that became the ws2d
   major finding.
3. **MiMo-V2.6-Pro, 2026-09-30 evening** (the user's model override of that day; every restart prompt names it): the reviews of ws2d,
   ws5p, ws6a, ws6b, ws6c and ws6d (20:34 to 21:31), and the fix stages of ws6e, ws2d and ws6a (`fd2bf53`, `876b47c`, `7edc15c`,
   `b955912`, `051a853`, `a09302c`, `2210fc9`, `e6e7404`, `819e979`). It left eight lanes ready to merge.
4. **Codex (GPT-6 Sol, GPT-6.1 Sol, GPT-6 Luna), early on 2026-10-01 (merges 05:28 to 05:48, stop 06:18).** Merged the eight lanes in the order of section 2 (merge
   reports for each; conflicts resolved with both sides kept), fixed the Turkish key, wrote the seam fix `d3a38aa` and its independent
   Sol review (no defect found; one test-coverage gap: the combined fixture had no real ELM or sawtooth), the import guards (Luna), the
   strict baseline, the ablation audit of SPARC15-pB11, a first isolation of the ITER15-impurity move (seam fix +0.056 %, not the
   cause; remap omitted reproduces the old value), a numerical evidence map, a Wave-3 readiness audit and a draft of this report
   (state PENDING). Gates run before the stop: schema, strict (37/25), `validate` (36 + 6 known + 0 unexpected, 229 s at `de96640`),
   `missions` 10/10, a 39-case candidate golden (130 s), `release:check` (exit 1: the CITATION author TODO), `figures:check` (exit 2).
   `mutation-smoke` (M1 to M20 killed, M21 running) and `bench:convergence` (7 of 9 runs) were **interrupted by the user's stop**
   (exit -1: a stop, not a verdict; both were re-run to completion at `a430821`). The user stopped Codex at 03:18 UTC (06:18) with
   HEAD `de96640` and a clean tree; the package (handoff note, prompt, 93 evidence files) is archived outside the repository.
5. **Claude (this session, from the morning of 2026-10-01; first commit `c99ebcd` at 06:44).** Root commits `c99ebcd`, `9016bc7`, `897ad8a`, `a430821`, `ba56db9`; Sonnet 5.5
   subagents for the audits and tests, each with an independent reviewer: the real-event seam tests, the ITER15-impurity audit and
   the golden attribution (three reviews, all "confirmed with corrections", the corrections applied to the ledger text), the golden
   re-record, the seam-adoption case, the mixing-radius fix and its re-record (review: confirmed with corrections, the validity
   caveat strengthened in the docstring), the gate, and this report. The mutation sandbox that the Codex stop left under `%TEMP%`
   was removed (junction first). The owner's confirmation of the author record of `CITATION.cff` (2026-10-01) is the basis of `9016bc7`. The Codex handoff
   and the Claude RESUME file record a conditional owner authorisation of a later push, tag and release after the gates and a final
   audit; none of that has been done and this report does not depend on it. A RESUME file and per-agent result files were kept so
   that a usage-limit stop loses nothing.

**The Codex probe artifact.** Codex's lane-tip measurement of ITER15-impurity at `876b47c` gave Q 12.9705 against the stored
12.8198 and was handed over as an unexplained lane discrepancy. The audit found it was an artifact of the observer: the probe wrapped
`EquilibriumCoupling.prototype.update` in a `function*` generator, but on the lane commit `update` is a plain function, so the
wrapper returned an unconsumed generator that the caller counted as an accepted update: 0 `adoptGeometry` calls instead of 30,
Shafranov shift 0.055 m instead of 0.198 m, while the report still said "GS accepted 30". The plain run is Q 12.8198, bit for bit the
fixture (golden CLI at `876b47c`, exit 0); an independent reviewer re-created the wrapper and got 12.970527291129311, exactly Codex's
number. Codex's merged-tree runs were valid (an unwrapped merged run is bitwise Codex's seam number 11.2994641958019), and its
hypothesis "q0 < 1" was wrong in the letter (it is q_min off axis that crosses 1).

Other audit facts: the golden JSON files were never merged textually; `test/golden/CHANGES.md` is append-only and was checked (the old
301540 bytes are a byte-identical prefix of the file after `3fcf528`, one entry appended, 0 lines removed; `7a8c81d` is +40 / -0);
the reports state that no stash was used and no dependency was installed in this phase, and that the `node_modules` junction of
each temporary worktree was unlinked first; every prompt after the Wave-1 privacy incident carries the privacy rule, and no incident
is recorded in this phase.

## 10. Wave 3 backlog

The authoritative sources are the roadmap section 5, `docs/v4-wave2a-report.md` section 9, and this phase. Local only: no push, tag,
release, Zenodo, PyPI or Pages action is part of Wave 3 until the owner-authorised release step.

### 10.1 Roadmap section 5 (in order)

1. **Numbers diff.** Merge all branches, write `docs/v4-numbers-diff.md`: a before/after table (v3.0.0 against v4) for every headline
   number (ITER 0D Q and P_fus, JET E_fus and beam-target share, SPARC, DEMO, NIF, ITER15 Q, f_bs, l_i, T_ped) with its cause; sections 6
   and 7 are the Wave-2A to Wave-2B part of it. Gate: `ci:local` green.
2. **i18n, then a11y.** TR/EN extraction (stable report ids, event codes and parameters, `Intl.NumberFormat`, runtime `<html lang>`),
   then keyboard, semantics, mobile; gate: pseudo-locale and axe-type checks.
3. **Formatter.** Biome whole-repo reformat as one commit listed in `.git-blame-ignore-revs`, only if an approved tool is available,
   and only while no other agent edits the checkout.
4. **Validation v2.** Reference table with DOIs, newly checked presets, NIF calibrated on N210808 and the other shots predicted blind,
   MagLIF (Gomez 2020), W-7X OP1.2, the Sauter q95 constants, MAST-U ranges, alpha-share tolerance, `JET15.Efus` (reword on XPASS, never
   retune), ITER15 n_G and T_ped; "benchmarked" instead of "validated" where the deviation exceeds 20 %; gate: `validate --json` with all
   rows and ratios; ranges and coefficients are not changed to pass.
5. **Figures.** One deliberate `npm run figures` into a scratch `--out` first, inspect every changed figure and caption, update the
   builder hashes only when justified (`UPDATE_FIGURE_GOLDEN=1` after viewing), then regenerate `docs/figures` and the manifest once;
   `figures:check` into `ci:local`; the UQ, Pareto and rho-t builders need registry entries and study data, `fig05` needs reference
   bands and 5-95 % intervals; the solver-counter caption in `paper.ts` ('only after a retry stage') is outdated.
6. **Docs.** English README with a Turkish mirror, `docs/technical-report.md` v4 (English, Turkish update) including edge, systems,
   scenario, UQ, G-EQDSK, TR-BDF2, the Wave-2B modules and their limits (section 8), the generated config reference, the convergence
   tables; no stale numbers (README validation table and its figure, technical-report timing rows: ITER15 400 s is about 24 s and 2e4
   steps, DEMO15 500 s about 140 s, both from the idle machine of Wave 2A, `docs/v4-wave2a-report.md` section 9, which supersedes the Wave-1 section 5 numbers).
7. **JOSS paper.** `paper/paper.md` and `paper.bib` (750 to 1000 words), statement of need, the section 5 and 6 tables of the reports,
   an AI-assistance disclosure, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue and PR templates, `paper/READINESS.md`.
8. **Release preparation (local).** 4.0.0 in `package.json`, `package-lock.json`, `CITATION.cff`, `.zenodo.json` and `CHANGELOG.md` (the
   `[Unreleased]` lines become a 4.0.0 section with "Numbers that changed"), `release:check --no-allow-unreleased`, `ci:local` and
   `figures:check` green, an independent final audit of every Claude, MiMo and Codex change, then a local fast-forward of `main` from
   `v4/integration`. The 4.0 version DOI exists only after the owner-authorised publication; the concept DOI is the existing one.
9. **Owner step.** Push, tag `v4.0.0`, GitHub release (Zenodo archives), then the minted version DOI into `CITATION.cff` identifiers and
   the README.

### 10.2 Carried from `docs/v4-wave2a-report.md` section 9 and still open

- **Pedestal and edge.** The default pedestal is still the fixed one (width 0.06, ETB factor 0.08, ELM size 0.35); the `eped1` model is
  opt-in; the opt-in `edgeModel: 'twoPoint'` T_sep is unvalidated and n_sep stays fuelling-controlled.
- **Transport.** `'scaling'` is circular against the confinement scalings by construction; `'cgm'` is uncalibrated; Newton costs 1.3
  to 1.5 times the Picard (the Jacobian is not reused, to keep chunk invariance); the ITPA20 regression covariance is not in the
  open text; whether `'cgm'` should default to `'pc'` is an owner decision.
- **Current and equilibrium.** Phi_b-dot and V'-dot terms are not applied (the remap is the instant limit); shape keys are not scenario
  controls (needs a moving boundary); free boundary is only started; MASTU15 keeps a slightly negative outermost cell of the t = 0
  current (-5e-5 I_p); no real EFIT g-file was available offline, so the G-EQDSK reader is tested on the solver's own files; `OUTER_ACCEPT`
  and `OUTER_LIMIT` are measurements; `temperatureMap` assumes a boundary symmetric about Z = 0.
- **Fast ions and current drive.** No fast-ion transport or loss model, no beam-beam channel; one preset-wide beam tangency radius; no
  partial Kadomtsev reconnection (q0 = 1.00 after a crash); the ECCD figure of merit at low-field-side absorption is low; the
  physics-based NBCD and ECCD are opt-in only.
- **Impurities and edge.** The Lengyel c_z for detachment is an upper bound (coronal Mavrin curves from 100 eV, ADAS data not in the
  repository); the Ne test uses a synthetic cooling curve; ITER15 q_peak is the unseeded attached value (a detached seeded divertor is
  a preset decision).
- **Presets and systems.** SPARC TF stress 1299 MPa against 800 keeps its warning (a bucked or wedged support model or a per-design
  allowable is not done); JET has no `systems.cs` block (iron-core transformer); TF nuclear heating is applied as a continuous
  flat-top cryoplant load (a duty-cycle or burn-window criterion is an owner decision); stellarators use the tokamak inboard-leg model
  for modular coils; engineering keys follow the flat-top means; `coilThickness_m` is not a design variable; the DEMO LCFS shape
  conversion, the DEMO density basis and the low-density L-H exponent 2 are assumptions; the library entry (`src/analysis` barrel,
  `solveEdge`, the G-EQDSK reader) is an owner API decision.
- **UI.** The 1.06 box margin duplicates `GSGridOptions.margin`; the 1.5D `geometryInfo()` should report `kappaB`/`deltaB` like the 0D
  one (one line, not done); the 3D coils are schematic; Learn progress (localStorage) is not part of shared state; the POPCON T axis
  is a per-job heuristic (W-7X weakest); Turkish strings of the wizard, report keys, scenario editor and education dictionary have no
  native review.
- **Tooling and kernel.** FSAL saves only 0.9 to 3.1 % of the rhs evaluations in ELM H-mode 0D presets (making `elmPartRate` piecewise
  constant moves every ELM preset, an owner decision); `src/cli/provenance.ts` must keep the exact text `new URL('../../',
  import.meta.url)`; `mutation-smoke`, `bench:*` and `missions` are outside `ci:local` (`figures:check` joins it in step 5); the
  Windows access violation 0xC0000005 of a spawned CLI is still unexplained (not seen in either gate run; 1840 extra soak runs in
  Wave 2B did not reproduce it); the CI workflow has never run on GitHub.

### 10.3 New open issues from this phase

1. **ITER15 Q convergence**: -1.74 % between 50 and 100 cells against the Wave-2A target of 1 % (section 8.1); find the cause (event
   phase of 51 crashes and an NTM is a candidate) or re-state the target with a stated uncertainty; do not tune.
2. **Hollow-core Kadomtsev model**: all ITER15 crashes are at q(0) > 1, `kadomtsevReset` declines such a profile, the amplitude is
   independent of the lobe size, MASTU15-saw takes the fallback for 2 of 4 crashes, no golden case exercises the `rho_mix > 0.95`
   clamp with the new function; a different hollow-core reconnection model (pairing around q_min) is separate work; the origin of the
   hollow core is not analysed; the ITER15 period 9.5 -> 7.8 s is a consequence, not a prediction.
3. **ITER15-impurity**: the case records the default shear trigger on a hollow profile; whether the remapped q is closer to a real ITER
   flat top is untested; the systematic -0.19 % remainder is not decomposed; the NTM seeding margin is 5.05 % of the thermal beta_N.
4. **Real-event coverage limits**: two shots, fixed seeds; the Z and Ne flush path in a real ELM shot is covered only by a synthetic
   test (the shot flushes only helium); the sawtooth shot's second crash is feeble and its `before` and `first` rewinds are adjacent;
   the ELM shot is tied to t_end 1.0 s; `tgSeen` is an equivalent mutant on the production path; most sabotages are caught by the
   round-trip assertion and not by the replay digest alone.
5. **Mutation and kernel**: M21 is killed only by timeout (an assertion-based kill is wanted); `mutation-smoke` has no mutants for the
   slicing code (the `applyControl` settle, the `rewindTo` drop, the host control settle); the step grid depends on t_end
   (`dtMax = min(0.05, t_end/400)`), so every near-threshold assertion is schedule-fragile and must keep one t_end.
6. **Pause latency**: re-measure on an idle machine at 1x, 30x and 100x with more than 30 requests per row before quoting a number;
   remaining unsliced stretches are one implicit attempt (up to about 18 ms) and the tail after the last Picard iteration plus the
   adoption (8 to 13 ms).
7. **Golden and ledger residues**: 'Flux required (V s)' is published for eight designs without a solenoid while the ws6c entry lists
   it as removed (owner decision); the 9 to 12 circuit keys that differ from the ws6c lane fixture follow the ws2d plasma (hypothesis);
   the six opt-in plasma moves are not predicted; the first ledger entry keeps wording that the 05:50 UTC entry supersedes.
8. **WS6 limits that stay visible**: the EPED reduced closure (+21 % / +15 %; the pedestal width is 14.5 % below 0.04 with a 0.45-point
   margin to its guard; the EPED trigger ignores fast-ion pressure while the fixed trigger counts it); the Loarte fit is an empirical
   ordering; the adaptive-barrier floor 1/16 is numerical; emergent H98 (section 8.1) is pedestal-limited in the lane's sensitivity
   (`etbFactor` 0.08 / 0.04 / 0.02 / 0.01 gives H98 0.70 / 0.83 / 0.89 / 0.95 and T_ped 1.53 / 2.42 / 3.68 / 3.56 keV on ITER15 bgb: a
   sensitivity, not a setting); IFS-PPPL is a circular L-mode fit (Newton falls back in 48 % of the solves on a marginal L-mode
   profile; MAST-U 1.5D at 2.5 s takes 165 to 650 s); start-up T_i overshoot (ITER15 raw peak 45 keV against 22 keV at the flat top)
   and MAST-U's L-H on the Joule power at 0.051 s remain preset decisions; Redl is checked against analytic limits and figure values,
   not NEO; the impurity module advances once per accepted step outside the TR-BDF2 error estimate and its default `'average'`
   controller masks screening and accumulation.
9. **Presets**: the SPARC and CS citations were not all re-verified (section 8.1); the density mission and the ITER-DHe3 and ITER-pB11
   golden cases sit on knife edges and move with any density change; near-threshold DIII-D at 1 MW is bistable in time.
10. **UI and scenario**: the `ImportPanel` file input is not keyboard reachable (the scenario editor's button-plus-hidden-input pattern
    is the fix); the embedded run view's TransportBar `onSetup` and `onReport` are no-ops; the scenario schema cannot state the
    model-dependent rules (`x-rules`); `optimize --scenario` checks the optimum with the preset's own heating, not an operating point;
    protocol v3 is backward compatible in one direction only; the Advanced section does not offer stellarator edge options.
11. **Strict typecheck**: 37 errors in 25 files remain (the baseline only goes down).
12. **Roadmap WS6 items not attempted in this phase** (not reported above and not done): the QLKNN-10D MLP, toroidal momentum (NBI torque, Peeters pinch, Rice scaling, ExB quench), the TORAX `iterhybrid` comparison within 10 %, row 6f (EC ray tracing, 1.5D stellarator), and the 6e criterion of a steady `exp(int v/D)` impurity profile to 1e-4 (no such test is reported here; it is open). They are carried as open items for v4.1 or later (no decision has been recorded).
13. **Release metadata**: `CITATION.cff` has no TODO any more (the owner confirmed the author record, no ORCID); the 4.0.0 version
    DOI comes after publication; `release:check --no-allow-unreleased` is a release-preparation gate and fails until the bump.

### 10.4 Owner decisions collected

The library entry (analysis barrel, edge solver, G-EQDSK), `coilThickness_m` as a design variable, the burn-window criterion for short
runs, FSAL and `elmPartRate`, whether `twoPoint` should become the default once validated, whether 'Flux required' stays published
for designs without a solenoid, whether `'cgm'` defaults to `'pc'`, and the reading of the SPARC `pulseLength_s` key (31 s full
discharge, flat top as `t_end`).

### 10.5 In flight, not part of this gate

Three Wave-3 lane branches exist, branched from `a430821` and therefore without `ba56db9` and `a229d7c`: `v4/w3com` (2 commits:
configuration reference generated from the JSON Schemas; community files), `v4/w3ui` (6 commits: pseudo-locale sweep, a11y names and
roles, locale-aware numbers, Turkish catalog for the physics layer's texts, first paint in the saved locale), `v4/w3val` (7 commits so
far: NIF calibrated on N210808 alone and N221204 and N230729 predicted blind, calibration and blind roles in `validate`, benchmarked
wording, W-7X OP1.2). They are merged after this gate, with `ci:local` re-run; the 4 Advanced-section tests they still report failing
are the ones `ba56db9` fixes.

## 11. Addendum after the gate: grid-independent NTM island flattening

The convergence miss of section 1 (ITER15 flat-top Q -1.74 % between 50 and 100 radial cells against the Wave-2A target of
1 %) was investigated after the gate (`scratch/claude-conv-investigation.md`, archived with the Claude handoff). The trigger was
the Kadomtsev mixing-radius fix `37e3c90`, which is correct (the flat-top crash period is now 5.8 +- 0.8 s on every grid from 45 to
140 cells); the cause was older: the NTM island flattening in `profiles/transport/coefficients.ts` added its extra diffusivity only
on faces with |rho - r_s| < w/2, a hard on/off face test present since v3.0.0, so the flattened width depended on the grid (0.78 of
the island at 25 and 50 cells, 1.12 at 35, 0.98 at 100) and ITER15 flat-top Q followed the (3,2) island width with r = -0.998 over
19 grids. The Wave-2A value of -0.20 % was two biases cancelling.

`8b90fb4` weights the extra diffusivity by the share of each face's control interval inside the island
(`profiles/transport/islandCoverage.ts`; the flattened width now equals the island width on any grid to round-off). Measured:

- ITER15 flat-top Q at 25 / 50 / 100 cells: 10.4442 / 10.6912 / 10.5054 before, 10.1629 / 10.4503 / 10.5094 after; the 50 -> 100
  change is +0.566 % (target 1 % met). The 25/50/100 triple is now monotone (Richardson order 2.28, GCI 0.18 %); that is a
  property of this triple only. Over ten grids of 45 cells and more the standard deviation of Q falls from 0.65 % to 0.31 %.
- Not met: T_ped changes -1.098 % between 50 and 100 cells (oscillatory with the grid; before, -0.02 % was a chance value of the
  same scatter). Below 50 cells the fix exposes a regime about 3 % lower in Q (25 cells has 5 cells across the pedestal); the
  default grid is 50 cells.
- The weighting conserves the integral of the extra diffusivity across the island, not the island's thermal resistance; whether
  that is the better approximation is a hypothesis.
- Golden (`595216c`): only ITER15 and ITER15-impurity move (the two cases with an NTM island; 37 are byte-identical). ITER15 Q
  10.691193708423413 -> 10.450311385999676 (-2.25 %), P_fus 537.655 -> 525.615 MW, l_i -1.18 %, T_ped +1.59 %, sawtooth crashes
  51 -> 62; ITER15-impurity Q 11.277040403297628 -> 11.298194586188112 (+0.19 %).
- `npm run validate`: 36 pass, 6 known, 0 unexpected, no check changes status (DEMO15 full-shot P_fus -0.93 %).
- Independent review: weighting exact to 3.3e-14 over 56 grids, every cited number matches the committed JSON, 279 files / 3670
  tests pass, strict at its baseline.

The ITER15 numbers in sections 5 to 7 and the 947f38b -> a229d7c table are measured before this fix; the current values are in
`test/golden/ITER15.json` and the 2026-10-01 ledger entry of `test/golden/CHANGES.md`.
