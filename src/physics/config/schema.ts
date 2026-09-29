/**
 * Runtime validation and a JSON Schema for every reactor configuration (`ReactorConfig`, types.ts).
 *
 * The schema below is the single description: {@link validateConfig} checks a value against it and reports
 * every problem with the dotted path of the offending property (`heating.P_NBI_MW: must be >= 0, got -3`);
 * {@link configJsonSchema} emits the same description as JSON Schema 2020-12 (`schema/fusion-sim.schema.json`,
 * written by `scripts/gen-schema.ts`). The types tie it to types.ts: each schema is a `Shape<T>` of the
 * interface it describes, so adding, removing or retyping a property there is a compile error here.
 *
 * What the bounds mean. They are the domain of the model, not an operating envelope: quantities that must be
 * positive are exclusive at 0, fractions are in [0, 1], and the upper limits are far beyond any device (they
 * exist to catch unit slips such as metres for millimetres). Every preset and every value the wizard offers
 * is inside them (schema.test.ts). A value inside the bounds can still make a run end early (a disruption, a
 * magnet quench): that is physics, not a configuration error. The cross-field rules are the few relations the
 * model itself cannot survive (minor radius below major radius; a tokamak needs a plasma current).
 *
 * @packageDocumentation
 */
import type {
  BlanketType, EdgeOptions, FRCConfig, Fidelity, FuelingMethod, ICFConfig, MTFConfig, MagneticConfig, MagnetTech, Method, MirrorConfig, MuonConfig,
  ProfileSettings, ReactorConfig,
} from '../types';
import { METHOD_LABELS } from '../types';
import type { Geometry } from '../geometry';
import type { FuelType } from '../reactivity';
import { IMPURITIES, type ImpuritySpecies } from '../constants';
import { DEFAULT_PROFILE_SETTINGS as PS } from '../profiles/defaults';
import { STEP_DT_MIN } from '../profiles/settings';
import {
  type ConfigPath, type Field, type JsonSchema, type Node, type NumberNode, type ObjectNode, type Rule, type ValidationIssue, type Shape,
  bool, closest, describeValue, formatIssue, int, nodeToJsonSchema, num, object, oneOf, opt, partial, pointerOf, series, validateNode,
} from './dsl';

export type { ConfigPath, IssueCode, JsonSchema, ValidationIssue } from './dsl';
export { formatIssue } from './dsl';

// ── enumerations, kept exhaustive by the compiler (a new union member is a compile error here) ──────

const keysOf = <K extends string>(r: Record<K, unknown>): K[] => Object.keys(r) as K[];

const FUELS = keysOf<FuelType>({ DT: 0, DD: 0, DHe3: 0, pB11: 0 });
const MAGNET_TECHS = keysOf<MagnetTech>({ Cu: 0, NbTi: 0, Nb3Sn: 0, REBCO: 0 });
const BLANKETS = keysOf<BlanketType>({ HCPB: 0, HCLL: 0, WCLL: 0, DCLL: 0, FLiBe: 0, none: 0 });
const FUELINGS = keysOf<FuelingMethod>({ gas: 0, pellet: 0, nbi: 0, mixed: 0 });
const FIDELITIES = keysOf<Fidelity>({ '0D': 0, '1.5D': 0 });
const SPECIES = keysOf<ImpuritySpecies>(IMPURITIES);
const ABLATORS = keysOf<ICFConfig['ablator']>({ CH: 0, HDC: 0, Be: 0 });
const SCALINGS = keysOf<MagneticConfig['scaling']>({ IPB98y2: 0, ITPA20: 0, 'ITPA20-IL': 0, ST_Valovic: 0 });
const TRANSPORT_MODELS = keysOf<ProfileSettings['transportModel']>({ scaling: 0, cgm: 0 });
const EDGE_MODELS = keysOf<NonNullable<ProfileSettings['edgeModel']>>({ legacy: 0, twoPoint: 0 });
const NONLINEAR_SOLVERS = keysOf<NonNullable<ProfileSettings['nonlinearSolver']>>({ auto: 0, picard: 0, newton: 0, pc: 0 });
const NEOCLASSICAL_MODELS = keysOf<NonNullable<ProfileSettings['neoclassicalModel']>>({ sauter: 0, redl: 0 });
const EDGE_LOSS_FITS = keysOf<NonNullable<EdgeOptions['lossFit']>>({ stangeby1: 0, stangeby2: 0, body2025: 0 });
const EDGE_RADIATIONS = keysOf<NonNullable<EdgeOptions['radiation']>>({ prescribed: 0, lengyel: 0 });
const MAGNETIC_METHODS = keysOf<MagneticConfig['method']>({ tokamak: 0, spherical_tokamak: 0, stellarator: 0 });
const ICF_METHODS = keysOf<ICFConfig['method']>({ icf_direct: 0, icf_indirect: 0 });
const MTF_METHODS = keysOf<MTFConfig['method']>({ mtf_liner: 0, mtf_piston: 0, maglif: 0, zpinch_sfs: 0 });

/** Every confinement method, in the order of METHOD_LABELS. */
export const METHODS: readonly Method[] = keysOf<Method>(METHOD_LABELS);

/** The six families of configuration; a method belongs to exactly one. */
export type ConfigFamily = 'magnetic' | 'icf' | 'mtf' | 'frc' | 'mirror' | 'muon';

export const METHOD_FAMILY: Readonly<Record<Method, ConfigFamily>> = {
  tokamak: 'magnetic', spherical_tokamak: 'magnetic', stellarator: 'magnetic',
  icf_direct: 'icf', icf_indirect: 'icf',
  mtf_liner: 'mtf', mtf_piston: 'mtf', maglif: 'mtf', zpinch_sfs: 'mtf',
  frc: 'frc', mirror: 'mirror', muon: 'muon',
};

