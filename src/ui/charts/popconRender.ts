/**
 * Drawing and hit-testing of the POPCON map (Plasma OPeration CONtour), independent of React: the component keeps the
 * canvas and the state, this module turns a grid into pixels and a pixel into a point of the map.
 *
 * The map shows the auxiliary power P_aux a steady state needs at each (⟨n_e⟩, ⟨T⟩) (colour), the Q = P_fus/P_aux
 * contours, the Greenwald density, where β_N exceeds its limit (red) and where the loss power is below the L-H
 * threshold (dark). APPROXIMATION: 0D steady state with profile factors (1−ρ²)^α, T_i = T_e; see physics/popcon.ts.
 * On top of it the run's trajectory (faded with age), the operating point, the point the shot is being steered to,
 * the hover cross-hair and, when given, the contour of the heating power that is applied now.
 */
import type { PopconGrid } from '../../physics/popcon';
import type { MagneticConfig } from '../../physics/types';
import { FrameColumns, lodIndices, mergeIndices } from './lod';
import { fmtAxis } from '../format';

export const POPCON_PAD = { l: 50, r: 10, t: 8, b: 24 };

/** what the axes of a drawing span: n from 0 to nMax [m⁻³], T from 0 to Tmax [keV], on a canvas of width × height CSS px */
export interface PopconView { width: number; height: number; nMax: number; Tmax: number }
export interface MapPoint { n: number; T: number }

export function plotRect(v: PopconView) {
  return { x: POPCON_PAD.l, y: POPCON_PAD.t, w: Math.max(1, v.width - POPCON_PAD.l - POPCON_PAD.r), h: Math.max(1, v.height - POPCON_PAD.t - POPCON_PAD.b) };
}

/** data → canvas pixels */
export function toPx(v: PopconView, n: number, T: number): { x: number; y: number } {
  const r = plotRect(v);
  return { x: r.x + (n / v.nMax) * r.w, y: r.y + r.h - (T / v.Tmax) * r.h };
}

/** canvas pixels → data (outside the plot rectangle too: check with `inPlot`) */
export function fromPx(v: PopconView, x: number, y: number): MapPoint {
  const r = plotRect(v);
  return { n: ((x - r.x) / r.w) * v.nMax, T: ((r.y + r.h - y) / r.h) * v.Tmax };
}

export function inPlot(v: PopconView, x: number, y: number): boolean {
  const r = plotRect(v);
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 0, then multiples of a 1-2-5 step up to `max`, about `target` of them */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0];
  const raw = max / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let k = 0; k * step <= max * (1 + 1e-9); k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

/** index of the cell of the grid that holds (n, T), or null outside the map */
export function cellAt(grid: PopconGrid, nMax: number, Tmax: number, n: number, T: number): { i: number; j: number } | null {
  if (!(n >= 0 && n <= nMax && T >= 0 && T <= Tmax)) return null;
  const i = Math.min(grid.nx - 1, Math.floor((n / nMax) * grid.nx));
  // the temperature cells end half-way between the grid temperatures
  let lo = 0, hi = grid.ny - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T > (grid.T[m] + grid.T[m + 1]) / 2) lo = m + 1; else hi = m; }
  return { i, j: lo };
}

/** what the map says at a point (the values of the cell that holds it) */
export interface PopconReadout {
  n: number; T: number;
  /** required auxiliary power [MW]; negative: the point heats itself */
  Paux_MW: number;
  Pfus_MW: number;
  /** P_fus / P_aux (Infinity for P_aux ≤ 0) */
  Q: number;
  betaN: number;
  fHe: number;
  selfHeated: boolean;
  aboveBetaLimit: boolean;
  belowLH: boolean;
  aboveGreenwald: boolean;
}

export function readoutAt(grid: PopconGrid, cfg: Pick<MagneticConfig, 'method' | 'limits'>, nMax: number, Tmax: number, n: number, T: number): PopconReadout | null {
  const c = cellAt(grid, nMax, Tmax, n, T);
  if (!c) return null;
  const k = c.i * grid.ny + c.j;
  const Paux = grid.Paux[k] / 1e6;
  const stell = cfg.method === 'stellarator';
  return {
    n, T, Paux_MW: Paux, Pfus_MW: grid.Pfus[k] / 1e6, Q: grid.Q[k], betaN: grid.betaN[k], fHe: grid.fHe[k],
    selfHeated: Paux <= 0,
    aboveBetaLimit: grid.betaN[k] > cfg.limits.betaN_limit,
    belowLH: !stell && !grid.PLH_ok[k],
    aboveGreenwald: !stell && n > grid.nG * cfg.limits.greenwald_limit,
  };
}

/**
 * Marching-squares segments of the level set { value(i, j) = level } over the grid nodes (n_i, T_j), as
 * [n₁, T₁, n₂, T₂] quadruples. Nodes with a non-finite value make the cells they belong to empty.
 */
