/**
 * Figures for uncertainty quantification and sensitivity studies:
 *  - {@link figViolin}: violin plots of output samples (Monte Carlo / Latin hypercube ensembles), one
 *    panel per output, one violin per group (e.g. per configuration), with median, interquartile range
 *    and 5-95 % whiskers, and an optional reference value;
 *  - {@link figTornado}: tornado plot of a one-at-a-time sensitivity study (output at the low and the
 *    high setting of each input, sorted by swing).
 * The builders take plain arrays (no dependence on the UQ engine), so any study can feed them.
 *
 * Violin: Gaussian kernel density estimate with Silverman's rule-of-thumb bandwidth
 * h = 0.9 min(sigma, IQR / 1.34) n^(-1/5) (B. W. Silverman, Density Estimation for Statistics and Data
 * Analysis, Chapman & Hall, London 1986, eq. 3.31); the shape spans the sample range; all violins of a
 * panel have the same area (a broad distribution is not drawn wider than a narrow one at equal n).
 * Quantiles: linear interpolation of the order statistics (Hyndman & Fan, The American Statistician
 * 50 (1996) 361, type 7, the default of R, NumPy and matplotlib).
 */
import { Figure } from '../figure';
import { OKABE_ITO } from '../colors';
import { C, COL1, COL2 } from './common';

// ---------------------------------------------------------------- statistics

/** the finite samples, sorted ascending (a copy) */
export function sortedFinite(x: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i])) out.push(x[i]);
  return out.sort((a, b) => a - b);
}

/** quantile p in [0, 1] of an ascending array (Hyndman & Fan type 7); NaN for an empty array */
export function quantileSorted(s: readonly number[], p: number): number {
  const n = s.length;
  if (!n) return NaN;
  const h = (n - 1) * Math.min(Math.max(p, 0), 1), i = Math.floor(h);
  return i >= n - 1 ? s[n - 1] : s[i] + (h - i) * (s[i + 1] - s[i]);
}

