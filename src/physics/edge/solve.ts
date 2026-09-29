/**
 * Two-point model of the outer divertor leg with volumetric losses, Lengyel radiation and the Eich heat-flux
 * width: the one set of pure functions behind the 0D diagnostics, the 1.5D separatrix boundary and POPCON.
 *
 * Chain of one flux tube (the peak tube of the outer leg), from the outer midplane u to the target t:
 *
 *   u ─ conduction (T_u) ─ x (divertor entrance, T_x) ─ conduction ─ cc (T_cc = T_t) ─ recycling layer ─ t
 *
 *   q_u = f_out P_sep B / (2π R_u λ_q B_p)         parallel heat-flux density at the outer midplane (λ_q: Eich #14)
 *   T_x^{7/2} = T_t^{7/2} + (7/2)(q_u/b) L_div/κ0e            T_u^{7/2} = T_x^{7/2} + (7/2) q_u (L − L_div)/κ0e
 *       (conduction with the heat-flux density of the unradiated tube, T_u ∝ (q L)^{2/7}; b = λ_int/λ_q below X)
 *   q_cc:   'lengyel'    radiation of the seed impurity between T_t and T_u (lengyel.ts: the heat flux surviving c_z)
 *           'prescribed' the divertor radiates the fraction f_rad,div of the power: q_cc = (1 − f_rad,div) q_u / b
 *   q_t = (1 − f_cool(T_t)) q_cc               recycling layer (Stangeby loss factor, losses.ts)
 *   q_t = γ (1 − f_mom(T_t)) n_u T_u (T_t/2m_i)^{1/2}          sheath and momentum balance (twoPoint.ts)
 *
 * The last two equations determine T_t. They are bistable at high recycling (an attached and a detached state of the same
 * n_u, q_u, c_z); the largest root, the attached branch a discharge follows while it is being seeded, is taken. It ends where
 * the radiation removes all of the power (the collapse of the target heat flux, within a few percent to ×1.5 of the
 * concentration of `cz_det` at ITER-like conditions); beyond it, or if no root exists above the floor, T_t is the floor
 * (0.5 eV) and `TtFloor` is set.
 *
 * Power ledger of the outer leg (P_leg = f_out P_sep), closed to rounding by construction and, for the Lengyel
 * radiation, checked against the radiated power computed from the cooling integrals:
 *   P_rad = f_rad P_leg,  P_cool = (1 − f_rad) f_cool P_leg,  P_t = (1 − f_rad)(1 − f_cool) P_leg,
 * with f_rad = 1 − b q_cc/q_u; the inner leg (1 − f_out) P_sep is not modelled.
 * Peak load on the target plate: q_⊥,peak = P_t / A_wet, A_wet = 2π R_t λ_int f_x / sin β (the Eich profile
 * peaks at P/A with the integral width λ_int); q_⊥,peak of the plasma at the sheath, without the (broader)
 * loads of neutrals and photons.
 *
 * Sources: P. C. Stangeby, Plasma Phys. Control. Fusion 60 (2018) 044022 (loss factors); T. Eich et al., Nucl.
 * Fusion 53 (2013) 093031 (λ_q); M. A. Makowski et al., Phys. Plasmas 19 (2012) 056122 (λ_int); the extended
 * Lengyel model of T. Body, A. Kallenbach and T. Eich, arXiv:2504.05486 (2025); details in the modules.
 * APPROXIMATIONS: T_i = T_e; T_u from the unradiated conduction (the radiation acts on the heat flux
 * below T ≈ 100–150 eV, upstream of that the conduction is nearly unaffected: the connection length of the Lengyel profile
 * is 0.5–3 % longer above and 2–13 % below the X-point at radiated fractions up to 18 %, i.e. T_u is too high by ≲ 2 %,
 * lengyel.test.ts; it grows with the radiated fraction); no B variation along the tube; no cross-field power exchange;
 * one flux tube stands for the profile.
 */
import { brent } from '../numerics/roots';
import type { ImpuritySpecies } from '../constants';
import { B_POL_FLOOR, eichLambdaQ_mm, integralWidth_mm } from './scalings';
import { coolingLoss, momentumLoss } from './losses';
import { LengyelIntegral, lengyelConcentration, lengyelFluxes, mavrinLengyel } from './lengyel';
import { conductionTemperature, sheathHeatFlux, targetDensity } from './twoPoint';
import { DetachmentState, detachmentConcentration, detachmentQualifier, detachmentState, divertorPressure } from './detachment';
import { DEFAULT_EDGE_PARAMS, EdgeParams } from './params';

