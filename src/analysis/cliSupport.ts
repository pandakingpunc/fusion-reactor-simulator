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
