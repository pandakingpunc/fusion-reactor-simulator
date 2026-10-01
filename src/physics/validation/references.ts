/**
 * Literature reference table for `npm run validate`: every check compares one model output of one
 * preset with a published value. The table is data only (no Node APIs), so the CLI, the tests and a
 * future docs generator (`validate --markdown`) share it.
 *
 * Kinds
 *   validation  a measured experimental value (or a record) of the device the preset describes
 *   benchmark   a published design-scenario prediction, integrated-modelling result or empirical
 *               scaling evaluated for the preset (no measurement exists, or the preset is a design)
 *   sanity      a physical bound or an order-of-magnitude comparison where no firm reference exists
 *
 * Acceptance policy. An accept range is derived from the literature, never fitted to the model output:
 * the published band — the published value with its published uncertainty, or the spread of the
 * published predictions (`band`) — widened by a reduced-model tolerance where a 0D/1.5D model cannot be
 * expected to be closer. The policy tolerances (`tolerance`), with their origin, are:
 *   confinement (τ_E, W, H98)  ×/÷ exp(2·0.145) = ×/÷ 1.34: twice the RMS log error of the IPB98(y,2)
 *                              fit to the ITPA ELMy H-mode database (ITER Physics Basis 1999, ch. 2)
 *   temperature                ±30 % (prescribed profile peaking and single-fluid energy balances)
 *   yield (fusion yield of a   ×/÷ 3: the D-D/D-T reactivity scales roughly as T^3–4 at 2–5 keV,
 *   pulsed ICF/MIF plasma)     so ±30 % in temperature is about a factor 3 in yield
 *   gain (Q or G)              ×/÷ 2 (Q grows faster than τ_E² near Q ≈ 10)
 * For these four the range is exactly {@link widen}(tolerance, {@link publishedBand}), rounded outward
 * to three significant digits; references.test.ts recomputes it, so a hand-typed range cannot drift
 * from the policy. A check whose range does not follow from one of them (a design requirement, a
 * physical bound, a ±2σ interval, a tolerance of its own) has tolerance 'stated', and its `basis` gives
 * the numbers. Each entry states its own derivation in `basis`.
 *
 * Roles (optional). 'calibration' marks the one shot a model constant was fitted to: its model value matches the
 * published one by construction, so it is not a test and validate labels it 'calibrated'. 'blind' marks a prediction made
 * after that calibration with nothing adjusted for the shot. A check without a role compares a model that was not fitted
 * to any value of the table with a published one.
 *
 * Wording (evaluate.ts). A check whose model value deviates by more than 20 % from the published value is reported as
 * 'benchmarked (deviation X %)', one within 20 % as 'validated' (a bound of kind sanity as 'sanity bound').
 *
 * Known failures. When the current model falls outside a defensible range, the check is kept and
 * `knownFailure` says why: validate prints it as KNOWN-FAIL, lists it in the summary and does not fail
 * the exit code. A known failure that starts passing is reported (XPASS) so the marker can be removed.
 * Model values quoted in `knownFailure` texts are those of v4.0 development (branch v4/integration).
 */
import type { MetricPath } from './metrics';

export type CheckKind = 'validation' | 'benchmark' | 'sanity';
/** 'calibration': a model constant was fitted to this value; 'blind': predicted after that calibration, nothing adjusted */
export type CheckRole = 'calibration' | 'blind';

/** The reduced-model tolerances of the acceptance policy (see above). */
export type PolicyTolerance = 'confinement' | 'temperature' | 'yield' | 'gain';
/** How `accept` follows from the published band: a policy tolerance, or 'stated' in `basis`. */
export type Tolerance = PolicyTolerance | 'stated';

export interface ReferenceCheck {
  /** unique, stable id: `<preset>.<quantity>` */
  id: string;
  /** preset id (src/physics/presets.ts) */
  preset: string;
  /** human-readable metric label */
  metric: string;
  /** where the model value comes from (see metrics.ts) */
  path: MetricPath;
  /** published value */
  value: number;
  /** published 1σ uncertainty or half-spread of the published values, in `unit` */
  uncertainty?: number;
  /**
   * published band when it is not value ± uncertainty, e.g. the spread of several code predictions
   * around a reference value; see {@link publishedBand}
   */
  band?: readonly [number, number];
  unit: string;
  /** short citation for one-line reports, e.g. "Gomez 2020" */
  ref: string;
  /** full citation */
  source: string;
  doi?: string;
  /** why there is no `doi` for a measured value: the source could not be verified as a peer-reviewed paper */
  sourceLimitation?: string;
  /** accepted model range [lo, hi], inclusive */
  accept: readonly [number, number];
  /** policy tolerance that widens the published band into `accept`, or 'stated' (derivation in `basis`) */
  tolerance: Tolerance;
  kind: CheckKind;
  /** the part of this check in a calibration (see the header); absent for a check that no fit enters */
  role?: CheckRole;
  /** how `accept` follows from the reference and the tolerances above */
  basis: string;
  /** why the current model is known to fall outside `accept`; the check then does not fail the run */
  knownFailure?: string;
}

