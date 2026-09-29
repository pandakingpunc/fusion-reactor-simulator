/**
 * What the command-line tools (uq, scan, optimize) share, kept free of Node APIs so that it can be tested in-process:
 * parsing of the flag syntaxes, the preset lookup, and the text reports.
 *
 *   --param PATH=DIST                      an uncertain parameter and its prior (uq): PATH is a dotted path into the
 *                                          configuration, DIST as in distributions.ts parseDist, e.g.
 *                                          H98=lognormal:1.0:0.14   n_target=normal:1e20:1e19:5e19:-
 *   --param PATH=LO:HI[:N]                 a scan axis (scan): N grid points, or none for a sampled scan
 *   --prob METRIC>=VALUE                   an extra probability (uq); operators >=, <=, >, <
 */
import { PRESETS } from '../physics/presets';
import type { ReactorConfig } from '../physics/types';
import { CAVEAT, CustomProbability, Comparison, EnsembleResult } from './ensemble';
import { METRIC_KEYS, MetricKey } from './metrics';
import { ParamSpec, PriorSet, defaultPriors, H98_SIGMA } from './priors';
import { parseDist } from './distributions';
import type { ScanAxis, ScanResult } from './scan';
import type { DesignReport, ParetoReport } from './design';

/** The preset with this id (the ids of the `validate` CLI); throws RangeError listing the valid ones. */
export function presetConfig(id: string): ReactorConfig {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new RangeError(`unknown preset '${id}'. Valid ids: ${PRESETS.map((x) => x.id).join(', ')}`);
  return p.cfg;
}

/** Splits 'PATH=REST' at the first '='. */
function splitAssign(text: string, what: string): [string, string] {
  const eq = text.indexOf('=');
  if (eq <= 0 || eq === text.length - 1) throw new RangeError(`${what} '${text}': expected PATH=VALUE`);
  return [text.slice(0, eq).trim(), text.slice(eq + 1).trim()];
}

