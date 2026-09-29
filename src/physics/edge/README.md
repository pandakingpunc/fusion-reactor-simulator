# Edge physics: scrape-off layer, divertor and detachment

`src/physics/edge/` is one set of pure functions (SI, temperatures in eV, no state, no DOM or Node API) behind
three users: the 0D magnetic model (diagnostics and report), the 1.5D boundary (`profiles/boundary`, the
separatrix temperature and the diagnostics) and POPCON (opt-in maps). All entry points build an
`EdgePlasma` and call `solveEdge(plasma, params)`.

## The model

The peak flux tube of the outer divertor leg, from the outer midplane `u` to the target `t`:

```
u --conduction--> x (divertor entrance) --conduction--> cc --recycling layer--> t
```

| Quantity | Definition | Source |
|---|---|---|
| `lambda_q` | `0.63 B_pol^-1.19` mm (regression #14) | Eich et al., Nucl. Fusion 53 (2013) 093031 |
| `lambda_int` | `lambda_q + 1.64 S`, `S = 1.22 lambda_q` (b = lambda_int/lambda_q = 3) | Makowski et al., Phys. Plasmas 19 (2012) 056122; Kallenbach et al., PPCF 58 (2016) 045013 |
| `q_u` | `f_out P_sep B / (2 pi R_u lambda_q B_p)`, `f_out = 2/3` | Stangeby 2000 (two-point model); f_out: engineering.ts |
| `T_x`, `T_u` | `T^{7/2} = T_cold^{7/2} + (7/2) q L / kappa0e`, `kappa0e = 2000`, `L = pi q95 R`, leg length 0.3 L, flux density `q_u/b` in the leg | Stangeby 2000 |
| `f_mom(T_t)`, `f_cool(T_t)` | `1 - f = A (1 - exp(-T_t/w))^s` | Stangeby, PPCF 60 (2018) 044022 (fits as quoted by Zhu et al., arXiv:2206.09964, eqs. 6.1-6.4) |
| `q_t` | `gamma (1 - f_mom) n_u T_u (T_t/2m_i)^{1/2}`, `gamma = 7` | Stangeby 2000, 2018 |
| radiation | `'prescribed'`: `f_rad,div` of the leg (the configuration's `divertor.f_rad_div`); `'lengyel'`: `q_u^2 = b^2 q_cc^2 + 2 kappa0e p^2 c_z (b^2 I_1 + I_2)`, `I = int L_z sqrt(T) dT` | Lengyel, IPP 1/191 (1981); Body, Kallenbach and Eich, arXiv:2504.05486 (2025) eqs. 38-42; L_z: Mavrin, Radiat. Eff. Defects Solids 173 (2018) 388 (radiation.ts) |
| `q_det`, `p_div` | `1.3/(1 + sum f_z c_z) (P_sep/MW)/(R/m) (Pa/p_div) (5 mm/lambda_int)`, `f_N,Ne,Ar = 18, 45, 90`; `n_sep = 2.65e19 (p_div/Pa)^0.31` | Kallenbach et al., NF 55 (2015) 053026, PPCF 58 (2016) 045013, PPCF 60 (2018) 045006; in the form of Henderson et al., NME 28 (2021) 101000 and Body et al. 2025 |
| state | attached `T_t >= 10 eV`, detached `T_t < 2 eV`, partially detached between | Stangeby 2018; Moulton et al., NF 61 (2021) 046029 (rollover 1.8 +/- 0.4 eV) |

`T_t` is the largest root of `q_sheath(T_t) = (1 - f_cool) q_cc(T_t)` (the attached branch; the equation is bistable at high
recycling). With the Lengyel radiation the attached branch ends where the radiation removes all of the power (the
collapse of the target heat flux); beyond it, or if the power is all radiated, `T_t` is the floor (0.5 eV, `TtFloor`).
The power ledger of the leg (`P_rad`, `P_cool`, `P_target`, plus the inner leg `(1 - f_out) P_sep`) closes to rounding and the
radiated power is checked against the cooling integrals (`closure`, `closureLengyel`, both tested to 1e-8).
`q_peak = P_target / A_wet`, `A_wet = 2 pi R_t lambda_int f_x / sin beta` (the Eich profile peaks at `P/A_wet`).

`cz_det` is the seed concentration at which the Lengyel model has a state with `T_t = detachTt_eV` (5 eV); at high recycling
the attached branch collapses within a few percent to a factor 1.5 of it (a partially detached window a few percent wide).
`cz_det = 0` means that no seed is needed: a state with `T_t <= detachTt_eV` exists without one. That includes a run of the
`'prescribed'` radiation that is already at or below that temperature (the prescribed `f_rad_div` stands in for whatever radiates in the
divertor; the MAST-U presets are of this kind); for an attached `'prescribed'` run `cz_det` is the requirement of the unradiated
tube, that is, of a seed that does all of the divertor radiation (the prescribed fraction is not subtracted). In the `'lengyel'` mode
it is always the onset concentration of the seed. The `cz_det` channel is capped at 1 (`CZ_CAP`): a concentration of one or more is no
attainable seeding, and a channel value at the cap reads "more than 100 %".

### Report rows

* `c_z for detachment, Lengyel upper bound (%)`: the flat-top mean in percent; `0` where no seed is needed; `n/a (> 100 %)` where the model
  finds no attainable seeding in the whole flat top (the JET, SPARC, DIII-D and JT-60SA presets: the coronal cooling function is deficient
  below 100 eV, where the seed radiates most; this is not the same as 100 %); `≥ X (> 100 % in N % of the flat top)` where only part of it
  is capped: the mean of the channel, which counts a capped frame as one, is then a lower bound of the mean requirement (the ITER p-B11 case,
  whose flat top swings between detached and attached frames, is of this kind). The species of the row is the seed of the configuration (neon
  without one). The Kallenbach qualifier is not turned into a second row: `EdgeResult.cz_qdet` has the concentration at which `q_det = 1`
  (ITER preset flat top: 35 % of argon and 70 % of neon, against the 34 % of argon of the Lengyel row), but the scaling is outside its range
  at ITER-size P_sep/R and the channel `q_det` carries the information.
* **Two divertor-load rows.** `Divertor q_max (MW/m²)` is the legacy engineering estimate: the maximum over the whole shot (the start-up
  transient and the ELM peaks included) of `P_SOL (1 - f_rad_div) (2/3) / A_wet` with `lambda_int = 2.64 lambda_q` (`S = lambda_q`), the
  configured radiated fraction and no momentum or power loss factors. `Target q_peak, two-point (MW/m²)` is the flat-top mean of the
  plasma sheath load of the two-point solution: the power that reaches the plate after `f_cool` and the radiation of the leg, over the wetted
  area of the Eich/Makowski width (`S = 1.22 lambda_q` by default, so `lambda_int = 3.0 lambda_q`). They agree in order of magnitude where
  the divertor is attached at the configured `f_rad_div` (ITER 38 against 25, JET 8.8 against 7.3) and differ where the two-point solution
  detaches the target (MAST-U 1.2 against 0, ITER D-He3 12 against 0.1): the momentum and power losses of the sheath solution take the
  heat flux off the plate, which the engineering row, with its fixed radiated fraction, cannot show. The first is a maximum over the
  shot, the second a flat-top mean; neither is a design limit.

## Where it is used

* 0D: `MagneticModel.diagnostics()` adds `EDGE_DIAGS` (group "Edge"): `P_sep_R`, `lambda_q`, `T_u`, `T_t`, `q_peak`, `f_pwr`,
  `detach` (0/1/2), `cz_det` (shown up to 1), `q_det`; `P_sep = P_SOL = P_heat - P_rad`, `n_sep = nsepFrac <n_e>`. The report's engineering
  table lists the flat-top means. Stellarators (island divertor) have none. The legacy `q_div` (fixed radiated fraction, S = lambda_q) is unchanged.
* 1.5D: the same channels from `P_SOL`, the boundary density and the equilibrium (`profiles/boundary/edge.ts`).
  `ProfileSettings.edgeModel = 'twoPoint'` uses `T_u` as the boundary condition `T_sep` instead of the legacy formula of
  `boundary/sol.ts` (default `'legacy'`); `n_sep` stays fuelling-controlled: the two-point model has no recycling or pumping and
  cannot give the upstream density, which is its free parameter.
  `P_SOL` is now the ELM-inclusive balance `P_heat - P_rad - dW/dt` with the smoothed dW/dt that includes the ELM crashes
  (`ctx.dWdtS`); see the header of `sol.ts`.
* POPCON: `computePopcon(cfg, { edge: true })` adds `PsepR`, `qPeak`, `Tt` at the steady state `P_sep = W/tau_E` of each cell.

Options: `MagneticConfig.divertor.edge` (`EdgeOptions` in `types.ts`, resolved by `resolveEdgeParams`; malformed values keep the default).

## Limits (read before quoting a number)

* **Cooling function below 100 eV.** The Mavrin fits are coronal and start at 0.1 keV; `coolingRate` holds its 100 eV value below.
  Ne, C and Ar radiate mostly between 5 and 100 eV, so the Lengyel `cz_det` is an UPPER BOUND, for neon up to an order of magnitude (the ITER
  Ne requirement of the model is several times the 6 % of the SOLPS-ITER database of Lore et al., NF 62 (2022) 106017; pinned by a test). `cz_belowFit`
  is the share of the cooling integral that comes from below 100 eV. A better curve (ADAS, with or without the non-coronal enhancement) goes in
  through `EdgeParams.lengyel` (`new LengyelIntegral(fn)`, `lzFromTable`).
* The Lengyel model over-predicts SOLPS by a factor of about 4 for ITER neon (Moulton et al. 2021); the broadening `b` removes most of it (Body et al.).
* `q_det` is an ASDEX Upgrade scaling (P_sep/R below about 10 MW/m); at ITER-size P_sep/R and with `p_div` from the AUG `n_sep` relation it is an
  extrapolation.
* `T_u` is from the unradiated conduction; the connection length of the Lengyel profile differs by less than 3 % above and 15 % below the X-point for a
  radiated fraction of about 18 % (`lengyel.test.ts`), that is a few percent in `T_u`, and more at larger radiated fractions.
* `q_peak` is the plasma heat flux at the sheath, without neutrals and photons; T_i = T_e; one flux tube; no drifts; ELMs not modelled.
* `lambda_q` is the Eich H-mode regression (attached, ELM-averaged); it is 0.57 mm for ITER against the 2 mm of the SOLPS-ITER baseline.

## Tests

`scalings.test.ts` (Eich, Makowski, loss fits), `twoPoint.test.ts` ((q L)^{2/7} law, sheath), `lengyel.test.ts` (cumulative integrals against brute-force
quadrature, the flux-tube equations integrated with RK4, the T_u approximation), `detachment.test.ts`, `solve.test.ts` (structure, power closure to 1e-8 including an independent
quadrature of the radiated power, ITER unseeded and seeded in the regime of Pitts et al., NME 20 (2019) 100696 and Lore et al. 2022, robustness),
`integration.test.ts` (0D, 1.5D, POPCON, the ELM-inclusive P_SOL, the c_z row of the report).
