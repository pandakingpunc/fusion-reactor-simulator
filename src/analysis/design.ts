/**
 * Design optimisation on the steady-state power balance: choose the machine size, field, current, density and temperature that
 * minimise a figure of merit (major radius, plasma volume, auxiliary power) or maximise fusion power or gain, subject to the
 * usual systems-code limits, with the steady-state evaluator of steadyState.ts (the POPCON fixed point) inside and the
 * augmented Lagrangian / Nelder-Mead solver of optim/ outside. In the spirit of, and far simpler than, PROCESS (M. Kovari et
 * al., Fusion Eng. Des. 89 (2014) 3054; 104 (2016) 9): a handful of variables, 0D physics, no cost model.
 *
 * Variables (each with bounds, by default relative to the preset): R, a [m], B0 [T], Ip [MA], fG = n_bar / n_Greenwald
 * (the line-averaged density as a fraction of the Greenwald density of the design, Greenwald 1988), T [keV] (volume-averaged,
 * T_i = T_e), and optionally H98 and kappa. Everything else (fuel, impurities, profile shapes, triangularity, magnet
 * technology and gaps) stays as in the preset; the volume-averaged density follows from fG.
 *
 * Constraints (normalised so that g <= 0 is feasible; `limit` values default to the preset's own limits):
 *   Q >= qMin                      steady-state gain (capped at 1000 where the alpha heating alone exceeds the losses)
 *   beta_N <= betaNMax             Troyon limit (preset limits.betaN_limit)
 *   q95 >= q95Min                  kink safety factor (default max(3, preset limits.q95_limit))
 *   P_L >= lhMargin P_LH           H-mode access, Martin 2008 + Ryter 2014 (the confinement model is H-mode everywhere)
 *   P_aux <= pauxMaxMW             installed auxiliary power (default: the preset's total)
 *   B_coil <= B_max(technology)    TF coil peak field and hoop stress of engineering.ts checkMagnet
 *   A = R/a within [aspectMin, aspectMax]   (default 0.6 to 1.6 times the preset's)
 *   P_fus >= pfusMinMW, neutron wall load <= wallLoadMax   (optional)
 * plus the bounds of the variables (fG <= the preset's Greenwald limit).
 *
 * EDUCATIONAL: the optimum is a property of this reduced model and its approximations (no pedestal, T_i = T_e, IPB98(y,2) x H98
 * everywhere, no current-drive or stability physics beyond the listed limits, no cost model); it says where the trade-offs lie,
 * not what to build. Every result carries that caveat.
 *
 * Pure TypeScript, no DOM or Node API.
 */
import { MagneticConfig } from '../physics/types';
import { MagnetCheck, checkMagnet, neutronWallLoad } from '../physics/engineering';
import { greenwaldDensity, lineAverageFactor } from '../physics/limits';
import { canonicalString } from '../physics/kernel/canonical';
import { sha256Hex } from '../physics/kernel/sha256';
import { AugLagOptions, augmentedLagrangian } from './optim/augLag';
import { cmaes } from './optim/cmaes';
import { hypervolume2D, nsga2 } from './optim/nsga2';
import { SteadyState, steadyState } from './steadyState';

export const OPTIMIZATION_CAVEAT =
  'EDUCATIONAL: the optimum is a property of a reduced-order steady-state model (0D power balance at the POPCON fixed point, T_i = T_e, ' +
  'IPB98(y,2) x H98 confinement everywhere, no cost model, only the listed limits). It shows where the trade-offs lie in the model; it is not a design of a real device.';

export type DesignVarName = 'R' | 'a' | 'B0' | 'Ip' | 'fG' | 'T' | 'H98' | 'kappa';
export const DESIGN_VARS: readonly DesignVarName[] = ['R', 'a', 'B0', 'Ip', 'fG', 'T', 'H98', 'kappa'];
export const DEFAULT_VARS: readonly DesignVarName[] = ['R', 'a', 'B0', 'Ip', 'fG', 'T'];