/** --param PATH=DIST for uq. */
export function parseParam(text: string): ParamSpec {
  const [path, rhs] = splitAssign(text, '--param');
  try {
    return { path, dist: parseDist(rhs), basis: 'given on the command line' };
  } catch (e) {
    throw new RangeError(`--param ${text}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** --param PATH=LO:HI[:N] for scan (a leading 'log:' before the numbers, PATH=log:LO:HI:N, makes the axis logarithmic). */
export function parseAxis(text: string): ScanAxis {
  const [path, rhs] = splitAssign(text, '--param');
  const parts = rhs.split(':');
  const log = parts[0] === 'log';
  const nums = log ? parts.slice(1) : parts;
  if (nums.length < 2 || nums.length > 3) throw new RangeError(`--param ${text}: expected PATH=LO:HI or PATH=LO:HI:N (optionally PATH=log:LO:HI:N)`);
  const lo = Number(nums[0]), hi = Number(nums[1]);
  if (nums[0].trim() === '' || nums[1].trim() === '' || !Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError(`--param ${text}: LO and HI must be finite numbers`);
  let points: number | undefined;
  if (nums.length === 3) {
    points = Number(nums[2]);
    if (nums[2].trim() === '' || !Number.isInteger(points) || points < 1) throw new RangeError(`--param ${text}: N must be a positive integer`);
  }
  return { path, lo, hi, ...(points !== undefined ? { points } : {}), ...(log ? { log: true } : {}) };
}

const OPS: Comparison[] = ['>=', '<=', '>', '<'];

/** --prob METRIC>=VALUE (metrics of metrics.ts). */
export function parseProbability(text: string): CustomProbability {
  for (const op of OPS) {
    const i = text.indexOf(op);
    if (i > 0) {
      const metric = text.slice(0, i).trim();
      const value = Number(text.slice(i + op.length));
      if (!(METRIC_KEYS as readonly string[]).includes(metric)) throw new RangeError(`--prob ${text}: unknown metric '${metric}'. Valid metrics: ${METRIC_KEYS.join(', ')}`);
      if (text.slice(i + op.length).trim() === '' || !Number.isFinite(value)) throw new RangeError(`--prob ${text}: '${text.slice(i + op.length)}' is not a finite number`);
      return { metric: metric as MetricKey, op, value };
    }
  }
  throw new RangeError(`--prob ${text}: expected METRIC>=VALUE (operators ${OPS.join(' ')})`);
}

/** --levels 0.05,0.5,0.95: quantile levels strictly between 0 and 1, ascending, without duplicates. */
export function parseLevels(items: readonly string[]): number[] {
  const out = items.map((s) => Number(s));
  out.forEach((v, i) => { if (!(v > 0 && v < 1)) throw new RangeError(`--levels: '${items[i]}' is not a probability in (0, 1)`); });
  for (let i = 1; i < out.length; i++) if (!(out[i] > out[i - 1])) throw new RangeError('--levels: the levels must be ascending and distinct');
  return out;
}

/**
 * The prior set of a uq run: the default priors of a magnetic preset (`mode` 'default'), or none ('none'), with the
 * --param entries replacing the default of the same path or adding to the list.
 */
export function buildPriors(cfg: ReactorConfig, mode: 'default' | 'none', params: readonly ParamSpec[], h98: keyof typeof H98_SIGMA = 'ipb98y2'): PriorSet {
  const base = mode === 'default' ? defaultPriors(cfg, { h98 }).params : [];
  const list = [...base];
  for (const p of params) {
    const i = list.findIndex((q) => q.path === p.path);
    if (i >= 0) list[i] = p; else list.push(p);
  }
  return { params: list };
}

// ---- text reports ---------------------------------------------------------------------------------------------------

/** number with 3 significant figures (or exponential for very large/small values) */
export function fmt(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'n/a';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2);
  return String(Number(x.toPrecision(3)));
}

function wrap(text: string, width = 100): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

/** confidence level as a percentage without floating-point noise: 0.95 -> '95', 0.995 -> '99.5' */
const level = (c: number): string => String(Math.round(c * 1000) / 10);
const pct = (p: number) => (Number.isFinite(p) ? `${(100 * p).toFixed(1)} %` : 'n/a');

/** Human-readable summary of a uq result. */
export function formatEnsemble(r: EnsembleResult): string {
  const L: string[] = [];
  const sys = r.system;
  L.push(`UQ of ${sys.preset ?? sys.method} (${sys.method}, ${sys.fidelity}, t_end ${fmt(sys.t_end_s)} s): ${r.design.runs} runs, ${r.design.analysis}, sampler ${r.design.sampler}, seed ${r.design.seed}`);
  L.push(wrap(r.caveat), '');
  for (const n of r.design.notes) L.push(`note: ${n}`);
  L.push('Uncertain parameters (prior median, 90 % interval):');
  for (const p of r.parameters) L.push(`  ${p.path.padEnd(30)} ${fmt(p.prior.median).padStart(9)}  [${fmt(p.prior.p05)} ... ${fmt(p.prior.p95)}]  ${p.dist.type}`);
  const u = r.runs;
  L.push('', `Runs: ${u.valid} valid of ${u.total} (${u.failed} failed): ${u.completed} ran to the scheduled end, ${u.disrupted} disrupted, ${u.other} ended otherwise`);
  for (const [reason, n] of Object.entries(u.endReasons)) L.push(`  ${String(n).padStart(6)}  ${reason}`);
  for (const f of u.failures.slice(0, 3)) L.push(`  failed run ${f.run}: ${f.error}`);
  L.push('', `Probabilities (Wilson ${level(r.design.confidence)} % interval, runs taken as independent):`);
  for (const p of r.probabilities) L.push(`  P(${p.id})`.padEnd(30) + `${pct(p.p).padStart(9)}  [${pct(p.ci[0])} ... ${pct(p.ci[1])}]  ${p.k}/${p.n}`);
  const table = (title: string, rows: EnsembleResult['outputs']) => {
    const keys = Object.keys(rows);
    if (!keys.length) return;
    L.push('', title);
    const qk = Object.keys(rows[keys[0]].quantiles);
    L.push(`  ${'metric'.padEnd(14)} ${'n'.padStart(5)} ${'mean'.padStart(9)} ${'sd'.padStart(9)} ${qk.map((k) => k.padStart(9)).join(' ')}`);
    for (const k of keys) {
      const o = rows[k];
      L.push(`  ${k.padEnd(14)} ${String(o.n).padStart(5)} ${fmt(o.mean).padStart(9)} ${fmt(o.sd).padStart(9)} ${qk.map((q) => fmt(o.quantiles[q]).padStart(9)).join(' ')}`);
    }
  };
  table('Performance (shots that ran to the scheduled end):', r.outputs);
  table('Operating point (all valid shots):', r.operating);
  const rc = Object.entries(r.rankCorrelation);
  if (rc.length) {
    L.push('', 'Spearman rank correlation of the outputs with the inputs:');
    for (const [metric, row] of rc) L.push(`  ${metric.padEnd(14)} ${Object.entries(row).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('   ')}`);
  }
  if (r.sensitivity) {
    L.push('', `Sobol' indices (${r.sensitivity.runs} runs; S = first order, ST = total; bracket = ${level(r.design.confidence)} % bootstrap interval):`);
    for (const t of r.sensitivity.targets) {
      L.push(`  ${t.metric} (${t.label}; ${t.nUsed} rows)`);
      for (const i of t.indices) {
        const num = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : 'n/a');
        const ci = (c?: [number, number]) => (c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? ` [${c[0].toFixed(2)}, ${c[1].toFixed(2)}]` : '');
        L.push(`    ${i.path.padEnd(30)} S ${num(i.S1).padStart(7)}${ci(i.S1_ci)}   ST ${num(i.ST).padStart(7)}${ci(i.ST_ci)}`);
      }
    }
  }
  L.push('', `input hash ${r.inputHash}`);
  return L.join('\n') + '\n';
}

