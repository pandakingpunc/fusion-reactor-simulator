/**
 * Steady-state evaluator: the POPCON power balance (src/physics/popcon.ts) solved at ONE operating point, with the intermediate
 * quantities an optimiser needs (loss power, L-H threshold, radiation, q95, ...), which the POPCON grid does not keep.
 *
 * At the volume-averaged density <n_e> and temperature <T> (T_i = T_e, H-mode confinement H98 x the selected scaling everywhere, IPB98(y,2)
 * by default; no beam-target fusion, no ohmic power, the same approximations as the POPCON map) the auxiliary power that holds the plasma
 * in steady state is
 *   P_aux + P_alpha = P_rad + W / tau_E(P_L),   P_L = P_heat - P_rad,core = P_aux + P_alpha - P_rad,core   (dW/dt = 0)
 * solved by the same fixed-point iterations as POPCON (tau_E ~ P^-0.69 makes them contract; the He ash fraction by an outer
 * loop of four passes). The result is Q = P_fus / P_aux, the L-H margin P_L / P_LH (Martin 2008 with the Ryter 2014 low-density
 * branch, line-averaged density), beta_N (Troyon 1984), n_bar / n_Greenwald and q95.
 *
 * Consistency with POPCON. The code below repeats the loop of computePopcon (popcon.ts) for a single (n, T) instead of a grid; a test
 * (steadyState.test.ts) evaluates both at the nodes of a grid for every kind of magnetic preset and requires agreement to 1e-12, so
 * a change to the POPCON physics that is not made here as well fails it. Cost: about a tenth of a millisecond per point.
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { MagneticConfig } from '../physics/types';
import { arealElongation, boundaryShape, plasmaSurface, plasmaVolume, profileIntegral, profileIntegralSplit, q95ForMethod } from '../physics/geometry';
import { tauHmode, tauISS04, pLH_threshold, stellaratorHISS04 } from '../physics/transport';
import { FUEL_CHANNELS, FUEL_SPECIES, pairDensity } from '../physics/reactivity';
import { bremsstrahlung, coolingRate, meanCharge, synchrotronTotal, RHO_CORE } from '../physics/radiation';
import { greenwaldDensity, betaToroidal, betaNormalized, lineAverageFactor } from '../physics/limits';

const E_KEV = 1.602176634e-16;
const MEV = 1.602176634e-13;

export interface SteadyState {
  /** volume-averaged electron density [m^-3] and temperature [keV] of the point */
  n: number;
  T: number;
  /** auxiliary power that sustains the point [W]; <= 0 when the alpha heating alone exceeds the losses (ignition) */
  Paux: number;
  /** fusion power [W] and the charged-product (alpha) heating [W] */
  Pfus: number;
  Pchar: number;
  /** total and core (rho < RHO_CORE) radiated power [W] */
  Prad: number;
  PradCore: number;
  /** loss power P_L = P_heat - P_rad,core [W] and the L-H threshold power [W] */
  PL: number;
  PLH: number;
  /** P_L reaches the L-H threshold (the assumed H-mode is accessible) */
  hmodeAccess: boolean;
  /** P_fus / P_aux (Infinity if P_aux <= 0) */
  Q: number;
  /** energy confinement time [s], stored thermal energy [J] */
  tauE: number;
  W: number;
  /** helium ash fraction n_He / n_e */
  fHe: number;
  betaN: number;
  /** line-averaged density over the Greenwald density */
  nOverNG: number;
  q95: number;
  /** plasma volume [m^3] */
  V: number;
}

