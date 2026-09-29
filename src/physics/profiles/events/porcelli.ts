/**
 * The sawtooth trigger of Porcelli, Boucher and Rosenbluth, Plasma Phys. Control. Fusion 38 (1996) 2163 (equations 11-16 and appendix B of the paper),
 * in the form of the module of Bateman and Nguyen (Lehigh University; National Transport Code Collaboration, `porcelli_module`, documentation of
 * 1 June 2006), whose variable definitions this file follows: the internal kink at the q = 1 surface is unstable to a crash when one of three conditions
 * holds,
 *
 *   (13)  −δŴ_core > c_h ω_Dh τ_A                               the fast ions cannot stabilise the ideal mode: their precession is slower than its growth
 *   (14)  −δŴ > ½ ω_*i τ_A                                       the ideal mode is not stabilised by the diamagnetic rotation of the thermal ions
 *   (15)  ½ ω_*i τ_A > −δŴ > −c_ρ ρ̂  and  ω_*i < c_* γ_ρ        the resistive (semi-collisional, ion-kinetic) mode grows faster than the diamagnetic frequency
 *
 * with δŴ = δŴ_core + δŴ_fast, δŴ_core = δŴ_MHD + δŴ_KO, δŴ_MHD = δŴ_Bussac + δŴ_elongation, the constants c_h = 0.4, c_ρ = 1, c_* = 3, c_f = 1 of the paper
 * (the values of the reference), and, at the radius r_1 of the q = 1 surface, r̄_1 = √κ_1 r_1, ε_1 = r̄_1/R, s_1 = r q′/q (normalised with
 * √(s_1² + 0.1²), the shear minimum of the module; l_i1 − ½ is taken from 0):
 *
 *   δŴ_Bussac = −(9π/s)(l_i1 − ½) ε_1² (β_p1² − β_pc²),   β_p1 = 2μ0 (⟨p⟩_1 − p(r_1))/B_p1²,   β_pc = 0.3 (1 − 5 r_1/(3 a))
 *   δŴ_elong  = −(18π/s)(l_i1 − ½)³ ((κ_1 − 1)/2)²          (Bussac, Pellat, Edery and Soule, PRL 35 (1975) 1638; Lütjens, Bondeson and Vlad, Nucl. Fusion 32 (1992) 1625)
 *   δŴ_KO     = 0.6 (√ε_1/s) β_i0 c_p,   c_p = (5/2) ∫_0^1 x^{3/2} p_i(x)/p_i0 dx      (trapped thermal ions: Kruskal and Oberman, Phys. Fluids 1 (1958) 275)
 *   δŴ_fast   = c_f (ε_1^{3/2}/s) β*_pα,   β*_pα = −(2μ0/B_p1²) ∫_0^1 x^{3/2} (dp_fast/dx) dx
 *
 * x = r/r_1, p the total pressure, ⟨p⟩_1 its volume average inside q = 1, l_i1 the internal inductance of the q = 1 surface (∫ B_p² dA/(B_p1² A_1)),
 * β_i0 = 2μ0 p_i0/B_T² the peak ion toroidal beta. The times and frequencies (T_i0 the central ion temperature in keV, A_i the ion mass number, n_e0 the
 * central electron density in 10²⁰ m⁻³):
 *
 *   τ_A = 0.8e-6 (R/B_T) √(A_i n_e0) [s],      ω_Dh = 500 E_fast[keV]/(Z_fast B_T R r̄_1) [s⁻¹],      ω_*i = 1000 T_i0 |dp_i/dr|/(p_i B_T r̄_1) [s⁻¹],
 *   ρ̂ = 3.25e-3 √(A_i T_i0)/(B_T r̄_1),      S = 43.7 T_i0^{3/2} r̄_1²/τ_A,      γ_ρ = 1.1 s_1^{6/7} ρ̂^{4/7}/(τ_A S^{1/7})  (semi-collisional m = 1 growth rate).
 *
 * Choices of this implementation: (i) the condition (13) is evaluated only when fast ions are present at the q = 1 surface (the module evaluates it
 * with E_fast = 0, where it reduces to ideal instability alone); E_fast and Z_fast are the pressure-weighted mean energy (E_0 τ_W/τ_th of the slowing-down
 * distribution, heating.ts) and charge of the beam ions and the fusion products there, (ii) B_p1 at the outboard midplane is μ0 I(r_1)/(π r_1 (1 + κ_1)),
 * the value for an elliptical current distribution, (iii) p_i is the thermal ion pressure, p includes the fast ions (the fields of the 'profile' fast-ion
 * model, or the pools of the scalar model distributed like the steady beam and alpha content). The margin returned to the stepper is continuous:
 * max over the three conditions of (left − right)/(|left| + |right| + 10⁻³), positive when a condition holds.
 */