/** Plasma and machine inputs of the edge model (SI) */
export interface EdgePlasma {
  /** power crossing the separatrix [W] */
  P_sep: number;
  /** major radius on axis and minor radius [m] */
  R: number; a: number;
  /** major radius of the outer midplane separatrix [m] (default R + a) */
  R_u?: number;
  /** toroidal field on axis [T] */
  B0: number;
  /** poloidal field at the outer midplane [T] (Eich #14 and the flux-tube geometry) */
  B_pol: number;
  q95: number;
  /** separatrix (upstream) electron density [m⁻³] */
  n_sep: number;
  /** main-ion mass [kg] */
  m_i: number;
  /** flux expansion of the target */
  f_x: number;
  /** radiated fraction of the divertor leg (mode 'prescribed') */
  f_rad_div: number;
  /** seed impurity of the SOL: species and concentration n_z/n_e */
  seed?: { species: ImpuritySpecies; c: number };
}

export interface EdgeResult {
  /** λ_q (Eich #14 or the override), S, λ_int [mm] and b = λ_int/λ_q */
  lambda_q_mm: number; S_mm: number; lambda_int_mm: number; b: number;
  /** parallel heat-flux density of the peak flux tube at the outer midplane [W/m²]; connection length and divertor leg [m] */
  q_u: number; L_par: number; L_div: number;
  /** temperatures at the divertor entrance and upstream (the separatrix value T_sep) [eV] */
  T_x: number; T_u: number;
  /** upstream electron pressure n_u T_u [m⁻³ eV] */
  p_u: number;
  /** target electron temperature [eV]; the floor of the solver was reached (fully detached) */
  T_t: number; TtFloor: boolean;
  /** target electron density [m⁻³] and parallel heat-flux density [W/m²] of the peak tube */
  n_t: number; q_t: number;
  /** momentum loss, recycling-layer power loss, radiated fraction of the leg, total power loss of the leg */
  f_mom: number; f_cool: number; f_rad: number; f_pwr: number;
  /** power ledger [W] */
  P_sep: number; P_leg: number; P_rad: number; P_cool: number; P_target: number; P_inner: number;
  /** relative closure of the ledger, and of the radiated power against the cooling integrals (Lengyel radiation; 0 otherwise) */
  closure: number; closureLengyel: number;
  /** wetted area of the target plate [m²] and peak perpendicular heat-flux density [MW/m²] */
  A_wet: number; q_peak: number;
  /** P_sep/R [MW/m] */
  P_sep_R: number;
  /** attached (0), partially detached (1), detached (2) */
  state: DetachmentState;
  /** Kallenbach qualifier and the divertor neutral pressure [Pa] that goes with n_sep */
  q_det: number; p_div: number;
  /**
   * seed concentration of the SOL at which the Lengyel model has a state with T_t = detachTt_eV, its sheath and the
   * heat flux that survives the radiation in balance (0: such a state exists without seed; Infinity: no cooling); the concentration of
   * the onset of detachment: at high recycling the attached branch collapses within a few percent to ×1.5 of it. An UPPER BOUND
   * (lengyel.ts). The species it refers to (the seed, else neon) and the share of its cooling integral from below 100 eV follow
   */
  cz_det: number; cz_species: ImpuritySpecies; cz_belowFit: number;
  /** concentration at which q_det = 1 for the same species (NaN: no radiative efficiency known) */
  cz_qdet: number;
}

/** floor of P_sep that keeps the fluxes finite and positive [W] */
const P_SEP_FLOOR = 1e3;
const N_SCAN = 40;

const fin = (x: number, d: number) => (Number.isFinite(x) ? x : d);

/** the cooling integral of a species: the one of the parameters, else Mavrin */
function lengyelOf(par: EdgeParams, species: ImpuritySpecies): LengyelIntegral {
  return par.lengyel?.[species] ?? mavrinLengyel(species);
}

interface Geometry {
  lq: number; S: number; lint: number; b: number;
  q_u: number; L: number; L_div: number; P_sep: number; P_leg: number;
}

