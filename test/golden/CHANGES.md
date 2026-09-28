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
