# Golden regression log

Append-only record of every change to the golden files in this folder. Entries are written by
`npm run golden:update -- --reason "…"`; do not edit or reorder past entries.

## 2026-09-28 12:01 UTC — v3.0.0 baseline

Node v24.19.0 · `npm run golden:update` · all cases

- Added (22): ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, ITER15, JET15, SPARC15, SPARC15-short, DEMO15, NIF, DIRECT, Z, GF, FRXL, ZAP, TAE, MIRROR, MUON

## 2026-09-28 12:45 UTC — format only (schema 1 → 2): add meta.fuel, whole-history diagnostic statistics with missing/non-finite counts, geometry, and for 1.5D the radial profiles and an equilibrium digest; no existing value changed

Node v24.19.0 · `npm run golden:update` · all cases

- Changed (22):
  - ITER: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - JET: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - SPARC: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - DIIID: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - JT60SA: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - MASTU: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - W7X: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - DEMO: schema 1 → 2; 0 keys moved; 223 keys added (history 210, geometry 12, meta 1)
  - ITER15: schema 1 → 2; 0 keys moved; 2308 keys added (profiles 1903, history 310, equilibrium 77, geometry 17, meta 1)
  - JET15: schema 1 → 2; 0 keys moved; 2308 keys added (profiles 1903, history 310, equilibrium 77, geometry 17, meta 1)
  - SPARC15: schema 1 → 2; 0 keys moved; 2308 keys added (profiles 1903, history 310, equilibrium 77, geometry 17, meta 1)
  - SPARC15-short: schema 1 → 2; 0 keys moved; 2308 keys added (profiles 1903, history 310, equilibrium 77, geometry 17, meta 1)
  - DEMO15: schema 1 → 2; 0 keys moved; 2308 keys added (profiles 1903, history 310, equilibrium 77, geometry 17, meta 1)
  - NIF: schema 1 → 2; 0 keys moved; 52 keys added (history 45, geometry 6, meta 1)
  - DIRECT: schema 1 → 2; 0 keys moved; 52 keys added (history 45, geometry 6, meta 1)
  - Z: schema 1 → 2; 0 keys moved; 62 keys added (history 55, geometry 6, meta 1)
  - GF: schema 1 → 2; 0 keys moved; 62 keys added (history 55, geometry 6, meta 1)
  - FRXL: schema 1 → 2; 0 keys moved; 62 keys added (history 55, geometry 6, meta 1)
  - ZAP: schema 1 → 2; 0 keys moved; 62 keys added (history 55, geometry 6, meta 1)
  - TAE: schema 1 → 2; 0 keys moved; 86 keys added (history 80, geometry 5, meta 1)
  - MIRROR: schema 1 → 2; 0 keys moved; 87 keys added (history 80, geometry 6, meta 1)
  - MUON: schema 1 → 2; 0 keys moved; 50 keys added (history 45, geometry 4, meta 1)

## 2026-09-28 12:48 UTC — add coverage cases for fuels and fidelities no preset uses: D-3He and p-11B in 0D (ITER, 100 s) and 1.5D (SPARC15, 3 s), 1.5D D-D tokamak (DIIID15, 3 s), 1.5D spherical tokamak (MASTU15), p-11B FRC and D-3He mirror

Node v24.19.0 · `npm run golden:update` · --only ITER-DHe3,ITER-pB11,SPARC15-DHe3,SPARC15-pB11,DIIID15,MASTU15,TAE-pB11,MIRROR-DHe3

- Added (8): ITER-DHe3, ITER-pB11, SPARC15-DHe3, SPARC15-pB11, DIIID15, MASTU15, TAE-pB11, MIRROR-DHe3

## 2026-09-28 14:05 UTC — ws2b 0D physics fixes: separate alpha/beam fast-ion pools (P_alpha = charged-product heating only, new P_beam_heat; ignition = P_alpha >= P_rad + W/tau_E without the Q>=5 guard; fast-particle pressure in beta_T/beta_N, NTM seeding on thermal beta_N); D-D with fuelFracA<1 and D-3He D-D side channels (0D, pulsed, POPCON; 1.5D picks up the D-3He channels); ICF burn with the selected fuel (H_B, energy and neutrons per reaction, ignition scale) and Q_eng = G eta_driver eta_th; tandem-mirror Pastukhov plug factor; heating.autoOff; Greenwald, Martin L-H (plus Ryter low-density branch) and tau_E scalings at the line-averaged density; P_L = P_heat - P_rad,core(rho<0.6) - smoothed dW/dt for tau_E and L-H; ELM-averaged power 0.3 W/tau_E instead of 0.3 P_heat; sawtooth crashes conserve W and particles; blanket multiplication on the neutron share only; e-i equilibration over all ions with computed lnLambda; Sauter q95 for spherical tokamaks; explicit H_ISS04; T_max and score exclude the start-up; MagLIF stagnation 2 ns; FRC/mirror W = 3/2 (n_e + n_i) T V. Shared report changes (T_max window, blanket economics) also move the 1.5D cases.

Node v24.19.0 · `npm run golden:update` · all cases