// ── shared pieces ───────────────────────────────────────────────────────────────────────────────────

const fuel = () => oneOf(FUELS, 'Fuel cycle: D-T, D-D, D-3He or p-11B.');
const seed = () => int({ min: 0, max: 4294967295, doc: 'Seed of the deterministic random generator (ELM, sawtooth and jitter sequences); an unsigned 32-bit integer.' });
const fraction = (doc: string, def?: number) => num({ min: 0, max: 1, doc, ...(def !== undefined ? { def } : {}) });

/** a < R: a tokamak with a minor radius that reaches the major radius has no plasma (the model quenches at once). */
const minorBelowMajor: Rule = {
  id: 'minor-radius-below-major-radius',
  doc: 'geometry.a must be smaller than geometry.R (aspect ratio R/a above 1).',
  reads: ['a', 'R'],
  check: (g) => {
    const a = g.a as number, R = g.R as number;
    return a >= R ? [{ path: 'a', message: `must be smaller than geometry.R (${R}), got ${a}: the aspect ratio R/a has to exceed 1` }] : [];
  },
};

/** A tokamak or spherical tokamak needs a plasma current (q95 = infinity without one); only a stellarator runs at Ip = 0. */
const tokamakNeedsCurrent: Rule = {
  id: 'tokamak-needs-plasma-current',
  doc: 'Ip_MA must be above 0 unless the method is stellarator.',
  reads: ['method', 'Ip_MA'],
  check: (c) => (c.method !== 'stellarator' && (c.Ip_MA as number) <= 0
    ? [{ path: 'Ip_MA', message: `must be > 0 for method '${String(c.method)}' (only a stellarator runs without plasma current), got ${String(c.Ip_MA)}` }]
    : []),
};

// ── magnetic confinement ────────────────────────────────────────────────────────────────────────────

const geometry = object<Geometry>({
  R: num({ exMin: 0, max: 100, unit: 'm', doc: 'Major radius.' }),
  a: num({ exMin: 0, max: 50, unit: 'm', doc: 'Minor radius.' }),
  kappa: num({ min: 1, max: 5, doc: 'Elongation of the 95 % flux surface (of the LCFS if profiles.lcfsKappa is not given).' }),
  delta: num({ min: -1, max: 1, doc: 'Triangularity of the 95 % flux surface.' }),
}, { doc: 'Plasma shape (D-shaped Miller-type cross section).', rules: [minorBelowMajor] });

