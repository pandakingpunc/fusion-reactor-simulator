/**
 * Ortak tipler: konfigürasyon, model arayüzü, olaylar, rapor.
 */
import { Geometry } from './geometry';
import { FuelType } from './reactivity';
import { ImpuritySpecies } from './constants';
import { DisruptionReport } from './disruption';
import { IntegratorOptions, IntegratorSnapshot } from './integrator';
import type { ScenarioState } from './scenario';

export type Method =
  | 'tokamak' | 'spherical_tokamak' | 'stellarator'
  | 'icf_direct' | 'icf_indirect'
  | 'mtf_liner' | 'mtf_piston'
  | 'zpinch_sfs' | 'maglif'
  | 'frc' | 'mirror' | 'muon';

export const METHOD_LABELS: Record<Method, string> = {
  tokamak: 'Tokamak (conventional)',
  spherical_tokamak: 'Spherical Tokamak (ST)',
  stellarator: 'Stellarator',
  icf_direct: 'Laser ICF — direct drive',
  icf_indirect: 'Laser ICF — indirect drive (hohlraum)',
  mtf_liner: 'MTF — electromagnetic liner',
  mtf_piston: 'MTF — liquid-metal piston',
  zpinch_sfs: 'Z-pinch (sheared-flow stabilized)',
  maglif: 'MagLIF',
  frc: 'Field-Reversed Configuration (FRC)',
  mirror: 'Magnetic Mirror',
  muon: 'Muon-catalyzed fusion (easter egg)',
};

export type MagnetTech = 'Cu' | 'NbTi' | 'Nb3Sn' | 'REBCO';
export type BlanketType = 'HCPB' | 'HCLL' | 'WCLL' | 'DCLL' | 'FLiBe' | 'none';
export type FuelingMethod = 'gas' | 'pellet' | 'nbi' | 'mixed';

/** Model doğruluğu: 0D güç dengesi veya 1.5D profil taşınımı + Grad–Shafranov dengesi */
export type Fidelity = '0D' | '1.5D';

/**
 * Electron-cyclotron launcher of the 'physics' current-drive model (ProfileSettings.eccd): the wave frequency and harmonic set where the
 * resonance is, the parallel refractive index the direction and the Doppler shift of the resonance, the poloidal angle where the wave is absorbed
 * the trapping the driven electrons meet (profiles/cd/eccd.ts). APPROXIMATION: no ray or beam tracing; the deposition is a Gaussian layer at the
 * aim `rho`, the whole ECRH power is absorbed there.
 */
export interface EccdLauncher {
  /** cyclotron harmonic of the absorption, an integer 1 to 3 (default 2) */
  harmonic?: number;
  /** wave frequency [GHz]; if absent the frequency is the one whose Doppler-shifted resonance is at the aim (y = ℓ ω_c/ω fixed by n∥ and T_e) */
  freq_GHz?: number;
  /** parallel refractive index, n∥ > 0 co-current drive, n∥ < 0 counter-current (default 0.3) */
  nPar?: number;
  /** poloidal angle of the absorption [deg] on the flux surface: 0 outboard midplane, 180 inboard (default 0) */
  thetaP_deg?: number;
  /** aim: normalised radius of the deposition layer (default ProfileSettings.ecrhRho) */
  rho?: number;
  /** rms width of the layer over the radius (default ProfileSettings.ecrhWidth) */
  width?: number;
}