export type DesignObjective = 'major-radius' | 'plasma-volume' | 'aux-power' | 'fusion-power' | 'gain';
export const DESIGN_OBJECTIVES: readonly DesignObjective[] = ['major-radius', 'plasma-volume', 'aux-power', 'fusion-power', 'gain'];

export interface DesignConstraints {
  /** steady-state Q at least this (default 10; null: no gain constraint) */
  qMin?: number | null;
  betaNMax?: number;
  q95Min?: number;
  /** P_L / P_LH at least this (default 1; null: no H-mode access constraint) */
  lhMargin?: number | null;
  /** auxiliary power at most this [MW] (default: the preset's installed power; null: none) */
  pauxMaxMW?: number | null;
  /** keep the TF coil below its peak field and stress limits (default true) */
  coil?: boolean;
  aspectMin?: number;
  aspectMax?: number;
  pfusMinMW?: number;
  wallLoadMax?: number;
}

/** inner solver of the augmented Lagrangian: the simplex search (default) or CMA-ES (for a rugged or badly scaled problem) */
export type DesignMethod = 'nelder-mead' | 'cma-es';

export interface DesignSpec {
  base: MagneticConfig;
  method?: DesignMethod;
  objective: DesignObjective;
  variables?: readonly DesignVarName[];
  bounds?: Partial<Record<DesignVarName, [number, number]>>;
  constraints?: DesignConstraints;
  /** starting temperatures [keV] of the multi-start (default 6, 10, 16, 25): the Q(T) curve of a POPCON has more than one maximum */
  startTemperatures?: readonly number[];
  solver?: AugLagOptions;
}

/** the machine described by a design vector, with its steady state */
export interface DesignPoint {
  cfg: MagneticConfig;
  state: SteadyState;
  /** volume-averaged density [m^-3] */
  n: number;
  /** TF coil peak field and hoop stress against the limits of the magnet technology */
  magnet: MagnetCheck;
  aspect: number;
  wallLoad: number;
}

export type DesignValues = Record<DesignVarName, number>;

/** the values of all design variables that the preset itself has (T and fG are not properties of a preset: 12 keV and 0.85) */
export function presetDesign(base: MagneticConfig): DesignValues {
  return {
    R: base.geometry.R, a: base.geometry.a, B0: base.B0, Ip: base.Ip_MA, fG: Math.min(0.85, base.limits.greenwald_limit), T: 12,
    H98: base.H98, kappa: base.geometry.kappa,
  };
}

/** The machine and its steady state for a full set of design values. */
export function designPoint(base: MagneticConfig, v: DesignValues): DesignPoint {
  const cfg: MagneticConfig = { ...base, geometry: { ...base.geometry, R: v.R, a: v.a, kappa: v.kappa }, B0: v.B0, Ip_MA: v.Ip, H98: v.H98 };
  // volume-averaged density from the line-averaged Greenwald fraction: n_bar = f_line <n_e> = fG n_G
  const n = (v.fG * greenwaldDensity(v.Ip, v.a)) / lineAverageFactor(cfg.transport.alpha_n);
  const state = steadyState(cfg, n, v.T);
  const magnet = checkMagnet(cfg.geometry, cfg.B0, cfg.magnet.tech, cfg.magnet.gap_m, cfg.magnet.coilThickness_m);
  return {
    cfg, state, n, magnet, aspect: v.R / v.a,
    wallLoad: neutronWallLoad(cfg.geometry, state.Pfus - state.Pchar, 1).load_MWm2,
  };
}

export interface ResolvedConstraints {
  qMin: number | null;
  betaNMax: number;
  q95Min: number;
  lhMargin: number | null;
  pauxMaxMW: number | null;
  coil: boolean;
  aspectMin: number;
  aspectMax: number;
  pfusMinMW: number | null;
  wallLoadMax: number | null;
}