import { FUEL_CHANNELS, FUEL_SPECIES } from '../../reactivity';
import { criticalEnergy, fastIonEnergyTime, slowingDownTime } from '../../heating';
import { KEV, MU0, type ProfileContext } from '../context';
import { beamComponents } from '../fastions/components';
import { cellIndex, interpCells } from '../geometry1d';
import { rhoOfQ, shearAt } from '../mhd';
import type { TriggerScratch, TriggerState } from './EventModel';
import { triggerProfiles } from './triggers';

/** The constants of the paper (the reference values; c_f = 1: the mode frequency is much below the fast-ion precession frequency) */
export const PORCELLI = { cH: 0.4, cRho: 1, cStar: 3, cF: 1, shearMin: 0.1 } as const;

/** All the quantities of the three conditions at a state (for the diagnostics, the event message and the tests) */
export interface PorcelliTerms {
  rho1: number; r1: number; rBar1: number; kappa1: number; eps1: number; s1: number; sNorm: number;
  li1: number; betaP1: number; betaPc: number; Bp1: number;
  dWbussac: number; dWelong: number; dWko: number; dWfast: number; dWcore: number; dW: number;
  tauA: number; omegaDh: number; omegaDi: number; rhoHat: number; lundquist: number; gammaRho: number;
  /** a fast-ion population exists at q = 1: the condition (13) is evaluated */
  fast: boolean;
  /** left and right sides of the conditions */
  c13: [number, number]; c14: [number, number]; c15a: [number, number, number]; c15b: [number, number];
  /** the conditions hold */
  eq13: boolean; eq14: boolean; eq15: boolean;
}

/** Scratch of the evaluation (allocated once per context size) */
interface Work { Ienc: Float64Array; pf: Float64Array; pb: Float64Array; pa: Float64Array; pi: Float64Array }
const works = new WeakMap<TriggerScratch, Work>();
function workOf(sc: TriggerScratch): Work {
  let w = works.get(sc);
  if (!w) {
    const N = sc.p.length;
    w = { Ienc: new Float64Array(N + 1), pf: new Float64Array(N), pb: new Float64Array(N), pa: new Float64Array(N), pi: new Float64Array(N) };
    works.set(sc, w);
  }
  return w;
}

/** Linear interpolation of a face array at ρ */
function atFaces(rhoF: ArrayLike<number>, a: ArrayLike<number>, i: number, rho: number): number {
  const t = (rho - rhoF[i]) / (rhoF[i + 1] - rhoF[i]);
  return a[i] + t * (a[i + 1] - a[i]);
}

/**
 * The fast-ion pressure profiles [Pa] of the beam and of the fusion products on the cells: the fields of the 'profile' fast-ion model, or the scalar
 * pools distributed like the steady contents of the work arrays (w.Wbeam, w.Walpha; flat when the source is off), each with the pool's content.
 */
export function fastPressureProfiles(ctx: ProfileContext, pb: Float64Array, pa: Float64Array): void {
  const N = ctx.N;
  const f = ctx.fast;
  if (f) {
    for (let i = 0; i < N; i++) {
      let wb = 0;
      for (const b of f.beam) wb += b.W[i];
      pb[i] = (2 / 3) * wb; pa[i] = (2 / 3) * f.alpha.W[i];
    }
    return;
  }
  const w = ctx.w, dV = ctx.tg.dV, V = ctx.tg.volume;
  let sb = 0, sa = 0;
  for (let i = 0; i < N; i++) { sb += w.Wbeam[i] * dV[i]; sa += w.Walpha[i] * dV[i]; }
  for (let i = 0; i < N; i++) {
    pb[i] = ctx.WfBeam > 0 ? (2 / 3) * ctx.WfBeam * (sb > 0 ? w.Wbeam[i] / sb : 1 / V) : 0;
    pa[i] = ctx.WfAlpha > 0 ? (2 / 3) * ctx.WfAlpha * (sa > 0 ? w.Walpha[i] / sa : 1 / V) : 0;
  }
}