/** 1.5D profil modeli ayarları (yalnız tokamak / ST) */
export interface ProfileSettings {
  /** radyal hücre sayısı (ρ_tor) */
  nRho: number;
  /**
   * edge packing of the radial cells (tanh step, 1.5D): the cells at the pedestal and the separatrix are
   * (1 + gridPacking) times narrower than the core cells, for the same nRho (default 4: 10 cells across the
   * pedestal at nRho 50). 0: the uniform grid of v3.
   */
  gridPacking?: number;
  /**
   * error control of the transport time step (TR-BDF2, profiles/solver/coupledStep.ts): the local error estimate of T_e, T_i, n_e
   * and ψ must stay below atol · max|y| + rtol · |y| in every cell (default rtol 1e-2, atol 1e-4: the profile maximum is the
   * scale of the absolute tolerance), and the step is at most dtMax seconds (default 0.5)
   */
  rtol?: number;
  atol?: number;
  dtMax?: number;
  /**
   * how the nonlinear system of a transport stage is solved (profiles/solver/coupledStep.ts): 'picard' (frozen coefficients, Anderson mixing:
   * the fast path), 'newton' (Newton–Raphson on T_e, T_i, n_e and ψ together with a coloured finite-difference block-tridiagonal
   * Jacobian and a line search; a solve that does not converge is repeated by the Pereverzev–Corrigan stabilised Picard iteration), 'pc'
   * (that stabilised Picard iteration alone). Default 'auto': Newton for a predictive transport model ('cgm'), Picard for 'scaling'
   */
  nonlinearSolver?: 'auto' | 'picard' | 'newton' | 'pc';
  /**
   * impurities and helium ash of the 1.5D model (profiles/impurity/). 'legacy' (default): the scalar inventories (one He-ash content with the
   * confinement time τ_He* = (τ_He* over τ_E) τ_E, one uniform impurity concentration that relaxes to its set-point). 'anomalous': n_He(ρ) and the
   * densities of the intrinsic impurity (`impurity.species`), of the seeded species and of an optional third species are state of the model,
   * evolved on the finite-volume particle solver with the D and v of the electrons scaled by `impurityDoverDe` and `impurityPinchOverPe`, the helium
   * ash sourced by the local fusion rate and exhausted with the confinement time τ_He* of `transport.tau_He_over_tau_E`, the impurities fixed
   * at the separatrix to their concentration (`impurity.concentration` as a live control, `impurity.seedConcentration`, `impurityExtraConcentration`)
   * and, for tungsten, a wall source. 'facit': the same with the neoclassical D, K, H of FACIT (Fajardo et al., Plasma Phys. Control. Fusion 64
   * (2022) 055017) added. Both replace the scalar heuristics: the He confinement time enters as the exhaust only, the impurity profile is what the
   * transport makes of the boundary value, and the tungsten inventory of the wall source is S_W times the confinement time of the transport instead
   * of τ_Z (τ_W × 4 without ELMs and sawteeth; the crashes are in the profiles).
   */
  impurityTransport?: 'legacy' | 'anomalous' | 'facit';
  /**
   * meaning of the configured impurity concentrations (`impurity.concentration`, `impurity.seedConcentration`, `impurityExtraConcentration`) in the
   * profile-resolved modes: 'average' (default) the volume-average concentration N_z/N_e, as in the scalar model (a slow controller sets the separatrix
   * value that gives it, the steady inventory of a tungsten wall source is added to it); 'separatrix' the concentration at the separatrix (a fixed
   * boundary value, the profile is what the transport makes of it)
   */
  impuritySetpoint?: 'average' | 'separatrix';
  /** anomalous impurity diffusivity over electron D (default 1); zero disables anomalous particle flux, including its pinch, in 'anomalous' mode */
  impurityDoverDe?: number;
  /** anomalous impurity convection over the electron convection v (the turbulent pinch, independent of the charge; default 1) */
  impurityPinchOverPe?: number;
  /** third impurity species of the profile-resolved module (besides `impurity.species` and `impurity.seedSpecies`), with its concentration at the separatrix */
  impurityExtraSpecies?: ImpuritySpecies;
  impurityExtraConcentration?: number;
  /**
   * plasma-current programme, the boundary condition of the current diffusion equation as a function of time: points [t (s), I_p (MA)] in increasing
   * time, linearly interpolated and held constant beyond the first and last point (profiles/control/plasmaCurrent.ts). `Ip_MA` is what the initial
   * equilibrium is solved for and should equal the programme at t = 0. Default: I_p constant. A function of time is given to the model as
   * `ProfileModules.plasmaCurrent`.
   */
  IpWaveform?: ReadonlyArray<readonly [number, number]>;
  /** GS ızgarası R yönü düğüm sayısı */
  eqNR: number;
  /** denge güncelleme aralığı üst sınırı [s] */
  eqUpdateInterval: number;
  /** LCFS şekli (verilmezse geometry.kappa/delta) */
  lcfsKappa?: number;
  lcfsDelta?: number;
  /**
   * The 95 % surface shape (κ95, δ95) that lcfsKappa/lcfsDelta belong to (the ITER and DEMO presets: the nominal `geometry`). The 0D volume,
   * surface and cross-section (geometry.boundaryShape) then scale with the configuration's own κ, δ: κ_LCFS = lcfsKappa · κ/κ95_ref,
   * δ_LCFS = lcfsDelta · δ/δ95_ref, so an edited κ or δ moves them as it moves q95 and the scalings. Without it the LCFS values are absolute
   * (the 1.5D model always reads them so).
   */
  lcfsRef95?: { kappa: number; delta: number };
  /** 'scaling': τ_E ölçeklemesiyle kısıtlanmış taşınım (doğrulanmış global dinamik, fiziksel profil şekli);
   *  'cgm': kritik-gradyan modeli (öngörücü, kalibrasyonsuz);
   *  'bgb': mixed Bohm/gyro-Bohm model of Erba et al. (1997, 1998), JET-validated coefficients, non-local Bohm term (predictive);
   *  'ifspppl': IFS-PPPL ITG critical gradient and stiffness of Kotschenreuther et al. (1995) (predictive) */
  transportModel: 'scaling' | 'cgm' | 'bgb' | 'ifspppl';
  /** χ şekli ∝ 1 + chiShape·ρ² */
  chiShape: number;
  /** profil sertliği: χ ×= 1 + stiffness·max(0, (R/L_T)/critGrad − 1) (ITG/TEM kritik gradyanı) */
  stiffness: number;
  critGrad: number;
  /** χ_i / χ_e */
  chiRatio: number;
  /** D / χ_e */
  DoverChi: number;
  /** pedestal genişliği (ρ_tor) ve ETB bastırma çarpanı χ_ETB / χ_turb(ρ_ped) */
  pedestalWidth: number;
  etbFactor: number;
  /** ELM tetik eşiği çarpanı (α_crit) ve çöküş kesri ΔW/W_ped */
  alphaCritFactor: number;
  elmFraction: number;
  /**
   * pedestal model (profiles/pedestal/, WS6a). 'fixed' (default): the width `pedestalWidth`, the barrier depth `etbFactor` and the
   * ballooning limit α_crit (`alphaCritFactor`) of the settings above. 'eped1': an EPED1-type pedestal (Snyder et al., Phys. Plasmas 16
   * (2009) 056118): the width follows the KBM constraint Δ = 0.076 β_p,ped^{1/2}, the height is limited by the peeling–ballooning
   * constraint, the barrier depth adapts to hold the pedestal-top pressure at that limit and the ELM fires when it is exceeded.
   * `pedestalWidth` is then only the width until the first evaluation (the radial grid is packed for the EPED width, 0.045 in ρ̂), `etbFactor` is the barrier
   * depth at the limit (in H-mode it deepens up to 16 times below it) and the α_ped/α_crit test is not applied
   */
  pedestalModel?: 'fixed' | 'eped1';
  /** dimensionless peeling–ballooning pressure gradient dβ_p/dψ_N of the 'eped1' pedestal (default 6.2: the DIII-D fit of the maximum gradient before an ELM at I_p B_T = 3.2 MA T, Groebner et al., GA-A26243) */
  pedPbGradient?: number;
  /** KBM coefficient of the width Δ = c β_p,ped^{1/2} of the 'eped1' pedestal (default 0.076) */
  pedKbmCoefficient?: number;
  /** exponent of the pedestal density n_ped/n_G in the pedestal beta of the 'eped1' pedestal (default 0.34: least-squares power law through the EPED prediction for the ITER baseline, Snyder 2015; 0: the height does not depend on the density) */
  pedDensityExponent?: number;
  /**
   * ELM energy loss: 'fixed' (default): the fraction `elmFraction` × U(0.8, 1.2) of the pedestal-region energy. 'loarte': ΔW_ELM = f W_ped U(0.8, 1.2) with
   * f the fit to the pedestal-collisionality correlation of Loarte et al., Plasma Phys. Control. Fusion 45 (2003) 1549 (profiles/pedestal/loarte.ts)
   * and W_ped = (3/2) n_e,ped (T_e,ped + T_i,ped) V; the depth of the crash and, for the largest ELMs, the width of its region are those that carry that energy
   * (profiles/pedestal/elmSize.ts)
   */
  elmLoss?: 'fixed' | 'loarte';
  /** testere dişi tetik kayması s₁ */
  sawtoothShear: number;
  /** ECRH birikim merkezi / genişliği, ICRH genişliği (ρ_tor) */
  ecrhRho: number;
  ecrhWidth: number;
  icrhWidth: number;
  /** NBI teğet yarıçapı / R0 */
  nbiRtan: number;
  /** akım sürme verimleri γ [10²⁰ A W⁻¹ m⁻²] */
  nbcdEff: number;
  eccdEff: number;
  /**
   * Fast ions (NBI ions and the charged fusion products). 'scalar' (default): two scalar energy pools that give β its fast-ion pressure, the
   * heating instantaneous and local (profiles/fastIons.ts). 'profile': energy fields on the radial grid, one per beam energy component and one
   * for the fusion products, with the slowing-down delay of the heating and an orbit-width smoothing of the source; the fast pressure enters β,
   * the Grad–Shafranov pressure table and the ballooning drive (not the bootstrap current), and the beam-target rate follows the fields
   * (profiles/fastions/).
   */
  fastIonModel?: 'scalar' | 'profile';
  /** multiplier of the rms orbit width of the fast ions in the 'profile' model (default 1; 0: no orbit smoothing) */
  fastOrbitScale?: number;
  /**
   * Current drive of the 1.5D model. 'legacy' (default): I_CD = γ P/(n̄₂₀ R0) with the efficiency factors `nbcdEff`, `eccdEff` and the Gaussian ECRH
   * deposition of `ecrhRho`. 'physics': neutral-beam current drive from the fast-ion current of the slowing-down distribution (Gaffey, Cordey) with the
   * electron shielding and trapped-electron correction of Start and Cordey (Phys. Fluids 23 (1980) 1477), and electron-cyclotron current drive
   * from the launcher `eccd` with the efficiency of Lin-Liu, Chan and Prater (Phys. Plasmas 10 (2003) 4064) (profiles/cd/); no free efficiency factor.
   */
  cdModel?: 'legacy' | 'physics';
  /** ECCD launcher of cdModel 'physics' (defaults: second harmonic, n∥ 0.3, outboard midplane, aimed at ecrhRho with the width ecrhWidth) */
  eccd?: EccdLauncher;
  /**
   * Sawtooth trigger. 'shear' (default): s₁ > `sawtoothShear` at q = 1 (the simplified shear form). 'porcelli': the three conditions of Porcelli,
   * Boucher and Rosenbluth (Plasma Phys. Control. Fusion 38 (1996) 2163, equations 13-15) on the ideal, trapped-ion and fast-ion energy of the
   * internal kink, the diamagnetic stabilisation and the growth rate of the ion-kinetic layer.
   */
  sawtoothTrigger?: 'shear' | 'porcelli';
  /**
   * Sawtooth reconnection. 'legacy' (default): T_e, T_i, n_e flattened inside the mixing radius and q raised to 1.01 there. 'kadomtsev': the same
   * mixing and the poloidal flux reset of Kadomtsev's full reconnection, which conserves the helical flux ψ* = ψ − Φ/2π (reconnected surfaces
   * of equal ψ*, volume conserved): q of the mixed region rises above 1 continuously from the axis.
   */
  sawtoothReconnection?: 'legacy' | 'kadomtsev';
  /** sabit ayırıcı sıcaklığı [keV]; verilmezse iki-nokta modeli */
  Tsep_keV?: number;
  /** n_sep / ⟨n_e⟩ */
  nsepFrac: number;
  /**
   * Boundary conditions T_sep, n_sep of the transport equations. 'legacy' (default): the conduction-limited
   * two-point T_sep of profiles/boundary/sol.ts (outboard share 0.6, clamped to 0.03–0.5 keV).
   * 'twoPoint': T_sep = T_u of the edge model (src/physics/edge: Eich λ_q, divertor spreading, outer-leg share of P_SOL;
   * only the guard band of 5 eV – 2 keV), the same functions as the edge diagnostics. n_sep stays fuelling-controlled in both.
   */
  edgeModel?: 'legacy' | 'twoPoint';
  /**
   * Coefficients of the bootstrap current and of the neoclassical conductivity (profiles/neoclassical.ts, profiles/current/redl.ts).
   * 'sauter' (default): Sauter, Angioni and Lin-Liu, Phys. Plasmas 6 (1999) 2834 with the correction of 9 (2002) 5140. 'redl': Redl et al.,
   * Phys. Plasmas 28 (2021) 022502, the same structure refitted to the numerical code NEO: less bootstrap current in the collisional edge and
   * with impurities. Both use the trapped fraction, collisionalities and Z_eff of Sauter's definitions.
   */
  neoclassicalModel?: 'sauter' | 'redl';
}

