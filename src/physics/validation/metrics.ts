/**
 * Quantities the literature checks in {@link ./references} compare with: where a metric path reads
 * its value from a finished run, and the few derived metrics that need more than one output.
 *
 * Metric paths:
 *   flatTop.<key>      flat-top average of a history diagnostic (analysis/flatTop.ts: last 30 % of the
 *                      frames, finite samples only)
 *   report.<key>       a numeric ShotReport scalar (Q_sci_max, E_fusion_MJ, neutronYield, Tmax_keV, …)
 *   engineering.<key>  a numeric entry of ShotReport.engineering
 *   burn.<key>         fusion-power-weighted ("burn-averaged") mean of a diagnostic over the whole run,
 *                      the quantity neutron time-of-flight ion temperatures measure in pulsed experiments
 *   derived.H98y2      τ_E(flat top) / τ_IPB98(y,2), with the scaling evaluated independently of the
 *                      physics code at the flat-top density and heating power (see {@link tauIPB98y2Ref})
 *   derived.Ttot       T_e + T_i (flat top), the "total temperature" quoted for FRC plasmas
 *   derived.alphaShare P_alpha / P_fus (flat top): the share of the fusion power that heats the plasma as charged
 *                      products (0.2 in a D-T plasma whose alphas are all deposited; 0D presets only)
 *   derived.HISS04     τ_E(flat top) / τ_ISS04 of a stellarator, the scaling evaluated independently of the physics
 *                      code at the flat-top line-averaged density and heating power (renormalisation f_ren = 1; see
 *                      {@link tauISS04Ref}); the quantity W7-X papers quote as τ_E/τ_ISS04
 *
 * A metric that is unavailable (missing key, non-numeric entry, preset without the inputs a derived
 * metric needs) reads as NaN, which the evaluation reports as a failure.
 */
import type { HistoryFrame, MagneticConfig, ReactorConfig, ShotReport } from '../types';

export type DerivedMetric = 'H98y2' | 'Ttot' | 'alphaShare' | 'HISS04';
/** every derived metric, for validating metric paths read from a file */
export const DERIVED_METRICS: readonly DerivedMetric[] = ['H98y2', 'Ttot', 'alphaShare', 'HISS04'];
/** the scopes a metric path can start with */
export const METRIC_SCOPES = ['flatTop', 'report', 'engineering', 'burn', 'derived'] as const;

/** ShotReport keys whose value is a number */
export type NumericReportKey = { [K in keyof ShotReport]-?: ShotReport[K] extends number ? K : never }[keyof ShotReport];

export type MetricPath =
  | `flatTop.${string}`
  | `report.${NumericReportKey}`
  | `engineering.${string}`
  | `burn.${string}`
  | `derived.${DerivedMetric}`;

/** What a finished preset run provides to the checks. */
export interface RunOutputs {
  report: ShotReport;
  /** flat-top averages (RunResult.avg) */
  flatTop: Record<string, number>;
  /** burn-weighted averages (RunResult.burn); optional for runs recorded before it existed */
  burn?: Record<string, number>;
  cfg: ReactorConfig;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN);

/** Reads a metric from a run; NaN if it is not available. */
export function readMetric(path: MetricPath, run: RunOutputs): number {
  const dot = path.indexOf('.');
  const scope = path.slice(0, dot);
  const key = path.slice(dot + 1);
  switch (scope) {
    case 'flatTop': return num(run.flatTop[key]);
    case 'report': return num((run.report as unknown as Record<string, unknown>)[key]);
    case 'engineering': return num(run.report.engineering?.[key]);
    case 'burn': return num(run.burn?.[key]);
    case 'derived': return derived(key as DerivedMetric, run);
    default: return NaN;
  }
}

function derived(name: DerivedMetric, run: RunOutputs): number {
  switch (name) {
    case 'Ttot': return num(run.flatTop.Te) + num(run.flatTop.Ti);
    case 'H98y2': return h98FromRun(run);
    case 'alphaShare': return alphaShareFromRun(run);
    case 'HISS04': return hISS04FromRun(run);
  }
}

