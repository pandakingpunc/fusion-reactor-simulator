---
title: 'Fusion Reactor Simulator: a deterministic, browser-native 0D and 1.5D simulator for fusion education and scenario exploration'
tags:
  - fusion
  - tokamak
  - plasma physics
  - transport modelling
  - TypeScript
  - reproducibility
authors:
  - name: Mustafa Karatum
    affiliation: 1
affiliations:
  - name: Independent researcher
    index: 1
date: 1 October 2026
bibliography: paper.bib
---

<!--
  Numbers: every measured number below sits between a num marker pair (an HTML comment with the key, see scripts/paper-numbers.ts) and is checked
  against its source by `npm run paper:numbers`; citations, the bibliography and the word count are checked by `npm run paper:check`.
  Comments marked OWNER-CONFIRM name facts that only the author can confirm (paper/READINESS.md lists them).
-->

# Summary

Fusion Reactor Simulator is an open-source (MIT) program that follows a fusion plasma in time and reports fusion power, gain $Q$, confinement, bootstrap fraction and the events that interrupt a pulse. A zero-dimensional (0D) power balance covers tokamaks, stellarators, laser fusion, magnetised-target schemes, field-reversed configurations, mirrors and muon-catalysed fusion. For tokamaks, a reduced 1.5D model evolves electron and ion temperatures, density and poloidal flux on the normalised toroidal-flux radius, coupled to a fixed-boundary Grad–Shafranov equilibrium, with sawteeth, edge-localised modes (ELMs) and neoclassical tearing modes. The models run in a web browser, as a TypeScript library, in a command-line tool and through a Python wrapper. The software ships <!--num:PRESETS.count-->22<!--/num--> presets (ITER, JET, SPARC, EU DEMO, W7-X, NIF and others) and <!--num:GOLDEN.count-->40<!--/num--> golden regression cases, and is archived on Zenodo [@karatum2026]. It serves education, pre-conceptual design and scenario exploration; it does not replace integrated modelling.

# Statement of need

Established codes cover parts of this space. PROCESS [@kovari2014; @kovari2016] is a steady-state systems code that finds self-consistent, optionally optimised power-plant parameters. cfspopcon [@body_cfspopcon] computes plasma operating contours, a method going back to @houlberg1982. FreeGS [@freegs] and FreeGSNKE [@amorisco2024] solve the free-boundary Grad–Shafranov problem, the latter in time. TORAX [@citrin2024] is a differentiable core-transport simulator in JAX that couples to machine-learned models. METIS [@artaud2018], closest in spirit, combines scaling-law-normalised 0D transport with 1D current diffusion and 2D equilibria in MATLAB.

This code differs in three ways. It runs where nothing is installed: interface, guided missions and every model run in a browser. It is deterministic: one configuration and seed give byte-identical output carrying the version, concept DOI, git commit and configuration hash, and uncertainty ensembles give the same result on any number of worker threads. Its models are deliberately reduced: transport coefficients are constrained by an energy-confinement scaling instead of computed from turbulence.

It replaces none of those codes: it has no free-boundary solver, turbulence surrogate or nonlinear MHD, and its engineering and optimisation modules are far simpler than PROCESS. It targets students, teachers and researchers who want quick, scriptable, reproducible scans and uncertainty analyses before heavier codes. <!-- OWNER-CONFIRM: no publication known to the author uses the software --> No publication is known to use it yet, so its research significance is prospective.

# Functionality

The 0D model integrates the power balance with an adaptive Dormand–Prince scheme, Bosch–Hale reactivities [@bosch1992], IPB98(y,2) confinement [@ipb1999] and an L–H threshold scaling [@martin2008]. The 1.5D model solves finite-volume transport on an edge-packed grid with TR-BDF2 [@bank1985], error control and event localisation, Hinton–Hazeltine current diffusion [@hinton1976], Sauter bootstrap current [@sauter1999] and a Miller boundary [@miller1998]. Sawteeth follow Kadomtsev reconnection, tearing modes the modified Rutherford equation [@lahaye2006]. Opt-in modules add an EPED1-type pedestal [@snyder2011], impurities and fast ions. Tools for scans, uncertainty quantification, optimisation, figures (SVG, PDF) and data export (G-EQDSK, NetCDF) surround the physics.

# Verification and validation