const profileSettings = partial<ProfileSettings>({
  nRho: int({ min: 8, max: 2000, def: PS.nRho, doc: 'Radial cells on rho_tor.' }),
  gridPacking: opt(num({ min: 0, max: 100, def: PS.gridPacking, doc: 'Edge packing of the radial cells (tanh step in the cell density): the cells at the pedestal and the separatrix are (1 + gridPacking) times narrower than the core cells, for the same nRho. 0 is the uniform grid of v3.' })),
  rtol: opt(num({ exMin: 0, max: 1, def: PS.rtol, doc: 'Relative tolerance of the error control of the transport time step (TR-BDF2). The model replaces a value outside its domain by the default at run time.' })),
  atol: opt(num({ min: 0, max: 1, def: PS.atol, doc: 'Absolute tolerance of the error control of the transport time step, as a fraction of the profile maximum (0: a purely relative tolerance).' })),
  dtMax: opt(num({ min: STEP_DT_MIN, max: 1e5, unit: 's', def: PS.dtMax, doc: 'Longest transport time step.' })),
  nonlinearSolver: opt(oneOf(NONLINEAR_SOLVERS, "Solver of the nonlinear system of a transport stage. 'auto': Newton-Raphson for a predictive transport model ('cgm'), Picard iteration with Anderson mixing for 'scaling'; 'picard', 'newton' (with the Pereverzev-Corrigan Picard iteration as its fallback) and 'pc' (that stabilised Picard iteration alone) force one.", 'auto')),
  IpWaveform: opt(series({
    x: { min: 0, max: 1e7, unit: 's' }, y: { exMin: 0, max: 200, unit: 'MA' }, minItems: 1, maxItems: 10000,
    doc: 'Plasma-current programme I_p(t): the boundary condition of the current diffusion as points [t (s), I_p (MA)] in increasing time, linearly interpolated and held constant beyond the first and last point. Ip_MA is what the initial equilibrium is solved for and should equal the programme at t = 0. Absent: I_p constant (and a live control).',
  })),
  eqNR: int({ min: 9, max: 1025, def: PS.eqNR, doc: 'Grad-Shafranov grid nodes in R.' }),
  eqUpdateInterval: num({ exMin: 0, max: 1e5, unit: 's', def: PS.eqUpdateInterval, doc: 'Upper limit of the interval between equilibrium updates.' }),
  lcfsKappa: opt(num({ min: 1, max: 5, doc: 'Elongation of the last closed flux surface; the elongation of `geometry` (a 95 % value) if absent.' })),
  lcfsDelta: opt(num({ min: -1, max: 1, doc: 'Triangularity of the last closed flux surface; the triangularity of `geometry` if absent.' })),
  lcfsRef95: opt(object<NonNullable<ProfileSettings['lcfsRef95']>>({
    kappa: num({ min: 1, max: 5, doc: 'Elongation of the 95 % surface that lcfsKappa belongs to.' }),
    delta: num({ min: -1, max: 1, doc: 'Triangularity of the 95 % surface that lcfsDelta belongs to.' }),
  }, { doc: 'The 95 % surface shape (kappa95, delta95) that lcfsKappa and lcfsDelta belong to. The 0D volume, surface and cross-section then follow an edited `geometry.kappa` or `geometry.delta` in the ratio kappa/kappa95 and delta/delta95 (the ITER and DEMO presets); without it the LCFS values are absolute.' })),
  transportModel: oneOf(TRANSPORT_MODELS, "'scaling': transport constrained by the tau_E scaling law (validated global dynamics); 'cgm': critical-gradient model (predictive, uncalibrated).", PS.transportModel),
  chiShape: num({ min: 0, max: 100, def: PS.chiShape, doc: 'Shape of chi, proportional to 1 + chiShape rho^2.' }),
  stiffness: num({ min: 0, max: 100, def: PS.stiffness, doc: 'Profile stiffness: chi is multiplied by 1 + stiffness max(0, (R/L_T)/critGrad - 1).' }),
  critGrad: num({ exMin: 0, max: 100, def: PS.critGrad, doc: 'Critical normalised temperature gradient R/L_T (ITG/TEM).' }),
  chiRatio: num({ exMin: 0, max: 100, def: PS.chiRatio, doc: 'chi_i / chi_e.' }),
  DoverChi: num({ exMin: 0, max: 100, def: PS.DoverChi, doc: 'Particle diffusivity over chi_e.' }),
  pedestalWidth: num({ exMin: 0, exMax: 0.5, unit: 'rho_tor', def: PS.pedestalWidth, doc: 'Pedestal width.' }),
  etbFactor: num({ exMin: 0, max: 1, def: PS.etbFactor, doc: 'Edge transport barrier: chi_ETB / chi_turb at the pedestal.' }),
  alphaCritFactor: num({ exMin: 0, max: 10, def: PS.alphaCritFactor, doc: 'ELM trigger threshold as a multiple of the critical ballooning alpha.' }),
  elmFraction: num({ exMin: 0, exMax: 1, def: PS.elmFraction, doc: 'ELM crash depth, Delta W / W_ped.' }),
  sawtoothShear: num({ exMin: 0, max: 10, def: PS.sawtoothShear, doc: 'Shear s1 at q = 1 that triggers a sawtooth crash.' }),
  ecrhRho: num({ min: 0, max: 1, unit: 'rho_tor', def: PS.ecrhRho, doc: 'ECRH deposition centre.' }),
  ecrhWidth: num({ exMin: 0, max: 1, unit: 'rho_tor', def: PS.ecrhWidth, doc: 'ECRH deposition width.' }),
  icrhWidth: num({ exMin: 0, max: 1, unit: 'rho_tor', def: PS.icrhWidth, doc: 'ICRH deposition width.' }),
  nbiRtan: num({ exMin: 0, max: 2, def: PS.nbiRtan, doc: 'NBI tangency radius over the major radius.' }),
  nbcdEff: num({ min: 0, max: 10, def: PS.nbcdEff, doc: 'Neutral-beam current-drive efficiency factor.' }),
  eccdEff: num({ min: 0, max: 10, def: PS.eccdEff, doc: 'Electron-cyclotron current-drive efficiency factor.' }),
  Tsep_keV: opt(num({ exMin: 0, max: 10, unit: 'keV', doc: 'Fixed separatrix temperature; the two-point model if absent.' })),
  nsepFrac: num({ exMin: 0, max: 1, def: PS.nsepFrac, doc: 'Separatrix density over the volume-averaged electron density.' }),
  edgeModel: opt(oneOf(EDGE_MODELS, "Separatrix temperature of the 1.5D boundary. 'legacy': conduction-limited two-point T_sep (outboard share 0.6, clamped to 0.03-0.5 keV); 'twoPoint': T_sep of the edge model (Eich lambda_q, divertor spreading, outer-leg power share), guard band 5 eV - 2 keV. The edge diagnostics use the edge model either way.", 'legacy')),
  neoclassicalModel: opt(oneOf(NEOCLASSICAL_MODELS, "Coefficients of the bootstrap current and of the neoclassical conductivity. 'sauter': Sauter, Angioni and Lin-Liu (1999, with the 2002 correction); 'redl': Redl et al. (2021), the same structure refitted to the numerical code NEO (less bootstrap current in the collisional edge and with impurities).", 'sauter')),
}, { doc: '1.5D profile-model settings (only used with fidelity "1.5D"); every property overrides the model default.' });

type Heating = MagneticConfig['heating'];
type Fueling = MagneticConfig['fueling'];
type Impurity = MagneticConfig['impurity'];
type Stellarator = MagneticConfig['stellarator'];
type Limits = MagneticConfig['limits'];
type Transport = MagneticConfig['transport'];
type Events = MagneticConfig['events'];
type Magnet = MagneticConfig['magnet'];
type Blanket = MagneticConfig['blanket'];
type Divertor = MagneticConfig['divertor'];
type Economics = MagneticConfig['economics'];
type Systems = NonNullable<MagneticConfig['systems']>;
type SystemsTf = NonNullable<Systems['tf']>;
type SystemsCs = NonNullable<Systems['cs']>;
type SystemsBlanket = NonNullable<Systems['blanket']>;

/**
 * Optional inputs of the systems-lite engineering models (src/physics/systems, ws7b): the TF coil stress, the CS flux budget, the
 * radial build and TBR of the blanket, the plant pulse of the cryoplant. Every property is optional: a missing one takes the design-typical
 * value of the magnet technology (documented in systems/). The bounds are the domain of the model (the models clamp inside them anyway).
 */
