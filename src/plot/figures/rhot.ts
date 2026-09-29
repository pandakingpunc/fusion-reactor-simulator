/**
 * Radius-time heat map of a 1.5D profile quantity (rho_tor on the vertical axis, time on the horizontal
 * axis, the value as colour): how T_e, n_e, q, j or a power density evolve through a discharge, with the
 * L-H transition and the crash events marked. The frames of a shot are unevenly spaced in time (the
 * integrator's steps, extra frames at crashes), so the field is resampled onto a uniform time grid
 * (piecewise linear in time, or the nearest frame) before it is drawn as a raster.
 */
import type { HistoryFrame, SimEvent } from '../../physics/types';
import { Figure } from '../figure';
import { COL2 } from './common';

export interface RhoTField {
  /** frame times (ascending) */
  t: number[];
  /** radial grid (ascending, the same for all frames) */
  rho: number[];
  /** Z[i * rho.length + j]: value at time t[i], radius rho[j] */
  Z: Float64Array;
}

/**
 * The profile `key` of every history frame that carries profiles, as one field; null when fewer than
 * two frames do, or the key is absent. Frames whose profile has another length than the first one are
 * skipped (a re-gridded run), values are multiplied by `scale`.
 */
export function rhoTFromFrames(frames: readonly HistoryFrame[], key: string, scale = 1): RhoTField | null {
  const withP = frames.filter((f) => f.prof && f.prof.rho && f.prof[key]);
  if (withP.length < 2) return null;
  const rho = withP[0].prof!.rho;
  const rows = withP.filter((f) => f.prof!.rho.length === rho.length && f.prof![key].length === rho.length);
  if (rows.length < 2) return null;
  const Z = new Float64Array(rows.length * rho.length);
  rows.forEach((f, i) => { const v = f.prof![key]; for (let j = 0; j < rho.length; j++) Z[i * rho.length + j] = v[j] * scale; });
  return { t: rows.map((f) => f.t), rho: rho.slice(), Z };
}

/**
 * Resamples a field onto `nt` uniformly spaced times between its first and last frame:
 * 'linear' interpolates between the two neighbouring frames, 'nearest' takes the closer one (crashes
 * stay sharp). Returns the new field (same radial grid).
 */
export function resampleUniform(f: RhoTField, nt: number, mode: 'linear' | 'nearest' = 'linear'): RhoTField {
  const n = f.t.length, nr = f.rho.length;
  const m = Math.max(2, Math.floor(nt));
  const t0 = f.t[0], t1 = f.t[n - 1];
  const t = Array.from({ length: m }, (_, k) => t0 + ((t1 - t0) * k) / (m - 1));
  const Z = new Float64Array(m * nr);
  let i = 0;
  for (let k = 0; k < m; k++) {
    while (i < n - 2 && f.t[i + 1] < t[k]) i++;
    const ta = f.t[i], tb = f.t[i + 1];
    const u = tb > ta ? Math.min(1, Math.max(0, (t[k] - ta) / (tb - ta))) : 0;
    const w = mode === 'nearest' ? (u < 0.5 ? 0 : 1) : u;
    for (let j = 0; j < nr; j++) Z[k * nr + j] = (1 - w) * f.Z[i * nr + j] + w * f.Z[(i + 1) * nr + j];
  }
  return { t, rho: f.rho, Z };
}

export interface RhoTFigureInput {
  field: RhoTField;
  /** colour bar label (mathtext) */
  label: string;
  /** colormap (default viridis; any tabulated name of colors.ts or 'RdBu' for a signed quantity) */
  cmap?: string;
  log?: boolean;
  vmin?: number;
  vmax?: number;
  /** contour levels drawn over the map (white lines) */
  contours?: number[];
  /** events to mark: 'LH' as a vertical line, 'ELM' / 'sawtooth' / 'NTM_onset' as ticks along the top */
  events?: readonly SimEvent[];
  title?: string;
  /** time axis label (default: t (s)) */
  timeLabel?: string;
  /** raster columns (default: the number of frames, at most 600) */
  nt?: number;
  mode?: 'linear' | 'nearest';
}

// grey, yellow and pink read on the dark end of every colormap and on the white legend box
const EVENT_TICKS: [string, string][] = [['ELM', '#a0a0a0'], ['sawtooth', '#f0e442'], ['NTM_onset', '#ff7f7f']];

/** rho-t heat map with a colour bar, optional contour lines and event marks. */
export function figRhoT(inp: RhoTFigureInput): Figure {
  const f = inp.field;
  const fig = new Figure(COL2, 2.7, { fontSize: 8, title: inp.title ?? 'Radius-time evolution' });
  const [ax] = fig.subplots(1, 1, { left: 0.62, right: 0.85, top: 0.25, bottom: 0.5 });
  const nr = f.rho.length;
  const r = resampleUniform(f, inp.nt ?? Math.min(600, Math.max(2, f.t.length)), inp.mode ?? 'linear');
  const nt = r.t.length;
  // raster rows run over rho (j), columns over time (i)
  const img = new Float64Array(nr * nt);
  for (let j = 0; j < nr; j++) for (let i = 0; i < nt; i++) img[j * nt + i] = r.Z[i * nr + j];
  const dt = (r.t[nt - 1] - r.t[0]) / (nt - 1), dr = nr > 1 ? (f.rho[nr - 1] - f.rho[0]) / (nr - 1) : 1;
  const extent: [number, number, number, number] = [r.t[0] - dt / 2, r.t[nt - 1] + dt / 2, Math.max(0, f.rho[0] - dr / 2), Math.min(1, f.rho[nr - 1] + dr / 2)];
  const map = ax.image(img, nt, nr, extent, { cmap: inp.cmap ?? 'viridis', vmin: inp.vmin, vmax: inp.vmax, log: inp.log, smooth: true });
  fig.colorbar(map, ax, { label: inp.label, width: 0.1, pad: 0.08 });
  if (inp.contours?.length) ax.contour(r.t, f.rho, img, inp.contours, { colors: '#ffffff', lw: 0.5 });
  for (const e of inp.events ?? []) if (e.kind === 'LH') ax.axvline(e.t, { color: '#ffffff', lw: 0.7, dash: 'dotted' });
  for (const [kind, color] of EVENT_TICKS) {
    const xs = (inp.events ?? []).filter((e) => e.kind === kind).map((e) => e.t);
    if (xs.length) ax.xmarks(xs, { color, frac: 0.05, label: kind === 'NTM_onset' ? 'NTM onset' : kind });
  }
  ax.set({ xlim: [extent[0], extent[1]], ylim: [extent[2], extent[3]], xlabel: inp.timeLabel ?? '$t$ (s)', ylabel: '$\\rho_{\\mathrm{tor}}$' });
  if ((inp.events ?? []).some((e) => EVENT_TICKS.some(([k]) => k === e.kind))) ax.legend({ loc: 'lower right', frame: true, size: 6 });
  return fig;
}