/** P_alpha / P_fus of the flat top; NaN without fusion power or without the diagnostics (1.5D runs have no P_alpha). */
export function alphaShareFromRun(run: RunOutputs): number {
  const P_alpha = num(run.flatTop.P_alpha), P_fus = num(run.flatTop.P_fus);
  return P_fus > 0 ? P_alpha / P_fus : NaN;
}

/** Engineering and plasma parameters of the IPB98(y,2) scaling. */
export interface Ipb98Inputs {
  /** plasma current [MA] */
  Ip_MA: number;
  /** toroidal field at R [T] */
  B_T: number;
  /** line-averaged electron density [10¹⁹ m⁻³] */
  n19: number;
  /** loss power P_L = P_heat − dW/dt [MW] (radiation not subtracted) */
  P_MW: number;
  /** major and minor radius [m] */
  R_m: number;
  a_m: number;
  /** areal elongation κ_a */
  kappa: number;
  /** average ion mass [amu] */
  M: number;
}

/**
 * Thermal energy confinement time of the IPB98(y,2) ELMy H-mode scaling [s]:
 *   τ = 0.0562 · I^0.93 · B^0.15 · n19^0.41 · P^−0.69 · R^1.97 · κ_a^0.78 · ε^0.58 · M^0.19
 * ITER Physics Expert Group on Confinement and Transport et al., "Chapter 2: Plasma confinement and
 * transport", Nucl. Fusion 39 (1999) 2175, eq. (20), doi:10.1088/0029-5515/39/12/302. Its fit to the
 * ITERH.DB3 ELMy H-mode data has an RMS error of 0.145 in ln τ.
 * Deliberately independent of the physics code (transport.ts), so that it can serve as a benchmark.
 */
export function tauIPB98y2Ref(p: Ipb98Inputs): number {
  const eps = p.a_m / p.R_m;
  return 0.0562 * p.Ip_MA ** 0.93 * p.B_T ** 0.15 * p.n19 ** 0.41 * p.P_MW ** -0.69 *
    p.R_m ** 1.97 * p.kappa ** 0.78 * eps ** 0.58 * p.M ** 0.19;
}

/** Hydrogenic ion mass for the IPB98(y,2) M: D → 2, D-T → 2 + fraction of T; undefined for other fuels. */
function hydrogenicMass(c: MagneticConfig): number | undefined {
  if (c.fuel === 'DD') return 2;
  if (c.fuel === 'DT') return 2 * c.fuelFracA + 3 * (1 - c.fuelFracA);
  return undefined;
}

/**
 * H98 = τ_E / τ_IPB98(y,2) over the flat top of a tokamak run. Inputs: the preset's I_p, B, R, a and
 * κ (as κ_a); the flat-top line-averaged density `nbar` (the 0D and the 1.5D model both report it; the
 * volume average `ne` is the fallback for a run without it); the flat-top heating power P_heat as the loss
 * power, since dW/dt ≈ 0 on the flat top and IPB98(y,2) does not subtract radiation (the model itself
 * subtracts the core radiation, so its H98 reads above its input H98 by that share).
 */
export function h98FromRun(run: RunOutputs): number {
  const c = run.cfg as MagneticConfig;
  if (c.method !== 'tokamak' && c.method !== 'spherical_tokamak') return NaN;
  const M = hydrogenicMass(c);
  if (M === undefined) return NaN;
  const f = run.flatTop;
  const n20 = Number.isFinite(f.nbar) ? f.nbar : f.ne;
  const tau = tauIPB98y2Ref({
    Ip_MA: c.Ip_MA, B_T: c.B0, n19: 10 * n20, P_MW: f.P_heat,
    R_m: c.geometry.R, a_m: c.geometry.a, kappa: c.geometry.kappa, M,
  });
  return f.tauE / tau;
}