/**
 * Edge (SOL and divertor) model options (src/physics/edge, a two-point model with Stangeby loss factors, Lengyel
 * radiation and Eich/Makowski heat-flux widths). All optional; the defaults and their sources are in
 * src/physics/edge/params.ts.
 */
export interface EdgeOptions {
  /** share of P_sep carried by the outer target leg (default 2/3) */
  outerShare?: number;
  /** divertor spreading S/λ_q (default 1.22, i.e. λ_int = 3 λ_q) */
  spreadingRatio?: number;
  /** absolute spreading S [mm]; overrides spreadingRatio */
  S_mm?: number;
  /** midplane heat-flux width [mm]; overrides the Eich regression #14 */
  lambdaQ_mm?: number;
  /** length of the divertor leg as a fraction of the connection length π q95 R (default 0.3) */
  divertorLengthFraction?: number;
  /** parallel electron conductivity κ0e [W m⁻¹ eV^{-7/2}] (default 2000) */
  kappa0e?: number;
  /** sheath heat transmission coefficient γ (default 7) */
  sheathGamma?: number;
  /** momentum/power loss fit vs. the target temperature (default 'stangeby1') */
  lossFit?: 'stangeby1' | 'stangeby2' | 'body2025';
  /** 'prescribed' (default): the divertor radiates divertor.f_rad_div of the power; 'lengyel': the seed impurity radiates (Lengyel model) */
  radiation?: 'prescribed' | 'lengyel';
  /** seed concentration of the SOL relative to impurity.seedConcentration (default 1) */
  seedEnrichment?: number;
  /** target electron temperature that defines the detachment onset of the c_z requirement [eV] (default 5) */
  detachTt_eV?: number;
  /** 1/sin β of the target plate (default 3) and the strike-point radius offset as a fraction of a (default 0.3) */
  targetTilt?: number;
  strikeRadiusFraction?: number;
}

