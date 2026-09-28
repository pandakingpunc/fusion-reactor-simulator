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

## 2026-09-28 14:26 UTC — ws4 (Grad-Shafranov): table mode meets I_p through FF' only (p' was rescaled with FF', leaving the reported p, beta_p and W_th 9-25 % out of force balance), closed-form beta0 (beta0 > 1 allowed), bounded 8-layer exterior fill + Jacobi, interior-only LU, Anderson-accelerated Picard and a saddle-free axis search. The ws4 re-record of 13:51 was reverted and is redone here with the full list of moves (the files are byte-identical to it). 0D cases unchanged. Two mechanisms move the 9 1.5D cases: (i) the field no longer holds c*p' while reporting p' (c = 0.99-1.07, typically 1.02, in the accepted solves); (ii) more table-mode updates converge and are accepted, so the transport geometry history changes (equilibrium frames JET15 4->7, DIIID15 5->7, DEMO15 26->31, MASTU15 1->2). Flat-top averages unless noted. ITER15: Q 9.755->9.766, q95 3.475->3.473, li 0.7255->0.7266, beta_p 0.5627->0.5630, qmin 0.987->0.978, rho_q1 0.088->0.180 (x2), sawteeth 25->21 with period 16.0->19.05 s, ELMs 1022->1023, Shafranov shift 0.170->0.165 m, dW/dt +4.6 %, V_loop +3.4 %; last equilibrium beta_p 0.574->0.568. JET15: Q 0.4355->0.4391, q95 3.699->3.688, li 0.7636->0.7615, beta_p 0.6272->0.6282, q0 0.983->1.185 and qmin 0.983->1.046, so the flat-top has no q = 1 surface any more (rho_q1 -0.355->-1), Shafranov shift 0.146->0.100 m (the last accepted equilibrium is now a flat-top one at beta_p 0.63 instead of a ramp-up one at 0.45), S_fuel -18.5 %, V_loop -8.9 %, f_bs +2.1 %. SPARC15: flat-top within 0.9 % (rho_q1 and dW/dt -0.9 %, Q 6.088->6.087, q95 4.163->4.162, all others <= 0.24 %). SPARC15-short: V_loop +1.3 %, all others <= 0.5 %. SPARC15-DHe3: rho_q1 -0.466->-0.453, all others <= 0.07 %. SPARC15-pB11: all <= 0.4 %. In the four SPARC cases the Shafranov shift moves by -0.6 to -1.7 % and the history V_loop minimum by 1.4-9.4 % (smaller in magnitude). DEMO15: Q 22.72->22.76, q95 4.920->4.925, li 0.7453->0.7451, beta_p 1.156->1.157, q0 1.478->1.665, Shafranov shift 0.403->0.439 m, dW/dt +27 %, V_loop +8.1 %, ELMs 1076->1068; last equilibrium beta_p 1.126->1.142. DIIID15: q95 5.931->5.908, li 0.8054->0.8043, q0 1.112->1.342, rho_q1 -0.58->-0.66, S_fuel +13 %, dW/dt +25 %, V_loop -2.8 %. MASTU15, a coupling transient: the old baseline never accepted a table equilibrium and kept the beta_p = 0.1 start-up geometry all shot (Shafranov shift 0.109 m at a flat-top beta_p of 1.15). Table solves 1-5 still stall at a residual of ~1e-2. Solve 6 at t = 1.4925 s now converges (the old code stopped at 3.5e-3) with currentScale 1.27: the <j_phi/R> and p tables, mapped to psi_N through the stale start-up equilibrium, carry 79 % of I_p on its flux surfaces, and its beta_p is 0.785 against 1.134 in transport. The 1.5D model accepts it (R_axis 0.959->1.063 m in one step) and keeps psi(rho) across the geometry change. In the next frame (t = 1.495 s) V_loop goes +0.045->-2.293 V, P_oh 0.006->0.513 MW (x85) and li 0.716->0.751, and the induced negative field reverses the core ohmic current for the rest of the shot. History V_loop min -0.0115->-2.293 V, P_oh max 0.195->0.513 MW. Flat-top: q0 2.38->9.51, q95 19.70->16.87, li 0.7259->0.7182, beta_p 1.149->1.160, P_oh x4.1, P_neutron +35 %, S_fuel -25 %, dW/dt +0.016->-0.036 MW. Last profile: johm[0] +0.072->-0.838 MA/m2, q[0] 1.73->8.42. Shafranov shift 0.109->0.213 m. The accepted state is a correct equilibrium of the tables it was given (force-balance residual 1.1e-5); the transient comes from a stale geometry catching up in one step. GS now flags such states with an Equilibrium.warnings 'table-current-rescaled' entry (|currentScale - 1| > 0.1; every other accepted solve in these cases has |c - 1| <= 0.067). Gating or relaxing these updates in model.ts is a required ws3 request, and MASTU15 must be re-recorded once it lands: rejecting them restores the old trajectory (V_loop min -0.012 V, P_oh max 0.195 MW).

Node v24.19.0 · `npm run golden:update` · all cases

- Changed (9):
  - ITER15: 2281 keys moved; max rel. diff 1.70e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2269 more)
  - JET15: 2257 keys moved; max rel. diff 1.92e+0 — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2245 more)
  - SPARC15: 2144 keys moved; max rel. diff 1.66e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2132 more)
  - SPARC15-short: 2139 keys moved; max rel. diff 1.62e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2127 more)
  - DEMO15: 2277 keys moved; max rel. diff 1.99e+0 — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2265 more)
  - SPARC15-DHe3: 2120 keys moved; max rel. diff 1.61e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2108 more)
  - SPARC15-pB11: 2120 keys moved; max rel. diff 1.60e+0 — equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], equilibrium.last.surfaces.RatZmax[6], … (+2108 more)
  - DIIID15: 2259 keys moved; max rel. diff 9.67e-1 — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2247 more)
  - MASTU15: 2257 keys moved; max rel. diff 1.77e+0 — equilibrium.frames, equilibrium.last.Raxis, equilibrium.last.Zaxis, equilibrium.last.betaP, equilibrium.last.li, equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[0], equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[2], equilibrium.last.surfaces.RatZmax[3], equilibrium.last.surfaces.RatZmax[4], equilibrium.last.surfaces.RatZmax[5], … (+2245 more)
- Unchanged (21): ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, NIF, DIRECT, Z, GF, FRXL, ZAP, TAE, MIRROR, MUON, ITER-DHe3, ITER-pB11, TAE-pB11, MIRROR-DHe3
