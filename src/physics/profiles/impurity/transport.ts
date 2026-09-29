/**
 * Transport coefficients of the impurity species on the faces of the 1.5D grid, in the convention of the particle solver
 * (fvsolver.ts DensitySolver): the flux through face f is V' (-g1 D dn/drho + <|grad rho|> v n), D in m^2/s and v in m/s (inward < 0).
 *
 *  - anomalous part: the D and v of the electrons on the faces (ctx.w.D, ctx.w.v: the model's particle diffusivity with the edge barrier,
 *    and the pinch v = -D 2 P rho g1/<|grad rho|> that makes the source-free electron profile n ~ exp(-P rho^2)), scaled by
 *    `impurityDoverDe` and `impurityPinchOverPe`. The turbulent convection of an impurity is the curvature pinch, independent of
 *    charge and mass (Fajardo, PhD thesis, LMU Muenchen 2023, section 2.4.2); thermodiffusion (proportional to 1/Z) and roto-diffusion are
 *    not modelled: a quasilinear model such as TGLF would replace this part.
 *  - neoclassical part (mode 'facit'): D_neo and the convection K d ln n_i/dr + H d ln T_i/dr of FACIT (facit.ts). FACIT's r is the
 *    minor-radius label of the flux surface; the solver's coordinate is rho = sqrt(Phi/Phi_b), and the two flux definitions agree with
 *    d/dr taken as (g1/<|grad rho|>) d/drho, the operator that also turns the electron pinch v = D (g1/<|grad rho|>) dln n/drho into a
 *    log-gradient (the zero-flux steady profile of the solver is exp(integral <|grad rho|> v/(g1 D) drho)). In a circular plasma
 *    g1 = 1/a^2 and <|grad rho|> = 1/a, so the operator is (1/a) d/drho = d/dr.
 */
import { meanCharge } from '../../radiation';
import { FUEL_SPECIES } from '../../reactivity';
import type { ProfileContext } from '../context';
import { faceValue, type TransportGeometry } from '../geometry1d';
import type { ProfileState } from '../state';
import { facitCoefficients, FACIT_NZ_MIN } from './facit';
import type { ImpuritySpeciesSpec } from './config';

/** Largest neoclassical convection velocity used [m/s]: the fits stay finite, this only guards a degenerate edge face */
export const NEO_V_MAX = 1e3;
/** floor of a quantity inside a logarithm (the fuel-ion density and T_i are positive; this only guards a zero) */
const LOG_FLOOR = 1e-30;

/** The effective main ion of a fuel (FACIT has one): number-weighted charge Z_i and mass A_i of the two fuel species at a fuel fraction fA */
export function mainIon(fuel: keyof typeof FUEL_SPECIES, fA: number): { Zi: number; Ai: number } {
  const fs = FUEL_SPECIES[fuel];
  const a = Math.min(Math.max(fA, 0), 1), b = 1 - a;
  const Zsum = a * fs.a.Z + b * fs.b.Z;
  return { Zi: (a * fs.a.Z * fs.a.Z + b * fs.b.Z * fs.b.Z) / Zsum, Ai: a * fs.a.A + b * fs.b.A };
}

/**
 * d ln X/dr on the faces [1/m], r the effective radius (g1/<|grad rho|>) d/drho: between the two cell centres that flank a face and,
 * for the outer face, between the last centre and the boundary value XB (half a cell). 0 on the axis face.
 */
export function faceLogGradient(g: TransportGeometry, X: ArrayLike<number>, XB: number, out: Float64Array): void {
  const N = g.N;
  out[0] = 0;
  for (let f = 1; f <= N; f++) {
    const xl = Math.max(X[f - 1], LOG_FLOOR), xr = Math.max(f < N ? X[f] : XB, LOG_FLOOR);
    out[f] = (Math.log(xr) - Math.log(xl)) / g.distF[f] * (g.g1F[f] / Math.max(g.gradRhoF[f], 1e-9));
  }
}

