# 1.5D profile model: module layout and plug-in interfaces

Developer note for the lanes that add physics to the 1.5D model (pedestal, transport closures,
fast ions, impurities, current drive, …). The physics is described in the module headers; this
note says where things live, in which order they run, and how to add a module without breaking
the invariants the tests and the golden files rely on.

## Layout

`ProfileModel` (`model.ts`) implements `SimModel` and only orders the calls; the physics lives in
the modules below. All of them read and write one `ProfileContext` (`context.ts`): configuration,
current equilibrium and transport geometry, work arrays, plasma and controller state, output.

| Path | Contents |
| --- | --- |
| `state.ts` | layout of the state vector `y = [T_e \| T_i \| n_e \| ψ \| scalars]`; `ctx.view(y)` gives named views (`st.Te`, `st.s.Ip`, …) |
| `work.ts` | work arrays `ctx.w` (cell arrays of N, face arrays of N + 1), allocated once |
| `context.ts` | `ProfileContext`, `StepConstants` (held fixed over a step), `onGeometry` cache hooks |
| `geometry1d.ts` | the radial grid (uniform, or packed towards the edge: `GridSpec`, `buildGrid`, `cellIndex`, `faceValue`, …) and the transport geometry on it, ρ̂ = √(Φ/Φ_b), from equilibrium tables (`EquilibriumTables`) |
| `fvsolver.ts` | implicit finite-volume solvers (heat, density, current) with the reference state and explicit rate of a TR-BDF2 stage, their right-hand sides (`residual`, `rate`) and error-estimate filter, `boundaryLoss` (P_bound), the Pereverzev–Corrigan term of the heat solve; the current diffusion in the Hinton–Hazeltine form with the moving-coordinate term |
| `composition.ts` | quasi-neutral composition; He ash, impurity and fuel-mix inventories |
| `qprofile.ts` | ψ → ψ′, q, enclosed current, ⟨j·B⟩; q95 |
| `boundary/sol.ts` | separatrix values (two-point T_sep, n_sep), lagged P_SOL |
| `sources/` | `SourceModel` plug-ins: `nbi`, `rf`, `fusion`, `radiation`, `exchange`; `current.ts` (σ_neo, bootstrap, ohmic); `deposition.ts` (profiles, NBI chord). `fusion` evaluates every channel of the fuel with the helpers the 0D model uses (`pairDensity`, `burnPerReaction`, the products of `FUEL_CHANNELS`) |
| `transport/` | `TransportModel` plug-ins: `scaling`, `cgm`; `coefficients.ts` adds barrier (`pedestal.ts`), D and pinch, NTM islands, neoclassical floor |
| `control/` | heating (with the ignition-test ramp-down) and density programmes, the plasma-current programme I_p(t) (`plasmaCurrent.ts`), fueling feedback, loss power P_L, τ_E scaling and the C_χ controller |
| `solver/` | `pipeline.ts` (evaluation order), `coupledStep.ts` (the TR-BDF2 step: the stage solver, error control, event localisation, failures), `newtonStage.ts` (Newton–Raphson on a stage; the block-tridiagonal LU, the coloured Jacobian and the damped Newton iteration are `numerics/blockTridiagN.ts` and `numerics/newton.ts`), `trbdf2.ts` (method constants, error estimate, controller), `localise.ts` (dense output and event crossing), `acceptStep.ts` (update after an accepted step) |
| `coupling/equilibrium.ts` | Grad–Shafranov coupling: initial solve, update policy, guarded updates (`eqguard.ts`) |
| `events/` | `EventModel` plug-ins: `LH`, `ELM`, `sawtooth`, `NTM`, `burn`, `warnings`, `disruption`; `triggers.ts` (the margins of the ELM and sawtooth thresholds the stepper localises) |
| `diagnostics.ts` | time traces (`PROFILE_DIAGS` are the ones the UI shows), profiles, power totals |
| `checkpoint.ts` | `Checkpointable` and the checkpoint store (rewind) |

## One step

`CoupledStepper.step` (normal phase) advances `y` from t towards `tMax` by one TR-BDF2 step (below) and returns the new
time; the step may end earlier than `tMax` (at an event, see "Time stepping"). An **attempt** (`implicitStep`, one TR-BDF2
step at one Δt) does:

