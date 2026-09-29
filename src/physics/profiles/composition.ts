/**
 * Plasma composition of the 1.5D model.
 *
 *  - Local composition (composition): fuel ion densities from quasi-neutrality with the He ash,
 *    the intrinsic impurity and an optional seeded impurity at fixed concentrations, their mean
 *    charges from coronal equilibrium (radiation.ts), Z_eff and the ion sum Σ n_j Z_j²/A_j / n_e
 *    used by the slowing-down and equilibration rates.
 *  - Global inventories (evolveInventories): He ash with confinement time τ_He (production: the
 *    ash of every fusion channel, fusion.ts), impurity content relaxing to its set-point with τ_Z
 *    (plus the tungsten source from the divertor), and the fuel mix n_a/(n_a + n_b) from fueling,
 *    beam and the per-channel burn-up (fusion.ts).
 */
import { FUEL_CHANNELS, FUEL_SPECIES } from '../reactivity';
import { meanCharge } from '../radiation';
import { IMPURITIES, ImpuritySpecies } from '../constants';
import { KEV, ProfileContext } from './context';
import { volumeIntegral } from './sources/deposition';
import type { ProfileState, ScalarView } from './state';

/** Seeded (radiating) impurity species, if one is configured */
export function seedSpecies(ctx: ProfileContext): ImpuritySpecies | null {
  const im = ctx.cfg.impurity;
  return im.seedSpecies && im.seedConcentration ? im.seedSpecies : null;
}

/** Composition: fuel densities from quasi-neutrality, Z_eff, ion sum (writes w.na … w.ionSum) */
export function composition(ctx: ProfileContext, Te: ArrayLike<number>, ne: ArrayLike<number>, s: ScalarView): void {
  // profile-resolved He ash and impurities (impurity/): the same arrays from the density profiles of the state
  if (ctx.impurity) { ctx.impurity.composition(Te, ne, s); return; }
  const w = ctx.w, N = ctx.N;
  const fs = FUEL_SPECIES[ctx.cfg.fuel];
  const im = ctx.cfg.impurity;
  const seed = seedSpecies(ctx);
  const cs = seed ? im.seedConcentration! : 0;
  const Ne = volumeIntegral(ctx.tg, ne);
  const fHe = Math.min(Math.max(s.NHe / Math.max(Ne, 1), 0), 0.3);
  const cZ = Math.max(s.cZ, 0);
  const fA = Math.min(Math.max(s.fA, 0), 1);
  const AZ = IMPURITIES[im.species]?.A ?? 20;
  const As = seed ? IMPURITIES[seed].A : 20;
  for (let i = 0; i < N; i++) {
    const T = Math.max(Te[i], 0.01);
    const Zz = meanCharge(im.species, Math.max(T, 0.1));
    const Zs = seed ? meanCharge(seed, Math.max(T, 0.1)) : 0;
    const n = ne[i];
    const nHe = fHe * n, nZ = cZ * n, ns = cs * n;
    const neFuel = Math.max(n - 2 * nHe - Zz * nZ - Zs * ns, 0.05 * n);
    const nf = neFuel / (fA * fs.a.Z + (1 - fA) * fs.b.Z);
    const na = fA * nf, nb = (1 - fA) * nf;
    w.na[i] = na; w.nb[i] = nb; w.nHe[i] = nHe; w.nZ[i] = nZ; w.ns[i] = ns; w.Zimp[i] = Zz; w.Zseed[i] = Zs;
    w.ni[i] = na + nb + nHe + nZ + ns;
    const main = na * fs.a.Z ** 2 + nb * fs.b.Z ** 2 + 4 * nHe;
    w.ZeffMain[i] = main / n;
    w.Zeff[i] = (main + Zz * Zz * nZ + Zs * Zs * ns) / n;
    w.ionSum[i] = (na * fs.a.Z ** 2 / fs.a.A + nb * fs.b.Z ** 2 / fs.b.A + nHe + nZ * Zz * Zz / AZ + ns * Zs * Zs / As) / n;
  }
}

/** Inputs of the inventory update over one accepted step */
export interface InventoryInputs {
  dt: number;
  /** particle confinement time used for the ash, impurity and particle times (τ_E-based) [s] */
  tauT: number;
  /** He ash production Σ_channels R_j × ash per reaction [1/s] (∫ w.ash dV) */
  ashRate: number;
  /** fueling rate entering the plasma, after the efficiency [1/s] */
  Sf: number;
  /** NBI particle source [1/s] */
  S_nbi: number;
  /** fraction of the fueling that is species a */
  wA: number;
}

/**
 * Explicit update of the He ash, impurity and fuel-mix scalars over one accepted step (o: state
 * at the start of the step, s: scalars of the new state).
 */
export function evolveInventories(ctx: ProfileContext, o: ProfileState, st: ProfileState, X: InventoryInputs): void {
  const c = ctx.cfg, g = ctx.tg, w = ctx.w, N = ctx.N, s = st.s;
  const { dt, tauT, ashRate, Sf, S_nbi, wA } = X;
  const Ne = volumeIntegral(g, st.ne);
  const tauHe = Math.max(c.transport.tau_He_over_tau_E * tauT, 1e-2);
  s.NHe = Math.max(0, o.s.NHe + dt * (ashRate - o.s.NHe / tauHe));
  const tau_p = Math.max(c.transport.tau_p_over_tau_E * tauT, 1e-2);
  // tungsten accumulates faster without the flushing of ELMs and sawteeth
  const tauW_accum = c.impurity.species === 'W' && (!c.events.elms || !c.events.sawteeth) ? 4 : 1;
  const S_W = c.impurity.species === 'W' ? (c.impurity.W_source_frac * ctx.PSOL) / (5000 * KEV) : 0;
  const tauZ = tau_p * tauW_accum;
  s.cZ = Math.max(0, o.s.cZ + dt * ((ctx.ctrl.cZ - o.s.cZ) / tauZ + S_W / Math.max(Ne, 1)));
  let burnA = 0, burnAll = 0;
  for (let i = 0; i < N; i++) { burnA += w.burnA[i] * g.dV[i]; burnAll += (w.burnA[i] + w.burnB[i]) * g.dV[i]; }
  // beam isotope mix: pure species a (D) with 'nbi' fueling, otherwise it follows the fuel mix
  // (D and T beams together in JET DTE2 — Mailloux et al., Nucl. Fusion 62 (2022) 042026)
  const wBeam = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
  const Nfuel = volumeIntegral(g, w.na) + volumeIntegral(g, w.nb);
  if (!FUEL_CHANNELS[c.fuel][0].sameSpecies && Nfuel > 0) {
    const Sa = Sf * wA + S_nbi * wBeam, Stot = Sf + S_nbi;
    const dfA = (Sa - burnA - o.s.fA * (Stot - burnAll)) / Nfuel;
    s.fA = Math.min(Math.max(o.s.fA + dt * dfA, 0.01), 0.99);
  } else s.fA = o.s.fA;
}