- Changed (24):
  - ITER: 336 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11); 3 keys removed (events 3) — events.ELM, events.LH, events.burn_start, events.sawtooth, events.warning, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, … (+327 more)
  - JET: 304 keys moved; max rel. diff 9.74e-1; 66 keys added (history 55, flatTop 11) — events.ELM, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, flatTop.P_heat, … (+292 more)
  - SPARC: 310 keys moved; max rel. diff 7.12e-1; 66 keys added (history 55, flatTop 11); 1 key removed (events 1) — events.ELM, events.burn_start, events.sawtooth, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, … (+299 more)
  - DIIID: 302 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11) — events.ELM, events.sawtooth, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, … (+290 more)
  - JT60SA: 313 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11) — events.ELM, events.sawtooth, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, … (+301 more)
  - MASTU: 306 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11) — events.ELM, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, flatTop.P_heat, … (+294 more)
  - W7X: 257 keys moved; max rel. diff 7.35e-1; 66 keys added (history 55, flatTop 11) — flatTop.Efus_MJ, flatTop.Nn, flatTop.P_alpha, flatTop.P_brems, flatTop.P_charged, flatTop.P_cond, flatTop.P_fus, flatTop.P_heat, flatTop.P_line, flatTop.P_neutron, flatTop.P_rad, flatTop.P_sync, … (+245 more)
  - DEMO: 336 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11); 2 keys removed (events 2) — events.ELM, events.burn_start, events.sawtooth, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, … (+326 more)
  - ITER15: 12 keys moved; max rel. diff 5.64e-1 — scalars.Q_eng, scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.engineering.Gross P_electric (MW), scalars.engineering.LCOE ($/MWh), scalars.engineering.Net P_electric (MW), scalars.engineering.P_thermal (MW), scalars.score, scalars.scoreBreakdown[2].value, scalars.scoreBreakdown[4].value
  - JET15: 11 keys moved; max rel. diff 6.97e-1 — scalars.Q_eng, scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.engineering.Gross P_electric (MW), scalars.engineering.P_thermal (MW), scalars.score, scalars.scoreBreakdown[0].value, scalars.scoreBreakdown[2].value, scalars.scoreBreakdown[4].value
  - SPARC15: 13 keys moved; max rel. diff 6.15e-1 — scalars.Q_eng, scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.engineering.EROI, scalars.engineering.Gross P_electric (MW), scalars.engineering.Net P_electric (MW), scalars.engineering.P_thermal (MW), scalars.score, scalars.scoreBreakdown[0].value, scalars.scoreBreakdown[2].value, … (+1 more)
  - SPARC15-short: 5 keys moved; max rel. diff 3.67e-1 — scalars.Q_eng, scalars.engineering.EROI, scalars.engineering.Gross P_electric (MW), scalars.engineering.Net P_electric (MW), scalars.engineering.P_thermal (MW)
  - DEMO15: 13 keys moved; max rel. diff 4.49e-1 — scalars.Q_eng, scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.engineering.EROI, scalars.engineering.Gross P_electric (MW), scalars.engineering.LCOE ($/MWh), scalars.engineering.Net P_electric (MW), scalars.engineering.P_thermal (MW), scalars.score, scalars.scoreBreakdown[2].value, … (+1 more)
  - NIF: 1 key moved; max rel. diff 7.25e-1; 2 keys added (scalars 2) — scalars.Q_eng
  - DIRECT: 1 key moved; max rel. diff 3.33e-1; 2 keys added (scalars 2) — scalars.Q_eng
  - Z: 207 keys moved; max rel. diff 1.00e+0 — flatTop.B, flatTop.C, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_fus, flatTop.Q, flatTop.Te, flatTop.Ti, flatTop.ne, flatTop.triple, history.B.mean, … (+195 more)
  - MIRROR: 199 keys moved; max rel. diff 8.84e-1 — flatTop.Efus_MJ, flatTop.Nn, flatTop.P_alpha, flatTop.P_brems, flatTop.P_cond, flatTop.P_fus, flatTop.Q, flatTop.Te, flatTop.Ti, flatTop.W, flatTop.tauE, flatTop.triple, … (+187 more)
  - ITER-DHe3: 322 keys moved; max rel. diff 1.00e+0; 66 keys added (history 55, flatTop 11) — events.ELM, events.sawtooth, events.warning, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Nn, flatTop.P_LH, flatTop.P_alpha, flatTop.P_brems, flatTop.P_bt, flatTop.P_charged, flatTop.P_cond, … (+310 more)
  - ITER-pB11: 338 keys moved; max rel. diff 1.00e+0; 81 keys added (history 55, scalars 13, flatTop 11, events 2) — events.ELM, events.sawtooth, events.warning, flatTop.Efus_MJ, flatTop.Ein_MJ, flatTop.Ip, flatTop.P_LH, flatTop.P_alpha, flatTop.P_aux, flatTop.P_brems, flatTop.P_charged, flatTop.P_cond, … (+326 more)
  - SPARC15-DHe3: 2125 keys moved; max rel. diff 1.16e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2113 more)
  - DIIID15: 8 keys moved; max rel. diff 6.55e-1 — scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.score, scalars.scoreBreakdown[0].value, scalars.scoreBreakdown[2].value, scalars.scoreBreakdown[4].value
  - MASTU15: 7 keys moved; max rel. diff 5.49e-1 — scalars.Temax_keV, scalars.Timax_keV, scalars.Tmax_MC, scalars.Tmax_keV, scalars.score, scalars.scoreBreakdown[0].value, scalars.scoreBreakdown[4].value
  - TAE-pB11: 191 keys moved; max rel. diff 9.02e-1 — flatTop.Efus_MJ, flatTop.P_alpha, flatTop.P_brems, flatTop.P_cond, flatTop.P_fus, flatTop.Q, flatTop.Te, flatTop.Ti, flatTop.W, flatTop.tauE, flatTop.triple, history.Efus_MJ.max, … (+179 more)
  - MIRROR-DHe3: 202 keys moved; max rel. diff 1.00e+0 — flatTop.Efus_MJ, flatTop.Nn, flatTop.P_alpha, flatTop.P_brems, flatTop.P_cond, flatTop.P_fus, flatTop.Q, flatTop.Te, flatTop.Ti, flatTop.W, flatTop.tauE, flatTop.triple, … (+190 more)
- Unchanged (6): GF, FRXL, ZAP, TAE, MUON, SPARC15-pB11
