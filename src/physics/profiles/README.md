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
| `geometry1d.ts` | transport geometry on ρ̂ = √(Φ/Φ_b) from equilibrium tables (`EquilibriumTables`) |
| `fvsolver.ts` | implicit finite-volume solvers (heat, density, current), `boundaryLoss` (P_bound) |
| `composition.ts` | quasi-neutral composition; He ash, impurity and fuel-mix inventories |
| `qprofile.ts` | ψ → ψ′, q, enclosed current, ⟨j·B⟩; q95 |
| `boundary/sol.ts` | separatrix values (two-point T_sep, n_sep), lagged P_SOL |
| `sources/` | `SourceModel` plug-ins: `nbi`, `rf`, `fusion`, `radiation`, `exchange`; `current.ts` (σ_neo, bootstrap, ohmic); `deposition.ts` (profiles, NBI chord). `fusion` evaluates every channel of the fuel with the helpers the 0D model uses (`pairDensity`, `burnPerReaction`, the products of `FUEL_CHANNELS`) |
| `transport/` | `TransportModel` plug-ins: `scaling`, `cgm`; `coefficients.ts` adds barrier (`pedestal.ts`), D and pinch, NTM islands, neoclassical floor |
| `control/` | heating (with the ignition-test ramp-down) and density programmes, fueling feedback, loss power P_L, τ_E scaling and the C_χ controller |
| `solver/` | `pipeline.ts` (evaluation order), `coupledStep.ts` (Picard step, Δt control, failures), `acceptStep.ts` (update after an accepted step) |
| `coupling/equilibrium.ts` | Grad–Shafranov coupling: initial solve (guarded, `eqguard.ts`), update policy, the update as a self-consistent solve (`coupling/outer.ts`: outer iteration of the tables on the equilibrium's own surfaces; `coupling/tables.ts`: node and table helpers) |
| `events/` | `EventModel` plug-ins: `LH`, `ELM`, `sawtooth`, `NTM`, `burn`, `warnings`, `disruption` |
| `diagnostics.ts` | time traces (`PROFILE_DIAGS` are the ones the UI shows), profiles, power totals |
| `checkpoint.ts` | `Checkpointable` and the checkpoint store (rewind) |

## One step

`CoupledStepper.step` (normal phase) takes an implicit step from `yOld` to `y`:

1. once per attempt, on the old state: composition → q profile → boundary values → step constants
   (`heatingPowers`, then every source's `prepare`, then the neoclassical closure) → fueling
   source (`w.Sn`) → every source's `particles`;
2. Picard iterations (≤ 8) on the iterate: transport coefficients (χ relaxed by ½) → density solve →
   composition → every source's `heat` → q profile → current sources (σ, bootstrap, every source's
   `current`, ohmic) → `assembleHeatSources` → heat solve (T_e, T_i together) → current solve;
3. P_bound from the last heat solve, final composition and q profile.

A failed attempt (Picard not converged, a change above 35 %, a non-finite state, or a `NumericalFailure`
or `GSFailure` thrown by a module) is retried with Δt × 0.4 (and runs the per-attempt parts of 1.
again); after 12 attempts one forced attempt is accepted if finite, otherwise the shot ends with a
`StepFailure`. Any other exception thrown inside a step (a `TypeError` of a plug-in, a violated
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

Energy bookkeeping: over an accepted step `dWdt = P_heat − P_rad − P_bound` to the Picard tolerance
(`energy.test.ts`: < 1e-4 P_heat over the ITER15 flat-top). A new heating or loss channel must keep
this closure: put its power density into a work array, add it in `assembleHeatSources` and in
`powerTotals` (`diagnostics.ts`). The stored energy has one definition, `ctx.storedEnergy`
(W = Σ 3/2 (n_e T_e + n_i T_i) ΔV).

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
- `heat(ctx, st, K)`: every Picard iteration on the iterate (its composition is current);
- `current(ctx, st, K)`: every Picard iteration; add driven current into `ctx.w.jcdB`;
- `accepted(ctx, t, dt, yOld, y)`: once after each accepted step of the normal phase (also a
  forced one; not during the quench phases): the place to evolve state;
- `geometryChanged(ctx, tg)`: rebuild caches that depend on the transport geometry.

`prepare`, `particles`, `heat` and `current` are evaluations, not events. A retried step runs
`prepare` and `particles` again, `heat` and `current` run once per Picard iteration, and `prepare`
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
fall in confinement (`acceptStep` takes it off at the next accepted step).

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
  or `geometryChanged`; an equilibrium swap mid-shot is followed by `evaluateWorkArrays`.
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
- Grad–Shafranov updates are quasi-static and self-consistent: p(ρ) and ⟨j_φ/R⟩(ρ) are handed to the solver on nodes ρ_j = j/N
  mapped to ψ_N through the equilibrium, and the nodes are moved until the new equilibrium's ρ_tor(ψ_N) agrees with them
  (rms Δρ below `OUTER_TOL` = 2e-3 over ρ ≥ 2 grid spacings; ω under-relaxed, at most `OUTER_MAX` iterations). A table mapped
  through the previous equilibrium instead (stale) integrates to something other than I_p on the new surfaces and, after a
  fast change, has no converged solution (JET15 lost one update in 15, MASTU15 three in seven). Each solve is a continuation
  from the previous equilibrium's own tables, halved on failure. Where the whole way cannot be solved (a fold of the
  fixed-boundary problem near the transport's pressure and current), at least 75 % of it is used and the update is reported
  once as limited (`fraction`); with less, or if the current table still needs rescaling by more than `CURRENT_SCALE_LIMIT`
  (0.5) at consistent surfaces, or the outer iteration stops above `OUTER_ACCEPT` (5e-3), it is rejected, counted, warned
  about and retried with a back-off. The core inside two grid spacings carries a flat current table: ⟨j_φ/R⟩ = 2π dI/dV of the
  innermost cells dips there and the surfaces are below what the grid resolves. The 1.5D golden cases accept all of their updates.
- The transport-geometry cell volumes are ∫V' dρ̂ over each cell, scaled once to the volume of the equilibrium. The
  equilibrium's output table has 101 nodes clustered at the edge (`surfaceLevels` in `equilibrium/gs.ts`: q, ⟨|∇ψ|²⟩ and dV/dψ_N
  follow a boundary layer of about 1e-3 in ψ_N at the LCFS): the g1, g2, V', ∇ρ, q and ΔV of the outer faces and cells are within 0.1 % of
  a table of 401 surfaces (with the old ψ_N = (k/50)² table ITER15 was 1.2 % and MASTU15 14.7 % off, and ρ̂ of the outer nodes
  too small by 5e-4 and 1.2e-2 at ψ_N = 0.96).
- The charged fusion products and the NBI ions heat instantaneously and locally (the 0D model delays the heating with
  the same pools); only their pressure follows the pool dynamics above, with no fast-ion transport or loss. The pool
  is scalar: its τ_W is the source-weighted mean over the cells, not a profile.
- `'cgm'` is uncalibrated; its outermost face uses the gradient between the last two cells, not
  the one to the separatrix value, and it is slow on JET-size machines.
- P_SOL (two-point T_sep) follows the lagged global balance P_heat − P_rad − dW/dt, not P_bound, on
  purpose: the instantaneous flux would couple T_sep and the edge gradient step by step.

## Tests

| File | Covers |
| --- | --- |
| `modules.test.ts` | state layout, work arrays, module wiring, checkpoint keys, the three plug-in interfaces (hooks and their call counts, particle source, state over accepted steps and rewinds) |
| `events/events.test.ts` | every event model through `afterStep`, with checkpoints |
| `energy.test.ts` | convection vs an analytic steady state, exact energy identity of a heat step, full-model energy balance (ITER15) |
| `geometry.test.ts` | transport geometry of an analytic Solov'ev equilibrium; cell volumes on real Grad–Shafranov tables (ITER15, MASTU15) |
| `sources/sources.test.ts` | NBI chord cache vs direct deposition, beam-target table vs the integral |
| `sources/fusion.test.ts` | reaction rates, burn-up, ash, beam-target rates and charged-product heating per channel against independent evaluations, for every fuel |
| `lossPower.test.ts` | core radiation, the loss power P_L, the scaling-mode τ_E and C_χ target at P_L (exact, every step), the smoothed dW/dt with the ELM losses (with a replay from an ELM frame), the L–H threshold with the low-density branch, one stored energy |
| `ignition.test.ts` | ignition and the ignition test (`heating.autoOff`) on an ITER15 shot, with replays from before and inside the ramp |
| `fastIons.test.ts` | fast-ion pressure in β, β_N,th, the steady content per cell; the pools: exact relaxation, W ≤ ∫P dt after every step, JET15 with 300 and 500 keV beams to their scheduled end, decay after the beam is off, replay from a start-up frame, disruption |
| `checkpoint.test.ts` | the checkpoint contract: key collisions, numeric records, restore from a record with missing keys |
| `transport/transport.test.ts` | 'cgm' smoke test (ITER15 ramp-up; runs through `runAllYielding`) |
| `integrity.test.ts` | equilibrium swaps (fresh work arrays), GS failures, the current-scale gate and retry timing, step failures (numerical failures retried, programming errors propagate with the state put back, also from the update after the accepted step), reported τ_E, initial equilibrium, replays from quench frames |
| `profiles.test.ts` | solver verification (analytic), neoclassical, MHD helpers, integration runs |

Tests that run for more than a few seconds of wall time use `runAllYielding` (`src/testing/yielding.ts`): it advances in
the chunks of `runAll`, bit-identically, and returns to the event loop after each, so that the Vitest worker can answer the runner
(a long synchronous run makes coverage runs end with "Timeout calling onTaskUpdate" although every test passed).

A change meant to preserve behaviour should leave `npm run golden` passing; a refactor can be
checked bit for bit by hashing whole histories before and after (every frame's `y`, diagnostics,
profiles, checkpoint record, and the events).