function geometryOf(pl: EdgePlasma, par: EdgeParams): Geometry {
  const R = Math.max(fin(pl.R, 1), 1e-3), a = Math.max(fin(pl.a, 0.5), 1e-3);
  const Ru = pl.R_u !== undefined && Number.isFinite(pl.R_u) ? pl.R_u : R + a;
  const Bp = Math.max(fin(pl.B_pol, B_POL_FLOOR), B_POL_FLOOR);
  const Bt = (Math.max(fin(pl.B0, 1), 1e-3) * R) / Ru;
  const B = Math.hypot(Bt, Bp);
  const lq = par.lambdaQ_mm ?? eichLambdaQ_mm(Bp);
  const S = par.S_mm ?? par.spreadingRatio * lq;
  const lint = integralWidth_mm(lq, S);
  const P_sep = Math.max(fin(pl.P_sep, 0), P_SEP_FLOOR);
  const P_leg = par.outerShare * P_sep;
  const q_u = (P_leg * B) / (2 * Math.PI * Ru * lq * 1e-3 * Bp);
  const L = Math.PI * Math.max(fin(pl.q95, 3), 1.5) * R;
  return { lq, S, lint, b: lint / lq, q_u, L, L_div: par.divertorLengthFraction * L, P_sep, P_leg };
}

/** Upstream and divertor-entrance temperatures for a target temperature (conduction, unradiated tube) */
function temperatures(g: Geometry, par: EdgeParams, Tt: number): { Tx: number; Tu: number } {
  const Tx = conductionTemperature(Tt, g.q_u / g.b, g.L_div, par.kappa0e);
  return { Tx, Tu: conductionTemperature(Tx, g.q_u, g.L - g.L_div, par.kappa0e) };
}

/** Cooling integral of the seed of a 'lengyel' run, or undefined (no radiation by the seed) */
function seedIntegral(pl: EdgePlasma, par: EdgeParams): { li: LengyelIntegral; c: number } | undefined {
  const s = pl.seed;
  if (par.radiation !== 'lengyel' || !s || !(s.c > 0)) return undefined;
  return { li: lengyelOf(par, s.species), c: s.c };
}

