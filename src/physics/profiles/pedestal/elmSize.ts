/**
 * The size of an ELM crash from the collisionality of the pedestal (`ProfileSettings.elmLoss = 'loarte'`): the energy ΔW_ELM = f(ν*_ped) W_ped
 * of Loarte et al. (2003, loarte.ts) and the shape of the crash (events/elm.ts, `elmCrash` of mhd.ts) that carries exactly this energy.
 *
 * The crash lowers T and n by the fractions f and f/2 of their excess over the separatrix values in the pedestal and, with a linear ramp, in a region
 * of width w inside it. The default ELM has w = 0.15 (`ELM_WIDTH_STD`). Loarte et al. (section 3 of the paper) find that ELMs affect the outermost 10 to 30 %
 * of the plasma radius (20 to 45 % of the volume) in DIII-D, JET and JT-60U, and that this region changes only weakly while the size of the collapse
 * changes strongly with the pedestal parameters: the size is carried by the depth first. The crash of a large ELM (ITER: 22 MJ from a pedestal of
 * 112 MJ) cannot be carried by a depth of the standard region alone, so the shape is found in three stages, each only as far as the energy needs:
 *
 *  1. the depth f up to `ELM_DEPTH_TYP` = 0.5 (the pedestal-top temperature falls by at most half) in the standard region;
 *  2. then the width w up to `ELM_WIDTH_MAX` = 0.25 (with the pedestal, the upper end of the observed 10 to 30 % of the radius);
 *  3. then the depth up to `ELM_DEPTH_MAX` = 0.95.
 *
 * A target that even that cannot carry is delivered as far as it goes (`capped`).
 */
import type { ProfileContext } from '../context';
import { interpCells } from '../geometry1d';
import { elmCrash } from '../mhd';
import type { ProfileState } from '../state';
import { loarteEnergyFraction, pedestalCollisionality } from './loarte';

const KEV = 1.602176634e-16;

export const ELM_WIDTH_STD = 0.15;
export const ELM_WIDTH_MAX = 0.25;
export const ELM_DEPTH_TYP = 0.5;
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

export interface ElmShape {
  /** depth f of the crash (T reduced by f, n by f/2) and the width w [ρ] of the region inside the pedestal */
  depth: number;
  width: number;
  /** the energy the crash removes [J]; below the target when `capped` */
  energy: number;
  capped: boolean;
}

/**
 * The shape (depth, width) of the crash whose energy loss is `target` [J], by bisection on copies of the profiles (the loss increases with the depth and
 * with the width): the three stages of the header. `rhoPed` is the pedestal top.
 */
export function elmShapeForEnergy(ctx: ProfileContext, st: ProfileState, rhoPed: number, target: number): ElmShape {
  if (!(target > 0)) return { depth: 0, width: ELM_WIDTH_STD, energy: 0, capped: false };
  const N = ctx.N, g = ctx.tg;
  const Te = new Float64Array(N), Ti = new Float64Array(N), ne = new Float64Array(N), ni = new Float64Array(N);
  const loss = (f: number, w: number): number => {
    Te.set(st.Te); Ti.set(st.Ti); ne.set(st.ne); ni.set(ctx.w.ni);
    return elmCrash(g, Te, Ti, ne, ni, ctx.bc.Te, ctx.bc.Ti, ctx.bc.n, rhoPed, f, 0.5 * f, w);
  };
  /** the smallest x in [lo, hi] at which the increasing function reaches the target (hi if it does not) */
  const solve = (fn: (x: number) => number, lo: number, hi: number): number => {
    for (let it = 0; it < 60 && hi - lo > 1e-10; it++) { const mid = 0.5 * (lo + hi); if (fn(mid) < target) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  };
  if (loss(ELM_DEPTH_TYP, ELM_WIDTH_STD) >= target) {
    const f = solve((x) => loss(x, ELM_WIDTH_STD), 0, ELM_DEPTH_TYP);
    return { depth: f, width: ELM_WIDTH_STD, energy: loss(f, ELM_WIDTH_STD), capped: false };
  }
  if (loss(ELM_DEPTH_TYP, ELM_WIDTH_MAX) >= target) {
    const w = solve((x) => loss(ELM_DEPTH_TYP, x), ELM_WIDTH_STD, ELM_WIDTH_MAX);
    return { depth: ELM_DEPTH_TYP, width: w, energy: loss(ELM_DEPTH_TYP, w), capped: false };
  }
  if (loss(ELM_DEPTH_MAX, ELM_WIDTH_MAX) >= target) {
    const f = solve((x) => loss(x, ELM_WIDTH_MAX), ELM_DEPTH_TYP, ELM_DEPTH_MAX);
    return { depth: f, width: ELM_WIDTH_MAX, energy: loss(f, ELM_WIDTH_MAX), capped: false };
  }
  return { depth: ELM_DEPTH_MAX, width: ELM_WIDTH_MAX, energy: loss(ELM_DEPTH_MAX, ELM_WIDTH_MAX), capped: true };
}
