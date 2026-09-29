/**
 * Tritium breeding ratio (TBR) as a function of the 6Li enrichment and the blanket thickness (systems-lite, lane ws7b).
 *
 * The fit used is the published surface fit of J. Shimwell, M. Kovari, S. Lilley, S. Zheng, L.W.G. Morgan, L.W. Packer,
 * J. McMillan, "A parameter study of time-varying tritium production in solid-type breeder blankets", Fusion Eng. Des. 104
 * (2016) 34-39, eq. (2) with the coefficients of its Table 3 (time-averaged TBR over 5 years of operation, 198 breeder
 * compositions per blanket thickness; MCNP6 coupled to FISPACT-II through FATI, EU DEMO HCPB model of the PPPT programme,
 * 2.4 GW, 70 % availability). PROCESS uses these fits for its HCPB blanket. The function is
 *
 *   TBR(x, y) = v1 + v2 x + v3 y + v4 y x + v5 x^2 + v6 y^2 + v7 x^2 y + v8 x y^2 + v9 x^2 y^2 + v10 x^3 + v11 y^3
 *             + v12 y x^3 + v13 y^2 x^3 + v14 x y^3 + v15 y^3 x^2 + v16 y^3 x^3 + v17 ln x + v18 ln y + v19 ln x ln y
 *
 * with x = Li4SiO4 / (Li4SiO4 + Be12Ti) volume fraction (0.06 to 1) and y = 6Li atom fraction of the lithium (0.1 to 1),
 * for three blanket thicknesses (its Table 1: maximum inboard / outboard depth 0.53 / 0.91 m thin, 0.64 / 1.11 m medium,
 * 0.75 / 1.30 m thick). The fixed volume fractions of the homogenised breeder zone are Eurofer 9.705 %, He coolant
 * 5.295 %, breeder pebbles 53.55 % (packing factor 0.63) and He purge gas 31.45 %.
 *
 * What the model adds (APPROXIMATION, flagged where used):
 *  - the thickness is interpolated linearly between the three fitted classes, in the mean of the inboard and outboard depth
 *    (0.72, 0.875, 1.025 m); above the thick class the TBR is saturated; below the thin class the TBR of the thin surface is
 *    scaled by 1 - exp(-s / lambda), lambda = 0.177 m, fitted here to the maximum TBR of Table 4 of the paper (1.247, 1.261,
 *    1.264: the thickness dependence is weak, "the additional tritium production in the rear of the blanket is marginal");
 *  - the breeder fraction defaults to the tritium-optimal one for the enrichment (the paper's fig. 7: about 0.3 at 60 % 6Li);
 *  - the model has no penetrations ("overestimates global TBR"), so the TBR is scaled with the blanket coverage relative to
 *    the coverage of the model, 0.9 (the earlier convention of this code), and the paper recommends a design target of 1.15;
 *  - the other blanket types keep the earlier reference TBR of this code (EU DEMO neutronics, Fischer et al. 2016 range
 *    HCLL 1.14-1.20, WCLL 1.15, DCLL 1.20, FLiBe 1.1-1.3) at the reference enrichment and the thick blanket, and take the
 *    relative dependence on enrichment and thickness from the HCPB fit (a liquid-metal blanket differs in detail).
 */
import type { BlanketType } from '../types';

/** v1..v19 of Table 3 of Shimwell et al. (2016), time-averaged TBR */
const V_THICK = [
  1.95893103797, -0.809792727863, 0.016958778333, -0.120230857418, 0.461211316443, -0.0478789050674, -2.1978304461,
  -1.38785787744, 4.93883798388, -0.223668963335, 0.0178181886132, 1.42583418972, -2.80720698559, 0.814691647096,
  -2.48568193656, 1.37932384899, 0.253355839249, 0.190845918447, -0.0257699008284,
];
const V_MEDIUM = [
  1.96122608615, -0.860855681012, 0.0193393390622, 0.279977226537, 0.659918133027, 0.013070435947, -3.48450356973,
  -2.3360647329, 7.38314099334, -0.365511595682, -0.0181287662329, 2.30397890094, -4.37481611533, 1.30804004777,
  -3.71450110227, 2.1588023402, 0.263823845354, 0.198976219881, -0.0192924115968,
];
const V_THIN = [
  1.93920586301, -0.948494854004, -0.0186700302911, 0.483417432982, 0.785901227724, -0.0120169189644, -3.45723121388,
  -2.05212472576, 6.45375263346, -0.436421277881, 0.0129809166177, 2.26116309299, -3.87538808736, 1.05778783291,
  -3.12644013943, 1.86242247177, 0.253324925437, 0.18795823903, -0.0256707269253,
];

/** mean of the inboard and outboard maximum blanket depth of the three fitted classes [m] (Table 1 of the paper) */
export const SHIMWELL_DEPTH = { thin: 0.72, medium: 0.875, thick: 1.025 } as const;
/** ratio of the outboard to the inboard depth of the fitted classes: 0.91 / 0.53, 1.11 / 0.64, 1.30 / 0.75 */
export const SHIMWELL_OUT_IN = 1.73;
/** saturation depth [m] of the thickness dependence, fitted to the maximum TBR of Table 4 of the paper */
export const TBR_DEPTH_LAMBDA = 0.177;
/** blanket coverage of the fitted model, used to scale the TBR to the coverage of a design */
export const TBR_COVERAGE_REF = 0.9;
/** valid range of the fit */
export const SHIMWELL_RANGE = { x: [0.06, 1], y: [0.1, 1] } as const;

