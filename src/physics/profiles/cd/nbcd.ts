/**
 * Neutral-beam current drive of the 1.5D model with the physics of the beam ions' current and of the electron return current
 * (ProfileSettings.cdModel = 'physics'), in place of the efficiency scaling γ ∝ ⟨T_e⟩ √E_b of sources/nbi.ts.
 *
 * The current density carried by the fast ions of one beam energy component, born at the rate S [m⁻³ s⁻¹] with the pitch ξ_b = v_∥/v at birth,
 * is the parallel flow of their steady slowing-down distribution (the l = 1 term of the Legendre series of Gaffey, J. Plasma Phys. 16 (1976) 149,
 * for the scattering of the pitch on the plasma ions; Cordey, Nucl. Fusion 16 (1976) 499; fastions/slowingDown.ts):
 *
 *   J_f = e Z_b S τ_s v_b ξ_b I(y_c, Ẑ),   I = (1 + y_c³)^{Ẑ/3} ∫_0^1 [y³/(y³ + y_c³)]^{Ẑ/3 + 1} dy,   y_c = v_c/v_b = √(E_c/E_b),
 *
 * with τ_s the electron slowing-down time, E_c the critical energy (Stix) and Ẑ the ratio of the pitch-angle scattering on the ions to their energy
 * drag, Z_eff/(A_b ionSum) (pitchScatteringZhat). The fast ions drag the electrons along, and the electron return current shields part of their
 * current; with the trapped-electron correction of Start and Cordey, Phys. Fluids 23 (1980) 1477 (the fit of Mikkelsen and Singer, Nucl.
 * Technol./Fusion 4 (1983) 237, valid for all aspect ratios; also equations 21 and 22 of the NBEAMS module of the NTCC, Houlberg et al.),
 *
 *   J_NB = [1 − (Z_b/Z_eff)(1 − G(Z_eff, ε))] J_f,   G(Z, ε) = (1.55 + 0.85/Z) √ε − (0.20 + 1.55/Z) ε,
 *
 * ε the inverse aspect ratio of the flux surface. G = 0 on the axis (the fast ions and the electrons carry a current that cancels for
 * Z_eff = Z_b in a uniform plasma) and grows towards the edge, where the trapped electrons cannot carry the return current.
 *
 * The pitch ξ_b of the birth is R_tan ⟨1/R⟩ along the deposition chord (sources/deposition.ts, NbiChord). In the 'profile' fast-ion model the source
 * of the current is the rate at which the field of a component gives its ions to the plasma, S = w_k/(E_k τ_W,k) (the steady state of the
 * slowing-down distribution has w = S E_k τ_W): it builds up after the beam starts and decays after it stops as the ions do, and is smoothed
 * over the orbit width. APPROXIMATION: the beam is injected in the direction of the plasma current; steady slowing-down distribution of the
 * uniform-field solution (no trapping of the fast ions, no energy diffusion, no radial fast-ion transport); ⟨j·B⟩ ≈ J_NB √⟨B²⟩.
 */
import { FUEL_SPECIES } from '../../reactivity';
import { criticalEnergy, spitzerSlowingDownTime } from '../../heating';
import { KEV, type ProfileContext, type StepConstants } from '../context';
import { beamComponents } from '../fastions/components';
import { gaffeyCurrentIntegral, pitchScatteringZhat } from '../fastions/slowingDown';
import type { NbiSource } from '../sources/nbi';
import type { SourceModel } from '../sources/SourceModel';
import type { ProfileState } from '../state';

const QE = 1.602176634e-19; // C
const AMU = 1.66053906660e-27; // kg

/** Nodes of the Gauss–Legendre panels of the current integral in the model (12 gives 1e-7 against 24 over the range of the model) */
const CURRENT_INTEGRAL_NODES = 12;

/**
 * The trapped-electron correction G(Z_eff, ε) of Start and Cordey (1980) in the fit of Mikkelsen and Singer (1983), clamped to [0, 1]
 * (the polynomial is a fit for ε < 0.5, and never leaves [0, 1] there).
 */
export function startCordeyG(zeff: number, eps: number): number {
  const z = Math.max(zeff, 1e-3), e = Math.max(eps, 0);
  const G = (1.55 + 0.85 / z) * Math.sqrt(e) - (0.20 + 1.55 / z) * e;
  return Math.min(Math.max(G, 0), 1);
}