export function resolveConstraints(base: MagneticConfig, c: DesignConstraints = {}): ResolvedConstraints {
  const A0 = base.geometry.R / base.geometry.a;
  const installed = base.heating.P_NBI_MW + base.heating.P_ICRH_MW + base.heating.P_ECRH_MW;
  return {
    qMin: c.qMin === undefined ? 10 : c.qMin,
    betaNMax: c.betaNMax ?? base.limits.betaN_limit,
    q95Min: c.q95Min ?? Math.max(3, base.limits.q95_limit),
    lhMargin: c.lhMargin === undefined ? 1 : c.lhMargin,
    pauxMaxMW: c.pauxMaxMW === undefined ? (installed > 0 ? installed : null) : c.pauxMaxMW,
    coil: c.coil ?? true,
    aspectMin: c.aspectMin ?? 0.6 * A0,
    aspectMax: c.aspectMax ?? 1.6 * A0,
    pfusMinMW: c.pfusMinMW ?? null,
    wallLoadMax: c.wallLoadMax ?? null,
  };
}

export interface ConstraintValue {
  id: string;
  label: string;
  /** normalised violation: <= 0 satisfied, 0 = exactly at the limit */
  g: number;
  /** the constrained quantity and its limit, in the units of the label */
  value: number;
  limit: number;
}

const QCAP = 1000;

/** All constraint values of a design point (only the enabled ones). */
export function constraintValues(pt: DesignPoint, c: ResolvedConstraints): ConstraintValue[] {
  const s = pt.state;
  const out: ConstraintValue[] = [];
  const ge = (id: string, label: string, value: number, limit: number) => out.push({ id, label, g: 1 - value / limit, value, limit });
  const le = (id: string, label: string, value: number, limit: number) => out.push({ id, label, g: value / limit - 1, value, limit });
  if (c.qMin !== null) ge('Q', 'steady-state Q >= ', Math.min(s.Q, QCAP), c.qMin);
  le('betaN', 'beta_N <= ', s.betaN, c.betaNMax);
  ge('q95', 'q95 >= ', s.q95, c.q95Min);
  if (c.lhMargin !== null) ge('PL/PLH', 'P_L / P_LH >= ', s.PL / s.PLH, c.lhMargin);
  if (c.pauxMaxMW !== null) le('Paux', 'P_aux [MW] <= ', s.Paux / 1e6, c.pauxMaxMW);
  if (c.coil) {
    le('Bcoil', 'B_coil [T] <= ', pt.magnet.B_coil, pt.magnet.B_max);
    le('stress', 'coil stress [MPa] <= ', pt.magnet.stress_MPa, pt.magnet.stress_limit);
  }
  ge('aspect>=', 'aspect ratio R/a >= ', pt.aspect, c.aspectMin);
  le('aspect<=', 'aspect ratio R/a <= ', pt.aspect, c.aspectMax);
  if (c.pfusMinMW !== null) ge('Pfus', 'P_fus [MW] >= ', s.Pfus / 1e6, c.pfusMinMW);
  if (c.wallLoadMax !== null) le('wall', 'neutron wall load [MW/m2] <= ', pt.wallLoad, c.wallLoadMax);
  return out;
}

/** The objective, scaled to be of order one at the preset. */
export function objectiveValue(objective: DesignObjective, pt: DesignPoint, ref: DesignPoint): number {
  const s = pt.state;
  switch (objective) {
    case 'major-radius': return pt.cfg.geometry.R / ref.cfg.geometry.R;
    case 'plasma-volume': return s.V / ref.state.V;
    case 'aux-power': return Math.max(s.Paux, 0) / 1e6 / Math.max(ref.cfg.heating.P_NBI_MW + ref.cfg.heating.P_ICRH_MW + ref.cfg.heating.P_ECRH_MW, 1);
    case 'fusion-power': return -s.Pfus / 5e8;
    case 'gain': return -Math.min(s.Q, QCAP) / 10;
  }
}

/** the objective in its natural unit, for reports */
export function objectiveNatural(objective: DesignObjective, pt: DesignPoint): { value: number; unit: string; label: string } {
  const s = pt.state;
  switch (objective) {
    case 'major-radius': return { value: pt.cfg.geometry.R, unit: 'm', label: 'major radius R' };
    case 'plasma-volume': return { value: s.V, unit: 'm^3', label: 'plasma volume' };
    case 'aux-power': return { value: Math.max(s.Paux, 0) / 1e6, unit: 'MW', label: 'auxiliary power (0 when ignited)' };
    case 'fusion-power': return { value: s.Pfus / 1e6, unit: 'MW', label: 'fusion power' };
    case 'gain': return { value: s.Q, unit: '', label: 'steady-state Q' };
  }
}