1. once, on the old state: composition → q profile → boundary values → step constants
   (`heatingPowers`, then every source's `prepare`, then the neoclassical closure) → fueling
   source (`w.Sn`) → every source's `particles`; the trigger margins of the events that have one;
2. the rates of the old state (`oldRates`): transport coefficients, every source's `heat`, the current sources, then the
   right-hand sides of the density, energy and current equations (`DensitySolver.residual`, `HeatSolver.residual`,
   `CurrentSolver.rate`), per volume: the explicit source of the trapezoidal stage and the R_n of the error estimate;
3. stage 1, the trapezoidal rule to t + γΔt (γ = 2 − √2), and stage 2, BDF2 from the old and the intermediate state to
   t + Δt. Both are backward-Euler-like solves over the same interval dΔt (d = 1 − √2/2): stage 1 with the old state as
   reference and its rate as an explicit source, stage 2 with the reference aU_γ + bU_n (a = 1.207, b = −0.207) and no
   source (`HeatInputs.U0e`, `Xe`, `DensityInputs.X`, `CurrentInputs.rate0`). The current diffusion of a stage has the plasma current at the end
   of the stage as its boundary condition (`ProfileContext.ipAt`, "Current diffusion"). Within a stage the nonlinear system is solved by
   Picard iterations on the iterate, accelerated by Anderson mixing of (T_e, T_i, n_e) (depth 4, at most 12 iterations, converged at a
   relative change of 0.1 rtol): transport coefficients → density solve → composition → every source's `heat` → q profile → current
   sources (σ, bootstrap, every source's `current`, ohmic) → `assembleHeatSources` → heat solve (T_e, T_i together) → current solve; or, for a
   predictive transport model, by Newton–Raphson on the four fields together ("Newton"). Stage 2 starts from the extrapolated stage 1;
4. P_bound from the last heat solve, final composition and q profile; the scaled error estimate of the step.

The error estimate accepts the step or repeats it with a smaller Δt (rejection: an attempt that is not a failure). A **failed**
attempt (Picard not converged in a stage, a non-finite state, or a `NumericalFailure` or `GSFailure` thrown by a module) is
retried with Δt × 0.4 (and runs the per-attempt parts of 1. again); after 12 failed attempts one forced attempt is accepted if
finite, otherwise the shot ends with a `StepFailure`. A relative change of a profile above 35 % within a step counts as an error
above the tolerance, in proportion to the change. Any other exception thrown inside a step (a `TypeError` of a plug-in, a violated
invariant) is a programming error: it propagates out of `Simulation.advance` with `y` put back to
the start of the step. That covers the update after the accepted step too (the `accepted` hooks,
the equilibrium update): `CoupledStepper.step` snapshots the scalars of the context that a step
changes (P_SOL, Γ_b, the smoothed dW/dt and the ELM energy booked in it, the fast-ion pools, the
diagnostics, the equilibrium, pending events, issued warnings) and restores them with `y`, so a
caller that catches the error and steps on continues as if the step had not been tried. What a
plug-in keeps in its own fields is its own business. A module that meets a numerical problem it cannot repair (a singular system
of its own, a non-finite closure) throws a `NumericalFailure` (`failures.ts`) to have the attempt
retried; the `SingularMatrixError` of the heat, density and current solves (`numerics/linalg.ts`) is converted to
`LinearAlgebraFailure` in `fvsolver.ts`.
Then `acceptStep` integrates the global quantities (P_SOL, τ_E and C_χ, inventories, counters, NTM
widths), calls the `accepted` hooks of the transport model and the sources, writes the
diagnostics, and the equilibrium coupling may adopt a new geometry (the work arrays are
re-evaluated on it).
`ProfileModel.postStep` then runs the event models in list order. Frames of a state no step
produced (t = 0, after an MHD crash, after a rewind) evaluate everything from `y` through
`PhysicsPipeline.evaluateWorkArrays`.

Energy bookkeeping: the TR-BDF2 step conserves energy in its own quadrature, ΔW/Δt = w (P_n + P_γ) + d P_{n+1} with
P = P_heat − P_rad − P_bound at the old, the intermediate and the new state and w = √2/4
(`CoupledStepper.energyResidual`, `energy.test.ts`: < 1e-4 P_heat over the ITER15 flat-top). The P_bound of the diagnostics is that
of the new state, so `dWdt = P_heat − P_rad − P_bound` holds only up to the change of P within the step. A new heating or loss
channel must keep the closure: put its power density into a work array, add it in `assembleHeatSources` and in
`powerTotals` (`diagnostics.ts`). The stored energy has one definition, `ctx.storedEnergy`
(W = Σ 3/2 (n_e T_e + n_i T_i) ΔV).

## Radial grid

The N cells lie between the faces ρ_f (ρ_0 = 0 the axis, ρ_N = 1 the separatrix); a cell centre is the
midpoint of its two faces, and the fluxes live on the faces. `ProfileSettings.gridPacking` p sets the
distribution of the faces: p = 0 is the uniform grid of v3, p > 0 (default 4) packs the cells towards the
edge with a tanh step in the cell density, ∝ 1 + p S(ρ), S = ½(1 + tanh((ρ − ρ_T)/w)), ρ_T = 1 − 1.25 w_ped,
w = 0.75 w_ped (w_ped = `pedestalWidth`): the edge cells are 1 + p = 5 times narrower than the core cells,
neighbouring cells differ in width by at most 25 %, and at N = 50 there are 10 cells across a pedestal of
width 0.06 (3 on the uniform grid). Every N gives the image of a uniform grid under the same smooth map
(`packedFaces`), so a refinement study converges in a fixed metric (`npm run bench:convergence`).
The packing follows `pedestalWidth`; a pedestal narrower than 0.04 gets fewer than 8 cells at N = 50, use
a larger `gridPacking` or `nRho` there.

`TransportGeometry` carries the grid, and **no module may use one spacing Δρ any more**:

| Field | Meaning |
| --- | --- |
| `dRhoC[i]` | width of cell i (the volume-weighted quantities, `RHO_CORE` share, NTM `∂q/∂ρ` over a cell) |
| `distF[f]` | distance between the two nodes that flank face f: centres f − 1 and f, the last centre and the separatrix for f = N (half a cell); the gradient across a face is ΔT/`distF` |
| `wR[f]` | weight of the right-hand cell in the linear interpolation of a cell value to face f; `faceValue(g, a, f)` |
| `spanF[f]`, `spanC[i]` | stencils of central differences over the faces, and over the centres (one-sided at the axis and towards the separatrix) |
| `cellIndex`, `centerInterval`, `nearestFace`, `interpCells` | lookups and interpolation in ρ; never `Math.floor(ρ / dRho)` |
| `uniform`, `dRho` | the legacy uniform grid and its width 1/N (for a packed grid `dRho` is only the mean spacing) |

The uniform path (`uniform`, p = 0) evaluates the expressions of the code before the grid became a parameter,
with arrays filled with the same doubles: p = 0 reproduces v3 bit for bit (`grid.test.ts` pins two shots; the
sha256 of every frame of the nine 1.5D golden cases was identical). Where the packed grid does something
else it is stated and gated on `g.uniform`: the α check of the ELM trigger (`alphaMHD`) includes the separatrix
face (its half cell is a face of the pedestal, and with cells 0.005 wide the steepest gradient of the barrier sits
there), and T_ped is the temperature at ρ_ped interpolated between the two centres around it (the uniform grid
takes the cell that contains ρ_ped, 0.02 wide in the steep barrier gradient).

ITER15 flat-top numbers against the grid (400 s; `npm run bench:convergence`, table under "Convergence" below): with p = 4
N = 50 and N = 100 differ by less than 1 % in Q, f_bs, ℓ_i and T_ped; the uniform grid by 1.6 % in Q, 1.7 % in ℓ_i
and 3.4 % in T_ped.

## Time stepping

**Method.** TR-BDF2 (Bank et al., IEEE Trans. CAD 4 (1985) 436; Hosea and Shampine, Appl. Numer. Math. 20 (1996) 21;
`solver/trbdf2.ts`): second order, L-stable, one step (no history, so a crash restarts it at no cost). The conserved quantities of the
equations are the density n_e, the energy contents (3/2) n_e T_e and (3/2) n_i T_i and ψ; the finite-volume solvers of `fvsolver.ts`
solve a stage as they solved a backward-Euler step, with the reference state and the explicit rate above. The inputs that are held
fixed over a step (heating powers, boundary values, the fueling source, the sources' `prepare`) are those of the old state.

**Error control** (`ProfileSettings.rtol`, `atol`, `dtMax`; defaults 1e-2, 1e-4, 0.5 s). The embedded estimate of the local truncation
error, a linear combination of R_n Δt and the three states that costs no further evaluation, is converted to T_e, T_i, n_e and ψ and
compared with `atol · max|y| + rtol · |y|` in every cell; the step is accepted when the largest ratio is at most 1. The raw estimate
is filtered with the inverse of the iteration matrix, `(I − dΔt J)⁻¹`, which is one more solve of each system with the frozen
coefficients of the last iterate (Hosea and Shampine, section 5): the outermost cells (a half cell from the separatrix) are stiff over a
step, the trapezoidal stage rings on them and the raw estimate reports the ringing, 100 to 1000 times the error of the cells inside;
the filter damps a component by 1/(1 + λ d Δt) and leaves the smooth ones alone. The maximum norm is the one that converges the
flat-top numbers; a root-mean-square norm takes half the steps and leaves Q about 1 % low (ITER15, 80 s). The next Δt is
Δt · 0.9 · err^(−1/2) within [0.2, 2] (an integral controller with no memory besides Δt, which is what the checkpoint records; the
exponent is between the 1/3 of the asymptotic error and what the estimate shows in practice, where the edge barrier and the
kinks of a crash dominate it); a rejected step is repeated with the step at which the error would be 0.9, the exponent measured
from two attempts. `CRASH_RESTART_DT` (0.5 ms) is proposed after an ELM or sawtooth crash. The counters
(`CoupledStepper.stats`: accepted, rejected, failed, localised, Picard iterations) are part of the checkpoint and the report.

**Events at the crossing** (`solver/localise.ts`). The ELM and the sawtooth crash used to fire after the first step that ended beyond
their threshold, so their time was late by up to a step and their rate depended on it. An event model with an `EventTrigger`
(`events/EventModel.ts`, `events/triggers.ts`) gives the stepper a margin (α_ped/α_crit − 1; s₁ − s_crit; positive beyond the
threshold, evaluated from the profiles only) and the earliest time it may fire (the end of its refractory period). When the margin
changes sign inside an accepted step, or the event becomes ready inside it, Brent's method (`numerics/roots.ts`) finds the crossing on
the dense output of the step (the quadratic through the three TR-BDF2 states), and the step is repeated with the length that ends
there; the crash then acts on the profiles at the crossing. The event is aimed 0.1 % beyond the threshold, and the ELM 2 % beyond its
recovery time τ_E/8, so that the model's own test passes on the diagnostics of the shortened step; if the interpolation missed, the margin of the
shortened step is still negative, no event fires, and the next step localises again from there (a delay by a fraction of a step,
never a lost event). In the ITER15 H-mode the ELMs are limited by the recovery time (α_ped/α_crit stays above 1 between crashes), so the
count follows the recovery time and not the step: 238 ELMs in 80 s at every Δt limit and tolerance. The L–H transition, the NTM onset and
the other events are not localised.

**Picard and Anderson.** The frozen-coefficient Picard iteration oscillates where χ depends steeply on the gradient (the critical-gradient
model: the differential diffusivity is 20 times χ near the threshold): a third of the attempts of ITER15 `cgm` failed, the mean step was
0.35 ms and the 10 s ramp-up took 30 s. Anderson mixing (`numerics/anderson.ts`) of the iterate converges in three to six iterations per
stage: under 3 % of the attempts are repeated and the 10 s run takes about 3 s. It is the fast path of the `scaling` model, whose χ is a smooth
function of the gradient, and stays that (bit for bit) whatever else changes.

**Newton** (`ProfileSettings.nonlinearSolver`: `'auto'`, the default, uses it for a predictive model, `'newton'` for every model, `'picard'`
and `'pc'` never). A stage is a root of F(z) = 0 for z = (T_e, T_i, n_e, ψ) of the N cells: the balance of each field over the stage interval,
F = (content − reference)/Δ − explicit rate − R(z), where R is the right-hand side of the finite-volume solvers (`residual`, `rate`) with every
coefficient evaluated at z (`solver/newtonStage.ts`). A fixed point of the Picard iteration is a root of F and the other way round (a test
solves a stage both ways and finds the same state to 3·10⁻⁹). F is a function of z alone: the evaluation runs in the order of the dependencies
(composition, q profile, transport coefficients, fluxes, sources), where the Picard iteration reads the q profile and the composition of the
iterate before (the transport model reads `w.qF`): a stale read makes F depend on the evaluations that came before and its finite differences
noise. Every row of F depends on its cell and the two neighbours, so the Jacobian is 4 × 4 block-tridiagonal and is built by coloured finite
differences (cells i ≡ c mod 3 perturbed together, one field at a time: 12 evaluations of F, `numerics/blockTridiagN.ts`, checked against the
column-by-column Jacobian to 2·10⁻⁵ of a row and against dense LU for the solve) and factored by block LU with pivoting inside the blocks.
The iteration (`numerics/newton.ts`) takes the Newton step with a backtracking line search on ½‖F‖² (Armijo, c = 10⁻⁴), a limit of 50 % of
a value per iteration and the positivity bounds of T and n; it stops when the applied step is below the Picard tolerance (0.1 rtol, at
most 2·10⁻³). The Jacobian is kept while the residual contracts by half per iteration (the chord method) and the second stage of an attempt
starts from the one of the first (same interval, close states); an **attempt starts without one**, so a step is a function of its inputs
and chunk invariance and exact rewind hold without checkpointing any cache. Quadratic convergence is visible until the step reaches the
accuracy of the Jacobian (a few 10⁻³ of a row on the stages tested, where the differences meet the kinks of the physics): the applied steps of a smooth
stage are 4.8·10⁻³, 1.5·10⁻³, 1.2·10⁻⁶, 6.6·10⁻¹⁰, 6·10⁻¹³ (`newtonStage.test.ts`).

**Pereverzev–Corrigan fallback** (Pereverzev and Corrigan, Comput. Phys. Commun. 179 (2008) 579). A Newton solve that does not converge (a line
search that finds no descent, a singular Jacobian, more than 12 iterations: 9 of the 1956 stages of the first 10 s of ITER15 `cgm`, 111 of 7462 over 40 s,
where the H-mode with its sawteeth and ELMs is on) is repeated from where the stage started by the Picard iteration with the heat solve stabilised:
the conduction gets an extra diffusivity c χ (c = 10) taken implicitly and c χ ∇T\* (T\* the iterate) taken off again explicitly (`HeatInputs.pcFactor`),
so that a fixed point solves the original equations. The frozen-χ iteration multiplies the error of the gradient by 1 − χ_d/((1 + c) χ),
χ_d = d(χ∇T)/d∇T, and diverges where χ_d > 2 χ; with the term it contracts where χ_d < 2 (1 + c) χ (a test: on a steep critical-gradient χ the plain
iteration cycles between two states and the stabilised one converges). `'pc'` uses it alone: on ITER15 `cgm` it costs about half of Picard with Anderson
mixing, with twice as many attempts repeated.

What it costs, ITER15 `cgm`, CPU seconds on an idle machine (steps taken; attempts repeated by the error test + failed): the first 10 s (the ramp-up):
Picard 3.0 (1030; 14 + 4), PC-Picard 1.8 (996; 29 + 4), Newton 3.9 (958; 17 + 3, 2.0 % of the attempts; 1.7 % rejected by the error test); 40 s
(through the L–H transition and the sawteeth): Picard 10.4 (3924; 362 + 125), PC-Picard 5.9 (3426; 560 + 114), Newton 15.3 (3224; 465 + 42). Newton
takes about 3 iterations per stage, the Jacobians (12 evaluations of the physics each, 0.6 per stage) are two thirds of its cost. It is the most robust
of the three (a third of the failed attempts of Picard) and 1.3 to 1.5 times as costly as Picard; the state at a given time differs between the
solvers by the L–H and sawtooth timing that a small change of the trajectory moves (Q at 40 s 0.18 / 0.26 / 0.20 for Newton / Picard / PC), not
by the solution of a stage (at 10 s the three agree: Q = 0.391, W = 55.0 MJ).

**What the error estimate does not see.** The quantities that are updated once per accepted step and held fixed within it (C_χ and its
integral term, P_SOL and the boundary values, the fueling command, the source deposition, the inventories, the fast-ion pools) are first
order in Δt, and the error control cannot resolve them: the flat-top means of ITER15 keep a dependence on the step of a few tenths of a
per cent (Q +0.3 % from a Δt limit of 0.5 s to 10 ms, the table below), and the first 80 s of the H-mode, before the means settle, +0.6 % for
a limit of 5 ms. One consequence is a
step-to-step oscillation of the boundary values (P_SOL responds to the dW/dt of the last step, and T_sep to P_SOL) that keeps the
outermost cells at the error limit and the step near 10 ms; feeding P_SOL with the smoothed dW/dt (an open issue of the edge work) removes
it and allows steps of 20 to 80 ms between ELMs.

**Cost.** A TR-BDF2 step is two Picard solves and the evaluation of the old state, about three times the work of the backward-Euler step, and
the error control takes more steps in the H-mode (the edge is stiff over a step and ELM cycles of 0.3 s hold 20 to 30 steps): ITER15 (400 s)
takes about 40 s of CPU time at the default tolerance against 10 s with the backward-Euler step, and the golden 1.5D cases 2 to 4 times as
long. `rtol` 1e-3 adds a half, 1e-4 doubles it again; the flat-top means do not move with the tolerance beyond the noise of the ELM cycle (table).

## Convergence

`npm run bench:convergence` (ITER15, 400 s, flat-top means; `bench/convergence.ts`, Richardson error estimates of `bench/richardson.ts`), run at the end of
the Newton and current-diffusion stage. One parameter at a time, the others at their defaults (nRho 50, gridPacking 4, rtol 1e-2, dtMax 0.5 s):

| | Q | f_bs | ℓ_i(3) | T_ped [keV] | steps | ELMs | attempts rejected + failed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nRho 25 / 50 / 100 | 10.41 / 10.65 / 10.65 | 0.2333 / 0.2300 / 0.2307 | 0.7142 / 0.7391 / 0.7388 | 3.590 / 3.421 / 3.427 | 23054 / 30379 / 40503 | 1300 / 1326 / 1332 | 3998 + 10 / 4247 + 2 / 6866 + 5 |
| rtol 1e-2 / 1e-3 / 1e-4 | 10.65 / 10.68 / 10.68 | 0.2300 / 0.2309 / 0.2312 | 0.7391 / 0.7353 / 0.7353 | 3.421 / 3.439 / 3.426 | 30379 / 48485 / 56876 | 1326 / 1327 / 1327 | 4247 + 2 / 7174 + 3 / 5786 + 2 |
| dtMax 0.5 / 0.05 / 0.01 s | 10.65 / 10.66 / 10.69 | 0.2300 / 0.2307 / 0.2309 | 0.7391 / 0.7359 / 0.7361 | 3.421 / 3.433 / 3.437 | 30379 / 31028 / 50865 | 1326 / 1326 / 1331 | 4247 + 2 / 4123 + 1 / 2525 + 0 |

The targets of the stage, all met at the defaults:

- Q, f_bs, ℓ_i and T_ped change by less than 1 % between nRho 50 and 100 (0.02, 0.29, 0.04 and 0.19 %) and between the tolerances 1e-2, 1e-3 and 1e-4
  (at most 0.34, 0.51, 0.51 and 0.53 % from 1e-2 to either), and between the Δt limits 0.5 s and 0.01 s (0.35, 0.41, 0.40, 0.48 %). Between nRho 25 and 50
  the changes are 2.3, 1.4, 3.4 and 4.7 %: 25 cells are 5 across the pedestal.
- The ELM count, which followed the step of the backward-Euler stepper (1101 to 1131), varies by 0.4 % over the Δt limits (1326 / 1326 / 1331), 0.1 % over the
  tolerances and 2.4 % over the grid.
- `'cgm'` ITER15 to 10 s takes 3.1 s (Newton, the default of the predictive model), with 1.7 % of the attempts rejected by the error test (2.0 % with the
  failed ones); above.

The scatter of the flat-top means between neighbouring runs (0.1 to 0.5 %) is that of the sawtooth and ELM sequences, which the Richardson fit reads as
oscillatory convergence (the GCI of the finest runs is 1 to 15 % for these four means, the observed orders of the smooth ones 0.4 to 4): the differences
above are the statement, not the extrapolation. The means moved by the current-diffusion form between the previous stage's table and this one (Q 10.56 → 10.65,
ℓ_i 0.743 → 0.739, f_bs 0.2286 → 0.2300, T_ped 3.401 → 3.421 keV at the defaults) but not their convergence.

## Current diffusion and the plasma-current programme

**Equation** (`fvsolver.ts`, `CurrentSolver`). The poloidal flux ψ (per radian, increasing outwards) on ρ̂ = √(Φ/Φ_b) obeys the flux-averaged
parallel Ohm's law in the form of Hinton and Hazeltine (Rev. Mod. Phys. 48 (1976) 239),

    σ∥ F ⟨R⁻²⟩ ∂ψ/∂t|Φ = (F² / (μ0 V′)) ∂ρ̂( V′ g2 ∂ρ̂ψ / F ) − ⟨j_ni·B⟩,      V′ = dV/dρ̂, g2 = ⟨|∇ρ̂|²/R²⟩,

whose right-hand side is ⟨j·B⟩ − ⟨j_ni·B⟩. With B = F∇φ + ∇ψ×∇φ the current is μ0 j = ∇F×∇φ − Δ\*ψ ∇φ and j·B = −F Δ\*ψ/(μ0 R²) +
F′|∇ψ|²/(μ0 R²) (F′ = dF/dψ): the toroidal current and the poloidal current, both with the sign that the form has. It is conservative in the
flux X/F, X = V′ g2 ∂ρ̂ψ = 2π μ0 I(ρ̂) with I the enclosed current, so the equation multiplied by V′/F² is integrated over the cells and the boundary
condition is X/F = 2π μ0 I_p/F at ρ̂ = 1. Before this stage the code had (1/(μ0 V′)) ∂ρ̂(V′ F g2 ∂ρ̂ψ), which has the F′ term of the poloidal
current with the wrong sign: the two agree for a constant F and differ by 2 F′ ⟨|∇ψ|²/R²⟩/μ0 in ⟨j·B⟩. On the analytic Solov'ev equilibrium
of `geometry.test.ts` ⟨j·B⟩ = F p′ + F FF′⟨R⁻²⟩/μ0 + FF′ g2 ψ′²/(F μ0) is reproduced to 5·10⁻⁵ by the new form and missed by 1.2 % by the old
one. The moves in the flat-top numbers of the 1.5D shots are in the golden ledger.

**Skin time.** With a uniform σ in a cylinder the equation is the one of the poloidal field with the edge field held by I_p: the current relaxes with
the time constant τ_R/λ₁² = μ0 σ a²/14.68 (λ₁ = 3.832 the first zero of J1, not the 2.405 of a cylinder whose wall current density is held), and
after a step of I_p the enclosed current is I(x, t)/I_p = x² − Σ a_n x J1(λ_n x) e^{−λ_n² t/τ_R} with a_n = 2/(λ_n J2(λ_n)).
`currentDiffusion.test.ts` steps the solver with TR-BDF2 and finds the series to 2·10⁻³ of I_p at 0.02, 0.1 and 0.5 τ_R, the relaxation
time to 2 %, and second-order convergence in Δt.

**The plasma current as the boundary condition** (`control/plasmaCurrent.ts`). I_p enters the stages at their ends: I_p(t + γΔt) in the first stage
of a TR-BDF2 step, I_p(t + Δt) in the second, I_p(t) of the old state in the explicit rate; the state scalar `Ip` holds the value at the end of the last
accepted step. It comes from one of two sources (`ProfileContext.ipAt`):

- **the control `Ip_MA`** [MA], one of the keys of `getControls()` (`ProfileContext.ctrl`): `Simulation.applyControl({ Ip_MA })`, the set-points restored by a
  rewind, the replay of the actuator log and the waveforms and triggers of the scenario engine (which validates its control keys against `getControls()`;
  `rampTemplate('Ip_MA', …)` works as it is) all reach it. Its initial value is the configured `MagneticConfig.Ip_MA`; a value below 0.05 MA is 0.05 MA,
  one that is not a number is the configured current. The kernel changes a control at step boundaries, so the value holds over the whole next step, both
  stages: a ramp is a staircase of the model's steps (the scenario's `rampStep` refines it), and a step change of I_p is a jump of the boundary current that
  the current diffusion follows at the skin time (`currentDiffusion.test.ts`: the boundary current is the new value at every later step, the inner
  surfaces lag). Without a change the model is bit for bit the constant-I_p one;
- **a programme**, a function of t alone (so a chunked run, a rewind and a replay see the same values), which takes the control's place (the run then has
  no `Ip_MA` among its controls: a scenario that names it is refused, a live patch of it is ignored) and is evaluated at the stage times themselves,
  so a smooth ramp is second order. It is given
  - as data: `ProfileSettings.IpWaveform`, points [t (s), I_p (MA)] in increasing time, linearly interpolated, constant beyond the ends, at least
    0.05 MA (`currentWaveform`); it is part of the configuration and so of the run fingerprint;
  - as a function: `ProfileModules.plasmaCurrent(t) → A` (`new ProfileModel(cfg, { plasmaCurrent })`), which takes precedence over the waveform and is
    not part of the fingerprint (the caller owns its determinism).