export function contourSegments(grid: PopconGrid, value: (i: number, j: number) => number, level: number): number[] {
  const { nx, ny, n, T } = grid;
  const out: number[] = [];
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ny - 1; j++) {
      const f = [value(i, j), value(i + 1, j), value(i + 1, j + 1), value(i, j + 1)];
      if (!f.every(Number.isFinite)) continue;
      const P = [[n[i], T[j]], [n[i + 1], T[j]], [n[i + 1], T[j + 1]], [n[i], T[j + 1]]];
      const pts: number[][] = [];
      for (let e = 0; e < 4; e++) {
        const a = f[e], b = f[(e + 1) % 4];
        if ((a < level) !== (b < level)) {
          const s = (level - a) / (b - a);
          pts.push([P[e][0] + s * (P[(e + 1) % 4][0] - P[e][0]), P[e][1] + s * (P[(e + 1) % 4][1] - P[e][1])]);
        }
      }
      if (pts.length >= 2) out.push(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    }
  }
  return out;
}

/** the run's path over the map, in map coordinates (n in m⁻³), thinned to what a chart of `columns` pixels can show */
export interface Trajectory { n: number[]; T: number[] }

/**
 * The (⟨n_e⟩, ⟨T_i⟩) path of a run from its frames: `ne` [10²⁰ m⁻³] and `Ti` [keV], thinned by the time chart's
 * min/max level of detail (lod.ts) applied to both, so a long run costs a bounded number of segments and a crash
 * (a sudden drop of T) is still a corner of the path.
 */
export function trajectoryOf(cols: FrameColumns, columns = 240, keep: readonly number[] = []): Trajectory {
  const out: Trajectory = { n: [], T: [] };
  if (!cols.n) return out;
  const t0 = cols.t[0], t1 = cols.t[cols.n - 1];
  const idx = mergeIndices(lodIndices(cols, 'ne', t0, t1, columns, keep), lodIndices(cols, 'Ti', t0, t1, columns, keep));
  const ne = cols.column('ne'), Ti = cols.column('Ti');
  for (const k of idx) {
    if (!Number.isFinite(ne[k]) || !Number.isFinite(Ti[k])) continue;
    out.n.push(ne[k] * 1e20); out.T.push(Ti[k]);
  }
  return out;
}

/** everything drawn over the map */
export interface PopconOverlay {
  trajectory?: Trajectory | null;
  /** the operating point now */
  point?: MapPoint | null;
  /** the point the shot is being steered to */
  target?: MapPoint | null;
  hover?: MapPoint | null;
  /** auxiliary heating applied now [MW]: its contour is where a steady state at this power lies */
  heatingMW?: number | null;
}

const P_LEVELS: readonly { v: number; c: string; lbl: string }[] = [
  { v: 1, c: '#ffd166', lbl: 'Q=1' }, { v: 5, c: '#f8961e', lbl: 'Q=5' }, { v: 10, c: '#f72585', lbl: 'Q=10' }, { v: 30, c: '#e0aaff', lbl: 'Q=30' },
];

/** colour of a cell: P_aux < 0 green (heats itself), otherwise blue to red on a log scale */
export function cellColor(Paux_MW: number): string {
  if (Paux_MW <= 0) return `rgba(6,214,160,${Math.min(0.85, 0.35 + Math.log10(1 - Paux_MW + 1) * 0.3)})`;
  const u = Math.min(1, Math.log10(Paux_MW + 1) / 3);
  return `rgba(${Math.round(60 + 190 * u)},${Math.round(100 - 60 * u)},${Math.round(230 - 200 * u)},0.75)`;
}

const FONT = '10px JetBrains Mono, monospace';

