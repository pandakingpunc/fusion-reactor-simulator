/**
 * POPCON (Plasma OPeration CONtour): map of the auxiliary power P_aux and of Q = P_fus/P_aux required for steady state in the
 * (⟨n_e⟩, ⟨T⟩) plane (Houlberg, Attenberger & Hively, Nucl. Fusion 22 (1982) 935).
 *
 * Steady-state power balance (the same components as the 0D model and the same loss-power definition):
 *   P_aux + P_α = P_rad + W/τ_E(P_L),   P_L = P_heat − P_rad,core  (dW/dt = 0; P_rad,core: ρ < RHO_CORE)
 * ⇒ P_L = W/τ_E(P_L) + P_rad,mantle; solved by fixed-point iteration (τ_E ∝ P^−0.69 → convergent).
 * L-H access: P_L ≥ P_LH (Martin 2008 + Ryter 2014 low-density branch, with the line-averaged density).
 * Composition: fuel dilution from quasi-neutrality (main impurity, seed, He ash); the He ash from the steady
 * state n_He = R_fusion τ_He / V, τ_He = (τ_He/τ_E)·τ_E. Radiation: bremsstrahlung (main ions +
 * He), Mavrin line cooling (impurity + seed), synchrotron (Albajar). Profiles
 * n = n₀(1−ρ²)^α_n, T = T₀(1−ρ²)^α_T; ⟨·⟩ is the volume average (the same definition as the 1.5D trajectory).
 * APPROXIMATION: T_i = T_e; H-mode (H98·IPB98) everywhere; no beam-target fusion and no ohmic power.
 */
import { MagneticConfig } from './types';
import { arealElongation, boundaryShape, plasmaSurface, plasmaVolume, profileIntegral, profileIntegralSplit } from './geometry';
import { tauHmode, tauISS04, pLH_threshold, stellaratorHISS04 } from './transport';
import { FUEL_CHANNELS, FUEL_SPECIES, pairDensity } from './reactivity';
import { bremsstrahlung, coolingRate, meanCharge, synchrotronTotal, RHO_CORE } from './radiation';
import { greenwaldDensity, betaToroidal, betaNormalized, lineAverageFactor } from './limits';

const E_KEV = 1.602176634e-16;
const MEV = 1.602176634e-13;

export interface PopconGrid {
  n: number[]; // yoğunluk ekseni ⟨n_e⟩ [m⁻³]
  T: number[]; // sıcaklık ekseni ⟨T⟩ [keV]
  nx: number; ny: number;
  Paux: Float64Array; // [W], indeks i·ny + j
  Pfus: Float64Array;
  Q: Float64Array;
  betaN: Float64Array;
  PLH_ok: Uint8Array;
  fHe: Float64Array; // kararlı durum He külü oranı n_He/n_e
  /** Greenwald limit on the ⟨n_e⟩ (volume-average) axis of this grid: n_G / f_line(α_n) (n_G is for the line average) */
  nG: number;
}