export interface DesignVariableResult {
  name: DesignVarName;
  value: number;
  lo: number;
  hi: number;
  preset: number;
  atBound: 'lower' | 'upper' | null;
}

export interface DesignConstraintResult extends ConstraintValue {
  satisfied: boolean;
  /** within 0.1 % of its limit */
  active: boolean;
  /** Lagrange multiplier estimate of the solver (>= 0 for an active inequality) */
  multiplier: number;
}

export interface DesignResult {
  caveat: string;
  objective: { name: DesignObjective; label: string; value: number; unit: string; preset: number };
  variables: DesignVariableResult[];
  constraints: DesignConstraintResult[];
  /** steady-state quantities at the optimum */
  optimum: {
    Q: number; Paux_MW: number; Pfus_MW: number; betaN: number; nOverNG: number; q95: number; PLoverPLH: number; tauE_s: number; T_keV: number;
    n_vol_m3: number; fHe: number; V_m3: number; B_coil_T: number; aspect: number; wallLoad_MWm2: number;
  };
  feasible: boolean;
  solver: { method: string; starts: number; bestStart: number; converged: boolean; reason: string; evals: number; outer: number; violation: number };
}

function boundsFor(base: MagneticConfig, name: DesignVarName, o?: Partial<Record<DesignVarName, [number, number]>>): [number, number] {
  if (o?.[name]) return o[name]!;
  const p = presetDesign(base);
  switch (name) {
    case 'R': case 'a': case 'B0': case 'Ip': return [0.6 * p[name], 1.5 * p[name]];
    case 'fG': return [0.1, base.limits.greenwald_limit];
    case 'T': return [2, 40];
    case 'H98': return [0.8, 1.5];
    case 'kappa': return [0.8 * p.kappa, 1.2 * p.kappa];
  }
}

/**
 * Solves the design problem. The starts of the multi-start differ in temperature (and in the density fraction); the best feasible
 * result wins, or, when no start reaches feasibility, the least violated one (feasible: false).
 */
