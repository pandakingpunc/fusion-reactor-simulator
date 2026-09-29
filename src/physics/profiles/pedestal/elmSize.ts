/**
 * The size of an ELM crash from the collisionality of the pedestal (`ProfileSettings.elmLoss = 'loarte'`): the energy ΔW_ELM = f(ν*_ped) W_ped
 * of Loarte et al. (2003, loarte.ts) of a crash that empties the pedestal region and an inner neighbour region (events/elm.ts, `elmCrash`),
 * and the depth of that crash, the fraction of T − T_sep it removes, that carries exactly this energy.
 */
import type { ProfileContext } from '../context';
import { interpCells } from '../geometry1d';
import { elmCrash } from '../mhd';
import type { ProfileState } from '../state';
import { loarteEnergyFraction, pedestalCollisionality } from './loarte';

const KEV = 1.602176634e-16;

/** The crash cannot remove more than this fraction of the pedestal excess (the solve of the depth stops there) */
export const ELM_DEPTH_MAX = 0.95;

export interface ElmLoss {
  /** ν*_ped at the pedestal top */
  nuStar: number;
  /** ΔW_ELM/W_ped of the fit */
  fraction: number;
  /** W_ped = (3/2) n_e,ped (T_e,ped + T_i,ped) V [J] */
  Wped: number;
  /** ΔW_ELM = fraction · W_ped [J] */
  energy: number;
}

/** The Loarte ELM energy loss for the state st with the pedestal top at ρ_top, at the safety factor q95 */
export function loarteElmLoss(ctx: ProfileContext, st: ProfileState, rhoTop: number, q95: number): ElmLoss {
  const g = ctx.tg;
  const ne = interpCells(g, st.ne, rhoTop), Te = interpCells(g, st.Te, rhoTop), Ti = interpCells(g, st.Ti, rhoTop);
  const Wped = 1.5 * ne * (Te + Ti) * KEV * g.volume;
  const nuStar = pedestalCollisionality(ne, Te, ctx.geomB.R, ctx.geomB.a, q95);
  const fraction = loarteEnergyFraction(nuStar);
  return { nuStar, fraction, Wped, energy: fraction * Wped };
}

/**
 * The depth f ∈ [0, ELM_DEPTH_MAX] of the crash (T and n reduced towards the separatrix values by f and f/2 in ρ ≥ ρ_ped − wIn, the profile of `elmCrash`)
 * whose energy loss is `target` [J]: by bisection on copies of the profiles (the loss is increasing in f); ELM_DEPTH_MAX if even that is not enough.
 */
export function elmDepthForEnergy(ctx: ProfileContext, st: ProfileState, rhoPed: number, target: number, wIn: number): number {
  if (!(target > 0)) return 0;
  const N = ctx.N, g = ctx.tg;
  const Te = new Float64Array(N), Ti = new Float64Array(N), ne = new Float64Array(N), ni = new Float64Array(N);
  const loss = (f: number): number => {
    Te.set(st.Te); Ti.set(st.Ti); ne.set(st.ne); ni.set(ctx.w.ni);
    return elmCrash(g, Te, Ti, ne, ni, ctx.bc.Te, ctx.bc.Ti, ctx.bc.n, rhoPed, f, 0.5 * f, wIn);
  };
  if (loss(ELM_DEPTH_MAX) <= target) return ELM_DEPTH_MAX;
  let lo = 0, hi = ELM_DEPTH_MAX;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    if (loss(mid) < target) lo = mid; else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return 0.5 * (lo + hi);
}