/** D, K, H [m^2/s] of FACIT on the faces of one species (each N + 1 values; the axis face is 0) */
export interface NeoTable { D: Float64Array; K: Float64Array; H: Float64Array }

/**
 * FACIT coefficients of species `spec` on the faces 1 ... N for the state st (T_e, T_i), the composition of the work arrays (fuel-ion
 * density, Z_eff), the safety factor of the faces and the impurity density block `nz` (cells; nzB: its value at the separatrix). The
 * separatrix face takes the boundary values (ctx.bc).
 */
export function facitTable(ctx: ProfileContext, st: ProfileState, spec: ImpuritySpeciesSpec, nz: ArrayLike<number>, nzB: number, out: NeoTable): void {
  const g = ctx.tg, w = ctx.w, N = ctx.N, cfg = ctx.cfg;
  const { Zi, Ai } = mainIon(cfg.fuel, st.s.fA);
  const ratioB = ctx.bc.n / Math.max(st.ne[N - 1], 1);
  out.D[0] = 0; out.K[0] = 0; out.H[0] = 0;
  for (let f = 1; f <= N; f++) {
    const inner = f < N;
    const Ti = inner ? faceValue(g, st.Ti, f) : ctx.bc.Ti;
    const Te = inner ? faceValue(g, st.Te, f) : ctx.bc.Te;
    const Ni = inner ? faceValue(g, w.na, f) + faceValue(g, w.nb, f) : (w.na[N - 1] + w.nb[N - 1]) * ratioB;
    const Nz = inner ? faceValue(g, nz, f) : Math.max(nzB, 0.5 * nz[N - 1]);
    const Zeff = inner ? faceValue(g, w.Zeff, f) : w.Zeff[N - 1];
    const eps = (g.RoutF[f] - g.RinF[f]) / (g.RoutF[f] + g.RinF[f]);
    const r = facitCoefficients({
      Zimp: Math.max(meanCharge(spec.species, Math.max(Te, 0.1)), 1), Aimp: spec.A, Zi, Ai,
      Ti_eV: Math.max(Ti, 1e-3) * 1e3, Ni, Nimp: Math.max(Nz, FACIT_NZ_MIN), Zeff: Math.max(Zeff, 1),
      TeOverTi: Math.max(Te, 1e-3) / Math.max(Ti, 1e-3), eps, q: Math.min(Math.max(w.qF[f], 0.3), 30), R0: g.R0, B0: g.B0,
    });
    const ok = Number.isFinite(r.D) && Number.isFinite(r.K) && Number.isFinite(r.H);
    out.D[f] = ok ? Math.max(r.D, 0) : 0;
    out.K[f] = ok ? r.K : 0;
    out.H[f] = ok ? r.H : 0;
  }
}

/**
 * The face coefficients of a species for the solver: D = (D_z/D_e) D_e + D_neo, v = (v_z/v_e) v_e + K d ln n_i/dr + H d ln T_i/dr, from
 * the electron coefficients of the work arrays, the FACIT table (undefined in mode 'anomalous') and the log-gradients of the fuel-ion
 * density and the ion temperature on the faces.
 */
export function faceCoefficients(ctx: ProfileContext, ratioD: number, ratioV: number, neo: NeoTable | undefined, gradN: ArrayLike<number>, gradT: ArrayLike<number>, D: Float64Array, v: Float64Array): void {
  const w = ctx.w, N = ctx.N;
  D[0] = ratioD * w.D[0]; v[0] = 0;
  for (let f = 1; f <= N; f++) {
    let d = ratioD * w.D[f], u = ratioV * w.v[f];
    if (neo) {
      d += neo.D[f];
      u += Math.min(Math.max(neo.K[f] * gradN[f] + neo.H[f] * gradT[f], -NEO_V_MAX), NEO_V_MAX);
    }
    D[f] = d; v[f] = u;
  }
}
