# Fusion Reactor Simulator — Technical report (v4.0.0)

**Author:** Mustafa Karatum, Independent researcher
**Release date:** 2026-10-01
**License:** MIT
**Concept DOI:** [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861)
**Version DOI (4.0.0):** [10.5281/zenodo.23100241](https://doi.org/10.5281/zenodo.23100241)
**Version DOI (4.1.0):** [10.5281/zenodo.23121818](https://doi.org/10.5281/zenodo.23121818)
**Türkçe:** [technical-report.md](tr/technical-report.md)

## 1. Scope and model hierarchy

The simulator is a reduced research and education tool for time-dependent scenario exploration. It runs in a browser, a headless TypeScript library, the `fusion-sim` CLI and a Python subprocess wrapper. The magnetic 0D model evolves volume-averaged energy, composition and current with adaptive Dormand–Prince integration. Separate reduced 0D families describe stellarators, inertial fusion, magnetised targets, FRCs, mirrors and muon-catalysed fusion. Only tokamaks and spherical tokamaks support the radial 1.5D model.

In 1.5D, `ProfileModel` evolves electron and ion temperatures, electron density and poloidal flux, plus scalar inventories and optional impurity/fast-ion fields. `Simulation` owns stepping, event history, controls, checkpoints and replay. Source, transport and event modules share a single context and participate in checkpoints. This is not a reactor design code, a free-boundary equilibrium solver or an integrated turbulence/MHD calculation. Design references are benchmarks, not experimental measurements. The code has no external plasma-physics certification.

## 2. Zero-dimensional power balance

The stored thermal energy is `W = (3/2) ∫ (n_e T_e + n_i T_i) dV`; temperatures are converted from keV to joules before energy accounting. Electron/ion exchange cancels in the total balance. Fusion channels use Bosch–Hale reactivities and channel-specific fuel pair densities and reaction energies. Alpha and injected-beam fast-ion energies are distinct reservoirs: injected beam power is never labelled alpha power. D-D, D-T and D-3He products are booked separately, including fuel depletion and helium ash.

```
dW/dt = P_heat − P_rad − P_transport − P_event
P_L = P_heat − P_rad,core − dW/dt
tau_E = W / P_L
Q = P_fusion / P_external
```

Confinement and L–H threshold correlations use line-averaged density, while particle inventory uses volume-averaged density. IPB98(y,2), ITER89-P and stellarator ISS04 are empirical scalings with their own domains. Radiation combines bremsstrahlung, line cooling and synchrotron approximations. NBI slowing down and beam-target fusion are reduced models, and RF deposition does not ray-trace. Heating programmes and an ignition test distinguish externally sustained burning from self-sustained alpha heating.

The density controller has feed-forward and feedback terms, finite actuator response and anti-windup. A seeded stochastic limiter acts near the Greenwald boundary. A density target is an input, not a prediction of particle transport; near-limit outcomes depend on the seed. Fuel fractions and charge neutrality are enforced before source evaluation. The code and derivations of each scaling are linked from the [configuration reference](config-reference.md) and module headers.

## 3. Radial transport, time integration and current diffusion

The radial coordinate is `rho = sqrt(Phi/Phi_b)`, with `dPhi = 2 pi q dpsi`. Flux-surface geometry supplies `V' = dV/drho`, gradient metrics and trapped-particle fraction. The conservative particle equation is

```
∂n_e/∂t = −(1/V') ∂Γ/∂rho + S_n
Γ = V' (−g1 D ∂n_e/∂rho + <|∇rho|> v n_e)
```

Heat conduction uses `V' g1 n_s chi_s ∂T_s/∂rho` at faces; convected enthalpy uses the particle flux. Local sources include electron/ion exchange, ohmic heating, fusion products, attenuated multi-energy NBI, Gaussian RF deposition and local radiation. Symmetry gives zero axis flux. A reduced two-point SOL model supplies separatrix temperature; density has a specified separatrix relation. The edge flux gradient carries the programmed plasma current.

Finite-volume cells are packed toward the pedestal. Face gradients use actual distances, integrals use cell volumes and interpolation uses neighbouring-cell weights. A uniform-grid spacing must not be substituted on the packed path. The default scaling transport adjusts its diffusivity through a PI controller toward `W = tau_scal P_L`; therefore agreement with a confinement scaling is partly imposed. Optional predictive closures remove that normalisation and expose an emergent H98.

Heat and current stages use second-order, L-stable TR-BDF2; the density stage uses backward Euler with Scharfetter–Gummel fluxes. Coupled stages use Anderson-accelerated Picard iteration, or damped Newton with a coloured Jacobian for predictive closures. A scaled embedded error estimate controls accepted steps; numerical failures retry at smaller steps. Forced finite acceptance after the retry ladder is diagnosed, and unresolved failure terminates the shot. Programming exceptions propagate after atomic rollback. ELM and sawtooth crossings are localised within a step, so events are not simply postponed to an output frame.

Current diffusion follows the Hinton–Hazeltine form, including the moving-coordinate term; it is not the obsolete constant-metric approximation. Sauter conductivity and bootstrap coefficients are the default; Redl is optional. Plasma current at the end of each stage supplies the edge condition. Boundary loop voltage, resistive and inductive flux components are recorded separately. See [profiles/README.md](../src/physics/profiles/README.md) for exact discrete equations, solver constants and failure semantics.

## 4. Fixed-boundary equilibrium and conservative coupling

```
Δ*psi = R ∂R(R⁻¹ ∂Rpsi) + ∂²Zpsi = −mu0 R² p'(psi) − F F'(psi)
R_LCFS(theta) = R0 + a cos(theta + asin(delta) sin(theta))
Z_LCFS(theta) = kappa a sin(theta)
```

The Grad–Shafranov solver uses a Miller boundary, finite differences with Shortley–Weller boundary distances, banded LU and relaxed Picard iteration. Shape mode uses parameterised sources; table mode uses pressure and current from transport. The pressure contribution is retained when matching total plasma current through the `FF'` source. Surface tracing provides volume, flux, q, magnetic averages and trapped-particle fraction. The equilibrium is fixed-boundary and quasi-static: external coils and vertical-control dynamics are not solved.

Updates respond to elapsed simulation time and changes in pressure, internal inductance or plasma current. An outer consistency loop reconciles geometry and source profiles. On adoption, species and thermal/fast-ion energy inventories are mapped with cell-volume accounting; the new geometry is adopted only after the complete update succeeds. The flux ledger preserves its meaning across remapping. Failed or cancelled suspended work restores state, coupling caches, module state and RNG. [Figure 1](figures/fig01_equilibrium.svg) shows equilibrium from its own figure run; its global values need not equal the golden flat-top averages. [Figure 2](figures/fig02_profiles.svg) shows radial profiles. G-EQDSK exports carry the fixed-boundary solution.

## 5. MHD events and their validity

Sawtooth mixing uses the helical-flux integral `psi*(rho) ∝ ∫ (1/q − 1) 2 rho drho`. The mixing radius is its first return to the axis reference beyond the outermost q<1 interval, provided the integral there is positive. The no-radius sentinel is bounded and independent of grid size. Temperature and density flattening conserve the relevant energy and particles.

Kadomtsev reconnection presumes a core with q0<1 and one q=1 surface. For a hollow core, the integral-based radius is a model convention, not a physical reconnection solution. The helical-flux reset declines such profiles; a Porcelli-triggered crash may fall back to the legacy q rebuild. Every baseline ITER15 crash occurs on a hollow core, and part of MASTU15-saw also uses fallback. These timings are not validated. A barely positive helical-flux lobe can still produce a full model crash.

ELMs use a reduced pedestal-gradient trigger. The optional Loarte closure estimates loss from pre-crash composition; trial evaluation is pure and accepted losses are measured from actual inventories. NTMs follow a modified Rutherford equation and flatten transport across islands. Face-control-interval overlap weights make the flattened physical width independent of radial resolution. ECCD suppression is reduced, not nonlinear resistive MHD. [Figure 8](figures/fig08_mhd.svg) illustrates events; the plotted mixing region must be read with the convention above and the [figure captions](figures/captions.md).

## 6. Optional physics modules

<!-- table: modules -->
| Switch | Default / opt-in | Example golden |
| --- | --- | --- |
| `transportModel` | `scaling` / `cgm`, `bgb`, `ifspppl` | ITER15-bgb, JET15-ifspppl |
| `neoclassicalModel` | `sauter` / `redl` | SPARC15-redl |
| `pedestalModel`, `elmLoss` | `fixed` / `eped1`, `loarte` | ITER15-EPED |
| `impurityTransport` | `legacy` / `anomalous`, `facit` | ITER15-impurity, ITER15-impurity-neo |
| `fastIonModel`, `cdModel` | `scalar`, `legacy` / `profile`, `physics` | JET15-fast, DIIID15-eccd |
| `sawtoothTrigger`, `sawtoothReconnection` | `shear`, `legacy` / `porcelli`, `kadomtsev` | MASTU15-saw |

These switches are opt-in. Golden cases and integration tests demonstrate activation and bookkeeping for representative combinations, not predictive validity for every combination. EPED1-type onset and temperature miss the stated target. Bohm/gyro-Bohm and IFS-PPPL closures produce emergent H98 outside the intended band in most tested cases. FACIT is a reduced implementation with analytic/internal checks; no external coefficient benchmark establishes its accuracy. Profile fast-ion moments, orbit smoothing, NBCD/ECCD and Porcelli triggers have targeted consistency tests, while the JET thermal/beam-target split stays unresolved. Reference derivations and validity gaps appear in the corresponding [module README](../src/physics/profiles/README.md).

## 7. Edge, systems, uncertainty and optimisation

The edge module estimates SOL power, Eich heat-flux width, two-point temperatures and divertor loading. ELM energy is included in the power accounting. Detachment, radiation partition and geometry are reduced closures. Systems-lite reports coil stress, neutron loading, energy conversion and pulse/central-solenoid quantities from supplied engineering inputs. Plasma flux requirements can be reported without a solenoid design; available swing and margin require one. These reports do not establish component feasibility, fatigue life, shielding adequacy or a detailed tritium cycle.

Scans and POPCON explore operating space; the displayed POPCON approximation is qualitative and differs from full time-dependent runs. UQ samples configured uncertainties using seeded streams, and worker assignment does not change the sample results. Optimisation supports scenario-aware objectives and Pareto fronts. It cannot supply missing model fidelity or prove global optimality. [Figure 4](figures/fig04_popcon.svg) shows POPCON and [Figure 9](figures/fig09_scan.svg) shows a full-model scan. Library/CLI export supports CSV, JSON, NetCDF, IMAS-shaped data and G-EQDSK; IMAS export is not an assertion of complete IDS compliance.

## 8. Determinism and software verification

Within a fixed runtime and configuration, direct stepping, chunked playback and resumable slices produce bit-identical accepted states. Wall-clock scheduling only selects yield points; it never enters a model equation. Checkpoints include RNG and module state, so rewind restores actual computation, not interpolation of stored frames. Scenario events, controls, configuration hashes and completion fingerprints make replay auditable. Floating-point transcendental functions can vary across Node majors or platforms; golden tolerance across Node majors is relaxed accordingly. Determinism is not a promise of identical bytes on every JavaScript implementation.

Unit/component/CLI tests cover analytic solutions, conservation, failures, worker shutdown, import/export, UI locales and accessibility. Real-event seam tests exercise Loarte ELMs, Porcelli/Kadomtsev crashes, equilibrium adoption, chunking and rewind together. Golden regression records complete scalars, histories, events and profile/equilibrium digests; every deliberate change has an append-only reason. Mutation smoke tests intentionally sabotage numerical and engineering paths; one case is detected by timeout. Coverage thresholds and the strict-type baseline are measured gates, not correctness proofs. No final independent audit was performed for this release: the owner waived that extra audit; the release checks still run.

Reproduce with `npm run ci:local`, `npm run coverage`, `npm run coverage:levels`, `npm run typecheck:strict`, `npm run build:lib`, `npm run paper:check` and `npm run release:check -- --no-allow-unreleased`. Use Node 24 for recorded golden and figure comparisons. Tests in `src/docs` check report/README/paper numbers, including deliberately falsified claims.

## 9. Numerical verification and convergence

[Figure 7](figures/fig07_verification.svg) measures Grad–Shafranov, cylindrical finite-volume diffusion and backward-Euler verification. Backward-Euler's first-order result does not measure TR-BDF2's order; separate TR-BDF2 tests cover its stage formula, stiff limit and error control.

<!-- table: verification -->
| Operator | Observed order | Expected order |
| --- | --- | --- |
| Grad–Shafranov / Solov’ev | <!--num:VER.GS-->2.05<!--/num--> | 2 |
| Finite-volume / cylindrical diffusion | <!--num:VER.FV-->1.94<!--/num--> | 2 |
| Backward Euler | <!--num:VER.BE-->0.99<!--/num--> | 1 |

The post-island-width-fix ITER15 radial series below is a full baseline discharge. Its default-grid values match `test/golden/ITER15.json`. All quantities are flat-top means; T_ped is in keV. Source: [convergence record](../bench/records/convergence-iter15-v4.json), with the complete time-tolerance and maximum-step studies.

<!-- table: convergence -->
| Parameter | Value | Q | f_bs | li(3) | T_ped (keV) | Steps | ELMs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nRho | 25 | 10.1629 | 0.230293 | 0.713831 | 3.50614 | 20568 | 1309 |
| nRho | 50 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| nRho | 100 | 10.5094 | 0.231067 | 0.721273 | 3.50977 | 22710 | 1322 |
| rtol | 0.01 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| rtol | 0.001 | 10.4758 | 0.231218 | 0.719483 | 3.53475 | 28491 | 1320 |
| rtol | 0.0001 | 10.4859 | 0.23127 | 0.719675 | 3.53776 | 37604 | 1321 |
| dtMax | 0.5 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| dtMax | 0.05 | 10.4524 | 0.230818 | 0.71965 | 3.53805 | 21885 | 1319 |
| dtMax | 0.01 | 10.488 | 0.231239 | 0.719809 | 3.53802 | 45791 | 1325 |

Radial cells <!--num:CONV.cells.base-->50<!--/num--> → <!--num:CONV.cells.fine-->100<!--/num-->: Q changes +<!--num:CONV.Q-->0.57<!--/num--> %, T_ped changes −<!--num:CONV.Tped-->1.10<!--/num--> %; target <!--num:CONV.target-->1<!--/num--> %.

Q meets the refinement target; T_ped does not. Its grid dependence oscillates as pedestal sampling changes. Below the default resolution there is a lower-Q regime, so the coarse grid is not an interchangeable default. This is empirical convergence of one event-rich trajectory, not proof of uniform convergence for all presets or switches. Manufactured solutions check individual operators; they do not validate reduced physical closures.

## 10. Reference comparison (validation v2)

<!--num:VAL.checks-->46<!--/num--> checks: <!--num:VAL.inrange-->38<!--/num--> within range, <!--num:VAL.known-->8<!--/num--> known failures, no unexpected failure. Wording: <!--num:VAL.validated-->16<!--/num--> validated, <!--num:VAL.benchmarked-->16<!--/num--> benchmarked, <!--num:VAL.calibrated-->1<!--/num--> calibrated, <!--num:VAL.sanity-->13<!--/num--> sanity bounds. Deviation threshold <!--num:VAL.threshold-->20<!--/num--> %.

Acceptance ranges come from published uncertainty, a documented reduced-model tolerance or an explicit bound in `references.ts`; they are never widened to fit the simulation. "Validated" is the harness wording for a comparison within its deviation threshold; "benchmarked" reports larger deviations even when a broad acceptance band passes. Design targets and sanity bounds retain those roles. NIF N210808 alone calibrates ICF_CAL; N221204 and N230729 are blind only with respect to that constant. Other model choices and inputs were not chosen without knowledge of those shots. The model lacks an input separating the shots and therefore predicts nearly the calibration yield for all of them.

The table includes every reference check: reference and model in the metric's units, their ratio, status, wording and calibration role. DEMO comparisons use the full preset, while DEMO golden cases are shortened. Source limitations for individual references are preserved below the table. [Figure 5](figures/fig05_validation.svg) plots these comparisons and [Figure 6](figures/fig06_reactivity_lawson.svg) gives reactivities and Lawson context.

<!-- table: validation -->
| ID / unit | Reference | Model | Ratio | Accepted | Status | Wording | Role | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ITER.Q | 10 | 10.084 | 1.0084 | 5..20 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.Pfus (MW) | 500 | 516.638 | 1.03328 | 300..800 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.H98 | 1 | 1.09088 | 1.09088 | 0.748..1.34 | pass | sanity bound | comparison | [ITER Physics Basis 1999](https://doi.org/10.1088/0029-5515/39/12/302) |
| ITER.nG | 0.85 | 0.848315 | 0.998018 | 0.6..1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.alphaShare | 0.2 | 0.207343 | 1.03671 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| JET.Efus (MJ) | 59 | 66.6361 | 1.12943 | 40..80 | pass | validated | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| JET.alphaShare | 0.2 | 0.202824 | 1.01412 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| SPARC.Q | 11 | 7.84251 | 0.712955 | 2..20 | pass | benchmarked (deviation -29 %) | comparison | [Creely 2020](https://doi.org/10.1017/S0022377820001257) |
| SPARC.alphaShare | 0.2 | 0.203735 | 1.01868 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| DIIID.H98 | 1 | 0.882597 | 0.882597 | 0.748..1.34 | pass | sanity bound | comparison | [ITER Physics Basis 1999](https://doi.org/10.1088/0029-5515/39/12/302) |
| DIIID.Palpha (MW) | 0.0225 | 0.00255145 | 0.113398 | 0..0.0225 | pass | sanity bound | comparison | [Lazarus 1997](https://doi.org/10.1088/0029-5515/37/1/I11) |
| JT60SA.W (MJ) | 22 | 20.3793 | 0.926331 | 15.8..31.2 | pass | validated | comparison | [Garzotti 2018](https://doi.org/10.1088/1741-4326/aa9e15) |
| JT60SA.tauE (s) | 0.64 | 0.478671 | 0.747924 | 0.389..0.856 | pass | benchmarked (deviation -25 %) | comparison | [Garzotti 2018](https://doi.org/10.1088/1741-4326/aa9e15) |
| MASTU.H98 | 1.15 | 0.915382 | 0.795984 | 0.748..1.74 | pass | benchmarked (deviation -20.4 %) | comparison | [Harrison 2024](https://doi.org/10.1088/1741-4326/ad6011) |
| MASTU.q95 | 7.5 | 6.39329 | 0.852438 | 5..10 | pass | sanity bound | comparison | [Berkery 2023](https://doi.org/10.1088/1361-6587/acb464) |
| W7X.Ti0 (keV) | 1.5 | 2.00395 | 1.33597 | 0.91..2.21 | pass | benchmarked (deviation +34 %) | comparison | [Beurskens 2021](https://doi.org/10.1088/1741-4326/ac1653) |
| W7X.HISS04 | 0.65 | 0.8068 | 1.24123 | 0.448..0.869 | pass | benchmarked (deviation +24 %) | comparison | [Beurskens 2021](https://doi.org/10.1088/1741-4326/ac1653) |
| DEMO.Pfus (MW) | 2000 | 1903.35 | 0.951673 | 1000..3000 | pass | validated | comparison | [Federici 2019](https://doi.org/10.1088/1741-4326/ab1178) |
| DEMO.alphaShare | 0.2 | 0.209192 | 1.04596 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| ITER15.Q | 10 | 10.4503 | 1.04503 | 5..20 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.Pfus (MW) | 500 | 525.615 | 1.05123 | 300..800 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.fbs | 0.2 | 0.230607 | 1.15303 | 0.1..0.4 | pass | validated | comparison | [Sips 2005](https://doi.org/10.1088/0741-3335/47/5A/003) |
| ITER15.li | 0.85 | 0.719487 | 0.846455 | 0.6..1.1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.q95 | 3 | 3.50345 | 1.16782 | 2.7..4 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.Tped (keV) | 4.5 | 3.54873 | 0.788606 | 2..7 | pass | benchmarked (deviation -21 %) | comparison | [Snyder 2011](https://doi.org/10.1088/0029-5515/51/10/103016) |
| ITER15.nG | 0.85 | 0.799974 | 0.941146 | 0.6..1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| JET15.Efus (MJ) | 59 | 81.8445 | 1.3872 | 40..80 | known-fail | benchmarked (deviation +39 %) | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| JET15.Ti0 (keV) | 10 | 10.1998 | 1.01998 | 6..15 | pass | validated | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| SPARC15.Q | 11 | 6.28916 | 0.571742 | 2..20 | pass | benchmarked (deviation -43 %) | comparison | [Creely 2020](https://doi.org/10.1017/S0022377820001257) |
| DEMO15.Pfus (MW) | 2000 | 2007.49 | 1.00375 | 1000..3000 | pass | validated | comparison | [Federici 2019](https://doi.org/10.1088/1741-4326/ab1178) |
| DEMO15.fbs | 0.35 | 0.374528 | 1.07008 | 0.2..0.6 | pass | validated | comparison | [Siccinio 2020](https://doi.org/10.1016/j.fusengdes.2020.111603) |
| NIF210808.G | 0.72 | 0.714783 | 0.992754 | 0.36..1.44 | pass | calibrated (deviation -0.7 %) | calibration | [Abu-Shawareb 2022](https://doi.org/10.1103/PhysRevLett.129.075001) |
| NIF210808.Ti (keV) | 9.55 | 1.32155 | 0.138383 | 6.3..13.2 | known-fail | benchmarked (deviation -86 %) | comparison | [Pak 2024](https://doi.org/10.1103/PhysRevE.109.025203) |
| NIF.G | 1.5 | 0.668409 | 0.445606 | 1..3 | known-fail | benchmarked (deviation -55 %) | blind | [Abu-Shawareb 2024](https://doi.org/10.1103/PhysRevLett.132.065102) |
| NIF.G_N230729 | 1.89 | 0.668409 | 0.353656 | 1..3.78 | known-fail | benchmarked (deviation -65 %) | blind | [Kritcher 2024](https://doi.org/10.1063/5.0210904) |
| DIRECT.G | 0.74 | 0.390571 | 0.527799 | 0.3..1.76 | pass | benchmarked (deviation -47 %) | comparison | [Gopalaswamy 2024](https://doi.org/10.1038/s41567-023-02361-4) |
| Z.yield | 11000000000000 | 199972000000000 | 18.1793 | 3660000000000..33000000000000 | known-fail | benchmarked (deviation +1718 %) | comparison | [Gomez 2020](https://doi.org/10.1103/PhysRevLett.125.155002) |
| Z.Ti (keV) | 3.1 | 3.1687 | 1.02216 | 2.17..4.03 | pass | validated | comparison | [Gomez 2020](https://doi.org/10.1103/PhysRevLett.125.155002) |
| GF.Tmax (keV) | 6.463 | 1.41172 | 0.218431 | 0.3..6.463 | pass | sanity bound | comparison | [Lindemuth 1983](https://doi.org/10.1088/0029-5515/23/3/001) |
| FRXL.Tmax (keV) | 6.463 | 1.43028 | 0.221303 | 0.3..6.463 | pass | sanity bound | comparison | [Lindemuth 1983](https://doi.org/10.1088/0029-5515/23/3/001) |
| ZAP.Te (keV) | 2 | 1 | 0.5 | 0.7..3.9 | pass | sanity bound | comparison | [Levitt 2024](https://doi.org/10.1103/PhysRevLett.132.155101) |
| TAE.Te (keV) | 0.5 | 0.606066 | 1.21213 | 0.25..1 | pass | benchmarked (deviation +21 %) | comparison | [Gota 2021](https://doi.org/10.1088/1741-4326/ac2521) |
| TAE.Ttot (keV) | 3 | 1.21213 | 0.404044 | 1.5..6 | known-fail | benchmarked (deviation -60 %) | comparison | [Gota 2021](https://doi.org/10.1088/1741-4326/ac2521) |
| MIRROR.Te (keV) | 0.66 | 9.53177 | 14.4421 | 0.33..1.8 | known-fail | sanity bound | comparison | [Bagryansky 2015](https://doi.org/10.1103/PhysRevLett.114.205001) |
| MUON.Yf | 150 | 106.462 | 0.709745 | 109..191 | known-fail | benchmarked (deviation -29 %) | comparison | [Jones 1986](https://doi.org/10.1103/PhysRevLett.56.588) |
| MUON.Q | 0.528 | 0.374511 | 0.709301 | 0..0.99 | pass | sanity bound | comparison | [Jones 1986](https://doi.org/10.1103/PhysRevLett.56.588) |

Reasons for the known failures (quoted from the source table):

- **JET15.Efus:** the 1.5D model over-predicts the record pulse by about 40 % (preset note "1.5D: +40 %"): beam-target fusion from the 3-component NBI deposition and a T_i(0) near 10 keV together over-predict the neutron rate of the record pulse
- **NIF210808.Ti:** the model puts N210808 below its own ignition threshold (χ_ig = 0.951 with ICF_CAL = 0.03931, fitted to the yield only), so no α heating raises the hot spot: its temperature is the kinematic one of the compression, 1.32 keV, a factor 7 below the experiment, while the calibrated yield (1.37 MJ) is reproduced. The temperature is the clearest sign that the calibration matches the yield with a wrong hot spot: the ignition-cliff constants, set when ICF_CAL was 0.07, are not part of it
- **NIF.G:** the model has no input for what separates N221204 from the calibration shot N210808 (an ablator 6 µm thicker, 7 % more laser energy, better low-mode symmetry and capsule quality), so it runs the same capsule and predicts the calibration yield, 1.37 MJ: G = 0.67 against 1.5 (model/published 0.45, yield ratio 0.43). The 2.3-fold increase of the yield between the two shots lies above the ignition cliff, which a model calibrated at one point on the cliff does not resolve; the cliff constants were not re-tuned. Before v4.0 ICF_CAL = 0.07 was tuned to N221204 itself and the check read G = 1.49, a fit that looked like a prediction
- **NIF.G_N230729:** as for N221204 the model predicts the calibration yield, 1.37 MJ, for every shot of the platform: G = 0.67 against 1.89 (model/published 0.35). The capsule quality that raised the yield of N230729 above that of N221204 (fewer high-Z inclusions and defects) enters the model only through the surface roughness, which acts on the ignition parameter and not on the burn-up of an ignited or marginal shot
- **Z.yield:** the 0D MagLIF model over-predicts the yield by more than an order of magnitude (2.0 × 10¹⁴ against 1.1 × 10¹³, since v4.0 with a burn of ≈ 2 ns instead of ≈ 30 ns): its ideal compression to CR = 30 has no liner–fuel mix, end losses, preheat losses or Be radiation, which limit the experiments
- **TAE.Ttot:** the single-temperature FRC model has T_i = T_e ≈ 0.6 keV, so T_e + T_i ≈ 1.2 keV; the hot beam-driven ion population of C-2W (T_i several times T_e) is not modelled
- **MIRROR.Te:** the single-temperature mirror model sets T_e = T_i ≈ 9.5 keV (with the Pastukhov plug factor of v4.0); mirror electrons are cooled by axial heat loss to the end walls, which limits every open trap built so far to T_e ≲ 1 keV and is not modelled
- **MUON.Yf:** Y_f = 1/(ω_s + 1/(λ_c τ_µ)) with the preset's ω_s = 0.56 % and λ_c = 1.2 × 10⁸ s⁻¹ gives 106 fusions per muon; the measured ≈150 implies a lower effective sticking (reactivation) or a faster cycling rate

Source-access limitations (from the source table):

- **MASTU.q95:** the 5 < q95 < 10 band is quoted from Berkery et al. 2023 (PPCF 65 045001), whose text could not be read when the check was reviewed (IOPscience stands behind a bot check and the OSTI record has no full text): what was verified is its abstract (operation stayed out of the low-q, low-density region of the Hugill diagram), the open slides of the same authors (ISTW 2022: plasma currents 400–750 kA, MAST-U yet to reach the low-q95 region) and, in the open text of Harrison et al. 2024 (PPCF 66 065019), the ranges 450–1000 kA, 0.42–0.64 T and κ 2.0–2.2; the EFIT q95 of 6.3–6.7 and the discharge shapes of Imada et al. 2024 (table 1) could not be re-read. The primary text of Sauter 2016 could not be read either (the EPFL copy resets the connection, Infoscience holds the record without the full text)
- **W7X.HISS04:** the ISS04 prefactor and exponents are those of a secondary quotation (Warmer et al., EUROfusion WPS2-PR(15)02, eq. 1, with f_ren in front); Yamada et al. 2005 (doi:10.1088/0029-5515/45/12/024) was not read, nor was the W7-X value of ι_2/3 behind the preset's 0.9
- **ITER15.Tped:** the 4.5 ± 0.5 keV (T_ped ≈ 4–5 keV) was not found as a printed number in the readable sources: the text of Snyder et al. 2011 (Nucl. Fusion 51 103016) could not be read (IOPscience stands behind a bot check, the OSTI record has no full text); the temperature above is derived from β_N,ped and n_ped of the authors' slides, and the abstract (only a summary of it was seen) quotes no temperature
- **NIF210808.Ti:** read in the accepted manuscript of the paper (OSTI 2377242, LLNL-JRNL-856035, 2026-10-01), not in the typeset article: the 10.1 keV is printed in its conclusion without an uncertainty, the 9 keV in section V as an approximate value for two shots, and the manuscript quotes N210808 as 1.33 ± 0.13 MJ where Abu-Shawareb et al. 2022 (table I) give 1.37 MJ
- **NIF.G_N230729:** verified: the abstract of Kritcher et al. 2024 (the Crossref record of doi:10.1063/5.0210904, read 2026-10-01) gives the maximum fusion energy of the platform to date as 3.88 MJ from 2.05 MJ of incident laser energy, and 3.15 MJ for N221204. Not verified: the full text of the paper, so no uncertainty of the 3.88 MJ is known (none is used), and the shot label and date, which the abstract does not state and which come from the facility record of LLNL (N230729, 30 July 2023)

## 11. Performance and pause latency

These are recorded measurements, not a timing guarantee for the final documentation commit. `bench/perf-baseline.json` gives three-run medians on Windows x64, Node v24.19.0, AMD Ryzen 5 5600, recorded during v4 development. ITER15 spans its baseline discharge and DEMO15 its full preset; performance is sensitive to CPU, runtime and competing tasks.

<!-- table: performance -->
| Preset | Median (s) |
| --- | --- |
| ITER | 1.999 |
| JET | 0.217 |
| ITER15 | 23.762 |
| JET15 | 4.114 |
| DEMO15 | 139.505 |
| NIF | 0.003 |

Pause request-to-reply measurements below come from [pause-latency-v4.json](../bench/records/pause-latency-v4.json), one short run per row with only about thirty requests. The machine was shared with other work; this is not a controlled idle measurement. Its p99 is effectively the maximum of that small sample. The worker settles or rolls back suspended steps before controls or rewind; it does not cancel arbitrary instructions instantly.

<!-- table: pause -->
| Preset | Speed | Requests | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| DEMO15 | 1x | 32 | 0.8 | 6.2 | 6.3 | 6.3 |
| DEMO15 | 30x | 31 | 3 | 9.6 | 10.6 | 10.6 |
| DEMO15 | 100x | 31 | 4.7 | 10 | 14.7 | 14.7 |
| ITER15 | 1x | 34 | 0.4 | 6 | 6.4 | 6.4 |
| ITER15 | 30x | 32 | 4.5 | 8.1 | 11.7 | 11.7 |
| ITER15 | 100x | 30 | 3.5 | 7 | 7.4 | 7.4 |

## 12. Limitations, open issues and provenance

- EPED onset pressure +<!--num:EPED.p-->21.1<!--/num--> %, temperature +<!--num:EPED.T-->15.4<!--/num--> %; the <!--num:EPED.target-->15<!--/num--> % target is unmet.
- Predictive-closure H98 target <!--num:H98.lo-->0.8<!--/num-->–<!--num:H98.hi-->1.2<!--/num-->: only one case, <!--num:H98.jet15-->1.02<!--/num-->, is in-band; the others span <!--num:H98.min-->0.29<!--/num-->–<!--num:H98.max-->0.70<!--/num-->.
- JET15 fusion energy <!--num:JET15.Efus-->81.8<!--/num--> MJ against <!--num:JET15.Efus.ref-->59<!--/num--> ± <!--num:JET15.Efus.unc-->6<!--/num--> MJ: +<!--num:JET15.Efus.dev-->39<!--/num--> %. Thermal share <!--num:JET.thermal-->36.7<!--/num--> % against an approximate <!--num:JET.trend-->50<!--/num--> % trend; #99971 split remains open.
- Blind NIF gain ratios: N221204 <!--num:NIF.N221204.ratio-->0.45<!--/num-->, N230729 <!--num:NIF.N230729.ratio-->0.35<!--/num-->; no shot-discriminating input.
- No external FACIT benchmark; hollow-core Kadomtsev behaviour is a convention/fallback.
- T_ped radial change −<!--num:CONV.Tped-->1.10<!--/num--> % misses the <!--num:CONV.target-->1<!--/num--> % target.
- Density control within about <!--num:NG.band-->2<!--/num--> % of Greenwald is stochastic; known failures are not presented as successes.

Other limits are fixed-boundary equilibrium, empirical confinement, approximate RF/NBI and SOL/divertor closures, simplified engineering, incomplete impurity atomic kinetics and representative rather than exhaustive switch-combination coverage. Figure hashes test reproducibility within their supported runtime; they do not prove external predictive accuracy. The [v3-to-v4 number reconciliation](v4-numbers-diff.md) attributes changed headline numbers to power accounting, geometry/preset inputs, discretisation, remapping, island flattening and ICF calibration. No coefficients or literature ranges were retuned during release closeout.

The software and documentation were developed by Mustafa Karatum with substantial assistance from Claude Code (Anthropic), Codex (OpenAI) and MiMo under the author's direction. Automated tests and AI-assisted reviews are not a substitute for independent expert review. The JOSS package in `paper/` is prepared, not submitted. Funding, submission and any future adoption statement require the author's review.

## References and reproduction data

- Fusion Reactor Simulator. [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861).
- ``PROCESS'': A systems code for fusion power plants---Part 1: Physics. [10.1016/j.fusengdes.2014.09.018](https://doi.org/10.1016/j.fusengdes.2014.09.018).
- ``PROCESS'': A systems code for fusion power plants---Part 2: Engineering. [10.1016/j.fusengdes.2016.01.007](https://doi.org/10.1016/j.fusengdes.2016.01.007).
- cfspopcon: a Python package for plasma operating contours. [10.5281/zenodo.10054879](https://doi.org/10.5281/zenodo.10054879).
- Contour analysis of fusion reactor plasma performance. [10.1088/0029-5515/22/7/006](https://doi.org/10.1088/0029-5515/22/7/006).
- FreeGS: a free-boundary Grad--Shafranov solver. [freegs](https://github.com/freegs-plasma/freegs).
- FreeGSNKE: A Python-based dynamic free-boundary toroidal plasma equilibrium solver. [10.1063/5.0188467](https://doi.org/10.1063/5.0188467).
- TORAX: A Fast and Differentiable Tokamak Transport Simulator in JAX. [10.48550/arXiv.2406.06718](https://doi.org/10.48550/arXiv.2406.06718).
- METIS: a fast integrated tokamak modelling tool for scenario design. [10.1088/1741-4326/aad5b1](https://doi.org/10.1088/1741-4326/aad5b1).
- Improved formulas for fusion cross-sections and thermal reactivities. [10.1088/0029-5515/32/4/I07](https://doi.org/10.1088/0029-5515/32/4/I07).
- Chapter 2: Plasma confinement and transport. [10.1088/0029-5515/39/12/302](https://doi.org/10.1088/0029-5515/39/12/302).
- Power requirement for accessing the H-mode in ITER. [10.1088/1742-6596/123/1/012033](https://doi.org/10.1088/1742-6596/123/1/012033).
- Transient simulation of silicon devices and circuits. [10.1109/TCAD.1985.1270142](https://doi.org/10.1109/TCAD.1985.1270142).
- Theory of plasma transport in toroidal confinement systems. [10.1103/RevModPhys.48.239](https://doi.org/10.1103/RevModPhys.48.239).
- Neoclassical conductivity and bootstrap current formulas for general axisymmetric equilibria and arbitrary collisionality regime. [10.1063/1.873240](https://doi.org/10.1063/1.873240).
- Noncircular, finite aspect ratio, local equilibrium model. [10.1063/1.872666](https://doi.org/10.1063/1.872666).
- Neoclassical tearing modes and their control. [10.1063/1.2180747](https://doi.org/10.1063/1.2180747).
- A first-principles predictive model of the pedestal height and width: development, testing and ITER optimization with the EPED model. [10.1088/0029-5515/51/10/103016](https://doi.org/10.1088/0029-5515/51/10/103016).
- Chapter 1: Overview and summary. [10.1088/0029-5515/47/6/S01](https://doi.org/10.1088/0029-5515/47/6/S01).
- JET D-T scenario with optimized non-thermal fusion. [10.1088/1741-4326/ace2d8](https://doi.org/10.1088/1741-4326/ace2d8).
- Overview of interpretive modelling of fusion performance in JET DTE2 discharges with TRANSP. [10.1088/1741-4326/ad0310](https://doi.org/10.1088/1741-4326/ad0310).
- Lawson criterion for ignition exceeded in an inertial fusion experiment. [10.1103/PhysRevLett.129.075001](https://doi.org/10.1103/PhysRevLett.129.075001).
- Achievement of target gain larger than unity in an inertial fusion experiment. [10.1103/PhysRevLett.132.065102](https://doi.org/10.1103/PhysRevLett.132.065102).
- Design of first experiment to achieve fusion target gain $>$ 1. [10.1063/5.0210904](https://doi.org/10.1063/5.0210904).

The full bibliography is [paper.bib](../paper/paper.bib). Each validation row links its primary reference; detailed range derivations and source limitations are in [references.ts](../src/physics/validation/references.ts). Figure captions, manifests, golden JSON and its reasons ledger are committed with the source. Run `npm run figures:check -- --threads 2` to check the archived figures without overwriting them.
