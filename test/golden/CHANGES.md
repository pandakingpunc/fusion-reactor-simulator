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

## 2026-09-28 13:42 UTC — ws3 1.5D integrity: Grad-Shafranov updates that did not converge were dropped silently (JET15 14 of 17, DIIID15 5 of 9, DEMO15 5 of 30, MASTU15 7 of 7) and are now retried (relaxation 0.5, then the pressure table filtered at the GS grid scale with relaxation 0.3) and accepted (JET15 17/17, DIIID15 9/9, DEMO15 30/30, MASTU15 6 accepted + 4 rejected and reported), so the transport geometry follows the plasma: JET15, DIIID15, DEMO15, MASTU15 move. All 1.5D cases gain the report counts 'GS updates accepted / needing a retry / rejected', 'Forced transport steps' and the diagnostic tauE_scal. The work-array refresh after an equilibrium swap, explicit step-retry exhaustion, the full rewind checkpoint, cgm tau_E = W/P_loss and the initial-GS guard move no golden number (ITER15 and the SPARC15 cases only gain keys).

Node v24.19.0 · `npm run golden:update` · all cases

- Changed (9):
  - ITER15: 0 keys moved; 10 keys added (history 5, scalars 4, flatTop 1)
  - JET15: 2213 keys moved; max rel. diff 1.76e+0; 10 keys added (history 5, scalars 4, flatTop 1) — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2201 more)
  - SPARC15: 0 keys moved; 10 keys added (history 5, scalars 4, flatTop 1)
  - SPARC15-short: 0 keys moved; 10 keys added (history 5, scalars 4, flatTop 1)
  - DEMO15: 1148 keys moved; max rel. diff 1.00e+0; 10 keys added (history 5, scalars 4, flatTop 1) — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+1136 more)
  - SPARC15-DHe3: 0 keys moved; 10 keys added (history 5, scalars 4, flatTop 1)
  - SPARC15-pB11: 0 keys moved; 10 keys added (history 5, scalars 4, flatTop 1)
  - DIIID15: 2166 keys moved; max rel. diff 1.55e+0; 10 keys added (history 5, scalars 4, flatTop 1) — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2154 more)
  - MASTU15: 2211 keys moved; max rel. diff 1.99e+0; 11 keys added (history 5, scalars 4, events 1, flatTop 1) — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2199 more)
- Unchanged (21): ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, NIF, DIRECT, Z, GF, FRXL, ZAP, TAE, MIRROR, MUON, ITER-DHe3, ITER-pB11, TAE-pB11, MIRROR-DHe3

## 2026-09-28 15:21 UTC — ws3 stage C: new 1.5D diagnostic P_bound, the power conducted and convected across the separatrix (keys added in every 1.5D case); every 1.5D case moves because the transport-geometry cell volumes now come from a spline of V against rho_tor^2 with clamped end slopes (the innermost cell was 1.3 % too small), and sawtooth crashes now conserve the electron and ion thermal energy exactly (a crash lost 3-4e-4 of the electron energy); MASTU15 also moves because the ion heat convected in through the separatrix now scales with n_i/n_e. Largest flat-top changes: ITER15 T_e(0) -0.52 %, Q 9.755 -> 9.749, Q_sci_avg -0.42 %; DEMO15 Q 22.71 -> 22.76; the other cases below 1e-3

Node v24.19.0 · `npm run golden:update` · all cases

- Changed (9):
  - ITER15: 2279 keys moved; max rel. diff 1.28e+0; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2267 more)
  - JET15: 2252 keys moved; max rel. diff 1.68e+0; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2240 more)
  - SPARC15: 2140 keys moved; max rel. diff 7.38e-1; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2128 more)
  - SPARC15-short: 2139 keys moved; max rel. diff 1.19e+0; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2127 more)
  - DEMO15: 2273 keys moved; max rel. diff 1.84e+0; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2261 more)
  - SPARC15-DHe3: 2121 keys moved; max rel. diff 1.02e+0; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2109 more)
  - SPARC15-pB11: 2120 keys moved; max rel. diff 5.47e-1; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2108 more)
  - DIIID15: 2255 keys moved; max rel. diff 4.96e-1; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2243 more)
  - MASTU15: 2246 keys moved; max rel. diff 3.06e-1; 6 keys added (history 5, flatTop 1) — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2234 more)
- Unchanged (21): ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, NIF, DIRECT, Z, GF, FRXL, ZAP, TAE, MIRROR, MUON, ITER-DHe3, ITER-pB11, TAE-pB11, MIRROR-DHe3

## 2026-09-28 19:51 UTC — ws3 addendum (no golden file changed): headline numbers and causes for the two ws3 entries above (13:42 stage A, 15:21 stage C); the 15:21 entry understates the stage C moves

Node v24.19.0 · `npm run golden:update` was not run for this entry · numbers compare the golden files before and after each entry (fork point 3d04e96, stage A d57f456, stage C 933b559); the geometry / sawtooth split comes from a snapshot of the 1.5D cases recorded at the geometry-fix commit 4894a8b alone