const systemsSettings = opt(object<Systems>({
  pulseLength_s: opt(num({ exMin: 0, max: 1e7, unit: 's', doc: 'Design length of the plasma pulse of the plant (current ramp-up + flat top + ramp-down): the time over which the pulsed-field energy is spread in the cryoplant load. A property of the machine, not of the simulated shot (default 1055 s, the PROCESS default plasma pulse).' })),
  tf: opt(object<SystemsTf>({
    nCoils: opt(int({ min: 2, max: 200, doc: 'Number of TF coils (default 18; 24 for copper coils; 50 for a stellarator).' })),
    noseFraction: opt(num({ min: 0, max: 0.9, doc: 'Share of the inboard-leg thickness that is solid steel case nose (default by technology).' })),
    structureFraction: opt(num({ min: 0.05, max: 1, doc: 'Load-bearing area fraction of the winding-pack region: steel jacket, plates, side walls (default by technology).' })),
    turnCurrent_A: opt(num({ min: 0, max: 1e6, unit: 'A', doc: 'Operating current per turn (sets the current-lead heat load; default by technology).' })),
    verticalInboardFraction: opt(num({ min: 0.1, max: 1, doc: 'Share of the vertical tension of the coil carried by the inboard leg (0.5 for a D-shaped coil).' })),
  }, { doc: 'TF coil (winding pack and case) inputs.' })),
  cs: opt(object<SystemsCs>({
    currentDensity_MAm2: opt(num({ exMin: 0, max: 1000, unit: 'MA m^-2', doc: 'Smeared current density of the CS winding at the peak field; sets the CS thickness B / (mu0 J) (default by technology, 13.6 for Nb3Sn).' })),
    B_max_T: opt(num({ exMin: 0, max: 100, unit: 'T', doc: 'Peak field of the CS conductor (default: the technology limit).' })),
    swingFraction: opt(num({ exMin: 0, max: 1, doc: 'Share of the +B to -B field swing of the solenoid that is used (default 1).' })),
    pfFlux_Vs: opt(num({ min: 0, max: 1e4, unit: 'V s', doc: 'Flux supplied by the poloidal-field coils (default 0).' })),
    li: opt(num({ exMin: 0, max: 5, doc: 'Internal inductance l_i(3) of the plasma for the inductive flux (default 0.85, or the 1.5D value).' })),
    ejima: opt(num({ min: 0, max: 2, doc: 'Ejima coefficient C_E of the resistive flux of the current ramp-up, C_E mu0 R I_p (default 0.4: the middle of the experiments and the PROCESS value; 0.45 is the ITER design value).' })),
  }, { doc: 'Central-solenoid flux budget. Giving this block turns the flux check on: a warning if the solenoid cannot supply the pulse.' })),
  blanket: opt(object<SystemsBlanket>({
    inboardDepth_m: opt(num({ min: 0, max: 20, unit: 'm', doc: 'Inboard breeding-blanket depth (default: 56 % of the space behind the first wall).' })),
    breederFraction: opt(fraction('HCPB breeder fraction Li4SiO4 / (Li4SiO4 + Be12Ti) (default: the tritium-optimal one).')),
  }, { doc: 'Radial build and TBR options of the blanket.' })),
}, { doc: 'Systems-lite engineering models (TF coil stress, CS flux budget, cryoplant, radial build, TBR); only the shot report reads them, the plasma models never do. Every property is optional.' }));