/** Full citations, shared by several checks. */
const SRC = {
  shimada2007: 'M. Shimada et al., "Chapter 1: Overview and summary" (Progress in the ITER Physics Basis), Nucl. Fusion 47 (2007) S1–S17',
  ipb1999: 'ITER Physics Expert Group on Confinement and Transport et al., "Chapter 2: Plasma confinement and transport" (ITER Physics Basis), Nucl. Fusion 39 (1999) 2175–2249',
  sips2005: 'A.C.C. Sips, "Advanced scenarios for ITER operation", Plasma Phys. Control. Fusion 47 (2005) A19–A40',
  snyder2011: 'P.B. Snyder et al., "A first-principles predictive model of the pedestal height and width: development, testing and ITER optimization with the EPED model", Nucl. Fusion 51 (2011) 103016',
  maslov2023: 'M. Maslov et al., "JET D-T scenario with optimized non-thermal fusion", Nucl. Fusion 63 (2023) 112002',
  creely2020: 'A.J. Creely et al., "Overview of the SPARC tokamak", J. Plasma Phys. 86 (2020) 865860502',
  federici2019: 'G. Federici et al., "Overview of the DEMO staged design approach in Europe", Nucl. Fusion 59 (2019) 066013',
  siccinio2020: 'M. Siccinio et al., "DEMO physics challenges beyond ITER", Fusion Eng. Des. 156 (2020) 111603',
  garzotti2018: 'L. Garzotti et al., "Analysis of JT-60SA operational scenarios", Nucl. Fusion 58 (2018) 026029 (scenario 2, table 1)',
  harrison2024: 'J.R. Harrison et al., "Overview of physics results from MAST Upgrade towards core-pedestal-exhaust integration", Nucl. Fusion 64 (2024) 112017',
  beurskens2021: 'M.N.A. Beurskens et al., "Ion temperature clamping in Wendelstein 7-X electron cyclotron heated plasmas", Nucl. Fusion 61 (2021) 116072',
  abushawareb2024: 'H. Abu-Shawareb et al. (Indirect Drive ICF Collaboration), "Achievement of target gain larger than unity in an inertial fusion experiment", Phys. Rev. Lett. 132 (2024) 065102',
  abushawareb2022: 'H. Abu-Shawareb et al. (Indirect Drive ICF Collaboration), "Lawson criterion for ignition exceeded in an inertial fusion experiment", Phys. Rev. Lett. 129 (2022) 075001 (table I)',
  pak2024: 'A. Pak et al., "Observations and properties of the first laboratory fusion experiment to exceed a target gain of unity", Phys. Rev. E 109 (2024) 025203',
  gopalaswamy2024: 'V. Gopalaswamy et al., "Demonstration of a hydrodynamically equivalent burning plasma in direct-drive inertial confinement fusion", Nat. Phys. 20 (2024) 751–757',
  gomez2020: 'M.R. Gomez et al., "Performance scaling in magnetized liner inertial fusion experiments", Phys. Rev. Lett. 125 (2020) 155002',
  lindemuth1983: 'I.R. Lindemuth and R.C. Kirkpatrick, "Parameter space for magnetized fuel targets in inertial confinement fusion", Nucl. Fusion 23 (1983) 263–284',
  levitt2024: 'B. Levitt et al., "Elevated electron temperature coincident with observed fusion reactions in a sheared-flow-stabilized Z pinch", Phys. Rev. Lett. 132 (2024) 155101',
  gota2021: 'H. Gota et al., "Overview of C-2W: high temperature, steady-state beam-driven field-reversed configuration plasmas", Nucl. Fusion 61 (2021) 106039',
  bagryansky2015: 'P.A. Bagryansky et al., "Threefold increase of the bulk electron temperature of plasma discharges in a magnetic mirror device", Phys. Rev. Lett. 114 (2015) 205001',
  jones1986: 'S.E. Jones et al., "Observation of unexpected density effects in muon-catalyzed d-t fusion", Phys. Rev. Lett. 56 (1986) 588–591',
  ipb1999ch1: 'ITER Physics Expert Group et al., "Chapter 1: Overview and summary" (ITER Physics Basis), Nucl. Fusion 39 (1999) 2137–2174',
  berkery2023: 'J.W. Berkery et al., "Operational space and performance limiting events in the first physics campaign of MAST-U", Plasma Phys. Control. Fusion 65 (2023) 045001',
  harrisonSuperX2024: 'J.R. Harrison et al., "Benefits of the Super-X divertor configuration for scenario integration on MAST Upgrade", Plasma Phys. Control. Fusion 66 (2024) 065019',
  lazarus1997: 'E.A. Lazarus et al., "Higher fusion power gain with profile control in DIII-D tokamak plasmas", Nucl. Fusion 37 (1997) 7–12',
  imada2024: 'K. Imada et al., "Observation of a new pedestal stability regime in MAST Upgrade H-mode plasmas", Nucl. Fusion 64 (2024) 086002',
} as const;

const DOI = {
  shimada2007: '10.1088/0029-5515/47/6/S01',
  ipb1999: '10.1088/0029-5515/39/12/302',
  sips2005: '10.1088/0741-3335/47/5A/003',
  snyder2011: '10.1088/0029-5515/51/10/103016',
  maslov2023: '10.1088/1741-4326/ace2d8',
  creely2020: '10.1017/S0022377820001257',
  federici2019: '10.1088/1741-4326/ab1178',
  siccinio2020: '10.1016/j.fusengdes.2020.111603',
  garzotti2018: '10.1088/1741-4326/aa9e15',
  harrison2024: '10.1088/1741-4326/ad6011',
  beurskens2021: '10.1088/1741-4326/ac1653',
  abushawareb2024: '10.1103/PhysRevLett.132.065102',
  abushawareb2022: '10.1103/PhysRevLett.129.075001',
  pak2024: '10.1103/PhysRevE.109.025203',
  gopalaswamy2024: '10.1038/s41567-023-02361-4',
  gomez2020: '10.1103/PhysRevLett.125.155002',
  lindemuth1983: '10.1088/0029-5515/23/3/001',
  levitt2024: '10.1103/PhysRevLett.132.155101',
  gota2021: '10.1088/1741-4326/ac2521',
  bagryansky2015: '10.1103/PhysRevLett.114.205001',
  jones1986: '10.1103/PhysRevLett.56.588',
  ipb1999ch1: '10.1088/0029-5515/39/12/301',
  berkery2023: '10.1088/1361-6587/acb464',
  harrisonSuperX2024: '10.1088/1361-6587/ad4058',
  imada2024: '10.1088/1741-4326/ad5219',
  lazarus1997: '10.1088/0029-5515/37/1/I11',
} as const satisfies Record<keyof typeof SRC, string>;

