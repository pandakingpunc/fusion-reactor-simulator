/**
 * Neoclassical closure coefficients of one step, evaluated on the old state (q from the old ψ):
 * collisionalities ν*_e, ν*_i, the Sauter bootstrap coefficients (Sauter, Angioni & Lin-Liu,
 * Phys. Plasmas 6 (1999) 2834; 9 (2002) 5140), and the neoclassical ion heat diffusivity used as
 * the floor of χ_i (neoclassical.ts: banana-regime Hinton–Hazeltine coefficient with a
 * collisional roll-over; APPROXIMATION).
 */
import type { ProfileContext } from '../context';
import type { ProfileState } from '../state';
import { chiNeoIon, nuStarE, nuStarI, sauterCoefficients } from '../neoclassical';

/** Writes w.nuE, w.nuI, w.chiNeo and ctx.sauter for state st */
export function neoclassicalCoefficients(ctx: ProfileContext, st: ProfileState): void {
  const w = ctx.w, N = ctx.N, g = ctx.tg;
  const { Te, Ti, ne } = st;
  ctx.sauter.length = N;
  for (let i = 0; i < N; i++) {
    const eps = g.epsC[i], R = g.RgeoC[i];
    const q = Math.min(Math.max(w.q[i], 0.3), 20);
    const Z = Math.max(w.Zeff[i], 1);
    w.nuE[i] = nuStarE(q, R, eps, ne[i], Math.max(Te[i], 0.01) * 1e3, Z);
    w.nuI[i] = nuStarI(q, R, eps, w.ni[i], Math.max(Ti[i], 0.01) * 1e3, Z);
    ctx.sauter[i] = sauterCoefficients(g.ftC[i], w.nuE[i], w.nuI[i], Z);
    w.chiNeo[i] = chiNeoIon(q, eps, g.B0, w.ni[i], Math.max(Ti[i], 0.01) * 1e3, ctx.M, Z, w.nuI[i]);
  }
}