const magneticShape: Shape<MagneticConfig> = {
  method: oneOf(MAGNETIC_METHODS, 'Confinement method.'),
  geometry,
  B0: num({ exMin: 0, max: 100, unit: 'T', doc: 'Toroidal field on axis.' }),
  Ip_MA: num({ min: 0, max: 200, unit: 'MA', doc: 'Plasma current (0 for a stellarator: bootstrap current neglected).' }),
  fuel: fuel(),
  fuelFracA: fraction('Fraction of the first species (D-T: n_D / (n_D + n_T)).'),
  n_target: num({ exMin: 0, max: 1e23, unit: 'm^-3', doc: 'Target volume-averaged electron density.' }),
  n_rampTime: num({ min: 0, max: 1e5, unit: 's', doc: 'Density ramp time.' }),
  heating: object<Heating>({
    P_NBI_MW: num({ min: 0, max: 5000, unit: 'MW', doc: 'Neutral-beam power.' }),
    E_NBI_keV: num({ exMin: 0, max: 1e4, unit: 'keV', doc: 'Neutral-beam energy per atom (must be positive even with P_NBI_MW = 0).' }),
    P_ICRH_MW: num({ min: 0, max: 5000, unit: 'MW', doc: 'Ion-cyclotron heating power.' }),
    f_ICRH_ion: fraction('Fraction of the ICRH power absorbed by the ions.'),
    P_ECRH_MW: num({ min: 0, max: 5000, unit: 'MW', doc: 'Electron-cyclotron heating power (electrons only).' }),
    rampTime: num({ min: 0, max: 1e4, unit: 's', doc: 'Heating ramp time.' }),
    autoOff: bool('Switch the heating off once Q reaches 5 (ignition test).'),
  }, { doc: 'Auxiliary heating.' }),
  fueling: object<Fueling>({
    method: oneOf(FUELINGS, 'Fuelling method.'),
    maxRate_1e20s: num({ min: 0, max: 1e6, unit: '1e20 s^-1', doc: 'Maximum fuelling rate.' }),
    pelletDepth: fraction('Pellet penetration depth (fraction of the minor radius).'),
  }, { doc: 'Fuelling.' }),
  impurity: object<Impurity>({
    species: oneOf(SPECIES, 'Main impurity.'),
    concentration: fraction('Impurity concentration n_Z / n_e.'),
    wallReflectivity: fraction('Wall reflectivity for synchrotron radiation.'),
    W_source_frac: fraction('Additional tungsten source (divertor erosion feeding core accumulation).'),
    seedSpecies: opt(oneOf(SPECIES, 'Divertor seeding impurity (Ar, Ne or N in a real machine).')),
    seedConcentration: opt(fraction('Divertor seeding concentration n_seed / n_e (constant, no dynamics).')),
  }, { doc: 'Impurities.' }),
  H98: num({ exMin: 0, max: 10, doc: 'H-mode confinement factor relative to the IPB98(y,2) scaling.' }),
  H89: num({ exMin: 0, max: 10, doc: 'L-mode confinement factor relative to the ITER89-P scaling.' }),
  scaling: oneOf(SCALINGS, "Confinement scaling law of the H-mode: 'IPB98y2' (default), 'ITPA20' or 'ITPA20-IL' (Verdoolaege et al. 2021, areal elongation and average LCFS triangularity), 'ST_Valovic' (spherical tokamak); H98 multiplies the selected scaling."),
  stellarator: object<Stellarator>({
    iota23: num({ exMin: 0, max: 10, doc: 'Rotational transform at two thirds of the radius.' }),
    f_ren: num({ exMin: 0, max: 10, doc: 'Deprecated: ISS04 renormalisation, tau_E = f_ren H98 tau_ISS04 when H_ISS04 is not given.' }),
    H_ISS04: opt(num({ exMin: 0, max: 10, doc: 'Confinement multiplier relative to ISS04: tau_E = H_ISS04 tau_ISS04 (then f_ren and H98 are not used).' })),
  }, { doc: 'Stellarator settings (used with method "stellarator").' }),
  limits: object<Limits>({
    betaN_limit: num({ exMin: 0, max: 20, doc: 'Troyon beta_N limit.' }),
    greenwald_limit: num({ exMin: 0, max: 10, doc: 'Density limit as a fraction of the Greenwald density.' }),
    q95_limit: num({ exMin: 0, max: 20, doc: 'Lower limit of q95 (disruption below it).' }),
    W_conc_limit: num({ exMin: 0, max: 1, doc: 'Tungsten concentration limit (radiative collapse above it).' }),
  }, { doc: 'Operational limits that end the shot.' }),
  transport: object<Transport>({
    tau_p_over_tau_E: num({ exMin: 0, max: 1000, doc: 'Particle confinement time over the energy confinement time.' }),
    tau_He_over_tau_E: num({ exMin: 0, max: 1000, doc: 'Helium-ash confinement time over the energy confinement time.' }),
    alpha_n: num({ min: 0, max: 10, doc: 'Density profile peaking exponent.' }),
    alpha_T: num({ min: 0, max: 10, doc: 'Temperature profile peaking exponent.' }),
  }, { doc: '0D transport and profile shape parameters.' }),
  events: object<Events>({
    elms: bool('Type-I ELMs.'), sawteeth: bool('Sawtooth crashes.'), ntm: bool('Neoclassical tearing modes.'),
  }, { doc: 'MHD events.' }),
  magnet: object<Magnet>({
    tech: oneOf(MAGNET_TECHS, 'Magnet technology (sets the maximum field at the coil).'),
    gap_m: num({ min: 0, max: 20, unit: 'm', doc: 'Plasma-to-coil gap (blanket and vacuum vessel).' }),
    coilThickness_m: num({ exMin: 0, max: 20, unit: 'm', doc: 'Coil thickness.' }),
  }, { doc: 'Toroidal-field magnets.' }),
  blanket: object<Blanket>({
    type: oneOf(BLANKETS, 'Breeding blanket concept.'),
    li6_enrichment: num({ min: 0, max: 1, doc: 'Lithium-6 enrichment (natural lithium: 0.075).' }),
    coverage: fraction('Fraction of the wall covered by breeding blanket.'),
  }, { doc: 'Breeding blanket.' }),
  divertor: object<Divertor>({
    f_rad_div: fraction('Fraction of the power radiated in the divertor.'),
    flux_expansion: num({ exMin: 0, max: 200, doc: 'Poloidal flux expansion at the target.' }),
    edge: opt(object<EdgeOptions>({
      outerShare: opt(num({ exMin: 0, max: 1, doc: 'Share of P_sep carried by the outer target leg (default 2/3).' })),
      spreadingRatio: opt(num({ exMin: 0, max: 100, doc: 'Divertor spreading S / lambda_q (default 1.22, i.e. lambda_int = 3 lambda_q).' })),
      S_mm: opt(num({ exMin: 0, max: 1000, unit: 'mm', doc: 'Absolute divertor spreading S; overrides spreadingRatio.' })),
      lambdaQ_mm: opt(num({ exMin: 0, max: 1000, unit: 'mm', doc: 'Midplane heat-flux width; overrides the Eich regression #14.' })),
      divertorLengthFraction: opt(num({ exMin: 0, max: 0.9, doc: 'Length of the divertor leg over the connection length pi q95 R (default 0.3).' })),
      kappa0e: opt(num({ exMin: 0, max: 1e5, unit: 'W m^-1 eV^-7/2', doc: 'Parallel electron conductivity (default 2000).' })),
      sheathGamma: opt(num({ exMin: 0, max: 100, doc: 'Sheath heat transmission coefficient (default 7).' })),
      lossFit: opt(oneOf(EDGE_LOSS_FITS, "Momentum and power loss fit against the target temperature (default 'stangeby1').")),
      radiation: opt(oneOf(EDGE_RADIATIONS, "'prescribed' (default): the divertor radiates divertor.f_rad_div of the power; 'lengyel': the seed impurity radiates (Lengyel model).")),
      seedEnrichment: opt(num({ exMin: 0, max: 1000, doc: 'Seed concentration of the SOL relative to impurity.seedConcentration (default 1).' })),
      detachTt_eV: opt(num({ exMin: 0, max: 1000, unit: 'eV', doc: 'Target electron temperature that defines the onset of detachment in the c_z requirement (default 5).' })),
      targetTilt: opt(num({ exMin: 0, max: 100, doc: '1 / sin(beta) of the target plate (default 3).' })),
      strikeRadiusFraction: opt(num({ exMin: -1, max: 1, doc: 'Strike-point radius offset from R as a fraction of a (default 0.3).' })),
    }, { doc: 'Edge (SOL and divertor) model options; every property is optional and a missing one takes its default (src/physics/edge/params.ts).' })),
  }, { doc: 'Divertor.' }),
  economics: object<Economics>({
    capital_MUSD_override: opt(num({ exMin: 0, max: 1e7, unit: 'MUSD', doc: 'Capital cost overriding the built-in estimate.' })),
    availability: fraction('Plant availability.'),
    thermalEff: num({ exMin: 0, exMax: 1, doc: 'Thermal-to-electric conversion efficiency.' }),
    wallPlugEff: num({ exMin: 0, max: 1, doc: 'Heating-system wall-plug efficiency.' }),
    discountRate: num({ min: 0, exMax: 1, doc: 'Discount rate.' }),
    lifetime_yr: num({ exMin: 0, max: 200, unit: 'yr', doc: 'Plant lifetime.' }),
  }, { doc: 'Economics.' }),
  t_end: num({ exMin: 0, max: 1e6, unit: 's', doc: 'Duration of the shot.' }),
  seed: seed(),
  fidelity: opt(oneOf(FIDELITIES, "'0D': global power balance; '1.5D': radial profile transport with a Grad-Shafranov equilibrium (tokamak and spherical tokamak only, ignored for a stellarator).", '0D')),
  profiles: opt(profileSettings),
  systems: systemsSettings,
};