/**
 * Mean energy [keV] of the steady slowing-down distribution of ions born at E_0: E_0 τ_W/τ_th (energy content over particle content), and the mean of
 * the birth energies of the charged products of the fuel with their charge: the pressure-weighted E_fast and Z_fast of the two populations at a cell
 * with T_e, n_e and ionSum. Returns [E_beam, Z_beam, E_alpha, Z_alpha].
 */
function meanFastEnergies(ctx: ProfileContext, Te: number, ne: number, ionSum: number): [number, number, number, number] {
  const c = ctx.cfg;
  const a = beamAtom(ctx);
  let Eb = 0, wsum = 0;
  for (const comp of beamComponents(c.heating.E_NBI_keV)) {
    const Ec = criticalEnergy(Math.max(Te, 0.01), a.A, ionSum);
    const tw = fastIonEnergyTime(Math.max(Te, 0.01), ne, a.A, a.Z, comp.E_keV, Ec), tt = slowingDownTime(Math.max(Te, 0.01), ne, a.A, a.Z, comp.E_keV, Ec);
    Eb += comp.f * comp.E_keV * (tt > 0 ? Math.min(tw / tt, 1) : 1); wsum += comp.f;
  }
  let Ea = 0, Za = 0, n = 0;
  for (const ch of FUEL_CHANNELS[c.fuel]) for (const pr of ch.products) {
    const E0 = pr.E_MeV * 1e3;
    const Ec = criticalEnergy(Math.max(Te, 0.01), pr.A, ionSum);
    const tw = fastIonEnergyTime(Math.max(Te, 0.01), ne, pr.A, pr.Z, E0, Ec), tt = slowingDownTime(Math.max(Te, 0.01), ne, pr.A, pr.Z, E0, Ec);
    Ea += E0 * (tt > 0 ? Math.min(tw / tt, 1) : 1); Za += pr.Z; n++;
  }
  return [wsum > 0 ? Eb / wsum : 0, a.Z, n > 0 ? Ea / n : 0, n > 0 ? Za / n : 2];
}

/** The beam atom: the species a of the fuel (deuterium, or the proton of p-¹¹B), as sources/nbi.ts */
function beamAtom(ctx: ProfileContext): { A: number; Z: number } {
  const a = FUEL_SPECIES[ctx.cfg.fuel].a;
  return { A: a.A, Z: a.Z };
}

/**
 * The terms of the three conditions for the state `st`, on the scratch arrays of the stepper (no work arrays are read except, for the fast ions of
 * the scalar model, the steady beam and alpha contents and the composition of the last evaluation, held fixed over a step like the fast-ion pressure).
 * null if there is no q = 1 surface between ρ = 0.05 and 0.8.
 */