export function solveDesign(spec: DesignSpec): DesignResult {
  const { base, objective } = spec;
  if (base.method === 'stellarator') throw new RangeError('the design optimisation covers tokamaks and spherical tokamaks (a stellarator has no q95 or Greenwald limit here)');
  if (!DESIGN_OBJECTIVES.includes(objective)) throw new RangeError(`unknown objective '${String(objective)}' (${DESIGN_OBJECTIVES.join(', ')})`);
  const names = [...(spec.variables ?? DEFAULT_VARS)];
  if (names.length === 0) throw new RangeError('the design needs at least one variable');
  if (new Set(names).size !== names.length) throw new RangeError('a design variable is listed twice');
  for (const nm of names) if (!DESIGN_VARS.includes(nm)) throw new RangeError(`unknown design variable '${String(nm)}' (${DESIGN_VARS.join(', ')})`);
  const bounds = names.map((nm) => boundsFor(base, nm, spec.bounds));
  bounds.forEach(([lo, hi], i) => { if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError(`bounds of ${names[i]}: need finite lo < hi, got [${lo}, ${hi}]`); });
  const cons = resolveConstraints(base, spec.constraints);
  const preset = presetDesign(base);
  const ref = designPoint(base, preset);
  const full = (u: readonly number[]): DesignValues => {
    const v = { ...preset };
    names.forEach((nm, i) => { v[nm] = bounds[i][0] + u[i] * (bounds[i][1] - bounds[i][0]); });
    return v;
  };
  const toUnit = (v: DesignValues) => names.map((nm, i) => Math.min(Math.max((v[nm] - bounds[i][0]) / (bounds[i][1] - bounds[i][0]), 0), 1));
  const nCons = constraintValues(ref, cons).length;
  const problem = {
    n: names.length,
    f: (u: number[]) => objectiveValue(objective, designPoint(base, full(u)), ref),
    ineq: (u: number[]) => {
      const cv = constraintValues(designPoint(base, full(u)), cons).map((c) => c.g);
      return cv.length === nCons ? cv : new Array(nCons).fill(1e6);
    },
    lower: names.map(() => 0), upper: names.map(() => 1),
  };
  const temps = spec.startTemperatures ?? [6, 10, 16, 25];
  let best: { r: ReturnType<typeof augmentedLagrangian>; start: number } | null = null;
  let evals = 0;
  temps.forEach((T0, s) => {
    const start = toUnit({ ...preset, T: T0, fG: Math.min(0.5 + 0.15 * s, base.limits.greenwald_limit) });
    const cma: AugLagOptions = spec.method === 'cma-es'
      ? { minimizer: (f, x0, lower, upper, maxEvals, outer) => cmaes(f, x0, { lower, upper, maxEvals, sigma0: outer === 1 ? 0.25 : 0.05, seed: 1 + s, tolFun: 1e-14, tolX: 1e-10 }) }
      : {};
    const r = augmentedLagrangian(problem, start, { feasTol: 1e-6, ...cma, ...spec.solver });
    evals += r.evals;
    const better = !best
      || (r.feasible && !best.r.feasible)
      || (r.feasible === best.r.feasible && (r.feasible ? r.f < best.r.f : r.violation < best.r.violation));
    if (better) best = { r, start: s };
  });
  const { r, start } = best!;
  const v = full(r.x);
  const pt = designPoint(base, v);
  const nat = objectiveNatural(objective, pt), natRef = objectiveNatural(objective, ref);
  const cv = constraintValues(pt, cons);
  const s = pt.state;
  return {
    caveat: OPTIMIZATION_CAVEAT,
    objective: { name: objective, label: nat.label, value: nat.value, unit: nat.unit, preset: natRef.value },
    variables: names.map((nm, i) => ({
      name: nm, value: v[nm], lo: bounds[i][0], hi: bounds[i][1], preset: preset[nm],
      atBound: r.x[i] <= 1e-6 ? 'lower' : r.x[i] >= 1 - 1e-6 ? 'upper' : null,
    })),
    constraints: cv.map((c, k) => ({ ...c, satisfied: c.g <= 1e-6, active: Math.abs(c.g) <= 1e-3, multiplier: r.lambda[k] ?? 0 })),
    optimum: {
      Q: s.Q, Paux_MW: s.Paux / 1e6, Pfus_MW: s.Pfus / 1e6, betaN: s.betaN, nOverNG: s.nOverNG, q95: s.q95, PLoverPLH: s.PL / s.PLH, tauE_s: s.tauE, T_keV: s.T,
      n_vol_m3: pt.n, fHe: s.fHe, V_m3: s.V, B_coil_T: pt.magnet.B_coil,
      aspect: pt.aspect, wallLoad_MWm2: pt.wallLoad,
    },
    feasible: r.feasible,
    solver: { method: `augmented Lagrangian + ${spec.method === 'cma-es' ? 'CMA-ES' : 'Nelder-Mead'}`, starts: temps.length, bestStart: start, converged: r.converged, reason: r.reason, evals, outer: r.outer, violation: r.violation },
  };
}

// ---- report -----------------------------------------------------------------------------------------------------

export interface DesignReport {
  schema: 1;
  tool: 'optimize';
  caveat: string;
  /** SHA-256 of everything that defines the problem: the same problem gives the same hash and, the solver being deterministic, the same result */
  inputHash: string;
  problem: {
    preset?: string;
    objective: DesignObjective;
    variables: DesignVarName[];
    bounds: Record<string, [number, number]>;
    constraints: ResolvedConstraints;
    startTemperatures: number[];
  };
  result: DesignResult;
}