// ── inertial confinement ────────────────────────────────────────────────────────────────────────────

const icfShape: Shape<ICFConfig> = {
  method: oneOf(ICF_METHODS, 'Confinement method.'),
  E_laser_MJ: num({ exMin: 0, max: 1000, unit: 'MJ', doc: 'Laser energy on target.' }),
  wavelength_nm: num({ min: 100, max: 5000, unit: 'nm', doc: 'Laser wavelength.' }),
  pulse_ns: num({ exMin: 0, max: 1000, unit: 'ns', doc: 'Pulse duration.' }),
  capsuleRadius_um: num({ exMin: 0, max: 1e5, unit: 'um', doc: 'Outer capsule radius.' }),
  fuelMass_ug: num({ exMin: 0, max: 1e7, unit: 'ug', doc: 'DT fuel mass.' }),
  ablatorMass_ug: num({ min: 0, max: 1e8, unit: 'ug', doc: 'Ablator mass.' }),
  ablator: oneOf(ABLATORS, 'Ablator material.'),
  adiabat: num({ min: 1, max: 100, doc: 'Fuel adiabat alpha (1 = cold degenerate).' }),
  convergenceRatio: num({ min: 1, max: 500, doc: 'Target convergence ratio.' }),
  implosionVelocity_kms: num({ exMin: 0, max: 5000, unit: 'km/s', doc: 'Implosion velocity.' }),
  hohlraumEff: fraction('Indirect drive: laser to X-ray to capsule coupling.'),
  absorption: fraction('Direct drive: laser absorption fraction.'),
  asymmetry_rms: num({ min: 0, max: 100, unit: '%', doc: 'Low-mode asymmetry (rms).' }),
  surfaceRoughness_nm: num({ min: 0, max: 1e5, unit: 'nm', doc: 'Surface roughness (Rayleigh-Taylor seed).' }),
  fuel: fuel(),
  seed: seed(),
  driverEff: opt(num({ exMin: 0, max: 1, doc: 'Driver (laser) wall-plug efficiency for Q_eng (default 0.1).', def: 0.1 })),
  thermalEff: opt(num({ exMin: 0, max: 1, doc: 'Thermal-to-electric efficiency for Q_eng (default 0.4).', def: 0.4 })),
};

// ── magnetised target fusion, Z-pinch, MagLIF ───────────────────────────────────────────────────────

const mtfShape: Shape<MTFConfig> = {
  method: oneOf(MTF_METHODS, 'Confinement method.'),
  r0_m: num({ exMin: 0, max: 100, unit: 'm', doc: 'Initial plasma radius.' }),
  L_m: num({ exMin: 0, max: 100, unit: 'm', doc: 'Length.' }),
  n0: num({ exMin: 0, max: 1e32, unit: 'm^-3', doc: 'Initial density.' }),
  T0_keV: num({ exMin: 0, max: 1000, unit: 'keV', doc: 'Initial temperature.' }),
  B0: num({ min: 0, max: 1000, unit: 'T', doc: 'Initial magnetic field.' }),
  compressionRatio: num({ min: 1, max: 1000, doc: 'Compression ratio r0 / r_min.' }),
  driverEnergy_MJ: num({ exMin: 0, max: 1e6, unit: 'MJ', doc: 'Driver energy.' }),
  compressionTime_us: num({ exMin: 0, max: 1e9, unit: 'us', doc: 'Compression duration.' }),
  jitter_us: num({ min: 0, max: 1e9, unit: 'us', doc: 'Piston or liner synchronisation error.' }),
  linerThicknessRatio: num({ min: 0, max: 100, doc: 'Liner thickness over radius (magneto-Rayleigh-Taylor).' }),
  preheat_kJ: num({ min: 0, max: 1e6, unit: 'kJ', doc: 'MagLIF laser preheat energy.' }),
  current_MA: num({ min: 0, max: 1000, unit: 'MA', doc: 'Z-pinch or MagLIF driver current.' }),
  flowShear: fraction('Z-pinch sheared-flow stabilisation (0 to 1).'),
  fuel: fuel(),
  seed: seed(),
};

// ── FRC, mirror, muon ───────────────────────────────────────────────────────────────────────────────