export function porcelliTerms(ctx: ProfileContext, st: TriggerState, sc: TriggerScratch): PorcelliTerms | null {
  triggerProfiles(ctx, st, sc);
  const g = ctx.tg, N = ctx.N;
  const rho1 = rhoOfQ(g, sc.qF, 1);
  if (!(rho1 > 0.05 && rho1 < 0.8)) return null;
  const wk = workOf(sc);
  ctx.cur.Ienc(sc.dpsiF, wk.Ienc);
  const iq = cellIndex(g, rho1);
  const rF = (f: number) => 0.5 * (g.RoutF[f] - g.RinF[f]);
  const r1 = rF(iq) + ((rho1 - g.rhoF[iq]) / (g.rhoF[iq + 1] - g.rhoF[iq])) * (rF(iq + 1) - rF(iq));
  const rEdge = rF(N);
  const A1 = atFaces(g.rhoF, g.AF, iq, rho1);
  const kappa1 = Math.max(A1 / (Math.PI * r1 * r1), 1);
  const rBar1 = Math.sqrt(kappa1) * r1;
  const R = g.R0, BT = g.B0;
  const eps1 = rBar1 / R;
  const s1 = shearAt(g, sc.qF, rho1);
  const sNorm = Math.sqrt(s1 * s1 + PORCELLI.shearMin * PORCELLI.shearMin);
  const I1 = atFaces(g.rhoF, wk.Ienc, iq, rho1);
  const Bp1 = (MU0 * Math.abs(I1)) / (Math.PI * r1 * (1 + kappa1));

  // pressures: thermal ions, thermal total, fast ions
  const pi = wk.pi;
  for (let i = 0; i < N; i++) pi[i] = st.ne[i] * st.niOverNe[i] * Math.max(st.Ti[i], 0.01) * KEV;
  fastPressureProfiles(ctx, wk.pb, wk.pa);
  const pf = wk.pf;
  for (let i = 0; i < N; i++) pf[i] = wk.pb[i] + wk.pa[i];
  let pi0 = 0;
  for (let i = 0; i < N; i++) pi0 = Math.max(pi0, pi[i]);

  // integrals over the cells inside q = 1 (the cell that holds it counts by its fraction φ)
  let V1 = 0, pV = 0, bp2A = 0, A1c = 0, cp = 0, fastInt = 0;
  for (let i = 0; i <= iq; i++) {
    const phi = i < iq ? 1 : Math.min(Math.max((rho1 - g.rhoF[i]) / (g.rhoF[i + 1] - g.rhoF[i]), 0), 1);
    if (!(phi > 0)) continue;
    const dA = (g.AF[i + 1] - g.AF[i]) * phi;
    const Ic = 0.5 * (wk.Ienc[i] + wk.Ienc[i + 1]);
    const rc = Math.max(0.5 * (g.RoutC[i] - g.RinC[i]), 1e-6);
    const Ac = 0.5 * (g.AF[i] + g.AF[i + 1]);
    const kc = Math.max(Ac / (Math.PI * rc * rc), 1);
    const Bpc = (MU0 * Math.abs(Ic)) / (Math.PI * rc * (1 + kc));
    V1 += g.dV[i] * phi; pV += (sc.p[i] + pf[i]) * g.dV[i] * phi;
    bp2A += Bpc * Bpc * dA; A1c += dA;
    const x = Math.min(rc / r1, 1), dx = ((rF(i + 1) - rF(i)) * phi) / r1;
    cp += Math.pow(x, 1.5) * (pi[i] / Math.max(pi0, 1e-30)) * dx;
    fastInt += Math.sqrt(x) * pf[i] * dx;
  }
  const li1 = A1c > 0 && Bp1 > 0 ? bp2A / (A1c * Bp1 * Bp1) : 0.5;
  cp *= 2.5;
  const pAvg1 = V1 > 0 ? pV / V1 : 0;
  const pR1 = interpCells(g, sc.p, rho1) + interpCells(g, pf, rho1);
  const betaP1 = Bp1 > 0 ? (2 * MU0 * (pAvg1 - pR1)) / (Bp1 * Bp1) : 0;
  const betaPc = 0.3 * (1 - (5 * r1) / (3 * rEdge));
  // the ideal terms are derived for a current density that falls outwards, l_i1 ≥ ½ (uniform j inside q = 1 gives ½); a hollow one (the profile a
  // reconnection leaves, q ≈ 1 flat inside) has no Bussac drive: l_i1 − ½ is taken from 0
  const dli = Math.max(li1 - 0.5, 0);
  const cMHD = (9 * Math.PI * dli) / sNorm, cEl = (18 * Math.PI * dli ** 3) / sNorm;
  const dWbussac = -cMHD * eps1 * eps1 * (betaP1 * betaP1 - betaPc * betaPc);
  const dWelong = -cEl * ((kappa1 - 1) / 2) ** 2;
  const betaI0 = (2 * MU0 * pi0) / (BT * BT);
  const dWko = (0.6 * cp * Math.sqrt(eps1) * betaI0) / sNorm;
  const betaFast = Bp1 > 0 ? (-2 * MU0 * (interpCells(g, pf, rho1) - 1.5 * fastInt)) / (Bp1 * Bp1) : 0;
  const dWfast = (PORCELLI.cF * Math.pow(eps1, 1.5) * betaFast) / sNorm;
  const dWcore = dWbussac + dWelong + dWko;
  const dW = dWcore + dWfast;

  // time and frequency scales
  const Ti0 = Math.max(st.Ti[0], 0.01), ne0 = st.ne[0] / 1e20;
  const na = ctx.w.na[0], nb = ctx.w.nb[0];
  const sp = FUEL_SPECIES[ctx.cfg.fuel];
  const Ai = na + nb > 0 ? (na * sp.a.A + nb * sp.b.A) / (na + nb) : 0.5 * (sp.a.A + sp.b.A);
  const tauA = 0.8e-6 * (R / BT) * Math.sqrt(Ai * Math.max(ne0, 1e-3));
  // |dp_i/dr|/p_i at q = 1: the ion pressure over the two cells around ρ_1, the radius from the faces
  const i0 = Math.min(Math.max(cellIndex(g, rho1), 1), N - 2);
  const dr = 0.5 * (g.RoutC[i0 + 1] - g.RinC[i0 + 1]) - 0.5 * (g.RoutC[i0 - 1] - g.RinC[i0 - 1]);
  const pIq = Math.max(interpCells(g, pi, rho1), 1e-30);
  let invLp = Math.abs(pi[i0 + 1] - pi[i0 - 1]) / Math.max(Math.abs(dr), 1e-9) / pIq;
  if (!(invLp > 0) || !Number.isFinite(invLp) || invLp > 1e6) invLp = 1 / r1;
  const omegaDi = (1000 * Ti0 * invLp) / (BT * rBar1);
  const rhoHat = (3.25e-3 * Math.sqrt(Ai * Ti0)) / (BT * rBar1);
  const lundquist = (43.7 * Ti0 ** 1.5 * rBar1 * rBar1) / tauA;
  const gammaRho = (1.1 * Math.pow(Math.max(s1, 1e-12), 6 / 7) * Math.pow(rhoHat, 4 / 7)) / (tauA * Math.pow(lundquist, 1 / 7));

  // fast ions at q = 1: pressure-weighted precession frequency of the beam ions and of the fusion products
  const pbq = interpCells(g, wk.pb, rho1), paq = interpCells(g, wk.pa, rho1), ptq = pbq + paq;
  const fast = ptq > 1e-3 * Math.max(pR1, 1e-30) && ptq > 0;
  let omegaDh = 0;
  if (fast) {
    const iq0 = Math.min(iq, N - 1);
    const [Eb, Zb, Ea, Za] = meanFastEnergies(ctx, interpCells(g, st.Te, rho1), interpCells(g, st.ne, rho1), Math.max(ctx.w.ionSum[iq0], 0.1));
    omegaDh = (500 / (BT * R * rBar1)) * ((pbq * Eb) / Math.max(Zb, 1) + (paq * Ea) / Math.max(Za, 1)) / ptq;
  }

  const c13: [number, number] = [-dWcore, PORCELLI.cH * tauA * omegaDh];
  const c14: [number, number] = [-dW, 0.5 * omegaDi * tauA];
  const c15a: [number, number, number] = [-PORCELLI.cRho * rhoHat, -dW, 0.5 * omegaDi * tauA];
  const c15b: [number, number] = [omegaDi, PORCELLI.cStar * gammaRho];
  return {
    rho1, r1, rBar1, kappa1, eps1, s1, sNorm, li1, betaP1, betaPc, Bp1, dWbussac, dWelong, dWko, dWfast, dWcore, dW,
    tauA, omegaDh, omegaDi, rhoHat, lundquist, gammaRho, fast, c13, c14, c15a, c15b,
    eq13: fast && c13[0] > c13[1], eq14: c14[0] > c14[1], eq15: c15a[0] < c15a[1] && c15a[1] < c15a[2] && c15b[0] < c15b[1],
  };
}

const rel = (l: number, r: number) => (l - r) / (Math.abs(l) + Math.abs(r) + 1e-3);

/** The margin of the trigger from the terms of a state: positive when one of the three conditions holds, −1 without a q = 1 surface */
export function marginOfTerms(t: PorcelliTerms | null): number {
  if (!t) return -1;
  const m13 = t.fast ? rel(t.c13[0], t.c13[1]) : -1;
  const m14 = rel(t.c14[0], t.c14[1]);
  // (15): both parts must hold: the smaller of the margins of −c_ρ ρ̂ < −δŴ, −δŴ < ½ ω_*i τ_A and ω_*i < c_* γ_ρ
  const m15 = Math.min(rel(t.c15a[1], t.c15a[0]), rel(t.c15a[2], t.c15a[1]), rel(t.c15b[1], t.c15b[0]));
  return Math.max(m13, m14, m15);
}

/** The margin of the trigger of the model (sawtooth.ts) at a state */
export function porcelliMargin(ctx: ProfileContext, st: TriggerState, sc: TriggerScratch): number {
  return marginOfTerms(porcelliTerms(ctx, st, sc));
}