*Verification.* The Grad–Shafranov solver converges at order <!--num:VER.GS-->2.05<!--/num--> against the exact Solov'ev solution, the finite-volume heat solver at <!--num:VER.FV-->1.94<!--/num--> and backward Euler at <!--num:VER.BE-->0.99<!--/num-->. For ITER in 1.5D, going from <!--num:CONV.cells.base-->50<!--/num--> to <!--num:CONV.cells.fine-->100<!--/num--> radial cells changes the flat-top $Q$ by <!--num:CONV.Q-->0.57<!--/num--> % but the pedestal temperature by <!--num:CONV.Tped-->1.10<!--/num--> %, which oscillates with the grid and misses the <!--num:CONV.target-->1<!--/num--> % target.

*Validation.* `npm run validate` compares <!--num:VAL.checks-->46<!--/num--> outputs with published values that carry DOIs. Accepted ranges come from published uncertainties and a stated tolerance, never from the model. In <!--num:VAL.inrange-->38<!--/num--> checks the model is within range; <!--num:VAL.known-->8<!--/num--> are documented known failures. A deviation above <!--num:VAL.threshold-->20<!--/num--> % is reported as "benchmarked", not "validated": <!--num:VAL.validated-->16<!--/num--> checks are validated, <!--num:VAL.benchmarked-->16<!--/num--> benchmarked, <!--num:VAL.calibrated-->1<!--/num--> is the calibration shot and <!--num:VAL.sanity-->13<!--/num--> are sanity bounds. The ITER 1.5D flat top gives $Q$ = <!--num:ITER15.Q-->10.45<!--/num--> and <!--num:ITER15.Pfus-->526<!--/num--> MW against the design values <!--num:ITER15.Q.ref-->10<!--/num--> and <!--num:ITER15.Pfus.ref-->500<!--/num--> [@shimada2007], a benchmark, not a measurement.

*Known failures and limits.* The inertial-fusion model has one constant, fitted to NIF shot N210808 [@abushawareb2022]; its blind predictions for N221204 [@abushawareb2024] and N230729 [@kritcher2024] reach <!--num:NIF.N221204.ratio-->0.45<!--/num--> and <!--num:NIF.N230729.ratio-->0.35<!--/num--> of the published gains, as the model has no input that separates the shots. The 1.5D JET yield is <!--num:JET15.Efus-->81.8<!--/num--> MJ against <!--num:JET15.Efus.ref-->59<!--/num--> ± <!--num:JET15.Efus.unc-->6<!--/num--> MJ [@maslov2023], <!--num:JET15.Efus.dev-->39<!--/num--> % too high; the thermal share of fusion power is <!--num:JET.thermal-->36.7<!--/num--> % against a trend of about <!--num:JET.trend-->50<!--/num--> % [@stancar2023], so the JET #99971 split stays open. The EPED1-type pedestal exceeds the EPED prediction [@snyder2011] by <!--num:EPED.p-->21.1<!--/num--> % in pressure and <!--num:EPED.T-->15.4<!--/num--> % in temperature, against a <!--num:EPED.target-->15<!--/num--> % target. Emergent H98 of the predictive closures lies in <!--num:H98.lo-->0.8<!--/num-->–<!--num:H98.hi-->1.2<!--/num--> for one of six cases (<!--num:H98.jet15-->1.02<!--/num-->); the other five span <!--num:H98.min-->0.29<!--/num--> to <!--num:H98.max-->0.70<!--/num-->. The Kadomtsev model is outside its premise for a hollow-core $q$ profile, and density control within about <!--num:NG.band-->2<!--/num--> % of the Greenwald limit is stochastic.

# AI usage disclosure

Most of the code, tests and documentation were written by AI coding assistants under the author's direction: Claude Code (Opus 5.5 and Sonnet 5.5, Anthropic), Codex (GPT-6 and GPT-6.1 models, OpenAI) and MiMo (MiMo-V2.6-Pro); commit trailers name the tool of each commit. The author set the scope, chose the models, literature values and tolerances, directed each work package, decided what to merge, and is responsible for the software and this paper. <!-- OWNER-CONFIRM: that Claude Code drafted this paper and that the author reviewed and edited it --> The paper was drafted by Claude Code from the repository's records; a script inserts and checks its numbers against the golden files and validation output. Correctness rests on automated and AI-assisted checks: unit tests with analytic and manufactured solutions, an append-only golden ledger that attaches a reason to every change of a number, independent review of each work package by a separate AI session, and literature ranges never fitted to the model. These checks do not replace review by plasma physicists, which the author invites.

# Acknowledgements

The author thanks the maintainers of TypeScript, React, Vite and Vitest, and the authors of the published values used here. <!-- OWNER-CONFIRM: funding statement --> No external funding supported this work.

# References
