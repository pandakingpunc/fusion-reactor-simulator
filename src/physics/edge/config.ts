/**
 * The edge model for a magnetic-confinement configuration: parameters from `cfg.divertor.edge`, the seed of the
 * SOL from `cfg.impurity`, and the inputs of the model from the plasma of the 0D model or of POPCON (volume-average
 * density, total power, plasma current). The 1.5D boundary builds its inputs from the equilibrium
 * (profiles/boundary/edge.ts) and shares the rest.
 */
import type { ImpuritySpecies } from '../constants';
import { C } from '../constants';
import { Geometry, poloidalField, q95ForMethod } from '../geometry';
import { DEFAULT_PROFILE_SETTINGS } from '../profiles/defaults';
import type { MagneticConfig } from '../types';
import { EdgeParams, resolveEdgeParams } from './params';
import { EdgePlasma } from './solve';

export interface EdgeSetup {
  par: EdgeParams;
  f_rad_div: number;
  f_x: number;
  /** seed of the SOL (concentration already multiplied by the enrichment) */
  seed?: { species: ImpuritySpecies; c: number };
}

const cache = new WeakMap<MagneticConfig, EdgeSetup>();

/** Edge parameters of a configuration; memoised per configuration object */
export function edgeSetup(cfg: MagneticConfig): EdgeSetup {
  let s = cache.get(cfg);
  if (!s) {
    const par = resolveEdgeParams(cfg.divertor.edge);
    const im = cfg.impurity;
    const seed = im.seedSpecies && im.seedConcentration && im.seedConcentration > 0
      ? { species: im.seedSpecies, c: im.seedConcentration * par.seedEnrichment } : undefined;
    s = { par, f_rad_div: cfg.divertor.f_rad_div, f_x: cfg.divertor.flux_expansion, seed };
    cache.set(cfg, s);
  }
  return s;
}

/** Separatrix density of the 0D model and POPCON: n_sep = nsepFrac ⟨n_e⟩ (the 1.5D default, profiles/defaults.ts) */
export function separatrixDensity(cfg: MagneticConfig, ne_vol: number): number {
  const f = cfg.profiles?.nsepFrac;
  return (typeof f === 'number' && f > 0 ? f : DEFAULT_PROFILE_SETTINGS.nsepFrac) * ne_vol;
}

/**
 * Inputs of the edge model for a plasma described by global quantities (0D model, POPCON): P_sep [W], plasma current
 * [A], volume-average electron density [m⁻³], mean fuel ion mass [amu]. B_pol is the mean poloidal field μ0 I_p/L_pol.
 */
export function edgePlasma0D(cfg: MagneticConfig, g: Geometry, P_sep: number, Ip_A: number, ne_vol: number, M_amu: number): EdgePlasma {
  const s = edgeSetup(cfg);
  return {
    P_sep, R: g.R, a: g.a, B0: cfg.B0, B_pol: poloidalField(g, Math.max(Ip_A, 1e5)),
    q95: q95ForMethod(cfg.method, g, cfg.B0, Math.max(Ip_A / 1e6, 0.01)),
    n_sep: separatrixDensity(cfg, ne_vol), m_i: M_amu * C.amu, f_x: s.f_x, f_rad_div: s.f_rad_div, seed: s.seed,
  };
}
