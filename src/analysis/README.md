# src/analysis: uncertainty quantification and optimisation

Everything here sits on top of the physics core and is **educational**: it shows how uncertainty propagates through, and what an
optimiser finds in, the reduced-order models. It is not a prediction of any real device. Every JSON result carries a `caveat` field
with that statement, and the text output prints it.

The modules are pure TypeScript (no DOM, no Node API) except `node/`, which holds the worker-pool runner. The command-line tools are
`src/cli/uq.cli.ts`, `scan.cli.ts` and `optimize.cli.ts` (run them with `npx tsx src/cli/<name>.cli.ts --help`).

## Map

| Module | What it does | Source |
|---|---|---|
| `sobolDirections.ts`, `sobol.ts` | Sobol' sequence, 256 dimensions, Gray-code order, random scrambling (Matousek linear matrix scramble + digital shift) | Joe & Kuo, SIAM J. Sci. Comput. 30 (2008) 2635 (direction numbers, licence in the file header); Matousek, J. Complexity 14 (1998) 527 |
| `distributions.ts` | uniform, loguniform, (truncated) normal and lognormal, triangular, point; quantile and CDF; erf/erfc and the normal quantile to full double precision | Abramowitz & Stegun 7.1.6, 7.1.14, 26.2.23 |
| `samplers.ts` | Monte Carlo, Latin hypercube, scrambled Sobol' on the unit cube, seeded with the project RNG; the stream of a column does not depend on the number of columns | McKay, Beckman & Conover 1979 |
| `stats.ts` | moments, type-7 quantiles, Wilson interval, Spearman correlation, percentile bootstrap | Hyndman & Fan 1996; Wilson 1927; Efron 1979 |
| `sensitivity.ts` | Saltelli design and the first-order (Saltelli 2010, Jansen) and total (Jansen, Sobol') Sobol' indices with bootstrap intervals | Saltelli et al., Comput. Phys. Commun. 181 (2010) 259; Jansen 1999 |
| `priors.ts` | parameters as dotted config paths, Gaussian-copula correlation groups, default priors of a magnetic preset | see below |
| `metrics.ts` | scalar outputs of one shot: flat-top and peak Q, P_fus, n/n_G, beta_N, disruption and completion flags | project flat-top definition |
| `ensemble.ts` | design of an ensemble, probabilities, quantiles, rank correlations, Sobol' targets, JSON and CSV | |
| `run.ts`, `node/` | in-process runner; worker-pool runner (`src/cli/pool.ts`) and its worker | |
| `scan.ts` | grid and sampled parameter scans | |
| `steadyState.ts` | the POPCON fixed point at one (n, T) with its intermediate quantities | Houlberg et al., Nucl. Fusion 22 (1982) 935 |
| `optim/` | Nelder-Mead, augmented Lagrangian, CMA-ES, NSGA-II | see the file headers |
| `design.ts` | design optimisation (R, a, B0, Ip, n/n_G, T against the systems limits), Pareto fronts | |
| `cliSupport.ts` | flag syntaxes and text reports of the CLIs | |

## Uncertainty quantification (`uq`)

`uq --preset ITER --n 128` samples the priors, runs a full simulation per sample and reports

* `P(Q >= 10)`: the shot ran to its scheduled end without a disruption **and** its flat-top Q reached the target;
* `P(disruption)`; `P(n/nG > 1)` for the flat-top mean and for the peak over the shot; extra events with `--prob METRIC>=X`;
* quantiles (default 5, 16, 50, 84, 95 %) with bootstrap intervals of Q, P_fus, ... over the shots that ran to the end, and of
  n/n_G, beta_N over all shots;
* Spearman rank correlations of the outputs with the inputs;
* with `--analysis sensitivity`, Sobol' first-order (S) and total (ST) indices with bootstrap intervals for `Q_flat`,
  `Q_delivered` (zero for a shot that ended early), `Pfus_flat_MW`, `nG_max`, `betaN_max` and `disrupted`. The design has
  `n (d + 2)` shots; use a power of two for `n` with the Sobol' sampler. The A and B blocks double as the propagation sample.

The metrics of a disrupted shot are taken over the frames up to the disruption onset: after it the plasma current collapses and
n/n_G (which divides by the instantaneous I_p) blows up. A shot that fails with an error is a failed shot, counted and excluded.
The intervals of probabilities (Wilson) and of the bootstrap treat the runs as independent draws; for Sobol' and Latin hypercube
designs they are conservative.

**Priors.** Parameters are addressed by dotted paths into the configuration (`H98`, `impurity.concentration`, ...); `--param
PATH=DIST` replaces or adds one (`lognormal:median:sigmaLog`, `normal:mean:sd[:lo:hi]`, `uniform:lo:hi`, `loguniform:lo:hi`,
`triangular:lo:mode:hi`, `point:v`), `--priors none` starts from nothing. The defaults of a magnetic preset
(`uq --preset ITER --list-params` prints them with their basis). Numeric settings of the 1.5D profile model can be uncertain too on a 1.5D
preset, e.g. `--param profiles.pedestalWidth=lognormal:0.06:0.3` (the pedestal width, ETB factor and ELM size are fixed inputs of the model):

* **H98**, lognormal, sigma_ln 0.14: the RMSE of the IPB98(y,2) regression and the quoted error of its ITER prediction
  (ITER Physics Basis, Nucl. Fusion 39 (1999) 2175, ch. 2). `--h98-prior itpa20il` uses 0.44/2.79 = 15.8 %, the uncertainty of the
  ITPA20-IL prediction tau_E,th(ITER) = 2.79 +- 0.44 s (Verdoolaege et al., Nucl. Fusion 61 (2021) 076006).
* **The ITPA20 covariance is not used.** Its regression covariance matrix is not in the open text of the paper (only the standard
  errors of the exponents and the ITER prediction are), and sampling the coefficients independently from their standard errors would
  ignore the strong anti-correlations of the regressors: the propagated uncertainty of tau_E at the ITER point comes out near 100 %
  instead of the published 16 %. The published prediction uncertainty is used as the width of the H98 prior instead.
  `CorrelationSpec` and `logScalingSigma` are in place for when the covariance is available.
* density `n_target` (sigma_ln 0.10), impurity and seeded-impurity fractions (0.5), He ash ratio tau_He/tau_E (0.25), and the beta_N
  and Greenwald limits of the disruption model (0.08): **assumptions**, marked `ASSUMPTION` in their basis text.

**Determinism.** The same options give byte-identical JSON, whatever `--threads` is: the design comes from the seeded sampler, each
shot is deterministic (the preset's own ELM seed, or with `--stochastic` a seed derived per design row), results are collected in
task order, and the JSON has no timing, host or date. `inputHash` identifies the inputs. `--flat-top frame` switches the flat-top
means to the frame-weighted definition of v3.0.0 (default: the time-weighted one of the golden numbers, the shot report and the validation table since v4.0).

## Optimisation (`optimize`)

`steadyState(cfg, n, T)` repeats the loop of `computePopcon` for one point. `steadyState.test.ts` requires agreement with the POPCON
grid to 1e-12 for ten kinds of preset (the two are bit-identical today), so a POPCON physics change that is not made here fails it.

`optimize --preset ITER --objective major-radius --q-min 10` chooses R, a, B0, Ip, n/n_G and T (optionally H98, kappa) to minimise
the major radius, plasma volume or auxiliary power, or maximise the fusion power or gain, subject to Q, beta_N, q95, H-mode
access (P_L >= P_LH), installed heating power, TF coil peak field and stress, and aspect ratio (`design.ts` lists them and their
defaults, which come from the preset's own limits). The solver is an augmented Lagrangian (Hestenes/Powell/Rockafellar; Nocedal &
Wright 17.4) with Nelder-Mead inside (`--solver cma-es` for CMA-ES), started from four temperatures because a POPCON has more than
one Q maximum. `--pareto major-radius,aux-power` gives the whole front of two objectives with NSGA-II, seeded with the two
single-objective optima. Results report the multipliers and which constraints are active.

**Verification** (see the tests): Hock-Schittkowski #71 (f* = 17.0140173, x* = 1, 4.7429994, 3.8211503, 1.3794082) is reproduced to
1e-8 with a feasible point; #6 and #12 too; the design optimum beats 20000 random feasible designs and every feasible node of a
density-temperature grid; CMA-ES solves ill-conditioned and rotated ellipsoids, Rosenbrock and Rastrigin (with restarts); NSGA-II
reproduces the convergence of Deb et al. (2002) on ZDT1 and the analytic front of Binh & Korn; the Sobol' indices of the
Ishigami function at N = 2^14 are S = 0.3139, 0.4424, 0.0000 and ST = 0.5575, 0.4424, 0.2438 (analytic 0.3139, 0.4424, 0 and 0.5576,
0.4424, 0.2437).

## Known limits

* The optimum is a property of the reduced model: 0D power balance at the POPCON fixed point, T_i = T_e, IPB98(y,2) x H98 confinement
  everywhere, no pedestal, no current-drive or stability physics beyond the listed limits, no cost model, fixed fuel, impurities,
  profile shapes and magnet gaps.
* `Q` in the steady state is capped at 1000 in constraints (an ignited point has no finite Q); the auxiliary-power objective is
  clamped at zero.
* Non-magnetic presets have no default priors (give `--param`); they run, and the metrics that do not exist for them are NaN.
* Ensembles of 1.5D presets work but cost seconds to minutes per shot.
* The Sobol' sequence is limited to 256 dimensions, that is 128 parameters in a Saltelli design.