/** Draw the map and its overlays. The canvas is assumed to be `view.width × view.height` CSS px (transform already set). */
export function drawPopcon(ctx: CanvasRenderingContext2D, grid: PopconGrid, view: PopconView, cfg: Pick<MagneticConfig, 'method' | 'limits'>, overlay: PopconOverlay = {}): void {
  const { nx, ny, T, Paux, Q, betaN, PLH_ok, nG } = grid;
  const { width, height, nMax, Tmax } = view;
  const r = plotRect(view);
  const stell = cfg.method === 'stellarator';
  const xp = (v: number) => r.x + (v / nMax) * r.w, yp = (v: number) => r.y + r.h - (v / Tmax) * r.h;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  const dn = nMax / nx;
  // cells: P_aux colour, β_N above the limit in red, below the L-H threshold darkened
  for (let i = 0; i < nx; i++) {
    const x0 = xp(i * dn), x1 = xp((i + 1) * dn);
    for (let j = 0; j < ny; j++) {
      const k = i * ny + j;
      const Tlo = j > 0 ? (T[j - 1] + T[j]) / 2 : 0, Thi = j < ny - 1 ? (T[j] + T[j + 1]) / 2 : Tmax;
      const y0 = yp(Thi), h = yp(Tlo) - y0 + 0.5, w = x1 - x0 + 0.5;
      ctx.fillStyle = cellColor(Paux[k] / 1e6); ctx.fillRect(x0, y0, w, h);
      if (betaN[k] > cfg.limits.betaN_limit) { ctx.fillStyle = 'rgba(239,71,111,0.35)'; ctx.fillRect(x0, y0, w, h); }
      if (!PLH_ok[k] && !stell) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, y0, w, h); }
    }
  }
  // Q contours (log scale; P_aux ≤ 0 is Q = ∞)
  const logQ = (i: number, j: number) => { const q = Q[i * ny + j]; return Number.isFinite(q) ? Math.log10(Math.max(q, 1e-3)) : 3; };
  ctx.lineWidth = 1.3;
  for (const lv of P_LEVELS) {
    ctx.strokeStyle = lv.c; ctx.beginPath();
    const seg = contourSegments(grid, logQ, Math.log10(lv.v));
    for (let s = 0; s < seg.length; s += 4) { ctx.moveTo(xp(seg[s]), yp(seg[s + 1])); ctx.lineTo(xp(seg[s + 2]), yp(seg[s + 3])); }
    ctx.stroke();
  }
  // the heating power applied now: where a steady state at this power lies
  if (overlay.heatingMW != null && overlay.heatingMW > 0) {
    const seg = contourSegments(grid, (i, j) => Paux[i * ny + j] / 1e6, overlay.heatingMW);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.beginPath();
    for (let s = 0; s < seg.length; s += 4) { ctx.moveTo(xp(seg[s]), yp(seg[s + 1])); ctx.lineTo(xp(seg[s + 2]), yp(seg[s + 3])); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // Greenwald density
  if (!stell && nG * cfg.limits.greenwald_limit < nMax) {
    const gx = xp(nG * cfg.limits.greenwald_limit);
    ctx.strokeStyle = '#ef476f'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ef476f'; ctx.font = FONT; ctx.textAlign = 'left'; ctx.fillText('n_G', gx + 3, r.y + 10);
  }
  // trajectory of the run: older is fainter
  const tr = overlay.trajectory;
  if (tr && tr.n.length > 1) {
    const K = 8, per = Math.ceil((tr.n.length - 1) / K);
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    for (let g = 0; g < K; g++) {
      const a = g * per, b = Math.min(tr.n.length - 1, a + per);
      if (a >= b) break;
      ctx.strokeStyle = `rgba(255,255,255,${(0.25 + 0.7 * ((g + 1) / K)).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(xp(tr.n[a]), yp(tr.T[a]));
      for (let q = a + 1; q <= b; q++) ctx.lineTo(xp(tr.n[q]), yp(tr.T[q]));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(xp(tr.n[0]), yp(tr.T[0]), 3, 0, Math.PI * 2); ctx.stroke(); // the start
  }
  // the point the shot is steered to, the operating point, the hover cross-hair
  const ring = (p: MapPoint, color: string, radius: number, cross: number) => {
    const px = xp(Math.min(p.n, nMax)), py = yp(Math.min(p.T, Tmax));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
    if (cross) { ctx.beginPath(); ctx.moveTo(px - cross, py); ctx.lineTo(px + cross, py); ctx.moveTo(px, py - cross); ctx.lineTo(px, py + cross); ctx.stroke(); }
  };
  const tg = overlay.target;
  if (tg && Number.isFinite(tg.n) && Number.isFinite(tg.T)) ring(tg, '#f8961e', 6, 0);
  const pt = overlay.point;
  if (pt && Number.isFinite(pt.n) && Number.isFinite(pt.T)) ring(pt, '#ffffff', 5, 9);
  const hv = overlay.hover;
  if (hv) {
    ctx.strokeStyle = 'rgba(214,220,232,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath();
    ctx.moveTo(xp(hv.n), r.y); ctx.lineTo(xp(hv.n), r.y + r.h); ctx.moveTo(r.x, yp(hv.T)); ctx.lineTo(r.x + r.w, yp(hv.T)); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  // frame, ticks and labels
  ctx.strokeStyle = '#263044'; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#7f8ba3'; ctx.font = FONT; ctx.textAlign = 'center';
  for (const v of niceTicks(nMax / 1e20, 5)) ctx.fillText(fmtAxis(v), xp(v * 1e20), height - 8);
  ctx.fillText('n̄_e [10²⁰ m⁻³]', r.x + r.w / 2, height - 0.5);
  ctx.textAlign = 'right';
  for (const v of niceTicks(Tmax, 5)) ctx.fillText(fmtAxis(v), r.x - 4, yp(v) + 3);
  ctx.save(); ctx.translate(11, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('T̄ [keV]', 0, 0); ctx.restore();
  // legend
  ctx.textAlign = 'left';
  let ly = r.y + 14;
  for (const lv of P_LEVELS) { ctx.fillStyle = lv.c; ctx.fillText(lv.lbl, r.x + r.w - 44, ly); ly += 12; }
  ctx.fillStyle = '#06d6a0'; ctx.fillText('P_aux<0', r.x + r.w - 44, ly); ly += 12;
  ctx.fillStyle = '#ef476f'; ctx.fillText('β_N>lim', r.x + r.w - 44, ly); ly += 12;
  ctx.fillStyle = '#7f8ba3'; ctx.fillText('dark: P<P_LH', r.x + r.w - 74, ly);
}