/** Kesit çizimi için akı yüzeyi anlık görüntüsü (dengeden) */
export interface EqSnapshot {
  R: number[][];
  Z: number[][];
  rho: number[]; // her konturun ρ_tor değeri
  Raxis: number;
  Zaxis: number;
  q95: number;
  li: number;
  betaP: number;
}

export interface MagneticConfig {
  method: 'tokamak' | 'spherical_tokamak' | 'stellarator';
  geometry: Geometry;
  B0: number; // T eksen
  Ip_MA: number; // stellarator için 0 (bootstrap ihmal)
  fuel: FuelType;
  fuelFracA: number; // tür a oranı (D-T: n_D/(n_D+n_T))
  n_target: number; // hedef elektron yoğunluğu [m^-3]: 0D hacim ortalaması ⟨n_e⟩; 1.5D çizgi ortalaması n̄ (control/fueling.ts)
  n_rampTime: number; // s
  heating: {
    P_NBI_MW: number; E_NBI_keV: number;
    P_ICRH_MW: number; f_ICRH_ion: number;
    P_ECRH_MW: number;
    rampTime: number; // s
    /** ısıtmayı Q hedefine göre kapat (ateşleme testi) */
    autoOff: boolean;
  };
  fueling: { method: FuelingMethod; maxRate_1e20s: number; pelletDepth: number };
  impurity: {
    species: ImpuritySpecies; concentration: number; wallReflectivity: number; W_source_frac: number;
    /** Divertör tohumlama safsızlığı (Ar/Ne/N): sabit n_seed/n_e oranı (dinamik yok) */
    seedSpecies?: ImpuritySpecies; seedConcentration?: number;
  };
  H98: number; H89: number;
  /**
   * H-mode τ_E scaling (see transport.ts tauHmode): IPB98(y,2) (default), the spherical-tokamak scaling after Valovič, or the
   * ITPA20 / ITPA20-IL scalings of Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 (opt-in; they take the areal elongation and
   * the average LCFS triangularity, `profiles.lcfsDelta ?? geometry.delta`, not the 95 % values). Stellarators use ISS04.
   */
  scaling: 'IPB98y2' | 'ITPA20' | 'ITPA20-IL' | 'ST_Valovic';
  stellarator: {
    iota23: number;
    /** @deprecated alias: if H_ISS04 is not given, τ_E = f_ren · H98 · τ_ISS04 (the old behaviour) */
    f_ren: number;
    /** confinement multiplier relative to ISS04: τ_E = H_ISS04 · τ_ISS04 (when given, f_ren and H98 are not used) */
    H_ISS04?: number;
  };
  limits: { betaN_limit: number; greenwald_limit: number; q95_limit: number; W_conc_limit: number };
  transport: { tau_p_over_tau_E: number; tau_He_over_tau_E: number; alpha_n: number; alpha_T: number };
  events: { elms: boolean; sawteeth: boolean; ntm: boolean };
  magnet: { tech: MagnetTech; gap_m: number; coilThickness_m: number };
  blanket: { type: BlanketType; li6_enrichment: number; coverage: number };
  divertor: { f_rad_div: number; flux_expansion: number; /** edge model options (src/physics/edge) */ edge?: EdgeOptions };
  economics: { capital_MUSD_override?: number; availability: number; thermalEff: number; wallPlugEff: number; discountRate: number; lifetime_yr: number };
  t_end: number; // s
  seed: number;
  /** '1.5D' → profil taşınımı + Grad–Shafranov (stellarator için yok sayılır) */
  fidelity?: Fidelity;
  profiles?: Partial<ProfileSettings>;
  /** optional inputs of the systems-lite engineering models (TF coil, CS flux, radial build); only the shot report reads them */
  systems?: SystemsConfig;
}