/** Steady-state power balance of a tokamak, spherical tokamak or stellarator at the volume-averaged (n, T); see the file header. */
export function steadyState(cfg: MagneticConfig, n: number, T: number): SteadyState {
  // volume and surface of the boundary (LCFS) shape, and the geometry of the ITPA20 scalings, exactly as computePopcon (popcon.ts)
  const g = cfg.geometry, gB = boundaryShape(cfg), V = plasmaVolume(gB), S = plasmaSurface(gB);
  const gITPA = { R: g.R, a: g.a, kappa: arealElongation(gB), delta: gB.delta };
  const stell = cfg.method === 'stellarator';
  const aN = cfg.transport.alpha_n, aT = cfg.transport.alpha_T;
  const pk = (1 + aN) * (1 + aN);
  const chans = FUEL_CHANNELS[cfg.fuel], fs = FUEL_SPECIES[cfg.fuel];
  const fA = cfg.fuelFracA;
  const M = fA * fs.a.A + (1 - fA) * fs.b.A;
  const zDen = fA * fs.a.Z + (1 - fA) * fs.b.Z;
  const im = cfg.impurity;
  const cs = im.seedConcentration ?? 0;
  const Wprof = ((1 + aN) * (1 + aT)) / (1 + aN + aT);
  const fLine = lineAverageFactor(aN);
  const tauOf = (ne: number, P: number) => stell
    ? tauISS04(g, cfg.B0, fLine * ne, P, cfg.stellarator.iota23, stellaratorHISS04(cfg.stellarator, cfg.H98))
    : tauHmode(cfg.scaling, cfg.scaling === 'ITPA20' || cfg.scaling === 'ITPA20-IL' ? gITPA : g, cfg.Ip_MA, cfg.B0, fLine * ne, P, M) * cfg.H98;
  const sh = (r: number) => 1 - r * r;
  const ne = n;
  // profile integrals that depend on T only
  const T0 = T * (1 + aT);
  const prof = (f: (Tl: number) => number, N = 24) => profileIntegral((r) => Math.pow(sh(r), 2 * aN) * f(T0 * Math.pow(sh(r), aT)), N);
  const profS = (f: (Tl: number) => number, N = 24) => profileIntegralSplit((r) => Math.pow(sh(r), 2 * aN) * f(T0 * Math.pow(sh(r), aT)), RHO_CORE, N);
  const Ich = chans.map((ch) => prof(ch.sigmav, 32));
  const Ibr0 = profS((Tl) => bremsstrahlung(1, Tl, 0)), Ibr01 = profS((Tl) => bremsstrahlung(1, Tl, 1));
  const Ibr1 = Ibr01.total - Ibr0.total, Ibr1c = Ibr01.inner - Ibr0.inner;
  const Iline = profS((Tl) => coolingRate(im.species, Tl));
  const Iseed = im.seedSpecies && cs ? profS((Tl) => coolingRate(im.seedSpecies!, Tl)) : { total: 0, inner: 0 };
  const Zz = meanCharge(im.species, T);
  const Zs = im.seedSpecies ? meanCharge(im.seedSpecies, T) : 0;

  let fHe = 0, P_loss = 1e6, P_tr = 0, Pf = 0, Pch = 0, Prad = 0, PradCore = 0, W = 0;
  for (let outer = 0; outer < 4; outer++) {
    const nfe = Math.max(ne * (1 - Zz * im.concentration - Zs * cs - 2 * fHe), 0);
    const na = (nfe * fA) / zDen, nb = (nfe * (1 - fA)) / zDen;
    const ni = na + nb + (fHe + im.concentration + cs) * ne;
    let ash = 0; Pf = 0; Pch = 0;
    chans.forEach((ch, k) => {
      const R = pairDensity(cfg.fuel, ch, na, nb) * pk * Ich[k] * V;
      ash += R * ch.ash; Pf += R * ch.Etot_MeV * MEV; Pch += R * ch.Echarged_MeV * MEV;
    });
    const Zmain = (na * fs.a.Z ** 2 + nb * fs.b.Z ** 2 + 4 * fHe * ne) / ne;
    const Pbr = ne * ne * pk * (Ibr0.total + Zmain * Ibr1) * V;
    const Pline = ne * ne * pk * (im.concentration * Iline.total + cs * Iseed.total) * V;
    const Psync = synchrotronTotal({ R: g.R, a: g.a, kappa: g.kappa, B0: cfg.B0, ne0_1e20: (ne * (1 + aN)) / 1e20, Te0_keV: T0, alpha_n: aN, alpha_T: aT, wallReflectivity: im.wallReflectivity });
    Prad = Pbr + Pline + Psync;
    PradCore = ne * ne * pk * (Ibr0.inner + Zmain * Ibr1c + im.concentration * Iline.inner + cs * Iseed.inner) * V + Psync;
    W = 1.5 * (ne + ni) * T * E_KEV * V * Wprof;
    for (let k = 0; k < 40; k++) { P_tr = W / Math.max(tauOf(ne, P_loss), 1e-4); P_loss = P_tr + Prad - PradCore; }
    const tauHe = cfg.transport.tau_He_over_tau_E * tauOf(ne, P_loss);
    fHe = Math.min((ash * tauHe) / V / ne, 0.3);
  }
  const Pa = P_tr + Prad - Pch;
  const PLH = pLH_threshold(fLine * ne, cfg.B0, S, M, cfg.Ip_MA, g.a, g.R);
  return {
    n, T, Paux: Pa, Pfus: Pf, Pchar: Pch, Prad, PradCore, PL: P_loss, PLH, hmodeAccess: P_loss >= PLH,
    Q: Pa > 0 ? Pf / Pa : Infinity, tauE: tauOf(ne, P_loss), W, fHe,
    betaN: cfg.Ip_MA > 0 ? betaNormalized(betaToroidal(W / (1.5 * V), cfg.B0), g.a, cfg.B0, cfg.Ip_MA) : 0,
    nOverNG: cfg.Ip_MA > 0 ? (fLine * ne) / greenwaldDensity(cfg.Ip_MA, g.a) : 0,
    q95: stell ? 0 : q95ForMethod(cfg.method, g, cfg.B0, Math.max(cfg.Ip_MA, 0.01)),
    V,
  };
}
