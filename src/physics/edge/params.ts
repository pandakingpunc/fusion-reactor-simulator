/**
 * Parameters of the edge model: the defaults, their sources, and the resolution of the (optional, possibly
 * partial or malformed) `MagneticConfig.divertor.edge` options into a complete set.
 */
import type { EdgeOptions } from '../types';
import { LossFit, lossFit } from './losses';
import { KAPPA0E, SHEATH_GAMMA } from './twoPoint';
import type { LengyelIntegral } from './lengyel';

export interface EdgeParams {
  /**
   * Share of P_sep on the outer target leg. The Eich λ_q is measured on the outer target (mapped to the
   * outer midplane); in H-mode the outer leg takes about two thirds of the power (in/out asymmetry ≈ 1 : 2,
   * the value of engineering.ts, APPROXIMATION; it depends on the drift direction and the mode).
   */
  outerShare: number;
  /** S/λ_q: 1.22, i.e. b = λ_int/λ_q = 1 + 1.64 · 1.22 = 3 (Kallenbach et al., PPCF 58 (2016) 045013) */
  spreadingRatio: number;
  /** absolute S [mm] (overrides spreadingRatio) */
  S_mm?: number;
  /** midplane heat-flux width [mm] (overrides the Eich regression #14) */
  lambdaQ_mm?: number;
  /**
   * Divertor leg length (X-point to target) over the connection length π q95 R. ITER: 20 m of about 58 m
   * (D. Moulton et al., Nucl. Fusion 61 (2021) 046029, §2.3.4 for the outer divertor of SOL ring 3).
   */
  divertorLengthFraction: number;
  kappa0e: number;
  sheathGamma: number;
  fit: LossFit;
  radiation: 'prescribed' | 'lengyel';
  seedEnrichment: number;
  /** target temperature that defines the detachment onset in the c_z requirement [eV] */
  detachTt_eV: number;
  /** 1/sin β of the target plate: ITER vertical target, field-line angle in the poloidal plane about 20° (engineering.ts) */
  targetTilt: number;
  /** strike-point radius R − f a (engineering.ts: 0.3, APPROXIMATION) */
  strikeRadiusFraction: number;
  /** floor of the target temperature of the solution [eV] (fully detached: recombination-limited) */
  TtFloor_eV: number;
  /** Lengyel integrals of the cooling functions by species; the Mavrin (coronal) fits where a species is missing */
  lengyel?: Record<string, LengyelIntegral>;
}

export const DEFAULT_EDGE_PARAMS: EdgeParams = {
  outerShare: 2 / 3,
  spreadingRatio: 1.22,
  divertorLengthFraction: 0.3,
  kappa0e: KAPPA0E,
  sheathGamma: SHEATH_GAMMA,
  fit: lossFit('stangeby1'),
  radiation: 'prescribed',
  seedEnrichment: 1,
  detachTt_eV: 5,
  targetTilt: 3,
  strikeRadiusFraction: 0.3,
  TtFloor_eV: 0.5,
};

const pos = (x: unknown, d: number, lo = 0, hi = Infinity): number =>
  typeof x === 'number' && Number.isFinite(x) && x > lo && x <= hi ? x : d;
const optPos = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined);

/** Complete parameters from the options of a configuration; a value that is missing, non-finite or out of range keeps the default */
export function resolveEdgeParams(o: EdgeOptions | undefined, lengyel?: Record<string, LengyelIntegral>): EdgeParams {
  const d = DEFAULT_EDGE_PARAMS;
  if (!o && !lengyel) return d;
  return {
    outerShare: pos(o?.outerShare, d.outerShare, 0, 1),
    spreadingRatio: pos(o?.spreadingRatio, d.spreadingRatio),
    S_mm: optPos(o?.S_mm),
    lambdaQ_mm: optPos(o?.lambdaQ_mm),
    divertorLengthFraction: pos(o?.divertorLengthFraction, d.divertorLengthFraction, 0, 0.9),
    kappa0e: pos(o?.kappa0e, d.kappa0e),
    sheathGamma: pos(o?.sheathGamma, d.sheathGamma),
    fit: lossFit(o?.lossFit),
    radiation: o?.radiation === 'lengyel' ? 'lengyel' : 'prescribed',
    seedEnrichment: pos(o?.seedEnrichment, d.seedEnrichment),
    detachTt_eV: pos(o?.detachTt_eV, d.detachTt_eV),
    targetTilt: pos(o?.targetTilt, d.targetTilt),
    strikeRadiusFraction: pos(o?.strikeRadiusFraction, d.strikeRadiusFraction, -1, 1),
    TtFloor_eV: d.TtFloor_eV,
    lengyel,
  };
}
