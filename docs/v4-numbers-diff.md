# v3.0.0 to v4: the headline numbers, before and after

Status: Wave 3, step 1 of the v4 roadmap (reconcile the physics numbers). Measured on 2026-10-01 on branch `v4/integration` at `4d64f60`
(the physics of that tree is the physics of the golden files; 40 golden cases). Nothing in this document is a new physics result: it
puts the published v3.0.0 numbers next to the v4 numbers, says what each move is made of, and says where the ledger does not say.
The v4 column of every table is held to `test/golden/*.json` by `src/regression/numbersDiff.test.ts`.

## 1. Summary

- **The 0D and 1.5D models now agree where v3 disagreed.** ITER Q (flat top) was 13.98 in 0D and 9.755 in 1.5D (0D 43 % above 1.5D);
  it is 10.08 and 10.45 (0D 3.5 % below). The v3 reading that the 1.5D physics (NTM, pedestal, current diffusion) pulls an
  overpredicting 0D down from Q 14 to 9.8 does not survive: the 0D number was 10.13 at the end of wave 1 (lanes ws2b and ws5b, the 0D power
  balance), with no 1.5D physics involved.
- **Moves of 0D tokamak numbers come from three kinds of change:** corrections of the 0D power balance (ws2b: ITER Q -25 %, DEMO -5 %, SPARC -4 %, JET E_fus +10 %), exact geometry and energies (ws2c: Miller volume, D-T energies; SPARC +15 %), and changed preset inputs (ITER
  density and LCFS shape, DEMO density and LCFS shape, the MAST-U scenario). Section 4.3 separates the inputs from the code by running
  the v4 code on the v3 inputs: for ITER 0D, of the -27.9 % in Q, -12.9 % is code and -17.2 % is the preset (the two do not add, the
  order matters).
- **1.5D moves are code only:** the v4 code on the v3 inputs reproduces the v4 numbers of ITER15, JET15, SPARC15 and DEMO15 to every
  printed digit. ITER15 Q +7.1 % is three steps: ws3d +6.1 % (loss power with core radiation and dW/dt), ws3s +2.8 % (edge-packed grid,
  TR-BDF2, Hinton-Hazeltine current diffusion), the NTM island flattening -2.3 %.
- **NIF:** the v3 gain 1.49 against N221204 was a fit (the constant `ICF_CAL` carried a source comment that says it was tuned to NIF, and the
  ledger says it was tuned to the N221204 preset). v4 calibrates on N210808 alone (model 0.715, published 0.72: by construction) and predicts
  N221204 blind: gain 0.668 against the published 1.5 (0.446 times it), a documented miss. The direct-drive gain moved 3.10 to 0.391 as a
  side effect of the shared constant.
- **Against the references:** closer for ITER 0D (Q 1.40 to 1.01 times the reference, P_fus 1.43 to 1.03), DEMO 0D P_fus (1.10 to 0.956) and
  MAST-U q95 (34 to 6.4, the published band is 5 to 10); further for SPARC 0D P_fus (205 MW against the 140 MW the v3 README quoted; v3
  182 MW), JET 0D E_fus (66.6 MJ, 1.13 times 59 MJ; v3 0.99), ITER15 T_ped (0.79 times the 4.5 keV reference; v3 0.82); ITER15 Q passes
  through its reference (0.975 to 1.05). Some of the closeness of ITER and DEMO 0D is a re-based input (design n/n_G, LCFS shape), see 4.3.
- **The 1.5D model is about 5 times slower:** ITER15 (400 s) 5.3 s to 27.8 s here (steps x2.2); the Wave 2A idle record is 23.8 s.
- **Several v3 README and technical-report claims no longer hold** (section 7): ITER Q 14.0 and 715 MW (0D), 9.8 and 491 MW (1.5D), the
  NTM onset at 81 s, "validated against NIF N221204", 25 presets, 19 checks all passing, 44 unit tests, the run times.

## 2. Method, definitions and what the columns mean

**v3.0.0 column.** A temporary worktree at tag `v3.0.0` (`8ded08c`; the published `eb97a6d` is its child and differs from it only in
`CITATION.cff`, `README.md` and `docs/technical-report.md`, `git diff --stat v3.0.0 eb97a6d`: no source file). Per case, with that tree's
own public API: `new Simulation(PRESETS[id].cfg).runAll()` for the shot report, and the flat top as v3's own `presetRunner.worker.ts`
computed it: the arithmetic mean over the frames from index floor(0.7 N) to the end, finite samples only (the snippet is in section 9).
The preset's own `t_end` is used, except DEMO and DEMO15, which use the golden harness's 600 s and 500 s (the full 2000 s presets are
the separate `X.*` rows). **Check:** the same runs reproduce, bit for bit, every flat-top key, all 252 numeric report scalars and all 242 numeric engineering
values of 14 cases of the v3.0.0 golden baseline that wave 1 recorded (`test/golden` at `1dc6d8a`: ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, ITER15, JET15,
SPARC15, DEMO15, NIF, DIRECT; 0 differences), so the v3 column is also in git history. `numbersDiff.test.ts` compares the v3 column with
those baseline files when the history is available.

**v4 column.** `test/golden/<case>.json` at HEAD. The golden flat top is the time-weighted mean over the last 30 % of the time span
(`src/physics/analysis/flatTop.ts`, the definition of the v4 shot report, validation table and figures); the report scalars (E_fus,
Q_sci_max, ...) are whole-run values and have no weighting. The same script on the HEAD tree reproduces the same 14 golden cases bit for
bit (every flat-top key, 252 report scalars, 452 engineering values; 0 differences).

**Two flat-top definitions.** v3 weights each frame equally, v4 each time span. The change column compares each version's own published
definition. Section 5 separates the definition from the physics: it is at most 0.3 % in every row except ITER15 T_ped (-2.4 % in v3,
-2.9 % in v4). The v4 flat top with frame weighting is bit for bit the v3 definition (`flatTopMean(..., {weighting: 'frame'})`).

**Rows marked `†`** (H98(y,2), tau_E/tau_ISS04) are computed from the flat-top values with the reference formulas of
`src/physics/validation/metrics.ts` and each tree's own preset geometry, as `npm run validate` does. v3 reports no line-average density
(`nbar`), so the v3 value uses the volume-average n_e, the documented fallback of that code; a line average (n_bar = 1.110 n_e for the
alpha_n 0.3 profile of these presets, 1.038 for W7-X, as the v4 run reports) would lower the v3 H98 values by 4.2 % and the W7-X
ratio by 2.0 % (estimates, not runs).

**Row `ITER.nG` (‡)** is not the same quantity in both columns: v3 reports n_e (volume average) / n_G, v4 the line average n_bar / n_G
(the ws2b change); the reference 0.85 is a line average.

**Reference column.** From `src/physics/validation/references.ts` (`REFERENCE_CHECKS`, 46 rows at HEAD): published value, uncertainty,
the accepted range of the check and its source label; "model/reference" is the model value divided by the published one. "None in
references.ts" means the table has no row for that quantity; where the v3 README quoted a reference value it is named. A reference is a
published value or a design target, the accepted range is derived from the literature and never fitted to the model (the header of
that file); the one fit it documents is the N210808 calibration.

**Cause column.** "steps:" lists the relative change (%) of the golden value between consecutive integration states of `v4/integration`
(the tables of section 4 give the values; a step is named after the lane merged at that state, steps below 0.05 % are left out, the
steps multiply to the total up to rounding). The text after it gives the causes from `test/golden/CHANGES.md` and the wave reports, with the entry's
date (UTC) in the legend below. The ledger is cited, not re-derived, except where this document says it measured something
("measured here").