- Stage A (13:42 entry). Cause: Grad-Shafranov updates that did not converge are retried and accepted, so the transport geometry follows the plasma. JET15: Q_sci_max 1.231 -> 1.314, E_fusion 84.57 -> 85.08 MJ, flat-top Q 0.4355 -> 0.4409, P_fus 14.44 -> 14.62 MW, f_bs 0.240 -> 0.247, Shafranov shift 0.146 -> 0.096 m, burn time 0.241 -> 0.220 s, equilibrium frames 4 -> 18. DEMO15: flat-top Q 22.721 -> 22.714, ELMs 1076 -> 1077, last-equilibrium q95 4.840 -> 4.898, equilibrium frames 26 -> 31. DIIID15: ELMs 250 -> 252, f_bs 0.3094 -> 0.3107, last-equilibrium l_i 0.800 -> 0.836, final T_ped 0.68 -> 0.51 keV, equilibrium frames 5 -> 10. MASTU15 (the equilibrium used to stay the initial beta_p = 0.1 one for the whole shot): f_bs 0.541 -> 0.396, l_i(3) 0.726 -> 0.832, flat-top q95 19.7 -> 17.6, last-equilibrium beta_p 0.10 -> 1.59, Shafranov shift 0.109 -> 0.216 m, Q_sci_max 3.12e-4 -> 2.97e-4, score 28 -> 27, warnings 1 -> 2. ITER15 and the SPARC15 cases only gained keys.
- Stage C (15:21 entry), causes: (G) the transport-geometry cell volumes come from V(rho^2) with the V' end slopes (the innermost cell was 1.3 % too small; geometry.test.ts); (S) sawtooth crashes conserve the electron and ion energy exactly; (M) ion heat convected in through the separatrix scales with n_i/n_e (only MASTU15 has boundary inflow); P_bound is a diagnostic only. Moves from the stage A files:
  - Every 1.5D case (G), flat-top central safety factor q(0): ITER15 1.061 -> 1.033 (-2.6 %; G alone -2.4 %), JET15 -2.4 %, DIIID15 -4.4 %, SPARC15 0.942 -> 0.909 (-3.6 %), SPARC15-short, -DHe3 and -pB11 -2.9 to -3.0 % (q_min = q(0) there), MASTU15 +0.1 %, DEMO15 1.470 -> 1.686 (+14.6 %; hollow current profile, q_min +0.13 %). The cell volumes of the first cells enter the current-diffusion balance (the psi inertia and source terms carry Delta V, and <j.B> is the flux divergence over Delta V), so a 1.3 % change of the central cell moves the current density near the axis; the flat-top mean of rho(q=1) follows (-1 where there is no q = 1 surface). The geometry-only snapshot reproduces these q(0) values.
  - ITER15 (G, then S): sawtooth count 25 -> 38, period 16 -> 10.5 s (the geometry commit alone gives 39). The shear at q = 1 reaches sawtoothShear earlier in the q_min decay once q(0) has moved (q(0) at t = 60 s, before the first crash, 1.164 -> 1.134 with q_min unchanged; crashes at s_1 = 0.22-0.30 instead of 0.30-0.35). The count is stable within each version (37-39 now, 24-26 before, for P_aux +0.2 %, I_p +0.1 % and two other RNG seeds), so this is a systematic shift, not noise. Flat-top: T_e(0) 23.98 -> 23.85 keV (-0.52 %: G -0.75 %, S +0.23 %), Q 9.7545 -> 9.7495, P_fus 490.6 -> 490.4 MW, l_i -0.19 %, P_SOL -0.11 %, P_rad -0.16 %, P_sync -0.7 %, T_ped +0.23 %, V_loop 0.0624 -> 0.0642 V (+2.8 %; the flat-top is a frame-weighted mean, so it includes the V_loop spikes of the extra frames at each crash and follows the crash count); E_fusion and Q_sci_avg -0.42 %, Q_sci_max -0.12 %; ELMs 1022 -> 1024, ELM frequency 2.61 -> 2.55 Hz; end-of-shot T_ped 4.53 -> 4.36 keV (ELM-cycle phase).
  - JET15 (G): Q_sci_max 1.3144 -> 1.3200 (+0.42 %), burn time 0.2200 -> 0.2131 s, triple product max +0.27 %, T_i max +0.22 %; flat-top: S_fuel +1.7 %, burn fraction -0.23 %, V_loop -0.11 %, every other value within 1e-3 (apart from q(0) and the near-zero mean dW/dt).
  - DEMO15 (G): flat-top V_loop 0.0122 -> 0.0148 V (+21 %; a 12 mV quantity, P_oh +0.66 %), Q 22.714 -> 22.758 (+0.19 %), P_SOL +0.65 %, T_ped -1.4 %, S_fuel +1.0 %, Q_sci_max 23.449 -> 23.552 (+0.44 %), Shafranov shift (last equilibrium) 0.402 -> 0.448 m, GS updates needing a retry 5 -> 2, ELMs 1077 -> 1078.
  - DIIID15 (G): flat-top V_loop -0.57 %, T_ped +0.23 %, alpha_ped +0.46 %, l_i +0.10 %, the cumulative E_fusion and E_in +1.0 % (frame means), scalar E_fusion +0.18 %.
  - MASTU15 (G, M): flat-top P_oh -1.4 %, S_fuel +1.3 %, V_loop -0.16 %, f_bs -0.09 %, neutron yield +0.19 %; (M) moves the ramp-up history means by up to 0.25 % (447 heat solves between 0.05 and 0.31 s) and the run takes one step fewer.
  - SPARC15, SPARC15-short, SPARC15-DHe3, SPARC15-pB11 (G): q(0) as above; every other flat-top value within 2e-4 and every scalar within 1.1e-4 (the 'keys moved' count is profile and history-statistic keys).
  - Keys added in every 1.5D case: P_bound (history statistics and flat-top). The 15:21 entry lists equilibrium.last.* among the added keys; the key sets of the files before and after differ by the six P_bound keys only.
