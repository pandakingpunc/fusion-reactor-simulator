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
