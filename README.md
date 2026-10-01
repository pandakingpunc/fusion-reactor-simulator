# Fusion Reactor Simulator

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22259861.svg)](https://doi.org/10.5281/zenodo.22259861)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

English | [Türkçe](README.tr.md)

> A time-resolved simulator of fusion reactors for research and education: a zero-dimensional (0D) power balance
> for <!--n:methods-->12 confinement methods, and a 1.5D radial transport model coupled to a Grad–Shafranov equilibrium for
> tokamaks and spherical tokamaks. Tokamak, spherical tokamak, stellarator, laser ICF, MTF/MagLIF/Z-pinch, FRC,
> magnetic mirror and muon-catalysed fusion, with <!--n:presets-->22 built-in presets (ITER, JET, SPARC, DEMO, W7-X, NIF, ...).
> Deterministic and reproducible, and open about where its numbers disagree with the published ones.

It runs in the browser (no runtime dependency beyond React), as a Node.js library, as a command line (`fusion-sim`,
with NetCDF, IMAS-like JSON and CSV output) and from Python.

<p align="center">
  <img src="docs/figures/fig01_equilibrium.svg" alt="Grad–Shafranov equilibrium of the ITER 1.5D discharge" width="92%">
</p>

## What it is, and what it is not

- **A reduced model.** The 0D model is a volume-averaged power and particle balance. The 1.5D model evolves T_e, T_i,
  n_e and the poloidal flux on ρ̂ = √(Φ/Φ_b) and is coupled, quasi-statically, to a fixed-boundary Grad–Shafranov
  equilibrium. Transport, the pedestal, ELMs, sawteeth and NTMs are closures with a few constants, several of them
  empirical; simplifications are marked `APPROXIMATION` in the code.
- **Not a design code.** It is a tool for research, teaching, pre-conceptual design and scenario exploration. It is
  not a free-boundary, turbulence or nonlinear MHD code, it has no coil set, and it must not be used as the primary
  source for machine design. Its limits are listed under [Known limits](#known-limits-and-unmet-targets).
- **Honest about its agreement with the references.** A model value within 20 % of a published one is called
  *validated*; beyond 20 % it is called *benchmarked*, with the deviation. Some checks fail and are documented as known
  failures, and the one tuned constant of the ICF model is fitted to one shot, so that shot is not a test.
  See [Validation summary](#validation-summary).

<!-- table: glance -->

| Built into the repository | Count |
|---|---|
| Confinement methods (`method`) | 12 |
| Presets | 22 |
| Golden regression cases (`test/golden`) | 40 |
| Literature checks of `npm run validate` | 46 |
| Paper figures (`docs/figures`) | 9 |
| Learn missions | 10 |

## What is new in v4

**Deterministic kernel and exact rewind.** Any sequence of `advance()` calls gives bitwise the same frames, events and
report as `runAll()`; `rewindTo()` restores the exact model state in 0D and 1.5D, so a rewound run replays bit for bit;
every live control change is logged and replays bitwise; `runFingerprint()` (SHA-256 of a canonical serialisation) names a
run by its inputs. All random numbers are seeded.

**1.5D solver.** Implicit finite volumes on an edge-packed radial grid, advanced by TR-BDF2 (second order, L-stable) with
error control. The events (L–H transition, ELM, sawtooth crash, NTM onset) are localised in time with a root finder
instead of being stepped over. Each stage is solved by Anderson-accelerated Picard iteration or Newton–Raphson with a
block-tridiagonal Jacobian; the current diffusion has the Hinton–Hazeltine form with I_p as the boundary condition. The
convergence of the solver is measured, and one number of it misses its target: see [Verification](#verification-and-convergence).

**Self-consistent Grad–Shafranov coupling.** The table mode of the equilibrium solver scales only FF′ to meet I_p, so the
reported pressure, β_p and stored energy stay in force balance; the surface table is clustered towards the edge; when a new
equilibrium is adopted the state is remapped conservatively (particle number, energy and enclosed current are kept), with
flux ledgers for the loop voltage, the resistive and inductive flux and the central-solenoid budget.

**Corrections of the 0D model.** Separate alpha and beam fast-ion pools (no spurious ignition with NBI on), the loss power
P_L = P_heat − P_rad,core − dW/dt, scalings and Greenwald limit at the line-averaged density, D-D and D-³He side channels,
exact D-T energies, Miller volume and surface, and a density feed-forward controller.

**Opt-in physics modules of the 1.5D model (WS6).** Each is behind a switch of `profiles.*` and is off by default, so a
configuration that does not name it behaves as before. They need `fidelity` `"1.5D"`.

<!-- table: modules -->

| Module | Switch | Default | Opt-in values |
|---|---|---|---|
| Predictive transport | `profiles.transportModel` | `"scaling"` | `"cgm"`, `"bgb"`, `"ifspppl"` |
| EPED1-type pedestal | `profiles.pedestalModel` | `"fixed"` | `"eped1"` |
| ELM energy loss (Loarte) | `profiles.elmLoss` | `"fixed"` | `"loarte"` |
| Impurity and helium-ash transport | `profiles.impurityTransport` | `"legacy"` | `"anomalous"`, `"facit"` |
| Fast-ion energy profiles | `profiles.fastIonModel` | `"scalar"` | `"profile"` |
| NBCD and ECCD current drive | `profiles.cdModel` | `"legacy"` | `"physics"` |
| Porcelli sawtooth trigger | `profiles.sawtoothTrigger` | `"shear"` | `"porcelli"` |
| Kadomtsev reconnection | `profiles.sawtoothReconnection` | `"legacy"` | `"kadomtsev"` |
| Redl bootstrap coefficients | `profiles.neoclassicalModel` | `"sauter"` | `"redl"` |
| Two-point edge model for T_sep | `profiles.edgeModel` | `"legacy"` | `"twoPoint"` |

The modules are reduced closures implemented as published and tested against their own limits. They are guarded by unit and
integration tests and, for most of them, by golden cases; they are not validated as predictive models, and several of their unmet
targets are stated under [Known limits](#known-limits-and-unmet-targets). Every field is described in the [configuration reference](docs/config-reference.md).

**Edge, systems engineering, uncertainty and optimisation.** A two-point divertor model (Stangeby loss factors, Eich λ_q with
divertor spreading, Lengyel seed-impurity radiation, a detachment qualifier) shared by the 0D model, the 1.5D boundary and POPCON;
a systems-lite package (TF coil winding pack and stress, central-solenoid flux budget, cryoplant, radial build, tritium breeding,
PROCESS 1990 cost accounts); seeded uncertainty quantification (Sobol' / Latin hypercube / Monte Carlo ensembles, P(Q ≥ 10),
P(disruption), Sobol' indices with bootstrap intervals); and design optimisation on the steady-state power balance (augmented
Lagrangian with Nelder–Mead or CMA-ES, NSGA-II Pareto fronts). The engineering and optimisation results carry an "educational"
caveat: the models behind them are heuristic.

**Headless library, command line, data formats, Python.** `src/physics/index.ts` is the public API (a barrel with `@public`
and `@experimental` tags); every configuration is validated at run time with path-specific errors and has a JSON Schema;
`fusion-sim` runs, scans, lists presets, checks configurations and writes G-EQDSK (COCOS 11); runs export as JSON, CSV, NDJSON,
NetCDF-3 (CF attributes) and IMAS-like JSON, each with a provenance block, byte-identical for the same configuration;
`python/fusion_sim` wraps the command line.

**Web application.** A scenario editor (programmed waveforms and triggers per control, templates, recording of a live run);
share links, embed views and hash routes; runs saved in the browser and run files that re-simulate on import and show a
verified-reproduction badge; a POPCON map computed off the main thread, with the run trajectory, click-to-steer and
divertor-edge maps; a 3D view (raw WebGL2, loaded on demand) with ELM and disruption effects; a Learn tab with <!--n:missions-->10 missions,
a glossary and a power-flow diagram; Compare with radar, overlay and configuration diff; the interface in English and Turkish
with locale-aware numbers, tested for hard-coded text and for accessibility (see
[interface language and accessibility](docs/interface-language-and-accessibility.md), which also states what the tests cannot check).

**Validation v2 and the publication engine.** A table of literature references with DOIs and accepted ranges, check roles
(calibration, blind) and the validated / benchmarked wording; PDF figures with embedded STIX Two fonts and a provenance
manifest, reproduced bit for bit by `npm run figures:check`.

## Quick start

Requirements: Node.js 20 or newer (`.nvmrc` pins the major the golden files were recorded with).

### Web application

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # type check and production build (static files, base './')
```

### Command line

```bash
npx tsx src/cli/fusion-sim.ts presets
npx tsx src/cli/fusion-sim.ts run --preset JET --series Q,P_fus,Ti --format csv > jet.csv
npx tsx src/cli/fusion-sim.ts run --preset SPARC --set fuel=DD --format text
npx tsx src/cli/fusion-sim.ts run --preset ITER15 --format netcdf --out iter15.nc
npx tsx src/cli/fusion-sim.ts scan --preset ITER --param heating.P_NBI_MW=10:50:10 --param H98=0.9,1.0,1.1 --metric flatTop.Q --out scan.csv
npx tsx src/cli/fusion-sim.ts export-eqdsk --preset ITER15 --out iter15.geqdsk
npx tsx src/cli/fusion-sim.ts schema --check my.reactor.json
npm run -s uq -- --preset ITER --n 128 --json uq-iter.json
npm run -s optimize -- --preset ITER --objective major-radius --json opt.json
```

After `npm run build:lib` the same program is `node build/lib/fusion-sim.js <command>`. Every command accepts `--help`, rejects
unknown or malformed flags with exit code 2 and takes `--threads N` where it runs in parallel. The commands are described in
[`src/cli/fusionSim/README.md`](src/cli/fusionSim/README.md); the formats in [`src/io/README.md`](src/io/README.md).

### Library

The package is not published to npm (`package.json` is `private`); build it and import the bundle, or run from source with `tsx`.

```ts
import { presets, validateConfig, runShot } from './build/lib/index.js';   // npm run build:lib

const cfg = { ...presets.find((p) => p.id === 'JET')!.cfg, t_end: 2 };
const check = validateConfig(cfg);                    // { ok: true, config } or { ok: false, issues }
const { report, flatTop, events, sim } = runShot(cfg);
console.log(report.E_fusion_MJ, flatTop.Q, sim.fingerprint('4.0.0'));
```

### Python

```python
import fusion_sim as fs

doc = fs.run("ITER", set={"heating.P_NBI_MW": 20}, t_end=100)   # dict: report, flatTop, burn, events, config, provenance
doc["report"]["Q_sci_max"], doc["flatTop"]["Q"]
fs.scan({"heating.P_NBI_MW": "10:50:10"}, preset="ITER", metrics=["flatTop.Q"])["points"]
```

The wrapper is a standard-library subprocess front end of the command line ([`python/README.md`](python/README.md)).

### Checks

```bash
npm test               # unit, component, CLI and fast golden tests (vitest)
npm run validate       # all presets against the literature table; a few minutes
npm run golden         # golden regression: every case at 1e-9
npm run figures:check  # docs/figures match figures.manifest.json and regenerate identically
npm run ci:local       # type checks, schema checks, tests, validate, golden, figures check, build, bundle budget; stops at the first failure
```

`npm run validate -- --json` writes the machine-readable result (schema 3); capture it with `npm run -s validate -- --json > results.json`
(plain `npm run` prints its banner to stdout). `npm run validate -- --markdown` prints the table of checks.

## Validation summary

`npm run validate` runs every preset and compares <!--n:checks-->46 model outputs with published values. A check has a published value with
its uncertainty, a source with DOI, an accepted range and a kind: *validation* (a measured value of the device), *benchmark*
(a published design or modelling value) or *sanity* (a physical bound). The accepted range is derived from the literature and a
stated reduced-model tolerance, never fitted to the model. Each result also carries a wording that compares the model value with
the published one: *validated* within 20 %, *benchmarked (deviation X %)* beyond 20 % (a model far from the published value is
compared with it, not validated against it), *calibrated* for the one shot a model constant is fitted to (its pass is by
construction) and *sanity bound* for a check of kind sanity (a bound is not a measurement). A check with the role *blind* is a
prediction made after that calibration with the constant not re-fitted.

<!-- table: validation-counts -->

| Result of `npm run validate` | Checks |
|---|---|
| Checks executed | 46 |
| Inside the accepted range | 38 |
| Documented known failures | 8 |
| Unexpected failures | 0 |
| Wording *validated* (within 20 %) | 16 |
| Wording *benchmarked* (beyond 20 %) | 16 |
| Wording *calibrated* | 1 |
| Wording *sanity bound* | 13 |
| Kind *validation* | 15 |
| Kind *benchmark* | 18 |
| Kind *sanity* | 13 |

Passing the range check is not the same as agreeing with the reference: the accepted ranges are wide, and only <!--n:validated-->16 of the <!--n:checks-->46 results
carry the wording *validated*. The headline quantities, against the published values (flat-top means; ratio = model / published):

<!-- table: headline -->

| Quantity | Published | 0D | 0D / pub. | 1.5D | 1.5D / pub. | Wording |
|---|---|---|---|---|---|---|
| ITER Q | 10 | 10.08 | 1.01 | 10.45 | 1.05 | validated / validated |
| ITER P_fus (MW) | 500 | 516.6 | 1.03 | 525.6 | 1.05 | validated / validated |
| ITER n_e,line / n_G | 0.85 | 0.848 | 1.00 | 0.800 | 0.94 | validated / validated |
| ITER q95 | 3.0 | 3.00 | 1.00 | 3.50 | 1.17 | validated / validated |
| ITER f_bs | 0.2 ± 0.05 | — | — | 0.231 | 1.15 | validated |
| ITER ℓ_i(3) | 0.85 ± 0.15 | — | — | 0.719 | 0.85 | validated |
| ITER T_e,ped (keV) | 4.5 ± 0.5 | — | — | 3.55 | 0.79 | benchmarked |
| JET E_fus (MJ) | 59 ± 6 | 66.6 | 1.13 | 81.8 | 1.39 | validated / benchmarked |
| SPARC Q | 11 | 7.84 | 0.71 | 6.29 | 0.57 | benchmarked / benchmarked |
| SPARC P_fus (MW) | 140 | 205.0 | 1.46 | 161.5 | 1.15 | benchmarked / validated |
| DEMO P_fus (MW) | 2000 | 1903 | 0.95 | 2007 | 1.00 | validated / validated |
| NIF N221204 G (blind) | 1.5 ± 0.1 | 0.668 | 0.45 | — | — | benchmarked |
| NIF N230729 G (blind) | 1.89 | 0.668 | 0.35 | — | — | benchmarked |
| NIF N210808 G (calibration) | 0.72 | 0.715 | 0.99 | — | — | calibrated |

The ICF rows are 0D models. The DEMO row is the full 2000 s preset, the run `npm run validate` makes (the golden DEMO cases are
shortened). The SPARC P_fus reference is the design value of Creely et al. 2020 and has no check in `npm run validate`. The
before-and-after of these numbers against the previous release, with the cause of each move, is in
[docs/v4-numbers-diff.md](docs/v4-numbers-diff.md).

<p align="center">
  <img src="docs/figures/fig05_validation.svg" alt="Ratio of simulated to published values for the 0D and 1.5D models" width="80%">
</p>

The <!--n:known-->8 documented known failures (the model falls outside the accepted range; each is explained in
[`references.ts`](src/physics/validation/references.ts), and none was closed by moving a range):

<!-- table: known-failures -->

| Check | Model | Published | Accepted | Model / published | Cause |
|---|---|---|---|---|---|
| `JET15.Efus` | 81.8 MJ | 59 ± 6 MJ | 40–80 | 1.39 | beam–target fusion of the 3-component NBI deposition in 1.5D; no beam–beam fusion or fast-ion loss model |
| `NIF210808.Ti` | 1.32 keV | 9.55 keV | 6.3–13.2 | 0.14 | the model sits below its own ignition threshold on the calibration shot: the yield is matched, the hot spot is 7 times too cold |
| `NIF.G` (blind) | 0.668 | 1.5 ± 0.1 | 1–3 | 0.45 | N221204: no model input separates it from N210808, so the calibration yield is predicted again |
| `NIF.G_N230729` (blind) | 0.668 | 1.89 | 1–3.78 | 0.35 | N230729: the same prediction as for N221204 |
| `Z.yield` | 2.0e14 | 1.1e13 | 3.66e12–3.3e13 | 18.18 | ideal MagLIF compression without liner–fuel mix, end or preheat losses |
| `TAE.Ttot` | 1.21 keV | 3 keV | 1.5–6 | 0.40 | single-temperature FRC; the hot beam-driven ions are not modelled |
| `MIRROR.Te` | 9.53 keV | 0.66 ± 0.05 keV | 0.33–1.8 | 14.44 | single-temperature mirror; electrons cooled by axial loss are not modelled |
| `MUON.Yf` | 106 | 150 ± 20.4 | 109–191 | 0.71 | the preset's sticking and cycling rate give 106 fusions per muon |

Until v4 the ICF constant was tuned to N221204 itself, which made that shot look like a validation. It is now calibrated on
N210808 alone, and N221204 and N230729 are blind predictions that miss. The direct-drive preset (`DIRECT.G`) passes its range
and is benchmarked at a deviation of -47 %; its capsule was never calibrated.

## Verification and convergence

Code verification against exact solutions (the figure [fig07_verification](docs/figures/fig07_verification.svg)):

<!-- table: orders -->

| Test | Observed order | Expected order |
|---|---|---|
| Grad–Shafranov solver against the exact Solov'ev solution | 2.05 | 2 |
| Finite-volume heat solver, steady diffusion with a uniform source | 1.94 | 2 |
| Backward-Euler decay of a Bessel eigenmode (self-convergence) | 0.99 | 1 |

The order of TR-BDF2 itself is checked on scalar problems in the unit tests. The convergence of the 1.5D discharge is measured by
`npm run bench:convergence` on ITER15 (400 s, flat-top means; <!--n:nrho-->50 cells, `rtol` <!--n:rtol-->1e-2 and `dtMax` <!--n:dtmax-->0.5 s are the defaults). The change
is the finest run against the middle one:

<!-- table: convergence -->

| Study | Metric | Coarse | Middle | Fine | Change | Target | Status |
|---|---|---|---|---|---|---|---|
| Radial cells 25 / 50 / 100 | Q | 10.16 | 10.45 | 10.51 | +0.57 % | < 1 % | met |
| Radial cells 25 / 50 / 100 | f_bs | 0.2303 | 0.2306 | 0.2311 | +0.20 % | < 1 % | met |
| Radial cells 25 / 50 / 100 | ℓ_i(3) | 0.7138 | 0.7195 | 0.7213 | +0.25 % | < 1 % | met |
| Radial cells 25 / 50 / 100 | T_ped (keV) | 3.506 | 3.549 | 3.510 | -1.10 % | < 1 % | **not met** |
| Tolerance `rtol` 1e-2 / 1e-3 / 1e-4 | Q | 10.45 | 10.48 | 10.49 | +0.10 % | < 1 % | met |
| Tolerance `rtol` 1e-2 / 1e-3 / 1e-4 | f_bs | 0.2306 | 0.2312 | 0.2313 | +0.02 % | < 1 % | met |
| Tolerance `rtol` 1e-2 / 1e-3 / 1e-4 | ℓ_i(3) | 0.7195 | 0.7195 | 0.7197 | +0.03 % | < 1 % | met |
| Tolerance `rtol` 1e-2 / 1e-3 / 1e-4 | T_ped (keV) | 3.549 | 3.535 | 3.538 | +0.09 % | < 1 % | met |
| Step limit `dtMax` 0.5 / 0.05 / 0.01 s | ELM count | 1317 | 1319 | 1325 | +0.45 % | < 2 % | met |

T_ped misses its target: it is oscillatory with the grid (<!--n:tped_change-->-1.10 % between 50 and 100 cells; 25 cells put only <!--n:cells25-->5 cells across the
pedestal and read <!--n:q25_lower-->2.75 % lower in Q), so the pedestal temperature is not converged to 1 %; the default grid has <!--n:cells50-->10 cells across the
pedestal. Radial cells and tolerance are discretisation parameters of the solver, not physics inputs. The q(0) and the number of
sawtooth crashes are not part of the table and are the least converged numbers of the 1.5D model: never quote them as converged physics.

A 400 s ITER 1.5D shot takes tens of seconds and the 2000 s DEMO 1.5D shot a few minutes (median wall times of `npm run bench:perf`
on an idle 6-core desktop, `bench/perf-baseline.json`, recorded when the 1.5D solver was merged; later physics fixes changed the step
counts, so a shared machine reads higher):

<!-- table: runtime -->

| Preset | Median wall time (s) |
|---|---|
| ITER (0D, 400 s) | 2.0 |
| ITER15 (1.5D, 400 s) | 23.8 |
| DEMO15 (1.5D, 2000 s) | 139.5 |

## Known limits and unmet targets

These are stated plainly because a green software gate (`npm run ci:local`: the code does what the tests say and the golden
files did not change) does not show that any closure predicts a real plasma. The numbers are those of
[docs/v4-wave2b-report.md](docs/v4-wave2b-report.md) (section 8.1; the grid convergence of T_ped is in section 11).

<!-- table: limits -->

| Target | Measured | Status |
|---|---|---|
| EPED1 pedestal within 15 % of the published EPED prediction (ITER15, at the ELM onset) | pressure +21.1 %, T_ped +15.4 % | **not met** (the acceptance test enforces the 25 % that a reduced closure can honestly claim); grid convergence between 50 and 100 cells met |
| Emergent H98(y,2) of the Bohm/gyro-Bohm closure in 0.8–1.2 | ITER15 0.701, JET15 1.024, SPARC15 0.644 | met on JET15 only |
| Emergent H98(y,2) of the IFS-PPPL closure in 0.8–1.2 | ITER15 0.287, JET15 0.442, SPARC15 0.304 | **not met** (ITER15 stays in L-mode with this closure); no coefficient was tuned |
| JET DTE2 #99971 thermal / beam-target split within 15 % of the published trend | thermal fraction 36.7 % against a trend of about 50 % | **open**: the paper gives no split for #99971, only a trend for the baseline scheme; beam–beam fusion and fast-ion losses are not modelled |

Further limits:

- **ITER15 sawtooth crashes rest on a hollow-core Kadomtsev convention.** In the gate measurement every ITER15 crash occurred with q(0)
  above 1 (measured before the NTM-flattening fix, not repeated since), while the crash model was written for a q = 1 surface that starts at
  the axis; the mixing radius of a hollow core follows a convention, defined by the helical flux, that is not validated, and neither are the
  crash rate and the trigger thresholds. The NTM that the crashes seed inherits this.
- **The density controller is not a safety claim near the Greenwald limit.** The systematic overshoot of a density ramp is small, but a stochastic,
  non-monotone band within about 2 % of n_G remains in which a shot may or may not disrupt, and the outcome depends on the seed and on `t_end`.
  No unconditional statement "safe below n_G" is made.
- **The ICF model has one tuned constant** and no input that separates the three NIF shots; the predictions of N221204 and N230729 miss
  (table above), and the hot spot of the calibration shot is too cold.
- **FACIT and the pedestal and ELM closures are reduced forms** compared with their sources term by term or with a published fit, not benchmarked
  against NEO, Aurora or EPED output beyond what is stated above.
- **Sentences written by the physics layer stay English** in the Turkish interface (events, warnings, termination reasons, report notes).
- **The 1.5D model is about <!--n:slower-->5 times slower** than it was before the TR-BDF2 solver with error control and event localisation: the price of
  the convergence above ([docs/v4-numbers-diff.md](docs/v4-numbers-diff.md), section 6).

## Headline physics models

<!-- table: models -->

| Area | Model | Reference |
|---|---|---|
| Reactivity ⟨σv⟩ | Bosch–Hale (D-T, D-D, D-³He), numerical Maxwellian average for p-¹¹B | Bosch & Hale, *NF* **32** (1992) 611; Nevins & Swain (2000) |
| Confinement | IPB98(y,2), ITPA20 and ITPA20-IL, ITER89-P, ISS04, ST; L–H threshold (Martin 2008, Ryter 2014 low-density branch) | ITER Physics Basis (1999); Verdoolaege (2021) |
| 1.5D transport | τ_E-scaled χ (PI controller) with critical-gradient stiffness, ETB and neoclassical floor; critical-gradient, Bohm/gyro-Bohm and IFS-PPPL closures | METIS (Artaud 2018); Erba (1997); Kotschenreuther (1995) |
| Equilibrium | Fixed-boundary Grad–Shafranov (Miller boundary, Shortley–Weller stencils); Cerfon–Freidberg Solov'ev for verification | Cerfon & Freidberg (2010) |
| Bootstrap and conductivity | Sauter–Angioni–Lin-Liu; Redl et al. as an option | *Phys. Plasmas* **6** (1999) 2834; Redl (2021) |
| MHD events | Kadomtsev and Porcelli sawteeth, α_crit and EPED1-type ELMs, modified Rutherford NTM | Kadomtsev (1975); Porcelli (1996); La Haye (2006) |
| Radiation | Bremsstrahlung (relativistic), Albajar synchrotron, Mavrin line radiation | Albajar (2001); Mavrin (2018) |
| Edge | Two-point divertor model, Eich λ_q, Lengyel radiation, detachment qualifier | Stangeby (2018); Eich (2013); Kallenbach (2018) |
| Limits and disruptions | Greenwald, Troyon β_N, q95; thermal and current quench, halo currents, runaway electrons | Greenwald (1988); Hender (2007) |
| Time integration | 0D: Dormand–Prince RK5(4); 1.5D: TR-BDF2 with error control and event localisation | Hairer–Nørsett–Wanner |

Constants are CODATA 2018 and all internal calculations use SI units. The full list of closures, with the equations and the
numerical methods, is in the [technical report](docs/technical-report.md).

## Figures

The <!--n:figures-->9 paper figures are generated by `npm run figures` (SVG for the web, PDF 1.4 with embedded STIX Two subsets for journals) with
captions in [`docs/figures/captions.md`](docs/figures/captions.md) and the provenance of every file (version, commit, configuration hash,
seeds, SHA-256) in [`figures.manifest.json`](docs/figures/figures.manifest.json). `npm run figures:check` regenerates them and compares the hashes.

<p align="center">
  <img src="docs/figures/fig03_timetraces.svg" alt="Time traces of the ITER 1.5D discharge" width="92%">
</p>

1. [Equilibrium](docs/figures/fig01_equilibrium.svg) ([PDF](docs/figures/fig01_equilibrium.pdf))
2. [Radial profiles](docs/figures/fig02_profiles.svg) ([PDF](docs/figures/fig02_profiles.pdf))
3. [Time traces](docs/figures/fig03_timetraces.svg) ([PDF](docs/figures/fig03_timetraces.pdf))
4. [POPCON](docs/figures/fig04_popcon.svg) ([PDF](docs/figures/fig04_popcon.pdf))
5. [Validation](docs/figures/fig05_validation.svg) ([PDF](docs/figures/fig05_validation.pdf))
6. [Reactivity and Lawson diagram](docs/figures/fig06_reactivity_lawson.svg) ([PDF](docs/figures/fig06_reactivity_lawson.pdf))
7. [Verification](docs/figures/fig07_verification.svg) ([PDF](docs/figures/fig07_verification.pdf))
8. [MHD events](docs/figures/fig08_mhd.svg) ([PDF](docs/figures/fig08_mhd.pdf))
9. [Operating-space scan](docs/figures/fig09_scan.svg) ([PDF](docs/figures/fig09_scan.pdf))

## Regression testing

Two independent safety nets guard the physics. The **literature validation** (`npm run validate`) checks selected outputs of every
preset against published ranges; it catches order-of-magnitude and consistency errors. The **golden regression** (`npm run golden`)
catches any numerical drift: for <!--n:cases-->40 cases (all presets, plus variants for the other fuels, most opt-in modules and 1.5D DIII-D and MAST-U) it
stores a deterministic snapshot in `test/golden/<case>.json` (every finite scalar of the shot report, flat-top averages, whole-run
statistics of every diagnostic, event counts, key time traces, the geometry and, in 1.5D, every radial profile and a digest of the last
equilibrium) and compares it at a relative tolerance of 1e-9 (1e-6 across Node.js major versions). Long discharges are shortened in the
golden cases (recorded in each file). When a change is meant to move the numbers, re-record them and say why:

```bash
npm run golden:update -- --reason "switch the ELM model to ..."
npm run golden:update -- --reason "..." --only ITER15,DEMO15
```

The reason is appended to the append-only log [`test/golden/CHANGES.md`](test/golden/CHANGES.md) with the moved keys of every case.
The numbers of this README (and of README.tr.md) are held to the golden files, the literature table and the benchmark records by
[`src/docs/readme.test.ts`](src/docs/readme.test.ts), so they cannot go stale silently.

## Project layout

```text
src/physics/          the physics core (browser-safe, no DOM or Node APIs)
  confinement/        0D models (magnetic, icf, mtf, frc, mirror, muon) and the shared shot report
  profiles/           1.5D model: grid, finite-volume solver, TR-BDF2, sources, transport closures, pedestal, impurities, fast ions, events
  equilibrium/        Grad–Shafranov: Miller boundary, solver, flux-surface averages, Solov'ev, free-boundary building blocks
  edge/  systems/     two-point divertor model; TF, central solenoid, cryoplant, radial build, costs
  kernel/             fingerprint, canonical serialisation, SHA-256, errors
  config/             runtime validation, JSON Schema, dotted paths, runShot
  validation/         references.ts (the literature table), metrics, evaluation
  index.ts            the public library API
src/cli/              validate, golden, figures, missions, uq, scan, optimize and fusion-sim; worker pool
src/io/               CSV, NDJSON, NetCDF-3, IMAS-like JSON and G-EQDSK writers and readers
src/analysis/         uncertainty quantification and optimisation
src/regression/       golden snapshots, comparator, numbers-diff test
src/docs/             the test that holds the numbers of the READMEs to their sources
src/plot/             plotting engine (SVG, PDF, fonts) and the paper figures
src/ui/  src/worker/  React interface and the simulation workers
src/i18n/  src/edu/   English and Turkish texts; the Learn missions and the glossary
schema/               JSON Schemas of a configuration and of a scenario (generated)
python/               fusion_sim, a standard-library wrapper of the command line
test/golden/          golden snapshots and their change log
bench/  scripts/      convergence and performance benchmarks; ci:local, build:lib, release:check and the generators
docs/                 config-reference.md, technical-report.md, v4-numbers-diff.md, the wave reports, figures/
```

## Documentation

- [Configuration reference](docs/config-reference.md): every field of a reactor configuration and of a scenario, generated from the JSON Schemas.
- [Technical report](docs/technical-report.md): equations, numerical methods, verification and validation.
- [Numbers before and after](docs/v4-numbers-diff.md): the headline numbers against the previous release, with the cause of each move.
- Gate reports of the v4 development: [wave 1](docs/v4-wave1-report.md), [wave 2A](docs/v4-wave2a-report.md), [wave 2B](docs/v4-wave2b-report.md).
- [Interface language and accessibility](docs/interface-language-and-accessibility.md), [CHANGELOG](CHANGELOG.md), [releasing](docs/RELEASING.md).

## Contributing, security, code of conduct

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) (set-up, the checks, the golden regression and validation policies, translations).
Security problems are reported privately: [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Citation

If you use this software, please cite it with the information in [`CITATION.cff`](CITATION.cff) ("Cite this repository" on GitHub).

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22259861.svg)](https://doi.org/10.5281/zenodo.22259861)

> Karatum, M. *Fusion Reactor Simulator*. Zenodo. [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861)

This is the concept DOI, which covers all versions and always resolves to the latest one. The DOI of each version is listed on Zenodo.

## AI assistance

The software was developed by the author, an independent researcher, with substantial help from AI coding assistants (Claude Code by
Anthropic, Codex by OpenAI and MiMo), under the author's direction and review. The evidence for the numbers is the tests, the golden
regression and the literature table, not the assistants' statements.

## License

[MIT](LICENSE) © 2026 Mustafa Karatum