/** exp(2 × 0.145): 2σ of the IPB98(y,2) database fit */
export const CONFINEMENT_FACTOR = Math.exp(2 * 0.145);

/** The published band of a check: `band` if given, otherwise value ± uncertainty (the value alone without one). */
export function publishedBand(c: Pick<ReferenceCheck, 'value' | 'uncertainty' | 'band'>): readonly [number, number] {
  if (c.band) return c.band;
  const u = c.uncertainty ?? 0;
  return [c.value - u, c.value + u];
}

/**
 * Rounds x outward to three significant digits (down for a lower bound, up for an upper one), after
 * absorbing binary noise such as 0.7 × 1.3 = 0.9099999999999999.
 */
export function roundOutward(x: number, dir: 'down' | 'up'): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const e = Math.floor(Math.log10(Math.abs(x))) - 2;
  const scaled = Number((x / 10 ** e).toPrecision(12));
  const k = dir === 'down' ? Math.floor(scaled) : Math.ceil(scaled);
  return Number((k * 10 ** e).toPrecision(3));
}

/** The accept range a policy tolerance gives for a published band [lo, hi] (positive quantities). */
export function widen(tolerance: PolicyTolerance, [lo, hi]: readonly [number, number]): readonly [number, number] {
  const [a, b] = tolerance === 'confinement' ? [lo / CONFINEMENT_FACTOR, hi * CONFINEMENT_FACTOR]
    : tolerance === 'temperature' ? [lo * 0.7, hi * 1.3]
      : tolerance === 'yield' ? [lo / 3, hi * 3]
        : [lo / 2, hi * 2];
  return [roundOutward(a, 'down'), roundOutward(b, 'up')];
}

/**
 * P_alpha / P_fusion of a D-T tokamak preset. The alpha particles carry 3.561 MeV of the 17.589 MeV released by
 * D + T → ⁴He + n (exact two-body kinematics of the AME2020 masses, reactivity.ts), a share of 0.2025, and P_alpha is
 * the heating by the charged products alone (the injected beams are P_beam_heat, a separate diagnostic), so the share
 * cannot exceed it. v3 booked the beam heating as P_alpha and read 0.24 for ITER.
 */
const ALPHA_SHARE = (preset: string): ReferenceCheck => ({
  id: `${preset}.alphaShare`, preset, metric: 'P_alpha / P_fusion (flat-top)', path: 'derived.alphaShare', value: 0.2, unit: '',
  ref: 'ITER Physics Basis ch. 1, 1999', source: SRC.ipb1999ch1, doi: DOI.ipb1999ch1, accept: [0, 0.213], tolerance: 'stated', kind: 'sanity',
  basis: 'a bound from the energetics of D + T → ⁴He (3.561 MeV) + n (14.028 MeV): the alphas carry 3.561/17.589 = 0.2025 of the fusion power ' +
    'and P_alpha, the deposited heating of the charged products alone, cannot exceed it; +5 % of slack (0.2126, rounded up to 0.213) because P_alpha = W_α/τ lags a ' +
    'P_fus that is not exactly steady on the flat top. Guards the v3 bookkeeping that counted the NBI heating in P_alpha (0.24 for ITER)',
});

/**
 * q95 of MAST Upgrade against its first physics campaign (Berkery 2023: almost all operation between 5 < q95 < 10).
 * Until v4.0 the preset had the design-maximum shape (R 0.85 m, a 0.65 m, κ 2.5, B0 0.75 T, I_p 1 MA: q95 = 18.2 by the fit) and the check was a
 * documented known failure; since v4.0 the preset is a first-campaign scenario (v4checks.test.ts recomputes its q95 from the fit).
 */
const MASTU_Q95 = (preset: 'MASTU'): ReferenceCheck => ({
  id: `${preset}.q95`, preset, metric: 'q95 (flat-top)', path: 'flatTop.q95', value: 7.5, band: [5, 10], unit: '',
  ref: 'Berkery 2023', source: `${SRC.berkery2023}; shape, field and current of the campaign: ${SRC.harrisonSuperX2024}; ${SRC.imada2024}`, doi: DOI.berkery2023,
  accept: [5, 10], tolerance: 'stated', kind: 'validation',
  basis: 'first physics campaign of MAST-U (I_p 450–1000 kA, B0 0.42–0.64 T; Harrison et al. 2024, Super-X paper): almost all operation between 5 < q95 < 10, ' +
    'the band, whose mid-point is the value. The accepted range is the band itself, a bound on both sides: q95 follows from I_p, B0 and ' +
    'the shape through the low-aspect-ratio fit of Sauter (2016), no reduced-model energy balance enters, so nothing is widened. The preset is a scenario of the ' +
    'campaign (R 0.8 m, a 0.5 m, κ 2.1, δ 0.47, 0.75 MA, 0.55 T; Harrison 2024 and Imada et al. 2024, whose EFIT q95 of three such discharges is 6.3–6.7): the ' +
    'fit gives 6.4 for it. With the design-maximum shape of the machine (R 0.85 m, a 0.65 m, κ 2.5) it gave 18.2',
});

/** The yield of N230729 is not in a paper that could be read: the facility's own record (no DOI), see `sourceLimitation`. */
const LLNL_NUG2024 = 'K. Fournier et al. (LLNL), "What\'s New for Users at the NIF...", NIF & JLF User Group Meeting (2024), LLNL-PRES-859704, slide 3: N230729, 3.88 MJ yield; ' +
  'lasers.llnl.gov/science/achieving-fusion-ignition: "July 30, 2023: The NIF laser again delivered 2.05 MJ of energy to the target, resulting in 3.88 MJ of fusion energy output"';
