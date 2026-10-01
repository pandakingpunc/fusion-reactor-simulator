/**
 * Electron-cyclotron heating and current-drive source of the 'physics' current-drive model (ProfileSettings.cdModel = 'physics'), with its own
 * deposition and a launcher configuration (ProfileSettings.eccd, EccdLauncher), in place of the Gaussian layer and the efficiency factor
 * `eccdEff` of sources/rf.ts (which then heats through the same power arrays but drives no current).
 *
 * The wave power P_EC (the controlled ECRH power) is absorbed in a Gaussian layer of the launcher's aim ρ and width, all of it by the electrons
 * (w.PecE; APPROXIMATION: no ray tracing, full single-pass absorption). The current density it drives on a flux surface is that of the linear
 * response of the electrons on the resonance curve (cd/eccd.ts, Lin-Liu, Chan and Prater, Phys. Plasmas 10 (2003) 4064):
 *
 *   ⟨j∥⟩ = 2π ζ* T_e Q/(32.74 n_20)   [A m⁻², T_e in keV, Q the absorbed power density in W m⁻³, n_20 = n_e/10²⁰ m⁻³],
 *   ⟨j·B⟩ = ⟨j∥⟩ ⟨B²⟩/⟨B⟩,
 *
 * evaluated at every cell of the layer with its own T_e, Z_eff and inverse aspect ratio ε (the circular model of the paper), at the poloidal
 * angle θ_p of the absorption (thetaP_deg; 0 the outboard midplane, where the wave of an equatorial launcher is absorbed), for the harmonic and the
 * parallel index of the launcher: n∥ > 0 drives current along the plasma current, n∥ < 0 against it. The resonance parameter y = ℓ ω_c/ω is that of the
 * frequency freq_GHz at the position of the cell (B = B_0 R_0/R) when it is given, else the one whose resonance curve has its lower
 * tip at u∥ = u_e (y = √(1 + u_e²/c²) − |n∥| u_e/c: the resonant electrons are thermal to a few times thermal, as the beam of an antenna aimed at the
 * layer heats).
 */
import { coulombLog } from '../../transport';
import type { ProfileContext, StepConstants } from '../context';
import type { TransportGeometry } from '../geometry1d';
import { gaussianDeposition } from '../sources/deposition';
import type { SourceModel } from '../sources/SourceModel';
import type { ProfileState } from '../state';
import { currentPerPower, eccdSurface, eccdZetaStar, MC2_KEV, type EccdSurface } from './eccd';
import type { CurrentDriveParts } from './nbcd';

/** electron charge [C] and mass [kg] */
const QE = 1.602176634e-19;
const ME = 9.1093837015e-31;

/** The launcher of a shot with its defaults filled in */
export interface ResolvedLauncher {
  harmonic: number;
  nPar: number;
  thetaP: number;
  rho: number;
  width: number;
  freq_GHz: number | undefined;
}

export function resolveLauncher(ctx: Pick<ProfileContext, 'ps'>): ResolvedLauncher {
  const l = ctx.ps.eccd ?? {};
  return {
    harmonic: Math.min(Math.max(Math.round(l.harmonic ?? 2), 1), 3),
    nPar: Math.min(Math.max(l.nPar ?? 0.3, -0.99), 0.99),
    thetaP: ((l.thetaP_deg ?? 0) * Math.PI) / 180,
    rho: l.rho ?? ctx.ps.ecrhRho,
    width: l.width ?? ctx.ps.ecrhWidth,
    freq_GHz: l.freq_GHz,
  };
}

/** y = ℓ ω_c/ω at major radius R of a wave of frequency f [GHz] (B = B_0 R_0/R) */
export function cyclotronRatio(harmonic: number, freq_GHz: number, B0: number, R0: number, R: number): number {
  return (harmonic * ((QE * B0 * R0) / (ME * R))) / (2 * Math.PI * freq_GHz * 1e9);
}

/** y without a frequency: the lower tip of the resonance curve at u∥ = u_e (header) */
export function defaultResonanceY(Te_keV: number, nPar: number): number {
  const ue = Math.sqrt((2 * Math.max(Te_keV, 0.01)) / MC2_KEV);
  return Math.sqrt(1 + ue * ue) - Math.abs(nPar) * ue;
}

export class EccdSource implements SourceModel {
  readonly id = 'eccd';
  private dep: Float64Array | null = null;
  private surf: (EccdSurface | undefined)[] = [];
  private launcher: ResolvedLauncher | null = null;

  constructor(private readonly parts: CurrentDriveParts) {}

  geometryChanged(ctx: ProfileContext, tg: TransportGeometry): void {
    this.launcher = resolveLauncher(ctx);
    this.dep = gaussianDeposition(tg, this.launcher.rho, this.launcher.width);
    this.surf = new Array<EccdSurface | undefined>(ctx.N).fill(undefined);
  }

  private ensure(ctx: ProfileContext): { dep: Float64Array; launcher: ResolvedLauncher } {
    if (!this.dep || !this.launcher) this.geometryChanged(ctx, ctx.tg);
    return { dep: this.dep!, launcher: this.launcher! };
  }

  /** The heating power of the layer replaces that of the Gaussian layer of the RF source (electrons only) */
  prepare(ctx: ProfileContext, _t: number, _st: ProfileState, K: StepConstants): void {
    const { dep } = this.ensure(ctx);
    const w = ctx.w;
    for (let i = 0; i < ctx.N; i++) w.PecE[i] = K.P_EC * dep[i];
  }

  current(ctx: ProfileContext, st: ProfileState, K: StepConstants): void {
    const jn = this.parts.eccd;
    jn.fill(0);
    if (!(K.P_EC > 0)) return;
    const { dep, launcher } = this.ensure(ctx);
    const g = ctx.tg, w = ctx.w, N = ctx.N;
    let dMax = 0;
    for (let i = 0; i < N; i++) dMax = Math.max(dMax, dep[i]);
    const direction = launcher.nPar >= 0 ? 1 : -1;
    const nAbs = Math.abs(launcher.nPar);
    for (let i = 0; i < N; i++) {
      if (!(dep[i] > 1e-3 * dMax)) continue;
      const Te = Math.max(st.Te[i], 0.05), ne = st.ne[i];
      const eps = g.epsC[i];
      const surf = (this.surf[i] ??= eccdSurface(eps));
      const y = launcher.freq_GHz !== undefined
        ? cyclotronRatio(launcher.harmonic, launcher.freq_GHz, g.B0, g.R0, g.RgeoC[i] * (1 + eps * Math.cos(launcher.thetaP)))
        : defaultResonanceY(Te, nAbs);
      const zeta = eccdZetaStar({
        Te_keV: Te, Zeff: Math.max(w.Zeff[i], 1), nPar: nAbs, harmonic: launcher.harmonic, y, eps: surf.a.eps, thetaP: launcher.thetaP, lnLambda: coulombLog(ne, Te),
      }, surf);
      const jPar = currentPerPower(zeta, Te, ne) * K.P_EC * dep[i];
      // ⟨j·B⟩ = ⟨j∥⟩ ⟨B²⟩/⟨B⟩ with ⟨B⟩ = ⟨h⟩ B_max and ⟨B²⟩ = ⟨h²⟩ B_max² of the model equilibrium
      jn[i] = direction * jPar * (Math.sqrt(g.B2C[i] * surf.a.h2) / surf.a.h1);
    }
    for (let i = 0; i < N; i++) w.jcdB[i] += jn[i];
  }
}