/** eq. (2) of the paper for the coefficient vector v of one thickness class */
export function shimwellSurface(v: readonly number[], x: number, y: number): number {
  const lx = Math.log(x), ly = Math.log(y);
  const x2 = x * x, x3 = x2 * x, y2 = y * y, y3 = y2 * y;
  return v[0] + v[1] * x + v[2] * y + v[3] * y * x + v[4] * x2 + v[5] * y2 + v[6] * x2 * y + v[7] * x * y2 + v[8] * x2 * y2
    + v[9] * x3 + v[10] * y3 + v[11] * y * x3 + v[12] * y2 * x3 + v[13] * x * y3 + v[14] * y3 * x2 + v[15] * y3 * x3
    + v[16] * lx + v[17] * ly + v[18] * lx * ly;
}

/** the fitted time-averaged TBR of a class ('thin' | 'medium' | 'thick') at breeder fraction x and 6Li fraction y (clamped to the fitted range) */
export function shimwellTBR(cls: 'thin' | 'medium' | 'thick', x: number, y: number): number {
  const v = cls === 'thin' ? V_THIN : cls === 'medium' ? V_MEDIUM : V_THICK;
  return shimwellSurface(v, clamp(x, SHIMWELL_RANGE.x[0], SHIMWELL_RANGE.x[1]), clamp(y, SHIMWELL_RANGE.y[0], SHIMWELL_RANGE.y[1]));
}

/** the tritium-optimal breeder fraction for an enrichment: maximum of the thick-blanket fit over x (golden-section search) */
export function optimalBreederFraction(li6: number): number {
  const y = clamp(li6, SHIMWELL_RANGE.y[0], SHIMWELL_RANGE.y[1]);
  const f = (x: number) => shimwellSurface(V_THICK, x, y);
  // the surface is unimodal in x on [0.06, 1] for y in [0.1, 1]: golden-section search, then a coarse guard against the end points
  const g = 0.5 * (Math.sqrt(5) - 1);
  let a: number = SHIMWELL_RANGE.x[0], b: number = SHIMWELL_RANGE.x[1];
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < 60; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return 0.5 * (a + b);
}

/**
 * TBR of an HCPB blanket without penetrations at the given 6Li fraction, breeder fraction (default: the tritium-optimal
 * one) and mean blanket depth s = (inboard + outboard depth) / 2 [m]. `inRange` is false outside the depth range of the fit.
 */
export function tbrHCPB(li6: number, meanDepth_m: number, breederFraction?: number): number {
  const x = breederFraction ?? optimalBreederFraction(li6);
  const s = Math.max(meanDepth_m, 1e-3);
  const T = (cls: 'thin' | 'medium' | 'thick') => shimwellTBR(cls, x, li6);
  if (s >= SHIMWELL_DEPTH.thick) return T('thick');
  if (s >= SHIMWELL_DEPTH.medium) {
    const w = (s - SHIMWELL_DEPTH.medium) / (SHIMWELL_DEPTH.thick - SHIMWELL_DEPTH.medium);
    return (1 - w) * T('medium') + w * T('thick');
  }
  if (s >= SHIMWELL_DEPTH.thin) {
    const w = (s - SHIMWELL_DEPTH.thin) / (SHIMWELL_DEPTH.medium - SHIMWELL_DEPTH.thin);
    return (1 - w) * T('thin') + w * T('medium');
  }
  const g = (d: number) => 1 - Math.exp(-d / TBR_DEPTH_LAMBDA);
  return T('thin') * (g(s) / g(SHIMWELL_DEPTH.thin));
}

/** true if the depth is inside the fitted range (0.72 to 1.025 m mean depth) */
export function depthInFittedRange(meanDepth_m: number): boolean {
  return meanDepth_m >= SHIMWELL_DEPTH.thin && meanDepth_m <= SHIMWELL_DEPTH.thick;
}

/** reference TBR (full blanket) and 6Li enrichment of the non-HCPB blanket types, kept from the earlier table of this code */
const TYPE_REF: Record<Exclude<BlanketType, 'none' | 'HCPB'>, { tbr: number; enrich: number }> = {
  HCLL: { tbr: 1.18, enrich: 0.9 }, WCLL: { tbr: 1.15, enrich: 0.9 }, DCLL: { tbr: 1.2, enrich: 0.9 }, FLiBe: { tbr: 1.2, enrich: 0.9 },
};

export interface TBROptions {
  /** mean of the inboard and outboard blanket depth [m]; default: the thick fitted class (EU DEMO-like) */
  meanDepth_m?: number;
  /** HCPB breeder fraction Li4SiO4 / (Li4SiO4 + Be12Ti); default tritium-optimal */
  breederFraction?: number;
}

/** Full-coverage, penetration-free TBR of a blanket type (0 for 'none'). */
export function tbrUnpenetrated(type: BlanketType, li6: number, opts: TBROptions = {}): number {
  if (type === 'none') return 0;
  const s = opts.meanDepth_m ?? SHIMWELL_DEPTH.thick;
  const hcpb = tbrHCPB(li6, s, opts.breederFraction);
  if (type === 'HCPB') return hcpb;
  const ref = TYPE_REF[type];
  return ref.tbr * (hcpb / tbrHCPB(ref.enrich, SHIMWELL_DEPTH.thick));
}

/**
 * Tritium breeding ratio of a reactor: the penetration-free TBR of the blanket type at the 6Li enrichment and blanket depth,
 * scaled with the blanket coverage (linear, relative to the coverage of the fitted model). The earlier signature
 * (type, li6, coverage) is kept: without a depth the thick (EU DEMO-like) blanket is meant.
 */
export function tritiumBreedingRatio(type: BlanketType, li6: number, coverage: number, opts: TBROptions = {}): number {
  if (type === 'none') return 0;
  return tbrUnpenetrated(type, li6, opts) * (coverage / TBR_COVERAGE_REF);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
