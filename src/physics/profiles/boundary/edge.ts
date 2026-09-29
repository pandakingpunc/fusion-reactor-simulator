/**
 * The edge model (src/physics/edge) for the 1.5D plasma: its inputs from the equilibrium and the boundary state, the
 * separatrix temperature it gives the transport equations, and the edge channels of the diagnostics.
 */
import { AMU, MU0, ProfileContext } from '../context';
import { EdgePlasma, edgeDiagValues, edgeSetup, solveEdge } from '../../edge';

/** Lower and upper guard of the two-point T_sep [keV]: numerical safety only, neither is reached by any preset */
export const TSEP_GUARD_KEV: readonly [number, number] = [0.005, 2];

/**
 * Inputs of the edge model: P_sep = the (lagged, ELM-inclusive) P_SOL of the context, n_sep = the boundary density,
 * the poloidal field μ0 I_p/L_pol of the LCFS, the outer-midplane radius and the connection length of the equilibrium.
 */
export function edgePlasma1D(ctx: ProfileContext, P_sep: number, n_sep: number, q95v: number, Ip: number): EdgePlasma {
  const g = ctx.tg, s = edgeSetup(ctx.cfg);
  return {
    P_sep, R: g.R0, a: g.a, R_u: g.RoutF[g.N], B0: g.B0, B_pol: (MU0 * Ip) / g.perimeter, q95: q95v,
    n_sep, m_i: ctx.M * AMU, f_x: s.f_x, f_rad_div: s.f_rad_div, seed: s.seed,
  };
}

/** T_sep [keV] of the edge model ('twoPoint' boundary): the upstream temperature of the two-point solution */
export function twoPointSeparatrixT(ctx: ProfileContext, P_sep: number, n_sep: number, q95v: number, Ip: number): number {
  const r = solveEdge(edgePlasma1D(ctx, P_sep, n_sep, q95v, Ip), edgeSetup(ctx.cfg).par);
  return Math.min(Math.max(r.T_u / 1000, TSEP_GUARD_KEV[0]), TSEP_GUARD_KEV[1]);
}

/** Edge channels of the diagnostics of the current boundary state (P_SOL, n_sep) */
export function edgeChannels1D(ctx: ProfileContext, q95v: number, Ip: number): Record<string, number> {
  return edgeDiagValues(solveEdge(edgePlasma1D(ctx, ctx.PSOL, ctx.bc.n, q95v, Ip), edgeSetup(ctx.cfg).par));
}