| Tag | Change | CHANGES.md entry (UTC) | State |
|---|---|---|---|
| ws2b | 0D physics fixes: separate alpha and beam fast-ion pools, ignition test, loss power P_L = P_heat - P_rad,core - dW/dt, ELM power 0.3 W/tau_E, scalings and L-H threshold at the line-average density, D-D and D-3He channels, T_max window | 2026-09-28 14:05 and 20:03 | `4c50fca` |
| ws5b | frames at an ELM crash carry the diagnostics of their own state (the run is bit-identical, the frame-weighted flat top changes) | 2026-09-28 21:47 | `4c0fdb7` |
| ws4 | Grad-Shafranov correctness (table mode meets I_p through FF' only, more updates accepted) | 2026-09-28 14:26 | `af38dbe` |
| ws3 | 1.5D integrity: GS retry ladder, transport-geometry cell volumes, sawtooth crashes conserve energy | 2026-09-28 13:42 and 15:21, addendum 19:51 | `fca4643` |
| ws3d | 1.5D parity with the 0D fixes: loss power, Ryter L-H branch, per-channel sources, fast-ion pools, cell volumes | 2026-09-28 22:27 and 23:45, addendum 2026-09-29 00:35 | `0451434` |
| ws2c | numbers hygiene: time-weighted flat tops, exact D-T energies, Miller volume and surface, ITER and DEMO density targets, MAST-U scenario, Ryter exponent | 2026-09-29 02:01 (merge 08:01) | `cad8a2a` |
| ws7a | edge model; the 1.5D P_SOL is ELM-inclusive | 2026-09-29 01:59 (merge 08:27) | `cf42433` |
| ws4i | 101-node edge-clustered surface table, self-consistent Grad-Shafranov updates | 2026-09-29 06:35 (merge 11:17) | `a7332e3` |
| ws3s | 1.5D solver: edge-packed grid, TR-BDF2 with localised events, Hinton-Hazeltine current diffusion, initial current | 2026-09-29 01:44, 08:02, 10:57, 12:19 (merge 13:04) | `7d8d92d` |
| ws2d | 0D density controller; published builds (engineering keys) | 2026-09-29 16:40, re-recorded 2026-10-01 04:53 | `3fcf528` |
| ws6c | conservative remap of the state at the adoption of an equilibrium | 2026-09-29 16:30, re-recorded 2026-10-01 04:53 | `3fcf528` |
| mix | Kadomtsev mixing radius of a hollow q core | 2026-10-01 05:50 | `7a8c81d` |
| ntmfl | NTM island flattening covers the island width on any radial grid | 2026-10-01 13:54 | `595216c` |
| icfcal | ICF model calibrated on NIF N210808 | 2026-10-01 07:49 | `12100d5` |

ws5s (mode-flip frame diagnostics) moved history statistics only and ws7b (systems-lite engineering) only engineering keys: no
number below moves through them (their entries, 2026-09-29 01:29 and 01:46). The ws2d and ws6c states are one re-record (`3fcf528`), so
a 1.5D step labelled ws6c also contains the ws2d engineering keys, which move no plasma key.

## 3. The table

Change % is 100 (v4 / v3 - 1). `n/a`: no such preset in v3.0.0.

| ID | Quantity | v3.0.0 | v4 | Change % | Reference (references.ts) | Causes |
|---|---|---|---|---|---|---|
| | **ITER 0D** | | | | | |
| `ITER.Q` | ITER 0D, Q (flat top) | 13.98 | 10.08 | -27.9 | Shimada 2007: 10, accepted 5 to 20; model/reference v3 1.40, v4 1.01 | steps: ws2b -25.4, ws5b -2.8, ws2c -0.9, ws2d +0.5. ws2b and ws5b together -27.5 % (the ws5b part corrects what the frame-weighted mean sampled at ELM frames; the simulated run is bit-identical): loss power with core radiation and dW/dt, ELM power 0.3 W/tau_E, scalings at the line-average density, beam heating no longer booked as alpha power. ws2c: exact D-T energies +4.1 %, Miller LCFS volume and surface, ITER density target 0.914e20. ws2d: density controller. Inputs changed too: section 4.3 |
| `ITER.Pfus` | ITER 0D, P_fus (flat top), MW | 715.5 | 516.6 | -27.8 | Shimada 2007: 500 MW, accepted 300 to 800; model/reference v3 1.43, v4 1.03 | steps: ws2b -24.8, ws5b -2.8, ws2c -1.9, ws2d +0.6. Same causes as ITER.Q; the alpha-power share of P_fus falls from 0.242 to 0.207 (ws2b: v3 booked about 32 MW of beam heating as alpha power) |
| `ITER.Qmax` | ITER 0D, Q_sci_max (peak of the shot report) | 15.94 | 12.74 | -20.1 | no check on the peak value (v3 validated it in 8 to 40) | steps: ws2b -14.1, ws5b -2.1, ws2c -9.3, ws2d +4.8. ws2b: same causes as ITER.Q; ws5b: ELM frames hold the post-crash state (the peak over frames follows it); ws2c, ws2d: as ITER.Q |
| `ITER.nG` | ITER 0D, n/n_G (flat top) ‡ | 0.8184 | 0.8483 | +3.7 | Shimada 2007: 0.85 (line average), accepted 0.6 to 1; model/reference v3 0.963, v4 0.998 | DEFINITION CHANGE at ws2b: v3 reports n_e (volume average) / n_G, v4 the line-average n/n_G (x1.110 for the alpha_n 0.3 profile). steps: ws2b +12.3, ws5b -0.5, ws2c -8.6, ws2d +1.4. ws2c: density target 1.0e20 to 0.914e20 volume average (design 0.85); ws2d: the controller sits on the target |
| | **JET** | | | | | |
| `JET.Efus` | JET 0D, E_fus, MJ | 58.31 | 66.64 | +14.3 | Maslov 2023: 59 +/- 6 MJ, accepted 40 to 80; model/reference v3 0.988, v4 1.13 | steps: ws2b +10.0, ws2c +4.6, ws2d -0.7. ws2b: loss power and the scalings at the line-average density; ws2c: Miller volume (-3.5 %), exact D-T energies, Ryter low-density branch; ws2d: density controller. Preset unchanged (v4 code on the v3 input: identical, 4.3) |
| `JET.btShare` | JET 0D, beam-target share P_bt/P_fus (flat top) | 0.7594 | 0.7172 | -5.6 | none in references.ts | steps: ws2b -4.1, ws5b +0.2, ws2c -1.8. ws2b: separate alpha and beam fast-ion pools (beam W_f 6.16 to 1.62 MJ); the Wave-1 report calls the share a property of the NBI-dominated heating; ws2c -1.8 % (Miller volume, D-T energies, Ryter branch; not split in the ledger) |
| `JET15.Efus` | JET 1.5D, E_fus, MJ | 84.57 | 81.84 | -3.2 | Maslov 2023: 59 +/- 6 MJ, accepted 40 to 80 (known failure); model/reference v3 1.43, v4 1.39 | steps: ws4 +0.2, ws3 +0.8, ws3d -3.6, ws2c -0.9, ws7a -0.4, ws4i -0.1, ws3s +1.0, ws6c -0.2. ws3d: dW/dt in the loss power (the ramp-up W follows tau_E, burn time 0.247 to 0 s); ws2c: Ryter branch (first L-H 0.22 to 0.32 s); ws3s: grid and solver. Still a known failure (accepted 40 to 80) |
| `JET15.btShare` | JET 1.5D, beam-target share P_bt/P_fus (flat top) | 0.6402 | 0.6332 | -1.1 | none in references.ts | steps: ws4 -0.4, ws3 -0.1, ws3d -0.2, ws7a +0.2, ws4i +0.2, ws3s -0.7, ws6c -0.1. ws3d: beam-target rate per channel with its own target; later moves < 1 % each and not split in the ledger (not fully attributed) |
| `JET15.Ti0` | JET 1.5D, T_i(0) (flat top), keV | 10.07 | 10.20 | +1.3 | Maslov 2023: 10 keV, accepted 6 to 15; model/reference v3 1.01, v4 1.02 | steps: ws4 +0.8, ws3 +0.3, ws3d -0.2, ws2c -0.1, ws7a -0.3, ws4i -0.2, ws3s +0.7, ws6c +0.3. Moves < 1 % per step; not attributed per step in the ledger |
| | **SPARC** | | | | | |
| `SPARC.Q` | SPARC 0D, Q (flat top) | 6.921 | 7.843 | +13.3 | Creely 2020: 11, accepted 2 to 20; model/reference v3 0.629, v4 0.713 | steps: ws2b -4.1, ws5b -0.7, ws2c +14.7, ws2d +3.8. ws2b: loss power (-4.1 %); ws2c: Miller volume (the ellipse was 8.6 % too big, SPARC Q 6.63 to 7.54) and exact D-T energies; ws2d: density controller (n/n_G 0.378 to 0.392). Preset change affects engineering keys only (4.3) |
| `SPARC.Pfus` | SPARC 0D, P_fus (flat top), MW | 181.8 | 205.0 | +12.8 | no check in references.ts (the v3 README quoted 140 MW, Creely 2020) | steps: ws2b -3.9, ws5b -0.7, ws2c +13.7, ws2d +3.9. Same causes as SPARC.Q |
| `SPARC15.Q` | SPARC 1.5D, Q (flat top) | 6.088 | 6.289 | +3.3 | Creely 2020: 11, accepted 2 to 20; model/reference v3 0.553, v4 0.572 | steps: ws3d +3.8, ws2c +0.4, ws4i -0.4, ws3s -0.4. ws3d: dW/dt in the loss power, Ryter L-H branch (the first L-H 0.81 to 1.50 s); ws2c: D-T energies; ws4i and ws3s: equilibrium table and grid |
| `SPARC15.Pfus` | SPARC 1.5D, P_fus (flat top), MW | 156.3 | 161.5 | +3.3 | no check in references.ts (the v3 README quoted 140 MW, Creely 2020) | steps: ws3d +3.7, ws2c +0.4, ws4i -0.4, ws3s -0.3. Same causes as SPARC15.Q |
| | **DEMO** | | | | | |
| `DEMO.Pfus` | DEMO 0D, P_fus (flat top, 600 s golden case), MW | 2193 | 1912 | -12.8 | Federici 2019: 2000 MW, accepted 1000 to 3000; model/reference v3 1.10, v4 0.956 | steps: ws2b -5.2, ws5b -2.5, ws2c -9.4, ws2d +4.2. ws2b: loss power (ignition no longer declared with NBI on); ws5b; ws2c: density target 0.75e20 to 0.711e20, LCFS shape (kappa 1.85, delta 0.5), exact D-T energies; ws2d: density controller. Inputs changed too: 4.3 |
| `DEMO.Q` | DEMO 0D, Q (flat top, 600 s golden case) | 21.82 | 19.03 | -12.8 | no check in references.ts | steps: ws2b -5.3, ws5b -2.5, ws2c -9.2, ws2d +4.1. Same causes as DEMO.Pfus |
| `DEMO15.Pfus` | DEMO 1.5D, P_fus (flat top, 500 s golden case), MW | 2268 | 2343 | +3.3 | Federici 2019: 2000 MW, accepted 1000 to 3000; model/reference v3 1.13, v4 1.17 | steps: ws4 +0.2, ws3 -0.1, ws3d +2.3, ws2c +0.8, ws7a -0.2, ws4i +0.3, ws6c -0.1. ws3d: loss power and Ryter branch (+2.3 %); ws2c; ws4i, ws3s; Wave 2B remap. The preset keeps the v3 1.5D density target 0.75e20 |
| `DEMO15.Q` | DEMO 1.5D, Q (flat top, 500 s golden case) | 22.72 | 23.47 | +3.3 | no check in references.ts | steps: ws4 +0.2, ws3 -0.1, ws3d +2.3, ws2c +0.8, ws7a -0.2, ws4i +0.3, ws3s +0.1, ws6c -0.1. Same causes as DEMO15.Pfus |
| | **ICF (NIF and direct drive)** | | | | | |
| `NIF.G` | NIF N221204, gain G | 1.489 | 0.6684 | -55.1 | Abu-Shawareb 2024: 1.5 +/- 0.1, accepted 1 to 3; blind in v4 (known failure); model/reference v3 0.993, v4 0.446 | Wave 3 calibration (CHANGES 2026-10-01 07:49): ICF_CAL 0.07 (the v3 comment says tuned to NIF, the ledger: to the N221204 preset) to 0.03931 (fitted to the N210808 yield 1.37 MJ), fuel mass 220 to 210 ug. Split measured here (order-dependent): the constant alone, with 220 ug, gives G 0.8426 (-43.4 %); the mass then -20.7 %. No other lane touched the ICF numbers (ws2b: Q_eng only) |
| `NIF.Yield` | NIF N221204, fusion yield, MJ | 3.052 | 1.370 | -55.1 | not a check; 3.1 MJ in the abstract of Abu-Shawareb 2024 (3.15 MJ in Kritcher 2024); model/reference v3 0.984, v4 0.442 | same as NIF.G (the yield is G x 2.05 MJ). Blind: the model has no input that separates N210808 from N221204 and N230729 |
| `NIF210808.G` | NIF N210808, gain G | n/a | 0.7148 | n/a | Abu-Shawareb 2022: 0.72, accepted 0.36 to 1.44; the calibration shot of v4; model/reference v4 0.993 | new preset; its yield is the calibration target by construction (1.3699 MJ against 1.37 MJ). v3 had no such preset and one yield for every NIF shot (3.05 MJ) |
| `NIF210808.Yield` | NIF N210808, fusion yield, MJ | n/a | 1.370 | n/a | Abu-Shawareb 2022: 1.37 MJ (the calibration target); model/reference v4 1.00 | calibration target, matched by construction (the constant is the root of E_fus = 1.37 MJ); a fit, not a test |
| `DIRECT.G` | Direct-drive preset, gain G | 3.096 | 0.3906 | -87.4 | Gopalaswamy 2024: 0.74 +/- 0.14, accepted 0.3 to 1.76; model/reference v3 4.18, v4 0.528 | side effect of the shared ICF_CAL (CHANGES 2026-10-01 07:49: "not a result for direct drive"); the capsule was never calibrated |
| | **ITER15 (1.5D, 400 s)** | | | | | |
| `ITER15.Q` | ITER15 (1.5D, 400 s), Q (flat top) | 9.755 | 10.45 | +7.1 | Shimada 2007: 10, accepted 5 to 20; model/reference v3 0.975, v4 1.05 | steps: ws4 +0.1, ws3 -0.2, ws3d +6.1, ws2c +0.7, ws7a -0.1, ws3s +2.8, ws6c +0.2, mix -0.2, ntmfl -2.3. ws3d +6.1 %: loss power P_L = P_heat - P_rad,core - dW/dt (+6.0 %); ws3s +2.8 %: edge-packed grid (+2.2 %), TR-BDF2, Hinton-Hazeltine current diffusion; ntmfl -2.3 %: NTM island flattening on any grid. 4.2 |
| `ITER15.Pfus` | ITER15, P_fus (flat top), MW | 490.6 | 525.6 | +7.1 | Shimada 2007: 500 MW, accepted 300 to 800; model/reference v3 0.981, v4 1.05 | steps: ws4 +0.1, ws3 -0.2, ws3d +6.1, ws2c +0.7, ws7a -0.1, ws3s +2.9, ws6c +0.2, mix -0.2, ntmfl -2.2. Same causes as ITER15.Q |
| `ITER15.fbs` | ITER15, bootstrap fraction f_bs | 0.2234 | 0.2306 | +3.2 | Sips 2005: 0.2 +/- 0.05, accepted 0.1 to 0.4; model/reference v3 1.12, v4 1.15 | steps: ws4 +0.1, ws3 -0.1, ws3d +2.9, ws2c +0.4, ws4i -0.2, ws3s +0.3, ws6c +0.1, ntmfl -0.3. ws3d +2.9 % (higher loss power), ws3s, ntmfl; 4.2 |
| `ITER15.li` | ITER15, l_i(3) | 0.7255 | 0.7195 | -0.8 | Shimada 2007: 0.85 +/- 0.15, accepted 0.6 to 1.1; model/reference v3 0.853, v4 0.846 | steps: ws4 +0.2, ws3 -0.3, ws4i -0.8, ws3s +1.5, ws6c -0.1, ntmfl -1.2. ws4i -0.8 % (edge-clustered table), ws3s +1.5 % (Hinton-Hazeltine form, initial current), ntmfl -1.2 %; 4.2 |
| `ITER15.Tped` | ITER15, T_e pedestal, keV | 3.700 | 3.549 | -4.1 | Snyder 2011: 4.5 +/- 0.5 keV, accepted 2 to 7; model/reference v3 0.822, v4 0.789 | steps: ws4 +0.2, ws3 +0.2, ws3d +0.6, ws2c -3.0, ws7a +1.2, ws4i +3.2, ws3s -7.8, ntmfl +1.6. ws3s: the whole move is the packed grid (10 cells across the pedestal), +/- 3 % swings at ws2c and ws4i are not decomposed in the ledger (not fully attributed); ntmfl +1.6 %. Of the -4.1 % about -2.4 to -2.9 % is the flat-top definition (section 5); T_ped is grid-oscillatory at +/- 1 % (CHANGES 2026-10-01 13:54) |
| `ITER15.nG` | ITER15, n/n_G (line average) | 0.8054 | 0.8000 | -0.7 | Shimada 2007: 0.85, accepted 0.6 to 1; model/reference v3 0.948, v4 0.941 | steps: ws4i -0.1, ws3s -0.6. Not attributed beyond the ws3s merge; the 1.5D density target is unchanged (1.0e20 line average, design n/n_G 0.837) and the flat top has sat at 0.80 since v3 (not analysed) |
| `ITER15.q95` | ITER15, q95 | 3.475 | 3.503 | +0.8 | Shimada 2007: 3, accepted 2.7 to 4; model/reference v3 1.16, v4 1.17 | steps: ws4 -0.1, ws3d +0.2, ws4i +0.8, ws3s -0.1, ws6c -0.1. ws4i +0.9 %: the 101-node edge-clustered surface table corrects q95 (+0.6 % ITER at a fixed shape); other steps < 0.1 % |
| | **MAST-U, DIII-D, W7-X (0D presets)** | | | | | |
| `MASTU.H98` | MAST-U 0D, H98(y,2) (flat top) † | 1.518 | 0.9154 | -39.7 | Harrison 2024: 1.15 +/- 0.15, accepted 0.748 to 1.74; model/reference v3 1.32, v4 0.796 | tau_E steps: ws2b -20.5 % (of which -4.2 % is the density basis, see the dagger; the rest the new loss power and scalings), ws2c -24.1 % (the preset became the first-campaign scenario: R 0.8 m, a 0.5 m, kappa 2.1, 0.75 MA, 0.55 T, 2 MW), ws2d -0.1 %. v4 code on the v3 input: 1.206 |
| `MASTU.q95` | MAST-U 0D, q95 (flat top) | 34.33 | 6.393 | -81.4 | Berkery 2023: band 5 to 10 (a sanity bound) | ws2b -47 %: Sauter (2016) low-aspect-ratio fit (34.33 to 18.18); ws2c -65 %: the preset became the first-campaign scenario (published band 5 to 10). v4 code on the v3 input: 18.18 |
| `MASTU.Pfus` | MAST-U 0D, P_fus (flat top), MW | 6.374e-4 | 1.420e-4 | -77.7 | none in references.ts | ws2b -12.4 %, ws2c -74.7 % (new scenario preset: smaller plasma, 2 MW instead of 5 MW), ws2d +0.7 %. v4 code on the v3 input: 6.507e-4 MW (+2.1 % against v3) |
| `DIIID.H98` | DIII-D 0D, H98(y,2) (flat top) † | 1.012 | 0.8826 | -12.8 | IPB 1999: 1, accepted 0.748 to 1.34 (a sanity bound); model/reference v3 1.01, v4 0.883 | steps: ws2b -12.8 % (of which -4.2 % is the density basis, see the dagger, estimate; tau_E 0.0929 to 0.0845 s the rest: loss power with core radiation and dW/dt, ELM power, line-average scalings; not bisected for DIII-D), then < 0.1 %. Preset unchanged |
| `DIIID.Palpha` | DIII-D 0D, P_alpha (flat top), MW | 11.66 | 0.002551 | -100.0 | Lazarus 1997: upper bound 0.0225 MW (a sanity bound); model/reference v3 518, v4 0.113 | ws2b (D1): v3 booked the 11.67 MW of beam heating as P_alpha; v4 counts only the charged D-D products (beam heating is P_beam_heat). Not a physics change of the plasma |
| `DIIID.Pfus` | DIII-D 0D, P_fus (flat top), MW | 0.003822 | 0.003845 | +0.6 | none in references.ts | steps: ws2b -8.8, ws5b -0.6, ws2c +10.9, ws2d +0.1. ws2b: loss power; ws2c: the Miller volume is 9 to 10 % smaller at the same input (ledger); the preset is unchanged |
| `W7X.Ti0` | W7-X 0D, T_i(0) (flat top), keV | 2.015 | 2.004 | -0.5 | Beurskens 2021: 1.5 +/- 0.2 keV, accepted 0.91 to 2.21; model/reference v3 1.34, v4 1.34 | ws2b -1.0 % (start-up window excluded, line-average scalings), ws2d +0.5 % (density controller); the v3 preset is unchanged |
| `W7X.HISS04` | W7-X 0D, tau_E/tau_ISS04 (flat top) † | 0.8281 | 0.8068 | -2.6 | Beurskens 2021: band 0.6 to 0.65, accepted 0.448 to 0.869 | steps: ws2b -2.6 % (of which about -2.0 % is the density basis, see the dagger, estimate; the rest the core-radiation loss power), ws2d -0.02 %. The v3 value on a line-average basis would be about 0.811 (estimate, not a run) |
| `W7X.Pfus` | W7-X 0D, P_fus (flat top), MW | 4.939e-5 | 4.722e-5 | -4.4 | none in references.ts | ws2b -4.5 % (core-radiation loss power, n-bar in ISS04); the Wave 2B density controller +0.1 %. v3 preset unchanged |

† and ‡: see section 2.

**Full-length DEMO presets.** The golden DEMO and DEMO15 cases are shortened (600 s, 500 s). The presets run 2000 s, and that is what
`npm run validate` checks and what the v3 README quoted (2.2 GW and 1.95 GW). These four rows are the only ones no golden file covers:
the v4 value is the time-weighted flat top of a run of the HEAD tree (DEMO 13 s, DEMO15 177 s), and the test checks that these
four are the only unchecked rows.

| ID | Quantity | v3.0.0 | v4 | Change % | Reference (references.ts) | Note |
|---|---|---|---|---|---|---|
| `X.DEMO.Pfus` | DEMO 0D, P_fus (flat top, full 2000 s preset), MW | 2204 | 1903 | -13.7 | Federici 2019: 2000 MW, accepted 1000 to 3000; model/reference v3 1.10, v4 0.952 | the same causes as `DEMO.Pfus`; the window is 1400 to 2000 s instead of 420 to 600 s |
| `X.DEMO.Q` | DEMO 0D, Q (flat top, full 2000 s preset) | 21.93 | 18.94 | -13.6 | no check in references.ts | the same causes as `DEMO.Q` |
| `X.DEMO15.Pfus` | DEMO 1.5D, P_fus (flat top, full 2000 s preset), MW | 1954 | 2007 | +2.7 | Federici 2019: 2000 MW, accepted 1000 to 3000; model/reference v3 0.977, v4 1.00 | the number `npm run validate` checks (its DEMO15.Pfus reads 2007.49 MW at HEAD, CHANGES 2026-10-01 13:54); v3 had the same gap between its 500 s and 2000 s runs (2268 and 1954 MW) |
| `X.DEMO15.Q` | DEMO 1.5D, Q (flat top, full 2000 s preset) | 19.56 | 20.10 | +2.8 | no check in references.ts | the same causes as `DEMO15.Q` |

## 4. How the moves add up

The states are the commits of `v4/integration` (first parent) that re-recorded the cases, read from `git show <commit>:test/golden/...`.
Values at states up to `4c0fdb7` (0D) and `0451434` (1.5D) are frame-weighted flat tops, from the ws2c merge `cad8a2a` on
time-weighted ones (the difference is in section 5, at most 0.3 % except T_ped). At the ws7a (`cf42433`), ws5s (`8a54de9`) and ws7b
(`3a9cdd9`) states no 0D value of these tables differs from the ws2c state.

### 4.1 0D presets

| State | ITER Q | ITER P_fus | ITER n/n_G | ITER Q_sci_max | JET E_fus | JET P_bt/P_fus | SPARC Q | DEMO Q | DEMO P_fus |
|---|---|---|---|---|---|---|---|---|---|
| v3 `1dc6d8a` | 13.98 | 715.5 | 0.8184 | 15.94 | 58.31 | 0.7594 | 6.921 | 21.82 | 2193 |
| ws2b `4c50fca` | 10.42 | 538.3 | 0.9194 | 13.69 | 64.15 | 0.7286 | 6.636 | 20.65 | 2078 |
| ws5b `4c0fdb7` | 10.13 | 523.4 | 0.9152 | 13.40 | 64.15 | 0.7302 | 6.590 | 20.13 | 2025 |
| ws2c `cad8a2a` | 10.04 | 513.7 | 0.8369 | 12.15 | 67.10 | 0.7174 | 7.558 | 18.27 | 1836 |
| ws2d `3fcf528` | 10.08 | 516.6 | 0.8483 | 12.74 | 66.64 | 0.7172 | 7.843 | 19.03 | 1912 |

| State | DIII-D P_alpha | DIII-D P_fus | MAST-U q95 | MAST-U P_fus | W7-X T_i(0) | W7-X P_fus |
|---|---|---|---|---|---|---|
| v3 `1dc6d8a` | 11.66 | 0.003822 | 34.33 | 6.374e-4 | 2.015 | 4.939e-5 |
| ws2b `4c50fca` | 0.002289 | 0.003485 | 18.18 | 5.585e-4 | 1.995 | 4.718e-5 |
| ws5b `4c0fdb7` | 0.002297 | 0.003462 | 18.18 | 5.579e-4 | 1.995 | 4.718e-5 |
| ws2c `cad8a2a` | 0.002549 | 0.003841 | 6.393 | 1.411e-4 | 1.995 | 4.718e-5 |
| ws2d `3fcf528` | 0.002551 | 0.003845 | 6.393 | 1.420e-4 | 2.004 | 4.722e-5 |

- **ITER Q 13.98 to 10.08.** ws2b and ws5b together are -27.5 % (13.98 to 10.13). The ws2b entry (2026-09-28 20:03) bisected the
  E_fus move on the 400 s shot: the loss power P_L = P_heat - P_rad,core(rho < 0.6) - dW/dt is -38 %, the ELM-averaged power 0.3 W/tau_E
  instead of 0.3 P_heat -4 %, tau_E and the L-H threshold at the line-average density +30 %. v3 booked about 32 MW of beam slowing-down
  power as alpha power (P_alpha 172.9 to 106.1 MW, the alpha share of P_fus 0.242 to 0.207; measured here with the validation formula),
  declared ignition at 385.6 s and issued a spurious IGNITION event at 14.5 s; all of that is gone. The ws5b part (-2.8 %, 10.42 to
  10.13) is not a change of the simulated state: that entry states that the run is bit-identical and that the frames at ELM crashes now
  carry the post-crash diagnostics, which flips the bias of the frame-weighted mean. The ledger describes each ws2b change as the
  correction of a bookkeeping or consistency defect, not a retune; this document did not re-audit that. ws2c (10.13 to 10.04) is, in its
  own measured order: time weighting +0.04 %, exact D-T energies +4.1 %, Miller volume with the LCFS shape -5.5 %, density target
  0.914e20 +0.7 %. ws2d +0.5 %: with the density controller the density sits on its target (n/n_G 0.837 to 0.848).
- **ITER n/n_G 0.818 to 0.848** is mostly a definition: ws2b +12.3 % is v3's volume average becoming the line average (x1.110).
- **JET E_fus 58.3 to 66.6 MJ.** ws2b +10.0 %, ws2c +4.6 % (Miller volume -3.5 %, exact D-T energies, the Ryter branch moves the first
  L-H from 0.34 to 0.44 s), ws2d -0.7 %. The JET preset is unchanged; the beam-target share 0.759 to 0.717 moves with ws2b (beam pool).
- **SPARC Q 6.92 to 7.84.** ws2b -4.1 %; ws2c +14.7 % is the Miller volume (the ellipse formula overestimated the volume by 8.6 %: Q
  6.63 to 7.54 in the ws2c ledger) with the exact D-T energies; ws2d +3.8 % (n/n_G 0.378 to 0.392, Q_sci_max 9.31 to 10.15).
- **DEMO Q 21.82 to 19.03 (600 s).** ws2b -5.3 % (no ignition is declared with NBI on any more: ignitionTime 575.9 to 0 s), ws5b -2.5 %,
  ws2c -9.2 % (ledger order: D-T energies +1.2 %, Miller volume and LCFS shape -2.1 %, density target 0.75e20 to 0.711e20 -8.4 %),
  ws2d +4.1 %.
- **DIII-D P_alpha 11.66 to 0.00255 MW** is bookkeeping (ws2b D1): v3 counted the 11.67 MW of beam heating as alpha power. The
  charged D-D products are all that P_alpha holds now; beam heating is a separate diagnostic (`P_beam_heat`).
- **MAST-U** q95 34.33 to 18.18 at ws2b (Sauter 2016 low-aspect-ratio fit) and to 6.393 at ws2c, where the preset became the
  first-campaign scenario (R 0.8 m, a 0.5 m, kappa 2.1, 0.75 MA, 0.55 T, 2 MW instead of R 0.85, a 0.65, kappa 2.5, 1 MA, 0.75 T,
  5 MW); the published band is 5 to 10.
- **W7-X** moves by -4.4 % in P_fus (ws2b: core-radiation loss power and n_bar in ISS04) and +0.5 % in T_i(0) (ws2d); its preset is unchanged.

### 4.2 1.5D presets

| State | ITER15 Q | P_fus | f_bs | l_i(3) | T_ped | n/n_G | q95 |
|---|---|---|---|---|---|---|---|
| v3 `1dc6d8a` | 9.755 | 490.6 | 0.2234 | 0.7255 | 3.700 | 0.8054 | 3.475 |
| ws4 `af38dbe` | 9.766 | 491.1 | 0.2237 | 0.7266 | 3.708 | 0.8054 | 3.473 |
| ws3 `fca4643` | 9.744 | 490.1 | 0.2235 | 0.7241 | 3.716 | 0.8055 | 3.473 |
| ws3d `0451434` | 10.34 | 519.8 | 0.2300 | 0.7243 | 3.739 | 0.8052 | 3.479 |
| ws2c `cad8a2a` | 10.41 | 523.2 | 0.2309 | 0.7242 | 3.628 | 0.8052 | 3.479 |
| ws7a `cf42433` | 10.40 | 522.6 | 0.2310 | 0.7242 | 3.670 | 0.8052 | 3.478 |
| ws4i `a7332e3` | 10.40 | 522.7 | 0.2306 | 0.7183 | 3.788 | 0.8047 | 3.507 |
| ws3s `7d8d92d` | 10.70 | 537.9 | 0.2313 | 0.7291 | 3.491 | 0.7999 | 3.504 |
| ws6c `3fcf528` | 10.71 | 538.8 | 0.2315 | 0.7284 | 3.492 | 0.7999 | 3.501 |
| mix `7a8c81d` | 10.69 | 537.7 | 0.2314 | 0.7281 | 3.493 | 0.7998 | 3.503 |
| ntmfl `595216c` | 10.45 | 525.6 | 0.2306 | 0.7195 | 3.549 | 0.8000 | 3.503 |

| State | JET15 E_fus | JET15 P_bt/P_fus | JET15 T_i(0) | SPARC15 Q | SPARC15 P_fus | DEMO15 Q | DEMO15 P_fus |
|---|---|---|---|---|---|---|---|
| v3 `1dc6d8a` | 84.57 | 0.6402 | 10.07 | 6.088 | 156.3 | 22.72 | 2268 |
| ws4 `af38dbe` | 84.76 | 0.6378 | 10.14 | 6.087 | 156.3 | 22.76 | 2272 |
| ws3 `fca4643` | 85.41 | 0.6370 | 10.17 | 6.087 | 156.3 | 22.74 | 2270 |
| ws3d `0451434` | 82.35 | 0.6360 | 10.15 | 6.319 | 162.1 | 23.26 | 2322 |
| ws2c `cad8a2a` | 81.59 | 0.6359 | 10.14 | 6.345 | 162.7 | 23.46 | 2342 |
| ws7a `cf42433` | 81.28 | 0.6369 | 10.11 | 6.345 | 162.7 | 23.41 | 2337 |
| ws4i `a7332e3` | 81.17 | 0.6385 | 10.09 | 6.318 | 162.0 | 23.48 | 2345 |
| ws3s `7d8d92d` | 82.00 | 0.6340 | 10.17 | 6.290 | 161.6 | 23.50 | 2346 |
| ws6c `3fcf528` | 81.84 | 0.6332 | 10.20 | 6.289 | 161.5 | 23.47 | 2343 |
| mix `7a8c81d` | 81.84 | 0.6332 | 10.20 | 6.289 | 161.5 | 23.47 | 2343 |
| ntmfl `595216c` | 81.84 | 0.6332 | 10.20 | 6.289 | 161.5 | 23.47 | 2343 |

- **ITER15 Q 9.755 to 10.45 (+7.1 %).** ws3d +6.1 %: the 1.5D loss power became P_L = P_heat - P_rad,core - dW/dt (ledger: +6.0 % from
  that change alone; P_L 117 to 130 MW, tau_E 2.55 to 2.36 s, L-H at 8.5 s instead of 6.5 s through the Ryter branch), with the
  fast-ion pools and per-channel sources. ws2c +0.7 % (exact D-T energies). ws3s +2.8 % (ledger: packed grid +2.2 %, the rest TR-BDF2 with
  localised events, the Hinton-Hazeltine form of the current diffusion and the initial current). ws6c +0.2 % (conservative remap),
  mix -0.2 %, ntmfl -2.3 % (the saturated (3,2) island w/a 0.0846 to 0.0881: the corrected flattening makes the 50-cell run behave
  like the old 100-cell run). The steps are consecutive integration states and multiply to the total exactly; the causes inside a step are the ledger's, measured on the lane's own base.
- **Quantities that moved less than the noise of the chain:** f_bs (+3.2 %, of which ws3d +2.9 %), q95 (+0.8 %, ws4i +0.9 % from
  the edge-clustered surface table), l_i(3) (-0.8 %: ws4i -0.8 %, ws3s +1.5 %, ntmfl -1.2 %). T_ped swings by -3.0 %, +1.2 %, +3.2 %,
  -7.8 % at ws2c, ws7a, ws4i, ws3s: only the ws3s step has a ledger cause (the packed grid); T_ped is grid-dependent and not
  converged to 1 % (CHANGES 2026-10-01 13:54).
- **JET15 E_fus 84.57 to 81.84 MJ:** ws3d -3.6 % (dW/dt in the loss power: the ramp-up W follows tau_E, burn time 0.247 to 0 s), ws2c
  -0.9 %, ws3s +1.0 %; it stays a known failure (59 +/- 6 MJ, accepted 40 to 80).
- **SPARC15 Q +3.3 %** is ws3d +3.8 % (L-H at 1.50 s instead of 0.81 s through the Ryter branch, higher loss power); **DEMO15 +3.3 %**
  is ws3d +2.3 % and ws2c +0.8 %.
- **Events (ITER15, measured here, v3 against v4):** L-H 6.5 s to 8.3 s, first sawtooth crash 81.0 s to 46.8 s, NTM onset 81.2 s to
  47.0 s, ELMs 1022 to 1317, sawtooth events 25 to 62, saturated island w/a 0.0840 to 0.0882. The ws6c remap accounts for 65.2 s to 46.8 s (Wave 2B report 7.1(iv), default ITER15); the move from 81.0 s to 65.2 s happened before the
  Wave 2B merges (the Wave 1 report ties the rise of the sawtooth count 25 to 38 to the ws3 cell volumes and to ws3d) and is not split here.

### 4.3 What the preset inputs did

`git diff v3.0.0 HEAD -- src/physics/presets.ts` shows these changes that reach the plasma (the others are comments, the systems and
magnet entries of the engineering report, and the v3 1.5D density targets, which ITER15 and DEMO15 keep). The right-hand column was
measured here: the v4 code run on the v3 preset configuration (taken from the v3 tree as JSON) against the v4 preset.

| Preset | Input change since v3.0.0 | v4 code, v3 input to v4 input |
|---|---|---|
| JET, JT-60SA, DIII-D, W7-X, SPARC, JET15, SPARC15, ITER15, DEMO15 | none that reaches the plasma (SPARC: TF leg and gap, systems keys: engineering only) | every flat-top key bit-identical (Q_eng and the engineering block differ where a preset gained systems entries: SPARC, SPARC15, ITER15, DEMO15) |
| ITER 0D | n_target 1.0e20 to 0.914e20 (volume average, design n/n_G 0.85); LCFS shape kappa 1.85, delta 0.49 (the 0D volume and surface follow the Miller LCFS) | Q 12.17 to 10.08 (-17.2 %), P_fus 625.3 to 516.6 MW; in steps: density target 12.17 to 11.31 (-7.1 %), then the LCFS shape 11.31 to 10.08 (-10.9 %). In the other order, the LCFS shape with the old target 1.0e20 does not burn at all (Q 0.0042, E_fus 541 MJ): not analysed |
| DEMO 0D (600 s) | n_target 0.75e20 to 0.711e20; LCFS shape kappa 1.85, delta 0.5; TF leg and gap, systems keys | Q 21.46 to 19.03 (-11.3 %), P_fus 2158 to 1912 MW; density target 21.46 to 19.57 (-8.8 %), then the LCFS shape 19.57 to 19.03 (-2.8 %) |
| MAST-U 0D | R 0.85 to 0.8 m, a 0.65 to 0.5, kappa 2.5 to 2.1, delta 0.5 to 0.47, B0 0.75 to 0.55 T, I_p 1.0 to 0.75 MA, NBI 5 to 2 MW | P_fus 6.507e-4 to 1.420e-4 MW (-78.2 %), q95 18.18 to 6.393, Q 1.363e-4 to 6.99e-5 |
| NIF | DT ice mass 220 to 210 ug | G 0.8426 to 0.6684 (-20.7 %) |
| NIF210808 | new preset (1.917 MJ laser light, ablator mass 3745 ug) | the calibration shot, G 0.7148 |

Reading the first two rows with the staircase: for ITER and DEMO the v4 code on the v3 input is -12.9 % and -1.6 % from v3 (ITER
Q 13.98 to 12.17, DEMO Q 21.82 to 21.46); the preset effect is the rest. The split depends on the order (effects of a code and an input
change are not additive), and it is measured on the final code, whereas the ledger's ws2c breakdown (section 4.1) is measured on the code of that day.

### 4.4 NIF

The ICF model has one tuned constant, `ICF_CAL` (the factor from geometric to effective areal density at stagnation). In v3 it was 0.07 with
a source comment saying it was tuned to NIF (in Turkish), and the ledger (2026-10-01 07:49) states it was tuned to the N221204 preset (G about 1.5), so the
v3 agreement 1.489 against 1.5 was a fit and not a test. v4 fits the constant to the yield of N210808 alone (1.37 MJ): `ICF_CAL` 0.03931,
and predicts N221204 and N230729 blind. Measured here with the v4 code: the constant alone (with the v3 ice mass 220 ug) gives G 0.8426
(-43.4 %); the ice mass 210 ug (the preset's value since the calibration) then gives 0.6684 (-20.7 %). No other lane moved an ICF number (ws2b:
Q_eng only). Blind results with this calibration: N221204 G 0.668 against 1.5 (0.446), N230729 G 0.668 against 1.89 (0.354), both
known failures; the model has no input that separates the three shots (the ledger's wording). v3 had one yield for every shot of the NIF capsule (3.05 MJ; the model yield does not depend on the laser energy, ledger); the N210808 model value 1.3699 MJ against the published 1.37 MJ is the calibration target and no
evidence. The hot-spot temperature of the report fell from 7.10 to 1.32 keV because the model now puts the N221204 capsule 5 % below its own ignition
threshold (chi_ig 0.951); the cliff constants were not part of the calibration (ledger).

## 5. The flat-top definition

v3 weights frames, v4 time. This table repeats the flat-top rows with both weightings on both versions; the v3 time and v4 frame columns
are measured here (not golden values); the v3 frame column is the main table's v3 column and the v4 time column is the golden value
(the test checks both). Frame-to-frame and time-to-time are the changes that leave the definition fixed.

| ID | v3 frame | v3 time | v4 frame | v4 time | frame to frame % | time to time % |
|---|---|---|---|---|---|---|
| `ITER.Q` | 13.98 | 14.00 | 10.09 | 10.08 | -27.8 | -28.0 |
| `ITER.Pfus` | 715.5 | 716.6 | 516.7 | 516.6 | -27.8 | -27.9 |
| `ITER.nG` | 0.8184 | 0.8186 | 0.8483 | 0.8483 | +3.7 | +3.6 |
| `JET.btShare` | 0.7594 | 0.7594 | 0.7172 | 0.7172 | -5.6 | -5.6 |
| `JET15.btShare` | 0.6402 | 0.6402 | 0.6330 | 0.6332 | -1.1 | -1.1 |
| `JET15.Ti0` | 10.07 | 10.07 | 10.20 | 10.20 | +1.3 | +1.3 |
| `SPARC.Q` | 6.921 | 6.921 | 7.842 | 7.843 | +13.3 | +13.3 |
| `SPARC.Pfus` | 181.8 | 181.8 | 205.0 | 205.0 | +12.8 | +12.8 |
| `SPARC15.Q` | 6.088 | 6.088 | 6.289 | 6.289 | +3.3 | +3.3 |
| `SPARC15.Pfus` | 156.3 | 156.3 | 161.5 | 161.5 | +3.3 | +3.3 |
| `DEMO.Pfus` | 2193 | 2198 | 1916 | 1912 | -12.6 | -13.0 |
| `DEMO.Q` | 21.82 | 21.87 | 19.07 | 19.03 | -12.6 | -13.0 |
| `DEMO15.Pfus` | 2268 | 2268 | 2342 | 2343 | +3.2 | +3.3 |
| `DEMO15.Q` | 22.72 | 22.72 | 23.46 | 23.47 | +3.3 | +3.3 |
| `ITER15.Q` | 9.755 | 9.753 | 10.45 | 10.45 | +7.1 | +7.2 |
| `ITER15.Pfus` | 490.6 | 490.6 | 525.6 | 525.6 | +7.1 | +7.1 |
| `ITER15.fbs` | 0.2234 | 0.2232 | 0.2306 | 0.2306 | +3.2 | +3.3 |
| `ITER15.li` | 0.7255 | 0.7254 | 0.7195 | 0.7195 | -0.8 | -0.8 |
| `ITER15.Tped` | 3.700 | 3.613 | 3.654 | 3.549 | -1.2 | -1.8 |
| `ITER15.nG` | 0.8054 | 0.8054 | 0.7999 | 0.8000 | -0.7 | -0.7 |
| `ITER15.q95` | 3.475 | 3.475 | 3.503 | 3.503 | +0.8 | +0.8 |
| `MASTU.H98` | 1.518 | 1.518 | 0.9154 | 0.9154 | -39.7 | -39.7 |
| `MASTU.q95` | 34.33 | 34.33 | 6.393 | 6.393 | -81.4 | -81.4 |
| `MASTU.Pfus` | 6.374e-4 | 6.373e-4 | 1.420e-4 | 1.420e-4 | -77.7 | -77.7 |
| `DIIID.H98` | 1.012 | 1.012 | 0.8826 | 0.8826 | -12.8 | -12.8 |
| `DIIID.Palpha` | 11.66 | 11.66 | 0.002551 | 0.002551 | -100.0 | -100.0 |
| `DIIID.Pfus` | 0.003822 | 0.003822 | 0.003845 | 0.003845 | +0.6 | +0.6 |
| `W7X.Ti0` | 2.015 | 2.015 | 2.004 | 2.004 | -0.5 | -0.5 |
| `W7X.HISS04` | 0.8281 | 0.8281 | 0.8068 | 0.8068 | -2.6 | -2.6 |
| `W7X.Pfus` | 4.939e-5 | 4.939e-5 | 4.722e-5 | 4.722e-5 | -4.4 | -4.4 |

The definition moves a row by at most 0.3 % (DEMO, ITER) except ITER15 T_ped: -2.35 % in v3 (3.700 to 3.613 keV) and -2.89 % in v4
(3.654 to 3.549 keV), because the ELM-crash frames recorded in the 1.5D history carry a sampled pedestal. Of the -4.1 % in the main table
about -2.4 to -2.9 points are the definition; the move at fixed definition is -1.2 % (frame) or -1.8 % (time).

## 6. Run time

One run per entry on this machine (shared with another agent's work, so load-dependent), Node v24.19.0, wall time of the constructor and
`runAll()` in one process; steps are the model's accepted steps.

| Case | v3.0.0 | v4 HEAD | Steps v3 to v4 | Other records |
|---|---|---|---|---|
| ITER15, 400 s | 5.3 s | 27.8 s (x5.2) | 9691 to 20903 (x2.2) | `bench/perf-baseline.json` 23.76 s (median of 3, idle, Ryzen 5 5600, 2026-09-29, Wave 2A gate; 8.88 s under load at Wave 1); the v3 technical report says about 4.5 s |
| DEMO15, 500 s (golden case) | 8.1 s | 40.7 s (x5.0) | 13175 to 33052 (x2.5) | |
| DEMO15, 2000 s (preset) | 35.5 s | 177.2 s (x5.0) | 51388 to 132437 (x2.6) | `bench/perf-baseline.json` 139.5 s (62.7 s at Wave 1); the v3 technical report says about 40 s |
| ITER 0D, 400 s | 2.2 s | 2.3 s | 12202 to 11162 | `bench/perf-baseline.json` 2.00 s |
| DEMO 0D, 2000 s (preset) | 12.0 s | 13.1 s | 53474 to 50292 | |

The 1.5D model takes 1.1 to 3.4 times the steps (2.2 times for ITER15 here) at about 2.4 times the time per step (here: 0.55 ms to 1.33 ms; the
Wave 2A report says about 3 times the work per step). The cause is the TR-BDF2 solver with error control and event localisation of ws3s
(the Wave 2A report, section 0 and 1); the split between more steps and costlier steps is measured here, the reason for the costlier
step (two stages, Newton and Anderson iterations) is a hypothesis of this document. The 0D model did not change in cost. Other
v3 timing claims: `npm run validate` about 45 s on 11 workers (v3 README), against a validation step of 280.1 s in the Wave 2B gate
(`ci:local` with `CI_LOCAL_THREADS=2` on a shared machine); `npm run figures` about 55 s (v3), about 4 min at 2 threads (Wave 2A report, section 9).

## 7. What v3 claimed that v4 no longer supports

From the published `README.md` and `docs/technical-report.md` of v3.0.0 (`eb97a6d`; both are in Turkish with an English abstract, so the
claims below are translated and paraphrased, not quoted). At HEAD both still carry these v3 numbers (the
README "Validation summary", the technical report abstract and section 7): updating them is the next Wave 3 step; this document is
their source.

| v3 claim (where) | v4 | Status |
|---|---|---|
| ITER Q (flat top) 14.0 (0D) and P_fus 715 MW (README table, technical report section 7: Q/ref 1.40, P_fus/ref 1.43) | 10.08 and 516.6 MW (1.01 and 1.03 of the references) | no longer true; the v3 0D value came from the power balance the ws2b lane corrected |
| The 1.5D model lowers the 0D overprediction (Q about 14) to 9.8, because the 3/2 NTM and the profile effects (pedestal, current diffusion) lower the confinement (technical report section 7, the paragraph "Yorum") | 0D 10.08, 1.5D 10.45: the 1.5D is 3.5 % above the 0D | the explanation is not supported; the gap was in the 0D balance |
| ITER 1.5D Q 9.8, P_fus 491 MW, f_bs 0.22, l_i(3) 0.73, q95 3.5 (README, technical report abstract) | 10.45, 525.6 MW, 0.231, 0.719, 3.503 | numbers moved (section 4.2); the abstract's Q = 9.8 is no longer the model's value |
| ITER T_e,ped 0.82 of 4.5 keV (technical report) | 3.549 keV, 0.789 of 4.5 | the model/reference ratio got worse; T_ped is grid-dependent at +/- 1 % |
| ITER15 time traces: L-H about 6.5 s, NTM onset about 81 s, 1022 ELMs, 24 sawteeth, island w/a about 0.084 (figure 3 caption, text) | L-H 8.3 s, NTM onset 47.0 s, 1317 ELMs, 62 sawtooth events, w/a 0.088 (measured here at HEAD; v3's own run: 6.5 s, 81.2 s, 1022, 25 events) | figure and caption are stale |
| JET E_fus 58 MJ in 0D (0.99 of 59 MJ) and 85 MJ in 1.5D (+43 %) (README, technical report) | 66.6 MJ (1.13) and 81.8 MJ (1.39, a known failure) | the 0D agreement is gone, still inside the accepted 40 to 80 MJ |
| About 60 % of the 1.5D fusion comes from NBI beam-target reactions, qualitatively consistent with TRANSP analyses (README footnote, technical report section 7) | the model gives 63.3 % in 1.5D, 71.7 % in 0D (v3: 64.0 %, 75.9 %) | the model number holds; references.ts has no check and no source for the TRANSP comparison, so it is not a validation |
| SPARC P_fus 182 MW (0D) and 157 MW (1.5D) against 140 MW; Q 0.63 and 0.55 of 11 | 205.0 and 161.5 MW (1.46 and 1.15 of 140 MW); Q 0.71 and 0.57 of 11 | further from the 140 MW the v3 README quoted (references.ts has no P_fus check) |
| EU DEMO P_fus 2.2 GW (0D) and 1.95 GW (1.5D) | 1.90 GW and 2.01 GW (full 2000 s runs, `X.*` rows) | moved by -13.7 % and +2.7 % |
| NIF N221204 gain: reference 1.54, model 1.49 (0.97), presented as a validation (README table, technical report abstract and section 7) | 0.668 against 1.5 | `ICF_CAL` was tuned to N221204: not a validation; v4 calibrates on N210808 and misses N221204 blind (section 4.4) |
| `npm run validate`: 25 presets, 19 literature checks, all pass (README, technical report section 7) | 22 presets (the v3 source had 21), 46 rows in `REFERENCE_CHECKS` at HEAD, 8 of them documented known failures; the Wave 2B gate recorded 36 passed, 6 known failures, 0 unexpected | the v3 range of ITER Q_sci_max was 8 to 40; the 25 presets was a v3 README error |
| ITER beta_N 1.87 (0D), 1.48 (1.5D) (technical report) | 1.68 and 1.73 | the fast-ion pressure is counted since ws2b (0D, where the lower thermal energy outweighs it) and ws3d (1.5D, where it adds) |
| `npm test`: 44 unit tests (README) | 3656 tests in 278 files (Wave 2B gate) | |
| ITER 1.5D 400 s about 4.5 s, DEMO 1.5D 2000 s about 40 s, validate about 45 s, figures about 55 s (technical report section 9) | 5.3 s and 35.5 s (v3, measured here); 27.8 s and 177.2 s (v4) | section 6 |

## 8. Moves not fully attributed, and open issues

Not fully attributed (what is known is in the row or the section named):

1. **ITER15 T_ped (-4.1 %)**: about -2.4 to -2.9 points is the flat-top definition (section 5); the ws3s step (-7.8 %) is the packed
   grid by the ledger's account, but the +/- 3 % swings at ws2c (-3.0 %), ws7a (+1.2 %) and ws4i (+3.2 %) have no ledger cause, and
   T_ped is not converged to 1 % in the grid.
2. **ITER15 n/n_G (0.8054 to 0.8000)** and the fact that the flat top sits at 0.80 while the density target is 0.837 (v3 too): the move
   appears at the ws3s merge (-0.6 %); no ledger cause; not analysed.
3. **JET15 beam-target share (-1.1 %), T_i(0) (+1.3 %)**: small steps (below 1 % each) with the lane list as the only cause.
4. **The ws2c step of the 0D rows** mixes five changes whose own breakdown the ledger gives for ITER, DEMO and SPARC only (section
   4.1); for JET, DIII-D, JT-60SA the ledger gives the Miller volume and the D-T energies as the causes without the split.
5. **DIII-D H98 (-12.8 %) and W7-X tau_E/tau_ISS04 (-2.6 %)**: the density basis of the reference formula is about -4.2 % and about -2.0 %
   (estimates); the rest is tau_E at ws2b, which the ledger bisects for ITER only.
6. **The ITER15 first sawtooth crash (81.0 s in v3, 46.8 s in v4)**: ws6c accounts for 65.2 to 46.8 s (Wave 2B report); the move 81.0 to
   65.2 s sits between v3 and the Wave 2A gate and is not split.
7. **The 1.5D run time**: the split between steps and cost per step is measured (section 6), the reason for the cost per step is a
   hypothesis.
8. **ITER 0D with the LCFS shape and the v3 density target 1.0e20** does not burn in the v4 code (Q 0.0042). Not analysed. It is a
   sensitivity of the 0D L-H access to the density target, found while separating the inputs.

Open issues for the integrator:

- `README.md` (Validation summary) and `docs/technical-report.md` (abstract, sections 7 and 9, figure 3 caption) still carry the v3 numbers
  of section 7 above; `docs/figures` too.
- `numbersDiff.test.ts` pins the v4 column: any later golden re-record that moves one of these numbers fails it until this document
  is updated (that is its purpose).
- The `X.*` rows are not golden-covered and can go stale; a golden case for the full DEMO15 preset would cost about 3 minutes.
- The v3 value of the derived rows (`†`) uses the volume-average fallback; if the integrator prefers like-for-like, the estimates in
  section 2 can be promoted to rows.
- Timings are single runs on a shared machine; the Wave 2A idle record (23.76 s for ITER15) is the better v4 number.

## 9. Reproduction

v3 side (nothing in the v3 tree is modified):

```sh
git worktree add --detach "$TEMP/v3.0.0" v3.0.0                        # then link node_modules into it
cd "$TEMP/v3.0.0" && npx tsx measure.ts                                 # measure.ts below, one case per call
```

```ts
import { PRESETS } from './src/physics/presets';
import { Simulation } from './src/physics/simulation';
const p = PRESETS.find((x) => x.id === 'ITER')!;                        // DEMO: { ...p.cfg, t_end: 600 }, DEMO15: t_end 500
const sim = new Simulation(p.cfg);
const report = sim.runAll();                                            // report.E_fusion_MJ, report.Q_sci_max, ...
const h = sim.history, i0 = Math.floor(h.length * 0.7);                 // the v3 flat top: frames i0 to the end
const flat = (k: string) => { let s = 0, n = 0; for (let i = i0; i < h.length; i++) { const v = h[i].d[k]; if (Number.isFinite(v)) { s += v; n++; } } return n ? s / n : NaN; };
console.log(flat('Q'), flat('P_fus'), report.E_fusion_MJ);
```

v4 side: the golden files, `npm run golden` (all 40 cases at 1e-9), or the same script on HEAD with
`flatTopAverages(sim.history, { weighting: 'time' })` from `src/physics/analysis/flatTop.ts` (`'frame'` gives the v3 definition).
The staircase tables are `git show <commit>:test/golden/<case>.json` at the commits named in the tables. The v4-code-on-v3-input runs
feed the preset configuration of the v3 tree (as JSON) to `new Simulation` of HEAD. The scratch files of this measurement
(`scratch/claude-nd-*`, not committed: the folder is ignored) hold the raw outputs of every number marked "measured here".
Single machine (Node v24.19.0, Windows), one seed per case (the preset seeds).
