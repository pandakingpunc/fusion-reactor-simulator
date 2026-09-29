/**
 * Pareto fronts of a multi-objective study (design optimisation, trade-off scans): the non-dominated
 * candidates of a set, the fronts behind them, and a figure that draws all candidates, the first
 * front(s) with their attainment staircase and, optionally, a third value as colour.
 *
 * Definitions and the non-dominated sorting algorithm: K. Deb, A. Pratap, S. Agarwal, T. Meyarivan,
 * "A fast and elitist multiobjective genetic algorithm: NSGA-II", IEEE Transactions on Evolutionary
 * Computation 6(2), 182-197 (2002), Sec. III-A. A point a dominates b when a is no worse than b in
 * every objective and strictly better in at least one; the first front holds the points no other point
 * dominates, the second front the points that only points of the first front dominate, and so on.
 */
import { Figure, Mappable } from '../figure';
import { colormap } from '../colors';
import { hex } from '../canvas';
import { C, COL1 } from './common';

export type Sense = 'min' | 'max';

/** a dominates b for the given optimisation senses (an objective that is not finite never dominates) */
export function dominates(a: readonly number[], b: readonly number[], senses: readonly Sense[]): boolean {
  let better = false;
  for (let k = 0; k < senses.length; k++) {
    const d = senses[k] === 'min' ? b[k] - a[k] : a[k] - b[k]; // > 0: a is better
    if (!(d >= 0)) return false; // worse, or NaN
    if (d > 0) better = true;
  }
  return better;
}

const usable = (p: readonly number[], m: number) => { for (let k = 0; k < m; k++) if (!Number.isFinite(p[k])) return false; return true; };

/**
 * Front index of every point (0: the Pareto front, 1: the front that remains after removing it, ...);
 * -1 for a point with a non-finite objective. O(m n^2) for n points and m objectives (fast non-dominated
 * sort of Deb et al. 2002). Identical points are on the same front.
 */
export function nonDominatedSort(points: readonly (readonly number[])[], senses: readonly Sense[]): number[] {
  const n = points.length, m = senses.length;
  const rank = new Array<number>(n).fill(-1);
  const ok = points.map((p) => usable(p, m));
  const dominated: number[][] = points.map(() => []);
  const count = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!ok[j]) continue;
      if (dominates(points[i], points[j], senses)) { dominated[i].push(j); count[j]++; }
      else if (dominates(points[j], points[i], senses)) { dominated[j].push(i); count[i]++; }
    }
  }
  let front: number[] = [];
  for (let i = 0; i < n; i++) if (ok[i] && count[i] === 0) { rank[i] = 0; front.push(i); }
  for (let r = 0; front.length; r++) {
    const next: number[] = [];
    for (const i of front) for (const j of dominated[i]) if (--count[j] === 0) { rank[j] = r + 1; next.push(j); }
    front = next;
  }
  return rank;
}

/** Indices (ascending) of the non-dominated points. */
export function paretoFront(points: readonly (readonly number[])[], senses: readonly Sense[]): number[] {
  const r = nonDominatedSort(points, senses);
  return r.flatMap((v, i) => (v === 0 ? [i] : []));
}

/**
 * Attainment staircase of a two-objective front: the boundary of the region that the front dominates,
 * as a polyline through the front points (sorted along the first objective) with a right angle between
 * neighbours.
 */