/**
 * Optional inputs of the systems-lite engineering models (src/physics/systems, v4.0). Every field defaults to a documented
 * design-typical value of the magnet technology; the plasma models never read them, only the shot report does.
 */
export interface SystemsConfig {
  /**
   * design length of the plasma pulse of the plant [s] (current ramp-up + flat top + ramp-down): the time over which the pulsed-field
   * energy of the PF system and CS is spread in the cryoplant load. A property of the machine, NOT of the simulated shot: the shot
   * report gives the same cryoplant power for any t_end. Default: DEFAULT_PULSE_LENGTH_S of systems/cryo.ts (1055 s).
   */
  pulseLength_s?: number;
  tf?: {
    /** number of TF coils (default 18; 24 for copper coils; 50 for a stellarator) */
    nCoils?: number;
    /** share of the inboard-leg thickness that is solid steel case nose */
    noseFraction?: number;
    /** load-bearing area fraction of the winding pack region (steel jacket, plates, side walls) */
    structureFraction?: number;
    /** operating current per turn [A] (current-lead heat load) */
    turnCurrent_A?: number;
    /** share of the vertical tension in the inboard leg (0.5 for a D-shaped coil) */
    verticalInboardFraction?: number;
  };
  cs?: {
    /** smeared current density of the CS winding at the peak field [MA/m^2] (default by technology, 13.6 for Nb3Sn); sets the CS thickness B/(mu0 J) */
    currentDensity_MAm2?: number;
    /** peak field of the CS conductor [T] (default: the technology limit) */
    B_max_T?: number;
    /** share of the +B to -B swing that is used */
    swingFraction?: number;
    /** flux supplied by the PF coils [V s] (default 0) */
    pfFlux_Vs?: number;
    /** internal inductance l_i(3) of the plasma for the inductive flux (default 0.85, or the 1.5D value) */
    li?: number;
    /** outer radius of the solenoid [m] (default: the TF inner radius minus the CS-TF gap of systems/csFlux.ts) */
    outerRadius_m?: number;
    /** radial thickness of the solenoid winding [m]; sets the current density B_max / (mu0 t) and takes precedence over currentDensity_MAm2 */
    thickness_m?: number;
    /** height of the solenoid stack [m] (default: the height of the straight TF leg; stored energy and mass only) */
    height_m?: number;
    /**
     * Ejima coefficient C_E of the resistive flux of the current ramp-up, Psi_res = C_E mu0 R I_p (default 0.4, the middle of the experiments
     * and the PROCESS value; 0.45 is the ITER design value): the ramp-up before t = 0 of a shot that starts at the full current, in
     * both plasma models and in the budget of the shot report
     */
    ejima?: number;
  };
  blanket?: {
    /** inboard breeding-blanket depth [m] (default: 56 % of the space behind the first wall) */
    inboardDepth_m?: number;
    /** HCPB breeder fraction Li4SiO4 / (Li4SiO4 + Be12Ti) (default: the tritium-optimal one) */
    breederFraction?: number;
  };
}