/** Silverman's rule-of-thumb bandwidth of an ascending sample; 0 when the sample has no spread */
export function silvermanBandwidth(s: readonly number[]): number {
  const n = s.length;
  if (n < 2) return 0;
  let m = 0;
  for (const v of s) m += v;
  m /= n;
  let ss = 0;
  for (const v of s) ss += (v - m) * (v - m);
  const sd = Math.sqrt(ss / (n - 1));
  const iqr = quantileSorted(s, 0.75) - quantileSorted(s, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  return 0.9 * spread * Math.pow(n, -0.2);
}

/** Gaussian kernel density estimate of `s` (any order) with bandwidth h, on the given grid */
export function gaussianKDE(s: readonly number[], grid: readonly number[], h: number): number[] {
  const n = s.length, c = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map((x) => {
    let d = 0;
    for (let i = 0; i < n; i++) { const z = (x - s[i]) / h; d += Math.exp(-0.5 * z * z); }
    return c * d;
  });
}

// ---------------------------------------------------------------- violin

export interface ViolinGroup {
  name: string;
  samples: ArrayLike<number>;
  /** fill/edge colour (default: the Okabe-Ito palette in group order) */
  color?: string;
}

export interface ViolinPanel {
  /** y label (mathtext) */
  label: string;
  unit?: string;
  groups: ViolinGroup[];
  /** reference value drawn as a dashed line (e.g. the published value or the nominal run) */
  ref?: number;
  refLabel?: string;
  /** log-scaled axis: the density is estimated for log10 of the (positive) samples */
  log?: boolean;
}

export interface ViolinOptions {
  title?: string;
  /** columns of the panel grid (default: min(panels, 3)) */
  ncols?: number;
  /** points of the density grid (default 96) */
  gridPoints?: number;
}

/** The densest KDE evaluation uses at most this many samples (evenly strided) */
const KDE_MAX_SAMPLES = 4000;

/** Outline of one violin: y values and half widths (density), spanning the sample range; null when it is degenerate. */
export function violinShape(sorted: readonly number[], log: boolean, gridPoints: number): { y: number[]; d: number[] } | null {
  const v = log ? sorted.filter((x) => x > 0).map(Math.log10) : sorted.slice();
  if (v.length < 2 || !(v[v.length - 1] > v[0])) return null;
  const h = silvermanBandwidth(v);
  if (!(h > 0)) return null;
  const stride = Math.max(1, Math.ceil(v.length / KDE_MAX_SAMPLES));
  const use = stride === 1 ? v : v.filter((_, i) => i % stride === 0);
  const lo = v[0], hi = v[v.length - 1];
  const grid = Array.from({ length: gridPoints }, (_, k) => lo + ((hi - lo) * k) / (gridPoints - 1));
  const d = gaussianKDE(use, grid, h);
  return { y: log ? grid.map((g) => Math.pow(10, g)) : grid, d };
}

const fmtUnit = (label: string, unit?: string) => (unit ? `${label} (${unit})` : label);

/** Violin plots: a grid of panels, one output per panel, one violin per group. */
export function figViolin(panels: readonly ViolinPanel[], o: ViolinOptions = {}): Figure {
  const np = Math.max(1, panels.length);
  const ncols = Math.max(1, Math.min(o.ncols ?? Math.min(np, 3), np));
  const nrows = Math.ceil(np / ncols);
  const W = ncols === 1 ? COL1 : COL2;
  const fig = new Figure(W, 0.65 + 2.3 * nrows, { fontSize: 8, title: o.title ?? 'Uncertainty distributions' });
  const axes = fig.subplots(nrows, ncols, { left: 0.62, right: 0.15, top: 0.28, bottom: 0.5, wspace: 0.62, hspace: 0.55 });
  fig.axes.splice(np); // the unused cells of the last row stay empty (no frame)
  const grid = Math.max(16, Math.floor(o.gridPoints ?? 96));
  panels.forEach((p, pi) => {
    const ax = axes[pi];
    const ng = p.groups.length;
    const sorted = p.groups.map((g) => sortedFinite(g.samples).filter((x) => !p.log || x > 0));
    const shapes = sorted.map((s) => violinShape(s, !!p.log, grid));
    // equal areas: one common density scale per panel (in the axis' own units: log panels use the log-space density)
    const areaScale = Math.max(...shapes.map((sh) => (sh ? Math.max(...sh.d) : 0)), 1e-300);
    p.groups.forEach((g, gi) => {
      const x = gi + 1, col = g.color ?? OKABE_ITO[gi % OKABE_ITO.length], s = sorted[gi], sh = shapes[gi];
      if (sh) {
        const w = sh.d.map((d) => (0.42 * d) / areaScale);
        const xs = [...w.map((v) => x + v), ...w.map((v) => x - v).reverse()];
        const ys = [...sh.y, ...sh.y.slice().reverse()];
        ax.polygon(xs, ys, { fill: col, stroke: col, alpha: 0.35, lw: 0.7, z: 1 });
        ax.polygon(xs, ys, { stroke: col, lw: 0.7, z: 1 });
      } else if (s.length) {
        ax.plot([x - 0.25, x + 0.25], [s[0], s[0]], { color: col, lw: 1.2, z: 3 }); // no spread: a single level
      }
      if (s.length) {
        const q05 = quantileSorted(s, 0.05), q25 = quantileSorted(s, 0.25), q50 = quantileSorted(s, 0.5), q75 = quantileSorted(s, 0.75), q95 = quantileSorted(s, 0.95);
        ax.plot([x, x], [q05, q95], { color: C.black, lw: 0.6, z: 3 });
        ax.plot([x, x], [q25, q75], { color: C.black, lw: 2.4, z: 3 });
        ax.plot([x], [q50], { marker: 'o', ms: 2.8, color: C.black, mfc: '#ffffff', lw: 0, z: 4 });
      }
    });
    if (p.ref !== undefined && Number.isFinite(p.ref)) ax.axhline(p.ref, { color: C.vermilion, lw: 0.8, dash: 'dashed', label: p.refLabel ?? 'reference' });
    const ns = sorted.map((s) => s.length);
    // y range: the samples and the reference value (a reference outside the ensemble stays on the axis)
    const all = sorted.flatMap((s) => (s.length ? [s[0], s[s.length - 1]] : []));
    if (p.ref !== undefined && Number.isFinite(p.ref) && (!p.log || p.ref > 0)) all.push(p.ref);
    let ylim: [number, number] | undefined;
    if (all.length) {
      const a = Math.min(...all), b = Math.max(...all);
      if (p.log) { const f = a < b ? Math.pow(b / a, 0.06) : 1.5; ylim = [a / f, b * f]; }
      else { const d = a < b ? 0.06 * (b - a) : Math.abs(a) * 0.1 || 1; ylim = [a - d, b + d]; }
    }
    ax.set({
      ylim, xlim: [0.4, ng + 0.6], xticks: p.groups.map((_, i) => i + 1), xticklabels: p.groups.map((g) => g.name), yscale: p.log ? 'log' : 'linear',
      ylabel: fmtUnit(p.label, p.unit),
    }).panelLabel(`(${String.fromCharCode(97 + (pi % 26))})`);
    if (p.ref !== undefined && Number.isFinite(p.ref) && p.refLabel) ax.legend({ loc: 'upper right', size: 6.5 });
    if (ns.length && ns.every((n) => n === ns[0])) ax.text(0.97, 0.03, `$n$ = ${ns[0]}`, { coords: 'axes', anchor: 'end', size: 6.5, color: C.grey });
  });
  return fig;
}

// ---------------------------------------------------------------- tornado

export interface TornadoBar {
  /** input parameter (mathtext) */
  label: string;
  /** output at the low and at the high setting of the input (either may be the larger) */
  low: number;
  high: number;
  /** text of the two settings, written next to the bar ends (e.g. "-20 %", "+20 %") */
  lowInput?: string;
  highInput?: string;
}

export interface TornadoInput {
  /** output at the nominal (all inputs at their base values) setting */
  base: number;
  /** x axis label (mathtext) */
  output: string;
  bars: readonly TornadoBar[];
  title?: string;
  /** draw only the largest swings (default: all) */
  maxBars?: number;
}

/** swing |high - low| of a bar (0 when either value is not finite) */
export const tornadoSwing = (b: TornadoBar): number => (Number.isFinite(b.low) && Number.isFinite(b.high) ? Math.abs(b.high - b.low) : 0);

/**
 * Tornado plot: one horizontal bar pair per input, from the base output to the output at the low
 * setting (blue) and at the high setting (vermilion); the input with the largest swing is on top.
 */
export function figTornado(inp: TornadoInput): Figure {
  const sorted = [...inp.bars].sort((a, b) => tornadoSwing(b) - tornadoSwing(a));
  const bars = inp.maxBars !== undefined ? sorted.slice(0, Math.max(1, inp.maxBars)) : sorted;
  const n = Math.max(1, bars.length);
  const H = 0.75 + 0.24 * (n + 0.9); // one row of height for the legend above the bars
  const fig = new Figure(COL1 * 1.5, H, { fontSize: 8, title: inp.title ?? 'Sensitivity (tornado)' });
  const [ax] = fig.subplots(1, 1, { left: 1.25, right: 0.3, top: 0.22, bottom: 0.5 });
  const ys = bars.map((_, k) => n - k);
  const vals = bars.flatMap((b) => [b.low, b.high]).filter(Number.isFinite);
  let lo = Math.min(inp.base, ...vals), hi = Math.max(inp.base, ...vals);
  if (!(hi > lo)) { const d = Math.abs(inp.base) * 0.1 || 1; lo -= d; hi += d; }
  const pad = 0.16 * (hi - lo);
  const bar = (b: number, v: number, y: number, fill: string) => {
    if (!Number.isFinite(v)) return;
    ax.polygon([b, v, v, b], [y - 0.32, y - 0.32, y + 0.32, y + 0.32], { fill, stroke: fill, lw: 0.5, alpha: 0.75, z: 1 });
  };
  bars.forEach((b, k) => {
    bar(inp.base, b.low, ys[k], C.blue);
    bar(inp.base, b.high, ys[k], C.vermilion);
    const put = (v: number, text: string | undefined) => {
      if (!text || !Number.isFinite(v)) return;
      const right = v >= inp.base;
      ax.text(v + (right ? 1 : -1) * 0.012 * (hi - lo), ys[k], text, { size: 6, baseline: 'middle', anchor: right ? 'start' : 'end', color: C.grey });
    };
    put(b.low, b.lowInput);
    put(b.high, b.highInput);
  });
  // legend entries (the bars carry no label of their own)
  ax.polygon([inp.base, inp.base, inp.base], [0, 0, 0], { fill: C.blue, alpha: 0.75, lw: 0, label: 'low setting' });
  ax.polygon([inp.base, inp.base, inp.base], [0, 0, 0], { fill: C.vermilion, alpha: 0.75, lw: 0, label: 'high setting' });
  ax.axvline(inp.base, { color: C.black, lw: 0.8, dash: 'solid' });
  ax.set({
    xlim: [lo - pad, hi + pad], ylim: [0.4, n + 1.5], yticks: ys, yticklabels: bars.map((b) => b.label), xlabel: inp.output,
  }).legend({ loc: 'upper center', ncol: 2, size: 6.5 });
  return fig;
}