export function staircase(front: readonly { x: number; y: number }[], senses: readonly [Sense, Sense]): { x: number[]; y: number[] } {
  const sx = senses[0] === 'min' ? 1 : -1, sy = senses[1] === 'min' ? 1 : -1;
  const pts = front.map((p) => ({ x: sx * p.x, y: sy * p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const x: number[] = [], y: number[] = [];
  pts.forEach((p, k) => {
    x.push(sx * p.x); y.push(sy * p.y);
    if (k < pts.length - 1) { x.push(sx * pts[k + 1].x); y.push(sy * p.y); }
  });
  return { x, y };
}

export interface ParetoPoint {
  x: number;
  y: number;
  /** optional third value shown as colour (e.g. the cost or a constraint margin) */
  c?: number;
}

export interface ParetoInput {
  points: readonly ParetoPoint[];
  xLabel: string;
  yLabel: string;
  /** direction of improvement of the two objectives (default: minimise both) */
  senses?: [Sense, Sense];
  /** colour bar label of the third value; the colour bar is drawn when any point carries `c` */
  colorLabel?: string;
  cmap?: string;
  /** number of fronts drawn with their staircase (default 1) */
  nFronts?: number;
  /** labelled reference designs (e.g. the baseline) */
  marks?: readonly { x: number; y: number; label: string }[];
  xlog?: boolean;
  ylog?: boolean;
  title?: string;
}

/** Scatter of all candidates with the Pareto front(s) and their staircase; a third value can colour the first front. */
export function figPareto(inp: ParetoInput): Figure {
  const senses = inp.senses ?? ['min', 'min'];
  const pts = inp.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!inp.xlog || p.x > 0) && (!inp.ylog || p.y > 0));
  const rank = nonDominatedSort(pts.map((p) => [p.x, p.y]), senses);
  const nF = Math.max(1, Math.floor(inp.nFronts ?? 1));
  const withC = pts.some((p) => p.c !== undefined && Number.isFinite(p.c));
  const fig = new Figure(COL1 * 1.45, 3.1, { fontSize: 8, title: inp.title ?? 'Pareto front' });
  const [ax] = fig.subplots(1, 1, { left: 0.6, right: withC ? 0.85 : 0.15, top: 0.22, bottom: 0.45 });

  // dominated candidates
  const dom = pts.filter((_, i) => rank[i] >= nF);
  if (dom.length) ax.scatter(dom.map((p) => p.x), dom.map((p) => p.y), { color: '#b0b0b0', ms: 2.4, label: 'dominated' });
  // fronts behind the first: lighter, dashed
  for (let r = nF - 1; r >= 1; r--) {
    const f = pts.filter((_, i) => rank[i] === r);
    if (!f.length) continue;
    const s = staircase(f, senses);
    const shade = ['#56B4E9', '#8fbfdc', '#b9d4e4'][Math.min(r - 1, 2)];
    ax.plot(s.x, s.y, { color: shade, lw: 0.7, dash: 'dashed' });
    ax.scatter(f.map((p) => p.x), f.map((p) => p.y), { color: shade, ms: 2.8, label: r === 1 ? `front ${r + 1}${nF > 2 ? '-' + nF : ''}` : undefined });
  }
  // the Pareto front
  const first = pts.filter((_, i) => rank[i] === 0);
  let map: Mappable | null = null;
  if (first.length) {
    const st = staircase(first, senses);
    ax.plot(st.x, st.y, { color: C.black, lw: 0.8 });
    if (withC) {
      const cs = first.map((p) => p.c).filter((v): v is number => v !== undefined && Number.isFinite(v));
      const vmin = Math.min(...cs), vmax = Math.max(...cs);
      const cm = colormap(inp.cmap ?? 'viridis');
      map = { cmap: cm, vmin: vmax > vmin ? vmin : vmin - 0.5, vmax: vmax > vmin ? vmax : vmin + 0.5, log: false };
      first.forEach((p, k) => {
        const u = p.c !== undefined && Number.isFinite(p.c) ? (p.c - map!.vmin) / (map!.vmax - map!.vmin) : NaN;
        ax.scatter([p.x], [p.y], { color: Number.isFinite(u) ? hex(cm(u)) : '#888888', ms: 4.2, label: k === 0 ? 'Pareto front' : undefined });
      });
    } else {
      ax.scatter(first.map((p) => p.x), first.map((p) => p.y), { color: C.vermilion, ms: 4.2, label: 'Pareto front' });
    }
  }
  for (const m of inp.marks ?? []) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    ax.plot([m.x], [m.y], { marker: 'd', ms: 5, color: '#ffffff', mfc: C.blue, lw: 0 });
    ax.text(m.x, m.y, `  ${m.label}`, { size: 6.5, baseline: 'middle', color: C.blue });
  }
  if (map) fig.colorbar(map, ax, { label: inp.colorLabel, width: 0.1, pad: 0.08 });
  ax.set({ xlabel: inp.xLabel, ylabel: inp.yLabel, xscale: inp.xlog ? 'log' : 'linear', yscale: inp.ylog ? 'log' : 'linear' }).legend({ loc: 'best', frame: true, size: 6.5 });
  return fig;
}