/** F = J_NB/J_f = 1 − (Z_b/Z_eff)(1 − G(Z_eff, ε)): the fraction of the fast-ion current that is left after the electron return current */
export function shieldingFactor(Zb: number, zeff: number, eps: number): number {
  return 1 - (Zb / Math.max(zeff, 1e-3)) * (1 - startCordeyG(zeff, eps));
}

/** Parameters of the fast-ion current of one beam energy component at a cell */
export interface FastIonCurrentInputs {
  /** T_e [keV], n_e [m⁻³] */
  Te: number; ne: number;
  /** mass number and charge of the beam ions */
  A: number; Z: number;
  /** beam energy of the component [keV] */
  Eb: number;
  /** Σ n_j Z_j²/(n_e A_j) and Z_eff of the plasma */
  ionSum: number; zeff: number;
  /** source rate S [m⁻³ s⁻¹] and the pitch cosine of the birth */
  S: number; xi: number;
}

/**
 * Parallel current density J_f [A m⁻²] of the fast ions of a component, e Z_b S τ_s v_b ξ_b I(y_c, Ẑ) (the header); `Ec_keV` the critical energy
 * of the plasma for these ions.
 */
export function fastIonCurrentDensity(p: FastIonCurrentInputs, Ec_keV: number = criticalEnergy(Math.max(p.Te, 0.01), p.A, p.ionSum)): number {
  if (!(p.S > 0) || !(p.Eb > 0)) return 0;
  const tauS = spitzerSlowingDownTime(Math.max(p.Te, 0.01), p.ne, p.A, p.Z);
  const vb = Math.sqrt((2 * p.Eb * KEV) / (p.A * AMU));
  const yc = Math.sqrt(Math.max(Ec_keV, 0) / p.Eb);
  const I = gaffeyCurrentIntegral(yc, pitchScatteringZhat(p.zeff, p.ionSum, p.A), CURRENT_INTEGRAL_NODES);
  return QE * p.Z * p.S * tauS * vb * p.xi * I;
}

/** The current drive of the two sources of the 'physics' model, as ⟨j·B⟩ of the last evaluation [A T m⁻²] (diagnostics: I_nbcd, I_eccd) */
export interface CurrentDriveParts {
  nbcd: Float64Array;
  eccd: Float64Array;
}

/**
 * Neutral-beam current drive source: adds the shielded current of every energy component of the beam into w.jcdB
 * (the header). Runs after the NBI source, whose per-component birth power and pitch it reads.
 */
export class NbcdSource implements SourceModel {
  readonly id = 'nbcd';

  constructor(private readonly nbi: NbiSource, private readonly parts: CurrentDriveParts) {}

  current(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const jn = this.parts.nbcd;
    jn.fill(0);
    const fast = ctx.fast;
    if (!(K.P_NBI > 0) && !fast) return;
    const c = ctx.cfg, w = ctx.w, g = ctx.tg, N = ctx.N;
    const fs = FUEL_SPECIES[c.fuel];
    const comps = beamComponents(c.heating.E_NBI_keV);
    const { Te, ne } = st;
    for (let k = 0; k < comps.length; k++) {
      const Ek = comps[k].E_keV, Ejoule = Ek * KEV;
      // source rate of the component in every cell [m⁻³ s⁻¹]
      let Smax = 0;
      const S = (i: number): number => (fast
        ? fast.beam[k].W[i] / (Math.max(fast.beam[k].tau[i], 1e-3) * Ejoule)
        : this.nbi.birthPower[k][i] / Ejoule);
      for (let i = 0; i < N; i++) Smax = Math.max(Smax, S(i));
      if (!(Smax > 0)) continue;
      const pitch = this.nbi.birthPitch[k];
      for (let i = 0; i < N; i++) {
        const Si = S(i);
        if (!(Si > 1e-3 * Smax)) continue;
        const zeff = Math.max(w.Zeff[i], 1);
        const J = fastIonCurrentDensity({ Te: Te[i], ne: ne[i], A: fs.a.A, Z: fs.a.Z, Eb: Ek, ionSum: w.ionSum[i], zeff, S: Si, xi: pitch[i] })
          * shieldingFactor(fs.a.Z, zeff, g.epsC[i]);
        jn[i] += J * Math.sqrt(g.B2C[i]);
      }
    }
    for (let i = 0; i < N; i++) w.jcdB[i] += jn[i];
  }
}