`MagneticConfig.Ip_MA` is what the initial equilibrium is solved for and should equal the current at t = 0; the Grad–Shafranov updates use the I_p of the
state; the current quench of a disruption overrides the current. Not done: the equilibrium coupling updates by the interval, β_p and ℓ_i, not by a
change of I_p (β_p ∝ I_p⁻² follows a large change, a small fast ramp does not trigger it), so a ramp runs on a geometry that is up to an update
interval old (a request to the coupling lane: an update when |ΔI_p|/I_p exceeds 10 %); the setup wizard does not offer the waveform, and the run
controls give `Ip_MA` the automatic slider range of an unknown key (a `CONTROL_DEFS` entry is the UI lane's).

**The moving coordinate.** The grid is ρ̂ = √(Φ/Φ_b): if the toroidal flux Φ_b through the boundary changes, a flux surface (Φ fixed) moves
in ρ̂ with dρ̂/dt = −ρ̂ Φ̇_b/(2Φ_b), the equation above holds at fixed Φ and at fixed ρ̂ ∂ψ/∂t|ρ̂ = ∂ψ/∂t|Φ + (ρ̂ Φ̇_b/(2Φ_b)) ∂ρ̂ψ.
`CurrentInputs.PhiBdotRel` (Φ̇_b/Φ_b) adds that term, implicitly, in `solve` and in `rate` (the gradient at a cell centre is the mean of the
two face gradients, the outer one the boundary value); with a flux frozen into the plasma (σ → ∞) the solution follows ψ0(ρ̂ e^{εt/2}) as it must
(`currentDiffusion.test.ts`). **The model passes 0.** Φ_b changes only with the shape and the toroidal field, which the fixed-boundary model does
not change; the successive equilibria differ in Φ_b by 10⁻⁴ to 10⁻³, of either sign from one update to the next (ITER15 100 s: ±5·10⁻⁴; JET15:
up to ±1.2·10⁻³ with the V′ of a face changing by 0.5 to 1.7 %), which is the accuracy of the Grad–Shafranov solver and not a rate: taking (Φ_b,new −
Φ_b,old)/Δt_update for Φ̇_b would feed noise into the current diffusion at the level of 10⁻³ of ψ per second. A free-boundary or shape-programme
coupling supplies the rate. The V′ of the conservative form is not inside the time derivative of ψ (as it is in the heat and particle equations,
whose contents n V′ change with V′), so the current equation has no V̇′ term; those of the heat and particle equations are not implemented: the
geometry is piecewise constant between adoptions, a jump at an adoption (V′ of a face by up to 1.7 %, the total volume fixed) would be a conservative
remap of the contents, which the coupling lane's interpolation of the geometry in time would replace.

## Definitions shared with the 0D model

The 1.5D model uses the same definitions as `confinement/magnetic.ts` (ws2b), so that the two agree
on a shot they can both run (`lossPower.test.ts`, `ignition.test.ts`, `fastIons.test.ts`, `sources/fusion.test.ts`):

- **Fusion**: thermal rate of a channel `pairDensity × ⟨σv⟩(T_i)` (½ n_D² for a D-D channel with n_D = n_a + n_b
  whatever `fuelFracA`), beam-target rate `n_f × beamTargetDensity × ⟨σv⟩_bt` per channel (the beam burns on every
  channel of the fuel, D-³He's D-D side channels included), fuel burn-up `burnPerReaction` and ash `FuelChannel.ash`
  per channel, heating by every charged product (α, p, T, ³He at their birth energies) on its own Stix critical
  energy. Heating stays instantaneous and local.
- **Loss power** P_L = P_heat − P_rad,core − dW/dt for the τ_E scaling and the L–H test. P_rad,core is bremsstrahlung
  and line radiation from ρ < `RHO_CORE` (0.6; a cell that straddles it counts by its share) plus all the
  synchrotron radiation. dW/dt (`ctx.dWdtS`) is the rate of change of W including the energy the ELM crashes take
  out (`ctx.crashE`, booked by `ElmEvents`), low-pass filtered with τ_E (5 ms at least): it vanishes in a steady
  H-mode, where the continuous dW/dt between the crashes is +P_ELM. Floors: 10 % of P_heat and 0.5 MW per 100 m³.
- **L–H threshold**: `pLH_threshold` (Martin 2008 with the Ryter 2014 low-density branch) at the line-averaged density.
- **Ignition**: P_α ≥ P_rad + W/τ_E (P_α the charged fusion products only, W/τ_E = `P_cond`), without a condition on Q,
  hysteresis 0.9; the state `ctx.ignited` is the `ignited` diagnostic and what the report's ignition time follows.
  It ends at the onset of a disruption (the quench frames are not ignited). With `heating.autoOff` the external
  heating ramps down over `heating.rampTime` once Q ≥ 5 (`ctx.tAuxOff`, `events/burn.ts`).
- **Fast-ion pressure**: the energy content of the NBI ions and of the charged fusion products is a pool per species
  (`ctx.WfBeam`, `ctx.WfAlpha`, `fastIons.ts`) that obeys the 0D equation dW/dt = P − W/τ_W: it builds up with the
  time constant τ_W = τ_se (1 − G)/2 of the Stix loss law (at least 1 ms) and decays after the source stops, so it
  never exceeds the injected energy (W' − W ≤ P Δt). Each accepted step advances it with the exact solution for
  constant P and τ_W (W' = W_ss + (W − W_ss) e^{−Δt/τ_W}). The steady content W_ss = P τ_W per cell (`w.Wbeam`,
  `w.Walpha`) and the time constant per cell (`w.tauWb`, `w.tauWa`; independent of the source power, so the pool also
  decays after the beam is off or the burn stops) are computed by the sources; the pool's τ_W is W_ss/P, or the volume
  mean while the source is off. The pools are part of the checkpoint and end at the onset of a disruption. β_T and
  β_N use the total pressure; `betaN_th` (thermal) seeds the NTMs and β_p (the equilibrium's pressure table) stays
  thermal. The diagnostics `W_alpha`, `W_beam`, `Wf`, `P_beam_heat`, `P_rad_core` and `dWdt_s` show the parts. A
  content that jumped to W_ss at once was 4.6 times the injected energy in a JET15 shot with a 500 keV beam and ended
  it in a spurious Troyon-limit disruption.

## Plug-in interfaces

`new ProfileModel(cfg, { transport?, sources?, events? })` replaces the transport model or the
source list, or adds event models (tests, experiments). `Simulation` builds the defaults; a module
that should run in every shot is registered as below.

**SourceModel** (`sources/SourceModel.ts`), registered in `defaultSources()` (`sources/index.ts`).
All hooks are optional:

- `prepare(ctx, t, st, K)`: on the old state, once per attempt; deposition that is held fixed over
  the step, fields of `K` (`StepConstants`). `K.btR` is one array per channel of the fuel
  (`FUEL_CHANNELS` order), `K.btR[j][i]` for channel j and cell i, filled with zeros by the pipeline
  before `prepare`: a source that reads it as a single array (`K.btR[i]`, the layout of v3) gets
  `undefined` and NaN power;
- `particles(ctx, t, dt, st, K)`: once per attempt, after the fueling control assigned `w.Sn`; add
  the source's particle source density [m⁻³ s⁻¹] into `w.Sn` (the density solve uses the sum; the
  fueling feedback on n̄ closes the electron balance, but a source that changes the fuel mix or
  the impurity inventory accounts for that itself);
- `heat(ctx, st, K)`: every Picard iteration of both stages on the iterate (its composition is current), and once on
  the old state (its rate);
- `current(ctx, st, K)`: the same; add driven current into `ctx.w.jcdB`;
- `accepted(ctx, t, dt, yOld, y)`: once after each accepted step of the normal phase (also a
  forced one; not during the quench phases): the place to evolve state;
- `geometryChanged(ctx, tg)`: rebuild caches that depend on the transport geometry.

`prepare`, `particles`, `heat` and `current` are evaluations, not events. A repeated step (rejected by the error
control, failed, or shortened to end at an event) runs `prepare` and `particles` again, `heat` and `current` run once per Picard
iteration of each stage and once on the old state (at least five times per attempt), and `prepare`
(with the other work-array evaluations) also runs for a state no step produced (first frame, after
an equilibrium swap, after an MHD crash). Write them as functions of (state, t, the source's own
state) that leave that state unchanged. A population that evolves from step to step is integrated
in `accepted` and saved and restored through `Checkpointable`.

The heat equation takes its sources from the fixed list of work arrays in `assembleHeatSources`
(the summation order is part of the bitwise results): add the new arrays there.

**TransportModel** (`transport/TransportModel.ts`), registered in `TRANSPORT_MODELS`
(`transport/index.ts`) under a `ProfileSettings.transportModel` id (the union in `types.ts`, owned
by the kernel lane, needs the id appended). `diffusivities(ctx, st, chiE, chiI)` writes the
anomalous χ on the N + 1 faces; barrier, particle transport, islands and floors are added by
`coefficients.ts`. It is an evaluation like `heat` (once per Picard iteration and per state
evaluation: idempotent). `predictive: true` leaves confinement to the model (τ_E = W/P_loss,
C_χ = 1); `false` puts the amplitude under the C_χ controller that tracks the τ_E scaling. Optional
`accepted(ctx, t, dt, yOld, y)` (runs before the sources' hooks) and `geometryChanged(ctx, tg)`
work as for sources.

**EventModel** (`events/EventModel.ts`), added in `defaultEvents()` (`events/index.ts`) before the
disruption check: `afterStep(ctx, t, st, d, ev)` after every accepted step of the normal phase,
with the diagnostics `d` of that step. A model that changes `y` sets `ctx.diagStale = true` (the
next frame re-evaluates the diagnostics) and may cap `ctx.dt`; it conserves what it claims to
conserve (the sawtooth crash conserves particles and electron and ion energy exactly). A model that
takes energy out of the thermal plasma between two steps (an ELM crash, a pellet) adds it to
`ctx.crashE` [J], so that the dW/dt of the loss power counts it as a loss of energy and not as a
fall in confinement (`acceptStep` takes it off at the next accepted step). It proposes a small step after the crash
(`ctx.dt = Math.min(ctx.dt, CRASH_RESTART_DT)`): the error control grows it from there.

An event that fires when a threshold on the profiles is crossed provides an `EventTrigger` (`trigger` on the model): `margin(ctx, st,
scratch)`, positive beyond the threshold and computed from the profiles only (no work arrays, no state of the model: the stepper
calls it on the old and the new state of a step and on the interpolation between them), and `readyAt(ctx)`, the end of the model's
refractory period. The stepper then ends a step at the crossing ("Time stepping"); `afterStep` keeps its own test on the
diagnostics of the step that ends there, and the two must agree (the margin is `α_ped/α_crit − 1` for the ELM, and the ELM's `readyAt`
is aimed 2 % beyond the recovery time so that `afterStep`'s strict test passes).

**Checkpointable** (`checkpoint.ts`): every module with state beyond `y` implements `save(rec, aux)`
and `restore(rec, aux)` (the context part also carries the last diagnostics and, in the quench
phases, the profiles). Numbers go into `rec` under keys unique over all modules (they are
stored in the history frames, so existing key names never change); references and strings go
into `aux`. `restore` must accept a record without `aux` (from elsewhere) and missing keys
(`recNum` defaults). `CheckpointStore.save` enforces what can be checked: a key written by two parts
(or the reserved `ck`), a non-numeric record value and an `aux` key written twice throw a
`CheckpointContractError` naming the parts. A plug-in prefixes its record keys with its own id
(`myModel_…`); what a part puts into `aux` is a copy or immutable (`ElmEvents` copies its ELM
times), or the checkpoint changes when the part goes on. Event models, sources and the transport
model take part as soon as they implement the hooks; other parts are listed in
`ProfileModel.checkpointParts`.

## Rules

- **State vector**: histories and rewinds index `y` by position. Append to `SCALAR_NAMES` only
  when a quantity must be integrated with the step; it changes `nState` and every 1.5D golden file.
- **Work arrays**: add names to `CELL_ARRAYS` / `FACE_ARRAYS` in `work.ts`; avoid allocating
  inside the Picard loop.
- **Geometry**: anything derived from the transport geometry is rebuilt through `ctx.onGeometry`
  or `geometryChanged`; an equilibrium swap mid-shot is followed by `evaluateWorkArrays`. Every geometry is
  built with `ctx.grid` (`geometryFromEquilibrium(eq, N, geomB, ctx.grid)`), and a difference or a cell lookup
  over ρ uses the grid arrays (`distF`, `dRhoC`, `spanC`, `cellIndex`, …), not `dRho`.
- **Determinism**: randomness only through `ctx.rng` (checkpointed); no wall clock, no iteration
  over unordered containers in the physics; fixed evaluation and summation order.
- **Diagnostics**: new keys go through `writeDiagnostics` (and `stateDiagnostics` for frames no step
  produced); add a `DiagSpec` to `PROFILE_DIAGS` only for traces the UI and figures should show.
  The golden files record every key of every frame: a new key or a moved number needs
  `npm run golden:update -- --reason "…"`.
- **Units**: T in keV, n in m⁻³, power densities in W m⁻³ (heat-equation sources in
  keV m⁻³ s⁻¹), ψ in Wb/rad increasing outwards, fluxes through a surface in 1/s or keV/s,
  outwards positive.

## Known limitations

- `ProfileModules.events` only adds event models (before the disruption check); the standard ones,
  in particular `ELM` (its statistics go into the report) and `sawtooth`, are replaced by
  editing `defaultEvents()`. Sources and the transport model can be replaced.
- The `accepted` hooks and the checkpoints of sources and the transport model run in the normal
  phase; during the quench phases of a disruption profiles are scaled, not transported.
- Grad–Shafranov updates are quasi-static: a table-mode solve whose current table had to be
  rescaled by more than `CURRENT_SCALE_LIMIT` (0.5) to meet I_p is rejected like a solve that does
  not converge (the geometry the table was mapped through is stale). MASTU15 (hollow current at
  β_p ≈ 1.8) still holds back part of its updates (4 accepted, 3 rejected: the geometry stays near
  the start-up equilibrium for much of the shot), and so do fast transients such as the JET15
  L–H transition (one of 15 attempts rejected). A converged answer needs a table consistent with
  the new geometry, i.e. an outer iteration between the transport tables and the solver.
- The transport-geometry cell volumes are ∫V' dρ̂ over each cell, scaled once to the volume of the equilibrium. The tables
  sit at ψ_N = (k/50)², so the last interval before the separatrix is wide in ρ̂ (ITER15 0.955 → 1, MASTU15 0.886 → 1) and
  the ρ̂ of the outer nodes, a cumulative integral of q that diverges at the X-point, is too small on such a coarse
  table (ITER15 5e-4, MASTU15 1.2e-2 at ψ_N = 0.96, against 8 times the surfaces). That is a property of the tables
  (`equilibrium/gs.ts`), not of the geometry: the metrics of the outer cells of a spherical tokamak sit at a ρ̂ that is
  up to 1 % of the minor radius off. A finer table (`nSurf`) moves ρ̂ and the cell volumes by less than 0.1 % (ITER15).
- The charged fusion products and the NBI ions heat instantaneously and locally (the 0D model delays the heating with
  the same pools); only their pressure follows the pool dynamics above, with no fast-ion transport or loss. The pool
  is scalar: its τ_W is the source-weighted mean over the cells, not a profile.
- `'cgm'` is uncalibrated; its outermost face uses the gradient between the last two cells, not
  the one to the separatrix value. The ITER15 ramp-up takes about 3 to 4 s per 10 s of discharge (JET-size machines are
  slower: the steps are shorter). Its stages are solved by Newton, which is about 1.3 to 1.5 times the cost of Picard with Anderson
  mixing: the Jacobian is 12 evaluations of the whole physics, and reusing it from step to step would need it in the checkpoint.
- P_SOL (two-point T_sep) follows the lagged global balance P_heat − P_rad − dW/dt, not P_bound, on
  purpose: the instantaneous flux would couple T_sep and the edge gradient step by step. The raw dW/dt of the last step still
  makes P_SOL and T_sep oscillate from step to step at Δt above about 15 ms (the outermost cells then hold the step near
  10 ms in the ITER15 H-mode); the smoothed dW/dt (`ctx.dWdtS`) would not (an open issue of the edge work).
- The step is second order in the transport equations only. The quantities that are updated once per accepted step (C_χ, P_SOL and the
  boundary values, the fueling command, the source deposition, the inventories) are first order, and the flat-top numbers of the
  ELM H-mode keep a dependence on Δt that the tolerance does not remove ("Time stepping").
- The L–H transition, the NTM onset and the burn/ignition events are localised to the step, not inside it; only the ELM and
  the sawtooth crash end a step at the crossing.

## Tests

| File | Covers |
| --- | --- |
| `solver/trbdf2.test.ts`, `solver/localise.test.ts` | TR-BDF2 constants, second order, L-stability and the embedded error estimate on scalar problems; the controller; the dense output and the crossing of an event margin |
| `fvsolver.test.ts` | the solvers' right-hand sides against their solutions, the reference state and explicit rate of a stage, the error-estimate filter, the Pereverzev–Corrigan term (a fixed point stays fixed; the frozen-χ iteration on a steep χ cycles and the stabilised one converges) |
| `../numerics/blockTridiagN.test.ts`, `../numerics/newton.test.ts` | the block-tridiagonal solver for block sizes 1 to 5 against dense LU (pivoting inside blocks, several right-hand sides, singular blocks), the coloured Jacobian against the column-by-column one and a linear map, the damped Newton iteration (quadratic convergence, the chord variant, the line search, the bounds, a Jacobian passed in, the failure reasons) |
| `solver/newtonStage.test.ts` | the residual of a stage is a function of the state alone, its coloured Jacobian is the Jacobian, its root is the Picard fixed point, quadratic convergence on a smooth stage, the choice of the solver, the fallback (a shot with every Newton solve failing is the PC-Picard shot bit for bit), chunk invariance and exact rewind of a Newton shot |
| `currentDiffusion.test.ts` | the skin-time response of a uniform cylinder to a step of I_p against the Bessel series and its second order in Δt, the Φ̇_b term (a frozen flux is carried with the moving grid), the Hinton–Hazeltine form with a non-constant F, the plasma-current programme (waveform, a shot whose boundary current follows it) and the control `Ip_MA` (a change at a step boundary, the log replay, the rewind, no control when a programme drives the current) |
| `solver/coupledStep.test.ts` | the TR-BDF2 step on whole shots: error control against a tight reference, `dtMax`, rejections and their counters, the energy identity, ELM counts against the step limit, the checkpoint of the counters |
| `modules.test.ts` | state layout, work arrays, module wiring, checkpoint keys, the three plug-in interfaces (hooks and their call counts, particle source, state over accepted steps and rewinds) |
| `events/events.test.ts` | every event model through `afterStep`, with checkpoints |
| `energy.test.ts` | convection vs an analytic steady state, exact energy identity of a heat step, full-model energy balance (ITER15) |
| `geometry.test.ts` | transport geometry of an analytic Solov'ev equilibrium, including ⟨j·B⟩ of the current solver against the analytic one (5·10⁻⁵ against 1.2 % for the form with F inside the derivative); cell volumes on real Grad–Shafranov tables (ITER15, MASTU15) |
| `sources/sources.test.ts` | NBI chord cache vs direct deposition, beam-target table vs the integral |
| `sources/fusion.test.ts` | reaction rates, burn-up, ash, beam-target rates and charged-product heating per channel against independent evaluations, for every fuel |
| `lossPower.test.ts` | core radiation, the loss power P_L, the scaling-mode τ_E and C_χ target at P_L (exact, every step), the smoothed dW/dt with the ELM losses (with a replay from an ELM frame), the L–H threshold with the low-density branch, one stored energy |
| `ignition.test.ts` | ignition and the ignition test (`heating.autoOff`) on an ITER15 shot, with replays from before and inside the ramp |
| `fastIons.test.ts` | fast-ion pressure in β, β_N,th, the steady content per cell; the pools: exact relaxation, W ≤ ∫P dt after every step, JET15 with 300 and 500 keV beams to their scheduled end, decay after the beam is off, replay from a start-up frame, disruption |
| `checkpoint.test.ts` | the checkpoint contract: key collisions, numeric records, restore from a record with missing keys |
| `transport/transport.test.ts` | 'cgm' smoke test (ITER15 ramp-up; runs through `runAllYielding`) |
| `integrity.test.ts` | equilibrium swaps (fresh work arrays), GS failures, the current-scale gate and retry timing, step failures (numerical failures retried, programming errors propagate with the state put back, also from the update after the accepted step), reported τ_E, initial equilibrium, replays from quench frames |
| `grid.test.ts` | the radial grid: the uniform path double for double, the packed grid (cells across the pedestal, smoothness, one map for every N), lookups; diffusion operator with a manufactured solution (observed order 2.0 on the packed grid), conservation of energy, particles and enclosed current, `alphaMHD` with the separatrix face; pins of two uniform-grid shots |
| `profiles.test.ts` | solver verification (analytic), neoclassical, MHD helpers, integration runs |

Tests that run for more than a few seconds of wall time use `runAllYielding` (`src/testing/yielding.ts`): it advances in
the chunks of `runAll`, bit-identically, and returns to the event loop after each, so that the Vitest worker can answer the runner
(a long synchronous run makes coverage runs end with "Timeout calling onTaskUpdate" although every test passed).

A change meant to preserve behaviour should leave `npm run golden` passing; a refactor can be
checked bit for bit by hashing whole histories before and after (every frame's `y`, diagnostics,
profiles, checkpoint record, and the events).