export function solveEdge(pl: EdgePlasma, par: EdgeParams = DEFAULT_EDGE_PARAMS): EdgeResult {
  const g = geometryOf(pl, par);
  const n_u = Math.max(fin(pl.n_sep, 1e19), 1e15);
  const m_i = Math.max(fin(pl.m_i, 3.34e-27), 1e-28);
  // 'lengyel': all radiation comes from the seed (none without one); 'prescribed': the divertor radiates f_rad,div
  const fRadDiv = par.radiation === 'lengyel' ? 0 : Math.min(Math.max(fin(pl.f_rad_div, 0), 0), 1);
  const seed = seedIntegral(pl, par);

  /** everything that depends on T_t: temperatures, losses, the heat flux that arrives and the sheath flux */
  const branch = (Tt: number) => {
    const { Tx, Tu } = temperatures(g, par, Tt);
    const fMom = momentumLoss(Tt, par.fit), fCool = coolingLoss(Tt, par.fit);
    let qx = g.q_u, qcc = (1 - fRadDiv) * g.q_u / g.b;
    if (seed) ({ q_x: qx, q_cc: qcc } = lengyelFluxes({ q_u: g.q_u, b: g.b, p: n_u * Tu, T_cc: Tt, T_x: Tx, T_u: Tu, kappa0: par.kappa0e }, seed.c, seed.li));
    return { Tx, Tu, fMom, fCool, qx, qcc, qSheath: sheathHeatFlux(n_u, Tu, Tt, fMom, m_i, par.sheathGamma) };
  };
  const F = (Tt: number) => { const br = branch(Tt); return br.qSheath - (1 - br.fCool) * br.qcc; };

  // largest root of F on [floor, T_hi]: start above the unradiated upstream temperature, scan down to the first sign change
  const Tfloor = par.TtFloor_eV;
  let hi = Math.max(temperatures(g, par, 0).Tu, 4 * Tfloor);
  let guard = 0;
  while (F(hi) <= 0 && guard++ < 40) hi *= 2;
  let Tt = Tfloor, floor = true;
  if (F(hi) <= 0) {
    // no sheath-limited root in reach (n_u absurdly low): the largest temperature tried
    Tt = hi; floor = false;
  } else {
    let prev = hi;
    for (let k = 1; k <= N_SCAN; k++) {
      const T = hi * Math.pow(Tfloor / hi, k / N_SCAN);
      if (F(T) < 0) {
        Tt = Math.exp(brent((x) => F(Math.exp(x)), Math.log(T), Math.log(prev), 1e-13));
        floor = false;
        break;
      }
      prev = T;
    }
  }
  const br = branch(Tt);
  const q_t = (1 - br.fCool) * br.qcc;

  // fractions and ledger
  const fRad = Math.min(Math.max(1 - (g.b * br.qcc) / g.q_u, 0), 1);
  const fPwr = 1 - (1 - fRad) * (1 - br.fCool);
  const P_rad = fRad * g.P_leg, P_cool = (1 - fRad) * br.fCool * g.P_leg, P_target = (1 - fRad) * (1 - br.fCool) * g.P_leg;
  const P_inner = g.P_sep - g.P_leg;
  const closure = Math.abs(P_rad + P_cool + P_target + P_inner - g.P_sep) / g.P_sep;
  let closureLengyel = 0;
  if (seed) {
    // radiated power from the cooling integrals: (q_u − q_x) + b (q_x/b − q_cc) per unit of upstream flux-tube area, with
    // K I = q² difference of each segment: K I_2/(q_u + q_x) + b K I_1/(q_x/b + q_cc)
    const K = 2 * par.kappa0e * (n_u * br.Tu) ** 2 * seed.c;
    const I1 = seed.li.integral(Tt, br.Tx), I2 = seed.li.integral(br.Tx, br.Tu);
    const perArea = K * I2 / (g.q_u + br.qx) + (g.b * K * I1) / (br.qx / g.b + br.qcc);
    const Prad_L = (g.P_leg / g.q_u) * perArea;
    closureLengyel = br.qcc > 0 ? Math.abs(Prad_L - P_rad) / g.P_sep : 0;
  }

  // loads
  const R = Math.max(fin(pl.R, 1), 1e-3), a = Math.max(fin(pl.a, 0.5), 1e-3);
  const Rt = R - par.strikeRadiusFraction * a;
  const A_wet = 2 * Math.PI * Rt * (g.lint * 1e-3) * Math.max(fin(pl.f_x, 1), 1e-3) * par.targetTilt;
  const q_peak = P_target / A_wet / 1e6;

  // detachment
  const species: ImpuritySpecies = pl.seed?.species ?? 'Ne';
  const q_det = detachmentQualifier(g.P_sep, R, n_u, g.lint, pl.seed);
  const cz = requiredSeedConcentration(par, species, g, n_u, m_i);

  return {
    lambda_q_mm: g.lq, S_mm: g.S, lambda_int_mm: g.lint, b: g.b,
    q_u: g.q_u, L_par: g.L, L_div: g.L_div, T_x: br.Tx, T_u: br.Tu, p_u: n_u * br.Tu,
    T_t: Tt, TtFloor: floor, n_t: targetDensity(n_u, br.Tu, Tt, br.fMom), q_t,
    f_mom: br.fMom, f_cool: br.fCool, f_rad: fRad, f_pwr: fPwr,
    P_sep: g.P_sep, P_leg: g.P_leg, P_rad, P_cool, P_target, P_inner, closure, closureLengyel,
    A_wet, q_peak, P_sep_R: g.P_sep / 1e6 / R,
    state: detachmentState(Tt),
    q_det, p_div: divertorPressure(n_u),
    cz_det: cz.c, cz_species: species, cz_belowFit: cz.belowFit,
    cz_qdet: detachmentConcentration(g.P_sep, R, n_u, g.lint, species),
  };
}

/**
 * Lengyel concentration of the species at which the target temperature is the detachment temperature
 * (par.detachTt_eV): the heat flux that the sheath can take at T_det, q_cc = q_sheath/(1 − f_cool), against the heat flux
 * that arrives, q_u/b. Independent of the radiation mode of the run.
 */
function requiredSeedConcentration(par: EdgeParams, species: ImpuritySpecies, g: Geometry, n_u: number, m_i: number): { c: number; belowFit: number } {
  const Tdet = par.detachTt_eV;
  const { Tx, Tu } = temperatures(g, par, Tdet);
  const fMom = momentumLoss(Tdet, par.fit), fCool = coolingLoss(Tdet, par.fit);
  if (!(fCool < 1)) return { c: Infinity, belowFit: 1 };
  const qcc = sheathHeatFlux(n_u, Tu, Tdet, fMom, m_i, par.sheathGamma) / (1 - fCool);
  const li = lengyelOf(par, species);
  const c = lengyelConcentration({ q_u: g.q_u, b: g.b, p: n_u * Tu, T_cc: Tdet, T_x: Tx, T_u: Tu, kappa0: par.kappa0e }, qcc, li);
  return { c, belowFit: li.belowFitShare(Tdet, Tu) };
}