const LLNL_NUG2024_LIMIT = 'no peer-reviewed paper that states the yield of N230729 could be verified in this session (the design perspective of Kritcher et al., ' +
  'Phys. Plasmas 31 (2024) 070502, doi:10.1063/5.0210904, discusses the platform but its text could not be read): the value is the facility record of the 2.05 MJ laser energy and the ' +
  '3.88 MJ yield, without a published uncertainty';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** lossless (adiabatic, γ = 5/3) temperature after radial compression of a cylinder by C: T0·C^(4/3) */
const adiabaticCyl = (T0: number, C: number) => r3(T0 * C ** (4 / 3));

export const REFERENCE_CHECKS: readonly ReferenceCheck[] = [
  // ─── ITER (0D) ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ITER.Q', preset: 'ITER', metric: 'Q (flat-top avg.)', path: 'flatTop.Q', value: 10, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [5, 20], tolerance: 'gain', kind: 'benchmark',
    basis: 'inductive design point Q = 10; ×/÷ 2 (gain tolerance)',
  },
  {
    id: 'ITER.Pfus', preset: 'ITER', metric: 'P_fusion (flat-top)', path: 'flatTop.P_fus', value: 500, unit: 'MW',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [300, 800], tolerance: 'stated', kind: 'benchmark',
    basis: 'Q = 10 at the 50 MW of heating of this preset (400–500 MW in the ITER design scenarios); −40 %/+60 % for a reduced model',
  },
  {
    id: 'ITER.H98', preset: 'ITER', metric: 'H98(y,2) (flat-top)', path: 'derived.H98y2', value: 1, unit: '',
    ref: 'ITER Physics Basis 1999', source: SRC.ipb1999, doi: DOI.ipb1999, accept: [0.748, 1.34], tolerance: 'confinement', kind: 'sanity',
    basis: 'ITER Q = 10 assumes H98 = 1 (Shimada 2007); ×/÷ exp(2·0.145) database scatter. Sanity only, not a test of ' +
      'confinement physics: the 0D model sets τ_E = H98 × τ_IPB98(y,2) with the preset\'s input H98 = 1, so this checks that ' +
      'input together with the model\'s loss power (it feeds P_L = P_heat − P_rad,core − dW/dt into the scaling, with the radiation ' +
      'of ρ < 0.6 only, while IPB98(y,2) and this independent evaluation at the flat-top n̄ and P_heat use P_heat, so the model is ' +
      'expected above H98 = 1 by the core-radiation share), its line-averaged density and NTM degradation',
  },
  {
    id: 'ITER.nG', preset: 'ITER', metric: 'n̄/n_G (flat-top)', path: 'flatTop.nG_frac', value: 0.85, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [0.6, 1.0], tolerance: 'stated', kind: 'benchmark',
    basis: 'inductive scenario n̄/n_G = 0.85 with n̄ the line-averaged density (Shimada 2007; Casper et al., Nucl. Fusion 54 (2014) 013005: densities at 85 % ' +
      'of the Greenwald limit), which is the density of the 0D model since v4.0. The target of the preset is the volume average 0.914e20 m⁻³, 1.015e20 m⁻³ on the line ' +
      '(0.85 n_G; the flat top reaches 0.84); up to the Greenwald limit, down to −30 %',
  },
  ALPHA_SHARE('ITER'),
  // ─── JET DTE2 (0D) ───────────────────────────────────────────────────────────────────────────
  {
    id: 'JET.Efus', preset: 'JET', metric: 'E_fusion', path: 'report.E_fusion_MJ', value: 59, uncertainty: 6, unit: 'MJ',
    ref: 'Maslov 2023', source: SRC.maslov2023, doi: DOI.maslov2023, accept: [40, 80], tolerance: 'stated', kind: 'validation',
    basis: 'record pulse #99971 (2021): 59 MJ in ~5 s; ≈10 % neutron-yield calibration uncertainty, widened to −32 %/+36 % for a 0D model',
  },
  ALPHA_SHARE('JET'),
  // ─── SPARC (0D) ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'SPARC.Q', preset: 'SPARC', metric: 'Q (flat-top avg.)', path: 'flatTop.Q', value: 11, unit: '',
    ref: 'Creely 2020', source: SRC.creely2020, doi: DOI.creely2020, accept: [2, 20], tolerance: 'stated', kind: 'benchmark',
    basis: 'predicted Q ≈ 11 at H98 = 1; the mission requirement Q > 2 is the lower bound, about factor 2 above the prediction the upper one',
  },
  ALPHA_SHARE('SPARC'),
  // ─── DIII-D (0D) ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'DIIID.H98', preset: 'DIIID', metric: 'H98(y,2) (flat-top)', path: 'derived.H98y2', value: 1, unit: '',
    ref: 'ITER Physics Basis 1999', source: SRC.ipb1999, doi: DOI.ipb1999, accept: [0.748, 1.34], tolerance: 'confinement', kind: 'sanity',
    basis: 'IPB98(y,2) reproduces the ELMy H-mode database, DIII-D included, with RMS log error 0.145: H98 = 1 within ×/÷ exp(2·0.145). ' +
      'Sanity only: the preset is a generic DIII-D H-mode, not a documented discharge, so there is no measurement to compare with, ' +
      'and the 0D model sets τ_E = H98 × τ_IPB98(y,2) with the preset\'s input H98 = 1. The check covers that input, the model\'s ' +
      'loss power (P_heat − P_rad,core − dW/dt in the scaling; P_heat in this independent evaluation at the flat-top n̄) and NTM degradation',
  },
  {
    id: 'DIIID.Palpha', preset: 'DIIID', metric: 'P_alpha, D-D charged products (flat-top)', path: 'flatTop.P_alpha', value: 0.0225, unit: 'MW',
    ref: 'Lazarus 1997', source: SRC.lazarus1997, doi: DOI.lazarus1997, accept: [0, 0.0225], tolerance: 'stated', kind: 'sanity',
    basis: 'a bound, not a measurement: a D-D plasma has no alpha heating, only the charged products of D-D fusion (T, p, 3He), a part ' +
      'of the D-D fusion power. The highest fusion power gain reached in DIII-D deuterium plasmas is Q_DD = 0.0015, so the preset\'s 15 MW ' +
      'of heating gives at most 0.0015 × 15 MW = 0.0225 MW of fusion power, charged products included. A larger P_alpha would mean that ' +
      'the beam heating is booked as fusion products, which v3 did (11.7 MW of NBI in P_alpha)',
  },
  // ─── JT-60SA (0D) ────────────────────────────────────────────────────────────────────────────
  {
    id: 'JT60SA.W', preset: 'JT60SA', metric: 'W_th (flat-top)', path: 'flatTop.W', value: 22.0, band: [21.2, 23.3], unit: 'MJ',
    ref: 'Garzotti 2018', source: SRC.garzotti2018, doi: DOI.garzotti2018, accept: [15.8, 31.2], tolerance: 'confinement', kind: 'benchmark',
    basis: 'scenario 2 (5.5 MA, 2.25 T, 41 MW): reference W_th = 22.0 MJ; the four transport-code predictions span 21.2–23.3 MJ (the band); ×/÷ exp(2·0.145)',
  },
  {
    id: 'JT60SA.tauE', preset: 'JT60SA', metric: 'τ_E (flat-top)', path: 'flatTop.tauE', value: 0.64, band: [0.52, 0.64], unit: 's',
    ref: 'Garzotti 2018', source: SRC.garzotti2018, doi: DOI.garzotti2018, accept: [0.389, 0.856], tolerance: 'confinement', kind: 'benchmark',
    basis: 'scenario 2: reference τ_E = 0.64 s; the four transport codes predict 0.60, 0.61, 0.58 and 0.52 s, so the band is 0.52–0.64 s; ×/÷ exp(2·0.145)',
  },
  // ─── MAST Upgrade (0D) ───────────────────────────────────────────────────────────────────────
  {
    id: 'MASTU.H98', preset: 'MASTU', metric: 'H98(y,2) (flat-top)', path: 'derived.H98y2', value: 1.15, uncertainty: 0.15, unit: '',
    ref: 'Harrison 2024', source: SRC.harrison2024, doi: DOI.harrison2024, accept: [0.748, 1.74], tolerance: 'confinement', kind: 'validation',
    basis: 'first campaigns: H98 ≈ 1.3 in the best H-modes, ≈ 1 once 2/1 tearing modes set in (range 1.0–1.3); ×/÷ exp(2·0.145) because ' +
      'the preset is not one of those discharges. Not circular: the preset confines with the spherical-tokamak scaling of Valovič, ' +
      'and H98 is IPB98(y,2) evaluated independently',
  },
  MASTU_Q95('MASTU'),
  // ─── Wendelstein 7-X (0D) ────────────────────────────────────────────────────────────────────
  {
    id: 'W7X.Ti0', preset: 'W7X', metric: 'T_i(0) (flat-top)', path: 'flatTop.Ti0', value: 1.5, uncertainty: 0.2, unit: 'keV',
    ref: 'Beurskens 2021', source: SRC.beurskens2021, doi: DOI.beurskens2021, accept: [0.91, 2.21], tolerance: 'temperature', kind: 'validation',
    basis: 'gas-fuelled ECRH plasmas (this preset: 7.5 MW ECRH, no pellets): central T_i clamped at 1.5 ± 0.2 keV by ion-scale ' +
      'turbulence; ±30 % temperature tolerance. The 0D model (ISS04 energy balance, prescribed profile peaking) has no turbulent ' +
      'clamping, so this bounds its energy balance only',
  },
  // ─── EU DEMO (0D) ────────────────────────────────────────────────────────────────────────────
  {
    id: 'DEMO.Pfus', preset: 'DEMO', metric: 'P_fusion (flat-top)', path: 'flatTop.P_fus', value: 2000, unit: 'MW',
    ref: 'Federici 2019', source: SRC.federici2019, doi: DOI.federici2019, accept: [1000, 3000], tolerance: 'stated', kind: 'benchmark',
    basis: '2018 baseline top-level requirement P_fus = 2000 MW; ±50 % for a reduced model',
  },
  ALPHA_SHARE('DEMO'),
  // ─── ITER · 1.5D ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'ITER15.Q', preset: 'ITER15', metric: 'Q (flat-top avg.)', path: 'flatTop.Q', value: 10, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [5, 20], tolerance: 'gain', kind: 'benchmark',
    basis: 'inductive design point Q = 10; ×/÷ 2 (gain tolerance)',
  },
  {
    id: 'ITER15.Pfus', preset: 'ITER15', metric: 'P_fusion (flat-top)', path: 'flatTop.P_fus', value: 500, unit: 'MW',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [300, 800], tolerance: 'stated', kind: 'benchmark',
    basis: 'Q = 10 at the 50 MW of heating of this preset (400–500 MW in the ITER design scenarios); −40 %/+60 % for a reduced model',
  },
  {
    id: 'ITER15.fbs', preset: 'ITER15', metric: 'Bootstrap fraction', path: 'flatTop.f_bs', value: 0.2, uncertainty: 0.05, unit: '',
    ref: 'Sips 2005', source: SRC.sips2005, doi: DOI.sips2005, accept: [0.1, 0.4], tolerance: 'stated', kind: 'benchmark',
    basis: 'inductive scenario f_bs ≈ 0.15–0.25; −50 %/+100 % of the value because f_bs depends on the pedestal pressure',
  },
  {
    id: 'ITER15.li', preset: 'ITER15', metric: 'ℓ_i(3)', path: 'flatTop.li', value: 0.85, uncertainty: 0.15, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [0.6, 1.1], tolerance: 'stated', kind: 'benchmark',
    basis: 'flat-top ℓ_i(3) design range 0.7–1.0 (poloidal-field system capability); ±0.1 for the current-diffusion model',
  },
  {
    id: 'ITER15.q95', preset: 'ITER15', metric: 'q95', path: 'flatTop.q95', value: 3.0, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [2.7, 4.0], tolerance: 'stated', kind: 'benchmark',
    basis: '15 MA / 5.3 T inductive scenario q95 = 3; −10 %/+33 % for the equilibrium reconstructed on the 1.5D grid',
  },
  {
    id: 'ITER15.Tped', preset: 'ITER15', metric: 'T_e pedestal', path: 'flatTop.Tped', value: 4.5, uncertainty: 0.5, unit: 'keV',
    ref: 'Snyder 2011', source: SRC.snyder2011, doi: DOI.snyder2011, accept: [2, 7], tolerance: 'stated', kind: 'benchmark',
    basis: 'EPED prediction for the ITER baseline, T_ped ≈ 4–5 keV; −50 %/+40 % of that band because the model uses an α-limited, not EPED, pedestal',
  },
  {
    id: 'ITER15.nG', preset: 'ITER15', metric: 'n̄/n_G', path: 'flatTop.nG_frac', value: 0.85, unit: '',
    ref: 'Shimada 2007', source: SRC.shimada2007, doi: DOI.shimada2007, accept: [0.6, 1.0], tolerance: 'stated', kind: 'benchmark',
    basis: 'inductive scenario n̄/n_G = 0.85; up to the Greenwald limit, down to −30 %',
  },
  // ─── JET DTE2 · 1.5D ─────────────────────────────────────────────────────────────────────────
  {
    id: 'JET15.Efus', preset: 'JET15', metric: 'E_fusion', path: 'report.E_fusion_MJ', value: 59, uncertainty: 6, unit: 'MJ',
    ref: 'Maslov 2023', source: SRC.maslov2023, doi: DOI.maslov2023, accept: [40, 80], tolerance: 'stated', kind: 'validation',
    basis: 'record pulse #99971: 59 MJ, beam-target fusion included; same range as the 0D check (≈10 % calibration uncertainty, −32 %/+36 %)',
    // no model value is quoted here: it moves with the 1.5D physics, and the check prints the current one
    knownFailure: 'the 1.5D model over-predicts the record pulse by about 40 % (preset note "1.5D: +40 %"): beam-target fusion ' +
      'from the 3-component NBI deposition and a T_i(0) near 10 keV together over-predict the neutron rate of the record pulse',
  },
  {
    id: 'JET15.Ti0', preset: 'JET15', metric: 'T_i axis', path: 'flatTop.Ti0', value: 10, unit: 'keV',
    ref: 'Maslov 2023', source: SRC.maslov2023, doi: DOI.maslov2023, accept: [6, 15], tolerance: 'stated', kind: 'validation',
    basis: 'DTE2 high-fusion-power pulses: T_i(0) ≈ 10 keV; −40 %/+50 %',
  },
  // ─── SPARC · 1.5D ────────────────────────────────────────────────────────────────────────────
  {
    id: 'SPARC15.Q', preset: 'SPARC15', metric: 'Q (flat-top avg.)', path: 'flatTop.Q', value: 11, unit: '',
    ref: 'Creely 2020', source: SRC.creely2020, doi: DOI.creely2020, accept: [2, 20], tolerance: 'stated', kind: 'benchmark',
    basis: 'predicted Q ≈ 11 at H98 = 1; the mission requirement Q > 2 is the lower bound, about factor 2 above the prediction the upper one',
  },
  // ─── EU DEMO · 1.5D ──────────────────────────────────────────────────────────────────────────
  {
    id: 'DEMO15.Pfus', preset: 'DEMO15', metric: 'P_fusion (flat-top)', path: 'flatTop.P_fus', value: 2000, unit: 'MW',
    ref: 'Federici 2019', source: SRC.federici2019, doi: DOI.federici2019, accept: [1000, 3000], tolerance: 'stated', kind: 'benchmark',
    basis: '2018 baseline top-level requirement P_fus = 2000 MW; ±50 % for a reduced model',
  },
  {
    id: 'DEMO15.fbs', preset: 'DEMO15', metric: 'Bootstrap fraction', path: 'flatTop.f_bs', value: 0.35, unit: '',
    ref: 'Siccinio 2020', source: SRC.siccinio2020, doi: DOI.siccinio2020, accept: [0.2, 0.6], tolerance: 'stated', kind: 'benchmark',
    basis: 'pulsed DEMO baseline f_bs ≈ 0.35; −40 %/+70 % because f_bs depends on the pedestal pressure',
  },
  // ─── NIF Hybrid-E shots: N210808 calibrates the ICF model, N221204 and N230729 are blind predictions ──────────────
  {
    id: 'NIF210808.G', preset: 'NIF210808', metric: 'Gain G (N210808, calibration)', path: 'report.Q_sci_max', value: 0.72, unit: '',
    ref: 'Abu-Shawareb 2022', source: SRC.abushawareb2022, doi: DOI.abushawareb2022, accept: [0.36, 1.44], tolerance: 'gain', kind: 'validation', role: 'calibration',
    basis: 'N210808 (8 August 2021): 1.37 MJ of fusion yield from 1.917 MJ of laser light, G = 0.72 (table I). The shot the ICF model is calibrated on: ICF_CAL, ' +
      'the one tuned constant, is the root of E_fus = 1.37 MJ for the capsule of this preset (confinement/icfCalibration.ts), so the model value is the published ' +
      'yield over the laser energy by construction and the check tests the arithmetic of the calibration, not the model; ×/÷ 2 (gain tolerance)',
  },
  {
    id: 'NIF.G', preset: 'NIF', metric: 'Gain G (N221204, blind)', path: 'report.Q_sci_max', value: 1.5, uncertainty: 0.1, unit: '',
    ref: 'Abu-Shawareb 2024', source: `${SRC.abushawareb2024}; uncertainty: ${SRC.pak2024}`, doi: DOI.abushawareb2024, accept: [1.0, 3.0], tolerance: 'stated', kind: 'validation', role: 'blind',
    basis: 'N221204 (5 December 2022): 3.15 MJ from 2.05 MJ of laser energy, G = 1.5 ± 0.1. A BLIND prediction: the ICF model is calibrated on N210808 alone ' +
      '(NIF210808.G) and nothing is adjusted for this shot. Lower bound G = 1, the result the shot is known for (target gain above unity); upper bound ×2 (gain tolerance)',
    knownFailure: 'the model has no input for what separates N221204 from the calibration shot N210808 (an ablator 6 µm thicker, 7 % more laser energy, better low-mode ' +
      'symmetry and capsule quality), so it runs the same capsule and predicts the calibration yield, 1.37 MJ: G = 0.67 against 1.5 (model/published 0.45, yield ' +
      'ratio 0.43). The 2.3-fold increase of the yield between the two shots lies above the ignition cliff, which a model calibrated at one point on the cliff does not ' +
      'resolve; the cliff constants were not re-tuned. Before v4.0 ICF_CAL = 0.07 was tuned to N221204 itself and the check read G = 1.49, a fit that looked like a prediction',
  },
  {
    id: 'NIF.G_N230729', preset: 'NIF', metric: 'Gain G (N230729, blind)', path: 'report.Q_sci_max', value: 1.89, unit: '',
    ref: 'LLNL NIF 2024', source: LLNL_NUG2024, sourceLimitation: LLNL_NUG2024_LIMIT, accept: [1.0, 3.78], tolerance: 'stated', kind: 'validation', role: 'blind',
    basis: 'N230729 (fired 30 July 2023 UTC; NIF notation NYYMMDD is the day the countdown began, the shot is also quoted as N230730): 3.88 MJ from 2.05 MJ of laser ' +
      'energy, G = 1.89; the repeat of the N221204 design with a higher-quality diamond capsule. No yield uncertainty was verified, none is used. A BLIND prediction ' +
      'with the configuration of the NIF preset (the model has no input that separates the shot from N221204). Lower bound G = 1 as for N221204; upper bound ×2 (gain tolerance)',
    knownFailure: 'as for N221204 the model predicts the calibration yield, 1.37 MJ, for every shot of the platform: G = 0.67 against 1.89 (model/published 0.35). ' +
      'The capsule quality that raised the yield of N230729 above that of N221204 (fewer high-Z inclusions and defects) enters the model only through the surface roughness, ' +
      'which acts on the ignition parameter and not on the burn-up of an ignited or marginal shot',
  },
  // ─── Direct-drive ICF (1.9 MJ) ───────────────────────────────────────────────────────────────
  {
    id: 'DIRECT.G', preset: 'DIRECT', metric: 'Gain G', path: 'report.Q_sci_max', value: 0.74, uncertainty: 0.14, unit: '',
    ref: 'Gopalaswamy 2024', source: SRC.gopalaswamy2024, doi: DOI.gopalaswamy2024, accept: [0.3, 1.76], tolerance: 'gain', kind: 'benchmark',
    basis: 'hydro-equivalent scaling of the best OMEGA cryogenic implosions to 2.15 MJ: 1.6 ± 0.3 MJ of fusion yield, G = 0.74 ± 0.14 ' +
      '(a burning, not ignited, plasma); ×/÷ 2 (gain tolerance). The preset\'s 1.9 MJ would give less. Not a validation of the direct-drive model: in v4.0 development the 0D model ' +
      'ignited this capsule and returned G = 3.10 (a documented known failure); the value fell to 0.39 when the one tuned constant of the ICF model, ICF_CAL, was recalibrated on the ' +
      'NIF shot N210808 (0.07 → 0.03931), which puts this capsule below the ignition threshold of the model (χ_ig = 0.61). The preset was not touched, and the effects that limit ' +
      'direct drive in the experiments (laser–plasma instabilities, hot-electron preheat, laser imprint) are still not modelled; the model value is 0.53 of the published one',
  },
  // ─── Z machine MagLIF ────────────────────────────────────────────────────────────────────────
  {
    id: 'Z.yield', preset: 'Z', metric: 'D-D neutron yield', path: 'report.neutronYield', value: 1.1e13, unit: '',
    ref: 'Gomez 2020', source: SRC.gomez2020, doi: DOI.gomez2020, accept: [3.66e12, 3.3e13], tolerance: 'yield', kind: 'validation',
    basis: 'best MagLIF shots at ~20 MA with enhanced B_z and preheat: primary D-D yield 1.1 × 10¹³ (2 kJ D-T equivalent); ×/÷ 3 (pulsed yield tolerance)',
    knownFailure: 'the 0D MagLIF model over-predicts the yield by more than an order of magnitude (2.0 × 10¹⁴ against 1.1 × 10¹³, ' +
      'since v4.0 with a burn of ≈ 2 ns instead of ≈ 30 ns): its ideal compression to ' +
      'CR = 30 has no liner–fuel mix, end losses, preheat losses or Be radiation, which limit the experiments',
  },
  {
    id: 'Z.Ti', preset: 'Z', metric: 'T_i (burn-averaged)', path: 'burn.Ti', value: 3.1, unit: 'keV',
    ref: 'Gomez 2020', source: SRC.gomez2020, doi: DOI.gomez2020, accept: [2.17, 4.03], tolerance: 'temperature', kind: 'validation',
    basis: 'burn-averaged ion temperature of the best shots, 3.1 keV (neutron time of flight); ±30 % temperature tolerance',
  },
  // ─── General Fusion piston MTF ───────────────────────────────────────────────────────────────
  {
    id: 'GF.Tmax', preset: 'GF', metric: 'T_max (compressed)', path: 'report.Tmax_keV', value: adiabaticCyl(0.3, 10), unit: 'keV',
    ref: 'Lindemuth 1983', source: SRC.lindemuth1983, doi: DOI.lindemuth1983, accept: [0.3, adiabaticCyl(0.3, 10)], tolerance: 'stated', kind: 'sanity',
    basis: 'no measurement at these conditions: the compressed temperature must lie between the initial T0 = 0.3 keV and the lossless adiabatic limit T0·C^(4/3) of a radial compression by C = 10 (γ = 5/3)',
  },
  // ─── FRX-L electromagnetic liner MTF ─────────────────────────────────────────────────────────
  {
    id: 'FRXL.Tmax', preset: 'FRXL', metric: 'T_max (compressed)', path: 'report.Tmax_keV', value: adiabaticCyl(0.3, 10), unit: 'keV',
    ref: 'Lindemuth 1983', source: SRC.lindemuth1983, doi: DOI.lindemuth1983, accept: [0.3, adiabaticCyl(0.3, 10)], tolerance: 'stated', kind: 'sanity',
    basis: 'no measurement at these conditions: the compressed temperature must lie between the initial T0 = 0.3 keV and the lossless adiabatic limit T0·C^(4/3) of a radial compression by C = 10 (γ = 5/3)',
  },
  // ─── Zap FuZE-Q sheared-flow Z pinch ─────────────────────────────────────────────────────────
  {
    id: 'ZAP.Te', preset: 'ZAP', metric: 'T_e (flat-top)', path: 'flatTop.Te', value: 2, uncertainty: 1, unit: 'keV',
    ref: 'Levitt 2024', source: SRC.levitt2024, doi: DOI.levitt2024, accept: [0.7, 3.9], tolerance: 'temperature', kind: 'sanity',
    basis: 'FuZE Thomson scattering: T_e = 1–3 keV on axis during neutron production; ±30 % temperature tolerance. Sanity only: at C = 1 the model keeps the preset\'s T0',
  },
  // ─── TAE Norman / C-2W FRC ───────────────────────────────────────────────────────────────────
  {
    id: 'TAE.Te', preset: 'TAE', metric: 'T_e (flat-top)', path: 'flatTop.Te', value: 0.5, unit: 'keV',
    ref: 'Gota 2021', source: SRC.gota2021, doi: DOI.gota2021, accept: [0.25, 1.0], tolerance: 'stated', kind: 'validation',
    basis: 'C-2W: T_e > 500 eV sustained for up to 30 ms by NBI (a lower bound, not a central value); factor 2 either way for a 0D single-temperature model',
  },
  {
    id: 'TAE.Ttot', preset: 'TAE', metric: 'T_e + T_i (flat-top)', path: 'derived.Ttot', value: 3.0, unit: 'keV',
    ref: 'Gota 2021', source: SRC.gota2021, doi: DOI.gota2021, accept: [1.5, 6.0], tolerance: 'stated', kind: 'validation',
    basis: 'C-2W: total temperature T_e + T_i > 3 keV (fast-ion dominated; a lower bound); factor 2 either way for a 0D model',
    knownFailure: 'the single-temperature FRC model has T_i = T_e ≈ 0.6 keV, so T_e + T_i ≈ 1.2 keV; the hot ' +
      'beam-driven ion population of C-2W (T_i several times T_e) is not modelled',
  },
  // ─── Tandem mirror ───────────────────────────────────────────────────────────────────────────
  {
    id: 'MIRROR.Te', preset: 'MIRROR', metric: 'T_e (flat-top)', path: 'flatTop.Te', value: 0.66, uncertainty: 0.05, unit: 'keV',
    ref: 'Bagryansky 2015', source: SRC.bagryansky2015, doi: DOI.bagryansky2015, accept: [0.33, 1.8], tolerance: 'stated', kind: 'sanity',
    basis: 'hottest bulk electrons measured in an open trap (GDT, 5 MW NBI + ECRH): 0.66 ± 0.05 keV on axis, peaks above 0.9 keV; ' +
      'factor 2 around that range (0.66/2 to 0.9 × 2). Sanity only: the preset is a tandem mirror of similar size and heating, not GDT',
    knownFailure: 'the single-temperature mirror model sets T_e = T_i ≈ 9.5 keV (with the Pastukhov plug factor of v4.0); mirror electrons are cooled by axial heat ' +
      'loss to the end walls, which limits every open trap built so far to T_e ≲ 1 keV and is not modelled',
  },
  // ─── Muon-catalysed fusion ───────────────────────────────────────────────────────────────────
  {
    id: 'MUON.Yf', preset: 'MUON', metric: 'Fusions per muon', path: 'flatTop.Yf', value: 150, uncertainty: 20.4, unit: '',
    ref: 'Jones 1986', source: SRC.jones1986, doi: DOI.jones1986, accept: [109, 191], tolerance: 'stated', kind: 'validation',
    basis: 'LAMPF record in high-density D-T: 150 ± 4 (stat.) ± 20 (syst.) fusions per muon; ±2σ with the errors in quadrature',
    knownFailure: 'Y_f = 1/(ω_s + 1/(λ_c τ_µ)) with the preset\'s ω_s = 0.56 % and λ_c = 1.2 × 10⁸ s⁻¹ gives 106 fusions per muon; ' +
      'the measured ≈150 implies a lower effective sticking (reactivation) or a faster cycling rate',
  },
  {
    id: 'MUON.Q', preset: 'MUON', metric: 'Q_scientific', path: 'report.Q_sci_max', value: r3((150 * 17.589) / 5000), unit: '',
    ref: 'Jones 1986', source: SRC.jones1986, doi: DOI.jones1986, accept: [0, 0.99], tolerance: 'stated', kind: 'sanity',
    basis: 'energy gain per muon: 150 fusions × 17.6 MeV / 5 GeV muon cost ≈ 0.53; µCF cannot exceed Q = 1 at the measured yields (bound)',
  },
];