/** SHA-256 of the canonical form of the problem definition. */
export function designHash(spec: DesignSpec): string {
  const names = [...(spec.variables ?? DEFAULT_VARS)];
  return sha256Hex(canonicalString({
    base: spec.base, objective: spec.objective, method: spec.method ?? 'nelder-mead', variables: names, bounds: names.map((n) => boundsFor(spec.base, n, spec.bounds)),
    constraints: resolveConstraints(spec.base, spec.constraints), startTemperatures: spec.startTemperatures ?? [6, 10, 16, 25], solver: spec.solver ?? null,
  }));
}

/** Solves the problem and wraps the result with its definition for a report (JSON of the optimize CLI). */
export function designReport(spec: DesignSpec, presetId?: string): DesignReport {
  const result = solveDesign(spec);
  const names = [...(spec.variables ?? DEFAULT_VARS)];
  return {
    schema: 1, tool: 'optimize', caveat: OPTIMIZATION_CAVEAT, inputHash: designHash(spec),
    problem: {
      ...(presetId ? { preset: presetId } : {}), objective: spec.objective, variables: names,
      bounds: Object.fromEntries(names.map((n) => [n, boundsFor(spec.base, n, spec.bounds)])), constraints: resolveConstraints(spec.base, spec.constraints),
      startTemperatures: [...(spec.startTemperatures ?? [6, 10, 16, 25])],
    },
    result,
  };
}

// ---- Pareto front of two objectives (NSGA-II) ---------------------------------------------------------------------

export interface ParetoSpec extends DesignSpec {
  /** the two objectives, traded off against each other */
  objectives: readonly [DesignObjective, DesignObjective];
  popSize?: number;
  generations?: number;
  seed?: number;
  /** start NSGA-II with the single-objective optima of the two objectives in the population (default true) */
  seedWithOptima?: boolean;
}

export interface ParetoPoint {
  /** the two objectives in their natural units (as in ParetoResult.objectives) */
  objectives: [number, number];
  variables: Record<string, number>;
  /** steady-state quantities of the point */
  Q: number;
  Paux_MW: number;
  Pfus_MW: number;
  betaN: number;
}

export interface ParetoResult {
  caveat: string;
  objectives: { name: DesignObjective; label: string; unit: string; preset: number }[];
  /** the feasible non-dominated designs, sorted by the first objective */
  points: ParetoPoint[];
  feasibleFound: boolean;
  evals: number;
  /** hypervolume of the front in the scaled objectives (the ones NSGA-II minimises), against the reference point 1.1 x the worst front value; for comparing runs */
  hypervolume: number;
}

export interface ParetoReport {
  schema: 1;
  tool: 'optimize';
  mode: 'pareto';
  caveat: string;
  inputHash: string;
  problem: DesignReport['problem'] & { objectives: DesignObjective[]; popSize: number; generations: number; seed: number };
  result: ParetoResult;
}

/**
 * The trade-off between two objectives under the constraints of the design problem, by NSGA-II (constrained domination): the whole
 * Pareto front in one run instead of one point per scalarisation. The objectives are minimised in the scaled form of objectiveValue.
 */