/** Engineering and configuration parameters of the ISS04 scaling. */
export interface Iss04Inputs {
  /** minor and major radius [m] */
  a_m: number;
  R_m: number;
  /** toroidal field on axis [T] */
  B_T: number;
  /** rotational transform at 2/3 of the minor radius */
  iota23: number;
  /** heating power [MW] */
  P_MW: number;
  /** line-averaged electron density [10¹⁹ m⁻³] */
  n19: number;
}

/**
 * Energy confinement time of the International Stellarator Confinement Scaling ISS04 [s], without the configuration
 * renormalisation (f_ren = 1):
 *   τ = 0.134 · a^2.28 · R^0.64 · P^−0.61 · n̄^0.54 · B^0.84 · ι_{2/3}^0.41
 * H. Yamada et al., Nucl. Fusion 45 (2005) 1684, doi:10.1088/0029-5515/45/12/024. The primary paper was not read: the
 * prefactor and the exponents are those printed in eq. (1) of F. Warmer et al., "Limits of confinement enhancement for
 * stellarators" (EUROfusion preprint WPS2-PR(15)02, who quote the scaling with a renormalisation factor f_ren in front), and the exponents
 * agree with the other secondary quotations found (a^2.28 R^0.64 P^−0.61 n^0.54 B^0.84 ι^0.41).
 * Deliberately independent of the physics code (transport.ts), so that it can serve as a benchmark.
 */
export function tauISS04Ref(p: Iss04Inputs): number {
  return 0.134 * p.a_m ** 2.28 * p.R_m ** 0.64 * p.P_MW ** -0.61 * p.n19 ** 0.54 * p.B_T ** 0.84 * p.iota23 ** 0.41;
}

/**
 * τ_E / τ_ISS04 over the flat top of a stellarator run: the preset's a, R, B and ι_{2/3}, the flat-top line-averaged density
 * (`nbar`; the volume average `ne` as the fallback) and heating power P_heat. NaN for any other method. The 0D model sets
 * τ_E = H_ISS04 · τ_ISS04 with the preset's renormalisation H_ISS04 (f_ren · H98 unless given), at the loss power it computes
 * (P_heat − core radiation − dW/dt) and its own density, so this value is that input moved by the model's loss power and
 * density: it tests the preset's confinement renormalisation against experiment, not a transport model.
 */
export function hISS04FromRun(run: RunOutputs): number {
  const c = run.cfg as MagneticConfig;
  if (c.method !== 'stellarator') return NaN;
  const f = run.flatTop;
  const n20 = Number.isFinite(f.nbar) ? f.nbar : f.ne;
  const tau = tauISS04Ref({
    a_m: c.geometry.a, R_m: c.geometry.R, B_T: c.B0, iota23: c.stellarator.iota23, P_MW: f.P_heat, n19: 10 * n20,
  });
  return f.tauE / tau;
}

/**
 * Fusion-power-weighted means of diagnostics over a whole run: Σ x·P_fus·Δt / Σ P_fus·Δt, with the
 * frame weights Δt_i = (t_{i+1} − t_{i−1})/2 (half intervals at the ends). NaN for a key when no fusion
 * power was produced or the key is missing; non-finite samples are skipped.
 */
export function burnAverages(hist: readonly Pick<HistoryFrame, 't' | 'd'>[], keys: readonly string[] = ['Ti', 'Te']): Record<string, number> {
  const out: Record<string, number> = {};
  const n = hist.length;
  for (const k of keys) {
    let sw = 0, sx = 0;
    for (let i = 0; i < n; i++) {
      const dt = 0.5 * (hist[Math.min(i + 1, n - 1)].t - hist[Math.max(i - 1, 0)].t);
      const w = (hist[i].d.P_fus ?? 0) * dt;
      const x = hist[i].d[k];
      if (!(w > 0) || !Number.isFinite(x)) continue;
      sw += w; sx += w * x;
    }
    out[k] = sw > 0 ? sx / sw : NaN;
  }
  return out;
}