/** Human-readable summary of a scan (the table of the first few points and the bookkeeping). */
export function formatScan(r: ScanResult, maxRows = 25): string {
  const L: string[] = [];
  L.push(`Scan of ${r.system.preset ?? r.system.method} (${r.system.method}, ${r.system.fidelity}, t_end ${fmt(r.system.t_end_s)} s): ${r.design.points} points, ${r.design.mode}`);
  L.push(wrap(CAVEAT), '');
  for (const n of r.design.notes) L.push(`note: ${n}`);
  for (const a of r.axes) L.push(`  axis ${a.path}: ${fmt(a.lo)} ... ${fmt(a.hi)}${a.log ? ' (log)' : ''}${a.points ? `, ${a.points} points` : ''}, preset value ${fmt(a.nominal)}`);
  L.push(`Runs: ${r.runs.valid} valid of ${r.runs.total} (${r.runs.failed} failed), ${r.runs.completed} ran to the end, ${r.runs.disrupted} disrupted`, '');
  const names = r.axes.map((a) => a.path);
  L.push(`  ${names.map((n) => n.padStart(12)).join(' ')} ${'Q_flat'.padStart(9)} ${'Pfus_flat_MW'.padStart(12)} ${'nG_max'.padStart(8)} ${'betaN_max'.padStart(9)}  end`);
  for (const p of r.points.slice(0, maxRows)) {
    const m = p.metrics;
    L.push(`  ${names.map((n) => fmt(p.values[n]).padStart(12)).join(' ')} ${fmt(m?.Q_flat).padStart(9)} ${fmt(m?.Pfus_flat_MW).padStart(12)} ${fmt(m?.nG_max).padStart(8)} ${fmt(m?.betaN_max).padStart(9)}  ${p.endReason}`);
  }
  if (r.points.length > maxRows) L.push(`  ... ${r.points.length - maxRows} more points (see --csv / --json)`);
  return L.join('\n') + '\n';
}

/** --param style bound NAME=LO:HI for optimize (design variable bounds). */
export function parseBound(text: string): { name: string; lo: number; hi: number } {
  const [name, rhs] = splitAssign(text, '--bound');
  const parts = rhs.split(':');
  const lo = Number(parts[0]), hi = Number(parts[1]);
  if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '' || !Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError(`--bound ${text}: expected NAME=LO:HI with finite numbers`);
  if (!(hi > lo)) throw new RangeError(`--bound ${text}: HI must exceed LO`);
  return { name, lo, hi };
}