const frcShape: Shape<FRCConfig> = {
  method: oneOf<'frc'>(['frc'], 'Confinement method.'),
  rs_m: num({ exMin: 0, max: 100, unit: 'm', doc: 'Separatrix radius.' }),
  L_m: num({ exMin: 0, max: 1000, unit: 'm', doc: 'Length.' }),
  Be_T: num({ exMin: 0, max: 100, unit: 'T', doc: 'External field.' }),
  n0: num({ exMin: 0, max: 1e30, unit: 'm^-3', doc: 'Density.' }),
  T0_keV: num({ exMin: 0, max: 1000, unit: 'keV', doc: 'Initial temperature.' }),
  P_NBI_MW: num({ min: 0, max: 1e4, unit: 'MW', doc: 'Neutral-beam power.' }),
  E_NBI_keV: num({ exMin: 0, max: 1e5, unit: 'keV', doc: 'Neutral-beam energy per atom.' }),
  t_end: num({ exMin: 0, max: 1e4, unit: 's', doc: 'Duration.' }),
  seed: seed(),
  fuel: fuel(),
};

const mirrorShape: Shape<MirrorConfig> = {
  method: oneOf<'mirror'>(['mirror'], 'Confinement method.'),
  L_m: num({ exMin: 0, max: 1000, unit: 'm', doc: 'Length.' }),
  a_m: num({ exMin: 0, max: 100, unit: 'm', doc: 'Plasma radius.' }),
  B_center_T: num({ exMin: 0, max: 100, unit: 'T', doc: 'Central field.' }),
  mirrorRatio: num({ exMin: 1, max: 1000, doc: 'Mirror ratio R_m (loss-cone angle sin^2 = 1/R_m); must exceed 1.' }),
  n0: num({ exMin: 0, max: 1e30, unit: 'm^-3', doc: 'Density.' }),
  T_keV: num({ exMin: 0, max: 1000, unit: 'keV', doc: 'Temperature.' }),
  P_aux_MW: num({ min: 0, max: 1e4, unit: 'MW', doc: 'Auxiliary heating power.' }),
  tandem: bool('Tandem mirror with end plugs.'),
  t_end: num({ exMin: 0, max: 1e4, unit: 's', doc: 'Duration.' }),
  seed: seed(),
  fuel: fuel(),
  plugPotential: opt(num({ min: 0, max: 100, doc: 'Tandem end-plug potential e phi_c / T_i (default 1).', def: 1 })),
};

const muonShape: Shape<MuonConfig> = {
  method: oneOf<'muon'>(['muon'], 'Confinement method.'),
  muonRate_per_s: num({ exMin: 0, max: 1e25, unit: 's^-1', doc: 'Muon production rate.' }),
  muonCost_GeV: num({ exMin: 0, max: 1000, unit: 'GeV', doc: 'Energy cost per muon.' }),
  stickingProb: num({ min: 0, max: 1, doc: 'Alpha-sticking probability per fusion.' }),
  density_LHD: num({ exMin: 0, max: 10, doc: 'Target density in units of the liquid-hydrogen density.' }),
  T_K: num({ exMin: 0, max: 1e5, unit: 'K', doc: 'Target temperature.' }),
  seed: seed(),
};

const FAMILY_NODE: Readonly<Record<ConfigFamily, ObjectNode>> = {
  magnetic: object<MagneticConfig>(magneticShape, { rules: [tokamakNeedsCurrent], doc: 'Magnetic confinement: tokamak, spherical tokamak, stellarator.' }).node as ObjectNode,
  icf: object<ICFConfig>(icfShape, { doc: 'Laser inertial confinement fusion, direct or indirect drive.' }).node as ObjectNode,
  mtf: object<MTFConfig>(mtfShape, { doc: 'Magnetised target fusion, Z-pinch and MagLIF.' }).node as ObjectNode,
  frc: object<FRCConfig>(frcShape, { doc: 'Field-reversed configuration.' }).node as ObjectNode,
  mirror: object<MirrorConfig>(mirrorShape, { doc: 'Magnetic mirror.' }).node as ObjectNode,
  muon: object<MuonConfig>(muonShape, { doc: 'Muon-catalysed fusion.' }).node as ObjectNode,
};

/** The schema node of one configuration family (for tools that need the ranges, e.g. an editor). */
export function familyNode(family: ConfigFamily): ObjectNode {
  return FAMILY_NODE[family];
}

// ── validation ──────────────────────────────────────────────────────────────────────────────────────

export interface ValidateOptions {
  /** 'error' (default): a property the schema does not know is an issue, with a suggestion for a typo; 'ignore': skip them */
  unknownKeys?: 'error' | 'ignore';
}

export type ConfigValidation =
  | { ok: true; config: ReactorConfig; issues: readonly [] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Checks that `input` (typically parsed JSON) is a valid reactor configuration. Reports all problems, each with
 * the path of the offending property. The configuration is not modified or copied: on success `config` is
 * `input`, typed.
 */
export function validateConfig(input: unknown, opts: ValidateOptions = {}): ConfigValidation {
  const issues: ValidationIssue[] = [];
  const add = (path: ConfigPath, code: ValidationIssue['code'], message: string, hint?: string) =>
    issues.push({ path, pointer: pointerOf(path), code, message, ...(hint !== undefined ? { hint } : {}) });
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    add('', 'type', `must be an object, got ${describeValue(input)}`);
    return { ok: false, issues };
  }
  const method = (input as Record<string, unknown>).method;
  if (method === undefined) add('method', 'required', `is required; one of ${METHODS.map((m) => `'${m}'`).join(', ')}`);
  else if (typeof method !== 'string') add('method', 'type', `must be a string, got ${describeValue(method)}`);
  else if (!(METHODS as readonly string[]).includes(method)) {
    const c = closest(method, METHODS);
    add('method', 'enum', `must be one of ${METHODS.map((m) => `'${m}'`).join(', ')}, got '${method}'`, c !== undefined ? `did you mean '${c}'?` : undefined);
  }
  if (issues.length) return { ok: false, issues };
  validateNode(FAMILY_NODE[METHOD_FAMILY[method as Method]], input, '', issues, opts.unknownKeys ?? 'error');
  return issues.length ? { ok: false, issues } : { ok: true, config: input as ReactorConfig, issues: [] };
}