export function solvePareto(spec: ParetoSpec): ParetoResult {
  const { base } = spec;
  if (base.method === 'stellarator') throw new RangeError('the design optimisation covers tokamaks and spherical tokamaks');
  const [o1, o2] = spec.objectives;
  for (const o of [o1, o2]) if (!DESIGN_OBJECTIVES.includes(o)) throw new RangeError(`unknown objective '${String(o)}' (${DESIGN_OBJECTIVES.join(', ')})`);
  if (o1 === o2) throw new RangeError('the two objectives of a Pareto front must differ');
  const names = [...(spec.variables ?? DEFAULT_VARS)];
  if (names.length === 0) throw new RangeError('the design needs at least one variable');
  if (new Set(names).size !== names.length) throw new RangeError('a design variable is listed twice');
  for (const nm of names) if (!DESIGN_VARS.includes(nm)) throw new RangeError(`unknown design variable '${String(nm)}' (${DESIGN_VARS.join(', ')})`);
  const bounds = names.map((nm) => boundsFor(base, nm, spec.bounds));
  bounds.forEach(([lo, hi], i) => { if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError(`bounds of ${names[i]}: need finite lo < hi, got [${lo}, ${hi}]`); });
  const cons = resolveConstraints(base, spec.constraints);
  const preset = presetDesign(base);
  const ref = designPoint(base, preset);
  const full = (x: readonly number[]): DesignValues => { const v = { ...preset }; names.forEach((nm, i) => { v[nm] = x[i]; }); return v; };
  const nCons = constraintValues(ref, cons).length;
  // the single-objective optima (one start, 10 keV) as seeds: NSGA-II reaches the ends of the front slowly when the feasible set is narrow
  const initial: number[][] = [];
  if (spec.seedWithOptima ?? true) {
    for (const o of [o1, o2]) {
      const one = solveDesign({ ...spec, objective: o, startTemperatures: [10] });
      initial.push(names.map((nm) => one.variables.find((v) => v.name === nm)!.value));
    }
  }
  const r = nsga2({
    n: names.length, m: 2,
    f: (x) => { const pt = designPoint(base, full(x)); return [objectiveValue(o1, pt, ref), objectiveValue(o2, pt, ref)]; },
    g: (x) => { const cv = constraintValues(designPoint(base, full(x)), cons).map((c) => c.g); return cv.length === nCons ? cv : new Array(nCons).fill(1e6); },
    lower: bounds.map((b) => b[0]), upper: bounds.map((b) => b[1]),
  }, { popSize: spec.popSize ?? 100, generations: spec.generations ?? 100, seed: spec.seed ?? 1, initial, feasTol: 1e-6 });
  const feasibleFound = r.front.length > 0 && r.front.every((i) => i.violation === 0);
  const pts: ParetoPoint[] = (feasibleFound ? r.front : []).map((i) => {
    const pt = designPoint(base, full(i.x));
    const n1 = objectiveNatural(o1, pt).value, n2 = objectiveNatural(o2, pt).value;
    return {
      objectives: [n1, n2] as [number, number], variables: Object.fromEntries(names.map((nm, k) => [nm, i.x[k]])),
      Q: pt.state.Q, Paux_MW: pt.state.Paux / 1e6, Pfus_MW: pt.state.Pfus / 1e6, betaN: pt.state.betaN,
    };
  });
  const scaled = feasibleFound ? r.front.map((i) => i.f) : [];
  const w1 = scaled.length ? Math.max(...scaled.map((f) => f[0])) : 0, w2 = scaled.length ? Math.max(...scaled.map((f) => f[1])) : 0;
  const refPt: [number, number] = [w1 + 0.1 * Math.abs(w1) + 1e-9, w2 + 0.1 * Math.abs(w2) + 1e-9];
  return {
    caveat: OPTIMIZATION_CAVEAT,
    objectives: [o1, o2].map((o) => ({ name: o, label: objectiveNatural(o, ref).label, unit: objectiveNatural(o, ref).unit, preset: objectiveNatural(o, ref).value })),
    points: pts, feasibleFound, evals: r.evals, hypervolume: scaled.length ? hypervolume2D(scaled, refPt) : 0,
  };
}

/** Solves the Pareto problem and wraps it for the JSON report. */
export function paretoReport(spec: ParetoSpec, presetId?: string): ParetoReport {
  const result = solvePareto(spec);
  const names = [...(spec.variables ?? DEFAULT_VARS)];
  const popSize = spec.popSize ?? 100, generations = spec.generations ?? 100, seed = spec.seed ?? 1;
  return {
    schema: 1, tool: 'optimize', mode: 'pareto', caveat: OPTIMIZATION_CAVEAT,
    inputHash: sha256Hex(canonicalString({ pareto: true, hash: designHash({ ...spec, objective: spec.objectives[0] }), objectives: spec.objectives, popSize, generations, seed, seedWithOptima: spec.seedWithOptima ?? true })),
    problem: {
      ...(presetId ? { preset: presetId } : {}), objective: spec.objectives[0], variables: names,
      bounds: Object.fromEntries(names.map((n) => [n, boundsFor(spec.base, n, spec.bounds)])), constraints: resolveConstraints(spec.base, spec.constraints),
      startTemperatures: [], objectives: [...spec.objectives], popSize, generations, seed,
    },
    result,
  };
}