export interface ICFConfig {
  method: 'icf_direct' | 'icf_indirect';
  E_laser_MJ: number;
  wavelength_nm: number;
  pulse_ns: number;
  capsuleRadius_um: number; // dış yarıçap
  fuelMass_ug: number; // DT
  ablatorMass_ug: number;
  ablator: 'CH' | 'HDC' | 'Be';
  adiabat: number; // α
  convergenceRatio: number; // CR hedef
  implosionVelocity_kms: number; // v_imp
  hohlraumEff: number; // dolaylı: lazer→x-ışını→kapsül
  absorption: number; // doğrudan: lazer soğurma
  asymmetry_rms: number; // % (düşük mod)
  surfaceRoughness_nm: number; // RT tohumu
  fuel: FuelType;
  seed: number;
  /** driver (laser) wall-plug efficiency, for Q_eng (default 0.1) */
  driverEff?: number;
  /** thermal → electric conversion efficiency, for Q_eng (default 0.4) */
  thermalEff?: number;
}

export interface MTFConfig {
  method: 'mtf_liner' | 'mtf_piston' | 'maglif' | 'zpinch_sfs';
  r0_m: number; // başlangıç plazma yarıçapı
  L_m: number; // uzunluk
  n0: number; // m^-3
  T0_keV: number;
  B0: number; // T
  compressionRatio: number; // r0/r_min
  driverEnergy_MJ: number;
  compressionTime_us: number;
  jitter_us: number; // piston senkron hatası
  linerThicknessRatio: number; // Δr/r (MRT için)
  preheat_kJ: number; // MagLIF lazer ön-ısıtma
  current_MA: number; // Z-pinch / MagLIF sürücü akımı
  flowShear: number; // Z-pinch kesme-akış (0-1) — stabilizasyon
  fuel: FuelType;
  seed: number;
}

export interface FRCConfig {
  method: 'frc';
  rs_m: number; // ayırıcı yarıçap
  L_m: number;
  Be_T: number; // dış alan
  n0: number; T0_keV: number;
  P_NBI_MW: number; E_NBI_keV: number;
  t_end: number; seed: number; fuel: FuelType;
}
export interface MirrorConfig {
  method: 'mirror';
  L_m: number; a_m: number; B_center_T: number; mirrorRatio: number;
  n0: number; T_keV: number; P_aux_MW: number; tandem: boolean;
  t_end: number; seed: number; fuel: FuelType;
  /** tandem end-plug potential eφ_c / T_i (default 1; tandem only) */
  plugPotential?: number;
}
export interface MuonConfig {
  method: 'muon';
  muonRate_per_s: number; muonCost_GeV: number; stickingProb: number; density_LHD: number; T_K: number;
  seed: number;
}

export type ReactorConfig = MagneticConfig | ICFConfig | MTFConfig | FRCConfig | MirrorConfig | MuonConfig;

/** Zaman serisi kanalı tanımı (UI grafikleri bu listeden okur) */
export interface DiagSpec {
  key: string;
  label: string;
  unit: string;
  group: string;
  log?: boolean;
}