/** Human-readable summary of an optimize report. */
export function formatDesign(r: DesignReport): string {
  const L: string[] = [];
  const res = r.result, p = r.problem;
  L.push(`Design optimisation of ${p.preset ?? 'the configuration'}: ${res.objective.label} (${p.objective}) ${p.objective === 'fusion-power' || p.objective === 'gain' ? 'maximised' : 'minimised'}`);
  L.push(wrap(r.caveat), '');
  L.push(`${res.feasible ? 'Optimum' : 'NO FEASIBLE DESIGN FOUND; least violated design'}: ${res.objective.label} = ${fmt(res.objective.value)} ${res.objective.unit} (preset machine: ${fmt(res.objective.preset)} ${res.objective.unit})`);
  L.push('', 'Variables:');
  L.push(`  ${'name'.padEnd(8)} ${'value'.padStart(10)} ${'preset'.padStart(10)}  bounds`);
  for (const v of res.variables) L.push(`  ${v.name.padEnd(8)} ${fmt(v.value).padStart(10)} ${fmt(v.preset).padStart(10)}  [${fmt(v.lo)}, ${fmt(v.hi)}]${v.atBound ? `  at ${v.atBound} bound` : ''}`);
  L.push('', 'Constraints:');
  for (const c of res.constraints) {
    L.push(`  ${c.satisfied ? (c.active ? 'ACTIVE  ' : 'ok      ') : 'VIOLATED'} ${(c.label + fmt(c.limit)).padEnd(38)} value ${fmt(c.value).padStart(9)}   multiplier ${fmt(c.multiplier)}`);
  }
  const o = res.optimum;
  L.push('', 'Operating point:');
  L.push(`  Q ${fmt(o.Q)}, P_aux ${fmt(o.Paux_MW)} MW, P_fus ${fmt(o.Pfus_MW)} MW, T ${fmt(o.T_keV)} keV, n_vol ${fmt(o.n_vol_m3)} m^-3 (n/nG ${fmt(o.nOverNG)}), tau_E ${fmt(o.tauE_s)} s`);
  L.push(`  beta_N ${fmt(o.betaN)}, q95 ${fmt(o.q95)}, P_L/P_LH ${fmt(o.PLoverPLH)}, He ash ${fmt(o.fHe)}, V ${fmt(o.V_m3)} m^3, B_coil ${fmt(o.B_coil_T)} T, A ${fmt(o.aspect)}, wall load ${fmt(o.wallLoad_MWm2)} MW/m^2`);
  const s = res.solver;
  L.push('', `Solver: ${s.method}, ${s.starts} starts (best: #${s.bestStart + 1}), ${s.evals} evaluations, ${s.outer} outer iterations, ${s.reason}, constraint violation ${s.violation.toExponential(1)}`);
  L.push(`input hash ${r.inputHash}`);
  return L.join('\n') + '\n';
}

/** Human-readable summary of a Pareto report (about 15 evenly spaced designs of the front). */
export function formatPareto(r: ParetoReport, maxRows = 15): string {
  const L: string[] = [];
  const res = r.result, p = r.problem;
  const [a, b] = res.objectives;
  L.push(`Pareto front of ${p.preset ?? 'the configuration'}: ${a.label} against ${b.label} (NSGA-II, population ${p.popSize}, ${p.generations} generations, seed ${p.seed})`);
  L.push(wrap(r.caveat), '');
  if (!res.feasibleFound) {
    L.push('NO FEASIBLE DESIGN FOUND: no individual of the final population satisfies all constraints.');
    L.push(`input hash ${r.inputHash}`);
    return L.join('\n') + '\n';
  }
  L.push(`${res.points.length} non-dominated feasible designs (hypervolume of the scaled front ${fmt(res.hypervolume)}, ${res.evals} evaluations); preset machine: ${a.label} ${fmt(a.preset)} ${a.unit}, ${b.label} ${fmt(b.preset)} ${b.unit}`, '');
  const names = Object.keys(res.points[0].variables);
  L.push(`  ${(a.label + (a.unit ? ` [${a.unit}]` : '')).padStart(22)} ${(b.label + (b.unit ? ` [${b.unit}]` : '')).padStart(24)} ${'Q'.padStart(8)} ${'P_aux'.padStart(8)} ${'P_fus'.padStart(8)}  ${names.join(' ')}`);
  const step = Math.max(1, Math.floor(res.points.length / maxRows));
  for (let k = 0; k < res.points.length; k += step) {
    const q = res.points[k];
    L.push(`  ${fmt(q.objectives[0]).padStart(22)} ${fmt(q.objectives[1]).padStart(24)} ${fmt(q.Q).padStart(8)} ${fmt(q.Paux_MW).padStart(8)} ${fmt(q.Pfus_MW).padStart(8)}  ${names.map((n) => fmt(q.variables[n])).join(' ')}`);
  }
  if (step > 1) L.push(`  (every ${step}th of ${res.points.length} designs; all are in the JSON)`);
  L.push(`input hash ${r.inputHash}`);
  return L.join('\n') + '\n';
}
