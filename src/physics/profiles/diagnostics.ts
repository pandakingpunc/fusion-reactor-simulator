/**
 * Diagnostics of the 1.5D model: the scalar time traces (PROFILE_DIAGS), the radial profiles of a
 * history frame, and the global power totals they are built from.
 */
import { pLH_threshold } from '../transport';
import { RHO_CORE } from '../radiation';
import { greenwaldDensity } from '../limits';
import { divertorHeatFlux, neutronWallLoad } from '../engineering';
import { LAWSON_DT } from '../confinement/magneticReport';
import type { DiagSpec } from '../types';
import { KEV, MU0, ProfileContext, StepConstants } from './context';
import { lossPower } from './control/confinement';
import { HEAT_CONVECTION } from './fvsolver';
import { cellIndex, interpCells } from './geometry1d';
import { q95 } from './qprofile';
import { volumeIntegral } from './sources/deposition';
import type { ProfileState } from './state';
import { alphaCritical, alphaMHD, rhoOfQ, stabilityProfiles } from './mhd';
import { EDGE_DIAGS } from '../edge';
import { edgeChannels1D } from './boundary/edge';

export const PROFILE_DIAGS: DiagSpec[] = [
  { key: 'Ti', label: 'T_i (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Te', label: 'T_e (volume avg.)', unit: 'keV', group: 'Temperature' },
  { key: 'Ti0', label: 'T_i (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'Te0', label: 'T_e (axis)', unit: 'keV', group: 'Temperature' },
  { key: 'Tped', label: 'T_e (pedestal top)', unit: 'keV', group: 'Temperature' },
  { key: 'Tsep', label: 'T_sep (two-point)', unit: 'keV', group: 'Temperature' },
  { key: 'ne', label: 'n_e (volume avg.)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nbar', label: 'n̄_e (line avg.)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'ne0', label: 'n_e (axis)', unit: '1e20 m⁻³', group: 'Density' },
  { key: 'nG_frac', label: 'n̄/n_Greenwald', unit: '', group: 'Density' },
  { key: 'fHe', label: 'He ash fraction', unit: '', group: 'Density' },
  { key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' },
  { key: 'P_alpha', label: 'P_alpha (charged fusion products, deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_beam_heat', label: 'P_beam (NBI ions, deposited)', unit: 'MW', group: 'Power' },
  { key: 'P_bt', label: 'P_fusion beam-target', unit: 'MW', group: 'Power' },
  { key: 'P_aux', label: 'P_auxiliary', unit: 'MW', group: 'Power' },
  { key: 'P_oh', label: 'P_ohmic', unit: 'MW', group: 'Power' },
  { key: 'P_cond', label: 'P_transport (W/τ_E)', unit: 'MW', group: 'Power' },
  { key: 'P_SOL', label: 'P_SOL', unit: 'MW', group: 'Power' },
  { key: 'P_bound', label: 'P_bound (conducted + convected across the separatrix)', unit: 'MW', group: 'Power' },
  { key: 'P_brems', label: 'P_brems', unit: 'MW', group: 'Radiation' },
  { key: 'P_sync', label: 'P_synchrotron', unit: 'MW', group: 'Radiation' },
  { key: 'P_line', label: 'P_line', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad', label: 'P_rad total', unit: 'MW', group: 'Radiation' },
  { key: 'P_rad_core', label: 'P_rad core (ρ < 0.6)', unit: 'MW', group: 'Radiation' },
  { key: 'Q', label: 'Scientific Q', unit: '', group: 'Performance' },
  { key: 'triple', label: 'n·T·τ_E', unit: 'keV s m⁻³', group: 'Performance', log: true },
  { key: 'lawson', label: 'Lawson ratio', unit: '', group: 'Performance' },
  { key: 'ignited', label: 'Ignited (1 = yes)', unit: '', group: 'Performance' },
  { key: 'tauE', label: 'τ_E', unit: 's', group: 'Confinement' },
  { key: 'tauE_scal', label: 'τ_E scaling law (C_χ target)', unit: 's', group: 'Confinement' },
  { key: 'H_mode', label: 'Mode (1=H, 0=L)', unit: '', group: 'Confinement' },
  { key: 'P_LH', label: 'P_LH threshold', unit: 'MW', group: 'Confinement' },
  { key: 'P_loss', label: 'P_L = P_heat − P_rad,core − dW/dt', unit: 'MW', group: 'Confinement' },
  { key: 'chi_mult', label: 'Transport multiplier C_χ', unit: 'm²/s', group: 'Confinement' },
  { key: 'betaN', label: 'β_N', unit: '', group: 'MHD' },
  { key: 'betaN_th', label: 'β_N (thermal plasma only)', unit: '', group: 'MHD' },
  { key: 'betaP', label: 'β_p', unit: '', group: 'MHD' },
  { key: 'q95', label: 'q95', unit: '', group: 'MHD' },
  { key: 'q0', label: 'q(0)', unit: '', group: 'MHD' },
  { key: 'li', label: 'ℓ_i(3)', unit: '', group: 'MHD' },
  { key: 'rho_q1', label: 'ρ(q=1)', unit: '', group: 'MHD' },
  { key: 'alpha_ped', label: 'α_ped / α_crit', unit: '', group: 'MHD' },
  { key: 'w32', label: 'NTM 3/2 island w/a', unit: '', group: 'MHD' },
  { key: 'w21', label: 'NTM 2/1 island w/a', unit: '', group: 'MHD' },
  { key: 'f_bs', label: 'Bootstrap fraction', unit: '', group: 'Current' },
  { key: 'f_cd', label: 'Driven-current fraction', unit: '', group: 'Current' },
  { key: 'V_loop', label: 'Loop voltage', unit: 'V', group: 'Current' },
  { key: 'Ip', label: 'I_p', unit: 'MA', group: 'Current' },
  { key: 'W', label: 'W_plasma', unit: 'MJ', group: 'Energy' },
  { key: 'Wf', label: 'W_fast ions (α + beam)', unit: 'MJ', group: 'Energy' },
  { key: 'W_alpha', label: 'W_α (fast charged fusion products)', unit: 'MJ', group: 'Energy' },
  { key: 'W_beam', label: 'W_beam (fast NBI ions)', unit: 'MJ', group: 'Energy' },
  { key: 'dWdt_s', label: 'dW/dt (smoothed, with ELM losses)', unit: 'MW', group: 'Energy' },
  { key: 'Zeff', label: 'Z_eff', unit: '', group: 'Impurities' },
  { key: 'cZ', label: 'c_Z (n_Z/n_e)', unit: '', group: 'Impurities', log: true },
  { key: 'S_fuel', label: 'Fueling', unit: '1e20 /s', group: 'Density' },
  { key: 'burnFrac', label: 'T burn fraction', unit: '', group: 'Fuel' },
  { key: 'fuelFracA', label: 'D fraction n_D/(n_D+n_T)', unit: '', group: 'Fuel' },
  { key: 'q_div', label: 'Divertor heat flux', unit: 'MW/m²', group: 'Engineering' },
  { key: 'n_wall', label: 'Neutron wall load', unit: 'MW/m²', group: 'Engineering' },
  ...EDGE_DIAGS,
];

/** Volume-integrated powers of the current work arrays [W] */
export interface PowerTotals {
  P_fus: number; P_chg: number; P_neut: number; P_bt: number;
  /** absorbed auxiliary heating (NBI + ICRH + ECRH) */
  P_aux_abs: number;
  /** NBI heating deposited in the plasma (the absorbed beam power; with the 'profile' fast-ion model the delivered heating, which lags it) */
  P_beam: number;
  P_oh: number;
  /** alpha (charged-product) heating, = P_chg (with the 'profile' fast-ion model the delivered heating, which lags the birth power P_chg) */
  P_alpha: number;
  P_brems: number; P_line: number; P_sync: number; P_rad: number;
  /** radiation of the core, ρ < RHO_CORE (all of the synchrotron radiation counts as core) */
  P_rad_core: number;
  /** P_aux_abs + P_oh + P_alpha (with the 'profile' fast-ion model the beam power in it is the delivered heating P_beam) */
  P_heat: number;
  /**
   * energy content of the steady slowing-down distributions of the fast charged fusion products and of
   * the NBI fast ions, P τ_W [J]: what the pools of fastIons.ts relax towards
   */
  Wss_alpha: number; Wss_beam: number;
}

/** Global quantities a diagnostics frame is written from */
export interface GlobalTotals extends PowerTotals {
  /** stored energy [J], its rate of change [W] */
  W: number; dWdt: number;
  /** energy content of the fast charged fusion products and of the NBI fast ions: the pools of fastIons.ts [J] */
  W_alpha: number; W_beam: number;
  /** reported τ_E and the scaling-law τ_E [s] */
  tauE: number; tauScal: number;
  /** loss power [W], line-averaged density [m⁻³] */
  P_loss: number; nbar: number;
  /**
   * power conducted and convected across the separatrix [W]; over an accepted step
   * dW/dt = P_heat − P_rad − P_bound up to the Picard tolerance (discrete energy conservation)
   */
  P_bound: number;
}

export function powerTotals(ctx: ProfileContext, K: StepConstants): PowerTotals {
  const w = ctx.w, g = ctx.tg;
  const I = (a: Float64Array) => volumeIntegral(g, a);
  const P_fus = I(w.Pfus), P_chg = I(w.Pchg), P_neut = I(w.Pneut), P_bt = I(w.Pbt);
  const fast = ctx.fast;
  const P_beam = I(w.PnbiE) + I(w.PnbiI);
  // the 'profile' fast-ion model delivers the heating of the beam ions and of the fusion products with the slowing-down delay: P_beam and
  // P_alpha are then the delivered heating (as the pools of the 0D model), while the absorbed beam power that Q is measured against is
  // the birth power of the components
  let P_beam_birth = P_beam;
  if (fast) { P_beam_birth = 0; for (const b of fast.beamBirth) P_beam_birth += I(b); }
  const P_rf = I(w.PicE) + I(w.PicI) + I(w.PecE);
  const P_aux_abs = fast ? P_beam_birth + P_rf : P_beam + I(w.PicE) + I(w.PicI) + I(w.PecE);
  const P_oh = I(w.Poh), P_alpha = fast ? I(w.PaE) + I(w.PaI) : P_chg;
  const P_brems = I(w.Pbr), P_line = I(w.Pline), P_sync = K.Psync, P_rad = P_brems + P_line + P_sync;
  // core radiation: bremsstrahlung and line radiation inside ρ < RHO_CORE (the cell that straddles it
  // counts by its share), synchrotron entirely
  let core = 0;
  for (let i = 0; i < g.N; i++) core += Math.min(1, Math.max(0, (RHO_CORE - g.rhoF[i]) / g.dRhoC[i])) * (w.Pbr[i] + w.Pline[i]) * g.dV[i];
  const P_rad_core = core + P_sync;
  const P_heat = fast ? P_rf + P_beam + P_oh + P_alpha : P_aux_abs + P_oh + P_alpha;
  return { P_fus, P_chg, P_neut, P_bt, P_aux_abs, P_beam, P_oh, P_alpha, P_brems, P_line, P_sync, P_rad, P_rad_core, P_heat, Wss_alpha: I(w.Walpha), Wss_beam: I(w.Wbeam) };
}

/**
 * Writes ctx.lastDiag and ctx.lastProf for state st from the current work arrays and the global
 * totals X. Also updates ctx.alphaRatio (the pedestal α of these profiles).
 */
export function writeDiagnostics(ctx: ProfileContext, st: ProfileState, X: GlobalTotals): void {
  const N = ctx.N, w = ctx.w, g = ctx.tg, c = ctx.cfg, s = st.s;
  const v = st;
  const Ip = s.Ip, Ip_MA = Ip / 1e6;
  const K = ctx.lastK!;
  const neAvg = ctx.volAvg(v.ne);
  let TeA = 0, TiA = 0;
  for (let i = 0; i < N; i++) { TeA += v.Te[i] * v.ne[i] * g.dV[i]; TiA += v.Ti[i] * w.ni[i] * g.dV[i]; }
  TeA /= Math.max(volumeIntegral(g, v.ne), 1); TiA /= Math.max(volumeIntegral(g, w.ni), 1);
  // pressure: thermal ⟨n_e T_e + n_i T_i⟩ = (2/3) W/V, plus the fast ions (2/3) (W_α + W_beam)/V, the pools
  // that build up with τ_W and cannot exceed the injected energy (fastIons.ts; isotropic, APPROXIMATION: the
  // anisotropy of the beam ions is neglected, as in the 0D model). β_T and β_N are
  // total; β_N,th (the drive of the NTMs is the bootstrap current of the thermal pressure gradient)
  // and β_p (the equilibrium's pressure table is thermal) are thermal.
  const pAvg = X.W / (1.5 * g.volume);
  const Wfast = X.W_alpha + X.W_beam;
  const betaThermal = (2 * MU0 * pAvg) / (g.B0 * g.B0);
  const betaT = betaThermal + (2 * MU0 * ((2 / 3) * Wfast / g.volume)) / (g.B0 * g.B0);
  const betaN = (betaT * 100 * g.a * g.B0) / Math.max(Ip_MA, 0.01);
  const betaN_th = (betaThermal * 100 * g.a * g.B0) / Math.max(Ip_MA, 0.01);
  const Bpa = (MU0 * Ip) / g.perimeter;
  const betaP = (2 * MU0 * pAvg) / (Bpa * Bpa);
  // ℓ_i(3) = 2∫B_p² dV/(μ0² I_p² R0), B_p² ≈ g2 ψ'²
  let bp2 = 0;
  for (let i = 0; i < N; i++) { const dps = 0.5 * (w.dpsiF[i] + w.dpsiF[i + 1]); bp2 += g.g2C[i] * dps * dps * g.dV[i]; }
  const li = (2 * bp2) / (MU0 * MU0 * Ip * Ip * g.R0);
  const Ibs = volumeIntegral(g, w.jbsB.map((jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0)));
  const Icd = volumeIntegral(g, w.jcdB.map((jb, i) => jb / (2 * Math.PI * g.RgeoC[i] * g.B0)));
  const P_in = X.P_aux_abs + X.P_oh;
  const Q = X.P_fus / Math.max(P_in, 1e4);
  const triple = neAvg * TiA * X.tauE;
  const nG = greenwaldDensity(Math.max(Ip_MA, 0.01), g.a);
  // L–H threshold: Martin 2008 with the line-averaged density and the Ryter 2014 low-density branch, as in 0D
  const P_LH = pLH_threshold(X.nbar, g.B0, g.surface, ctx.M, Math.max(Ip_MA, 0.01), g.a, g.R0);
  const rhoPed = 1 - ctx.ps.pedestalWidth;
  // T_ped: the electron temperature at ρ_ped. The legacy uniform grid takes the cell that contains it (a cell 0.02 wide, in the steep
  // gradient of the barrier); the packed grid interpolates linearly between the two centres around ρ_ped
  const Tped = g.uniform ? v.Te[cellIndex(g, rhoPed)] : interpCells(g, v.Te, rhoPed);
  // pressure at the separatrix: the last face of the α check on a packed grid (alphaMHD)
  const pSep = (ctx.bc.n * ctx.bc.Te + ctx.bc.n * (w.ni[N - 1] / Math.max(v.ne[N - 1], 1)) * ctx.bc.Ti) * KEV;
  // the ballooning drive is the gradient of the total pressure: with the 'profile' fast-ion model the fast ions are in it (not in the bootstrap current, which reads w.p)
  const pMhd = ctx.fast ? ctx.fast.totalPressure(w.p) : w.p;
  const aMax = alphaMHD(g, pMhd, w.qF, rhoPed - 0.02, w.alphaF, pSep);
  const aCrit = alphaCritical(ctx.geomB.kappa, ctx.geomB.delta, ctx.ps.alphaCritFactor);
  ctx.alphaRatio = aMax / aCrit;
  const rho1 = rhoOfQ(g, w.qF, 1);
  const q95v = q95(ctx);
  const qdiv = divertorHeatFlux(ctx.geomB, Math.max(Ip, 1e5), ctx.PSOL, c.divertor.f_rad_div, c.divertor.flux_expansion).q_div_MWm2;
  const nw = neutronWallLoad(ctx.geomB, X.P_neut, 1).load_MWm2;
  const Vloop = ctx.lastVloop;
  let qmin = Infinity; for (let f = 0; f <= N; f++) qmin = Math.min(qmin, w.qF[f]);
  const Ne = volumeIntegral(g, v.ne);
  ctx.lastDiag = {
    Ti: TiA, Te: TeA, Ti0: v.Ti[0], Te0: v.Te[0], Tped, Tsep: ctx.bc.Te,
    ne: neAvg / 1e20, nbar: X.nbar / 1e20, ne0: v.ne[0] / 1e20, nG_frac: X.nbar / nG, fHe: s.NHe / Math.max(Ne, 1),
    P_fus: X.P_fus / 1e6, P_alpha: X.P_alpha / 1e6, P_beam_heat: X.P_beam / 1e6, P_bt: X.P_bt / 1e6, P_aux: (K.P_NBI + K.P_IC + K.P_EC) / 1e6, P_oh: X.P_oh / 1e6,
    P_cond: X.W / X.tauE / 1e6, P_SOL: ctx.PSOL / 1e6, P_brems: X.P_brems / 1e6, P_sync: X.P_sync / 1e6, P_line: X.P_line / 1e6, P_rad: X.P_rad / 1e6, P_rad_core: X.P_rad_core / 1e6,
    Q, triple, lawson: triple / LAWSON_DT, tauE: X.tauE, tauE_scal: X.tauScal, H_mode: ctx.hmode ? 1 : 0, P_LH: P_LH / 1e6, chi_mult: s.Cchi,
    betaN, betaN_th, betaT: betaT * 100, betaP, q95: q95v, q0: w.qF[0], qmin, li, rho_q1: rho1, alpha_ped: aMax / aCrit,
    w32: s.w32 / g.a, w21: s.w21 / g.a, NTM: s.w32 > 0.01 * g.a || s.w21 > 0.01 * g.a ? 1 : 0,
    f_bs: Ibs / Math.max(Ip, 1), f_cd: Icd / Math.max(Ip, 1), V_loop: Vloop, Ip: Ip_MA,
    W: X.W / 1e6, Wf: Wfast / 1e6, W_alpha: X.W_alpha / 1e6, W_beam: X.W_beam / 1e6, ignited: ctx.ignited ? 1 : 0, Zeff: ctx.volAvg(w.Zeff), cZ: s.cZ, S_fuel: s.Sfuel / 1e20,
    burnFrac: s.NTfuel > 0 ? s.NTburn / s.NTfuel : 0, fuelFracA: s.fA,
    q_div: qdiv, n_wall: nw, P_heat: X.P_heat / 1e6, P_charged: X.P_chg / 1e6, P_neutron: X.P_neut / 1e6,
    Efus_MJ: s.Efus / 1e6, Ein_MJ: s.Ein / 1e6, Nn: s.Nn, P_loss: X.P_loss / 1e6, dWdt: X.dWdt / 1e6, dWdt_s: ctx.dWdtS / 1e6, P_bound: X.P_bound / 1e6,
    ...edgeChannels1D(ctx, q95v, Ip),
  };
  // profiles
  const mer = w.mercF, bal = w.ballF;
  stabilityProfiles(g, pMhd, w.qF, mer, bal);
  const r = (a: ArrayLike<number>, sc = 1) => Array.from(a, (x) => x * sc);
  const jfac = (_i: number) => 1 / (g.B0 * 1e6);
  ctx.lastProf = {
    rho: r(g.rhoC), Te: r(v.Te), Ti: r(v.Ti), ne: r(v.ne, 1e-20), q: r(w.q),
    j: Array.from(w.jB, (x, i) => x * jfac(i)), jbs: Array.from(w.jbsB, (x, i) => x * jfac(i)), jcd: Array.from(w.jcdB, (x, i) => x * jfac(i)),
    johm: Array.from(w.jB, (x, i) => (x - w.jniB[i]) * jfac(i)),
    chie: Array.from(g.rhoC, (_, i) => 0.5 * (w.chiE[i] + w.chiE[i + 1])), chii: Array.from(g.rhoC, (_, i) => 0.5 * (w.chiI[i] + w.chiI[i + 1])),
    Palpha: r(w.Pchg, 1e-6), Paux: Array.from(g.rhoC, (_, i) => (w.PnbiE[i] + w.PnbiI[i] + w.PicE[i] + w.PicI[i] + w.PecE[i]) * 1e-6),
    Prad: r(w.Prad, 1e-6), Pohm: r(w.Poh, 1e-6), p: r(w.p, 1e-3), Zeff: r(w.Zeff),
    ...(ctx.fast ? { pfast: r(ctx.fast.pFast, 1e-3) } : {}),
    shear: Array.from(g.rhoC, (rr, i) => (rr * (w.qF[i + 1] - w.qF[i]) / g.dRhoC[i]) / Math.max(w.q[i], 1e-6)),
    alpha: Array.from(g.rhoC, (_, i) => 0.5 * (w.alphaF[i] + w.alphaF[i + 1])),
  };
}

/**
 * Power conducted and convected across the separatrix by the profiles of st [W], with the χ of the
 * evaluated work arrays and the boundary particle outflux Γ_b of the last accepted step: P_bound of
 * a state that no step produced.
 */
function boundaryPower(ctx: ProfileContext, st: ProfileState): number {
  const w = ctx.w, bc = ctx.bc;
  const GammaF = new Float64Array(ctx.N + 1);
  GammaF[ctx.N] = ctx.GammaB;
  const b = ctx.heat.boundaryLoss({ ne1: st.ne, ni1: w.ni, chiE: w.chiE, chiI: w.chiI, GammaF, convCoef: HEAT_CONVECTION, TeB: bc.Te, TiB: bc.Ti, nB: bc.n }, st.Te, st.Ti);
  return (b.e + b.i) * KEV;
}

/**
 * Diagnostics of a state that no step produced (first frame, after an MHD crash): the work arrays
 * must have been evaluated on st (K: their step constants). τ_E is carried over from the last
 * frame in 'scaling' transport (the controller target), and W/P_loss in predictive transport.
 */
export function stateDiagnostics(ctx: ProfileContext, st: ProfileState, K: StepConstants, predictive: boolean): void {
  const tauPrev = ctx.lastDiag.tauE ?? 0.1;
  const tauScal = ctx.lastDiag.tauE_scal ?? tauPrev;
  const W = ctx.storedEnergy(st);
  const P = powerTotals(ctx, K);
  const P_loss = lossPower(ctx, P.P_heat, P.P_rad_core, ctx.dWdtS);
  const tauE = predictive ? W / P_loss : tauPrev;
  writeDiagnostics(ctx, st, { ...P, W, dWdt: 0, W_alpha: ctx.WfAlpha, W_beam: ctx.WfBeam, tauE, tauScal, P_loss, nbar: ctx.lineAvg(st.ne), P_bound: boundaryPower(ctx, st) });
}

/** Diagnostics during the quench phases of a disruption: only the quantities the quench changes */
export function quenchDiagnostics(ctx: ProfileContext, st: ProfileState): void {
  const W = ctx.storedEnergy(st);
  Object.assign(ctx.lastDiag, {
    W: W / 1e6, Te: ctx.volAvg(st.Te), Ti: ctx.volAvg(st.Ti), Te0: st.Te[0], Ti0: st.Ti[0], Ip: st.s.Ip / 1e6,
    P_fus: 0, P_alpha: 0, P_beam_heat: 0, P_aux: 0, P_heat: 0, Q: 0, P_bt: 0, P_neutron: 0, P_charged: 0, Wf: 0, W_alpha: 0, W_beam: 0,
  });
}