export type EventKind = 'ELM' | 'sawtooth' | 'NTM_onset' | 'NTM_gone' | 'LH' | 'HL' | 'disruption' | 'quench' | 'ignition' | 'burn_start' | 'burn_end' | 'warning' | 'info' | 'stagnation' | 'end';

export interface SimEvent {
  t: number;
  kind: EventKind;
  msg: string;
  value?: number;
}

export interface TerminationInfo {
  t: number;
  reason: string; // kısa
  diagnosis: string; // öğretici cümle
  fix: string;
  disruption?: DisruptionReport;
  natural: boolean; // planlı bitiş (t_end)
}

export interface SimModel {
  readonly kind: 'magnetic' | 'pulsed';
  readonly method: Method;
  readonly timeUnit: 's' | 'ns' | 'µs';
  readonly tEnd: number;
  readonly outputDt: number;
  readonly nState: number;
  readonly diagSpecs: DiagSpec[];
  /**
   * Dormand–Prince controller settings. Required together with rhs() unless the model provides its
   * own step(): Simulation builds no Dormand–Prince stepper for such a model and rejects a model
   * that has neither (ModelContractError).
   */
  readonly integratorOpts?: IntegratorOptions;
  readonly dt0: number;
  initialState(): Float64Array;
  /**
   * Right-hand side of dy/dt = f(t, y) for the Dormand–Prince stepper; optional when the model
   * provides step(). It must be a function of (t, y), the live controls and the state that
   * saveInternal() captures, and may only write caches that it does not read back (the kernel
   * reuses the last stage of an accepted step as the first stage of the next one when the model
   * state is unchanged in between: Simulation option `fsal`).
   */
  rhs?(t: number, y: Float64Array, dydt: Float64Array): void;
  /**
   * Diagnostics of the state y at time t. They must describe the y that is passed in: a model that
   * caches the diagnostics of its last rhs() evaluation has to refresh the cache whenever postStep()
   * changes y (Simulation records a frame right after postStep()).
   */
  diagnostics(t: number, y: Float64Array): Record<string, number>;
  /** kabul edilen adımdan sonra; y'yi değiştirebilir (ELM vb.) ve olay üretebilir */
  postStep(t: number, dt: number, y: Float64Array): SimEvent[];
  /**
   * How the shot ended, or null while it runs. Read-only for consumers; the model sets it, and
   * Simulation.rewindTo() writes back the value stored in the frame's checkpoint (after
   * restoreInternal()), so implementations must keep it a writable data property.
   */
  readonly terminated: TerminationInfo | null;
  /** canlı müdahale */
  applyControl(patch: Record<string, number>): void;
  getControls(): Record<string, number>;
  /**
   * RNG/dahili durumun kaydı (geri sarma için). Whatever rhs() and postStep() read and that can
   * change must be in it or in getControls(): the exact rewind and the kernel's stage reuse (see
   * rhs) depend on that. The kernel calls it twice per Dormand–Prince step, so it must be cheap
   * and free of side effects.
   */
  saveInternal(): Record<string, number>;
  restoreInternal(s: Record<string, number>): void;
  /** atış sonu raporu */
  report(history: HistoryFrame[], events: SimEvent[]): ShotReport;
  /** statik: geometrik çizim verisi */
  geometryInfo(): Record<string, number>;
  /**
   * İsteğe bağlı kendi zaman adımlayıcısı (örtük PDE çözücüleri): verilirse Simulation
   * Dormand–Prince yerine bunu çağırır (rhs() ve integratorOpts gerekmez); y yerinde güncellenir,
   * yeni t döner (≤ tMax). A step that ends the shot (sets `terminated`, e.g. a numerical failure)
   * may return t unchanged; Simulation then still records the terminal frame (see HistoryFrame).
   */
  step?(t: number, y: Float64Array, tMax: number): number;
  /**
   * Optional resumable form of step() (kernel/slices.ts): a generator that yields at the points where the kernel may
   * suspend the step and returns the new time. It has the meaning of step() exactly, and step() is what running it to
   * its end gives: same y, same state, bitwise (a model implements one body and derives the other form). Simulation
   * uses it only when the caller of advance() passes `yieldWhen`, to return to that caller in the middle of a step; a model
   * without it is stepped whole. Rules for the model: hold the step's state in the generator's locals and in the model's own
   * fields (never in anything that is not restored by restoreInternal()/restoreCheckpoint() and reset by the step); while the
   * step is suspended the kernel calls nothing on the model but the generator's next() and return(), and getControls(),
   * terminated and currentDt, which must be readable; a step that is dropped (return()) is followed by rewindTo(), which
   * restores the model from a checkpoint, so the model need not undo it. See the Simulation header, "Step atomicity".
   */
  stepSlices?(t: number, y: Float64Array, tMax: number): Generator<void, number, void>;
  /** son adımın önerdiği zaman adımı (UI gösterimi) */
  readonly currentDt?: number;
  /** İsteğe bağlı radyal profil anlık görüntüsü (1.5D) — geçmiş karelerine eklenir */
  profiles?(y: Float64Array): Record<string, number[]>;
  /** Denge değiştiyse yeni akı yüzeyi görüntüsü (bir kez döner, sonra null) */
  takeEqSnapshot?(): EqSnapshot | null;
  /**
   * Optional checkpoint of dynamic model state that saveInternal() cannot hold (arrays, strings,
   * sets, solver objects). Called right after saveInternal() whenever a frame is recorded; the
   * kernel keeps the value in frame.sim.model and on rewind calls restoreCheckpoint() with it after
   * restoreInternal(). The value must be structured-clonable data that is never mutated afterwards
   * (immutable parts, e.g. an equilibrium, may be shared between frames).
   */
  saveCheckpoint?(): unknown;
  restoreCheckpoint?(state: unknown): void;
}