/** Thrown by {@link assertValidConfig}; `issues` lists every problem. */
export class ConfigValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[], what = 'configuration') {
    super(`invalid ${what} (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n${issues.map((i) => `  ${formatIssue(i)}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/** {@link validateConfig} that throws a {@link ConfigValidationError} instead of returning the issues. */
export function assertValidConfig(input: unknown, opts: ValidateOptions = {}): ReactorConfig {
  const r = validateConfig(input, opts);
  if (!r.ok) throw new ConfigValidationError(r.issues);
  return r.config;
}

// ── field descriptions (editors, the CLI's --set, tests) ────────────────────────────────────────────

export interface FieldInfo {
  path: ConfigPath;
  kind: Node['kind'];
  optional: boolean;
  /** number: bounds, integer flag and unit; enum: the allowed values */
  min?: number; max?: number; exMin?: number; exMax?: number; integer?: boolean; unit?: string;
  values?: readonly string[];
  doc?: string;
  def?: number | boolean | string;
}

/** Describes the property at a dotted path of the configuration of `method` (undefined if there is none). */
export function fieldInfo(method: Method, path: ConfigPath): FieldInfo | undefined {
  let node: Node = FAMILY_NODE[METHOD_FAMILY[method]];
  let optional = false;
  if (path !== '') {
    for (const key of path.split('.')) {
      if (node.kind !== 'object' || !Object.prototype.hasOwnProperty.call(node.props, key)) return undefined;
      const f: Field<unknown> = node.props[key];
      node = f.node;
      optional = f.optional;
    }
  }
  const info: FieldInfo = { path, kind: node.kind, optional };
  if (node.kind === 'number') {
    const n: NumberNode = node;
    for (const k of ['min', 'max', 'exMin', 'exMax', 'unit', 'doc', 'def'] as const) if (n[k] !== undefined) (info as unknown as Record<string, unknown>)[k] = n[k];
    info.integer = n.integer;
  } else if (node.kind === 'enum') {
    info.values = node.values;
    if (node.doc) info.doc = node.doc;
    if (node.def !== undefined) info.def = node.def;
  } else if (node.doc) info.doc = node.doc;
  if (node.kind === 'boolean' && node.def !== undefined) info.def = node.def;
  return info;
}

/** Every leaf (number, boolean, enum) property path of a method's configuration. */
export function leafPaths(method: Method): string[] {
  const out: string[] = [];
  const walk = (n: ObjectNode, prefix: string) => {
    for (const [k, f] of Object.entries(n.props)) {
      const p = prefix === '' ? k : `${prefix}.${k}`;
      if (f.node.kind === 'object') walk(f.node, p); else out.push(p);
    }
  };
  walk(FAMILY_NODE[METHOD_FAMILY[method]], '');
  return out;
}

// ── JSON Schema ─────────────────────────────────────────────────────────────────────────────────────

/** The `$id` of the emitted schema (a URN: the schema is not hosted anywhere). */
export const CONFIG_SCHEMA_ID = 'urn:fusion-reactor-simulator:schema:reactor-config';

const DEF_NAME: Readonly<Record<ConfigFamily, string>> = {
  magnetic: 'magneticConfig', icf: 'icfConfig', mtf: 'mtfConfig', frc: 'frcConfig', mirror: 'mirrorConfig', muon: 'muonConfig',
};

/** Methods of each family, for the `if` of the discriminated union. */
function methodsOf(family: ConfigFamily): Method[] {
  return METHODS.filter((m) => METHOD_FAMILY[m] === family);
}

/**
 * The JSON Schema (draft 2020-12) of a reactor configuration. The document is an object whose `method`
 * selects one of six definitions (`if` / `then` on `method`, so validators point at the branch that applies).
 * Ranges, enumerations, required properties and "no unknown properties" are enforced by the schema;
 * cross-field rules cannot be written in JSON Schema and are listed in `x-rules` annotations instead
 * (validateConfig enforces them).
 */
export function configJsonSchema(): JsonSchema {
  const $defs: Record<string, JsonSchema> = {};
  const families = Object.keys(FAMILY_NODE) as ConfigFamily[];
  for (const fam of families) {
    const s = nodeToJsonSchema(FAMILY_NODE[fam]);
    // the shape of the plasma and the 1.5D settings are shared, named definitions: hoist them
    const props = s.properties as Record<string, JsonSchema>;
    if (fam === 'magnetic') {
      $defs.geometry = props.geometry;
      props.geometry = { $ref: '#/$defs/geometry' };
      $defs.profileSettings = props.profiles;
      props.profiles = { $ref: '#/$defs/profileSettings' };
    }
    $defs[DEF_NAME[fam]] = s;
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: CONFIG_SCHEMA_ID,
    title: 'Fusion Reactor Simulator: reactor configuration',
    description: 'The configuration of one simulated shot: the argument of `new Simulation(cfg)`. `method` selects the family; every property of a family is listed and unknown properties are rejected. Generated from src/physics/config/schema.ts (npm run schema); do not edit.',
    type: 'object',
    required: ['method'],
    properties: { method: { type: 'string', enum: [...METHODS] } },
    allOf: families.map((fam) => ({
      if: { properties: { method: { enum: methodsOf(fam) } }, required: ['method'] },
      then: { $ref: `#/$defs/${DEF_NAME[fam]}` },
    })),
    $defs,
  };
}