/** uniformT: eşit aralıklı T ekseni (raster/figür için); varsayılan düşük T'de sıklaştırılmış */
export function computePopcon(cfg: MagneticConfig, o: { nx?: number; ny?: number; Tmax?: number; nMaxFactor?: number; uniformT?: boolean } = {}): PopconGrid {
  const NX = o.nx ?? 44, NY = o.ny ?? 44, TMAX = o.Tmax ?? 40;
  // volume and surface of the boundary (LCFS) shape, as in the 0D model (geometry.boundaryShape)
  const g = cfg.geometry, gB = boundaryShape(cfg), V = plasmaVolume(gB), S = plasmaSurface(gB);
  const gITPA = { R: g.R, a: g.a, kappa: arealElongation(gB), delta: gB.delta }; // ITPA20 scalings: κ_a and the average LCFS δ
  const stell = cfg.method === 'stellarator';
  const aN = cfg.transport.alpha_n, aT = cfg.transport.alpha_T;
  const nG = greenwaldDensity(cfg.Ip_MA, g.a) / lineAverageFactor(aN);
  const nMax = stell ? cfg.n_target * 2.5 : nG * (o.nMaxFactor ?? 1.6);
  const n = Array.from({ length: NX }, (_, i) => (nMax * (i + 0.5)) / NX);
  const T = Array.from({ length: NY }, (_, j) => (o.uniformT ? (TMAX * (j + 0.5)) / NY : 0.5 + (TMAX - 0.5) * ((j + 0.5) / NY) ** 1.4));
  const pk = (1 + aN) * (1 + aN);
  const chans = FUEL_CHANNELS[cfg.fuel], fs = FUEL_SPECIES[cfg.fuel];
  const fA = cfg.fuelFracA;
  const M = fA * fs.a.A + (1 - fA) * fs.b.A;
  const zDen = fA * fs.a.Z + (1 - fA) * fs.b.Z; // yakıt elektronu başına iyon
  const im = cfg.impurity;
  const cs = im.seedConcentration ?? 0;
  const Wprof = ((1 + aN) * (1 + aT)) / (1 + aN + aT); // ⟨nT⟩ = Wprof·⟨n⟩⟨T⟩
  // the scalings use the line-averaged density (n̄ = f_line ⟨n_e⟩)
  const fLine = lineAverageFactor(aN);
  const tauOf = (ne: number, P: number) => stell
    ? tauISS04(g, cfg.B0, fLine * ne, P, cfg.stellarator.iota23, stellaratorHISS04(cfg.stellarator, cfg.H98))
    : tauHmode(cfg.scaling, cfg.scaling === 'ITPA20' || cfg.scaling === 'ITPA20-IL' ? gITPA : g, cfg.Ip_MA, cfg.B0, fLine * ne, P, M) * cfg.H98;

  const Paux = new Float64Array(NX * NY), Pfus = new Float64Array(NX * NY), Q = new Float64Array(NX * NY);
  const betaN = new Float64Array(NX * NY), PLH_ok = new Uint8Array(NX * NY), fHeA = new Float64Array(NX * NY);
  const sh = (r: number) => 1 - r * r;
  for (let j = 0; j < NY; j++) {
    // T'ye bağlı profil integralleri (yoğunluktan bağımsız)
    const T0 = T[j] * (1 + aT);
    const prof = (f: (Tl: number) => number, N = 24) => profileIntegral((r) => Math.pow(sh(r), 2 * aN) * f(T0 * Math.pow(sh(r), aT)), N);
    // radiation integrals: the total and the core (ρ < RHO_CORE) share
    const profS = (f: (Tl: number) => number, N = 24) => profileIntegralSplit((r) => Math.pow(sh(r), 2 * aN) * f(T0 * Math.pow(sh(r), aT)), RHO_CORE, N);
    const Ich = chans.map((ch) => prof(ch.sigmav, 32));
    const Ibr0 = profS((Tl) => bremsstrahlung(1, Tl, 0)), Ibr01 = profS((Tl) => bremsstrahlung(1, Tl, 1));
    const Ibr1 = Ibr01.total - Ibr0.total, Ibr1c = Ibr01.inner - Ibr0.inner; // brems is linear in Z_eff
    const Iline = profS((Tl) => coolingRate(im.species, Tl));
    const Iseed = im.seedSpecies && cs ? profS((Tl) => coolingRate(im.seedSpecies!, Tl)) : { total: 0, inner: 0 };
    const Zz = meanCharge(im.species, T[j]);
    const Zs = im.seedSpecies ? meanCharge(im.seedSpecies, T[j]) : 0;
    for (let i = 0; i < NX; i++) {
      const ne = n[i];
      let fHe = 0, P_loss = 1e6, P_tr = 0, Pf = 0, Pch = 0, Prad = 0, W = 0;
      for (let outer = 0; outer < 4; outer++) {
        // bileşim (yarı-nötrallik)
        const nfe = Math.max(ne * (1 - Zz * im.concentration - Zs * cs - 2 * fHe), 0);
        const na = (nfe * fA) / zDen, nb = (nfe * (1 - fA)) / zDen;
        const ni = na + nb + (fHe + im.concentration + cs) * ne;
        // füzyon (termal)
        let ash = 0; Pf = 0; Pch = 0;
        chans.forEach((ch, k) => {
          const R = pairDensity(cfg.fuel, ch, na, nb) * pk * Ich[k] * V;
          ash += R * ch.ash; Pf += R * ch.Etot_MeV * MEV; Pch += R * ch.Echarged_MeV * MEV;
        });
        // ışınım
        const Zmain = (na * fs.a.Z ** 2 + nb * fs.b.Z ** 2 + 4 * fHe * ne) / ne;
        const Pbr = ne * ne * pk * (Ibr0.total + Zmain * Ibr1) * V;
        const Pline = ne * ne * pk * (im.concentration * Iline.total + cs * Iseed.total) * V;
        const Psync = synchrotronTotal({ R: g.R, a: g.a, kappa: g.kappa, B0: cfg.B0, ne0_1e20: (ne * (1 + aN)) / 1e20, Te0_keV: T0, alpha_n: aN, alpha_T: aT, wallReflectivity: im.wallReflectivity });
        Prad = Pbr + Pline + Psync;
        const PradCore = ne * ne * pk * (Ibr0.inner + Zmain * Ibr1c + im.concentration * Iline.inner + cs * Iseed.inner) * V + Psync;
        // energy and τ_E: P_L = W/τ_E(P_L) + P_rad,mantle
        W = 1.5 * (ne + ni) * T[j] * E_KEV * V * Wprof;
        for (let k = 0; k < 40; k++) { P_tr = W / Math.max(tauOf(ne, P_loss), 1e-4); P_loss = P_tr + Prad - PradCore; }
        // He külü kararlı durumu
        const tauHe = cfg.transport.tau_He_over_tau_E * tauOf(ne, P_loss);
        fHe = Math.min((ash * tauHe) / V / ne, 0.3);
      }
      const Pa = P_tr + Prad - Pch;
      const k = i * NY + j;
      Paux[k] = Pa; Pfus[k] = Pf; Q[k] = Pa > 0 ? Pf / Pa : Infinity; fHeA[k] = fHe;
      betaN[k] = cfg.Ip_MA > 0 ? betaNormalized(betaToroidal(W / (1.5 * V), cfg.B0), g.a, cfg.B0, cfg.Ip_MA) : 0;
      PLH_ok[k] = P_loss >= pLH_threshold(fLine * ne, cfg.B0, S, M, cfg.Ip_MA, g.a, g.R) ? 1 : 0;
    }
  }
  return { n, T, nx: NX, ny: NY, Paux, Pfus, Q, betaN, PLH_ok, fHe: fHeA, nG };
}