/**
 * One recorded frame. Frame times increase strictly with one exception: the frame that ends a shot
 * (its `sim.terminated` is set) shares its time with the previous frame when the step that ended
 * the shot made no progress in time (a model's own stepper gave up: 'Numerical failure'). Its state
 * and diagnostics then equal the previous frame's; it exists to carry the termination and the
 * final checkpoint, so that a rewind to the last frame keeps the shot ended.
 */
export interface HistoryFrame {
  t: number;
  y: number[]; // durum (geri sarma için)
  d: Record<string, number>;
  internal: Record<string, number>;
  /** radyal profiller (yalnız 1.5D, düzenli çıktı karelerinde) */
  prof?: Record<string, number[]>;
  /** akı yüzeyleri (yalnız dengenin güncellendiği karelerde) */
  eq?: EqSnapshot;
  /** kernel checkpoint for an exact rewind (written by Simulation since v4) */
  sim?: SimCheckpoint;
}

/**
 * Simulation kernel state at a history frame, taken right after the frame was recorded.
 * Together with the frame's t, y and internal it is everything Simulation.rewindTo() needs to
 * continue exactly as the uninterrupted run did.
 */
export interface SimCheckpoint {
  /** steps taken by the kernel so far (the actuator log's step index) */
  steps: number;
  /** next regular output time */
  nextOut: number;
  /** next synchronisation point (see Simulation) */
  nextSync: number;
  /** index of the next user breakpoint */
  nextBreak: number;
  /** number of events in Simulation.events when the frame was recorded */
  nEvents: number;
  /** Dormand–Prince controller state; absent for models with their own stepper (no Dormand–Prince stepper exists then) */
  integ?: IntegratorSnapshot;
  /** the model's live controls (getControls()) in force at the frame */
  controls: Record<string, number>;
  /**
   * SimModel.terminated at the frame (a copy; null while the shot runs). restoreInternal() clears
   * it, so without it a rewind to the final frame of a finished, disrupted or quenched shot would
   * bring the shot back to life.
   */
  terminated: TerminationInfo | null;
  /** SimModel.saveCheckpoint() at the frame, for models that implement it */
  model?: unknown;
  /** state of the scenario engine at the frame (only for a run with a scenario, SimulationOptions.scenario; see scenario.ts) */
  scenario?: ScenarioState;
}

/**
 * One live intervention (Simulation.applyControl). It takes effect at the step boundary where it
 * was applied: after `step` kernel steps, at time `t`, before step `step + 1` begins.
 */
export interface ActuatorEntry {
  t: number;
  step: number;
  patch: Record<string, number>;
}

export interface ScoreEntry {
  label: string;
  value: number;
  ref: number;
  unit: string;
  note: string;
}

export interface ShotReport {
  method: Method;
  duration: number; // In timeUnit (s, ns, or µs).
  timeUnit: string;
  Tmax_keV: number;
  Tmax_MC: number; // milyon °C
  Timax_keV: number;
  Temax_keV: number;
  /** Stable, burn, and ignition times are always in seconds, regardless of timeUnit. */
  stableTime_s: number;
  burnTime_s: number;
  ignitionTime_s: number;
  stableDefinition: string;
  Q_sci_max: number;
  Q_sci_avg: number;
  Q_eng: number;
  Q_eng_note: string;
  E_fusion_MJ: number;
  E_input_MJ: number;
  neutronYield: number; // toplam nötron sayısı
  neutronFluence_m2: number; // n/m²
  tripleProduct_max: number; // keV s m^-3
  lawson_ratio: number; // nTτ / (nTτ)_ateşleme
  lawsonNote: string;
  termination: TerminationInfo;
  score: number; // 0-100
  scoreBreakdown: ScoreEntry[];
  historical: { label: string; ratio: number; note: string }[];
  warnings: string[];
  engineering: Record<string, number | string | boolean>;
  extras: Record<string, number | string>;
}
